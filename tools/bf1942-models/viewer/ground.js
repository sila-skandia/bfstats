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
 * The two caps **one contact** is tested against, as accelerations rather
 * than as per-tick velocity steps — the viewer integrates at its own rate.
 *
 * They carry no load, and that is the engine's own arithmetic rather than a
 * simplification: the budget is `A * N.y * 1.5 * 9.82 / 30` metres per second
 * of delta-v per tick, i.e. `A * N.y * |g|` as an acceleration, with no
 * normal force anywhere in it (collision-response.md section 8 — "there is no
 * force and no mass in this solver"). At `N.y = 1` on the flat that is
 * `A * 14.73`.
 *
 * **Where the viewer differs, named:** the engine sums nothing — it takes the
 * **mean** over touching parts, so a whole vehicle's Coulomb budget is
 * `A * |g|` however many wheels touch. This file instead scales each
 * contact's answer by that wheel's share of standing weight (`load / |g|`,
 * which sums to 1) and sums those, which reaches the same whole-vehicle total
 * on flat ground and additionally makes an unloading wheel lose its share.
 * The two genuinely disagree where the driven wheels carry a different
 * fraction of the weight than of the part count: a jeep is rear-wheel drive,
 * so the engine's mean gives its two driven wheels half the budget while this
 * file gives them the third of the weight they actually carry.
 */
function coulombCaps(friction) {
  return {
    kinetic: friction * COULOMB_SLIDING * COULOMB_GRAVITY,
    breakaway: friction * COULOMB_BREAKAWAY * COULOMB_GRAVITY,
  };
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
  const parked = loaded && allLatched && budget > 0
    && drive === 0 && braking === 0
    && s.velocity.lengthSq() <= STATIC_HOLD_SPEED * STATIC_HOLD_SPEED
    && s.angularVelocity.lengthSq() <= STATIC_HOLD_SPIN * STATIC_HOLD_SPIN;
  if (!parked) {
    vehicle._staticQuiet = 0;
    vehicle._staticHeld = false;
    return false;
  }
  // A hull dropped onto a slope crosses every one of those thresholds
  // transiently on the way down, so the hold waits for them to hold together
  // for a whole second, with the suspension stopped, before it takes effect.
  //
  // **The settle test gates entry only.** Once the hold is on, the spring
  // rate it measures is its own doing: zeroing the horizontal velocity moves
  // the contact patches by a hair, the springs answer, and the rate crosses
  // `STATIC_HOLD_SETTLE` again — which used to reset the dwell, let the hull
  // creep for another second, and re-engage, a limit cycle regulated by the
  // threshold itself. It cost a parked M3A1 0.54 m in ten seconds. Re-testing
  // a precondition against a state the test itself created is circular; the
  // conditions that genuinely mean "no longer parked" are the ones above, and
  // they are checked every sub-step.
  if (!vehicle._staticHeld) {
    if (springRate > STATIC_HOLD_SETTLE) {
      vehicle._staticQuiet = 0;
      return false;
    }
    vehicle._staticQuiet = (vehicle._staticQuiet ?? 0) + h;
    if (vehicle._staticQuiet < STATIC_HOLD_DWELL) return false;
    vehicle._staticHeld = true;
  }
  // What the contacts are being asked to hold, this substep: the horizontal
  // acceleration plus the horizontal velocity already on the hull, expressed
  // as one acceleration so both are measured against the same budget.
  const ax = accel.x + s.velocity.x / h;
  const az = accel.z + s.velocity.z / h;
  if (Math.hypot(ax, az) > budget) {
    // Past the break-away budget — a slope steeper than `atan(mu)` — the
    // latch lets go and the hull slides, exactly as the engine's does.
    vehicle._staticHeld = false;
    vehicle._staticQuiet = 0;
    return false;
  }
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
  // THREE MORE CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK, and
  // these three were the file's last labelled inventions:
  //
  //   `corneringStiffness 7`     lateral force per radian of slip angle.
  //   `lateralGripFraction 1/1.5` how much of the Coulomb budget the lateral
  //                              axis could reach.
  //   `slipFloor 1.5`            the floored denominator a slip angle was
  //                              read against, plus a speed fade, because a
  //                              tyre model with authority at zero speed is
  //                              an oscillator.
  //
  // All three stood in for **RollGrip's own demand**, `dV = -(Vt along the
  // axle)` (collision-response.md section 8), which this file had never
  // written out: the Coulomb clamp BOUNDS a lateral demand and never CREATES
  // one, so deleting the stiffness without putting RollGrip in its place left
  // the jeep with no lateral force at all — 16 degrees of turn in 12 s
  // instead of 60, which is what a previous reviewer measured and why they
  // were kept. With the demand written out the same jeep turns **120 degrees
  // in 12 s** at 31 m/s, against 108 on `main` and 92 with the fitted model,
  // and the worst body roll is 8.7 degrees.
  //
  // And the clamp is **isotropic** again, as PHY-2 says it is: no ellipse,
  // no anisotropy, no slip-angle curve anywhere. What replaces the ellipse's
  // rollover protection is that the two demands now genuinely compete for one
  // budget — a wheel spending it on drive has none left to corner with, which
  // is collision-response.md's own "power slide" note, and a tank measured
  // `worstUp >= 0.974` across the whole yaw sweep where the ellipse was put
  // there to stop it rolling.
  // --- resistance and brakes ------------------------------------------------
  // FOUR CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK. All four were
  // fitted against the kinematic `revs = speed / ratio` drivetrain, and all
  // four are things the engine gets for free out of the EngineGrip target:
  //
  //   `rollingResistance 0.55`  a always-on drag. The engine has none. Off
  //   `engineBraking 0.4`       the pedal the rev state decays toward zero
  //                             with a 40-tick time constant, the target
  //                             `ratio * revs` decays with it, and the wheel
  //                             asks for `T - Vt` — a deficit that grows as
  //                             the target falls. That IS the coast, and it
  //                             is a firm one: the engine really does stop a
  //                             BF1942 jeep in a couple of seconds.
  //   `brakeDecel 8`            a brake force. The engine's brake is the byte
  //                             `PhysicsEngine+0xb4`, which `addFriction`
  //                             tests at `0x0825c28a` to **discard the target
  //                             entirely** (`0x0825c293` zeroes it): the
  //                             wheel then asks for `0 - Vt`, its whole
  //                             contact velocity back, and the Coulomb clamp
  //                             decides how much of that the ground answers.
  //                             So the brake is exactly `mu * |g|` and 8 was
  //                             below even mud's 11.0.
  //   `reverseBelow 0.5`        a speed under which an opposed pedal stops
  //                             braking and starts driving. The engine has no
  //                             such threshold: the brake byte is set while
  //                             the pedal opposes the REV DIRECTION, so it
  //                             clears by itself the moment the revs cross
  //                             zero and reverse drive begins from there.

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

    const speed = s.velocity.length();

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
        // speed the engine is commanding (TANK-9's EngineGrip target), over
        // the wheel's own radius. Unloaded there is no friction to feed the
        // load, so the rev filter climbs to the ceiling on its own and the
        // target comes out at the redline without anything saying so here.
        if (wheel.driven) {
          wheel.angle += (engine.target(0) / k.wheelRadius) * h;
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

      // Everything below is per-contact ACCELERATION, unweighted — the
      // currency the engine's solver works in, a wanted velocity change over
      // one tick, capped at `A * N.y * |g|` with no load in it. This wheel's
      // share of standing weight is applied once, at the end.
      const gShare = load / -GRAVITY;

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
      let aLat = -uLat * ENGINE_TICK_HZ;

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
      if (wheel.driven) {
        aLong = (engine.target(0, uLong) - uLong) * ENGINE_TICK_HZ;
      }

      // The friction circle, with the engine's own coefficient and its 1.5:1
      // break-away hysteresis (PHY-2). The budget is the mean of the two
      // contacting materials, so the same jeep has 0.9 on grass and 0.75 in
      // mud; the clamp scales the pair and so keeps the direction of the
      // demand, which is what makes a drive-saturated axle understeer instead
      // of doing something creative.
      const caps = coulombCaps(wheel.friction);
      const demand = Math.hypot(aLong, aLat);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      staticBudget += caps.breakaway * gShare;
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
      const fLong = aLong * gShare;
      const fLat = aLat * gShare;

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

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `ratio = 3.5 *
 * setDifferential / curve[idx]`. Declared again here (rather than imported)
 * because `flight.js` keeps its own copy private, the same way that file's
 * own gravity constant is "kept local... until physics.js... grows a shared
 * constants module". */
const ENGINE_RATIO_SCALE = 3.5;

/**
 * `setEngineType`'s enum, and it is a **bitfield** — re-derived from the
 * 26-entry jump table at `0x086cf7b0` that `operator<<(ostream&, EngineType)`
 * (`0x0823ef60`) switches on, each index matched to the case body that pushes
 * its string. `EngineTemplate::getEngineType()` is **virtual slot `+0xa0`**
 * (vtable `0x0872bd80`, vptr symbol+8 = `0x0872bd88`, slot → `0x0823fd00`),
 * which is why an exhaustive grep for direct `call` sites once found none and
 * ledger TANK-1 said nothing read it. There are nine call sites.
 *
 *   bit 0 (1)   propeller / thrust physics — the ONLY gate on
 *               `PhysicsEngine::updatePhysics`, which **returns at its second
 *               instruction** without it (`0x0824cc10`-`0x0824cc20`)
 *   bit 1 (2)   ground drivetrain: `feedbackLoop` clamps its load to [-1, +1]
 *   bit 2 (4)   differential steering, and the ±1 clamp that comes with it
 *   bit 3 (8)   thrust rather than propeller spin (ship, torpedo)
 *   bit 4 (16)  pinned throttle (rocket, torpedo)
 *
 * `c_ETCar` (2) and `c_ETTank` (6) both clear bit 0. **A ground vehicle gets
 * no hull thrust at all** — ledger TANK-7, refuted; `subsystems/
 * tank-driving.md` §5.
 */
export const ENGINE_TYPES = {
  c_etplane: 1, c_etcar: 2, c_ettank: 6,
  c_etship: 9, c_etrocket: 0x11, c_ettorpedo: 0x19,
};

/** `updatePhysics`'s gate: propeller/thrust physics. No ground vehicle. */
export const ENGINE_BIT_THRUST = 1;
/** `feedbackLoop` clamps its load sample to [-1, +1] (`0x0824c8ab`). */
export const ENGINE_BIT_LOAD_CLAMP = 2;
/** `getCurrentDifferentialRPM` splits and clamps per side (`0x0824c90f`). */
export const ENGINE_BIT_DIFFERENTIAL = 4;

/**
 * The bits an `engineType` name carries. **The `EngineTemplate` constructor's
 * own default is 0** (`0x0823f078 mov DWORD PTR [ebx+0x524],0x0`) — no bits,
 * so no `updatePhysics`, no differential and no load clamp — and an unknown
 * name has to read as that rather than as a guess. It costs nothing in the
 * installed corpus: **every one of the 1,309 ground-vehicle Engines across
 * the 18 installs authors `setEngineType`** (824 `c_ETTank`, 394 `c_ETCar`,
 * 91 `c_ETShip` on the amphibians' second engine), none leaves it unset.
 */
export function engineTypeBits(name) {
  return ENGINE_TYPES[String(name ?? '').toLowerCase()] ?? 0;
}

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
 * **This is the `engineType & 4` branch on its own.** The function the engine
 * calls is `getCurrentDifferentialRPM`, which tests the type first and
 * returns the rev state **raw and unclamped** when the bit is clear — see
 * `currentDifferentialRPM`. A car has wheels well off its centreline (a
 * Willy's rear springs sit at x = ±0.6) and must not reach this.
 *
 * @param {number} revs the engine's rev state, `PhysicsEngine+0xa0`. NOT the
 *   pedal: `getCurrentDifferentialRPM` loads `+0xa0` at `0x0824c9c0`
 * @param {number} steer `PhysicsEngine+0xb0`, the clipped yaw angle over
 *   `maxRotation.x`, -1..1
 * @param {number} side sign of the wheel's local X in the vehicle frame
 */
export function differentialRPM(revs, steer, side) {
  if (side === 0) return revs;
  const factor = side > 0 ? 1 - 1.5 * steer : 1 + 1.5 * steer;
  return Math.max(-1, Math.min(1, revs * factor));
}

/**
 * `PhysicsEngine::getCurrentDifferentialRPM(float side)` whole, `0x0824c990`,
 * hand-decoded flag by flag (the x87 trap that has bitten this corpus): the
 * type test at `0x0824c9d1`-`0x0824c9e0` is `and eax,0x4; je` straight to the
 * return, so
 *
 *   (type & 4) == 0   ->  the rev state, RAW — a car runs to +1.2
 *   (type & 4) != 0   ->  clamp(revs * (1 -/+ 1.5*steer), -1, +1)
 *   side == 0         ->  the rev state raw, even on a tank (0x0824ca4a)
 *
 * **This is where a tank's 1.0 ceiling lives** — not in the rev clamp, which
 * is `[-1.0, +1.2]` for every type alike (ledger TANK-9, TANK-12). So the
 * Sherman tops out at `ladder[5] * 1.0` = 14.89 m/s and the Willys at
 * `ladder[5] * 1.2` = 31.28.
 */
export function currentDifferentialRPM(revs, steer, side, bits) {
  if ((bits & ENGINE_BIT_DIFFERENTIAL) === 0) return revs;
  return differentialRPM(revs, steer, side);
}

// THERE IS NO `bodyThrust` IN THIS FILE ANY MORE, and nothing here may grow
// one back. It used to carry `PhysicsEngine::updatePhysics`'s propeller
// expression — `e = thr - v/noPropellerEffectAtSpeed`, `K = 0.1|thr| + e|e|`,
// `a = fwd*K*ratio` (`0x0824cf45`-`0x0824cf78`) — and apply it to a hull.
// That whole function is behind `getEngineType() & 1`, and the gate is not a
// gate on a block: `0x0824cc04 mov eax,[edi+0x9c]; 0x0824cc10 call [edx+0xa0];
// 0x0824cc16 and eax,0x1; 0x0824cc1e jne 0x0824cc28`, and the fall-through at
// `0x0824cc20` is the epilogue. **`c_ETCar` (2) and `c_ETTank` (6) clear bit 0
// and the function returns at its second instruction.** A ground vehicle gets
// no hull thrust, no `feedbackLoop` from that path, and never reaches
// `noPropellerEffectAtSpeed` (`tmpl+0x520`, read only at `0x0824cf45` inside
// `&1` AND `&8`). Ledger TANK-7, refuted; TANK-1's "nothing calls
// getEngineType" refuted with it. `flight.js` keeps the aircraft's own copy of
// the propeller law, which is where it belongs.
//
// What propels a ground vehicle — car and tank alike — is the EngineGrip
// contact-speed target below, on its `c_PGFEngineGrip` springs.

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
 * `b` is **PhysicsEngine** `+0xb8` (the object at `Engine+0x60`, not the
 * Engine itself), and it is **a one-shot lockout, not a constant**:
 * `Engine::handleUpdate` `0x0823e120` counts it down by `dt/gearChangeTime`
 * to zero (`0x0823e24f`/`0x0823e25a`), and a whole-binary store scan finds no
 * other writer at all -- not even a gear change re-arms it (ledger TANK-9,
 * TANK-12). So after the first `gearChangeTime` of a vehicle's life (0.05 s
 * for the Sherman and M3A1, the constructor's 1.0 s for the Willys) `b = 0` and
 *
 *   T = ratio * differentialRPM(side)      -> dV = T - Vt, zero at v = T
 *
 * The old reading took the constructor's seed `+0xb8 = 1.0` (`0x0824c756`
 * region) for the steady value and landed on a factor of **0.5**, which made
 * every gear's ceiling half what the engine gives. `differentialRPM` returns
 * the engine's **rev state** `+0xa0` (`0x0824c990`), not the pedal, so the
 * ceiling is `ratio * revs` and revs runs to `ENGINE_REV_CEILING`.
 *
 * @param {number} revs the engine's rev state, NOT the pedal
 * @param {number} [blend] the live gear-change timer `+0xb8`, 1 at the
 *   instant of a change and 0 in all steady driving
 * @param {number} [contactSpeed] `Vt . fwd`, the second term's input
 * @param {number} [bits] `getEngineType()`. Defaults to the differential bit
 *   because that is the branch this helper was written to pin; `EngineState`
 *   passes its vehicle's own, so a car's wheels never take the split
 */
export function engineGripTarget(revs, steer, side, ratio,
    blend = 0, contactSpeed = 0, bits = ENGINE_BIT_DIFFERENTIAL) {
  const b = Math.max(0, Math.min(1, blend));
  return (1 - 0.5 * b) * ratio * currentDifferentialRPM(revs, steer, side, bits)
    + 0.5 * b * contactSpeed;
}

/**
 * The engine's own rev ceiling, and the number `revLimit 356` was standing in
 * for. `Engine::handleUpdate` `0x0823e120` runs the rev state as a first-order
 * filter on the throttle and the drivetrain load,
 *
 *   revs += 0.05 * ((T1 - load) - 0.5*revs)        // 0x0823e2bf; fixed point 2*(T1-load)
 *   revs  = min(1.2, max(-1.0, revs))              // 0x0823e2f4 (ceiling), 0x0823e30b (floor)
 *
 * `T1` is not the raw pedal: it is the engine's clipped RotationalBundle roll
 * angle over `maxRotation.z` (`0x0823e1e0`-`0x0823e1f4`), which reaches 1.0
 * within about 0.1 s of full throttle on all three vanilla drivetrains. The
 * 0.05 is per engine tick, NOT scaled by dt. `EngineState` below carries the
 * whole filter; the kinematic `speed / ratio` inversion this file used to run
 * is gone (ledger TANK-12).
 *
 * **The clamp itself is type-independent.** Both arms apply to every engine
 * type alike; a tank's 1.0 comes from `getCurrentDifferentialRPM`'s own `& 4`
 * clamp, not from here. See `currentDifferentialRPM`.
 *
 * So an open throttle against no load pins revs at **1.2**, not 1. That is
 * what puts a Willy's top gear at `1.2 * 26.064` = 31.3 m/s rather than at
 * `ladder[top]`, and a Sherman's at `1.0 * 14.894` = 14.89. The asymmetric
 * floor of -1.0 is the engine's too, and is why reverse is slower than first.
 */
export const ENGINE_REV_CEILING = 1.2;

/** The same clamp's lower arm, `0x0823e30b`-`0x0823e31e`: revs floor at -1.0. */
export const ENGINE_REV_FLOOR = 1.0;

/**
 * `ds:0x86c08a8`, raw `cd cc 4c 3d` = 0.05f. The rev filter's gain, applied
 * **per `Engine::handleUpdate` call and NOT scaled by `dt`** — the only uses
 * of `dt` in that whole function are `fdiv [esi+0x374]` (the gear-change
 * lockout) at `0x0823e23f` and three `calculateAndClipAngle` calls. So the
 * filter's time constant is 40 engine ticks whatever the tick rate is, and
 * a viewer that normalises it per second gets the wrong spool-up.
 */
const ENGINE_REV_FILTER_GAIN = 0.05;

/**
 * `ds:0x86d0cdc`, raw `a4 70 7d 3f` = 0.99f. The car branch of
 * `feedbackLoop`'s running mean, `L = (L*n + L0) * 0.99 / (n + 1)`
 * (`0x0824c952`-`0x0824c97e`).
 */
const ENGINE_LOAD_MEAN_SCALE = 0.99;

/**
 * `setNumberOfGears` `0x0823fd10` **clamps its argument to [1, 5]**
 * (`cmp edx,0x5; jle` then `mov edx,5`; `test edx,edx; jle` then `mov edx,1`),
 * so TANK-3's non-monotonic `nGears 8` ladder is real in the curve but
 * unreachable from any `.con`. `gearLadder` deliberately does NOT clamp — it
 * is the curve, and the curve is what the ledger pins — so the clamp lives
 * here, where a template is read.
 */
const ENGINE_MAX_GEARS = 5;

/** `EngineTemplate`'s own constructor defaults, `0x0823efc0`: gears 1
 * (`0x0823f018`), differential 10.0 (`0x0823f022`), torque 60.0
 * (`0x0823f02c`), gearUp 0.7 (`0x0823f036`), gearDown 0.3 (`0x0823f040`),
 * gearChangeTime 1.0 (`0x0823f04a`), engineType 0 (`0x0823f078`). Used when a
 * `.con` omits the word, which is why they are transcribed rather than
 * invented. */
const ENGINE_DEFAULTS = {
  numberOfGears: 1, differential: 10.0, torque: 60.0,
  gearUp: 0.7, gearDown: 0.3, gearChangeTime: 1.0,
};

/**
 * The engine's own simulation tick, and the rate `EngineState.advance` steps
 * the filter at.
 *
 * `g_simulationFps` (`0x08716b5c`, raw `0000f041` = 30.0) is the figure the
 * friction budget above already spends, and **ledger LOOP-1 is CLOSED on it**
 * (2026-09-20): the simulation is a fixed 30 Hz tick, `dt = 1/30` exactly, on
 * client and server alike — `Setup::updateInputs` `0x080bc540` is an
 * accumulator, and the only `dt` that ever reaches `simulateFrame` is the
 * tick's own. The earlier "the loop targets `2 * g_simulationFps` and stores
 * a measured frame time" reading was of the render loop, not the simulation,
 * and nothing in this file hedges against it any more.
 *
 * So the filter runs at 30 Hz on an accumulator independent of the viewer's
 * own sub-step rate, which is also what makes spool-up frame-rate
 * independent. The 40-tick time constant is 1.33 s of wall clock.
 */
const ENGINE_TICK_SECONDS = 1 / ENGINE_TICK_HZ;

const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

/**
 * The whole of `Engine::handleUpdate` (`0x0823e120`) and the drivetrain half
 * of `PhysicsEngine` — the rev filter, the gearbox, the brake byte, the
 * gear-change lockout and `feedbackLoop`'s load accumulator — as one object
 * both vehicle classes own. Ledger TANK-12 and TANK-13.
 *
 * What it replaces: `GroundVehicle` used to invert `revs = speed / ratio`
 * kinematically and `TrackedVehicle` had no rev state at all. The inversion
 * reaches the same ceiling but not the same spool-up, has no behaviour after
 * a shift, and cannot express the thing that actually governs a Refractor
 * drivetrain — **the load feedback**. In the engine, hard acceleration makes
 * `feedbackLoop`'s load large, the load pulls revs down, low revs lower the
 * EngineGrip target, and the target is the whole of the propulsion. That loop
 * is why `setTorque` matters (as the load's *divisor*, TANK-13) and why a
 * 25-tonne Sherman and a 2.5-tonne jeep with the same ratios would not drive
 * alike.
 *
 * Live fields carry their engine offsets: `revs` is `PhysicsEngine+0xa0`,
 * `load` `+0xa4`, `loadCount` `+0xac`, `steer` `+0xb0`, `braking` `+0xb4`,
 * `blend` `+0xb8`, `gear` `+0xbc`; `rollAngle`/`yawAngle` are the
 * `RotationalBundle` angles at `Engine+0x10c` / `+0x104`.
 */
export class EngineState {
  /**
   * @param {object} [physics] the Engine node's `extras.physics`
   * @param {boolean} [automaticReset] the Engine's `rig.automaticReset`
   */
  constructor(physics = {}, automaticReset = true) {
    const pick = (value, fallback) =>
      (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    this.torque = pick(physics.torque, ENGINE_DEFAULTS.torque);
    this.differential = pick(physics.differential, ENGINE_DEFAULTS.differential);
    this.numberOfGears = Math.max(1, Math.min(ENGINE_MAX_GEARS,
      Math.round(pick(physics.numberOfGears, ENGINE_DEFAULTS.numberOfGears))));
    this.gearUp = pick(physics.gearUp, ENGINE_DEFAULTS.gearUp);
    this.gearDown = pick(physics.gearDown, ENGINE_DEFAULTS.gearDown);
    this.gearChangeTime = pick(physics.gearChangeTime, ENGINE_DEFAULTS.gearChangeTime);
    this.engineType = physics.engineType ?? null;
    this.bits = engineTypeBits(this.engineType);
    // The Engine's own RotationalBundle, which is what the throttle and the
    // steer are read through. `maxRotation` is the divisor; the rate is
    // `setAcceleration` under the `automaticReset` law (GUN-2) and falls back
    // to `setMaxSpeed`, which every vanilla ground drivetrain authors equal
    // to it. Yaw/Pitch/Roll order, straight off the `.con`.
    const maxRotation = physics.maxRotation || [0, 0, 0];
    const rate = physics.acceleration || physics.maxSpeed || [0, 0, 0];
    this.maxRollAngle = Math.abs(maxRotation[2] || 0);
    this.maxYawAngle = Math.abs(maxRotation[0] || 0);
    this.rollRate = Math.abs(rate[2] || 0);
    this.yawRate = Math.abs(rate[0] || 0);
    this.automaticReset = automaticReset !== false;
    /** `getCurrentRatio()` for every gear (TANK-3). */
    this.ladder = gearLadder(this.differential, this.numberOfGears);

    /** `PhysicsEngine+0xbc`, 1-based. The engine seeds it to 1 and
     * `handleUpdate` is the only thing that ever writes it again — which the
     * old TANK-7 reading denied, and is why a Sherman used to be stuck in
     * first gear at 41 km/h instead of climbing to 53.6. */
    this.gear = 1;
    /** `PhysicsEngine+0xa0`, the filtered rev state, [-1.0, +1.2]. */
    this.revs = 0;
    /** `PhysicsEngine+0xb8`. The two `PhysicsEngine` constructors seed it to
     * **1.0** (`0x0824c74c`, `0x0824c7cc`) and `handleUpdate` counts it down
     * by `dt/gearChangeTime`; a whole-binary store scan finds no other writer
     * at all — **not even a gear change re-arms it**. So it is a one-shot
     * lockout that expires `gearChangeTime` into the object's life and stays
     * expired, and the old "steady factor of ½" reading mistook this seed for
     * a steady value and halved the whole fleet. */
    this.blend = 1.0;
    /** `Engine+0x10c` / `+0x104`: the clipped bundle angles, in the `.con`'s
     * own units (a Willy's roll runs to ±5000, a Sherman's to ±1). */
    this.rollAngle = 0;
    this.yawAngle = 0;
    /** `T1`, the rev filter's command: `rollAngle / maxRotation.z`. */
    this.throttleTerm = 0;
    /** `PhysicsEngine+0xb0`: `yawAngle / maxRotation.x`. */
    this.steer = 0;
    /** `PhysicsEngine+0xb4`, and it is a hard cut rather than a brake force:
     * `addFriction` discards the whole EngineGrip target when it is set
     * (`0x0825c28a`/`0x0825c293`), so the wheel asks for `0 - Vt` — all of its
     * contact velocity back, at whatever the ground can answer. */
    this.braking = false;
    /** `PhysicsEngine+0xa4`/`+0xac`/`+0xa8`. */
    this.load = 0;
    this.loadCount = 0;
    this.prevLoad = 0;
    this._clock = 0;
  }

  /** `PhysicsEngine::getCurrentRatio()` at the live gear. */
  get ratio() {
    return this.ladder[Math.min(this.ladder.length, Math.max(1, this.gear)) - 1];
  }

  /** `PhysicsEngine::getCurrentTorque()`: the TANK-4 curve at the live revs,
   * times `setTorque`. It is the **divisor of the load** (TANK-13), never a
   * multiplier on drive — at redline it returns 0.70x and so *raises* the
   * load feedback rather than adding power. */
  get torqueNow() {
    return engineTorqueFraction(this.revs) * this.torque;
  }

  /**
   * The EngineGrip contact-speed target for a wheel on `side`, in **metres
   * per second of contact-patch velocity** — no wheel radius anywhere on this
   * path (`SpinWheel` `0x0825b440` *divides* by one, for the visual angle
   * only). TANK-9 as corrected.
   *
   * @param {number} side sign of the wheel's local X
   * @param {number} [contactSpeed] `Vt . fwd`, for the gear-change blend
   */
  target(side, contactSpeed = 0) {
    if (this.braking) return 0;
    return engineGripTarget(this.revs, this.steer, side, this.ratio,
      this.blend, contactSpeed, this.bits);
  }

  /**
   * One contact's clamped longitudinal velocity change, as
   * `PhysicsEngine::feedbackLoop` (`0x0824c850`) takes it. TANK-13.
   *
   *   L0 = dot(dV, fwd) * getCurrentRatio() / getCurrentTorque()
   *   (type & 2)  ->  L0 clamped to [-1, +1]              (car AND tank)
   *   (type & 4)  ->  L is the frame MAX when revs > 0, the frame MIN when
   *                   revs <= 0                            (tank)
   *   else        ->  L = (L*n + L0) * 0.99 / (n + 1)      (car)
   *
   * **The min/max are that way round**, decoded from `0x0824c91f`'s
   * `fldz; fucompp` (ST = 0.0, SRC = revs, so `revs > 0` takes the `jne` to
   * `0x0824c942`, whose `fucom` keeps `L0` only when `L0 > L`). The
   * v4-gearbox verdict states them inverted. Physically the max is the one
   * that can hold an engine down, and the pair is symmetric in reverse.
   *
   * **Only a `c_PGFEngineGrip` wheel feeds it.** `addFriction` dispatches on
   * the grip byte at `0x0825baf1`-`0x0825bafe` (`mov dl,[esi+0xb4];
   * and eax,0x4; test al,al; jne 0x0825c1b0`), and the `0x4` branch is the
   * only one that walks the node's ancestors for a `PhysicsEngine`
   * (`0x0825c1b0`-`0x0825c1fa`, storing it at `0x0825c556`). A RollGrip wheel
   * takes the `0x2` branch at `0x0825bb04` instead, so the pointer stays null
   * and the guard at `0x0825bc19` skips the call. The load is therefore the
   * mean over the DRIVEN wheels alone.
   *
   * Getting this wrong is not academic: counting a jeep's two free-rolling
   * fronts as zero samples halves the load, which pins the revs at
   * `2*(1 - 0.5)` = 1.0 — just above `gearUp 0.95` — so the box shifts
   * straight to top under full wheelspin and stays there. On Wake that jeep
   * never left second gear's worth of speed; it sat in fifth doing donuts.
   *
   * @param {number} dvLong metres per second per **engine tick**
   */
  sample(dvLong) {
    let l0 = dvLong * this.ratio / Math.max(1e-6, Math.abs(this.torqueNow));
    if (!Number.isFinite(l0)) return;
    if (this.bits & ENGINE_BIT_LOAD_CLAMP) l0 = clamp(l0, -1, 1);
    if (this.bits & ENGINE_BIT_DIFFERENTIAL) {
      if (this.revs > 0) { if (l0 > this.load) this.load = l0; }
      else if (l0 < this.load) this.load = l0;
      return;
    }
    const n = this.loadCount;
    this.load = (this.load * n + l0) * ENGINE_LOAD_MEAN_SCALE / (n + 1);
    this.loadCount = n + 1;
  }

  /**
   * Carry the engine forward by `dt` of wall time, running whole
   * `ENGINE_TICK_SECONDS` ticks. The viewer sub-steps faster than the engine
   * does (60 Hz for a car, 120 for a tank, against the engine's 30), exactly
   * as `PointPhysicsNode` sub-steps inside one tick — so the load samples of
   * several sub-steps land in one tick's accumulator, which is what the
   * engine does too.
   */
  advance(dt, throttle, yaw) {
    this._clock += dt;
    let ticks = 0;
    while (this._clock >= ENGINE_TICK_SECONDS && ticks < 8) {
      this._clock -= ENGINE_TICK_SECONDS;
      this.tick(ENGINE_TICK_SECONDS, throttle, yaw);
      ticks += 1;
    }
    // A frame longer than eight engine ticks is a stall, not a simulation;
    // drop the backlog rather than spending minutes of spool-up in one frame.
    if (ticks >= 8) this._clock = 0;
  }

  /** One `Engine::handleUpdate`. */
  tick(dt, throttle, yaw) {
    const pedal = clamp(throttle, -1, 1);
    const steerInput = clamp(yaw, -1, 1);

    // The two RotationalBundle axes, under `setAutomaticReset`'s own law
    // (GUN-2): the angle ramps straight toward `input * maxRotation` at the
    // declared rate, in units per second, with no velocity register. Every
    // car/tank Engine in the 18 installs but one authors the flag. A Willy
    // reaches full roll in 5000/55000 = 0.091 s, a Sherman in 1/10 = 0.1 s,
    // and a Sherman's steer reaches full lock in 1/4 = 0.25 s.
    this.rollAngle = this.#ramp(this.rollAngle, pedal * this.maxRollAngle,
      this.rollRate * dt, this.maxRollAngle);
    this.yawAngle = this.#ramp(this.yawAngle, steerInput * this.maxYawAngle,
      this.yawRate * dt, this.maxYawAngle);
    // `T1 = Engine+0x10c / getMaxRotation().z` (0x0823e1e0-0x0823e1f4). An
    // Engine that declares no roll limit has nothing to divide by — no
    // ground vehicle in the 18 installs is in that position, all 1,421 of
    // them author a non-zero `maxRotation.z` — so the fallback is the pedal
    // itself, which is what the ratio converges to anyway.
    this.throttleTerm = this.maxRollAngle > 0
      ? this.rollAngle / this.maxRollAngle : pedal;
    this.steer = this.maxYawAngle > 0 ? this.yawAngle / this.maxYawAngle : 0;

    // The gear-change lockout counts down and is never re-armed (0x0823e24f,
    // 0x0823e25a).
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend
        - dt / Math.max(1e-6, this.gearChangeTime));
    }

    // The brake byte: the pedal opposing the rev direction, against literal
    // ±0.1 doubles (`ds:0x86cf658`, `ds:0x86ba1d8`). Read off `Engine+0x124`,
    // the RAW input, not the clipped angle.
    this.braking = (pedal < -0.1 && this.revs > 0)
      || (pedal > 0.1 && this.revs < 0);

    // The filter itself. `0.05` is per call; the whole point of TANK-12.
    const delta = ENGINE_REV_FILTER_GAIN
      * ((this.throttleTerm - this.load) - 0.5 * this.revs);
    this.revs = clamp(this.revs + delta, -ENGINE_REV_FLOOR, ENGINE_REV_CEILING);

    // Up needs the lockout expired, down does not (0x0823e391-0x0823e3f1).
    // The engine falls THROUGH the up-shift into the down-shift test, so both
    // run in one tick; with gearUp 0.95 against gearDown 0.4 the second can
    // never fire after the first.
    if (this.revs > this.gearUp && this.blend === 0
        && this.gear < this.numberOfGears) {
      this.gear += 1;
    }
    if (this.revs < this.gearDown && this.gear > 1) this.gear -= 1;

    // The tail: last tick's load is kept and the accumulator cleared, so the
    // samples `addFriction` adds after this belong to the next tick.
    this.prevLoad = this.load;
    this.load = 0;
    this.loadCount = 0;
  }

  /** Park it: the engine's own construction state. */
  reset() {
    this.gear = 1;
    this.revs = 0;
    this.blend = 1.0;
    this.rollAngle = 0;
    this.yawAngle = 0;
    this.throttleTerm = 0;
    this.steer = 0;
    this.braking = false;
    this.load = 0;
    this.loadCount = 0;
    this.prevLoad = 0;
    this._clock = 0;
  }

  #ramp(angle, wanted, step, limit) {
    let next = angle;
    if (wanted > angle) next = Math.min(wanted, angle + step);
    else if (wanted < angle) next = Math.max(wanted, angle - step);
    // `calculateAndClipAngle`'s clip, with the template's symmetric limits.
    return limit > 0 ? clamp(next, -limit, limit) : next;
  }
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

  // `mu 1.1` is gone: a track wheel's material (38, 178) is as undefined in
  // vanilla as a jeep's 37, so all of them fall back to material 0 at 1.0 and
  // the coefficient comes from the ground, per wheel, like everyone else's
  // (PHY-2). There never was a tank-specific reading to lose.
  //
  // The ANISOTROPY is gone too, with the same four names `WILLYS` lists —
  // `lateralGripFraction 0.5`, `corneringStiffness 12`,
  // `frontAxleCorneringStiffness 7`, `slipFloor 1.0`. The ellipse existed to
  // stop a track that resisted sliding sideways as hard as it gripped
  // lengthwise from rolling the hull over. With RollGrip written out, the
  // lateral demand competes with the drive for one isotropic budget instead
  // of being added to it, and a tank that is driving has no spare lateral
  // force to roll itself with: measured `worstUp >= 0.974` at every yaw from
  // 0.3 to full lock on both hulls, and >= 0.987 entering a turn from
  // straight-line top speed — the two cases the ellipse was fitted against.

  // THREE CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK.
  //
  //   `rollingResistance 0.5`  a free-rolling front axle's drag. The engine
  //                            gives a RollGrip wheel NO longitudinal demand
  //                            at all (collision-response.md section 8):
  //                            `dV = -(Vt along the axle)`, lateral only.
  //   `trackResistance 0.25`   a fitted damper toward the track's target,
  //                            standing in for the engine's own `x30` on that
  //                            exact term. It was fitted against an M3A1 gear
  //                            ratio of 17.5 that TANK-3 refuted, then
  //                            re-fitted in the same breath against a body
  //                            thrust TANK-7 refuted. Both of its anchors are
  //                            gone; the term it stood in for is now written
  //                            out, so it is retired rather than re-fitted a
  //                            third time.
  //   `trackDifferential 20`   a hand-built steering couple, needed only
  //                            because `bodyThrust` propelled the hull and
  //                            the wheels' own targets had nothing to do. The
  //                            differential is now where the engine puts it —
  //                            in the two sides' contact-speed targets — and
  //                            the hull turns because they differ, with
  //                            nothing applying a yaw torque to it
  //                            (tank-driving.md section 5).

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
    const speed = s.velocity.length();

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
        // Airborne and driven: the track keeps moving at its commanded
        // surface speed against nothing, over its own radius (`SpinWheel`
        // `0x0825b440` is `speed / radius`, visual only — TANK-8).
        if (wheel.driven) {
          wheel.angle += (engine.target(wheel.side) / wheel.radius) * h;
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

      // Everything below is per-contact ACCELERATION, unweighted, which is
      // the currency the engine's solver works in — a wanted velocity change
      // over one tick, capped at `A * N.y * |g|` with no load in it. This
      // wheel's share of standing weight is applied once, at the end, when
      // the answer becomes a force on the hull.
      const gShare = load / -GRAVITY;

      // Lateral: **RollGrip**, the same demand `GroundVehicle` now carries —
      // the component of the contact velocity along the wheel's own axle,
      // asked for back in full inside one tick. A dummy roller gets nothing
      // at all: `addFriction` returns at `0x0825b7xx` for the DummyGrip bit
      // before any of this, so it is not even a zero sample.
      let aLat = wheel.dummy ? 0 : -uLat * ENGINE_TICK_HZ;

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
      if (wheel.driven && !wheel.dummy) {
        aLong = (engine.target(wheel.side, uLong) - uLong) * ENGINE_TICK_HZ;
      }

      // The friction CIRCLE, isotropic on the tangential plane exactly as
      // PHY-2 reads it — the ellipse this class used to carry is gone with
      // `lateralGripFraction`. The magnitude is the pair of materials' and so
      // is the 1.5:1 break-away hysteresis; nothing about the shape is this
      // file's any more.
      const caps = coulombCaps(wheel.friction);
      const demand = Math.hypot(aLong, aLat);
      const grip = coulombClamp(demand, caps, wheel.staticGrip);
      wheel.staticGrip = grip.latched;
      if (!grip.latched) allLatched = false;
      staticBudget += caps.breakaway * gShare;
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
      const fLong = aLong * gShare;
      const fLat = aLat * gShare;

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
        ? engine.target(wheel.side) / wheel.radius
        : uLong / wheel.radius) * h;
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
    // Back to the engine's own construction state: gear 1, no revs, and the
    // gear-change lockout re-seeded at 1.0 the way a fresh `PhysicsEngine` is.
    this.engine.reset();
    this._staticQuiet = 0;
    this._staticHeld = false;
    s.position.copy(this.node.userData.spawnPosition || s.position);
    s.orientation.copy(this.node.userData.spawnOrientation || s.orientation);
  }
}
