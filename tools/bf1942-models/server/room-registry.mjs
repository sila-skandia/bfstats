// The room registry and the socket-agnostic routing: which rooms exist, the
// connections attached to them, the join handshake and the one scheduler lap.
// Split out of `rooms.mjs`, which re-exports `RoomServerCore`.

import {
  MSG_CLOSED, MSG_HELLO, MSG_JOIN, MSG_JOIN_SNAPSHOT,
} from '../viewer/netcode.js';
import { FRAME_MS, ROOM_CODE_RE, SNAPSHOT_RATE_DEFAULT } from './room-rules.mjs';
import { encodeJsonMsg, eventRow, frame, parseJson, tail } from './room-wire.mjs';
import { Room } from './room.mjs';

/**
 * What the process holds, as megabytes of RSS, measured 2026-11-13 on the
 * server's own entry point (`node server/server.mjs`, rooms joined over the
 * socket, `ps`): the process at boot, the first room of a level over a later
 * one (the level and the heap's slack with it), a room, a room's bots, and
 * what bots in hulls add (the hulls' own navigation maps and drives).
 *
 *   boot 82 | one room 237 | two rooms on one level 264 | one bot room
 *   234..270 | two bot rooms 317 | Berlin, one hull room 279, two 398 |
 *   Wake, one hull room 351
 *
 * The model answers Wake to within 5 MB and Berlin from above. `budget` is
 * the server's cap on the sum: 748 of the container's 832Mi, 10 % under it
 * (`deploy/app/netcode-deployment.yaml`). 832Mi is the smallest limit at
 * which a Midway room's bots get their ships (tier 2 below, 738 MB).
 */
export const ROOM_MEMORY = Object.freeze({ process: 82, level: 110, room: 40, bots: 35, hulls: 85, budget: 748,
                                           botRoom: 10, cellBytes: 9, buildBytes: 4 });

/**
 * A level's own cost, where the table can say what the level is
 * (`level-table.mjs` `cost`): `bots` and `hulls` above are a 2 km level's
 * navigation maps and nothing else, and a level is not always 2 km.
 *
 * A bot map is one cell a square metre (`nav-map.js` `NAV_CELL`), 9 bytes a
 * cell (`blocked` one, `heights` and `normalY` four each): 36 MB at 2048 m,
 * 9 at 1024, 144 at 4096. A level's rooms share its maps (`room-bots.mjs`:
 * the infantry map and, since 2026-11-13, the hulls'), so they are the
 * level's cost, at the richest tier any of its rooms runs; a room's own bots
 * are `botRoom` on top. Measured 2026-11-13 on the server's own entry point,
 * one room of 15 bots in hulls, the peak of `ps` RSS over 200 s against this
 * sum for the maps that run built: Stalingrad 251 / 260, Berlin 271 / 314,
 * Wake 386 / 386, Midway 717 / 818. Midway's five maps are 720 MB, so a
 * room there cannot have them all under the 748 MB budget.
 *
 * A map being built holds scratch beside it, and the cgroup meets that
 * peak: `buildBytes` a cell, once, for the largest level that runs bots (one
 * map is built at a time). Measured the same way with the cap on: a Midway
 * room with its bots in ships alone (three maps) peaked at 733 and 695 MB
 * where the maps and the flat terms come to 674; with the scratch, 738.
 *
 * So a room runs the richest of these tiers that fits when it is made:
 *
 *   3  bots in every hull      the infantry map and every hull map
 *   2  bots in ships only      the infantry map and the water maps
 *   1  bots on foot            the infantry map
 *   0  no bots
 *
 * and is refused (`server_full`) when not even 0 fits.
 */
export const BOT_TIERS = Object.freeze({ none: 0, foot: 1, ships: 2, hulls: 3 });

/** The megabytes of one of `cost`'s navigation maps. */
export function navMapMb(cost) {
  const side = Math.ceil(cost?.worldSize ?? 0);
  return side * side * ROOM_MEMORY.cellBytes / 1048576;
}

/** How many maps a level holds for rooms at `tier`. */
export function tierMaps(cost, tier) {
  if (tier <= BOT_TIERS.none) return 0;
  if (tier === BOT_TIERS.foot) return 1;
  if (tier === BOT_TIERS.ships) return 1 + cost.waterMaps;
  return 1 + cost.hullMaps;
}
/** How long a room may stand empty before it is dropped. */
export const EMPTY_ROOM_MS = 60_000;

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
  constructor({ levels = new Map(), defaultLevel = null, now = null, random = null, rules = null,
                bots = null, memoryBudgetMb = null } = {}) {
    this.levels = levels;
    /** The rooms' server settings over `ROOM_RULES` (`authority.mjs`). */
    this.rules = rules;
    /** The rooms' bots (`room-bots.mjs`): off unless the server turns them on
     *  (`{ enabled, perRoom, node }`); `used` counts every room's, for the
     *  node-wide cap. */
    this.bots = bots?.enabled
      ? { ...bots, used: () => { let n = 0; for (const r of this.rooms.values()) n += r.bots?.count ?? 0; return n; } }
      : null;
    this.defaultLevel = defaultLevel;
    /** The cap on live rooms, as megabytes of what they hold (`ROOM_MEMORY`,
     *  `mayCreate`); null is no cap (a harness). The server sets it. */
    this.memoryBudgetMb = Number.isFinite(memoryBudgetMb) && memoryBudgetMb > 0 ? memoryBudgetMb : null;
    this.now = now || (() => performance.now());
    /** The auto-team's coin for a tie (`rand()`, `team-to-add.js`). */
    this.random = random || Math.random;
    this.rooms = new Map();        // code -> Room
    this.connections = new Map();  // peer -> connection record
    this.nextId = 1;
    this.timer = null;
  }

  /** The lobby: [{code, level, mode, players, max}] (GET /netcode/rooms). */
  roomList() {
    return [...this.rooms.values()].map(r => r.listRow());
  }

  /** CREATE-or-join: a code with no room makes one on the default level,
   *  on the layer `mode` names (the level's default for none), under the
   *  host settings the create row carries (`room-settings.mjs`: CREATE
   *  GAME's `game.server*` words; an existing room ignores them). */
  createRoom(code, { level = null, mode = null, settings = null } = {}) {
    if (typeof code !== 'string' || !ROOM_CODE_RE.test(code)) return null;
    const existing = this.rooms.get(code);
    if (existing) return existing;
    const levelName = level || this.defaultLevel;
    // The cap, before the level is loaded for a room that will not be made.
    this.refused = null;
    if (!this.levels.has(levelName)) return null;
    if (this.memoryBudgetMb !== null) this.reapEmptyRooms();
    const tier = this.tierFor(levelName);
    if (tier === null) { this.refused = 'server_full'; return null; }
    const levelData = this.levels.get(levelName);
    if (!levelData) return null;
    const room = this.#makeRoom(code, levelData, mode, { settings }, tier);
    if (tier < this.topTier()) {
      console.error(`room ${code}: ${levelName} at bot tier ${tier} of ${this.topTier()} (${this.memoryEstimateMb()} of ${this.memoryBudgetMb} MB)`);
    }
    this.rooms.set(code, room);
    return room;
  }

  /** What the process holds with its live rooms, megabytes of RSS
   *  (`ROOM_MEMORY`): the process, each level some room plays, and each
   *  room at its size: plain, with bots, or with bots in hulls. A room that
   *  exists is asked whether it runs bots (`room.bots.enabled`: the server
   *  has them on and the layer has bot data); `extra`, a room not made yet on
   *  `extra.level`, is counted at the most the server's settings allow. */
  memoryEstimateMb(extra = null, { without = null } = {}) {
    const M = ROOM_MEMORY;
    const botRoom = M.bots + (this.bots?.vehicles === true ? M.hulls : 0);
    /** level -> the richest tier a room of it runs (a costed level's maps). */
    const tiers = new Map();
    let sum = M.process;
    const count = (level, runsBots, tier) => {
      const cost = this.levelCost(level);
      if (!cost) {
        // A level the table cannot cost (a harness's): a 2 km level's terms.
        tiers.set(level, null);
        sum += M.room + (runsBots ? botRoom : 0);
        return;
      }
      const t = runsBots ? tier : BOT_TIERS.none;
      tiers.set(level, Math.max(tiers.get(level) ?? 0, t));
      sum += M.room + (t > BOT_TIERS.none ? M.botRoom : 0);
    };
    for (const [code, room] of this.rooms) {
      if (code === without) continue;
      count(room.level(), !!room.bots?.enabled, room.botTier ?? this.topTier());
    }
    if (extra) count(extra.level, !!this.bots, extra.tier ?? this.topTier());
    let build = 0;
    for (const [level, tier] of tiers) {
      const cost = tier == null ? null : this.levelCost(level);
      sum += M.level + (cost ? tierMaps(cost, tier) * navMapMb(cost) : 0);
      if (cost && tier > BOT_TIERS.none) build = Math.max(build, navMapMb(cost) * M.buildBytes / M.cellBytes);
    }
    return Math.round(sum + build);
  }

  /** What the table knows of a level before it is loaded (`level-table.mjs`
   *  `cost`): `{ worldSize, hullMaps, waterMaps }`, or null. */
  levelCost(level) {
    return (typeof this.levels.cost === 'function' ? this.levels.cost(level) : null) ?? null;
  }

  /** The richest tier the server's settings allow (`BOT_TIERS`). */
  topTier() {
    if (!this.bots) return BOT_TIERS.none;
    return this.bots.vehicles === true ? BOT_TIERS.hulls : BOT_TIERS.foot;
  }

  /** The tier a new room on `level` runs: the richest that fits the budget
   *  beside the rooms there are (less `without`, a room about to move), or
   *  null when no room fits. */
  tierFor(level, { without = null } = {}) {
    const top = this.topTier();
    if (this.memoryBudgetMb === null) return top;
    const cost = this.levelCost(level);
    const tiers = !cost ? [top] : [BOT_TIERS.hulls, BOT_TIERS.ships, BOT_TIERS.foot, BOT_TIERS.none]
      .filter(t => t <= top && (t !== BOT_TIERS.ships || (cost.waterMaps > 0 && this.bots?.ships !== false)));
    for (const tier of tiers) {
      if (this.memoryEstimateMb({ level, tier }, { without }) <= this.memoryBudgetMb) return tier;
    }
    return null;
  }

  /** The bot policy of a room at `tier` (`room-bots.mjs`). */
  #botsAt(tier) {
    if (!this.bots || tier === BOT_TIERS.none) return null;
    if (tier === BOT_TIERS.foot) return this.bots.vehicles ? { ...this.bots, vehicles: false } : this.bots;
    if (tier === BOT_TIERS.ships) return { ...this.bots, kinds: ['ship'] };
    return this.bots;
  }

  /** Rooms nobody has been in for `EMPTY_ROOM_MS` are dropped: a room is
   *  kept through the seconds its players take to come back after a level
   *  change, and no longer. Until this, an empty room was kept for good. */
  reapEmptyRooms() {
    const now = this.now();
    for (const [code, room] of [...this.rooms]) {
      if (room.players.size > 0 || !Number.isFinite(room.emptyAt)) continue;
      if (now - room.emptyAt < EMPTY_ROOM_MS) continue;
      console.error(`room ${code}: dropped, empty for ${Math.round((now - room.emptyAt) / 1000)} s`);
      this.destroyRoom(code);
    }
  }

  /** Whether one more room fits under the cap: on `levelName`, or (none
   *  named) on a level some room already plays, the cheapest there is. */
  mayCreate(levelName = null) {
    if (this.memoryBudgetMb === null) return true;
    this.reapEmptyRooms();
    const level = levelName ?? this.rooms.values().next().value?.level() ?? '';
    return this.tierFor(level) !== null;
  }

  #makeRoom(code, levelData, mode, host, tier = this.topTier()) {
    const room = this.#newRoom(code, levelData, mode, host, tier);
    room.botTier = tier;
    return room;
  }

  #newRoom(code, levelData, mode, host, tier) {
    return new Room({
      code, level: levelData, mode, now: this.now, random: this.random, rules: this.rules,
      settings: host.settings ?? null,
      bots: tier === this.topTier() ? this.bots : this.#botsAt(tier),
      host: {
        carry: host.carry ?? null,
        hasLevel: name => this.levels.has(name),
        changeLevel: entry => this.changeLevel(code, entry),
      },
    });
  }

  /**
   * A room moves to another level (`Setup::runNextLevel`: the end of its
   * rounds, a passed map vote, `admin.changeMap`). A room is one World on
   * one level, so the move is a new Room under the same code that keeps the
   * host's half (settings, vote settings, bans, the admin's key): every
   * player is sent a `levelChange` row naming the level and the layer, is
   * taken out of the old room and has its socket closed, and its page loads
   * the level and joins the code again (`net-room.js`), as a retail client
   * reconnects through the loading screen. False when the server has no
   * such level, and the room stays as it is.
   */
  changeLevel(code, { level, mode = null } = {}) {
    const old = this.rooms.get(code);
    // The cap, counting the room as it will be and not as it is.
    const tier = old && this.levels.has(level) ? this.tierFor(level, { without: code }) : null;
    if (old && tier === null) {
      console.error(`room ${code}: level change to ${level} refused, the server has no room for it`);
      return false;
    }
    const levelData = this.levels.get(level);
    if (!old || !levelData) return false;
    let room;
    try {
      room = this.#makeRoom(code, levelData, mode, { carry: old.host.carry() }, tier);
    } catch (error) {
      console.error(`room ${code}: level change to ${level} failed: ${error.message}`);
      return false;
    }
    const row = eventRow('levelChange', old.tick, { level: room.level(), mode: room.mode(),
                                                    modeDefault: room.defaultMode() });
    old.stop();
    for (const connection of [...old.players.values()]) {
      connection.peer.send(encodeJsonMsg(row));
      old.leave(connection);
      connection.room = null;
      connection.peer.close(4002, 'level change');
    }
    this.rooms.set(code, room);
    if (this.timer !== null) room.start?.();
    console.error(`room ${code}: now on ${room.level()} (${room.mode() ?? 'default'})`);
    return true;
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
      // The highest input seq this room's world has consumed for the player;
      // the snapshot's `ack` (netcode.js), kept monotonic so an idle tick
      // never withdraws an acknowledgement.
      ack: 0,
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
    const made = !this.rooms.has(row.room);
    const room = this.createRoom(row.room, {
      level: row.level ?? null,
      mode: typeof row.mode === 'string' ? row.mode : null,
      settings: row.settings && typeof row.settings === 'object' ? row.settings : null,
    });
    // A create past the cap says so; a join of a room that exists never
    // reaches the cap (`createRoom` hands the room back first).
    if (!room) return bad(this.refused ?? 'bad_room');
    // Whoever's join made the room is its admin (`room-host.mjs`).
    if (made) room.host.setCreator(connection);
    const joined = room.join(connection, {
      name: row.name ?? '',
      team: row.team == null ? 0 : row.team,
      password: typeof row.password === 'string' ? row.password : '',
      admin: typeof row.admin === 'string' ? row.admin : null,
      id: typeof row.id === 'string' ? row.id : null,
    });
    if (!joined.ok) {
      // A room nobody got into is not kept (a create with a bad name).
      if (made && room.players.size === 0) { room.stop(); this.rooms.delete(row.room); }
      return bad(joined.code);
    }
    console.error(`room ${room.code}: slot ${joined.slot} joined as ${connection.name} (${room.players.size}/16)`);
    // The handshake: HELLO, then the live state, then the stream.
    connection.room = room;
    connection.peer.send(encodeJsonMsg(room.helloRow(connection), MSG_HELLO));
    connection.peer.send(frame(MSG_JOIN_SNAPSHOT, room.snapshotPayload()));
    room.broadcast(eventRow('join', room.tick, {
      slot: joined.slot, text: connection.name, team: connection.team,
    }), connection);
    // The welcome lines, behind the handshake (`WelcomeMsgEvent`).
    room.host.welcome(connection);
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
