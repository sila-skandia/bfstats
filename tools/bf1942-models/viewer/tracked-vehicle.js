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
// THE HULL'S MOTION IS THE SERVER'S OWN PER-TICK LAW (2026-10-22, ledger
// TANK-18..TANK-24, TERR-17): one 30 Hz tick of `Engine::handleUpdate`, the
// springs on their pushes, the root's sleep and single Euler step, and the
// collision pass's wheel pushes and EngineGrip friction, replayed against the
// lab's Sherman to a third of a millimetre an acknowledged tick
// (`tests/test_tank_law.py`, `features/tank-ground-law`). The suspension this
// class used to share with `GroundVehicle` (vertical rays, travel, bump stop,
// 120 Hz sub-steps, a fitted angular damper, a static hold) is gone from it;
// what is still the page's own is marked where it stands.
//
// (Split out of `ground.js`, now `wheeled-vehicle.js`: the tracks are this
// module's; the springs and `Wheel` are shared through `suspension.js`, the
// tyre's contact through `ground-contact.js`, the engine through
// `ground-engine.js`.)

import * as THREE from 'three';
import { Vehicle } from './vehicle-base.js';
import { GRAVITY } from './physics.js';
import { TANK } from './ground-specs.js';
import {
  DECK_STEP_UP, DECK_WALL_STEP, DECK_FLOOR_COS, ENGINE_TICK_HZ,
  DEFAULT_MATERIAL_FRICTION, DEFAULT_MATERIAL_RESISTANCE, WHEEL_MATERIAL_FRICTION,
  WHEEL_MATERIAL_RESISTANCE, hullContactFriction, surfaceNormalAt, intoContactPlane, addBoxDrag,
} from './ground-contact.js';
import { Wheel } from './suspension.js';
import { clamp, EngineState, ENGINE_BIT_THRUST, engineTypeBits } from './ground-engine.js';
import { traverseOwn } from './spawned-craft.js';
import { bodyMotion, scrollBeltsByEngine, scrollBeltsByMotion } from './track-scroll.js';
import {
  AmphibiousKit, HullWater, bedGroundHeight, inertiaGeometryBox, geometryInertia,
} from './amphibious.js';

const DEG = Math.PI / 180;

/** `c_PGFEngineDummyGrip`: an idler or return-roller road wheel — present for
 * the tread to ride on, not for the drivetrain. TANK-6/14 read it as
 * spin-only; the Wake Sherman and M3A1 extras confirm it byte for byte
 * rather than merely inferring it from the grip name — every dummy-grip
 * `Spring` node in both ships `setStrength 0`/`setDamping 0`, so it already
 * costs the suspension solve nothing on its own, without this file having to
 * special-case it there. */
const GRIP_DUMMY = 'c_PGFEngineDummyGrip';
/** `c_PGFRollGrip`: a free-rolling axle (a half-track's front pair), which
 *  asks back only its speed along the axle. */
const GRIP_ROLL = 'c_PGFRollGrip';

/**
 * A wheel's rolling radius, measured off its own mesh — generalising the
 * hand measurement TANK-14/15 took off the Sherman and M3A1 collision
 * meshes (Y/Z extent averaged: `(0.258+0.256)/2 ~= 0.257`, `(0.174+0.166)/2
 * ~= 0.17`, both confirmed against this exact function's arithmetic on the
 * live Wake scene) so a tank from any mod answers for its own wheel size
 * rather than needing a per-vehicle number — the same thing `WillyRadius`
 * already established no `.con` file ever declares.
 *
 * A collision probe is never the wheel's mesh. A spring the `.con` authors
 * `createInvisible` (`bf42/assemble.py` `build_node`: the KettenKrad's rear
 * wheels, the R75's and HD_XA42's sidecar wheel, the LVT4's driven pair, a
 * PT boat's beach wheels) carries no drawn mesh, only its col0 probe, and
 * the half-extent of that probe (a 3-vertex triangle under the axle on the
 * R75, 0.002 m) put its contact at the axle. It takes the probe's depth
 * under its origin instead, where `checkVsTerrain` meets the ground and the
 * depth `hull-bodies.js` `wheelContactDepths` hands the page's drive.
 *
 * @returns {number|null} metres, or null if the node (and nothing under it)
 *   carries geometry to measure
 */
export function measureWheelRadius(node) {
  const drawn = obj => obj.geometry && !obj.userData?.collision;
  let target = drawn(node) ? node : null;
  if (!target) {
    // Not into a spawned object under it: a towing tractor's hook Springs
    // carry the towed gun, whose meshes are no wheel of the tractor's
    // (`traverseOwn`, FHX-30).
    traverseOwn(node, child => { if (!target && drawn(child)) target = child; });
  }
  if (!target) return probeDepth(node);
  const geometry = target.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;
  return ((box.max.y - box.min.y) + (box.max.z - box.min.z)) / 4;
}

/** An undrawn wheel's contact depth: the lowest vertex of the collision
 *  probes hung directly under it, in its own frame. Null with none. */
function probeDepth(node) {
  let low = Infinity;
  const box = new THREE.Box3();
  for (const child of node.children) {
    if (!child.geometry || !child.userData?.collision) continue;
    child.updateMatrix();
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    box.copy(child.geometry.boundingBox).applyMatrix4(child.matrix);
    low = Math.min(low, box.min.y);
  }
  return low < 0 ? -low : null;
}

/** Metres: an authored offset this close to the centreline is the centreline. */
const CENTRELINE = 1e-4;

/**
 * A steered wheel's posed axle (row 0) and forward (row 2, the page's -Z),
 * world frame: the hull's axes turned about its up by the steering bundle's
 * servo angle `steerDeg` (positive right, TANK-27). RollGrip asks along the
 * axle; EngineGrip drives along the forward (`addFriction` reads the
 * spring's physics parent's absolute row 2, 0x0825b9cf).
 */
export function steeredAxle(out, steerDeg, q) {
  const a = -steerDeg * (Math.PI / 180);
  return out.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(q);
}
export function steeredForward(out, steerDeg, q) {
  const a = -steerDeg * (Math.PI / 180);
  return out.set(-Math.sin(a), 0, -Math.cos(a)).applyQuaternion(q);
}

/** A wheel's side at rest: the sign of its offset, 0 on the centreline. */
export function restSide(x) {
  return Math.abs(x) < CENTRELINE ? 0 : Math.sign(x);
}

/**
 * The side `getCurrentDifferentialRPM` is handed for a wheel in contact.
 *
 * `addFriction` takes it as the x of the spring's position relative to its
 * parent (`0x0825c265 call [eax+0x34]`, `PhysicsNode::getRelativePosition`
 * `0x08254a50`, then `0x0825c26a mov ebx,[eax]`), and reads it after
 * `solveImpulse` has moved the spring in the same resolve pass. That move is
 * the spring branch of `solveImpulse` (`0x082594f0`-`0x08259610`): the
 * part's mean contact normal `+0x68` times its push-out along that normal,
 * clamped to [0, 1] m, added to `getAbsolutePosition` (`+0x2c`, `0x08254990`)
 * and written back with `setAbsolutePosition` (`+0x30`, `0x082549b0`). The
 * normal is the world terrain normal (`checkVsTerrain`), so in the hull's
 * frame the spring stands `nBody.x * push` off its authored offset when
 * `addFriction` asks; `PhysicsSpring::updatePhysics` puts it back on the next
 * tick, before the next push.
 *
 * A spring off the centreline (every vanilla tank's) never changes side this
 * way. One on it, as FHSW's horses carry (`HorseEngineSpringR` at
 * `0/-0.3/-0.9` under a `c_ETTank` Engine), takes the side the contact
 * normal leans to in the hull's frame: under full lock it is one of the two
 * tracks, not the centreline's unclamped `revs` (13.4 m/s on a horse in
 * fifth) that held a galloping horse on a 36 m circle at 10.8 m/s. Which
 * track depends on how the hull leans. The lab's horse under W+D at 11 m/s
 * leaned out of the turn (its right side 6 degrees up), slowed to 0.6 m/s and
 * spun at 3.75 rad/s within 4.5 s (FHSW Operation_SpringAwakening,
 * Cavalry_K98, 2026-10-17); the page's hull leans into the turn, so on level
 * ground the spring still pushes as the outer track and the circle holds.
 *
 * @param {number} restX the wheel's authored x in the hull frame (0 on the
 *   centreline, `restSide`)
 * @param {number} normalX the contact normal's x in the hull frame
 * @param {number} push how far the contact pushes the spring out, metres
 */
export function contactSide(restX, normalX, push) {
  return Math.sign(restX + normalX * Math.max(0, Math.min(1, push)));
}

// --- the server's per-tick ground law (ledger TANK-18..TANK-24) --------------
//
// One engine tick of a driven `c_ETTank`, in the server's own order, replayed
// against the lab's Sherman to 0.2-0.4 mm an acknowledged tick
// (`lab/veh_law_check.py`, `tests/test_tank_law.py`):
//
//   1 `Engine::handleUpdate` 0x0823e120 (`EngineState.tick`, TANK-12)
//   2 `performMobilePhysicsUpdate` 0x08147470, children before parents: every
//     `PhysicsSpring::updatePhysics` 0x0824ddd0 (the wheel snapped back to rest,
//     `-(1.5 k D + c (D - Dprev) 30)` at its anchor), `PhysicsEngine` 0x0824cbb0
//     (wakes the root at |revs| >= 0.05), the root `PhysicsNode` 0x082543d0
//     (sleep, box drag, one Euler step, the rows turned about omega)
//   3 the collision pass `rpm.update` 0x0825d0b0: each awake wheel's col0
//     vertex 0 against the terrain (`checkVsTerrain` 0x0825a960), moved out
//     along the face normal by its depth clamped to 1 m (`solveImpulse`
//     0x08258d30), and `addFriction` 0x0825b6e0 posting one clamped delta-v a
//     wheel (EngineGrip toward `ratio * diffRPM(side)` along the track, the
//     static latch, `feedbackLoop`), meaned, into the NEXT tick's accumulators

/** The engine's tick, seconds (LOOP-1). */
const TICK = 1 / ENGINE_TICK_HZ;

/** `PhysicsNode` sleep (0x082543d0): a root that has been quiet for this many
 *  ticks sleeps -- velocities, accumulators and gravity all zeroed -- until
 *  something wakes it. TANK-21. */
const SLEEP_TICKS = 100;
/** The root's own wake tests on the accumulator, velocity and spin it holds
 *  as the tick starts (|a|^2, |v|^2, |w|^2), and a contact's (|speed|^2). */
const WAKE_ACC2 = 2.5;
const WAKE_V2 = 0.25;
const WAKE_W2 = 0.25;
const CONTACT_WAKE2 = 0.1;
/** `PhysicsEngine::updatePhysics`: revs this large wake the root. */
const ENGINE_WAKE_REVS = 0.05;
/** The root's guards: an accumulator past 1000 is scaled to it; a friction
 *  accumulator past 250 (|w| part: 200) is dropped for the tick. */
const ACC_LIMIT = 1000;
const FR_LIMIT2 = 62500;
const RFR_LIMIT2 = 40000;
/** `solveImpulse`'s spring branch moves the wheel at most this far, metres. */
const PUSH_LIMIT = 1;
/** `PlayerAction::get` 0x0815c5a0 rounds an axis to hundredths (a key: 1.00). */
/** The Engine's registers ride the wire at 0.8 of their value (`writeSignedFloat`). */
const ENGINE_WIRE = 1.25;
/** Ticks of state a drive keeps for `rewind`: 3 s, past any round trip. */
const HISTORY_TICKS = 90;
/** Metres: the kept tick a recorded pose names must stand this close to it. */
const REWIND_MATCH = 0.05;
const roundAxis = v => Math.round(clamp(v, -1, 1) * 100) / 100;
/** A spring's force is `1.5 k D` (the 1.5 is gravity's 14.73 over 9.82, PHY-5). */
const SPRING_FORCE_SCALE = 1.5;
/** `addFriction`'s kinetic budget per unit friction and `N.y`, one tick's
 *  delta-v: `1.5 * 9.82 / 30` (the break-away is 1.5 times it). PHY-2. */
const COULOMB_LO = 1.5 * 9.82 / ENGINE_TICK_HZ;

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
    /** `materialResistance` beside it (`level-terrain.js` carries it as
     * `surfaceFriction.resistance`): `addFriction`'s `-resistance * Vt`. */
    this.surfaceResistance = options.surfaceResistance
      || options.surfaceFriction?.resistance || (() => DEFAULT_MATERIAL_RESISTANCE);
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
    //
    // **Over the engine's own box, not the wheel footprint.** The box
    // `getGeometryInertia` reads is the root LOD's first child's mesh (a
    // tank's `ShermanComplex`, COL-15), the hull, which is longer, wider and
    // taller than the span of its road wheels: a Sherman's footprint gives a
    // yaw inertia of 7.0 m^2, its hull box 13.1. The footprint is kept only
    // for a tree that carries no such geometry (a test double).
    //
    // It is not cosmetic. The AI's tank law steers on the yaw rate
    // (`TankControl::controlTowardsDirection`, AI-45: `steer = angle -
    // rate/(30|angle| + 1)`, a unit gain at a straight heading), and a hull
    // that turns twice as far per tick of differential as the engine's
    // closes that loop above one: the steer flips sign every tick, the
    // differential's max-of-wheels load (TANK-13) holds the revs near 0.75,
    // and a bot Sherman crawled at 8.0 m/s where the lab's LOD 0 rounds
    // record 12-14.6 (features/desert-combat-parity/lab-ground-truth.md). On
    // the box a bot T-72 under its `maxSpeed 12` cruises at 11.3 m/s in fifth
    // at revs 0.76 and an M1A1 under 15 at 14.2, revs 0.95; the lab's are
    // 11.2 at 0.755 and 14.1 at 0.947.
    this.geometryBox = inertiaGeometryBox(node, options.collisionMeshes ?? null);
    this._inertia = this.geometryBox
      ? geometryInertia(this.geometryBox)
      : new THREE.Vector3((l2 + h2) / 3, (w2 + l2) / 3, (w2 + h2) / 3);

    // Hull collision against static objects — same as `GroundVehicle`.
    this._hullRadius = this._boundingRadius;
    this._collisionOwner = this.collider?.statics?.ownerOf(node) ?? -1;

    // `GroundVehicle`'s two, with the same meaning: this tick's resolved hull
    // contacts for `hullContactFriction`, and whether the rigid-body solver
    // owns this hull against the static world (which turns off the sweep at
    // the end of `#step`).
    this.hullContacts = [];
    this.hullSolved = false;

    /** An amphibian's water engine, floats and rudders (`amphibious.js`),
     * or null for a hull with none. */
    const waterLevel = options.waterLevel ?? this.collider?.waterLevel;
    // The level's collision sidecar, whose `bbox` is a mesh's `.sm` header box
    // (`headerGeometryBox`, COL-14); null in a harness.
    const collisionMeshes = options.collisionMeshes ?? null;
    this.amphibious = AmphibiousKit.of(node, { waterLevel, mass: this.mass, drag: this.drag, collisionMeshes });
    /** How deep the hull is under the sea and what that costs it in drag
     * (`HullWater`): the amphibian kit's own, or one of its own, or null on a
     * level with no sea. Every land hull stands on the sea BED, not only one
     * that floats: `checkVsTerrain` meets the heightfield and water produces
     * no impulse (collision-response.md section 7), so a tank driven into the
     * sea sinks until its springs find the bottom. */
    this.water = this.amphibious?.water ?? HullWater.of(node, { waterLevel, mass: this.mass, drag: this.drag, collisionMeshes });
    this.groundHeight = bedGroundHeight(this.collider, waterLevel, this.groundHeight);
    this._inputOf = name => this.input(name);

    /** The root `PhysicsNode`'s state between ticks, in the server's own
     * terms (`SimpleObjectNetworkable::updateStateMask` 0x08235ee0 sends it
     * whole): `acc`/`racc` the acceleration and its moment accumulated for
     * the next tick (gravity, springs, resistance; world frame), `fr`/`rfr`
     * the mean friction posted by the collision pass, `sleepiness` the
     * 100-tick countdown (0 = asleep), `clock` the tick accumulator. `fresh`
     * until the first tick, which stands the wheels on the ground they
     * already press into (`#settleWheels`). */
    this.law = {
      clock: 0, sleepiness: SLEEP_TICKS, fresh: true,
      acc: new THREE.Vector3(0, GRAVITY, 0), racc: new THREE.Vector3(),
      fr: new THREE.Vector3(), rfr: new THREE.Vector3(),
    };

    // Scratch, so a tick allocates nothing — the same set `GroundVehicle`
    // keeps, for the same reason.
    this._wWorld = new THREE.Vector3();
    this._vert = new THREE.Vector3();
    this._contact = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._vt = new THREE.Vector3();
    this._dv = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._hcForce = new THREE.Vector3();
    this._hcTorque = new THREE.Vector3();
    this._hcRes = new THREE.Vector3();
    this._groundOut = { y: NaN, n: new THREE.Vector3(0, 1, 0) };
    this._surface = { y: NaN, nx: 0, ny: 1, nz: 0 };
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
    this._wheelFwd = new THREE.Vector3();
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
    // Not into an object a spawner of the hull stood (`traverseOwn`): a
    // towing tractor's towed gun is baked under it, Engine and wheels too.
    traverseOwn(this.node, obj => {
      const data = obj.userData || {};
      if (data.templateKind === 'Engine' && data.physics) {
        // An amphibian's water engine (`c_ETShip`, bit 0 set) drives no
        // spring: it is `amphibious.js`'s. Taking it for the drivetrain
        // because the walk met it last left a BMP-2's tracks on a screw's
        // gearbox.
        if (engineTypeBits(data.physics.engineType) & ENGINE_BIT_THRUST) return;
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
      let steerRate = 0;
      let steerSign = 1;
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
          // The bundle's servo under `automaticReset` (GUN-2): degrees a
          // second, its `setAcceleration` (TANK-12's reading of the Engine's
          // own bundle), else `setMaxSpeed`.
          steerRate = Math.abs(yaw.acceleration || yaw.maxSpeed || 0);
          // The bundle's own sense, as `applyRig` poses it (`axisDirection`):
          // the Puma's rear axles declare `direction -1` and turn against
          // the front. Taking the stick's sense laid its four driven wheels
          // parallel and the eight-wheeler crabbed instead of turning.
          steerSign = Math.sign(yaw.direction || yaw.acceleration || 1);
          break;
        }
      }
      const wheel = new Wheel(obj, rest, data.physics, steered);
      // The authored offset, read through two world matrices: a spring the
      // `.con` puts on the centreline comes back 1e-7 off it, and the sign
      // of that noise used to decide its side for good.
      wheel.side = restSide(rest.x);
      wheel.dummy = data.physics.grip === GRIP_DUMMY;
      wheel.grip = data.physics.grip ?? null;
      /** World frame: where `solveImpulse` moved the wheel off its rest last
       * tick (along the contact normal, at most 1 m), which the spring reads
       * as `-D` this tick; and the `D` of the tick before, for its damper. */
      wheel.push = new THREE.Vector3();
      wheel.dPrev = new THREE.Vector3();
      wheel.steerMax = steerMax;
      /** The steering bundle's own angle (degrees) and its servo rate: the
       * axle RollGrip asks along is the wheel's posed row 0, which follows the
       * bundle at its rate, not the stick. */
      wheel.steerRate = steerRate;
      wheel.steerSign = steerSign;
      wheel.steerAngle = 0;
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

  /** `Engine+0x142` for every Engine on the hull (the drivetrain's and an
   * amphibian's screw): TemplateMessage 4 sets it when the driver's seat is
   * taken, 5 clears it when he leaves (ledger PHY-14). While it is clear the
   * inputs are zeroed and the revs held at 0. */
  get engineRunning() { return this.engine.running; }
  set engineRunning(on) { this.engine.running = !!on; }

  /** A land drivetrain: see `GroundVehicle.landDrive`. */
  get landDrive() { return true; }

  /** Carry the hull forward by `dt`: whole engine ticks only, off an
   * accumulator (LOOP-1), so the per-tick law below runs exactly once per
   * server tick whatever a caller hands it. The world's tick is 1/30 s and
   * runs one; a test that steps 1/60 runs one every other call.
   *
   * It used to sub-step at 120 Hz, which ran the engine's per-tick law (the
   * spring's damper on `D - Dprev`, the friction's one delta-v a tick, the
   * latch) four times a server tick: a sidecar page then predicted its own
   * Sherman centimetres off the server's every ack. */
  integrate(dt) {
    if (!(dt > 0)) return;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);
    const law = this.law;
    law.clock += dt;
    let ticks = Math.floor(law.clock / TICK + 1e-6);
    law.clock -= ticks * TICK;
    if (law.clock < 0) law.clock = 0;
    // A stall, not a simulation (the world's own clock caps its catch-up the
    // same way). [free, numerics]
    if (ticks > 8) ticks = 8;
    for (let i = 0; i < ticks; i++) this.#recordedTick();
    this.applyTransform();
    this.applyRig();
    this.#applyWheels();
    // The belts' texture at this tick's engine state, each at its own side's
    // `ratio * diffRPM` (`track-scroll.js`, AnimatedBundle::updateAnimations).
    scrollBeltsByEngine(this.node, this.engine, dt);
  }

  /** One tick, kept: its inputs and the whole state it ended in, so a
   * correction can start again from any of the last `HISTORY_TICKS`
   * (`rewind`). `tickId` counts the ticks this drive has run. */
  #recordedTick() {
    const throttle = this.input('c_PIThrottle');
    const yaw = this.input('c_PIYaw');
    this.#tick();
    this.tickId = (this.tickId ?? 0) + 1;
    const h = this._history ??= [];
    const entry = h.length >= HISTORY_TICKS ? h.shift() : {};
    entry.id = this.tickId;
    entry.throttle = throttle;
    entry.yaw = yaw;
    entry.snap = this.#snapshot(entry.snap);
    h.push(entry);
  }

  /**
   * The server's state at a tick this drive ran, adopted there and the ticks
   * since run again on their own inputs: the retail client's way of taking a
   * correction (it reads the whole control state the server ran the acked
   * word in, and predicts on from it), and what makes a correction cost the
   * springs nothing. The delta reconciler it replaces added the acked tick's
   * pose and velocity error to the present, a round trip late; against the
   * per-tick spring law that error was out of phase with the hull's own
   * bounce, and the lab M3A1 under it bounced 40 mm at idle and diverged in
   * the turns (`features/tank-ground-law`, 2026-10-23). The rest of the
   * server's state comes too when the sidecar sends it (`adopt`); the springs
   * are re-stood at the server's pose (`reanchor`).
   *
   * @param {number|{x:number, y:number, z:number}} at the drive's `tickId` the
   *   server's state belongs to, or the pose the page recorded for that tick
   *   (the kept tick nearest it, within 5 cm)
   * @param {{x:number, y:number, z:number, q:number[], v?:number[]}} pose
   * @returns {{error: number, errorY: number}|false} the page's error at that
   *   tick (metres, horizontal and vertical), or false when it is no longer kept
   */
  rewind(id, pose) {
    const h = this._history;
    let at = -1;
    if (h && typeof id === 'number') at = h.findIndex(e => e.id === id);
    else if (h && id) {
      let best = REWIND_MATCH * REWIND_MATCH;
      h.forEach((e, k) => {
        const d = (e.snap.p[0] - id.x) ** 2 + (e.snap.p[1] - id.y) ** 2 + (e.snap.p[2] - id.z) ** 2;
        if (d <= best) { best = d; at = k; }
      });
    }
    if (at < 0) return false;
    const s = this.state;
    // How far the page had it from the server's at that tick.
    const was = h[at].snap.p;
    const plan = { error: Math.hypot(pose.x - was[0], pose.z - was[2]), errorY: Math.abs(pose.y - was[1]) };
    const keepThrottle = this.input('c_PIThrottle');
    const keepYaw = this.input('c_PIYaw');
    this.#restore(h[at].snap);
    s.position.set(pose.x, pose.y, pose.z);
    if (pose.q) s.orientation.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]).normalize();
    if (pose.v) s.velocity.set(pose.v[0], pose.v[1], pose.v[2]);
    if (pose.body) this.adopt(pose.body);
    this.#standWheels(false);
    h[at].snap = this.#snapshot(h[at].snap);
    this._replaying = true;
    try {
      for (let k = at + 1; k < h.length; k++) {
        this.setInput('c_PIThrottle', h[k].throttle);
        this.setInput('c_PIYaw', h[k].yaw);
        this.#tick();
        h[k].snap = this.#snapshot(h[k].snap);
      }
    } finally {
      this._replaying = false;
      this.setInput('c_PIThrottle', keepThrottle);
      this.setInput('c_PIYaw', keepYaw);
    }
    return plan;
  }

  /**
   * The rest of the server's state at a tick, on top of the pose and velocity
   * already set: spin, the accumulators, the sleep flag, the Engine's
   * registers (`net-sidecar.js` `hullBodyOf`: page frame, the Engine at 0.8 of
   * its values). What the retail client's `readControlObjectState` takes,
   * the springs aside. Returns whether the springs were taken: never, so the
   * caller re-stands the wheels.
   */
  adopt(body) {
    const s = this.state, law = this.law;
    const q = this._q.copy(s.orientation);
    const qInv = this._qInv.copy(q).invert();
    if (body.w) s.angularVelocity.fromArray(body.w).applyQuaternion(qInv);
    if (body.acc) law.acc.fromArray(body.acc);
    if (body.racc) law.racc.fromArray(body.racc);
    if (body.fr) law.fr.fromArray(body.fr);
    if (body.rfr) law.rfr.fromArray(body.rfr);
    if (body.sleep === true) law.sleepiness = 0;
    else if (body.sleep === false && law.sleepiness <= 0) law.sleepiness = SLEEP_TICKS;
    const e = body.engine;
    if (e) {
      const engine = this.engine;
      if (Number.isFinite(e.revs)) engine.revs = e.revs * ENGINE_WIRE;
      if (Number.isFinite(e.load)) engine.load = e.load * ENGINE_WIRE;
      // The two bundle angles go on the wire over 1.25 times their limit
      // (`EngineNetworkable::getNetUpdate` 0x082279d0: `writeSignedFloat(
      // angle, 16, 1.25 * max(|maxRotation|, |minRotation|))`, 0x08227a4e,
      // 0x08227cb0), not over 1.25: a Willy's throttle angle runs to 5000,
      // a Sherman's to 1. An axis with no limit (a car's yaw) writes nothing
      // a client can read back, and keeps the page's own.
      if (Number.isFinite(e.roll) && engine.maxRollAngle > 0) {
        engine.rollAngle = e.roll * ENGINE_WIRE * engine.maxRollAngle;
      }
      if (Number.isFinite(e.yaw) && engine.maxYawAngle > 0) {
        engine.yawAngle = e.yaw * ENGINE_WIRE * engine.maxYawAngle;
      }
      if (Number.isInteger(e.gear)) engine.gear = e.gear;
    }
    // Not the springs: their relative positions and Dprev come in 2 mm
    // steps, and adopted every ack that noise reached the damper as 0.24 m/s^2
    // a wheel and the lab Sherman rode 6.5 mm high; the wheels are re-stood at
    // the server's pose instead (`reanchor`).
    return false;
  }

  /** Everything a tick reads and writes, into `out` (reused). */
  #snapshot(out = {}) {
    const s = this.state, law = this.law, e = this.engine;
    out.p = s.position.toArray(out.p);
    out.q = s.orientation.toArray(out.q);
    out.v = s.velocity.toArray(out.v);
    out.w = s.angularVelocity.toArray(out.w);
    out.acc = law.acc.toArray(out.acc);
    out.racc = law.racc.toArray(out.racc);
    out.fr = law.fr.toArray(out.fr);
    out.rfr = law.rfr.toArray(out.rfr);
    out.sleepiness = law.sleepiness;
    out.engine = Object.assign(out.engine ?? {}, {
      revs: e.revs, load: e.load, loadCount: e.loadCount, prevLoad: e.prevLoad, gear: e.gear,
      blend: e.blend, rollAngle: e.rollAngle, yawAngle: e.yawAngle, throttleTerm: e.throttleTerm,
      steer: e.steer, braking: e.braking, running: e.running,
    });
    out.wheels ??= this.wheels.map(() => ({}));
    this.wheels.forEach((w, i) => {
      const o = out.wheels[i];
      o.push = w.push.toArray(o.push);
      o.dPrev = w.dPrev.toArray(o.dPrev);
      o.latch = w.staticGrip;
      o.steer = w.steerAngle;
      o.compression = w.compression;
    });
    return out;
  }

  #restore(snap) {
    const s = this.state, law = this.law;
    s.position.fromArray(snap.p);
    s.orientation.fromArray(snap.q);
    s.velocity.fromArray(snap.v);
    s.angularVelocity.fromArray(snap.w);
    law.acc.fromArray(snap.acc);
    law.racc.fromArray(snap.racc);
    law.fr.fromArray(snap.fr);
    law.rfr.fromArray(snap.rfr);
    law.sleepiness = snap.sleepiness;
    Object.assign(this.engine, snap.engine);
    this.wheels.forEach((w, i) => {
      const o = snap.wheels[i];
      w.push.fromArray(o.push);
      w.dPrev.fromArray(o.dPrev);
      w.staticGrip = o.latch;
      w.steerAngle = o.steer;
      w.compression = o.compression;
    });
  }

  /** Whether the root `PhysicsNode` is asleep (TANK-21). */
  get asleep() { return this.law.sleepiness <= 0; }

  /** One server tick. */
  #tick() {
    const s = this.state;
    const law = this.law;
    const h = TICK;
    // A replayed tick (`rewind`) moves no servo the page draws.
    if (!this._replaying) this.advanceSurfaces(h);
    if (law.fresh) this.#settleWheels();

    // --- 1 Engine::handleUpdate ---------------------------------------------
    // The RAW player inputs, at the hundredths `PlayerAction::get` hands the
    // engine: the Engine's own RotationalBundle lives inside `EngineState`.
    // `s.surfaces` still poses the visible wheels through `applyRig`.
    const throttle = roundAxis(this.input('c_PIThrottle'));
    const yaw = roundAxis(this.input('c_PIYaw'));
    const engine = this.engine;
    engine.tick(h, throttle, yaw);
    // Each steering bundle's servo, the same tick (`calculateAndClipAngle`
    // 0x081d7490 under automaticReset): straight toward input x lock.
    for (const wheel of this.wheels) {
      if (!wheel.steered) continue;
      const want = yaw * wheel.steerSign * wheel.steerMax;
      const step = wheel.steerRate > 0 ? wheel.steerRate * h : Infinity;
      const a = wheel.steerAngle;
      wheel.steerAngle = want > a ? Math.min(want, a + step) : Math.max(want, a - step);
    }
    // Audio rpm for `.ssc` Default / Engine::Rpm: the engine's rev state.
    const wanted = Math.min(1, Math.abs(engine.revs));
    s.throttle += (wanted - s.throttle) * Math.min(1, 8 * h);

    // --- 2 performMobilePhysicsUpdate: springs, engine, root -----------------
    // Every spring copies the root's sleep before the engine can wake it, and
    // the collision pass tests a part only while its node is awake (TANK-21).
    const wheelsAwake = law.sleepiness > 0;
    const acc = law.acc;
    const racc = law.racc;
    for (const wheel of this.wheels) {
      // `D` = anchor - wheel = -push, the wheel standing where last tick's
      // `solveImpulse` left it; `Dprev` is the D of the tick before.
      const dx = -wheel.push.x, dy = -wheel.push.y, dz = -wheel.push.z;
      const px = wheel.dPrev.x, py = wheel.dPrev.y, pz = wheel.dPrev.z;
      wheel.dPrev.set(dx, dy, dz);
      if (!wheelsAwake) continue;   // asleep: D kept, no force, the wheel stays
      wheel.push.set(0, 0, 0);       // snapped back to rest
      const k = SPRING_FORCE_SCALE * wheel.strength;
      const c = wheel.damping * ENGINE_TICK_HZ;
      const a = this._force.set(
        -(k * dx + c * (dx - px)), -(k * dy + c * (dy - py)), -(k * dz + c * (dz - pz)));
      wheel.load = a.length();
      if (!(wheel.load > 0)) continue;
      acc.add(a);
      // At the anchor, the spring's rest in the hull.
      const arm = this._arm.copy(wheel.rest).applyQuaternion(s.orientation);
      racc.add(this._torque.crossVectors(arm, a));
    }
    // `PhysicsEngine::updatePhysics` 0x0824cbb0: a turning engine wakes the
    // root, then returns (a `c_ETTank` clears bit 0, TANK-7).
    if (Math.abs(engine.revs) >= ENGINE_WAKE_REVS) law.sleepiness = SLEEP_TICKS;

    // An amphibian's water half (its screw, floats, rudders) and a land hull's
    // submerged drag: accelerations in the body frame (`amphibious.js`).
    if (this.amphibious || this.water) {
      const q = this._q.copy(s.orientation);
      const qInv = this._qInv.copy(q).invert();
      const vBody = this._vBody.copy(s.velocity).applyQuaternion(qInv);
      const fBody = this._susp.set(0, 0, 0);
      const tBody = this._tanTorque.set(0, 0, 0);
      if (this.amphibious) {
        this.amphibious.step(h, { q, qInv, position: s.position, vBody, w: s.angularVelocity,
          force: fBody, torque: tBody, surfaces: s.surfaces, running: engine.running,
          inputOf: this._inputOf });
      } else {
        this.water.step({ q, position: s.position, vBody, force: fBody });
      }
      acc.add(fBody.applyQuaternion(q));
      racc.add(tBody.applyQuaternion(q));
    }

    // The root's sleep: the accumulator as it stands, then v, then omega.
    const w = s.angularVelocity;   // body rates
    if (acc.lengthSq() >= WAKE_ACC2 || s.velocity.lengthSq() >= WAKE_V2
        || w.lengthSq() >= WAKE_W2) {
      law.sleepiness = SLEEP_TICKS;
    } else if (law.sleepiness > 0) {
      law.sleepiness -= 1;
    }
    const prevX = s.position.x, prevY = s.position.y, prevZ = s.position.z;
    if (law.sleepiness <= 0) {
      s.velocity.set(0, 0, 0);
      w.set(0, 0, 0);
      this.#clearAccumulators(0);
    } else {
      this.#integrateRoot(h);
    }

    // --- 3 the collision pass -------------------------------------------------
    this.#collide(wheelsAwake);

    // Failsafe, not suspension: a hull whose origin is under the ground
    // (nothing the engine has; the page's own net under a deck or a hole)
    // is put back on it.
    const under = this.groundHeight(s.position.x, s.position.z, s.position.y);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }
    this.#sweepStatics(prevX, prevY, prevZ);
  }

  /** The root `PhysicsNode`'s step (0x082543d0): box drag, `v += acc dt`,
   * `v += fr dt`, `x += v dt`, omega from the torques over the box inertia,
   * the rows turned about omega by `|omega| dt`; then the accumulators start
   * the next tick at gravity. */
  #integrateRoot(h) {
    const s = this.state;
    const law = this.law;
    const q = this._q.copy(s.orientation);
    const qInv = this._qInv.copy(q).invert();
    const acc = law.acc;
    // The box law over the hull's own box (`addBoxDrag`, PHY-4), its moment in
    // the body frame; a tree with no geometry (a test double) keeps the
    // sphere law it always ran.
    const tDrag = this._tanForce.set(0, 0, 0);
    if (!addBoxDrag(this.geometryBox, this.drag, this.mass, s, q, qInv, acc, tDrag)) {
      const kDrag = Math.PI * this._boundingRadius * this._boundingRadius * this.drag / this.mass;
      acc.addScaledVector(s.velocity, -kDrag);
    }
    law.racc.add(tDrag.applyQuaternion(q));
    if (acc.lengthSq() > ACC_LIMIT * ACC_LIMIT) acc.setLength(ACC_LIMIT);
    s.velocity.addScaledVector(acc, h);
    if (law.fr.lengthSq() <= FR_LIMIT2) s.velocity.addScaledVector(law.fr, h);
    s.position.addScaledVector(s.velocity, h);
    const racc = law.racc;
    if (racc.lengthSq() > ACC_LIMIT * ACC_LIMIT) racc.setLength(ACC_LIMIT);
    // The roll axis takes the friction moment unguarded, pitch and yaw only
    // under the guard (the root's two sums, `Tpre` and `Tpost`).
    const tPre = this._accel.copy(racc).add(law.rfr).applyQuaternion(qInv);
    const tPost = this._gTick.copy(racc);
    if (law.rfr.lengthSq() <= RFR_LIMIT2) tPost.add(law.rfr);
    tPost.applyQuaternion(qInv);
    const w = s.angularVelocity;
    const I = this._inertia;
    w.x += tPost.x * h / I.x;
    w.y += tPost.y * h / I.y;
    w.z += tPre.z * h / I.z;
    const rate = w.length();
    if (rate * rate > 1e-6) {
      this._axis.copy(w).multiplyScalar(1 / rate);
      this._spin.setFromAxisAngle(this._axis, rate * h);
      s.orientation.multiply(this._spin).normalize();
    }
    this.#clearAccumulators(GRAVITY);
  }

  #clearAccumulators(gravity) {
    const law = this.law;
    law.acc.set(0, gravity, 0);
    law.racc.set(0, 0, 0);
    law.fr.set(0, 0, 0);
    law.rfr.set(0, 0, 0);
  }

  /** A drive that starts mid-life -- a hull just boarded off its parked body,
   * or put back on its pad -- has no last tick: every wheel is stood on the
   * push the ground already gives it, with no damper rate, which is the
   * state a resting engine hull carries (`D` steady). Without it the first
   * tick has no spring under it and the hull drops a tick of gravity onto
   * its springs. [free: the page's entry, not the engine's] */
  #settleWheels() {
    this.law.fresh = false;
    this.#standWheels(true);
  }

  /**
   * The hull was moved under the drive -- a netcode correction put the
   * server's pose back (`net-room.js` `correctDrivenHull`) -- so the push each
   * wheel holds from the last collision pass belongs to a pose the hull is no
   * longer in. Stand every wheel on the ground at the new pose, and shift its
   * `Dprev` by the same step, so the spring sees the corrected pose and its
   * damper (`D - Dprev`) no jump.
   *
   * Without it each ack's correction reached the springs as a displacement
   * made inside one tick: `c (D - Dprev) 30` read it as a closing speed the
   * hull never had, and the next ack's correction answered the bounce that
   * made. With the per-tick law exact that loop has no damping of its own: a
   * lab M3A1 replayed with the reconciler's corrections bounced 20-110 mm at
   * idle where the same run uncorrected sat within 0.02 mm, and a seated
   * Sherman "wobbled badly" live (`features/tank-ground-law`, 2026-10-22).
   * The engine has no such step: its client adopts the server's whole
   * control state, springs and accumulators with it. [free: the page's
   * delta reconciler]
   *
   * `rest`: the hull was put down whole, its velocity zeroed (a fresh seat,
   * a lost drive), so each spring takes its push with no rate.
   */
  reanchor({ rest = false } = {}) {
    // A hull put down whole has no past to rewind into.
    if (rest && this._history) this._history.length = 0;
    if (this.law.fresh) return;
    this.#standWheels(rest);
  }

  /** Each wheel's push at the present pose, from its probe (`#collide`'s). With
   * `rest`, `Dprev` is the push's own (no rate); else it moves with the push. */
  #standWheels(rest) {
    const s = this.state;
    const q = this._q.copy(s.orientation);
    const probeDown = this._dir.set(0, -1, 0).applyQuaternion(q);
    const was = this._rel;
    for (const wheel of this.wheels) {
      // A push the body world's statics gave (COL-21) is that world's to
      // re-make; the terrain's is re-stood here.
      if (!rest && wheel.staticPush) continue;
      was.copy(wheel.push);
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const vert = this._vert.copy(attach).addScaledVector(probeDown, wheel.contactDepth ?? wheel.radius);
      wheel.push.set(0, 0, 0);
      if (this.#ground(vert.x, vert.z, attach.y + DECK_STEP_UP, this._groundOut)) {
        const pen = this._groundOut.y - vert.y;
        if (pen >= 0) {
          const n = this._groundOut.n;
          wheel.push.copy(n).multiplyScalar(Math.min(PUSH_LIMIT, pen * n.lengthSq()));
        }
      }
      if (rest) wheel.dPrev.copy(wheel.push).multiplyScalar(-1);
      else wheel.dPrev.sub(was.sub(wheel.push).multiplyScalar(-1));
      wheel.compression = wheel.push.length();
    }
  }

  /** The ground under a probe: the engine's terrain (`Heightfield.engineSurface`,
   * TERR-16) where the level offers it, else the injected `groundHeight` and
   * its normal; a drivable deck above it wins. Into `out` (`y`, world normal
   * `n`); false where there is nothing. */
  #ground(x, z, fromY, out) {
    const field = this.collider?.heightfield;
    let y = -Infinity;
    if (field?.engineSurface) {
      field.engineSurface(x, z, this._surface);
      if (Number.isFinite(this._surface.y)) {
        y = this._surface.y;
        out.n.set(this._surface.nx, this._surface.ny, this._surface.nz);
      }
      const deck = this.collider.deckHeight?.(x, z, fromY);
      if (Number.isFinite(deck) && deck > y) {
        y = deck;
        surfaceNormalAt(this, x, z, fromY, out.n);
      }
    } else {
      y = this.groundHeight(x, z, fromY);
      if (Number.isFinite(y)) surfaceNormalAt(this, x, z, fromY, out.n);
    }
    out.y = y;
    return Number.isFinite(y);
  }

  /**
   * `rpm.update`'s pass over the hull's springs (0x0825d0b0): a wheel whose
   * node is awake drops its col0 vertex 0 on the ground (`checkVsTerrain`
   * 0x0825a960); in contact, `solveImpulse` moves it out along the contact
   * normal by `clamp(depth, 0, 1)` (the push the spring reads next tick) and
   * `addFriction` 0x0825b6e0 answers its tangential speed:
   *
   *   V   = v + w x (C - root) + (0, g/30, 0),  Vt = V - N (V.N)
   *   acc += -resistance Vt                                 (summed)
   *   T   = ratio diffRPM(side) along the track, tangent   (EngineGrip; 0 braking)
   *   dV  = T - Vt, clamped by the static latch to A 1.5 9.82/30 N.y (x1.5 latched)
   *   fr  = mean of 30 dV over the contacts, at the pushed contact point
   *
   * A `c_PGFRollGrip` axle asks back its speed along the axle only; a dummy
   * roller is pushed (it is drawn so) and asks for nothing.
   */
  #collide(awake) {
    const s = this.state;
    const law = this.law;
    const engine = this.engine;
    const q = this._q.copy(s.orientation);
    const qInv = this._qInv.copy(q).invert();
    const wWorld = this._wWorld.copy(s.angularVelocity).applyQuaternion(q);
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(q);
    const probeDown = this._dir.set(0, -1, 0).applyQuaternion(q);
    const ground = this._groundOut;
    const fr = law.fr, rfr = law.rfr;
    let count = 0;
    let loaded = 0;
    if (!awake) {
      // A sleeping root's parts are not tested: no contact, no friction, and
      // the latch is off; the hull still stands where it went to sleep.
      for (const wheel of this.wheels) wheel.staticGrip = false;
      s.airspeed = s.velocity.length();
      return;
    }
    for (const wheel of this.wheels) {
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const depthBelow = wheel.contactDepth ?? wheel.radius;
      const vert = this._vert.copy(attach).addScaledVector(probeDown, depthBelow);
      const fromY = attach.y + DECK_STEP_UP;
      let pen = -Infinity;
      if (this.#ground(vert.x, vert.z, fromY, ground)) pen = ground.y - vert.y;
      // The deeper of the terrain's push and the static world's (the body
      // world's `solveImpulse` on the level's statics, COL-21).
      const n = this._normal.copy(ground.n);
      let friction, resistance;
      const st = wheel.staticPush;
      const stDepth = st ? Math.hypot(st.x, st.y, st.z) : 0;
      if (st && stDepth > 0 && stDepth > Math.max(0, pen)) {
        pen = stDepth;
        n.set(st.x / stDepth, st.y / stDepth, st.z / stDepth);
        friction = st.friction;
        resistance = st.resistance;
      }
      if (!(pen >= 0)) {
        // Out of contact: the latch is left as it stands. Airborne and
        // driven, the track runs on at its commanded surface speed (`SpinWheel`
        // 0x0825b440, visual only, TANK-8).
        wheel.compression = 0;
        if (wheel.driven) wheel.angle += (engine.target(wheel.side) / wheel.radius) * TICK;
        continue;
      }
      const pushLen = Math.min(PUSH_LIMIT, pen * n.lengthSq());
      wheel.push.copy(n).multiplyScalar(pushLen);
      wheel.compression = pushLen;
      loaded += 1;
      // The contact on the ground under the probe; its speed with next
      // tick's gravity in it.
      const C = this._contact.set(vert.x, vert.y + pen, vert.z);
      const rel = this._rel.subVectors(C, s.position);
      const speed = this._u.crossVectors(wWorld, rel).add(s.velocity);
      const speed2 = speed.lengthSq();
      if (wheel.dummy) {
        wheel.angle += (speed.dot(fwd) / wheel.radius) * TICK;
        continue;
      }
      if (friction === undefined) {
        // The wheel's own material (`wheelContactDepths`, off its probe) and
        // the ground's, meaned (`impulseOn`).
        friction = 0.5 * ((wheel.materialFriction ?? WHEEL_MATERIAL_FRICTION)
          + this.surfaceFriction(vert.x, vert.z, fromY));
        resistance = 0.5 * ((wheel.materialResistance ?? WHEEL_MATERIAL_RESISTANCE)
          + this.surfaceResistance(vert.x, vert.z, fromY));
      }
      wheel.friction = friction;
      const V = speed;
      V.y += GRAVITY / ENGINE_TICK_HZ;
      const nn = n.lengthSq();
      const Vt = this._vt.copy(V).addScaledVector(n, -V.dot(n) / nn);
      if (resistance > 0) law.acc.addScaledVector(Vt, -resistance);
      // The demanded change of contact speed, one tick's worth.
      const dV = this._dv;
      let side = wheel.side;
      // The wheel's forward: `addFriction` reads its physics parent's
      // absolute row 2 (0x0825b9cf), so a spring under a steering bundle
      // drives along the bundle's posed heading, the same servo angle its
      // RollGrip axle follows (TANK-27). A driven steered wheel (the AMD35's,
      // the Humvee's four-wheel drive) asked along the hull instead fought
      // its own lock and the car would not turn.
      const wf = wheel.steered ? steeredForward(this._wheelFwd, wheel.steerAngle, q) : fwd;
      if (wheel.driven) {
        // The side as `addFriction` reads it, after the push (`contactSide`).
        side = contactSide(wheel.side === 0 ? 0 : wheel.rest.x,
          this._nBody.copy(n).applyQuaternion(qInv).x, pushLen);
        wheel.contactSide = side;
        const T = this._target.copy(wf).multiplyScalar(engine.target(side, Vt.dot(wf)));
        T.addScaledVector(n, -T.dot(n) / nn);
        dV.subVectors(T, Vt);
      } else if (wheel.grip === GRIP_ROLL || wheel.steered) {
        // RollGrip: the speed along the (steered) axle, laid in the contact
        // plane, asked back whole.
        const axle = steeredAxle(this._lat, wheel.steered ? wheel.steerAngle : 0, q);
        if (intoContactPlane(axle, n)) dV.copy(axle).multiplyScalar(-Vt.dot(axle));
        else dV.set(0, 0, 0);
      } else {
        // ContactGrip: the whole tangential speed back.
        dV.copy(Vt).multiplyScalar(-1);
      }
      // The static latch: kinetic budget `lo`, break-away `hi = 1.5 lo`.
      const lo = friction * COULOMB_LO * Math.max(0, n.y);
      const hi = 1.5 * lo;
      const m2 = dV.lengthSq();
      if (wheel.staticGrip) {
        if (m2 > hi * hi && m2 > 1.0000001e-6) {
          wheel.staticGrip = false;
          dV.multiplyScalar(Math.abs(hi) / Math.sqrt(m2));
          const m2b = dV.lengthSq();
          if (m2b > lo * lo && m2b > 1.0000001e-6) dV.multiplyScalar(Math.abs(lo) / Math.sqrt(m2b));
        }
      } else if (m2 > lo * lo && m2 > 1.0000001e-6) {
        dV.multiplyScalar(Math.abs(lo) / Math.sqrt(m2));
      } else {
        wheel.staticGrip = true;
      }
      // `feedbackLoop` 0x0824c850: the clamped change along the track, from
      // a driven wheel only (TANK-13).
      if (wheel.driven) engine.sample(dV.dot(wf));
      // Posted at the wheel as `solveImpulse` left it, plus the contact's
      // offset from it: the contact point moved out by the push.
      const f = dV.multiplyScalar(ENGINE_TICK_HZ);
      const at = this._arm.copy(C).add(wheel.push).sub(s.position);
      fr.multiplyScalar(count).add(f).multiplyScalar(1 / (count + 1));
      rfr.multiplyScalar(count).add(this._torque.crossVectors(at, f)).multiplyScalar(1 / (count + 1));
      count += 1;
      if (speed2 > CONTACT_WAKE2) law.sleepiness = SLEEP_TICKS;
      // Visual roll: a driven wheel at its own side's commanded rate (TANK-2),
      // anything else at its contact speed.
      wheel.angle += (wheel.driven ? engine.target(side) : V.dot(wf)) / wheel.radius * TICK;
    }
    // The hull's own contacts from the rigid-body solver, as samples in the
    // same mean (`hullContactFriction`); its accumulators are the body frame.
    if (this.hullContacts.length) {
      const vBody = this._vBody.copy(s.velocity).applyQuaternion(qInv);
      const gBody = this._gTick.set(0, GRAVITY / ENGINE_TICK_HZ, 0).applyQuaternion(qInv);
      const tf = this._hcForce.set(0, 0, 0), tt = this._hcTorque.set(0, 0, 0);
      const fb = this._hcRes.set(0, 0, 0);
      const added = hullContactFriction(this, s, qInv, vBody, s.angularVelocity, gBody, tf, tt, fb);
      if (added > 0) {
        fr.multiplyScalar(count).add(tf.applyQuaternion(q)).multiplyScalar(1 / (count + added));
        rfr.multiplyScalar(count).add(tt.applyQuaternion(q)).multiplyScalar(1 / (count + added));
        law.acc.add(fb.applyQuaternion(q));
        count += added;
      }
    }
    s.grounded = loaded > 0;
    s.airspeed = s.velocity.length();
  }

  /** Hull collision against static objects where the rigid-body solver does
   * not own the hull (`hullSolved`): the page's swept sphere, as
   * `GroundVehicle` has it. */
  #sweepStatics(prevX, prevY, prevZ) {
    const s = this.state;
    if (!this.collider || !(this._hullRadius > 0) || this.hullSolved) return;
    const dx = s.position.x - prevX;
    const dy = s.position.y - prevY;
    const dz = s.position.z - prevZ;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist > 1e-6)) return;
    const len = 1 / dist;
    // The deck gate, exactly as `GroundVehicle` passes it.
    const support = this.groundHeight(prevX, prevZ, prevY);
    const stepTop = Number.isFinite(support) ? support + DECK_WALL_STEP : -Infinity;
    // Barbed wire is no wall to a hull moving through it
    // (`PlayerControlObject::handleCollision` 0x08318b00 vetoes the
    // response above the handler gate, `|v|^2 > 0.1`; `obstacle.js`).
    const v2 = s.velocity.lengthSq();
    const hit = this.collider.sweepSphere(
      prevX, prevY, prevZ, dx * len, dy * len, dz * len,
      dist, this._hullRadius, this._collisionOwner, false,
      stepTop, DECK_FLOOR_COS, v2 > 0.1);
    if (!hit) return;
    const backOff = Math.max(0, hit.t - 0.02);
    s.position.x = prevX + dx * len * backOff;
    s.position.y = prevY + dy * len * backOff;
    s.position.z = prevZ + dz * len * backOff;
    const vDotN = s.velocity.x * hit.nx + s.velocity.y * hit.ny + s.velocity.z * hit.nz;
    if (vDotN < 0) {
      s.velocity.x -= vDotN * hit.nx;
      s.velocity.y -= vDotN * hit.ny;
      s.velocity.z -= vDotN * hit.nz;
    }
  }

  /**
   * A replay's recorded drive (`Vehicle.presentKinematic`): every road wheel
   * rolls at its own track's speed over its measured radius -- the hull's
   * speed along it plus the turn's share at the wheel's side (`w x r`), which
   * is how a tracked hull turns: one track faster than the other -- at rest
   * height, since nothing recorded says how far a spring is compressed.
   */
  presentKinematic(dt, throttle = 0, running = true) {
    const s = this.state;
    this._qInv.copy(s.orientation).invert();
    this._vBody.copy(s.velocity).applyQuaternion(this._qInv);
    this._u.copy(s.angularVelocity).applyQuaternion(this._qInv);
    const forward = -this._vBody.z;
    for (const wheel of this.wheels) {
      const radius = wheel.radius || this.spec.wheelRadius || 0.4;
      const along = forward + this._u.y * (wheel.rest?.x ?? 0);
      wheel.compression = 0;
      wheel.angle += (along / radius) * dt;
    }
    super.presentKinematic(dt, throttle, running);
    this.#applyWheels();
    // No engine is recorded to scroll the belts from: each runs at its side's
    // contact speed off the recorded motion (`track-scroll.js`).
    scrollBeltsByMotion(this.node, bodyMotion(s.orientation, s.velocity, s.angularVelocity), dt);
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
      wheel.staticGrip = true;
      wheel.load = 0;
      wheel.push.set(0, 0, 0);
      wheel.dPrev.set(0, 0, 0);
      wheel.node.position.copy(wheel.basePosition);
      wheel.node.quaternion.copy(wheel.baseQuaternion);
    }
    // Back to the engine's own construction state: gear 1, no revs, and the
    // gear-change lockout re-seeded at 1.0 the way a fresh `PhysicsEngine` is.
    this.engine.reset();
    this.amphibious?.reset();
    this.law.clock = 0;
    if (this._history) this._history.length = 0;
    this.law.sleepiness = SLEEP_TICKS;
    this.law.fresh = true;
    this.#clearAccumulators(GRAVITY);
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
