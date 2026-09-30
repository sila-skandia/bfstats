// Engines that do not point at the nose: a helicopter's hover engines, a
// Harrier's lift jets, a hovercraft's rudder fans. Split out of `aircraft.js`,
// which builds one of these per engine when an airframe carries any.
//
// Refractor has no helicopter class. Desert Combat's AH-64 is three `Engine`s
// placed with `setRotation 0/270/0` under three input-driven
// `RotationalBundle`s, and the retail client flies it with the same
// `PhysicsEngine::updatePhysics` (client `0x0057bfb0`, lnxded `0x0824cbb0`)
// that pulls a Spitfire along. Three things in that function, all read on
// lnxded 2026-09-30 (ledger PHY-12..PHY-14), are what make it a helicopter:
//
//  1. **The thrust axis is the engine's own.** `fwd` is row 2 of
//     `this->getAbsoluteTransformation()` (vtable `+0x20` ->
//     `PhysicsNode::getAbsoluteTransformation` `0x08254950`, which forwards to
//     the composite object's own absolute transform), so an Engine placed
//     pitched 270 degrees pushes straight up, and an Engine under a
//     `RotationalBundle` pushes wherever that bundle is posed:
//     `RotationalBundle::handleUpdate` (`0x081d78e0`) rebuilds the bundle's
//     relative transform from its clipped angles every update (`setState`'s
//     arithmetic, inlined at `0x081d7b7c`-`0x081d7bb4`). The force goes
//     on the ROOT through `addAccelerationAtAbsolutePosition` (root vtable
//     `+0x68`) at the engine's own absolute position (`+0x2c`); the speed term
//     reads the ROOT's positional speed (`+0x38`) against this engine's `fwd`.
//
//  2. **The throttle is the gearbox's rev state, not the pedal** (TANK-12).
//     `PhysicsEngine+0xa0` is written by `Engine::handleUpdate` (`0x0823e120`)
//     from `T1 = clippedRollAngle / maxRotation.z`, and the roll angle is run
//     by `RotationalBundle::calculateAndClipAngle` (`0x081d7490`), whose last
//     act is to clip it into `[minRotation.z, maxRotation.z]`. So
//     `setMinRotation .../1500` over `setMaxRotation .../5000` is an idle
//     floor: with the collective released the hover engines still sit at
//     `T1 = 0.3`, and `S` cannot take them lower.
//
//  3. **The engine's own rotation axes pose nothing** (physics.md §7).
//     `Engine::handleUpdate` runs `calculateAndClipAngle` for its three axes
//     and tail-calls `Engine::updateSound` (Engine vtable `+0xe0`), never
//     `setState`; the tilt a helicopter's stick asks for comes only from the
//     bundles above the engine.
//
// Everything here is arithmetic on the node tree's own extras: the Engine's
// rest orientation (its glb quaternion), each bundle's `rig` axes, the
// Engine's own `rig` roll axis and `physics.maxRotation`. No number is fitted.

import * as THREE from 'three';
import { currentRatio, currentTorque, loadSample, revAdvance } from './engine-revs.js';
import { SIMULATION_FPS } from './body-friction.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const RAD = Math.PI / 180;

/**
 * How far off the nose an engine must point before its airframe is flown on
 * the engine law here rather than `aircraft.js`'s fixed-wing path.
 *
 * Not an engine number: the engine runs one law for every `c_ETPlane`. It is
 * the viewer's seam, because the fixed-wing path is calibrated on the pedal
 * reaching the thrust law directly (`Aircraft.advanceEngines`) and must not
 * move. Surveyed over every extracted `VCAir` root with a `c_ETPlane` engine
 * on this PC (569 of them, 2026-09-30): the 491 fixed-wing aircraft have every
 * engine within 2 degrees of the nose (FHSW's Ar196, 2; all the rest, 0), and
 * the other 78 (helicopters, the Harrier, XPack2's jetpack, FHSW's E16A1 with
 * its engine turned round) have one at 90 degrees or more. 45 splits them
 * with room on both sides.
 */
export const LIFT_ENGINE_ANGLE = 45;

/** `0.1*|throttle|`, the half of `K` that does not fade with speed. */
const ENGINE_IDLE = 0.1;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * One tick of `RotationalBundle::calculateAndClipAngle` (lnxded `0x081d7490`,
 * ledger GUN-2), on a plain `{angle, speed}` register pair.
 *
 * Two laws, picked by the bundle's `setAutomaticReset`:
 *
 *   automaticReset   angle ramps STRAIGHT toward `x * maxRotation` at
 *                    `|acceleration|` deg/s; no velocity register
 *   otherwise        speed ramps toward `x * maxSpeed` at `|acceleration|`
 *                    deg/s^2, angle += speed*dt + continousRotationSpeed*dt
 *
 * with `x = input`, negated when the axis's `setAcceleration` is negative
 * (`direction`). `maxSpeed` enters signed, so an axis authored
 * `setMaxSpeed -150` with `setAcceleration -150` drives the servo law the
 * same way round as `150/150` and only the automaticReset law sees the
 * difference. Then the clip, in the engine's order: both bounds zero wraps
 * once by 360, else `> max -> max`, else `< min -> min`.
 *
 * The engine returns before touching either register when acceleration and
 * continuous rotation are both zero. `con.py` omits a zero acceleration, so a
 * missing one is read as zero here too; `axisOf` fills it from the Engine's
 * own `physics.acceleration` triple where that exists.
 *
 * @param {{angle: number, speed: number}} reg the axis's registers, mutated
 * @param {object} axis `{min, max, free, maxSpeed, direction, acceleration,
 *   continuousRotation, automaticReset}` in the `rig` extras' own units
 * @param {number} input this tick's `PlayerInput` value for the bound channel
 * @param {number} dt seconds
 */
export function clipAngleStep(reg, axis, input, dt) {
  const accel = Math.abs(axis.acceleration || 0);
  const continuous = axis.continuousRotation || 0;
  if (accel === 0 && continuous === 0) return reg;
  const x = (axis.direction < 0 ? -input : input) || 0;
  const step = accel * dt;
  if (axis.automaticReset) {
    const target = x * (axis.max ?? 0);
    reg.angle += clamp(target - reg.angle, -step, step);
  } else {
    const target = x * (axis.maxSpeed ?? 0);
    reg.speed += clamp(target - reg.speed, -step, step);
    reg.angle += reg.speed * dt + continuous * dt;
  }
  if (axis.free) {
    if (reg.angle > 180) reg.angle -= 360;
    else if (reg.angle < -180) reg.angle += 360;
  } else {
    const hi = axis.max ?? 0, lo = axis.min ?? 0;
    if (reg.angle > hi) reg.angle = hi;
    else if (reg.angle < lo) reg.angle = lo;
  }
  return reg;
}

/**
 * A `rig` axis as `clipAngleStep` reads it. `automaticReset` is declared per
 * bundle, not per axis (`con.py` `rig()`), so it is folded in here.
 */
function axisOf(spec, automaticReset, acceleration) {
  if (!spec) return null;
  return {
    input: spec.input ?? null,
    min: spec.min ?? 0,
    max: spec.max ?? 0,
    free: !!spec.free,
    maxSpeed: spec.maxSpeed ?? 0,
    direction: spec.direction ?? 1,
    acceleration: acceleration ?? spec.acceleration ?? 0,
    continuousRotation: spec.continuousRotation ?? 0,
    automaticReset: !!automaticReset,
  };
}

const AXIS_NAMES = ['yaw', 'pitch', 'roll'];

/** The input-driven axes a bundle's `rig` declares, or null for none. Rate
 *  (Engine spin) axes pose nothing and a gear axis is not a bundle's. */
function bundleAxes(rig) {
  if (!rig?.axes) return null;
  const axes = {};
  let any = false;
  for (const name of AXIS_NAMES) {
    const spec = rig.axes[name];
    if (!spec || spec.driver === 'rate' || !spec.input) continue;
    axes[name] = axisOf(spec, rig.automaticReset);
    any = true;
  }
  return any ? axes : null;
}

/**
 * Each rigged node's rest rotation, as first seen.
 *
 * A rack is a rig part the page poses (`Vehicle.applyRig`), and a seat that
 * is left mid-deflection leaves its node there: `#vacate` re-centres the
 * throttle and the pedals, not the stick, and applies the rig as it stands.
 * The next `Aircraft` built on the same hull would then read that deflection
 * as the rack's rest and fly with its thrust tilted for good. The first time
 * a rigged node is seen it is the authored pose (a hull's first `Aircraft` is
 * built before it has ever been posed), so that is the one kept.
 */
const restPoses = new WeakMap();
function restQuaternion(node) {
  if (!node.userData?.rig) return node.quaternion;
  let rest = restPoses.get(node);
  if (!rest) {
    rest = node.quaternion.clone();
    restPoses.set(node, rest);
  }
  return rest;
}

const _path = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** `to`'s rest pose in `from`'s frame, by composing the local transforms on
 *  the path between them (never the world matrices, which carry whatever the
 *  rig last posed). `from` must be an ancestor of `to`. */
function pathMatrix(from, to, out = _path) {
  const nodes = [];
  for (let n = to; n && n !== from; n = n.parent) nodes.push(n);
  out.identity();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    out.multiply(_local.compose(n.position, restQuaternion(n), n.scale));
  }
  return out;
}

/** `pathMatrix` as `{offset, quaternion}` arrays (glb frame). */
function relative(from, to) {
  pathMatrix(from, to).decompose(_p, _q, _s);
  return { offset: [_p.x, _p.y, _p.z], quaternion: [_q.x, _q.y, _q.z, _q.w] };
}

/**
 * Everything the engine law needs about one `Engine` node, read off the tree
 * `aircraftSpec` is walking. Positions and rotations are in the glb frame
 * (the exporter's Z mirror already applied), as the nodes carry them.
 *
 *   chain     the input-driven `RotationalBundle`s between the root and the
 *             engine, outermost first: each one's rest pose in its parent
 *             segment's frame and its `rig` axes
 *   local     the engine's own pose in the innermost segment's frame (its
 *             `setRotation`, e.g. the 0/270/0 that stands a hover engine up)
 *   throttle  the Engine's own roll axis — the `c_PIThrottle` (or
 *             `c_PIAltFire`, or `c_PIYaw`) binding whose clipped angle over
 *             `maxRotation.z` is `T1`
 *   offNose   degrees between the rest thrust axis and the nose
 *
 * @param {THREE.Object3D} root the vehicle root
 * @param {THREE.Object3D} node the `Engine` node
 */
export function engineGeometry(root, node) {
  const racks = [];
  for (let n = node.parent; n && n !== root; n = n.parent) {
    if (n.userData?.templateKind !== 'RotationalBundle') continue;
    const axes = bundleAxes(n.userData.rig);
    if (axes) racks.unshift({ node: n, axes });
  }
  const chain = [];
  let frame = root;
  for (const rack of racks) {
    chain.push({ id: rack.node.name, ...relative(frame, rack.node), axes: rack.axes });
    frame = rack.node;
  }
  const local = relative(frame, node);
  // The rest axis: every bundle at its rest pose.
  pathMatrix(root, node).decompose(_p, _q, _s);
  _dir.copy(FORWARD).applyQuaternion(_q);
  const offNose = Math.acos(clamp(_dir.dot(FORWARD), -1, 1)) / RAD;
  const physics = node.userData?.physics || {};
  const rig = node.userData?.rig;
  const roll = rig?.axes?.roll;
  // `physics.acceleration` is the Engine's own signed triple (`con.py` emits it
  // for exactly this: the drivetrain reads the numbers, not a pose). Its roll
  // component is the one `calculateAndClipAngle` ramps the throttle at.
  const accel = Array.isArray(physics.acceleration) ? Math.abs(physics.acceleration[2] ?? 0) : undefined;
  const throttle = roll ? axisOf(roll, rig.automaticReset, accel || undefined) : null;
  const maxRotationZ = Array.isArray(physics.maxRotation) ? physics.maxRotation[2] : (roll?.max ?? 0);
  return { chain, local, throttle, maxRotationZ, offNose };
}

// Scratch for the per-sub-step pose; nothing here may allocate.
const _pq = new THREE.Quaternion();
const _pr = new THREE.Quaternion();
const _pv = new THREE.Vector3();
const _pe = new THREE.Euler();

/**
 * One engine, flown on the engine's own law. Built by `Aircraft` from an
 * `aircraftSpec` engine entry that carries `engineGeometry`'s fields.
 */
export class VectoredEngine {
  constructor(spec) {
    this.id = spec.id;
    this.engineType = spec.engineType ?? null;
    // `getCurrentRatio` (`0x0824ca70`): 3.5 * setDifferential / ratioCurve[100].
    this.ratio = currentRatio(spec.differential ?? 1);
    // `setTorque`, the divisor of the load `feedbackLoop` feeds the gearbox.
    this.torque = spec.torque ?? 0;
    this.fadeSpeed = spec.noPropellerEffectAtSpeed || 100;
    this.throttle = spec.throttle || null;
    this.maxRotationZ = spec.maxRotationZ ?? 0;
    this.chain = (spec.chain || []).map(segment => ({
      id: segment.id,
      offset: new THREE.Vector3(...segment.offset),
      quaternion: new THREE.Quaternion(...segment.quaternion),
      axes: Object.entries(segment.axes || {}).map(([name, axis]) => ({ name, axis, reg: { angle: 0, speed: 0 } })),
    }));
    this.local = {
      offset: new THREE.Vector3(...(spec.local?.offset || [0, 0, 0])),
      quaternion: new THREE.Quaternion(...(spec.local?.quaternion || [0, 0, 0, 1])),
    };
    this.reset();
  }

  /** Back to rest: bundles centred, throttle angle at zero, gearbox stopped. */
  reset() {
    this.roll = { angle: 0, speed: 0 };
    // The throttle axis clips on its first tick, so an idle floor is reached
    // then; before any tick the angle is the engine ctor's zero.
    for (const segment of this.chain) for (const a of segment.axes) { a.reg.angle = 0; a.reg.speed = 0; }
    /** `PhysicsEngine+0xa0`, the rev state, which IS the thrust law's throttle. */
    this.revs = 0;
    /** `+0xa4` / `+0xac`: the load `feedbackLoop` accumulates within a tick. */
    this.load = 0;
    this.loadCount = 0;
  }

  /** The throttle axis's `PlayerInput` channel, or null for an unbound engine. */
  get input() { return this.throttle?.input ?? null; }

  /** `T1 = clippedRollAngle / maxRotation.z` (`0x0823e1e0`-`0x0823e1f4`). */
  get t1() {
    return this.maxRotationZ ? this.roll.angle / this.maxRotationZ : 0;
  }

  /**
   * `Engine::handleUpdate` (`0x0823e120`), once per `integrate`.
   *
   * The throttle angle first (the engine's `calculateAndClipAngle` for the roll
   * axis), then the gearbox on the load the previous tick's thrust
   * evaluations left, then the load cleared — the function's own order. The
   * filter's `0.05` is per engine tick (TANK-12), so `dt` is converted to
   * 30 Hz ticks and `revAdvance`'s closed form runs them.
   *
   * `running` is `Engine+0x142`: TemplateMessage 4 sets it and 5, 0x14 and
   * 0x15 clear it (`Engine::handleMessage` `0x0823e730`), and while it is
   * clear `handlePlayerInput` (`0x0823e5e0`) zeroes the inputs and the gearbox
   * forces the revs to zero (`0x0823e2e6`).
   *
   * @param {number} dt seconds
   * @param {number} input this frame's value of `this.input`
   * @param {boolean} running
   */
  advance(dt, input, running = true) {
    if (this.throttle) clipAngleStep(this.roll, this.throttle, running ? input : 0, dt);
    this.revs = running ? revAdvance(this.revs, this.t1, this.load, dt * SIMULATION_FPS) : 0;
    this.load = 0;
    this.loadCount = 0;
  }

  /** `RotationalBundle::handleUpdate` for every bundle above the engine. */
  stepBundles(dt, inputOf) {
    for (const segment of this.chain) {
      for (const a of segment.axes) clipAngleStep(a.reg, a.axis, a.axis.input ? inputOf(a.axis.input) : 0, dt);
    }
  }

  /**
   * Where the engine points and where it sits, in the world frame, as the
   * bundles stand: `outDir` the thrust axis (row 2 of its absolute transform,
   * `FORWARD` in the glb frame), `outArm` its position relative to the root's
   * origin.
   *
   * Each bundle is `rest * R(yaw, pitch, roll)`, `RotationalBundle::setState`'s
   * `pivot * setRotation(angles) * bundleTransformation` with the pivot at the
   * origin (no DC rack authors one). `R` is Refractor's `Ry*Rx*Rz` mirrored
   * into the glb frame the way `bf42/gltf.py`'s `quat_from_ypr` mirrors a
   * placement: yaw and pitch negated, roll kept.
   */
  pose(orientation, outDir, outArm) {
    _pq.copy(orientation);
    outArm.set(0, 0, 0);
    for (const segment of this.chain) {
      outArm.add(_pv.copy(segment.offset).applyQuaternion(_pq));
      _pq.multiply(segment.quaternion);
      let yaw = 0, pitch = 0, roll = 0;
      for (const a of segment.axes) {
        if (a.name === 'yaw') yaw = a.reg.angle;
        else if (a.name === 'pitch') pitch = a.reg.angle;
        else roll = a.reg.angle;
      }
      if (yaw || pitch || roll) _pq.multiply(_pr.setFromEuler(_pe.set(-pitch * RAD, -yaw * RAD, roll * RAD, 'YXZ')));
    }
    outArm.add(_pv.copy(this.local.offset).applyQuaternion(_pq));
    _pq.multiply(this.local.quaternion);
    outDir.copy(FORWARD).applyQuaternion(_pq);
    return outDir;
  }

  /**
   * `K` for this evaluation, `PhysicsEngine::updatePhysics` (`0x0824cbb0`):
   *
   *   e = revs - rho*(v.fwd)/setNoPropellerEffectAtSpeed
   *   K = 0.1*|revs| + e*|e|
   *
   * and `feedbackLoop(K*fwd, fwd)` (`0x0824c850`) folded into the load: for a
   * `c_ETPlane` (bits 1 and 2 clear) `L0 = K*ratio/getCurrentTorque()` into
   * the running mean. The caller applies `fwd * K * ratio`.
   *
   * @param {number} along the root's velocity along this engine's `fwd`
   * @param {number} rho `1 - clamp(y/airDensityZeroAtHeight, 0, 1)` at the engine
   */
  thrust(along, rho) {
    const e = this.revs - rho * along / this.fadeSpeed;
    const k = ENGINE_IDLE * Math.abs(this.revs) + e * Math.abs(e);
    const torque = currentTorque(this.torque, this.revs);
    if (Math.abs(torque) > 1e-9) {
      this.load = loadSample(this.load, this.loadCount, k * this.ratio / torque);
      this.loadCount++;
    }
    return k;
  }
}
