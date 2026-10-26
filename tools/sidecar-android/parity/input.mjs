// Writes core/src/test/resources/parity/input.json: input.mjs, recorded.
//
//   pure      encodeAxis / decodeAxis over their range, buttonMask, the input
//             shapes (encodeAction, actionFor, isEncodedShape,
//             normaliseAction), inputPayload / decodeInputBlock, holdOf,
//             PageButtonEdges, actionIndexOf;
//   teams     sendTeam / sendKit / sendSpawnRequest / sendChat and
//             spawnSequence against a fake session, on the fake clock;
//   scripts   InputSender driven by op lists (lib/sender-ops below): the
//             scenarios of tests/sidecar_input_harness.mjs (the burst, the
//             slots, the slot law, atAck on a held clock, the internet path,
//             the merge), idle modes, joins, send failures, press/release;
//   sims      InputSender against the page's real clock law (viewer/
//             input-pace.js and fixed-step.js, as tests/input_tick_harness.mjs
//             drives them) and a server that reads, trims to four, runs one a
//             tick and acks at 20 Hz, for each pacing law ('server', 'bucket',
//             'slot') at several frame rates, stalls and internet round trips.
//             Each sim records its ops (every page word and ack at its
//             instant), so the Kotlin test replays the same ops into the port
//             and requires the same datagrams, events and returns at the same
//             instants; the log is stored as its first entries plus a sha-256
//             per 64 entries.
//
// Date.now, performance.now and the timers are lib/fake-time.mjs's, which
// core's ManualScheduler matches.
//   node parity/input.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as I from '../../bf1942-models/sidecar/input.mjs';
import { installFakeTime, rng, plain } from './lib/fake-time.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const try_ = (fn) => { try { return { ok: plain(fn()) }; } catch (e) { return { error: e.message }; } };
const rand = rng(30);
const int = (n) => Math.floor(rand() * n);
const pick = (a) => a[int(a.length)];
const C = I.AXIS_CENTRE;

// --- pure --------------------------------------------------------------------
const pure = {};
{
  const vs = [];
  for (let v = -20; v <= 20; v += 0.03125) vs.push(v);
  for (let i = 0; i < 300; i++) vs.push((rand() * 2 - 1) * 20);
  vs.push(0.5, -0.5, 16, -16, 1e300, -1e300, 1 / 3);
  pure.encodeAxis = vs.map((v) => [v, I.encodeAxis(v)]);
  pure.encodeAxisOdd = [null, true, false, '3', '', ' 2 ', '0x10', 'x', [], [5]].map((v) => [v, I.encodeAxis(v)]);
  pure.decodeAxis = Array.from({ length: 4096 }, (_, n) => I.decodeAxis(n));
  const specs = [null, 0, 5, -1, 2 ** 32 + 3, 1.9, 'FIRE', 'fire|crouch', 'alt_fire, reload', 'altFire', 'ALTFIRE', ' Toggle-Camera-Mode ',
    'menu9', 'ch33', '', '  ', 'nope', ['FIRE', 'LIE'], [1, 'use', 2 ** 31], [], { fire: true, crouch: 1, lie: 0, run: '' }, { bogus: false },
    { bogus: true }, true, 'mouse look', 'MouseLook', 'TOGGLECAMERA', 'ß'];
  pure.buttonMask = specs.map((s) => [s, try_(() => I.buttonMask(s))]);
  const inputs = [
    {}, { forward: true }, { back: true, left: true, lookX: 2.5, lookY: -1 }, { forward: 1, back: 1, right: 'y' },
    { pitchUp: true, rollLeft: true, fire: true, altFire: 1, use: 1, reload: 1, drop: 1, walk: 1, run: 1, crouch: 1, lie: 1, action: 1 },
    { menu1: true, menu5: 1, menu9: true, buttons: 'reload' }, { lookX: '3', lookY: 0 }, { lookX: 40 }, { lookX: -0.0001 },
    { buttons: 2 ** 31 }, { buttons: ['FIRE', 2 ** 31] }, { mask: 'crouch' }, { buttons: 0, mask: 'crouch' },
    { axes: [C, C, C, C, 2100, C], buttons: 1 }, { axes: [C, C, C, C, 2100, C] }, { axes: [C, C, C, C, 2100.5, C], buttons: 1 },
    { axes: [0, 4095, 1, 2, 3, 4], mask: 'fire' }, { axes: [1, 2, 3, 4, 5] }, { axes: [1, 2, 3, 4, 5, 6, 7] }, { axes: [-1, 0, 0, 0, 0, 4096] },
    { axes: [0.5, null, 2], buttons: 'fire' }, { axes: { yaw: 1, PITCH: -1, mouseLookX: 3, roll: null } }, { axes: { THROTTLE: 1, throttle: null } },
    { channels: [1, -1, 0.5, 0, 2, -2] }, { channels: [1] }, { yaw: 1, throttle: -1, mouseLookY: 0.25 }, { roll: 16, buttons: { fire: true } },
    { axes: [C, C, C, C, C, C], yaw: 1 }, { buttons: 'bogus' }, { forward: true, buttons: 'bogus' },
  ];
  pure.shapes = inputs.map((x) => ({ input: x, encoded: I.isEncodedShape(x), encodeAction: try_(() => I.encodeAction(x)),
    actionFor: try_(() => I.actionFor(x)), normaliseAction: try_(() => I.normaliseAction(x)) }));
  pure.payload = [];
  for (let k = 0; k < 40; k++) {
    const n = k < 4 ? k : int(5);
    const actions = Array.from({ length: n }, () => ({ axes: Array.from({ length: 6 }, () => pick([C, int(4096), 0, 4095])), buttons: pick([0, int(2 ** 26), 2 ** 31 + 5]) }));
    const first = pick([1, int(I.SERIAL_MAX), I.SERIAL_MAX, 7]);
    const mask = pick([I.STREAM_INPUT, 3, 63]);
    const res = try_(() => Buffer.from(I.inputPayload(actions, first, mask)).toString('hex'));
    pure.payload.push({ actions, first, mask, ...res, decoded: res.ok ? plain(I.decodeInputBlock(Buffer.from(res.ok, 'hex'))) : null });
  }
  pure.holdOf = Array.from({ length: 20 }, () => {
    const a = { axes: Array.from({ length: 6 }, () => int(4096)), buttons: int(2 ** 26) };
    return { action: a, held: plain(I.holdOf(a)) };
  });
  const edges = new I.PageButtonEdges();
  const B = I.BUTTON;
  const seq = [B.LIE | B.FIRE, B.LIE | B.FIRE | B.ACTION, B.LIE | B.FIRE | B.ACTION, B.LIE | B.ACTION | B.RELOAD, B.LIE | B.RELOAD, 0, 0, B.RELOAD,
    B.MENU3, B.MENU3 | B.CROUCH, B.TOGGLE_CAMERA, 0, B.LIE, B.LIE, 0, 2 ** 31, -1];
  for (let i = 0; i < 60; i++) seq.push(int(2 ** 26) & (rand() < 0.5 ? (B.LIE | B.ACTION | B.RELOAD | B.FIRE | B.CROUCH) : 0xffffffff));
  pure.edges = seq.map((x, i) => { const extra = i % 7 === 3 ? B.USE : 0; const out = edges.apply(x, extra); if (i === 40) edges.reset(); return [x, extra, out]; });
  pure.actionIndexOf = [5, 0, -3, 2.5, null, '7', 1e20, NaN].map((v) => [v, I.actionIndexOf(v)]);
  pure.constants = { ONE_SHOT_BUTTONS: I.ONE_SHOT_BUTTONS, TOGGLE_STATE_BUTTONS: I.TOGGLE_STATE_BUTTONS, BUTTON: I.BUTTON, BUTTON_CHANNEL: I.BUTTON_CHANNEL,
    AXIS: I.AXIS, AXIS_NAMES: I.AXIS_NAMES, SERIAL_MAX: I.SERIAL_MAX, DEFAULT_SERIAL: I.DEFAULT_SERIAL, TICK_RATE: I.TICK_RATE, AXIS_FULL: I.AXIS_FULL,
    ACTION_BITS: I.ACTION_BITS, MAX_ACTIONS_PER_PACKET: I.MAX_ACTIONS_PER_PACKET, SPAWN_GROUP_MAX: I.SPAWN_GROUP_MAX, TEAMS: I.TEAMS };
}

// --- teams -------------------------------------------------------------------
function fakeSession(me, log, time) {
  return {
    me,
    queue: (name, body) => log.push(['queue', time.now, name, body]),
    chatOut: { say: (text, o) => { log.push(['say', time.now, text, o.team]); return text.length > 0 && text.length < 20; } },
  };
}
const teams = [];
{
  const time = installFakeTime(0);
  const cases = [
    { me: { playerId: 3, team: 1 }, calls: [['team', 2], ['team', 1, 9], ['team', 258], ['kit', 3], ['kit', 256], ['kit', -1], ['spawn', 3, 2], ['spawn', 128, 0], ['spawn', 0, 300], ['chat', 'hi', true], ['chat', '', false], ['chat', 'x'.repeat(30), 1]] },
    { me: { playerId: null, team: 0 }, calls: [['team', 2], ['kit', 1], ['spawn', 1, 1], ['chat', 'hi', false]] },
    { me: null, calls: [['team', 1]] },
  ];
  for (const c of cases) {
    const log = [];
    const s = fakeSession(c.me, log, time);
    for (const call of c.calls) {
      const r = try_(() => {
        if (call[0] === 'team') return call.length > 2 ? I.sendTeam(s, call[1], call[2]) : I.sendTeam(s, call[1]);
        if (call[0] === 'kit') return I.sendKit(s, call[1]);
        if (call[0] === 'spawn') return I.sendSpawnRequest(s, call[1], call[2]);
        return I.sendChat(s, call[1], { team: call[2] });
      });
      log.push(['ret', call, r]);
    }
    teams.push({ me: c.me, calls: c.calls, log });
  }
  // spawnSequence on the fake clock.
  const seqs = [
    [{ playerId: 3, team: 1 }, { team: 2, kit: 1, spawnGroup: 3 }],
    [{ playerId: 3, team: 2 }, { team: 2, kit: 4, spawnGroup: 5, spawnPoint: 9 }],
    [{ playerId: 3, team: 1 }, { spawnGroup: 64, spawnPoint: 2 }],
    [{ playerId: 3, team: 1 }, { team: 2, kit: 2, spawnGroup: 3, stepMs: 0 }],
    [{ playerId: 3, team: 1 }, { team: 2, kit: 2, spawnGroup: 200, stepMs: 40 }],
    [{ playerId: 3, team: 1 }, { team: 2, kit: 300, spawnGroup: 3, stepMs: 40 }],
    [{ playerId: null, team: 1 }, { team: 2 }],
  ];
  const seqOut = [];
  for (const [me, opts] of seqs) {
    const log = [];
    const s = fakeSession(me, log, time);
    const start = time.now;
    let settled = null;
    I.spawnSequence(s, opts).then((v) => { settled = { ok: v, at: time.now - start }; }, (e) => { settled = { error: e.message, at: time.now - start }; });
    // Each step's continuation runs as a microtask after the timer that
    // resolves its delay: flushed before the clock moves on.
    for (let t = 0; t <= 500; t += 10) { time.advanceTo(start + t); for (let k = 0; k < 8; k++) await Promise.resolve(); }
    seqOut.push({ me, opts, log: log.map(([k, at, ...rest]) => [k, at - start, ...rest]), settled });
    if (s.me) s.me.team = s.me.team; // unchanged
  }
  teams.push({ spawnSequence: seqOut });
  time.restore();
}

// --- the sender's op driver ----------------------------------------------------
// One InputSender, driven by ops, recording every datagram, event and return.
// The Kotlin test has the same driver (InputTest.Driver); both must read the
// ops alike, so the ops are data: [name, ...args].
function canon(v) {
  if (v instanceof Error) return { error: v.message };
  return plain(v);
}
function makeDriver(time) {
  const log = [];
  let sender = null, sess = null, customClock = 0, failNext = 0, failEvery = 0, calls = 0, idleCalls = 0;
  const ops = [];
  function apply(op) {
    ops.push(op);
    const [name, ...a] = op;
    const i = ops.length - 1;
    const ret = (v) => log.push(['ret', name, canon(v)]);
    try {
      switch (name) {
        case 'at': time.advanceTo(a[0]); return;
        case 'new': {
          const o = a[0];
          sess = { joined: o.joined ?? true, conn: { state: o.state ?? 'connected', sendData: (payload, meta) => {
            calls++;
            if (failNext > 0 || (failEvery && calls % failEvery === 0)) { if (failNext > 0) failNext--; throw new Error('send window full'); }
            log.push(['send', time.now, Buffer.from(payload).toString('hex'), meta.input, calls]);
            return calls;
          } } };
          failEvery = o.failEvery ?? 0;
          const opts = {};
          for (const k of ['rate', 'idle', 'pace', 'firstSerial', 'maxQueue', 'idleAfterMs']) if (o[k] !== undefined) opts[k] = o[k];
          if (o.mergeAbove !== undefined) opts.mergeAbove = o.mergeAbove === 'Infinity' ? Infinity : o.mergeAbove;
          if (o.clock === 'custom') opts.clock = () => customClock;
          if (o.idleEvery) opts.idleButtons = () => (idleCalls++ % o.idleEvery === 1 ? I.BUTTON.ACTION | I.BUTTON.FIRE : 0);
          sender = new I.InputSender(sess, opts);
          for (const ev of ['sent', 'merged', 'started', 'stopped', 'error']) sender.on(ev, (p) => log.push(['emit', time.now, ev, canon(p)]));
          return;
        }
        case 'enq': return ret(sender.enqueue(a[0], a[1]));
        case 'enqz': return ret(sender.enqueue({ ...I.ZERO_ACTION, axes: I.ZERO_ACTION.axes.slice(), buttons: 0 }, a[0]));
        case 'ack': return ret(sender.atAck(a[0], a[1]));
        case 'rtt': sender.noteRtt(a[0]); return;
        case 'start': sender.start(); return;
        case 'stop': sender.stop(); return;
        case 'set': return ret(sender.setInput(a[0]));
        case 'press': return ret(sender.press(a[0]));
        case 'release': return ret(sender.release(a[0]));
        case 'tick': a[0] === null ? sender._tick() : sender._tick(a[0]); return;
        case 'pump': sender._pump(); return;
        case 'poke': sender[a[0]] = a[1]; return;
        case 'sess': sess.joined = a[0]; sess.conn.state = a[1]; return;
        case 'fail': failNext = a[0]; return;
        case 'clock': customClock = a[0]; return;
        case 'state': log.push(['state', snapshot(sender)]); return;
        default: throw new Error(`op ${name}`);
      }
    } catch (e) { log.push(['throw', name, e.message]); }
  }
  return { apply, log, ops, get sender() { return sender; } };
}
function snapshot(s) {
  return plain({
    serial: s.serial, stats: s.stats, path: s.path, running: s.running, rtt: s.rttMs(), action: s.action,
    pending: s.pending.map((w) => ({ serial: w.serial, tag: w.tag, merged: w.merged ?? null, recvAt: w.recvAt, action: w.action })),
    recent: s.recent.map((w) => w.serial), released: s.released.slice(-6),
    tokens: s._tokens, tokensAt: s._tokensAt, releasedAt: s._releasedAt, nextAt: s._nextAt, lastInputAt: s._lastInputAt,
  });
}

const scripts = [];
function script(name, build) {
  const time = installFakeTime(0);
  const d = makeDriver(time);
  build(d.apply, d, time);
  d.apply(['state']);
  time.restore();
  scripts.push({ name, ops: d.ops, log: d.log });
}
const L = I.BUTTON.LIE, A = I.BUTTON.ACTION, F = I.BUTTON.FIRE, Cr = I.BUTTON.CROUCH, R = I.BUTTON.RELOAD;
const look = I.encodeAxis(3);
const W = (lx, buttons) => ({ axes: [C, C, C, C, lx, C], buttons });
const P = 1000 / 30;

// sidecar_input_harness.mjs: a slow frame's five words, then one a slot.
script('burst', (op) => {
  op(['at', 1000]);
  op(['new', { rate: 30, idle: 'hold', mergeAbove: 'Infinity' }]);
  for (let i = 1; i <= 5; i++) op(['enq', W(look, F | (i === 1 ? L : 0)), 100 + i]);
  op(['state']);
  // the harness's slots: from the release time, a period at a time, with Date.now frozen
  let slot = 1.8e12 + 1000;
  for (let k = 0; k < 6; k++) { slot += P; op(['tick', slot]); }
  for (let i = 6; i <= 7; i++) op(['enq', W(look, F), 100 + i]);
  for (let k = 0; k < 2; k++) { slot += P; op(['tick', slot]); }
  op(['tick', slot + P]); op(['tick', slot + 2 * P]);
  op(['poke', '_lastInputAt', 0]);
  op(['tick', null]); op(['tick', null]); op(['tick', null]);
});
script('slotLaw', (op) => {
  op(['at', 1000]);
  op(['new', { rate: 30, idle: 'hold', pace: 'slot', mergeAbove: 'Infinity' }]);
  for (let i = 1; i <= 5; i++) op(['enq', W(look, F), 200 + i]);
  let t = 1.8e12 + 1000;
  for (let k = 0; k < 6; k++) { t += P; op(['tick', t]); }
});
script('atAck', (op) => {
  op(['new', { rate: 30, idle: 'hold', clock: 'custom', firstSerial: 10 }]);
  op(['clock', 1000]); op(['enqz', 1]); op(['poke', '_tokens', 2]); op(['clock', 1033]); op(['enqz', 1]); op(['poke', '_tokens', 2]);
  op(['clock', 1050]); op(['ack', 10, 100]);
  op(['clock', 1060]); op(['enqz', 1]); op(['poke', '_tokens', 2]);
  op(['clock', 1061]); op(['ack', 11, 103]);
  op(['clock', 1100]); op(['ack', 12, 104]);
  op(['ack', 12, null]); op(['ack', 13, 0]); op(['ack', 9, 110]); op(['ack', 14, 108]);
});
script('internet', (op) => {
  op(['new', { rate: 30, idle: 'hold', clock: 'custom', firstSerial: 10 }]);
  op(['clock', 1000]);
  op(['rtt', 185]); op(['rtt', 170]); op(['rtt', 176]); op(['rtt', -1]); op(['rtt', 6000]); op(['rtt', NaN]);
  op(['enqz', 1]); op(['poke', '_tokens', 2]);
  for (let i = 1; i <= 5; i++) { op(['clock', 1000 + 33 * i]); op(['enqz', 1]); op(['poke', '_tokens', 2]); }
  op(['clock', 1180]); op(['ack', 10, 100]);
  for (let i = 0; i < 10; i++) op(['rtt', 100 + i]);
});
script('merge', (op) => {
  op(['new', { rate: 30, idle: 'hold', firstSerial: 50, mergeAbove: 3, joined: false }]);
  const E = (lx, buttons, tag) => op(['enq', { axes: [C, C, C, I.encodeAxis(1), I.encodeAxis(lx), C], buttons }, tag]);
  E(1, R | L, 301); E(2, L, 302); E(-0.5, Cr, 303); E(0.25, 0, 304);
  op(['state']);
  for (let i = 0; i < 30; i++) E(pick([16, -16, 3, -2.5, 0]), pick([0, R, L, Cr | F, A]), 400 + i);
  op(['sess', true, 'connected']);
  op(['at', 10]); op(['start']);
  for (let t = 20; t < 1500; t += 7) op(['at', t]);
});
script('maxQueue', (op) => {
  op(['new', { maxQueue: 5, mergeAbove: 'Infinity', joined: false }]);
  for (let i = 0; i < 9; i++) op(['enq', { forward: true, lookX: i }, i]);
  op(['enq', null, 'null']);
  op(['state']);
});
for (const idle of ['zero', 'hold', 'stop']) {
  script(`idle-${idle}`, (op) => {
    op(['at', 5]);
    op(['new', { idle, idleEvery: idle === 'zero' ? 3 : 0, idleAfterMs: 120 }]);
    op(['start']); op(['start']);
    op(['set', { forward: true, fire: true, reload: true, lookX: 2 }]);
    for (let t = 10; t < 400; t += 9) op(['at', t]);
    op(['press', 'crouch|lie']);
    for (let t = 400; t < 800; t += 13) op(['at', t]);
    op(['release', ['lie']]);
    op(['set', null]);
    for (let t = 800; t < 1100; t += 17) op(['at', t]);
    op(['stop']); op(['stop']);
    op(['at', 1300]);
  });
}
script('failures', (op) => {
  op(['new', { failEvery: 4 }]);
  op(['start']);
  for (let t = 0; t < 600; t += 5) { op(['at', t]); if (t % 30 === 0) op(['enqz', t]); if (t === 300) op(['fail', 3]); }
});
script('joinLate', (op) => {
  op(['new', { joined: false, state: 'connecting' }]);
  op(['start']);
  for (let t = 0; t < 400; t += 5) { op(['at', t]); if (t % 20 === 0) op(['enqz', t]); }
  op(['sess', false, 'connected']);
  for (let t = 400; t < 500; t += 5) op(['at', t]);
  op(['sess', true, 'connected']);
  for (let t = 500; t < 1200; t += 5) { op(['at', t]); if (t % 40 === 0) op(['enqz', t]); }
  op(['sess', true, 'closed']);
  for (let t = 1200; t < 1400; t += 5) { op(['at', t]); if (t % 40 === 0) op(['enqz', t]); }
});
script('fallBehind', (op) => {
  op(['new', { rate: 60 }]);
  op(['start']);
  op(['at', 100]);
  op(['poke', '_nextAt', 1.8e12 - 1000]);
  op(['pump']);
  op(['at', 2000]);
  op(['enqz', 1]);
  op(['at', 2400]);
});
script('badOptions', (op) => {
  op(['new', { rate: 0 }]); op(['new', { rate: 61 }]); op(['new', { rate: 'x' }]); op(['new', { idle: 'sleep' }]);
  op(['new', { rate: '45', pace: 'bucket' }]); op(['start']);
  for (let t = 0; t < 300; t += 3) { op(['at', t]); if (t % 11 === 0) op(['enq', { lookX: (t % 7) - 3, fire: t % 2 }, t]); }
});

// --- sims --------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'input-parity-'));
fs.copyFileSync(path.join(here, '../../bf1942-models/viewer/input-pace.js'), path.join(tmp, 'input-pace.mjs'));
fs.copyFileSync(path.join(here, '../../bf1942-models/viewer/fixed-step.js'), path.join(tmp, 'fixed-step.mjs'));
const { createInputPacer, feedFrame } = await import(pathToFileURL(path.join(tmp, 'input-pace.mjs')).href);
const { FixedStep } = await import(pathToFileURL(path.join(tmp, 'fixed-step.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

function simulate(o0) {
  const o = { fps: 60, jitter: 2, gaps: 0, gapMin: 60, gapMax: 180, stallMs: 0, stallEvery: 4000, seconds: 6, seed: 1, phase: 13,
    compute: 2, owd: 0, pace: 'server', quietFrom: Infinity, quietTo: Infinity, ...o0 };
  const rand = rng(o.seed);
  const time = installFakeTime(0);
  const d = makeDriver(time);
  const op = d.apply;
  let vt = 0;
  op(['new', { rate: 30, idle: 'zero', pace: o.pace, mergeAbove: o.pace === 'slot' ? 'Infinity' : o.pace === 'bucket' ? 3 : undefined, idleEvery: o.idleEvery }]);
  if (o.owd) op(['rtt', 2 * o.owd]);
  op(['start']);
  const wire = [];
  const toSidecar = [];
  const tags = new Map();
  d.log.push = ((push) => function (e) {
    if (e[0] === 'emit' && e[2] === 'sent') { const p = e[3]; wire.push({ serial: p.serial, at: vt, tag: p.tag, idle: p.idle }); if (!p.idle) tags.set(p.serial, p.tag); }
    return push.call(this, e);
  })(d.log.push);
  const pacer = createInputPacer();
  const clock = new FixedStep({ rate: 30 });
  let feed = null, scale = 1, seq = 0;
  const rows = [];
  let rowN = 0;
  const inbox = [];
  const buffer = [];
  let lastSerial = 0, lastRunSerial = 0, tick = 0, nextTick = o.phase, sinceAck = 0;
  let nextFrame = 0, lastFrame = 0, nextStall = o.stallMs ? o.stallEvery : Infinity;
  const end = o.seconds * 1000;
  while (vt < end) {
    op(['at', vt]);
    while (toSidecar.length && toSidecar[0].at <= vt) {
      const b = toSidecar.shift();
      const before = d.log.length;
      op(['ack', b.serial, b.tick]);
      const a = d.log[before][2];
      inbox.push({ at: vt + 0.5, row: { n: ++rowN, seq: tags.get(b.serial) ?? null, iq: a.iq, sq: a.sq, st: a.starved, ld: a.lead } });
    }
    if (vt >= nextTick) {
      const readAt = nextTick - o.compute;
      while (wire.length && wire[0].at + o.owd <= readAt) {
        const w = wire.shift();
        if (w.serial > lastSerial) { buffer.push(w); lastSerial = w.serial; }
      }
      while (buffer.length > 4) buffer.shift();
      tick++;
      if (buffer.length) lastRunSerial = buffer.shift().serial;
      sinceAck++;
      if (sinceAck >= (tick % 3 === 0 ? 1 : 2)) { sinceAck = 0; toSidecar.push({ at: nextTick + o.compute + o.owd, serial: lastRunSerial, tick }); }
      nextTick += P;
    }
    if (vt >= nextFrame) {
      while (inbox.length && inbox[0].at <= vt) { rows.push(inbox.shift().row); if (rows.length > 64) rows.shift(); }
      const wallMs = vt - lastFrame;
      lastFrame = vt;
      const dt = Math.min(wallMs / 1000, 0.1);
      const f = feedFrame(dt, feed);
      const n = clock.advance(f.fed * scale);
      const quiet = vt >= o.quietFrom && vt < o.quietTo;
      for (let i = 0; i < n; i++) {
        const s = ++seq;
        if (!quiet) op(['enqz', s]);
        pacer.noteWord(s, (clock.accumulator + (n - 1 - i) * clock.dt) * 1000);
      }
      scale = pacer.update({ rows, now: vt, frameMs: dt * 1000, wallMs, hitch: f.hitch });
      feed = pacer.feed();
      let len = 1000 / o.fps + rand() * o.jitter;
      if (o.gaps && rand() < (o.gaps * len) / 1000) len = o.gapMin + rand() * (o.gapMax - o.gapMin);
      if (vt >= nextStall) { len = o.stallMs; nextStall += o.stallEvery; }
      nextFrame = vt + len;
    }
    vt += 0.25;
  }
  op(['state']);
  time.restore();
  // Compact: 'at' ops between other ops are kept (they fire the pump), but
  // runs of them are cut to the last before each other op and every 4 ms.
  return { ops: d.ops, log: d.log };
}
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const CHUNK = 64;
const sims = [];
for (const pace of ['server', 'bucket', 'slot']) {
  const runs = { fps60: { fps: 60, jitter: 4, seed: 60 }, fps20: { fps: 20, jitter: 8, seed: 20 }, fps9: { fps: 9, jitter: 8, seed: 9 },
    gappy: { fps: 45, jitter: 6, gaps: 1.5, seed: 5 }, stalls: { fps: 60, stallMs: 300, stallEvery: 2000, seed: 3 },
    owd115: { fps: 60, jitter: 4, seed: 115, owd: 115 }, quiet: { fps: 60, seed: 8, quietFrom: 2000, quietTo: 3000, idleEvery: 4 } };
  for (const [name, o] of Object.entries(runs)) {
    const { ops, log } = simulate({ ...o, pace });
    // The ops as stored: an 'at' only where it is followed by another op, or a
    // timer could fire before the next one (the Kotlin driver advances to
    // each op's instant anyway, so dropping an 'at' that nothing follows
    // until a later 'at' changes nothing: advanceTo is monotone).
    const kept = [];
    for (let i = 0; i < ops.length; i++) {
      if (ops[i][0] === 'at' && i + 1 < ops.length && ops[i + 1][0] === 'at') continue;
      kept.push(ops[i]);
    }
    sims.push({ name: `${pace}-${name}`, ops: kept, entries: log.length, head: log.slice(0, 40),
      chunks: Array.from({ length: Math.ceil(log.length / CHUNK) }, (_, k) => sha(log.slice(k * CHUNK, (k + 1) * CHUNK))) });
  }
}

const out = { pure, teams, scripts, sims, chunk: CHUNK };
fs.writeFileSync(new URL('../core/src/test/resources/parity/input.json', import.meta.url), JSON.stringify(out));
console.log(`${scripts.length} scripts, ${sims.length} sims; ${sims.map((s) => `${s.name} ${s.entries}`).join(', ')}`);
