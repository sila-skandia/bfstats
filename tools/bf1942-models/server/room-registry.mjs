// The room registry and the socket-agnostic routing: which rooms exist, the
// connections attached to them, the join handshake and the one scheduler lap.
// Split out of `rooms.mjs`, which re-exports `RoomServerCore`.

import {
  MSG_CLOSED, MSG_HELLO, MSG_JOIN, MSG_JOIN_SNAPSHOT,
} from '../viewer/netcode.js';
import { FRAME_MS, ROOM_CODE_RE, SNAPSHOT_RATE_DEFAULT } from './room-rules.mjs';
import { encodeJsonMsg, eventRow, frame, parseJson, tail } from './room-wire.mjs';
import { Room } from './room.mjs';

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
