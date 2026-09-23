// The aircraft flight model: the per-surface lift, thrust and rigid-body
// arithmetic the retail client runs, on top of the generic `Vehicle`. Split
// out of `flight.js`, which still re-exports it.

import * as THREE from 'three';
import { Vehicle, keyOf, axisAngle } from './vehicle-base.js';
import { hullGeometry } from './ship-spec.js';

// --- flight model ----------------------------------------------------------
//
// NOT PROVISIONAL ANY MORE. Everything below is the arithmetic the retail
// client runs, read out of it function by function, driving the `.con` files'
// own per-surface numbers. There is no whole-aircraft lift slope, no commanded
// body rate, no weathervane gain and no side-drag rate: roll authority, pitch
// trim, yaw stability, aerodynamic damping and the stall all emerge from the
// surface table, which is how DICE tuned these aircraft and why the `.con`
// files contain no "roll rate" number anywhere.
//
// Addresses are the retail client catalogued in
// `features/bf1942-engine-reference` (sha256 60c9452d..., subsystem `physics`);
// `features/flyable-vehicles/flight-model.md` section 2d carries the
// reconstructions in full, with the Linux dedicated server's twins.
//
// Frame, measured off the extracted Wake scene rather than assumed: the
// Corsair's propeller sits at local z = -4.15 and its rudder at z = +2.65, and
// its left wing at x = -4.13 against the right at x = +4.16. So the vehicle's
// own frame is -Z forward, +Y up, +X starboard — the ordinary glTF convention,
// because the exporter's Z mirror has already resolved Refractor's handedness.
// Every table below is authored in *Refractor's* frame (+Z nose) so it can be
// diffed against the `.con` line by line, and mirrored on the way in.
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
/** The hinge. Every aircraft surface in vanilla swings on its local pitch axis. */
const HINGE = new THREE.Vector3(1, 0, 0);

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Gravity. NOT 9.81.
 *
 * `BasicPhysicsSystem::BasicPhysicsSystem` (client `0x00578f00`) seeds its
 * gravity field with the literal 0xC16BAE14 = -14.7295379, and nothing in a map
 * load path ever writes it again: all 31 xrefs to the singleton are accounted
 * for and the only `setGravity` callers are the chat cheats (EarthWalk -10,
 * MoonWalk -1.67, SpaceWalk -0.1) and the console property. `physics.gravity`
 * appears in no vanilla file, so the default is the value.
 *
 * Kept local on purpose. `viewer/physics.js` is growing a shared constants
 * module; when it lands this should read from it rather than declaring its own
 * g, and `gunfire.js`'s own GRAVITY with it.
 */
export const GRAVITY = 14.7295379;

/**
 * Where the air runs out. `airDensityZeroAtHeight`, +0x30 of the same
 * constructor, 1000.0 and authored by no vanilla file.
 *
 * `PhysicsWing::updatePhysics` multiplies every surface's lift by
 * `1 - clamp(y/this, 0, 1)`, so a wing makes nothing at all at 1000 m: a hard
 * service ceiling, and the only altitude effect in the model that reduces
 * anything. `PhysicsEngine::updatePhysics` reads the same number but puts it
 * somewhere else entirely — see `Aircraft.step`.
 */
const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;

/** The tail constant of `calculateLift` (client `0x008feb30`). */
const LIFT_SCALE = 0.0025;

/**
 * 1/9.82, the constant `PhysicsWing` and `PhysicsSpring` both normalise by.
 *
 * The engine multiplies authored coefficients by `getGravity() * -0.101833`,
 * which at the shipped g is a flat x1.49995. Whoever wrote it was expressing
 * "in units of gravity" against a g of 9.82 that the engine no longer runs at.
 */
const GRAVITY_NORMALISER = 0.101833;

/** Per-surface saturation, m/s^2. `PhysicsWing::updatePhysics`. */
const SURFACE_LIFT_CLAMP = 200;

/** A submerged surface makes ten times the lift. Same function. */
const SUBMERGED_MEDIUM = 10;

/** `(pi/4)`: the box drag law's faces are ellipses inscribed in them. */
const BOX_AREA = Math.PI / 4;

/** `0.1 * |throttle|`: the part of thrust that does not fade with speed. */
const ENGINE_IDLE = 0.1;

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `3.5 * setDifferential / curve`. */
const ENGINE_RATIO_SCALE = 3.5;

/**
 * The gear-ratio curve entry every aircraft samples.
 *
 * `getCurrentRatio` divides by `lerp(gearRatioCurve, (gear/numberOfGears)*100)`.
 * `Engine`'s constructor (`0x0057bc50`) writes `gear = 1` and nothing in the
 * whole binary ever writes it again — there is no gear-shifting code in the
 * retail client, only a `Gear: %d` debug readout — and no aircraft authors
 * `setNumberOfGears`, whose default is 1. So the index is 100 every time.
 *
 * `EngineTemplate`'s constructor (`0x005715d0`) hard-codes the curve as six
 * control points, (0, 1.00) (20, 3.50) (40, 2.20) (60, 1.50) (80, 1.10)
 * (100, 0.94), piecewise-linearly filled. There is no `.con` binding for it and
 * no "curve" string anywhere in the binary, so this is not overridable data.
 */
const GEAR_RATIO = 0.94;

/**
 * Sub-steps per frame, and the floor on their rate.
 *
 * The engine's own positional integrator (`0x00578aa0`, read
 * instruction-by-instruction) is semi-implicit Euler in four fixed sub-steps of
 * dt/4, so four is not a number we chose. The 240 Hz floor is: `map.html`
 * clamps `THREE.Clock` at 0.1 s, and a per-surface model is stiff — the
 * Corsair's pitch mode is near 8 rad/s — so a 0.1 s frame gets 24 sub-steps
 * rather than four long ones, and the model steps identically at 1/60, 1/30
 * and 0.1.
 */
const SUBSTEPS = 4;
const SUBSTEP_RATE = 240;

/** How fast the undercarriage takes roll out of a vehicle on its wheels. */
const GROUND_LEVEL_TAU = 0.15;

/**
 * THE lift equation, whole. `dice::ref2::world::calculateLift`, client
 * `0x0057fa90`, matched instruction-for-instruction against the Linux
 * dedicated server's `0x0824eb20`.
 *
 * ```c
 * float calculateLift(const Vec3& vel, const Vec3& surfaceUp, float coeff) {
 *     float len = |vel|;  if (len == 0) return 0;
 *     float s = clamp(dot(vel/len, surfaceUp), -1, 1);
 *     float a = asin(s) * 57.29578;                      // DEGREES
 *     float c = (fabs(a) >= 45) ? 0
 *             : (a >= 0) ? a*(45 - a)/506.25 : a*(45 + a)/506.25;
 *     return (0.75*c + 0.25*s) * len*len * coeff * 0.0025;
 * }
 * ```
 *
 * Three things in it are the whole flight model. The speed exponent is **2**,
 * not 1 — flight-model.md section 9c item 1, settled. The coefficient curve
 * peaks at exactly 1.0 at 22.5 degrees and is hard zero past +-45, which is the
 * engine's entire stall model and the reason nothing in the data declares one.
 * And the returned number is an **acceleration**: the caller hands it to
 * `addAccelerationAtAbsolutePosition`, which is why `setRegulateToLift 4.91`
 * can be compared against it directly and why it reads as g/3.
 *
 * Sign: the caller applies `-lift * surfaceUp`, so a positive return is a
 * push along -surfaceUp. Flow arriving from below a wing gives `s < 0` and
 * therefore lift upward.
 *
 * Small-angle slope, worth having for arithmetic done against this file:
 * 0.75*45/506.25 + 0.25*pi/180 = 0.07103 per degree = 4.0699 per radian.
 *
 * @param {THREE.Vector3} velocity flow at the surface, world frame
 * @param {THREE.Vector3} surfaceUp unit normal of the surface, world frame
 * @param {number} coeff (setWingLift + setFlapLift) * g/9.82
 * @returns {number} m/s^2, to be applied along -surfaceUp
 */
export function calculateLift(velocity, surfaceUp, coeff) {
  const len = velocity.length();
  if (len === 0) return 0;
  const s = clamp(velocity.dot(surfaceUp) / len, -1, 1);
  const a = Math.asin(s) * DEG;
  const c = Math.abs(a) >= 45 ? 0
    : a >= 0 ? a * (45 - a) / 506.25 : a * (45 + a) / 506.25;
  return (0.75 * c + 0.25 * s) * len * len * coeff * LIFT_SCALE;
}

/**
 * Principal inertia from the mesh bounding box and `inertiaModifier`.
 *
 * The modifier triple is [data] and is yaw/pitch/roll.
 *
 * Two laws, chosen by `spec.inertiaLaw`:
 *
 *  - `'box'` (the default, and what every aircraft in this file is calibrated
 *    against) divides by **12**: the textbook solid box. [free]
 *  - `'geometry'` divides by **3**, which is the engine's own
 *    `getGeometryInertia` (lnxded `0x08253930`, client `0x0053fc30`,
 *    collision-response.md §4.2): `Ix = (DY²+DZ²)/3`, `Iy = (DZ²+DX²)/3`,
 *    `Iz = (DX²+DY²)/3` off the object's geometry bounding box, **four times** a
 *    solid box's inertia per unit mass, and the only inertia the engine has.
 *    `rigid-body.js`'s `boxInertia` and `ground-specs.js`'s vehicle tables already use
 *    it; a ship uses it because a 115 m hull turning on a quarter of its real
 *    inertia pirouettes.
 *
 * Mass cancels out of the rotation either way — the engine's `Δω` divides a
 * per-mass torque by a per-mass inertia and `mass never enters rotation` —
 * so it is carried here only to keep `_torque = _moment * mass` unchanged.
 *
 * @param {number} mass kg
 * @param {[number, number, number]} size span (x), height (y), length (z), metres
 * @param {[number, number, number]} modifier `inertiaModifier`, yaw/pitch/roll
 * @param {'box'|'geometry'} law which divisor
 */
function boxInertia(mass, size, modifier, law = 'box') {
  const [w, h, l] = size;
  const [yaw, pitch, roll] = modifier;
  const divisor = law === 'geometry' ? 3 : 12;
  return {
    x: mass * (l * l + h * h) / divisor * pitch,
    y: mass * (w * w + l * l) / divisor * yaw,
    z: mass * (w * w + h * h) / divisor * roll,
  };
}

/**
 * One `Wing` template, as the arithmetic the engine does with it.
 *
 * Authored in Refractor's own frame (x right, y up, **z nose**) so the tables
 * below can be read against `Physics.con` and `Objects.con` line by line; the
 * constructor mirrors Z into the glb frame the extracted scenes are in, which
 * negates the rotations about X and Y and leaves the one about Z alone — the
 * same conjugation `bf42/gltf.py`'s `quat_from_ypr` applies to the meshes.
 */
class Surface {
  constructor(spec) {
    this.id = spec.id;
    const lift = (spec.wingLift || 0) + (spec.flapLift || 0);

    /**
     * `PhysicsWing::updatePhysics`, `0x0057fbf0`:
     * `coeff = (setWingLift + setFlapLift) * getGravity() * -0.101833`.
     *
     * The two authored values are **summed into one coefficient**. There is no
     * `flapLift x deflection` term anywhere in the update path — this corrects
     * flight-model.md section 4a, and it is why a rudder (`wingLift 0 /
     * flapLift 2`) and a body fin (`2 / 0`) behave identically to the force
     * term.
     */
    this.coeff = lift * GRAVITY * GRAVITY_NORMALISER;

    /**
     * ...and this is where the two values *are* told apart.
     * `Wing::handleUpdate` (Linux `0x08250950`, disassembled) poses the surface
     * at `rotateXDeg(deflection * flapLift/(wingLift + flapLift) - pitchOffset)`
     * composed with its bundle transform. So `setFlapLift` is the moving share
     * of one surface's area: a ship rudder (0/2) swings all of it, a body fin
     * (2/0) none, a Corsair elevator (0.5/0.5) half — 20 degrees of hinge is
     * ten degrees of aerodynamic angle.
     */
    this.flapShare = lift > 0 ? (spec.flapLift || 0) / lift : 0;

    /**
     * `setPitchOffset`, degrees — and it is a real rest incidence, not only the
     * regulator's reference. Same instruction: the angle handed to
     * `rotateXDeg` is the deflection term **minus** pitchOffset, at every
     * update, for every Wing. That closes flight-model.md's open question, and
     * it is what the 53-of-54 uniformity and the one deliberate 0 on the
     * Katyusha rocket's fin were always saying.
     */
    this.pitchOffset = spec.pitchOffset || 0;

    // `applyPoint = addTemplate position + setPositionOffset`, both parent
    // frame. The regulators' offsets negate their attach positions exactly, so
    // sustaining lift lands on the CoM and pitches nothing.
    const [ax, ay, az] = spec.attach || [0, 0, 0];
    const [ox, oy, oz] = spec.offset || [0, 0, 0];
    this.apply = new THREE.Vector3(ax + ox, ay + oy, -(az + oz));

    // `mountQuaternion` is the same rotation already conjugated: a spec built
    // from an extracted scene reads the node's own glb quaternion, which IS
    // `Ry(-yaw)Rx(-pitch)Rz(roll)` because `bf42/gltf.py` applied the mirror at
    // export. Spelling the Euler triple out is for the hand-written tables
    // below, which are read against `Physics.con`.
    const [yaw, pitch, roll] = spec.mount || [0, 0, 0];
    this.mount = spec.mountQuaternion
      ? new THREE.Quaternion(...spec.mountQuaternion).normalize()
      : new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-pitch * RAD, -yaw * RAD, roll * RAD, 'YXZ'));
    // The -90 roll on every rudder and vertical fin turns its lift sideways
    // through the same formula. Nothing here special-cases them.
    this.rest = this.mount.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(HINGE, this.pitchOffset * RAD));

    this.regulateToLift = spec.regulateToLift || 0;
    this.wingToRegulatorRatio = spec.wingToRegulatorRatio ?? 1;

    // Shaped exactly as a rig axis, so `advanceSurfaces` servos it and
    // `axisAngle` reads it: the physics surface and the visible node are then
    // the same state and cannot drift. A regulator takes no player input, so it
    // gets a synthetic one the `c_PI*` namespace can never collide with.
    this.axis = {
      input: spec.input || `c_Regulator:${spec.id}`,
      min: spec.min ?? 0,
      max: spec.max ?? 0,
      free: false,
      maxSpeed: spec.maxSpeed ?? 0,
      direction: spec.direction ?? 1,
      driver: 'position',
    };
    /** Filled in by the `Aircraft`, which is what knows the control name. */
    this.key = '';
  }

  /** The surface's normal in the body frame, at a hinge angle in degrees. */
  orient(deflectionDeg, out) {
    // glb rotations about the hinge are the negation of Refractor's, so the
    // engine's `deflection*flapShare - pitchOffset` comes over with its sign
    // flipped. A positive `setPitchOffset` therefore tilts the surface's normal
    // forward, which is the sign that makes incidence lift.
    return out.copy(this.mount).multiply(_hinge.setFromAxisAngle(
      HINGE, (this.pitchOffset - deflectionDeg * this.flapShare) * RAD));
  }
}

// Scratch. A per-surface model runs eight lift evaluations per sub-step and up
// to 24 sub-steps a frame, so none of this may allocate.
const _hinge = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _r = new THREE.Vector3();
const _flow = new THREE.Vector3();
const _force = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _moment = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _iw = new THREE.Vector3();
const _gyro = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _refFlow = new THREE.Vector3();
const _g1 = new THREE.Vector3();
const _g2 = new THREE.Vector3();
const _g3 = new THREE.Vector3();
const _g4 = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * The Corsair, entirely from data.
 *
 * Body from `Objects/Vehicles/Air/Corsair/Objects.con`, surfaces and engine
 * from its `Physics.con`, attach positions and mount rotations from the
 * `CorsairComplex` bundle. The only [free] number in it is `size`, which feeds
 * the solid-box inertia estimate.
 */
export const CORSAIR = {
  mass: 2500,               // [data]
  drag: 0.0652,             // linear, s^-1 — dragAccel = -drag*v [data]
  gravity: GRAVITY,
  inertiaModifier: [1.05, 0.850, 0.94],   // yaw/pitch/roll [data]
  // Mesh bounding box: span 12.5 m, height 3.1 m, length 10.2 m. [free]
  size: [12.5, 3.1, 10.2],
  // Wheels-down ride height, for the heightfield clamp.
  groundClearance: 1.2,
  // `setMaxSpeed 500` over the engine's 5000-degree accumulator is a tenth of
  // the range per second: a ten-second spool from idle to full. [data]
  throttleRate: 0.1,
  // Gear is not a player input; it retracts on altitude and engine input
  // thresholds. See input-and-cockpit.md. [data]
  gearUpAltitude: 25,
  gearDownAltitude: 23,
  engines: [
    // `CorsairEngine`, attached to `CorsairComplex` at the propeller hub — and
    // that is where its thrust is applied, not at the CoM.
    { id: 'engine', position: [0.02, 0.446, 4.149],
      differential: 5, noPropellerEffectAtSpeed: 70 },
  ],
  // id | attach | setPositionOffset | setRotation | range | maxSpeed |
  // sign(setAcceleration) | input | setWingLift | setFlapLift | setPitchOffset
  surfaces: [
    { id: 'ailL', node: 'CorsairFlapLeftOuter',
      attach: [-4.129, 0.064, 1.114], offset: [0.5, 0, -0.90], mount: [8, 0, -8.999],
      min: -30, max: 30, maxSpeed: 120, direction: -1, input: 'c_PIRoll',
      wingLift: 1.85, flapLift: 1.7, pitchOffset: 0.5 },
    { id: 'ailR', node: 'CorsairFlapRightOuter',
      attach: [4.156, 0.082, 1.124], offset: [-0.5, 0, -0.90], mount: [-8.999, 0, 8],
      min: -30, max: 30, maxSpeed: 120, direction: 1, input: 'c_PIRoll',
      wingLift: 1.85, flapLift: 1.7, pitchOffset: 0.5 },
    { id: 'elevL', node: 'CorsairFlapTailLeft',
      attach: [-1.124, 0.812, -3.539], offset: [0.5, 0, 0],
      min: -10, max: 20, maxSpeed: 60, direction: -1, input: 'c_PIPitch',
      wingLift: 0.5, flapLift: 0.5 },
    { id: 'elevR', node: 'CorsairFlapTailRight',
      attach: [1.146, 0.812, -3.539], offset: [-0.5, 0, 0],
      min: -10, max: 20, maxSpeed: 60, direction: -1, input: 'c_PIPitch',
      wingLift: 0.5, flapLift: 0.5 },
    { id: 'rud', node: 'CorsairRudder',
      attach: [0.03, 1.88, -2.649], offset: [0, -0.5, 0], mount: [0, 0, -89.999],
      min: -15, max: 15, maxSpeed: 60, direction: 1, input: 'c_PIYaw',
      wingLift: 1.0, flapLift: 1.0 },
    // The lift regulators: input-less, at the CoM, servoed against
    // `setRegulateToLift` — which is 4.91 in all 27 vanilla uses and is also
    // `WingTemplate`'s own constructor default (Linux `0x082514c0`, +0x1cc =
    // 0x409d1eb8). g/3, and a fighter carries two of the three.
    { id: 'regL', node: 'CorsairFlapLeftMiddle',
      attach: [-2.563, -0.134, 0.895], offset: [2.564, 0.135, -0.895], mount: [9, 0, -5.999],
      min: -2, max: 2, maxSpeed: 30, direction: 1,
      wingLift: 0, flapLift: 4, pitchOffset: 0.5,
      regulateToLift: 4.91, wingToRegulatorRatio: 1 },
    { id: 'regR', node: 'CorsairFlapRightMiddle',
      attach: [2.52, -0.144, 0.895], offset: [-2.52, 0.145, -0.895], mount: [-8.999, 0, 6],
      min: -2, max: 2, maxSpeed: 30, direction: 1,
      wingLift: 0, flapLift: 4, pitchOffset: 0.5,
      regulateToLift: 4.91, wingToRegulatorRatio: 1 },
    // Meshless, input-less, 0.1 m behind the CoM, mounted on its side: the
    // weathervane. A lumped model has to name a gain for this; a per-surface
    // one gets it out of `r x F` for nothing.
    { id: 'fin', node: 'CorsairBodyWingVertical',
      attach: [0, 0, 0], offset: [0, 0, -0.1], mount: [0, 0, -89.999],
      wingLift: 2, flapLift: 0 },
  ],
};

/** Physics tables by `control` name. One so far; the survey has 13. */
const SPECS = { Corsair: CORSAIR };

const _rel = new THREE.Matrix4();
const _relInv = new THREE.Matrix4();
const _relPos = new THREE.Vector3();
const _relQuat = new THREE.Quaternion();
const _relScale = new THREE.Vector3();
const _wheelBox = new THREE.Box3();

/**
 * An aircraft's own physics table, read off its extracted node tree: the
 * `CORSAIR`-shaped table built from the plane's OWN `.con` numbers.
 *
 * Until 2026-09-24 every aircraft in a level flew on `CORSAIR`: `SPECS` has
 * one entry and nothing passed a spec, so a Spitfire (tail 5.31 m aft, not
 * 3.54; elevators `0.5/0.7`, not `0.5/0.5`; ailerons `2.4/2.3`, not
 * `1.85/1.7`; regulators `flapLift 2`, not 4; `drag 0.09`, not `0.0652`;
 * `inertiaModifier 0.85/0.833/0.84`) flew as a Corsair. Ledger AI-75 has the
 * measured difference. Everything here comes from the glb, the same reading
 * `shipSpec` (ship-spec.js) makes for a hull: the root's `mass` / `drag` /
 * `inertiaModifier`, each `c_ETPlane` `Engine`'s `setDifferential` /
 * `setNoPropellerEffectAtSpeed` / rev span, each `Wing`'s lift pair, offset,
 * incidence, regulator and its own rig axis, all in the root's frame.
 *
 * Two quantities are not a `.con` field. The inertia box is the root's own
 * geometry box (`hullGeometry`), under the solid-box law every aircraft here
 * is calibrated against (the engine's `getGeometryInertia` is `/3`, four times
 * this; flight-model.md and viewer-ships §12.3 say why it stays). The ride
 * height is the lowest wheel's bottom: the `Spring`s' own meshes, in the
 * root's frame (1.39 m for the Spitfire, whose level spawn stands exactly that
 * high over the strip), else the Corsair's 1.2.
 *
 * Returns null for a root that carries no body physics or no plane engine,
 * which keeps every hand-built test aircraft on `CORSAIR`.
 */
export function aircraftSpec(root) {
  const physics = root?.userData?.physics;
  if (!physics || !(physics.mass > 0)) return null;
  root.updateWorldMatrix(true, true);
  _relInv.copy(root.matrixWorld).invert();
  const frame = node => {
    _rel.multiplyMatrices(_relInv, node.matrixWorld).decompose(_relPos, _relQuat, _relScale);
    return { position: [_relPos.x, _relPos.y, -_relPos.z], quaternion: [_relQuat.x, _relQuat.y, _relQuat.z, _relQuat.w] };
  };
  const engines = [];
  const surfaces = [];
  let throttleRate = CORSAIR.throttleRate;
  let wheelBottom = Infinity;
  root.traverse(node => {
    const data = node.userData || {};
    const part = data.physics;
    if (data.templateKind === 'Engine' && part?.engineType === 'c_ETPlane') {
      engines.push({
        id: node.name,
        engineType: part.engineType,
        position: frame(node).position,
        differential: part.differential ?? 1,
        torque: part.torque,
        noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 70,
      });
      // `setMaxSpeed` over the rev span, as `CORSAIR.throttleRate` reads it.
      const span = Math.abs(part.maxRotation?.[2] ?? 0);
      const speed = Math.abs(part.maxSpeed?.[2] ?? 0);
      if (span > 0 && speed > 0) throttleRate = speed / span;
    } else if (data.templateKind === 'Wing') {
      const axis = data.rig?.axes?.pitch;
      const f = frame(node);
      surfaces.push({
        id: node.name,
        node: node.name,
        attach: f.position,
        offset: part?.positionOffset ? [...part.positionOffset] : [0, 0, 0],
        mountQuaternion: f.quaternion,
        min: axis?.min ?? 0,
        max: axis?.max ?? 0,
        maxSpeed: axis?.maxSpeed ?? 0,
        direction: axis?.direction ?? 1,
        input: axis?.input,
        wingLift: part?.wingLift ?? 0,
        flapLift: part?.flapLift ?? 0,
        pitchOffset: part?.pitchOffset ?? 0,
        regulateToLift: part?.regulateToLift ?? 0,
        wingToRegulatorRatio: part?.wingToRegulatorRatio ?? 1,
      });
    } else if (data.templateKind === 'Spring') {
      // The wheel's own mesh: the node's, or its untagged per-material
      // children. Not the dust and splash emitters hung beneath it.
      for (const mesh of [node, ...node.children.filter(c => !c.userData?.templateKind)]) {
        if (!mesh.isMesh || !mesh.geometry || mesh.userData?.collision || /collision/i.test(mesh.name || '')) continue;
        mesh.geometry.computeBoundingBox();
        _wheelBox.copy(mesh.geometry.boundingBox).applyMatrix4(_rel.multiplyMatrices(_relInv, mesh.matrixWorld));
        wheelBottom = Math.min(wheelBottom, _wheelBox.min.y);
      }
    }
  });
  if (!engines.length) return null;
  return {
    mass: physics.mass,
    drag: physics.drag ?? CORSAIR.drag,
    dragLaw: 'box',
    gravity: GRAVITY,
    inertiaModifier: physics.inertiaModifier || [1, 1, 1],
    size: hullGeometry(root).size,
    groundClearance: Number.isFinite(wheelBottom) && wheelBottom < 0 ? -wheelBottom : CORSAIR.groundClearance,
    throttleRate,
    gearUpAltitude: CORSAIR.gearUpAltitude,
    gearDownAltitude: CORSAIR.gearDownAltitude,
    engines,
    surfaces,
  };
}

/** An aircraft: a `Vehicle` plus the model that turns inputs into state. */
export class Aircraft extends Vehicle {
  /**
   * @param {{spec?: object, modelsBase?: string, cockpit?: boolean}} [options]
   */
  constructor(node, parent, options = {}) {
    super(node, parent, options);
    // The hand table first (the Corsair's is this reader's output bar the
    // inertia box, and every flight test is calibrated on it), then the
    // aircraft's own data, then the Corsair for a tree that carries none.
    this.spec = options.spec || SPECS[this.control] || aircraftSpec(node) || CORSAIR;
    this.surfaces = this.spec.surfaces.map(spec => new Surface(spec));
    for (const surface of this.surfaces) {
      surface.key = `${keyOf(this.control, surface.axis.input)}/pitch`;
    }
    this.extraServos = this.surfaces.map(surface => [surface.key, surface.axis]);
    this._servos = null;
    this.engines = this.spec.engines.map(engine => ({
      id: engine.id,
      // `ObjectTemplate.engineType`, carried because `waterGate` splits on its
      // bit 3 and the two rules are opposites: without it a ship's screw, which
      // is authored BELOW the waterline, would take the aircraft rule and have
      // its throttle zeroed every step.
      engineType: engine.engineType ?? null,
      position: new THREE.Vector3(
        engine.position[0], engine.position[1], -engine.position[2]),
      // `getCurrentRatio` = 3.5 * setDifferential / gearRatioCurve[100].
      // `setTorque` is NOT in it: it only scales `getCurrentTorque`, whose one
      // caller in the whole binary is `feedbackLoop`, which spends it on the
      // RPM accumulator behind the engine sound.
      ratio: ENGINE_RATIO_SCALE * engine.differential / GEAR_RATIO,
      // `setTorque`, carried for the ONE thing it does to the simulation:
      // `getCurrentTorque()` divides the gearbox's load by it (TANK-13), so on
      // a vehicle whose rev state is modelled it sets the top speed. Unused by
      // an aircraft here, which has no rev state.
      torque: engine.torque,
      differential: engine.differential,
      fadeSpeed: engine.noPropellerEffectAtSpeed,
    }));
    this.inertia = boxInertia(this.spec.mass, this.spec.size,
                              this.spec.inertiaModifier, this.spec.inertiaLaw);
    this.groundHeight = () => -Infinity;
    // Below this a surface is in the water and makes ten times the lift.
    // Off by default: the page that knows where the sea is should say so.
    this.waterHeight = -Infinity;
    // Airborne-from-rest would just belly-flop; a plane parked on the strip has
    // its gear down and no airspeed, which is the honest starting state.
    this.state.inputs.set('c_PILandingGear', 0);
  }

  /** Where a surface's hinge has actually got to, degrees. */
  deflection(surface) {
    return axisAngle(surface.axis, this.state.surfaces.get(surface.key) ?? 0);
  }

  /**
   * The throttle one engine may use this step, or `null` for "no thrust".
   *
   * `PhysicsEngine::updatePhysics` tests the engine node's own world height
   * against the water level and then splits on `engineType & 8`
   * (`0x0824cc89`/`0x0824d047`). An aircraft has that bit clear, and its rule is
   * the one implemented here: **below the waterline the throttle is zeroed** —
   * a ditched plane's propeller stops pulling. A ship has it set and gets the
   * mirror, which `ship.js` overrides in.
   *
   * `waterHeight` is -Infinity until the page says where the sea is, so on a
   * land map this is never taken.
   */
  waterGate(_engine, worldY) {
    return worldY < this.waterHeight ? 0 : this.state.throttle;
  }

  /**
   * Accelerations and moments that are neither a surface's nor an engine's.
   *
   * Nothing for an aircraft: `PhysicsSpring` is stood in for by `settle` and
   * there is no third node type on a plane. A `FloatingBundle` is one
   * (`ship.js`), and so would a `LandingGear` be if it made force.
   */
  bodyForces(_accel, _moment, _h) {}

  /**
   * `Engine::handleUpdate` (`0x0823e120`), once per engine tick.
   *
   * Nothing for an aircraft. The engine runs the gearbox for every engine type
   * — the rev filter, its 1.2 clamp and the load feedback are all
   * type-independent — but `flight.js`'s aircraft model was measured and
   * calibrated against the pedal reaching the thrust law directly, so putting
   * the filter in front of it would move every number in `test_flight.py`
   * without a measurement to move them to. It is a divergence, and it is
   * written down as one in this file's header rather than fixed here.
   * `ship.js` implements it, because for a ship the load feedback IS the top
   * speed.
   */
  advanceEngines(_dt) {}

  /**
   * `PhysicsEngine::feedbackLoop` (`0x0824c850`), once per engine per thrust
   * evaluation, with `K` before the ratio.
   *
   * Nothing for an aircraft, for the same reason `advanceEngines` is nothing:
   * with no rev state there is no load to accumulate into.
   */
  noteThrust(_engine, _k, _throttle) {}

  /**
   * Body drag, added to the accumulator.
   *
   * `-drag * v`, which is what this file has always done and is **not** the
   * engine's law: `PhysicsNode` takes the box form
   * (`accel += -drag*|relV|/mass * (Ax*proj0 + Ay*proj1 + Az*proj2)`,
   * physics.md §3), quadratic in speed and area-scaled. The linear form is a
   * fitted stand-in whose coefficient came out of the Corsair's measured
   * terminal speeds, and replacing it is a flight-model job, not this stream's.
   * `ship.js` runs the box law, because a ship's terminal speed is nothing at
   * all without the submerged drag multiplier.
   */
  applyDrag(_accel, _h, _moment) {
    if (this.spec.dragLaw === 'box') { this.applyBoxDrag(_accel, _moment); return; }
    _accel.addScaledVector(this.state.velocity, -this.spec.drag);
  }

  /**
   * `PhysicsNode`'s box drag, the law every live vehicle root runs (physics.md
   * §3, ledger PHY-4; lnxded `0x08252f50` / `0x08253280`):
   *
   *   accel  += -drag |v| / mass * (Ax proj0(v) + Ay proj1(v) + Az proj2(v))
   *   angAcc += -drag |w| / mass * ((Ay+Az) proj0(w) + (Ax+Az) proj1(w) + (Ax+Ay) proj2(w))
   *
   * with `Ax = (pi/4) DY DZ` and the rest, the ellipses in the geometry box's
   * faces. The same arithmetic `ship.js` runs for a hull (there with the
   * submersion scale). An aircraft built from its own data (`aircraftSpec`)
   * takes it; `CORSAIR` keeps the fitted `-drag v`, because every flight test is
   * calibrated on it. Under the box law the four vanilla fighters whose AI
   * `maxSpeed` is 60 (Spitfire, Yak9, Zero, Mustang) top out at 57.4..59.5 m/s
   * on the deck; under `-drag v` they reached 45.5..51.3 (ledger AI-75).
   */
  applyBoxDrag(accel, moment) {
    const k = this.spec;
    const [dx, dy, dz] = k.size;
    if (!(k.drag > 0) || !(k.mass > 0)) return;
    const ax = BOX_AREA * dy * dz, ay = BOX_AREA * dx * dz, az = BOX_AREA * dx * dy;
    _qi.copy(this.state.orientation).invert();
    const v = this.state.velocity;
    const speed = v.length();
    if (speed > 1e-9) {
      _flow.copy(v).applyQuaternion(_qi);
      _force.set(_flow.x * ax, _flow.y * ay, _flow.z * az).applyQuaternion(this.state.orientation);
      accel.addScaledVector(_force, -k.drag * speed / k.mass);
    }
    if (!moment) return;
    const w = this.state.angularVelocity;
    const rate = w.length();
    if (rate < 1e-9) return;
    _flow.copy(w).applyQuaternion(_qi);
    _force.set(_flow.x * (ay + az), _flow.y * (ax + az), _flow.z * (ax + ay))
      .applyQuaternion(this.state.orientation);
    moment.addScaledVector(_force, -k.drag * rate / k.mass);
  }

  /**
   * `medium`: the one multiplier on a surface's lift.
   *
   * `1 - clamp(y/1000, 0, 1)` in air, flat 10 below the water surface. Both
   * from `PhysicsWing::updatePhysics`. The first is a hard service ceiling —
   * at 1000 m a Refractor wing makes nothing whatever — and the second is why
   * a ship's `HullWing` steers at all.
   */
  medium(y) {
    if (y < this.waterHeight) return SUBMERGED_MEDIUM;
    return 1 - clamp(y / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
  }

  /**
   * The lift regulator's servo command, once per frame.
   *
   * `PhysicsWing::updatePhysics`, the branch gated on the template's
   * regulate-enabled flag:
   *
   * ```
   * refFlow = parentForward * |v|
   * command = clamp((calculateLift(refFlow, surfaceUp, coeff)
   *                  + calculateNeutralLift(refFlow, -setPitchOffset, coeff)
   *                    * setWingToRegulatorRatio
   *                  + setRegulateToLift) * getGravity() * 0.101833, -1, +1)
   * ```
   *
   * Two things follow, and both are load-bearing. The reference flow is the
   * *body's forward axis*, not the real one — so the regulator is a
   * speed-scheduled trim device and knows nothing about angle of attack; it
   * cannot save a stalled aircraft, and it goes on making lift when the nose is
   * nowhere near the flight path. And `calculateNeutralLift` (client
   * `0x00580280`) is the surface's own undeflected lift at its authored
   * incidence, so `setWingToRegulatorRatio` is a feed-forward that discounts
   * it. Equilibrium is exactly "this surface holds `setRegulateToLift`".
   *
   * The command is an *input* in -1..1, not an angle: it lands in the same slot
   * a player input would and the ordinary +-2 degree servo chases it at
   * `setMaxSpeed 30`. So the loop is proportional, and it saturates.
   */
  regulate() {
    const s = this.state;
    const speed = s.velocity.length();
    _fwd.copy(FORWARD).applyQuaternion(s.orientation);
    _refFlow.copy(_fwd).multiplyScalar(speed);
    for (const surface of this.surfaces) {
      if (!surface.regulateToLift) continue;
      surface.orient(this.deflection(surface), _qs);
      _up.copy(UP).applyQuaternion(_qs.premultiply(s.orientation));
      const lift = calculateLift(_refFlow, _up, surface.coeff);
      _up.copy(UP).applyQuaternion(_qs.copy(surface.rest).premultiply(s.orientation));
      const neutral = calculateLift(_refFlow, _up, surface.coeff);
      this.setInput(surface.axis.input, clamp(
        (lift + neutral * surface.wingToRegulatorRatio + surface.regulateToLift)
        * -this.spec.gravity * GRAVITY_NORMALISER, -1, 1));
    }
  }

  /**
   * One step. Order matters: the regulator reads where the surfaces are, the
   * surfaces then move toward their commands, and only then does the model read
   * them — so a slammed stick still takes the config's declared time to become
   * a control moment.
   */
  integrate(dt) {
    const s = this.state;
    const k = this.spec;
    if (this.autoFirstPerson && !this.firstPerson) this.setFirstPerson(true);

    // Throttle spools rather than steps. `throttleMin` is 0 for an aircraft —
    // a propeller does not run backwards — and -1 for a ship, whose Engine
    // declares `setMinRotation 0/0/-4000` and whose `K = 0.1*|throttle| + e*|e|`
    // is signed, so a negative throttle is astern.
    const wanted = clamp(this.input('c_PIThrottle'), k.throttleMin ?? 0, 1);
    const gap = wanted - s.throttle;
    const spool = k.throttleRate * dt;
    s.throttle = Math.abs(gap) <= spool ? wanted : s.throttle + Math.sign(gap) * spool;
    // `Engine::handleUpdate`'s own slot in the tick: the gearbox runs ONCE per
    // engine tick, on the load the previous tick's `feedbackLoop` calls left,
    // and then clears that load — which is why it cannot live in `step()`
    // beside the sub-steps. Empty for an aircraft, whose throttle this file
    // has always fed to the thrust law directly; a ship's rev state is
    // `ship.js`'s (`engine-revs.js`, ledger TANK-12/TANK-13).
    this.advanceEngines(dt);
    this.advancePropeller(dt);

    const steps = Math.max(SUBSTEPS, Math.round(dt * SUBSTEP_RATE));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);
    s.airspeed = s.velocity.length();

    // Gear is automatic in the real game, on altitude thresholds.
    const floor = this.groundHeight(s.position.x, s.position.z);
    const agl = s.position.y - (Number.isFinite(floor) ? floor : 0);
    const gear = this.input('c_PILandingGear');
    if (gear < 1 && agl > k.gearUpAltitude) this.setInput('c_PILandingGear', 1);
    else if (gear > 0 && agl < k.gearDownAltitude) this.setInput('c_PILandingGear', 0);

    this.applyTransform();
    this.applyRig();
  }

  /** One sub-step of the rigid body. */
  step(h) {
    const s = this.state;
    const k = this.spec;

    // The servos run here rather than once a frame, and they have to. The
    // regulator is a proportional loop closed through a rate-limited servo, and
    // its gain is about 3: given a whole 0.1 s browser frame the servo can cross
    // its entire +-2 degree range in one step, the loop goes bang-bang, and the
    // aircraft trims somewhere else. Stepping it with the sub-step makes the
    // trim the same at 1/60, 1/30 and 0.1, which is also what the engine does —
    // `Wing::handleUpdate` and `PhysicsWing::updatePhysics` are the same tick.
    this.regulate();
    this.advanceSurfaces(h);

    _accel.set(0, 0, 0);
    _moment.set(0, 0, 0);

    // Every surface, including the ones that take no input. The fin and the
    // regulators are why an aircraft that has never touched a control still
    // weathervanes and still holds itself up.
    for (const surface of this.surfaces) {
      surface.orient(this.deflection(surface), _qs);
      _up.copy(UP).applyQuaternion(_qs.premultiply(s.orientation));
      _r.copy(surface.apply).applyQuaternion(s.orientation);
      // The flow AT THE SURFACE, not at the centre of mass. This term is the
      // whole of aerodynamic damping: a rolling aircraft gives its ailerons a
      // vertical velocity component and their own lift opposes the roll.
      _flow.copy(s.velocity).add(_arm.crossVectors(s.angularVelocity, _r));
      const lift = calculateLift(_flow, _up, surface.coeff)
        * this.medium(s.position.y + _r.y);
      const a = -clamp(lift, -SURFACE_LIFT_CLAMP, SURFACE_LIFT_CLAMP);
      _force.copy(_up).multiplyScalar(a);
      _accel.add(_force);
      // Applied at the surface's own world position, so the off-centre ones
      // make the pitch, roll and yaw moments. This is the line that replaces
      // every commanded body rate the model used to carry.
      _moment.add(_arm.crossVectors(_r, _force));
    }

    // Thrust. `PhysicsEngine::updatePhysics`, `0x0057bfb0`:
    //
    //   rho = 1 - clamp(y/airDensityZeroAtHeight, 0, 1)
    //   e   = throttle - rho*(vel . fwd)/setNoPropellerEffectAtSpeed
    //   K   = 0.1*|throttle| + e*|e|
    //   F   = fwd * K * getCurrentRatio()
    //
    // `e*|e|` is a SIGNED SQUARE, not the linear fade this file used to carry,
    // and it goes negative above the fade speed: a propeller past
    // `setNoPropellerEffectAtSpeed` is a powerful airbrake, which is what caps
    // a dive far below `g/drag`. And `rho` multiplies only the *speed* term, so
    // thrust does not fade with altitude — it grows, because a high aircraft's
    // propeller does not know how fast it is going. The 1000 m ceiling is a
    // lift ceiling only.
    _fwd.copy(FORWARD).applyQuaternion(s.orientation);
    const along = s.velocity.dot(_fwd);
    for (const engine of this.engines) {
      _r.copy(engine.position).applyQuaternion(s.orientation);
      // The water gate. `engineType` bit 3 (`c_ETShip` = 9, `c_ETTorpedo` =
      // 0x19) versus bit 3 clear (`c_ETPlane` = 1) picks opposite rules at
      // `0x0824cc89`/`0x0824d047`, and an aircraft's is "an engine under water
      // makes no thrust". `waterGate` answers for both; the default is an
      // aircraft's, so nothing here changes for one.
      const throttle = this.waterGate(engine, s.position.y + _r.y);
      if (throttle === null) continue;
      const rho = 1 - clamp((s.position.y + _r.y) / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
      const e = throttle - rho * along / engine.fadeSpeed;
      const k = ENGINE_IDLE * Math.abs(throttle) + e * Math.abs(e);
      const a = k * engine.ratio;
      // `PhysicsEngine::feedbackLoop(K*fwd, fwd)` at `0x0824cfc1`, whose one
      // effect that survives the tick is the load the gearbox reads next tick.
      // Empty for an aircraft: `flight.js` feeds the pedal straight through, so
      // there is no rev state for a load to pull down.
      this.noteThrust(engine, k, throttle);
      _force.copy(_fwd).multiplyScalar(a);
      _accel.add(_force);
      // At the engine node, not the centre of mass — a nacelle 0.45 m above the
      // CoM and four nacelles out on a B17's wings.
      _moment.add(_arm.crossVectors(_r, _force));
    }

    // Anything the body carries that is neither a surface nor an engine. Empty
    // for an aircraft; a ship's eight `FloatingBundle`s are here, and because
    // they land in `_moment` as well their differing depths are what rights the
    // hull (`ship.js`).
    this.bodyForces(_accel, _moment, h);

    _accel.y -= k.gravity;
    this.applyDrag(_accel, h, _moment);

    // Angular, in the body frame, which is the only one the inertia tensor is
    // diagonal in. The gyroscopic term matters here: a Corsair's yaw inertia is
    // nearly three times its pitch one.
    _qi.copy(s.orientation).invert();
    _torque.copy(_moment).applyQuaternion(_qi).multiplyScalar(k.mass);
    _omega.copy(s.angularVelocity).applyQuaternion(_qi);
    const I = this.inertia;
    _iw.set(I.x * _omega.x, I.y * _omega.y, I.z * _omega.z);
    _gyro.crossVectors(_omega, _iw);
    _omega.x += (_torque.x - _gyro.x) / I.x * h;
    _omega.y += (_torque.y - _gyro.y) / I.y * h;
    _omega.z += (_torque.z - _gyro.z) / I.z * h;
    const rate = _omega.length();
    if (rate > 1e-9) {
      _axis.copy(_omega).divideScalar(rate);
      s.orientation.multiply(_spin.setFromAxisAngle(_axis, rate * h)).normalize();
    }
    s.angularVelocity.copy(_omega).applyQuaternion(s.orientation);

    s.velocity.addScaledVector(_accel, h);
    s.position.addScaledVector(s.velocity, h);

    // Ground. Real collision against buildings is a separate problem; this is
    // only the heightfield and the sea, so the plane cannot fall through Wake.
    const floor = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(floor) && s.position.y < floor + k.groundClearance) {
      s.position.y = floor + k.groundClearance;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
      this.settle(h);
    } else {
      s.grounded = false;
    }
  }

  /**
   * What the undercarriage does that the aerodynamics cannot.
   *
   * Refractor stands a parked aircraft on three `Spring` wheels
   * (`CorsairWheelLeft`, `setStrength 24 / setDamping 12`, through
   * `PhysicsSpring::updatePhysics` at `0x0057f0d0`); modelling those is a
   * separate job — flight-model.md section 7 item 6. Two of their effects are
   * load-bearing for a takeoff and are stood in for here: the wheels hold the
   * wings level, and they stop the nose digging into the strip.
   *
   * Pitch-*up* is left entirely alone, and deliberately: rotation is the
   * aircraft turning about its main wheels under elevator authority, and a
   * ground constraint that damped it would mean an aircraft that can never
   * leave the ground.
   */
  settle(h) {
    const s = this.state;
    _g1.copy(FORWARD).applyQuaternion(s.orientation);
    const digging = _g1.y < 0;
    if (digging) _g1.y = 0;
    if (_g1.lengthSq() < 1e-9) return;
    _g1.normalize();
    _g2.crossVectors(_g1, UP);
    if (_g2.lengthSq() < 1e-6) return;
    _g2.normalize();
    _g3.crossVectors(_g2, _g1).normalize();
    _basis.makeBasis(_g2, _g3, _g4.copy(_g1).negate());
    _qs.setFromRotationMatrix(_basis);
    s.orientation.slerp(_qs, 1 - Math.exp(-h / GROUND_LEVEL_TAU));

    _qi.copy(s.orientation).invert();
    _omega.copy(s.angularVelocity).applyQuaternion(_qi);
    _omega.z *= Math.exp(-h / GROUND_LEVEL_TAU);
    if (digging && _omega.x < 0) _omega.x = 0;
    s.angularVelocity.copy(_omega).applyQuaternion(s.orientation);
  }

  /** Park the aircraft on the strip at its spawn, nose level, and step out. */
  reset() {
    if (this.autoFirstPerson) this.setFirstPerson(false);
    const s = this.state;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.throttle = 0;
    s.airspeed = 0;
    s.propellerAngle = 0;
    s.propRpm = 0;
    s.surfaces.clear();
    s.inputs.clear();
    s.inputs.set('c_PILandingGear', 0);
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
