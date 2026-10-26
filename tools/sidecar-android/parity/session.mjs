// Writes core/src/commonTest/resources/parity/session.json.gz from the Node
// sidecar's session.mjs: scripted transcripts of a Session driven through a
// fake socket and the fake clock. Each scenario is a list of steps (start,
// a datagram from the server at a time, a queued event, a chat line, leave),
// and its transcript is every datagram the session sends and every event it
// emits, with the virtual time, in order. SessionTest.kt runs the same steps
// through Session.kt and requires the same lines.
//
// Scenarios: `capture`, a real join of the lab (Wake co-op, 8 bots: the
// handshake, the world dump, a spawn and 10 s of a soldier's control states; the session leaves after) recorded
// by parity/live/udp-relay.mjs between the Node sidecar and the server and cut
// to its first 30 s, every datagram from the server replayed at its time; and synthetic ones built here
// from the wire's own encoders, for what a short lab join does not show (an
// expansion's two ChallengeResponses, the event window filling, a lost block's
// resend, chat in and out, bf42++ settings, the level gate's hold, timeout and
// throw, the quiet watchdog, a level change, malformed streams).
//
// Runs Node against the committed level tables with no install and no
// downloads (lib/tables.mjs), in a child, as the other decoder fixtures do.
//   node parity/session.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RES, SIDECAR, writeGz, gunzip, ensureTables, scratchCache, runNode } from './lib/tables.mjs';

const SELF = fileURLToPath(import.meta.url);
const CAPTURE = path.join(RES, 'session', 'lab-wake-join.capture.ndjson.gz');

if (!process.env.SESSION_PARITY_CHILD) {
  ensureTables();
  const cache = scratchCache();
  const text = runNode([SELF], cache, { env: { ...(await import('./lib/tables.mjs')).parityEnv(cache), SESSION_PARITY_CHILD: '1' } });
  writeGz(path.join(RES, 'session.json.gz'), text);
  console.log(`session.json.gz: ${text.length} bytes of JSON`);
  fs.rmSync(cache, { recursive: true, force: true });
  process.exit(0);
}

// ---- the child -------------------------------------------------------------------
const crypto = (await import('node:crypto')).default;
const { installFakeTime } = await import('./lib/fake-time.mjs');
const { enc, prng } = await import('./lib/fixture.mjs');
const imp = (f) => import(path.join(SIDECAR, f));
const { Session } = await imp('session.mjs');
const { PT } = await imp('netconn.mjs');
for (const k of ['SIDECAR_LAG_MS', 'SIDECAR_JITTER_MS', 'SIDECAR_LOSS']) delete process.env[k];
console.warn = () => {}; // the bundled-CRC notes
console.log = (...a) => process.stderr.write(a.join(' ') + '\n'); // stdout is the fixture

export const KEY = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const EVENT_NAMES = ['open', 'connected', 'joined', 'event', 'unknown-event', 'ghost', 'unknown-datagram', 'decode-error',
  'denied', 'disconnected', 'pong', 'stats', 'left', 'level-change', 'plus-settings', 'skip-static-objects',
  'level-hold', 'level-release', 'sent', 'control-state'];

async function run(sc) {
  const time = installFakeTime(0);
  const r = prng(sc.seed ?? 1942);
  const realRandomInt = crypto.randomInt;
  crypto.randomInt = (max) => Math.floor(r() * max);
  const lines = [];
  const at = () => time.now;
  const o = sc.opts ?? {};
  const gate = o.gate === undefined ? null
    : o.gate === 'throw' ? () => { throw new Error('gate broke'); }
    : o.gate === 'never' ? () => new Promise(() => {})
    : o.gate === 'none' ? () => null
    : () => new Promise((res) => setTimeout(() => res(o.gate.result), o.gate.delay));
  const s = new Session('10.0.0.9', 14567, {
    name: o.name ?? 'sidecar', team: o.team ?? 0, password: o.password ?? '', reconnectPassword: o.reconnectPassword ?? '',
    plus: o.plus === null ? null : undefined,
    keyFor: () => (o.key === null ? null : (o.key ?? KEY)),
    ...(o.silenceMs != null ? { silenceMs: o.silenceMs } : {}),
    ...(o.levelHoldMs != null ? { levelHoldMs: o.levelHoldMs } : {}),
    ...(gate ? { levelGate: gate } : {}),
  });
  const onMsg = s.conn.sock.listeners('message')[0];
  s.conn.sock.close();
  s.conn.sock = {
    send: (b, port, host, cb) => { lines.push(JSON.stringify(enc([at(), 'out', b]))); setImmediate(() => cb(null)); },
    close: () => lines.push(JSON.stringify([at(), 'sockClose'])),
  };
  s.conn.bind = async () => ({ address: '127.0.0.1', port: 50000, family: 'IPv4' });
  for (const n of EVENT_NAMES) s.on(n, (...a) => lines.push(JSON.stringify(enc([at(), 'ev', n, ...a]))));
  for (const st of sc.steps) {
    await time.stepTo(st.t);
    switch (st.op) {
      case 'start': await s.start(); break;
      case 'in': onMsg(Buffer.from(st.hex, 'hex'), { address: '10.0.0.9', port: 14567, family: 'IPv4', size: st.hex.length / 2 }); break;
      case 'queue': s.queue(st.name, st.body ?? {}); break;
      case 'say': lines.push(JSON.stringify([at(), 'said', s.chatOut.say(st.text, { team: !!st.team })])); break;
      case 'leave': s.leave(); break;
      case 'close': s.close(); break;
      case 'end': break;
      default: throw new Error(`bad op ${st.op}`);
    }
    await new Promise((res) => setImmediate(res));
  }
  // What the session holds at the end.
  lines.push(JSON.stringify(enc([at(), 'end', {
    joined: s.joined, me: { playerId: s.me.playerId, team: s.me.team, dbAcked: s.me.dbAcked, challengeA: s.me.challengeA, contentMod: s.me.contentMod ?? null, mapId: s.me.mapId ?? null },
    players: s.players.size, objects: s.objects.size, soldiers: [...s.soldiers], nextSendBlock: s.nextSendBlock, lastConfirmedBlock: s.lastConfirmedBlock,
    unconfirmed: [...s.unconfirmed.keys()], outbox: s.outbox.length, nextRecvBlock: s.nextRecvBlock, levelChange: s.levelChange,
    plus: { skipStaticObjects: s.plus.skipStaticObjects, setLevelSeen: s.plus.setLevelSeen }, restart: s.restartTiming(), conn: s.conn.state,
  }])));
  s.close();
  crypto.randomInt = realRandomInt;
  time.restore();
  return lines;
}

import { ID, dg, accept, data, disconnect, pingReq, payload, bitsOf, CHALLENGE, serverInfo, setLevel, createPlayer } from './lib/wire-fakes.mjs';

const scenarios = {};

// -- the lab capture -------------------------------------------------------------------
{
  const cap = gunzip(CAPTURE).trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.dir);
  const t0 = cap.find((x) => x.dir === 'out').t;
  // The capture is cut (live/trim-capture.mjs): the session leaves half a
  // second after the last datagram kept.
  const steps = [{ t: 0, op: 'start' }];
  for (const x of cap) if (x.dir === 'in') steps.push({ t: +(x.t - t0).toFixed(3), op: 'in', hex: x.hex });
  steps.push({ t: steps.at(-1).t + 500, op: 'leave' });
  steps.push({ t: steps.at(-1).t + 1000, op: 'end' });
  scenarios.capture = { opts: { name: 'capnode', team: 2, gate: { delay: 120, result: { source: 'cache' } } }, steps };
}

// -- a synthetic join of an expansion's server, through a level gate ----------------------
{
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  steps.push({ t: 100, op: 'in', hex: data(1, 1, 1, payload({ index: 0, events: [...serverInfo('XPack2'), { type: 'Challenge', challenge: CHALLENGE, xpack: 783, mod: 'XPack2' }] })) });
  steps.push({ t: 300, op: 'in', hex: data(2, 3, 7, payload({ index: 1, events: [
    { type: 'WelcomeMsg', message: 'Welcome %UI&nfr&hen~ %3DM&D=50&C=red~', index: 0 },
    { type: 'SpecialGame', kind: 2 },
    setLevel('bf1942/levels/wake/', 'coop.con'),
    createPlayer(4, 2, false, 'sidecar', 300), createPlayer(5, 1, true, 'bot1', 310),
    { type: 'SetTeam', team: 1, playerId: 4 },
    { type: 'SetDefaultVehicle', playerId: 4, netId: 302 },
    { type: 'DataBaseComplete', a: 0, b: 0 },
  ] })) });
  // A resent copy of block 1 (dropped), then the simulation start.
  steps.push({ t: 360, op: 'in', hex: data(3, 3, 7, payload({ index: 1, resend: true, events: [{ type: 'SpecialGame', kind: 0 }] })) });
  steps.push({ t: 700, op: 'in', hex: data(4, 5, 0x1f, payload({ index: 2, events: [{ type: 'Simulation', running: true, worldTime: 12.5 }, { type: 'SpecialGame', kind: 2 }] })) });
  // Out of order: block 4 before block 3.
  steps.push({ t: 800, op: 'in', hex: data(5, 6, 0x3f, payload({ index: 4, events: [{ type: 'DestroyPlayer', playerId: 5 }] })) });
  steps.push({ t: 820, op: 'in', hex: data(6, 6, 0x3f, payload({ index: 3, events: [{ type: 'ServerInfo2', serverName: 'renamed' }] })) });
  steps.push({ t: 900, op: 'in', hex: pingReq(6, 7, 0x7f, 123456) });
  steps.push({ t: 2500, op: 'end' });
  scenarios.xpackJoin = { opts: { name: 'sidecar', team: 2, gate: { delay: 250, result: { source: 'download', url: 'x' } } }, steps };
}

// -- the event window, a lost block and its resend -------------------------------------
{
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  for (let i = 0; i < 20; i++) steps.push({ t: 50 + i * 40, op: 'queue', name: 'RadioMessage', body: { message: i, broadcast: i % 2 === 1, playerId: 4 } });
  // Acks for the first sequences only, then a loss (sequence 3 lost, 4 delivered).
  steps.push({ t: 300, op: 'in', hex: data(1, 2, 0x3, payload({ index: 0, events: [] })) });
  steps.push({ t: 500, op: 'in', hex: data(2, 4, 0xd, payload({ index: 1, events: [] })) });
  steps.push({ t: 900, op: 'in', hex: data(3, 9, 0x1ff, payload({ index: 2, events: [] })) });
  steps.push({ t: 1300, op: 'in', hex: data(4, 20, 0xffffffff, payload({ index: 3, events: [] })) });
  steps.push({ t: 2200, op: 'end' });
  scenarios.window = { opts: { key: null }, steps };
}

// -- chat in and out, a level change, the quiet watchdog -------------------------------------
{
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  steps.push({ t: 100, op: 'in', hex: data(1, 1, 1, payload({ index: 0, events: [
    createPlayer(2, 1, false, 'me', 200),
    { type: 'ChatFragment', first: true, team: false, noSender: false, serverFlag: false, playerId: 7, total: 20, text: 'hello there, ge' },
    { type: 'ChatFragment', first: false, text: 'neral' },
    { type: 'ChatFragment', first: false, text: 'stray' },
    { type: 'ChatFragment', first: true, team: true, noSender: true, serverFlag: true, total: 3, text: 'abc' },
    { type: 'ChatFragment', first: true, total: 30, playerId: 1, text: 'open line' },
    { type: 'ChatFragment', first: true, total: 2, playerId: 3, text: 'hi' },
    { type: 'GameStatus', status: 2 },
    { type: 'GameStatus', status: 5, extra: '0815\0', text: 'bf1942' },
  ] })) });
  steps.push({ t: 150, op: 'say', text: 'a line long enough to need three pieces of fifteen' });
  steps.push({ t: 160, op: 'say', text: 'team', team: true });
  steps.push({ t: 170, op: 'say', text: '' });
  steps.push({ t: 180, op: 'say', text: 'third' });
  steps.push({ t: 190, op: 'say', text: 'fourth' });
  steps.push({ t: 200, op: 'say', text: 'fifth is dropped' });
  steps.push({ t: 3000, op: 'in', hex: data(2, 3, 7, payload({ index: 1, events: [] })) });
  // Then nothing: the watchdog reports a timeout 20 s on.
  steps.push({ t: 30000, op: 'end' });
  scenarios.chatQuiet = { opts: { name: 'me', key: null }, steps };
}

// -- malformed streams -------------------------------------------------------------------
{
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  steps.push({ t: 100, op: 'in', hex: data(1, 1, 1, payload({ mask: 1, events: [] })) });                        // input stream from the server
  steps.push({ t: 110, op: 'in', hex: data(2, 1, 1, payload({ mask: 8 | 2, index: 0, events: [{ type: 'SpecialGame', kind: 1 }] })) }); // a download stream
  steps.push({ t: 120, op: 'in', hex: data(3, 1, 1, payload({ index: 1, events: [{ type: 'SpecialGame', kind: 0 }, { type: 'raw', id: 0x7f }] })) }); // an unknown event id
  steps.push({ t: 130, op: 'in', hex: data(4, 1, 1, payload({ index: 2, count: 3, events: [{ type: 'SpecialGame', kind: 3 }] })) });  // the block says 3, holds 1
  steps.push({ t: 140, op: 'in', hex: data(5, 1, 1, Buffer.alloc(0)) });                                           // no mask at all
  steps.push({ t: 150, op: 'in', hex: data(6, 1, 1, payload({ mask: 2, count: 1, index: 3, events: [] })) });      // header only, no body
  // Ghost streams: a short header, a control state cut short, an action 2, and a record cut short.
  steps.push({ t: 160, op: 'in', hex: data(7, 1, 1, payload({ mask: 4, tail: bitsOf(20, 5) })) });
  steps.push({ t: 170, op: 'in', hex: data(8, 1, 1, payload({ mask: 4, tail: [...bitsOf(32, 99), ...bitsOf(8, 0), 1, ...bitsOf(12, 300)] })) });
  steps.push({ t: 180, op: 'in', hex: data(9, 1, 1, payload({ mask: 4, tail: [...bitsOf(32, 100), ...bitsOf(8, 3), 0, ...bitsOf(2, 0), ...bitsOf(16, 77), ...bitsOf(2, 3), ...bitsOf(16, 78), ...bitsOf(2, 2), ...bitsOf(16, 79)] })) });
  steps.push({ t: 190, op: 'in', hex: data(10, 1, 1, payload({ mask: 4, tail: [...bitsOf(32, 101), ...bitsOf(8, 1), 0, ...bitsOf(2, 1), ...bitsOf(16, 80), 1, ...bitsOf(11, 200), 1, 0, 1] })) });
  steps.push({ t: 200, op: 'in', hex: data(11, 1, 1, payload({ mask: 4, tail: [...bitsOf(32, 102), ...bitsOf(8, 1), 0, ...bitsOf(2, 1), ...bitsOf(16, 81), 0, ...bitsOf(11, 8), ...bitsOf(8, 0xa5)] })) });
  steps.push({ t: 210, op: 'in', hex: dg({ type: 0xc, seq: 0, body: [1, 2, 3] }) });                               // an unknown datagram type
  steps.push({ t: 300, op: 'in', hex: disconnect(0x0d) });
  steps.push({ t: 400, op: 'close' });
  steps.push({ t: 500, op: 'end' });
  scenarios.malformed = { opts: { plus: null, key: null }, steps };
}

// -- the level gate: a timeout, a throw, a gate with nothing to wait for -----------------------
for (const [name, gate] of [['gateTimeout', 'never'], ['gateThrows', 'throw'], ['gateNone', 'none']]) {
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  steps.push({ t: 100, op: 'in', hex: data(1, 1, 1, payload({ index: 0, events: [...serverInfo(), { type: 'Challenge', challenge: CHALLENGE, xpack: -1, mod: 'bf1942' }] })) });
  steps.push({ t: 200, op: 'in', hex: data(2, 2, 3, payload({ index: 1, events: [setLevel('bf1942/levels/el_alamein/', 'coop.con'), createPlayer(1, 2, false, 'g', 100), { type: 'DataBaseComplete', a: 1, b: 2 }] })) });
  steps.push({ t: 300, op: 'in', hex: data(3, 3, 7, payload({ index: 2, events: [{ type: 'Simulation', running: true, worldTime: 3 }] })) });
  steps.push({ t: 2600, op: 'leave' });
  steps.push({ t: 2700, op: 'end' });
  scenarios[name] = { opts: { gate, levelHoldMs: 2000 }, steps };
}

// -- a mod server: ServerInfo's mod (desertcombat) differs from the Challenge's
//    content base (bf1942); the gate asks for the server's mod's level -------------------
{
  const steps = [{ t: 0, op: 'start' }, { t: 40, op: 'in', hex: accept() }];
  steps.push({ t: 100, op: 'in', hex: data(1, 1, 1, payload({ index: 0, events: [
    { type: 'ServerInfo', mapId: 'BF1942', mod: 'desertcombat', gameId: 'bf1942' }, { type: 'ServerInfo2', serverName: 'dc lab' },
    { type: 'Challenge', challenge: CHALLENGE, xpack: -1, mod: 'bf1942' }] })) });
  steps.push({ t: 200, op: 'in', hex: data(2, 2, 3, payload({ index: 1, events: [setLevel('bf1942/levels/el_alamein/', 'coop.con'), createPlayer(1, 2, false, 'g', 100), { type: 'DataBaseComplete', a: 1, b: 2 }] })) });
  steps.push({ t: 600, op: 'leave' });
  steps.push({ t: 700, op: 'end' });
  scenarios.modServer = { opts: { gate: { delay: 100, result: { source: 'download' } } }, steps };
}

const out = {};
for (const [name, sc] of Object.entries(scenarios)) out[name] = { opts: sc.opts ?? {}, seed: sc.seed ?? 1942, steps: sc.steps, lines: await run(sc) };
out.challengeResponses = [
  { challenge: CHALLENGE, xpack: -1, mod: 'bf1942' }, { challenge: CHALLENGE, xpack: 783, mod: 'XPack2' }, { challenge: '00000000000000000000', xpack: 713, mod: '' },
].map((c) => ({ in: c, out: null }));
out.contentAck = [[1, 2], [0xffffffff, 0x12345678], [null, 5], [5, null], [0x80000000, 1]].map(([a, b]) => ({ in: [a, b] }));
out.eventWindowFull = [[0, 31], [14, 31], [15, 0], [14, 0], [3, 20], [20, 5], [31, 17]].map(([a, b]) => ({ in: [a, b] }));
{
  const S = await imp('session.mjs');
  for (const c of out.challengeResponses) {
    const r = prng(7);
    const real = crypto.randomInt; crypto.randomInt = (max) => Math.floor(r() * max);
    c.out = enc(S.challengeResponses({ challenge: Buffer.from(c.in.challenge, 'hex'), xpack: c.in.xpack, mod: c.in.mod }, (x) => (x === 713 ? null : `${KEY}${x}`), (m) => (m === 'XPack2' ? 0xdeadbeef : m === 'BF1942' ? 0x01020304 : null)));
    crypto.randomInt = real;
  }
  for (const c of out.contentAck) c.out = S.contentAck(...c.in);
  for (const c of out.eventWindowFull) c.out = S.eventWindowFull(...c.in);
}
process.stdout.write(JSON.stringify(out));
