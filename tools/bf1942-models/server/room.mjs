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
  INPUT_BYTES_MIN, decodeInputFrame,
} from '../viewer/netcode.js';
import {
  CHOKE_CAP, CHOKE_PERIOD_MS, DROP_SWEEP_MS, FIRE_EVENT_COOLDOWN_S, FRAME_MS,
  HEARTBEAT_TIMEOUT_MS, NAME_OK, RATE_BYTES, SNAPSHOT_RATE_DEFAULT,
  STALL_COLLAPSE_TICKS, error, isPeer, nextFreeSlot,
} from './room-rules.mjs';
import { encodeJsonMsg, eventRow, frame, parseJson, serverTimeBytes } from './room-wire.mjs';
import { chokeRates, sendSnapshots, snapshotRecord } from './room-stream.mjs';
import { createControlChannel } from './room-control.mjs';
import { teamToAddPlayer } from '../viewer/team-to-add.js';
import { createRoomPads } from './room-pads.mjs';
import { createRoomMissiles } from './room-missiles.mjs';
import { createRoomHits } from './room-hits.mjs';
import { createRoomGuns } from './room-guns.mjs';
import { createRoomPacks } from './room-packs.mjs';
import { createRoomStats } from './room-stats.mjs';
import { createRoomHost } from './room-host.mjs';
import { createRoomBots } from './room-bots.mjs';

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

  constructor({ code, level, mode = null, now = null, random = null, rules = null,
                settings = null, host = null, bots = null }) {
    this.code = code;
    /** The auto-team's coin for a tie (`#autoTeam`, `rand() & 1`). */
    this.random = random || Math.random;
    this.levelData = level;           // the shared LevelData
    // The layer the room plays: the one the creating join asked for
    // (`?mode=`, resolved the page's way), else the level's default.
    this.instance = level.instantiate(mode);
    this.world = this.instance.world;
    this.now = now || (() => performance.now());
    this.tick = 0;                    // engine ticks run (MSG_EVENT's `t`)
    this.clock = new FixedStep({ rate: WORLD_TICK_RATE, maxTicks: MAX_CATCH_UP_TICKS });
    /** Ticks a stall cost the room's tick clock for good (`frame`, D-4). */
    this.ticksLost = 0;
    /** `game.serverBandwidthChokeLimit`: 0, the engine's default, is off (R-1). */
    this.chokeCap = CHOKE_CAP;
    this.lastChoke = null;
    /** slot (1..16) -> connection record. Slot order is join order. */
    this.players = new Map();
    this.lastAt = null;
    this.lastSweep = 0;
    /** When the room last had nobody in it (`room-registry.mjs`
     *  `reapEmptyRooms`); null while someone is. */
    this.emptyAt = this.now();
    this.timer = null;
    // The host half (room-host.mjs): the creator's settings, the admin, the
    // votes, the bans and the map list. `host` is the registry's part of it
    // (`hasLevel`, `changeLevel`, and a level change's `carry`).
    this.host = createRoomHost({ room: this, settings, base: rules, ...(host ?? {}) });
    // P3: the damage/death/ticket/flag authority, fed this room's world
    // (its rows go to everyone — the kill feed, the tickets, the flags).
    this.authority = createAuthority({
      world: this.world,
      loadouts: level?.loadouts,
      levelDir: level?.name ?? null,
      ownerOf: root => this.instance.ownerOf(root),
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
      // `clearWorld` empties the seats before it kills; the pads' half of it
      // and of the restart is the room's.
      onClearWorld: () => {
        for (const connection of this.players.values()) this.#unmount(connection);
        this.pads.clearWorld();
      },
      onRestart: () => this.pads.restart(),
      // The server's settings (`authority.mjs` `ROOM_RULES`): the pre-game
      // and the team-kill law, under the room's own settings.
      rules: { ...(rules ?? {}), ...this.host.rules() },
      // `kickPlayer(id, false)` (vt+0x334, 0x08148d40) at the team-kill
      // limit: the slot leaves and its socket closes (`room-host.mjs` `kick`).
      onKick: slot => { this.host.kick(slot); },
      // `killPlayer`'s auto-balance and `gameStatusEndGame`'s round count.
      onAutoBalance: slot => this.host.autoBalance(slot),
      onRoundsOver: () => this.host.roundsOver(),
      // TKT-8: a carried point's carrier, as this room has it.
      spawnGone: spawn => this.instance.carriedPointGone?.(spawn) ?? false,
    });
    // The control channel's seat, spawn and radio actions (room-control.mjs).
    this.#control = createControlChannel({
      room: this,
      event: (type, connection, extra) => this.#event(type, connection, extra),
    });
    // The score board's numbers on the wire (room-stats.mjs).
    this.stats = createRoomStats({ room: this });
    // The rounds that are vehicles (room-missiles.mjs, FA-29): before the
    // pads, whose books take the table as it stands at their start.
    this.missiles = createRoomMissiles({
      room: this,
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
      unmount: connection => this.#unmount(connection),
    });
    // The vehicle pads and the wrecks (room-pads.mjs), whose rows go to
    // everyone as the authority's do.
    this.pads = createRoomPads({
      room: this,
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
      unmount: slot => {
        const connection = this.players.get(slot);
        if (connection) this.#unmount(connection);
      },
    });
    // The hits and blasts the players' pages report, priced here
    // (room-hits.mjs).
    this.hits = createRoomHits({
      room: this,
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
    });
    // The seat guns and the bots' launchers, flown here (room-guns.mjs):
    // the World's `guns`, each landing priced by `hits.onRound`.
    this.guns = createRoomGuns({ room: this, capsuleRays: bots?.capsuleRays !== false });
    // A round that is a vehicle leaves the room's own barrel as one
    // (`round-launch.js` `fireRound` -> `guns.onVehicleRound`): the launch is
    // the missiles' (room-missiles.mjs, FA-29), for a player in the launcher.
    // The page's own `launch` row for the same round is then a repeat.
    if (this.guns?.guns) {
      this.guns.guns.onVehicleRound = group => {
        const slot = this.guns.firerOf?.(group);
        const root = slot != null ? this.world.player(slot)?.occupancy?.root : null;
        const launcher = root ? this.instance.table.find(v => v.root === root) : null;
        if (!launcher || !this.missiles.roundOf(launcher) || !this.players.has(slot)) return false;
        this.missiles.launch(slot, launcher);
        // Spent either way: a launcher with a round in the air throws no shell.
        return true;
      };
    }
    // The medic bags and wrenches the players' pages fire, run here
    // (room-packs.mjs): the heal is the server's, on the snapshot and the
    // `hull` rows.
    this.packs = createRoomPacks({
      room: this,
      onRow: row => this.broadcast(eventRow(row.type, this.tick, row), null),
    });
    // The room's bots (room-bots.mjs, online co-op): the page's referee in
    // this world, under the process's caps (`bots`, the registry's policy).
    this.bots = createRoomBots({ room: this, policy: bots });
  }

  level() { return this.levelData.name; }
  mode() { return this.instance.extras?.gameplayMode || null; }
  /** Whether the room plays the level's default layer, which a page whose
   *  URL names no `?mode=` loads too. */
  defaultMode() { return this.mode() === (this.levelData.modeOf(null) ?? this.mode()); }
  playerCount() { return this.players.size; }
  capacity() { return this.host.settings.maxPlayers; }

  /** The lobby row: {code, level, mode, players, max}. */
  listRow() {
    return { code: this.code, level: this.level(), mode: this.mode(),
             players: this.playerCount(), max: this.capacity(),
             password: !!this.host.settings.password };
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
  join(connection, { name, team, password = '', admin = null, id = null }) {
    if (this.players.size >= MAX_PLAYERS) return error('room_full');
    if (!isPeer(connection.peer)) return error('no_peer');
    if (name == null || !NAME_OK.test(String(name).trim())) return error('bad_name');
    if (!(team === 0 || team === 1 || team === 2)) return error('bad_team');
    // The host's gate: the bans, the password, the reserved slots, the
    // room's own max players (`room-host.mjs` `mayJoin`).
    const refused = this.host.mayJoin(connection, { name: String(name).trim(), password, admin, id });
    if (refused) return error(refused);
    // A slot table the bots have filled gives one up for a human
    // (`room-bots.mjs` `makeRoom`); a bot's slot is held like a player's.
    this.bots.makeRoom();
    const slot = nextFreeSlot({ has: s => this.players.has(s) || this.bots.has(s) });
    if (slot === null) return error('room_full');
    if (team === 0) team = this.#autoTeam();
    connection.slot = slot;
    connection.name = String(name).trim();
    connection.team = team;
    connection.rate = SNAPSHOT_RATE_DEFAULT;
    connection.budget = RATE_BYTES;
    connection.nextSendAt = 0;
    connection.fireAt = 0;
    connection.lastSeen = this.now();
    this.players.set(slot, connection);
    this.emptyAt = null;
    // addPlayer places the soldier on the team's flag (world.js's own join
    // law) and the client's spawn row re-places it on its chosen flag.
    this.world.addPlayer(slot, { team });
    // The engine chokes at every join (`processReceivedPackets` 0x08138560).
    this.#choke();
    return { ok: true, slot, team };
  }

  /** The engine's join half for team 0: `PlayerManager::getTeamToAddPlayer`
   *  (0x08261670, `viewer/team-to-add.js`) over every player on each side,
   *  weighed by the team ratios, a tie at random (`rand() & 1`, 0x0826179e).
   *  The ratios are CREATE GAME's AXIS VS ALLIED TEAM RATIO pair. */
  #autoTeam() {
    // Every player on each side, the bots among them (`+0x7c` of each).
    const [one, two] = this.bots.sideCounts();
    return teamToAddPlayer(one, two, this.host.settings.axisTeamRatio,
                           this.host.settings.alliedTeamRatio, this.random);
  }

  /** The HELLO row (netcode.js: slot, room, level, mode, team, name, slots,
   *  maxPlayers, flags, vehicles, tickets). `slots` is the roster the
   *  joining player can see — every slot except their own, name and team —
   *  so the page's labels and feed have names before the first event row. */
  helloRow(connection) {
    const roster = [];
    for (const [slot, c] of this.players) {
      if (slot === connection.slot) continue;
      roster.push({ slot, name: c.name, team: c.team, ...this.stats.of(slot) });
    }
    // The bots, each with its mark (`listPlayers`' " is an AI bot.", CON-24).
    for (const row of this.bots.rosterRows()) roster.push({ ...row, ...this.stats.of(row.slot) });
    return {
      slot: connection.slot,
      room: this.code,
      level: this.level(),
      mode: this.mode(),
      team: connection.team,
      name: connection.name,
      slots: roster,
      // The joining player's own score, kills, deaths and ping (a slot's
      // tally is new with its player).
      stats: this.stats.of(connection.slot),
      maxPlayers: this.capacity(),
      // The settings, the map list, the admin flag and any running vote.
      ...this.host.hello(connection),
      // The bot settings and the cap in force (`room-bots.mjs`).
      bots: this.bots.publicSettings(),
      // What the room flies itself (`room-guns.mjs`): the seat guns, so a
      // page reports no landing of its own seat rounds (`vehicle-hits.js`).
      rounds: this.guns?.publicState() ?? null,
      flags: this.flagsForWire(),
      vehicles: this.vehiclesForWire(),
      tickets: this.world.tickets,
      // A CTF layer's flags as the law has them now (`ctf.js` `snapshot`),
      // so a client joining mid-round draws a carried or dropped flag where
      // it is rather than on its pole; null on any other layer.
      ctf: this.authority.ctf?.snapshot() ?? null,
      // Whether the room plays the level's default layer (a page with no
      // `?mode=` has loaded the right one), and the round: playing, or
      // ended with its result and the restart's countdown.
      modeDefault: this.defaultMode(),
      round: this.authority.roundState(),
      // The hulls and statics not at full hit points (`room-pads.mjs`).
      damage: this.pads.damageState(),
    };
  }

  /** [{name, team}] — the deploy screen lists the level's flags. */
  flagsForWire() {
    return this.instance.flags.map(f => ({ name: f.name, team: f.team }));
  }

  /** [{id, template, pad, node, live}] — the room-side seat table; ids are
   *  reused by MSG_ACTION {type:'seat', vehicle: <id>}, the snapshot records
   *  and the pad rows. `pad` is the entry's `objectSpawns` row, `node` its
   *  hull's index in `scene.glb` (null for a hull the level does not place:
   *  a pad's other-side vehicle), which is how the page finds its own copy;
   *  `live` whether it stands in the world now (`room-pads.mjs`). */
  vehiclesForWire() {
    // `round`: the launcher whose fired round this hull is (room-missiles.mjs);
    // the page's copy is its pooled node of that template.
    return this.instance.table.map(v => ({ id: v.id, template: v.template, pad: v.pad ?? null,
                                           node: v.node ?? null, live: !!v.live,
                                           // A ship's spawner's second or third craft: the
                                           // page's copy is that slot of the baked one's.
                                           ...(v.craftSlot > 0 ? { slot: v.craftSlot } : {}),
                                           ...(v.round != null ? { round: v.round } : {}) }));
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
        // A ping that carries a pong's time back is the round trip the board's
        // ping column shows (room-stats.mjs), and is not answered.
        if (this.stats.onPingEcho(connection, body, this.now())) return;
        connection.peer.send(frame(MSG_PONG, serverTimeBytes(this.now())));
        return;
      }
      case MSG_INPUT: {
        // Malformed: ignore, keep alive. A 14-byte record from a page that
        // predates the analogue throttle and rudder still reads (netcode.js).
        if (body.length < 4 + INPUT_BYTES_MIN) return;
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
    this.authority.forget?.(slot);
    this.stats.forget(slot);
    this.host.forget(slot);
    this.world.removePlayer(slot);
    this.players.delete(slot);
    if (!this.players.size) this.emptyAt = this.now();
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

    let n = this.clock.advance(elapsedMs / 1000);
    // Retail's server stall law (D-4, P-10): more than nine owed runs one, and
    // the rest are gone from the tick clock (`GameServer::update` 0x08132955).
    // The FixedStep's own cap of 12 still bounds what `advance` hands back.
    if (n > STALL_COLLAPSE_TICKS) { this.ticksLost += n - 1; n = 1; }
    for (let i = 0; i < n; i++) this.#tick();
    // And every 10 s, with the timer sync (`updateConnections` 0x0813940c).
    if (this.lastChoke === null || nowMs - this.lastChoke >= CHOKE_PERIOD_MS) this.#choke(nowMs);
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
    // A destroyed Armor's own blast (`Armor::status`, gap audit entry 3),
    // and any hull it kills in turn, into `step.damage` first.
    this.hits.deathBlasts(step);
    // A hull that died this step takes its crew with it, before the death
    // pass reads their Armors.
    this.missiles.hullDeaths(step);
    this.pads.hullDeaths(step);
    // The crewed hulls' matrices, for the bots' aim and the next tick's
    // muzzles (room-guns.mjs).
    this.guns?.afterStep();
    // The bots' tick, where the page's frame and the headless runner have it:
    // after the world's step, their rounds landing before the death pass.
    this.bots.step(WORLD_TICK_DT);
    // P3: death decree, ticket bleeds, flag captures — the authority's own
    // half after every world step (all damage funnels landed during it).
    this.authority.afterStep(step, WORLD_TICK_DT);
    // Retail's top-up and removal (`gameStatusPlaying`, `killPlayer`).
    this.bots.afterAuthority();
    // The pads and the wrecks, after the captures (the page's order).
    this.pads.step(WORLD_TICK_DT);
    // The chat relay's paced pieces (CHAT-2) and the board's changed numbers.
    this.#control.chatTick();
    this.stats.step();
    // The votes' clocks (`updateVoteSystem`, once a server frame, D-1).
    this.host.step();
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

  /** R-1 (room-stream.mjs `chokeRates`), at a join and every 10 s. */
  #choke(nowMs = this.now()) {
    this.lastChoke = nowMs;
    chokeRates(this.players, this.chokeCap);
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
