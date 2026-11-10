// The top of the sky for a jet's pilot (features/dogfight-lessons-jets,
// "The roof").
//
// The flight law takes every surface's lift to nothing at 1,000 m
// (`aircraft.js` AIR_DENSITY_ZERO_AT_HEIGHT): half at 500 m, a tenth at
// 900. A Spitfire runs out of speed long before it gets there; a jet does
// not, and a Spitfire's plan flown on one (zoom until slow, pull up until
// slow) climbs straight through it and falls out of it. So every pilot of
// an airframe paced as a jet flies under a roof: `stepPilot`
// (`dogfight-pilot.js`) passes whatever his plan answers through
// `underRoof`, which levels a climb off by 800 m real (`ROOF`), a fifth of
// the lift left, by capping how hard the plan may pull toward the sky: the
// roll, the rudder and the trigger stay the plan's. The lessons' starts
// stop under it too (`dogfight-duel.js` `pacedHeight`: no start over
// 760 m). The shared guard (`guard`, 880 m real) is still there as the last
// word, and with the roof nobody reaches it: nine starts of every demo and
// move of the nine lessons top out under 810 m on the F-16 and 850 on the
// MiG-29 (`tests/dogfight_jet_harness.mjs --tops`).
//
// A plan sees the fight at the Spitfire's size (`dogfight-duel.js`
// `pilotView`): heights and speeds divided by the airframe's pace. So the
// roof in the pilot's numbers is 800 m over the pace: 625 on the F-16
// (1.28), 533 on the MiG-29 (1.5). The step context carries the pace
// (`c.pace`: `runDuel`, `runFight`, the live `stepSeat`). A context without
// one (the school harness's own Spitfire steps) is pace 1, and the
// Spitfire's pilots are not put under it: they are flown as before, to the
// last decimal.
//
// A pull that is taking the plane over the top of a loop that fits under
// the roof is left alone (`LOOP_ROOM`), and an inverted plane is let pull
// through. A plan can also say its answer is not to be touched (`roof:
// false`): up and over's jet ace does, for a loop it starts at a height of
// its own.

import { clamp, pitchOf, basis, bodyRates } from './dogfight-flight.js';

const DEG = Math.PI / 180;

/** Where a wing makes no lift at all, real metres (the flight law's). */
export const LIFT_CEILING = 1000;

/** The airframe's pace as its pilot's numbers show it (`c.pace`), 1 where
 *  the context gives none. */
export const paceOf = c => (Number.isFinite(c.pace) && c.pace >= 1 ? c.pace : 1);

/** A real height (metres) in the pilot's numbers. */
export const seenHeight = (c, real) => real / paceOf(c);

/** The real height a jet's pilot levels off by, metres: a fifth of the lift
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

/** Over the allowed climb by more than this (degrees), the throttle comes
 *  off: a jet's engine out-pulls its weight, and on full power a nose that
 *  is too high carries the plane up whatever the stick does in thin air. */
const CUT_OVER = 15;
/** Wings nearer the vertical than this (the lift's share that is up or
 *  down), the elevator does not move the nose up or down: it is left. */
const KNIFE = 0.15;
/** How much higher a loop goes than its radius now says: the nose comes
 *  round more slowly as the air thins toward the top. */
const LOOP_ROOM = 1.3;

/**
 * A plan's answer kept under the roof. The roof takes one thing from the
 * plan: how hard it may pull the nose toward the sky. The pull that would
 * put the path on the allowed climb is worked out in the plane's own pitch
 * plane (over the share of its lift that points up, so a banked pilot
 * eases the pull and an inverted one pulls through), less the pitch rate
 * under way, by more on an airframe whose nose answers late (`hand.pitch`):
 * a nose on its way up goes on rising for as long as the stick takes to
 * bite. The plan's own pull is flown wherever it asks for less sky than
 * that. The roll, the rudder and the trigger stay the plan's, so a turn at
 * the roof is still the plan's turn, flatter; well over the allowed climb
 * the throttle comes off too.
 *
 * Every pilot of an airframe paced as a jet flies under it
 * (`dogfight-pilot.js` `stepPilot`), unless his answer says it is going
 * over the top of a loop (`roof: false`).
 */
export function underRoof(c, out, opts = {}) {
  if (!out) return out;
  const allowed = roofClimb(c, 90, opts);
  if (allowed >= 60) return out;
  const { me } = c;
  const q = me.orientation;
  const pitch = pitchOf(q);
  const up = basis(q).U[1];
  // The nose leads the path: 5 degrees of it are the wing's own.
  const climb = Math.max(pathClimb(c), pitch - 5);
  const throttle = climb - allowed > CUT_OVER ? 0 : out.throttle;
  if (Math.abs(up) < KNIFE) return throttle === out.throttle ? out : { ...out, throttle };
  const rate = bodyRates(q, me.angularVelocity ?? [0, 0, 0]).pitch;
  const want = clamp(((allowed - climb) * DEG) / up, -0.6, 0.6);
  const cap = clamp(2.5 * want - 0.55 * (me.hand?.pitch ?? 1) * rate, -0.7, 1);
  // The stick's pitch is nose-down positive: a pull is its negative.
  const pull = -(Number.isFinite(out.pitch) ? out.pitch : 0);
  // A pull that is taking the plane over the top of a loop that fits under
  // the roof is left alone: at the rate the nose is coming round, the loop's
  // top (its radius is the speed over that rate; the air thins on the way,
  // `LOOP_ROOM`) is under it.
  if (up > 0 && pull > 0 && rate > 0.1) {
    const v = Math.hypot(...me.velocity);
    const top = me.position[1] + (v / rate) * (1 + Math.cos(pathClimb(c) * DEG)) * LOOP_ROOM;
    if (top <= seenHeight(c, opts.roof ?? ROOF)) return out;
  }
  const flown = up > 0 ? Math.min(pull, cap) : Math.max(pull, cap);
  if (flown === pull && throttle === out.throttle) return out;
  return { ...out, pitch: -flown, throttle };
}
