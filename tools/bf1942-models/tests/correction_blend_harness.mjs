// `viewer/correction-blend.js` under node: a correction moves the simulation,
// the drawn pose eases onto it.
//
// One node run, several scenarios, one JSON blob out (the pattern of
// `netcode_reconcile_harness.mjs`). The module is pure, so the python side
// copies it alone.
//
//   a  at the instant a correction lands, the drawn pose does not move
//   b  the offset fades to nothing, monotonically
//   c  a jump too large to be residue snaps
//   d  an orientation correction is drawn continuous, then fades
//   e  THE SHAKE: a walk whose prediction runs 2.25% slow, corrected whole at
//      20 Hz, drawn at 60 fps from two 30 Hz tick poses exactly as
//      local-look.js draws it; the drawn speed's frame-to-frame jitter with
//      and without the blend (the lab's 2026-10-22 measurement was 15.3% rms
//      through the sidecar against 2.6% solo)
import { createCorrectionBlend, deltaRotation, applyRotation } from './correction-blend.mjs';

const results = {};

{
  const b = createCorrectionBlend();
  // A body drawn at x = 10; the correction moves the simulation to 10.05.
  let sim = 10;
  const drawnBefore = sim + b.offset.x;
  sim += 0.05;
  b.shift(0.05, 0, 0);
  results.a = { drawnBefore, drawnAfter: sim + b.offset.x, offset: b.offset.x };
}

{
  const b = createCorrectionBlend();
  b.shift(0.05, 0, 0);
  const trail = [];
  for (let i = 0; i < 60; i++) { b.decay(1 / 60); trail.push(b.offset.x); }
  results.b = {
    after100ms: trail[5],
    after500ms: trail[29],
    after1s: trail[59],
    monotone: trail.every((v, i) => i === 0 || Math.abs(v) <= Math.abs(trail[i - 1])),
    sameSign: trail.every((v) => v <= 0),
  };
}

{
  const b = createCorrectionBlend();
  const ok = b.shift(5, 0, 0);
  results.c = { blended: ok, offset: b.offset.x, snaps: b.snaps };
}

{
  const b = createCorrectionBlend();
  // A hull yawed 0; the correction turns it by 3 degrees about y.
  const half = (3 * Math.PI / 180) / 2;
  const dq = [0, Math.sin(half), 0, Math.cos(half)];
  const before = [0, 0, 0, 1];
  const after = [0, 0, 0, 1];
  applyRotation(dq, after);
  b.rotate(deltaRotation(before, after));
  const drawn = applyRotation(b.offset.q, after.slice());
  const yaw = (q) => 2 * Math.atan2(q[1], q[3]) * 180 / Math.PI;
  for (let i = 0; i < 30; i++) b.decay(1 / 60);
  const later = applyRotation(b.offset.q, after.slice());
  results.d = { drawnYawAtInstant: yaw(drawn), drawnYawAfter500ms: yaw(later), simYaw: yaw(after) };
}

{
  // The page's 30 Hz ticks, its 60 fps frames, the server's 20 Hz acks two
  // ticks behind; the page runs 6.0 m/s where the server runs 6.135.
  const run = (blend) => {
    const PAGE = 6.0 / 30, SERVER = 6.135 / 30;
    const b = createCorrectionBlend();
    let sim = 0;               // the page's body
    let prev = 0, cur = 0;     // the two tick poses the frame blends
    const ledger = [];         // [tick, page position at that tick]
    let tick = 0;
    const drawn = [];
    for (let frame = 0; frame < 60 * 6; frame++) {
      const t = frame / 60;
      // A tick on every other frame.
      if (frame % 2 === 0) {
        tick++;
        sim += PAGE;
        prev = cur; cur = sim;
        ledger.push([tick, sim]);
        // An ack on two of every three ticks, measuring the tick two back.
        if (tick > 3 && tick % 3 !== 0) {
          const ack = tick - 2;
          const at = ledger.find(([k]) => k === ack);
          const err = SERVER * ack - at[1];
          // The acked-tick law, whole (smoothing 1): the body moves by the
          // error, the unacknowledged ledger with it.
          sim += err;
          for (const e of ledger) if (e[0] > ack) e[1] += err;
          if (blend) { prev += err; cur += err; b.shift(err, 0, 0); }
        }
      }
      if (blend) b.decay(1 / 60);
      const alpha = frame % 2 === 0 ? 0 : 0.5;
      drawn.push(prev + (cur - prev) * alpha + b.offset.x);
      void t;
    }
    const v = [];
    for (let i = 1; i < drawn.length; i++) v.push((drawn[i] - drawn[i - 1]) * 60);
    const tail = v.slice(60);
    const mean = tail.reduce((s, x) => s + x, 0) / tail.length;
    const k = 9, dev = [];
    for (let i = 4; i < tail.length - 4; i++) {
      const avg = tail.slice(i - 4, i + 5).reduce((s, x) => s + x, 0) / k;
      dev.push(tail[i] - avg);
    }
    const rms = Math.sqrt(dev.reduce((s, x) => s + x * x, 0) / dev.length);
    return { meanSpeed: +mean.toFixed(3), jitterPct: +(100 * rms / mean).toFixed(2),
      endGap: +(SERVER * tick - drawn[drawn.length - 1]).toFixed(3) };
  };
  results.e = { whole: run(false), blended: run(true) };
}

process.stdout.write(JSON.stringify(results));
