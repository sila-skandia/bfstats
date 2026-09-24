// A soldier drawn in a seat: the seat's pose glb at the SeatObject, half a
// body where the seat says so, the arms pinned to the wheel or the gun by the
// seat's `skeletonIK` nodes, and `Ub_DieInVehicle` bound for the slump.
//
// One implementation for every seated body the page draws: the human's own
// (`seat-pose.js`, which adds the kit and the camera rules), the bots'
// (`bot-visuals.js`) and remote players' (`netcode-render.js`). `seat-ik.js`
// stays the solver and the pose rules; this is the three.js half.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import {
  collectIkBindings, defaultSeatPoseName, ikTarget, resolveSeatStates, seatBody,
  seatPoseName, solveTwoBone,
} from './seat-ik.js';
import { DIE_IN_VEHICLE_UPPER } from './soldier-death.js';

/** A bone by name, tolerant of the underscore/space spellings the data mixes. */
export const boneKey = name => String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();
export function findBone(root, name) {
  const want = boneKey(name);
  let found = null;
  root.traverse(obj => { if (!found && boneKey(obj.name) === want) found = obj; });
  return found;
}

/** `c_SeatShowHalfBodySoldier` — `setUseSeat` hides `Bip01 Pelvis` and its
 *  subtree. Scaling the bone to nothing is the closest a skinned mesh gets to
 *  `disableBoneTree`. */
export function hideBelowPelvis(scene) {
  const pelvis = findBone(scene, 'Bip01 Pelvis');
  if (pelvis) pelvis.scale.setScalar(1e-4);
}

/** The node a seated body follows: the SeatObject, else the seat's own node. */
export const seatAnchor = seat => seat?.seatObjects?.[0] || seat?.node || null;

/**
 * The per-frame IK work for one seat: every `extras.skeletonIK` node this seat
 * owns, paired with the arm chain it drives.
 *
 * Scoped by the same `control` tag `surveyVehicle` buckets seats with, so a
 * Sherman gunner's Browning does not pull the driver's hands and vice versa;
 * an untagged node belongs to `rootId`. The chain is the bone's two ancestors —
 * the engine's own `i-1` and `i-2` (`applyIK2BoneSolver` reads the bone array
 * at negative offsets, 232 bytes apart), which for `Bip01 R Hand` is the
 * forearm and the upper arm.
 */
export function bindSeatIkChains(seat, scene, clips, rootId) {
  const chains = [];
  if (!seat?.node || !scene) return chains;
  // Which bones the seat clips re-pose every frame. Those need no restoring:
  // the mixer overwrites last frame's IK before this frame's runs. A bone no
  // clip touches does need it, or the deltas compound (a pose file that
  // resolved only `seat.lower` would wind the arms off the model in seconds).
  const driven = new Set();
  for (const clip of clips || []) {
    for (const track of clip.tracks || []) {
      driven.add(boneKey(track.name.slice(0, track.name.lastIndexOf('.'))));
    }
  }
  const owners = [];
  seat.node.traverse(obj => {
    if (!obj.userData?.skeletonIK) return;
    const owner = obj.userData.control || rootId;
    if (owner === seat.id) owners.push(obj);
  });
  const resolveChild = (node, index, name) =>
    (name && node.children.find(c => c.name === name)) || node.children[index] || null;
  for (const binding of collectIkBindings(owners, resolveChild)) {
    const end = findBone(scene, binding.bone);
    const mid = end?.parent;
    const root = mid?.parent;
    if (!end || !mid || !root) continue;
    chains.push({
      ...binding, end, mid, root,
      rest: [root, mid, end].map(
        b => (driven.has(boneKey(b.name)) ? null : b.quaternion.clone())),
    });
  }
  return chains;
}

// Scratch, so the three.js half of a frame's IK allocates nothing.
const _ikPos = new THREE.Vector3();
const _ikScale = new THREE.Vector3();
const _ikQuat = new THREE.Quaternion();
const _ikParent = new THREE.Quaternion();
const _ikInverse = new THREE.Quaternion();
const _ikDelta = new THREE.Quaternion();
const _ikRoot = new THREE.Vector3();
const _ikMid = new THREE.Vector3();
const _ikEnd = new THREE.Vector3();
const _ikA = [0, 0, 0];
const _ikB = [0, 0, 0];
const _ikC = [0, 0, 0];
const toArr = (v, out) => { out[0] = v.x; out[1] = v.y; out[2] = v.z; return out; };

/**
 * Pin each declared bone to its vehicle node's live world pose, once a frame.
 *
 * Called after the seat pose's mixer has stepped and after the vehicle's own
 * rig has been applied, so the wheel is already where this frame put it and
 * the hands follow it round rather than trailing it by a frame.
 *
 * `updateIk` (lnxded `0x08265880`) does the same composition in the soldier's
 * own frame; world space is the same answer and saves inverting a matrix the
 * viewer already has. The arm reaches (`applyIK2BoneSolver`) and the hand is
 * then planted at the declared angle outright (`Skeleton::transform`,
 * `0x8342233`) — both halves, in that order.
 */
export function stepSeatIkChains(chains, scene) {
  if (!chains?.length || !scene) return;
  for (const chain of chains) {
    if (chain.rest[0]) chain.root.quaternion.copy(chain.rest[0]);
    if (chain.rest[1]) chain.mid.quaternion.copy(chain.rest[1]);
    if (chain.rest[2]) chain.end.quaternion.copy(chain.rest[2]);
  }
  scene.updateMatrixWorld(true);
  for (const chain of chains) {
    chain.target.updateWorldMatrix(true, false);
    chain.target.matrixWorld.decompose(_ikPos, _ikQuat, _ikScale);
    const target = ikTarget(
      chain.entry,
      [_ikPos.x, _ikPos.y, _ikPos.z],
      [_ikQuat.x, _ikQuat.y, _ikQuat.z, _ikQuat.w]);

    chain.root.getWorldPosition(_ikRoot);
    chain.mid.getWorldPosition(_ikMid);
    chain.end.getWorldPosition(_ikEnd);
    const solve = solveTwoBone(
      toArr(_ikRoot, _ikA), toArr(_ikMid, _ikB), toArr(_ikEnd, _ikC),
      target.position);
    if (solve.degenerate) continue;

    // A world-space rotation applied to a bone whose parent stays put is
    // `local' = parentWorld^-1 * q * parentWorld * local`. Bend the forearm
    // first, then swing the whole arm: the swing was derived from where the
    // hand sits *after* the bend and carries it along rigidly.
    applyWorldDelta(chain.mid, solve.bend);
    applyWorldDelta(chain.root, solve.reach);
    chain.root.updateMatrixWorld(true);

    // And the hand's own orientation is the declared one, not whatever the
    // arm's swing left behind.
    chain.end.parent.getWorldQuaternion(_ikParent);
    _ikQuat.set(target.quaternion[0], target.quaternion[1],
                target.quaternion[2], target.quaternion[3]);
    chain.end.quaternion.copy(_ikParent.invert()).multiply(_ikQuat);
    chain.end.updateMatrixWorld(true);
  }
}

function applyWorldDelta(bone, quat) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_ikParent);
  _ikInverse.copy(_ikParent).invert();
  _ikDelta.set(quat[0], quat[1], quat[2], quat[3]);
  // parentWorld^-1 * delta * parentWorld, then premultiply onto the local.
  _ikDelta.premultiply(_ikInverse).multiply(_ikParent);
  bone.quaternion.premultiply(_ikDelta);
}

/**
 * Seated bodies for soldiers the page does not own (bots, remote players).
 * `ctx`: `loader` (a GLTFLoader), `url(soldierName, poseName)` (a url, or
 * the urls to try in order), `shade(scene)`,
 * `parent` (the group they hang off), `dispose(scene)` (GPU release), and
 * optionally `dresser` (`soldier-dress.js`), which hangs the occupant's kit on
 * the seated body -- helmet and all, the way the engine draws a jeep's
 * passenger.
 */
export function createSeatBodies(ctx) {
  const cache = new Map();

  /** The first of `urls` (one url, or the model roots to try in order,
   *  `pose-bases.js`) that loads, else null. */
  function asset(urls) {
    const list = [urls].flat();
    const key = list.join('|');
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        for (const url of list) {
          try {
            const gltf = await ctx.loader.loadAsync(url);
            return { scene: gltf.scene, animations: gltf.animations ?? [] };
          } catch { /* the next root */ }
        }
        return null;
      })());
    }
    return cache.get(key);
  }

  /**
   * Load `soldierName` seated in `seat`: the seat's own pose glb (its fallback
   * when the seat names a state no glb was written for), half a body where the
   * seat says so, the arm IK for `rootId`'s hull, `Ub_DieInVehicle` out of
   * `dieClips`, and `kit`'s worn parts. Resolves null for a seat that draws
   * nobody.
   */
  async function load(soldierName, seat, { dieClips = [], rootId = null, kit = null } = {}) {
    const anchor = seatAnchor(seat);
    const body = seatBody(seat?.seatObjects);
    if (!anchor || !body.draw) return null;
    const states = resolveSeatStates(seat.seatObjects);
    const found = await asset(ctx.url(soldierName, seatPoseName(states.upperBody, states.lowerBody)))
      ?? await asset(ctx.url(soldierName, defaultSeatPoseName(body.mask)));
    if (!found) return null;
    const scene = skeletonClone(found.scene);
    scene.traverse(obj => { if (obj.isSkinnedMesh) obj.frustumCulled = false; });
    ctx.shade?.(scene);
    if (body.halfBody) hideBelowPelvis(scene);
    const mixer = new THREE.AnimationMixer(scene);
    const action = (clips, name, once = false) => {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play();
      return a;
    };
    const lower = action(found.animations, 'seat.lower');
    const upper = action(found.animations, 'seat.upper');
    const dieUpper = action(dieClips, DIE_IN_VEHICLE_UPPER, true);
    if (dieUpper) { dieUpper.setEffectiveWeight(0); dieUpper.paused = true; }
    scene.visible = false;
    ctx.parent.add(scene);
    const sb = {
      scene, mixer, lower, upper, dieUpper, anchor, seat,
      halfBody: body.halfBody, spine: findBone(scene, 'Bip01 Spine'),
      ik: bindSeatIkChains(seat, scene, found.animations, rootId),
      body: null, dead: false, disposed: false,
    };
    if (kit && ctx.dresser) {
      ctx.dresser.dress(scene, kit, () => !sb.disposed)
        .catch(err => console.warn('seat kit:', err));
    }
    return sb;
  }

  const _spine = new THREE.Vector3();

  /** One frame: on the anchor, mixer stepped, the arms pinned (a live man
   *  only), and the stand-in target recorded, `height` under the spine. */
  function step(sb, dt, height = 1) {
    sb.anchor.getWorldPosition(sb.scene.position);
    sb.anchor.getWorldQuaternion(sb.scene.quaternion);
    sb.mixer.update(dt);
    if (!sb.dead) stepSeatIkChains(sb.ik, sb.scene);
    if (sb.spine) {
      sb.scene.updateMatrixWorld(true);
      sb.spine.getWorldPosition(_spine);
      sb.body = { x: _spine.x, y: _spine.y - height, z: _spine.z };
    }
  }

  /** The seated death: the torso goes over (`Ub_DieInVehicle`), the legs keep
   *  the seat's clip, and the hands let go of the gun. */
  function slump(sb) {
    sb.dead = true;
    sb.ik = [];
    if (!sb.dieUpper) return false;
    sb.upper?.setEffectiveWeight(0);
    sb.dieUpper.paused = false;
    sb.dieUpper.reset();
    sb.dieUpper.setEffectiveWeight(1);
    sb.dieUpper.play();
    return true;
  }

  function dispose(sb) {
    if (!sb) return;
    sb.disposed = true;
    sb.mixer.stopAllAction();
    sb.mixer.uncacheRoot(sb.scene);
    sb.scene.parent?.remove(sb.scene);
    ctx.dispose?.(sb.scene);
  }

  return { load, step, slump, dispose };
}
