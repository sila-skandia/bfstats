// Where a replayed object is at a recording time: the recording's frame
// turned into the viewer's, the ghost look of an object out of the client's
// update range, and place(), which poses one replay entity (its group, its
// wreck swap and, for a soldier, its gait) as a pure function of the clock.

import * as THREE from 'three';
import { sampleAt, hpAt, isReplicated } from './replay-recording.js';
import { setGaitPose } from './replay-gait.js';

// --- coordinates ----------------------------------------------------------------
//
// The viewer's frame is BF1942's with z negated. A recorded rotation quaternion
// (x, y, z, w) is (-x, -y, z, w) here: measured against the vehicles baked into
// maps/wake/scene.glb at eight different headings, |dot| >= 0.998 for every one,
// where a pitched SBD rules out the alternatives.

export function toViewPosition(p, out) {
  return out.set(p[0], p[1], -p[2]);
}

export function toViewQuaternion(q, out) {
  return out.set(-q[0], -q[1], q[2], q[3]);
}

// The soldier model's root, unlike every vehicle's, is authored facing the
// opposite way (see place()). Same constant kits.html uses to flip a
// head-slot attachment 180 degrees.
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);

// Out-of-range objects are drawn in this: announced and placed, but not updated.
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0x9aa666, transparent: true, opacity: 0.2, depthWrite: false,
});

function setGhost(entity, ghost) {
  if (entity.ghost === ghost) return;
  entity.ghost = ghost;
  for (const { mesh, material } of entity.meshes) mesh.material = ghost ? ghostMaterial : material;
}

export function place(player, entity, t) {
  const { life, group } = entity;
  entity.hp = null;
  if (t < life.created || t >= life.destroyed) {
    group.visible = false;
    return;
  }
  const replicated = isReplicated(life, t);
  // A soldier out of the replicated set is in a vehicle, or out of range:
  // there is no pose worth holding.
  if ((life.soldier && !replicated) || (!replicated && !player.showGhosts)) {
    group.visible = false;
    return;
  }
  const s = sampleAt(life, t);
  if (!s) {
    group.visible = false;
    return;
  }
  group.visible = true;
  toViewPosition(s.a.p, group.position);
  toViewQuaternion(s.a.q, group.quaternion);
  if (s.b) {
    group.position.lerp(toViewPosition(s.b.p, player.v1), s.k);
    group.quaternion.slerp(toViewQuaternion(s.b.q, player.q1), s.k);
  }
  // The soldier glb's own root carries a baked 180-degree turn that a
  // vehicle's root doesn't (README §12): toViewQuaternion alone was only
  // ever fitted against vehicles baked into the level scene. Measured
  // exactly 180.00 degrees off at the spawn instant of both soldier lives
  // in replay_20260915-213110.ndjson, against spawnYaw()'s convention.
  if (life.soldier) group.quaternion.multiply(SOLDIER_YAW_FLIP);

  // Aim assist during firing: align soldier model directly towards the target/shot direction
  if (life.soldier && player.rec.fires) {
    const activeFire = player.rec.fires.find(f => Math.abs(t - f.t) <= 0.8);
    if (activeFire && activeFire.dir) {
      const dirVec = new THREE.Vector3(activeFire.dir[0], 0, -activeFire.dir[2]).normalize();
      const lookTarget = group.position.clone().add(dirVec);
      group.lookAt(lookTarget.x, group.position.y, lookTarget.z);
    }
  }
  setGhost(entity, !replicated);
  const hp = hpAt(life, t);
  entity.hp = hp;
  const wrecked = Boolean(entity.wreck) && hp !== null && hp <= 0;
  entity.normal.visible = !wrecked;
  if (entity.wreck) entity.wreck.visible = wrecked;
  if (entity.anim && !wrecked) setGaitPose(entity, t);
}
