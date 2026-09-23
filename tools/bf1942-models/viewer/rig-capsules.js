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
  const caps = buildCapsules(table, name => {
    const bone = bones.get(boneKey(name));
    if (!bone?.parent) return null;
    bone.getWorldPosition(_bone);
    bone.parent.getWorldPosition(_parent);
    return { bone: _bone.toArray(), parent: _parent.toArray() };
  });
  return caps.length ? caps : null;
}
