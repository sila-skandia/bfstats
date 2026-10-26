// Writes core/src/commonTest/resources/parity/rejoin.json from the Node sidecar's
// rejoin.mjs: the disconnect classification, the kick-notice reader, the
// retail boxes and denials, the GameStatus 5 reader, and the Rejoiner state
// machine over the rejoin harness's scenarios (a fake session and a fake
// clock; every event with its time). RejoinTest.kt replays them.
//   node parity/rejoin.mjs
import { EventEmitter } from 'node:events';
import { sidecar, write } from './lib/fixture.mjs';

const R = await sidecar('rejoin.mjs');
const out = {};

const lc = { password: '4711' };
out.classify = [
  [0x19], [0x15], [0x16], [0x0a], [0x0a, { levelChange: lc }], [0x0d], [0x15, { levelChange: lc }], [0x1c], [null],
  [0x0a, { kickNotice: { banned: false } }], [0x0a, { kickNotice: { banned: true } }], [0x19, { kickNotice: { banned: false } }],
  [0x0d, { levelChange: lc, kickNotice: { banned: true } }], [0x16, { kickNotice: { banned: false } }], [-1],
].map(([reason, o]) => ({ reason, levelChange: !!o?.levelChange, kickNotice: o?.kickNotice ?? null, out: R.classifyDisconnect(reason, o) }));
// levelChange is truthy-tested: these are not a level change, 'x' and {} are.
out.classifyTruthy = [0, '', false, null, NaN, 'x', {}, 1].map((v) => ({ levelChange: Number.isNaN(v) ? 'NaN' : v, out: R.classifyDisconnect(0x0a, { levelChange: v }) }));
out.rejoinable = ['kicked', 'banned', 'closed', 'drop', 'level-change', 'horizon', 'denied', ''].map((k) => [k, R.rejoinable(k)]);

const me = ['skandia-sc', 'skandia-sc_1'];
const notices = [
  ['Player skandia-sc_1 was kicked from the server.\n', me],
  ['*skandia-sc\u0080was\u0080banned\u0080for\u0080teamkilling', me],
  ['Player skandia was kicked from the server.', me],
  ['Player xskandia-sc was kicked from the server.', me],
  ['skandia-sc: stop teamkilling or you will be kicked', me],
  ['*This\u0080server\u0080is\u0080managed\u0080by\u0080BFSM\u00802.0', me],
  ['***SKANDIA-SC was KICKED\tfor idling  ', me],
  ['skandia-sc kicked', [' skandia-sc ']],
  ['skandia-sc kickedx', me],
  ['skandia-sc_kicked', me],
  ['skandia-sc banning now', me],
  ['skandia-sc was kicked (warning 3)', me],
  ['skandia-sc was kicked', ['', '   ', null, 7]],
  ['skandia-sc was kicked', []],
  ['', me],
  ['kicked: skandia-sc.', me],
  ['kicked: skandia-sc-2', me],
  ['banned skandia-sc, then unbanned', me],
  ['Kicking skandia-sc for ping', me],
  ['skandia-sc was kickedwill', me],
  ['skandia-sc was kicked (warning 3/3)', me],
  ['skandia-sc kicked for teamkilling (warning 3)', me],
  ['*skandia-sc\u0080was\u0080kicked\u0080(warning\u00803)', me],
  ['Warning: skandia-sc, stop teamkilling or be kicked', me],
  ['WARNING skandia-sc will be banned', me],
  ['skandia-sc was warned for teamkilling, next is kicked', me],
  ['skandia-sc warns: kicked players stay out', me],
  ['skandia-sc, you\'ll be kicked for idling', me],
  ['skandia-sc gets kicked next', me],
  ['skandia-sc has been kicked. Others will be kicked too', me],
  ['Kicking skandia-sc (warning)', me],
  ['skandia-sc kicked (warningx)', me],
];
out.notice = notices.map(([text, names]) => ({ text, names, out: R.kickNoticeFor(text, names) }));
out.noticeNotString = R.kickNoticeFor(null, me);

out.describe = [
  { kind: 'kicked', reason: 0x15, name: 'Kicked', message: 'Kicked for teamkilling' },
  { kind: 'kicked', reason: 0x15, name: 'Kicked' },
  { kind: 'banned', reason: 0x0a, name: 'PRTimeOut', notice: { banned: true, text: 'skandia-sc was banned for teamkilling' } },
  { kind: 'closed', reason: 0x0d, name: 'PRDisconnect', message: 'Idle too long' },
  { kind: 'drop', reason: 0x0a, name: 'PRTimeOut' },
  { kind: 'level-change', reason: 0x19, name: 'LevelChange' },
  { kind: 'horizon' },
  { kind: 'banned', reason: 0x1b, message: 'bad data' },
  { kind: 'mystery', reason: 0x0d },
  { kind: 'mystery' },
].map((a) => ({ in: a, out: R.describeDisconnect(a) }));
out.box = [0x0a, 0x0d, 0x13, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x1b, 0x42, null].flatMap((r) => [
  { reason: r, message: '', out: R.retailDisconnectBox(r, '') },
  { reason: r, message: 'Kicked for teamkilling', out: R.retailDisconnectBox(r, 'Kicked for teamkilling') },
]);
out.denial = [0x02, 0x11, 0x16, 0x17, 0x18, 0x1e, 0x04, null].flatMap((r) => [
  { reason: r, retry: false, out: R.retailDenial(r) }, { reason: r, retry: true, out: R.retailDenial(r, { retry: true }) },
]);
out.denialText = R.DENIAL_TEXT;
out.titles = R.DISCONNECT_TITLE;
out.final = [2, 4, 9, 0x11, 0x16, 0x17, 0x18, 0x1e, null].map((r) => [r, R.denialIsFinal(r)]);
out.constants = R.DISCONNECT;
out.fromEvent = [
  { status: 5, extra: '0815\u0000', text: 'DesertCombat' }, { status: 2 }, { status: 5, extra: '\0\0\0\0\0', text: 'bf1942' },
  { status: 5, extra: '123456' }, { status: 5, extra: '12\u00003' }, { status: 5, extra: '' }, { status: 5, text: 'x' },
].map((e) => ({ in: e, out: R.reconnectFromGameStatus(e.extra == null ? e : { ...e, extra: Buffer.from(e.extra, 'latin1') }) }));

// --- the state machine (the rejoin harness's scenarios and a few more) ------------
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
  close() { this.closed = true; if (this.closeThrows) throw new Error('closed twice'); }
}
async function scenario(sc) {
  const { start, script = [], probeUpAfterMs = 0, horizonMs = 600000, runMs = 700000, options = {}, throwOn = [],
    probeThrows = false, probeDelayMs = 0, stopAtMs = [], closeThrows = false } = sc;
  const up = probeUpAfterMs == null ? Infinity : probeUpAfterMs;
  const clock = new FakeClock();
  const log = [];
  const sessions = [];
  let attempt = 0;
  const r = new R.Rejoiner({
    timers: { now: () => clock.now(), set: (fn, ms) => clock.set(fn, ms), clear: (h) => clock.clear(h) },
    horizonMs, ...options,
    probe: async () => {
      if (probeDelayMs) await new Promise((res) => clock.set(res, probeDelayMs));
      if (probeThrows) throw new Error('probe failed');
      return clock.now() >= up;
    },
    connect: (opts) => {
      if (throwOn.includes(attempt)) { attempt++; throw new Error('no socket'); }
      const s = new FakeSession(opts);
      s.closeThrows = closeThrows;
      sessions.push(s);
      const what = script[attempt++] ?? 'join';
      clock.set(() => {
        if (what === 'join') { s.emit('connected', { id: 1 }); clock.set(() => s.emit('joined', { playerId: 3 }), 500); }
        if (what === 'full') s.emit('denied', { reason: 2, name: 'PRServerIsFull' });
        if (what === 'badpw') s.emit('denied', { reason: 0x11, name: 'PRInvalidPassword' });
        if (what === 'version') s.emit('denied', { reason: 0x18, name: 'VersionTooNew' });
        if (what === 'banned-drop') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: 0x16, name: 'Banned' }); }
        if (what === 'closed-drop') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: 0x0d, name: 'PRDisconnect' }); }
        if (what === 'timeout-drop') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: 0x0a, name: 'PRTimeOut' }); }
        if (what === 'stall') s.emit('connected', { id: 1 });
        if (what === 'full-noname') s.emit('denied', { reason: 2 });
        if (what === 'denied-empty') s.emit('denied', {});
        if (what === 'denied-null') s.emit('denied', { name: null, reason: null });
        if (what === 'denied-none') s.emit('denied');
        if (what === 'drop-noname') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: 0x0a }); }
        if (what === 'drop-empty') { s.emit('connected', { id: 1 }); s.emit('disconnected'); }
        if (what === 'drop-null') { s.emit('connected', { id: 1 }); s.emit('disconnected', { reason: null }); }
        if (what === 'late') {
          // Nothing until the connect timeout has moved on to the next try,
          // then every event at once from the abandoned session.
          clock.set(() => {
            s.emit('connected', { id: 1 }); s.emit('denied', { reason: 0x11, name: 'PRInvalidPassword' });
            s.emit('disconnected', { reason: 0x16, name: 'Banned' }); s.emit('joined', { playerId: 9 });
          }, 10500);
        }
        // 'silent': no answer at all; the connect timeout fires
      }, 50);
      return s;
    },
  });
  for (const ev of ['probe', 'attempt', 'retry', 'rejoined', 'give-up']) {
    r.on(ev, (x) => log.push({ ev, t: clock.now(), ...JSON.parse(JSON.stringify({ ...x, info: undefined })) }));
  }
  for (const at of stopAtMs) clock.set(() => { r.stop(); log.push({ ev: 'stopped', t: clock.now(), state: r.state }); }, at);
  const started = r.start(start);
  const again = r.start(start); // a second start while active is refused
  await clock.run(runMs);
  return {
    in: { ...sc, probeUpAfterMs: probeUpAfterMs ?? null },
    out: { started, again, state: r.state, log, sessions: sessions.map((s) => ({ key: s.opts.reconnectPassword, team: s.opts.team, closed: s.closed })) },
  };
}

const LC = (team = 1, extra = {}) => ({ kind: 'level-change', reason: 0x19, password: '4711', team, ...extra });
out.machine = {};
for (const [name, sc] of Object.entries({
  slow: { start: LC(2), probeUpAfterMs: 40000 },
  full: { start: LC(1), script: ['full', 'full', 'join'] },
  badpw: { start: LC(1), script: ['badpw'] },
  kicked: { start: { kind: 'kicked', reason: 0x15, password: '', team: 1 } },
  retail: { start: LC(2, { timing: { firstProbeMs: 16000, probeMs: 3000 } }), probeUpAfterMs: 40000 },
  nfr: { start: LC(2, { timing: { firstProbeMs: 16000, probeMs: 2000 } }), probeUpAfterMs: 20000 },
  never: { start: LC(1), probeUpAfterMs: null, horizonMs: 120000, runMs: 200000 },
  silent: { start: LC(1), script: ['silent', 'join'] },
  banned: { start: LC(1), script: ['banned-drop'] },
  closed: { start: { kind: 'closed', reason: 0x0d, password: '', team: 1 } },
  closedMidJoin: { start: LC(1), script: ['closed-drop'] },
  timeoutMidJoin: { start: LC(1), script: ['timeout-drop', 'join'] },
  drop: { start: { kind: 'drop', reason: 0x0a, password: '4711', team: 2 } },
  manyFull: { start: LC(0), script: Array(14).fill('full'), horizonMs: 90000, runMs: 200000 },
  stall: { start: LC(1), script: ['stall', 'join'], options: { joinTimeoutMs: 5000 } },
  version: { start: LC(1), script: ['version'] },
  threw: { start: LC(1), throwOn: [0] },
  backoff: { start: LC(1), script: ['silent', 'silent', 'silent', 'silent', 'join'], options: { backoff: 2.25, probeMaxMs: 9000, connectTimeoutMs: 3000 } },
  defaults: { start: {} },
  nullish: { start: { kind: 'level-change', reason: 0x19, password: null, team: null } },
  deniedNoName: { start: LC(1), script: ['full-noname', 'denied-empty', 'denied-null', 'denied-none', 'join'] },
  dropNoName: { start: LC(1), script: ['drop-noname', 'join'] },
  dropEmpty: { start: LC(1), script: ['drop-empty'] },
  dropNull: { start: LC(1), script: ['drop-null'] },
  late: { start: LC(1), script: ['late', 'join'] },
  probeThrows: { start: LC(1), probeThrows: true, horizonMs: 20000, runMs: 40000 },
  stopDuringProbe: { start: LC(1), probeDelayMs: 700, stopAtMs: [4300, 9000] },
  stopIdle: { start: { kind: 'kicked', reason: 0x15 }, stopAtMs: [100] },
  horizonOnRetry: { start: LC(1), script: ['silent'], horizonMs: 8000, runMs: 30000 },
  closeThrows: { start: LC(1), script: ['full', 'join'], closeThrows: true },
})) out.machine[name] = await scenario(sc);

write('rejoin', out);
