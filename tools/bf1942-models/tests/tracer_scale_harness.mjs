// Fires a gun whose tracer is a baked streak mesh through `gunfire.js` under
// node and prints how the streak was scaled and where it sits: the engine's
// rule is scale (10, 10, |v| / tracerScaler) about the mesh's own origin, no
// translation (ledger TRC-1..TRC-3). argv[2] is a JSON spec:
// `{ cases: [{ name, velocity, scaler, meshZ: [min, max], width, tracerLength }] }`.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GunFire } from './gunfire.js';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = { cases: {} };

for (const c of spec.cases) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 2000);
  camera.position.set(0, 5, 30);
  scene.add(camera);
  const gun = new THREE.Group();
  gun.name = c.name;
  gun.userData.fireArms = {
    velocity: c.velocity, roundOfFire: 18, magSize: 1300,
    projectile: { template: 'Quad_Projectile', kind: 'bullet', timeToLive: 1.0, gravity: 0 },
    tracer: { template: 'Tracer', interval: 1, scaler: c.scaler, timeToLive: 4, gravity: 0 },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = `${c.name} muzzle 1`;
  muzzle.userData.muzzle = { index: 0 };
  muzzle.position.set(0, 0, -2);
  gun.add(muzzle);
  // The baked streak: a box of the authored extent (`meshZ` in Refractor's
  // frame, +Z forward), built the way the exporter's glb arrives: Z mirrored,
  // so a tail authored at -Z sits at +Z and `lookAt` points -Z down the line
  // of flight.
  const [z0, z1] = c.meshZ;
  const geometry = new THREE.BoxGeometry(c.width, c.width, z1 - z0);
  geometry.translate(0, 0, -(z0 + z1) / 2);
  const streak = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
  streak.name = `${c.name} tracer`;
  streak.userData.tracerMesh = { template: 'Tracer', geometry: 'test' };
  gun.add(streak);
  gun.position.set(10, 20, -5);
  gun.rotation.set(0.1, 0.7, 0);
  scene.add(gun);
  scene.updateMatrixWorld(true);

  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  const [group] = guns.collect(gun, {
    replace: true, speedScale: 1, maxRange: 1200,
    roundLifetime: 'data', tracerLength: c.tracerLength ?? 'data',
  });
  guns.fireShot(group);
  const tracer = guns.tracers.find(t => t.bright);
  const origin = new THREE.Vector3(...tracer.origin);
  const dir = tracer.velocity.clone().normalize();
  // The streak mesh's own origin against the round's launch point, in metres
  // along the flight line (+ ahead) and across it.
  const offset = tracer.mesh.position.clone().sub(origin);
  const along = offset.dot(dir);
  const across = offset.clone().addScaledVector(dir, -along).length();
  // Where the drawn geometry's own ends land along the flight line.
  tracer.mesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const ends = [geometry.boundingBox.min.z, geometry.boundingBox.max.z].map(
    z => new THREE.Vector3(0, 0, z).applyMatrix4(tracer.mesh.matrixWorld).sub(origin).dot(dir));
  out.cases[c.name] = {
    scale: tracer.mesh.scale.toArray(),
    lengthScale: tracer.lengthScale,
    acrossScale: tracer.acrossScale,
    width: tracer.width,
    originAlong: along,
    originAcross: across,
    drawnFrom: Math.min(...ends),
    drawnTo: Math.max(...ends),
    lead: tracer.lead,
  };
}

console.log(JSON.stringify(out));
