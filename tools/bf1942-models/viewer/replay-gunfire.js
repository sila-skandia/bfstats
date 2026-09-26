// A ray cast against the replayed hulls, so a round the page fires (a
// replayed shot through the page's own guns) stops on a replayed tank the
// way it stops on a level one: the impact effect on its hull, never a hit
// point billed (map.html skips the replay's rounds in `guns.onImpact`).

import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const raycaster = new THREE.Raycaster();

/** A node the level placed as one of its spawner vehicles: under the level
 *  glb's `spawners` group (`level-statics.js` `indexScene`). */
function isBakedVehicle(node) {
  for (let n = node?.parent; n; n = n.parent) {
    if (n.userData?.kind === 'spawners' || n.name === 'spawners') return true;
  }
  return false;
}

/**
 * Keep the replay's rounds meeting what the replay draws, whenever the
 * level's collider turns up: the page hands the guns their collider when its
 * terrain is built (`guns.useLevel`), which can be after the replay is.
 *
 * - The replayed hulls, through the collider's `dynamicCast`.
 * - Not the level's own placed vehicles. A replay hides them (the recording's
 *   hulls stand in for them), but their hulls stay in the collision index, so
 *   a round leaving a replayed Defgun's barrel started inside the hidden
 *   baked Defgun and went off there, and a parked tank's hull stopped rounds
 *   at its spawn long after the recorded one drove off. A placed vehicle with
 *   a deck (a carrier, a destroyer) keeps its hull: its deck is the ground a
 *   replayed plane parks on (`groundHeight`).
 *
 * Returns how many baked hulls it took out of the rounds' way (the first
 * time it sees a collider), else 0.
 */
export function syncReplayCollision(player) {
  const collider = player.ctx.guns?.collider;
  if (!collider) return 0;
  player.castHulls ??= (ox, oy, oz, dx, dy, dz, maxDist, skipOwner) =>
    dynamicCast(player, ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
  if (collider.dynamicCast !== player.castHulls) collider.dynamicCast = player.castHulls;
  if (player.bakedCollisionOf === collider) return 0;
  player.bakedCollisionOf = collider;
  const statics = collider.statics;
  if (!statics?.ownerNodes) return 0;
  const decks = new Set();
  if (statics.drivable) {
    for (let tri = 0; tri < statics.owners.length; tri++) {
      if (statics.drivable[tri]) decks.add(statics.owners[tri]);
    }
  }
  let off = 0;
  statics.ownerNodes.forEach((node, id) => {
    if (decks.has(id) || !isBakedVehicle(node)) return;
    statics.disableOwner(id);
    off += 1;
  });
  return off;
}

export function dynamicCast(player, ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
  if (!player.hulls?.size) return null;
  raycaster.set(_origin.set(ox, oy, oz), _dir.set(dx, dy, dz).normalize());
  raycaster.near = 0.01;
  raycaster.far = maxDist;
  let best = null;
  let bestDist = maxDist;
  for (const hull of player.hulls.values()) {
    if (!hull.group.visible || hull.ghost) continue;
    if (skipOwner === hull.ownerTag) continue;
    const target = hull.wreck?.visible ? hull.wreck : hull.scene;
    const hits = raycaster.intersectObject(target, true);
    const hit = hits.find(h => h.object.visible !== false);
    if (!hit || hit.distance >= bestDist) continue;
    bestDist = hit.distance;
    let nx = 0, ny = 1, nz = 0;
    if (hit.face) {
      _normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      const n = hit.face.normal.clone().applyNormalMatrix(_normalMatrix).normalize();
      nx = n.x; ny = n.y; nz = n.z;
    }
    best = {
      t: hit.distance, x: hit.point.x, y: hit.point.y, z: hit.point.z,
      nx, ny, nz,
      // 61: the armour the level's own hulls carry; the impact effect is
      // the steel one.
      material: 61, owner: hull.ownerTag, kind: 'object',
    };
  }
  return best;
}
