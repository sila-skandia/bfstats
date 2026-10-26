// Writes core/src/test/resources/parity/chat.json from the Node sidecar's
// chat.mjs: the pieces a line is cut into, the receiver over the chat
// harness's lab capture (decoded here with events.mjs, so the fixture holds
// the pieces, not the bits) and over its refusals, and the sender's pace and
// queue on a fake clock. ChatTest.kt replays them.
//   node parity/chat.mjs
import fs from 'node:fs';
import { sidecar, write, prng } from './lib/fixture.mjs';

const C = await sidecar('chat.mjs');
const { BitReader, readEventBlock } = await sidecar('events.mjs');
const lab = JSON.parse(fs.readFileSync(new URL('../../bf1942-models/tests/fixtures/sidecar_chat_lab.json', import.meta.url)));
const out = {};

const texts = ['', 'hi', 'x'.repeat(15), 'y'.repeat(16), 'z'.repeat(100), 'a€b', 'emoji 😀 here', 'lone \ud800 surrogate', 'é'.repeat(70),
  'tab\tand\nnewline', 'ÿĀ', 'x'.repeat(63), 'x'.repeat(64), null];
out.fragments = texts.flatMap((t) => [
  { text: t, opts: {}, out: C.chatFragments(t) },
  { text: t, opts: { team: true, playerId: 7, noSender: true, serverFlag: true }, out: C.chatFragments(t, { team: true, playerId: 7, noSender: true, serverFlag: true }) },
]);
out.bytes = texts.map((t) => [t, Buffer.from(C.chatBytes(t)).toString('hex')]);
out.constants = { CHAT_PIECE: C.CHAT_PIECE, CHAT_MAX: C.CHAT_MAX, CHAT_QUEUE: C.CHAT_QUEUE, CHAT_PIECE_MS: C.CHAT_PIECE_MS, CHAT_RECV_MAX: C.CHAT_RECV_MAX };

// The receiver over the lab's datagrams, per session: every piece in, every answer out.
const pieceOf = (ev) => {
  const p = { first: ev.first, text: ev.text };
  for (const k of ['team', 'noSender', 'serverFlag', 'playerId', 'total']) if (ev[k] !== undefined) p[k] = ev[k];
  return p;
};
const streams = {};
for (const d of lab.received) {
  const r = new BitReader(Buffer.from(d.hex, 'hex'));
  if (!(r.readUnsigned(6) & 2)) continue;
  for (const ev of readEventBlock(r).events) if (ev.type === 'ChatFragment') (streams[d.who] ??= []).push(pieceOf(ev));
}
// What the sidecar sent, read back as the server reads it.
for (const d of lab.sent) {
  const r = new BitReader(Buffer.from(d.hex, 'hex'));
  r.readUnsigned(6);
  for (const ev of readEventBlock(r).events) if (ev.type === 'ChatFragment') (streams[`${d.who}:sent`] ??= []).push(pieceOf(ev));
}
// Refusal streams (the harness's) and a random mix.
streams.laterFirst = [{ first: false, text: 'x' }, { first: true, total: 1, playerId: 2, text: 'y' }];
streams.firstWhileOpen = [{ first: true, total: 20, playerId: 1, text: 'x'.repeat(15) }, { first: true, total: 3, playerId: 1, text: 'abc' }, { first: false, text: 'x'.repeat(5) }];
streams.overLong = [{ first: true, total: 255, playerId: 1, text: 'x'.repeat(15) }, ...Array(5).fill({ first: false, text: 'x'.repeat(15) })];
streams.overshoot = [{ first: true, total: 4, playerId: 1, text: 'abc' }, { first: false, text: 'de' }, { first: false, text: 'f' }];
streams.serverLine = [{ first: true, team: false, noSender: true, serverFlag: true, playerId: 9, total: 3, text: 'abc' }];
streams.zero = [{ first: true, total: 0, text: '' }, { first: true, text: 'q' }];
{
  const rnd = prng(777);
  const s = [];
  for (let i = 0; i < 200; i++) {
    const first = rnd() < 0.3;
    const n = Math.floor(rnd() * 16);
    const text = Array.from({ length: n }, () => String.fromCharCode(32 + Math.floor(rnd() * 224))).join('');
    s.push(first ? { first, team: rnd() < 0.5, noSender: rnd() < 0.2, serverFlag: rnd() < 0.2, playerId: Math.floor(rnd() * 64), total: Math.floor(rnd() * 70), text } : { first, text });
  }
  streams.random = s;
}
out.assemble = Object.fromEntries(Object.entries(streams).map(([who, pieces]) => {
  const a = new C.ChatAssembler();
  return [who, pieces.map((p) => ({ in: p, out: a.push(p) }))];
}));
// reset() mid-line
{
  const a = new C.ChatAssembler();
  const r1 = a.push({ first: true, total: 10, playerId: 1, text: 'abc' });
  a.reset();
  out.reset = [r1, a.push({ first: false, text: 'x' }), a.push({ first: true, total: 1, playerId: 4, text: 'z' })];
}

// The sender on a fake clock: a pump every 50 ms, as the harness drives it,
// and one driven by its own interval.
function sender(lines, { step = 50, until = 5000, ownTimer = false, pieceMs } = {}) {
  let t = 0;
  const queued = [];
  const timers = [];
  const s = new C.ChatSender({ queue: (name, body) => queued.push({ t, name, body }) }, {
    now: () => t, ...(pieceMs ? { pieceMs } : {}),
    setTimer: (fn, ms) => { const h = { fn, ms, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { h.dead = true; },
  });
  const accepted = lines.map(([text, team, at]) => ({ text, team, at }));
  const said = [];
  for (; t <= until; t += step) {
    for (const l of accepted) if (l.at === t) said.push({ t, ok: s.say(l.text, { team: l.team }) });
    if (ownTimer) { for (const h of timers) if (!h.dead) while (h.at <= t) { h.at += h.ms; h.fn(); } } else s.pump();
  }
  return { lines, step, until, ownTimer, pieceMs: pieceMs ?? null, said, queued, timers: timers.map((h) => ({ ms: h.ms, dead: !!h.dead })) };
}
out.sender = [
  sender([['first line, which is long enough for three pieces!', false, 0], ['second', false, 0], ['third', true, 0], ['fourth', false, 0], ['fifth: the queue is full', false, 0], ['', false, 0]]),
  sender([['a', false, 0], ['b', false, 100], ['c'.repeat(40), true, 2000], ['d', false, 2050]], { ownTimer: true }),
  sender([['x'.repeat(63), false, 0], ['y', false, 600]], { ownTimer: true, pieceMs: 50, step: 10, until: 1000 }),
  sender([['€€€', false, 0], ['\u0000', false, 0]], { ownTimer: true }),
];

write('chat', out);
