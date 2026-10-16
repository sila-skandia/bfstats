// The sidecar's chat under node (sidecar/chat.mjs, events.mjs ChatFragment,
// record.mjs). Fed the lab capture in fixtures/sidecar_chat_lab.json: the
// server's own datagrams as two sidecar sessions received them, and the
// datagrams chatA and chatB sent. See test_sidecar_chat.py.
import fs from 'node:fs';
import { BitReader, BitWriter, readEventBlock, writeEventBlock } from '../sidecar/events.mjs';
import { ChatAssembler, ChatSender, chatFragments, CHAT_PIECE, CHAT_MAX } from '../sidecar/chat.mjs';
import { recordFor } from '../sidecar/record.mjs';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_chat_lab.json', import.meta.url)));
const EVENTS = 1 << 1;
const results = {};

// An event block off a datagram: the 6-bit stream mask, then the events.
function blockOf(hex) {
  const r = new BitReader(Buffer.from(hex, 'hex'));
  const mask = r.readUnsigned(6);
  if (!(mask & EVENTS)) return null;
  return readEventBlock(r);
}

// --- what the server sent: pieces back into lines ---------------------------
const asm = new Map();
results.pieces = [];
results.heard = [];
for (const d of fx.received) {
  const block = blockOf(d.hex);
  for (const ev of block.events) {
    if (ev.type !== 'ChatFragment') continue;
    results.pieces.push({ who: d.who, first: ev.first, len: ev.text.length, pid: ev.playerId ?? null });
    if (!asm.has(d.who)) asm.set(d.who, new ChatAssembler());
    const line = asm.get(d.who).push(ev);
    if (line && !line.refused) results.heard.push({ who: d.who, ...recordFor({ type: 'Chat', ...line }) });
    if (line?.refused) results.heard.push({ who: d.who, refused: line.refused });
  }
}

// --- what the sidecar sent: rebuilt from the lines said, byte for byte -------
results.sentRebuilt = [];
const byWho = new Map();
for (const d of fx.sent) { if (!byWho.has(d.who)) byWho.set(d.who, []); byWho.get(d.who).push(d); }
for (const [who, sent] of byWho) {
  const pieces = fx.said.filter((x) => x.who === who).flatMap((x) => chatFragments(x.text, { team: x.team }));
  sent.forEach((d, i) => {
    const r = new BitReader(Buffer.from(d.hex, 'hex'));
    r.readUnsigned(6);
    r.readUnsigned(8);
    const index = r.readUnsigned(5);
    const resend = r.readBool();
    const w = new BitWriter(256);
    w.writeUnsigned(EVENTS, 6);
    writeEventBlock(w, index, resend, [['ChatFragment', pieces[i]]]);
    results.sentRebuilt.push({ who, i, same: Buffer.from(w.bytes()).toString('hex') === d.hex });
  });
  results.sentRebuilt.push({ who, pieces: pieces.length, datagrams: sent.length });
}
// and our sent bytes read back as the server reads them
results.sentHeard = [];
for (const [who, sent] of byWho) {
  const a = new ChatAssembler();
  for (const d of sent) for (const ev of blockOf(d.hex).events) {
    const line = a.push(ev);
    if (line) results.sentHeard.push({ who, ...line });
  }
}

// --- the layout's sizes, in bits past the block header (8 + 5 + 1) and the
// 7-bit type: a later piece is 4 + 8n, a first piece adds 4 bools, the u8
// total and, unless noSender, the u8 sender.
function pieceBits(piece) { const w = new BitWriter(64); writeEventBlock(w, 0, false, [['ChatFragment', piece]]); return w.pos - 14 - 7; }
results.sizes = {
  later: pieceBits({ first: false, text: 'abc' }),
  serverFirst: pieceBits({ first: true, team: false, noSender: true, serverFlag: true, total: 3, text: 'abc' }),
  playerFirst: pieceBits({ first: true, team: true, playerId: 7, total: 3, text: 'abc' }),
};
// a server line round trip: no sender on the wire, pid -1
{
  const w = new BitWriter(64);
  writeEventBlock(w, 0, false, [['ChatFragment', { first: true, team: false, noSender: true, serverFlag: true, playerId: 9, total: 3, text: 'abc' }]]);
  const b = readEventBlock(new BitReader(w.bytes()));
  results.serverLine = recordFor({ type: 'Chat', ...new ChatAssembler().push(b.events[0]) });
}

// --- fragmenting --------------------------------------------------------------
results.split = {
  short: chatFragments('hi').map((p) => p.text),
  exact: chatFragments('x'.repeat(CHAT_PIECE)).map((p) => p.text.length),
  sixteen: chatFragments('y'.repeat(CHAT_PIECE + 1)).map((p) => p.text.length),
  long: chatFragments('z'.repeat(100)).map((p) => p.text.length),
  total: chatFragments('z'.repeat(100))[0].total,
  max: CHAT_MAX,
  wide: chatFragments('a€b')[0].text,
};

// --- the receiver's refusals -------------------------------------------------
{
  const a = new ChatAssembler();
  results.refusals = {
    laterFirst: a.push({ first: false, text: 'x' })?.refused ?? null,
  };
  a.push({ first: true, total: 20, playerId: 1, text: 'x'.repeat(15) });
  results.refusals.firstWhileOpen = a.push({ first: true, total: 3, playerId: 1, text: 'abc' })?.refused ?? null;
  const b = new ChatAssembler();
  b.push({ first: true, total: 255, playerId: 1, text: 'x'.repeat(15) });
  for (let i = 0; i < 3; i++) b.push({ first: false, text: 'x'.repeat(15) });
  results.refusals.overLong = b.push({ first: false, text: 'x'.repeat(15) })?.refused ?? null;
}

// --- the sender's pace and queue ---------------------------------------------
{
  let t = 0;
  const queued = [];
  const session = { queue: (name, body) => queued.push({ t, name, body }) };
  const s = new ChatSender(session, { now: () => t, setTimer: () => 1, clearTimer: () => {} });
  const accepted = [];
  accepted.push(s.say('first line, which is long enough for three pieces!'));
  accepted.push(s.say('second'));
  accepted.push(s.say('third', { team: true }));
  accepted.push(s.say('fourth'));
  accepted.push(s.say('fifth: the queue is full'));
  accepted.push(s.say(''));
  for (t = 0; t <= 5000; t += 50) s.pump();
  results.sender = {
    accepted,
    times: queued.map((q) => q.t),
    firsts: queued.map((q) => q.body.first),
    teams: queued.filter((q) => q.body.first).map((q) => q.body.team),
  };
}

console.log(JSON.stringify(results));
