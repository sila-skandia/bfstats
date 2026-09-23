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
//    (30 |angle| + 1), +-10)` clamped to +-1. Outside the limit
//    `TankControl::turnTowardsDirection` 0x0862d630 turns first: full lock
//    away from the angle's sign, `tweak_highThrottle` 1.0 while the hull's
//    speed is under `min(1, angle^2 * 0.3)` and `tweak_lowThrottle` 0.4
//    beyond, the signs following the drive direction.
//  * `EntryTankMoveTo::execute` 0x08622e80: arrival inside the move's radius
//    resets the controls; `CommonControls::actionStatusDecision` 0x0860fbe0
//    drives forward for a target ahead of the beam (`forward . dir >= 0`);
//    behind it, for a plain move (mode 0), `CommonControls::getBox`
//    0x08612060 asks the pathfinder for the free box around the hull on its
//    map (`IAIPathfinding` +0x3c; +0x78 first checks the position is valid,
//    else the mobile's nearest valid point), `getIntersection` finds where
//    the heading leaves that box and `checkLineAgainstObjects` shortens
//    that run by the first object on it: when the run is no longer than
//    the mobile template's turn radius (+0xc, `aiTemplatePlugIn.turnRadius`),
//    the angle exceeds 1.2566 (72 deg) and the box's shorter side is at
//    least half the turn radius, the wanted angle is flipped by pi (the
//    hull backs toward the target); otherwise it turns. The `maxSpeed`
//    handed to the law is the `IPIMobile` +0x14 -> +8 term,
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
  /** `TankControl::turnTowardsDirection` 0x0862d630: full lock away from
   *  the angle's sign, and the throttle `tweak_highThrottle` (1.0) while the
   *  hull's speed is under `min(1, angle^2 * tweak_velocityLimitModifier
   *  (0.3))`, else `tweak_lowThrottle` (0.4); the sign follows the drive
   *  direction. The three tweaks are the binary's data at 0x08762c9c..a4. */
  turnHighThrottle: 1.0,
  turnLowThrottle: 0.4,
  turnVelocityLimit: 0.3,
  turnKeepAngle: 150 * DEG,
  /** `CommonControls::actionStatusDecision` 0x0860fbe0, mode 0: a target
   *  behind the beam is backed toward when the free run along the heading
   *  is no longer than the turn radius, the angle passes 72 deg (1.2566)
   *  and the free box's shorter side is at least half the turn radius. */
  reverseAngle: 1.2566371,
  reverseBoxFraction: 0.5,
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
 * The tank driving law for one tick. `forward` is the hull's heading (unit,
 * x/z), `velocity` the hull's velocity (x/z), `toTarget` the vector to the
 * steering point (x/z), `yawRate` the hull's yaw rate (rad/s, 0 when not
 * known), `slopeSum` the two probes' slope angles (deg, 0 on flat ground).
 * Returns `{ throttle, steer, angle, aligned, turn }` with `angle` the signed
 * angle `-(bearing - yaw)` and `steer` its clamped, damped value (the caller
 * maps it onto the vehicle's yaw channel).
 */
export function tankControl({ forward, velocity, toTarget, maxSpeed, yawRate = 0,
                              slopeSum = 0, lastLeg = false, lastTurn = 0,
                              freeAhead = Infinity, boxShort = Infinity, turnRadius = TANK.defaultTurnRadius }) {
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
    // `actionStatusDecision`: a target behind the beam is backed toward when
    // the heading's free run on the map is within the turn radius, the
    // angle passes 72 deg and the free box is at least half a turn radius
    // across (`driveDecision`); otherwise the hull turns first
    // (`turnTowardsDirection`): full lock, high throttle until it moves,
    // then the low throttle. A target straight behind flips the angle's
    // sign every tick as the hull turns; the turn keeps its direction until
    // the angle is well inside the half circle (INVENTION: that hysteresis).
    const behind = driveDecision({ dot, angle, freeAhead, boxShort, turnRadius }).reverse;
    const drive = behind ? -1 : 1;
    let dir = Math.sign(angle) || 1;
    if (lastTurn && Math.abs(angle) > TANK.turnKeepAngle) dir = lastTurn;
    const bodySpeed = Math.hypot(velocity[0], velocity[1]);
    const limitV = Math.min(1, angle * angle * TANK.turnVelocityLimit);
    const throttle = (bodySpeed <= limitV ? TANK.turnHighThrottle : TANK.turnLowThrottle) * drive;
    return { throttle, steer: dir * drive, angle, aligned: false, turn: dir, reverse: behind };
  }
  let wanted = TANK.wantedSpeed * (1 - sCurve(slopeSum * TANK.slopeGain));
  if (wanted < TANK.minWantedSpeed) wanted = TANK.minWantedSpeed;
  wanted /= Math.abs(lateral) * TANK.lateralDamping + 1;
  if (maxSpeed > 0 && wanted > maxSpeed) wanted = maxSpeed;
  const delta = wanted - speed;
  const damp = clamp(speed / (Math.abs(delta) * TANK.speedDamping + 1), -TANK.dampingCap, TANK.dampingCap);
  const throttle = clamp(TANK.throttleGain * (delta - damp), -1, 1);
  return { throttle, steer, angle, aligned: true, turn: 0, reverse: false };
}

/**
 * `CommonControls::actionStatusDecision` mode 0: forward for a target ahead
 * of the beam; behind it, reverse when the free run along the heading
 * (`freeAhead`, the box edge or the first object) is within the turn
 * radius, the angle passes 72 deg and the box's shorter side is at least
 * half the turn radius. Returns `{ reverse, angle }` with the flipped angle.
 */
export function driveDecision({ dot, angle, freeAhead = Infinity, boxShort = Infinity,
                                turnRadius = TANK.defaultTurnRadius }) {
  if (dot >= 0) return { reverse: false, angle };
  const reverse = freeAhead <= turnRadius && Math.abs(angle) > TANK.reverseAngle
    && boxShort >= TANK.reverseBoxFraction * turnRadius;
  if (!reverse) return { reverse: false, angle };
  const flipped = (angle < 0 ? -1 : 1) * Math.PI - angle;
  return { reverse: true, angle: flipped };
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
