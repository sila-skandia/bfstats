// `viewer/replay-gait.js` `bendTorso` under node: a replayed soldier's torso
// turned and bent to his recorded aim, checked against the camera his rounds
// leave along (`replay-camera.js` `viewQuaternion`, ledger VIEW-14).
//
// One node run, one JSON report, the modules imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, as `replay_harness.mjs` does.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, gait, camera, recording] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-gait.js'), imp('replay-camera.js'), imp('replay-recording.js'),
]);
const { TORSO_ROOT_BONE, bendTorso, unbendTorso, makeAimBend, stanceBends, buildGaitRig, setGaitPose } = gait;

const FLIP = new THREE.Quaternion(0, 1, 0, 0);
const DEG = Math.PI / 180;
const results = {};

/** A soldier's drawn group over a skeleton shaped like the pose glb's: the
 *  scene, `Bip01` with the glb's own odd rest rotation, the torso root under
 *  it with another, and a child the chest is read off. */
function soldier(yawDeg = 37, leanDeg = 6, torsoName = TORSO_ROOT_BONE) {
  const group = new THREE.Group();
  group.quaternion.setFromEuler(new THREE.Euler(leanDeg * DEG, yawDeg * DEG, -leanDeg * 0.5 * DEG, 'YXZ'));
  group.position.set(10, 2, -4);
  const scene = new THREE.Group();
  group.add(scene);
  const bip = new THREE.Bone();
  bip.name = 'Bip01';
  bip.quaternion.set(-0.4996, -0.4996, -0.5004, 0.5004).normalize();
  scene.add(bip);
  const torso = new THREE.Bone();
  torso.name = torsoName;
  torso.quaternion.set(-0.0729, -0.0039, -0.0521, 0.9959).normalize();
  torso.position.set(0, 0.05, 0.02);
  bip.add(torso);
  group.updateMatrixWorld(true);
  return { group, scene, torso };
}

/** The world direction a vector fixed in the torso bone points along. */
function torsoDir(torso, local) {
  torso.updateWorldMatrix(true, false);
  return local.clone().applyQuaternion(torso.getWorldQuaternion(new THREE.Quaternion()));
}

/** The torso-local vector that points along his body's forward at rest. */
function restForward(s) {
  const body = s.group.getWorldQuaternion(new THREE.Quaternion()).multiply(FLIP);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(body);
  const inv = s.torso.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { body, fwd, local: fwd.clone().applyQuaternion(inv) };
}

const angleDeg = (a, b) => a.angleTo(b) / DEG;

// --- the chest follows the camera's aim -----------------------------------
//
// A positive aim pitch is up (the rounds' sign), a positive twist turns as the
// camera's yaw does. For each, the drawn chest's forward against the view the
// rounds leave along, `viewQuaternion` on the same body.
results.matches = [];
for (const [pitch, twist] of [[6, 0], [-5, 0], [0, 7.7], [10, -12], [-14, 15], [3.3, 3.3]]) {
  const s = soldier();
  const rest = restForward(s);
  const bend = makeAimBend();
  bendTorso(s.torso, bend, s.group, { pitch, twist }, true, null);
  const drawn = torsoDir(s.torso, rest.local);
  const view = camera.viewQuaternion({
    body: rest.body,
    yaw: twist * recording.AIM_TWIST_SCALE * DEG,
    pitch: pitch * recording.AIM_PITCH_SCALE * DEG,
  });
  const want = new THREE.Vector3(0, 0, -1).applyQuaternion(view);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.body);
  results.matches.push({
    pitch, twist,
    offDeg: angleDeg(drawn, want),
    // The rise off his body's own level, positive up.
    riseDeg: 90 - angleDeg(drawn, up),
  });
}

// --- no compounding ---------------------------------------------------------
//
// A clip that holds the torso still is not rewritten by three's mixer, so the
// bone keeps what the bend left on it. With the bend taken off before the
// mixer and put on after, a hundred frames of one aim draw the same bend as the
// first; and a clip that does write the bone moves the base under it.
{
  const s = soldier();
  const rest = restForward(s);
  const bend = makeAimBend();
  const restQ = s.torso.quaternion.clone();
  bendTorso(s.torso, bend, s.group, { pitch: 8, twist: 4 }, true, null);
  const first = torsoDir(s.torso, rest.local);
  let maxDrift = 0;
  for (let i = 0; i < 100; i++) {
    unbendTorso(s.torso, bend);
    // (the mixer, silent)
    bendTorso(s.torso, bend, s.group, { pitch: 8, twist: 4 }, true, 1 / 60);
    maxDrift = Math.max(maxDrift, angleDeg(first, torsoDir(s.torso, rest.local)));
  }
  unbendTorso(s.torso, bend);
  const restored = s.torso.quaternion.angleTo(restQ) / DEG;
  // A clip writes a new pose: the bend goes on over that one.
  const clipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 20 * DEG).multiply(restQ);
  s.torso.quaternion.copy(clipQ);
  bendTorso(s.torso, bend, s.group, { pitch: 0, twist: 0.0001 }, true, 1 / 60);
  const onClip = s.torso.quaternion.angleTo(clipQ) / DEG;
  // The bend with no unbend first, as the code had it before: it winds.
  const w = soldier();
  const wb = makeAimBend();
  for (let i = 0; i < 10; i++) { wb.worn = false; bendTorso(w.torso, wb, w.group, { pitch: 4, twist: 0 }, true, 1 / 60); }
  const windWithoutUnbend = angleDeg(restForward(soldier()).fwd, torsoDir(w.torso, restForward(soldier()).local));
  results.compounding = { maxDrift, restored, onClip, windWithoutUnbend };
}

// --- the stances that carry no bend ----------------------------------------
{
  const s = soldier();
  const rest = restForward(s);
  const bend = makeAimBend();
  const restQ = s.torso.quaternion.clone();
  bendTorso(s.torso, bend, s.group, { pitch: 10, twist: 0 }, true, null);
  const standing = angleDeg(rest.fwd, torsoDir(s.torso, rest.local));
  // He lies down: the bend eases off at AIM_BEND_EASE_HZ.
  const easing = [];
  for (let i = 0; i < 30; i++) {
    unbendTorso(s.torso, bend);
    bendTorso(s.torso, bend, s.group, { pitch: 10, twist: 0 }, false, 1 / 60);
    easing.push(angleDeg(rest.fwd, torsoDir(s.torso, rest.local)));
  }
  // A cut into a stance with no bend draws none at once.
  const c = soldier();
  const cb = makeAimBend();
  bendTorso(c.torso, cb, c.group, { pitch: 10, twist: 0 }, true, null);
  unbendTorso(c.torso, cb);
  const cRest = c.torso.quaternion.clone();
  bendTorso(c.torso, cb, c.group, { pitch: 10, twist: 0 }, false, null);
  results.stances = {
    standing,
    easing,
    afterCut: c.torso.quaternion.angleTo(cRest) / DEG,
    lieDown: s.torso.quaternion.angleTo(restQ) / DEG,
    bends: { stand: stanceBends('stand'), crouch: stanceBends('crouch'), prone: stanceBends('prone'), none: stanceBends(undefined) },
  };
}

// --- the clamp --------------------------------------------------------------
{
  const s = soldier();
  const rest = restForward(s);
  const bend = makeAimBend();
  bendTorso(s.torso, bend, s.group, { pitch: 40, twist: 0 }, true, null);
  results.clamp = { max: gait.AIM_BEND_MAX_DEG, drawn: angleDeg(rest.fwd, torsoDir(s.torso, rest.local)) };
}

// --- the fallback rig through setGaitPose ----------------------------------
//
// `replay-actors.js` hands setGaitPose `aimAt`'s aim beside the body record.
// The bone named as GLTFLoader loads it: spaces sanitised to underscores.
{
  const s = soldier(0, 0, 'Spine_Root');
  const anim = buildGaitRig(s.scene, [], [], 0);
  const life = { nid: 1, samples: [{ t: 0, p: [0, 0, 0], q: [0, 0, 0, 1] }, { t: 10, p: [0, 0, 0], q: [0, 0, 0, 1] }] };
  const entity = { life, anim, group: s.group, normal: s.scene };
  const rest = restForward(s);
  setGaitPose(entity, 1, { stance: 'stand' }, { pitch: 6, twist: 0 });
  const rise1 = angleDeg(rest.fwd, torsoDir(s.torso, rest.local));
  for (let i = 1; i <= 10; i++) setGaitPose(entity, 1 + i / 60, { stance: 'stand' }, { pitch: 6, twist: 0 });
  const rise10 = angleDeg(rest.fwd, torsoDir(s.torso, rest.local));
  setGaitPose(entity, 2, { stance: 'prone' }, { pitch: 6, twist: 0 });
  setGaitPose(entity, 2.0001, { stance: 'prone' }, { pitch: 6, twist: 0 });
  results.fallback = { found: anim.torso?.name ?? null, rise1, rise10 };
}

process.stdout.write(JSON.stringify(results));
