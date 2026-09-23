// Bots in aircraft and boats: the plane's flight law and the boat's helm,
// read from `PlaneControl::towardsPoint` 0x08629730, `PlaneControl::
// towardsDirection` 0x08629fa0 (the earlier notes cited 0x0862a2a0, which is
// inside it), `PlaneControl::aimAtDirection` 0x08629cf0, `EntryPlaneMoveTo::
// execute` 0x08620220, `BBPGotoWaypoint3d::createPlan` 0x085b81e0,
// `BoatControl::towardsDirection` 0x0860df70 / `speedControl` 0x0860e130
// and `EntryBoatMoveTo::execute` 0x08613d60 (features/
// bf1942-ai-research-2026-09-21/bot-behaviours.md §9 and §12, ledger
// AI-46..AI-47, AI-60).
//
//  * The plane: `towardsDirectionEngine` is the engine's law line for line
//    (verified against an x87 emulation of the binary), fed by
//    `towardsPoint` (moves) and `aimAtDirection` (the guns). The waypoint
//    move's clearance is the order's +0x14, 50 m from `orderAirBot`
//    (strategic.js `_orderAir`); the point is the area's own at ground + 75.
//  * The boat: `BoatControl::speedControl` 0x0860cf40. Past 30 deg (state
//    0) it turns: full rudder, braking above 3 m/s and pushing with the
//    motion below. Within 30 deg it is underway: the unit's `maxSpeed`
//    scaled by how open the water is (`getLevel` against the map's base
//    level) and the angle, a `simpleReg` throttle on the speed, and a
//    yaw-damped log rudder (`boatSpeedControl`). `actionStatusDecision`
//    (bot-vehicle.js, the turn in the box and reversing off a beach) feeds it
//    the drive and angle (`boatControl`'s `decision`), and the move's arrival
//    brakes to a stop (`boatResetControls`), ledger AI-85 / AI-87.

const DEG = Math.PI / 180;

export const PLANE = {
  /** `ConPosition(point, 4 x unit radius)`, the 3D move's end condition. */
  arriveRadiusFactor: 4.0,
  /** A waypoint move's clearance: `WPAltitudeMoveTo` +0x14, 50 m from
   *  `orderAirBot` 0x08640982, read by `BBPGotoWaypoint3d::createPlan`
   *  0x085b81e0. Used when the waypoint carries none. */
  cruiseClearance: 50.0,
};

/** `BBPFire3d` and `BBPIdle3d`. */
export const PLANE_FIRE = {
  approachRange: 0.9,
  fireRange: 0.8,
  /** `BAPConObjectInFront(target, 10.0)` 0x08550e70: the target lies beyond
   *  the plane's position + 10 m along the nose (`fwd . (t - (p + 10 fwd))
   *  > 0`), a half-space, not a cone. Mode 1's gate. */
  inFrontDistance: 10.0,
  /** `BAPCConPrecision3d` ctor 0x0854b9e0: the precision is squared and
   *  floored at 0.01 (0.1 m). */
  precisionMin: 0.1,
  /** `BAPConInsideBattleZone(m)` 0x0854e670 is the MAP, not the ordered
   *  area: `m <= x < worldMapSizeX - m` and the same in z (`AISettings`
   *  +0x10 / +0x14). The fire loop runs while inside by 150 m; inside by
   *  less than 200 m it flies `MoveTo3d` to the map's centre at 200 m. */
  battleZone: 150.0,
  battleZoneReturn: 200.0,
  battleZoneHeight: 200.0,
  /** The aim statement's clearance (`BAPAAimAtObject3d` +0x198, set by
   *  `createMobileLessAttackPlan` 0x085a0080: 50 m for mode 1, 75 m else). */
  aimClearance: 75.0,
  aimClearanceVehicle: 50.0,
  /** `EntryPlaneAimAt::execute` 0x0861f610's throttle floor, handed to
   *  `towardsDirection` (+0x38): 1.0 against an air target, 0.5 against
   *  anything else (`0x3f000000` at 0x0861f875). */
  throttleFloorAir: 1.0,
  throttleFloorGround: 0.5,
  /** `createPlanInternal` 0x0859b4b0: the approach's `BAPAMoveTo3dObject`
   *  clearance (+0x44, the 100.0 pushed at 0x0859bfbb; the ctor 0x08541870
   *  stores its fourth float there), and the break's `BAPAMoveTo3dDirection`
   *  clearance (100.0 at 0x0859beab) and point height (100.0 written into the
   *  point's y at 0x0859bda5). The first reading (AI-56 / AI-69) had 50 m. */
  approachClearance: 100.0,
  breakClearance: 100.0,
  breakHeight: 100.0,
  breakDistance: 200.0,
  breakSpeedFactor: 1.5,
  passRadiusFactor: 1.3,
  arriveSpeedFactor: 0.5,
  radiusSmallFactor: 0.8,
  radiusSmallMin: 0.5,
  radiusVehicle: 5.0,
  radiusLarge: 10.0,
  weaponHeatSmall: 0.5,
  weaponHeatVehicle: 0.8,
  /** `aiTemplatePlugIn.maxRollAngle` / `maxClimbAngle` (ControlInfo3d
   *  +0x104 / +0x108), every vanilla aircraft. */
  maxRollAngle: 0.9999,
  maxClimbAngle: 0.3333,
  idleSpeed: 0.1,
};

export const BOAT = {
  fullRudderAngle: 30 * DEG,
  alignedCos: 0.996,
  speedBand: 3.0,
  rudderDeadBand: 0.03,
  arriveRadiusFactor: 4.0,
  /** `speedControl` 0x0860cf40's wanted-speed factors, by the free block's
   *  level at the hull against the map's base level (+0xc4a4) and the angle:
   *  2 levels clear, > 50 deg 0.6, > 30 deg 0.8; 1 level clear, > 50 deg
   *  0.4, 15..50 deg 0.6; not clear, > 30 deg 0.3, 2..15 deg 0.5, else 0.4. */
  angle50: 0.87266463,
  angle15: 0.2617994,
  angle2: 0.034906585,
  /** The rudder's yaw-rate damping, `sin(angle) - 0.1 x yawRate`. */
  yawDamping: 0.1,
  /** A water map's base level, 2^2 m blocks (ledger AI-66, INFERRED). */
  baseLevel: 2,
  /** `BoatControl::resetControls` 0x0860dff0: the arrival brake holds until
   *  the speed along the heading is at or under 1 m/s (the `fld1` compare at
   *  0x0860e29d). */
  brakeDoneSpeed: 1.0,
};

/**
 * `BoatControl::speedControl` 0x0860cf40, underway (a direction to go and the
 * angle within 30 deg, or past state 0): the wanted speed is the unit's
 * `maxSpeed` (Mobile plug-in +8) scaled by how open the water is (`getLevel`
 * 0x0847ca60 against the map's base level) and how far the helm has to turn;
 * the throttle is `simpleReg` 0x08613c20 of the wanted speed less last
 * tick's speed (BAPAMoveTo +0x54), clamped to +-1; the rudder is
 * `sign(x) log10(9|x| + 1)` with `x = sin(angle) - 0.1 x yawRate`, both
 * clamped. `angle` and `yawRate` share a sense (positive turns toward a
 * positive angle). EntryBoatMoveTo 0x08613d60 passes no speed cap (1e9).
 */
export function boatSpeedControl({ angle, direction = 1, maxSpeed, prevSpeed = 0, yawRate = 0,
                                   level = Infinity, baseLevel = BOAT.baseLevel }) {
  const a = Math.abs(angle);
  let f = 1;
  if (baseLevel < level) {
    if (baseLevel + 1 < level) {
      if (a > BOAT.angle50) f = 0.6;
      else if (a > BOAT.fullRudderAngle) f = 0.8;
    } else if (a > BOAT.angle50) f = 0.4;
    else if (a > BOAT.angle15) f = 0.6;
  } else if (a > BOAT.fullRudderAngle) f = 0.3;
  else if (a <= BOAT.angle15 && a > BOAT.angle2) f = 0.5;
  else f = 0.4;
  const wanted = direction * maxSpeed * f;
  const throttle = clamp(wanted - prevSpeed, -1, 1);
  const x = clamp(Math.sin(clamp(angle, -Math.PI / 2, Math.PI / 2)) - clamp(yawRate, -1, 1) * BOAT.yawDamping, -1, 1);
  const rudder = Math.sign(x) * Math.log10(9 * Math.abs(x) + 1);
  return { throttle, rudder, wanted, factor: f };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** q * v for a quaternion {x,y,z,w} and a vector [x,y,z]. */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** `towardsDirection`'s output curve: `sign(v) log10(9|v| + 1)` on [-1, 1]. */
export function stickShape(v) {
  const c = clamp(v, -1, 1);
  return c < 0 ? -Math.log10(1 - c * 9) : Math.log10(c * 9 + 1);
}

/**
 * `BBPFire3d::createPlan`'s target mode and aim radius from the target's
 * extents (`[dx, dy, dz]`), whether it is a vehicle and whether it moves.
 */
export function planeFireMode({ extents = [0.6, 1.8, 0.6], vehicle = false, large = false, mobile = true }) {
  if (!mobile) return { mode: 3, radius: 0 };
  if (!vehicle) {
    const r = Math.max(PLANE_FIRE.radiusSmallMin, PLANE_FIRE.radiusSmallFactor * Math.max(extents[0], extents[1], extents[2]));
    return { mode: 0, radius: r };
  }
  const mean = (extents[0] + extents[1] + extents[2]) / 3;
  return large ? { mode: 2, radius: Math.max(PLANE_FIRE.radiusLarge, mean) }
               : { mode: 1, radius: Math.max(PLANE_FIRE.radiusVehicle, mean) };
}

/**
 * `BAPConInsideBattleZone::evaluate` 0x0854e670 in the viewer's frame (x is
 * the engine's x, z its negative): more than `margin` inside every edge of
 * the `[sizeX, sizeZ]` world map.
 */
export function insideBattleZone(x, z, margin, [sizeX, sizeZ]) {
  const ez = -z;
  return margin <= x && x < sizeX - margin && margin <= ez && ez < sizeZ - margin;
}

/**
 * The miss distance of a round fired now: `BAPCConPrecision3d::evaluate`
 * 0x0854baf0 compares the target's predicted position at the impact time
 * (`BAPAAimAt3d::getPredictedPosition`, `Aimer::getPredictedTargetPosition`
 * 0x08539280: linear in the RELATIVE velocity, target minus shooter,
 * `BAPAAimAtObject3d::getAimVec` 0x0853c7f0) with where a round fired along
 * the gun's current direction is then (`Aimer::getImpactPosition` 0x08539300
 * with no drag: `dir * speed * t + (0, 0.5 g t^2, 0)`). `rel` is target minus
 * muzzle, `relVel` target minus shooter velocity, `dir` the gun's unit
 * direction. The impact time is the lead solution `|rel + relVel t| = s t`.
 * Returns `{ miss, t }`.
 */
export function roundMiss({ rel, relVel = [0, 0, 0], dir, speed, gravity = 0 }) {
  const s = Math.max(1, speed);
  // |rel + v t|^2 = s^2 t^2  ->  (v.v - s^2) t^2 + 2 rel.v t + rel.rel = 0
  const a = relVel[0] ** 2 + relVel[1] ** 2 + relVel[2] ** 2 - s * s;
  const b = 2 * (rel[0] * relVel[0] + rel[1] * relVel[1] + rel[2] * relVel[2]);
  const c = rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2;
  let t = Math.sqrt(c) / s;
  const disc = b * b - 4 * a * c;
  if (Math.abs(a) > 1e-6 && disc >= 0) {
    const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
    const pos = [r1, r2].filter(x => x > 0);
    if (pos.length) t = Math.min(...pos);
  }
  const p = [rel[0] + relVel[0] * t, rel[1] + relVel[1] * t, rel[2] + relVel[2] * t];
  // The firing direction that meets `p` at `t` (`Aimer::getFiringDirection`'s
  // aim, without drag): the round's drop taken out of the line.
  const aim = norm3([p[0], p[1] - 0.5 * gravity * t * t, p[2]]);
  if (!dir) return { miss: 0, t, aim };
  const q = [dir[0] * s * t, dir[1] * s * t + 0.5 * gravity * t * t, dir[2] * s * t];
  return { miss: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t, aim };
}

/**
 * The closest approach of a round fired along `dir` now to the target's
 * path: `Aimer::getNearestImpactPoint` 0x08539490. The engine sets the
 * derivative of `|Q t + R t^2 - C|^2` to zero (`Q = dir * speed - relVel`,
 * `R = (0, g/2, 0)`, `C = rel`; the cubic `2 R.R t^3 + 3 Q.R t^2 + (Q.Q -
 * 2 C.R) t - C.Q`, `Polynom::findRoots`) and keeps the non-negative root
 * nearest the target. Without drag (every bullet's `Aimer` +0 is 0).
 * Returns `{ miss, t }`, or `null` when no root is non-negative.
 */
export function nearestMiss({ rel, relVel = [0, 0, 0], dir, speed, gravity = 0 }) {
  const Q = [dir[0] * speed - relVel[0], dir[1] * speed - relVel[1], dir[2] * speed - relVel[2]];
  const R = [0, 0.5 * gravity, 0];
  const at = t => Math.hypot(Q[0] * t - rel[0], Q[1] * t + R[1] * t * t - rel[1], Q[2] * t - rel[2]);
  const a = 2 * R[1] * R[1], b = 3 * Q[1] * R[1];
  const c = Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 - 2 * rel[1] * R[1];
  const d = -(rel[0] * Q[0] + rel[1] * Q[1] + rel[2] * Q[2]);
  const roots = cubicRoots(a, b, c, d).filter(t => t >= 0);
  if (!roots.length) return null;
  let best = null;
  for (const t of roots) {
    const miss = at(t);
    if (!best || miss < best.miss) best = { miss, t };
  }
  return best;
}

/** Real roots of `a t^3 + b t^2 + c t + d` (any leading zeros). */
function cubicRoots(a, b, c, d) {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return Math.abs(c) < 1e-12 ? [] : [-d / c];
    const disc = c * c - 4 * b * d;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-c - s) / (2 * b), (-c + s) / (2 * b)];
  }
  const p = b / a, q = c / a, r = d / a;
  const A = q - p * p / 3, B = 2 * p ** 3 / 27 - p * q / 3 + r;
  const disc = B * B / 4 + A ** 3 / 27;
  const shift = -p / 3;
  if (disc > 1e-12) {
    const s = Math.sqrt(disc);
    return [Math.cbrt(-B / 2 + s) + Math.cbrt(-B / 2 - s) + shift];
  }
  if (Math.abs(A) < 1e-12) return [shift];
  const m = 2 * Math.sqrt(-A / 3);
  const th = Math.acos(clamp(3 * B / (A * m), -1, 1)) / 3;
  return [0, 1, 2].map(k => m * Math.cos(th - 2 * Math.PI * k / 3) + shift);
}

/**
 * `EntryPlaneAimAt::execute` 0x0861f610: the direction the aim statement
 * hands `aimAtDirection` 0x08629cf0, and the Aimer state its precision test
 * reads. Against an AIR target (the target information's +4 & 0x10) the
 * Aimer is fed the shooter's velocity (`BAPAAimAtObject3d::getAimVec`
 * 0x0853c7f0 subtracts it from the target's) and the round's own exit
 * velocity, the 3D firing direction is used as it is (clamped to unit
 * length) and the throttle floor is 1.0. Against anything else the shooter's
 * velocity is passed as ZERO and the exit velocity plus the plane's own
 * speed as the round speed, so the aim is the line to the target (lead only
 * for the target's own motion, drop at that speed), and the throttle floor
 * is 0.5 (the `0x3f000000` at 0x0861f875). An `indirect` weapon (template
 * byte +1, `weaponTemplate.indirect`, ConsoleClass620 0x08510db0) against a
 * ground target flies the LEVEL bearing of that solution; with no solution
 * (a level length under 0.001) it holds its own level heading. `rel` is the
 * target less the muzzle. Returns `{ dir, relVel, speed, throttleFloor }`.
 */
export function planeAimFor({ rel, targetVel = [0, 0, 0], velocity = [0, 0, 0], roundSpeed, gravity = 0,
                              air = false, indirect = false, forward = [0, 0, -1] }) {
  const own = Math.hypot(velocity[0], velocity[1], velocity[2]);
  const relVel = air ? [targetVel[0] - velocity[0], targetVel[1] - velocity[1], targetVel[2] - velocity[2]]
                     : [targetVel[0], targetVel[1], targetVel[2]];
  const speed = air ? roundSpeed : roundSpeed + own;
  let dir = roundMiss({ rel, relVel, speed, gravity }).aim;
  if (!air && indirect) {
    const l = Math.hypot(dir[0], dir[2]);
    if (l >= 0.001) dir = [dir[0] / l, 0, dir[2] / l];
    else {
      const f = Math.hypot(forward[0], forward[2]) || 1;
      dir = [forward[0] / f, 0, forward[2] / f];
    }
  }
  return { dir, relVel, speed, throttleFloor: air ? PLANE_FIRE.throttleFloorAir : PLANE_FIRE.throttleFloorGround };
}

/**
 * The trigger's precision test, `BAPCConPrecision3d::evaluate` 0x0854baf0
 * (modes 0 / 3) and `BAPCConBombPrecision3d::evaluate` 0x0854a8c0 (modes 1 /
 * 2), with their closest-approach variants (read in the disassembly; the
 * trackers are the ctors' `FLT_MAX` fields). `m2` is the squared miss at the
 * lead time, `n2` the squared nearest-approach miss (bomb class only; null
 * when there is none), `p2` the squared precision floored at 0.01. `state`
 * carries the trackers between ticks.
 *
 *  * Direct (`closest` false): fire when `m2 <= p2`; the bomb class also
 *    fires when `n2 <= p2`.
 *  * Closest approach: while the miss shrinks (`m2 <= last`, `last > 0.01`)
 *    store it and hold fire; once it grows, fire when the stored minimum was
 *    inside the precision. `Precision3d` then resets its tracker either way;
 *    the bomb class resets it only when it fires, and its first test fires
 *    only while its second tracker is still outside the precision.
 */
export function precisionGate(state, { m2, n2 = null, p2, bomb = false, closest = false }) {
  const FLT_MAX = 3.4028234663852886e38;
  if (!bomb) {
    if (!closest) return m2 <= p2;
    const last = state.last1 ?? FLT_MAX;
    if (last <= 0.01 || last < m2) { state.last1 = FLT_MAX; return last <= p2; }
    state.last1 = m2;
    return false;
  }
  if (!closest) {
    if (m2 <= p2) return true;
    return n2 !== null && n2 <= p2;
  }
  const last1 = state.last1 ?? FLT_MAX, last2 = state.last2 ?? FLT_MAX;
  if (last1 <= 0.01 || last1 < m2) {
    if (last1 <= p2 && !(last2 <= p2)) { state.last1 = FLT_MAX; return true; }
  } else {
    state.last1 = m2;
  }
  if (n2 === null) return false;
  if (last2 <= 0.01 || last2 < n2) {
    if (last2 <= p2) { state.last2 = FLT_MAX; return true; }
  } else {
    state.last2 = n2;
  }
  return false;
}

/**
 * One step of the plane's fire plan: `state` is `{ phase, breakFrom }`
 * (`phase` 'approach' | 'attack' | 'break'), advanced in place. `position`
 * / `forward` / `velocity` are the plane's, `target` / `targetVel` the
 * target's, `maxRange` the chosen weapon's, `turnRadius` the AI template's,
 * `lineOfFire` `BAPConObjectLineOfFire` 0x08551890 (the bot's memory record
 * of the target is not lost: it is seen now), `mode` / `precision` from
 * `planeFireMode`, `muzzle` / `aimDir` / `roundSpeed` / `gravity` the gun.
 *
 * `createPlanInternal` 0x0859b4b0 mode 0 (a soldier) is `If(ObjectDistance
 * 0.9 R & LineOfFire, createMobileLessAttackPlan, MoveTo3dObject(.. until
 * 0.8 R & LineOfFire))`: no in-front test. Modes 1 / 2 also want the
 * target past `inFrontDistance` along the nose (`ObjectInFront` 10.0) and
 * break after the pass. The trigger (`createMobileLessAttackPlan`
 * 0x085a0080, read in its disassembly) is a `BAPConAnd` of, by mode:
 * 0 / 3 `ObjectDistance(R)` & `BAPCConPrecision3d(precision, !burst)`;
 * 1 `ObjectDistance(R)` & `BAPCConBombPrecision3d(precision, false)`;
 * 2 `BAPCConBombPrecision3d(precision, true)` alone (no range test). The
 * closest-approach flag of the first is the weapon template's byte 0
 * (`weaponTemplate.burst`, ConsoleClass617 0x08510180) inverted: a burst
 * gun takes the direct test, a non-burst weapon (the bombs) the closest
 * approach (`precisionGate`). `relVel` / `roundSpeed` are the Aimer's
 * (`planeAimFor`: the shooter's velocity is left out against a ground
 * target); `relVel` defaults to the target's velocity less the plane's.
 * Returns `{ phase, fire, inFront, dist, dir, miss, nearest }`.
 */
export function attackRunStep(state, { position, forward, velocity, target, targetVel = [0, 0, 0],
                                       maxRange, turnRadius = 25, lineOfFire = true, mode = 1,
                                       precision = 1, muzzle = null, aimDir = null, roundSpeed = 600,
                                       gravity = 0, relVel = null, burst = true }) {
  const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
  const dist = Math.max(0.5, Math.hypot(dx, dy, dz));
  const dir = [dx / dist, dy / dist, dz / dist];
  const cosFront = forward[0] * dir[0] + forward[1] * dir[1] + forward[2] * dir[2];
  // `ObjectInFront`: beyond position + 10 m along the nose.
  const inFront = cosFront * dist - PLANE_FIRE.inFrontDistance > 0;
  const needsFront = mode === 1 || mode === 2;
  if (!state.phase) state.phase = 'approach';
  if (state.phase === 'break') {
    const from = state.breakFrom ?? position;
    const run = Math.hypot(position[0] - from[0], position[2] - from[2]);
    if (run >= PLANE_FIRE.breakDistance) state.phase = 'approach';
  } else if (state.phase === 'attack') {
    const passed = needsFront && (dist < PLANE_FIRE.passRadiusFactor * turnRadius || !inFront);
    if (passed) { state.phase = 'break'; state.breakFrom = [...position]; }
    else if (dist > PLANE_FIRE.approachRange * maxRange || !lineOfFire) state.phase = 'approach';
  } else if (dist <= PLANE_FIRE.approachRange * maxRange && lineOfFire && (!needsFront || inFront)) {
    state.phase = 'attack';
  }
  const from = muzzle ?? position;
  const rel = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
  const rv = relVel ?? [targetVel[0] - velocity[0], targetVel[1] - velocity[1], targetVel[2] - velocity[2]];
  const barrel = aimDir ?? forward;
  const { miss } = roundMiss({ rel, relVel: rv, dir: barrel, speed: roundSpeed, gravity });
  const bomb = mode === 1 || mode === 2;
  const near = bomb ? nearestMiss({ rel, relVel: rv, dir: barrel, speed: roundSpeed, gravity }) : null;
  const p = Math.max(PLANE_FIRE.precisionMin, precision);
  let fire = false;
  if (state.phase === 'attack') {
    const gate = precisionGate(state, { m2: miss * miss, n2: near ? near.miss * near.miss : null, p2: p * p,
                                        bomb, closest: bomb ? mode === 2 : !burst });
    fire = gate && (mode === 2 || dist <= maxRange);
  }
  return { phase: state.phase, fire, inFront, dist, dir, miss, nearest: near ? near.miss : null };
}

/** `PlaneControl::towardsDirection` 0x08629fa0's constants (all read from the
 *  binary: 43.0 at 0x087058a8, ln 10 at 0x087058ac, -0.833 / 0.333 at
 *  0x087058b0 / b4, 0.866 / 0.134 at 0x087058b8 / bc, 0.9 at 0x086d16c8,
 *  0.1 at 0x086b1ca0, 18.0 at 0x086c08d0, 0.3 at 0x086c030c, 9.0 at 0x086c08cc). */
export const TOWARDS = {
  speedKnee: 43.0,
  ln10: 2.3025851,
  climbSlope: -0.833,
  climbTop: 0.333,
  yawRateGain: 0.1,
  rollRateGain: 0.5,
  bankKnee: 0.866,
  bankSpan: 0.134,
  diveFrontCos: 0.9,
  diveSideMax: 0.1,
  diveGain: 18.0,
  diveFloor: 0.3,
  /** `aimAtDirection` 0x08629cf0: the probes run 50 m along the velocity,
   *  `2 (clearance - altitude)` over the clearance is the pull-up demand, a
   *  takeoff aims at `y = 0.3333` (the literal 0x3eaaa64c) until 50 m up at
   *  half the top speed. */
  probe: 50.0,
  takeoffDirY: 0.3333,
  takeoffHeight: 50.0,
  takeoffSpeedFraction: 0.5,
  /** `towardsPoint` 0x08629730: the lift toward the point inside 100 m
   *  (10000 = 100^2, rate 0.0001), the 100 m probe, the 200 m takeoff aim. */
  pointLiftRange: 100.0,
  pointLiftRate: 0.0001,
  pointProbe: 100.0,
  takeoffTargetY: 200.0,
};

const clamp1 = v => (v < -1 ? -1 : v > 1 ? 1 : v);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : v; };

/**
 * `PlaneControl::towardsDirection` 0x08629fa0, in the ENGINE's frame (x right,
 * y up, z forward). Verified instruction for instruction: an x87 emulator of
 * the function's 1,351 disassembled lines agrees with this to 2e-4 on 1,700
 * random inputs covering every reachable branch (features/
 * bf1942-engine-reference/lnxded/x87emu.py and towards_direction_emu.py;
 * the Ghidra output of this function is missing its head).
 *
 * `R` / `U` / `F` are the airframe's right / up / forward rows, `omega` its
 * world angular velocity (`IPIMobile::getRotationalSpeed`, vt +0x18),
 * `climbDemand / clearance` the pull-up demand (its caller's `2 (clearance -
 * altitude)` and clearance), `takeoff` suppresses the turn, `throttleFloor`
 * and `speed` (`getSpeedMagnitude`) the throttle floor and airspeed,
 * `diveGuard` the dive pull-out, `maxClimb` / `maxRoll` ControlInfo3d +0x104 /
 * +0x108. Returns the four channels the function writes: `throttle`
 * (driveThrottleControl, +0x50, raw), `yaw` (driveTurnControl +0x54), `roll`
 * (driveRollControl +0x10c) and `pitch` (drivePitchControl +0x110), the last
 * three through `sign(v) log10(9|v| + 1)`.
 */
export function towardsDirectionEngine({ dir, R, U, F, omega = [0, 0, 0], climbDemand = 0, clearance = 1,
                                         takeoff = false, throttleFloor = 1, speed = 0, diveGuard = true,
                                         maxClimb = PLANE_FIRE.maxClimbAngle, maxRoll = PLANE_FIRE.maxRollAngle }) {
  const D = norm3(dir);
  const Rh = norm3(cross3([0, 1, 0], F));
  const Fh = cross3(Rh, [0, 1, 0]);
  const Ul = cross3(F, Rh);
  const behind = dot3(D, F) < 0 || dot3(D, Fh) < 0;
  const wRh = dot3(omega, Rh), wUl = dot3(omega, Ul), wF = dot3(omega, F);
  const bank = dot3(Ul, R);
  const upright = dot3(Ul, U);
  const s = clamp(climbDemand / clearance, 0, 1);
  const q = clamp(speed / TOWARDS.speedKnee, 0, 1);
  // The climb limit from the airspeed: -0.5 standing, +0.333 from 43 m/s.
  const k = ((Math.exp((1 - q) * TOWARDS.ln10) - 1) / 9) * TOWARDS.climbSlope + TOWARDS.climbTop;
  const kc = clamp(k, -1, maxClimb);
  let limit = 1;
  if (Ul[1] > 0) {
    if (F[1] > 0) limit = kc < 0 ? (1 - Ul[1]) * kc : kc * Ul[1];
    else limit = kc / Ul[1];
  }
  const throttle = Math.max(throttleFloor, s);
  let up = Math.min(dot3(Ul, D), limit) * (1 - s) + s;
  let side = 0;
  if (!takeoff) {
    side = dot3(D, Rh);
    if (behind) side = Math.sign(side);
  }
  if (diveGuard && up < 0 && dot3(F, D) > TOWARDS.diveFrontCos && side < TOWARDS.diveSideMax) {
    let t = Math.log10(1 - up * TOWARDS.diveGain);
    if (t <= TOWARDS.diveFloor) t = TOWARDS.diveFloor;
    up = -clamp(t, 0, 1);
  }
  if (kc < F[1]) up = Math.min(up, -Math.log10((F[1] - kc) * 9 + 1));
  const P = clamp1(clamp1(wRh) + up);
  const Y = clamp1(side - clamp1(wUl) * TOWARDS.yawRateGain);
  const yaw = dot3(R, Rh) * Y + dot3(R, Ul) * P;
  const pitch = -(dot3(U, Rh) * Y + dot3(U, Ul) * P);
  const b = upright >= 0 ? bank : 2 * Math.sign(bank) - bank;
  const yr = clamp(Y * (P >= TOWARDS.bankKnee ? (1 - P) / TOWARDS.bankSpan : 1), -maxRoll, maxRoll);
  const roll = TOWARDS.rollRateGain * clamp1(wF) + b + yr;
  return { throttle, yaw: stickShape(yaw), roll: stickShape(roll), pitch: stickShape(pitch),
           dbg: { s, up, P, Y, side, bank: b, limit } };
}

/** The viewer's frame (right-handed, a body's forward is -z) to the
 *  engine's (left-handed, forward +z): z flips for a vector, and an angular
 *  velocity (an axial vector under a reflection) becomes (-x, -y, z). */
export const toEngine = v => [v[0], v[1], -v[2]];
export const omegaToEngine = w => [-w[0], -w[1], w[2]];

/**
 * `PlaneControl::aimAtDirection` 0x08629cf0: two altitude probes 50 m along
 * the velocity and along its level part (`InformationReal::getAltitude(Vec3)`
 * 0x085e8950, the least height over the ground along the probe) give the
 * pull-up demand `max(2 (clearance - h1), 2 (clearance - h2))`; before the
 * bot's airborne flag is set (bot vt +0x180) the wanted direction's y is
 * 0.3333 and no turn is made, and the flag is set (vt +0x17c) once the plane
 * is 50 m up at half its top speed; then `towardsDirection` with the dive
 * guard on. `altitudeAlong(offset)` is the probe (viewer frame), `clearance`
 * the aim statement's (+0x198: 75 m for a small target, 50 m for mode 1),
 * `throttleFloor` its +0x20 (1.0 for a soldier). Returns the viewer's stick
 * `{ power, roll, pitch, rudder, airborne }` (the engine's channel signs
 * are the viewer drivetrain's: pitch negative is nose up, a positive roll
 * lowers the right wing).
 */
export function aimAtDirection({ orientation, velocity, angularVelocity = [0, 0, 0], dir, altitudeAlong = null,
                                 altitude = Infinity, clearance = 75, airborne = true, throttleFloor = 1,
                                 maxSpeed = 100, maxClimb = PLANE_FIRE.maxClimbAngle, maxRoll = PLANE_FIRE.maxRollAngle }) {
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  const vn = speed > 0 ? velocity.map(x => x / speed * TOWARDS.probe) : [0, 0, 0];
  const h1 = altitudeAlong ? altitudeAlong(vn) : Infinity;
  const h2 = altitudeAlong ? altitudeAlong([vn[0], 0, vn[2]]) : Infinity;
  const climbDemand = Math.max(2 * (clearance - h1), 2 * (clearance - h2));
  let d = toEngine(dir);
  let flying = airborne;
  if (!flying) {
    d = [d[0], TOWARDS.takeoffDirY, d[2]];
    if (altitude >= TOWARDS.takeoffHeight && speed / Math.max(1, maxSpeed) >= TOWARDS.takeoffSpeedFraction) flying = true;
  }
  const r = towardsDirectionEngine({
    dir: d, R: toEngine(rotate(orientation, [1, 0, 0])), U: toEngine(rotate(orientation, [0, 1, 0])),
    F: toEngine(rotate(orientation, [0, 0, -1])), omega: omegaToEngine(angularVelocity),
    climbDemand, clearance, takeoff: !airborne, throttleFloor, speed, diveGuard: true, maxClimb, maxRoll,
  });
  return { power: r.throttle >= 1 ? 1 : 0, throttle: r.throttle, roll: r.roll, pitch: r.pitch, rudder: r.yaw,
           airborne: flying, climbDemand, dbg: r.dbg, dir: d };
}

/**
 * `PlaneControl::towardsPoint` 0x08629730 (called by `EntryPlaneMoveTo::
 * execute` 0x08620220 with the move's clearance, `BAPAMoveTo3d` +0x3c /
 * `BAPAMoveTo3dObject` +0x44): within 100 m (horizontal) of the point the
 * wanted height is lifted toward `max(ground or water under the point +
 * clearance, own height)` by `0.0001 d^2`; the altitude probe runs 100 m
 * along the velocity (and 100 m level when the velocity points more than
 * half down); before the airborne flag the wanted height is 200 m (world y)
 * and no turn is made; then `towardsDirection` toward the point with the
 * pull-up demand `clearance - altitude`, throttle floor 1.0 and no dive
 * guard. `groundAt(x, z)` is the higher of the terrain and the water.
 * Returns the viewer's stick plus `airborne` (the flag after this tick) and
 * `arrived` (`ConPosition(point, 4 x radius)`, the MoveTo's end condition).
 */
export function towardsPoint({ orientation, position, velocity, angularVelocity = [0, 0, 0], target, clearance = 50,
                               groundAt = null, altitudeAlong = null, altitude = Infinity, airborne = true,
                               maxSpeed = 100, radius = 10, maxClimb = PLANE_FIRE.maxClimbAngle,
                               maxRoll = PLANE_FIRE.maxRollAngle }) {
  let ty = target[1];
  const dx = position[0] - target[0], dz = position[2] - target[2];
  const d2 = dx * dx + dz * dz;
  if (d2 < TOWARDS.pointLiftRange * TOWARDS.pointLiftRange) {
    const g = groundAt ? groundAt(target[0], target[2]) : -Infinity;
    let floor = (Number.isFinite(g) ? g : -Infinity) + clearance;
    if (floor <= position[1]) floor = position[1];
    const y = (ty - floor) * d2 * TOWARDS.pointLiftRate + floor;
    if (ty < y) ty = y;
  }
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  const vn = speed > 0 ? velocity.map(x => x / speed * TOWARDS.pointProbe) : velocity.map(x => x * TOWARDS.pointProbe);
  let flying = airborne;
  if (!flying && altitude >= TOWARDS.takeoffHeight && speed / Math.max(1, maxSpeed) >= TOWARDS.takeoffSpeedFraction) flying = true;
  let h = altitudeAlong ? altitudeAlong(vn) : Infinity;
  if (vn[1] < -TOWARDS.pointProbe * 0.5) {
    const l = Math.hypot(vn[0], vn[2]);
    const level = l > 0 ? [vn[0] / l * TOWARDS.pointProbe, 0, vn[2] / l * TOWARDS.pointProbe] : [0, 0, 0];
    if (altitudeAlong) h = Math.min(h, altitudeAlong(level));
  }
  if (!airborne) ty = TOWARDS.takeoffTargetY;
  const d = [target[0] - position[0], ty - position[1], target[2] - position[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const Fv = rotate(orientation, [0, 0, -1]);
  const dir = len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : Fv;
  const r = towardsDirectionEngine({
    dir: toEngine(dir), R: toEngine(rotate(orientation, [1, 0, 0])), U: toEngine(rotate(orientation, [0, 1, 0])),
    F: toEngine(Fv), omega: omegaToEngine(angularVelocity), climbDemand: clearance - h, clearance,
    takeoff: !airborne, throttleFloor: 1, speed, diveGuard: false, maxClimb, maxRoll,
  });
  const arrived = Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2])
    < PLANE.arriveRadiusFactor * radius;
  return { power: r.throttle >= 1 ? 1 : 0, throttle: r.throttle, roll: r.roll, pitch: r.pitch, rudder: r.yaw,
           airborne: flying, arrived, takeoff: !airborne, dbg: r.dbg, h };
}

/**
 * The boat's helm for one tick: `{ throttle, steer, angle, arrived }`, the
 * steer in the same sense as the tank law (`-(bearing - yaw)`).
 */
export function boatControl({ forward, velocity, toTarget, radius = 10, maxSpeed = null, prevSpeed = 0,
                              yawRate = 0, level = Infinity, prevThrottle = null, decision = null }) {
  const fLen = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / fLen, fz = forward[1] / fLen;
  const tLen = Math.hypot(toTarget[0], toTarget[1]);
  if (!(tLen > 1e-3)) return { throttle: 0, steer: 0, angle: 0, arrived: true };
  const dx = toTarget[0] / tLen, dz = toTarget[1] / tLen;
  const dot = fx * dx + fz * dz;
  const cross = fx * dz - fz * dx;
  const angle = Math.atan2(cross, dot);
  const arrived = tLen < BOAT.arriveRadiusFactor * radius;
  let steer = Math.abs(angle) > BOAT.fullRudderAngle ? Math.sign(angle) : clamp(angle / BOAT.fullRudderAngle, -1, 1);
  if (Math.abs(steer) < BOAT.rudderDeadBand) steer = 0;
  const speed = fx * velocity[0] + fz * velocity[1];
  if (decision && maxSpeed > 0 && !arrived) {
    // `BoatControl::towardsDirection` 0x0860df70: `actionStatusDecision`
    // then `speedControl` 0x0860cf40, which turns (below) when the drive is
    // 0 or, in state 0, the angle passes 30 deg (0x0860cf40's first test);
    // otherwise it runs underway on the decision's angle, negated when the
    // motion's sign differs from the drive, and wants `drive x` the speed.
    const turning = decision.drive === 0 || (decision.state === 0 && Math.abs(decision.angle) > BOAT.fullRudderAngle);
    if (!turning) {
      const a = decision.sign !== decision.drive ? -decision.angle : decision.angle;
      const r = boatSpeedControl({ angle: a, direction: decision.drive, maxSpeed, prevSpeed, yawRate, level });
      return { throttle: r.throttle, steer: r.rudder, angle: a, arrived, speed, wanted: r.wanted };
    }
  } else if (maxSpeed > 0 && !arrived && Math.abs(angle) <= BOAT.fullRudderAngle) {
    // Underway: the engine's regulated speed and damped rudder.
    const r = boatSpeedControl({ angle, maxSpeed, prevSpeed, yawRate, level });
    return { throttle: r.throttle, steer: r.rudder, angle, arrived, speed, wanted: r.wanted };
  }
  if (maxSpeed > 0 && !arrived && prevThrottle !== null) {
    // `speedControl`'s turn (state 0, the angle past 30 deg): full rudder
    // toward the target, flipped going astern; above 3 m/s the throttle
    // brakes against the motion, at or below it a full throttle is kept and
    // any other is set to the motion's sign. A hull at dead rest has no sign
    // to take: ahead (INVENTION; the engine's never sits at exactly 0).
    const motion = Math.sign(speed) || 1;
    const turn = motion * (Math.sign(angle) || 1);
    let t;
    if (Math.abs(speed) > BOAT.speedBand) t = -Math.sign(speed);
    else t = Math.abs(prevThrottle) === 1 ? prevThrottle : motion;
    return { throttle: t, steer: turn, angle, arrived, speed };
  }
  let throttle = dot >= BOAT.alignedCos ? 1 : (Math.abs(angle) > BOAT.fullRudderAngle ? 0.5 : 0.8);
  if (arrived) throttle = speed > BOAT.speedBand ? -0.5 : 0;
  return { throttle, steer, angle, arrived, speed };
}

/**
 * `BoatControl::resetControls(bot, true, false, false, done)` 0x0860dff0, as
 * `EntryBoatMoveTo::execute` 0x08613d60 calls it inside the move's radius:
 * the rudder and channels 1 / 2 zeroed; `v` the speed along the hull's
 * heading (velocity . matrix row 2); above 1 m/s the throttle brakes
 * against it, `-sign(v) log10(9 |v| + 1)` (0x0860e295..0x0860e33f; the
 * channel takes it clamped), and the move is not done; at or under 1 m/s
 * the throttle is zeroed and `done` stays true, so the move ends only once
 * the hull has all but stopped. (The full `-sign(v)` for `|v| <= 0.03` at
 * 0x0860e450 sits under the `|v| > 1` test and never runs.)
 */
export function boatResetControls(speedAlong) {
  const v = speedAlong;
  if (!(Math.abs(v) > BOAT.brakeDoneSpeed)) return { throttle: 0, steer: 0, done: true };
  const throttle = clamp(-Math.sign(v) * Math.log10(9 * Math.abs(v) + 1), -1, 1);
  return { throttle, steer: 0, done: false };
}

// -----------------------------------------------------------------------
// Aircraft spacing: the runway test and the collision avoidance
// -----------------------------------------------------------------------

/**
 * `BBChange::runwayClear` 0x0855f850. The plane's local box (`getLocalBounding
 * Box`, vt+0x24) gives `dx dy dz`; an orthographic frustum (`Frustum::
 * setupOrtho` 0x08441110 with width `1.5 dz`, height `1.3 dy`, near
 * `-0.6 dx`, far `12 dx`: the pushes at 0x0855f97a..0x0855f9e6, constants
 * 0x86be4d0 1.5, 0x87023e0 1.3, 0x87023e4 -0.6, 0x87023d8 12.0) is set in
 * the plane's frame with its z row flattened to the horizontal and
 * re-orthonormalised (0x0855f8b5..0x0855f960). `setupOrtho`'s planes keep
 * `|x| <= w / 2`, `|y| <= h / 2` and `-near <= z <= far`, so the box runs
 * from `0.6 dx` to `12 dx` ahead of the plane's origin, `0.75 dz` either
 * side and `0.65 dy` above and below. `getObjectsWithinFrustum` 0x085e3b80
 * asks the side's grid and the neutral one (0) with
 * `RunwayObstructedPredicate::includeInformation` 0x08560070: not the plane
 * itself, ITMobile (0x4000) set, ITSoldier (0x400000) and ITNaval (0x40)
 * clear. The runway is clear when none is inside. (A Spitfire's `dx` is its
 * 11.2 m span: 134 m ahead, 14 m wide.) The grid's own inside test (vt+0x18)
 * is not read: an object is inside when its position is (INFERRED).
 *
 * `others`: `{ pos: [x, y, z], types: [...] }`, the neutral and own-side
 * objects; `forward` the hull's nose on x/z.
 */
export const RUNWAY = { width: 1.5, height: 1.3, near: -0.6, far: 12.0 };

export function runwayClear({ position, forward, box, others }) {
  const dx = box.max[0] - box.min[0], dy = box.max[1] - box.min[1], dz = box.max[2] - box.min[2];
  const fl = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / fl, fz = forward[1] / fl;
  const halfW = RUNWAY.width * dz / 2, halfH = RUNWAY.height * dy / 2;
  const from = -RUNWAY.near * dx, to = RUNWAY.far * dx;
  for (const o of others ?? []) {
    const t = o.types ?? [];
    if (!t.includes('ITMobile') || t.includes('ITSoldier') || t.includes('ITNaval')) continue;
    const rx = o.pos[0] - position[0], ry = o.pos[1] - position[1], rz = o.pos[2] - position[2];
    const along = rx * fx + rz * fz;
    const across = rx * fz - rz * fx;
    if (along >= from && along <= to && Math.abs(across) <= halfW && Math.abs(ry) <= halfH) return false;
  }
  return true;
}

/**
 * `BBAvoid::collisionPredicted` 0x0855d2f0: `rel` the other's centre less
 * the bot's, `relVel` the other's velocity less the bot's, `R` the two
 * radii summed, `lookAhead` the seconds. Already overlapping: `{ t: 0 }`.
 * Otherwise, when `|relVel| >= 0.2`, the closest approach `tca = -rel .
 * relVel / |relVel|^2` (none behind, `tca < 0`); inside `R` there the first
 * contact is `t = tca - sqrt(R^2 - m^2) / |relVel|`, predicted when
 * `0 <= t <= lookAhead`, with the contact point `rel + relVel t`.
 * Returns null when none is predicted.
 */
export function collisionPredicted(rel, relVel, R, lookAhead) {
  const R2 = R * R;
  const d2 = rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2];
  if (d2 < R2) return { t: 0, point: [...rel] };
  const v2 = relVel[0] * relVel[0] + relVel[1] * relVel[1] + relVel[2] * relVel[2];
  if (!(v2 >= 1e-6)) return null;
  const v = Math.sqrt(v2);
  if (v < 0.2) return null;
  const tca = -(rel[0] * relVel[0] + rel[1] * relVel[1] + rel[2] * relVel[2]) / v2;
  if (tca < 0) return null;
  const c = [rel[0] + relVel[0] * tca, rel[1] + relVel[1] * tca, rel[2] + relVel[2] * tca];
  const m2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
  if (!(m2 < R2)) return null;
  const t = tca - Math.sqrt(R2 - m2) / v;
  if (t > lookAhead || t < 0) return null;
  return { t, point: [rel[0] + relVel[0] * t, rel[1] + relVel[1] * t, rel[2] + relVel[2] * t] };
}

/** The air avoid's constants. */
export const AIR_AVOID = {
  /** Mobile plug-in +0x2c, `avoidCollisionLookAhead`: 5.0 by both ctors
   *  (0x085e0bd7, 0x085e0c9b), set only on the big ships (15). */
  lookAhead: 5.0,
  /** `BAPConTime(1.1 t)` in `BBPAvoidCollision3d::createPlan`. */
  timeFactor: 1.1,
};

/**
 * `BBAvoid::calculateUrgency` 0x0855c650 for a bot in an aircraft. `self`
 * and each of `others`: `{ id, centre, velocity, radius, mass }`; the centre
 * is the position plus the rotated local box centre (`getSphereLocalOffset`
 * 0x085d6860: half of min + max), the radius the box's half diagonal about
 * that centre (`getSmallestRadius` 0x085d68f0 -> `LocalBoundingBox::
 * calcRadius` 0x083809f0, its second loop), the mass the object's physics
 * mass (`IPIPhysicalReal::getMass` 0x085ebd20 reads `AITemplatePhysical+8`,
 * which `initFromObject` 0x085e1130 copies from the world object's physics,
 * interface 0xc422 vt+0xa0). Neighbours are what the side's and the neutral
 * grid return within `lookAhead x speed + radius` of the centre. Each
 * predicted collision whose object moves at least the pathfinding's
 * potential-obstacle speed (`getPotentialObstacleMaxSpeed`, 0 on every
 * level, so every one) adds `mass x |relVel| / |rel|` (0x0855cf3d); the
 * largest names the plan's object. The caller multiplies by the modifier.
 */
export function airAvoidUrgency({ self, others, lookAhead = AIR_AVOID.lookAhead }) {
  const speed = Math.hypot(...self.velocity);
  const reach = lookAhead * speed + self.radius;
  let sum = 0, best = null, bestTerm = 0;
  for (const o of others ?? []) {
    if (o.id === self.id) continue;
    const rel = [o.centre[0] - self.centre[0], o.centre[1] - self.centre[1], o.centre[2] - self.centre[2]];
    const dist = Math.hypot(...rel);
    if (dist > reach + o.radius) continue;
    const relVel = [o.velocity[0] - self.velocity[0], o.velocity[1] - self.velocity[1], o.velocity[2] - self.velocity[2]];
    const hit = collisionPredicted(rel, relVel, self.radius + o.radius, lookAhead);
    if (!hit) continue;
    const term = (o.mass ?? 0) * Math.hypot(...relVel) / Math.max(dist, 1e-3);
    sum += term;
    if (term >= bestTerm) { bestTerm = term; best = { id: o.id, t: hit.t, point: hit.point, rel, relVel, other: o }; }
  }
  return { urgency: sum, best };
}

/**
 * `BBPAvoidCollision3d::createPlan` 0x08587420: a `MoveTo3d` to a point one
 * second of the bot's own travel ahead, turned 45 deg (0.7071) away from
 * the other. `n = getNormal(v) = (v.z, -v.x)` (0x08658780); with the other
 * on n's side (`n . d > 0`, `d` its x/z offset) the turn is +45 deg
 * (`((v.x - v.z), (v.x + v.z)) x 0.7071`), else -45 deg. The angle test
 * before it (`|u . n| - pi/2 > 0.349` at 0x085877f5, no acos) never passes:
 * that branch is dead. The point's height is the bot's less `2 t` when it is
 * the lower of the two, else plus `2 t` (the altitudes by Information
 * vt+0x20, INFERRED getAltitude). The move ends after `1.1 t` (`BAPConTime`)
 * or at the point (`BAPConPosition`); its speed is the Mobile plug-in's
 * `maxSpeed`, x0.3 unless the other is behind both diagonals, and the
 * viewer's `towardsPoint` takes no speed, so that cap is not ported.
 *
 * In the viewer's frame (z is the engine's negated); the side test is done
 * in the engine's.
 */
export function airAvoidPoint({ position, velocity, other, t, altitude, otherAltitude }) {
  const a = velocity[0], b = -velocity[2];
  const dx = other[0] - position[0], dz = -(other[2] - position[2]);
  const n = [b, -a];
  const plus = n[0] * dx + n[1] * dz > 0;
  const k = Math.SQRT1_2;
  const off = plus ? [(a - b) * k, (a + b) * k] : [(a + b) * k, (b - a) * k];
  const dy = altitude <= otherAltitude ? -2 * t : 2 * t;
  return { point: [position[0] + off[0], position[1] + dy, position[2] - off[1]], until: AIR_AVOID.timeFactor * t };
}
