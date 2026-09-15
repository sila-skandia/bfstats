// Driving a Refractor land vehicle that is already standing in an extracted map.
//
// Same seam as `flight.js`, on purpose and to the letter:
//
//   input source  ->  VehicleState  ->  presentation (rig, camera, audio)
//
// `GroundVehicle` extends `Vehicle` and adds only the model that turns inputs
// into state. Nothing below the seam knows whether the throttle came from a
// keyboard or a replay, and nothing above it reads anything but `VehicleState`.
//
// What is different from an aircraft is where the numbers come from. The
// Corsair's flight model had to be reconstructed from `Wing` templates and a
// calibration; a land vehicle's chassis is declared almost completely in
// `Physics.con` and `assemble.py` now carries it into the glb as
// `extras.physics`. A Willys jeep arrives with four `Spring` nodes (position,
// `setStrength 25`, `setDamping 5`, a traction class per wheel), an `Engine`
// (`c_ETCar`, `setTorque 10.5`, `setDifferential 7`, a five-speed gearbox with
// its shift points) and a steered `RotationalBundle` per front wheel. This
// module reads all of that off the node tree at construction; the `WILLYS`
// table below only fills in what the data genuinely does not say.
//
// PROVISIONAL, in the same sense `Aircraft`'s roll model is: the retail
// engine's car integrator has not been read out of the executable the way the
// point-body one has (`physics.js`), so the *shape* of this model — vertical
// spring rays, a linear tyre inside a friction circle, torque as mass-free
// acceleration — is our reconstruction, contained in `integrate` and
// replaceable without anything outside noticing.

import * as THREE from 'three';
import { Vehicle } from './flight.js';
import { GRAVITY } from './physics.js';

// Same body frame the flight model measured off the extracted scenes: -Z
// forward, +Y up, +X starboard. The Willy agrees — its front wheels sit at
// z = -0.75 in the glb and its rear springs at z = +1.46.
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

const DEG = Math.PI / 180;

/** The two grips a wheel declares, and what they mean to the drivetrain. */
const GRIP_DRIVEN = 'c_PGFEngineGrip';

/**
 * Willys jeep numbers. Every one is either read from the shipped data (and the
 * glb now carries it, so the fallback here should never fire on a current
 * extract) or marked as fitted and awaiting measurement against the game.
 */
export const WILLYS = {
  // `Objects.con`: `mass 2500`, `drag 1.5`. Mass never appears alone in this
  // model — every force is kept in acceleration units, the same reading of
  // `setTorque` the flight model uses — but the exe's drag equation divides by
  // it, so it is real data doing real work below. [data]
  mass: 2500,
  drag: 1.5,
  // Enters the retail drag equation as pi r^2 / mass (`physics.js`,
  // `applyDrag`, 0x00578990). Not declared for vehicles anywhere we can read;
  // 1.8 m is the jeep's rough envelope. At these numbers aero drag is
  // 0.11 m/s^2 at top speed — present, and nearly decorative. [free]
  boundingRadius: 1.8,

  // --- drivetrain, `Physics.con` --------------------------------------------
  // `setTorque`, read the way flight-model.md section 2b reads it for
  // aircraft: peak drive as acceleration, m/s^2, mass already inside. For a
  // car we take that peak to be first gear's, and scale the other gears down
  // by ratio — see `gearRatios`. [data; the units are strong inference]
  torque: 10.5,
  // `setDifferential 7`: final drive between engine revs and wheel revs.
  // With the measured wheel radius it is one leg of the top-speed arithmetic
  // below, which is the strongest evidence for reading it as a ratio. [data]
  differential: 7,
  // `setNumberOfGears 5`, `setGearUp 0.95`, `setGearDown 0.4`: the gear count
  // and the shift points as fractions of maximum revs. This is the whole of
  // what the game declares about the gearbox — there is no per-gear ratio
  // anywhere in the vanilla data, we looked. [data]
  numberOfGears: 5,
  gearUp: 0.95,
  gearDown: 0.4,
  // The ratio ladder the data does not have. Five steps from a 3.8 crawler to
  // a 1.0 top, roughly geometric, chosen so the post-upshift revs land at
  // 0.65-0.76 of the limit — comfortably above the 0.4 downshift point, so
  // the automatic never hunts. Reverse borrows first. [free]
  gearRatios: [3.8, 2.6, 1.8, 1.25, 1.0],
  reverseRatio: 3.8,
  // Engine speed ceiling, rad/s. The one number that closes the top-speed
  // equation: v = revLimit x wheelRadius / (differential x topGear), and 356
  // puts that at 18.5 m/s (66.6 km/h) before resistance, 18.3 after — inside
  // the 60-70 km/h band the game's Willys is remembered to do. 356 rad/s is
  // 3,400 rpm, which is even the right neighbourhood for the real vehicle's
  // Go-Devil engine, though nothing here leans on that. [free]
  revLimit: 356,
  // Torque fades linearly over the last (1 - gearUp) of the rev range, the
  // same shape `setNoPropellerEffectAtSpeed` gives an aircraft: top speed is
  // where faded drive meets resistance, not a hard wall. [free, shape only —
  // the endpoints are gearUp and revLimit above]
  //
  // --- wheels ---------------------------------------------------------------
  // Measured off `Willy_WheelR_M1`'s vertex bounds in the glb: the tyre spans
  // -0.364..0.364 in Y and Z. Not declared in any .con — the engine gets it
  // from the collision mesh, and so, indirectly, do we. [data, measured]
  wheelRadius: 0.364,
  // `setStrength 25` / `setDamping 5`, per wheel. The units are acceleration
  // per metre and per metre-per-second — per-mass, like torque — and the
  // evidence is too tidy to be coincidence: four wheels give the heave mode
  // 2 x sqrt(4 x 25) = 20 of critical damping, and 4 x 5 = 20 is exactly what
  // the data provides. Somebody at DICE tuned this critically damped. [data;
  // units strong inference]
  springStrength: 25,
  springDamping: 5,
  // How far a spring may compress before it is riding on the bump stop, and
  // how much stiffer the stop is. Neither is declared. [free]
  suspensionTravel: 0.30,
  bumpStiffness: 5,

  // --- tyres ----------------------------------------------------------------
  // Friction coefficient against the declared grip classes. The classes
  // themselves (`c_PGFRollGrip` fronts, `c_PGFEngineGrip` rears) are data;
  // the coefficient behind them is not readable, so one mu covers both. At
  // 1.0 the jeep corners at up to one BF-gravity (14.73 m/s^2) and launches
  // traction-limited at about 6 m/s^2 on its rear axle. [free]
  mu: 1.0,
  // Lateral force per radian of slip, per unit of that wheel's normal load.
  // Saturates against mu at 1/7 rad (8 degrees) of slip. Load-proportional
  // stiffness makes this jeep neutral-steer in the textbook sense; the
  // understeer you feel at the limit comes from the friction circle eating
  // the driven axle's lateral grip. [free]
  corneringStiffness: 7,
  // Slip angles are read against a floored longitudinal speed and faded in
  // below walking pace, because a tyre model with real authority at zero
  // speed is a numerical oscillator, not a tyre. [free, numerics]
  slipFloor: 1.5,
  // --- resistance and brakes ------------------------------------------------
  rollingResistance: 0.55,  // m/s^2, always-on once moving [free]
  engineBraking: 0.4,       // m/s^2, throttle closed [free]
  brakeDecel: 8,            // m/s^2 at full pedal, before the friction circle [free]
  // Below this forward speed an opposed throttle stops braking and starts
  // driving the other way — the BF1942 behaviour where holding S brakes to a
  // halt and then backs up. [free]
  reverseBelow: 0.5,

  // --- the rigid body -------------------------------------------------------
  // Per-mass inertia (radius of gyration squared, m^2) about roll/pitch/yaw,
  // from a 1.6 x 1.5 x 3.6 m box. The Willys declares no `inertiaModifier`
  // the way every aircraft does, so not even the ratios are data here. [free]
  inertiaRoll: 0.40,
  inertiaPitch: 1.27,
  inertiaYaw: 1.29,
  // s^-1, on the body rates. The suspension already damps pitch and roll
  // hard (the dampers work on a lever); this mops up yaw and the airborne
  // case. [free]
  angularDamping: 0.8,

  // --- steering -------------------------------------------------------------
  // `WillyFrontWheelR/L`: `setMinRotation -30`, `setMaxRotation 30` about yaw
  // from `c_PIYaw` — the physical steering lock, and the same rig
  // `applyRig` poses the wheels with, so the physics and the visual read one
  // number. Fallback only; the live value comes off the node. [data]
  maxSteer: 30,

  // s^-1 ease on `state.throttle`, which is the audio/blur output rather than
  // the drive input — a car answers its pedal at once, but the engine *note*
  // swelling over a third of a second reads right. [free, presentation only]
  throttleEase: 3,
};

/**
 * One wheel, as discovered from the glb: the `Spring` node (which *is* the
 * wheel mesh — `WillyFrontSpringR` carries `geometry Willy_WheelR_M1`), its
 * rest position in the vehicle's own frame, and what the data says about it.
 */
class Wheel {
  constructor(node, rest, physics, steered) {
    this.node = node;
    /** Rest position of the axle in the vehicle frame, glb pose. */
    this.rest = rest;
    this.strength = physics.strength ?? WILLYS.springStrength;
    this.damping = physics.damping ?? WILLYS.springDamping;
    /** `c_PGFEngineGrip` marks the driven axle; the fronts roll free. */
    this.driven = physics.grip === GRIP_DRIVEN;
    this.steered = steered;
    this.basePosition = node.position.clone();
    this.baseQuaternion = node.quaternion.clone();
    // Live per-tick results, kept readable so a harness can watch the axle.
    this.compression = 0;
    this.load = 0;
    /** Rolled angle, radians, for the visual spin. */
    this.angle = 0;
  }
}

/** A land vehicle: a `Vehicle` plus the drive model that moves it. */
export class GroundVehicle extends Vehicle {
  /**
   * @param {THREE.Object3D} node   the assembled vehicle root from the map glb
   * @param {THREE.Object3D} parent where to reparent it to (usually the scene)
   * @param {{spec?: object, modelsBase?: string, cockpit?: boolean,
   *          groundHeight?: (x: number, z: number) => number}} [options]
   */
  constructor(node, parent, options = {}) {
    super(node, parent, options);
    this.spec = options.spec || WILLYS;
    /**
     * Where the ground is, injected the same way `Aircraft.groundHeight` is:
     * this module must run under node with an analytic floor, so it never
     * imports a collider — a page passes `WorldCollider.surfaceHeight`
     * (bound), a test passes arithmetic.
     */
    this.groundHeight = options.groundHeight || (() => -Infinity);

    this.wheels = [];
    /** Engine declarations off the `Engine` node, spec values as fallback. */
    this.engine = {
      torque: this.spec.torque,
      differential: this.spec.differential,
      numberOfGears: this.spec.numberOfGears,
      gearUp: this.spec.gearUp,
      gearDown: this.spec.gearDown,
    };
    /** Current gear, 1-based; `reverse` is a mode rather than a gear slot. */
    this.gear = 1;
    /** Engine speed, rad/s, derived from the driven axle each tick. */
    this.revs = 0;
    this.collectChassis();

    // Body-frame inertia, diagonal. A box is symmetric enough for a jeep.
    this._inertia = new THREE.Vector3(
      this.spec.inertiaPitch, this.spec.inertiaYaw, this.spec.inertiaRoll);

    // Scratch, so a tick allocates nothing.
    this._q = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
    this._vBody = new THREE.Vector3();
    this._wWorld = new THREE.Vector3();
    this._rWorld = new THREE.Vector3();
    this._attach = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._lat = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._torque = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._susp = new THREE.Vector3();
    this._fTyre = new THREE.Vector3();
    this._arm = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  /**
   * Read the chassis off the node tree.
   *
   * A wheel is a `Spring` node with a `physics` extra — position, stiffness,
   * damping, grip class all come from the glb, so a Kubelwagen or a Sherman's
   * six-a-side road wheels arrive through the same walk with no per-vehicle
   * table. A wheel is *steered* if any ancestor between it and the root
   * carries a yaw rig on `c_PIYaw`, which is exactly the `RotationalBundle`
   * the front wheels hang from.
   */
  collectChassis() {
    this.node.updateWorldMatrix(true, true);
    const rootInverse = this.node.matrixWorld.clone().invert();
    const local = new THREE.Matrix4();
    this.node.traverse(obj => {
      const data = obj.userData || {};
      if (data.templateKind === 'Engine' && data.physics) {
        const p = data.physics;
        if (typeof p.torque === 'number') this.engine.torque = p.torque;
        if (typeof p.differential === 'number') this.engine.differential = p.differential;
        if (typeof p.numberOfGears === 'number') this.engine.numberOfGears = p.numberOfGears;
        if (typeof p.gearUp === 'number') this.engine.gearUp = p.gearUp;
        if (typeof p.gearDown === 'number') this.engine.gearDown = p.gearDown;
        return;
      }
      if (data.templateKind !== 'Spring' || !data.physics) return;
      local.multiplyMatrices(rootInverse, obj.matrixWorld);
      const rest = new THREE.Vector3().setFromMatrixPosition(local);
      let steered = false;
      for (let p = obj.parent; p && p !== this.node; p = p.parent) {
        const yaw = p.userData?.rig?.axes?.yaw;
        if (yaw && yaw.input === 'c_PIYaw') { steered = true; break; }
      }
      this.wheels.push(new Wheel(obj, rest, data.physics, steered));
    });
    // Nothing marked driven — a trailer, or an extract from before the
    // physics extras — drives everything rather than nothing.
    if (this.wheels.length && !this.wheels.some(w => w.driven)) {
      for (const wheel of this.wheels) wheel.driven = true;
    }
  }

  /**
   * The gearbox this tick: derive revs from road speed, shift on the declared
   * thresholds, and say how much drive is available.
   *
   * `setGearUp 0.95` / `setGearDown 0.4` are fractions of maximum revs, which
   * is the one reading that makes both numbers work as an automatic's
   * hysteresis: after an upshift the ratio step drops revs to 0.65-0.76, above
   * the downshift line, so the box never hunts. Drive per gear is
   * `setTorque` scaled by ratio — first gear gets the full 10.5 — and it
   * fades linearly over the last five percent of the rev range, so top speed
   * is an equilibrium rather than a wall.
   */
  #drivetrain(speed, reverse) {
    const k = this.spec;
    const e = this.engine;
    const gears = k.gearRatios;
    const top = Math.min(e.numberOfGears, gears.length);
    const revsIn = gear => speed * e.differential * gear / k.wheelRadius;
    if (reverse) {
      this.gear = 1;
      this.revs = revsIn(k.reverseRatio);
    } else {
      this.revs = revsIn(gears[this.gear - 1]);
      if (this.gear < top && this.revs > e.gearUp * k.revLimit) this.gear += 1;
      else if (this.gear > 1 && this.revs < e.gearDown * k.revLimit) this.gear -= 1;
      this.revs = revsIn(gears[this.gear - 1]);
    }
    const ratio = reverse ? k.reverseRatio : gears[this.gear - 1];
    const span = Math.max(1e-6, (1 - e.gearUp) * k.revLimit);
    const fade = Math.max(0, Math.min(1, (k.revLimit - this.revs) / span));
    return e.torque * (ratio / gears[0]) * fade;
  }

  /**
   * The Engine's rate rig is real on this vehicle too — `WillyEngine` carries
   * the same +-5000 roll accumulator a Corsair's does — but here the node's
   * children are the *wheel assemblies*, and no `spinsWithEngine` flag marks
   * anything, so `applyRig`'s fallback would swing all four wheels bodily
   * around the crankshaft axis. Keeping `propellerAngle` at zero keeps that
   * spin the identity; the wheels are rolled individually below, off their
   * own contact speeds, which is what the accumulator is standing in for.
   */
  advancePropeller() {}

  /**
   * One step. The public entry clamps its own rate: the page hands whatever
   * `THREE.Clock` gives it (up to 0.1 s), and a spring at `strength 25` times
   * four wheels is stiff enough to want the 60 Hz the rest of the viewer
   * integrates at, so a long frame is cut into engine-sized pieces rather
   * than integrated whole.
   */
  integrate(dt) {
    if (!(dt > 0)) return;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);
    const steps = Math.max(1, Math.ceil(dt * 60));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.#step(h);
    this.applyTransform();
    this.applyRig();
    this.#applyWheels();
  }

  #step(h) {
    const s = this.state;
    const k = this.spec;
    this.advanceSurfaces(h);

    const q = this._q.copy(s.orientation);
    const qInv = this._qInv.copy(q).invert();
    const vBody = this._vBody.copy(s.velocity).applyQuaternion(qInv);
    const w = s.angularVelocity;              // body rates, like Aircraft's
    const wWorld = this._wWorld.copy(w).applyQuaternion(q);
    /** Forward road speed, signed: positive is travelling nose-first. */
    const vf = -vBody.z;

    // --- pedals -------------------------------------------------------------
    // One axis does three jobs, exactly as in the game: accelerate, brake,
    // reverse. Opposing the current motion is braking until the vehicle has
    // all but stopped; only then does the same input become drive the other
    // way. `c_PIThrottle` runs -1..1 here where an aircraft clamps it at 0.
    const cmd = Math.max(-1, Math.min(1, this.input('c_PIThrottle')));
    let braking = 0;
    let drive = 0;
    let reverse = false;
    if (cmd > 0.01 && vf < -k.reverseBelow) {
      braking = cmd;
    } else if (cmd < -0.01 && vf > k.reverseBelow) {
      braking = -cmd;
    } else if (Math.abs(cmd) > 0.01) {
      reverse = cmd < 0;
      drive = this.#drivetrain(Math.abs(vf), reverse) * Math.abs(cmd);
    } else {
      this.#drivetrain(Math.abs(vf), vf < 0);   // keep revs honest for audio
    }

    // The audio/blur output eases; the drive itself already answered.
    const wanted = Math.min(1, Math.abs(cmd));
    const gap = wanted - s.throttle;
    const ease = k.throttleEase * h;
    s.throttle = Math.abs(gap) <= ease ? wanted : s.throttle + Math.sign(gap) * ease;

    // --- steering -------------------------------------------------------------
    // The deflection comes off the same rate-limited surface `applyRig` poses
    // the front wheels with — the rig's `setMaxSpeed 200` over +-30 degrees
    // *is* the steering servo — so the physics can never turn the axle faster
    // than the wheel visibly turns. Sign matches the aircraft convention:
    // positive `c_PIYaw` is a right turn, a negative yaw rate.
    let steerInput = 0;
    for (const [key, value] of s.surfaces) {
      if (key.includes('/c_PIYaw/') && key.endsWith('/yaw')) { steerInput = value; break; }
    }
    const steer = -steerInput * k.maxSteer * DEG;

    // --- wheels ---------------------------------------------------------------
    const force = this._force.set(0, 0, 0);      // body frame, per mass
    const torque = this._torque.set(0, 0, 0);    // body frame
    let loaded = 0;

    // Per-wheel drive and brake are found before the loop so the friction
    // circle can be applied per contact: total demand, split over the axle by
    // its live load, each wheel capped by mu times what it is carrying.
    const drivenCount = this.wheels.filter(x => x.driven).length || 1;
    // Slip authority fades in below walking pace — see `slipFloor`.
    const speed = s.velocity.length();
    const authority = Math.min(1, speed / 2);

    for (const wheel of this.wheels) {
      // Where the axle is, and how fast it is moving vertically. The spring
      // ray is world-vertical — PROVISIONAL; correct on the flats this jeep
      // lives on, increasingly wrong past 20 degrees of body lean.
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const floor = this.groundHeight(attach.x, attach.z);
      const rWorld = this._rWorld.copy(wheel.rest).applyQuaternion(q);
      const compression = Number.isFinite(floor)
        ? (floor + k.wheelRadius) - attach.y
        : -Infinity;
      if (compression <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        // An airborne driven wheel spins against nothing.
        if (wheel.driven && drive !== 0) {
          wheel.angle += (reverse ? -1 : 1) * (this.revs / this.engine.differential) * h;
        }
        continue;
      }

      // Suspension: spring on travel, damper on the attach point's vertical
      // rate, bump stop past the travel. All per mass, straight off
      // `setStrength`/`setDamping` — see the spec table for the units case.
      const travel = Math.min(compression, k.suspensionTravel);
      const overrun = compression - travel;
      const attachRate = s.velocity.y + (wWorld.z * rWorld.x - wWorld.x * rWorld.z);
      let load = wheel.strength * (travel + overrun * k.bumpStiffness)
        - wheel.damping * attachRate;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;

      // The tyre's own frame: forward steered or straight, lateral to its
      // right. Rotation about +Y, so a negative steer angle points the wheel
      // starboard — the right turn the sign convention above promises.
      const dir = this._dir.set(-Math.sin(steer), 0, -Math.cos(steer));
      if (!wheel.steered) dir.set(0, 0, -1);
      const lat = this._lat.crossVectors(dir, UP);

      // Contact-patch velocity in the body frame.
      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));
      const uLong = u.dot(dir);
      const uLat = u.dot(lat);

      // Lateral: linear in slip angle, per unit load, saturated by the
      // friction circle below. The floored denominator is the numerics note
      // in the spec table.
      const slip = Math.atan2(uLat, Math.max(Math.abs(uLong), k.slipFloor));
      let fLat = -k.corneringStiffness * slip * load * authority;

      // Longitudinal: the axle's share of drive, brake against the motion,
      // rolling resistance and engine braking against it too. Retardation is
      // weighted by this wheel's share of standing weight (`load / g`, which
      // sums to 1 at rest), so an unloading inner wheel loses its share of
      // everything at once.
      const gShare = load / -GRAVITY;
      let fLong = 0;
      if (wheel.driven && drive !== 0) {
        fLong += (reverse ? -1 : 1) * drive / drivenCount;
      }
      const moving = Math.tanh(uLong / 0.3);
      fLong -= moving * k.rollingResistance * gShare;
      if (braking > 0) fLong -= moving * k.brakeDecel * braking * gShare;
      if (drive === 0 && braking === 0 && wheel.driven) {
        fLong -= moving * k.engineBraking / drivenCount;
      }

      // The friction circle: a tyre carrying `load` has mu x load to spend,
      // shared between going and turning. Scaling the pair keeps the
      // direction of the demand, which is what makes a drive-saturated axle
      // understeer instead of doing something creative.
      const cap = k.mu * load;
      const demand = Math.hypot(fLong, fLat);
      if (demand > cap && demand > 1e-9) {
        fLong *= cap / demand;
        fLat *= cap / demand;
      }

      // Suspension pushes along world up; the tyre works in the body's
      // ground plane at the contact patch, a wheel radius below the axle.
      const suspension = this._susp.set(0, load, 0).applyQuaternion(qInv);
      force.add(suspension);
      force.addScaledVector(dir, fLong);
      force.addScaledVector(lat, fLat);
      torque.add(this._arm.crossVectors(wheel.rest, suspension));
      const fTyre = this._fTyre.set(0, 0, 0)
        .addScaledVector(dir, fLong).addScaledVector(lat, fLat);
      this._arm.set(wheel.rest.x, wheel.rest.y - k.wheelRadius, wheel.rest.z);
      torque.add(this._arm.cross(fTyre));

      // The visual roll, from the road passing under the contact patch.
      wheel.angle += (uLong / k.wheelRadius) * h;
    }

    s.grounded = loaded > 0;
    s.airspeed = speed;

    // --- integrate ------------------------------------------------------------
    // Semi-implicit Euler, like everything else in the viewer: velocity
    // first, position with the updated velocity.
    const accel = this._accel.copy(force).applyQuaternion(q);
    accel.y += GRAVITY;
    // The exe's drag equation, coefficients from `Objects.con`: see
    // `PointBody.applyDrag` for the disassembly. Wind is zero in every
    // vanilla level.
    const kDrag = Math.PI * k.boundingRadius * k.boundingRadius * k.drag / k.mass;
    accel.addScaledVector(s.velocity, -kDrag);
    s.velocity.addScaledVector(accel, h);
    s.position.addScaledVector(s.velocity, h);

    w.x += (torque.x / this._inertia.x - k.angularDamping * w.x) * h;
    w.y += (torque.y / this._inertia.y - k.angularDamping * w.y) * h;
    w.z += (torque.z / this._inertia.z - k.angularDamping * w.z) * h;
    if (w.lengthSq() > 0) {
      const spin = new THREE.Quaternion().setFromEuler(
        this._euler.set(w.x * h, w.y * h, w.z * h, 'XYZ'));
      s.orientation.multiply(spin).normalize();
    }

    // Failsafe, not suspension: if the hull's origin has somehow got below
    // the ground the springs never saw (a cliff edge under the belly, a
    // teleport), stop it there rather than letting it fall out of the world.
    const under = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }
  }

  /**
   * Write the wheels' own motion onto the scene graph: compression slides the
   * spring node up its travel (the wheel meets the ground the physics put it
   * on), contact speed rolls it about its axle. The steer is not written
   * here — the front wheels' yaw is the declared rig, and `applyRig` already
   * poses it from the same rate-limited surface the physics read.
   */
  #applyWheels() {
    const k = this.spec;
    for (const wheel of this.wheels) {
      const lift = Math.min(wheel.compression, k.suspensionTravel);
      wheel.node.position.y = wheel.basePosition.y + lift;
      // Rolling forward carries the top of the wheel toward -Z, which about
      // +X is the negative sense.
      wheel.node.quaternion.copy(wheel.baseQuaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-wheel.angle, 0, 0)));
    }
  }

  /** Park it back on its spawn, engine off, wheels straight. */
  reset() {
    if (this.autoFirstPerson) this.setFirstPerson(false);
    const s = this.state;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.throttle = 0;
    s.airspeed = 0;
    s.surfaces.clear();
    s.inputs.clear();
    this.gear = 1;
    this.revs = 0;
    for (const wheel of this.wheels) {
      wheel.angle = 0;
      wheel.compression = 0;
      wheel.load = 0;
      wheel.node.position.copy(wheel.basePosition);
      wheel.node.quaternion.copy(wheel.baseQuaternion);
    }
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
