// The top of the sky for a jet's pilot (features/dogfight-lessons-jets,
// under-the-height.md and up-and-over.md).
//
// The flight law takes every surface's lift to nothing at 1,000 m
// (`aircraft.js` AIR_DENSITY_ZERO_AT_HEIGHT): half at 500 m, a tenth at
// 900. A Spitfire runs out of speed long before it gets there; a jet does
// not, and a Spitfire's plan flown on one (zoom until slow, pull up until
// slow) climbs straight through it and falls out of it. The jet aces here
// know where it is and level off under it.
//
// A plan sees the fight at the Spitfire's size (`dogfight-duel.js`
// `pilotView`): heights and speeds divided by the airframe's pace. So the
// ceiling in the pilot's numbers is 1,000 m over the pace: 781 on the F-16
// (1.28), 667 on the MiG-29 (1.5). The step context carries the pace
// (`c.pace`: `runDuel`, `runFight`, the live `stepSeat`), the same one the
// shared guard (`dogfight-pilot.js` `guard`) reads its 880 m over. A context
// without one (the school harness's own Spitfire steps) is pace 1.
//
// The guard is the last word: past 880 m real and still climbing, it puts
// the nose on the horizon. What this module adds is the levelling off before
// it, so the jet aces fly a level roof at 800 m instead of being caught by the
// guard on the way through, and an over-the-top height for the loop.

import { heading, climbing } from './dogfight-pilot.js';
import { pointNose, clamp, pitchOf } from './dogfight-flight.js';

const DEG = Math.PI / 180;

/** Where a wing makes no lift at all, real metres (the flight law's). */
export const LIFT_CEILING = 1000;

/** The airframe's pace as its pilot's numbers show it (`c.pace`), 1 where
 *  the context gives none. */
export const paceOf = c => (Number.isFinite(c.pace) && c.pace >= 1 ? c.pace : 1);

/** A real height (metres) in the pilot's numbers. */
export const seenHeight = (c, real) => real / paceOf(c);

/** The real height the jet aces level off at, metres: a fifth of the lift
 *  left, enough to fly on and turn over the top. */
export const ROOF = 800;

/**
 * The steepest climb (degrees, the pilot's numbers) that levels off at
 * `roof` real metres: the climb rate allowed falls with the height left
 * (`tau` seconds of it), so the nose comes down to level as the roof
 * nears, and below level above it. `want` is the plan's own climb; the
 * smaller of the two is flown.
 */
export function roofClimb(c, want, { roof = ROOF, tau = 3.5 } = {}) {
  const left = seenHeight(c, roof) - c.me.position[1];
  const v = Math.max(1, Math.hypot(...c.me.velocity));
  const allowed = Math.asin(clamp(left / tau / v)) / DEG;
  return Math.min(want, allowed);
}

/** Whether the roof is holding the climb down: the climb it allows is
 *  under `deg` degrees. */
export const atRoof = (c, deg = 4, opts = {}) => roofClimb(c, 90, opts) < deg;

/** The path's climb angle, degrees. */
export const pathClimb = c => Math.asin(clamp(c.me.velocity[1] / Math.max(1, Math.hypot(...c.me.velocity)))) / DEG;

/**
 * A plan's answer kept under the roof: where the plane is climbing more
 * steeply than the roof allows, the nose is pushed down onto the allowed
 * climb along its heading instead, wings kept level (rolling inverted to
 * pull it down is slow in thin air), the throttle and the trigger as the
 * plan had them.
 */
export function underRoof(c, out, opts = {}) {
  if (!out) return out;
  const allowed = roofClimb(c, 90, opts);
  // The nose leads the path: a nose coming up through the allowed climb is
  // held there before the path follows it.
  if (allowed >= 60 || Math.max(pathClimb(c), pitchOf(c.me.orientation) - 5) <= allowed + 2) return out;
  const k = pointNose(c.me, climbing(heading(c.me.velocity), allowed), { fine: 60, push: 0.7 });
  return { ...out, pitch: k.pitch, roll: k.roll, rudder: k.rudder };
}
