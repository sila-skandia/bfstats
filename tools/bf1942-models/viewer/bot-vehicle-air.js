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
//    move's clearance (the order's altitude, `BBPGotoWaypoint3d` reads it
//    from the order +0x14) is not read: `PLANE.cruiseClearance` (INVENTION).
//  * The boat: `actionStatusDecision` gives the angle and drive direction;
//    `speedControl` holds full rudder outside 30 deg (0.5236) with the
//    throttle held while the heading is within cos 0.996 of the wanted
//    direction, a 3 m/s speed band and a 0.03 dead band on the rudder.

const DEG = Math.PI / 180;

export const PLANE = {
  /** `ConPosition(point, 4 x unit radius)`, the 3D move's end condition. */
  arriveRadiusFactor: 4.0,
  /** A waypoint move's clearance (INVENTION: the order's altitude is not
   *  read). */
  cruiseClearance: 120.0,
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
  clearance: 50.0,
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
};

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
 * 0x085a0080) is `ObjectDistance(R)` and the precision test (mode 0 / 3
 * `BAPCConPrecision3d`, 1 / 2 `BAPCConBombPrecision3d` 0x0854a8c0 alike
 * for a gun): the round's miss within `max(0.1, precision)` m. The
 * precision classes' closest-approach flag (the weapon template's first
 * byte) is not decoded; the direct test is used (INVENTION).
 * Returns `{ phase, fire, inFront, dist, dir, miss }`.
 */
export function attackRunStep(state, { position, forward, velocity, target, targetVel = [0, 0, 0],
                                       maxRange, turnRadius = 25, lineOfFire = true, mode = 1,
                                       precision = 1, muzzle = null, aimDir = null, roundSpeed = 600,
                                       gravity = 0 }) {
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
  const relVel = [targetVel[0] - velocity[0], targetVel[1] - velocity[1], targetVel[2] - velocity[2]];
  const { miss } = roundMiss({ rel, relVel, dir: aimDir ?? forward, speed: roundSpeed, gravity });
  const fire = state.phase === 'attack' && dist <= maxRange && miss <= Math.max(PLANE_FIRE.precisionMin, precision);
  return { phase: state.phase, fire, inFront, dist, dir, miss };
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
export function boatControl({ forward, velocity, toTarget, radius = 10 }) {
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
  let throttle = dot >= BOAT.alignedCos ? 1 : (Math.abs(angle) > BOAT.fullRudderAngle ? 0.5 : 0.8);
  if (arrived) throttle = speed > BOAT.speedBand ? -0.5 : 0;
  return { throttle, steer, angle, arrived };
}
