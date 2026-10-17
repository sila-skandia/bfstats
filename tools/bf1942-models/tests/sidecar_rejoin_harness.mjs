// The sidecar's rejoin after a level change under node (sidecar/rejoin.mjs,
// netconn.mjs buildConnectRequest / probeServerInfo, session.mjs GameStatus 5).
// Bytes are built from the binaries' layouts, not captured: GameStatusEvent::
// serialize 0x0811db80 (u8 status, and for status 5 forty raw bits, u8 length,
// that many bytes), the ConnectRequest (handleConnectRequest 0x08436810 /
// the client's 0x0060f300), sendServerInfo 0x08436280. The state machine runs
// against a fake session and a fake clock. See test_sidecar_rejoin.py.
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { BitWriter } from '../sidecar/bitstream.mjs';
import { EVENT_TYPE_BITS, BLOCK_COUNT_BITS, BLOCK_INDEX_BITS } from '../sidecar/events.mjs';
import { buildConnectRequest, buildServerInfoRequest, probeServerInfo, PT, PROTOCOL_MAJOR, PROTOCOL_MINOR } from '../sidecar/netconn.mjs';
import { Session } from '../sidecar/session.mjs';
import { Rejoiner, classifyDisconnect, denialIsFinal, reconnectFromGameStatus, DISCONNECT } from '../sidecar/rejoin.mjs';

const results = {};
const hex = (b) => Buffer.from(b).toString('hex');

// --- the ConnectRequest -------------------------------------------------------
{
  const plain = buildConnectRequest({});
  const keyed = buildConnectRequest({ password: 'lab', reconnectPassword: '4711' });
  const long = buildConnectRequest({ reconnectPassword: '123456' });
  const short = buildConnectRequest({ reconnectPassword: '07' });
  results.connect = {
    length: keyed.length,
    type: keyed[2] >> 4,
    major: keyed.readUInt32LE(8), minor: keyed.readUInt32LE(12),
    password: keyed.subarray(16, 16 + 4).toString('latin1'),
    passwordTailZero: keyed.subarray(19, 80).every((x) => x === 0),
    keyed: hex(keyed.subarray(80, 84)),
    plain: hex(plain.subarray(80, 84)),
    long: hex(long.subarray(80, 84)),
    short: hex(short.subarray(80, 84)),
    expectMajor: PROTOCOL_MAJOR, expectMinor: PROTOCOL_MINOR,
  };
  // A Session built for a rejoin carries the key through to its connection.
  const s = new Session('127.0.0.1', 9, { name: 't', reconnectPassword: '4711' });
  results.connect.sessionKey = hex(buildConnectRequest({ password: s.conn.password, reconnectPassword: s.conn.reconnectPassword }).subarray(80, 84));
  s.close();
  const sir = buildServerInfoRequest();
  results.serverInfoRequest = { length: sir.length, type: sir[2] >> 4 };
}

// --- GameStatus 5 off the wire --------------------------------------------------
// One event-stream payload as the server writes it: the 6-bit stream mask
// (events only), the block header, GameStatus 5 then an Ack, so the test also
// proves the reader stopped exactly at GameStatus's end.
function statusPayload(status, digits, mod, index = 0) {
  const w = new BitWriter(256);
  w.writeUnsigned(1 << 1, 6);                 // stream mask: GameEventManager
  w.writeUnsigned(2, BLOCK_COUNT_BITS);       // two events
  w.writeUnsigned(index, BLOCK_INDEX_BITS);
  w.writeBool(false);                         // not a resend
  w.writeUnsigned(0x24, EVENT_TYPE_BITS);     // GameStatus
  w.writeUnsigned(status, 8);
  if (status === 5) {
    // GameStatusEvent ctor 0x0815b490: four bytes of the password, then a NUL.
    const five = Buffer.alloc(5);
    Buffer.from(digits, 'latin1').copy(five, 0, 0, 4);
    w.writeBytes(five);
    const text = Buffer.from(mod, 'latin1');
    w.writeUnsigned(text.length, 8);
    w.writeBytes(text);
  }
  w.writeUnsigned(0x02, EVENT_TYPE_BITS);     // Ack
  w.writeUnsigned(0xdeadbeef, 32);
  return Buffer.from(w.bytes());
}
{
  const s = new Session('127.0.0.1', 9, { name: 't' });
  const seen = [];
  const changes = [];
  s.on('event', (ev) => seen.push({ type: ev.type, status: ev.status, value: ev.value }));
  s.on('level-change', (c) => changes.push(c));
  s.on('decode-error', (e) => seen.push({ type: 'decode-error', message: e.message }));
  s.on('unknown-event', (u) => seen.push({ type: 'unknown', id: u.id }));
  s._onData(statusPayload(2, '', '', 0), 1);            // end of round, no tail
  s._onData(statusPayload(5, '4711', 'bf1942', 1), 2); // the level is over
  results.status = { seen, changes, levelChange: s.levelChange };
  s.close();
  results.fromEvent = {
    full: reconnectFromGameStatus({ status: 5, extra: Buffer.from('0815\0', 'latin1'), text: 'DesertCombat' }),
    notFive: reconnectFromGameStatus({ status: 2 }),
    empty: reconnectFromGameStatus({ status: 5, extra: Buffer.alloc(5), text: 'bf1942' }),
  };
}

// --- classification -------------------------------------------------------------
results.classify = {
  levelChange: classifyDisconnect(0x19),
  kicked: classifyDisconnect(0x15),
  banned: classifyDisconnect(0x16),
  timeout: classifyDisconnect(0x0a),
  timeoutAfterStatus5: classifyDisconnect(0x0a, { levelChange: { password: '4711' } }),
  left: classifyDisconnect(0x0d),
  kickedAfterStatus5: classifyDisconnect(0x15, { levelChange: { password: '4711' } }),
};
results.final = Object.fromEntries([2, 4, 9, 0x11, 0x16, 0x17, 0x18, 0x1e].map((r) => [`0x${r.toString(16)}`, denialIsFinal(r)]));
results.constants = DISCONNECT;

// --- the state machine against a fake session and a fake clock -------------------
class FakeClock {
  constructor() { this.t = 0; this.q = []; this.seq = 0; }
  now() { return this.t; }
  set(fn, ms) { const h = { at: this.t + ms, fn, id: this.seq++ }; this.q.push(h); return h; }
  clear(h) { if (h) this.q = this.q.filter((x) => x !== h); }
  async run(untilMs) {
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const h = this.q[0];
      if (!h || h.at > untilMs) break;
      this.q.shift();
      this.t = h.at;
      h.fn();
      await new Promise((r) => setImmediate(r)); // let the async probe settle
    }
    this.t = Math.max(this.t, untilMs);
  }
}

class FakeSession extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.closed = false; }
  close() { this.closed = true; }
}

// script: per attempt, what the server does: 'join' | 'full' | 'badpw' |
// 'silent' | 'banned-drop'. probeUpAfterMs: when the server answers probes.
async function scenario({ start, script = [], probeUpAfterMs = 0, horizonMs = 600000, runMs = 700000 }) {
  const clock = new FakeClock();
  const log = [];
  const sessions = [];
  let attempt = 0;
  const r = new Rejoiner({
    timers: { now: () => clock.now(), set: (fn, ms) => clock.set(fn, ms), clear: (h) => clock.clear(h) },
    horizonMs,
    probe: async () => clock.now() >= probeUpAfterMs,
    connect: (opts) => {
      const s = new FakeSession(opts);
      sessions.push(s);
      const what = script[attempt++] ?? 'join';
      // The server's answer arrives a little later, on the fake clock.
      clock.set(() => {
        if (what === 'join') { s.emit('connected', { id: 1 }); clock.set(() => s.emit('joined', { playerId: 3 }), 500); }
        if (what === 'full') s.emit('denied', { reason: 2, name: 'PRServerIsFull' });
        if (what === 'badpw') s.emit('denied', { reason: 0x11, name: 'PRInvalidPassword' });
        if (what === 'banned-drop') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: 0x16, name: 'Banned' }); }
        // 'silent': no answer at all; the connect timeout fires
      }, 50);
      return s;
    },
  });
  for (const ev of ['probe', 'attempt', 'retry', 'rejoined', 'give-up']) {
    r.on(ev, (x) => log.push({ ev, t: clock.now(), ...JSON.parse(JSON.stringify({ ...x, info: undefined })) }));
  }
  const started = r.start(start);
  await clock.run(runMs);
  return {
    started, state: r.state, log,
    sessions: sessions.map((s) => ({ key: s.opts.reconnectPassword, team: s.opts.team, closed: s.closed })),
    probeTimes: log.filter((x) => x.ev === 'probe').map((x) => x.t),
  };
}

results.machine = {
  // A level change on a slow server: bf42++'s pinger (1 s, then every 2 s)
  // until it answers at 40 s, then one attempt with the digits and the old
  // side gets back on.
  slow: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 2 }, probeUpAfterMs: 40000 }),
  // The server is up but refuses twice as full, then lets us in.
  full: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 1 }, script: ['full', 'full', 'join'] }),
  // A wrong server password is final.
  badpw: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 1 }, script: ['badpw'] }),
  // Kicked: no probe, no attempt.
  kicked: await scenario({ start: { kind: 'kicked', reason: 0x15, password: '', team: 1 } }),
  // The same wait with the retail pinger (a server that said UI&nfr to a
  // bf42++ client keeps the 2 s interval; a retail client probes every 3 s).
  retail: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 2, timing: { firstProbeMs: 16000, probeMs: 3000 } }, probeUpAfterMs: 40000 }),
  nfr: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 2, timing: { firstProbeMs: 16000, probeMs: 2000 } }, probeUpAfterMs: 20000 }),
  // The server never comes back: give up at the horizon.
  never: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 1 }, probeUpAfterMs: Infinity, horizonMs: 120000, runMs: 200000 }),
  // The first attempt hears nothing (the connect timeout), the second joins.
  silent: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 1 }, script: ['silent', 'join'] }),
  // Accepted, then banned before the join completed: final.
  banned: await scenario({ start: { kind: 'level-change', reason: 0x19, password: '4711', team: 1 }, script: ['banned-drop'] }),
  // A plain drop (no GameStatus 5): rejoins without a key.
  drop: await scenario({ start: { kind: 'drop', reason: 0x0a, password: '4711', team: 2 } }),
};

// --- the probe against a real socket ---------------------------------------------
{
  const server = dgram.createSocket('udp4');
  const got = [];
  server.on('message', (msg, rinfo) => {
    got.push(hex(msg));
    // sendServerInfo 0x08436280: 0x88 bytes, [0] 1, type 0xa, [8..] the name.
    const b = Buffer.alloc(0x88);
    b[0] = 1;
    b[2] = PT.ServerInfo << 4;
    b.write('lab server', 8, 'latin1');
    server.send(b, rinfo.port, rinfo.address);
  });
  await new Promise((res) => server.bind(0, '127.0.0.1', res));
  const up = await probeServerInfo('127.0.0.1', server.address().port, { timeoutMs: 1000 });
  server.close();
  // Nobody listening: no answer, and null within the timeout.
  const quiet = dgram.createSocket('udp4');
  await new Promise((res) => quiet.bind(0, '127.0.0.1', res));
  const port = quiet.address().port;
  quiet.close();
  const t = Date.now();
  const down = await probeServerInfo('127.0.0.1', port, { timeoutMs: 300 });
  results.probe = { up, requests: got, down, downMs: Date.now() - t };
}

process.stdout.write(JSON.stringify(results));
