// BF42++'s protocol additions through the sidecar (sidecar/plus.mjs,
// events.mjs, session.mjs, netconn.mjs). The event bytes are written here bit
// by bit from bf42plus's own readers (src/bf/gameevent.cpp:288-335), not with
// events.mjs's writers, so a wrong layout in either shows. See
// test_sidecar_plus.py and features/udp-sidecar/wire.md section 30.
import { BitWriter } from '../sidecar/bitstream.mjs';
import { EVENT_TYPE_BITS, BLOCK_COUNT_BITS, BLOCK_INDEX_BITS, writeEvent } from '../sidecar/events.mjs';
import { Session } from '../sidecar/session.mjs';
import { NetConnection } from '../sidecar/netconn.mjs';
import { recordFor } from '../sidecar/record.mjs';
import {
  buildPlusAcceptAck, parsePlusAcceptAck, crc8, parseServerSettings, defaultServerSettings,
  colorFromString, restartTiming, INVALID_COLOR,
} from '../sidecar/plus.mjs';

const results = {};
const hex = (b) => Buffer.from(b).toString('hex');
const f32 = (w, x) => { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); w.writeBytes(b); };
const vec = (w, v) => v.forEach((x) => f32(w, x));

// One event-stream payload: the 6-bit mask (events), the block header, then
// each event as its 7-bit type and the body `body(w)` writes.
function payload(events, index = 0) {
  const w = new BitWriter(1400);
  w.writeUnsigned(1 << 1, 6);
  w.writeUnsigned(events.length, BLOCK_COUNT_BITS);
  w.writeUnsigned(index, BLOCK_INDEX_BITS);
  w.writeBool(false);
  for (const [id, body] of events) { w.writeUnsigned(id, EVENT_TYPE_BITS); body(w); }
  return Buffer.from(w.bytes());
}

// The bodies, per bf42plus's deSerialize.
const createFull = (w) => {                       // gameevent.cpp:288
  w.writeUnsigned(2790, 32);                      // templateid
  w.writeUnsigned(7, 16);                         // objectid
  w.writeBool(true);                              // hasPositionAndRotation
  vec(w, [512.25, 77.5, -1024.75]);               // position
  vec(w, [90, -5, 2.5]);                          // rotation
  w.writeBool(true);                              // hasScale
  vec(w, [1, 2, 0.5]);                            // scale
};
const createBare = (w) => {
  w.writeUnsigned(31, 32); w.writeUnsigned(65535, 16); w.writeBool(false); w.writeBool(false);
};
const update = (id, action, v) => (w) => {        // gameevent.cpp:314
  w.writeUnsigned(id, 16); w.writeUnsigned(action, 2);
  if (action !== 3) vec(w, v);
};
const hudText = (kind, text) => (w) => {          // gameevent.cpp:329
  const b = Buffer.from(text, 'latin1');
  w.writeUnsigned(kind, 3); w.writeUnsigned(b.length, 7); w.writeBytes(b);
};
const special = (action) => (w) => w.writeUnsigned(action, 2);  // lnxded 0x0811fe30
const setLevel = (w) => {                          // events.mjs SetLevel, lnxded 0x0811d7e0
  w.writeFixedString('bf1942/levels/wake/', 64); w.writeFixedString('conquest.con', 64);
  for (const n of [8, 8, 16, 8, 16, 16, 8, 32, 32]) w.writeUnsigned(0, n);
};
const welcome = (text, index) => (w) => {          // lnxded 0x0811f990
  const b = Buffer.from(text + '\0', 'latin1');
  w.writeUnsigned(b.length, 8); w.writeBytes(b); w.writeSigned(index, 8);
};
const ack = (w) => w.writeUnsigned(0xdeadbeef, 32);

function session(opts = {}) {
  const s = new Session('127.0.0.1', 9, { name: 't', ...opts });
  const seen = [];
  const flags = [];
  s.on('event', (ev) => seen.push(JSON.parse(JSON.stringify(ev))));
  s.on('decode-error', (e) => seen.push({ type: 'decode-error', message: e.message }));
  s.on('unknown-event', (u) => seen.push({ type: 'unknown', id: u.id }));
  s.on('skip-static-objects', () => flags.push('skip'));
  s.on('plus-settings', (st) => flags.push(`settings:${st.seen.join(',')}`));
  return { s, seen, flags };
}

// --- every new event in one block, an Ack after each, framing held --------------
{
  const { s, seen, flags } = session();
  s._onData(payload([
    [0x27, special(2)], [0x02, ack],
    [0x36, setLevel], [0x02, ack],
    [0x1c, createFull], [0x02, ack],
    [0x1c, createBare], [0x02, ack],
    [0x1d, update(7, 0, [1, 2, 3])], [0x02, ack],
    [0x1d, update(7, 1, [45, 0, 0])], [0x02, ack],
    [0x1d, update(7, 2, [2, 2, 2])], [0x02, ack],
    [0x1d, update(7, 3)], [0x02, ack],
    [0x01, hudText(3, 'Server restarting, été')], [0x02, ack],
    [0x01, hudText(0, '')], [0x02, ack],
    [0x27, special(2)], [0x02, ack],
  ]), 1);
  results.block = { seen, flags, records: seen.filter((e) => e.type !== 'Ack').map((e) => recordFor(e)) };
  s.close();
}

// --- SpecialGame 2 after the SetLevel does not switch the statics off -----------
{
  const { s, flags } = session();
  s._onData(payload([[0x36, setLevel], [0x27, special(2)], [0x02, ack]]), 1);
  results.lateSpecial = { flags, skip: s.plus.skipStaticObjects };
  s.close();
}

// --- an id nobody registers still stops the block (as a retail client does) ------
{
  const { s, seen } = session();
  s._onData(payload([[0x02, ack], [0x1f, ack], [0x02, ack]]), 1);
  results.unknown = seen.map((e) => e.type);
  s.close();
}

// --- events.mjs's writers produce the same bits ------------------------------------
{
  const mine = new BitWriter(256);
  writeEvent(mine, 'CreateStaticObject', { template: 2790, objectId: 7, pos: [512.25, 77.5, -1024.75], rot: [90, -5, 2.5], scale: [1, 2, 0.5] });
  writeEvent(mine, 'UpdateStaticObject', { objectId: 7, action: 3 });
  writeEvent(mine, 'HUDText', { kind: 3, text: 'hi' });
  const ref = new BitWriter(256);
  ref.writeUnsigned(0x1c, EVENT_TYPE_BITS); createFull(ref);
  ref.writeUnsigned(0x1d, EVENT_TYPE_BITS); update(7, 3)(ref);
  ref.writeUnsigned(0x01, EVENT_TYPE_BITS); hudText(3, 'hi')(ref);
  results.writers = { same: hex(mine.bytes()) === hex(ref.bytes()), bits: [mine.pos, ref.pos] };
}

// --- the welcome lines through a session, and the restart timing ------------------
{
  const plain = session();
  plain.s._onData(payload([[0x17, welcome('Welcome to the lab', 0)], [0x02, ack]]), 1);
  const nfr = session();
  nfr.s._onData(payload([
    [0x17, welcome('Have fun %UI&nfr&hssdeath~', 0)],
    [0x17, welcome('%3DM&D=50&C=red~ %3DO&t=Mortar&T=MORTAR~', 1)],
    [0x02, ack],
  ]), 1);
  const retail = session({ plus: null });
  results.welcome = {
    plain: { timing: plain.s.restartTiming(), flags: plain.flags },
    nfr: { timing: nfr.s.restartTiming(), flags: nfr.flags, ui: nfr.s.plus.settings.UI,
           mine: nfr.s.plus.settings.mine3DMap, custom: nfr.s.plus.settings.custom3DMaps, framed: nfr.seen.map((e) => e.type) },
    retail: { timing: retail.s.restartTiming() },
  };
  for (const x of [plain, nfr, retail]) x.s.close();
}

// --- the parser's edge cases, each against the client's code -------------------------
{
  const P = (text, o) => parseServerSettings(text, defaultServerSettings(), o);
  results.parse = {
    // several settings on one line, separated by text
    several: P('a %UI&sbw~ b %UI&hen~ c').UI,
    // no closing '~': nothing
    unclosed: P('%UI&nfr').seen,
    // a character other than '&' after the name ends the line's parse
    badChar: P('%UI&nfr~%U-I&sbw~%UI&hen~').UI,
    // lower case is not a name character: the name is empty, then 'u' -> stop
    lower: P('%ui&nfr~').seen,
    // a one-character name is skipped, and so is a five-character one
    lengths: P('%U&nfr~%ABCDE&x~%UI&hssjoin~').seen,
    // 3DS and 3DCP write the mine map's distance (settings.cpp:347, 353)
    slip: (() => { const s = P('%3DS&D=99~%3DCP&D=7~'); return { mine: s.mine3DMap.distance, supply: s.supplyDepot3DMap, cp: s.controlPoint3DMap }; })(),
    // strtol: a value's leading number; no '=' or an empty one is 0
    numbers: [P('%3DM&D=12abc~').mine3DMap.distance, P('%3DM&D=~').mine3DMap.distance, P('%3DM&D~').mine3DMap.distance, P('%3DM&D=-3~').mine3DMap.distance],
    colors: [colorFromString('#f0a'), colorFromString('#FF8000'), colorFromString('DodgerBlue'), colorFromString('#12345'), colorFromString('nocolor') === INVALID_COLOR, colorFromString('#-12')],
    // 3DO: unknown template dropped; the first entry for a template kept; empty T -> the name
    custom: P('%3DO&t=Nope&T=x~%3DO&t=Mortar~%3DO&t=mortar&T=second~', { templateExists: (n) => n.toLowerCase() === 'mortar' }).custom3DMaps,
    // a C string: nothing after a NUL
    nul: P('%UI&sbw~\0%UI&hen~').UI,
    // a setting split across two welcome lines is never seen (one parse per line)
    split: (() => { const s = defaultServerSettings(); parseServerSettings('%UI&n', s); parseServerSettings('fr~', s); return s.UI.allowFasterRestart; })(),
  };
  results.timing = {
    plus: restartTiming({ plus: true }),
    plusNfr: restartTiming({ plus: true, settings: P('%UI&nfr~') }),
    retail: restartTiming({ plus: false }),
  };
}

// --- the ConnectAcceptAck --------------------------------------------------------------
{
  const sent = (plus) => {
    const c = new NetConnection('127.0.0.1', 9, plus === 'default' ? {} : { plus });
    const out = [];
    c._raw = (b) => out.push(hex(b));
    c.state = 'connecting';
    const accept = Buffer.alloc(13); accept[2] = 2 << 4; accept[8] = 5; accept.writeUInt32LE(1234, 9);
    c._onConnectAccept(accept);
    c.sock.close();
    return out[0];
  };
  results.ack = {
    plusDefault: sent('default'),
    retail: sent(null),
    custom: sent({ version: { major: 1, minor: 6, patch: 3, build: 20 } }),
    parsed: parsePlusAcceptAck(buildPlusAcceptAck(5)),
    parsedRetail: parsePlusAcceptAck(Buffer.from('0500400000000000', 'hex')),
    crcCheck: crc8(Buffer.from('123456789', 'latin1')),
  };
}

process.stdout.write(JSON.stringify(results));
