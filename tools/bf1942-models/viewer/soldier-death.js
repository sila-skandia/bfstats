// Which death a soldier plays: the engine's own choice, read out of
// `BFSoldier::handleDamage(float)` (lnxded `0x08270980`), over the clips
// `extract_pose.py --die` bakes into `poses/gaits/die.gait.glb`.
//
// The engine picks the pair once, on the killing blow, from four things it
// knows about the soldier at that moment, in this order:
//
//   1. he has a parent (`this+0x50`, a seat)      -> `Ub_DieInVehicle`, UPPER ONLY
//                                                    (`0x08270bd0`: one
//                                                    `setAnimationState(1, ...)`;
//                                                    the legs keep the seat's
//                                                    lower state)
//   2. state bit 0x10 (`this+0x3e6`, the canopy)  -> `Lb_/Ub_ParachuteDie`
//   3. the lower state has `c_AsmIsSwimming`      -> `Lb_/Ub_DieSwim`
//   4. the lower state is `Lb_ParachuteFall`      -> `Lb_/Ub_DieHitGround`
//   5. `getPose()`:
//        crouching (1) -> `Die{Chest,Back}Crouch`
//        lying     (2) -> `DieLie`
//        standing  (0) -> `DieHead` when the round's bone is `Bip01 Head`
//                         (template `+0x290`), else 1 in 4 `DieSlow`
//                         (`rand() & 3 == 0`), else `Die{Chest,Back}Stand`
//
// "Back" is index 1 of each pair and is taken when the round travelled the way
// the soldier faces: `SkeletonCollisionMesh::getLatestCollision` hands back the
// ray segment `getDistanceToGeometry` was called with (`0x083aeb10` stores its
// second Vec3 argument at `+0x24`, the bone at `+0x30`), and `handleDamage`
// takes Back when that vector dotted with the soldier's forward row (matrix
// `+0x20`) is positive. So Back is "shot in the back", which is why those clips
// pitch the body forward.
//
// The collision is the mesh's LATEST one, not this blow's: a man shot and then
// killed by a grenade falls by the bullet. A blow with no skeleton collision at
// all (`bone < 0`) leaves Back off, which is Chest.
//
// `Lb_DieByVehicle` is cached on the template (`+0x270`) and nothing in lnxded
// reads it back -- all 802 `BFSoldier`, `BFSoldierTemplate` and `GameServer`
// functions were swept (ledger DIE-6) -- so the server never enters it; it is
// baked and bound but never chosen here. Neither is
// `Lb_DieInVehicle`, which the script declares and `handleDamage` never enters.
//
// Free of `three` and of the DOM, so `tests/soldier_death_harness.mjs` runs it
// under node.

import { isHeadBone } from './skeleton-hit.js';

/** `ObjectTemplate.timeToLiveAfterDeath 10`, `CommonSoldierData.inc`: how long
 *  the corpse is drawn after the blow. */
export const CORPSE_SECONDS = 10;

/** The corpse time a published tree carries (`gaits.json`
 *  `soldierBody.timeToLiveAfterDeath`), else the vanilla 10 s. */
export function corpseSeconds(soldierBody) {
  const v = soldierBody?.timeToLiveAfterDeath;
  return Number.isFinite(v) && v > 0 ? v : CORPSE_SECONDS;
}

/**
 * The height above the feet from which a round counts as a head hit, standing,
 * for a round that met the stand-in sphere rather than a drawn skeleton.
 * **Viewer stand-in, not engine data**, used only where no rig is drawn (the
 * headless runner). A drawn body is tested against the engine's own capsules
 * (`skeleton-hit.js`), whose `Bip01_Head` bone is the head. 0.2 m under the
 * standing eye (`EYE_HEIGHT[0]`, 1.65 m).
 */
export const HEAD_HIT_FLOOR = 1.45;

/**
 * Death family -> the two baked clips. `upper` alone for the seated death,
 * whose lower half is the seat's own clip.
 */
export const DIE_CLIPS = Object.freeze({
  dieChestStand: Object.freeze({ lower: 'Lb_DieChestStand', upper: 'Ub_DieChestStand' }),
  dieBackStand: Object.freeze({ lower: 'Lb_DieBackStand', upper: 'Ub_DieBackStand' }),
  dieChestCrouch: Object.freeze({ lower: 'Lb_DieChestCrouch', upper: 'Ub_DieChestCrouch' }),
  dieBackCrouch: Object.freeze({ lower: 'Lb_DieBackCrouch', upper: 'Ub_DieBackCrouch' }),
  dieLie: Object.freeze({ lower: 'Lb_DieLie', upper: 'Ub_DieLie' }),
  dieHead: Object.freeze({ lower: 'Lb_DieHead', upper: 'Ub_DieHead' }),
  dieSlow: Object.freeze({ lower: 'Lb_DieSlow', upper: 'Ub_DieSlow' }),
  dieHitGround: Object.freeze({ lower: 'Lb_DieHitGround', upper: 'Ub_DieHitGround' }),
  dieByVehicle: Object.freeze({ lower: 'Lb_DieByVehicle', upper: 'Ub_DieByVehicle' }),
});

/** The seated death's torso: `handleDamage` enters it by name, upper only. */
export const DIE_IN_VEHICLE_UPPER = 'Ub_DieInVehicle';

/** Every family `deathFamily` can answer, the ones owned elsewhere included
 *  (`parachuteDie` by `parachute.js`, `swimDie` by `swim.js`). */
export const DEATH_FAMILIES = Object.freeze(new Set([
  ...Object.keys(DIE_CLIPS), 'dieInVehicle', 'parachuteDie', 'swimDie',
]));

/**
 * Did the round come from behind? `travel` is the round's direction of travel
 * (any length), `yaw` the soldier's, in the page's convention: forward is
 * `(sin yaw, 0, cos yaw)`. The engine dots the full 3-vector with the forward
 * row, which has no y, so the vertical part never matters. Null or zero
 * `travel` is "no collision": not from behind.
 */
export function hitFromBehind(travel, yaw) {
  if (!travel || !Number.isFinite(yaw)) return false;
  const dot = travel[0] * Math.sin(yaw) + travel[2] * Math.cos(yaw);
  return dot > 0;
}

/** Was the latest round a head shot? The bone it met when the round met a
 *  skeleton (`hit.bone`); the height band (`HEAD_HIT_FLOOR`) when it met the
 *  stand-in sphere; no when there was no round. Takes a `roundHit`, or a bare
 *  height above the feet. */
export function isHeadHit(hit) {
  if (hit != null && typeof hit === 'object') {
    if (hit.bone != null) return isHeadBone(hit.bone);
    hit = hit.height;
  }
  return Number.isFinite(hit) && hit >= HEAD_HIT_FLOOR;
}

/**
 * What the soldier's latest skeleton collision says, from a round's origin and
 * the point it met him: `{ travel, height, bone, seated }`, which is what
 * `deathFamily` reads. `feetY` is the soldier's feet (for a seated man, the
 * feet of his stand-in body); `bone` the capsule it met (`skeleton-hit.js`),
 * null off the stand-in sphere; `seated` says the round met a man in his
 * seat, so the damage is his rather than his hull's.
 */
export function roundHit(origin, at, feetY, seated = false, bone = null) {
  if (!origin || !at) return null;
  const travel = [at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]];
  if (!(Math.hypot(travel[0], travel[1], travel[2]) > 1e-6)) return null;
  return { travel, height: Number.isFinite(feetY) ? at[1] - feetY : null,
           bone: bone ?? null, seated: !!seated };
}

/**
 * The family the killing blow plays, in `handleDamage`'s order.
 *
 * `seated`, `parachuteOpen`, `swimming`, `freeFall` are the four whole-body
 * tests; `stance` is `'stand' | 'crouch' | 'prone'` (`getPose` 0/1/2); `hit`
 * is the soldier's latest collision (`roundHit`), or null; `yaw` his heading;
 * `rand` a `[0, 1)` source for the 1-in-4 slow death.
 */
export function deathFamily({
  seated = false, parachuteOpen = false, swimming = false, freeFall = false,
  stance = 'stand', hit = null, yaw = 0, rand = Math.random,
} = {}) {
  if (seated) return 'dieInVehicle';
  if (parachuteOpen) return 'parachuteDie';
  if (swimming) return 'swimDie';
  if (freeFall) return 'dieHitGround';
  const back = hitFromBehind(hit?.travel ?? null, yaw);
  if (stance === 'crouch') return back ? 'dieBackCrouch' : 'dieChestCrouch';
  if (stance === 'prone') return 'dieLie';
  if (isHeadHit(hit)) return 'dieHead';
  // `rand() & 3`: nonzero three times in four keeps the chest/back pair.
  if (Math.floor(rand() * 4) === 0) return 'dieSlow';
  return back ? 'dieBackStand' : 'dieChestStand';
}

/**
 * What to play when a death family's clips did not bind. A standing corpse is
 * worse than none, so no chain reaches a locomotion family: the caller hides
 * the body when this returns null.
 */
export function resolveDeathFamily(want, bound) {
  const chain = {
    dieBackStand: ['dieBackStand', 'dieChestStand'],
    dieHead: ['dieHead', 'dieChestStand'],
    dieSlow: ['dieSlow', 'dieChestStand'],
    dieChestCrouch: ['dieChestCrouch', 'dieChestStand'],
    dieBackCrouch: ['dieBackCrouch', 'dieChestCrouch', 'dieChestStand'],
    dieLie: ['dieLie', 'dieChestStand'],
    dieHitGround: ['dieHitGround', 'dieChestStand'],
    dieByVehicle: ['dieByVehicle', 'dieChestStand'],
  }[want] ?? [want];
  if (typeof bound !== 'function') return chain[0];
  for (const name of chain) if (bound(name)) return name;
  return null;
}
