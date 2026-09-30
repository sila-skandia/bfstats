// The hand weapon's recoil: the kick a shot puts into the soldier's aim, and
// the way it springs back (lnxded; ledger FA-2..FA-5).
//
// A shot does not move the view. `BFSoldier::calcRecoil` (0x0827e2f0, from
// `FireArms::Fire` 0x0828a3d9 and `FireArms::handleUpdate` 0x08289532 for a
// soldier's weapon) only draws two amounts and arms a counter:
//
//   pitch  (+0x548) = recoilForceUp        (template +0x308..+0x314)
//   yaw    (+0x54c) = recoilForceLeftRight (template +0x31c..+0x328)
//   count  (+0x544) = goBackOnRecoil ? 20 : 8     (template +0x331)
//
// each CRD drawn by `Random::getContinuousRandom`, a uniform between its two
// values for every shipped weapon, with nothing drawn at all unless
// `setHasRecoilForce` (template +0x330) is set. A new shot overwrites all three.
// Then every 30 Hz tick while the counter is not zero,
// `BFSoldier::handlePlayerInput` (0x08275c17..0x08275c97) ADDS
//
//   yawRecoil()   = yaw   x table[count] x devMod    to c_PIMouseLookX
//   pitchRecoil() = pitch x table[count] x devMod    to c_PIMouseLookY
//
// and decrements the counter, AFTER the zoom factor has scaled the mouse and
// BEFORE the look law turns the view (`pitch -= y`, `yaw -= 3x`, the +-38
// clamp: `mouse-input.js`). `devMod` is `HandFireArms::getDevMod` 0x08294400,
// the weapon's `setDevMod` entry for the soldier's pose (1 when it declares
// none); zoom does not enter. The tables are `recoilTabel` 0x0872ee20 (with
// goBack) and `recoilTabel2` 0x0872ee80 (without), read from index `count`
// down to 1:
//
//   recoilTabel   20..13: -0.2 -0.16 -0.13 -0.1 -0.07 -0.05 -0.03 -0.01  (sum -0.75)
//                 12..1:   0.01 0.03 0.05 0.07 0.09 0.12 0.12 0.09 0.07 0.05 0.03 0.02
//                                                                          (sum +0.75)
//   recoilTabel2   8..1:  -0.2 -0.16 -0.13 -0.1 -0.07 -0.05 -0.03 -0.01  (sum -0.75)
//
// So a shot kicks 0.75 of its drawn amount over eight ticks (0.27 s), and a
// `goBack` weapon then returns exactly that over the next twelve (0.4 s),
// bell-shaped: the aim comes back to where it was before the shot plus
// whatever the player's own mouse did meanwhile, since both ride the same
// axis. A shot inside those 20 ticks restarts the ride and drops what was
// left of the return, so a fast semi-automatic or a burst still climbs. A
// weapon without `goBack` keeps its kick: vanilla's BAR, DP, Johnson, StG 44
// and Type 99, and 20 of DC Final's 26 (its pistols, the Tabuk and the
// Remington go back). `goBackOnRecoil` defaults TRUE (the template ctor writes 1
// at 0x0828d85e; `makeScript` prints only `setGoBackOnRecoil 0`); an absent
// `setRecoilForceUp` is a fixed 1.0 and an absent left-right 0.
//
// Free of the DOM and of `three`: `tests/recoil_harness.mjs` drives it.

/** `recoilTabel`, 0x0872ee20: the goBack ride, read from 20 down to 1. */
export const RECOIL_TABLE = Float32Array.of(
  0, 0.02, 0.03, 0.05, 0.07, 0.09, 0.12, 0.12, 0.09, 0.07, 0.05,
  0.03, 0.01, -0.01, -0.03, -0.05, -0.07, -0.1, -0.13, -0.16, -0.2);
/** `recoilTabel2`, 0x0872ee80: the kick alone, read from 8 down to 1. */
export const RECOIL_TABLE2 = Float32Array.of(
  0, -0.01, -0.03, -0.05, -0.07, -0.1, -0.13, -0.16, -0.2);
/** The counter `calcRecoil` arms: `((goBack != 0) - 1 & -12) + 20`. */
export const GO_BACK_TICKS = 20;
export const KICK_TICKS = 8;

/** The three-wide `setDevMod` order, the pose `getDevMod` indexes by. */
const POSE_INDEX = { stand: 0, crouch: 1, prone: 2 };

/** A uniform draw between a CRD's two values, the way `getContinuousRandom`
 *  draws `CRD_UNIFORM` (and `CRD_NONE`'s fixed value when both are one). */
function draw(range, fallback, rand) {
  if (!Array.isArray(range) || range.length < 1) return fallback;
  const a = Number(range[0]);
  const b = Number(range.length > 1 ? range[1] : range[0]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fallback;
  return a + (b - a) * rand();
}

/**
 * `BFSoldier::calcRecoil`: arm `ride` (reused, never reallocated) for one shot
 * of a weapon whose extracted `recoil` block is `recoil`, drawing with `rand`
 * (0..1). Returns false, leaving any ride in progress alone, when the weapon
 * has no recoil force. `devMod` is the weapon's `setDevMod` triple, or null.
 */
export function calcRecoil(ride, recoil, rand, devMod = null) {
  if (!recoil?.hasForce) return false;
  ride.pitch = Math.fround(draw(recoil.up, 1, rand));
  ride.yaw = Math.fround(draw(recoil.leftRight, 0, rand));
  ride.goBack = recoil.goBack !== false;
  ride.count = ride.goBack ? GO_BACK_TICKS : KICK_TICKS;
  ride.devMod = Array.isArray(devMod) ? devMod : null;
  return true;
}

/** `getDevMod`: the weapon's multiplier for the soldier's pose, 1 without one. */
export function devModFor(devMod, stance) {
  if (!Array.isArray(devMod)) return 1;
  const value = Number(devMod[POSE_INDEX[stance] ?? 0]);
  return Number.isFinite(value) ? value : 1;
}

/**
 * One tick of the ride: what `yawRecoil` and `pitchRecoil` add to the tick's
 * `c_PIMouseLookX` / `c_PIMouseLookY`, written into `out` ({ x, y }), and the
 * counter's decrement. Zero, and nothing counted, once the ride is spent.
 */
export function recoilStep(ride, stance, out) {
  out.x = 0;
  out.y = 0;
  if (!ride?.count) return out;
  const table = ride.goBack ? RECOIL_TABLE : RECOIL_TABLE2;
  const t = table[ride.count] ?? 0;
  const m = devModFor(ride.devMod, stance);
  out.x = ride.yaw * t * m;
  out.y = ride.pitch * t * m;
  ride.count--;
  return out;
}
