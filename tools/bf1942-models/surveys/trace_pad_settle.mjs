#!/usr/bin/env node
// Trace one placed hull's load settle in the page's own body world, tick by
// tick, from the pose its spawner gives it: for comparing with a server
// recording of the same pad (`features/fh-fhsw-open-issues`, FHX-22).
//
//   node surveys/trace_pad_settle.mjs --mod fhsw --level operation_springawakening \
//        --template ISU152 --at 1310.66,106.07,604.07 [--seconds 3] [--every 1]
//
// `--at` is the spawner's authored position (the hull is stood there, at its
// node's own rotation, as `spawnObject` stands it, ledger SPAWN-28). Prints
// `t x y z` (engine coordinates) per printed tick and the terrain under the origin.

import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = join(here, '..', 'viewer');
installModuleHooks(viewerDir);
const load = rel => import(pathToFileURL(join(here, '..', rel)).href);
const { loadRealLevel } = await load('server/level-load.mjs');
const { bodyPoseOf, bodySpecFor, bodyTerrainOf } = await load('server/level-bodies.mjs');
const { BodyWorld } = await load('viewer/body-world.js');
const { buildParkedVehicle } = await load('viewer/vehicle-bodies.js');
const { pruneToMode } = await load('viewer/game-modes.js');

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const mod = opt('--mod'), level = opt('--level'), template = opt('--template').toLowerCase();
// Engine coordinates; the glb's world mirrors Z (Refractor +Z is glTF -Z).
const engineAt = opt('--at').split(',').map(Number);
const at = [engineAt[0], engineAt[1], -engineAt[2]];
const seconds = Number(opt('--seconds', 3)), every = Number(opt('--every', 1));

const data = loadRealLevel({ viewerDir, name: level, mod });
const root = data.sceneRoot;
pruneToMode(root, data.extras?.gameplayMode);
root.updateMatrixWorld(true);
let best = null, bestD = Infinity;
root.traverse(node => {
  if (!node.userData?.armor) return;
  if (String(node.name).replace(/_\d+$/, '').toLowerCase() !== template) return;
  const p = node.getWorldPosition(node.position.clone());
  const d = Math.hypot(p.x - at[0], p.z - at[2]);
  if (d < bestD) { bestD = d; best = node; }
});
if (!best || bestD > 10) throw new Error(`no ${template} within 10 m of ${engineAt}`);
const spec = bodySpecFor(best, data);
const pose = bodyPoseOf(best);
pose.position = at.slice();
const world = new BodyWorld({ tables: data.damageTables,
  terrain: bodyTerrainOf(data.heightfield, data.extras?.waterLevel) });
const parked = buildParkedVehicle(spec, { ...pose, asleep: false });
world.addParked(0, parked, spec);
const ground = data.heightfield.height(at[0], at[2]);
console.log(`${best.name}: node ${bestD.toFixed(2)} m from --at; terrain under the origin ${ground.toFixed(2)}`);
const b = parked.body;
const ticks = Math.round(seconds * 30);
for (let t = 0; t <= ticks; t++) {
  if (t % every === 0) {
    console.log(`${(t / 30).toFixed(3)} ${b.pos[0].toFixed(3)} ${b.pos[1].toFixed(3)} ${(-b.pos[2]).toFixed(3)}`
      + ` v ${b.v.map(v => v.toFixed(2)).join(' ')}${b.sleeping ? ' asleep' : ''}`);
  }
  world.tick();
}
