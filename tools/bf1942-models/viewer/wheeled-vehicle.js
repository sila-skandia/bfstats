// Driving a Refractor wheeled land vehicle that is already standing in an
// extracted map: `GroundVehicle`, the wheels' owner. (Was `ground.js`; the land
// drive is now one module per owner: this file the wheels, `tracked-vehicle.js`
// the tracks, `suspension.js` the springs, `ground-contact.js` the tyre's
// contact, `ground-engine.js` the engine and `ground-specs.js` the tables.)
//
// Same seam as the aircraft's (`vehicle-base.js`, `aircraft.js`), on purpose
// and to the letter:
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
// table (`ground-specs.js`) only fills in what the data genuinely does not say.
//
// PROVISIONAL, in the same sense `Aircraft`'s roll model is: the retail
// engine's car integrator has not been read out of the executable the way the
// point-body one has (`physics.js`), so the *shape* of this model — vertical
// spring rays, a linear tyre inside a friction circle, torque as mass-free
// acceleration — is our reconstruction, contained in `integrate` and
// replaceable without anything outside noticing.

import * as THREE from 'three';
import { Vehicle } from './vehicle-base.js';
import { GRAVITY } from './physics.js';
import { WILLYS } from './ground-specs.js';
import {
  DECK_STEP_UP, DECK_WALL_STEP, DECK_FLOOR_COS, ENGINE_TICK_HZ,
  DEFAULT_MATERIAL_FRICTION, WHEEL_MATERIAL_FRICTION, coulombCaps, coulombClamp,
  staticHold, hullContactFriction, surfaceNormalAt, intoContactPlane,
} from './ground-contact.js';
import {
  SPRING_AXIS_Y, SPRING_GRAVITY_SCALE, SPRING_AXIS_FLOOR, Wheel, probeAlongAxis,
  MAX_OVERRUN,
} from './suspension.js';
import { clamp, EngineState } from './ground-engine.js';

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
     * (`aircraft.js`) never gets one. `hullContactFriction` is what reads it.
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
