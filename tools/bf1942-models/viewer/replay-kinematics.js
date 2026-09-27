// What a replayed hull's own presentation needs that a v3 recording does not
// carry, derived from the motion it does carry: velocity and turn rates in the
// hull's frame, the stick that would turn it that way, the throttle that would
// move it that fast, and a ground vehicle's revs and gear.
//
// Everything here is an ESTIMATE from recorded poses, and is labelled as such
// wherever it reaches the page: a v3 recording has position and orientation at
// 10 Hz and nothing about the controls. A v4 recording's engine records (`g`,
// `replay-recording.js` `engineAt`) replace the throttle and revs outright;
// the stick has no recorded counterpart and stays derived.
//
// Frames: positions and quaternions in and out are the VIEWER's (BF1942's with
// z negated, quaternions (-x, -y, z, w); replay-actors.js). A hull's forward is
// its local -Z, up +Y, right +X, as `aircraft.js` / `wheeled-vehicle.js` have
// it. Three.js-free, so `tests/replay_kinematics_harness.mjs` runs it in node.

import { sampleAt } from './replay-recording.js';

/** Half the central-difference window, seconds: one recorded sample either
 *  side of the instant, which is the resolution the recording has. */
export const DIFF_HALF = 0.1;

/** The stick's full deflection, as body rates (rad/s). Not engine numbers --
 *  the recording has no controls to read -- but the order of what the vanilla
 *  airframes reach: the Corsair rolls at up to 200 deg/s, pitches at about a
 *  quarter of that and yaws at a tenth. A turn at these rates or faster is a
 *  full stick. */
export const AIR_FULL_RATES = Object.freeze({ pitch: 1.2, roll: 3.5, yaw: 0.6 });

/** A ground vehicle's wheelbase and steering lock, for turning a yaw rate
 *  into a steering input. Stand-ins for the hull's own geometry, which the
 *  rig carries per wheel but not as one number. */
const WHEELBASE = 2.6;
const STEER_LOCK = 30 * Math.PI / 180;

export function toViewPosition(p, out = [0, 0, 0]) {
  out[0] = p[0]; out[1] = p[1]; out[2] = -p[2];
  return out;
}

export function toViewQuaternion(q, out = [0, 0, 0, 1]) {
  out[0] = -q[0]; out[1] = -q[1]; out[2] = q[2]; out[3] = q[3];
  return out;
}

function slerp(a, b, k, out) {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  if (dot > 0.9995) {
    out[0] = ax + (bx - ax) * k; out[1] = ay + (by - ay) * k;
    out[2] = az + (bz - az) * k; out[3] = aw + (bw - aw) * k;
  } else {
    const theta = Math.acos(dot);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - k) * theta) / s;
    const wb = Math.sin(k * theta) / s;
    out[0] = ax * wa + bx * wb; out[1] = ay * wa + by * wb;
    out[2] = az * wa + bz * wb; out[3] = aw * wa + bw * wb;
  }
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= n; out[1] /= n; out[2] /= n; out[3] /= n;
  return out;
}

/** The recorded pose at `t` in the viewer's frame, interpolated exactly as
 *  the replay draws it (`sampleAt`), or null. */
export function poseAt(life, t) {
  const s = sampleAt(life, t);
  if (!s) return null;
  const p = toViewPosition(s.a.p);
  const q = toViewQuaternion(s.a.q);
  if (s.b) {
    const pb = toViewPosition(s.b.p);
    const qb = toViewQuaternion(s.b.q);
    p[0] += (pb[0] - p[0]) * s.k; p[1] += (pb[1] - p[1]) * s.k; p[2] += (pb[2] - p[2]) * s.k;
    slerp(q, qb, s.k, q);
  }
  return { p, q };
}

/** `v` turned by the unit quaternion `q`, into `out`. */
export function rotate(q, v, out = [0, 0, 0]) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

const conjugate = q => [-q[0], -q[1], -q[2], q[3]];

function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * The hull's motion at `t`: pose, world velocity (m/s), world angular velocity
 * (rad/s), both again in the hull's own frame, and its speed along its
 * forward axis. Central differences over `DIFF_HALF` either side, clamped to
 * the life's own lifetime so a spawn is not read as a leap from the origin.
 */
export function motionAt(life, t) {
  const pose = poseAt(life, t);
  if (!pose) return null;
  const t0 = Math.max(life.created, t - DIFF_HALF);
  const t1 = Math.min(Number.isFinite(life.destroyed) ? life.destroyed - 1e-3 : Infinity, t + DIFF_HALF);
  const span = t1 - t0;
  const a = span > 1e-3 ? poseAt(life, t0) : null;
  const b = span > 1e-3 ? poseAt(life, t1) : null;
  const velocity = [0, 0, 0];
  const angular = [0, 0, 0];
  if (a && b) {
    velocity[0] = (b.p[0] - a.p[0]) / span;
    velocity[1] = (b.p[1] - a.p[1]) / span;
    velocity[2] = (b.p[2] - a.p[2]) / span;
    // dq = qb * conj(qa) is the world-frame turn across the window.
    let dq = multiply(b.q, conjugate(a.q));
    if (dq[3] < 0) dq = dq.map(v => -v);
    const s = Math.hypot(dq[0], dq[1], dq[2]);
    if (s > 1e-9) {
      const angle = 2 * Math.atan2(s, dq[3]);
      const rate = angle / span;
      angular[0] = (dq[0] / s) * rate;
      angular[1] = (dq[1] / s) * rate;
      angular[2] = (dq[2] / s) * rate;
    }
  }
  // A recorded teleport (a respawn reusing nothing, a relevance jump) is not
  // motion: nothing in this game crosses 400 m/s.
  if (Math.hypot(velocity[0], velocity[1], velocity[2]) > 400) {
    velocity[0] = velocity[1] = velocity[2] = 0;
    angular[0] = angular[1] = angular[2] = 0;
  }
  const inverse = conjugate(pose.q);
  const bodyVelocity = rotate(inverse, velocity);
  const bodyRates = rotate(inverse, angular);
  return {
    position: pose.p,
    quaternion: pose.q,
    velocity,
    angular,
    bodyVelocity,
    bodyRates,
    speed: Math.hypot(velocity[0], velocity[1], velocity[2]),
    forward: -bodyVelocity[2],
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The stick that turns an aircraft at `bodyRates`: `c_PIPitch` positive is
 * nose DOWN (the Air map's Arrow Up, controls-rows.js), `c_PIYaw` positive is
 * right and `c_PIRoll` positive is right wing down. In the hull's frame a
 * positive rate about +X raises the nose, about +Y turns left and about +Z
 * (forward is -Z) lifts the right wing.
 */
export function aircraftStick(bodyRates, full = AIR_FULL_RATES) {
  return {
    pitch: clamp(-bodyRates[0] / full.pitch, -1, 1),
    yaw: clamp(-bodyRates[1] / full.yaw, -1, 1),
    roll: clamp(-bodyRates[2] / full.roll, -1, 1),
  };
}

/** The steering input that turns a wheeled hull at `yawRate` (rad/s, +Y left)
 *  going `forward` m/s: the bicycle model's lock, over the axle's own lock. */
export function groundSteer(yawRate, forward) {
  if (Math.abs(forward) < 0.5) return 0;
  const lock = Math.atan((-yawRate) * WHEELBASE / forward);
  return clamp(lock / STEER_LOCK, -1, 1);
}

/**
 * An aircraft's throttle from how it moves, 0..1: shut with nobody aboard,
 * idling on the ground at rest, climbing with the take-off roll, and under
 * power in flight -- more the faster and the harder it climbs. `vmax` is the
 * airframe's top speed where the data has one.
 */
export function aircraftThrottle({ crewed, airborne, speed, forwardAccel = 0, climb = 0, vmax = 60 }) {
  if (!crewed) return 0;
  if (!airborne) {
    if (speed < 1.5) return 0;
    // The take-off roll is full power; taxiing is a fraction of it.
    return clamp(speed / 20 + Math.max(0, forwardAccel) / 4, 0.15, 1);
  }
  const power = 0.45 + 0.45 * clamp(speed / vmax, 0, 1)
    + 0.1 * clamp(climb / 10, 0, 1) + 0.2 * clamp(forwardAccel / 5, 0, 1);
  return clamp(power, 0.35, 1);
}

/** A ship's throttle, signed: ahead or astern, by its speed along its own
 *  axis over the top speed. */
export function shipThrottle({ crewed, forward, vmax = 12 }) {
  if (!crewed) return 0;
  if (Math.abs(forward) < 0.3) return 0.1;
  return clamp(forward / vmax, -1, 1);
}

/**
 * A ground vehicle's revs and gear from its speed, by the engine's own
 * gearbox (`ground-engine.js` `EngineState`): in steady driving the contact
 * speed is `ratio(gear) * revs` (`engineGripTarget`), so the revs are the
 * speed over the gear's ratio, and the box shifts up past `gearUp` and down
 * below `gearDown` exactly as `Engine::handleUpdate` does. `engine` is the
 * drive's own `EngineState`; its `gear` is carried from frame to frame.
 */
export function groundRevs(engine, forward, crewed) {
  if (!engine?.ladder?.length) return crewed ? clamp(Math.abs(forward) / 15, 0.12, 1) : 0;
  if (!crewed) {
    engine.gear = 1;
    return 0;
  }
  const speed = Math.abs(forward);
  let gear = Math.max(1, Math.min(engine.ladder.length, engine.gear || 1));
  for (let i = 0; i < engine.ladder.length; i++) {
    const revs = speed / engine.ladder[gear - 1];
    if (revs > (engine.gearUp ?? 0.95) && gear < engine.ladder.length) gear += 1;
    else if (revs < (engine.gearDown ?? 0.4) && gear > 1 && speed / engine.ladder[gear - 2] < (engine.gearUp ?? 0.95)) gear -= 1;
    else break;
  }
  engine.gear = gear;
  const revs = speed / engine.ladder[gear - 1];
  // An engine turning over with its crew aboard is never silent: the idle.
  return clamp(Math.max(0.12, revs), 0, 1.2);
}

/** Height above whatever `groundHeight` says is under `position`, or
 *  Infinity where it says nothing. */
export function aboveGround(position, groundHeight) {
  const floor = groundHeight ? groundHeight(position[0], position[2]) : -Infinity;
  return Number.isFinite(floor) ? position[1] - floor : Infinity;
}

/**
 * Which model node each recorded moving part turns. Parts and nodes meet by
 * name; among a name's several nodes (a ship's identical AA guns) each placed
 * part takes the nearest to where the recording says it sits (a v5 `jn`),
 * closest pair first and each node once, and a part with no place takes the
 * name's next free node in model order. `parts` are `{ key, name, pos }` and
 * `nodes` `{ name, pos }`, positions in the root's frame and names compared as
 * given; returns Map<part key, node index>. A part left without a node is
 * absent.
 */
export function matchJointNodes(parts, nodes) {
  const byName = new Map();
  nodes.forEach((node, i) => {
    if (!byName.has(node.name)) byName.set(node.name, []);
    byName.get(node.name).push(i);
  });
  const out = new Map();
  const taken = new Set();
  const pairs = [];
  for (const part of parts) {
    if (!part.pos) continue;
    for (const i of byName.get(part.name) ?? []) {
      const at = nodes[i].pos;
      pairs.push([Math.hypot(at[0] - part.pos[0], at[1] - part.pos[1], at[2] - part.pos[2]), part.key, i]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, key, i] of pairs) {
    if (out.has(key) || taken.has(i)) continue;
    out.set(key, i);
    taken.add(i);
  }
  for (const part of parts) {
    if (out.has(part.key)) continue;
    const i = (byName.get(part.name) ?? []).find(j => !taken.has(j));
    if (i === undefined) continue;
    out.set(part.key, i);
    taken.add(i);
  }
  return out;
}
