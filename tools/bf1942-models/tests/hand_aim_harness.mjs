// Fires a hand weapon's barrels through `gunfire.js` under node, down the
// `aimRay` `hand-weapon.js` gives it (`hand-aim.js`), and prints one JSON blob:
// which way every round left, in the eye's own frame, and from where.
//
// The question is ledger XHIT-12: a `fireInCameraDof` gun's barrel turns the
// eye's frame before the round goes down its forward (`FireArms::fireBarrel`
// 0x0828aba0). Desert Combat's Remington declares eight barrels at the
// FireArms' origin with turns up to 1.5 degrees, so a pull should paint eight
// pellets on those turns, not one slug down the view axis.
//
// argv[2] is a JSON spec: `{ cases: [{ name, glb?, nodes?, spread, release? }] }`.
// A case names a viewmodel glb (its FireArms node and muzzles are read out of
// the JSON chunk, transforms as baked) or hands the nodes in directly
// (`{ fireArms, muzzles: [{ translation, rotation }] }`), for a run without
// the asset trees.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { handAimRay } from './hand-aim.js';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/** The FireArms node and its muzzle children out of a glb's JSON chunk. */
function fromGlb(path) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  const nodes = doc.nodes;
  const gun = nodes.find(n => n.extras?.fireArms);
  if (!gun) throw new Error(`${path}: no FireArms node`);
  const muzzles = (gun.children ?? []).map(i => nodes[i]).filter(n => n.extras?.muzzle);
  return { name: gun.name, fireArms: gun.extras.fireArms, muzzles };
}

function build({ name, fireArms, muzzles }) {
  const gun = new THREE.Group();
  gun.name = name ?? 'gun';
  // A bullet round with no tracer still flies (round-launch.js `spawnTracer`,
  // its streak hidden), which is all this needs.
  gun.userData.fireArms = { ...fireArms, tracer: null };
  muzzles.forEach((m, index) => {
    const node = new THREE.Object3D();
    node.name = `${gun.name} muzzle ${index + 1}`;
    node.userData.muzzle = { index };
    if (m.translation) node.position.fromArray(m.translation);
    if (m.rotation) node.quaternion.fromArray(m.rotation);
    if (m.scale) node.scale.fromArray(m.scale);
    gun.add(node);
  });
  return gun;
}

const DEG = 180 / Math.PI;
const out = { cases: {} };

for (const c of spec.cases) {
  const scene = new THREE.Scene();
  // The eye, somewhere on the map, looking up-left: the round's frame is this.
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 1000);
  camera.position.set(12, 31.6, -40);
  camera.rotation.set(0.17, 0.52, 0, 'YXZ');
  scene.add(camera);
  camera.updateMatrixWorld(true);
  // The hand: the weapon is held canted and off the view axis, the way a
  // viewmodel's clip holds it. None of that may reach the round.
  const hand = new THREE.Group();
  hand.position.set(3, 30, -38);
  hand.rotation.set(0.4, -1.1, 0.35);
  scene.add(hand);
  const parts = c.glb ? fromGlb(c.glb) : c.nodes;
  const gun = build(parts);
  hand.add(gun);
  scene.updateMatrixWorld(true);

  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  let seed = 7;
  guns.rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const release = c.release ? new THREE.Vector3(...c.release) : null;
  const [group] = guns.collect(gun, {
    replace: true,
    speedScale: 1,
    maxRange: 1200,
    roundLifetime: 'data',
    aimRay: handAimRay(() => camera, { release }),
    spreadDeg: () => c.spread,
  });
  const result = { muzzles: group?.muzzles.length ?? 0, pulls: [] };
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const toEye = camera.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (let pull = 0; pull < (c.pulls ?? 1); pull++) {
    const before = guns.tracers.length;
    guns.fireShot(group);
    const rounds = guns.tracers.slice(before).map(t => {
      // Direction in the eye's frame, as yaw right / pitch up in degrees.
      const d = t.velocity.clone().normalize().applyQuaternion(toEye);
      const o = new THREE.Vector3(...t.origin).sub(eye).applyQuaternion(toEye);
      return {
        dir: [d.x, d.y, d.z],
        yaw: Math.atan2(d.x, -d.z) * DEG,
        pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) * DEG,
        origin: [o.x, o.y, o.z],
      };
    });
    result.pulls.push(rounds);
  }
  out.cases[c.name] = result;
}

console.log(JSON.stringify(out));
