// `viewer/suspension.js` `staticSpringContact`: a wheel spring that a static
// face pushes while the terrain probe also has it in contact. The engine posts
// both contacts on the wheel's response, merges the pushes per axis
// (`setAdjust` 0x0825cec0) and moves the wheel along the contacts' mean
// normal (`solveImpulse` 0x08258d30), so the ground's push under the wheel
// survives a wall brushing its side. Run by `tests/test_static_spring_merge.py`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { staticSpringContact } = await import(pathToFileURL(path.join(viewer, 'suspension.js')).href);

const qInv = new THREE.Quaternion();
const out = () => ({ compression: 0, normal: new THREE.Vector3(), friction: 0, resistance: 0 });
const pick = r => r && { compression: +r.compression.toFixed(4), normal: r.normal.toArray().map(v => +v.toFixed(4)) };
const up = new THREE.Vector3(0, 1, 0);
const res = {};
// A horse's side spring on flat ground (0.3 m into it) brushed by a camouflage
// net's skirt, pushed 0.63 m sideways (the 2026-10-28 page trace).
const side = { staticPush: { x: 0.458, y: 0.043, z: 0.427, friction: 0.8, resistance: 0.02 } };
res.wallAndGround = pick(staticSpringContact(side, 0.3, qInv, out(), up));
res.wallAlone = pick(staticSpringContact(side, 0.3, qInv, out()));
// Off the ground the wall's push stands alone, as before.
res.wallOffGround = pick(staticSpringContact(side, -0.2, qInv, out(), up));
// A wheel on a sandbag top: the static push is vertical, the terrain under it
// shallower; the merge keeps the larger, the old rule's answer.
const top = { staticPush: { x: 0, y: 0.4, z: 0, friction: 0.8, resistance: 0.02 } };
res.deckOverGround = pick(staticSpringContact(top, 0.1, qInv, out(), up));
process.stdout.write(JSON.stringify(res));
