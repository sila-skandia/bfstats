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
// the lift left. The lessons' starts stop under it too (`dogfight-duel.js`
// `pacedHeight`: no start over 760 m). The shared guard (`guard`, 880 m
// real) is still there as the last word, and with the roof nobody reaches
// it: nine starts of every demo and move of the nine lessons top out at
// 840 m on the F-16 (`tests/dogfight_jet_harness.mjs --tops`).
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
// A plan that means to go over the top of a loop says so in its answer
// (`roof: false`), and is left alone while it does: pushing a nose that is
// past the vertical back down is the long way round.

import { heading, climbing } from './dogfight-pilot.js';
import { pointNose, clamp, pitchOf, basis, bankOf, HAND } from './dogfight-flight.js';

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
/** How far round (degrees) the nose is put at 60 degrees of bank, so a turn
 *  under way goes on, level, instead of being rolled out of. */
const TURN_ROUND = 35;

/**
 * A plan's answer kept under the roof. Where the plane is climbing more
 * steeply than the roof allows, or its nose is on the way to it (a nose
 * rising goes on rising for as long as the airframe's stick takes to bite,
 * `hand.pitch`), the nose is put on the allowed climb instead: pushed down
 * along its heading, or, in a bank, a little round the way it is turning,
 * so a turn goes on level. Well over the allowed climb the throttle comes
 * off too. The trigger is the plan's.
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
  const pitch = pitchOf(me.orientation);
  const { F } = basis(me.orientation);
  const w = me.angularVelocity ?? [0, 0, 0];
  const rise = (w[2] * F[0] - w[0] * F[2]) / Math.max(0.2, Math.cos(pitch * DEG)) / DEG;
  const nose = pitch + Math.max(0, rise) * HAND.ref * (me.hand?.pitch ?? 1);
  // The nose leads the path: 5 degrees of it are the wing's own.
  if (Math.max(pathClimb(c), nose - 5) <= allowed + 2) return out;
  const h = heading(me.velocity);
  const { bank, inverted } = bankOf(me.orientation);
  const round = inverted ? 0 : clamp(bank / 60) * TURN_ROUND * DEG;
  const to = [h[0] * Math.cos(round) - h[2] * Math.sin(round), 0, h[2] * Math.cos(round) + h[0] * Math.sin(round)];
  const k = pointNose(me, climbing(to, allowed), { fine: 60, push: 0.7 });
  const throttle = Math.max(pathClimb(c), pitch) - allowed > CUT_OVER ? 0 : out.throttle;
  return { ...out, pitch: k.pitch, roll: k.roll, rudder: k.rudder, throttle };
}
