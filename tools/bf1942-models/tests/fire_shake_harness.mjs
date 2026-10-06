// Drives the upper body's camera shake (`fire-shake.js`, ledger CS-8..CS-11)
// outside a browser and prints one JSON blob: a shake's factor over time for
// the blocks vanilla and Desert Combat ship, what restarts it, and what
// `applyViewShake` does to a camera.
//
// The blocks are `bf42/animstates.py`'s parse of the shipped lines
// (`AnimationStatesCameraShakes.con`, Desert Combat's `AnimationStatesMod.con`),
// as `extract_viewmodel.py` writes them into a viewmodel's clip extras.

import * as THREE from 'three';
import { CameraShake, applyViewShake } from './fire-shake.js';

const block = fields => ({
  timeToShake: 0, pitch: [0, 0], yaw: [0, 0], roll: [0, 0],
  upDown: [0, 0], leftRight: [0, 0], inOut: [0, 0],
  fadeIn: 0, fadeOut: 0, minFactor: 0, ...fields,
});
// Vanilla `Ub_FireBazooka` (Desert Combat's Stinger and RPG-7 are the same).
const BAZOOKA = [block({ pitch: [0.25, 900], yaw: [0.5, 100], roll: [0.5, 800],
                         upDown: [1, 500], leftRight: [0.8, 100], inOut: [0.4, 8],
                         fadeOut: 3 })];
// `Ub_FireThompson`: no fade out, so it runs for as long as the state does.
const THOMPSON = [block({ pitch: [0.05, 900], yaw: [0.05, 700], roll: [0.25, 800],
                          leftRight: [0.01, 2000], inOut: [0.01, 2000] })];
// `Ub_FireK98Sniper` (CS-7): a kick, then a slow drift in slot 1.
const K98_SNIPER_FIRE = [block({ pitch: [2, 10], fadeOut: 4 }),
                         block({ pitch: [0.1, 1], yaw: [-0.03, 2.3] })];
// `Ub_StandAimK98Sniper`: the aim sway, fading to a 0.075 floor and held there.
const K98_SNIPER_AIM = [block({ pitch: [0.25, 1.5], yaw: [0.2, 0.5], fadeOut: 0.25,
                                minFactor: 0.075 })];
// A fade-in, as the locomotion states declare one (`fadeIn 0.6`).
const FADE_IN = [block({ upDown: [0.08, 15], fadeIn: 0.6 })];
// The stationary-gun trigger state's time limit (`FireMachineGunShake`).
const TIMED = [block({ timeToShake: 0.1, pitch: [0.25, 900] })];

const DT = 1 / 60;
const out = {};

/** Run `seconds` of frames from a fresh entry; sample the factor and slot. */
function run(slots, seconds, samples) {
  const shake = new CameraShake();
  shake.enter('state', slots);
  const channels = {};
  const trace = {};
  let first = null;
  for (let frame = 1; frame <= Math.round(seconds / DT); frame++) {
    const live = shake.update(DT, channels);
    if (frame === 1) first = { ...channels, live, factor: shake.factor, t: shake.t };
    for (const at of samples) {
      if (Math.abs(frame * DT - at) < DT / 2) {
        trace[at] = { factor: shake.factor, slot: shake.slot, live, t: shake.t };
      }
    }
  }
  return { first, trace };
}

out.bazooka = run(BAZOOKA, 1, [0.1, 0.3, 0.32, 0.34, 0.5]);
out.thompson = run(THOMPSON, 5, [1, 5]);
out.sniperFire = run(K98_SNIPER_FIRE, 3, [0.2, 0.26, 0.3, 3]);
out.sniperAim = run(K98_SNIPER_AIM, 10, [1, 3.7, 4, 10]);
out.fadeIn = run(FADE_IN, 2, [0.5, 1, 1.7, 2]);
out.timed = run(TIMED, 0.2, [0.05, 0.1, 0.15]);

// What restarts it (CS-9): only a state unlike the current one.
{
  const shake = new CameraShake();
  shake.enter('Ub_FireColt', BAZOOKA);
  for (let i = 0; i < 6; i++) shake.update(DT, {});
  const before = shake.factor;
  const same = shake.enter('Ub_FireColt', BAZOOKA);
  const afterSame = shake.factor;
  const other = shake.enter('Ub_StandAimColt', null);
  const noneLive = shake.update(DT, {});
  const tAfterEnd = shake.t;
  const again = shake.enter('Ub_FireColt', BAZOOKA);
  const againLive = shake.update(DT, {});
  out.restart = { before, same, afterSame, other, noneLive, tAfterEnd, again, againLive,
                  againFactor: shake.factor };
}

// The camera (CS-11): turns and moves in the camera's own frame, each sign the
// engine's, and the undo.
function shaken(fields) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(10, 2, -5);
  camera.rotation.set(0, Math.PI / 2, 0, 'YXZ');   // facing world -X
  camera.updateMatrixWorld();
  const before = { p: camera.position.toArray(), q: camera.quaternion.toArray() };
  const restore = applyViewShake(camera, { pitch: 0, yaw: 0, roll: 0, x: 0, y: 0, z: 0, ...fields });
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const moved = camera.position.clone().sub(new THREE.Vector3(...before.p));
  restore();
  const back = camera.position.toArray().every((v, i) => Math.abs(v - before.p[i]) < 1e-9)
    && camera.quaternion.toArray().every((v, i) => Math.abs(v - before.q[i]) < 1e-9);
  return { fwd: fwd.toArray(), up: up.toArray(), right: right.toArray(),
           moved: moved.toArray(), back };
}
out.camera = {
  rest: shaken({}),
  pitch: shaken({ pitch: 10 }),
  yaw: shaken({ yaw: 10 }),
  roll: shaken({ roll: 10 }),
  up: shaken({ y: 1 }),
  right: shaken({ x: 1 }),
  forward: shaken({ z: 1 }),
};

console.log(JSON.stringify(out));
