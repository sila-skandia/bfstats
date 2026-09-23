// Bots and land vehicles: the tank driving law and the Change behaviour's
// scoring. Read from the decompiles on 2026-09-23 (features/
// bf1942-ai-research-2026-09-21/bot-behaviours.md §8, ledger AI-43..AI-45):
//
//  * `TankControl::controlTowardsDirection` 0x0862c670 (`CarControl`'s
//    0x0860e670 is the same law with the car's own limits): the target
//    direction against the hull heading gives a signed angle; inside the
//    entry's angle limit (30 deg, 60 deg on a `moveTo` marked so) the hull
//    drives: a wanted speed of 20 m/s, cut by `1 - SCurve(slope * k)` over
//    two terrain probes 20 m ahead (floor 2 m/s), divided by `|roll rate| *
//    10 + 1` (the Mobile's rotational speed vt+0x18 dotted with the hull's
//    forward row, read 2026-09-24; the first read called it the lateral
//    velocity), capped at the AI template's `maxSpeed`; the throttle is
//    `2 * ((drive * wanted - |v|) - clamp(|v| / (30 |drive * wanted - |v||
//    + 1), +-10))` clamped to +-1, the steer `angle - clamp(rate / (30
//    |angle| + 1), +-10)` clamped to +-1. With `drive` 0, or the angle
//    outside the limit, the tail (0x0862cad8..0x0862cc3b) holds full lock
//    toward the angle's sign and a throttle of `drive` (1 for a `drive` of
//    0) while the hull is at or under 2 m/s, none above. Before either, an
//    angle is negated when the motion's sign differs from a non-zero
//    `drive` (0x0862c9ae..0x0862c9c2). `TankControl::turnTowardsDirection`
//    0x0862d630 is only `EntryTankTurnTo`'s (0x086253fc), never a move's.
//  * `EntryTankMoveTo::execute` 0x08622e80: arrival inside the move's radius
//    resets the controls (`TankControl::resetControls` 0x0862dca0, zeroes
//    only); otherwise `CommonControls::actionStatusDecision` 0x0860fbe0
//    (`actionStatusDecision` below, the turn-in-the-box state machine on
//    `BAPAMoveTo` +0x60) gives the law its `drive`, angle and motion sign.
//    The `maxSpeed` handed to the law is the Mobile template's +8,
//    `aiTemplatePlugIn.maxSpeed` (Sherman 16, Willy 25, a soldier 5).
//  * `BBChange::calculateUrgency` 0x0855e0c0 with `calculateVehicleUrgency`
//    0x08583b10 and its internals 0x08584310 / 0x08584580 / 0x08585750: a
//    unit's urgency is `SCurve(health) * (fireStrength * (w1 + 0.15) +
//    moveUrgency * w2) + value`, where `w1 / w2` split the bot's order
//    strengths (both zero: 0.5 / 0.5), `moveUrgency = engineHeat * maxSpeed
//    * 4` (x2.5 when another bot already sits in it), `fireStrength` sums the
//    unit's weapon strengths against what is around (the exact weighting is
//    not read: the spotted enemy classes, INVENTION), and ramps of 15 s
//    apply after the bot left that unit and after the unit spawned. On foot
//    the bot's own urgency x1.25 (x `modifyForDriver`) is "staying"; every
//    enterable unit in the environment's radius that is not manned by the
//    enemy, not upside down (up . normal < 0.6914), and standing on a valid
//    cell of the bot's map scores `u * (f + 0.5)` with `f = min(0.5, (R^2 -
//    d^2) / R^2)`; the winner gives `Declein(0.5 * best / staying) * k * 4`,
//    times a 10 s ramp after the last change and the outside-area factor.
//  * `BBPChange::createPlan` 0x0858b5c0: farther than 12.5 m a
//    `MoveToObjectFinding` to 6.25 m (broken when the unit is taken or
//    moves), then within 12.375 m the Use trigger held until `ObjectOccupied`,
//    `UpdateVehicle`, and the `ChangeVehicle` instruction.

import { sCurve, decleiningSlope } from './bot-behaviours.js';

const DEG = Math.PI / 180;

export const TANK = {
  wantedSpeed: 20.0,
  minWantedSpeed: 2.0,
  /** The wanted speed over `|roll rate| x 10 + 1` (0x0862d232..0x0862d26b). */
  rollDamping: 10.0,
  speedDamping: 30.0,
  dampingCap: 10.0,
  throttleGain: 2.0,
  angleLimit: 30 * DEG,
  angleLimitLastLeg: 60 * DEG,
  slopeProbe: 20.0,
  /** `ControlInfo` +0x4c, the slope-to-SCurve gain (INVENTION: 1). */
  slopeGain: 1.0,
  /** The tail's full lock: a throttle of `drive` (1 for 0) at or under this
   *  speed (the 2.0 at 0x086c08c4, compared at 0x0862cad8), none above. */
  lockSpeed: 2.0,
  /** `aiTemplatePlugIn.turnRadius` when the page hands none (Sherman 5). */
  defaultTurnRadius: 5.0,
  /** A soldier's `maxSpeed` term. */
  soldierMaxSpeed: 5.0,
};

/** `BBChangeTeleport::calculateUrgency` factors, by where the bot sits. */
export const TELEPORT = {
  /** A seat under an occupied root: root / own seat / other seats. */
  seatUnderDriver: { root: 0.5, self: 1.0, other: 0.5 },
  seatShip: { root: 1.0, self: 0.5, other: 0.65 },
  seatLand: { root: 1.0, self: 0.5, other: 0.7 },
  seatAir: { root: 1.5, self: 0.5, other: 0.5 },
  root: { root: 1.0, self: 1.0, other: 0.5 },
  urgencyScale: 4.0,
  pendingUrgency: 6.0,
  noOrderUrgency: 2.0,
  noOrderSplit: 0.05,
};

export const CHANGE = {
  stayFactor: 1.25,
  fireBias: 0.15,
  moveFactor: 4.0,
  moveFactorOccupied: 2.5,
  upsideDownCos: 0.6914,
  /** `BFEnvironment::getHardware` 0x085e2fa0: the 50 m candidate radius. */
  searchRadius: 50.0,
  approachFrom: 12.5,
  approachTo: 6.25,
  useWithin: 12.375,
  rampSeconds: 10.0,
  unitRampSeconds: 15.0,
  urgencyScale: 4.0,
  outsideAreaFactor: 0.75,
  /** `modifyForDriver`: a manned unit's secondary seats (0.77 / 0.5 by
   *  class) — bots here take the driver's seat only. */
  driverFactor: 1.0,
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * `TankControl::controlTowardsDirection` 0x0862c670 for one tick. `forward`
 * is the hull's heading (x/z), `velocity` its velocity (x/z), `toTarget` the
 * vector to the steering point (x/z), `yawRate` the hull's yaw rate (rad/s),
 * `rollRate` its rotational speed about the heading, `slopeSum` the two
 * probes' slope angles (deg). `decision` is `actionStatusDecision`'s `{
 * drive, angle, sign }`; without one the plain move's answer stands in
 * (drive for a target ahead of the beam, a turn in place behind it).
 * Returns `{ throttle, steer, angle, aligned, drive }`: `angle` the signed
 * angle the law steered on, `steer` the viewer's `c_PIYaw` (the engine's yaw
 * channel, same sense).
 */
export function tankControl({ forward, velocity, toTarget, maxSpeed, yawRate = 0, rollRate = 0,
                              slopeSum = 0, lastLeg = false, decision = null }) {
  const fLen = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / fLen, fz = forward[1] / fLen;
  const tLen = Math.hypot(toTarget[0], toTarget[1]);
  if (!(tLen > 1e-3)) return { throttle: 0, steer: 0, angle: 0, aligned: true, drive: 0 };
  let drive, angle, sign;
  if (decision) {
    ({ drive, angle, sign } = decision);
  } else {
    const dx = toTarget[0] / tLen, dz = toTarget[1] / tLen;
    const dot = fx * dx + fz * dz;
    const cross = fx * dz - fz * dx;          // sin(yaw - bearing): negative past the bow to +yaw
    angle = Math.atan2(cross, dot);
    drive = dot >= 0 ? 1 : 0;
    sign = Math.sign(fx * velocity[0] + fz * velocity[1]);
  }
  // 0x0862c9ae..0x0862c9c2: the angle is negated while the hull moves the
  // other way from a non-zero drive.
  if (drive !== 0 && sign !== drive) angle = -angle;
  const limit = lastLeg ? TANK.angleLimitLastLeg : TANK.angleLimit;
  const speed = Math.hypot(velocity[0], velocity[1]);
  if (drive !== 0 && Math.abs(angle) <= limit) {
    const steerDamp = clamp(yawRate / (TANK.speedDamping * Math.abs(angle) + 1), -TANK.dampingCap, TANK.dampingCap);
    const steer = clamp(angle - steerDamp, -1, 1);
    let wanted = TANK.wantedSpeed * (1 - sCurve(slopeSum * TANK.slopeGain));
    if (wanted < TANK.minWantedSpeed) wanted = TANK.minWantedSpeed;
    wanted /= Math.abs(rollRate) * TANK.rollDamping + 1;
    if (maxSpeed > 0 && wanted > maxSpeed) wanted = maxSpeed;
    const delta = drive * wanted - speed;
    const damp = clamp(speed / (Math.abs(delta) * TANK.speedDamping + 1), -TANK.dampingCap, TANK.dampingCap);
    const throttle = clamp(TANK.throttleGain * (delta - damp), -1, 1);
    return { throttle, steer, angle, aligned: true, drive };
  }
  // The tail: full lock toward the angle, the drive's throttle while slow.
  const throttle = speed <= TANK.lockSpeed ? (drive || 1) : 0;
  return { throttle, steer: Math.sign(angle), angle, aligned: false, drive };
}

/**
 * `AIPathfinding::getBox` 0x0847d140 -> `AStarLocalSearch::initSearchBox`
 * 0x085f3060 -> `getSearchBox` 0x085f4180: the box a hull stands in on its
 * map. The level is `getLandLevel` 0x085f3f90's, the largest level from the
 * map's max down to the vehicle's min whose block at the point is free; the
 * block of that level holding the point is grown one block at a time, the
 * four sides in turn (+z, +x, -z, -x) from each of the four starting sides,
 * a side stopping at the first blocked block and the whole at 32 tries; the
 * largest of the four is kept and widened by one block on every side. In
 * map cells: `levelAt(gx, gz)` is the free level of a cell (`freeLevel`, -1
 * blocked or off the map). Returns `{ min, max }` in cells (max exclusive,
 * as `getSearchBox` keeps it) or null when the point is blocked.
 */
export function searchBox(levelAt, gx, gz, { minLevel = 0, maxLevel = 8 } = {}) {
  let level = levelAt(gx, gz);
  if (level < minLevel) return null;
  if (level > maxLevel) level = maxLevel;
  const B = 1 << level;
  const free = (bx, bz) => levelAt(bx, bz) >= level;
  let best = null, bestArea = -1;
  for (let start = 0; start < 4; start++) {
    const mn = [gx & -B, gz & -B];
    const mx = [mn[0] + B, mn[1] + B];
    let flags = 0, tries = 0, side = start;
    do {
      if (!((flags >> side) & 1)) {
        let ok = true;
        if (side === 0) { for (let x = mn[0]; x < mx[0] && ok; x += B) ok = free(x, mx[1]); if (ok) mx[1] += B; else flags |= 1; }
        else if (side === 1) { for (let z = mn[1]; z < mx[1] && ok; z += B) ok = free(mx[0], z); if (ok) mx[0] += B; else flags |= 2; }
        else if (side === 2) { for (let x = mn[0]; x < mx[0] && ok; x += B) ok = free(x, mn[1] - B); if (ok) mn[1] -= B; else flags |= 4; }
        else { for (let z = mn[1]; z < mx[1] && ok; z += B) ok = free(mn[0] - B, z); if (ok) mn[0] -= B; else flags |= 8; }
        tries++;
      }
      side = (side + 1) & 3;
    } while (flags !== 0xf && tries < 32);
    const area = (mx[0] - mn[0]) * (mx[1] - mn[1]);
    if (start === 0 || bestArea < area) { best = [mn, mx]; bestArea = area; }
  }
  const [mn, mx] = best;
  return { min: [mn[0] - B, mn[1] - B], max: [mx[0] + B, mx[1] + B], level };
}

// -----------------------------------------------------------------------
// `CommonControls::actionStatusDecision` 0x0860fbe0: the turn in the box
// -----------------------------------------------------------------------

const HALF_PI_F = Math.fround(Math.PI / 2);      // the 1.5707964 the code subtracts
const PI_F = Math.fround(Math.PI);               // 3.1415927

/** The state machine's constants, each read at its use in 0x0860fbe0. */
export const ASD = {
  /** State 0's back-out test: the target's side angle past 1.2566371 (72 deg). */
  abeamAngle: 1.2566371,
  /** ... and the free box's shorter side at least 0.5 x the turn radius. */
  boxFraction: 0.5,
  /** States 2..8 keep their manoeuvre only while the target is behind the
   *  beam or at least 0.5235988 (30 deg) off the nose. */
  frontAngle: 0.5235988,
  /** State 8 backs straight out while the run astern beats 1.1 x the
   *  hull's radius. */
  backClearance: 1.1,
  /** States 6 / 7 aim at the box centre less the hit point turned 45 deg. */
  rot45: 0.7071,
};

function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

/** `-(acos(clamp(x)) - pi/2)`, the side angle the code writes (= asin x). */
function sideAngle(x) { return -(Math.acos(clamp(x, -1, 1)) - HALF_PI_F); }

/** `BaseVector2::normalize` 0x083b99d0: unit length, left alone when already
 *  within 1.19e-7 of it, zeroed below 1.42e-14. */
export function normalize2(x, z) {
  const l2 = x * x + z * z;
  if (Math.abs(l2 - 1) < 1.1920929e-07) return [x, z];
  if (Math.abs(l2) < 1.4210855e-14) return [0, 0];
  const k = 1 / Math.sqrt(l2);
  return [x * k, z * k];
}

/**
 * `getIntersection` 0x08612210: where the line from `p` along `d` leaves
 * the box `min..max` (x/z), or null when `p` is outside it. A flat box
 * returns `p` itself. The z edges are tried before the x edges, the far
 * one by the sign of `d`.
 */
export function boxExit(min, max, d, p) {
  if (!(min[0] <= p[0] && p[0] <= max[0] && min[1] <= p[1] && p[1] <= max[1])) return null;
  const w = max[0] - min[0], h = max[1] - min[1];
  if (w === 0 || h === 0) return [p[0], p[1]];
  const a = d[0], b = d[1], na = -a;
  const c = -(b * p[0] + na * p[1]);
  const fMin = na * min[1] + b * min[0] + c;
  const fMax = b * max[0] + na * max[1] + c;
  if (b <= 0) {
    const t = -fMin / (b * w);
    if (t >= 0 && t <= 1) return [min[0] + t * w, min[1]];
  } else {
    const t = fMax / (b * w);
    if (t >= 0 && t <= 1) return [max[0] - t * w, max[1]];
  }
  if (a >= 0) {
    if (a > 0) {
      const t = fMax / (na * h);
      if (t >= 0 && t <= 1) return [max[0], max[1] - t * h];
    }
  } else {
    const t = -fMin / (na * h);
    if (t >= 0 && t <= 1) return [min[0], min[1] + t * h];
  }
  return null;
}

/**
 * `checkLineAgainstObjects` 0x0860f7c0: the run `run` (x/z) from `pos`,
 * shortened to the first object circle it enters (`objects` `{x, z, r}`,
 * the bot's potential obstacles, `BotMain::getPotentialObstacles` 0x0852d790
 * through bot vtable +0x124, each at its Physical radius). False when the run is shorter
 * than the hull's own `radius`, when an object is entered inside that
 * radius, or when the hull already stands in one. Returns `{ ok, x, z,
 * dist }` (the shortened run and its length).
 */
export function checkLine(pos, run, radius, objects = []) {
  let len = Math.hypot(run[0], run[1]);
  if (!(radius <= len)) return { ok: false, x: 0, z: 0, dist: 0 };
  const ux = run[0] / len, uz = run[1] / len;
  for (const o of objects) {
    const dx = pos[0] - o.x, dz = pos[1] - o.z;
    const b = 2 * (dx * ux + dz * uz);
    const disc = b * b - 4 * (dx * dx + dz * dz - o.r * o.r);
    if (!(disc > 0)) continue;
    const s = Math.sqrt(disc);
    const t1 = (s - b) * 0.5, t0 = (-b - s) * 0.5;
    if (!(t1 > 0) || !(t0 < len)) continue;
    if (t0 >= 0) {
      len = t0;
      if (t0 < radius) return { ok: false, x: 0, z: 0, dist: 0 };
    } else if (Math.abs(t0) <= t1) {
      return { ok: false, x: 0, z: 0, dist: 0 };
    }
  }
  return { ok: true, x: len * ux, z: len * uz, dist: len };
}

/**
 * `CommonControls::actionStatusDecision` 0x0860fbe0, one tick, in the
 * engine's x/z frame (the caller flips the viewer's z). The move's state
 * is `BAPAMoveTo` +0x60 (`setStatus` 0x085407b0; the ctor 0x08540350 zeroes
 * it). Inputs: `dir` the unit direction to the move's point (zero for none),
 * `pos` the hull, `forward` the x/z of its 3D heading (not normalised, as
 * the code takes it), `velSign` the sign of velocity . heading in 3D,
 * `speed` the Mobile's speed (vt+0x1c), `radius` the Physical's bounding
 * radius (vt+0x28), `turnRadius` the Mobile template's +0xc, `box` the
 * pathfinder's box around the hull (`getBox` 0x08612060 -> `AIPathfinding::
 * getBox` 0x0847d140; `{min, max, from?}` or null; `searchBox`), `line(run)`
 * the object check (`checkLine`).
 *
 * Returns `{ state, drive, angle, sign }`: `drive` +1 drive ahead, -1
 * reverse, 0 turn in place (the law's full lock); `angle` the steering
 * angle; `sign` the motion's sign (the law flips the angle when it differs
 * from a non-zero `drive`). The states are documented in
 * features/bf1942-ai-spec/movement.md (ledger AI-85).
 */
export function actionStatusDecision({ state = 0, dir, pos, forward, velSign = 0, speed = 0, radius = 1,
                                        turnRadius = TANK.defaultTurnRadius, box = null, line = null }) {
  const lineCheck = line ?? ((run) => checkLine(pos, run, radius));
  const [fx, fz] = forward;
  const [nx, nz] = normalize2(fz, -fx);            // `getNormal` 0x08658780: (z, -x)
  const hasDir = !(dir[0] * dir[0] + dir[1] * dir[1] === 0);
  let dot, angle;
  if (hasDir) {
    dot = fx * dir[0] + fz * dir[1];
    angle = sideAngle(nx * dir[0] + nz * dir[1]);
  } else {
    dot = 1;
    angle = 1.0;
  }
  const sideSign = sgn(angle);
  const absAngle = Math.abs(angle);
  const sign = sgn(velSign);
  const signedSpeed = sign * speed;
  const motion = sign === 0 ? [fx, fz] : [fx * sign, fz * sign];
  const moveDir = hasDir ? dir : [fx, fz];
  const full = a => (dot < 0 ? sideSign * PI_F - a : a);
  const R = turnRadius;
  const r2q = (R * 0.5) * (R * 0.5);
  const keepGoing = () => dot <= 0 || ASD.frontAngle <= absAngle;
  const out = (st, drive, a) => ({ state: st, drive, angle: a, sign });
  const turn = st => out(st, 0, full(angle));
  const C = box ? [(box.min[0] + box.max[0]) * 0.5, (box.min[1] + box.max[1]) * 0.5] : null;
  // The run from the hull along `d` to the box edge, cut by objects: the
  // hit point and its length, or null (no box exit, or the check failed).
  // The edge is found from the point the box was taken at (`box.from`: the
  // last valid position when the hull stands on a blocked cell, as
  // `CommonControls::getBox` substitutes it), the run measured from the hull.
  const hitAlong = d => {
    const hit = boxExit(box.min, box.max, d, box.from ?? pos);
    if (!hit) return null;
    const c = lineCheck([hit[0] - pos[0], hit[1] - pos[1]]);
    if (!c.ok) return null;
    return { p: [pos[0] + c.x, pos[1] + c.z], dist: c.dist };
  };
  switch (state) {
    case 0: {
      if (0 <= dot) return out(0, 1, angle);
      if (!box) return turn(8);
      const h = hitAlong([fx, fz]);
      if (!h) return turn(8);
      if (h.dist > R) return turn(9);
      const shortSide = Math.min(box.max[0] - box.min[0], box.max[1] - box.min[1]);
      if (!(ASD.abeamAngle < absAngle) || !(R * ASD.boxFraction <= shortSide)) return turn(8);
      const hc = [h.p[0] - C[0], h.p[1] - C[1]];
      const pc = [pos[0] - C[0], pos[1] - C[1]];
      const a = full(angle);
      if (hc[0] * pc[0] + hc[1] * pc[1] <= 0) {
        return out((dir[0] * fx + dir[1] * fz) < 0 ? 7 : 6, 0, a);
      }
      const m1 = [C[0] + hc[0], C[1] - hc[1]];
      const m2 = [C[0] - hc[0], C[1] + hc[1]];
      const d1 = Math.abs(nx * (m1[0] - pos[0]) + nz * (m1[1] - pos[1]));
      const d2 = Math.abs(nx * (m2[0] - pos[0]) + nz * (m2[1] - pos[1]));
      return out(d2 < d1 ? 4 : 2, 0, a);
    }
    case 1:
      return out(1, 0, angle);
    case 2:
    case 4: {
      if (!box) return turn(0);
      const half2 = (box.max[0] - C[0]) ** 2 + (box.max[1] - C[1]) ** 2;
      const h = hitAlong(moveDir);
      if (!h) return turn(0);
      const run = Math.hypot(h.p[0] - pos[0], h.p[1] - pos[1]);
      const hc = [h.p[0] - C[0], h.p[1] - C[1]];
      const m = state === 2 ? [C[0] + hc[0], C[1] - hc[1]] : [C[0] - hc[0], C[1] + hc[1]];
      // The code takes the mirrored point less the hull's HEADING (not its
      // position) and scales it by 1 / |v|^2 (0x08610909 `fdiv`).
      const v = [m[0] - fx, m[1] - fz];
      const q = v[0] * v[0] + v[1] * v[1];
      const u = [v[0] / q, v[1] / q];
      const reach2 = run * run + Math.min(r2q, q);
      if (u[0] * fx + u[1] * fz > 0 && half2 < reach2 && (signedSpeed + 1) ** 2 < reach2) {
        if (keepGoing()) return out(state, 1, sideAngle(nx * u[0] + nz * u[1]));
        return turn(0);
      }
      return turn(state === 2 ? 3 : 5);
    }
    case 3:
    case 5: {
      if (!box) return turn(0);
      const sx = box.max[0] - box.min[0], sz = box.max[1] - box.min[1];
      const h = hitAlong(moveDir);
      if (!h) return turn(0);
      const run = Math.hypot(h.p[0] - pos[0], h.p[1] - pos[1]);
      const w = normalize2(h.p[0] - C[0], h.p[1] - C[1]);
      const b = [C[0] - w[0], C[1] - w[1]];
      const eq = (b[0] - pos[0]) ** 2 + (b[1] - pos[1]) ** 2;
      const reach2 = run * run + Math.min(r2q, eq);
      if (sx * sx + sz * sz <= reach2 && (signedSpeed + 1) ** 2 <= reach2 && keepGoing()) {
        return out(state, -1, -sideAngle(w[0] * nx + w[1] * nz));
      }
      return turn(0);
    }
    case 6:
    case 7: {
      if (!box) return turn(0);
      const h = hitAlong(moveDir);
      if (!h) return turn(0);
      const run = Math.hypot(h.p[0] - pos[0], h.p[1] - pos[1]);
      const hx = h.p[0] - C[0], hz = h.p[1] - C[1];
      const k = ASD.rot45;
      const b = state === 6
        ? [C[0] - (hx * -k - hz * k), C[1] - (hx * -k + hz * k)]
        : [C[0] - (hx * k - hz * k), C[1] - (hz * k + hx * k)];
      const e = [b[0] - pos[0], b[1] - pos[1]];
      const w = normalize2(e[0], e[1]);
      const eq = e[0] * e[0] + e[1] * e[1];
      if (fx * e[0] + fz * e[1] <= 0 && (signedSpeed + 1) ** 2 <= run * run + Math.min(r2q, eq) && keepGoing()) {
        return out(state, -1, sideAngle(w[0] * nx + w[1] * nz));
      }
      return turn(0);
    }
    case 8: {
      let ahead = 0, astern = 0;
      if (box) {
        const f = hitAlong([fx, fz]);
        if (f) ahead = f.dist;
        const b = hitAlong([-fx, -fz]);
        if (b) astern = b.dist;
      }
      if (keepGoing() && box && ahead < R && radius * ASD.backClearance < astern) return out(8, -1, -angle);
      return turn(0);
    }
    case 9: {
      const h = box ? hitAlong(motion) : null;
      const a = full(angle);
      if (h && R < h.dist) return out(9, 1, a);
      return out(0, 0, a);
    }
    default:
      return out(state, 0, angle);
  }
}

/**
 * `calculateVehicleUrgency` for one unit (a soldier on foot included).
 * `fire` is the unit's `calculateFireStrength` (bot-strength.js
 * `fireStrength`); the older `strengths` x `presence` sum stands in only
 * when no `fire` is given. `orderSplit` is `[w1, w2]`.
 */
export function unitUrgency({ health = 1, fire = null, strengths = {}, presence = { Infantry: 1 }, maxSpeed = 0,
                              engineHeat = 1, occupiedByBot = false, value = 0,
                              orderSplit = [0.5, 0.5], spawnAge = Infinity, leftAge = Infinity }) {
  let fireTerm = fire;
  if (fireTerm === null || fireTerm === undefined) {
    fireTerm = 0;
    for (const [type, s] of Object.entries(strengths)) fireTerm += (s ?? 0) * (presence[type] ?? 0);
  }
  const fire_ = fireTerm;
  const move = engineHeat * maxSpeed * (occupiedByBot ? CHANGE.moveFactorOccupied : CHANGE.moveFactor);
  let u = sCurve(clamp(health, 0, 1)) * (fire_ * (orderSplit[0] + CHANGE.fireBias) + move * orderSplit[1]) + value;
  if (leftAge < CHANGE.unitRampSeconds) u *= leftAge / CHANGE.unitRampSeconds;
  if (spawnAge < CHANGE.unitRampSeconds) u *= spawnAge / CHANGE.unitRampSeconds;
  return u;
}

/** The bot's order strengths into the fire / move split (`Bot` +0x168 / +0x16c). */
export function orderSplit(attack = 0, defence = 0) {
  if (attack <= 0) return defence <= 0 ? [0.5, 0.5] : [1.0, 0.0];
  if (defence > 0) return [defence / (attack + defence), attack / (attack + defence)];
  return [0.0, 1.0];
}

/**
 * `BBChange::calculateUrgency` on foot: `staying` is the bot's own unit
 * urgency (x1.25 applied here), `candidates` `{ id, u, dist }` already
 * filtered (enterable, not manned by the enemy, upright, reachable).
 * Returns `{ urgency, best }`.
 */
export function changeUrgency({ staying, candidates, radius = CHANGE.searchRadius, mod = 1,
                                ramp = 1, areaFactor = 1 }) {
  const stay = staying * CHANGE.stayFactor;
  let best = null, bestU = 0;
  for (const c of candidates ?? []) {
    const f = Math.min(0.5, (radius * radius - c.dist * c.dist) / (radius * radius));
    const u = c.u * (f + 0.5);
    if (u > bestU) { bestU = u; best = c; }
  }
  if (!best) return { urgency: 0, best: null };
  if (bestU <= stay) return { urgency: 0, best: null };
  const x = stay > 0 ? 0.5 * bestU / stay : 0.5 * bestU;
  return { urgency: decleiningSlope(x) * mod * CHANGE.urgencyScale * ramp * areaFactor, best };
}

/**
 * `BBChangeTeleport::calculateUrgency`: the seat swap within one hull.
 * `where` is `'root'` (the bot drives), `'seatUnderDriver'`, `'seatAir'`,
 * `'seatLand'` or `'seatShip'`; `rootU` / `selfU` the root's and the bot's
 * own seat's `calculateVehicleUrgency`; `seats` the other seats as `{ id,
 * u }` (free ones); `radio` the message strength, `orderFactor` the bot's
 * skill factor for seats other than its own (1 with an order), `pending`
 * a change into another object still under way, `attackSplit` w1,
 * `hasPlan` whether a plan runs. Returns `{ urgency, best }`, `best` null
 * when the bot keeps its seat.
 */
export function teleportChangeUrgency({ where = 'root', rootU = 0, selfU = 0, seats = [], radio = 0,
                                        orderFactor = 1, pending = false, attackSplit = 0.5, hasPlan = true }) {
  const f = TELEPORT[where] ?? TELEPORT.root;
  const r = 1 - radio;
  let best = null, bestU = selfU * f.self * r;
  const own = bestU;
  if (where !== 'root') {
    const u = rootU * f.root * r * orderFactor;
    if (u > bestU) { bestU = u; best = { id: 'root', u }; }
  }
  for (const seat of seats) {
    const u = (seat.u ?? 0) * f.other * r * orderFactor;
    if (u > bestU) { bestU = u; best = { id: seat.id, u }; }
  }
  if (!best) {
    if (pending) return { urgency: TELEPORT.pendingUrgency, best: null };
    if (attackSplit < TELEPORT.noOrderSplit && !hasPlan) return { urgency: TELEPORT.noOrderUrgency, best: null };
    return { urgency: 0, best: null };
  }
  const x = own > 0 ? 0.5 * bestU / own : 0.5 * bestU;
  return { urgency: decleiningSlope(x) * TELEPORT.urgencyScale, best };
}
