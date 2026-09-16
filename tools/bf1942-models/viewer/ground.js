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

// --- tank and half-track differential steering ------------------------------
//
// `verify-r7.md` (TANK-1..17, all confirmed or corrected by a second reader
// against the disassembly): a `c_ETTank` Engine has no vehicle-type-specific
// code path anywhere. Differential steering is a side-effect of ordinary,
// type-agnostic wheel code — any `c_PGFEngineGrip` wheel's commanded spin is
//
//   getCurrentRatio() * engine.getCurrentDifferentialRPM(side)
//
// reading the same `roll` (throttle) / `yaw` (steer) axes any Engine exposes.
// A car's Engine simply never binds `setInputToYaw`, so every one of its
// wheels passes `side == 0` and the formula degenerates to plain uniform
// throttle — which is why `GroundVehicle` above never needed any of this.
//
// `TrackedVehicle` cannot simply `extends GroundVehicle`: that class's
// per-tick work lives in true (`#`-private) methods, and JavaScript does not
// let a subclass reach or override a private method of its parent — so this
// stands beside `GroundVehicle` as its own `Vehicle` subclass, matching its
// constructor and public interface exactly (a page can `new TrackedVehicle(
// node, parent, options)` in `GroundVehicle`'s place) while sharing the
// module's constants and the `Wheel` bookkeeping class.
//
// THE CORRECTION THIS TRACK EXISTS TO CARRY: `getCurrentRatio()` samples a
// full 101-entry array (`GEAR_RATIO_CURVE` below), not five control points on
// a spline. verify-r7.md's researcher read it as the latter and got the
// M3A1 wrong; the verifier decompiled `EngineTemplate`'s constructor directly
// and found every slot but five defaults to 1.0. `idx = trunc(gear /
// numberOfGears * 100)` with `gear` permanently 1 (seeded once, never written
// again by any code path found in either binary — TANK-7), so only
// `numberOfGears` of 1 or 5 ever land on an authored index; every other
// integer count reduces the whole curve lookup to exactly `3.5 *
// differential`. Sherman and Willy (5 gears) land on index 20 — an authored
// point — and get 4.0 and 7.0; the M3A1 (4 gears) lands on index 25, nowhere
// near one, and gets 17.5, not the ~5.5 a smooth interpolation between the
// *named* points would suggest.
//
// WHAT IS PROVISIONAL HERE, same disclaimer `GroundVehicle` carries for its
// own tyre model and worth repeating because this one goes further: the
// suspension (spring/damper per wheel, vertical rays, semi-implicit Euler)
// is `GroundVehicle`'s own reconstruction, copied rather than shared for the
// private-method reason above. What is genuinely new is how a driven wheel's
// *longitudinal* force is found — no retail disassembly reads a tracked
// vehicle's Coulomb friction model, and `verify-r7.md`'s own viewer recipe
// says as much ("exactly as speculative as Willy's own tyre model — the real
// per-wheel force law is still open", citing PHY-2/PHY-4). What is BYTE-EXACT
// and must not be diluted by that provisionality is `differentialRPM` (TANK-10)
// and `engineRatio` (TANK-3/6/7/8) themselves — every approximation below is
// built out from those two, never around them.

/** `c_PGFEngineDummyGrip`: an idler or return-roller road wheel — present for
 * the tread to ride on, not for the drivetrain. TANK-6/14 read it as
 * spin-only; the Wake Sherman and M3A1 extras confirm it byte for byte
 * rather than merely inferring it from the grip name — every dummy-grip
 * `Spring` node in both ships `setStrength 0`/`setDamping 0`, so it already
 * costs the suspension solve nothing on its own, without this file having to
 * special-case it there. */
const GRIP_DUMMY = 'c_PGFEngineDummyGrip';

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `ratio = 3.5 *
 * setDifferential / curve[idx]`. Declared again here (rather than imported)
 * because `flight.js` keeps its own copy private, the same way that file's
 * own gravity constant is "kept local... until physics.js... grows a shared
 * constants module". */
const ENGINE_RATIO_SCALE = 3.5;

/** `PhysicsEngine`'s own default when a `.con` file never calls
 * `setNoPropellerEffectAtSpeed` — TANK-5, confirmed at `EngineTemplate::
 * makeScript`'s `+0x5cc`. Sherman and M3A1 both leave it at this default
 * (TANK-4); a mod's tank that overrides it is read off the node instead, see
 * `collectChassis` below. */
const FADE_SPEED_DEFAULT = 100.0;

/**
 * The gear-ratio curve `EngineTemplate`'s constructor (`0x005715d0`) actually
 * lays down: 101 slots, all 1.0 except the five `EngineTemplate` writes by
 * hand (TANK-3/6, byte-verified immediates). `flight.js`'s own `GEAR_RATIO =
 * 0.94` is the special case of this same table at `numberOfGears = 1` (no
 * aircraft ever declares a gearbox, so its index is always exactly 100); a
 * vehicle with a real gearbox needs the whole table, because the "smooth
 * five-point spline" a curve drawn through just the named points suggests is
 * wrong for any `numberOfGears` that is not exactly 1 or 5 (the M3A1 worked
 * example in `engineRatio` below).
 */
const GEAR_RATIO_CURVE = new Array(101).fill(1.0);
GEAR_RATIO_CURVE[20] = 3.5;
GEAR_RATIO_CURVE[40] = 2.2;
GEAR_RATIO_CURVE[60] = 1.5;
GEAR_RATIO_CURVE[80] = 1.1;
GEAR_RATIO_CURVE[100] = 0.94;

/**
 * `PhysicsEngine::getCurrentRatio()`, exactly (TANK-3/6/7, corrected).
 *
 * `gear` is folded in as the literal 1 it is seeded to and never written
 * again anywhere in either binary (TANK-7) — no vehicle this corpus has read
 * ever shifts it, tank or otherwise, so it is not threaded through as a
 * parameter. The division is done in floating point and truncated exactly
 * the way the client's own `_ftol` helper does (`0x00804af0`, TANK-7's
 * correction from an earlier "round" reading), then linearly interpolated
 * against the next slot up — which only ever matters, for an integer
 * `numberOfGears`, when the division lands exactly on a multiple of 20 (no
 * interpolation needed, the fractional part is zero) or somewhere the curve
 * is flat at 1.0 on both sides anyway. Both cases the byte-exact worked
 * examples below hit.
 *
 * Worked examples verify-r7.md hand-checked against the corrected array
 * (TANK-8): Sherman (`differential 4`, `numberOfGears 5`) and Willy
 * (`differential 7`, `numberOfGears 5`) both land on index 20 — an authored
 * control point — giving 3.5*4/3.5 = **4.0** and 3.5*7/3.5 = **7.0**. The
 * M3A1 (`differential 5`, `numberOfGears 4`) lands on index 25 — not a
 * control point, not adjacent to one — giving 3.5*5/1.0 = **17.5**, not the
 * ~5.5 a spline through the five named points would give. The only gear
 * counts that ever touch the curve's authored shape at all are 1 and 5;
 * every other integer count reduces to exactly `3.5 * differential`.
 *
 * @param {number} differential `setDifferential`
 * @param {number} numberOfGears `setNumberOfGears`, default 1
 * @returns {number} the fixed drivetrain ratio — compute once, the gearbox
 *   never shifts
 */
export function engineRatio(differential, numberOfGears) {
  const gears = numberOfGears > 0 ? numberOfGears : 1;
  const t = Math.max(0, Math.min(100, (1 / gears) * 100));
  const idx = Math.min(100, Math.trunc(t));
  const frac = t - idx;
  const lo = GEAR_RATIO_CURVE[idx];
  const hi = GEAR_RATIO_CURVE[Math.min(100, idx + 1)];
  const curve = lo + (hi - lo) * frac;
  return (ENGINE_RATIO_SCALE * differential) / curve;
}

/**
 * `PhysicsEngine::getCurrentDifferentialRPM(float side) const`, byte-exact
 * (TANK-10, independently re-hand-traced flag by flag against the raw
 * disassembly — the exact class of x87 trap that has bitten this corpus 11
 * of its last 13 rounds, and it held with no sign errors found). `side` is a
 * pure sign discriminator, not a magnitude: 0 for a wheel with no lateral
 * offset (a car's, or one authored dead on the centreline), positive for the
 * wheel on the vehicle's own +X (starboard) side, negative for -X.
 *
 * At `throttle == 0` both non-zero branches are exactly zero regardless of
 * `yaw` (TANK-17: a tank cannot pivot from a dead stop on the stick alone) —
 * a direct algebraic consequence of every branch multiplying by `throttle`,
 * not a separate case here.
 *
 * @param {number} throttle `c_PIThrottle`, -1..1, signed (reverse is
 *   negative throttle, not a separate gear)
 * @param {number} yaw `c_PIYaw`, -1..1
 * @param {number} side sign of the wheel's local X in the vehicle frame
 */
export function differentialRPM(throttle, yaw, side) {
  if (side === 0) return throttle;
  const factor = side > 0 ? 1 - 1.5 * yaw : 1 + 1.5 * yaw;
  return Math.max(-1, Math.min(1, throttle * factor));
}

/**
 * The one piece of this file with no disassembly behind it at all: how much
 * forward force a side's `differentialRPM` demands.
 *
 * `Aircraft.step` in this repo already carries the confirmed shape verbatim
 * (`PhysicsEngine::updatePhysics`, `0x0057bfb0` — see its own comment for the
 * citation): `e = throttle - rho*(vel.fwd)/fadeSpeed`, `K = 0.1*|throttle| +
 * e*|e|`, `F = fwd * K * ratio`. That function is shared code — every
 * Engine-derived vehicle runs it, not only aircraft — but it was only ever
 * read for the single whole-body throttle a plane or a car presents, because
 * neither ever binds `setInputToYaw`. TANK-10 is what parametrises throttle
 * *by side*; evaluating the identical confirmed shape once per side, with
 * that side's own `differentialRPM` standing in for the whole-vehicle
 * throttle the confirmed function reads, is this file's own bridge between
 * the two confirmed formulas — not itself a byte reading. It degenerates to
 * exactly the confirmed whole-body case when `yaw == 0`, where every side's
 * `differentialRPM` is the same `throttle`. [free]
 *
 * The result is an acceleration (mass already inside, this codebase's
 * standing convention for anything descended from `setTorque`), meant to be
 * applied at that side's driven wheels and clamped by their own friction
 * circle — not, as `Aircraft.step` applies its twin, as an unconstrained
 * body force. A tank's tractive effort is bounded by what its tracks can
 * grip, the same as a Willys' rear axle; an aircraft's thrust is not bounded
 * by anything the wheels touch.
 *
 * At `throttle == 0` while still moving, `e` is `-v/fadeSpeed` (nonzero), so
 * this returns a small deceleration for free — no separate "engine braking"
 * constant needed, unlike `GroundVehicle`'s.
 *
 * @returns {number} m/s^2, mass already inside
 */
export function driveAccel(throttle, yaw, side, forwardSpeed, ratio,
    fadeSpeed = FADE_SPEED_DEFAULT) {
  const d = differentialRPM(throttle, yaw, side);
  const e = d - forwardSpeed / fadeSpeed;
  return (0.1 * Math.abs(d) + e * Math.abs(e)) * ratio;
}

/**
 * A wheel's rolling radius, measured off its own mesh — generalising the
 * hand measurement TANK-14/15 took off the Sherman and M3A1 collision
 * meshes (Y/Z extent averaged: `(0.258+0.256)/2 ~= 0.257`, `(0.174+0.166)/2
 * ~= 0.17`, both confirmed against this exact function's arithmetic on the
 * live Wake scene) so a tank from any mod answers for its own wheel size
 * rather than needing a per-vehicle number — the same thing `WillyRadius`
 * already established no `.con` file ever declares.
 *
 * @returns {number|null} metres, or null if the node (and nothing under it)
 *   carries geometry to measure
 */
function measureWheelRadius(node) {
  let target = node.geometry ? node : null;
  if (!target) {
    node.traverse(child => { if (!target && child.geometry) target = child; });
  }
  if (!target) return null;
  const geometry = target.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;
  return ((box.max.y - box.min.y) + (box.max.z - box.min.z)) / 4;
}

/**
 * Sherman numbers [data, `Objects.con`/`Physics.con`, TANK-4 byte-confirmed]
 * — used only when the node tree gives `collectChassis` nothing to read (an
 * extract from before `extras.physics` carried these, or a test double), and
 * for the geometry-derived fields, only when a wheel walk finds no wheels at
 * all to measure a footprint from.
 */
export const TANK = {
  mass: 25000,
  drag: 2,
  differential: 4,
  numberOfGears: 5,

  // Half-extents of the wheel footprint, and the one dimension no wheel walk
  // can ever supply (hull height) — fallbacks only; `collectChassis` measures
  // the first two off the actual wheel layout whenever there is one. [free]
  halfWidth: 1.0,
  halfLength: 2.5,
  hullHalfHeight: 1.1,
  boundingRadius: 3.0,
  wheelRadius: 0.33,

  // Suspension: `GroundVehicle`'s own shape: no tank-specific reading of the
  // spring solver exists any more than a car's does. The travel needs to be
  // generous precisely *because* the dummy wheels are legitimately worth
  // nothing (TANK-14): a Sherman's whole 25-tonne hull rests on only 4 real
  // springs (2 per side, `strength 18`), so standing still alone already
  // asks for ~0.20 m of compression (14.73 / (4*18)) — this is sized with
  // headroom above that static point, not tuned to a drive test. [free]
  suspensionTravel: 0.35,
  bumpStiffness: 5,

  // Tracks resist sliding sideways far harder than a tyre; stiffened well
  // past Willy's own 7 on that basis, not a measurement. mu close to Willy's
  // for lack of any tank-specific reading. [free]
  mu: 1.1,
  corneringStiffness: 30,
  // The half-track's own front axle only: an ordinary tyre, not a track —
  // Willy's own value (`WILLYS.corneringStiffness`), transcribed rather than
  // imported so this file's two vehicle specs stay independently readable.
  frontAxleCorneringStiffness: 7,
  slipFloor: 1.0,
  // The half-track's free-rolling front axle only (TANK-15) — never an
  // engine-connected wheel, so no separate "engine braking" belongs with it.
  rollingResistance: 0.5,
  // A driven wheel's own resistance, N per (m/s) per unit load — see
  // `#step`'s own comment on why this, not the confirmed thrust law's
  // governor term, is what actually closes the top-speed equation at a
  // tank-appropriate speed. Fitted so the two vanilla tanks land in a
  // plausible band (Sherman ~9 m/s / 33 km/h, M3A1 ~31 m/s / 112 km/h) while
  // still showing the corrected ratio's real effect — M3A1 markedly
  // livelier than Sherman, matching both vehicles' real top speeds being in
  // that order. Not a measurement; there is no recorded reference drive for
  // either tank the way `ground-vehicles.md`'s own open gaps ask for one.
  // [free]
  trackResistance: 0.8,

  // s^-1, on the body rates. Willy needs only 0.8 for the same job (mopping
  // up yaw and the airborne case); a tank's wheels sit much farther from the
  // root than a jeep's (the M3A1's own front axle 3 m ahead of it), so the
  // same yaw rate puts a far larger torque through the identical suspension
  // formula. Found by driving one through a sustained turn and watching it
  // roll itself onto its roof — twice: held from a stand-still it tipped
  // somewhere between yaw input 0.2 and 0.3 (fixed at 5.0), and a second,
  // harder case survived that fix and still rolled the M3A1 at yaw 0.6
  // entered from its own straight-line top speed (~31 m/s) rather than
  // accelerating into the turn — the extra speed alone very nearly doubles
  // the centripetal load a held turn puts through the suspension. 12.0 was
  // the lowest value that survived both; this carries margin above it.
  // corneringStiffness made no difference to either case at any value
  // tried. [free]
  angularDamping: 15.0,

  // A steered front axle's lock, used only if its own bundle somehow
  // declares no min/max at all to measure. M3A1's own is +-40 (TANK-15),
  // read off the node before this ever applies.
  maxSteer: 40,
};

/** A tank or half-track: `c_PGFEngineGrip` wheels driven in a differential
 * pair per verify-r7.md, instead of Willy's steered wheel pair. Same
 * constructor and public interface as `GroundVehicle` (see the file header
 * for why it cannot simply extend it). */
export class TrackedVehicle extends Vehicle {
  /**
   * @param {THREE.Object3D} node   the assembled vehicle root from the map glb
   * @param {THREE.Object3D} parent where to reparent it to (usually the scene)
   * @param {{spec?: object, modelsBase?: string, cockpit?: boolean,
   *          groundHeight?: (x: number, z: number) => number}} [options]
   */
  constructor(node, parent, options = {}) {
    super(node, parent, options);
    this.spec = options.spec || TANK;
    this.groundHeight = options.groundHeight || (() => -Infinity);

    // `this.control` never changes after construction, so the two
    // `s.surfaces` keys `#step` reads every sub-step are built once here
    // rather than templated fresh each call — a per-tick string allocation
    // `features/mesh-viewer-performance/README.md` rule 5 exists to rule out,
    // the same reasoning behind every scratch vector below.
    this._throttleKey = `${this.control}/c_PIThrottle/roll`;
    this._yawKey = `${this.control}/c_PIYaw/yaw`;

    // Root PCO physics (`Sherman`/`M3A1`'s own `setMass`/`setObjectDrag`) —
    // unlike `GroundVehicle`, read off the node rather than a single fitted
    // table, because this class has to answer for a 25-tonne Sherman and a
    // 15-tonne M3A1 at once, not one Willys.
    const rootPhysics = node.userData?.physics || {};
    this.mass = typeof rootPhysics.mass === 'number' ? rootPhysics.mass : this.spec.mass;
    this.drag = typeof rootPhysics.drag === 'number' ? rootPhysics.drag : this.spec.drag;

    this.wheels = [];
    /** Engine declarations off the `Engine` node; `torque` is kept for
     * report/API parity with `GroundVehicle` and for anything downstream
     * that wants it (engine audio, say) but this class never spends it —
     * TANK-9 reads it as feeding only engine *sound*, a separate 101-slot
     * curve this file has no reason to carry. There is deliberately no
     * `gearUp`/`gearDown` here: a tank's `gear` never leaves 1 (TANK-7), so
     * there is nothing to shift toward. */
    this.engine = {
      differential: this.spec.differential,
      numberOfGears: this.spec.numberOfGears,
      torque: null,
      fadeSpeed: FADE_SPEED_DEFAULT,
    };
    this._extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    this.collectChassis();

    // getCurrentRatio(), TANK-3/6/7/8: fixed for the vehicle's life, exactly
    // mirroring the retail engine never writing `gear` past its seed of 1.
    this.ratio = engineRatio(this.engine.differential, this.engine.numberOfGears);

    /** Driven wheels sharing each side, so the per-side drive force below
     * splits evenly the same way `GroundVehicle` already splits its own. */
    this.drivenBySide = { '-1': 0, '0': 0, '1': 0 };
    for (const wheel of this.wheels) {
      if (wheel.driven) this.drivenBySide[wheel.side] += 1;
    }

    // A box estimate for aero drag and roll/pitch/yaw inertia, same
    // reconstruction `WILLYS` uses a guessed box for — except the footprint
    // is measured off the actual wheel layout rather than guessed, since
    // `collectChassis` already has it. Only the hull height is still a
    // free-standing guess; no wheel tells us how tall the vehicle is.
    const spanX = this._extent.maxX - this._extent.minX;
    const spanZ = this._extent.maxZ - this._extent.minZ;
    const halfWidth = Number.isFinite(spanX) && spanX > 0 ? spanX / 2 : this.spec.halfWidth;
    const halfLength = Number.isFinite(spanZ) && spanZ > 0 ? spanZ / 2 : this.spec.halfLength;
    const halfHeight = this.spec.hullHalfHeight;
    this._boundingRadius = Math.hypot(halfWidth, halfLength) || this.spec.boundingRadius;
    const w2 = (2 * halfWidth) ** 2, l2 = (2 * halfLength) ** 2, h2 = (2 * halfHeight) ** 2;
    // x=pitch (about the right axis), y=yaw (about up), z=roll (about
    // forward) — the same axis/field mapping `GroundVehicle._inertia` uses,
    // read against `w.x/y/z`'s own meaning in `#step` below.
    this._inertia = new THREE.Vector3((l2 + h2) / 12, (w2 + l2) / 12, (w2 + h2) / 12);

    // Scratch, so a tick allocates nothing — the same set `GroundVehicle`
    // keeps, for the same reason.
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
    this._spin = new THREE.Quaternion();
    this._wheelEuler = new THREE.Euler();
    this._wheelSpin = new THREE.Quaternion();
  }

  /**
   * The chassis, read off the node tree — same philosophy as
   * `GroundVehicle.collectChassis`, extended for the grip classes a tracked
   * vehicle's wheels use that a Willys never needs (TANK-6/14/15):
   *
   *   c_PGFEngineGrip       driven — `differentialRPM` reaches it.
   *   c_PGFEngineDummyGrip  idler/return-roller road wheels. The shipped
   *                         data gives every one on both the Sherman and the
   *                         M3A1 `setStrength 0`/`setDamping 0` (checked
   *                         against the live Wake scene, not assumed from
   *                         the grip name alone), so the existing spring
   *                         formula already prices them at zero without this
   *                         file special-casing them for it.
   *   c_PGFRollGrip         a half-track's ordinary steered front axle
   *                         (M3A1Wheel1): found the identical way Willy's
   *                         front wheels are, an ancestor `RotationalBundle`
   *                         bound to `c_PIYaw` — reused verbatim, recipe
   *                         step 11 — and its own declared lock angle is
   *                         kept per-wheel (`steerMax`) rather than a shared
   *                         constant, since a half-track's is not Willy's.
   *
   * `side = sign(localX)`, +X = right (TANK-10/12), is computed once here
   * rather than every tick; a wheel dead on the centreline (`side === 0`,
   * never seen in vanilla data but not asserted against) falls back to
   * `differentialRPM`'s own `side === 0` branch, plain throttle.
   */
  collectChassis() {
    this.node.updateWorldMatrix(true, true);
    const rootInverse = this.node.matrixWorld.clone().invert();
    const local = new THREE.Matrix4();
    this.node.traverse(obj => {
      const data = obj.userData || {};
      if (data.templateKind === 'Engine' && data.physics) {
        const p = data.physics;
        if (typeof p.differential === 'number') this.engine.differential = p.differential;
        if (typeof p.numberOfGears === 'number') this.engine.numberOfGears = p.numberOfGears;
        if (typeof p.torque === 'number') this.engine.torque = p.torque;
        if (typeof p.noPropellerEffectAtSpeed === 'number') {
          this.engine.fadeSpeed = p.noPropellerEffectAtSpeed;
        }
        return;
      }
      if (data.templateKind !== 'Spring' || !data.physics) return;
      local.multiplyMatrices(rootInverse, obj.matrixWorld);
      const rest = new THREE.Vector3().setFromMatrixPosition(local);
      let steered = false;
      let steerMax = this.spec.maxSteer;
      for (let p = obj.parent; p && p !== this.node; p = p.parent) {
        // A `RotationalBundle` ancestor only — unlike `GroundVehicle`'s own
        // walk (safe there only because a car's Engine never binds yaw at
        // all), a `c_ETTank` Engine now *does* have a yaw axis of its own
        // (the +-1 degree body lean), and it sits between every wheel and
        // the root, so checking every ancestor regardless of kind would mark
        // every wheel on the vehicle "steered" off that unrelated axis.
        if (p.userData?.templateKind !== 'RotationalBundle') continue;
        const yaw = p.userData?.rig?.axes?.yaw;
        if (yaw && yaw.input === 'c_PIYaw') {
          steered = true;
          const span = Math.max(Math.abs(yaw.min ?? 0), Math.abs(yaw.max ?? 0));
          if (span > 0) steerMax = span;
          break;
        }
      }
      const wheel = new Wheel(obj, rest, data.physics, steered);
      wheel.side = Math.sign(rest.x);
      wheel.dummy = data.physics.grip === GRIP_DUMMY;
      wheel.steerMax = steerMax;
      wheel.radius = measureWheelRadius(obj) ?? this.spec.wheelRadius;
      this.wheels.push(wheel);
      this._extent.minX = Math.min(this._extent.minX, rest.x);
      this._extent.maxX = Math.max(this._extent.maxX, rest.x);
      this._extent.minZ = Math.min(this._extent.minZ, rest.z);
      this._extent.maxZ = Math.max(this._extent.maxZ, rest.z);
    });
  }

  /**
   * No `RotationalBundle` spin belongs on a tank hull's Engine node either —
   * see `GroundVehicle.advancePropeller` for the full reasoning, which
   * applies unchanged. It would be a no-op even without this override: a
   * `c_ETTank` Engine's own roll/yaw axes are `driver: "position"` (the
   * +-1 degree body-lean `bf42/assemble.py`'s `engine_spin_axes` explicitly
   * carves out, "neither rate nor free"), never the wide accumulator range
   * that predicate exists to spin. Kept explicit for the same reason
   * `GroundVehicle` keeps its own: so nobody has to re-derive that from the
   * base class to be sure.
   */
  advancePropeller() {}

  /** One step. Same public contract as `GroundVehicle.integrate`: clamps its
   * own rate into engine-sized sub-steps regardless of what `THREE.Clock`
   * hands it. */
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
    const w = s.angularVelocity;
    const wWorld = this._wWorld.copy(w).applyQuaternion(q);
    const vf = -vBody.z;

    // --- engine state -----------------------------------------------------
    //
    // A `c_ETTank` Engine's roll/yaw axes are ordinary position axes here
    // (+-1 degree of body lean — TANK-4's `Physics.con` read, `bf42/con.py`'s
    // own note) rather than the wide accumulator range a car's throttle axis
    // gets, so `advanceSurfaces` above has *already* put both through the
    // same declared-`setMaxSpeed` servo every other rig part answers to, and
    // `s.surfaces` already holds them, normalised back to -1..1 — unlike
    // `GroundVehicle`, which reads `c_PIThrottle` raw because a car's own
    // throttle axis is exactly this wide-accumulator kind and never lands in
    // `s.surfaces` at all. Reading these from there is this file's reading
    // of the recipe's "axisToward('roll')/('yaw')": verify-r7.md pins the
    // FORMULA these feed (TANK-10) but not the rate a keypress becomes the
    // `PhysicsEngine`-internal value it reads — this is the one rate the
    // vehicle's own data happens to declare for these exact axes, a
    // reasonable stand-in, but open.
    //
    // OPEN QUESTION, worth naming precisely: a half-track's front-axle
    // steering bundle (`M3A1Wheel1`) binds the identical (control, c_PIYaw,
    // yaw) key the Engine's own body-lean axis does, and
    // `Vehicle.servoAxes()` dedupes strictly by that triple — correct for a
    // mirrored aileron pair, its designed case, but a collision here between
    // two unrelated mechanisms. Whichever axis's declared `setMaxSpeed`
    // happens to win the race governs the *rate* `s.surfaces` converges at
    // (Engine 4 deg/s over a 1 degree span, `M3A1Wheel1` 2 deg/s over 40 —
    // both fast enough to settle inside half a second), never which value it
    // converges *to* (`this.input('c_PIYaw')`, read once, shared). Fixing it
    // for real means `Vehicle`'s shared key scheme in `flight.js`, outside
    // this file's ownership this round.
    const throttle = s.surfaces.get(this._throttleKey) ?? 0;
    const yaw = s.surfaces.get(this._yawKey) ?? 0;
    s.throttle = Math.min(1, Math.abs(throttle));

    const fadeSpeed = this.engine.fadeSpeed;
    const accelPos = driveAccel(throttle, yaw, 1, vf, this.ratio, fadeSpeed);
    const accelNeg = driveAccel(throttle, yaw, -1, vf, this.ratio, fadeSpeed);
    const accelZero = driveAccel(throttle, yaw, 0, vf, this.ratio, fadeSpeed);

    // --- wheels -------------------------------------------------------------
    const force = this._force.set(0, 0, 0);
    const torque = this._torque.set(0, 0, 0);
    let loaded = 0;
    const speed = s.velocity.length();
    const authority = Math.min(1, speed / 2);

    for (const wheel of this.wheels) {
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const floor = this.groundHeight(attach.x, attach.z);
      const rWorld = this._rWorld.copy(wheel.rest).applyQuaternion(q);
      const compression = Number.isFinite(floor)
        ? (floor + wheel.radius) - attach.y
        : -Infinity;
      if (compression <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        // Airborne and driven: the track keeps moving at its commanded rate
        // against nothing, same convention `GroundVehicle` uses.
        if (wheel.driven) {
          wheel.angle += this.ratio * differentialRPM(throttle, yaw, wheel.side) * h;
        }
        continue;
      }

      // Suspension: `GroundVehicle`'s own spring/damper/bump-stop shape,
      // unchanged — see its comment for the PROVISIONAL vertical-ray
      // disclaimer, which applies here exactly as it does there.
      const travel = Math.min(compression, k.suspensionTravel);
      const overrun = compression - travel;
      const attachRate = s.velocity.y + (wWorld.z * rWorld.x - wWorld.x * rWorld.z);
      let load = wheel.strength * (travel + overrun * k.bumpStiffness)
        - wheel.damping * attachRate;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;

      // No steer angle for a track wheel — `dir` stays nose-forward, exactly
      // `GroundVehicle`'s own `!wheel.steered` branch. The one wheel this
      // matters for is a half-track's own front axle (recipe step 11,
      // "Willy's existing steerable-front-wheel code unchanged"), using its
      // own bundle's declared lock (`wheel.steerMax`) rather than a shared
      // vehicle-wide constant, since a half-track's is not a jeep's.
      const dir = this._dir.set(0, 0, -1);
      if (wheel.steered) {
        const steer = -yaw * wheel.steerMax * DEG;
        dir.set(-Math.sin(steer), 0, -Math.cos(steer));
      }
      const lat = this._lat.crossVectors(dir, UP);

      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));
      const uLong = u.dot(dir);
      const uLat = u.dot(lat);

      // Lateral: same shape as `GroundVehicle`'s cornering-stiffness model
      // for every wheel that touches the ground, dummy rollers included —
      // their own near-zero load already prices them out on its own. A
      // track's much stronger resistance to sliding sideways than a tyre's
      // is `k.corneringStiffness` alone for a track wheel; the half-track's
      // own front axle is an ordinary tyre (TANK-15: "an ordinary steerable
      // front axle"), recipe step 11's "Willy's existing... code unchanged"
      // — reusing the *track* figure there as well nearly rolled the M3A1
      // in a held turn (found by driving one out ten seconds at speed and
      // watching it go onto its roof), because that wheel, unlike a track
      // wheel, is actively deflected by the steer angle and so puts real
      // slip into a coefficient four times Willy's own.
      const slip = Math.atan2(uLat, Math.max(Math.abs(uLong), k.slipFloor));
      const stiffness = wheel.steered ? k.frontAxleCorneringStiffness : k.corneringStiffness;
      let fLat = -stiffness * slip * load * authority;

      // Longitudinal: the one place a tracked vehicle's wheels genuinely
      // differ from a jeep's.
      let fLong = 0;
      if (wheel.steered) {
        // The half-track's front axle only: a free-rolling tyre, never
        // engine-connected (TANK-15), so nothing here but passive rolling
        // resistance — Willy's own shape, no braking or reverse state
        // machine, because this wheel never drives.
        const gShare = load / -GRAVITY;
        const moving = Math.tanh(uLong / 0.3);
        fLong -= moving * k.rollingResistance * gShare;
      } else if (wheel.driven) {
        // TANK-10's own per-side split, `driveAccel`'s confirmed-formula
        // extension (see its own comment): every driven wheel on a side
        // shares that side's demanded force evenly, then the friction
        // circle below still has the final word — a demand the tracks
        // cannot grip is clamped exactly the way an overpowered rear axle
        // already is on a jeep.
        const count = this.drivenBySide[wheel.side] || 1;
        const accel = wheel.side > 0 ? accelPos : wheel.side < 0 ? accelNeg : accelZero;
        fLong = accel / count;
        // Rolling resistance, always on once moving — `GroundVehicle`'s own
        // shape, and load-bearing here in a way it is not there. The
        // confirmed force law's own governor term (`driveAccel`'s `e`) only
        // meaningfully opposes `throttle` once speed is a sizeable fraction
        // of `fadeSpeed` (100 m/s, TANK-5's confirmed default): read alone
        // it would let a tank accelerate toward aircraft-scale speeds before
        // ever feeling it. Nothing in verify-r7.md gives a ground vehicle's
        // top speed the way a car's `revLimit` does for `GroundVehicle`, so
        // this term — not the confirmed formula — is what actually closes
        // the equation at a tank-scale speed; the corrected `ratio` still
        // drives the *comparison* between vehicles (a higher ratio settles
        // faster and higher against the same resistance), which is the
        // property this whole track exists to get right. [free]
        const gShare = load / -GRAVITY;
        fLong -= uLong * k.trackResistance * gShare;
      }
      // A dummy (spin-only) wheel gets no longitudinal force at all —
      // TANK-14's reading, and its own zero strength/damping already leaves
      // it nothing to spend one on regardless.

      const cap = k.mu * load;
      const demand = Math.hypot(fLong, fLat);
      if (demand > cap && demand > 1e-9) {
        fLong *= cap / demand;
        fLat *= cap / demand;
      }

      const suspension = this._susp.set(0, load, 0).applyQuaternion(qInv);
      force.add(suspension);
      force.addScaledVector(dir, fLong);
      force.addScaledVector(lat, fLat);
      torque.add(this._arm.crossVectors(wheel.rest, suspension));
      const fTyre = this._fTyre.set(0, 0, 0)
        .addScaledVector(dir, fLong).addScaledVector(lat, fLat);
      this._arm.set(wheel.rest.x, wheel.rest.y - wheel.radius, wheel.rest.z);
      torque.add(this._arm.cross(fTyre));

      // Visual roll: a driven wheel spins at its own side's commanded rate
      // (TANK-10 again — the two tracks visibly move at different speeds
      // mid-turn, which is the entire point of this steering law), so it can
      // read slightly ahead of or behind the hull's own integrated motion
      // exactly where the two mechanisms disagree — see `driveAccel`'s own
      // comment. Everything else, dummy rollers included, rolls off its own
      // actual contact speed the way `GroundVehicle`'s wheels all do, which
      // costs nothing extra since `uLong` above is geometry, not load.
      wheel.angle += (wheel.driven
        ? this.ratio * differentialRPM(throttle, yaw, wheel.side)
        : uLong / wheel.radius) * h;
    }

    s.grounded = loaded > 0;
    s.airspeed = speed;

    // --- integrate ------------------------------------------------------------
    // Semi-implicit Euler, `GroundVehicle`'s own shape, unchanged.
    const accel = this._accel.copy(force).applyQuaternion(q);
    accel.y += GRAVITY;
    const kDrag = Math.PI * this._boundingRadius * this._boundingRadius * this.drag / this.mass;
    accel.addScaledVector(s.velocity, -kDrag);
    s.velocity.addScaledVector(accel, h);
    s.position.addScaledVector(s.velocity, h);

    w.x += (torque.x / this._inertia.x - k.angularDamping * w.x) * h;
    w.y += (torque.y / this._inertia.y - k.angularDamping * w.y) * h;
    w.z += (torque.z / this._inertia.z - k.angularDamping * w.z) * h;
    if (w.lengthSq() > 0) {
      this._spin.setFromEuler(this._euler.set(w.x * h, w.y * h, w.z * h, 'XYZ'));
      s.orientation.multiply(this._spin).normalize();
    }

    // Failsafe, not suspension — see `GroundVehicle`'s own comment.
    const under = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }
  }

  /** Suspension lift + roll onto the scene graph — `GroundVehicle`'s own
   * convention, unchanged; see its comment. The steer is not written here
   * either, for the same reason: a half-track's front-axle yaw is the
   * declared rig, and `applyRig` already poses it (subject to the shared-key
   * caveat noted in `#step`). */
  #applyWheels() {
    for (const wheel of this.wheels) {
      const lift = Math.min(wheel.compression, this.spec.suspensionTravel);
      wheel.node.position.y = wheel.basePosition.y + lift;
      this._wheelSpin.setFromEuler(this._wheelEuler.set(-wheel.angle, 0, 0));
      wheel.node.quaternion.copy(wheel.baseQuaternion).multiply(this._wheelSpin);
    }
  }

  /** Park it back on its spawn, engine off, wheels straight — same contract
   * as `GroundVehicle.reset`. No `gear` to reset: this class never has one. */
  reset() {
    if (this.autoFirstPerson) this.setFirstPerson(false);
    const s = this.state;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.throttle = 0;
    s.airspeed = 0;
    s.surfaces.clear();
    s.inputs.clear();
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
