// Bots and land vehicles: the tank driving law and the Change behaviour's
// scoring. Read from the decompiles on 2026-09-23 (features/
// bf1942-ai-research-2026-09-21/bot-behaviours.md §8, ledger AI-43..AI-45):
//
//  * `TankControl::controlTowardsDirection` 0x0862c670 (`CarControl`'s
//    0x0860e670 is the same law with the car's own limits): the target
//    direction against the hull heading gives a signed angle; inside the
//    entry's angle limit (30 deg, 60 deg on a `moveTo` marked so) the hull
//    drives: a wanted speed of 20 m/s, cut by `1 - SCurve(slope * k)` over
//    two terrain probes 20 m ahead (floor 2 m/s), divided by `|lateral
//    velocity| * 10 + 1`, capped at the AI template's `maxSpeed`; the
//    throttle is `2 * ((wanted - speed) - clamp(speed / (30 |wanted -
//    speed| + 1), +-10))` clamped to +-1, the steer `angle - clamp(rate /
//    (30 |angle| + 1), +-10)` clamped to +-1. Outside the limit the hull
//    turns first (that branch is not read: a half throttle with full lock
//    is the stand-in, INVENTION).
//  * `EntryTankMoveTo::execute` 0x08622e80: arrival inside the move's radius
//    resets the controls; `CommonControls::actionStatusDecision` picks
//    forward or reverse (not read: forward only here, INVENTION); the
//    `maxSpeed` handed to the law is the `IPIMobile` +0x14 -> +8 term,
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
  lateralDamping: 10.0,
  speedDamping: 30.0,
  dampingCap: 10.0,
  throttleGain: 2.0,
  angleLimit: 30 * DEG,
  angleLimitLastLeg: 60 * DEG,
  slopeProbe: 20.0,
  /** `ControlInfo` +0x4c, the slope-to-SCurve gain (INVENTION: 1). */
  slopeGain: 1.0,
  /** The turn-first branch (INVENTION): full throttle with full lock, since
   *  the viewer's tracked hull barely pivots on the spot (0.014 rad/s at
   *  throttle 0 against 0.15 rad/s under way, measured 2026-09-23). */
  turnThrottle: 1.0,
  turnKeepAngle: 150 * DEG,
  /** A soldier's `maxSpeed` term. */
  soldierMaxSpeed: 5.0,
};

export const CHANGE = {
  stayFactor: 1.25,
  fireBias: 0.15,
  moveFactor: 4.0,
  moveFactorOccupied: 2.5,
  upsideDownCos: 0.6914,
  /** The environment query's radius (INVENTION: not read). */
  searchRadius: 100.0,
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
 * The tank driving law for one tick. `forward` is the hull's heading (unit,
 * x/z), `velocity` the hull's velocity (x/z), `toTarget` the vector to the
 * steering point (x/z), `yawRate` the hull's yaw rate (rad/s, 0 when not
 * known), `slopeSum` the two probes' slope angles (deg, 0 on flat ground).
 * Returns `{ throttle, steer, angle, aligned, turn }` with `angle` the signed
 * angle `-(bearing - yaw)` and `steer` its clamped, damped value (the caller
 * maps it onto the vehicle's yaw channel).
 */
export function tankControl({ forward, velocity, toTarget, maxSpeed, yawRate = 0,
                              slopeSum = 0, lastLeg = false, lastTurn = 0 }) {
  const fLen = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / fLen, fz = forward[1] / fLen;
  const tLen = Math.hypot(toTarget[0], toTarget[1]);
  if (!(tLen > 1e-3)) return { throttle: 0, steer: 0, angle: 0, aligned: true };
  const dx = toTarget[0] / tLen, dz = toTarget[1] / tLen;
  const dot = fx * dx + fz * dz;
  const cross = fx * dz - fz * dx;            // sin(yaw - bearing): negative past the bow to +yaw
  const angle = Math.atan2(cross, dot);
  const limit = lastLeg ? TANK.angleLimitLastLeg : TANK.angleLimit;
  const speed = fx * velocity[0] + fz * velocity[1];
  const lateral = -fz * velocity[0] + fx * velocity[1];
  const steerDamp = clamp(yawRate / (TANK.speedDamping * Math.abs(angle) + 1), -TANK.dampingCap, TANK.dampingCap);
  const steer = clamp(angle - steerDamp, -1, 1);
  if (Math.abs(angle) > limit) {
    // A target straight behind flips the angle's sign every tick as the hull
    // turns; the turn keeps its direction until the angle is well inside the
    // half circle (INVENTION: the turn-first branch is not read).
    let dir = Math.sign(angle) || 1;
    if (lastTurn && Math.abs(angle) > TANK.turnKeepAngle) dir = lastTurn;
    return { throttle: TANK.turnThrottle, steer: dir, angle, aligned: false, turn: dir };
  }
  let wanted = TANK.wantedSpeed * (1 - sCurve(slopeSum * TANK.slopeGain));
  if (wanted < TANK.minWantedSpeed) wanted = TANK.minWantedSpeed;
  wanted /= Math.abs(lateral) * TANK.lateralDamping + 1;
  if (maxSpeed > 0 && wanted > maxSpeed) wanted = maxSpeed;
  const delta = wanted - speed;
  const damp = clamp(speed / (Math.abs(delta) * TANK.speedDamping + 1), -TANK.dampingCap, TANK.dampingCap);
  const throttle = clamp(TANK.throttleGain * (delta - damp), -1, 1);
  return { throttle, steer, angle, aligned: true, turn: 0 };
}

/**
 * `calculateVehicleUrgency` for one unit (a soldier on foot included).
 * `strengths` is the unit's weapon strength table by class, `presence` how
 * much of each class is around (the bot's spotted enemies, at least one
 * infantryman: INVENTION), `orderSplit` `[w1, w2]`.
 */
export function unitUrgency({ health = 1, strengths = {}, presence = { Infantry: 1 }, maxSpeed = 0,
                              engineHeat = 1, occupiedByBot = false, value = 0,
                              orderSplit = [0.5, 0.5], spawnAge = Infinity, leftAge = Infinity }) {
  let fire = 0;
  for (const [type, s] of Object.entries(strengths)) fire += (s ?? 0) * (presence[type] ?? 0);
  const move = engineHeat * maxSpeed * (occupiedByBot ? CHANGE.moveFactorOccupied : CHANGE.moveFactor);
  let u = sCurve(clamp(health, 0, 1)) * (fire * (orderSplit[0] + CHANGE.fireBias) + move * orderSplit[1]) + value;
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
