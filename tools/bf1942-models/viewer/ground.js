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

// --- Coulomb friction, PHY-2 ------------------------------------------------
//
// `ResponsePhysics::addFriction` lnxded `0x0825b6e0` spends a per-tick
// tangential velocity budget, with no force and no mass anywhere in it:
//
//   limKinetic = A * 1.50 * 9.82 * L / 30      m/s of delta-v, one 30 Hz tick
//   limStatic  = 1.50 * limKinetic  =  A * 2.25 * 9.82 * L / 30
//
// read from `0x086be4d0` (1.5), `0x086d16e0` (2.25), `0x086d16e4` (9.82) and
// `0x08716b5c` (30), formed at `0x0825b7c9`. `1.5 * 9.82` is 14.73, which is
// the shipped gravity — so as an acceleration the kinetic budget is exactly
// `A * |g| * L` and the static one is half again.
//
// L, and this was the round's one open disagreement: it is the **y of the
// averaged contact normal**, `ResponsePhysics+0x6c`. Settled here by reading
// `impulseOn` `0x08258900`, whose tail at `0x08258a6a`-`0x08258abb` maintains
// `+0x68` as a running mean of its third Vec3 argument (the contact normal)
// — `mean = (mean*count + n)/(count+1)`, count at `+0xa4` — while `posAdjust`
// lives at `+0x14` and `speedAdjust` at `+0x2c`. There is no impulse
// accumulator at `+0x68`. `addFriction`'s branch at `0x0825b7a2` sends a
// `CID_BFSoldierTemplate` object to `0x0825c63e`, which points the load read
// at `+0x98` instead; everything else, a vehicle part included, falls through
// to `0x0825b7ae` and reads `+0x68`.
//
// A is NOT the surface's own coefficient: `impulseOn`'s tail
// (`0x08258b6a`-`0x08258ba0`) stores `0.5 * (friction(matA) + friction(matB))`
// into `+0xa8`. A wheel on grass runs at `0.5*(1.0 + 0.8) = 0.9`.
const COULOMB_SLIDING = 1.50;
const COULOMB_BREAKAWAY = 2.25;
const COULOMB_GRAVITY = 9.82;

/**
 * Above this speed the parking hold below has faded to nothing, and the
 * fitted coast model has the wheel to itself. Purely the viewer's, and a
 * fade rather than a step so there is no discontinuity to drive through.
 * [free, numerics]
 */
const PARKING_HOLD_SPEED = 3.0;

/**
 * The engine's simulation tick, `0x08716b5c`. It appears twice in the
 * friction solver: once dividing the budget into a per-tick velocity step,
 * and once multiplying the wanted velocity change back into an acceleration
 * (`addFrictionAtAbsolutePosition(F * 30)`). So a grip mode that asks for a
 * velocity change of `dV` is asking for `dV * 30` m/s^2, and the Coulomb
 * clamp is what decides how much of that the ground can actually answer.
 *
 * Where a grip mode asks for a whole velocity back **this tick**, the 30 is
 * `1/dt` and not a number — this file substeps at `h <= 1/60`, so the faithful
 * translation of "all of it, this tick" is `1/h`, and that is what the parking
 * holds below spend. Writing 30 there instead asked for half the correction
 * the engine asks for and left a parked M3A1 creeping at 0.054 m/s; with `1/h`
 * it is 0.014 (a residual the file's other comment explains). The constant
 * stays here because the *budget* side of the solver really is a fixed 30.
 */
const ENGINE_TICK_HZ = 30;

/**
 * `MaterialManager.materialFriction` for a contact surface the level does not
 * name. An id the define file never mentions falls back to material 0, which
 * vanilla authors at 1.0, and that is also the `Material` constructor's own
 * default — so every path lands on the same number.
 */
export const DEFAULT_MATERIAL_FRICTION = 1.0;

/**
 * The wheel's own side of the pair. A Willy's wheels are material 37 and a
 * tank's road wheels 38 / 178; vanilla defines none of them, so all three fall
 * back to material 0 at 1.0 (collision-response.md section 9.4). Mods that
 * define them would change this, which is why it is a named constant and not
 * an inlined 1.
 */
const WHEEL_MATERIAL_FRICTION = 1.0;

/**
 * The two caps a contact is tested against, as accelerations rather than as
 * per-tick velocity steps — the viewer integrates at its own rate, and
 * `1.5 * 9.82 / 14.73` is exactly 1, so the kinetic cap really is `A * load`.
 *
 * `load` stands in for the engine's `|g| * L`: the viewer's per-wheel spring
 * loads sum to `|g|` when the vehicle is standing, so summed over the
 * contacts the budget is the engine's whole-vehicle one. **Approximation,
 * named:** the engine takes a mean over touching parts of one normal's y and
 * the viewer distributes the same total by spring load, so the two agree on
 * flat ground and diverge on a slope, where the viewer's split follows the
 * suspension rather than a single averaged normal.
 */
function coulombCaps(friction, load) {
  const g = -GRAVITY;
  const kinetic = friction * (COULOMB_SLIDING * COULOMB_GRAVITY / g) * load;
  const breakaway = friction * (COULOMB_BREAKAWAY * COULOMB_GRAVITY / g) * load;
  return { kinetic, breakaway };
}

/**
 * Clamp a tangential demand into the Coulomb budget, with the engine's
 * **state-dependent hysteresis** — not two passes, the two arms of one branch
 * (`0x0825bb72 mov dl,[esi+0xb4]; test dl,dl; jns 0x0825bebc`):
 *
 *   latched static  |demand| > breakaway -> latch breaks, scale to kinetic
 *                   otherwise            -> apply in full, up to 1.5x kinetic
 *   not latched     |demand| > kinetic   -> scale to kinetic, stay sliding
 *                   otherwise            -> the latch sets
 *
 * The clamp is **isotropic on the tangential plane** — a vector scale and
 * nothing more. There is no slip-angle curve anywhere in the engine, and no
 * separate lateral coefficient; where this file keeps either, it says so.
 *
 * @returns {{scale: number, latched: boolean}} the factor to apply to both
 *   components of the demand, and the latch state for the next tick
 */
// --- the spring, PHY-5 -------------------------------------------------------
//
// `PhysicsSpring::updatePhysics(float dt)` lnxded `0x0824ddd0` / client
// `0x0057f0d0`:
//
//   anchor = parentPos + rot(parentTransform) * offset
//   D      = anchor - wheel.getAbsolutePosition()
//   accel  = -( strength * g * (-1/9.82) * D  +  damping * (D - D_prev) / dt )
//   root->addAccelerationAtRelativePosition(anchor - rootPos, accel)
//
// Two things in that are worth having and one is worth not pretending to.
//
// WORTH HAVING. `g * (-1/9.82)` makes the sag gravity-invariant, and at the
// shipped `g = -14.73` it is exactly **1.5** — so every spring in the game
// acts at one and a half times the `setStrength` its `.con` file reads.
// `bf42/con.py` deliberately exports the authored number and leaves the law
// to the runtime; this file is that runtime. And `D_prev` is a **one-tick
// backward difference of the displacement**, not a node velocity, so the
// damper answers how fast the spring is being compressed rather than how fast
// its mounting point happens to be moving through the world.
//
// ALSO WORTH HAVING: the axis. `SpringTemplate`'s constructor writes
// `axisFixation = (0, 1, 0)` at `+0x15c` (`0x0824fc50` loads 1.0f into ecx,
// `0x0824fc89`/`0x0824fc92`/`0x0824fc95` store 0/1/0), `setAxisFixation` is
// the only thing that could change it, and **no `.con` in any of the 18
// installed mods authors it** — surveyed, zero hits, `setPositionalFixation`
// likewise. So every spring everywhere runs on the object's own +Y, which is
// the HULL's up and leans with it, never the world's. (The ctor's other
// defaults, for the record: strength `+0x16c` 1.0, damping `+0x168` 0.5.)
//
// WORTH NOT PRETENDING TO: **there is no ray.** A wheel is a collision body
// and its contacts come from its own mesh vertices through
// `ResponsePhysics::checkVsTerrain` `0x0825a960`; the binary's only
// line-versus-triangle routine has two callers and both are AI pathfinding.
// What follows below is a probe down the spring axis against a height
// function, which is what this viewer can afford — an approximation OF a
// vertex-contact solver, not a reconstruction of one. Nobody should go
// looking for "the engine's ray" on the strength of it.
const SPRING_AXIS_Y = 1.0;

/**
 * `strength * g * (-1/9.82)`: 1.5 at the shipped gravity, and derived from
 * `GRAVITY` rather than written as 1.5 so it stays gravity-invariant exactly
 * the way the engine's own expression does.
 */
const SPRING_GRAVITY_SCALE = GRAVITY * (-1 / 9.82);

/**
 * Below this much of the spring axis pointing at the ground, the probe below
 * is asked to divide by nearly nothing and its Newton step runs away. A hull
 * that far over is not driving anyway, so it falls back to a vertical drop.
 * Numerics, not engine. [free]
 */
const SPRING_AXIS_FLOOR = 0.2;

/**
 * What a latched static contact really is: a **velocity constraint**, not a
 * force. `collision-response.md` section 8's "latched static: F = dV in full"
 * cancels the whole tangential velocity every tick and keeps cancelling
 * whatever is re-injected, so a parked vehicle in the engine does not creep.
 *
 * The per-wheel parking hold in the loops above cannot do that on its own: it
 * is a velocity-proportional force answering a constant one (PHY-5 leans the
 * spring axis with the hull, so a hull on its static rake pushes itself
 * along), and it settles where the two balance rather than at zero. On flat
 * analytic ground the residual is 5 mm of drift over ten parked seconds; on
 * Wake's real terrain, where the rake is bigger, it was 0.74 m for a jeep and
 * 0.30 m for a Sherman — visible wandering, against a main checkout that does
 * not move at all.
 *
 * So the constraint is applied where it belongs: after the forces are summed,
 * on a hull that is stopped, idle and standing entirely on latched contacts,
 * the **horizontal** acceleration and velocity are zeroed — but only while the
 * demand fits inside the summed break-away budget, which is what keeps this a
 * Coulomb result rather than glue. Past that budget (a slope steeper than
 * `atan(mu)`) it lets go and slides, exactly as the engine's latch does.
 *
 * Vertical motion is untouched: a hull still settles on its springs, and
 * anything that lifts a wheel clears its latch and so this hold with it.
 */
const STATIC_HOLD_SPEED = 0.35;

/**
 * And it waits for the hull to stop turning as well as stop moving. A vehicle
 * settling onto a slope pitches and slides at the same time, and freezing the
 * slide while the pitch is still coming round leaves it sitting a degree or so
 * off the ground it is standing on. [free, numerics]
 */
const STATIC_HOLD_SPIN = 0.05;

/**
 * And it waits for the springs to stop moving. A hull dropped onto a slope
 * settles by pitching and sliding together, and its velocity passes through
 * small values on the way; the thing that separates "still settling" from
 * "parked" is whether the suspension is still travelling. Holding before it
 * has stopped leaves a jeep sitting a degree and a quarter off the slope it is
 * standing on, which is exactly what this threshold was added to stop.
 * [free, numerics]
 */
const STATIC_HOLD_SETTLE = 0.02;

const STATIC_HOLD_DWELL = 1.0;

function staticHold(vehicle, s, accel, h, drive, braking, loaded, budget,
    allLatched, springRate) {
  const quiet = loaded && allLatched && budget > 0
    && drive === 0 && braking === 0
    && springRate <= STATIC_HOLD_SETTLE
    && s.velocity.lengthSq() <= STATIC_HOLD_SPEED * STATIC_HOLD_SPEED
    && s.angularVelocity.lengthSq() <= STATIC_HOLD_SPIN * STATIC_HOLD_SPIN;
  // A hull dropped onto a slope crosses every one of those thresholds
  // transiently on the way down, so the hold waits for them to hold together
  // for a whole second before it takes effect. A genuinely parked vehicle
  // passes that in a second; a settling one never does.
  vehicle._staticQuiet = quiet ? (vehicle._staticQuiet ?? 0) + h : 0;
  if (vehicle._staticQuiet < STATIC_HOLD_DWELL) return false;
  // What the contacts are being asked to hold, this substep: the horizontal
  // acceleration plus the horizontal velocity already on the hull, expressed
  // as one acceleration so both are measured against the same budget.
  const ax = accel.x + s.velocity.x / h;
  const az = accel.z + s.velocity.z / h;
  if (Math.hypot(ax, az) > budget) return false;
  accel.x = 0;
  accel.z = 0;
  s.velocity.x = 0;
  s.velocity.z = 0;
  return true;
}

function coulombClamp(demand, caps, latched) {
  if (latched) {
    if (demand > caps.breakaway && demand > 1e-9) {
      return { scale: caps.kinetic / demand, latched: false };
    }
    return { scale: 1, latched: true };
  }
  if (demand > caps.kinetic && demand > 1e-9) {
    return { scale: caps.kinetic / demand, latched: false };
  }
  return { scale: 1, latched: true };
}

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
  // what the game *authors* about the gearbox — but it is no longer the whole
  // of what the game knows, because the ratio ladder is a curve compiled into
  // `EngineTemplate`'s constructor rather than a `.con` word (TANK-3). See
  // `GEAR_RATIO_CURVE` and `gearLadder`. [data]
  numberOfGears: 5,
  gearUp: 0.95,
  gearDown: 0.4,
  // There is no `gearRatios`, no `reverseRatio` and no `revLimit` here any
  // more. All three were inventions and all three are now derived (TANK-3,
  // TANK-9):
  //
  //   the ladder      `gearLadder(differential, numberOfGears)` — the engine's
  //                   own `getCurrentRatio()` per gear, for any gear count.
  //   reverse         gear 1's ratio, which is what `reverseRatio 3.8` was
  //                   standing in for (it equalled `gearRatios[0]`).
  //   the rev ceiling  revs are a fraction of full, and the road speed a gear
  //                   reaches at a given rev fraction is the engine's own
  //                   EngineGrip target, `ratio * revs`. Full is not 1:
  //                   `Engine::handleUpdate` clamps revs to
  //                   `ENGINE_REV_CEILING` (1.2), so top gear tops out at
  //                   `1.2 * ladder[top]`. `revLimit 356` was fitted to put
  //                   that at 18.5 m/s; the read relation puts it at 31.3 and
  //                   owes nothing to a fit.
  //
  // Torque still fades linearly over the last (1 - gearUp) of the rev range so
  // that top speed is an equilibrium rather than a wall. That shape is still a
  // viewer choice; its endpoints are now both data. [free, shape only]
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
  // There is no `mu` here any more. The coefficient is material data (PHY-2):
  // `0.5 * (materialFriction[wheel] + materialFriction[ground])`, looked up
  // per wheel through the `surfaceFriction` the page injects. A jeep runs at
  // 0.9 on grass, 0.75 in mud, 1.05 on a paved road and 0.55 in water,
  // instead of at a flat fitted 1.0 everywhere — and it breaks away at 1.5x
  // that before it starts sliding. `DEFAULT_MATERIAL_FRICTION` is what a
  // level with no material map falls back to, which is also what the old
  // constant happened to be.
  //
  // Lateral force per radian of slip, per unit of that wheel's normal load,
  // saturating against the Coulomb cap at about 8 degrees of slip.
  // **INVENTION, and now known to be one.** The engine has no slip-angle
  // curve anywhere: its clamp is a plain isotropic vector scale on the
  // tangential plane, and a rolling wheel only ever asks for lateral
  // correction in the first place. This is kept because it is what gives the
  // jeep a steering feel a player can drive, not because anything backs it.
  // [free, invented]
  corneringStiffness: 7,
  // How much of the Coulomb budget the lateral axis may reach, the same
  // invented anisotropy the tracked class carries and for a sharper reason
  // here. `corneringStiffness` above was fitted against a flat isotropic
  // `mu * load` circle with no hysteresis; PHY-2's 1.5:1 break-away raised
  // the ceiling a *latched* wheel may pull by half, and the jeep promptly
  // rolled itself onto its roof at full lock (89 degrees, from 12). 1/1.5
  // puts the break-away ceiling back exactly where the fitted circle was and
  // leaves the sliding ceiling below it — so the hysteresis is observable in
  // the direction the invented stiffness does not dominate (traction) and
  // neutral in the one where it does. Re-fitting the stiffness instead would
  // have hidden the change inside another free number. [free, invented]
  lateralGripFraction: 1 / 1.5,
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

  // s^-1 ease on the audio rpm written to `state.throttle` (gearbox revs /
  // pedal floor) — the drive itself answers the pedal at once. [free]
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
    /** The live half of `ResponsePhysics`'s grip byte `+0xb4`: bit 0x80, the
     * static latch. A parked vehicle stands on latched contacts (a parked
     * aircraft is the engine's own worked example), so it starts set. */
    this.staticGrip = true;
    /** The material coefficient this wheel last found under itself, kept for
     * the harness to read. `0.5 * (wheel + ground)`, PHY-2. */
    this.friction = DEFAULT_MATERIAL_FRICTION;
    /** `D_prev`: last tick's compression along the spring axis, so the damper
     * is the engine's one-tick backward difference of the displacement
     * (PHY-5) rather than the attach point's world-vertical velocity. `null`
     * means the wheel was not in contact last tick — the engine never needs
     * that case because its wheel is a body whose displacement is continuous,
     * while a probe's compression jumps from nothing to its full depth in one
     * step and a backward difference against zero reads that as tens of
     * metres a second. The first contact tick therefore takes its rate from
     * the axle's own closing speed along the spring axis instead, which is
     * what a continuous displacement would have been changing at. It is NOT
     * zeroed: this flag is cleared on every airborne tick, so zeroing it
     * turned the damper off for a tick every time a wheel re-landed — 3 % of
     * a jeep's contacts and 8 % of a half-track's over rough ground, i.e.
     * exactly when the damper matters. [free, numerics] */
    this.prevCompression = null;
  }
}

/**
 * How far it is from `attach` to the ground **down the spring axis**, rather
 * than straight down the world's Y. The two differ by `1/cos(lean)`, so a
 * hull at 20 degrees was reading its wheels 6 % too shallow before.
 *
 * One Newton step off the vertical estimate is enough: the heightfield is a
 * 4 m lattice and the correction is second order in the lean.
 *
 * @returns {number} metres along the axis, or Infinity where there is no
 *   ground under it at all
 */
function probeAlongAxis(groundHeight, attach, axisWorld) {
  const floor = groundHeight(attach.x, attach.z);
  if (!Number.isFinite(floor)) return Infinity;
  const drop = attach.y - floor;
  if (axisWorld.y <= SPRING_AXIS_FLOOR) return drop;
  let t = drop / axisWorld.y;
  const px = attach.x - axisWorld.x * t;
  const pz = attach.z - axisWorld.z * t;
  const under = groundHeight(px, pz);
  if (!Number.isFinite(under)) return t;
  return t + (attach.y - axisWorld.y * t - under) / axisWorld.y;
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
    /**
     * `MaterialManager.materialFriction` of the ground under a world (x, z),
     * injected exactly the way `groundHeight` is so this module still runs
     * under node with no collider and no textures. The page builds it from
     * the level's own `terrain/materials.png` and `_shared/damage.json`; a
     * test passes a constant or a stripe. PHY-2.
     */
    this.surfaceFriction = options.surfaceFriction || (() => DEFAULT_MATERIAL_FRICTION);

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
    /** Engine speed as a fraction of full, 0..1 — the quantity `setGearUp`
     * and `setGearDown` are fractions *of*, and the same normalised rev the
     * engine's own torque curve is indexed by (TANK-4). It used to be rad/s
     * against a fitted `revLimit`. */
    this.revs = 0;
    this.collectChassis();

    /** `getCurrentRatio()` for gear 1..numberOfGears (TANK-3), built from the
     * engine's own compiled curve rather than an authored ladder — because
     * there is no authored ladder. Willy (`differential 7`, `numberOfGears 5`)
     * comes out 7.000 / 11.136 / 16.333 / 22.273 / 26.064. Any gear count gets
     * a real ratio, and above five gears the ladder is **not monotonic**; see
     * `gearLadder`. */
    this.ladder = gearLadder(this.engine.differential, this.engine.numberOfGears);

    // Hull collision against static objects (buildings, walls, other vehicles).
    // `k.boundingRadius` is the same value the drag equation uses — large enough
    // to keep the body off a wall without catching on every kerb. The owner id
    // is the collision index's slot for this vehicle's own hull, which must be
    // skipped in the sweep or the vehicle collides with itself.
    this._hullRadius = this.spec.boundingRadius;
    this._collisionOwner = this.collider?.statics?.ownerOf(node) ?? -1;

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
   * `setGearUp 0.95` / `setGearDown 0.4` are fractions of maximum revs, and
   * revs are a fraction outright, so both read literally. The road speed a
   * gear reaches at a rev fraction is the engine's own EngineGrip target for
   * that gear, `ratio * revs` (TANK-9 as corrected) — and revs runs to
   * `ENGINE_REV_CEILING` = 1.2, not 1, so Willy's five gears top out at
   * 8.40 / 13.36 / 19.60 / 26.73 / 31.28 m/s. The automatic's hysteresis
   * still works out: an upshift at 0.95 lands the next gear at 0.60-0.81,
   * well above the 0.4 downshift line, so the box never hunts.
   *
   * THE TRAP, and it is the easy bug in this file (TANK-3): there are two
   * ladders and they run in opposite directions.
   *
   *   `getCurrentRatio()` RISES with gear — Willy 7.00 -> 26.06. It is a
   *   *speed* multiplier: the engine's surface-speed target, and the thing
   *   `bodyThrust` scales.
   *
   *   the DRIVE share falls with gear — 1.000 / 0.629 / 0.429 / 0.314 / 0.269
   *   for any five-speed. It is the curve *sample* normalised to first gear,
   *   `ladder[0] / ladder[g-1]`, and it is what the deleted `gearRatios`
   *   ladder (3.8 / 2.6 / 1.8 / 1.25 / 1.0, normalised 1.000 / 0.684 / 0.474 /
   *   0.329 / 0.263) was an eyeballed approximation of.
   *
   * Drive per gear is `setTorque` at its share, shaped by the engine's own
   * torque curve (TANK-4, peak at 60 % revs, 0.70 at both ends) and faded over
   * the last five percent of the rev range so top speed is an equilibrium.
   */
  #drivetrain(speed, reverse) {
    const e = this.engine;
    const ladder = this.ladder;
    const top = ladder.length;
    // The EngineGrip target for a gear is `ratio * revs`, so the rev fraction
    // is simply road speed over the ratio — capped at the engine's own
    // ceiling rather than at 1.
    // Reverse runs against the clamp's other arm, which is NOT symmetric:
    // `Engine::handleUpdate` floors revs at -1.0 and ceils them at +1.2, so
    // reverse in first is 1/1.2 of forward in first, by the engine's own
    // arithmetic rather than by a separate `reverseRatio`.
    const ceiling = reverse ? ENGINE_REV_FLOOR : ENGINE_REV_CEILING;
    const revsIn = ratio => Math.min(ceiling, speed / Math.max(1e-6, ratio));
    if (reverse) {
      // Reverse borrows first gear, which is what the deleted `reverseRatio`
      // did — it was authored equal to `gearRatios[0]`.
      this.gear = 1;
      this.revs = revsIn(ladder[0]);
    } else {
      this.revs = revsIn(ladder[this.gear - 1]);
      if (this.gear < top && this.revs > e.gearUp) this.gear += 1;
      else if (this.gear > 1 && this.revs < e.gearDown) this.gear -= 1;
      this.revs = revsIn(ladder[this.gear - 1]);
    }
    const share = ladder[0] / ladder[this.gear - 1];
    const span = Math.max(1e-6, ceiling - e.gearUp);
    const fade = Math.max(0, Math.min(1, (ceiling - this.revs) / span));
    return e.torque * share * engineTorqueFraction(this.revs) * fade;
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
      this.#drivetrain(Math.abs(vf), false);
    } else if (cmd < -0.01 && vf > k.reverseBelow) {
      braking = -cmd;
      this.#drivetrain(Math.abs(vf), true);
    } else if (Math.abs(cmd) > 0.01) {
      reverse = cmd < 0;
      drive = this.#drivetrain(Math.abs(vf), reverse) * Math.abs(cmd);
    } else {
      this.#drivetrain(Math.abs(vf), vf < 0);
    }

    // `state.throttle` is what map.html feeds as Engine::Rpm / `.ssc` Default.
    // A car's Engine roll snaps to the pedal in <0.1 s (Willy: maxSpeed 55000
    // over ±5000), so pedal alone is a step; gearbox revs are what climb and
    // drop through the gears. A fading pedal floor covers the stationary
    // blip where road speed is still zero.
    const revRpm = Math.min(1, Math.max(0, this.revs));
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
    const steer = -steerInput * k.maxSteer * DEG;

    // --- wheels ---------------------------------------------------------------
    const force = this._force.set(0, 0, 0);      // body frame, per mass
    const torque = this._torque.set(0, 0, 0);    // body frame
    let loaded = 0;
    // `staticHold`'s two inputs: the summed break-away budget of the contacts
    // and whether every one of them is latched.
    let staticBudget = 0;
    let allLatched = true;
    let springRate = 0;

    // Per-wheel drive and brake are found before the loop so the friction
    // circle can be applied per contact: total demand, split over the axle by
    // its live load, each wheel capped by mu times what it is carrying.
    const drivenCount = this.wheels.filter(x => x.driven).length || 1;
    // Slip authority fades in below walking pace — see `slipFloor`.
    const speed = s.velocity.length();
    const authority = Math.min(1, speed / 2);

    // The spring axis, world frame. `(0, 1, 0)` in the HULL's frame — the
    // constructor's own `axisFixation`, which nothing authors over (PHY-5) —
    // so it leans with the body instead of standing world-vertical.
    const axisWorld = this._axis.set(0, SPRING_AXIS_Y, 0).applyQuaternion(q);

    for (const wheel of this.wheels) {
      // Where the axle is, and how far the ground is DOWN THE SPRING AXIS.
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const reach = probeAlongAxis(this.groundHeight, attach, axisWorld);
      const compression = Number.isFinite(reach) ? k.wheelRadius - reach : -Infinity;
      if (compression <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        wheel.prevCompression = null;
        // No contact this tick clears the static latch (`0x0825b76b`).
        wheel.staticGrip = false;
        // An airborne driven wheel spins against nothing — at the surface
        // speed the engine is commanding for this gear (TANK-9's EngineGrip
        // target), over the wheel's own radius.
        if (wheel.driven && drive !== 0) {
          // Unloaded, the rev filter pins at the ceiling, so an airborne
          // driven wheel spins at the redline surface speed for this gear.
          const commanded = ENGINE_REV_CEILING * this.ladder[this.gear - 1];
          wheel.angle += (reverse ? -1 : 1) * (commanded / k.wheelRadius) * h;
        }
        continue;
      }

      // Contact-patch velocity in the body frame. Hoisted above the spring
      // because the damper's first tick needs its vertical component.
      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));

      // Suspension, PHY-5: spring on travel at 1.5x the authored strength,
      // damper on the one-tick backward difference of the displacement, bump
      // stop past the travel. All per mass, straight off
      // `setStrength`/`setDamping` — see the spec table for the units case.
      // Still an approximation in shape: `travel`, `bumpStiffness` and the
      // probe itself are the viewer's, only the force law is read.
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
      const rate = wheel.prevCompression === null
        ? Math.max(0, -u.y) : (compression - wheel.prevCompression) / h;
      let load = SPRING_GRAVITY_SCALE * wheel.strength
        * (travel + overrun * k.bumpStiffness)
        + wheel.damping * rate;
      springRate = Math.max(springRate, Math.abs(rate));
      wheel.prevCompression = compression;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;
      // The Coulomb coefficient this contact spends: the mean of the wheel's
      // own material and the ground's (PHY-2), sampled where the tyre is.
      wheel.friction = 0.5 * (WHEEL_MATERIAL_FRICTION
        + this.surfaceFriction(attach.x, attach.z));

      // The tyre's own frame: forward steered or straight, lateral to its
      // right. Rotation about +Y, so a negative steer angle points the wheel
      // starboard — the right turn the sign convention above promises.
      const dir = this._dir.set(-Math.sin(steer), 0, -Math.cos(steer));
      if (!wheel.steered) dir.set(0, 0, -1);
      const lat = this._lat.crossVectors(dir, UP);

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
        // A PARKING HOLD, and it is the engine's own law rather than a new
        // invention: EngineGrip's wanted velocity change is `dV = T - Vt`
        // (collision-response.md section 8), and at a closed throttle `T` is
        // zero, so a driven wheel asks for the whole of its contact velocity
        // back, at `dV * 30`. The Coulomb clamp below caps it.
        //
        // The engine asks for that at EVERY speed, and it is a firm brake:
        // applied unconditionally it takes this jeep from 12.8 m/s to 1.0 in
        // three seconds off the pedal. That may well be right — BF1942
        // vehicles do stop quickly — but the rest of this file's coast is
        // built on a much gentler invented law (`engineBraking`,
        // `rollingResistance`) that was fitted against the old behaviour, and
        // swapping the two wholesale is a different job from item 16's. So it
        // is faded out by `PARKING_HOLD_SPEED` and only really does the one
        // thing the fitted model cannot: hold a stopped vehicle still.
        //
        // That became necessary with PHY-5. A hull sitting on its own static
        // rake now has a forward component of suspension force, exactly as
        // the engine's would, because the spring axis leans with the body
        // instead of standing world-vertical — and nothing fitted was strong
        // enough to resist it. A parked jeep crept at 0.1 m/s and a parked
        // M3A1 rolled away at 2.2.
        //
        // IT DOES NOT STOP IT DEAD, and the reason is structural rather than a
        // matter of gain. This is a velocity-proportional force answering a
        // constant one, so it settles where the two balance: the residual is
        // the rake acceleration times one substep — 0.005 m/s for the jeep and
        // 0.014 for the M3A1, i.e. 5 and 14 cm over ten parked seconds. Nothing
        // sinks: every wheel's compression is identical at t=10 s and t=20 s.
        // The engine has no such residual because its latched static contact is
        // a **velocity constraint**, not a force — "F = dV in full" cancels the
        // whole tangential velocity and keeps cancelling whatever the rake
        // re-injects. Expressing that here means projecting the horizontal
        // force out of a latched, stopped, closed-throttle contact after the
        // forces are summed, which is a change to the integrator rather than to
        // this term. [free, numerics]
        const hold = Math.max(0, 1 - Math.abs(uLong) / PARKING_HOLD_SPEED);
        fLong -= uLong * (1 / h) * hold / drivenCount;
      }

      // The friction circle, now with the engine's own coefficient and its
      // 1.5:1 break-away hysteresis (PHY-2). The budget is the mean of the
      // two contacting materials, so the same jeep has 0.9 on grass and 0.75
      // in mud; the clamp scales the pair and so keeps the direction of the
      // demand, which is what makes a drive-saturated axle understeer instead
      // of doing something creative.
      const caps = coulombCaps(wheel.friction, load);
      const demand = Math.hypot(fLong, fLat / k.lateralGripFraction);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      staticBudget += caps.breakaway;
      if (grip.scale !== 1) {
        fLong *= grip.scale;
        fLat *= grip.scale;
      }

      // Suspension pushes along the SPRING AXIS, which is the hull's own up
      // (PHY-5) — so in the body frame it is simply (0, load, 0), with no
      // rotation at all, and it leans with the vehicle instead of staying
      // world-vertical. The tyre works in the body's ground plane at the
      // contact patch, a wheel radius below the axle.
      const suspension = this._susp.set(0, load, 0);
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
    const under = this.groundHeight(s.position.x, s.position.z);
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
    if (this.collider && this._hullRadius > 0) {
      const dx = s.position.x - prevX;
      const dy = s.position.y - prevY;
      const dz = s.position.z - prevZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-6) {
        const len = 1 / dist;
        const hit = this.collider.sweepSphere(
          prevX, prevY, prevZ, dx * len, dy * len, dz * len,
          dist, this._hullRadius, this._collisionOwner);
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
    this.gear = 1;
    this.revs = 0;
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
 * `OverTimeDistribution::generateDistribution`, lnxded `0x081e7830`
 * (client twin `FUN_005094b0`), as `EngineTemplate::EngineTemplate`
 * `0x0823efc0` drives it: 101 slots, seeded to the constructor's default and
 * then filled **piecewise-linearly** between the authored control points.
 *
 *   v[j] = ((hi - j) * v[lo] + (j - lo) * v[hi]) / (hi - lo)   for j in lo..hi
 *
 * with two edge rules that both matter here:
 *
 *   - index 0 participates as a control point whether or not it is authored.
 *     The ratio curve does not author it, so slots 0..20 ramp from the ctor
 *     default 1.0 up to 3.5 — which is the whole reason the gear ladder is
 *     non-monotonic above five gears.
 *   - after the last authored index the value is held flat (the tail case at
 *     `0x081e78b8`). Moot for both curves below, which author index 100.
 *
 * THE CORRECTION THIS FUNCTION EXISTS TO CARRY (TANK-3, 2026-09-19): the
 * previous reading of this file had the curve as "1.0 everywhere except five
 * authored slots", which came from reading the constructor's default-fill loop
 * and the five stores and never following the eleven `CALL`s after them. That
 * model put the M3A1 at 17.5 and reduced every gear count but 1 and 5 to
 * exactly `3.5 * differential`. Both are wrong. Do not restore it.
 *
 * @param {Array<[number, number]>} points authored (index, value) pairs
 * @param {number} fallback the constructor's default, used for index 0 when
 *   the template does not author it
 */
function overTimeDistribution(points, fallback = 1.0) {
  const curve = new Array(101).fill(fallback);
  const authored = [...points].sort((a, b) => a[0] - b[0]);
  for (const [index, value] of authored) curve[index] = value;
  // Index 0 is always a knot; its value is whatever it already holds (the
  // authored one, or the ctor default).
  const knots = authored[0]?.[0] === 0 ? authored.map(p => p[0]) : [0, ...authored.map(p => p[0])];
  for (let n = 0; n < knots.length - 1; n++) {
    const lo = knots[n], hi = knots[n + 1];
    const span = hi - lo;
    for (let j = lo + 1; j < hi; j++) {
      curve[j] = ((hi - j) * curve[lo] + (j - lo) * curve[hi]) / span;
    }
  }
  const last = knots[knots.length - 1];
  for (let j = last + 1; j <= 100; j++) curve[j] = curve[last];
  return curve;
}

/**
 * `getCurrentRatio`'s curve (TANK-3). Control points 20 -> 3.5, 40 -> 2.2,
 * 60 -> 1.5, 80 -> 1.1, 100 -> 0.94; index 0 unauthored, so the first fifth of
 * it climbs from the constructor's 1.0. Sampled every ten slots it reads
 * 1.000 2.250 3.500 2.850 2.200 1.850 1.500 1.300 1.100 1.020 0.940.
 */
const GEAR_RATIO_CURVE = overTimeDistribution(
  [[20, 3.5], [40, 2.2], [60, 1.5], [80, 1.1], [100, 0.94]]);

/**
 * `getCurrentTorque`'s curve (TANK-4), a *different* 101-slot distribution at
 * a different offset, indexed by a normalised rev fraction rather than by the
 * gear. Control points 0 -> 0.70, 10 -> 0.80, 30 -> 0.90, 60 -> 1.00,
 * 85 -> 0.85, 100 -> 0.70: peak drive at 60 % revs, 70 % of peak at both ends.
 * Every ten slots: 0.700 0.800 0.850 0.900 0.9333 0.9667 1.000 0.940 0.880
 * 0.800 0.700.
 *
 * Its only caller is `PhysicsEngine::feedbackLoop`, which runs inside both
 * `updatePhysics` and `addFriction`. An earlier note in this corpus called it
 * "engine-sound RPM only"; that was never established and TANK-4 retired it.
 */
const ENGINE_TORQUE_CURVE = overTimeDistribution(
  [[0, 0.70], [10, 0.80], [30, 0.90], [60, 1.00], [85, 0.85], [100, 0.70]]);

/** Sample a 101-slot distribution at `t` in 0..100 the way both getters do:
 * truncate toward zero for the slot, lerp into the next one. */
function sampleDistribution(curve, t) {
  const x = t < 0 ? 0 : t > 100 ? 100 : t;
  const i = Math.min(100, Math.trunc(x));
  const frac = x - i;
  const lo = curve[i];
  const hi = curve[Math.min(100, i + 1)];
  return lo + (hi - lo) * frac;
}

/**
 * `PhysicsEngine::getCurrentRatio()`, lnxded `0x0824ca70` / client
 * `FUN_0057bd90` (TANK-3, re-read and corrected 2026-09-19):
 *
 *   idxf  = gear / numberOfGears * 100
 *   i     = trunc(idxf)                       // toward zero, the exe's _ftol
 *   ratio = 3.5 * differential / lerp(curve[i], curve[i+1], idxf - i)
 *
 * The 3.5 is a multiplier on `differential`, not a curve value and not a
 * divisor — it is numerically equal to `curve[20]`, which is exactly why a
 * five-speed's first gear comes out at the raw `differential`.
 *
 * Worked examples, all re-derived from the control points:
 *
 *   Sherman  `differential 4, numberOfGears 5`   4.000  6.364  9.333 12.727 14.894
 *   Willy    `differential 7, numberOfGears 5`   7.000 11.136 16.333 22.273 26.064
 *   M3A1     `differential 5, numberOfGears 4`   5.512  9.459 14.583 18.617
 *
 * The M3A1's first gear is **5.512**, not the 17.5 this file used to carry.
 *
 * @param {number} differential `setDifferential`
 * @param {number} [gear] 1-based; the engine seeds it to 1 and no code path
 *   read so far writes it again (TANK-7), so a tracked hull passes 1 — but the
 *   curve is indexed by it, so it is a parameter, not a folded constant.
 * @param {number} [numberOfGears] `setNumberOfGears`, default 1
 */
export function engineRatio(differential, gear = 1, numberOfGears = 1) {
  const gears = numberOfGears > 0 ? numberOfGears : 1;
  return (ENGINE_RATIO_SCALE * differential)
    / sampleDistribution(GEAR_RATIO_CURVE, (gear / gears) * 100);
}

/**
 * The whole ladder, gear 1..numberOfGears, for any gear count — installed mods
 * reach `numberOfGears 8` and `50`, and every one of those gears now gets a
 * real ratio instead of collapsing to `3.5 * differential`.
 *
 * **The ladder is not monotonic above five gears, and that is correct.**
 * Because the curve climbs from 1.0 to 3.5 across indices 0..20, a gear that
 * lands below index 20 samples a *smaller* divisor than first-of-a-five-speed
 * and so gets a *larger* ratio: `numberOfGears 8, differential 5` gives
 * g1 = 6.829 but g2 = 5.512. Do not sort it, clamp it or otherwise "fix" it.
 */
export function gearLadder(differential, numberOfGears) {
  const gears = Math.max(1, Math.round(numberOfGears > 0 ? numberOfGears : 1));
  const out = new Array(gears);
  for (let g = 1; g <= gears; g++) out[g - 1] = engineRatio(differential, g, gears);
  return out;
}

/**
 * `PhysicsEngine::getCurrentTorque()`'s curve factor (TANK-4), without the
 * `x torque` the engine applies on top: `lerp` into `ENGINE_TORQUE_CURVE` at
 * `min(|revs|, 1.0) * 100`.
 *
 * @param {number} revs engine speed as a fraction of full, signed or not
 */
export function engineTorqueFraction(revs) {
  return sampleDistribution(ENGINE_TORQUE_CURVE, Math.min(Math.abs(revs), 1) * 100);
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
 * `PhysicsEngine::updatePhysics` body thrust (TANK-7, client `0x0057bfb0` /
 * lnxded `0x0824cbb0`) — the same law `Aircraft.step` already carries:
 *
 *   e = thr − ρ(v·fwd) / fadeSpeed
 *   K = 0.1|thr| + e|e|
 *   a = fwd * K * ratio
 *
 * Applied **once** per simulation step at the engine node, from the
 * undivided throttle (`+0xa0`). Yaw never enters this formula — steering
 * while moving splits only the EngineGrip contact-speed targets via
 * `differentialRPM` (TANK-2 / TANK-9). An earlier viewer mistake evaluated
 * this per driven side and summed both tracks → ~8.8 m/s² at yaw 0 instead
 * of the retail ~4.4 (V-R3 claim 22).
 *
 * `rho` defaults to 1 (ground vehicles sit well below the aircraft density
 * ceiling). Units are acceleration; mass is already inside, matching the
 * rest of this codebase's `setTorque`-descended convention.
 *
 * @returns {number} m/s^2 along hull forward
 */
export function bodyThrust(throttle, forwardSpeed, ratio,
    fadeSpeed = FADE_SPEED_DEFAULT, rho = 1) {
  const e = throttle - rho * forwardSpeed / fadeSpeed;
  return (0.1 * Math.abs(throttle) + e * Math.abs(e)) * ratio;
}

/**
 * EngineGrip contact-speed target, re-derived 2026-09-20 (TANK-9 corrected).
 * The engine's expression, `addFriction` lnxded `0x0825c2ed`-`0x0825c407`, is
 *
 *   T = (1 - 0.5*b) * ratio * differentialRPM(side) * fwd
 *       + 0.5*b * (Vt . fwd) fwd                        // the SAME fwd axis
 *
 * — a **blend between the commanded surface speed and the wheel's own
 * contact speed**, not a scale on the target. `0.5*b` is formed at
 * `0x0825c32b` (`fld ds:0x86b05e8` = 0.5, `fmul [edx+0xb8]`) for the first
 * term's `1 - 0.5*b` (`fsubr ds:0x86ba8d4` = 1.0) and again at `0x0825c3b1`
 * for the second; the two are summed at `0x0825c3d7`-`0x0825c407`.
 *
 * `b` is engine `+0xb8`, and it is **the gear-change timer, not a constant**:
 * `Engine::handleUpdate` `0x0823e120` counts it down by `dt/gearChangeTime`
 * to zero (`0x0823e24f`/`0x0823e25a`) and nothing on the server re-arms it,
 * so after the first `gearChangeTime` of a vehicle's life `b = 0` and
 *
 *   T = ratio * differentialRPM(side)      -> dV = T - Vt, zero at v = T
 *
 * The old reading took the constructor's seed `+0xb8 = 1.0` (`0x0824c756`
 * region) for the steady value and landed on a factor of **0.5**, which made
 * every gear's ceiling half what the engine gives. `differentialRPM` returns
 * the engine's **rev state** `+0xa0` (`0x0824c990`), not the pedal, so the
 * ceiling is `ratio * revs` and revs runs to `ENGINE_REV_CEILING`.
 *
 * @param {number} [blend] the live gear-change timer `+0xb8`, 1 at the
 *   instant of a change and 0 in all steady driving
 * @param {number} [contactSpeed] `Vt . fwd`, the second term's input
 */
export function engineGripTarget(throttle, yaw, side, ratio,
    blend = 0, contactSpeed = 0) {
  const b = Math.max(0, Math.min(1, blend));
  return (1 - 0.5 * b) * ratio * differentialRPM(throttle, yaw, side)
    + 0.5 * b * contactSpeed;
}

/**
 * The engine's own rev ceiling, and the number `revLimit 356` was standing in
 * for. `Engine::handleUpdate` `0x0823e120` runs the rev state as a first-order
 * filter on the pedal and the drivetrain load,
 *
 *   revs += 0.05 * ((pedal - load) - 0.5*revs)     // fixed point 2*(pedal-load)
 *   revs  = min(1.2, max(-1.0, revs))              // 0x0823e2bf onward
 *
 * so a closed throttle against no load pins revs at **1.2**, not 1. That is
 * what puts a Willy's top gear at `1.2 * 26.064` = 31.3 m/s rather than at
 * `ladder[top]`. The asymmetric floor of -1.0 is the engine's too, and is why
 * reverse is slower than first.
 */
export const ENGINE_REV_CEILING = 1.2;

/** The same clamp's lower arm, `0x0823e2bf` onward: revs floor at -1.0. */
export const ENGINE_REV_FLOOR = 1.0;

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

  // `mu 1.1` is gone: a track wheel's material (38, 178) is as undefined in
  // vanilla as a jeep's 37, so all of them fall back to material 0 at 1.0 and
  // the coefficient comes from the ground, per wheel, like everyone else's
  // (PHY-2). There never was a tank-specific reading to lose.
  //
  // What survives is the ANISOTROPY, and it is now labelled for what it is:
  // an invention. The engine's clamp is isotropic on the tangential plane and
  // has no separate lateral coefficient at all. This file keeps one because a
  // track that slides sideways as reluctantly as it grips lengthwise rolls
  // itself over — at a Coulomb cap of 1.1x14.73 a full-lock turn asks 10.9 of
  // roll moment about the contact patches where the springs can answer at
  // most `sum(load) * halfWidth` = 12.5, and the M3A1 duly went onto its roof
  // the moment anything let it turn quickly. Expressed as a fraction of the
  // material cap rather than as a coefficient of its own, so the material
  // data drives the magnitude and only the shape is fitted. [free, invented]
  lateralGripFraction: 0.5,
  // How quickly that lateral limit is reached, not how large it is: at 30 the
  // tracks reached it inside a tenth of a degree of slip, which read as a hull
  // welded to its heading. Same invention as Willy's. [free, invented]
  corneringStiffness: 12,
  // The half-track's own front axle only: an ordinary tyre, not a track —
  // Willy's own value (`WILLYS.corneringStiffness`), transcribed rather than
  // imported so this file's two vehicle specs stay independently readable.
  frontAxleCorneringStiffness: 7,
  slipFloor: 1.0,
  // The half-track's free-rolling front axle only (TANK-15) — never an
  // engine-connected wheel, so no separate "engine braking" belongs with it.
  rollingResistance: 0.5,
  // EngineGrip slip damper toward `engineGripTarget` (TANK-9), N per (m/s)
  // per unit load — provisional until Coulomb magnitudes (PHY-2) are known.
  // Open assumption (PLAN T3): this opposition, not fadeSpeed, is the real
  // top-speed governor; do not invent fadeSpeed changes if cruise still
  // overshoots the soft retail band.
  //
  // Re-fitted from 0.8 to put both hulls back in the band this file was
  // originally tuned to and `ground-vehicles.md` still quotes — Sherman
  // ~9 m/s / 33 km/h, M3A1 ~31 m/s / 112 km/h. The TANK-7 correction (body
  // thrust applied once at the hull instead of per driven side) halved the
  // propulsion this number was fitted against and nothing re-fitted it
  // afterwards, so the Sherman had quietly been sitting at 18.5 km/h — a
  // tank a player reads as broken before it has turned a corner. 0.25
  // lands 33.7 and 114.5 km/h. Still fitted, still not a measurement. [free]
  trackResistance: 0.25,

  // The same damper's gain on the part of the target that DIFFERS between
  // the two tracks — i.e. on the steering signal alone (`#step`). Kept apart
  // from `trackResistance` because the two are not the same job: that one
  // decides how fast the hull ends up going, this one decides how hard a
  // track is driven against its opposite number, and a single shared value
  // could only ever buy one at the other's expense. Sized against the grip
  // actually available: the friction circle caps a track at `mu * load`, and
  // a tank that never gets near that cap cannot out-torque its own tracks'
  // sideways scrub, which is exactly how a Sherman ended up taking four
  // minutes to turn around. Fitted, like every other number in this block,
  // against the two vanilla hulls' turn rate with the rollover cases still
  // surviving. [free]
  trackDifferential: 20.0,

  // s^-1, on the *roll and pitch* body rates. Willy needs only 0.8 for the
  // same job (mopping up the airborne case); a tank's wheels sit much
  // farther from the root than a jeep's (the M3A1's own front axle 3 m ahead
  // of it), so the same body rate puts a far larger torque through the
  // identical suspension formula. Found by driving one through a sustained
  // turn and watching it roll itself onto its roof — twice: held from a
  // stand-still it tipped somewhere between yaw input 0.2 and 0.3 (fixed at
  // 5.0), and a second, harder case survived that fix and still rolled the
  // M3A1 at yaw 0.6 entered from its own straight-line top speed (~31 m/s)
  // rather than accelerating into the turn — the extra speed alone very
  // nearly doubles the centripetal load a held turn puts through the
  // suspension. 12.0 was the lowest value that survived both; this carries
  // margin above it. corneringStiffness made no difference to either case at
  // any value tried. [free]
  angularDamping: 15.0,

  // s^-1, on the **yaw** rate alone, and much lighter than the roll/pitch
  // figure above. Both rollover cases `angularDamping` was fitted against
  // are failures about the *roll* axis — the hull going over on its side —
  // and nothing in that tuning record ever measured what 15.0 did to
  // heading. What it did was flatten differential steering to nothing: a
  // tank's only yaw authority is the small left/right split in track force
  // `differentialRPM` produces, and dividing its steady state by 15 left the
  // Sherman turning 1.4 deg/s at full lock — a 4-minute 360, which is what a
  // player reads as "the drivetrain doesn't work". Yaw is damped on its own
  // term now, sized so the two vanilla tracked hulls turn at a believable
  // rate while both rollover cases above still survive (they are asserted in
  // tests/test_ground.py and were re-run against this value). Still fitted,
  // not measured — the same standing ask every other [free] constant here
  // carries. [free]
  yawDamping: 2.0,

  // A steered front axle's lock, used only if its own bundle somehow
  // declares no min/max at all to measure. M3A1's own is +-40 (TANK-15),
  // read off the node before this ever applies.
  maxSteer: 40,
};

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
     * report/API parity with `GroundVehicle` and for the engine audio, and
     * this class still does not spend it as drive — `bodyThrust` carries the
     * propulsion. What it is NOT is sound-only: TANK-4 retired that claim,
     * because `getCurrentTorque`'s caller runs inside `updatePhysics` and
     * `addFriction`, and the second 101-slot curve is carried here now
     * (`ENGINE_TORQUE_CURVE`). There is deliberately no `gearUp`/`gearDown`:
     * a tank's `gear` never leaves 1 (TANK-7), so there is nothing to shift
     * toward. */
    this.engine = {
      differential: this.spec.differential,
      numberOfGears: this.spec.numberOfGears,
      torque: null,
      fadeSpeed: FADE_SPEED_DEFAULT,
    };
    this._extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    this.collectChassis();

    /** The whole ladder (TANK-3), for any gear count — the Sherman's
     * 4.000/6.364/9.333/12.727/14.894 and the M3A1's
     * 5.512/9.459/14.583/18.617. A tracked hull never shifts, so only
     * `ladder[0]` is ever spent; it is built in full because that is what the
     * corrected curve is pinned against. */
    this.ladder = gearLadder(this.engine.differential, this.engine.numberOfGears);
    // getCurrentRatio() at gear 1, TANK-3/6/7/8: fixed for the vehicle's life,
    // exactly mirroring the retail engine never writing `gear` past its seed.
    this.ratio = this.ladder[0];

    /** Driven wheels sharing each side — used for diagnostics / harnesses;
     * longitudinal thrust is no longer split per side (TANK-7). */
    this.drivenBySide = { '-1': 0, '0': 0, '1': 0 };
    for (const wheel of this.wheels) {
      if (wheel.driven) this.drivenBySide[wheel.side] += 1;
    }
    /** The load on the least-loaded grounded driven wheel, carried one
     * sub-step. The steering couple in `#step` is sized and capped against
     * this single shared number rather than each wheel's own live load — see
     * its comment for why that is what keeps the two tracks' halves equal and
     * opposite. Seeded to the hull's static share so the first sub-step after
     * a spawn has something sane; no driven wheels leaves it 0 and the couple
     * simply vanishes. */
    const drivenCount = this.wheels.reduce((n, w) => n + (w.driven ? 1 : 0), 0);
    this._coupleLoad = drivenCount > 0 ? -GRAVITY / drivenCount : 0;
    /** And the material coefficient that wheel found, so the couple's cap is
     * the ground's rather than a constant (PHY-2). */
    this._coupleFriction = DEFAULT_MATERIAL_FRICTION;

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

    // Hull collision against static objects — same as `GroundVehicle`.
    this._hullRadius = this._boundingRadius;
    this._collisionOwner = this.collider?.statics?.ownerOf(node) ?? -1;

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
   * What actually cured it is `#step`'s friction ellipse
   * (`lateralGripFraction`) —
   * measured: the cycle is gone at 60 Hz with that in place, and 60/120/240/
   * 480 Hz now agree to four decimals on every figure the harness reports.
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

    // TANK-7: one whole-body thrust from undivided throttle — not per side.
    const fadeSpeed = this.engine.fadeSpeed;
    const thrust = bodyThrust(throttle, vf, this.ratio, fadeSpeed);

    // Audio rpm for `.ssc` Default / Engine::Rpm. Land scripts modulate on
    // Default; `PhysicsEngine::feedbackLoop` (0x0057be90) folds
    // getCurrentRatio()*K / getCurrentTorque() into the engine's RPM state
    // and that is the channel the note follows. `thrust` is already K*ratio.
    const engineTorque = Math.max(this.engine.torque || 4, 1e-3);
    const loadRpm = Math.min(1, Math.abs(thrust) / engineTorque);
    const pedal = Math.min(1, Math.abs(throttle));
    const wanted = Math.max(loadRpm, pedal * 0.25);
    s.throttle += (wanted - s.throttle) * Math.min(1, 8 * h);

    // --- wheels -------------------------------------------------------------
    const force = this._force.set(0, 0, 0);
    const torque = this._torque.set(0, 0, 0);
    let loaded = 0;
    // `staticHold`'s two inputs, exactly as `GroundVehicle` gathers them.
    let staticBudget = 0;
    let allLatched = true;
    let springRate = 0;
    // The steering couple's budget for the NEXT sub-step, gathered as the
    // loop goes rather than in a second pass over the same wheels: the
    // weakest driven track that is actually on the ground. A wheel in the air
    // answers nothing, so it is skipped rather than zeroing the split for the
    // whole hull the moment one roller crests a bump.
    let nextCoupleLoad = Infinity;
    let nextCoupleFriction = DEFAULT_MATERIAL_FRICTION;
    const speed = s.velocity.length();
    const authority = Math.min(1, speed / 2);

    // The spring axis, world frame — the hull's own up (PHY-5), not the
    // world's. See `GroundVehicle.#step` for the whole reading.
    const axisWorld = this._axis.set(0, SPRING_AXIS_Y, 0).applyQuaternion(q);

    for (const wheel of this.wheels) {
      const attach = this._attach.copy(wheel.rest).applyQuaternion(q).add(s.position);
      const reach = probeAlongAxis(this.groundHeight, attach, axisWorld);
      const compression = Number.isFinite(reach) ? wheel.radius - reach : -Infinity;
      if (compression <= 0) {
        wheel.compression = 0;
        wheel.load = 0;
        wheel.prevCompression = null;
        wheel.staticGrip = false;   // no contact clears the latch (PHY-2)
        // Airborne and driven: the track keeps moving at its commanded rate
        // against nothing, same convention `GroundVehicle` uses.
        if (wheel.driven) {
          wheel.angle += this.ratio * differentialRPM(throttle, yaw, wheel.side) * h;
        }
        continue;
      }

      // Contact-patch velocity, hoisted for the damper's first tick exactly
      // as `GroundVehicle` hoists its own.
      const u = this._u.copy(vBody).add(this._arm.crossVectors(w, wheel.rest));

      // Suspension: `GroundVehicle`'s own spring/damper/bump-stop shape,
      // unchanged — including PHY-5's 1.5x gravity-invariance factor, the
      // backward-difference damper and its first-contact closing-speed seed,
      // and its disclaimer about what a probe down the spring axis is and is
      // not. A tracked hull needs the seed more than a jeep does: on rough
      // ground 8 % of its contacts are a wheel re-landing.
      const travel = Math.min(compression, k.suspensionTravel);
      const overrun = compression - travel;
      const rate = wheel.prevCompression === null
        ? Math.max(0, -u.y) : (compression - wheel.prevCompression) / h;
      let load = SPRING_GRAVITY_SCALE * wheel.strength
        * (travel + overrun * k.bumpStiffness)
        + wheel.damping * rate;
      springRate = Math.max(springRate, Math.abs(rate));
      wheel.prevCompression = compression;
      if (load < 0) load = 0;
      wheel.compression = compression;
      wheel.load = load;
      loaded += 1;
      wheel.friction = 0.5 * (WHEEL_MATERIAL_FRICTION
        + this.surfaceFriction(attach.x, attach.z));
      if (wheel.driven && load > 0 && load < nextCoupleLoad) {
        nextCoupleLoad = load;
        nextCoupleFriction = wheel.friction;
      }

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
        // TANK-9: EngineGrip builds a contact-speed target from
        // differentialRPM (yaw splits left/right); friction pulls toward
        // it. This is **not** a second copy of body thrust (TANK-7) —
        // earlier code applied `K*ratio` per side here and doubled launch
        // accel at yaw 0. Coulomb magnitudes open (PHY-2); `trackResistance`
        // is the provisional damper (PLAN T3 open governor assumption).
        //
        // Split into the two jobs one constant used to do. The part common
        // to both tracks (`vMean`, the yaw-0 target) is the top-speed
        // governor and keeps `trackResistance` exactly as it was; the part
        // that DIFFERS between the tracks — the whole of the steering
        // signal, and nothing else — gets its own gain, because tying the
        // two together made turn rate hostage to top speed: every unit of
        // steering authority bought a proportional loss of cruise, so the
        // fitted governor left the Sherman at 0.4 deg/s of yaw at full lock.
        // At `yaw == 0` the two targets are equal and this reduces, term for
        // term, to the line it replaces — so acceleration, top speed,
        // reverse and TANK-17's own no-pivot-from-rest (differentialRPM is
        // 0 on both sides at zero throttle, so both targets are 0 together)
        // are all bit-identical to before. `differentialRPM`/`engineRatio`
        // are untouched: this only changes how hard the split they compute
        // is pushed, which was never anything but [free] to begin with.
        //
        // Split into the two jobs one constant used to do, and the steering
        // half made a COUPLE rather than a brake. `vMean` — the yaw-0 target
        // both tracks share — carries the top-speed governor and keeps
        // `trackResistance` doing exactly what it always did. What each track
        // asks for either side of that mean carries the steering, at its own
        // gain, because tying the two together made turn rate hostage to top
        // speed: every unit of steering authority cost a proportional unit of
        // cruise, and the fitted governor left the Sherman at 0.4 deg/s of
        // yaw at full lock.
        //
        // A couple, not a brake, because `differentialRPM` clamps the outer
        // track at 1.0 — so read literally, the split only ever *slows* the
        // inner track, and at the gain that actually turns a 25-tonne hull
        // that brake is several times `bodyThrust`: a held full-lock turn
        // dragged the Sherman from 32 km/h down to walking pace and stayed
        // there. `diff` is each track's own deviation from the mean of the
        // two, so one track gains exactly what the other gives up, the hull's
        // net tractive effort is untouched, and what a turn genuinely costs
        // comes out of the lateral scrub below instead.
        //
        // The couple is sized and capped off ONE shared number — the least
        // loaded driven wheel that is on the ground, as of the previous
        // sub-step (`_coupleLoad`) — and never off this wheel's own live
        // load, so both halves come out identical in magnitude however the
        // weight has just shifted. That is what keeps it a couple. Written
        // against the live load it is heavier on the outer track, the one a
        // turn loads up, so the pair stopped summing to zero and the residual
        // read as a net forward push: a Sherman gaining speed to 61 km/h
        // mid-turn, an M3A1 to 178 and onto its roof. Sizing it off the
        // hull's static weight share instead fixed the tank and not the
        // half-track, whose driven tracks carry only part of its weight (a
        // free-rolling front axle carries the rest), so a static share
        // over-drove them past the grip they actually had. The weakest driven
        // track is the honest budget for a split that has to be answered
        // equally at both ends. The governor above still reads this wheel's
        // own live load, because that half is a real friction-scaled contact
        // force rather than a split of engine effort.
        const vMean = engineGripTarget(throttle, 0, 0, this.ratio);
        const vTgt = engineGripTarget(throttle, yaw, wheel.side, this.ratio);
        const vOther = engineGripTarget(throttle, yaw, -wheel.side, this.ratio);
        const gShare = load / -GRAVITY;
        const coupleLoad = this._coupleLoad;
        const coupleCap = coulombCaps(this._coupleFriction, coupleLoad).kinetic;
        let diff = (vTgt - vOther) * 0.5 * k.trackDifferential
          * (coupleLoad / -GRAVITY);
        if (diff > coupleCap) diff = coupleCap;
        else if (diff < -coupleCap) diff = -coupleCap;
        fLong = -(uLong - vMean) * k.trackResistance * gShare + diff;
        // The same parking hold `GroundVehicle` carries, and for the same
        // reason: `trackResistance 0.25` stands in for the engine's own x30
        // on this exact term, and at a quarter of a percent of it a hull
        // parked on its own static rake rolled away at 2.2 m/s once PHY-5
        // let the suspension lean with it. Below walking pace with the
        // throttle shut, ask for the engine's figure; the Coulomb clamp
        // decides what the ground gives back.
        if (Math.abs(throttle) < 0.01) {
          const hold = Math.max(0, 1 - Math.abs(uLong) / PARKING_HOLD_SPEED);
          fLong -= uLong * (1 / h) * hold * gShare;
        }
      }
      // A dummy (spin-only) wheel gets no longitudinal force at all —
      // TANK-14's reading, and its own zero strength/damping already leaves
      // it nothing to spend one on regardless.

      // The friction limit is an ELLIPSE here, not the circle a tyre gets —
      // and PHY-2 says plainly that the engine's is a circle for both, so
      // this is the viewer's, kept for a reason rather than for parity. An
      // isotropic budget starves the differential (the only yaw authority a
      // tank has) of longitudinal force while handing the hull a lateral
      // force big enough to roll it: on a paved road the cap is 1.05x14.73
      // and a full-lock turn asks ~10.4 of roll moment about the contact
      // patches where the springs can answer at most `sum(load) * halfWidth`
      // = 12.5. The M3A1 duly went onto its roof the moment anything let it
      // turn quickly. `lateralGripFraction` sits below that threshold by a
      // real margin and the longitudinal budget is untouched.
      //
      // The magnitude is the material's (PHY-2) and so is the 1.5:1
      // break-away hysteresis; only the ellipse's SHAPE is this file's own,
      // and `lateralGripFraction` says so in its own comment. Stretching the
      // lateral axis by that fraction turns the ellipse test back into the
      // same scalar compare the isotropic clamp does, so both classes run one
      // `coulombClamp`.
      const caps = coulombCaps(wheel.friction, load);
      const demand = Math.hypot(fLong, fLat / k.lateralGripFraction);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      staticBudget += caps.breakaway;
      if (grip.scale !== 1) {
        fLong *= grip.scale;
        fLat *= grip.scale;
      }

      // Along the spring axis, i.e. the hull's own up: (0, load, 0) in the
      // body frame, unrotated (PHY-5).
      const suspension = this._susp.set(0, load, 0);
      force.add(suspension);
      force.addScaledVector(dir, fLong);
      force.addScaledVector(lat, fLat);
      torque.add(this._arm.crossVectors(wheel.rest, suspension));
      const fTyre = this._fTyre.set(0, 0, 0)
        .addScaledVector(dir, fLong).addScaledVector(lat, fLat);
      this._arm.set(wheel.rest.x, wheel.rest.y - wheel.radius, wheel.rest.z);
      torque.add(this._arm.cross(fTyre));

      // Visual roll: a driven wheel spins at its own side's commanded rate
      // (TANK-2 — the two tracks visibly move at different speeds mid-turn,
      // which is the entire point of this steering law; SpinWheel is
      // visual-only per TANK-8), so it can read slightly ahead of or behind
      // the hull's own integrated motion. Everything else, dummy rollers
      // included, rolls off its own actual contact speed the way
      // `GroundVehicle`'s wheels all do.
      wheel.angle += (wheel.driven
        ? this.ratio * differentialRPM(throttle, yaw, wheel.side)
        : uLong / wheel.radius) * h;
    }

    this._coupleLoad = nextCoupleLoad < Infinity ? nextCoupleLoad : 0;
    this._coupleFriction = nextCoupleLoad < Infinity
      ? nextCoupleFriction : DEFAULT_MATERIAL_FRICTION;

    s.grounded = loaded > 0;
    s.airspeed = speed;

    // --- integrate ------------------------------------------------------------
    // Semi-implicit Euler, `GroundVehicle`'s own shape, plus TANK-7 body
    // thrust applied once along hull forward (not per track).
    const accel = this._accel.copy(force).applyQuaternion(q);
    this._fwd.set(0, 0, -1).applyQuaternion(q);
    accel.addScaledVector(this._fwd, thrust);
    // Body-level EngineGrip remainder (TANK-9 / PLAN T3 open governor):
    // wheel `trackResistance` toward `v_tgt` is Coulomb-capped (`mu*load`),
    // so a high-ratio hull (M3A1's 17.5) still outruns the soft retail band
    // and rolls in a hard turn. The same damper on the free body — toward
    // the undivided yaw-0 target — closes what the patches cannot without
    // touching fadeSpeed.
    const vNom = engineGripTarget(throttle, 0, 0, this.ratio);
    accel.addScaledVector(this._fwd, -(vf - vNom) * k.trackResistance);
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
    const under = this.groundHeight(s.position.x, s.position.z);
    if (Number.isFinite(under) && s.position.y < under + 0.05) {
      s.position.y = under + 0.05;
      if (s.velocity.y < 0) s.velocity.y = 0;
      s.grounded = true;
    }

    // Hull collision against static objects — same sweep as `GroundVehicle`.
    // skipOwner of -1 skips nothing, so the sweep works even with a mock
    // collider that has no owner index.
    if (this.collider && this._hullRadius > 0) {
      const dx = s.position.x - prevX;
      const dy = s.position.y - prevY;
      const dz = s.position.z - prevZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-6) {
        const len = 1 / dist;
        const hit = this.collider.sweepSphere(
          prevX, prevY, prevZ, dx * len, dy * len, dz * len,
          dist, this._hullRadius, this._collisionOwner);
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
    // Back to the constructor's seed, not the last sub-step's reading: every
    // wheel's load was just zeroed above, and a parked vehicle's first step
    // should size its steering couple off a hull standing on its own weight.
    const driven = this.wheels.reduce((n, w) => n + (w.driven ? 1 : 0), 0);
    this._coupleLoad = driven > 0 ? -GRAVITY / driven : 0;
    this._coupleFriction = DEFAULT_MATERIAL_FRICTION;
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
