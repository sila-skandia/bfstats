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
// (1.28), 667 on the MiG-29 (1.5). The step context carries no pace, and a
// pilot cannot weigh it off its own flight (the plane's accelerations do
// not separate gravity from lift and thrust cleanly enough), but one thing
// it is handed is shrunk by it: its gun. A jet fights with its own cannon
// (`ownGun`), one barrel on the nose (no convergence), and is shown it at
// its muzzle speed over the pace; the school's wing guns converge. So the
// pace is the cannon's real muzzle speed over the one the pilot is shown,
// or a pace the context gives (`c.pace`) where one does.

import { heading, climbing } from './dogfight-pilot.js';
import { pointNose, clamp, pitchOf } from './dogfight-flight.js';

const DEG = Math.PI / 180;

/** Where a wing makes no lift at all, real metres (the flight law's). */
export const LIFT_CEILING = 1000;
/** The muzzle speed of a jet's own cannon (m/s): every published Desert
 *  Combat jet's (`tests/fixtures/dc-jets.json`), the F-16's and the MiG-29's. */
export const JET_CANNON = 1000;
/** The school's wing guns (`dogfight-pilot.js` `gunOf`). */
const SCHOOL_GUN = 400;

/** The airframe's pace as its pilot's numbers show it: `c.pace` where the
 *  context gives one, else read off the gun it thinks with. Never under 1. */
export function paceOf(c) {
  if (Number.isFinite(c.pace) && c.pace >= 1) return c.pace;
  const g = c.gun ?? c.pilot?.gun;
  if (!g || !(g.speed > 0)) return 1;
  const own = !(g.converge > 0.05);
  return Math.max(1, (own ? JET_CANNON : SCHOOL_GUN) / g.speed);
}

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
