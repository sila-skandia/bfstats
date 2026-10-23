// The page's world clock against a server's tick (`viewer/input-pace.js`),
// in a model of the whole path: a page whose frames jitter, its 1/30 s world
// clock at the pacer's rate (and its hitch drop, net-room.js), the sidecar's
// bucket (sidecar/input.mjs), and a server that reads at the start of each
// frame, runs one word a tick and trims above four (D-1..D-4), acking at
// 20 Hz with the row `atAck` writes. See test_input_pace.py.
import { createInputPacer, INPUT_PACE } from './input-pace.mjs';

const P = 1000 / 30;

function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

/**
 * opts: pace ('lead' | 'off'), seconds, fps, jitter (ms), stallMs,
 * stallEvery, standing (words already standing in the server's buffer at the
 * start, as a join or an old hitch leaves them), hitchDrop, seed.
 */
function simulate(opts) {
  const o = { pace: 'lead', seconds: 60, fps: 60, jitter: 4, stallMs: 0, stallEvery: 4000, standing: 0,
              hitchDrop: true, seed: 7, phase: 11, compute: 2, ...opts };
  const rand = rng(o.seed);
  const pacer = createInputPacer();
  const rows = [];
  let n = 0;
  // The server.
  const buffer = [];           // words read, not run: { serial, recvAt }
  const wire = [];             // released, not yet read: { serial, recvAt, relAt }
  let nextTick = o.phase, tick = 0, lastRun = 0, ackTick = 0, ackSerial = 0, ticksSinceBlock = 0;
  // The sidecar.
  const held = [];
  let tokens = 2, tokensAt = 0;
  let serial = 0;
  for (let i = 0; i < o.standing; i++) buffer.push({ serial: ++serial, recvAt: -1000 });
  lastRun = 0;
  // The page.
  let t = 0, acc = 0, scale = 1, frameEma = 1000 / o.fps, nextStall = o.stallMs ? o.stallEvery : Infinity;
  const stats = { waits: [], backlog: [], starved: 0, starvedOutside: 0, ticks: 0, scales: [], stalls: [], recover: [] };
  const stallWindows = [];
  const release = (at) => {
    if (at > tokensAt) { tokens = Math.min(2, tokens + (at - tokensAt) / P); tokensAt = at; }
    while (held.length && tokens >= 1 - 1e-9) { tokens -= 1; wire.push({ ...held.shift(), relAt: at }); }
  };
  const serverUntil = (until) => {
    while (nextTick <= until) {
      const readAt = nextTick - o.compute;
      release(readAt);
      while (wire.length && wire[0].relAt <= readAt) buffer.push(wire.shift());
      tick++;
      stats.ticks++;
      if (buffer.length) { const w = buffer.shift(); lastRun = w.serial; w.ranAt = nextTick; stats.waits.push(nextTick - w.recvAt); }
      else {
        stats.starved++;
        if (!stallWindows.some(([a, b]) => nextTick >= a && nextTick <= b)) stats.starvedOutside++;
      }
      while (buffer.length > 4) buffer.shift();    // D-2
      ticksSinceBlock++;
      // A block at 20 Hz: after every 1.5 ticks on average (alternating 1, 2).
      if (ticksSinceBlock >= (tick % 3 === 0 ? 1 : 2)) {
        ticksSinceBlock = 0;
        const at = nextTick + o.compute;
        const iq = held.length;
        const sq = buffer.length + wire.filter((w) => w.relAt < at - 2).length;
        const dTick = tick - ackTick;
        const runCount = lastRun - ackSerial;
        const st = ackTick ? Math.max(0, dTick - runCount) : 0;
        const acked = runHistory.get(lastRun);
        rows.push({ n: ++n, iq, sq, st, ld: acked != null ? at - acked : null, at });
        if (rows.length > 64) rows.shift();
        stats.backlog.push({ at, b: iq + sq });
        ackTick = tick; ackSerial = lastRun;
      }
      nextTick += P;
    }
  };
  const runHistory = new Map();
  while (t < o.seconds * 1000) {
    let frame = 1000 / o.fps + rand() * o.jitter;
    if (t >= nextStall) { frame = o.stallMs; stats.stalls.push(t); stallWindows.push([t, t + o.stallMs + 250]); nextStall += o.stallEvery; }
    serverUntil(t + frame);
    t += frame;
    const dt = Math.min(frame, 100);
    if (dt < 100) frameEma += (dt - frameEma) * 0.05;
    acc += dt * scale;
    if (o.hitchDrop && o.pace === 'lead' && dt >= 100 && frameEma < 50 && acc >= 2 * P) acc = P + (acc % P);
    while (acc >= P) {
      acc -= P;
      const w = { serial: ++serial, recvAt: t + 0.5 };
      runHistory.set(w.serial, w.recvAt);
      held.push(w);
    }
    release(t + 0.5);
    if (o.pace === 'lead') scale = pacer.update({ rows: rows.filter((r) => r.at <= t), now: t, frameMs: dt });
    stats.scales.push(scale);
  }
  // Recovery after each stall: ms until the backlog is <= 1 for a second.
  for (const s of stats.stalls) {
    const end = s + o.stallMs;
    const after = stats.backlog.filter((x) => x.at >= end);
    let ok = null;
    for (let i = 0; i < after.length; i++) {
      if (after.slice(i).filter((x) => x.at < after[i].at + 1000).every((x) => x.b <= 1)) { ok = after[i].at - end; break; }
    }
    stats.recover.push(ok);
  }
  const settled = stats.backlog.filter((x) => x.at > 3000).map((x) => x.b);
  const waits = stats.waits.slice(90).sort((a, b) => a - b);
  return {
    backlogMean: settled.reduce((a, b) => a + b, 0) / settled.length,
    backlogMax: Math.max(...settled),
    backlogLastSecondMean: (() => { const l = stats.backlog.filter((x) => x.at > o.seconds * 1000 - 1000).map((x) => x.b); return l.reduce((a, b) => a + b, 0) / l.length; })(),
    waitMedian: waits[waits.length >> 1],
    waitP90: waits[Math.floor(waits.length * 0.9)],
    starvedPct: (100 * stats.starved) / stats.ticks,
    starvedOutsidePct: (100 * stats.starvedOutside) / stats.ticks,
    minScale: Math.min(...stats.scales),
    maxScale: Math.max(...stats.scales),
    recover: stats.recover,
    pace: pacer.state(),
  };
}

const results = { limits: INPUT_PACE };
results.steady = simulate({});
results.joinStanding = simulate({ standing: 3 });
results.legacyStanding = simulate({ pace: 'off', standing: 3 });
results.stalls = simulate({ stallMs: 300, seconds: 60 });
results.stallsNoDrop = simulate({ stallMs: 300, seconds: 60, hitchDrop: false });
results.jittery = simulate({ fps: 30, jitter: 25, seed: 3 });

// The unit's own edges.
{
  const p = createInputPacer();
  const u = {};
  u.noRows = p.update({ rows: [], now: 0, frameMs: 16 });
  const rows = [];
  for (let i = 1; i <= 12; i++) rows.push({ n: i, iq: 0, sq: 1, st: 0, ld: 50 });
  u.slow = p.update({ rows, now: 100, frameMs: 16 });
  const low = rows.map((r, i) => ({ ...r, n: 12 + i + 1, ld: 2 }));
  u.fast = p.update({ rows: low, now: 200, frameMs: 16 });
  u.stale = p.update({ rows: low, now: 1000, frameMs: 16 });
  // A starved tick with nothing held, frames even: the target grows.
  const q = createInputPacer();
  q.update({ rows: [{ n: 1, iq: 0, sq: 0, st: 1, ld: 10 }], now: 5000, frameMs: 16 });
  u.bumped = q.state();
  // After the page's own hitch, or with a word held in the sidecar: it does not.
  const r = createInputPacer();
  r.update({ rows: [], now: 5000, frameMs: 100 });
  r.update({ rows: [{ n: 1, iq: 0, sq: 0, st: 3, ld: 10 }], now: 5100, frameMs: 16 });
  r.update({ rows: [{ n: 2, iq: 1, sq: 0, st: 1, ld: 10 }], now: 7000, frameMs: 16 });
  u.notBumped = r.state();
  results.unit = u;
}
console.log(JSON.stringify(results));
