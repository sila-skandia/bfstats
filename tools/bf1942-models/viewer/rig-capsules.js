// The hit capsules of a drawn soldier rig, in world space, this frame
// (`skeleton-hit.js` has the engine's rule; this reads the bones off a
// three.js scene for it). Shared by every body the page draws: the bots on
// foot and in their seats, and the human's own.

import * as THREE from 'three';
import { boneKey, buildCapsules } from './skeleton-hit.js';

const _bone = new THREE.Vector3();
const _parent = new THREE.Vector3();

/** Every node of `scene` by folded bone name, cached on the scene. */
function bonesOf(scene) {
  let map = scene.userData.__boneIndex;
  if (!map) {
    map = new Map();
    scene.traverse(obj => {
      const key = boneKey(obj.name);
      if (key && !map.has(key)) map.set(key, obj);
    });
    scene.userData.__boneIndex = map;
  }
  return map;
}

/**
 * The capsules of `table` (`gaits.json` `soldierBody.collisionBones`) on the
 * rig `scene`, or null when there is no table or the rig is not in the world.
 * Updates the rig's world matrices first, so the answer is the pose the mixer
 * last left, wherever the rig was placed.
 */
export function rigCapsules(scene, table) {
  if (!scene || !table?.length || !scene.parent) return null;
  scene.updateMatrixWorld(true);
  const bones = bonesOf(scene);
  // A half body's legs (`seat-body.js` `hideBelowPelvis`): no capsule.
  const hidden = scene.userData.hiddenBones;
  const caps = buildCapsules(table, name => {
    const key = boneKey(name);
    if (hidden?.has(key)) return null;
    const bone = bones.get(key);
    if (!bone?.parent) return null;
    bone.getWorldPosition(_bone);
    bone.parent.getWorldPosition(_parent);
    return { bone: _bone.toArray(), parent: _parent.toArray() };
  });
  return caps.length ? caps : null;
}

/** The rig's skeleton joints in the skeleton's own order (the extractor
 *  marks them and writes them in the `.ske`'s order), cached on the scene. */
function jointsOf(scene) {
  let list = scene.userData.__jointList;
  if (!list) {
    list = [];
    const seen = new Set();
    scene.traverse(obj => {
      if (!obj.userData?.joint) return;
      const key = boneKey(obj.name);
      if (seen.has(key)) return;
      seen.add(key);
      list.push(obj);
    });
    scene.userData.__jointList = list;
  }
  return list;
}

/** How stale a rig's world matrices may be for `rigBones`, ms: half a frame.
 *  The bots' sense rays ask many times a tick; one walk of the rig serves
 *  them all. */
const BONES_FRESH_MS = 8;

/**
 * The drawn rig's bones for a bot's sense rays and aim (`bot-sense.js`
 * `soldierBones`, ledger AI-123): `{ count, at(i) }`, `at` the bone's place
 * now in the soldier's body frame (right, up, ahead of his feet; `soldier`
 * is the World's `{ x, y, z, yaw }`), read off the same skeleton
 * `rigCapsules` hangs his capsules on. Null for a rig not in the world.
 */
export function rigBones(scene, soldier) {
  if (!scene?.parent || !soldier) return null;
  const joints = jointsOf(scene);
  if (joints.length < 2) return null;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (!(now - (scene.userData.__bonesAt ?? -Infinity) < BONES_FRESH_MS)) {
    scene.updateMatrixWorld(true);
    scene.userData.__bonesAt = now;
  }
  const c = Math.cos(soldier.yaw ?? 0), n = Math.sin(soldier.yaw ?? 0);
  return {
    count: joints.length,
    at(i) {
      const e = joints[i]?.matrixWorld.elements;
      if (!e) return null;
      const dx = e[12] - soldier.x, dz = e[14] - soldier.z;
      // `bot-sense.js` `toBodyFrame`.
      return [dx * c - dz * n, e[13] - soldier.y, dx * n + dz * c];
    },
  };
}
