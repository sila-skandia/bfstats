// One page word for every server tick, through the real code on both sides
// of the sidecar: the page's clock (map.html's 0.1 s frame clamp, world.js's
// feed `feedFrame` and the pacer `createInputPacer`, viewer/input-pace.js, on
// FixedStep, viewer/fixed-step.js) and the sidecar's `InputSender`
// (sidecar/input.mjs: its bucket, its merge, its 30 Hz pump, its `atAck`),
// on a synthetic clock, against a server that reads its datagrams at the
// start of each 1/30 s frame, keeps at most four (D-2), runs one a tick (D-3)
// and acks at 20 Hz. See test_input_tick.py.
//
// Per scenario it counts, past the first `settle` seconds, the server ticks
// that ran no page word (starved), ran a merged record, or ran a record out
// of turn, and the words the server trimmed.
// The viewer's modules are copied beside this file as .mjs by the test (they
// are ES modules in a tree node reads as CommonJS); the sidecar's is loaded
// from its path, the first argument.
import { createInputPacer, feedFrame } from './input-pace.mjs';
import { FixedStep } from './fixed-step.mjs';

const { InputSender, ZERO_ACTION } = await import(process.argv[2]);

const P = 1000 / 30;

function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

/**
 * opts: fps, jitter (ms of random lateness a frame), gaps (long frames a
 * second, gapMin..gapMax ms), stallMs/stallEvery, seconds, settle (s), seed,
 * phase (ms: the server's tick against the page's start), feed (false: the
 * clock without world.js's feed), pace (false: no pacer, the clock at 1).
 */
function simulate(opts) {
  const o = { fps: 60, jitter: 2, gaps: 0, gapMin: 60, gapMax: 180, stallMs: 0, stallEvery: 4000,
              seconds: 40, settle: 6, seed: 1, phase: 13, compute: 2, feed: true, pace: true, ...opts };
  const rand = rng(o.seed);
  let vt = 0;                                   // virtual ms
  const T0 = 1.8e12;                            // wall ms near today's, as the bucket sees them
  const realNow = Date.now;
  Date.now = () => T0 + vt;
  try {
    // The sidecar.
    const wire = [];                            // released, not yet read: { serial, at, tag, merged }
    const session = { joined: true, conn: { state: 'connected', sendData: () => 1 } };
    const sender = new InputSender(session, { rate: 30, idle: 'zero', clock: () => vt });
    let merged = 0;
    const tags = new Map();                     // serial -> the page's seq
    const mergedSerials = new Set();
    sender.on('merged', (e) => { merged += e.words - 1; mergedSerials.add(e.serial); });
    sender.on('sent', (e) => { wire.push({ serial: e.serial, at: vt, tag: e.tag, idle: e.idle }); if (!e.idle) tags.set(e.serial, e.tag); });
    sender._nextAt = Date.now() + sender.periodMs;
    let nextPump = 0;
    // The page.
    const pacer = createInputPacer();
    const clock = new FixedStep({ rate: 30 });
    let feed = null, scale = 1, seq = 0;
    const rows = [];
    let rowN = 0;
    const inbox = [];                           // ack rows in flight to the page
    // The server.
    const buffer = [];
    let lastSerial = 0, lastRunSerial = 0, tick = 0, nextTick = o.phase, sinceAck = 0;
    const stats = { ticks: 0, starved: 0, mergedRun: 0, outOfTurn: 0, trimmed: 0, idleRun: 0, waits: [], words: 0 };
    let expectTag = null;
    let nextFrame = 0, lastFrame = 0, nextStall = o.stallMs ? o.stallEvery : Infinity;
    const end = o.seconds * 1000;
    const step = 0.25;                          // ms of virtual time a step
    while (vt < end) {
      // The sidecar's pump (setInterval at half a period).
      if (vt >= nextPump) { sender._pump(); nextPump += Math.max(5, Math.floor(sender.periodMs / 2)); }
      // The server's frame: read, trim to four, run one, ack at 20 Hz.
      if (vt >= nextTick) {
        const readAt = nextTick - o.compute;
        while (wire.length && wire[0].at <= readAt) {
          const w = wire.shift();
          if (w.serial > lastSerial) { buffer.push(w); lastSerial = w.serial; }
        }
        while (buffer.length > 4) { buffer.shift(); if (vt > o.settle * 1000) stats.trimmed++; }
        tick++;
        const settled = vt > o.settle * 1000;
        if (settled) stats.ticks++;
        if (buffer.length) {
          const w = buffer.shift();
          lastRunSerial = w.serial;
          if (settled) {
            if (mergedSerials.has(w.serial)) stats.mergedRun++;
            if (w.idle) stats.idleRun++;
            else {
              stats.words++;
              if (expectTag !== null && w.tag !== expectTag) stats.outOfTurn++;
              const rec = sender.released.find((r) => r.serial === w.serial);
              if (rec?.recvAt != null) stats.waits.push(nextTick - rec.recvAt);
            }
          }
          if (!w.idle) expectTag = w.tag + 1;
        } else if (settled) stats.starved++;
        sinceAck++;
        if (sinceAck >= (tick % 3 === 0 ? 1 : 2)) {
          sinceAck = 0;
          const at = nextTick + o.compute;
          // The block reaches the sidecar `compute` ms after the tick; read
          // there as sidecar.mjs does, then sent on to the page.
          const savedVt = vt;
          vt = at;
          const a = sender.atAck(lastRunSerial, tick);
          vt = savedVt;
          inbox.push({ at: at + 0.5, row: { n: ++rowN, seq: tags.get(lastRunSerial) ?? null, iq: a.iq, sq: a.sq,
                                            st: a.starved, ld: a.lead } });
        }
        nextTick += P;
      }
      // The page's frame.
      if (vt >= nextFrame) {
        while (inbox.length && inbox[0].at <= vt) { rows.push(inbox.shift().row); if (rows.length > 64) rows.shift(); }
        const wallMs = vt - lastFrame;
        lastFrame = vt;
        const dt = Math.min(wallMs / 1000, 0.1);          // map.html
        const f = o.feed ? feedFrame(dt, feed) : { fed: dt, hitch: false };
        const n = clock.advance(f.fed * scale);
        for (let i = 0; i < n; i++) {
          const s = ++seq;
          sender.enqueue({ ...ZERO_ACTION, axes: ZERO_ACTION.axes.slice(), buttons: 0 }, s);
          // How long this word's tick had been due (net-room.js).
          pacer.noteWord(s, (clock.accumulator + (n - 1 - i) * clock.dt) * 1000);
        }
        if (o.pace) {
          scale = pacer.update({ rows, now: vt, frameMs: dt * 1000, wallMs, hitch: f.hitch });
          feed = pacer.feed();
        }
        let len = 1000 / o.fps + rand() * o.jitter;
        if (o.gaps && rand() < (o.gaps * len) / 1000) len = o.gapMin + rand() * (o.gapMax - o.gapMin);
        if (vt >= nextStall) { len = o.stallMs; nextStall += o.stallEvery; }
        nextFrame = vt + len;
      }
      vt += step;
    }
    const waits = stats.waits.sort((a, b) => a - b);
    return {
      ticks: stats.ticks, starved: stats.starved, mergedWords: merged, mergedRun: stats.mergedRun, outOfTurn: stats.outOfTurn,
      trimmed: stats.trimmed, idleRun: stats.idleRun, words: stats.words,
      waitMedian: waits[waits.length >> 1], waitP90: waits[Math.floor(waits.length * 0.9)],
      pace: pacer.state(),
    };
  } finally {
    Date.now = realNow;
  }
}

const results = {};
for (const fps of [144, 60, 45, 30, 20, 12, 9]) results[`fps${fps}`] = simulate({ fps, jitter: Math.min(8, 240 / fps), seed: fps });
results.gappy = simulate({ fps: 45, jitter: 6, gaps: 1.5, seed: 5 });
results.fps9NoFeed = simulate({ fps: 9, jitter: 8, seed: 9, feed: false });
results.gappyNoFeed = simulate({ fps: 45, jitter: 6, gaps: 1.5, seed: 5, feed: false });
results.stalls = simulate({ fps: 60, stallMs: 300, seed: 3 });
console.log(JSON.stringify(results));
