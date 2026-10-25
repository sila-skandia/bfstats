// An aircraft on its wheels, as the dedicated server runs it each 30 Hz tick.
//
// The engine has no undercarriage model of its own. A plane stands on its
// three `Spring` parts exactly as a tank stands on its road wheels (ledger
// TANK-18..TANK-23, AIRGND-1..AIRGND-5): each tick
//
//   1 every spring pushes the root by `-(1.5 k D + c (D - Dprev) 30)` at its
//     anchor, `D` the anchor-to-wheel vector the last collision pass left
//     (`PhysicsSpring::updatePhysics` 0x0824ddd0), and the wheel snaps back
//     to its rest under its parent;
//   2 the wings, the engine and the box drag add to the same accumulators,
//     and the root takes one Euler step (`PhysicsNode::updatePhysics`
//     0x082543d0), with the sleep countdown;
//   3 the collision pass drops each awake wheel's col0 vertex 0 on the ground
//     (`checkVsTerrain` 0x0825a960), pushes the wheel out along the face
//     normal by at most 1 m (`solveImpulse` 0x08258d30), and `addFriction`
//     0x0825b6e0 answers the contact's tangential speed: an occupied
//     `c_PGFRollGripWhenOccupied` wheel asks back only its speed along its
//     axle (the spring node's row 0, which a steered tail wheel's bundle
//     turns), an empty one all of it, clamped by the static latch, posted as
//     the mean of every contact into the next tick's friction accumulators.
//
// The page's aircraft stood instead on a ride-height clamp 1.72 m over the
// heightfield (the SBD's, half a metre higher than the server's, whose springs
// sit 0.14 m compressed), levelled by a fitted slerp and steered by a per-step
// friction on the vertical only (`Aircraft.settle`, `groundFriction`). Every
// ack then corrected it by centimetres on the ground: the taxi and rudder the
// owner felt as bumpy.
//
// The law here is shared by every fixed-wing airframe whose wheels are springs
// (all of vanilla's: three `RollGripWhenOccupied` springs, k 24, c 12, the tail
// wheel under a `c_PIYaw` bundle). A helicopter (`vectored`) keeps the page's
// own handling.

import * as THREE from 'three';
import { clipAngleStep } from './vectored-engines.js';

/** The wheel's own side of the material pair. Every vanilla plane's wheels
 *  are material 37, which `materialManagerDefine.con` never defines, so it
 *  is material 0's: friction 1.0, resistance **0.02** (AIRGND-4; the lab SBD's
 *  rolling resistance matched the server's accumulator only so, 15% short at
 *  0.01). A tank's road wheel 178 is defined without a resistance and takes
 *  the `Material` default 0.01 instead (TANK-23). Material 0's resistance
 *  also stands in for a level whose tables carry none. */
const WHEEL_MATERIAL_FRICTION = 1.0;
const WHEEL_MATERIAL_RESISTANCE = 0.02;
const DEFAULT_MATERIAL_RESISTANCE = 0.02;

/** The engine's tick. */
export const TICK_HZ = 30;
export const TICK = 1 / TICK_HZ;

/** `getGravity() * -0.101833`: the spring's and the wing's normaliser, 1.49995
 *  at the shipped g (`PhysicsSpring::updatePhysics`). */
const SPRING_SCALE = 14.7295379 * 0.101833;

/** The root's sleep (TANK-21): the countdown, and what keeps it at 100. */
const SLEEP_TICKS = 100;
const WAKE_ACC2 = 2.5;
const WAKE_V2 = 0.25;
const WAKE_W2 = 0.25;
const CONTACT_WAKE2 = 0.1;
const ENGINE_WAKE_REVS = 0.05;

/** The root step's guards (TANK-22). */
const ACC_LIMIT = 1000;
const FR_LIMIT2 = 62500;
const RFR_LIMIT2 = 40000;

/** `solveImpulse`'s Spring branch moves a wheel at most a metre (TANK-20). */
const PUSH_LIMIT = 1;

/** `addFriction`'s kinetic budget per tick, before `A` and `N.y` (PHY-2). */
const COULOMB_LO = 1.5 * 9.82 / TICK_HZ;
const LATCH_EPS = 1.0000001e-6;

const _a = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _t = new THREE.Vector3();
const _vert = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _n = new THREE.Vector3();
const _C = new THREE.Vector3();
const _V = new THREE.Vector3();
const _Vt = new THREE.Vector3();
const _dV = new THREE.Vector3();
const _axle = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _steerQ = new THREE.Quaternion();
const _yAxis = new THREE.Vector3();
const _tPre = new THREE.Vector3();
const _tPost = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _surface = { y: NaN, nx: 0, ny: 1, nz: 0 };

/** Whether a wheel table carries what the law needs (`aircraftSpec`'s
 *  `anchor`, `vertex`, `strength`). */
export function wheelsCarryLaw(wheels) {
  return Array.isArray(wheels) && wheels.length > 0
    && wheels.every(w => Array.isArray(w.anchor) && Array.isArray(w.vertex) && w.strength > 0);
}

/** The law's per-airframe state: the root's accumulators and sleep, and each
 *  wheel's push, `Dprev`, latch and steering bundle. */
export function createGroundLaw(wheels) {
  return {
    clock: 0,
    fresh: true,
    sleepiness: SLEEP_TICKS,
    acc: new THREE.Vector3(0, -14.7295379, 0),
    racc: new THREE.Vector3(),
    fr: new THREE.Vector3(),
    rfr: new THREE.Vector3(),
    contacts: 0,
    // The pose the last collision pass ran at, and the one before it (where
    // each wheel's `Dprev` was pushed): what `rebase` measures a correction
    // against.
    last: { valid: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    prev: { valid: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    legs: wheels.map(spec => ({
      spec,
      push: new THREE.Vector3(),
      dPrev: new THREE.Vector3(),
      latch: false,
      steer: { angle: 0, speed: 0 },
      // The steering bundle's servo as `calculateAndClipAngle` runs it (GUN-2):
      // a tail wheel's yaw bundle declares `setAutomaticReset 1`.
      steerAxis: spec.steer ? { ...spec.steer.axis, automaticReset: spec.steer.automaticReset !== false } : null,
      contact: false,
      depth: 0,
      // The latch as the last pass found it, and the steering angle each of
      // the last two passes ran at.
      latchIn: false,
      steerLast: 0,
      steerPrev: 0,
    })),
  };
}

/** The steering bundle's turn of a leg, the glb frame (its yaw is the
 *  engine's negated, `vehicle-base.js` `SIGN`), into `out`. */
function steerOf(leg, out, angle = leg.steer.angle) {
  const steer = leg.spec.steer;
  if (!steer) return out.identity();
  const p = steer.pivot;
  return out.setFromAxisAngle(_yAxis.set(p[0], p[1], p[2]), -angle * Math.PI / 180);
}

/** A point of a leg (its anchor or its col0 vertex, root frame) where its
 *  steering bundle has it, root frame, into `out`. */
function legPoint(leg, point, out, angle = leg.steer.angle) {
  out.set(point[0], point[1], point[2]);
  const steer = leg.spec.steer;
  if (!steer?.origin) return out;
  const o = steer.origin;
  out.x -= o[0]; out.y -= o[1]; out.z -= o[2];
  out.applyQuaternion(steerOf(leg, _steerQ, angle));
  out.x += o[0]; out.y += o[1]; out.z += o[2];
  return out;
}

/** Each steering bundle's servo for one tick (`RotationalBundle::handleUpdate`). */
export function stepSteering(law, yaw, dt) {
  for (const leg of law.legs) {
    if (leg.steerAxis) clipAngleStep(leg.steer, leg.steerAxis, yaw, dt);
  }
}

/** The springs' accelerations into `acc` / `racc` (step 1). A sleeping root's
 *  springs keep `D` and push nothing. */
export function applySprings(law, s, acc, racc) {
  const awake = law.sleepiness > 0;
  const q = s.orientation;
  for (const leg of law.legs) {
    const dx = -leg.push.x, dy = -leg.push.y, dz = -leg.push.z;
    const px = leg.dPrev.x, py = leg.dPrev.y, pz = leg.dPrev.z;
    leg.dPrev.set(dx, dy, dz);
    if (!awake) continue;
    leg.push.set(0, 0, 0);
    const k = SPRING_SCALE * leg.spec.strength;
    const c = (leg.spec.damping || 0) * TICK_HZ;
    _a.set(-(k * dx + c * (dx - px)), -(k * dy + c * (dy - py)), -(k * dz + c * (dz - pz)));
    if (_a.lengthSq() === 0) continue;
    acc.add(_a);
    legPoint(leg, leg.spec.anchor, _arm).applyQuaternion(q);
    racc.add(_t.crossVectors(_arm, _a));
  }
}

/** `PhysicsEngine::updatePhysics`'s wake: a turning engine keeps the root up. */
export function wakeOnRevs(law, revs) {
  if (Math.abs(revs) >= ENGINE_WAKE_REVS && law.sleepiness >= 0) law.sleepiness = SLEEP_TICKS;
}

/**
 * The root's sleep test and step (`PhysicsNode::updatePhysics` 0x082543d0,
 * TANK-21/TANK-22). `acc` / `racc` are the tick's whole accumulators, gravity,
 * springs, wings, engines and drag in them; `fr` / `rfr` the last collision
 * pass's friction. `inertia` is the box's, mass included (`boxInertia`), and
 * `mass` turns a moment of acceleration back into a torque. `s.angularVelocity`
 * is the world's. Returns false when the root slept this tick.
 */
export function stepRoot(law, s, acc, racc, inertia, mass, h) {
  const w = s.angularVelocity;
  if (law.sleepiness >= 0) {
    if (acc.lengthSq() >= WAKE_ACC2 || s.velocity.lengthSq() >= WAKE_V2 || w.lengthSq() >= WAKE_W2) {
      law.sleepiness = SLEEP_TICKS;
    } else if (law.sleepiness > 0) {
      law.sleepiness -= 1;
    }
  }
  if (law.sleepiness <= 0) {
    s.velocity.set(0, 0, 0);
    w.set(0, 0, 0);
    clearAccumulators(law, 0);
    return false;
  }
  if (acc.lengthSq() > ACC_LIMIT * ACC_LIMIT) acc.setLength(ACC_LIMIT);
  s.velocity.addScaledVector(acc, h);
  if (law.fr.lengthSq() <= FR_LIMIT2) s.velocity.addScaledVector(law.fr, h);
  s.position.addScaledVector(s.velocity, h);
  if (racc.lengthSq() > ACC_LIMIT * ACC_LIMIT) racc.setLength(ACC_LIMIT);
  // Roll (the nose axis) takes the friction moment unguarded; pitch and yaw
  // only while it is under 200 (the root's `Tpre` and `Tpost`).
  const q = _q.copy(s.orientation);
  const qInv = _qInv.copy(q).invert();
  _tPre.copy(racc).add(law.rfr).applyQuaternion(qInv);
  _tPost.copy(racc);
  if (law.rfr.lengthSq() <= RFR_LIMIT2) _tPost.add(law.rfr);
  _tPost.applyQuaternion(qInv);
  const wb = _t.copy(w).applyQuaternion(qInv);
  wb.x += _tPost.x * mass * h / inertia.x;
  wb.y += _tPost.y * mass * h / inertia.y;
  wb.z += _tPre.z * mass * h / inertia.z;
  const rate = wb.length();
  if (rate * rate > 1e-6) {
    _axle.copy(wb).multiplyScalar(1 / rate);
    s.orientation.multiply(_spin.setFromAxisAngle(_axle, rate * h)).normalize();
  }
  w.copy(wb).applyQuaternion(s.orientation);
  return true;
}

/** The accumulators as the root leaves them: gravity alone, or nothing at all
 *  when it sleeps. `gravity` is the page's signed g (negative). */
export function clearAccumulators(law, gravity) {
  law.acc.set(0, gravity, 0);
  law.racc.set(0, 0, 0);
  law.fr.set(0, 0, 0);
  law.rfr.set(0, 0, 0);
}

/**
 * The ground under a probe: the engine's terrain (`Heightfield.engineSurface`,
 * TERR-16) where the page has it, else the injected `groundHeight`, and a
 * higher surface from `groundHeight` (a ship's deck, a drivable static) over
 * it. Into `out` (`y`, normal); false where there is none.
 */
function groundAt(plane, x, z, fromY, out, n) {
  const field = plane.collider?.heightfield;
  let y = -Infinity;
  // The page's own floor for the terrain is the lattice read bilinearly
  // (`Heightfield.height`, what `groundHeight` returns off a deck), which
  // stands up to centimetres over the engine's two triangles (TERR-16) on a
  // cell that bulges. It is not the ground the server's wheel meets: only a
  // surface over it as well (a deck) is taken from `groundHeight`. Taken
  // whenever it was the higher, it moved the wheel's push on El Alamein's
  // sand by 2-4 cm and turned the lab Bf109's lift-off friction over from
  // tick to tick (AIRGND-9, `features/aircraft-flight-law`, "The lift-off").
  let floor = NaN;
  if (field?.engineSurface) {
    field.engineSurface(x, z, _surface);
    if (Number.isFinite(_surface.y)) {
      y = _surface.y;
      n.set(_surface.nx, _surface.ny, _surface.nz);
    }
    if (typeof field.height === 'function') floor = field.height(x, z);
  }
  const other = plane.groundHeight(x, z, fromY);
  if (Number.isFinite(other) && other > y + 1e-3 && !(other <= floor + 1e-3)) {
    y = other;
    groundNormal(plane, x, z, fromY, n);
  } else if (Number.isFinite(y) && typeof plane.collider?.deckHeight === 'function') {
    // A drivable static whose top lies between the triangles and the bilinear
    // floor (a slab flush with a bulging cell): `groundHeight` hides it under
    // the floor, so it is asked of the collider itself, as the tracked drive's
    // `#ground` does.
    const deck = plane.collider.deckHeight(x, z, fromY);
    if (Number.isFinite(deck) && deck > y + 1e-3) {
      const d = plane.collider.deck;
      y = deck;
      if (d && Number.isFinite(d.ny)) n.set(d.nx, d.ny, d.nz);
      else groundNormal(plane, x, z, fromY, n);
    }
  }
  out.y = y;
  return Number.isFinite(y);
}

/** A surface's normal by central differences of `groundHeight`, 0.25 m. */
function groundNormal(plane, x, z, fromY, n) {
  if (plane.deckNormal && plane.deckNormal(x, z, fromY, _deck)) return n.set(_deck[0], _deck[1], _deck[2]);
  const e = 0.25;
  const hx0 = plane.groundHeight(x - e, z, fromY), hx1 = plane.groundHeight(x + e, z, fromY);
  const hz0 = plane.groundHeight(x, z - e, fromY), hz1 = plane.groundHeight(x, z + e, fromY);
  if (![hx0, hx1, hz0, hz1].every(Number.isFinite)) return n.set(0, 1, 0);
  return n.set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
}
const _deck = [0, 1, 0];
const _ground = { y: NaN };

/**
 * The collision pass over the wheels (step 3). `occupied` picks the
 * `RollGripWhenOccupied` arm: RollGrip with a pilot aboard, ContactGrip
 * without (`PhysicsSpring::updatePhysics`'s rewrite of the grip byte, 9 or 10).
 * `g` is the page's signed gravity (negative).
 */
export function collideWheels(plane, law, s, occupied, g) {
  const q = s.orientation;
  const fr = law.fr, rfr = law.rfr;
  let count = 0;
  law.contacts = 0;
  if (law.sleepiness <= 0) {
    for (const leg of law.legs) { leg.latch = false; leg.contact = false; }
    law.last.valid = false;
    law.prev.valid = false;
    return 0;
  }
  const w = s.angularVelocity;
  for (const leg of law.legs) {
    leg.latchIn = leg.latch;
    leg.steerPrev = leg.steerLast;
    leg.steerLast = leg.steer.angle;
  }
  law.prev.valid = law.last.valid;
  law.prev.pos.copy(law.last.pos);
  law.prev.quat.copy(law.last.quat);
  law.last.valid = true;
  law.last.pos.copy(s.position);
  law.last.quat.copy(q);
  for (const leg of law.legs) {
    legPoint(leg, leg.spec.vertex, _vert).applyQuaternion(q).add(s.position);
    legPoint(leg, leg.spec.anchor, _anchor).applyQuaternion(q).add(s.position);
    leg.contact = false;
    if (!groundAt(plane, _vert.x, _vert.z, _anchor.y + 0.5, _ground, _n)) continue;
    const depth = _vert.y - _ground.y;
    leg.depth = depth;
    if (depth > 0) continue;
    const nn = _n.lengthSq();
    const pushLen = Math.min(PUSH_LIMIT, Math.max(0, -depth * nn));
    leg.push.copy(_n).multiplyScalar(pushLen);
    leg.contact = true;
    law.contacts += 1;
    // The contact on the ground under the probe and its speed, next tick's
    // gravity in it (`impulseOn` 0x08258900, `addFriction`).
    _C.set(_vert.x, _ground.y, _vert.z);
    _arm.subVectors(_C, s.position);
    const speed = _V.crossVectors(w, _arm).add(s.velocity);
    const speed2 = speed.lengthSq();
    const ground = plane.surfaceFriction ? plane.surfaceFriction(_vert.x, _vert.z, _anchor.y) : 1.0;
    const groundRes = plane.surfaceFriction?.resistance
      ? plane.surfaceFriction.resistance(_vert.x, _vert.z, _anchor.y) : DEFAULT_MATERIAL_RESISTANCE;
    const A = 0.5 * (WHEEL_MATERIAL_FRICTION + (Number.isFinite(ground) ? ground : 1.0));
    const res = 0.5 * (WHEEL_MATERIAL_RESISTANCE + (Number.isFinite(groundRes) ? groundRes : DEFAULT_MATERIAL_RESISTANCE));
    speed.y += g / TICK_HZ;
    _Vt.copy(speed).addScaledVector(_n, -speed.dot(_n) / nn);
    if (res > 0) law.acc.addScaledVector(_Vt, -res);
    if (occupied) {
      // RollGrip: the speed along the axle (the wheel's row 0, its steering
      // bundle's turn in it) laid in the contact plane, asked back whole.
      _axle.set(1, 0, 0).applyQuaternion(steerOf(leg, _steerQ)).applyQuaternion(q);
      _axle.addScaledVector(_n, -_axle.dot(_n) / nn);
      const al = _axle.lengthSq();
      if (al > 0) _dV.copy(_axle).multiplyScalar(-_Vt.dot(_axle) / al);
      else _dV.set(0, 0, 0);
    } else {
      _dV.copy(_Vt).multiplyScalar(-1);
    }
    // The static latch: kinetic budget `lo`, break-away `hi = 1.5 lo`.
    const lo = A * COULOMB_LO * _n.y;
    const hi = 1.5 * lo;
    const m2 = _dV.lengthSq();
    if (leg.latch) {
      if (m2 > hi * hi && m2 > LATCH_EPS) {
        leg.latch = false;
        _dV.multiplyScalar(Math.abs(hi) / Math.sqrt(m2));
        const m2b = _dV.lengthSq();
        if (m2b > lo * lo && m2b > LATCH_EPS) _dV.multiplyScalar(Math.abs(lo) / Math.sqrt(m2b));
      }
    } else if (m2 > lo * lo && m2 > LATCH_EPS) {
      _dV.multiplyScalar(Math.abs(lo) / Math.sqrt(m2));
    } else {
      leg.latch = true;
    }
    // Posted at the wheel as `solveImpulse` left it plus the contact's offset
    // from it: the contact point moved out by the push.
    const f = _dV.multiplyScalar(TICK_HZ);
    _arm.copy(_C).add(leg.push).sub(s.position);
    fr.multiplyScalar(count).add(f).multiplyScalar(1 / (count + 1));
    rfr.multiplyScalar(count).add(_t.crossVectors(_arm, f)).multiplyScalar(1 / (count + 1));
    count += 1;
    if (speed2 > CONTACT_WAKE2 && law.sleepiness >= 0) law.sleepiness = SLEEP_TICKS;
  }
  return count;
}

/**
 * A drive that starts mid-life (a plane just boarded off its parked body)
 * has no last tick: every wheel is stood on the push the ground gives it now,
 * with no damper rate, the state a resting hull carries (`D` steady).
 */
export function settleLegs(plane, law, s) {
  law.fresh = false;
  const q = s.orientation;
  for (const leg of law.legs) {
    leg.push.set(0, 0, 0);
    legPoint(leg, leg.spec.vertex, _vert).applyQuaternion(q).add(s.position);
    legPoint(leg, leg.spec.anchor, _anchor).applyQuaternion(q).add(s.position);
    if (groundAt(plane, _vert.x, _vert.z, _anchor.y + 0.5, _ground, _n)) {
      const depth = _vert.y - _ground.y;
      if (depth <= 0) leg.push.copy(_n).multiplyScalar(Math.min(PUSH_LIMIT, -depth * _n.lengthSq()));
    }
    leg.dPrev.copy(leg.push).multiplyScalar(-1);
  }
}

/** The push the collision pass gives a leg at a pose (`solveImpulse`'s
 *  Spring branch, geometry only), into `out`. */
function pushAt(plane, leg, pos, quat, angle, out) {
  out.set(0, 0, 0);
  legPoint(leg, leg.spec.vertex, _vert, angle).applyQuaternion(quat).add(pos);
  legPoint(leg, leg.spec.anchor, _anchor, angle).applyQuaternion(quat).add(pos);
  if (!groundAt(plane, _vert.x, _vert.z, _anchor.y + 0.5, _ground, _n)) return out;
  const depth = _vert.y - _ground.y;
  if (depth <= 0) out.copy(_n).multiplyScalar(Math.min(PUSH_LIMIT, -depth * _n.lengthSq()));
  return out;
}

const _dq = new THREE.Quaternion();
const _dx = new THREE.Vector3();
const _push = new THREE.Vector3();
/** Beyond this a correction is a new start, not a nudge. [free] */
const REBASE_LIMIT = 2;

/**
 * Whether something moved the hull since the last collision pass (the
 * page's hull reconciler, a harness putting the server's state back), and if
 * so, the hidden state the law carries made to agree with the corrected pose.
 *
 * Each wheel's push is a function of the pose the pass ran at and its `Dprev`
 * of the pose before it. Left as they were, a correction moves the hull but
 * not its springs: the next tick reads the old compression and, through the
 * damper (`c (D - Dprev) 30`, 360 m/s^2 a metre for a plane's c 12, three
 * times a tank's), turns a millimetre's correction into a kick that the next
 * correction answers larger. The pose before is moved as the reconciler moves
 * every tick it holds (the same translation, the same turn on the left), both
 * pushes are taken again from the ground, and the pass's friction and rolling
 * resistance are run again from the latches it started with, at the corrected
 * velocity. Returns true when it rebased.
 */
export function rebase(plane, law, s, occupied, g) {
  if (!law.last.valid || law.sleepiness <= 0) return false;
  const moved = s.position.distanceToSquared(law.last.pos);
  const turned = 1 - Math.abs(s.orientation.dot(law.last.quat));
  if (moved < 1e-14 && turned < 1e-14) return false;
  if (moved > REBASE_LIMIT * REBASE_LIMIT) { law.fresh = true; law.last.valid = false; law.prev.valid = false; return false; }
  // The pose the tick before stood at, from the corrected state itself: the
  // root's step is `x += v dt` with the new v and the rows turned about the
  // new omega by `|omega| dt` (TANK-22), so the corrected position less
  // `v dt`, turned back by `omega dt`, IS the pose the last pass's `Dprev`
  // was pushed at (to the wire's 1 mm/s), where moving the old one along with
  // the correction carries that tick's own prediction error into the damper.
  law.prev.valid = true;
  law.prev.pos.copy(s.position).addScaledVector(s.velocity, -TICK);
  const w = s.angularVelocity;
  const rate = w.length();
  law.prev.quat.copy(s.orientation);
  if (rate > 1e-9) law.prev.quat.premultiply(_dq.setFromAxisAngle(_dx.copy(w).multiplyScalar(1 / rate), -rate * TICK));
  law.prev.quat.normalize();
  const prevPos = law.prev.pos.clone();
  const prevQuat = law.prev.quat.clone();
  for (const leg of law.legs) {
    leg.latch = leg.latchIn;
    leg.steer.angle = leg.steerLast;
    pushAt(plane, leg, prevPos, prevQuat, leg.steerPrev, _push);
    leg.dPrev.copy(_push).multiplyScalar(-1);
  }
  // The pass again, at the corrected pose and velocity, from a root that has
  // just stepped (gravity alone in the accumulator).
  const steerNow = law.legs.map(leg => leg.steerLast);
  const steerBefore = law.legs.map(leg => leg.steerPrev);
  clearAccumulators(law, g);
  for (const leg of law.legs) leg.push.set(0, 0, 0);
  // collideWheels shifts `last` into `prev`; keep the corrected one.
  law.last.valid = true;
  law.last.pos.copy(prevPos);
  law.last.quat.copy(prevQuat);
  law.legs.forEach((leg, i) => { leg.steerLast = steerBefore[i]; leg.steer.angle = steerNow[i]; });
  collideWheels(plane, law, s, occupied, g);
  return true;
}
