// `viewer/strafe-lean.js` under node: the engine's strafe lean (ledger
// ANIM-21) from a soldier's recorded state bits, eased on the replay clock,
// and laid over a skeleton shaped like the pose glb's.
//
// One node run, one JSON report, the modules imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, as `replay_aim_bend_harness.mjs` does.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, lean] = await Promise.all([imp('vendor/three.module.js'), imp('strafe-lean.js')]);
const { strafeLeanTarget, strafeLeanAt, makeStrafeLean, leanBody, unleanBody, STRAFE_LEAN_RATE } = lean;

const FLIP = new THREE.Quaternion(0, 1, 0, 0);
const DEG = Math.PI / 180;
const results = {};

// --- the target -------------------------------------------------------------
results.targets = Object.fromEntries([
  ['none', 0x0], ['forward', 0x1], ['back', 0x2],
  ['right', 0x8], ['left', 0x4],
  ['forwardRight', 0x9], ['forwardLeft', 0x5],
  ['backRight', 0xa], ['backLeft', 0x6],
  // Other bits ride along (lying 0x40, zoomed 0x20) and change nothing.
  ['rightLying', 0x48], ['forwardRightZoomed', 0x29],
  ['undefined', undefined],
].map(([k, b]) => [k, strafeLeanTarget(b)]));

// --- the value on the clock ---------------------------------------------------
//
// Rows every 1/30 s, as the recorder writes them while the aim moves.
function rows(segments, hz = 30) {
  const out = [];
  for (const [from, to, bits] of segments) {
    for (let t = from; t < to - 1e-9; t += 1 / hz) out.push({ t: Math.round(t * 1e6) / 1e6, bits });
  }
  return out;
}
const run = rows([[0, 2, 0x1], [2, 4, 0x8], [4, 6, 0x9], [6, 6.1, 0x4], [6.1, 8, 0x1]]);
results.rate = STRAFE_LEAN_RATE;
results.settled = strafeLeanAt(run, 1.9);
results.rampRight = [2.0, 2.1, 2.2, 2.3, 2.5].map(t => strafeLeanAt(run, t));
results.onRight = strafeLeanAt(run, 3.9);
results.toDiagonal = strafeLeanAt(run, 4.05);
results.onDiagonal = strafeLeanAt(run, 5.9);
// A tap left for 0.1 s from +0.5: down by 0.3, then back toward 0.
results.tapLeft = strafeLeanAt(run, 6.1);
results.afterTap = strafeLeanAt(run, 6.2);
results.afterTapSettled = strafeLeanAt(run, 7.0);
// A body whose first rows are a strafe starts from the constructor's 0.
const late = rows([[10, 11, 0x8]]);
results.firstRows = [10.0, 10.1, 10.5].map(t => strafeLeanAt(late, t));
results.beforeFirst = strafeLeanAt(late, 9);
results.empty = strafeLeanAt(undefined, 3);
// The same answer however the clock got there.
const fwd = []; for (let t = 1.5; t <= 7.5; t += 0.05) fwd.push(strafeLeanAt(run, t));
const back = []; for (let t = 7.5; t >= 1.5 - 1e-9; t -= 0.05) back.push(strafeLeanAt(run, t));
back.reverse();
results.seekDrift = Math.max(...fwd.map((v, i) => Math.abs(v - back[i])));

// --- the drawn pose ---------------------------------------------------------
//
// A soldier's group over a skeleton shaped like the pose glb's: `Bip01` with
// the glb's odd rest rotation, the pelvis and the torso root under it, the
// three spine bones in a chain, each with a rest rotation of its own.
function soldier(yawDeg = 37, leanDeg = 6) {
  const group = new THREE.Group();
  group.quaternion.setFromEuler(new THREE.Euler(leanDeg * DEG, yawDeg * DEG, -leanDeg * 0.5 * DEG, 'YXZ'));
  group.position.set(10, 2, -4);
  const scene = new THREE.Group();
  group.add(scene);
  const bone = (name, parent, q, p) => {
    const b = new THREE.Bone();
    b.name = name;
    b.quaternion.set(...q).normalize();
    b.position.set(...p);
    parent.add(b);
    return b;
  };
  const bip = bone('Bip01', scene, [0.1023, -0.1030, 0.7032, 0.6960], [0.02, 1.0, 0.03]);
  const pelvis = bone('Bip01 Pelvis', bip, [0.4779, 0.4779, -0.5211, 0.5211], [0, 0, 0]);
  const root = bone('Spine Root', bip, [-0.4249, -0.5650, 0.5696, -0.4193], [0, 0.05, 0.02]);
  const s0 = bone('Bip01 Spine', root, [0.1181, 0.0572, 0.0876, 0.9875], [0.1, 0, 0]);
  const s1 = bone('Bip01 Spine1', s0, [0.0768, 0.0497, 0.0555, 0.9943], [0.12, 0, 0]);
  const s2 = bone('Bip01 Spine2', s1, [0.0665, -0.0289, 0.0571, 0.9957], [0.12, 0, 0]);
  group.updateMatrixWorld(true);
  const body = group.getWorldQuaternion(new THREE.Quaternion()).multiply(FLIP);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(body);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(body);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body);
  // Each bone's own vector that points along his forward at rest.
  const local = b => fwd.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert());
  const rest = { pelvis: local(pelvis), s0: local(s0), s1: local(s1), s2: local(s2) };
  return { group, scene, bip, pelvis, s0, s1, s2, fwd, right, up, rest };
}

/** Where a bone's rest-forward points now, as a heading off his forward about
 *  his up, degrees, positive to his right. */
function heading(s, bone, localFwd) {
  s.group.updateMatrixWorld(true);
  const d = localFwd.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  d.addScaledVector(s.up, -d.dot(s.up)).normalize();
  return Math.atan2(d.dot(s.right), d.dot(s.fwd)) / DEG;
}

results.pose = {};
for (const [name, value] of [['right', 0.8], ['left', -0.8], ['forwardRight', 0.5], ['forwardLeft', -0.4]]) {
  const s = soldier();
  const l = makeStrafeLean(s.scene);
  const pelvisAt = s.pelvis.getWorldPosition(new THREE.Vector3());
  leanBody(l, s.group, value);
  const pelvisNow = s.pelvis.getWorldPosition(new THREE.Vector3());
  // The root turns about his origin: its height stays and its distance from
  // the vertical through the origin stays.
  const origin = s.group.getWorldPosition(new THREE.Vector3());
  const flat = v => { const d = v.clone().sub(origin); return d.addScaledVector(s.up, -d.dot(s.up)).length(); };
  results.pose[name] = {
    bones: l.bones.length,
    legs: heading(s, s.pelvis, s.rest.pelvis),
    spine: heading(s, s.s0, s.rest.s0),
    spine1: heading(s, s.s1, s.rest.s1),
    chest: heading(s, s.s2, s.rest.s2),
    rootHeightMoved: Math.abs(pelvisNow.clone().sub(origin).dot(s.up) - pelvisAt.clone().sub(origin).dot(s.up)),
    rootRadiusMoved: Math.abs(flat(pelvisNow) - flat(pelvisAt)),
  };
}

// No lean draws nothing and leaves every bone as it was.
{
  const s = soldier();
  const l = makeStrafeLean(s.scene);
  const before = [s.bip, s.s0, s.s1, s.s2].map(b => b.quaternion.clone());
  leanBody(l, s.group, 0);
  results.zero = Math.max(...[s.bip, s.s0, s.s1, s.s2].map((b, i) => b.quaternion.angleTo(before[i]) / DEG));
}

// --- no winding ---------------------------------------------------------------
//
// three's mixer writes a bone only when its value changes, so a lean left on a
// bone a clip holds still would be turned again every frame. Ten frames held
// at 0.8 with the unlean between draw the same legs as one; without it they
// wind round.
{
  const s = soldier();
  const l = makeStrafeLean(s.scene);
  const legs = [];
  for (let i = 0; i < 10; i++) {
    unleanBody(l);
    leanBody(l, s.group, 0.8);
    legs.push(heading(s, s.pelvis, s.rest.pelvis));
  }
  unleanBody(l);
  results.held = { first: legs[0], drift: Math.max(...legs) - Math.min(...legs), restored: heading(s, s.pelvis, s.rest.pelvis) };
  const w = soldier();
  const lw = makeStrafeLean(w.scene);
  for (let i = 0; i < 3; i++) leanBody(lw, w.group, 0.8);
  results.held.windWithoutUnlean = heading(w, w.pelvis, w.rest.pelvis);
}

console.log(JSON.stringify(results));
