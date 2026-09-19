// How much of a blast a soldier actually catches: the engine's line-of-sight
// sampling, HP-10.
//
// An explosion reaches a vehicle through `VehicleDamageSet.applySplash`, which
// walks registered vehicles — and the man on foot is not one of them, so until
// now a grenade at his feet cost him nothing. The engine's soldier path is not
// the vehicle path with a different victim: it is a whole extra mechanism that
// multiplies the linear distance falloff by a fraction of rays that got
// through.
//
//     GameServer::handleExplosionOnObject   0x08156500
//       edi = 1.0f                          0x08156505   the exposure, seeded
//       ... victim is a soldier ...
//       call checkForHitOnSoldier           0x08156eb6
//       edi = result                        0x08156ece
//       if (exposure == 0.0) return 0       0x08156ede   short-circuit
//       damage = t * dmg * mod * edi        0x081566b4   `fmulp`
//
// `GameServer::checkForHitOnSoldier(Pos3 blast, float, BFSoldier*, IObject*)`
// (`0x08156090`) was read end to end for this module. It is three copies of
// one loop, chosen by `BFSoldier::getPose()` (`0x0827ddc0`), and each copy
// walks a static table of `Vec3` offsets, adds each to the soldier's
// `getPos()` (IObject vtable `+0x38`, called at `0x0815612d`), and asks
// `checkIfRayHitsSoldier(blast, sample - blast, soldier, source)`
// (`0x0815b5e0`) whether the segment is clear. The count of clear segments is
// `fild`ed and divided by a constant.
//
//   pose 0  standing   table 0x0871bac0   9 samples   divisor 18.0  (0x86c08d0)
//   pose 1  crouching  table 0x0871ba40   9 samples   divisor  9.0  (0x86c08cc)
//   pose 2  prone      table 0x0871ba00   3 samples   divisor  3.0  (0x86c08c8)
//   anything else                          a Debug line, then `fldz`  0x08156298
//
// Three things in that list are worth stating outright, because each one is a
// thing a reconstruction gets wrong:
//
//  1. **The standing and crouching tables are byte-identical.** All 108 bytes.
//     The only difference between a standing man and a crouching one is the
//     divisor, so a fully exposed standing soldier scores exactly **0.5** and a
//     fully exposed crouching one **1.0**. Crouching in the open takes DOUBLE
//     the splash standing does. That is not a bug to correct: it is one
//     constant, deliberately doubled, and it is the mechanism by which the
//     engine makes standing up the safer thing to do near a grenade.
//  2. **The offsets are never rotated.** The sample point is `getPos() +
//     offset` with no basis change anywhere in the function, so the +-0.2 m
//     (standing/crouch) and +-0.5 m (prone) spread is always along **world X**.
//     A prone soldier lying north-south is sampled across his body; one lying
//     east-west is sampled along it. Reproduced, because it is the engine.
//  3. The offsets are relative to the soldier's **object origin**, which
//     `physics.js` establishes sits `CHARACTER_HEIGHT` (1.0 m) above his feet
//     (`setCharacterHeight -1.00`). So standing samples 0.9 / 0.7 / 0.3 m off
//     the ground, and prone's single row at 0.3 m is exactly the prone camera
//     height (`setPoseCameraPos c_BfSoldierLying 0/-0.7/0`).
//
// WHAT THE RAY IS TESTED AGAINST. `checkIfRayHitsSoldier` does two casts and
// both must come back clear:
//
//   * world objects — a ray query on `ds:0x871dc24` vtable `+0x48`
//     (`0x0815b677`) with a filter holding the root parent of the source
//     object and mask `0x200`. A hit that is **not the soldier himself**
//     returns false (`0x0815b689`); no hit, or a hit on the soldier, continues.
//   * the terrain — `dice::ref2::geom::terrainBase` (`ds:0x87435f0`, the same
//     global the combat area reads), a collision interface off vtable `+0x8`
//     and then a segment test at `+0xc` (`0x0815b811`). A hit returns false;
//     no hit returns **true**, and so does a terrain with no collision
//     interface at all (`0x0815b821`).
//
// ONE ENGINE SLIP, READ AND NOT REPRODUCED. When the sample sits **below** the
// blast (`dir.y < 0`, the `fucom` at `0x0815b6f6` and `test ah,0x45` at
// `0x0815b70c`) the terrain cast is flipped to point upward — the standard
// trick — but the origin is computed as `from - dir` (`fsub st,st(3)` at
// `0x0815b723`, and again at `0x0815b72a`/`0x0815b72e`) where flipping the
// segment `[A, A+d]` correctly gives `[A+d, -d]`. `from - dir` is the sample
// MIRRORED through the blast, so for any sample below the explosion the
// terrain half of the test runs on a segment that never touches the real path.
// The object half is unaffected — it always uses the true `from`/`dir` — so a
// wall still blocks. This module casts the real segment: reproducing the slip
// would let a grenade on a roof kill a man on the floor below through the
// terrain, which is a worse lie than the one it fixes. Named here with its
// addresses so the next reader does not rediscover it as a difference.
//
// Free of `three` and of the DOM: the collider arrives as a callback, so
// `tests/soldier_exposure_harness.mjs` runs the real thing under node.

/** `BFSoldier::getPose()`'s three answers (`0x0827ddc0`, flags 0x20 / 0x40). */
export const POSE_STAND = 0;
export const POSE_CROUCH = 1;
export const POSE_PRONE = 2;

/**
 * The three sample tables, verbatim, as `[dx, dy, dz]` triples.
 *
 * Read out of `bf1942_lnxded.static` at `0x0871bac0` (standing), `0x0871ba40`
 * (crouching) and `0x0871ba00` (prone). The standing and crouching blocks are
 * the same 108 bytes — see the module note.
 */
const TORSO_COLUMN = Object.freeze([
  Object.freeze([0.0, -0.10000000149011612, 0.0]),
  Object.freeze([0.0, -0.30000001192092896, 0.0]),
  Object.freeze([0.0, -0.699999988079071, 0.0]),
  Object.freeze([-0.20000000298023224, -0.10000000149011612, 0.0]),
  Object.freeze([-0.20000000298023224, -0.30000001192092896, 0.0]),
  Object.freeze([-0.20000000298023224, -0.699999988079071, 0.0]),
  Object.freeze([0.20000000298023224, -0.10000000149011612, 0.0]),
  Object.freeze([0.20000000298023224, -0.30000001192092896, 0.0]),
  Object.freeze([0.20000000298023224, -0.699999988079071, 0.0]),
]);

/** `0x0871ba00`: three points in a row across the body at prone camera height. */
const PRONE_ROW = Object.freeze([
  Object.freeze([0.0, -0.699999988079071, 0.0]),
  Object.freeze([-0.5, -0.699999988079071, 0.0]),
  Object.freeze([0.5, -0.699999988079071, 0.0]),
]);

/** Indexed by pose. Standing and crouching share the table, by the engine's own bytes. */
export const EXPOSURE_SAMPLES = Object.freeze([TORSO_COLUMN, TORSO_COLUMN, PRONE_ROW]);

/**
 * The divisor each loop's hit count is divided by, indexed by pose.
 *
 * `fdiv ds:0x86c08d0` (18.0), `ds:0x86c08cc` (9.0), `ds:0x86c08c8` (3.0) at
 * `0x08156207`, `0x081563d2` and `0x081564f2`. **18 against nine samples** is
 * the standing cap.
 */
export const EXPOSURE_DIVISOR = Object.freeze([18, 9, 3]);

/** The most a soldier in that pose can score: 0.5 standing, 1.0 otherwise. */
export const MAX_EXPOSURE = Object.freeze([
  EXPOSURE_SAMPLES[0].length / EXPOSURE_DIVISOR[0],
  EXPOSURE_SAMPLES[1].length / EXPOSURE_DIVISOR[1],
  EXPOSURE_SAMPLES[2].length / EXPOSURE_DIVISOR[2],
]);

/** Is this a pose `checkForHitOnSoldier` has a table for? */
export function knownPose(pose) {
  return pose === POSE_STAND || pose === POSE_CROUCH || pose === POSE_PRONE;
}

/**
 * The exposure of a soldier at `origin` to a blast at `blast`, in `[0, 1]`.
 *
 * `origin` is the soldier's **object origin**, not his feet — a caller with a
 * feet position adds `physics.js`'s `CHARACTER_HEIGHT`. `blocked` is
 * `(ox, oy, oz, dx, dy, dz, distance) -> boolean`, true when something stands
 * between the blast and that sample; `worldBlocker` below builds one from a
 * `collision.js` collider.
 *
 * A pose the engine has no table for returns **0**, which is what its Debug
 * branch does (`fldz`, `0x08156298`) and which the caller must then treat as
 * the short-circuit it is.
 */
export function soldierExposure(blast, origin, pose, blocked) {
  if (!knownPose(pose)) return 0;
  const samples = EXPOSURE_SAMPLES[pose];
  const divisor = EXPOSURE_DIVISOR[pose];
  let hits = 0;
  for (const [ox, oy, oz] of samples) {
    // sample = getPos() + offset, world axes, never rotated.
    const sx = origin.x + ox;
    const sy = origin.y + oy;
    const sz = origin.z + oz;
    const dx = sx - blast.x;
    const dy = sy - blast.y;
    const dz = sz - blast.z;
    const distance = Math.hypot(dx, dy, dz);
    // A sample sitting exactly on the blast has no segment to test and the
    // engine's own ray query gets a zero-length direction; count it as clear.
    if (!(distance > 1e-6)) { hits++; continue; }
    if (!blocked(blast.x, blast.y, blast.z,
                 dx / distance, dy / distance, dz / distance, distance)) {
      hits++;
    }
  }
  return hits / divisor;
}

/**
 * The world positions a given pose would be sampled at — for a debug overlay,
 * and for a test that wants to assert where rather than how many.
 */
export function exposurePoints(origin, pose) {
  if (!knownPose(pose)) return [];
  return EXPOSURE_SAMPLES[pose].map(([ox, oy, oz]) => [
    origin.x + ox, origin.y + oy, origin.z + oz,
  ]);
}

/**
 * A `blocked` callback over a `collision.js` `WorldCollider`.
 *
 * Duck-typed on `cast` alone so this module still imports nothing.
 *
 * **Water does not block.** The engine's two casts are against world objects
 * and against `terrainBase`; the sea is neither, and it has no collision
 * interface of its own. `WorldCollider.cast` does test the water plane, so a
 * grenade thrown into the shallows would otherwise be shielded from a man
 * standing in it by the surface between them.
 *
 * `skipOwner` is the collider's owner id for the firer, matching the root
 * parent the engine puts in its ray filter (`0x0815b616`).
 *
 * `slack` pulls the far end of the segment in by a few millimetres: the sample
 * points sit on the soldier, and a soldier standing against a wall has his own
 * sample essentially on the surface. Without it the wall he is leaning on
 * counts as cover from a grenade at his own feet.
 */
export function worldBlocker(collider, { skipOwner = -1, slack = 0.02 } = {}) {
  if (!collider || typeof collider.cast !== 'function') return () => false;
  return (ox, oy, oz, dx, dy, dz, distance) => {
    const reach = distance - slack;
    if (!(reach > 0)) return false;
    const hit = collider.cast(ox, oy, oz, dx, dy, dz, reach, skipOwner);
    if (!hit) return false;
    if (hit.kind === 'water') return false;
    return true;
  };
}
