// One room: a World stepped at 30 Hz, its players and their wire — the join,
// the leave and the silent sweep, the engine loop and the event rows. Split
// out of `rooms.mjs` (which re-exports `Room`); the control channel is
// `room-control.mjs`, the choke and snapshot stream `room-stream.mjs`.

import { FixedStep, MAX_CATCH_UP_TICKS } from '../viewer/physics.js';
import { WORLD_TICK_DT, WORLD_TICK_RATE } from '../viewer/world.js';
import { createAuthority } from './authority.mjs';
import {
  MAX_PLAYERS,
  MSG_ACTION, MSG_EVENT, MSG_INPUT, MSG_LEAVE, MSG_PING, MSG_PONG,
  decodeInputFrame,
} from '../viewer/netcode.js';
import {
  DROP_SWEEP_MS, FIRE_EVENT_COOLDOWN_S, FRAME_MS, HEARTBEAT_TIMEOUT_MS, NAME_OK,
  SNAPSHOT_RATE_DEFAULT, error, isPeer, nextFreeSlot,
} from './room-rules.mjs';
import { encodeJsonMsg, eventRow, frame, parseJson, serverTimeBytes } from './room-wire.mjs';
import { chokeRates, sendSnapshots, snapshotRecord } from './room-stream.mjs';
import { createControlChannel } from './room-control.mjs';

// --- the room ----------------------------------------------------------------

/**
 * One game: a joined LevelInstance (its World), the players and the wire.
 *
 * The clock: `frame(nowMs)` accumulates real elapsed time into a FixedStep
 * (the page's own, physics.js) and runs that many engine ticks, one
 * `world.step(WORLD_TICK_DT)` at a time, so consumed inputs and their fire
 * flags are observable per tick; MAX_CATCH_UP_TICKS bounds a burst the same
 * way the World's own clock bounds one. The harness drives `frame` directly;
 * production `start()`s a 33 ms interval that does the same.
 */
export class Room {
  #control;

  constructor({ code, level, now = null }) {
    this.code = code;
    this.levelData = level;           // the shared LevelData
    this.instance = level.instantiate();
    this.world = this.instance.world;
    this.now = now || (() => performance.now());
    this.tick = 0;                    // engine ticks run (MSG_EVENT's `t`)
    this.clock = new FixedStep({ rate: WORLD_TICK_RATE, maxTicks: MAX_CATCH_UP_TICKS });
    /** slot (1..16) -> connection record. Slot order is join order. */
    this.players = new Map();
    this.lastAt = null;
    this.lastSweep = 0;
    this.timer = null;
    // P3: the damage/death/ticket/flag authority, fed this room's world
    // (its rows go to everyone — the kill feed, the tickets, the flags).
    this.authority = createAuthority({
      world: this.world,
      loadouts: level?.loadouts,
      levelDir: level?.name ?? null,
      ownerOf: root => this.instance.ownerOf(root),
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
    });
    // The control channel's seat/spawn actions (room-control.mjs).
    this.#control = createControlChannel({
      room: this,
      event: (type, connection, extra) => this.#event(type, connection, extra),
    });
  }

  level() { return this.levelData.name; }
  mode() { return this.levelData.extras?.gameplayMode || null; }
  playerCount() { return this.players.size; }
  capacity() { return MAX_PLAYERS; }

  /** The lobby row: {code, level, mode, players, max}. */
  listRow() {
    return { code: this.code, level: this.level(), mode: this.mode(),
             players: this.playerCount(), max: this.capacity() };
  }

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.frame(null), FRAME_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // --- the join handshake ----------------------------------------------------

  /**
   * MSG_JOIN → MSG_HELLO → MSG_JOIN_SNAPSHOT → stream (netcode.js §join).
   * On failure returns `{ok: false, code}`; the caller sends MSG_CLOSED and
   * closes. On success the connection's slot/name/team/rate are set.
   */
  join(connection, { name, team }) {
    if (this.players.size >= MAX_PLAYERS) return error('room_full');
    if (!isPeer(connection.peer)) return error('no_peer');
    if (name == null || !NAME_OK.test(String(name).trim())) return error('bad_name');
    if (!(team === 0 || team === 1 || team === 2)) return error('bad_team');
    const slot = nextFreeSlot(this.players);
    if (slot === null) return error('room_full');
    if (team === 0) team = this.#autoTeam();
    connection.slot = slot;
    connection.name = String(name).trim();
    connection.team = team;
    connection.rate = SNAPSHOT_RATE_DEFAULT;
    connection.nextSendAt = 0;
    connection.fireAt = 0;
    connection.lastSeen = this.now();
    this.players.set(slot, connection);
    // addPlayer places the soldier on the team's flag (world.js's own join
    // law) and the client's spawn row re-places it on its chosen flag.
    this.world.addPlayer(slot, { team });
    return { ok: true, slot, team };
  }

  /** The engine's join half: fewer first, tie lands on team 1. */
  #autoTeam() {
    let one = 0, two = 0;
    for (const p of this.players.values()) {
      if (p.team === 1) one++; else if (p.team === 2) two++;
    }
    return one <= two ? 1 : 2;
  }

  /** The HELLO row (netcode.js: slot, room, level, mode, team, name, slots,
   *  maxPlayers, flags, vehicles, tickets). `slots` is the roster the
   *  joining player can see — every slot except their own, name and team —
   *  so the page's labels and feed have names before the first event row. */
  helloRow(connection) {
    const roster = [];
    for (const [slot, c] of this.players) {
      if (slot === connection.slot) continue;
      roster.push({ slot, name: c.name, team: c.team });
    }
    return {
      slot: connection.slot,
      room: this.code,
      level: this.level(),
      mode: this.mode(),
      team: connection.team,
      name: connection.name,
      slots: roster,
      maxPlayers: MAX_PLAYERS,
      flags: this.flagsForWire(),
      vehicles: this.vehiclesForWire(),
      tickets: this.world.tickets,
    };
  }

  /** [{name, team}] — the deploy screen lists the level's flags. */
  flagsForWire() {
    return this.instance.flags.map(f => ({ name: f.name, team: f.team }));
  }

  /** [{id, template}] — the room-side seat table; ids are reused by
   *  MSG_ACTION {type:'seat', vehicle: <id>} and the snapshot records. */
  vehiclesForWire() {
    return this.instance.table.map(v => ({ id: v.id, template: v.template }));
  }

  // --- inbound messages ------------------------------------------------------

  /** Whole framed payloads (type byte first), from an adapter or a harness. */
  onMessage(connection, payload) {
    const type = payload[0];
    const body = payload.subarray ? payload.subarray(1) : payload.slice(1);
    connection.lastSeen = this.now();
    switch (type) {
      case MSG_LEAVE: {
        this.leave(connection);
        return;
      }
      case MSG_PING: {
        // u32le client time; the pong carries our monotonic ms. The law is
        // the timeout, not the cadence — the client decides when to ping.
        const clientMs = body.length >= 4
          ? (body[0] | (body[1] << 8) | (body[2] << 16) | (body[3] << 24)) : 0;
        connection.peer.send(frame(MSG_PONG, serverTimeBytes(this.now())));
        return;
      }
      case MSG_INPUT: {
        if (body.length < 4 + 14) return;   // malformed; ignore, keep alive
        // The P3 death decree: the dead send nothing (the page's own loop
        // stops at `soldierDead`; the world idles the body either way).
        if (!this.authority.mayInput(connection.slot)) return;
        const { seq, input, look } = decodeInputFrame(body);
        this.world.setInput(connection.slot, input, look, seq);
        return;
      }
      case MSG_ACTION: {
        this.#onAction(connection, parseJson(body));
        return;
      }
      default: {
        // Unknown bytes on a joined socket: ignore. A future client posting
        // a forward-compatible row must not break a live round.
      }
    }
  }

  #onAction(connection, row) {
    this.#control.onAction(connection, row);
  }

  /** Exit: the level's leave law (unmount + park + soldier placement), then
   *  the room's row. Shared by the explicit exit, leave and drop paths. */
  #unmount(connection) {
    this.#control.unmount(connection);
  }

  /** The kit max from `_shared/loadouts.json` for this level/mode/team —
   *  the page's soldierMaxHp path, minus the deploy-screen kit pick (P3). */
  // --- leave and drop --------------------------------------------------------

  /** J-3's 0xd: the explicit leave. The socket stays open for a re-join. */
  leave(connection) {
    if (connection.slot == null) return;
    const slot = connection.slot;
    const name = connection.name;
    if (this.world.player(slot)?.occupancy) this.#unmount(connection);
    this.world.removePlayer(slot);
    this.players.delete(slot);
    connection.slot = null;
    connection.name = null;
    connection.team = null;
    this.broadcast(eventRow('leave', this.tick, { slot, text: name }),
      connection);
  }

  /** The silent sweep: a peer that has sent nothing for HEARTBEAT_TIMEOUT_MS
   *  is gone; the leave row broadcasts and the socket closes. */
  #sweepDrops(nowMs) {
    for (const connection of this.players.values()) {
      if (nowMs - connection.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        this.leave(connection);
        connection.peer.close(4000, 'silent timeout');
      }
    }
  }

  // --- the engine loop -------------------------------------------------------

  /** One scheduler lap: catch the clock up (bounded), then let each
   *  connection's snapshot cadence fire. `elapsedMs` is real elapsed wall
   *  time; the harness injects its own. */
  frame(elapsedMs = null) {
    const nowMs = this.now();
    if (this.lastAt === null) this.lastAt = nowMs;
    if (elapsedMs == null) elapsedMs = Math.max(0, nowMs - this.lastAt);
    this.lastAt = nowMs;

    const n = this.clock.advance(elapsedMs / 1000);
    for (let i = 0; i < n; i++) this.#tick();
    this.#choke();
    this.#broadcastSnapshots(nowMs);
    if (nowMs - this.lastSweep >= DROP_SWEEP_MS) {
      this.lastSweep = nowMs;
      this.#sweepDrops(nowMs);
    }
  }

  #tick() {
    this.tick++;
    const world = this.world;
    const step = world.step(WORLD_TICK_DT);
    // P3: death decree, ticket bleeds, flag captures — the authority's own
    // half after every world step (all damage funnels landed during it).
    this.authority.afterStep(step, WORLD_TICK_DT);
    const nowMs = this.now();
    for (const [slot, connection] of this.players) {
      const player = world.player(slot);
      if (!player) continue;
      // A bare seat (a gun root with no drivetrain) has no Vehicle to hold
      // its pose: feed the root's live matrix the way the page feeds
      // `setPlayerPosition`, so the snapshot and the combat area read right.
      // On-foot players need none of this, but they DO fire — the scan
      // below is not seated-only.
      if (player.occupancy && !player.vehicle && player.position) {
        world.setPlayerPosition(slot, this.instance.positionOf(player.occupancy));
      }
      // The input acknowledgement: the HIGHEST seq this world has consumed for
      // the player, kept monotonic. `player.last` is only the entry THIS tick
      // consumed, and a tick with nothing buffered consumes the engine's
      // zeroed word, which carries no seq — reading the ack straight off it
      // would blank the acknowledgement on every idle tick and cost the client
      // the tick it reconciles against (netcode-reconcile.js).
      if (Number.isInteger(player.last?.seq) && player.last.seq > connection.ack) {
        connection.ack = player.last.seq;
      }
      // Fire events, at the throttle: `player.last` is the entry exactly one
      // tick consumed, so a fire flag here is the World's own receive law.
      const last = player.last;
      if (last?.input?.fire && nowMs >= connection.fireAt
          && !this.authority.dead.has(slot)) {
        connection.fireAt = nowMs + FIRE_EVENT_COOLDOWN_S * 1000;
        this.broadcast(eventRow('fire', this.tick, { slot }), connection);
      }
    }
  }

  /** R-1 (room-stream.mjs `chokeRates`). */
  #choke() {
    chokeRates(this.players);
  }

  #broadcastSnapshots(nowMs) {
    sendSnapshots(this.players, nowMs, () => this.snapshotPayload());
  }

  /** The 20 Hz record (room-stream.mjs `snapshotRecord`), built once per
   *  send. Public because the core's join handshake sends it as
   *  MSG_JOIN_SNAPSHOT. */
  snapshotPayload() {
    return snapshotRecord(this);
  }

  /** A MSG_EVENT row to every player except the source (the actor's own
   *  client simulates its own seat changes and fire; join/leave exclude
   *  the actor). */
  #event(type, connection, extra) {
    this.broadcast(eventRow(type, this.tick, { slot: connection.slot, ...extra }),
      connection);
  }

  broadcast(row, except) {
    const bytes = encodeJsonMsg(row, MSG_EVENT);
    for (const connection of this.players.values()) {
      if (connection === except) continue;
      connection.peer.send(bytes);
    }
  }

  broadcastToAll(row) {
    const bytes = encodeJsonMsg(row, MSG_EVENT);
    for (const connection of this.players.values()) connection.peer.send(bytes);
  }
}
