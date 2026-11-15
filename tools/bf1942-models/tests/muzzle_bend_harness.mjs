// Remaster mode's muzzle bend (`round-launch.js` `spawnTracer`,
// `projectile-flight.js` `bendFromMuzzle`) under node: a gun fired from the
// eye (its `aimRay`, a seat's camera-fired MG), its rounds stepped frame by
// frame. Prints, per frame, where the streak's tail is against the muzzle
// and the round's own line, and whether the beam beside it is drawn; and the
// same for a gun far from the eye (a bot's), which draws no beam.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { advanceTracers } from './projectile-flight.js';

globalThis.bfRemasterHooks = {
  tracer: { glow: () => {}, stretch: 1.6, coverage: 0.3, minPx: 3.2, litPx: 2, everyRound: true,
            fromMuzzle: 40, hold: 0.08, fade: 0.12 },
};

function run(eyeAt) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 3000);
  camera.position.set(...eyeAt);
  scene.add(camera);
  const gun = new THREE.Group();
  gun.name = 'browning';
  gun.userData.fireArms = {
    velocity: 900, roundOfFire: 10, magSize: 1000,
    projectile: { template: 'Browning_Projectile', kind: 'bullet', timeToLive: 2, gravity: 0 },
    tracer: { template: 'Tracer', interval: 3, scaler: 50, timeToLive: 2, gravity: 0 },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'browning muzzle 1';
  muzzle.userData.muzzle = { index: 0 };
  // The barrel's end: 0.9 m ahead of the eye and below it, as the M3A1's is.
  muzzle.position.set(0, -0.4, -0.8);
  gun.add(muzzle);
  scene.add(gun);
  scene.updateMatrixWorld(true);
  // Fired from the eye down -Z (`cameraLaunch`).
  const ray = { origin: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 0, -1), frame: new THREE.Quaternion() };
  const guns = new GunFire({ scene, camera, viewportHeight: () => 1080 });
  guns.rand = () => 0.5;
  const [group] = guns.collect(gun, {
    replace: true, speedScale: 1, maxRange: 1500, roundLifetime: 'data', tracerLength: 'data',
    aimRay: () => ray,
  });
  guns.fireShot(group);
  const tracer = guns.tracers[0];
  const at = muzzle.getWorldPosition(new THREE.Vector3());
  const frames = [];
  for (let k = 0; k < 9; k++) {
    advanceTracers(guns, 1 / 30);
    const live = guns.tracers.includes(tracer);
    tracer.mesh.updateMatrixWorld(true);
    const tail = tracer.mesh.localToWorld(new THREE.Vector3(0, 0, tracer.tail > 0 ? tracer.tail : 1));
    // Off the round's line (the eye's ray, the z axis), in metres.
    const offLine = Math.hypot(tail.x, tail.y);
    frames.push({
      age: +tracer.age.toFixed(3), live,
      tailToMuzzle: +tail.distanceTo(at).toFixed(3),
      offLine: +offLine.toFixed(3),
      bent: !!tracer.vis,
      beam: !!tracer.beam && !!tracer.beam.parent,
      beamTo: tracer.beam ? +tracer.beam.position.distanceTo(tracer.mesh.position).toFixed(1) : null,
    });
  }
  return frames;
}

console.log(JSON.stringify({ own: run([0, 0, 0]), far: run([60, 5, 30]) }));
