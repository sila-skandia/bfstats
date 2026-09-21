// The room server's core: the transport-agnostic half of the P2 netcode.
//
// One Room per join code: a World (P1) stepped at the engine's 30 Hz by a
// fixed-step accumulator driven from the monotonic wall clock, input fed
// through `World.setInput(id, input, look, seq)` so the World's own receive
// law does the enforcing (trim <= 4 drop-oldest, exactly one consume per
// tick, zeroed idle word on an empty buffer, seq dedupe on `seq > lastSeen`,
// backlog > 9 collapses), one 20 Hz snapshot stream per connection under the
// R-1 choke, and the control channel's seat/spawn actions mirrored on the
// world. Everything here talks to abstract `{send(bytes), close()}` peers —
// `server.mjs` adapts the WebSocket, the harnesses drive the same core with
// in-memory peers, which is what keeps the protocol law in one place and the
// tests off the network.
//
// Laws pinned here, with the ledger in `features/bf1942-engine-reference/
// subsystems/netcode.md`:
//   LOOP/D-*  the receive law — enforced by World.setInput, fed verbatim
//   J-1/J-3   the control channel: seat enter/exit/switch and spawn arrive
//             as action rows, not as PlayerActions; 0xd is the explicit
//             MSG_LEAVE and its drop twin is the silent-10 s sweep
//   P-2       snapshots at 20 Hz (default), each connection its own rate
//   R-1       Σ(rate × 1044) ≤ cap; offenders lose 5, never below 10 —
//             the engine's own cap value was not recovered in P0, so the
//             cap is a documented P2 choice (see server/README.md)
//
// Divergences, all documented: one drive model per hull at a time (the
// World's #vehicleTick integrates player.vehicle once per seated player), a
// bare seat's snapshot pose comes from the root's live world matrix via the
// player.position feed, and fire events are throttled to ~0.35 s per player
// (map.html's 1/0.35 SMG cadence) pending P3's real GunFire rounds.

import { FixedStep, MAX_CATCH_UP_TICKS } from '../viewer/physics.js';
import { WORLD_TICK_DT, WORLD_TICK_RATE } from '../viewer/world.js';
import { createAuthority } from './authority.mjs';
import {
  MAX_PLAYERS,
  MSG_ACTION, MSG_CLOSED, MSG_EVENT, MSG_HELLO, MSG_INPUT,
  MSG_JOIN, MSG_JOIN_SNAPSHOT, MSG_LEAVE, MSG_PING, MSG_PONG,
  MSG_SNAPSHOT,
  encodeSnapshot, decodeInputFrame,
} from '../viewer/netcode.js';

/** A join code's shape (the lobby rule; see server/README.md §decisions). */
export const ROOM_CODE_RE = /^[A-Za-z0-9_-]{3,24}$/;
export const NAME_MAX = 24;
const NAME_OK = /^[^\x00-\x1f\x7f]{1,24}$/;

/** The R-1 choke's shape: conn+0x10 = 1044 byte-budget per rate unit... */
export const RATE_BYTES = 1044;
export const SNAPSHOT_RATE_DEFAULT = 20;
export const SNAPSHOT_RATE_MIN = 10;
/** ... and the capacity law the room server honors. 1044 x 16 x 20 — every
 *  player at the default rate — is the P2 choice for the engine's own value
 *  (not recovered in P0; see server/README.md §decisions). */
export const CHOKE_CAP = RATE_BYTES * MAX_PLAYERS * SNAPSHOT_RATE_DEFAULT;

/** Silent connections are dropped — the peer's 0xd-equivalent (J-3). */
/** A connection the server heard nothing from for this long is gone. The
 *  page pings every 4 s, so 15 s tolerates a paused main thread (a
 *  client-side level load can hold a synchronous burst of several seconds,
 *  during which the page cannot even run its own timer) without drifting
 *  into the engine's 30 s keepalive period. */
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const DROP_SWEEP_MS = 1_000;

/** Fire-event throttle: map.html's 1/0.35 s SMG cadence. P3's GunFire rounds
 *  will own the real cadence; this is the room's event copy. */
export const FIRE_EVENT_COOLDOWN_S = 0.35;

/** The room clock's own frame cadence (33.33 ms); the FixedStep interior
 *  means the cadence is a target, not a law. */
const FRAME_MS = Math.max(1, Math.round(WORLD_TICK_DT * 1000));

/**
 * The `{send, close}` peer contract one adapter must meet (documented in
 * server/README.md; server.mjs's socket adapter is the reference).
 * `send` takes the whole frame (type byte + payload) as Uint8Array.
 */
export function isPeer(peer) {
  return peer && typeof peer.send === 'function' && typeof peer.close === 'function';
}

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
    if (!row || typeof row !== 'object') return;
    if (row.type === 'spawn') this.#onSpawn(connection, row);
    else if (row.type === 'seat') this.#onSeat(connection, row);
  }

  /** The deploy action: place the soldier on the flag the row names (0-based
   *  into HELLO's flags), or the team's own flag when the row omits it. The
   *  P3 authority revives the player first — the fresh Armor at the kit's
   *  max (`authority.revive`, loadouts.json), the death decree lifted. */
  #onSpawn(connection, row) {
    const slot = connection.slot;
    const world = this.world;
    const player = world.player(slot);
    if (!player) return;
    if (player.occupancy) this.#unmount(connection);   // defensive
    const flags = this.instance.flags;
    let flag = null;
    const index = row?.flag;
    if (Number.isInteger(index) && index >= 0 && index < flags.length) {
      flag = flags[index];
    }
    this.authority.revive(slot, connection.team, row?.kit ?? null);
    if (!world.spawnPlayer(slot, { flag, advance: true })) return;
    this.#event('spawn', connection, {});
  }

  /** The engine's control channel rows (netcode.js): enter/exit/switch.
   *  The seat index is the occupancy survey's order position, 0 = root —
   *  the same index the snapshot's seatIndex carries. */
  #onSeat(connection, row) {
    const slot = connection.slot;
    const world = this.world;
    const vehicleId = Number.isInteger(row?.vehicle) ? row.vehicle : 0;
    const vehicle = this.instance.table.find(v => v.id === vehicleId);
    if (!vehicle) return;
    const seatIndex = Number.isInteger(row?.seat) ? Math.max(0, row.seat) : 0;
    const action = row?.action;
    const player = world.player(slot);
    const current = player?.occupancy?.root;

    if (action === 'enter') {
      if (current) this.#unmount(connection);
      let mounted = null;
      try {
        mounted = this.instance.mountIntoSeat(world, slot, vehicle, seatIndex);
      } catch (error) {
        console.error(`room ${this.code}: slot ${slot} seat enter on ${vehicle.template} THREW: ${error.stack?.slice(0, 400) ?? error.message}`);
        return;
      }
      if (!mounted) {
        console.error(`room ${this.code}: slot ${slot} seat enter on ${vehicle.template} FAILED (seatIndex ${seatIndex}, survey ${this.instance.seatSurveyOf?.(vehicle) ?? 'n/a'})`);
        return;
      }
      console.error(`room ${this.code}: slot ${slot} entered ${vehicle.template} seat ${mounted.occupancy.order.indexOf(mounted.seatId)}`);
      this.#event('seatEnter', connection, {
        vehicle: vehicle.id,
        seat: mounted.occupancy.order.indexOf(mounted.seatId),
      });
    } else if (action === 'exit') {
      if (current && current === vehicle.root) this.#unmount(connection);
    } else if (action === 'switch') {
      if (!current || current !== vehicle.root) return;
      const switched = this.instance.switchSeat(world, slot, vehicle, seatIndex);
      if (!switched || !switched.changed) return;
      this.#event('seatEnter', connection, {
        vehicle: vehicle.id,
        seat: switched.occ.order.indexOf(switched.seatId),
      });
    }
  }

  /** Exit: the level's leave law (unmount + park + soldier placement), then
   *  the room's row. Shared by the explicit exit, leave and drop paths. */
  #unmount(connection) {
    const player = this.world.player(connection.slot);
    if (!player?.occupancy) return;
    const seat = player.occupancy.order.indexOf(player.occupancy.activeSeatId);
    const root = player.occupancy.root;
    const vehicle = this.instance.table.find(v => v.root === root);
    this.instance.unmountFromSeat(this.world, connection.slot, vehicle);
    if (vehicle) {
      this.#event('seatExit', connection, {
        vehicle: vehicle.id,
        seat: seat >= 0 ? seat : 0,
      });
    }
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

  /** R-1: while Σ(rate × 1044) > cap, the highest-rate connections above the
   *  floor lose 5 — the engine's "lower the offending rates" (netcode.md §5).
   *  The snapshot is ~52 B/player-equivalent at 20 Hz, so this is a capacity
   *  law, not a bandwidth panic. */
  #choke() {
    let total = 0;
    for (const connection of this.players.values()) total += connection.rate * RATE_BYTES;
    if (total <= CHOKE_CAP) return;
    const sorted = [...this.players.values()].sort((a, b) => b.rate - a.rate);
    let at = 0;
    while (total > CHOKE_CAP && at < sorted.length) {
      const c = sorted[at];
      if (c.rate <= SNAPSHOT_RATE_MIN) { at++; continue; }
      c.rate = Math.max(SNAPSHOT_RATE_MIN, c.rate - 5);
      total -= 5 * RATE_BYTES;
      if (at === sorted.length - 1) at = 0;    // another pass round the list
      else at++;
    }
  }

  #broadcastSnapshots(nowMs) {
    for (const connection of this.players.values()) {
      if (nowMs < connection.nextSendAt) continue;
      connection.peer.send(frame(MSG_SNAPSHOT, this.snapshotPayload()));
      // The cadence is the connection's own rate; roll the phase instead of
      // snapping to now, so a lagging burst of frames does not ride one tick.
      connection.nextSendAt = nowMs + (1000 / connection.rate);
    }
  }

  /** The 20 Hz record (netcode.js's encodeSnapshot), built once per send —
   *  every connection at whatever rate ships the same bytes. Public because
   *  the core's join handshake sends it as MSG_JOIN_SNAPSHOT. */
  snapshotPayload() {
    const world = this.world;
    const rows = new Map(world.playersSnapshot().map(r => [r.id, r]));
    const players = [];
    for (const [slot, connection] of this.players) {
      const row = rows.get(slot);
      if (!row) continue;
      let { x, y, z } = row;
      // A seated player whose seat has no drivetrain: the world's own
      // snapshot falls back to the soldier's (stale) pose; the room's live
      // root-matrix feed is the truth here.
      const wp = world.player(slot);
      if (row.seated && wp && !wp.vehicle && wp.position) {
        x = wp.position[0]; y = wp.position[1]; z = wp.position[2];
      }
      const entry = row.vehicleOwner != null
        ? this.instance.ownerToEntry.get(row.vehicleOwner) : null;
      players.push({
        slot,
        alive: row.alive, seated: row.seated,
        crouch: row.crouch, prone: row.prone,
        inVehicle: row.inVehicle,
        team: row.team, x, y, z, yaw: row.yaw, pitch: row.pitch,
        hp: row.hp,
        vehicleId: entry ? entry.id : 0,
        seatIndex: row.seatIndex >= 0 ? Math.min(row.seatIndex, 15) : null,
      });
    }
    const vehicles = [];
    for (const entry of this.instance.table) {
      const pose = world.vehiclePose(entry.owner);
      if (!pose) continue;
      vehicles.push({
        id: entry.id,
        occupied: entry.seated > 0,
        air: entry.kind === 'air',
        ground: entry.kind === 'ground',
        x: pose.x, y: pose.y, z: pose.z, q: pose.q,
      });
    }
    return encodeSnapshot(this.tick, players, vehicles);
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

// --- the core ----------------------------------------------------------------

/**
 * The room registry + socket-agnostic message routing.
 *
 * `levels` is a name -> LevelData map (real levels + the harness's `test`);
 * `defaultLevel` names the level a join creates a new room on when the join
 * row carries none. Attach a peer (one WebSocket, one committed connection)
 * then feed whole WebSocket payloads via `onMessage`; the core answers
 * MSG_CLOSED for anything but MSG_JOIN pre-join.
 */
export class RoomServerCore {
  constructor({ levels = new Map(), defaultLevel = null, now = null } = {}) {
    this.levels = levels;
    this.defaultLevel = defaultLevel;
    this.now = now || (() => performance.now());
    this.rooms = new Map();        // code -> Room
    this.connections = new Map();  // peer -> connection record
    this.nextId = 1;
    this.timer = null;
  }

  /** The lobby: [{code, level, mode, players, max}] (GET /netcode/rooms). */
  roomList() {
    return [...this.rooms.values()].map(r => r.listRow());
  }

  /** CREATE-or-join: a code with no room makes one on the default level. */
  createRoom(code, { level = null } = {}) {
    if (typeof code !== 'string' || !ROOM_CODE_RE.test(code)) return null;
    const existing = this.rooms.get(code);
    if (existing) return existing;
    const levelName = level || this.defaultLevel;
    const levelData = this.levels.get(levelName);
    if (!levelData) return null;
    const room = new Room({ code, level: levelData, now: this.now });
    this.rooms.set(code, room);
    return room;
  }

  room(code) { return this.rooms.get(code); }

  /** Drop a room: leave rows go out, sockets close, the code frees. */
  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.stop();
    for (const connection of [...room.players.values()]) {
      room.leave(connection);
      connection.peer.close(4000, 'room closed');
    }
    this.rooms.delete(code);
  }

  /** Register a socket; returns the connection the adapter holds. */
  attach(peer) {
    const connection = {
      id: this.nextId++,
      peer,
      slot: null,          // 1..16 once joined
      name: null,
      team: null,
      rate: SNAPSHOT_RATE_DEFAULT,
      nextSendAt: 0,
      lastSeen: this.now(),
      fireAt: 0,
      room: null,
    };
    this.connections.set(peer, connection);
    return connection;
  }

  detach(peer) {
    const connection = this.connections.get(peer);
    if (!connection) return;
    if (connection.room) connection.room.leave(connection);
    this.connections.delete(peer);
  }

  /** The one routing law: MSG_JOIN pre-join, the room's own handler after. */
  onMessage(peer, payload) {
    const connection = this.connections.get(peer);
    if (!connection) return;
    connection.lastSeen = this.now();
    if (connection.room == null) {
      if (payload[0] !== MSG_JOIN) {
        connection.peer.send(encodeJsonMsg({ code: 'join_first' }, MSG_CLOSED));
        connection.peer.close(4000, 'join_first');
        return;
      }
      this.#onJoin(connection, tail(payload));
      return;
    }
    connection.room.onMessage(connection, payload);
  }

  #onJoin(connection, body) {
    const row = parseJson(body);
    const bad = (code) => {
      connection.peer.send(encodeJsonMsg({ code }, MSG_CLOSED));
      connection.peer.close(4000, code);
    };
    if (!row || typeof row.room !== 'string') return bad('bad_join');
    const room = this.createRoom(row.room, { level: row.level ?? null });
    if (!room) return bad('bad_room');
    const joined = room.join(connection, {
      name: row.name ?? '',
      team: row.team == null ? 0 : row.team,
    });
    if (!joined.ok) return bad(joined.code);
    console.error(`room ${room.code}: slot ${joined.slot} joined as ${connection.name} (${room.players.size}/16)`);
    // The handshake: HELLO, then the live state, then the stream.
    connection.room = room;
    connection.peer.send(encodeJsonMsg(room.helloRow(connection), MSG_HELLO));
    connection.peer.send(frame(MSG_JOIN_SNAPSHOT, room.snapshotPayload()));
    room.broadcast(eventRow('join', room.tick, {
      slot: joined.slot, text: connection.name,
    }), connection);
  }

  /** The scheduler: one 33 ms lap across every room (production starts this;
   *  the harnesses drive `room.frame` directly and never do). */
  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      for (const room of this.rooms.values()) room.frame();
    }, FRAME_MS);
    for (const room of this.rooms.values()) room.start();
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const room of this.rooms.values()) room.stop();
  }
}

// --- wire helpers ------------------------------------------------------------

/** One type byte + payload (netcode.js's framing). */
export function frame(type, payload) {
  const out = new Uint8Array(1 + payload.length);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

/** A JSON control record's frame: type byte + UTF-8 JSON (netcode.js:
 *  "control is rare and a JSON row stays debuggable in a proxy log"). */
export function encodeJsonMsg(row, type = MSG_EVENT) {
  return Buffer.from([type, ...Buffer.from(JSON.stringify(row))]);
}

/** MSG_EVENT's row: {t, type, ...extra} — types join/leave/spawn/seatEnter/
 *  seatExit/fire/closed, plus row-specific keys (netcode.js). */
export function eventRow(type, tick, extra = {}) {
  return { t: tick, type, ...extra };
}

export function parseJson(body) {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    return null;
  }
}

function serverTimeBytes(ms) {
  const n = Math.max(0, Math.round(ms)) & 0xffffffff;
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

function tail(bytes) {
  return bytes.subarray ? bytes.subarray(1) : bytes.slice(1);
}

function nextFreeSlot(players) {
  for (let slot = 1; slot <= MAX_PLAYERS; slot++) {
    if (!players.has(slot)) return slot;
  }
  return null;
}

function error(code) { return { ok: false, code }; }