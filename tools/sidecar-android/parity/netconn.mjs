// Writes core/src/test/resources/parity/netconn.json from the Node
// sidecar's netconn.mjs: every datagram builder's bytes, the parsers over
// edge datagrams, the lab-knob env parsing, and scripted transcripts of a
// NetConnection driven through a fake socket and a fake clock (every
// datagram it sends, every event it emits, in order). NetConnTest.kt replays
// the scripts through the Kotlin port and requires the same transcript.
//   node parity/netconn.mjs
import { sidecar, write, hex, encs, prng } from './lib/fixture.mjs';
import { installFakeTime } from './lib/fake-time.mjs';

for (const k of ['SIDECAR_LAG_MS', 'SIDECAR_JITTER_MS', 'SIDECAR_LOSS']) delete process.env[k];
const N = await sidecar('netconn.mjs');
const { NetConnection, PT } = N;

const out = {};

// --- builders and parsers ---------------------------------------------------
out.connectRequest = [
  {}, { password: 'lab' }, { password: 'x'.repeat(31) }, { password: 'y'.repeat(32) }, { password: 'z'.repeat(40) },
  { reconnectPassword: '4711' }, { reconnectPassword: '07' }, { reconnectPassword: '123456' },
  { password: 'café€', reconnectPassword: 'Łx' }, { password: 'lab', reconnectPassword: '0815' },
].map((o) => ({ in: o, hex: hex(N.buildConnectRequest(o)) }));
out.serverInfoRequest = hex(N.buildServerInfoRequest());
const info = (name, len = 0x88) => { const b = Buffer.alloc(len); b[0] = 1; b[2] = PT.ServerInfo << 4; if (len > 8) b.write(name, 8, 'latin1'); return b; };
out.parseServerInfo = [
  info('lab server'), info(''), info('x', 9), info('', 8), info('', 7), Buffer.from('0100a0', 'hex'),
  (() => { const b = info('abc'); b[2] = 0x20; return b; })(),
  Buffer.from('0100a000ac1fd4f5bf9b0408402bd4f5c02bd4f5ba0b0000', 'hex'), // a real server1 answer's head: no name there
].map((b) => ({ hex: hex(b), out: N.parseServerInfo(b) }));
out.presult = Object.fromEntries([0, 2, 0x0a, 0x0d, 0x11, 0x15, 0x16, 0x19, 0x1b, 0x1e, 0x42, 0xffffffff].map((r) => [r, N.PRESULT[r] ?? `0x${r.toString(16)}`]));
out.constants = { PROTOCOL_MAJOR: N.PROTOCOL_MAJOR, PROTOCOL_MINOR: N.PROTOCOL_MINOR, MAX_DATAGRAM: N.MAX_DATAGRAM, MAX_PAYLOAD: N.MAX_PAYLOAD };

// --- the lab knobs ------------------------------------------------------------
out.env = [];
for (const env of [{}, { SIDECAR_LAG_MS: '170' }, { SIDECAR_LAG_MS: ' 40 ', SIDECAR_JITTER_MS: '20', SIDECAR_LOSS: '0.02' },
  { SIDECAR_LAG_MS: '-5', SIDECAR_JITTER_MS: 'abc', SIDECAR_LOSS: '2' }, { SIDECAR_LAG_MS: '0x10', SIDECAR_JITTER_MS: '1e2', SIDECAR_LOSS: '-1' },
  { SIDECAR_LAG_MS: '', SIDECAR_JITTER_MS: '.5', SIDECAR_LOSS: 'Infinity' }, { SIDECAR_LAG_MS: '12px', SIDECAR_JITTER_MS: '+3', SIDECAR_LOSS: '0.5e0' }]) {
  for (const k of ['SIDECAR_LAG_MS', 'SIDECAR_JITTER_MS', 'SIDECAR_LOSS']) delete process.env[k];
  Object.assign(process.env, env);
  const c = new NetConnection('127.0.0.1', 9);
  out.env.push({ env, lagMs: c.lagMs, jitterMs: c.jitterMs, loss: c.loss });
  c.sock.close();
}
for (const k of ['SIDECAR_LAG_MS', 'SIDECAR_JITTER_MS', 'SIDECAR_LOSS']) delete process.env[k];

// --- transcripts ----------------------------------------------------------------
// A datagram from the server: header fields, then the body at byte 7 (data:
// the u16 length and the payload).
function dg({ type, id = 5, seq = 0, ack = 0, mask = 0, size = 7, body = null }) {
  const b = Buffer.alloc(Math.max(size, 7 + (body ? body.length : 0)));
  b[0] = id;
  b[1] = (seq & 0x3f) | ((ack & 3) << 6);
  b[2] = (type << 4) | ((ack >> 2) & 0xf);
  b.writeUInt32LE(mask >>> 0, 3);
  if (body) Buffer.from(body).copy(b, 7);
  return b;
}
const accept = (id = 5, time = 1234) => { const b = Buffer.alloc(13); b[2] = PT.ConnectAccept << 4; b[8] = id; b.writeUInt32LE(time, 9); return b; };
const denied = (reason, len = 16) => { const b = Buffer.alloc(len); b[2] = PT.ConnectDenied << 4; if (len >= 12) b.writeUInt32LE(reason, 8); return b; };
const disc = (reason, message = '', len = 0x20c) => { const b = Buffer.alloc(len); b[2] = PT.Disconnect << 4; if (len >= 12) b.writeUInt32LE(reason, 8); if (len > 12) b.write(message, 12, 'latin1'); return b; };
const data = (seq, ack, mask, payload) => { const p = typeof payload === 'string' ? Buffer.from(payload, 'hex') : Buffer.from(payload); const body = Buffer.alloc(2 + p.length); body.writeUInt16LE(p.length, 0); p.copy(body, 2); return dg({ type: PT.Data, seq, ack, mask, body }); };
const pingReq = (seq, ack, mask, clock, flag) => { const body = Buffer.alloc(6); body.writeUInt32LE(clock, 1); body[5] = flag; return dg({ type: PT.PingRequest, seq, ack, mask, body }); };
const pingResp = (seq, ack, mask, echo, theirs, flag) => { const body = Buffer.alloc(10); body.writeUInt32LE(echo, 1); body.writeUInt32LE(theirs, 5); body[9] = flag; return dg({ type: PT.PingResponse, seq, ack, mask, body }); };

function run(script, { opts = {}, env = {}, random = [] } = {}) {
  for (const k of ['SIDECAR_LAG_MS', 'SIDECAR_JITTER_MS', 'SIDECAR_LOSS']) delete process.env[k];
  Object.assign(process.env, env);
  const clock = installFakeTime(1_000_000, { wall0: 0, floorWall: true });
  let ri = 0;
  const realRandom = Math.random;
  Math.random = () => random[ri++ % random.length];
  const log = [];
  const pendingCbs = [];
  const fake = {
    send: (b, port, host, cb) => { log.push(encs(['out', b, port, host])); pendingCbs.push(cb); },
    close: () => log.push(encs(['sockClose'])),
  };
  const nopts = { ...opts };
  if (nopts.plus === 'default') delete nopts.plus;
  const c = new NetConnection('10.0.0.9', 14567, nopts);
  const onMsg = c.sock.listeners('message')[0];
  c.sock.close();
  c.sock = fake;
  for (const ev of ['connected', 'denied', 'disconnected', 'pong', 'data', 'server-info', 'unknown', 'status', 'raw-out']) {
    c.on(ev, (...a) => log.push(encs(['ev', ev, ...a])));
  }
  c.on('raw-in', (b) => log.push(encs(['ev', 'raw-in', b])));
  for (const step of script) {
    log.push(encs(['step', step]));
    try {
      switch (step.op) {
        case 'connect': c.connect(); break;
        case 'in': onMsg(Buffer.from(step.hex, 'hex'), { address: '10.0.0.9', port: 14567, family: 'IPv4', size: step.hex.length / 2 }); break;
        case 'advance': clock.advance(step.ms); break;
        case 'flush': while (pendingCbs.length) pendingCbs.shift()(null); break;
        case 'send': log.push(encs(['seq', c.sendData(Buffer.from(step.hex, 'hex'), step.tag ?? null)])); break;
        case 'sendBig': c.sendData(Buffer.alloc(step.n)); break;
        case 'ping': c.pingRequest(); break;
        case 'disconnect': c.disconnect(step.reason, step.message); break;
        case 'close': c.close(); break;
        case 'state': c.state = step.state; if (step.id != null) c.id = step.id; break;
        default: throw new Error(`bad op ${step.op}`);
      }
    } catch (e) { log.push(encs(['err', e.message])); }
  }
  const end = {
    state: c.state, id: c.id, sendSeq: c.sendSeq, lastRecv: c.lastRecv, lastConfirmed: c.lastConfirmed, recvMask: c.recvMask,
    lastSentSeq: c.lastSentSeq, stats: c.stats, sentPackets: [...c.sentPackets.entries()], lastHeardAt: c.lastHeardAt, now: c.now(),
    pending: c._pending ?? 0,
  };
  Math.random = realRandom;
  clock.restore();
  return { opts, env, random, script, log, end: encs(end) };
}

const H = (b) => ({ op: 'in', hex: hex(b) });
const scripts = {};

// The handshake as bf42++ (the default), the data path and its bookkeeping.
{
  const s = [{ op: 'ping' }, { op: 'send', hex: 'aa' }, { op: 'connect' }, { op: 'advance', ms: 2500 }, { op: 'flush' },
    H(accept(5, 1234)), H(accept(6, 99)), { op: 'advance', ms: 3000 }, { op: 'flush' }];
  // The server's data: seq 1, 2, then 4 (3 lost), a duplicate 4, an old 2, then a ping carrying 6 (5 never seen).
  s.push(H(data(1, 0, 0, '0102')), H(data(2, 0, 0, '03')), H(data(4, 0, 0, '')), H(data(4, 0, 0, 'ff')), H(data(2, 0, 0, 'ee')));
  s.push(H(pingReq(6, 0, 0, 777, 1)), H(pingReq(6, 0, 0, 778, 0)), H(dg({ type: PT.PingRequest, size: 12 })));
  // Ours: three payloads, two tagged, then the server acks 1 and 3 (2 lost).
  s.push({ op: 'send', hex: '1122', tag: 'a' }, { op: 'send', hex: '33', tag: null }, { op: 'send', hex: '', tag: 'c' });
  s.push({ op: 'advance', ms: 40 }, H(data(7, 3, 0b101, '07')), { op: 'ping' }, { op: 'advance', ms: 55 });
  s.push(H(pingResp(8, 3, 0b101, 3040, 5, 1)), H(pingResp(8, 3, 0, 1, 5, 0)), H(dg({ type: PT.PingResponse, size: 16 })));
  // An ack ahead of anything sent (statuses with no tag), and a stale one.
  s.push(H(data(9, 6, 0xffffffff, '')), H(data(10, 5, 0, '')));
  // A payload length past the datagram's end is clamped.
  s.push(H(dg({ type: PT.Data, seq: 11, body: Buffer.from('ff0001', 'hex') })));
  // Wrap the sequence: 70 more datagrams in.
  for (let i = 0; i < 70; i++) s.push(H(data((12 + i) & 0x3f, 6, 1, [i])));
  // Fill the send window: 31 more sends without an ack, the last refused.
  for (let i = 0; i < 31; i++) s.push({ op: 'send', hex: i.toString(16).padStart(2, '0'), tag: `w${i}` });
  s.push({ op: 'sendBig', n: 1464 }, H(data(18, 37, 0x7fffffff, '')), { op: 'sendBig', n: 1463 });
  s.push(H(info('lab')), H(dg({ type: 6, size: 9 })), H(Buffer.from('0102', 'hex')));
  s.push({ op: 'disconnect', reason: 0xd, message: 'bye' }, { op: 'ping' }, { op: 'close' }, { op: 'flush' }, { op: 'close' });
  scripts.handshake = run(s);
}
// The send window: 30 ahead of the last ack, the 31st refused, an ack opens
// it again, and the sequence wraps past 63.
{
  const s = [{ op: 'connect' }, H(accept(5, 1)), { op: 'flush' }];
  for (let i = 0; i < 31; i++) s.push({ op: 'send', hex: '', tag: `w${i}` });
  s.push(H(data(1, 30, 0x2fffffff, '')));
  for (let i = 0; i < 40; i++) s.push({ op: 'send', hex: 'ab', tag: i });
  s.push(H(data(2, 63 & 60, 0xfffffffe, '')), { op: 'send', hex: 'cd' }, { op: 'flush' });
  scripts.window = run(s);
}
// The retail ack, then the server's Disconnect with a message.
scripts.retail = run([{ op: 'connect' }, H(accept(7, 0xfedcba98)), { op: 'flush' }, H(disc(0x15, 'Kicked for teamkilling')),
  { op: 'disconnect' }, { op: 'close' }], { opts: { plus: null } });
scripts.customPlus = run([{ op: 'connect' }, H(accept(3, 1)), { op: 'flush' }], { opts: { plus: { version: { major: 1, minor: 6, patch: 3, build: 20 } } } });
scripts.passwords = run([{ op: 'connect' }, { op: 'advance', ms: 1000 }, H(denied(0x11)), { op: 'advance', ms: 3000 }],
  { opts: { password: 'secret', reconnectPassword: '4711' } });
for (const [name, b] of [['deniedShort', denied(0, 11)], ['deniedUnknown', denied(0x42)], ['deniedBanned', denied(0x16)]]) {
  scripts[name] = run([{ op: 'connect' }, H(b), { op: 'advance', ms: 2000 }]);
}
// The server ends the session (the kick harness's cases) and other closes.
for (const [name, b] of [['kicked', disc(0x15, 'Kicked for teamkilling')], ['banned', disc(0x16)], ['closed', disc(0x0d)],
  ['timeout', disc(0x0a)], ['levelChange', disc(0x19)], ['discShort', disc(0, '', 12)], ['discTiny', disc(0, '', 11)], ['discLong', disc(0x15, 'm'.repeat(600), 0x30c)]]) {
  scripts[name] = run([{ op: 'connect' }, H(accept(2, 5)), H(b), { op: 'ping' }, { op: 'send', hex: '00' }]);
}
// The disconnect harness: a goodbye from a connection set up by hand, closed at once.
scripts.goodbye = run([{ op: 'state', state: 'connected' }, { op: 'disconnect', reason: 0xd, message: '' }, { op: 'close' }, { op: 'flush' },
  { op: 'disconnect', reason: 0xd, message: 'again' }]);
scripts.longMessage = run([{ op: 'state', state: 'connected', id: 9 }, { op: 'disconnect', reason: 0x0d, message: 'é'.repeat(600) }]);
// The lab knobs: lag, jitter and loss each way, against a fixed random stream.
{
  const r = prng(12345);
  const random = Array.from({ length: 97 }, r);
  const s = [{ op: 'connect' }, { op: 'advance', ms: 50 }, H(accept(4, 10)), { op: 'advance', ms: 200 }, { op: 'flush' }];
  for (let i = 0; i < 12; i++) s.push(H(data(1 + i, 0, 0, [i])), { op: 'send', hex: `0${i % 10}`, tag: i }, { op: 'advance', ms: 30 }, { op: 'flush' });
  s.push({ op: 'ping' }, { op: 'disconnect' }, { op: 'close' }, { op: 'advance', ms: 500 }, { op: 'flush' });
  scripts.labKnobs = run(s, { env: { SIDECAR_LAG_MS: '170', SIDECAR_JITTER_MS: '25', SIDECAR_LOSS: '0.3' }, random });
}
// An ack for sequences never sent is ignored (it used to move lastConfirmed
// past sendSeq and close the send window for good), and so is a short
// ConnectAccept: the resend carries on until a whole one comes.
{
  const s = [{ op: 'connect' }, H(accept(5, 1).subarray(0, 12)), H(accept(5, 1).subarray(0, 7)), { op: 'advance', ms: 1000 }, H(accept(5, 1)), { op: 'flush' }];
  s.push(H(data(1, 20, 0xffffffff, '')), H(pingReq(2, 40, 0, 7, 0)), { op: 'send', hex: '01', tag: 'a' });
  s.push(H(data(3, 5, 0xffffffff, '')), { op: 'send', hex: '02', tag: 'b' }, { op: 'send', hex: '03', tag: 'c' });
  s.push(H(data(4, 3, 0b111, '')), H(data(5, 9, 0xffffffff, '')));
  for (let i = 0; i < 32; i++) s.push({ op: 'send', hex: '04', tag: i });
  s.push(H(data(6, 33, 0xffffffff, '')), H(data(7, 34, 0xffffffff, '')), { op: 'send', hex: '05' }, { op: 'flush' });
  scripts.ackAhead = run(s);
}
scripts.lagOnly = run([{ op: 'connect' }, H(accept(4, 10)), { op: 'advance', ms: 100 }, { op: 'flush' }, { op: 'disconnect' }, { op: 'close' },
  { op: 'advance', ms: 100 }, { op: 'flush' }], { env: { SIDECAR_LAG_MS: '100' } });
out.scripts = scripts;

// probeServerInfo over a real socket (the rejoin harness's probe): a stand-in
// that answers every request with a 136-byte ServerInfo, and a closed port.
{
  const dgram = (await import('node:dgram')).default;
  const server = dgram.createSocket('udp4');
  const got = [];
  server.on('message', (msg, rinfo) => { got.push(hex(msg)); server.send(info('lab server'), rinfo.port, rinfo.address); });
  await new Promise((res) => server.bind(0, '127.0.0.1', res));
  const up = await N.probeServerInfo('127.0.0.1', server.address().port, { timeoutMs: 1000 });
  server.close();
  const quiet = dgram.createSocket('udp4');
  await new Promise((res) => quiet.bind(0, '127.0.0.1', res));
  const port = quiet.address().port;
  quiet.close();
  const down = await N.probeServerInfo('127.0.0.1', port, { timeoutMs: 300 });
  out.probe = { reply: hex(info('lab server')), up, requests: got, down };
}

write('netconn', out);
process.exit(0);
