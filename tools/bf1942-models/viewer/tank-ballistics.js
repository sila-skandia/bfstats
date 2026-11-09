// A tank shell's flight, in closed form, for the tank school (features/
// battle-schools, tank-matchup.md sections 2 and 3): the drop, the time of
// flight, the elevation a range needs, the reach, and the lead. Pure: no
// three.js, no page, so the school's page, its tests and a headless duel all
// read the same numbers.
//
// The law is the server's. A round leaves at its muzzle speed down the bore
// plus the firing hull's velocity, plus `2/30` of a tick of gravity back on y
// (FA-23, `round-launch.js` `ROOT_SPEED_LIFT`). It moves its first tick without
// gravity, then falls under `gravityModifier x -14.73 m/s^2` in four sub-steps
// a tick (IMP-8). No vanilla round has drag (GUN-9). For a point body that
// puts it, at every tick, on
//
//     y(t) = 0.375 g dt^2 + (vy - 0.875 g dt) t + g t^2 / 2
//
// (`projectile-flight.js` `firstTickLift`, g signed downward, dt = 1/30), and
// x and z move at their launch speeds.

import { GRAVITY } from './physics.js';

/** The server's tick. */
export const TICK = 1 / 30;
/** What `fireBarrel` adds back on y: `2/30` of a tick of gravity (FA-23). */
export const ROOT_LIFT = -(2 / 30) * GRAVITY;

const DEG = Math.PI / 180;

/**
 * A gun as the school flies it: `{ speed, gravity }`, the muzzle speed in
 * m/s and the round's `gravityModifier` (1 when the template declares none).
 * From a glb FireArms node's extras (`fireArms.velocity`,
 * `fireArms.projectile.gravity`).
 */
export function gunOf(fireArms) {
  const speed = Number(fireArms?.velocity);
  const gravity = fireArms?.projectile?.gravity;
  return {
    speed: Number.isFinite(speed) && speed > 0 ? speed : 100,
    gravity: Number.isFinite(Number(gravity)) ? Number(gravity) : 1,
  };
}

/**
 * The shell's launch velocity in the gun's frame: `x` along the bore's
 * heading (level), `y` up, `z` across (to the right). `elevation` in degrees;
 * `hull` the firing hull's velocity in the same frame, `{ along, up, across }`.
 */
export function launch(gun, elevation = 0, hull = null) {
  const e = elevation * DEG;
  return {
    x: gun.speed * Math.cos(e) + (hull?.along ?? 0),
    y: gun.speed * Math.sin(e) + ROOT_LIFT + (hull?.up ?? 0),
    z: hull?.across ?? 0,
  };
}

/** Where the shell is `t` seconds after it left the muzzle, from the muzzle. */
export function positionAt(gun, t, elevation = 0, hull = null) {
  const v = launch(gun, elevation, hull);
  const g = GRAVITY * gun.gravity;
  const y = t <= TICK
    ? v.y * t
    : 0.375 * g * TICK * TICK + (v.y - 0.875 * g * TICK) * t + 0.5 * g * t * t;
  return { t, x: v.x * t, y, z: v.z * t };
}

/** Time of flight to `range` metres down the bore's heading. */
export function timeTo(gun, range, elevation = 0, hull = null) {
  const vx = launch(gun, elevation, hull).x;
  return vx > 0 ? range / vx : Infinity;
}

/** Where the shell is when it has gone `range` metres: `{ t, x, y, z }`.
 *  `y` below 0 is how far it has fallen below the muzzle. */
export function at(gun, range, elevation = 0, hull = null) {
  return positionAt(gun, timeTo(gun, range, elevation, hull), elevation, hull);
}

/** How far the shell falls below the muzzle, fired level, by `range`. */
export function dropAt(gun, range, hull = null) {
  return -at(gun, range, 0, hull).y;
}

/**
 * The elevation, in degrees, that puts the shell back at the muzzle's height
 * `range` metres out (`rise` metres above it, if given). Null past the gun's
 * reach at `maxElevation`.
 */
export function elevationFor(gun, range, { rise = 0, maxElevation = 20, hull = null } = {}) {
  const height = e => at(gun, range, e, hull).y - rise;
  let lo = -10, hi = maxElevation;
  if (height(hi) < 0) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (height(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** How far the shell lands on flat ground at `elevation` (the muzzle's own
 *  height), and when: `{ range, t }`. */
export function reach(gun, elevation = 20) {
  const v = launch(gun, elevation);
  const g = GRAVITY * gun.gravity;
  // 0.5 g t^2 + (vy - 0.875 g dt) t + 0.375 g dt^2 = 0, the later root.
  const a = 0.5 * g, b = v.y - 0.875 * g * TICK, c = 0.375 * g * TICK * TICK;
  const t = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return { range: v.x * t, t };
}

/**
 * The aim-off, in degrees, for a target crossing at `theirs` m/s while you
 * cross at `yours` (both sideways to the line of fire, same sign the same
 * way). The shell carries your velocity, so only the difference counts, and
 * as an angle it is the same at every range. Positive: aim ahead of them.
 */
export function leadAngle(gun, theirs = 0, yours = 0) {
  return Math.atan2(theirs - yours, gun.speed) / DEG;
}

/** The hold-over rule of thumb: degrees of elevation per 100 m, from the
 *  elevation 400 m needs (within about half a degree out to 400 m). */
export function degreesPer100(gun) {
  const e = elevationFor(gun, 400, { maxElevation: 45 });
  return e == null ? null : Math.round(e / 4);
}

/** The arc, sampled every `step` seconds, until it has gone `range` metres
 *  or fallen `floor` metres below the muzzle. */
export function arc(gun, { range = 400, elevation = 0, hull = null, step = 0.05, floor = -200 } = {}) {
  const out = [];
  const tEnd = timeTo(gun, range, elevation, hull);
  for (let t = 0; ; t += step) {
    const p = positionAt(gun, Math.min(t, tEnd), elevation, hull);
    out.push(p);
    if (t >= tEnd || p.y < floor) break;
  }
  return out;
}
