// A recorded round's launch (`replay-hulls.js` `recordedLaunch`) under node:
// the recorder writes `fireBarrel`'s launch matrix (features/server-replay-
// recorder `write_fire`), and the engine adds `projectilePosition` and the
// barrel's offset to it on the barrel's frame (XHIT-16). One gun with one
// barrel at `0/0/14.5` and `projectilePosition 0/0/-14` (vanilla's Yamato
// main battery, glTF z negated), recorded at (10, 20, 30) BF1942 frame
// firing down BF1942 +X. Prints the launch point and direction, page frame.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { recordedLaunch }] = await Promise.all([imp('vendor/three.module.js'), imp('replay-hulls.js')]);

function rig(projectilePosition) {
  const gun = new THREE.Object3D();
  gun.name = 'Gun';
  gun.userData = { templateKind: 'FireArms', fireArms: { velocity: 100, ...(projectilePosition ? { projectilePosition } : {}) } };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Gun muzzle 1';
  muzzle.userData = { templateKind: 'Muzzle', muzzle: { index: 0 } };
  muzzle.position.set(0, 0, -14.5);
  gun.add(muzzle);
  gun.updateMatrixWorld(true);
  return { gun, muzzle };
}
const out = {};
for (const [name, pp] of [['withOffset', [0, 0, 14]], ['barrelOnly', null]]) {
  const { gun, muzzle } = rig(pp);
  const ray = recordedLaunch(gun, { pos: [10, 20, 30], dir: [1, 0, 0] })(muzzle);
  out[name] = { origin: ray.origin.toArray().map(x => +x.toFixed(4)), dir: ray.dir.toArray().map(x => +x.toFixed(4)) };
}
console.log(JSON.stringify(out));
