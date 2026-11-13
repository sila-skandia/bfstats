// Drives `viewer/frame-pacer.js` against a simulated display and prints one
// JSON blob: for each case the divisor it settled on and the gaps between
// drawn frames once settled.
//
//   node frame_pacer_harness.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const { createFramePacer } = await import(pathToFileURL(path.join(viewer, 'frame-pacer.js')).href);

/** `seconds` of a display at `hz` whose frames cost `cost(i, t)` ms. */
function run(hz, cost, seconds = 30) {
  const refresh = 1000 / hz;
  const changes = [];
  const pacer = createFramePacer({ onChange: s => changes.push(s.divisor) });
  const drawn = [];
  let t = 0, i = 0;
  while (t < seconds * 1000) {
    if (pacer.gate(t)) {
      drawn.push(t);
      // The next call is the first refresh after the frame's work is done.
      const done = t + cost(i++, t);
      t = Math.max(t + refresh, Math.ceil(done / refresh - 1e-9) * refresh);
    } else {
      t += refresh;
    }
  }
  const tail = drawn.filter(x => x > (seconds - 5) * 1000);
  const gaps = tail.slice(1).map((x, k) => +(x - tail[k]).toFixed(2));
  const counts = {};
  for (const g of gaps) counts[g] = (counts[g] || 0) + 1;
  return { divisor: pacer.state.divisor, fps: +pacer.state.fps.toFixed(1), gaps: counts, changes };
}

const out = {
  // 120 Hz, 10 ms frames: every frame overruns one refresh.
  proMotionSlow: run(120, () => 10),
  // 120 Hz, frames 7 or 10 ms in no order: the uneven mix a player calls stutter.
  proMotionMixed: run(120, i => ((i * 7919) % 10 < 4 ? 10 : 7)),
  // 120 Hz, 5 ms frames: left alone.
  proMotionFast: run(120, () => 5),
  // 60 Hz, 6 ms: left alone.
  sixtyFast: run(60, () => 6),
  // 60 Hz, one frame in six late: left at 60 rather than held at 30.
  sixtyOccasional: run(60, i => (i % 6 === 0 ? 18 : 12)),
  // 60 Hz, half the frames late: an even 30.
  sixtyHalf: run(60, i => (i % 2 ? 19 : 14)),
  // 120 Hz, an uneven stretch then a light one: paced, then let go.
  recovers: run(120, (i, t) => (t < 12000 ? ((i * 7919) % 10 < 4 ? 10 : 7) : 4), 40),
  // 120 Hz, frames hovering at the refresh itself for two minutes: it does
  // not swing back and forth.
  hovering: run(120, i => 7.6 + ((i * 2654435761) % 1000) / 1000 * 1.4, 120),
  // 120 Hz, 30 ms frames: they take four refreshes each by themselves.
  heavy: run(120, () => 30),
};
console.log(JSON.stringify(out));
