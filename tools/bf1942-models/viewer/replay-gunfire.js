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
/** The armour a hull answers with when its model carries no collision mesh
 *  (every shipped vehicle does; this is for a stripped glb). */
const HULL_MATERIAL = 61;
/** The material a round passes through (`static-index.js`). */
const NON_SOLID = 90;
const CATCHER = /catcher/i;

/**
 * A hull's collision meshes, found once: `{ meshes, dominant }`, the glb's
 * collision primitives (invisible nodes whose geometry carries the
 * `defenseMaterial` of its faces) and the material most of its faces have.
 * The cubes FHSW hangs under a hull to stop a ranging gun's rounds are not
 * the hull.
 */
export function collisionPartsOf(hull) {
  if (hull.collisionParts) return hull.collisionParts;
  const meshes = [];
  const tris = new Map();
  hull.scene?.traverse(o => {
    if (!o.isMesh || !o.geometry?.userData?.collision) return;
    const material = Number(o.geometry.userData.defenseMaterial);
    if (!Number.isFinite(material)) return;
    for (let n = o; n; n = n.parent) if (CATCHER.test(n.name ?? '')) return;
    const count = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    // The wheels' one-face suspension probes are not the hull's skin.
    if (count <= 2) return;
    meshes.push(o);
    if (material !== NON_SOLID) tris.set(material, (tris.get(material) ?? 0) + count);
  });
  let dominant = null;
  let most = 0;
  for (const [material, count] of tris) {
    if (count > most) { most = count; dominant = material; }
  }
  return (hull.collisionParts = { meshes, dominant });
}

const _relative = new THREE.Matrix4();
const _relPos = new THREE.Vector3();
const _relQuat = new THREE.Quaternion();
const _relScale = new THREE.Vector3();
const _frame = new THREE.Quaternion();
const _minusZ = new THREE.Vector3(0, 0, -1);

/** The FireArms node `muzzle` belongs to (itself, else its nearest ancestor
 *  that carries `fireArms`), or null. */
function fireArmsOf(muzzle) {
  for (let n = muzzle; n; n = n.parent) {
    if (n.userData?.fireArms) return n;
  }
  return null;
}

/**
 * The `aimRay` of a recorded hand-weapon shot, barrel by barrel. `ray` is
 * the recorded launch (`origin`, `dir`: the eye and the weapon's aim, which a
 * server row names once however many barrels the pull fires). The engine
 * turns that frame by each barrel's own `addFireArmsPosition` rotation and
 * moves it by its offset (`fireBarrel`, ledger XHIT-12 and XHIT-16), and a
 * shotgun's pellet pattern is those turns: the Secret Weapons shotgun's five
 * barrels are five pellets that leave a degree or so apart. Every barrel
 * fired down the one recorded ray was five pellets on one line and one
 * impact on the wall. `hand-aim.js` `handAimRay` is the play page's, this the
 * replay's: a gun with one barrel at its origin and no turn answers `ray`
 * itself.
 */
export function barrelAimRay(ray) {
  const out = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
  return muzzle => {
    out.origin.copy(ray.origin);
    out.dir.copy(ray.dir);
    const node = fireArmsOf(muzzle);
    if (!node || muzzle === node) return out;
    muzzle.updateWorldMatrix(true, false);
    node.updateWorldMatrix(true, false);
    _relative.copy(node.matrixWorld).invert().multiply(muzzle.matrixWorld).decompose(_relPos, _relQuat, _relScale);
    _frame.setFromUnitVectors(_minusZ, ray.dir).multiply(_relQuat);
    out.dir.copy(_minusZ).applyQuaternion(_frame);
    out.origin.add(_relPos.applyQuaternion(_frame));
    return out;
  };
}

/**
 * Whether recorded shot `f` is the row that fires `group`'s pull. The server
 * writes one `f` a barrel, and `guns.fireShot` fires every barrel of a
 * multi-barrel gun that is not `asynchronyFire` (BOMB-1), so firing it once a
 * row fired every barrel once for each: 25 pellets from the shotgun's five
 * rows, all on the same line. Only a pull's first row (`f.barrel`, numbered
 * as the recording is read: replay-recording.js `numberBarrels`) fires it.
 */
export function leadsPull(group, f) {
  const barrels = group?.muzzles?.length ?? 1;
  if (barrels < 2 || group.stats?.asynchronyFire) return true;
  return !(f?.barrel > 0) || f.barrel % barrels === 0;
}

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
    // What the engine collides a round with is the hull's collision mesh,
    // not the model it is drawn as: its faces carry the material (the
    // vehicle's own: a jeep's 45, a tank's plates), and the impact effect is
    // that material's, not one steel plate for every hull. A face of
    // material 90 is not solid to a round (`NON_SOLID_MATERIAL`).
    const parts = collisionPartsOf(hull);
    let hit = null;
    let material = HULL_MATERIAL;
    if (parts.meshes.length) {
      hit = raycaster.intersectObjects(parts.meshes, false)
        .find(h => Number(h.object.geometry.userData.defenseMaterial) !== NON_SOLID);
      if (hit) material = Number(hit.object.geometry.userData.defenseMaterial);
    }
    if (!hit) {
      // Nothing of the collision mesh on the line: what is drawn there (a
      // gun barrel, an aerial) is struck as the hull's own material.
      const target = hull.wreck?.visible ? hull.wreck : hull.scene;
      hit = raycaster.intersectObject(target, true).find(h => h.object.visible !== false && !h.object.geometry?.userData?.collision);
      if (hit) material = parts.dominant ?? HULL_MATERIAL;
    }
    if (!hit || hit.distance >= bestDist) continue;
    bestDist = hit.distance;
    let nx = 0, ny = 1, nz = 0;
    if (hit.face) {
      _normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      const n = hit.face.normal.clone().applyNormalMatrix(_normalMatrix).normalize();
      if (n.dot(_dir) > 0) n.negate();
      nx = n.x; ny = n.y; nz = n.z;
    }
    best = {
      t: hit.distance, x: hit.point.x, y: hit.point.y, z: hit.point.z,
      nx, ny, nz,
      material, owner: hull.ownerTag, kind: 'object',
    };
  }
  return best;
}
