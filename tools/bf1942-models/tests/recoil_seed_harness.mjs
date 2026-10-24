// The recoil the page draws for its own rounds on a real server, against the
// aim the lab server's BAR burst moved by (test_recoil_seed.py). For each
// pair of rounds in fixtures/recoil_seed_bar.json, arm `recoil.js`
// `calcRecoil` with `inputRecoilRand` at the first round's input index, run
// the ride over the four ticks to the next round (`recoilStep`, standing),
// and turn the look axes into degrees as the look law does: yaw 3 deg a tick
// per unit of c_PIMouseLookX, the view's pitch 2.5 x c_PIMouseLookY
// (wire.md section 33).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { calcRecoil, inputRecoilRand, recoilStep } = await import(pathToFileURL(path.join(viewer, 'recoil.js')).href);

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'recoil_seed_bar.json'), 'utf8'));
const recoil = { up: fx.up, leftRight: fx.leftRight, hasForce: true, goBack: false };

function ride(rand, ticks) {
  const r = { count: 0 };
  calcRecoil(r, recoil, rand, [1.0, 0.85, 0.5]);
  let x = 0, y = 0;
  const out = {};
  for (let i = 0; i < ticks; i++) {
    recoilStep(r, 'stand', out);
    x += out.x;
    y += out.y;
  }
  return { yaw: 3 * x, pitch: -2.5 * y };
}

let seed = 1;
const lcg = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
console.log(JSON.stringify({
  seeded: fx.pairs.map(([gi, next, dYaw, dPitch]) => ({ gi, dYaw, dPitch, ...ride(inputRecoilRand(gi), next - gi) })),
  dice: fx.pairs.map(([gi, next, dYaw, dPitch]) => ({ gi, dYaw, dPitch, ...ride(lcg, next - gi) })),
  noIndex: inputRecoilRand(null),
}));
