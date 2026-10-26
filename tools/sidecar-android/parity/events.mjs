// Writes core/src/commonTest/resources/parity/events.json: events.mjs's readers and
// writers over
//   - decode: every event type's reader over seeded random bodies (the type's
//     7 bits, then random bytes), with what it read and where it stopped, or
//     the error it threw; and ids no event has;
//   - windows: the two unknown-event windows of a live sidecar review log
//     (run.review.ndjson, 2026-10-15), read as session.mjs reads a block's
//     tail, event by event to the first error;
//   - encode: every writer over empty, seeded random and edge bodies (values
//     out of range, wrong types the JS coerces, long strings), the bytes and
//     bit length it wrote, and those bytes read back;
//   - blocks: whole blocks written and read, and random blocks read;
//   - actions: writeActionBlock's records;
//   - errors: an unknown name, an event with no writer, too many events.
// No raw datagram corpus is checked in (no pcap; the recordings carry decoded
// rows), so the live bytes are the review log's windows and the rest is
// seeded.
//   node parity/events.mjs
import fs from 'node:fs';
import {
  EVENTS, EVENT_BY_ID, EVENT_TYPE_BITS, BitReader, BitWriter, readEvent, writeEvent, readEventBlock, writeEventBlock, writeActionBlock,
} from '../../bf1942-models/sidecar/events.mjs';
import { rng, plain } from './lib/fixture.mjs';

const rand = rng(1942);
const int = (n) => Math.floor(rand() * n);
const pick = (a) => a[int(a.length)];
const hex = (w) => Buffer.from(w.bytes()).toString('hex');
const try_ = (fn) => { try { return { ok: plain(fn()) }; } catch (e) { return { error: e.message }; } };

function readAll(bytes, bits) {
  const r = new BitReader(bytes, bits);
  const res = try_(() => readEvent(r));
  return { ...res, pos: r.pos };
}

// --- decode ------------------------------------------------------------------
const decode = [];
const ids = [...EVENT_BY_ID.keys(), 0, 0x1f, 0x20, 0x2c, 0x38, 0x3f, 0x40, 0x7f];
for (const id of ids) {
  for (let k = 0; k < 6; k++) {
    const len = k === 0 ? 0 : int(k < 3 ? 12 : 90);
    const w = new BitWriter(256);
    w.writeUnsigned(id, EVENT_TYPE_BITS);
    for (let i = 0; i < len; i++) w.writeUnsigned(k === 1 ? 0 : k === 2 ? 0xff : int(256), 8);
    const bits = w.pos - (k === 3 ? int(7) : 0);
    decode.push({ hex: hex(w), bits, ...readAll(w.bytes(), bits) });
  }
}

// --- windows -----------------------------------------------------------------
const windows = [
  { bitOffset: 516, hex: '00f007000000606f0000e0e1290100806de001aff210f27bb61067972e519db39050cfcc5070464e390f' },
  { bitOffset: 413, hex: '00e00f0000000000000040cc810000c0e13901000041a066e822d14fcdb3107da90ed12cbacaf017f82d7099eb0ef0e1' },
].flatMap((w) => {
  // The window starts at the unknown type 0 itself (the GameStatus misread
  // that wrote these, events.mjs's GameStatus note), so it is read from every
  // bit of its first eight bytes: real bytes through every reader they reach.
  const bytes = Buffer.from(w.hex, 'hex');
  return Array.from({ length: 64 }, (_, start) => {
    const r = new BitReader(bytes);
    r.pos = start;
    const events = [];
    let error = null;
    while (r.remaining >= EVENT_TYPE_BITS) {
      try { events.push(plain(readEvent(r))); } catch (e) { error = e.message; break; }
    }
    return { hex: w.hex, start, events, error, pos: r.pos };
  });
});

// --- encode ------------------------------------------------------------------
const latin = 'abcXYZ09 _-é€ÿ';
const str = (n) => Array.from({ length: n }, () => pick([...latin])).join('');
function value(kind) {
  switch (kind.k) {
    case 'u': return pick([int(2 ** Math.min(kind.n, 31)), 0, 2 ** kind.n - 1, 2 ** kind.n, -1, -(2 ** 31), 4294967295, 4294967296 + 5, 3.7, -3.7, '12', null, true]);
    case 's': return pick([int(2 ** (kind.n - 1)) * (rand() < 0.5 ? -1 : 1), 0, -1, 2 ** (kind.n - 1) - 1, -(2 ** (kind.n - 1)), 2 ** 31, -(2 ** 31), 2.5, '-7', null]);
    case 'b': return pick([true, false, 0, 1, '', 'x', null, 2]);
    case 'f': return pick([rand() * 2000 - 1000, 0, -0, 1e-40, 3.4e38, 3.5e38, 1 / 3, Math.fround(0.1), -1e-7, '2.5', null]);
    case 'bytes': return pick([Array.from({ length: int(kind.n + 4) }, () => pick([int(256), 300, -1, 255, 1.9])), [], null]);
    case 'str': return pick([str(int(kind.n + 8)), '', 'aĀb', 'x'.repeat(kind.n), 'y'.repeat(kind.n - 1)]);
    case 'lstr': return pick([str(int(40)), '', 'z'.repeat(255), 'q'.repeat(256), 'w'.repeat(300), 'é€Ā']);
    case 'ranged': return pick([kind.min + int(kind.max - kind.min + 1), kind.max + 1, kind.min - 1, kind.max + 9, 1.5, null]);
    case 'vec3': return pick([[1, 2, 3], [1.5], null, []]);
    default: throw new Error(kind.k);
  }
}
const vec = () => pick([[rand() * 1000, rand() * 100, -rand() * 1000], [0, 0, 0], [1, 2], [1, 2, 3, 4], null, [3.5e38, -0, 1e-45]]);
const custom = {
  HUDText: () => pick([{}, { kind: int(8), text: str(int(30)) }, { kind: 9, text: 'x'.repeat(200) }, { text: 'é€Ā' }, { kind: -1, text: '' }, { kind: 2.9 }]),
  CreateStaticObject: () => {
    const e = { template: pick([int(2 ** 32), -5, 7]), objectId: pick([int(65536), 70000]) };
    if (rand() < 0.6) e.pos = vec();
    if (rand() < 0.5) e.rot = vec();
    if (rand() < 0.4) e.scale = vec();
    return e;
  },
  UpdateStaticObject: () => pick([{}, { objectId: int(65536), action: int(4), value: vec() }, { objectId: 3, action: 3 }, { action: '3', value: [1, 2, 3] }, { action: 7, value: [9, 9, 9] }]),
  ChatFragment: () => pick([{}, { first: true, team: rand() < 0.5, noSender: false, serverFlag: rand() < 0.5, playerId: int(300), total: int(300), text: str(int(20)) },
    { first: true, noSender: true, total: 5, text: 'hello' }, { first: false, text: str(int(18)) }, { first: 1, playerId: -3, text: 'é€Ā' }, { first: true }]),
};
const encode = [];
for (const [name, def] of Object.entries(EVENTS)) {
  if (!def.write && !def.fields) continue;
  const bodies = [{}];
  for (let k = 0; k < 10; k++) {
    if (def.write) bodies.push(custom[name]());
    else { const b = {}; for (const [f, kind] of def.fields) if (rand() < 0.9) b[f] = value(kind); bodies.push(b); }
  }
  for (const raw of bodies) {
    const body = JSON.parse(JSON.stringify(raw));
    const w = new BitWriter(1472);
    const res = try_(() => writeEvent(w, name, body));
    const row = { name, body, hex: hex(w), bits: w.pos };
    if (res.error) row.error = res.error;
    else row.back = readAll(w.bytes(), w.pos);
    encode.push(row);
  }
}

// Fixed edges the random bodies may miss: an lstr past 255 bytes is cut at
// 255, a vector is always three floats, and a non-string where a string goes
// is String()-ed (events.mjs writeField / writeVec3 / HUDText / ChatFragment).
for (const [name, raw] of [
  ['ServerInfo2', { serverName: 'q'.repeat(256) }], ['ServerInfo2', { serverName: 'w'.repeat(300) }], ['ServerInfo2', { serverName: 12345 }],
  ['ServerInfo', { mapId: true, mod: null, gameId: 7.5 }], ['SessionId', { sessionId: 42 }], ['RemoteCommand', { password: false, command: 1e21 }],
  ['HUDText', { kind: 1, text: 404 }], ['HUDText', { kind: 2, text: false }], ['ChatFragment', { first: true, total: 3, text: 123 }],
  ['ChatFragment', { first: false, text: true }],
  ['CreateStaticObject', { template: 1, objectId: 2, pos: [1, 2], rot: [1, 2, 3, 4] }], ['CreateStaticObject', { template: 1, objectId: 2, pos: [], scale: [5] }],
  ['CreateStaticObject', { template: 1, objectId: 2, pos: 'ab', rot: 7 }], ['UpdateStaticObject', { objectId: 1, action: 0, value: [7] }],
  ['UpdateStaticObject', { objectId: 1, action: 2, value: [1, 2, 3, 4, 5] }], ['UpdateStaticObject', { objectId: 1, action: 1, value: { 0: 1 } }],
  ['UpdateStaticObject', { objectId: 1, action: 1, value: [null, '2', 3] }],
  // Uint8Array.from(string) iterates code points: an astral character is one element
  ['Vote', { a: 1, f: 'a\u{1F600}57' }], ['Vote', { f: '9\u{1F600}' }], ['Vote', { f: '\uD800x1' }],
]) {
  const body = JSON.parse(JSON.stringify(raw));
  const w = new BitWriter(1472);
  const res = try_(() => writeEvent(w, name, body));
  const row = { name, body, hex: hex(w), bits: w.pos };
  if (res.error) row.error = res.error;
  else row.back = readAll(w.bytes(), w.pos);
  encode.push(row);
}

// --- blocks ------------------------------------------------------------------
const writable = Object.entries(EVENTS).filter(([, d]) => d.write || d.fields).map(([n]) => n);
const sample = (name) => {
  const def = EVENTS[name];
  if (def.write) return custom[name]();
  const b = {}; for (const [f, kind] of def.fields) b[f] = value(kind); return b;
};
const blocks = [];
for (let k = 0; k < 30; k++) {
  const n = k === 0 ? 0 : int(12) + 1;
  const events = Array.from({ length: n }, () => { const name = pick(writable); return [name, JSON.parse(JSON.stringify(sample(name)))]; });
  const index = pick([int(32), 31, 32, 37, -1]);
  const resend = rand() < 0.3;
  const w = new BitWriter(1472);
  const res = try_(() => writeEventBlock(w, index, resend, events));
  const r = new BitReader(w.bytes(), w.pos);
  blocks.push({ index, resend, events, hex: hex(w), bits: w.pos, ...(res.error ? { error: res.error } : {}), back: try_(() => readEventBlock(r)), pos: r.pos });
}
for (let k = 0; k < 20; k++) {
  const bytes = Uint8Array.from({ length: int(40) + 1 }, () => int(256));
  bytes[0] = int(4);
  const r = new BitReader(bytes);
  blocks.push({ read: Buffer.from(bytes).toString('hex'), back: try_(() => readEventBlock(r)), pos: r.pos });
}

// --- actions ------------------------------------------------------------------
const actions = [];
for (let k = 0; k < 20; k++) {
  const list = Array.from({ length: k === 0 ? 0 : int(4) + 1 }, () => ({
    axes: Array.from({ length: 6 }, () => pick([2048, int(4096), 4095, 0, 4096, -1, 2.5])),
    buttons: pick([0, 1, int(2 ** 26), 2 ** 31, -1, 4294967295]),
  }));
  const first = pick([1, int(0x3fffffff), 0x3fffffff, -5, 0, 2 ** 31 - 1]);
  const w = new BitWriter(256);
  writeActionBlock(w, first, list);
  actions.push({ first, actions: list, hex: hex(w), bits: w.pos });
}

// --- errors ------------------------------------------------------------------
const errors = [];
for (const [name, body] of [['Nope', {}], ['CreateObject', {}], ['Map', {}], ['GameStatus', { status: 5 }]]) {
  const w = new BitWriter(64);
  const res = try_(() => writeEvent(w, name, body));
  errors.push({ name, error: res.error ?? null, hex: hex(w), bits: w.pos });
}
{
  const w = new BitWriter(4096);
  const res = try_(() => writeEventBlock(w, 0, false, Array.from({ length: 0xff }, () => ['Suicide', {}])));
  errors.push({ name: 'block255', error: res.error ?? null, hex: hex(w), bits: w.pos });
  const w2 = new BitWriter(4096);
  writeEventBlock(w2, 0, false, Array.from({ length: 0xfe }, () => ['Suicide', {}]));
  errors.push({ name: 'block254', error: null, hex: hex(w2), bits: w2.pos });
}

const out = { eventTypeBits: EVENT_TYPE_BITS, names: Object.entries(EVENTS).map(([n, d]) => [n, d.id, d.addr]), decode, windows, encode, blocks, actions, errors };
fs.writeFileSync(new URL('../core/src/commonTest/resources/parity/events.json', import.meta.url), JSON.stringify(out));
console.log(`${decode.length} decodes, ${encode.length} encodes, ${blocks.length} blocks, ${windows.reduce((a, w) => a + w.events.length, 0)} events read from the windows`);
