// A replay's "Trace every round" (replay-ui.js, round-launch.js `fireRound`),
// under node: a rifle, which retail never draws a round for (GUN-12), fired
// by a replay gun with the switch off and on, and by a gun that is not a
// replay's with it on. One JSON report on stdout, read by
// test_replay_trace_every_round.py.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';

function fire({ replay, traced }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 2000);
  camera.position.set(0, 2, 10);
  scene.add(camera);
  const gun = new THREE.Group();
  gun.name = 'K98';
  gun.userData.fireArms = {
    velocity: 1000, roundOfFire: 1, magSize: 5,
    projectile: { template: 'K98Projectile', kind: 'bullet', timeToLive: 1.0, gravity: 0 },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'K98 muzzle 1';
  muzzle.userData.muzzle = { index: 0 };
  gun.add(muzzle);
  scene.add(gun);
  scene.updateMatrixWorld(true);
  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.traceEveryRound = traced;
  const [group] = guns.collect(gun, { replace: true, speedScale: 1, maxRange: 1200, roundLifetime: 'data', tracerLength: 'data' });
  group.replay = replay;
  guns.fireShot(group);
  const round = guns.tracers[0];
  const out = { visible: Boolean(round?.mesh.visible), bright: Boolean(round?.bright), forced: Boolean(round?.forced), length: round?.mesh.scale.z ?? null };
  // Three frames on, 50 m out: the 2 cm stand-in is held to a visible width.
  for (let i = 0; i < 3; i++) guns.advance(1 / 60);
  out.across = guns.tracers[0]?.mesh.scale.x ?? null;
  return out;
}

console.log(JSON.stringify({
  off: fire({ replay: true, traced: false }),
  on: fire({ replay: true, traced: true }),
  notReplay: fire({ replay: false, traced: true }),
}));
