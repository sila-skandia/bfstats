// Where a gun that fires from its own transform puts its round (ledger
// XHIT-16, lnxded `FireArms::fireBarrel` 0x0828aba0): `round-launch.js`
// `barrelLaunch`, and the camera half of the same law, `gun-groups.js`
// `cameraLaunch`. Prints one JSON blob.
//
// argv[2] is a JSON spec: `{ cases: [{ name, glb? | nodes?, roots?, turns?,
// guns: [name], camera?, refs?: [name] }] }`. `nodes` is a glTF node array
// (name, translation, rotation, children, extras); `glb` reads one out of a
// baked file instead. `turns` rolls named nodes about their own Z before the
// shot (a round selector's key), `{ node, degrees }`. For every FireArms node
// in `guns` and every muzzle under it: the launch point and direction, and
// the muzzle's own world position (where the page launched before it read
// `projectilePosition` beside the barrels). `camera` fires the same guns
// through `cameraLaunch` from that node.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { barrelLaunch } from './round-launch.js';
import { cameraLaunch } from './gun-groups.js';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));

function glbNodes(path) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  return { nodes: doc.nodes, roots: doc.scenes?.[doc.scene ?? 0]?.nodes ?? [0] };
}

function build(nodes, roots) {
  const objs = nodes.map(n => {
    const o = new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    o.userData = n.extras ?? {};
    return o;
  });
  nodes.forEach((n, i) => { for (const c of n.children ?? []) objs[i].add(objs[c]); });
  const scene = new THREE.Object3D();
  for (const r of roots) scene.add(objs[r]);
  scene.updateMatrixWorld(true);
  return scene;
}

const r3 = v => v.toArray().map(x => +x.toFixed(4));
const out = {};
for (const c of spec.cases) {
  const { nodes, roots } = c.glb ? glbNodes(c.glb) : { nodes: c.nodes, roots: c.roots ?? [0] };
  const scene = build(nodes, roots);
  for (const t of c.turns ?? []) {
    scene.traverse(o => {
      if (o.name === t.node) o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), t.degrees * Math.PI / 180));
    });
  }
  scene.updateMatrixWorld(true);
  const result = { guns: {}, refs: {} };
  const camera = c.camera ? scene.getObjectByName(c.camera) : null;
  for (const name of c.guns) {
    // The first node of that name, depth first (a ship's front turret).
    const gun = scene.getObjectByName(name);
    const muzzles = gun.children.filter(o => o.userData?.muzzle);
    const launch = camera ? cameraLaunch(gun, camera) : null;
    result.guns[name] = muzzles.map(m => {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      let dir;
      if (launch) {
        const ray = launch(m);
        pos.copy(ray.origin);
        dir = ray.dir.clone();
      } else {
        barrelLaunch(m, gun.userData.fireArms?.projectilePosition, pos, quat);
        dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      }
      return { muzzle: m.name, origin: r3(pos), dir: r3(dir), muzzleWorld: r3(m.getWorldPosition(new THREE.Vector3())) };
    });
  }
  for (const name of c.refs ?? []) {
    // Every node of that name (a ship carries one drawn gun per turret).
    const found = [];
    scene.traverse(o => { if (o.name === name) found.push(o); });
    result.refs[name] = found.flatMap(o => o.children.filter(m => m.userData?.muzzle)
      .map(m => r3(m.getWorldPosition(new THREE.Vector3()))));
  }
  out[c.name] = result;
}
console.log(JSON.stringify({ cases: out }));
