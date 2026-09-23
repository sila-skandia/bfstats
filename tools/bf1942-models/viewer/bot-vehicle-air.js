// Bots in aircraft and boats: the plane's flight law and the boat's helm,
// derived on 2026-09-23 from `PlaneControl::towardsPoint` 0x08629730,
// `PlaneControl::towardsDirection` 0x0862a2a0, `EntryPlaneMoveTo::execute`
// 0x08620220, `BBPGotoWaypoint3d::createPlan` 0x085b81e0,
// `BoatControl::towardsDirection` 0x0860df70 / `speedControl` 0x0860e130
// and `EntryBoatMoveTo::execute` 0x08613d60 (features/
// bf1942-ai-research-2026-09-21/bot-behaviours.md §9, ledger AI-46..AI-47).
//
// What is read, and what stands in:
//
//  * The plane plan: for a 3D waypoint, `MoveTo3d(point, point, maxSpeed,
//    ConPosition(point, 4 * unit radius))`; the entry hands the first point
//    to `towardsPoint`, which within 100 m of it lifts the wanted altitude to
//    at least ground / water + a clearance (the move's own, blended in by
//    `0.0001 * d^2`), takes the plane's velocity direction over 100 m as
//    the frame, and marks a takeoff run while `speed / maxSpeed < 0.5` and
//    the unit is under 50 m/s.
//  * `towardsDirection`: probes 50 m along the plane's three axes; the roll
//    input follows the wanted direction's component along the plane's right
//    axis, the pitch its component along the up axis times 0.5 plus the
//    stall / dive terms, the yaw input a tenth of the lateral error; the
//    bank is cut to nothing above cos 0.866 (30 deg); the throttle correction
//    is `((e^(2.3 (1 - speed/43)) - 1) / 9) * -0.833 + 0.333` clamped to
//    [-1, ControlInfo +0x104]; a nose more than 50 m/s down levels first.
//    The exact stall / dive terms and the ControlInfo limits are not read
//    (the viewer's are INVENTION: a level pull-up under 40 m above ground).
//  * The boat: `actionStatusDecision` gives the angle and drive direction;
//    `speedControl` holds full rudder outside 30 deg (0.5236) with the
//    throttle held while the heading is within cos 0.996 of the wanted
//    direction, a 3 m/s speed band and a 0.03 dead band on the rudder.
//    Boats have no bitmap in the viewer: they hold a straight line to the
//    point (INVENTION).

const DEG = Math.PI / 180;

export const PLANE = {
  probe: 50.0,
  speedNorm: 43.0,
  bankCos: 0.866,
  pitchGain: 0.5,
  yawGain: 0.1,
  arriveRadiusFactor: 4.0,
  takeoffFraction: 0.5,
  takeoffSpeed: 50.0,
  /** Wanted height above the ground on the way (INVENTION). */
  cruiseClearance: 120.0,
  /** On the ground below this height above it; rotate at this fraction of
   *  the takeoff speed with this much stick (INVENTION). */
  groundHeight: 4.0,
  rotateFraction: 0.7,
  /** Stick: negative is nose up in the viewer's `c_PIPitch` (flight.js). */
  rotatePitch: -0.5,
  climbOutPitch: -0.35,
  rollGain: 1.0,
  verticalDamping: 0.01,
  noseUpLimit: 20 * DEG,
  noseDownLimit: 15 * DEG,
  /** Below this height above the ground the nose is held up (INVENTION). */
  pullUpHeight: 40.0,
  levelDownSpeed: -50.0,
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

/**
 * The plane's inputs for one tick. `orientation` is the hull quaternion
 * (`FORWARD` is -z, up +y, right +x), `position` / `target` world points,
 * `velocity` the world velocity, `groundY` the ground under the plane,
 * `targetGroundY` the ground under the target, `maxSpeed` the AI template's.
 * Returns `{ power, roll, pitch, rudder, takeoff, arrived }` with `power`
 * the throttle change sign (+1 / -1 / 0: the viewer's throttle latches).
 */
export function planeControl({ orientation, position, velocity, target, groundY, targetGroundY,
                               maxSpeed = 100, radius = 10, onGround = false }) {
  const f = rotate(orientation, [0, 0, -1]);
  const u = rotate(orientation, [0, 1, 0]);
  const r = rotate(orientation, [1, 0, 0]);
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  // `towardsPoint`: the wanted height rises to the ground plus the clearance
  // as the point nears; the arrival radius is `4 * unit radius`.
  const dx = target[0] - position[0], dz = target[2] - position[2];
  const d2 = dx * dx + dz * dz;
  let wantY = target[1];
  const floorY = (Number.isFinite(targetGroundY) ? targetGroundY : groundY) + PLANE.cruiseClearance;
  if (wantY < floorY) wantY = (wantY - floorY) * Math.min(1, d2 * 0.0001) + floorY;
  const arrived = Math.hypot(dx, target[1] - position[1], dz) < PLANE.arriveRadiusFactor * radius;
  const dirLen = Math.hypot(dx, wantY - position[1], dz) || 1;
  let d = [dx / dirLen, (wantY - position[1]) / dirLen, dz / dirLen];
  const height0 = position[1] - (Number.isFinite(groundY) ? groundY : position[1]);
  const takeoff = onGround || height0 < PLANE.groundHeight
    || (speed < PLANE.takeoffSpeed && speed / Math.max(1, maxSpeed) < PLANE.takeoffFraction);
  if (takeoff) {
    // The takeoff run: straight ahead, nose level until flying speed.
    d = [f[0], Math.max(0, f[1]), f[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / len, d[1] / len, d[2] / len];
  }
  // Too close to the ground, or diving hard: wings level, nose up, first.
  const height = position[1] - (Number.isFinite(groundY) ? groundY : position[1]);
  const climbOut = !takeoff && (height < PLANE.pullUpHeight || velocity[1] < PLANE.levelDownSpeed);
  const side = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];       // the wanted direction's right component
  const lift = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];       // its up component
  const ahead = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  // Bank toward the side, held level once the wings pass 30 deg (`0.866`).
  const upWorld = u[1];
  let roll = clamp(side * PLANE.rollGain, -1, 1);
  // A positive roll lowers the right wing; `r[1]` is the right wing's height,
  // so the bank grows while the two signs differ. Past 30 deg the bank is
  // held, and past 45 deg it is undone.
  const banking = Math.sign(roll) === -Math.sign(r[1]);
  if (upWorld < PLANE.bankCos && banking) roll *= Math.max(0, (upWorld - 0.5) / (PLANE.bankCos - 0.5));
  if (upWorld < 0.7071) roll = clamp(r[1] * 2.0, -1, 1);
  // The stick's pitch is negative for nose up (flight.js's elevator): the
  // engine's `up component x 0.5`, a vertical-speed damping against the
  // phugoid, and the nose held inside +-20 / -15 deg (the ControlInfo limits
  // are not read: INVENTION).
  const nosePitch = Math.asin(clamp(f[1], -1, 1));
  let pitch = clamp(-(lift * PLANE.pitchGain) + velocity[1] * PLANE.verticalDamping - (ahead < 0 ? 0.5 : 0), -1, 1);
  if (nosePitch > PLANE.noseUpLimit) pitch = Math.max(pitch, 0.15);
  if (nosePitch < -PLANE.noseDownLimit) pitch = Math.min(pitch, -0.25);
  if (takeoff) pitch = speed > PLANE.takeoffSpeed * PLANE.rotateFraction ? PLANE.rotatePitch : 0.0;
  // Wings level: a positive roll input lowers the right wing (`r[1]` is the
  // right wing's height), so the input follows `r[1]`.
  if (climbOut) { roll = clamp(r[1] * 2.0, -1, 1); pitch = PLANE.climbOutPitch; }
  const rudder = clamp(side * PLANE.yawGain * 3.0, -1, 1);
  // The shaped speed term of `towardsDirection` (`((e^(2.3 (1 - v/43)) - 1)
  // / 9) * -0.833 + 0.333`) feeds the pitch limit, not the throttle; the
  // throttle stays at full power (INVENTION: the throttle channel's own
  // write in that law is not read).
  const power = 1;
  return { power, roll, pitch, rudder, takeoff, climbOut, arrived, side, lift, ahead };
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
