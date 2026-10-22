// A ship under way, as the dedicated server runs it each 30 Hz tick.
//
// The engine has no ship model: a hull is a `PhysicsNode` root with a
// `c_ETShip` Engine, two rudder `Wing`s and a row of `FloatingBundle`s under
// it, and the server ticks it exactly as it ticks a tank (ledger TANK-18,
// SHIPLAW-1). One tick, in the server's order:
//
//   1 the handleUpdate pass. `Engine::handleUpdate` (`0x0823e120`, TANK-12)
//     turns the Engine's roll axis on the throttle (`calculateAndClipAngle`
//     `0x081d7490`, GUN-2: an automatic-reset axis ramps to `input * max` at
//     `|acceleration|` deg/s) and the gearbox's revs toward `2 (T1 - L)` on the
//     load the last tick left; `Wing::handleUpdate` (`0x08250950`) turns each
//     rudder the same way on `c_PIYaw`.
//   2 the children's physics, into the root's accumulators (SHIPLAW-2):
//     `PhysicsEngine::updatePhysics` (`0x0824cbb0`) wakes the root at
//     `|revs| >= 0.05`, and with its screw under the sea pushes
//     `fwd * K * ratio` at the screw, `K = 0.1|revs| + e|e|`,
//     `e = revs - (v . fwd)(1 - y/1000) / noPropellerEffectAtSpeed`; with the
//     screw out of the sea and `|revs| > 0.02` it pins the revs to 1 and
//     pushes nothing. `PhysicsWing::updatePhysics` (`0x0824ed10`) lifts each
//     rudder `-clamp(10 calculateLift(v + w x r, up, 1.5 (wingLift + flapLift)),
//     +-200)` along its up at its own position while it is under the sea.
//     `PhysicsFloatingBundle::updatePhysics` (`0x0824d640`, PHY-3,
//     `body-float.js`) adds each float's buoyancy and heave damping at the
//     float, while the root is awake.
//   3 the root, `PhysicsNode::updatePhysics` (`0x082543d0`): the sleep test
//     on the accumulators as the children left them (TANK-21), then the box
//     drag with the submerged scale `s = 1 + 24 min(underWater / DY, 1)` on
//     BOTH arms (SHIPLAW-3), then one Euler step (TANK-22), the accumulators
//     restarting at `(0, g, 0)`.
//   4 the collision pass, `ResponsePhysics::checkVsTerrain` (`0x0825a960`):
//     `underWater = waterLevel - (the lowest col0 vertex's world y)`, which the
//     next tick's drag reads. The page takes it at the start of the next tick
//     from the same pose, so a correction re-derives it for free.
//
// Under the old model the page sub-stepped the ship at 240 Hz on a pedal that
// spooled at its own rate, turned the rudders on the rig's position servo at
// `setMaxSpeed` (18 deg/s) instead of the automatic-reset ramp at
// `setAcceleration` (36), left the submerged scale off the angular drag, took
// the hull's depth off its collision box rather than its col0, kept a
// gyroscopic term the engine does not have and never slept. Every ack then
// corrected a Daihatsu by centimetres.
//
// What this does not do: the hull against the sea bed (the col0 vertices'
// `impulseOn` and friction) and against other objects. A hull that touches
// the bed falls back on `Ship`'s own push-out and friction after the step.

import * as THREE from 'three';
import { calculateLift } from './aircraft.js';
import { clipAngleStep } from './vectored-engines.js';
import { floatAcceleration, GRAVITY as SERVER_GRAVITY } from './body-float.js';
import { currentRatio, currentTorque, loadSample, revStep } from './engine-revs.js';

export const SHIP_TICK_HZ = 30;
export const SHIP_TICK = 1 / SHIP_TICK_HZ;

/** `getGravity()`, -14.73, and the wing's `g / -9.82` = 1.5 exactly. */
const G = SERVER_GRAVITY;
const WING_SCALE = G / -9.82;

/** `basicPhysicsSystem+0x24`: the height the air's density reaches zero at. */
const AIR_ZERO_HEIGHT = 1000;
/** `PhysicsWing::updatePhysics`: a wing under the sea lifts ten times. */
const WATER_MEDIUM = 10;
/** ...and its lift is clamped to +-200. */
const LIFT_CLAMP = 200;
/** `0.1*|revs|`, the half of `K` that does not fade with speed. */
const ENGINE_IDLE = 0.1;
/** The ship's water rule, `engineType & 8`: the screw out of the sea. */
const SHIP_ENGINE_TYPES = new Set(['c_ETShip', 'c_ETTorpedo']);
const PINNED_REVS_BAND = 0.02;
const PINNED_REVS = 1;

/** The root (TANK-21, TANK-22). */
const SLEEP_TICKS = 100;
const WAKE_ACC2 = 2.5;
const WAKE_V2 = 0.25;
const WAKE_W2 = 0.25;
const ENGINE_WAKE_REVS = 0.05;
const ACC_LIMIT = 1000;
const FR_LIMIT2 = 62500;
const RFR_LIMIT2 = 40000;

/** `updatePositionalDragAdvanced`'s areas: `3.14 * 0.25`, not pi/4. */
const DRAG_AREA = 3.14 * 0.25;
/** The submerged scale's top, `1 + 24 min(depth/DY, 1)`. */
const SUBMERGED_DRAG_TOP = 25;

/** `PlayerAction::get`: the engine sees an axis to the hundredth (TANK-24). */
const roundAxis = v => Math.round(Math.max(-1, Math.min(1, v || 0)) * 100) / 100;

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

const _acc = new THREE.Vector3();
const _racc = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _wb = new THREE.Vector3();
const _pre = new THREE.Vector3();
const _post = new THREE.Vector3();

/** A rig axis (`userData.rig.axes.<name>`) in `clipAngleStep`'s shape. */
function rigAxis(rig, name) {
  const spec = rig?.axes?.[name];
  if (!spec) return null;
  return {
    input: spec.input ?? null,
    min: spec.min ?? 0,
    max: spec.max ?? 0,
    free: !!spec.free,
    maxSpeed: spec.maxSpeed ?? 0,
    direction: spec.direction ?? 1,
    acceleration: spec.acceleration ?? 0,
    continuousRotation: spec.continuousRotation ?? 0,
    automaticReset: !!rig.automaticReset,
  };
}

function findNode(root, name, kind) {
  let found = null;
  root?.traverse?.(o => {
    if (!found && o.name === name && (!kind || o.userData?.templateKind === kind)) found = o;
  });
  return found;
}

/**
 * The law's state for a ship, or null when the hull carries nothing the law
 * runs on (no `c_ETShip` Engine, no floats).
 *
 * `underside` is the hull's col0 in its own frame (`Ship.underside`), whose
 * lowest vertex `checkVsTerrain` measures `underWater` from; the collision
 * box's bottom stands in for a hull without one.
 */
export function createShipLaw(ship) {
  const spec = ship.spec;
  const engineSpec = spec.engines?.find(e => SHIP_ENGINE_TYPES.has(e.engineType));
  if (!engineSpec || !ship.floats?.length) return null;
  const engineNode = findNode(ship.node, engineSpec.id, 'Engine');
  const rig = engineNode?.userData?.rig;
  const phys = engineNode?.userData?.physics ?? {};
  const roll = rigAxis(rig, 'roll') ?? {
    input: 'c_PIThrottle', min: (spec.throttleMin ?? -1) * 1, max: 1, free: false,
    maxSpeed: 1, direction: 1, acceleration: spec.throttleRate ?? 1, automaticReset: true,
  };
  const maxRotation = phys.maxRotation?.[2] || roll.max || 1;
  const engine = {
    spec: engineSpec,
    position: new THREE.Vector3(engineSpec.position[0], engineSpec.position[1], -engineSpec.position[2]),
    axis: roll,
    maxRotation,
    angle: 0,
    reg: { angle: 0, speed: 0 },
    ratio: currentRatio(engineSpec.differential ?? 1),
    torque: engineSpec.torque ?? 1,
    fade: engineSpec.noPropellerEffectAtSpeed || 1,
  };
  const wings = ship.surfaces.map((surface, i) => {
    const s = spec.surfaces[i] ?? {};
    const node = findNode(ship.node, s.node ?? surface.id, 'Wing');
    const axis = rigAxis(node?.userData?.rig, 'pitch') ?? {
      ...surface.axis, acceleration: surface.axis.maxSpeed, automaticReset: true,
    };
    return {
      surface,
      axis,
      reg: { angle: 0, speed: 0 },
      coeff: ((s.wingLift || 0) + (s.flapLift || 0)) * WING_SCALE,
    };
  });
  return {
    clock: 0,
    acc: new THREE.Vector3(0, G, 0),
    racc: new THREE.Vector3(),
    fr: new THREE.Vector3(),
    rfr: new THREE.Vector3(),
    sleepiness: SLEEP_TICKS,
    engine,
    wings,
    revs: 0,
    load: 0,
    loadCount: 0,
    underWater: 0,
    debug: null,
  };
}

/** `checkVsTerrain`'s `underWater`: the sea's height over the lowest col0
 *  vertex, or over the collision box's bottom corners without one. */
export function underWaterOf(ship) {
  const water = ship.waterHeight;
  if (!Number.isFinite(water)) return 0;
  const s = ship.state;
  let lowest = Infinity;
  const under = ship.underside;
  if (under?.length) {
    const e = _q.copy(s.orientation);
    for (let i = 0; i < under.length; i += 3) {
      const y = _r.set(under[i], under[i + 1], under[i + 2]).applyQuaternion(e).y;
      if (y < lowest) lowest = y;
    }
  } else {
    const [dx, , dz] = ship.spec.size ?? [0, 0, 0];
    const cx = ship.spec.hullCentre?.[0] ?? 0, cz = ship.spec.hullCentre?.[1] ?? 0;
    for (const x of [cx - dx / 2, cx + dx / 2]) {
      for (const z of [cz - dz / 2, cz + dz / 2]) {
        const y = _r.set(x, ship.keel, z).applyQuaternion(s.orientation).y;
        if (y < lowest) lowest = y;
      }
    }
  }
  const depth = water - (s.position.y + lowest);
  return depth > 0 ? depth : 0;
}

/** Seed the law from a whole server state (a test, a correction that carries
 *  the hidden fields). Angles are the Engine's `T1` and degrees. */
export function seedShipLaw(law, { revs, load, throttle, sleeping, acc, racc, fr, rfr } = {}) {
  if (Number.isFinite(revs)) law.revs = revs;
  if (Number.isFinite(load)) law.load = load;
  if (Number.isFinite(throttle)) law.engine.reg.angle = throttle * law.engine.maxRotation;
  if (sleeping !== undefined) law.sleepiness = sleeping ? 0 : SLEEP_TICKS;
  if (acc) law.acc.copy(acc);
  if (racc) law.racc.copy(racc);
  if (fr) law.fr.copy(fr);
  if (rfr) law.rfr.copy(rfr);
}

/**
 * One server tick. `throttle` and `yaw` are the input axes. Returns false
 * when the root slept this tick.
 */
export function shipTick(ship, law, throttle, yaw, running = true) {
  const s = ship.state;
  const k = ship.spec;
  const h = SHIP_TICK;
  const e = law.engine;
  law.underWater = underWaterOf(ship);

  // 1. handleUpdate: the Engine's roll axis and gearbox, the rudders.
  clipAngleStep(e.reg, e.axis, roundAxis(throttle), h);
  const t1 = e.reg.angle / e.maxRotation;
  // An engine that is off stores its revs as 0 (`0x0823e2e6`, TANK-12).
  law.revs = running ? revStep(law.revs, t1, law.load) : 0;
  law.load = 0;
  law.loadCount = 0;
  for (const wing of law.wings) clipAngleStep(wing.reg, wing.axis, roundAxis(yaw), h);

  // 2. The children, into the accumulators the last tick left.
  const acc = _acc.copy(law.acc);
  const racc = _racc.copy(law.racc);
  const addAt = (arm, a) => {
    acc.add(a);
    racc.add(_t.crossVectors(arm, a));
  };
  const q = s.orientation;
  // The Engine first: it sits in the hull's Bundle, ahead of the floats.
  if (Math.abs(law.revs) >= ENGINE_WAKE_REVS && law.sleepiness >= 0) law.sleepiness = SLEEP_TICKS;
  _r.copy(e.position).applyQuaternion(q);
  const screwY = s.position.y + _r.y;
  // Out of the sea the revs are pinned and nothing is pushed, but only off
  // the dead band: a screw in the air at `|revs| <= 0.02` still runs the
  // thrust (`0x0824cc89`/`0x0824d047`).
  let thrust = true;
  if (!(screwY < ship.waterHeight) && Math.abs(law.revs) > PINNED_REVS_BAND) {
    law.revs = PINNED_REVS;
    thrust = false;
  }
  if (thrust) {
    _fwd.copy(FORWARD).applyQuaternion(q);
    const rho = Math.max(0, Math.min(1, screwY / AIR_ZERO_HEIGHT));
    const ee = law.revs - s.velocity.dot(_fwd) * (1 - rho) / e.fade;
    const K = ENGINE_IDLE * Math.abs(law.revs) + Math.abs(ee) * ee;
    // `feedbackLoop(K fwd, fwd)`: the load the next tick's gearbox reads.
    const torque = currentTorque(e.torque, law.revs);
    if (Math.abs(torque) > 1e-12) {
      law.load = loadSample(law.load, law.loadCount, K * e.ratio / torque);
      law.loadCount++;
    }
    addAt(_r, _a.copy(_fwd).multiplyScalar(K * e.ratio));
  }
  // The rudders.
  for (const wing of law.wings) {
    const surface = wing.surface;
    surface.orient(wing.reg.angle, _qs);
    _up.copy(UP).applyQuaternion(_qs.premultiply(q));
    _r.copy(surface.apply).applyQuaternion(q);
    const y = s.position.y + _r.y;
    _v.copy(s.velocity).add(_rel.crossVectors(s.angularVelocity, _r));
    let lift = calculateLift(_v, _up, wing.coeff);
    if (y < ship.waterHeight) lift *= WATER_MEDIUM;
    else lift *= 1 - Math.max(0, Math.min(1, y / AIR_ZERO_HEIGHT));
    lift = Math.max(-LIFT_CLAMP, Math.min(LIFT_CLAMP, lift));
    addAt(_r, _a.copy(_up).multiplyScalar(-lift));
  }
  // The floats, while the root is awake.
  if (law.sleepiness > 0 && Number.isFinite(ship.waterHeight)) {
    for (const float of ship.floats) {
      _r.copy(float.local).applyQuaternion(q);
      _v.copy(s.velocity).add(_rel.crossVectors(s.angularVelocity, _r));
      const ay = floatAcceleration(float, {
        nodeY: s.position.y + _r.y,
        waterLevel: ship.waterHeight,
        verticalSpeed: _v.y,
        angle: float.angle || 0,
        sinkOffset: float.sinkOffset || 0,
        drag: k.drag,
        mass: k.mass,
        areaXZ: ship.footprint,
      });
      if (ay !== 0) addAt(_r, _a.set(0, ay, 0));
    }
  }
  if (law.debug) { law.debug.acc = acc.clone(); law.debug.racc = racc.clone(); }

  // 3. The root: sleep, drag, the step.
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
    law.acc.set(0, 0, 0);
    law.racc.set(0, 0, 0);
    law.fr.set(0, 0, 0);
    law.rfr.set(0, 0, 0);
    return false;
  }
  applyBoxDrag(ship, law.underWater, acc, racc);
  if (acc.lengthSq() > ACC_LIMIT * ACC_LIMIT) acc.setLength(ACC_LIMIT);
  s.velocity.addScaledVector(acc, h);
  if (law.fr.lengthSq() <= FR_LIMIT2) s.velocity.addScaledVector(law.fr, h);
  s.position.addScaledVector(s.velocity, h);
  if (racc.lengthSq() > ACC_LIMIT * ACC_LIMIT) racc.setLength(ACC_LIMIT);
  _qi.copy(q).invert();
  _pre.copy(racc).add(law.rfr).applyQuaternion(_qi);
  _post.copy(racc);
  if (law.rfr.lengthSq() <= RFR_LIMIT2) _post.add(law.rfr);
  _post.applyQuaternion(_qi);
  const I = ship.inertia;
  const wb = _wb.copy(w).applyQuaternion(_qi);
  wb.x += _post.x * k.mass * h / I.x;
  wb.y += _post.y * k.mass * h / I.y;
  wb.z += _pre.z * k.mass * h / I.z;
  const rate = wb.length();
  if (rate * rate > 1e-6) {
    _axis.copy(wb).multiplyScalar(1 / rate);
    q.multiply(_spin.setFromAxisAngle(_axis, rate * h)).normalize();
  }
  w.copy(wb).applyQuaternion(q);
  law.acc.set(0, G, 0);
  law.racc.set(0, 0, 0);
  law.fr.set(0, 0, 0);
  law.rfr.set(0, 0, 0);
  return true;
}

/**
 * `PhysicsNode::updatePositionalDragAdvanced` (`0x08252f50`) and
 * `updateRotationalDragAdvanced` (`0x08253280`), as `updatePhysics` calls them
 * for a root with a geometry box (`0x082544d0`..):
 *
 *   s       = 1 + 24 min(underWater / DY, 1)
 *   acc    += -drag |s v| / mass (Ax proj0(s v) + Ay proj1(s v) + Az proj2(s v))
 *   racc   += -drag s |w| / mass ((Ay+Az) proj0(w) + (Ax+Az) proj1(w) + (Ax+Ay) proj2(w))
 *
 * with `Ax = 0.785 DY DZ`, `Ay = 0.785 DX DZ`, `Az = 0.785 DX DY`. The scale is
 * on the rotational arm too (`param_5`), once.
 */
export function applyBoxDrag(ship, underWater, acc, racc) {
  const k = ship.spec;
  const [dx, dy, dz] = k.size;
  if (!(k.drag > 0) || !(k.mass > 0) || !(dy > 0)) return;
  const scale = 1 + (SUBMERGED_DRAG_TOP - 1) * Math.min(underWater / dy, 1);
  const ax = DRAG_AREA * dy * dz, ay = DRAG_AREA * dx * dz, az = DRAG_AREA * dx * dy;
  const q = ship.state.orientation;
  _qi.copy(q).invert();
  _v.copy(ship.state.velocity).multiplyScalar(scale);
  const speed = _v.length();
  if (speed > 0) {
    _rel.copy(_v).applyQuaternion(_qi);
    _a.set(_rel.x * ax, _rel.y * ay, _rel.z * az).applyQuaternion(q);
    acc.addScaledVector(_a, -k.drag * speed / k.mass);
  }
  const w = ship.state.angularVelocity;
  const rate = w.length();
  if (rate > 0) {
    _rel.copy(w).applyQuaternion(_qi);
    _a.set(_rel.x * (ay + az), _rel.y * (ax + az), _rel.z * (ax + ay)).applyQuaternion(q);
    racc.addScaledVector(_a, -scale * k.drag * rate / k.mass);
  }
}
