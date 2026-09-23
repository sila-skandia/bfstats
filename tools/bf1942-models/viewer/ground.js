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
import { WILLYS, TANK } from './ground-specs.js';
import {
  DECK_STEP_UP, DECK_WALL_STEP, DECK_FLOOR_COS, ENGINE_TICK_HZ,
  DEFAULT_MATERIAL_FRICTION, WHEEL_MATERIAL_FRICTION, coulombCaps, coulombClamp,
  SPRING_AXIS_Y, SPRING_GRAVITY_SCALE, SPRING_AXIS_FLOOR, staticHold,
  hullContactFriction, Wheel, probeAlongAxis, MAX_OVERRUN, surfaceNormalAt,
  intoContactPlane,
} from './ground-contact.js';
import { clamp, EngineState } from './ground-engine.js';

export { WILLYS, TANK, DEFAULT_MATERIAL_FRICTION };
export {
  ENGINE_TYPES, ENGINE_BIT_THRUST, ENGINE_BIT_LOAD_CLAMP, ENGINE_BIT_DIFFERENTIAL,
  engineTypeBits, engineRatio, gearLadder, engineTorqueFraction, differentialRPM,
  currentDifferentialRPM, engineGripTarget, ENGINE_REV_CEILING, ENGINE_REV_FLOOR,
  EngineState,
} from './ground-engine.js';

// Same body frame the flight model measured off the extracted scenes: -Z
// forward, +Y up, +X starboard. The Willy agrees — its front wheels sit at
// z = -0.75 in the glb and its rear springs at z = +1.46.
const UP = new THREE.Vector3(0, 1, 0);

const DEG = Math.PI / 180;

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
    /**
     * `MaterialManager.materialFriction` of the ground under a world (x, z),
     * injected exactly the way `groundHeight` is so this module still runs
     * under node with no collider and no textures. The page builds it from
     * the level's own `terrain/materials.png` and `_shared/damage.json`; a
     * test passes a constant or a stripe. PHY-2.
     */
    this.surfaceFriction = options.surfaceFriction || (() => DEFAULT_MATERIAL_FRICTION);
    /**
     * `(x, z, fromY, out) => boolean`: the contact normal of a drivable deck
     * where a wheel is on one, injected the same way the two above are. Optional
     * — with no hook (or off a deck) the contact normal is the heightfield's own
     * gradient, which is what it has always been. See `surfaceNormalAt`.
     */
    this.deckNormal = options.deckNormal || null;

    this.wheels = [];
    /** `Engine::handleUpdate`'s whole state — the rev filter, the gearbox and
     * the load feedback — shared with `TrackedVehicle`. Built from the spec
     * here and replaced from the `Engine` node in `collectChassis`. */
    this.engine = new EngineState({
      torque: this.spec.torque,
      differential: this.spec.differential,
      numberOfGears: this.spec.numberOfGears,
      gearUp: this.spec.gearUp,
      gearDown: this.spec.gearDown,
      engineType: 'c_ETCar',
    });
    this.collectChassis();

    // Hull collision against static objects (buildings, walls, other vehicles).
    // `k.boundingRadius` is the same value the drag equation uses — large enough
    // to keep the body off a wall without catching on every kerb. The owner id
    // is the collision index's slot for this vehicle's own hull, which must be
    // skipped in the sweep or the vehicle collides with itself.
    this._hullRadius = this.spec.boundingRadius;
    this._collisionOwner = this.collider?.statics?.ownerOf(node) ?? -1;

    /**
     * This tick's hull contacts against the static world, or against another
     * vehicle: `[{normal, normalY, friction, resistance, count, x, y, z}]`,
     * filled by `vehicle-bodies.js` `DrivenBody.noteContact` once the rigid-body
     * solver has resolved them and emptied at the top of every body tick.
     *
     * Declaring it is the opt-in: a drive model with no tyre mean to dilute
     * (`flight.js`) never gets one. `hullContactFriction` is what reads it.
     */
    this.hullContacts = [];

    /**
     * True while the rigid-body contact solver owns this hull's collisions
     * with the static world (`body-statics.js`, through `BodyWorld`), which is
     * whenever the page has a `collision-meshes.json` for the mod and has
     * adopted this vehicle as a `DrivenBody`.
     *
     * The sweep at the end of `#step` is then off: it is a *second*,
     * incompatible answer to the same question — a whole-vehicle bounding
     * sphere stopped dead at a wall, with the correction applied at the centre
     * of mass so nothing ever spins — and running both would double every
     * push-out. It stays as the fallback for a level or a mod the solver
     * cannot serve.
     */
    this.hullSolved = false;

    // Body-frame inertia, diagonal. A box is symmetric enough for a jeep.
    this._inertia = new THREE.Vector3(
      this.spec.inertiaPitch, this.spec.inertiaYaw, this.spec.inertiaRoll);

    // Scratch, so a tick allocates nothing.
    this._q = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
    this._vBody = new THREE.Vector3();
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
    this._axis = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._gTick = new THREE.Vector3();
    this._uG = new THREE.Vector3();
    this._tanForce = new THREE.Vector3();
    this._tanTorque = new THREE.Vector3();
    this._nBody = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  /**
   * Read the chassis off the node tree.
   *
   * A wheel is a `Spring` node with a `physics` extra — position, stiffness,
   * damping, grip class all come from the glb, so a Kubelwagen or a Sherman's
   * six-a-side road wheels arrive through the same walk with no per-vehicle
   * table. A wheel is *steered* if a `RotationalBundle` ancestor between it
   * and the root carries a yaw rig on `c_PIYaw`, which is exactly the bundle
   * the front wheels hang from — and only such an ancestor, because a car's
   * Engine may bind `c_PIYaw` for its own body lean (see the walk below).
   */
  collectChassis() {
    this.node.updateWorldMatrix(true, true);
    const rootInverse = this.node.matrixWorld.clone().invert();
    const local = new THREE.Matrix4();
    this.node.traverse(obj => {
      const data = obj.userData || {};
      if (data.templateKind === 'Engine' && data.physics) {
        // `engineType` comes off the node now (item 3): the 1.2 rev ceiling
        // is type-independent but `getCurrentDifferentialRPM`'s +-1 clamp is
        // not, and 101 of the 1,309 ground-vehicle Engines across the 18
        // installs are a `c_ETTank` with at least one `c_PGFRollGrip` wheel.
        // Vanilla's three (Hanomag, Ho-Ha, M3A1) are half-tracks and reach
        // `TrackedVehicle` through `seats.js`; a mod's need not.
        this.engine = new EngineState({
          torque: this.spec.torque,
          differential: this.spec.differential,
          numberOfGears: this.spec.numberOfGears,
          gearUp: this.spec.gearUp,
          gearDown: this.spec.gearDown,
          ...data.physics,
        }, data.rig?.automaticReset);
        return;
      }
      if (data.templateKind !== 'Spring' || !data.physics) return;
      local.multiplyMatrices(rootInverse, obj.matrixWorld);
      const rest = new THREE.Vector3().setFromMatrixPosition(local);
      let steered = false;
      let steerMax = this.spec.maxSteer;
      for (let p = obj.parent; p && p !== this.node; p = p.parent) {
        // A `RotationalBundle` ancestor only, the same guard `TrackedVehicle`
        // carries. A car's Engine was assumed never to bind yaw; vanilla's
        // `KubelwagenEngine` does — `setInputToYaw c_PIYaw` over
        // `setMinRotation -1/0/-1` .. `setMaxRotation 1/0/1`, the same +-1
        // degree body lean a `c_ETTank` Engine declares, and it sits between
        // every spring and the root. Walking ancestors regardless of kind
        // therefore marked the rear `c_PGFEngineGrip` springs steered too, so
        // all four tyres pointed the same way: the Kubelwagen crabbed off on
        // a fixed heading with no yaw moment at any lock. The Schwimmwagen
        // declares the same engine rig and was broken the same way; Willy,
        // whose engine binds roll only, was not.
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
      wheel.steerMax = steerMax;
      this.wheels.push(wheel);
    });
    // Nothing marked driven — a trailer, or an extract from before the
    // physics extras — drives everything rather than nothing.
    if (this.wheels.length && !this.wheels.some(w => w.driven)) {
      for (const wheel of this.wheels) wheel.driven = true;
    }
  }

  /** `getCurrentRatio()` at the live gear (TANK-3). */
  get ratio() { return this.engine.ratio; }
  /** The whole ladder — Willy 7.000/11.136/16.333/22.273/26.064. */
  get ladder() { return this.engine.ladder; }
  /** 1-based, and now the ENGINE's own gear rather than a road-speed
   * inversion's. */
  get gear() { return this.engine.gear; }
  /** The filtered rev state, [-1.0, +1.2] (TANK-12). It is no longer
   * `speed / ratio`: that inversion reached the same ceiling but had no
   * spool-up, no behaviour after a shift, and no way to express the load
   * feedback that actually governs a Refractor drivetrain. */
  get revs() { return this.engine.revs; }

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
    /** Forward road speed, signed: positive is travelling nose-first. */
    const vf = -vBody.z;

    // --- the engine ---------------------------------------------------------
    // One axis still does three jobs, but no state machine here decides which:
    // the engine's own rev filter and brake byte do (TANK-12). A pedal that
    // opposes the rev direction sets `PhysicsEngine+0xb4`, which discards the
    // wheels' whole EngineGrip target so they ask for their contact velocity
    // back; when the revs cross zero the byte clears by itself and the same
    // pedal is now driving the other way. There is no `reverseBelow`, no
    // `brakeDecel` and no reverse gear — reverse is the rev clamp's own lower
    // arm, -1.0 against the ceiling's +1.2, which is why it is slower.
    const cmd = clamp(this.input('c_PIThrottle'), -1, 1);
    const engine = this.engine;
    engine.advance(h, cmd, 0);
    const drive = engine.braking ? 0 : Math.abs(cmd);
    const braking = engine.braking ? 1 : 0;

    // `state.throttle` is what map.html feeds as Engine::Rpm / `.ssc` Default,
    // and `Engine::Rpm` is the rev state. A fading pedal floor still covers
    // the stationary blip, where the filter has not spooled up yet.
    const revRpm = Math.min(1, Math.abs(this.revs));
    const pedal = Math.min(1, Math.abs(cmd));
    const stationary = Math.max(0, 1 - Math.abs(vf) / 2);
    const wanted = Math.max(revRpm, pedal * stationary);
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
    // Kept normalised here; the lock is per wheel below, off the bundle's own
    // declared span, with `spec.maxSteer` standing in only for a wheel whose
    // bundle declared none.
    const steerNorm = -steerInput;

    // --- wheels ---------------------------------------------------------------
    const force = this._force.set(0, 0, 0);      // body frame, per mass
    const torque = this._torque.set(0, 0, 0);    // body frame
    let loaded = 0;
    // `staticHold`'s two inputs: the summed break-away budget of the contacts
    // and whether every one of them is latched.
    let staticBudget = 0;
    let allLatched = true;
    let springRate = 0;
    // `addFrictionAtAbsolutePosition`'s two accumulators: the tangential
    // force and its moment are MEANED over the tick's contacts, not summed
    // (see `coulombCaps`). The springs above keep summing, because they go
    // through `addAccelerationAtRelativePosition`, which is a plain add.
    const tanForce = this._tanForce.set(0, 0, 0);
    const tanTorque = this._tanTorque.set(0, 0, 0);
    let tanCount = 0;

    const speed = s.velocity.length();

    // The spring axis, world frame. `(0, 1, 0)` in the HULL's frame — the
    // constructor's own `axisFixation`, which nothing authors over (PHY-5) —
    // so it leans with the body instead of standing world-vertical.
    const axisWorld = this._axis.set(0, SPRING_AXIS_Y, 0).applyQuaternion(q);

    // **Next tick's gravity, added to every contact velocity before the
    // tangential demand is taken** — collision-response.md section 8's
    // `V.y += g/30`, and it is in the binary, not only in the note:
    // `0x0825b8b3 mov eax,ds:0x871dc30` (the physics-system singleton),
    // `0x0825b8e4 call [edx+0x14]` — slot `+0x14` of `vtable for
    // BasicPhysicsSystem` `0x0872de40` is `BasicPhysicsSystem::getGravity`
    // `0x08251ec0` — then `0x0825b8e7 fdiv ds:0x8716b5c` (30.0) and
    // `0x0825b8ff fadd` into the y term of `V`, all of it BEFORE the normal
    // projection that makes `Vt`. Section 8's note on why: "so a held body
    // does not creep". Without it the solver only ever sees the velocity gravity has
    // ALREADY produced, cancels that, and lets the next tick's share through
    // again; a parked jeep then walks down a 5-degree slope at a steady
    // 0.8 m/s. With it the demand includes the push before it becomes
    // motion, and the static latch answers the whole of it. In the body
    // frame, because that is where `u` lives.
    const gravityTick = this._gTick.set(0, GRAVITY / ENGINE_TICK_HZ, 0)
      .applyQuaternion(qInv);

    for (const wheel of this.wheels) {
      // Where the axle is, and how far the ground is DOWN THE SPRING AXIS.
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      // One reference height for every ground query this wheel makes: the axle
      // plus the step the suspension can mount. A drivable deck at or below it
      // is this wheel's floor; a deck above it is something the vehicle has to
      // drive round to, and a deck it is under stays over its head.
      const fromY = attach.y + DECK_STEP_UP;
      const reach = probeAlongAxis(this.groundHeight, attach, axisWorld, fromY);
      const raw = Number.isFinite(reach) ? k.wheelRadius - reach : -Infinity;
      if (raw <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        wheel.prevCompression = null;
        // No contact this tick clears the static latch (`0x0825b76b`).
        wheel.staticGrip = false;
        // An airborne driven wheel spins against nothing — at the surface
        // speed the engine is commanding (TANK-9's EngineGrip target), over
        // the wheel's own radius. Unloaded there is no friction to feed the
        // load, so the rev filter climbs to the ceiling on its own and the
        // target comes out at the redline without anything saying so here.
        if (wheel.driven) {
          wheel.angle += (engine.target(0) / k.wheelRadius) * h;
        }
        continue;
      }

      // The contact normal, hoisted above the spring because the spring now
      // needs it too — see the `nAxis` note on `load`.
      const nBody = surfaceNormalAt(this, attach.x, attach.z, fromY,
        this._normal).applyQuaternion(qInv);

      // Contact-patch velocity in the body frame. Hoisted above the spring
      // because the damper's first tick needs its vertical component.
      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));

      // Suspension, PHY-5: spring on travel at 1.5x the authored strength,
      // damper on the one-tick backward difference of the displacement, bump
      // stop past the travel. All per mass, straight off
      // `setStrength`/`setDamping` — see the spec table for the units case.
      // Still an approximation in shape: `travel`, `bumpStiffness` and the
      // probe itself are the viewer's, only the force law is read.
      // **Bounded before anything reads it**, and the damper is the reason:
      // `rate` is a backward difference of this number, so an axle that the
      // probe says went from nothing to three metres deep in one sub-step
      // reports a closing speed of 360 m/s and the damper alone answers with
      // 1800 m/s^2. Capping only the spring's overrun left that untouched,
      // and the jeep still peaked at 187 km/h on a washboard whose flat
      // ground it does 111 on. Past `travel + MAX_OVERRUN` the probe is not
      // describing a suspension state at all.
      const compression = Math.min(raw, k.suspensionTravel + MAX_OVERRUN);
      const travel = Math.min(compression, k.suspensionTravel);
      const overrun = compression - travel;
      // On a wheel that had no contact last tick there is no backward
      // difference to take, and taking one against zero reads the whole
      // penetration depth as one tick's worth of closing speed. The engine
      // never meets that case because its wheel is a body whose displacement
      // is continuous; the honest stand-in is the speed the axle is actually
      // closing on the ground along the spring axis, which is what a
      // continuous displacement would have been changing at. The spring axis
      // is the hull's own +Y (PHY-5), so in the body frame that is simply
      // `-u.y`. A wheel settling gently gets nearly nothing, a wheel landing
      // hard gets its real closing rate, and the damper is no longer blind
      // for a tick every time a wheel re-lands — which on rough ground is 3 %
      // of a jeep's contacts and 8 % of a half-track's. [free, numerics]
      // The damper answers how fast the spring is being compressed, and the
      // axle cannot close on the ground faster than it is travelling toward
      // it. A backward difference of a PROBE can: on a near-vertical face
      // the probe's reading jumps the whole bounded depth in one sub-step
      // and reports 96 m/s of closing speed where the axle is doing 8. The
      // closing speed is the same quantity the first-contact seed already
      // uses, for the same reason, so it bounds the difference too.
      // [free, numerics]
      const closing = Math.abs(u.y) + SPRING_AXIS_FLOOR;
      const rate = wheel.prevCompression === null
        ? Math.max(0, -u.y)
        : clamp((compression - wheel.prevCompression) / h, -closing, closing);
      // **A spring cannot push against a face it is edge-on to.** The probe
      // runs down the hull's own +Y (PHY-5, read), but the ground answers
      // along its own normal, so the reaction available along the spring
      // axis is at most `N . axis` of it. Without this a jeep straddling a
      // 25 m drop read metres of compression on the near-vertical face and
      // the bump stop pushed at about 101 m/s^2 along the hull's up while
      // the tyres, with `N.y` near 0.12, had 1.8 m/s^2 to answer with: 251.8
      // km/h and inverted, out of a fall worth 80.
      //
      // It is the same quantity the friction budget already spends — that
      // one is `N . world-up` and is read (`0x0825b80c fld [eax+0x4]`); this
      // is `N . spring-axis`. The engine has no equivalent because its wheel
      // is a body whose displacement comes from its own contact rather than
      // from a probe down an axis, so the precedent is read and the transfer
      // is this file's. [free, numerics]
      const nAxis = nBody.y > 0 ? nBody.y : 0;
      let load = (SPRING_GRAVITY_SCALE * wheel.strength
        * (travel + overrun * k.bumpStiffness)
        + wheel.damping * rate) * nAxis;
      springRate = Math.max(springRate, Math.abs(rate));
      wheel.prevCompression = compression;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;
      // The Coulomb coefficient this contact spends: the mean of the wheel's
      // own material and the ground's (PHY-2), sampled where the tyre is.
      wheel.friction = 0.5 * (WHEEL_MATERIAL_FRICTION
        + this.surfaceFriction(attach.x, attach.z, fromY));

      // The tyre frame is laid into the contact plane rather than into the
      // hull's — see `intoContactPlane` for the bytes and for what the
      // hull-plane frame cost.
      // The tyre's own frame: forward steered or straight, lateral to its
      // right. Rotation about +Y, so a negative steer angle points the wheel
      // starboard — the right turn the sign convention above promises.
      const steer = steerNorm * (wheel.steerMax ?? k.maxSteer) * DEG;
      const dir = this._dir.set(-Math.sin(steer), 0, -Math.cos(steer));
      if (!wheel.steered) dir.set(0, 0, -1);
      const lat = this._lat.crossVectors(dir, UP);
      // Each axis projected independently, as the engine projects the axle:
      // a degenerate one means the wheel is edge-on to the surface, and the
      // engine's answer there is to ask for nothing.
      const driveOk = intoContactPlane(dir, nBody);
      const axleOk = intoContactPlane(lat, nBody);

      // Section 8 takes the tangential demand from `V` with next tick's
      // gravity already in it. The spring above deliberately used `u`
      // WITHOUT it, because the damper's seed is a real closing speed.
      const uG = this._uG.copy(u).add(gravityTick);
      const uLong = driveOk ? uG.dot(dir) : 0;
      const uLat = axleOk ? uG.dot(lat) : 0;

      // Everything below is per-contact ACCELERATION, and it stays that way:
      // the engine's tangential solve has no normal load in it at all. What
      // happens to these at the end is a MEAN over the contacts, not a sum.

      // Lateral: **RollGrip**, and it is the engine's own demand rather than
      // a tyre model (collision-response.md section 8, PHY-2). Every grip
      // mode in the solver asks for the component of the contact velocity
      // along the wheel's own axle back, in full, inside one tick:
      //
      //   RollGrip     dV = -(Vt along the axle)       -- free rolling
      //   EngineGrip   dV = T - Vt                     -- the same lateral
      //                                                   term, plus drive
      //
      // There is no slip-angle curve anywhere in the engine and no separate
      // lateral coefficient: what limits it is the same isotropic Coulomb
      // clamp the longitudinal demand is measured against, which is why a
      // wheel that spends its budget driving has none left to corner with.
      let aLat = axleOk ? -uLat * ENGINE_TICK_HZ : 0;

      // Longitudinal: the EngineGrip contact-speed target and nothing else.
      // `dV = T - Vt` (collision-response.md section 8), asked for at the
      // engine's own `F * 30` (`ds:0x8716b5c` at `0x0825bc67`), and the
      // Coulomb clamp below decides what the ground answers. A `c_PGFRollGrip`
      // front wheel gets **no longitudinal demand at all** — it is free
      // rolling, and RollGrip's wanted change is along the axle only.
      //
      // The brake byte is inside `engine.target()`: set, it returns 0, so the
      // wheel asks for its whole contact velocity back. That is the brake,
      // the coast and the parking hold, all three, and it is why
      // `brakeDecel`, `engineBraking`, `rollingResistance` and
      // `PARKING_HOLD_SPEED` are gone from this file.
      let aLong = 0;
      if (wheel.driven && driveOk) {
        aLong = (engine.target(0, uLong) - uLong) * ENGINE_TICK_HZ;
      }

      // The friction circle, with the engine's own coefficient and its 1.5:1
      // break-away hysteresis (PHY-2). The budget is the mean of the two
      // contacting materials, so the same jeep has 0.9 on grass and 0.75 in
      // mud; the clamp scales the pair and so keeps the direction of the
      // demand, which is what makes a drive-saturated axle understeer instead
      // of doing something creative.
      const caps = coulombCaps(wheel.friction, nBody.y);
      const demand = Math.hypot(aLong, aLat);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      staticBudget += caps.breakaway;
      tanCount += 1;
      if (grip.scale !== 1) {
        aLong *= grip.scale;
        aLat *= grip.scale;
      }
      // `feedbackLoop` sees the CLAMPED change, per engine tick, along this
      // wheel's own forward axis (TANK-13) — and only from a
      // `c_PGFEngineGrip` wheel, because the grip dispatch at `0x0825bafe`
      // sends only the `0x4` branch to the ancestor walk that finds the
      // engine at all.
      if (wheel.driven) engine.sample(aLong / ENGINE_TICK_HZ);
      // Suspension pushes along the SPRING AXIS, which is the hull's own up
      // (PHY-5) — so in the body frame it is simply (0, load, 0), with no
      // rotation at all, and it leans with the vehicle instead of staying
      // world-vertical. It SUMS.
      const suspension = this._susp.set(0, load, 0);
      force.add(suspension);
      torque.add(this._arm.crossVectors(wheel.rest, suspension));
      // The tyre works in the contact plane at the contact patch, a wheel
      // radius below the axle, and goes into the MEANED accumulators with
      // its own `r x f` — the angular half of
      // `addFrictionAtAbsolutePosition` is a running mean of `r x v` on the
      // same count, so the lever arm is taken per contact and then averaged,
      // never summed.
      const fTyre = this._fTyre.set(0, 0, 0)
        .addScaledVector(dir, aLong).addScaledVector(lat, aLat);
      tanForce.add(fTyre);
      // The contact is where the wheel actually is, not where it rests: the
      // spring is compressed, so the patch sits `compression` higher than
      // `rest.y - radius`. `#applyWheels` already moves the visible wheel by
      // exactly this and the force application point was not following it.
      // The engine has no such gap — it applies at
      // `part.pos + avgContactRelPos` and `part.pos` is the wheel body's
      // live position.
      this._arm.set(wheel.rest.x,
        wheel.rest.y - k.wheelRadius + travel, wheel.rest.z);
      tanTorque.add(this._arm.cross(fTyre));

      // The visual roll, from the road passing under the contact patch.
      wheel.angle += (uLong / k.wheelRadius) * h;
    }

    // The hull's own contacts go into the same mean the tyres feed — a
    // side-on one with nothing in it, which is the engine's dilution and not
    // a loss of grip we invented. See `hullContactFriction`.
    tanCount += hullContactFriction(this, s, qInv, vBody, w, gravityTick,
      tanForce, tanTorque, force);

    // The mean, and the budget the static hold measures itself against with
    // it (`addFrictionAtAbsolutePosition` `0x08254e50`).
    if (tanCount > 0) {
      force.addScaledVector(tanForce, 1 / tanCount);
      torque.addScaledVector(tanTorque, 1 / tanCount);
      staticBudget /= tanCount;
    }

    s.grounded = loaded > 0;
    s.airspeed = speed;

    // --- integrate ------------------------------------------------------------
    // Semi-implicit Euler, like everything else in the viewer: velocity
    // first, position with the updated velocity.
    const accel = this._accel.copy(force).applyQuaternion(q);
    accel.y += GRAVITY;
    staticHold(this, s, accel, h, drive, braking, loaded, staticBudget,
      allLatched, springRate);
    // The exe's drag equation, coefficients from `Objects.con`: see
    // `PointBody.applyDrag` for the disassembly. Wind is zero in every
    // vanilla level.
    const kDrag = Math.PI * k.boundingRadius * k.boundingRadius * k.drag / k.mass;
    accel.addScaledVector(s.velocity, -kDrag);
    const prevX = s.position.x, prevY = s.position.y, prevZ = s.position.z;
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
    // The reference is the hull origin itself, NOT the origin plus a step: a
    // deck above the origin must stay above it, or driving under a low bridge
    // would snap the hull up onto the span.
    const under = this.groundHeight(s.position.x, s.position.z, s.position.y);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }

    // Hull collision against static objects (walls, buildings, parked
    // vehicles). Wheels see the heightfield via `groundHeight`; without this
    // sweep the body would pass straight through any hull that does not also
    // sit on the heightfield — a building wall, a pier — because nothing else
    // checks the static mesh against the body's volume. `WorldCollider`
    // already does this for the soldier (`physics.js`); the vehicle just was
    // never wired in. A SKIN offset keeps the body from vibrating against the
    // surface it is butted up to. `skipOwner` of -1 (no match) skips nothing,
    // so a test collider with no owner index still works.
    if (this.collider && this._hullRadius > 0 && !this.hullSolved) {
      const dx = s.position.x - prevX;
      const dy = s.position.y - prevY;
      const dz = s.position.z - prevZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-6) {
        const len = 1 / dist;
        // A drivable deck is a FLOOR to this sweep, never a wall: see
        // `DECK_FLOOR_COS`. The hull sphere is the vehicle's whole bounding
        // radius centred barely a metre off the ground, so it is buried in
        // anything horizontal it stands on — terrain only gets away with it by
        // not being in the sweep at all. Two numbers hand the gate the geometry
        // it needs: the surface the hull is riding (so a lip within a step of it
        // is a kerb, not a wall) and the slope past which a drivable triangle is
        // a road rather than a parapet. Everything else in the level, this
        // vehicle's own hull aside, still stops it dead.
        const support = this.groundHeight(prevX, prevZ, prevY);
        const stepTop = Number.isFinite(support)
          ? support + DECK_WALL_STEP : -Infinity;
        const hit = this.collider.sweepSphere(
          prevX, prevY, prevZ, dx * len, dy * len, dz * len,
          dist, this._hullRadius, this._collisionOwner, false,
          stepTop, DECK_FLOOR_COS);
        if (hit) {
          const backOff = Math.max(0, hit.t - 0.02);
          s.position.x = prevX + dx * len * backOff;
          s.position.y = prevY + dy * len * backOff;
          s.position.z = prevZ + dz * len * backOff;
          // Kill the velocity component into the surface normal (it points
          // from the hull toward the vehicle centre). Lateral and tangential
          // components are preserved so the vehicle slides along the wall.
          const vDotN = s.velocity.x * hit.nx + s.velocity.y * hit.ny
                      + s.velocity.z * hit.nz;
          if (vDotN < 0) {
            s.velocity.x -= vDotN * hit.nx;
            s.velocity.y -= vDotN * hit.ny;
            s.velocity.z -= vDotN * hit.nz;
          }
        }
      }
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
    // The engine's own construction state: gear 1, no revs, the gear-change
    // lockout re-seeded at 1.0 the way a fresh `PhysicsEngine` is.
    this.engine.reset();
    this._staticQuiet = 0;
    this._staticHeld = false;
    for (const wheel of this.wheels) {
      wheel.angle = 0;
      wheel.compression = 0;
      wheel.prevCompression = null;
      wheel.staticGrip = true;
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
// THE CORRECTION THIS TRACK EXISTS TO CARRY, now itself corrected (TANK-3,
// 2026-09-19): `getCurrentRatio()` samples a full 101-entry array, and that
// array is **piecewise-linear between its control points**, not flat at 1.0
// between them. A 2026-09-16 reading found the constructor's default-fill loop
// and its five stores, never followed the eleven `CALL`s to
// `OverTimeDistribution::generateDistribution` that follow them, and concluded
// that every slot but five holds 1.0 — which put the M3A1 at 17.5 and reduced
// every gear count but 1 and 5 to exactly `3.5 * differential`. Both are
// refuted. Sherman and Willy (5 gears, index 20) keep 4.0 and 7.0; the M3A1
// (4 gears, index 25, `curve[25] = 3.175`) is **5.512**, near enough the ~5.5 a
// smooth interpolation suggests because the curve genuinely is one. See
// `overTimeDistribution` and `gearLadder` below.
//
// `gear` is still seeded to 1 and no code path read so far writes it again
// (TANK-7), so a tracked hull runs on `ladder[0]` for its whole life — but the
// ladder itself is computed for every gear, because a car shifts and because
// pinning the full ladder is what keeps the curve honest.
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

/** Sub-steps per second `TrackedVehicle.integrate` clamps to — the engine's
 * own 30 Hz tick x 4 `PointPhysicsNode` substeps (`physics.md` §3); see
 * `integrate` for the limit cycle that made the rate worth pinning. */
const SUBSTEP_HZ = 120;

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
    /** The ground's `materialFriction` under a world (x, z) — injected the
     * same way `groundHeight` is. See `GroundVehicle`'s own field. PHY-2. */
    this.surfaceFriction = options.surfaceFriction || (() => DEFAULT_MATERIAL_FRICTION);
    /** The drivable-deck contact normal hook. See `GroundVehicle`'s own field. */
    this.deckNormal = options.deckNormal || null;

    // Root PCO physics (`Sherman`/`M3A1`'s own `setMass`/`setObjectDrag`) —
    // unlike `GroundVehicle`, read off the node rather than a single fitted
    // table, because this class has to answer for a 25-tonne Sherman and a
    // 15-tonne M3A1 at once, not one Willys.
    const rootPhysics = node.userData?.physics || {};
    this.mass = typeof rootPhysics.mass === 'number' ? rootPhysics.mass : this.spec.mass;
    this.drag = typeof rootPhysics.drag === 'number' ? rootPhysics.drag : this.spec.drag;

    this.wheels = [];
    /** `Engine::handleUpdate`'s whole state, built from the `Engine` node in
     * `collectChassis` below. A tracked hull **does** shift: TANK-12 found
     * `PhysicsEngine+0xbc` written at `0x0823e3c7`/`0x0823e3f1` inside
     * `handleUpdate`, which the old TANK-7 reading (`gear` never leaves its
     * seed) denied — and being stuck in first is exactly why this viewer's
     * Sherman read 41 km/h against the engine's 53.6. */
    this.engine = new EngineState({
      differential: this.spec.differential,
      numberOfGears: this.spec.numberOfGears,
    });
    this._extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    this.collectChassis();

    /** Driven wheels sharing each side, for diagnostics and harnesses. */
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
    //
    // Divisor 3, not 12: this is the engine's `getGeometryInertia` (lnxded
    // `0x08253930`, collision-response.md §4.2), which is four times a solid
    // box's inertia per unit mass and is the only inertia the engine has.
    this._inertia = new THREE.Vector3((l2 + h2) / 3, (w2 + l2) / 3, (w2 + h2) / 3);

    // Hull collision against static objects — same as `GroundVehicle`.
    this._hullRadius = this._boundingRadius;
    this._collisionOwner = this.collider?.statics?.ownerOf(node) ?? -1;

    // `GroundVehicle`'s two, with the same meaning: this tick's resolved hull
    // contacts for `hullContactFriction`, and whether the rigid-body solver
    // owns this hull against the static world (which turns off the sweep at
    // the end of `#step`).
    this.hullContacts = [];
    this.hullSolved = false;

    // Scratch, so a tick allocates nothing — the same set `GroundVehicle`
    // keeps, for the same reason.
    this._q = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
    this._vBody = new THREE.Vector3();
    this._attach = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._lat = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._torque = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._gTick = new THREE.Vector3();
    this._uG = new THREE.Vector3();
    this._tanForce = new THREE.Vector3();
    this._tanTorque = new THREE.Vector3();
    this._nBody = new THREE.Vector3();
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
        // The whole drivetrain, from the template. `noPropellerEffectAtSpeed`
        // is deliberately NOT read: it lives inside `updatePhysics`'s
        // `& 1`-and-`& 8` block, which a `c_ETTank` never reaches (TANK-7).
        this.engine = new EngineState({
          differential: this.spec.differential,
          numberOfGears: this.spec.numberOfGears,
          ...data.physics,
        }, data.rig?.automaticReset);
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

  /** `getCurrentRatio()` at the live gear (TANK-3). A getter, not a field:
   * the gearbox shifts (TANK-12) and this used to be pinned at `ladder[0]`
   * for the vehicle's whole life. */
  get ratio() { return this.engine.ratio; }
  /** The whole ladder — Sherman 4.000/6.364/9.333/12.727/14.894, M3A1
   * 5.512/9.459/14.583/18.617. */
  get ladder() { return this.engine.ladder; }
  /** 1-based, so `window.__drive()` and the harness read one shape for both
   * vehicle classes. */
  get gear() { return this.engine.gear; }
  /** The filtered rev state, [-1.0, +1.2]. */
  get revs() { return this.engine.revs; }

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
   * hands it.
   *
   * At `SUBSTEP_HZ`, not one step per rendered frame. A tank's suspension is
   * far stiffer in roll than a jeep's — a Sherman's whole 25 t rests on four
   * springs at `strength 18` only 1.01 m either side of the centreline — and
   * the class shipped with an uncapped lateral tyre force four times Willy's
   * stiffness on top of that, which put explicit integration of the pair
   * past its stability limit at one step per frame. It did not merely
   * wobble: driven at full lock the model settled into a textbook period-2
   * limit cycle, body roll rate flipping -15.08 deg/s / +14.91 deg/s and the
   * four wheel loads swapping sides ([5.39, 4.37, 3.00, 1.98] <-> [3.22,
   * 2.18, 5.22, 4.18]) on alternate frames, for ever. That is the judder a
   * player sees, and it also scrambles the differential this whole class
   * exists to model, since the loads the track forces scale with are the
   * ones oscillating.
   *
   * What cures it now is that there is no unbounded lateral force left to
   * integrate: every tangential demand is a velocity change asked for inside
   * one tick and clamped at `A * |g|`, so the stiffness a `.con` declares
   * cannot put the pair past its stability limit at all. Measured: 0 roll
   * sign flips per second in a settled full-lock turn, worst per-frame load
   * step 0.0000, against the 59 flips and 14 % steps the fitted model left
   * behind even at this rate.
   * This is margin, not the fix, and it is not free margin either, so it is
   * set to what the engine itself runs rather than to the largest number
   * that helped: `physics.md` §3's fixed 30 Hz tick with four
   * `PointPhysicsNode` substeps inside it is exactly 120 Hz. The margin is
   * worth buying because neither the stiffness a mod's vehicle declares nor
   * the frame time this is handed (`dt` is only clamped at 0.1 s upstream)
   * is under this file's control. */
  integrate(dt) {
    if (!(dt > 0)) return;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);
    const steps = Math.max(1, Math.ceil(dt * SUBSTEP_HZ));
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
    const vf = -vBody.z;

    // --- engine state -----------------------------------------------------
    //
    // The RAW player inputs, because the engine's own RotationalBundle now
    // lives inside `EngineState` and is stepped there: `Engine+0x124` is the
    // raw input (read only for the brake byte) and `Engine+0x10c`/`+0x104`
    // the clipped angles the throttle and steering terms are built from. This
    // used to read `s.surfaces`, which put the two through `Vehicle`'s own
    // servo instead — a reasonable stand-in at the time, and the reason the
    // half-track's shared-`c_PIYaw`-key collision with `M3A1Wheel1`'s
    // steering bundle used to govern the drivetrain's steering rate. It no
    // longer can: `s.surfaces` still poses the visible wheels through
    // `applyRig`, and the drivetrain reads the Engine's own declared
    // `maxRotation`/`acceleration` (`extras.physics`, TANK-12).
    const throttle = clamp(this.input('c_PIThrottle'), -1, 1);
    const yaw = clamp(this.input('c_PIYaw'), -1, 1);
    const engine = this.engine;
    engine.advance(h, throttle, yaw);

    // Audio rpm for `.ssc` Default / Engine::Rpm — now the engine's own rev
    // state rather than a thrust-over-torque reconstruction of it, since the
    // rev state is what `Engine::Rpm` is.
    const wanted = Math.min(1, Math.abs(engine.revs));
    s.throttle += (wanted - s.throttle) * Math.min(1, 8 * h);

    // --- wheels -------------------------------------------------------------
    const force = this._force.set(0, 0, 0);
    const torque = this._torque.set(0, 0, 0);
    let loaded = 0;
    // `staticHold`'s two inputs, exactly as `GroundVehicle` gathers them.
    let staticBudget = 0;
    let allLatched = true;
    let springRate = 0;
    // `addFrictionAtAbsolutePosition`'s two accumulators: the tangential
    // force and its moment are MEANED over the tick's contacts, not summed
    // (see `coulombCaps`). The springs above keep summing, because they go
    // through `addAccelerationAtRelativePosition`, which is a plain add.
    const tanForce = this._tanForce.set(0, 0, 0);
    const tanTorque = this._tanTorque.set(0, 0, 0);
    let tanCount = 0;
    const speed = s.velocity.length();

    // The spring axis, world frame — the hull's own up (PHY-5), not the
    // world's. See `GroundVehicle.#step` for the whole reading.
    const axisWorld = this._axis.set(0, SPRING_AXIS_Y, 0).applyQuaternion(q);

    // **Next tick's gravity, added to every contact velocity before the
    // tangential demand is taken** — collision-response.md section 8's
    // `V.y += g/30`, and it is in the binary, not only in the note:
    // `0x0825b8b3 mov eax,ds:0x871dc30` (the physics-system singleton),
    // `0x0825b8e4 call [edx+0x14]` — slot `+0x14` of `vtable for
    // BasicPhysicsSystem` `0x0872de40` is `BasicPhysicsSystem::getGravity`
    // `0x08251ec0` — then `0x0825b8e7 fdiv ds:0x8716b5c` (30.0) and
    // `0x0825b8ff fadd` into the y term of `V`, all of it BEFORE the normal
    // projection that makes `Vt`. Section 8's note on why: "so a held body
    // does not creep". Without it the solver only ever sees the velocity gravity has
    // ALREADY produced, cancels that, and lets the next tick's share through
    // again; a parked jeep then walks down a 5-degree slope at a steady
    // 0.8 m/s. With it the demand includes the push before it becomes
    // motion, and the static latch answers the whole of it. In the body
    // frame, because that is where `u` lives.
    const gravityTick = this._gTick.set(0, GRAVITY / ENGINE_TICK_HZ, 0)
      .applyQuaternion(qInv);

    for (const wheel of this.wheels) {
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      // One deck reference for the whole probe, exactly as `GroundVehicle` does.
      const fromY = attach.y + DECK_STEP_UP;
      const reach = probeAlongAxis(this.groundHeight, attach, axisWorld, fromY);
      const raw = Number.isFinite(reach) ? wheel.radius - reach : -Infinity;
      if (raw <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        wheel.prevCompression = null;
        wheel.staticGrip = false;   // no contact clears the latch (PHY-2)
        // Airborne and driven: the track keeps moving at its commanded
        // surface speed against nothing, over its own radius (`SpinWheel`
        // `0x0825b440` is `speed / radius`, visual only — TANK-8).
        if (wheel.driven) {
          wheel.angle += (engine.target(wheel.side) / wheel.radius) * h;
        }
        continue;
      }

      // The contact normal, hoisted above the spring for the same reason
      // `GroundVehicle` hoists it.
      const nBody = surfaceNormalAt(this, attach.x, attach.z, fromY,
        this._normal).applyQuaternion(qInv);

      // Contact-patch velocity, hoisted for the damper's first tick exactly
      // as `GroundVehicle` hoists its own.
      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));

      // Suspension: `GroundVehicle`'s own spring/damper/bump-stop shape,
      // unchanged — including PHY-5's 1.5x gravity-invariance factor, the
      // backward-difference damper and its first-contact closing-speed seed,
      // and its disclaimer about what a probe down the spring axis is and is
      // not. A tracked hull needs the seed more than a jeep does: on rough
      // ground 8 % of its contacts are a wheel re-landing.
      // Bounded before the damper reads it — see `GroundVehicle.#step`.
      const compression = Math.min(raw, k.suspensionTravel + MAX_OVERRUN);
      const travel = Math.min(compression, k.suspensionTravel);
      const overrun = compression - travel;
      // The damper answers how fast the spring is being compressed, and the
      // axle cannot close on the ground faster than it is travelling toward
      // it. A backward difference of a PROBE can: on a near-vertical face
      // the probe's reading jumps the whole bounded depth in one sub-step
      // and reports 96 m/s of closing speed where the axle is doing 8. The
      // closing speed is the same quantity the first-contact seed already
      // uses, for the same reason, so it bounds the difference too.
      // [free, numerics]
      const closing = Math.abs(u.y) + SPRING_AXIS_FLOOR;
      const rate = wheel.prevCompression === null
        ? Math.max(0, -u.y)
        : clamp((compression - wheel.prevCompression) / h, -closing, closing);
      // **A spring cannot push against a face it is edge-on to.** The probe
      // runs down the hull's own +Y (PHY-5, read), but the ground answers
      // along its own normal, so the reaction available along the spring
      // axis is at most `N . axis` of it. Without this a jeep straddling a
      // 25 m drop read metres of compression on the near-vertical face and
      // the bump stop pushed at about 101 m/s^2 along the hull's up while
      // the tyres, with `N.y` near 0.12, had 1.8 m/s^2 to answer with: 251.8
      // km/h and inverted, out of a fall worth 80.
      //
      // It is the same quantity the friction budget already spends — that
      // one is `N . world-up` and is read (`0x0825b80c fld [eax+0x4]`); this
      // is `N . spring-axis`. The engine has no equivalent because its wheel
      // is a body whose displacement comes from its own contact rather than
      // from a probe down an axis, so the precedent is read and the transfer
      // is this file's. [free, numerics]
      const nAxis = nBody.y > 0 ? nBody.y : 0;
      let load = (SPRING_GRAVITY_SCALE * wheel.strength
        * (travel + overrun * k.bumpStiffness)
        + wheel.damping * rate) * nAxis;
      springRate = Math.max(springRate, Math.abs(rate));
      wheel.prevCompression = compression;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;
      wheel.friction = 0.5 * (WHEEL_MATERIAL_FRICTION
        + this.surfaceFriction(attach.x, attach.z, fromY));

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
      // Into the contact plane, exactly as `GroundVehicle` does it.
      const driveOk = intoContactPlane(dir, nBody);
      const axleOk = intoContactPlane(lat, nBody);

      // Section 8 takes the tangential demand from `V` with next tick's
      // gravity already in it. The spring above deliberately used `u`
      // WITHOUT it, because the damper's seed is a real closing speed.
      const uG = this._uG.copy(u).add(gravityTick);
      const uLong = driveOk ? uG.dot(dir) : 0;
      const uLat = axleOk ? uG.dot(lat) : 0;

      // Per-contact ACCELERATION with no normal load in it, meaned at the
      // end — `GroundVehicle.#step` and `coulombCaps` carry the reading.

      // Lateral: **RollGrip**, the same demand `GroundVehicle` now carries —
      // the component of the contact velocity along the wheel's own axle,
      // asked for back in full inside one tick. A dummy roller gets nothing
      // at all: `addFriction` returns at `0x0825b7xx` for the DummyGrip bit
      // before any of this, so it is not even a zero sample.
      let aLat = (wheel.dummy || !axleOk) ? 0 : -uLat * ENGINE_TICK_HZ;

      // Longitudinal: the EngineGrip contact-speed target, which is the whole
      // of a tracked vehicle's propulsion (tank-driving.md section 5).
      //
      //   dV = T - Vt,  T = ratio * getCurrentDifferentialRPM(side) along fwd
      //
      // and `addFriction` hands the root `F * 30` — `ds:0x8716b5c`, the
      // engine's own tick rate, at `0x0825bc67` — so the gain is
      // `ENGINE_TICK_HZ` and not a fitted number and **not** `1 / h`. The
      // distinction is not cosmetic: at `1 / h` the demand is four times
      // stiffer at this class's 120 Hz sub-step than the engine's is, which
      // saturates the Coulomb clamp on every sub-step, pins `feedbackLoop`'s
      // load at its own clamp of 1.0, and holds the revs below `gearUp` for
      // ever — a Sherman that never leaves third at 30 km/h.
      //
      // The two sides' targets differ by
      // `getCurrentDifferentialRPM`'s own `1 -/+ 1.5 * steer`, each clamped
      // to +-1, and **that difference is the entire steering mechanism** —
      // nothing applies a yaw torque to the hull, and the couple this file
      // used to build is gone with `trackDifferential`.
      //
      // A `c_PGFRollGrip` wheel (a half-track's front axle) and a dummy
      // roller get NO longitudinal demand at all: RollGrip's wanted change is
      // `-(Vt along the axle)`, lateral only, and DummyGrip returns before
      // the solver (collision-response.md section 8).
      let aLong = 0;
      if (wheel.driven && !wheel.dummy && driveOk) {
        aLong = (engine.target(wheel.side, uLong) - uLong) * ENGINE_TICK_HZ;
      }

      // The friction CIRCLE, isotropic on the tangential plane exactly as
      // PHY-2 reads it — the ellipse this class used to carry is gone with
      // `lateralGripFraction`. The magnitude is the pair of materials' and so
      // is the 1.5:1 break-away hysteresis; nothing about the shape is this
      // file's any more.
      const caps = coulombCaps(wheel.friction, nBody.y);
      const demand = Math.hypot(aLong, aLat);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      // **A dummy roller is not a contact for this purpose.** The grip
      // dispatch at `0x0825c669` tests `and eax,0x4` on the grip byte and
      // sends `c_PGFEngineDummyGrip` (0x24) to `0x0825c680 call [eax+0xcc]`
      // -- `SpinWheel` -- and out, so it never reaches
      // `addFrictionAtAbsolutePosition` and never bumps its count `+0x64`.
      // Counting a Sherman's eight dummies alongside its four driven bogies
      // divides the tank's whole tangential answer by three: measured, that
      // took the brake from 1.18 s to 3.35 s and turned a 25-degree slope
      // into a 146 m slide. A plain `c_PGFDummyGrip` (0x20) is NOT excluded
      // -- `(0x20 & 4) == 0` sends it back to the ordinary path at
      // `0x0825b761` -- but no shipped chassis authors one.
      if (!wheel.dummy) {
        staticBudget += caps.breakaway;
        tanCount += 1;
      }
      if (grip.scale !== 1) {
        aLong *= grip.scale;
        aLat *= grip.scale;
      }
      // `feedbackLoop` sees the CLAMPED change, as a per-engine-tick delta-v
      // along this wheel's own forward axis (TANK-13) — and only from a
      // `c_PGFEngineGrip` wheel (the `0x4` branch at `0x0825bafe`), so a
      // half-track's free-rolling front axle and every dummy roller are
      // absent from it rather than present as zeroes.
      if (wheel.driven && !wheel.dummy) engine.sample(aLong / ENGINE_TICK_HZ);
      // Along the spring axis, i.e. the hull's own up: (0, load, 0) in the
      // body frame, unrotated (PHY-5). Springs sum; tyres mean.
      const suspension = this._susp.set(0, load, 0);
      force.add(suspension);
      torque.add(this._arm.crossVectors(wheel.rest, suspension));
      const fTyre = this._fTyre.set(0, 0, 0)
        .addScaledVector(dir, aLong).addScaledVector(lat, aLat);
      tanForce.add(fTyre);
      this._arm.set(wheel.rest.x,
        wheel.rest.y - wheel.radius + travel, wheel.rest.z);
      tanTorque.add(this._arm.cross(fTyre));

      // Visual roll: a driven wheel spins at its own side's commanded rate
      // (TANK-2 — the two tracks visibly move at different speeds mid-turn,
      // which is the entire point of this steering law; SpinWheel is
      // visual-only per TANK-8), so it can read slightly ahead of or behind
      // the hull's own integrated motion. Everything else, dummy rollers
      // included, rolls off its own actual contact speed the way
      // `GroundVehicle`'s wheels all do.
      wheel.angle += (wheel.driven
        ? engine.target(wheel.side) / wheel.radius
        : uLong / wheel.radius) * h;
    }

    // The hull's own contacts, as samples in the same mean (see
    // `hullContactFriction`). A tracked hull is wider than its track is tall,
    // so this matters more here than on a jeep: a Sherman that noses into a
    // wall keeps its tracks' grip diluted by one part, not replaced.
    tanCount += hullContactFriction(this, s, qInv, vBody, w, gravityTick,
      tanForce, tanTorque, force);

    if (tanCount > 0) {
      force.addScaledVector(tanForce, 1 / tanCount);
      torque.addScaledVector(tanTorque, 1 / tanCount);
      staticBudget /= tanCount;
    }

    s.grounded = loaded > 0;
    s.airspeed = speed;

    // --- integrate ------------------------------------------------------------
    // Semi-implicit Euler, `GroundVehicle`'s own shape. **Nothing is added
    // along hull forward here**: `PhysicsEngine::updatePhysics` returns at its
    // second instruction for a `c_ETTank` (TANK-7), so the tracks' contact
    // forces above are the whole of the propulsion, and the free-body damper
    // that used to stand beside them is gone with `trackResistance`.
    const accel = this._accel.copy(force).applyQuaternion(q);
    accel.y += GRAVITY;
    staticHold(this, s, accel, h, Math.abs(throttle) < 0.01 ? 0 : 1, 0,
      loaded, staticBudget, allLatched, springRate);
    const kDrag = Math.PI * this._boundingRadius * this._boundingRadius * this.drag / this.mass;
    accel.addScaledVector(s.velocity, -kDrag);
    const prevX = s.position.x, prevY = s.position.y, prevZ = s.position.z;
    s.velocity.addScaledVector(accel, h);
    s.position.addScaledVector(s.velocity, h);

    // Roll and pitch keep the heavy damper the rollover fit asked for; yaw
    // gets its own, far lighter one, because differential steering IS the
    // yaw torque and the rollover cases were never about heading — see
    // `TANK.yawDamping`.
    const yawDamping = k.yawDamping ?? k.angularDamping;
    w.x += (torque.x / this._inertia.x - k.angularDamping * w.x) * h;
    w.y += (torque.y / this._inertia.y - yawDamping * w.y) * h;
    w.z += (torque.z / this._inertia.z - k.angularDamping * w.z) * h;
    if (w.lengthSq() > 0) {
      this._spin.setFromEuler(this._euler.set(w.x * h, w.y * h, w.z * h, 'XYZ'));
      s.orientation.multiply(this._spin).normalize();
    }

    // Failsafe, not suspension — see `GroundVehicle`'s own comment.
    // The reference is the hull origin itself, NOT the origin plus a step: a
    // deck above the origin must stay above it, or driving under a low bridge
    // would snap the hull up onto the span.
    const under = this.groundHeight(s.position.x, s.position.z, s.position.y);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }

    // Hull collision against static objects — same sweep as `GroundVehicle`.
    // skipOwner of -1 skips nothing, so the sweep works even with a mock
    // collider that has no owner index.
    if (this.collider && this._hullRadius > 0 && !this.hullSolved) {
      const dx = s.position.x - prevX;
      const dy = s.position.y - prevY;
      const dz = s.position.z - prevZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-6) {
        const len = 1 / dist;
        // The deck gate, exactly as `GroundVehicle` passes it.
        const support = this.groundHeight(prevX, prevZ, prevY);
        const stepTop = Number.isFinite(support)
          ? support + DECK_WALL_STEP : -Infinity;
        const hit = this.collider.sweepSphere(
          prevX, prevY, prevZ, dx * len, dy * len, dz * len,
          dist, this._hullRadius, this._collisionOwner, false,
          stepTop, DECK_FLOOR_COS);
        if (hit) {
          const backOff = Math.max(0, hit.t - 0.02);
          s.position.x = prevX + dx * len * backOff;
          s.position.y = prevY + dy * len * backOff;
          s.position.z = prevZ + dz * len * backOff;
          const vDotN = s.velocity.x * hit.nx + s.velocity.y * hit.ny
                      + s.velocity.z * hit.nz;
          if (vDotN < 0) {
            s.velocity.x -= vDotN * hit.nx;
            s.velocity.y -= vDotN * hit.ny;
            s.velocity.z -= vDotN * hit.nz;
          }
        }
      }
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
      wheel.prevCompression = null;
      wheel.staticGrip = true;
      wheel.load = 0;
      wheel.node.position.copy(wheel.basePosition);
      wheel.node.quaternion.copy(wheel.baseQuaternion);
    }
    // Back to the engine's own construction state: gear 1, no revs, and the
    // gear-change lockout re-seeded at 1.0 the way a fresh `PhysicsEngine` is.
    this.engine.reset();
    this._staticQuiet = 0;
    this._staticHeld = false;
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
