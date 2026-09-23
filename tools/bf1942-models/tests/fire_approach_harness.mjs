// Brief R item 4: the fire approach's goal (`bot-plans.js approachGoal`,
// `initObjectFinding` 0x08545df0 / `traceValidPoint` 0x0847e3a0) on a
// synthetic 1 m map. One JSON object on stdout; run by
// tests/test_fire_approach.py.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { approachGoal } = await import(path.join(HERE, '..', 'viewer', 'bot-plans.js'));

// 100 x 100 cells of 1 m, all free but a 30 m blocked square whose corner
// is at (40, -40) .. (70, -70) (z is negative north, as the maps are).
const W = 100;
const blocked = new Uint8Array(W * W);
for (let gz = 40; gz < 70; gz++) for (let gx = 40; gx < 70; gx++) blocked[gz * W + gx] = 1;
const nav = { cellSize: 1, width: W, height: W, blocked };

const round = p => (p ? p.map(v => Math.round(v * 100) / 100) : null);
const out = {
  // A target on free ground is its own goal.
  free: round(approachGoal(nav, [20.5, 0, -20.5], [90.5, 0, -90.5], 225)),
  // A target in the middle of the block, the bot east of it: the first free
  // pixel on the line toward the bot, 15 m out.
  blocked: round(approachGoal(nav, [55.5, 0, -55.5], [95.5, 0, -55.5], 225)),
  // The same with a finding radius shorter than the way out: no goal.
  tooFar: round(approachGoal(nav, [55.5, 0, -55.5], [95.5, 0, -55.5], 10)),
  // No map: the target's own point.
  noMap: round(approachGoal(null, [55.5, 0, -55.5], [95.5, 0, -55.5], 225)),
};
process.stdout.write(JSON.stringify(out) + '\n');
