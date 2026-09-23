// One `PointPhysicsNode`, and the world constants its update reads: gravity,
// wind, the four sub-steps and the submersion drag scale.
//
// Split out of `physics.js`, which re-exports all of it; see that file's header
// for the engine facts behind these numbers.

// --- the world's constants -------------------------------------------------

/**
 * Metres per second squared, downward. `BasicPhysicsSystem::BasicPhysicsSystem`
 * at `0x00578f00` writes `0xC16BAE14` into the gravity field; all 31 references
 * to the singleton were audited and nothing overrides it at init or map load.
 * The only writers are the three chat cheats at `0x00729b30` (EarthWalk -10,
 * MoonWalk -1.67, SpaceWalk -0.1), which is itself the proof that -14.73 is the
 * value the game ships with.
 */
export const GRAVITY = -14.73;

/** Wind, a world property beside gravity. Zero in every vanilla level. */
export const WIND = Object.freeze({ x: 0, y: 0, z: 0 });

/** Sub-steps per update, and the `h = dt * 0.25` at `0x00578aa8`. */
export const SUB_STEPS = 4;

/**
 * The 25x multiplier in the drag scale at `0x00578990`. **PHY-7, confirmed.**
 *
 *     scale = 1 + 24 * min(underWater / boundingRadius, 1)
 *
 * applied to the velocity before the wind is subtracted. Field `+0x44` no
 * longer needs hedging: it is written by `PointPhysicsNode::setUnderWater`
 * (lnxded `0x08256ad0`) and read by `getUnderWater` (`0x08256ae0`), so it is
 * **submersion depth in metres**, not a fraction and not a flag. The vehicle
 * sibling `PhysicsNode::setUnderWater` (`0x0824d430`) keeps the same quantity at
 * `+0x8c`, and `StaticPhysicsNode`'s is a no-op returning `fldz`.
 *
 * The 24 is `25.0 - 1` with the 25.0 at `0x086ccce0`; the law was re-derived
 * from `PointPhysicsNode::updatePhysics` `0x082562f2`-`0x08256320`. A fully
 * submerged body therefore drags 25x, which is what wading is supposed to cost.
 * The depth is divided by the body's own bounding radius, so for a soldier
 * (`SOLDIER_BOUNDING_RADIUS`, still inferred) the scale saturates at 0.8 m under.
 */
export const DRAG_SUBMERSION_SCALE = 24;

// --- a point body ----------------------------------------------------------

/**
 * One `PointPhysicsNode`: a position, a velocity, and an acceleration
 * accumulator that is spent and cleared once per update.
 *
 * The accumulator is the part worth understanding. Nothing integrates a force
 * directly; callers *add acceleration* during a frame, the update spends the
 * total in four sub-steps, zeroes it, and then re-seeds gravity for the next
 * update. That ordering is `0x00578ca0` exactly, including the detail that
 * gravity is seeded at the *end*, which is why it is seeded here in the
 * constructor too — otherwise the very first tick of a body's life would fall
 * at zero g.
 */
export class PointBody {
  constructor({
    mass = 100,
    drag = 0,
    boundingRadius = 1,
    gravityModifier = 1,
    position = null,
    velocity = null,
  } = {}) {
    this.mass = mass;
    this.drag = drag;
    // `arg1` to `updatePositionalDragSimple`, taken from virtual slot +0x1c —
    // `getBoundingRadius` by the lnxded vtable order, which is `working`
    // confidence rather than proven. It enters the drag as pi * r^2, i.e. as a
    // frontal area, which is at least consistent with that reading.
    this.boundingRadius = boundingRadius;
    this.gravityModifier = gravityModifier;
    this.position = { x: 0, y: 0, z: 0, ...(position || {}) };
    this.velocity = { x: 0, y: 0, z: 0, ...(velocity || {}) };
    this.accel = { x: 0, y: 0, z: 0 };
    // Where the body was when this update began, and how far it moved. A caller
    // that has to resolve the move against geometry needs both, and a renderer
    // interpolating between ticks needs the first.
    this.previous = { ...this.position };
    this.delta = { x: 0, y: 0, z: 0 };
    this.seedGravity();
  }

  /** `accel.y += gravity * gravityModifier`, the tail of `updatePhysics`. */
  seedGravity() {
    this.accel.y += GRAVITY * this.gravityModifier;
  }

  addAcceleration(ax, ay, az) {
    this.accel.x += ax;
    this.accel.y += ay;
    this.accel.z += az;
  }

  setVelocity(vx, vy, vz) {
    this.velocity.x = vx;
    this.velocity.y = vy;
    this.velocity.z = vz;
  }

  setPosition(x, y, z) {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.previous.x = x;
    this.previous.y = y;
    this.previous.z = z;
  }

  /** Speed through the air, which is what a drag term and a HUD both want. */
  get speed() {
    const v = this.velocity;
    return Math.hypot(v.x, v.y, v.z);
  }

  /**
   * `PointPhysicsNode::updatePositionalDragSimple`, `0x00578990`.
   *
   *     accel -= (scale * v - wind) * pi * r^2 * drag * (1 / mass)
   *
   * Three things about this are not the textbook `-drag * v`, and all three are
   * in the disassembly:
   *
   *   - it is **wind-relative**, so a body at rest in a wind is still pushed;
   *   - it is scaled by **pi * r^2 / mass**, a frontal area over a mass, so the
   *     `.con` `drag` is a coefficient and not the whole story;
   *   - the velocity is pre-multiplied by `scale`, which is 1 unless the body
   *     is under water — see `DRAG_SUBMERSION_SCALE`.
   *
   * `underWater` is **submersion depth in metres** (PHY-7), the quantity
   * `setUnderWater` writes at `+0x44`. It used to be called `submersion` here
   * and documented as unknown; it is neither.
   *
   * Applied once per update on the pre-integration velocity, not once per
   * sub-step. The engine asserts on mass 0 here ("Mass 0 when calculating
   * drag."), so a zero mass is a caller bug rather than a case to handle.
   */
  applyDrag(wind = WIND, underWater = 0) {
    if (!(this.drag > 0) || !(this.mass > 0)) return;
    const r = this.boundingRadius;
    const scale = 1 + DRAG_SUBMERSION_SCALE
      * Math.min(1, Math.max(0, r > 0 ? underWater / r : 0));
    const k = Math.PI * r * r * this.drag / this.mass;
    const v = this.velocity;
    this.accel.x -= (scale * v.x - wind.x) * k;
    this.accel.y -= (scale * v.y - wind.y) * k;
    this.accel.z -= (scale * v.z - wind.z) * k;
  }

  /**
   * The integrator at `0x00578aa0`: four sub-steps of `dt / 4`, each one
   * `v += a*h` and then a position advance with the **updated** v.
   *
   * Written out rather than looped-with-a-vector-class because that is what it
   * is, and because the accumulator has to be zeroed at the end (the engine's
   * epilogue does exactly that, after writing the position through virtual
   * +0x38). Leaving that out is how an acceleration silently applies forever.
   */
  integrate(dt) {
    const h = dt / SUB_STEPS;
    const v = this.velocity;
    const a = this.accel;
    this.previous.x = this.position.x;
    this.previous.y = this.position.y;
    this.previous.z = this.position.z;
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < SUB_STEPS; i++) {
      v.x += a.x * h;
      v.y += a.y * h;
      v.z += a.z * h;
      dx += v.x * h;
      dy += v.y * h;
      dz += v.z * h;
    }
    this.delta.x = dx;
    this.delta.y = dy;
    this.delta.z = dz;
    this.position.x += dx;
    this.position.y += dy;
    this.position.z += dz;
    a.x = 0; a.y = 0; a.z = 0;
  }

  /**
   * One full `PointPhysicsNode::updatePhysics`, `0x00578ca0`: drag, integrate,
   * re-seed gravity for the next one. In that order, and the order matters.
   */
  updatePhysics(dt, { wind = WIND, underWater = 0 } = {}) {
    this.applyDrag(wind, underWater);
    this.integrate(dt);
    this.seedGravity();
  }
}
