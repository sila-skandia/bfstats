// A ray cast against the replayed hulls, so a round the page fires (a
// replayed shot through the page's own guns) stops on a replayed tank the
// way it stops on a level one: the impact effect on its hull, never a hit
// point billed (map.html skips the replay's rounds in `guns.onImpact`).

import * as THREE from 'three';
import { hullRadius } from './replay-camera.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const raycaster = new THREE.Raycaster();
/** Metres a hull may have moved since its matrices were last written: the
 *  broadphase sphere below is that much wider than the hull. */
const SPHERE_SLACK = 3;

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

/**
 * The hulls drawn this frame, rebuilt when the replay's clock moves (the
 * same moment the set can change) or a hull is built. A round's cast used to
 * walk every hull life of the round (4,661 on Manchuria) to find the 157
 * drawn, for every round, every tick.
 */
function drawnHulls(player) {
  const c = (player._drawnHulls ??= { time: NaN, size: -1, list: [] });
  if (c.time === player.time && c.size === player.hulls.size) return c.list;
  c.time = player.time;
  c.size = player.hulls.size;
  c.list.length = 0;
  for (const hull of player.hulls.values()) {
    if (!hull.group.visible || hull.ghost) continue;
    // Where the hull stands, from its root: a placed gun's pose is on its
    // root, not its group, whose position stays at the origin.
    hull.root.getWorldPosition(hull.castCentre ??= new THREE.Vector3());
    hull.castRadius ??= hullRadius(hull);
    c.list.push(hull);
  }
  return c.list;
}

/** Whether the ray from (ox, oy, oz) along the unit (dx, dy, dz), `maxDist`
 *  long, comes within `r` of the point (cx, cy, cz). */
function rayNearsSphere(ox, oy, oz, dx, dy, dz, maxDist, cx, cy, cz, r) {
  const px = cx - ox, py = cy - oy, pz = cz - oz;
  const along = px * dx + py * dy + pz * dz;
  if (along < -r || along > maxDist + r) return false;
  const dx2 = px - dx * along, dy2 = py - dy * along, dz2 = pz - dz * along;
  return dx2 * dx2 + dy2 * dy2 + dz2 * dz2 <= r * r;
}

export function dynamicCast(player, ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
  if (!player.hulls?.size) return null;
  _dir.set(dx, dy, dz).normalize();
  raycaster.set(_origin.set(ox, oy, oz), _dir);
  raycaster.near = 0.01;
  raycaster.far = maxDist;
  let best = null;
  let bestDist = maxDist;
  for (const hull of drawnHulls(player)) {
    if (skipOwner === hull.ownerTag) continue;
    // The hull's bounding sphere first (its radius measured once on its
    // model, the bullet catchers under an FHSW tank left out): the full
    // recursive raycast over a hull's hundreds of meshes ran for every
    // drawn hull, 384 of a cast's 415 microseconds (Manchuria, 2026-11-10:
    // the editor's bullet chase at 5 fps through the planes' strafing).
    const p = hull.castCentre;
    const r = hull.castRadius + SPHERE_SLACK;
    if (!rayNearsSphere(ox, oy, oz, _dir.x, _dir.y, _dir.z, bestDist, p.x, p.y, p.z, r)) continue;
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
