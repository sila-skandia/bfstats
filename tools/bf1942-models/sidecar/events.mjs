// The game-event stream: the block framing and every event's wire layout.
//
// Read from bf1942_lnxded.static. The block is GameEventManager::transmit
// 0x0812d770 / processReceivedPacket 0x0812e040: an 8-bit event count, a
// 5-bit block index (the sender's counter mod 32), a 1-bit resend flag, then
// the events. Each event is its type in 7 bits (readGameEvent 0x0812e2f0,
// the rangedBits(0, 0x40) quirk) followed by its serialize() body. The ids
// are GameEvent::initEvents 0x0811bee0; the bodies are each class's
// serialize() at the address in the table.

import { BitReader, BitWriter, rangedBits } from './bitstream.mjs';

export const EVENT_TYPE_BITS = rangedBits(0, 0x40); // 7
export const BLOCK_COUNT_BITS = 8;
export const BLOCK_INDEX_BITS = 5;
export const MAX_EVENTS_PER_BLOCK = 0xfe;

// field kinds: u(n) unsigned, s(n) signed, b bool, f float32, bytes(n),
// str(n) fixed NUL-padded, lstr len-prefixed (8-bit length) string,
// ranged(min,max), vec3, custom
const u = (n) => ({ k: 'u', n });
const s = (n) => ({ k: 's', n });
const b = { k: 'b' };
const f = { k: 'f' };
const bytes = (n) => ({ k: 'bytes', n });
const str = (n) => ({ k: 'str', n });
const lstr = { k: 'lstr' };
const ranged = (min, max) => ({ k: 'ranged', min, max });
const vec3 = { k: 'vec3' };

// name -> {id, addr (serialize), fields: [[name, kind], ...] or {read, write}}
export const EVENTS = {
  // BF42++'s own events (wire.md section 30). A bf42++ client registers a
  // maker for each in its event table (bf42plus src/bf/gameevent.cpp:386-388);
  // a retail client has none and drops the rest of the block on one (it
  // crashes, unpatched: 0x004b403f). Only the client's deSerialize exists in
  // bf42plus (serialize returns false), so the layouts are its readers'.
  // `addr` is null: these are not lnxded's.
  //
  // HUDTextEvent (gameevent.cpp:329): 3-bit kind (0 centre top line 2, the
  // spawn message; 1 centre top line 3, the status message; 2 the centre kill
  // message; 3 the centre yellow message), 7-bit length, that many bytes of
  // ISO-8859-1, not NUL-terminated. Length 0 clears kinds 0, 1 and 3.
  HUDText: {
    id: 0x01, addr: null,
    read(r) {
      const kind = r.readUnsigned(3);
      const len = r.readUnsigned(7);
      return { kind, text: Buffer.from(r.readBytes(len)).toString('latin1') };
    },
    write(w, e) {
      const bytes = Buffer.from(e.text ?? '', 'latin1').subarray(0, 127);
      w.writeUnsigned(e.kind ?? 0, 3);
      w.writeUnsigned(bytes.length, 7);
      w.writeBytes(bytes);
    },
  },
  // CreateStaticObjectEvent (gameevent.cpp:288): u32 template id (the level's
  // own numbering, ObjectTemplateManager_getTemplate), u16 the server's id for
  // the object (its own namespace, not a networkable id), bool, and when set
  // two full vectors (readFullVector, three raw float32: BF1942.exe
  // 0x00583180), position then rotation (yaw, pitch, roll degrees, applied
  // with the engine's setRotation); bool, and when set a full vector scale
  // (read and never applied).
  CreateStaticObject: {
    id: 0x1c, addr: null,
    read(r) {
      const e = { template: r.readUnsigned(32), objectId: r.readUnsigned(16), hasTransform: r.readBool() };
      if (e.hasTransform) { e.pos = readVec3(r); e.rot = readVec3(r); }
      e.hasScale = r.readBool();
      if (e.hasScale) e.scale = readVec3(r);
      return e;
    },
    write(w, e) {
      w.writeUnsigned(e.template ?? 0, 32);
      w.writeUnsigned(e.objectId ?? 0, 16);
      const t = !!(e.pos || e.rot);
      w.writeBool(t);
      if (t) { writeVec3(w, e.pos); writeVec3(w, e.rot); }
      w.writeBool(!!e.scale);
      if (e.scale) writeVec3(w, e.scale);
    },
  },
  // UpdateStaticObjectEvent (gameevent.cpp:314): u16 object id, 2-bit action
  // (0 move, 1 rotate, 2 scale, 3 delete), and a full vector for every action
  // but delete.
  UpdateStaticObject: {
    id: 0x1d, addr: null,
    read(r) {
      const e = { objectId: r.readUnsigned(16), action: r.readUnsigned(2) };
      if (e.action !== 3) e.value = readVec3(r);
      return e;
    },
    write(w, e) {
      w.writeUnsigned(e.objectId ?? 0, 16);
      w.writeUnsigned(e.action ?? 0, 2);
      if ((e.action ?? 0) !== 3) writeVec3(w, e.value);
    },
  },

  Ack: { id: 0x02, addr: '0x0811ff70', fields: [['value', u(32)]] },
  Debug: { id: 0x03, addr: '0x0811e120', fields: [['number', s(32)]] },
  Simulation: { id: 0x04, addr: '0x0811e1e0', fields: [['running', b], ['worldTime', f]] },
  CreateMultipleObjects: { id: 0x05, addr: '0x0811d500', fields: [['template', u(32)], ['firstNetId', u(16)], ['count', u(4)]] },
  DestroyObject: { id: 0x06, addr: '0x0811d660', fields: [['netId', u(16)]] },
  CreateObject: {
    id: 0x07, addr: '0x0811d360',
    read(r) {
      const e = { template: r.readUnsigned(32), netId: r.readUnsigned(16), hasTransform: r.readBool() };
      if (e.hasTransform) { e.pos = readVec3(r); e.rot = readVec3(r); }
      return e;
    },
  },
  CreatePlayer: {
    id: 0x08, addr: '0x0811ca60',
    fields: [['team', u(3)], ['spawnGroup', u(4)], ['isRemote', b], ['playerId', u(8)],
      ['playerNetId', u(16)], ['vehicleNetId', u(16)], ['cameraNetId', u(16)], ['kitNetId', u(16)],
      ['isAI', b], ['name', str(32)]],
  },
  SetDefaultVehicle: { id: 0x09, addr: '0x0811d020', fields: [['playerId', u(8)], ['netId', u(16)]] },
  SetVehicle: { id: 0x0a, addr: '0x0811ce60', fields: [['playerId', u(8)], ['netId', u(16)]] },
  ExitVehicle: { id: 0x0b, addr: '0x0811d110', fields: [['flag', b], ['playerId', u(8)]] },
  DestroyPlayer: { id: 0x0c, addr: '0x0811cbd0', fields: [['playerId', u(8)]] },
  SetPlayerName: { id: 0x0d, addr: '0x0811fb80', fields: [['name', lstr], ['playerId', u(8)]] },
  SetTempCamera: { id: 0x0e, addr: '0x0811cf40', fields: [['netId', u(16)]] },
  ConnectionType: { id: 0x0f, addr: '0x0811e5a0', fields: [['connType', ranged(0, 6)]] },
  UpdateRate: { id: 0x10, addr: '0x0811e4d0', fields: [['rate', u(8)]] },
  CreatePlayerAck: { id: 0x11, addr: '0x0811cc90', fields: [['playerId', u(8)]] },
  Vote: {
    id: 0x12, addr: '0x0811e8b0',
    fields: [['a', u(8)], ['b', u(8)], ['c', u(8)], ['d', u(8)], ['e', u(8)], ['f', bytes(4)],
      ['g', ranged(0, 4)], ['h', ranged(0, 3)]],
  },
  Map: {
    id: 0x13, addr: '0x0811ec40',
    read(r) {
      const add = r.readBool(), mapLen = r.readUnsigned(8), modLen = r.readUnsigned(8), mode = r.readUnsigned(8);
      return { add, mode, map: r.readFixedString(mapLen), mod: r.readFixedString(modLen) };
    },
  },
  Challenge: {
    id: 0x14, addr: '0x0811f1c0',
    read(r) {
      const challenge = r.readBytes(10), xpack = r.readSigned(32), modLen = r.readUnsigned(8);
      const mod = r.readFixedString(modLen), tail = r.readBytes(8);
      return { challenge: Buffer.from(challenge), xpack, mod, tail: Buffer.from(tail) };
    },
  },
  ChallengeResponse: {
    id: 0x15, addr: '0x0811f4c0',
    fields: [['keyHash', bytes(73)], ['a', u(32)], ['b', u(32)], ['c', u(32)], ['xpack', s(32)],
      ['statsResponse', bytes(32)], ['flag', u(1)]],
  },
  GameRules: {
    id: 0x16, addr: '0x0811f780',
    fields: [['soldierFF', f], ['externalViews', b], ['noseCam', b], ['ticketRatio', f],
      ['timeLimit', u(32)], ['worldTime', u(32)], ['crosshairCentre', b]],
  },
  WelcomeMsg: { id: 0x17, addr: '0x0811f990', fields: [['message', lstr], ['index', s(8)]] },
  ResetMap: { id: 0x18, addr: '0x0811fc60', fields: [['value', u(32)]] },
  CheckSum: {
    id: 0x19, addr: '0x0811c580',
    read(r) {
      const n1 = r.readUnsigned(8), a = r.readBits(n1), n2 = r.readUnsigned(8), c = r.readBits(n2);
      return { n1, a: Buffer.from(a), n2, c: Buffer.from(c), value: r.readUnsigned(32) };
    },
  },
  ServerInfo: { id: 0x1a, addr: '0x08120880', fields: [['mapId', lstr], ['mod', lstr], ['gameId', lstr]] },
  ServerInfo2: { id: 0x1b, addr: '0x08120c40', fields: [['serverName', lstr]] },
  FlagHolder: { id: 0x1e, addr: '0x0811e2b0', fields: [['flag', b], ['playerId', u(8)]] },
  HandlePickup: { id: 0x23, addr: '0x0811d1f0', fields: [['playerId', u(8)], ['netId', u(16)]] },
  GameStatus: {
    id: 0x24, addr: '0x0811db80',
    // serialize 0x0811db80 / deSerialize 0x0811daf0: an 8-bit status code, and
    // the five raw bytes plus the length-prefixed text ONLY when the status is
    // 5. Any other status is the code alone — reading the tail unconditionally
    // runs 56 bits into the next event and makes it look like an unknown type 0.
    read(r) {
      const status = r.readUnsigned(8);
      if (status !== 5) return { status };
      const extra = r.readBytes(5);
      return { status, extra: Buffer.from(extra), text: r.readLenString() };
    },
  },
  ControlPointCaptured: { id: 0x25, addr: '0x0811dc80', fields: [['a', u(8)], ['b', u(8)]] },
  ReqScoutCamera: { id: 0x26, addr: '0x0811fd60', fields: [['playerId', u(8)], ['netId', u(16)]] },
  // 2-bit action (serialize 0x0811fe70). lnxded sends only 0, the refill
  // (GameServer::triggerSpecialGameEvent 0x081591a0); 2 is bf42++'s "do not
  // load StaticObjects.con", honoured only before the SetLevel (bf42plus
  // gameevent.cpp:225-236).
  SpecialGame: { id: 0x27, addr: '0x0811fe70', fields: [['kind', u(2)]] },
  // One piece of a chat line (chat.mjs has the protocol). serialize 0x08120e10
  // / deSerialize 0x08120f10: bool first; ONLY on a first piece, bool team
  // (+0xe, the line's SayTarget is 0, the sender's side), bool noSender (+0xd,
  // the server's own line), bool serverFlag (+0xf), u8 sender id unless
  // noSender, u8 the whole line's length; then on every piece a 4-bit length
  // and that many bytes. A later piece carries only its length and bytes.
  ChatFragment: {
    id: 0x28, addr: '0x08120e10',
    read(r) {
      const e = { first: r.readBool() };
      if (e.first) {
        e.team = r.readBool();
        e.noSender = r.readBool();
        e.serverFlag = r.readBool();
        e.playerId = e.noSender ? -1 : r.readUnsigned(8);
        e.total = r.readUnsigned(8);
      }
      const len = r.readUnsigned(4);
      e.text = Buffer.from(r.readBytes(len)).toString('latin1');
      return e;
    },
    write(w, e) {
      w.writeBool(!!e.first);
      if (e.first) {
        w.writeBool(!!e.team);
        w.writeBool(!!e.noSender);
        w.writeBool(!!e.serverFlag);
        if (!e.noSender) w.writeUnsigned((e.playerId ?? -1) & 0xff, 8);
        w.writeUnsigned((e.total ?? 0) & 0xff, 8);
      }
      const bytes = Buffer.from(e.text ?? '', 'latin1').subarray(0, 15);
      w.writeUnsigned(bytes.length, 4);
      w.writeBytes(bytes);
    },
  },
  TimerSync: { id: 0x29, addr: '0x0811f5f0', fields: [['timeLimit', u(32)], ['worldTime', u(32)]] },
  ScoreMsg: {
    id: 0x2a, addr: '0x0811c8d0',
    read(r) {
      const e = { scoreType: r.readRanged(0, 10), playerId: r.readUnsigned(8) };
      if (e.scoreType === 3 || e.scoreType === 6) { e.victimId = r.readUnsigned(8); e.weapon = r.readUnsigned(32); e.bodyPart = r.readUnsigned(8); }
      return e;
    },
  },
  PBFragment: {
    id: 0x2b, addr: '0x081210d0',
    read(r) {
      const e = { flag: r.readBool(), a: r.readUnsigned(32), b: r.readUnsigned(16) };
      const len = r.readUnsigned(16);
      e.data = Buffer.from(r.readBytes(len));
      return e;
    },
  },
  SpawnRequest: { id: 0x2f, addr: '0x0811cd70', fields: [['spawnGroup', u(8)], ['spawnPoint', u(8)]] },
  StatsKills: { id: 0x30, addr: '0x0811dd90', read: readStats },
  StatsShots: { id: 0x31, addr: '0x0811ded0', read: readStats },
  StatsHits: { id: 0x32, addr: '0x0811e010', read: readStats },
  Suicide: { id: 0x33, addr: '0x0811e420', fields: [] },
  DataBaseComplete: { id: 0x34, addr: '0x0811c7b0', fields: [['a', u(16)], ['b', u(16)]] },
  DatabaseCompleteAck: { id: 0x35, addr: null, fields: [] },
  SetLevel: {
    id: 0x36, addr: '0x0811d7e0',
    fields: [['levelPath', str(64)], ['modeFile', str(64)], ['u8a', u(8)], ['u8b', u(8)], ['u16c', u(16)],
      ['u8d', u(8)], ['u16e', u(16)], ['u16f', u(16)], ['u8g', u(8)], ['u32h', u(32)], ['u32i', u(32)]],
  },
  SessionId: { id: 0x37, addr: '0x0811da60', fields: [['sessionId', str(64)]] },
  SetTeam: { id: 0x39, addr: '0x0811e390', fields: [['team', u(8)], ['playerId', u(8)]] },
  RadioMessage: { id: 0x3a, addr: '0x0811c6b0', fields: [['message', u(16)], ['broadcast', b], ['playerId', u(8)]] },
  TriggerObjectSpawner: { id: 0x3b, addr: '0x0811e650', fields: [['value', u(8)]] },
  HitFromPos: { id: 0x3c, addr: '0x0811e770', fields: [['sector', u(3)], ['strength', u(8)]] },
  RemoteCommand: { id: 0x3d, addr: '0x0811d980', fields: [['password', str(9)], ['command', str(64)]] },
  ChangeKit: { id: 0x3e, addr: '0x0811ed50', fields: [['kit', u(8)]] },
};

export const EVENT_BY_ID = new Map(Object.entries(EVENTS).map(([name, e]) => [e.id, { name, ...e }]));

function readVec3(r) { return [r.readFloat(), r.readFloat(), r.readFloat()]; }
function writeVec3(w, v) { for (const x of (v ?? [0, 0, 0])) w.writeFloat(x); }

function readStats(r) {
  const e = { rowsMinus1: r.readUnsigned(8), playerId: r.readUnsigned(8), rows: [] };
  for (let i = 0; i < 10; i++) e.rows.push({ template: r.readUnsigned(32), count: r.readUnsigned(16) });
  return e;
}

function readField(r, kind) {
  switch (kind.k) {
    case 'u': return r.readUnsigned(kind.n);
    case 's': return r.readSigned(kind.n);
    case 'b': return r.readBool();
    case 'f': return r.readFloat();
    case 'bytes': return Buffer.from(r.readBytes(kind.n));
    case 'str': return r.readFixedString(kind.n);
    case 'lstr': return r.readLenString();
    case 'ranged': return r.readRanged(kind.min, kind.max);
    case 'vec3': return readVec3(r);
    default: throw new Error(`unknown field kind ${kind.k}`);
  }
}

function writeField(w, kind, v) {
  switch (kind.k) {
    case 'u': return w.writeUnsigned(v ?? 0, kind.n);
    case 's': return w.writeSigned(v ?? 0, kind.n);
    case 'b': return w.writeBool(!!v);
    case 'f': return w.writeFloat(v ?? 0);
    case 'bytes': { const b = new Uint8Array(kind.n); if (v) b.set(Uint8Array.from(v).subarray(0, kind.n)); return w.writeBytes(b); }
    case 'str': return w.writeFixedString(v ?? '', kind.n);
    case 'lstr': { const enc = Buffer.from(v ?? '', 'latin1'); w.writeUnsigned(enc.length, 8); return w.writeBytes(enc); }
    case 'ranged': return w.writeRanged(v ?? kind.min, kind.min, kind.max);
    case 'vec3': return (v ?? [0, 0, 0]).forEach((x) => w.writeFloat(x));
    default: throw new Error(`unknown field kind ${kind.k}`);
  }
}

export function readEvent(r) {
  const id = r.readUnsigned(EVENT_TYPE_BITS);
  const def = EVENT_BY_ID.get(id);
  if (!def) throw new Error(`unknown event type 0x${id.toString(16)}`);
  let body;
  if (def.read) body = def.read(r);
  else { body = {}; for (const [name, kind] of def.fields) body[name] = readField(r, kind); }
  return { type: def.name, id, ...body };
}

export function writeEvent(w, name, body = {}) {
  const def = EVENTS[name];
  if (!def) throw new Error(`unknown event ${name}`);
  w.writeUnsigned(def.id, EVENT_TYPE_BITS);
  if (def.write) return def.write(w, body);
  if (!def.fields) throw new Error(`event ${name} has no writer`);
  for (const [field, kind] of def.fields) writeField(w, kind, body[field]);
}

// One event block as the GameEventManager frames it.
export function readEventBlock(r) {
  const count = r.readUnsigned(BLOCK_COUNT_BITS);
  const index = r.readUnsigned(BLOCK_INDEX_BITS);
  const resend = r.readBool();
  const events = [];
  for (let i = 0; i < count; i++) events.push(readEvent(r));
  return { count, index, resend, events };
}

export function writeEventBlock(w, index, resend, events) {
  if (events.length > MAX_EVENTS_PER_BLOCK) throw new Error('too many events in one block');
  w.writeUnsigned(events.length, BLOCK_COUNT_BITS);
  w.writeUnsigned(index & 0x1f, BLOCK_INDEX_BITS);
  w.writeBool(resend);
  for (const [name, body] of events) writeEvent(w, name, body);
}

// The PlayerActionManager block: a 4-bit count, a signed 32-bit first serial,
// then count PlayerAction records of six 12-bit axes and a 32-bit button
// mask (transmit 0x08148190, PlayerAction::writeToStream 0x08148750).
export function writeActionBlock(w, firstSerial, actions) {
  w.writeUnsigned(actions.length, 4);
  if (actions.length === 0) return;
  w.writeSigned(firstSerial, 32);
  for (const a of actions) {
    for (let i = 0; i < 6; i++) w.writeUnsigned(a.axes[i] ?? 2047, 12);
    w.writeUnsigned(a.buttons >>> 0, 32);
  }
}

export { BitReader, BitWriter };
