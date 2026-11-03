// The strafe lean: a soldier moving sideways turns his legs toward where he is
// going and keeps his chest on his aim.
//
// Retail has no sideways clip. `Lb_StrafeLeft` / `Lb_StrafeRight` play the
// forward run (`3PRunLower.baf`), and so does a diagonal, which stays in
// `Lb_RunForward`. What makes a strafe read as one is a turn the engine lays
// over the clips in `BFSoldier::updateAnimations` (lnxded `0x0826e630`, client
// `FUN_004fb150`; ledger ANIM-21):
//
//   * a target from the soldier's state bits (`+0x3e6` server, `+0x416`
//     client, what `st` records): bit 1 forward, 2 back, 4 left, 8 right,
//     set by `handlePlayerInput` from the sign of the two ramp bytes. No side
//     bit: 0. A side bit alone: +0.8 right, -0.8 left. With forward or back:
//     +0.5 right, -0.4 left, the sign flipped when backing.
//   * the value moving toward it at 3.0 a second on the draw clock.
//   * when it is not exactly 0, the skeleton's root turned `value x 90`
//     degrees about his up (`setRotateYDeg`, composed with `rotate90aroundX`,
//     passed to `Skeleton::transform`), and the three spine bones from the
//     template's `+0x288` (`Bip01 Spine`, `Spine1`, `Spine2`) each turned
//     `value x -30` degrees about the same axis, in place of the aim twist.
//     The pitch stays.
//
// The legs turn 72 degrees on a straight strafe and 45 on a diagonal, and the
// three spine turns take the whole of it back off by `Spine2`, so the chest
// stays square to the aim and the lower back carries the turn.
//
// The value is worked out from the recorded rows at `t` on every call, not
// stepped from frame to frame, so a seek or a pause draws the same pose
// (round-replay-capture README section 12).

import * as THREE from 'three';
import { findBone } from './pose-compose.js';
import { latestIndex } from './replay-recording.js';

/** How fast the lean comes on and goes off, a second (the `3.0` in
 *  `BFSoldier::updateAnimations`). */
export const STRAFE_LEAN_RATE = 3.0;
/** Degrees of root turn per unit of lean. */
export const STRAFE_ROOT_DEG = 90;
/** Degrees each of the three spine bones turns back per unit of lean. */
export const STRAFE_SPINE_DEG = -30;
/** The template's `+0x288` bone and the two after it. */
export const STRAFE_ROOT_BONE = 'Bip01';
export const STRAFE_SPINE_BONES = Object.freeze(['Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2']);

const BIT_FORWARD = 0x1;
const BIT_BACK = 0x2;
const BIT_LEFT = 0x4;
const BIT_RIGHT = 0x8;
const SIDE = BIT_LEFT | BIT_RIGHT;
const ALONG = BIT_FORWARD | BIT_BACK;

/** The longest the lean takes to reach a new target: -0.8 to +0.8. */
const SETTLE = 1.6 / STRAFE_LEAN_RATE;

/** The engine's target for a soldier's state bits. */
export function strafeLeanTarget(bits) {
  const b = Number.isInteger(bits) ? bits : 0;
  if (!(b & SIDE)) return 0;
  if (!(b & ALONG)) return b & BIT_LEFT ? -0.8 : 0.8;
  const v = b & BIT_LEFT ? -0.4 : 0.5;
  return b & BIT_BACK ? -v : v;
}

function approach(value, target, dt) {
  if (!(dt > 0) || value === target) return value;
  const step = dt * STRAFE_LEAN_RATE;
  return target > value ? Math.min(target, value + step) : Math.max(target, value - step);
}

/**
 * The lean at `t` from a soldier's recorded body rows (`rec.stances.get(nid)`,
 * each `{ t, bits }`), or 0 before his first row.
 *
 * Walks back to a run of one target held long enough that the lean had
 * reached it whatever came before, then steps forward through each change to
 * `t`. A body whose first row is still inside its run starts from 0, the
 * constructor's value.
 */
export function strafeLeanAt(list, t) {
  const i = latestIndex(list, t);
  if (i < 0) return 0;
  const target = row => strafeLeanTarget(row.bits);
  // Back to the anchor run.
  let j = i;
  let runTarget = target(list[i]);
  let runEnd = t;
  let value = 0;
  for (;;) {
    while (j > 0 && target(list[j - 1]) === runTarget) j--;
    if (runEnd - list[j].t >= SETTLE) { value = runTarget; break; }
    if (j === 0) { value = 0; break; }
    runEnd = list[j].t;
    j--;
    runTarget = target(list[j]);
  }
  // Forward to `t`.
  let at = list[j].t;
  let goal = target(list[j]);
  for (let m = j + 1; m <= i; m++) {
    const g = target(list[m]);
    if (g === goal) continue;
    value = approach(value, goal, list[m].t - at);
    at = list[m].t;
    goal = g;
  }
  return approach(value, goal, t - at);
}

/** The pose glb's root carries a baked half turn: a drawn group is his body
 *  times this, so his body is the group times it again (`replay-gait.js`). */
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _bodyQ = new THREE.Quaternion();
const _bodyInv = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _parentInv = new THREE.Quaternion();
const _turnQ = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _parentPos = new THREE.Vector3();
const _parentScale = new THREE.Vector3();

/** One body's lean state: its four bones and what each last wore. */
export function makeStrafeLean(scene) {
  const bone = (name, deg) => {
    const node = scene ? findBone(scene, name) : null;
    return node ? {
      node, deg,
      baseQ: new THREE.Quaternion(), baseP: new THREE.Vector3(),
      appliedQ: new THREE.Quaternion(), appliedP: new THREE.Vector3(),
      worn: false,
    } : null;
  };
  const root = bone(STRAFE_ROOT_BONE, STRAFE_ROOT_DEG);
  const spine = STRAFE_SPINE_BONES.map(n => bone(n, STRAFE_SPINE_DEG));
  return { scene, bones: [root, ...spine].filter(Boolean), value: 0 };
}

/**
 * Before the mixer: put back the pose the mixer drew under the lean. three's
 * mixer writes a bone only when its value changes (memory "three mixer writes
 * on change"), so a lean left on a bone a clip holds still would be turned
 * again next frame. A bone something else has written since is left alone.
 */
export function unleanBody(lean) {
  if (!lean) return;
  for (const b of lean.bones) {
    if (!b.worn) continue;
    if (b.node.quaternion.equals(b.appliedQ)) b.node.quaternion.copy(b.baseQ);
    if (b.node.position.equals(b.appliedP)) b.node.position.copy(b.baseP);
    b.worn = false;
  }
}

/**
 * After the mixer and the morph: turn the root by `value x 90` and each spine
 * bone by `value x -30` about the body's up. `group` is the soldier's drawn
 * group (his body times the pose glb's half turn). The turn about his up is
 * the body frame's own, carried onto each bone in its parent's frame, so the
 * root's turn is about the vertical through his origin, as
 * `Skeleton::transform`'s root matrix turns it.
 *
 * The sign: the engine's frame is left-handed with +Y up, the page's
 * right-handed, so a positive engine yaw (forward toward +X, his right) is a
 * negative turn about the page's up. Checked on 8t224pppqe (Player, 25.8 s,
 * a right strafe): his feet point along his travel.
 */
export function leanBody(lean, group, value) {
  if (!lean) return;
  lean.value = value;
  if (!value) return;
  if (group) group.getWorldQuaternion(_bodyQ); else _bodyQ.identity();
  _bodyQ.multiply(SOLDIER_YAW_FLIP);
  _bodyInv.copy(_bodyQ).invert();
  for (const b of lean.bones) {
    const node = b.node;
    b.baseQ.copy(node.quaternion);
    b.baseP.copy(node.position);
    // D = B R B^-1 in the world, B his body; on the bone, P^-1 D P.
    _turnQ.setFromAxisAngle(UP, -value * b.deg * Math.PI / 180);
    _turnQ.premultiply(_bodyQ).multiply(_bodyInv);
    if (node.parent) {
      node.parent.updateWorldMatrix(true, false);
      node.parent.matrixWorld.decompose(_parentPos, _parentQ, _parentScale);
      _parentInv.copy(_parentQ).invert();
      _turnQ.premultiply(_parentInv).multiply(_parentQ);
    }
    node.quaternion.premultiply(_turnQ);
    // The root turns about his origin, so its offset turns with it.
    if (b.deg === STRAFE_ROOT_DEG) node.position.applyQuaternion(_turnQ);
    node.updateMatrixWorld(true);
    b.appliedQ.copy(node.quaternion);
    b.appliedP.copy(node.position);
    b.worn = true;
  }
}
