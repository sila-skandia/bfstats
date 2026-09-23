// A driven land vehicle's suspension: the spring law (PHY-5) and its axis,
// the `Wheel` read off a `Spring` node, and the probe down the spring axis that
// finds the ground under an axle. Shared by `GroundVehicle`
// (`wheeled-vehicle.js`) and `TrackedVehicle` (`tracked-vehicle.js`), which
// each own their wheels; this module holds no state. Split out of
// `ground-contact.js`, which keeps the tyre's side of the contact.

import { GRAVITY } from './physics.js';
import { WILLYS } from './ground-specs.js';
import { DEFAULT_MATERIAL_FRICTION } from './ground-contact.js';

/** The two grips a wheel declares, and what they mean to the drivetrain. */
const GRIP_DRIVEN = 'c_PGFEngineGrip';

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
export const SPRING_AXIS_Y = 1.0;

/**
 * `strength * g * (-1/9.82)`: 1.5 at the shipped gravity, and derived from
 * `GRAVITY` rather than written as 1.5 so it stays gravity-invariant exactly
 * the way the engine's own expression does.
 */
export const SPRING_GRAVITY_SCALE = GRAVITY * (-1 / 9.82);

/**
 * Below this much of the spring axis pointing at the ground, the probe below
 * is asked to divide by nearly nothing and its Newton step runs away. A hull
 * that far over is not driving anyway, so it falls back to a vertical drop.
 * Numerics, not engine. [free]
 *
 * **KNOWN DEFECT, measured 2026-09-20, not fixed here.** That fall-back is
 * where a tumbling jeep launches itself. Once the hull is past about 60
 * degrees of pitch the vertical `drop` stops meaning anything: an axle that
 * has swung under the ground reads a `compression` of metres, the bump stop
 * multiplies it by `bumpStiffness`, and the whole load is pushed along the
 * hull's own +Y, which at that attitude points sideways or down — so the
 * spring drives the hull further in instead of holding it up. The second half
 * of the same defect is that `dir`/`lat` are the hull's XZ plane rather than
 * the contact plane, so a saturated longitudinal demand on a steeply pitched
 * hull is mostly world-vertical thrust.
 *
 * On the harness's synthetic washboard (0.35 m every 12 m, gentler than
 * Wake's dunes) a full-throttle Willy reaches an apex of **148 m** and
 * **454 km/h**; on `main` the same run stays at 1.13 m and 58 km/h. Tanks and
 * half-tracks stay bounded (1.3 m / 2.2 m) because they never tumble.
 * Returning `Infinity` here instead of `drop` takes 148 m down to 37 m and
 * capping the bump-stop overrun at 0.5 m takes it to 4.9 m, but neither
 * removes the 160-plus km/h, because the thrust half is untouched. The fix is
 * to project the tyre frame onto the contact plane; it is a physics change,
 * not a guard.
 */
export const SPRING_AXIS_FLOOR = 0.2;

/**
 * One wheel, as discovered from the glb: the `Spring` node (which *is* the
 * wheel mesh — `WillyFrontSpringR` carries `geometry Willy_WheelR_M1`), its
 * rest position in the vehicle's own frame, and what the data says about it.
 */
export class Wheel {
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
 * `fromY` is the reference height every ground query on this probe shares: the
 * axle plus the step the vehicle may climb, so a drivable deck within reach is
 * the floor and one above it is not (`WorldCollider.surfaceHeight`). It must be
 * one value for the whole probe — asking the offset sample from a different
 * reference is how a surface stops being a function and the spring starts
 * reading cliffs that are not there.
 *
 * @returns {number} metres along the axis, or Infinity where there is no
 *   ground under it at all
 */
export function probeAlongAxis(groundHeight, attach, axisWorld, fromY) {
  const floor = groundHeight(attach.x, attach.z, fromY);
  if (!Number.isFinite(floor)) return Infinity;
  const drop = attach.y - floor;
  // Past the floor the probe has no answer, and **the honest answer is "no
  // contact"**, not a vertical drop. Returning `drop` there reported the
  // world-vertical distance as a distance along an axis pointing nearly
  // sideways, so a hull tipped past ~78 degrees read its buried axles as
  // metres of compression — loads of 2312 against a standing 4.9 — and the
  // bump stop threw the jeep 148 m into the air off a 0.35 m washboard. A
  // wheel whose spring axis is that far from vertical is not carrying the
  // hull; whatever is holding it up is the hull sweep's problem.
  if (axisWorld.y <= SPRING_AXIS_FLOOR) return Infinity;
  let t = drop / axisWorld.y;
  const px = attach.x - axisWorld.x * t;
  const pz = attach.z - axisWorld.z * t;
  const under = groundHeight(px, pz, fromY);
  if (!Number.isFinite(under)) return t;
  return t + (attach.y - axisWorld.y * t - under) / axisWorld.y;
}

/**
 * How far past its authored travel a spring may be pushed before the probe is
 * simply wrong about where the ground is. The bump stop is `bumpStiffness`
 * times the authored rate, so an unbounded overrun is an unbounded force:
 * this is the depth at which a contact stops being a suspension event and
 * starts being one the hull sweep should have caught. [free, numerics]
 */
export const MAX_OVERRUN = 0.5;
