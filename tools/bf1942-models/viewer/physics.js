// How Refractor moves a thing, and a soldier that walks on it.
//
// Everything in the first half of this file is the retail engine's arithmetic,
// read out of BF1942.exe rather than guessed — the addresses are recorded in
// `features/bf1942-engine-reference/symbols.json`, subsystem `physics`, and
// `./xref.py list physics` prints them. The facts that matter, and that are
// each surprising enough to be worth stating up front:
//
//   - **Gravity is -14.73 m/s^2**, not 9.81 (`BasicPhysicsSystem` ctor,
//     `0x00578f00`). It is a console property with no vanilla `.con` setting it,
//     so the constructor's default is the live value on every map. Everything
//     that falls in this game falls half again as fast as it does on Earth, and
//     the spring solver at `0x0057f0d0` even divides by 9.82 to undo it, which
//     is the strongest evidence the number is meant.
//   - **One update is four sub-steps of dt/4** (`0x00578aa0`), each doing
//     `v += a*h` and *then* advancing the position with the already-updated `v`.
//     That is semi-implicit (symplectic) Euler, four times over.
//   - **Drag is wind-relative and scaled by frontal area over mass**
//     (`0x00578990`), not a plain `-drag * v`. See `applyDrag`.
//   - **Soldier speeds are hardcoded in the executable**, not in any `.con`:
//     two small float tables at `0x009581b4`, indexed by pose and by whether
//     there is any forward input at all.
//   - **Those tables are reached through a ramp** (PHY-6): a signed byte per
//     axis, +20 a tick while held and -12 a tick when released, scaled by
//     1/127. 0.21 s to full speed, 0.35 s to a stop. See `RAMP_ACCEL`.
//   - **The jump is a 6.0 m/s impulse added to the acceleration accumulator**
//     (PHY-1), gated on a contact whose normal.y exceeds 0.1 — not on a slope
//     limit, of which the engine has none. See `JUMP_IMPULSE`.
//   - **The locomotion force applies only when no contact was resolved.**
//     `0.75 * vCmd`, which for a soldier means only in free air; on the ground
//     the friction solver moves him. See `LOCOMOTION_GAIN` and `SoldierBody.step`.
//
// The one deliberate divergence, and it is this module's only one: the outer
// loop here is a **fixed 60 Hz accumulator with render interpolation**, whereas
// `World::update` (`0x004b6cb0`) passes the raw frame dt straight down with no
// accumulator and no clamp anywhere below it. Retail therefore integrates a
// different trajectory on a 30 fps machine than on a 100 fps one. We want the
// opposite: a recorded input stream must replay to the same position on any
// machine, because the end goal of this viewer is replaying captured rounds.
// *Inside* a tick nothing diverges — the four sub-steps are the engine's.
//
// The dedicated server says the same thing, and says which rate to pick. See
// `TICK_RATE`.
//
// Like `collision.js`, this module imports nothing. It takes a duck-typed
// `world` with `surfaceHeight(x, z)`, `sweepSphere(...)` and `cast(...)` —
// which is exactly what `WorldCollider` is — so `tests/physics_harness.mjs` can
// drive the whole thing under node with no renderer, no GL and no three.js.
// Every one of the three is optional: a level exported before the collision
// flip has a heightfield and no hulls, and a body on one still walks.

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
 * Our fixed tick, and why it is 60 and not the 30 the jump figures imply.
 *
 * PHY-1's **1.12 m apex and 0.80 s of air** are what the engine's four
 * sub-steps produce at `dt = 1/30`, and the ledger reaches that `dt` from
 * `g_simulationFps = 30.0`. But `g_simulationFps` is not the frame period: it
 * is a fixed scale constant (lnxded `.data` `0x08716b5c`, raw `0000f041`, and
 * **nothing in the binary writes it** — `objdump -d -M intel` over the whole
 * file has no `fstp`/`mov` to that address, and it is not a console word:
 * the only `simulationFps` string in the file is the symbol's own name). What
 * the loop rate is built from is that constant **doubled**:
 *
 *     Setup::initEngine   0x080bc632  fld [0x08716b5c]   ; 30.0
 *                         0x080bc63f  fadd st,st(0)      ; 60.0
 *                         0x080bc641  fstp [ecx+0xc4]    ; the loop's rate
 *
 *     Setup::mainLoop     0x080bc0b0  fld1
 *                         0x080bc0b2  fdiv [ebx+0xc4]    ; period = 1/60 s
 *                         0x080bc0e3  je  0x080bc3b0     ; deadline not reached
 *                         0x080bc3b2  (spin on System::getExactTime, 0x08418160)
 *                         0x080bc0f6  fsubrp             ; dt = now - last
 *                         0x080bc0f8  fstp [ebx+0xc8]    ; the frame dt, measured
 *
 * So the dedicated server targets **60 Hz** and integrates with the *measured*
 * elapsed time, and `Game::updateWorld` (`0x0805d9b0`) hands that dt straight
 * down — `BasicPhysicsSystem::update` (`0x08251ef0`) is an empty stub, so
 * there is no accumulator anywhere below it either.
 *
 * Two things follow. The engine's own jump apex **moves with the frame rate**,
 * so 1.12 m is the figure for a machine running at exactly 30 fps and not a
 * universal constant; and 60 Hz, not 30, is the period the shipped loop aims
 * at. Dropping this viewer to a 30 Hz tick to chase 1.12 m would therefore
 * chase a frame-rate artefact, and it would halve the resolver's sampling —
 * 0.2 m of travel per tick at a run instead of 0.1 — in the one part of this
 * module with no engine provenance. `tests/test_soldier.py` pins the apex, the
 * ramp and the fall a landing is billed as identical at 23.7, 30, 60 and
 * 144 **frames** per second, which is the property that actually matters.
 *
 * Recorded as a finding rather than a ledger edit: PHY-1 and PHY-6 both state
 * wall-clock figures that rest on `dt = 1/30`.
 */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/**
 * Ticks one frame may run before the clock gives up and drops the rest.
 *
 * A tab that was backgrounded for a minute must not come back and run 3,600
 * ticks in one frame. Twelve is 200 ms of catch-up, which covers a GC pause and
 * a texture upload and nothing longer.
 */
export const MAX_CATCH_UP_TICKS = 12;

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

// --- the outer clock -------------------------------------------------------

/**
 * A fixed-step accumulator with a render interpolation factor.
 *
 * `advance(frameDt)` returns how many whole ticks to run and leaves `alpha` in
 * 0..1 for the leftover, so a renderer draws between the last two tick states
 * instead of at the last one. `dropped` counts ticks the catch-up cap threw
 * away, which is the only honest way to notice that the sim is not keeping up.
 *
 * Retail has none of this (`World::update`, `0x004b6cb0`, passes the frame dt
 * down unmodified and unclamped). This is the divergence the file header
 * explains: determinism for replay beats bug-for-bug fidelity here.
 */
export class FixedStep {
  constructor({ rate = TICK_RATE, maxTicks = MAX_CATCH_UP_TICKS } = {}) {
    this.dt = 1 / rate;
    this.maxTicks = maxTicks;
    this.accumulator = 0;
    this.alpha = 0;
    this.dropped = 0;
    this.ticks = 0;
  }

  advance(frameDt) {
    if (!(frameDt > 0)) frameDt = 0;
    this.accumulator += frameDt;
    let n = Math.floor(this.accumulator / this.dt);
    if (n > this.maxTicks) {
      this.dropped += n - this.maxTicks;
      // Drop the excess rather than carry it: carrying it means the next frame
      // owes the same debt plus its own, and the sim never catches up.
      this.accumulator -= (n - this.maxTicks) * this.dt;
      n = this.maxTicks;
    }
    // Clamped, because subtracting n whole ticks off a float accumulator lands
    // a few times 1e-16 below zero often enough to matter to an alpha.
    this.accumulator = Math.max(0, this.accumulator - n * this.dt);
    this.alpha = this.accumulator / this.dt;
    this.ticks += n;
    return n;
  }

  reset() {
    this.accumulator = 0;
    this.alpha = 0;
  }
}

/** Straight-line blend, for drawing between two tick states. */
export function lerp(a, b, t) { return a + (b - a) * t; }

// --- the soldier -----------------------------------------------------------

export const POSE_STAND = 0;
export const POSE_CROUCH = 1;
export const POSE_PRONE = 2;

/** `c_SstCrouch`, `c_SstLie`, `c_SstJump` as they sit in the pose flags byte. */
export const POSE_FLAG_CROUCH = 0x20;
export const POSE_FLAG_PRONE = 0x40;
export const POSE_FLAG_JUMP = 0x80;

/**
 * The pose index the engine derives from the flags, at `0x005013f8`:
 *
 *     pose = (flags & 0x20) ? 1 : (flags & 0x40) >> 5
 *
 * Crouch wins over prone when both bits are somehow set, and the prone bit is
 * shifted rather than tested, which is how bit 6 becomes the value 2.
 */
export function poseFromFlags(flags) {
  return (flags & POSE_FLAG_CROUCH) ? POSE_CROUCH
    : ((flags & POSE_FLAG_PRONE) >> 5);
}

/**
 * `BFSoldierTemplate::directionalSpeed[6]` at `0x009581b4`, byte-identical to
 * the Linux dedicated server's copy at `0x0872edec`.
 *
 * Indexed `pose * 2 + (forwardInput <= 0 ? 1 : 0)`, so the pairs read
 * (forward, not-forward): standing 6 and 4, crouching 2 and 2, prone 1 and 1.
 * Note what the index actually tests — *no forward input at all* takes the
 * second slot, so standing still and walking backwards share a number.
 */
export const DIRECTIONAL_SPEED = Object.freeze([6, 4, 2, 2, 1, 1]);

/** `BFSoldierTemplate::strafeSpeed[3]` at `0x009581cc`, by pose. */
export const STRAFE_SPEED = Object.freeze([4, 2, 1]);

/** `BFSoldierTemplate::walkSpeedFactor` at `0x009581d8`: the walk toggle. */
export const WALK_SPEED_FACTOR = 1 / 3;

/** Top speed for a pose and a forward input, before the walk toggle. */
export function directionalSpeed(pose, forward) {
  return DIRECTIONAL_SPEED[pose * 2 + (forward <= 0 ? 1 : 0)];
}

// --- the ramp that reaches those tables (PHY-6) ------------------------------

/**
 * `g_simulationFps`, 30, and the only place this module needs it.
 *
 * The ramp below is authored as integers *per call*, and `handlePlayerInput`
 * is called once a frame — so its wall-clock time constants are the frame
 * rate's, not a fixed tick's (see `TICK_RATE`: the dedicated server's loop
 * targets `2 * g_simulationFps` and integrates with the measured elapsed
 * time). **0.212 s to full speed is therefore the figure for a machine at
 * exactly 30 fps**, the same caveat PHY-1's apex carries.
 *
 * This viewer runs a 60 Hz fixed step on purpose, so the ramp is carried as a
 * rate per second and stepped by `dt`: the wall clock then holds at any rate,
 * which is what a replay needs. At `dt = 1/30` it walks the engine's integer
 * ladder exactly — `600 * (1/30)` is 20.0 and `360 * (1/30)` is 12.0 in binary
 * floating point, with no rounding — which is what the tests assert against.
 */
export const ENGINE_TICK_RATE = 30;

/**
 * `applyMovementFactors(float input, char accel, char decel, char& state)`,
 * lnxded `0x082807a0`. **PHY-6, confirmed.**
 *
 * A soldier does not reach the speed tables the instant a key goes down. Each
 * axis carries a **signed byte** that walks toward the input and is then scaled
 * by `1/127` before it indexes the table. `handlePlayerInput` calls it twice,
 * for forward (`this+0x58d`, `0x0827475a`) and strafe (`this+0x58c`,
 * `0x0827477f`), and both call sites `movsx` the same two immediates:
 *
 *     accel = 20   0x0872ee14        decel = 12   0x0872ee18
 *
 * which sit adjacent to `walkSpeedFactor` at `0x0872ee10`. The three arms are
 *
 *     input == 0 && state != 0  ->  state moves toward 0 by decel
 *     input >  0                ->  state = min(max(state, 0) + accel, +127)
 *     input <  0                ->  state = max(min(state, 0) - accel, -127)
 *
 * Note the `max(state, 0)` in the second arm and the `min(state, 0)` in the
 * third: reversing direction snaps the register to zero and ramps out of it, so
 * a reversal costs one ramp-up rather than a ramp-down and a ramp-up.
 *
 * At 30 Hz that is **0.212 s to full speed** (127/20 = 6.35 ticks) and
 * **0.353 s to a stop** (127/12 = 10.58 ticks).
 *
 * Only the *sign* of the input is read. A half-pressed axis ramps at the same
 * rate and to the same 127 as a fully pressed one; there is no analogue term.
 */
export const RAMP_ACCEL = 20;
export const RAMP_DECEL = 12;
export const RAMP_LIMIT = 127;

/** The `fmul` at `0x082747c6` against `0x086d2718`, the nearest float32 to 1/127. */
export const RAMP_SCALE = 1 / 127;

/** Seconds the ramp takes to cross its whole range, in each direction. */
export const RAMP_TO_FULL_SECONDS = RAMP_LIMIT / (RAMP_ACCEL * ENGINE_TICK_RATE);
export const RAMP_TO_STOP_SECONDS = RAMP_LIMIT / (RAMP_DECEL * ENGINE_TICK_RATE);

/**
 * One step of the ramp. `input` is read for its sign only; `dt` scales the
 * engine's per-tick integers into this viewer's step.
 */
export function applyMovementFactors(input, state, dt,
                                     accel = RAMP_ACCEL, decel = RAMP_DECEL) {
  const up = accel * ENGINE_TICK_RATE * dt;
  const down = decel * ENGINE_TICK_RATE * dt;
  if (!(input > 0) && !(input < 0)) {
    if (state > 0) return Math.max(0, state - down);
    if (state < 0) return Math.min(0, state + down);
    return 0;
  }
  if (input > 0) return Math.min(Math.max(state, 0) + up, RAMP_LIMIT);
  return Math.max(Math.min(state, 0) - up, -RAMP_LIMIT);
}

/**
 * Signed forward speed for a pose and a ramp state, `0x08274800`.
 *
 * The table slot is chosen from the **ramp byte**, not from the raw input
 * (`0x082747e0 cmp BYTE [ecx+0x58d],0; setle`), so letting go of W does not
 * flip a soldier onto the backward row while he is still coasting forward.
 */
export function rampedDirectionalSpeed(pose, state, walk = false) {
  const slot = DIRECTIONAL_SPEED[pose * 2 + (state <= 0 ? 1 : 0)];
  return slot * (state * RAMP_SCALE) * (walk ? WALK_SPEED_FACTOR : 1);
}

/** Signed strafe speed. `strafeSpeed` is indexed by pose alone — no slot flip. */
export function rampedStrafeSpeed(pose, state, walk = false) {
  return STRAFE_SPEED[pose] * (state * RAMP_SCALE) * (walk ? WALK_SPEED_FACTOR : 1);
}

/**
 * `CommonSoldierData.inc`: `mass 100`, `drag 1.0`. Both shipped, both read.
 */
export const SOLDIER_MASS = 100;
export const SOLDIER_DRAG = 1.0;

/** `setParachuteDrag 24.00` / `setParachuteSpeed 30.00`, same file. */
export const PARACHUTE_DRAG = 24;
export const PARACHUTE_SPEED = 30;

/**
 * The soldier's bounding radius, for the drag term only. **Inferred.**
 *
 * The engine reads it from a virtual getter, not from any `.con`, so it is not
 * in the shipped data and was not located in the client. 0.8 m is chosen
 * because it makes the drag equation reproduce a number that *is* shipped: at
 * `PARACHUTE_DRAG`, terminal velocity is
 *
 *     g / (pi * r^2 * drag / mass) = 14.73 / (pi * 0.64 * 24 / 100) = 30.5 m/s
 *
 * against `setParachuteSpeed 30.00`. A 1.8% miss on a value that spans two
 * independent constants is good evidence for the reading of the drag equation,
 * and weaker but real evidence for the radius. Treat the radius as a tunable.
 * At the soldier's own `drag 1.0` it is nearly inert — terminal velocity is
 * 730 m/s, i.e. a man falls essentially in vacuum, which matches the game.
 */
export const SOLDIER_BOUNDING_RADIUS = 0.8;

/**
 * The jump. **PHY-1, confirmed on both binaries — read, not fitted.**
 *
 * `BFSoldier::handlePlayerInput` (client `0x00500190`, lnxded `0x08273c70`)
 * selects the jump on a non-zero `PlayerInput[9]` (`c_PIAction`) and computes
 *
 *     accel = ((0, min(1 + dot(d_hat, N), 1) * N.y * 6.0, 0) - 0.25 * vCmd)
 *             * g_simulationFps
 *
 * then hands it to `PhysicsNode::addAccelerationAtRelativePosition(zero, accel)`
 * (client `0x005017a1`, lnxded `0x08275123`) and **zeroes `vCmd` outright**.
 * Constants: `6.0` at `0x008eb25c` / `0x086d271c` (raw `40c00000`), `0.25` at
 * `0x008d5c04` / `0x086c08ac`, the `1.0` clamp at `0x008c53c8`, the 30.0 at
 * `0x00957640` / `0x08716b5c`.
 *
 * Three things follow, and each one was a live misreading before this round:
 *
 *   - **It is an impulse, not a velocity set.** The `* g_simulationFps` is
 *     undone by the integrator, whose accumulator is cleared every tick
 *     (`0x082562aa`), so the net is exactly `Delta v` once. On flat ground
 *     `N = (0,1,0)`, `d_hat` has its y forced to 0 before normalising, so the
 *     dot is 0, `K` clamps to 1 and the whole term is **+6.0 m/s**.
 *   - **The horizontal term lands on the velocity, not on the command.**
 *     `-0.25 * vCmd` is a backward kick of 1.5 m/s at a 6 m/s run — ten times a
 *     normal tick's forward gain, in the opposite direction — and the command
 *     is then set to zero rather than damped. Writing it as `vCmd *= 0.75` is
 *     the refuted form: it only coincides while the body is already at its
 *     commanded speed.
 *   - **At `dt = 1/30` the apex is 1.12 m and the hang is 0.80 s**, not
 *     1.222 m / 0.815 s. Those are the continuum `v^2/2g` figures; four
 *     semi-implicit sub-steps of `dt/4` land lower. A viewer calibrated to
 *     1.222 m is 9% high.
 *
 * That last figure is also the check on the second point. Stepping this
 * module's own integrator at 30 Hz reproduces **1.1221 m and 0.8000 s** to four
 * decimals, and it only does so when the impulse goes through the accumulator:
 * a `v.y = 6.0` velocity set gives 1.1971 m, because it skips gravity's own
 * share of the jump tick. `tests/test_physics.py` pins that as the parity
 * assertion.
 *
 * The rate qualifier on it is not pedantry. The impulse is spent over one
 * `dt`, so the apex rises with the tick: a shorter tick delivers the same
 * `Delta v` sooner and loses less of it to the tick's own gravity, and 60 Hz
 * lands at 1.166 m. That is a property of the engine too, whose loop
 * integrates with the measured frame time (`TICK_RATE`) — 1.12 m is the figure
 * for a machine at exactly 30 fps. This viewer picks one rate and holds it at
 * any frame rate, which is the part a replay depends on.
 */
export const JUMP_IMPULSE = 6.0;

/** The `-0.25 * vCmd` the same tick applies to the *actual* velocity. */
export const JUMP_COMMAND_KICK = 0.25;

/**
 * The only slope threshold anywhere in soldier movement. **PHY-1.**
 *
 * A jump is legal iff the previous tick produced a contact whose `normal.y`
 * exceeds this on a material that is not Water (id 1). Soldier state-bit `0x40`
 * is set by `handleCollision` at client `0x004fa764` and lnxded `0x0827d566`
 * (`or WORD PTR [edi+0x3e6],0x40`; threshold at `0x008c53cc` / `0x086b1ca0`)
 * and cleared every tick (client `0x00501bb6`, lnxded `0x08274d29`), so the bit
 * needs a *fresh* upward contact — which is one of the three independent
 * reasons a held jump key cannot double-jump.
 *
 * 0.1 is far more permissive than `MAX_GROUND_SLOPE`: it admits any face up to
 * about 84 degrees. That difference is deliberate and is the engine's.
 */
export const JUMP_CONTACT_NORMAL_Y = 0.1;

/** `materialManagerdefine.con` material 1. A contact on it never arms a jump. */
export const MATERIAL_WATER = 1;

/**
 * `accel = 0.75 * vCmd`, `0x08274a09` against `0x086ba8cc`. **PHY-6.**
 *
 * The locomotion force, and the two things about it that decide how this module
 * uses it. It is **not** multiplied by `g_simulationFps` — unlike the jump — so
 * it really is an acceleration of `0.75 * vCmd` m/s^2, i.e. `vCmd / 40` of
 * delta-v per engine tick. And it is applied **only when the collision solver
 * resolved no impulse that tick** (`IResponsePhysics+0xa4 == 0`), which for a
 * soldier means only while airborne. A soldier standing on the ground is moved
 * by the friction path instead — see `SoldierBody.step`, which explains at
 * length why this module reproduces the airborne arm and not the grounded one.
 *
 * Swimming's `5.0 * vCmd` (`0x08274b6f`, `0x086c5288`) is *not* under that gate;
 * this module does not swim yet.
 */
export const LOCOMOTION_GAIN = 0.75;

/**
 * Eye height above the feet, per pose.
 *
 * `CommonSoldierData.inc` gives the camera as an offset from the soldier's own
 * origin, not from the ground:
 *
 *     setPoseCameraPos c_BfSoldierStanding   0/0.65/0
 *     setPoseCameraPos c_BfSoldierCrouching  0/0.12/0
 *     setPoseCameraPos c_BfSoldierLying      0/-0.7/0
 *     setCharacterHeight -1.00
 *
 * Read literally the standing eye would be 0.65 m off the floor, which is
 * absurd, so the origin is not at the feet. `setCharacterHeight -1.00` is the
 * missing metre: the contact point sits 1 m *below* the origin. Adding it back
 * gives 1.65 / 1.12 / 0.30 m, which are exactly the heights a standing,
 * crouching and prone man's eyes sit at. The three offsets are `confirmed`
 * shipped data; reading `characterHeight` as the origin-to-feet distance is
 * `strong inference`.
 */
export const CHARACTER_HEIGHT = 1.0;
export const POSE_CAMERA_POS = Object.freeze([0.65, 0.12, -0.7]);
export const EYE_HEIGHT = Object.freeze(
  POSE_CAMERA_POS.map(offset => CHARACTER_HEIGHT + offset));

/**
 * Collision extents per pose. **Viewer choices, not engine data.**
 *
 * The shipped body collider is a mesh (`ObjectTemplate.geometry BodyCollision`)
 * plus eight `setSkeletonCollisionBone` capsules for *hit* detection, neither
 * of which is a movement volume. **The engine has no movement capsule at all**
 * (PHY-1): the collider it sweeps is the object's own `SimpleCollisionMesh`
 * vertices, walked by `ResponsePhysics::checkVsTerrain` (`0x0825a960`) over
 * `getVertexCollision` and `getFaceCollision`. There is no ray and no capsule
 * to go looking for.
 *
 * These are a plain vertical capsule sized off the eye heights above: a man is
 * about 0.15 m of skull above his eyes, and 0.3 m is a shoulder's half-width.
 * Prone is modelled as a short column rather than a lying capsule, which is
 * wrong in the pedantic sense and invisible in the first-person view this
 * drives.
 */
export const BODY_HEIGHT = Object.freeze([1.80, 1.30, 0.60]);
export const BODY_RADIUS = 0.3;

/**
 * How far a body is allowed to be lifted by an obstacle it walks into, and how
 * far it is glued to ground falling away beneath it. **Viewer choices.**
 *
 * Refractor's soldier does not step in this sense at all — **there is no
 * step-up code in the engine** (PHY-1). It is a physics body riding a contact
 * solver, and a kerb is climbed or not climbed by the contact solve. Without
 * something like this a viewer body catches on every 8 cm kerb in Berlin, so
 * the lowest sphere of the capsule is lifted by `STEP_HEIGHT` while grounded
 * and a short downward sweep finds what to stand on afterwards. Marked clearly
 * because it is the one movement behaviour here with no engine provenance
 * whatsoever.
 */
export const STEP_HEIGHT = 0.45;
export const SNAP_DOWN = 0.45;

/**
 * Steepest surface that counts as standing on rather than sliding off.
 * **Viewer choice**, and permissive on purpose: BF1942 infantry climb dunes
 * that no modern shooter would allow.
 *
 * **The engine has no walk-slope limit** (PHY-1). `JUMP_CONTACT_NORMAL_Y`, the
 * 0.1 that arms a jump, is the only slope threshold anywhere in soldier
 * movement; what stops a soldier walking up a cliff in retail is the contact
 * solver's friction budget, not a test like this one. This stays because a
 * kinematic body with no contact solver needs *something* to refuse a wall, and
 * because it is what keeps `#refuseSteepGround` from ratcheting a body up a
 * cliff face. It is not the engine's shape, and jump legality no longer
 * consults it.
 */
export const MAX_GROUND_SLOPE = Math.cos(60 * Math.PI / 180);

/**
 * Seconds the eye takes to travel between two poses, when nobody says otherwise.
 *
 * A pose change that teleported the camera half a metre reads as a glitch
 * rather than as ducking, so the eye is animated. 0.09 s is a placeholder for a
 * caller that does not care; `soldier.js` passes the real per-transition
 * durations, which come off the animation clips
 * (`animations/AnimationStatesCrouching.con` and `...Lie.con`) and differ by a
 * factor of four between dropping prone and standing back up.
 */
export const POSE_TRANSITION = 0.09;

/** Gap kept between a body and whatever it stops against, in metres. */
const SKIN = 0.01;

/** Passes the slide resolver will make before it gives up on a corner. */
const SLIDE_PASSES = 4;

// Scratch for the capsule sweep. `world.sweepSphere` hands back a record it
// owns and reuses, so the nearest of several sphere sweeps has to be copied out
// before the next call overwrites it.
const _contact = {
  t: 0, nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, material: 0, owner: -1,
};

/** Scratch for `Heightfield.normal`, which writes into a caller's array. */
const _normal = [0, 1, 0];

/**
 * Nearest contact for a stack of spheres swept together, or null.
 *
 * A capsule sweep done as N sphere sweeps. Exact swept-capsule-vs-triangle is
 * a longer piece of algebra for a body that is 1.8 m of three overlapping
 * 0.3 m spheres; the approximation's only error is the scalloping between
 * them, which is under a centimetre and is on the inside of the volume.
 */
function sweepCapsule(world, x, y, z, dx, dy, dz, dist, radius, offsets) {
  if (!world || !world.sweepSphere) return null;
  let best = -1;
  for (const offset of offsets) {
    const hit = world.sweepSphere(x, y + offset, z, dx, dy, dz, dist, radius);
    if (!hit) continue;
    // A surface the motion is travelling *away* from cannot stop it. The sweep
    // reports one at `t = 0` for any sphere already resting against geometry,
    // and `#resolve` then advances by `max(0, t - SKIN)` = 0, finds the move is
    // not into the plane so strips nothing, sweeps again from the same point,
    // and burns all four passes without moving the body one millimetre.
    //
    // That is how a soldier who walked off the test platform hung on its lip
    // instead of falling: the instant `grounded` goes false the capsule's
    // lowest sphere drops from `STEP_HEIGHT + r` to `r`, which lands it exactly
    // tangent to the deck he just left, and every tick after that was spent
    // re-finding the same tangent contact. His velocity reached -25 m/s while
    // his position moved 0.2 m in two seconds.
    if (dx * hit.nx + dy * hit.ny + dz * hit.nz >= 0) continue;
    if (best >= 0 && hit.t >= best) continue;
    best = hit.t;
    _contact.t = hit.t;
    _contact.nx = hit.nx; _contact.ny = hit.ny; _contact.nz = hit.nz;
    _contact.px = hit.px; _contact.py = hit.py; _contact.pz = hit.pz;
    _contact.material = hit.material;
    _contact.owner = hit.owner;
  }
  return best >= 0 ? _contact : null;
}

/**
 * A walking body: the engine's speeds and integrator, our collision resolve.
 *
 * `position` is the **feet**, not the origin and not the eye — every other
 * height in here is measured up from it, and the ground clamp is a comparison
 * against it directly. `body.position` is kept in step with it so that a caller
 * wanting the raw `PointBody` (a replay writing state in) has one.
 */
export class SoldierBody {
  constructor({ position = null, yaw = 0, world = null } = {}) {
    this.body = new PointBody({
      mass: SOLDIER_MASS,
      drag: SOLDIER_DRAG,
      boundingRadius: SOLDIER_BOUNDING_RADIUS,
      position,
    });
    this.world = world;
    this.yaw = yaw;
    this.poseFlags = 0;
    this.pose = POSE_STAND;
    this.grounded = false;
    this.parachute = false;
    // Eye height is animated rather than snapped: a pose change that teleported
    // the camera 50 cm reads as a glitch, not as ducking. The travel is linear
    // over a duration the caller may set per transition, because it stands in
    // for an animation clip playing at a declared rate rather than for a spring.
    this.eyeHeight = EYE_HEIGHT[POSE_STAND];
    this.previousEyeHeight = this.eyeHeight;
    this.eyeFrom = this.eyeHeight;
    this.eyeProgress = 1;
    this.eyeDuration = POSE_TRANSITION;
    this.material = -1;      // what the feet are on, for footsteps later
    this.contacts = 0;       // hull contacts resolved in the last tick
    // The soldier's two `applyMovementFactors` registers (PHY-6), carried as
    // floats over [-127, 127] rather than as signed bytes — see
    // `ENGINE_TICK_RATE` for why the discretisation and not the timing gives.
    this.forwardRamp = 0;
    this.strafeRamp = 0;
    // The most-upward contact normal of the previous tick, and whether that
    // contact armed a jump. `handleCollision` keeps the most upward normal of
    // the frame at soldier `+0x400` (lnxded `0x0827d4d5`-`0x0827d503`) and the
    // arming bit is cleared every tick, so both are per-tick state that the
    // *next* tick's input handling reads. Flat ground until proven otherwise.
    this.contactNormal = { x: 0, y: 1, z: 0 };
    this.contactMaterial = -1;
    this.jumpArmed = false;
    // Did the previous tick resolve any contact at all? This is PHY-6's
    // gate on the locomotion force -- `IResponsePhysics+0xa4 != 0` -- and it
    // is a different question from `grounded`, which asks whether the thing
    // touched was flat enough to stand on.
    this.contacted = false;
    // What the last landing was worth, for a fall-damage caller. `#settle`
    // zeroes `velocity.y` in the same tick it flips `grounded` true, so a
    // caller reading the velocity after `step()` always misses the impact;
    // these are captured before the resolve instead.
    this.landed = false;         // did this tick end a fall?
    this.impactSpeed = 0;        // |v| at the moment of that landing
    this.impactNormalY = 1;      // and the surface it arrived on
    this.impactCosTheta = 1;     // cos of the angle off that surface normal
    this.impactMaterial = -1;    // the material struck, the fall's attacker
    this.fallHeight = 0;         // lastCollisionHeight - y, the engine's `F`
    this.lastCollisionHeight = this.body.position.y;
    this._offsets = [];
    this._jumpQueued = false;
    this._armed = false;
    this._bestNormalY = -Infinity;
  }

  get position() { return this.body.position; }
  get previous() { return this.body.previous; }
  get velocity() { return this.body.velocity; }

  /** Ground speed, which is the number a HUD wants rather than the 3D one. */
  get groundSpeed() {
    const v = this.body.velocity;
    return Math.hypot(v.x, v.z);
  }

  get height() { return BODY_HEIGHT[this.pose]; }

  place(x, y, z, yaw = this.yaw) {
    this.body.setPosition(x, y, z);
    this.body.setVelocity(0, 0, 0);
    this.yaw = yaw;
    this.grounded = false;
    this.forwardRamp = 0;
    this.strafeRamp = 0;
    this.jumpArmed = false;
    this.contactNormal.x = 0;
    this.contactNormal.y = 1;
    this.contactNormal.z = 0;
    this.contactMaterial = -1;
    this.contacted = false;
    // A placed body has not fallen: the drop it would be judged on starts here,
    // so teleporting down a cliff never bills the arrival as a fall.
    this.lastCollisionHeight = y;
    this.landed = false;
    this.impactSpeed = 0;
    this.fallHeight = 0;
    // A placed body is standing where it was put, not halfway through ducking
    // into it: the eye snaps rather than easing in from wherever it last was.
    this.eyeHeight = EYE_HEIGHT[this.pose];
    this.previousEyeHeight = this.eyeHeight;
    this.eyeFrom = this.eyeHeight;
    this.eyeProgress = 1;
  }

  /**
   * Set the pose flags, the way the engine's soldier state machine does.
   *
   * Crouch and prone are the two bits at 0x20 and 0x40 and the pose falls out
   * of `poseFromFlags`; nothing here decides a priority of its own.
   *
   * `duration` is how long the eye takes to arrive, and it only restarts the
   * travel when the pose actually changed — so holding crouch does not pin the
   * eye at the start of the transition forever. Travel begins from where the
   * eye *is*, not from the old pose's nominal height, so reversing a transition
   * halfway does not jump.
   */
  setPoseFlags(flags, duration = POSE_TRANSITION) {
    const pose = poseFromFlags(flags);
    if (pose !== this.pose) {
      this.eyeFrom = this.eyeHeight;
      this.eyeProgress = 0;
      this.eyeDuration = duration > 0 ? duration : 1e-6;
    }
    this.poseFlags = flags;
    this.pose = pose;
  }

  setCrouch(on, duration = POSE_TRANSITION) {
    this.setPoseFlags(on ? ((this.poseFlags | POSE_FLAG_CROUCH) & ~POSE_FLAG_PRONE)
      : (this.poseFlags & ~POSE_FLAG_CROUCH), duration);
  }

  setProne(on, duration = POSE_TRANSITION) {
    this.setPoseFlags(on ? ((this.poseFlags | POSE_FLAG_PRONE) & ~POSE_FLAG_CROUCH)
      : (this.poseFlags & ~POSE_FLAG_PRONE), duration);
  }

  /** The parachute is a drag swap and nothing else: 1.0 becomes 24. */
  setParachute(on) {
    this.parachute = Boolean(on);
    this.body.drag = on ? PARACHUTE_DRAG : SOLDIER_DRAG;
  }

  /**
   * Declare the body standing on ground it was placed on, off the tick.
   *
   * Spawn placement puts the feet on a surface without running a tick, so
   * nothing has produced a contact yet — and since PHY-1's jump gate is a
   * *contact*, not `grounded`, a freshly placed body would silently refuse its
   * first jump without this. (It used to work by accident, because the gate
   * was `grounded` and callers set that field directly.) Arming here is
   * correct rather than a workaround: in the engine a soldier resting on the
   * floor has a contact with an upward normal every tick.
   *
   * `material` is passed so a spawn onto water still refuses a jump.
   */
  plant(normalY = 1, material = -1) {
    this.grounded = true;
    this.lastCollisionHeight = this.body.position.y;
    this.contactNormal.x = 0;
    this.contactNormal.y = normalY;
    this.contactNormal.z = 0;
    this.contactMaterial = material;
    this.jumpArmed = normalY > JUMP_CONTACT_NORMAL_Y && material !== MATERIAL_WATER;
    this.contacted = true;
    return this;
  }

  /** Queued rather than applied, so a keypress between ticks is never lost. */
  jump() { this._jumpQueued = true; }

  /**
   * One fixed tick.
   *
   * `input` is `{ forward, strafe, walk }` with the two axes in -1..1, which is
   * what a keyboard, a stick or a replay all reduce to. The yaw the body faces
   * is `this.yaw`; the caller owns looking around.
   */
  step(dt, input = {}) {
    const body = this.body;
    const forward = clamp(input.forward ?? 0, -1, 1);
    const strafe = clamp(input.strafe ?? 0, -1, 1);
    const walk = Boolean(input.walk);

    // --- the ramp, then the tables it indexes (PHY-6) ----------------------
    this.forwardRamp = applyMovementFactors(forward, this.forwardRamp, dt);
    this.strafeRamp = applyMovementFactors(strafe, this.strafeRamp, dt);
    const fwdSpeed = rampedDirectionalSpeed(this.pose, this.forwardRamp, walk);
    const sideSpeed = rampedStrafeSpeed(this.pose, this.strafeRamp, walk);
    // Facing is +Z at yaw 0, matching the viewer's own look vector. Both speeds
    // are already signed by their ramp register, so the input axes do not
    // reappear here.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let cmdX = sy * fwdSpeed - cy * sideSpeed;
    let cmdZ = cy * fwdSpeed + sy * sideSpeed;
    // Diagonal input would otherwise beat both tables at once. The engine's own
    // combination of the two axes was not traced (the result is scaled again by
    // two per-soldier fields before use, `0x005013f8`), so this clamps the
    // resultant to the larger of the two authored speeds, which is the
    // conservative reading.
    const want = Math.hypot(cmdX, cmdZ);
    const cap = Math.max(Math.abs(fwdSpeed), Math.abs(sideSpeed));
    if (want > cap && want > 0) {
      cmdX *= cap / want;
      cmdZ *= cap / want;
    }

    const v = body.velocity;
    // The jump is resolved **first**, and that ordering is load-bearing.
    //
    // PHY-1's `-0.25 * vCmd` lands on the **actual** velocity. Run the ground
    // arm below first and it does not: that arm assigns `v = vCmd`, so the
    // kick would always land on a velocity equal to the command and would
    // always read as `0.75 * vCmd` — the refuted form, item 1's third "do
    // NOT", arrived at by the back door. It coincides only while the body is
    // already travelling at its commanded speed, which is exactly the case
    // the refutation warns about.
    //
    // The case where they part is a soldier pressed into a wall: his actual
    // velocity is ~0 because the resolver strips it, his command is a full
    // 6 m/s into the wall, and the engine's kick is therefore 1.5 m/s
    // **backward, off the wall**. Assigning first gave him 6.0 into the wall,
    // took 1.5 off it, and handed the resolver 4.5 m/s to strip — so he rose
    // straight up, stayed in contact, and PHY-6's gate kept the airborne
    // force switched off for the whole hop. Measured on Berlin
    // (Bernauer_Strasse_HQ, yaw pi) and Wake (The_Airfield, yaw pi/4): the
    // body never left the wall.
    //
    // Nothing changes for an unblocked runner, who is the case every measured
    // figure comes from: his velocity already equals his command when the tick
    // begins, so the assignment was a no-op and 6.0 still becomes 4.5.
    const jumped = this.#tryJump(dt, cmdX, cmdZ);
    if (jumped) {
      // `vCmd` is zeroed outright, not damped, and the engine's jump branch
      // forward-jumps clean over the locomotion block — so a jump tick carries
      // no locomotion force and no friction assignment at all. The next tick
      // rebuilds both.
      cmdX = 0;
      cmdZ = 0;
    } else if (this.grounded) {
      // **The deliberate divergence, and the reason it is deliberate.**
      //
      // In the engine a soldier on the ground is moved by the friction solver,
      // not by the `0.75 * vCmd` force below: that force is gated off on any
      // tick where the collision solver resolved an impulse (PHY-6), and
      // standing on the floor is such a tick. The friction path (PHY-2) gives a
      // soldier its own coefficient pair — `A * 7.2 * 9.82 * n.y^5 / 30` to
      // break away and `A * 4.8 * 9.82 * n.y^5 / 30` while sliding — which on
      // flat ground with `A = 1` is **2.357 and 1.571 m/s of delta-v per tick**,
      // against a top speed of 6 m/s. The budget is three times the whole speed
      // range, so the ledger's own wording is that friction "cancels tangential
      // slip outright": its observable output is a body that tracks its
      // commanded tangential velocity with no lag a player could see.
      //
      // A direct assignment reproduces that observable exactly, and this module
      // has no rigid body to reproduce the mechanism with — no contact
      // impulses, no static/kinetic latch, no per-part mean. The visible
      // acceleration a player feels is the *ramp* above, which is now the
      // engine's, and the friction budget is what makes the ramp the only thing
      // one feels. Implementing `0.75 * vCmd` here instead would be flatly
      // wrong twice over: it is gated off on the ground, and at `vCmd / 40` per
      // engine tick it would take 1.3 s to reach a speed the ramp reaches in
      // 0.21 s.
      //
      // What this therefore does NOT model: sliding on ice or wet mud (a
      // material whose `materialFriction` is low enough to make the budget
      // bite), and being shoved by a contact. Both need the contact solver in
      // `collision-response.md` §8, which is the collision round's, not this
      // module's. See `first-person-soldier.md` §8.
      v.x = cmdX;
      v.z = cmdZ;
    } else if (!this.contacted) {
      // The engine's gate, and it is **"no contact impulse was resolved"**,
      // not "airborne". Those coincide for a body falling through clear air,
      // and they emphatically do not for one scraping a wall or hanging on the
      // lip of a ledge: reading the gate as "airborne" lets an unopposed
      // 4.5 m/s^2 pile onto a body the resolver is pinning, and the horizontal
      // speed then climbs without bound while the position does not move. That
      // is not a hypothetical — it wedged a soldier on the test platform's far
      // edge at 13 m/s and rising. With the real gate, a body in contact with
      // anything is moved by friction and gravity alone, which is what PHY-2
      // says and what makes the runaway impossible.
      //
      // So this arm *is* the engine's: an acceleration of `0.75 * vCmd`, with
      // no `* 30`. `AIR_CONTROL` used to live here as an invented per-tick
      // lerp; it is gone. At a 6 m/s command that is 4.5 m/s^2, so a 0.80 s
      // jump carries about 3.6 m/s of steering authority and a tap of
      // air-strafe carries almost none — the asymmetry retail has and the
      // lerp did not.
      body.addAcceleration(LOCOMOTION_GAIN * cmdX, 0, LOCOMOTION_GAIN * cmdZ);
    }

    // --- the engine's update ----------------------------------------------
    const wasGrounded = this.grounded;
    body.updatePhysics(dt);
    // The impact velocity, captured before anything clamps it.
    const ivx = v.x, ivy = v.y, ivz = v.z;

    // --- and our resolve --------------------------------------------------
    this._armed = false;
    this._bestNormalY = -Infinity;
    this.landed = false;
    this.#resolve();
    this.#refuseSteepGround();
    this.#settle();

    // A landing is a tick that ends grounded having not begun so. `F` is the
    // engine's `getLastCollisionHeight() - pos.y` (Armor `+0x28`), which is the
    // height of the last *contact*, not the apex: a jump straight up therefore
    // lands with `F = 0` and a jump off a ledge is billed the ledge, not the
    // apex above it.
    if (this.grounded && !wasGrounded) {
      this.landed = true;
      this.impactSpeed = Math.hypot(ivx, ivy, ivz);
      const n = this.contactNormal;
      this.impactNormalY = this._bestNormalY > -Infinity ? n.y : 1;
      // `cos(theta)` off the surface normal, which HP-14 raises to the third
      // power on land and the second in water. Straight down onto the flat is
      // 1; a glancing arrival along a slope is small, and the whole severity
      // goes with its cube.
      this.impactCosTheta = this.impactSpeed > 1e-9
        ? Math.abs((ivx * n.x + ivy * n.y + ivz * n.z) / this.impactSpeed)
        : 1;
      this.impactMaterial = this.contactMaterial;
      this.fallHeight = this.lastCollisionHeight - this.body.position.y;
    }
    this.jumpArmed = this._armed;
    this.contacted = this._bestNormalY > -Infinity;
    if (this.grounded) this.lastCollisionHeight = this.body.position.y;

    if (this.grounded) this.poseFlags &= ~POSE_FLAG_JUMP;
    this.previousEyeHeight = this.eyeHeight;
    const target = EYE_HEIGHT[this.pose];
    if (this.eyeProgress >= 1) {
      this.eyeHeight = target;
    } else {
      this.eyeProgress = Math.min(1, this.eyeProgress + dt / this.eyeDuration);
      this.eyeHeight = this.eyeFrom + (target - this.eyeFrom) * this.eyeProgress;
    }
  }

  /** Eye position for a render, interpolated between the last two ticks. */
  eye(alpha = 1, out = { x: 0, y: 0, z: 0 }) {
    const p = this.body.position;
    const q = this.body.previous;
    out.x = lerp(q.x, p.x, alpha);
    out.y = lerp(q.y, p.y, alpha) + lerp(this.previousEyeHeight, this.eyeHeight, alpha);
    out.z = lerp(q.z, p.z, alpha);
    return out;
  }

  /**
   * Spend a queued jump, if this tick's gate allows one. True if it fired.
   *
   * The gate is the previous tick's contact, not `grounded` and not
   * `MAX_GROUND_SLOPE` (PHY-1, item 2). The pose test is a viewer choice and
   * stays one: the engine's own refusal to re-jump comes from the sound
   * trigger still being `c_SstJump`, which `soldier.js` models as a press edge.
   *
   * `cmdX`/`cmdZ` are this tick's commanded movement — `vCmd` — which the
   * caller has not yet spent on anything, so both terms below land where the
   * engine puts them.
   */
  #tryJump(dt, cmdX, cmdZ) {
    if (!this._jumpQueued) return false;
    this._jumpQueued = false;
    if (!this.jumpArmed || this.pose !== POSE_STAND) return false;
    const n = this.contactNormal;
    // `d_hat` is the commanded movement with **y forced to zero before**
    // normalising (client `0x0050166c`), so only the normal's horizontal part
    // can enter the dot. Running into a rise gives a negative dot and a weaker
    // jump; running down one clamps back to 1.
    const len = Math.hypot(cmdX, cmdZ);
    const dot = len > 1e-9 ? (cmdX / len) * n.x + (cmdZ / len) * n.z : 0;
    const K = Math.min(1 + dot, 1);
    // Through the **accumulator**, not onto the velocity, and this is the
    // detail that decides the apex. The engine scales the whole vector by
    // `g_simulationFps` and adds it to the same accumulator gravity was
    // already seeded into, so the four sub-steps spend the jump and the tick's
    // own gravity together. The `* fps` is `/ dt` at the engine's own rate;
    // written as `/ dt` it delivers exactly `JUMP_IMPULSE` of delta-v from the
    // jump term at any tick rate.
    //
    // Setting `v.y = 6.0` instead skips gravity's share of that first tick and
    // lands the apex at 1.197 m rather than 1.122 m. See the constant.
    const inv = 1 / dt;
    this.body.addAcceleration(
      (-JUMP_COMMAND_KICK * cmdX) * inv,
      (K * n.y * JUMP_IMPULSE) * inv,
      (-JUMP_COMMAND_KICK * cmdZ) * inv);
    this.grounded = false;
    this.jumpArmed = false;
    this.poseFlags |= POSE_FLAG_JUMP;
    return true;
  }

  /**
   * Record a contact, the way `handleCollision` does.
   *
   * Two things come out of it and both are per-tick. The kept normal is the
   * **most upward** of the frame, not the last or the nearest (lnxded
   * `0x0827d4d5`-`0x0827d503`), which is what makes a jump in the corner of a
   * room use the floor rather than the wall. And the jump-arming bit is set by
   * any contact whose `normal.y` exceeds `JUMP_CONTACT_NORMAL_Y` on a material
   * that is not Water — so treading water never arms a jump, and a 70-degree
   * face does, even though nothing that steep counts as `grounded` here.
   */
  #contact(nx, ny, nz, material) {
    if (!Number.isFinite(ny)) return;
    if (ny > this._bestNormalY) {
      this._bestNormalY = ny;
      this.contactNormal.x = nx;
      this.contactNormal.y = ny;
      this.contactNormal.z = nz;
      this.contactMaterial = material;
    }
    if (ny > JUMP_CONTACT_NORMAL_Y && material !== MATERIAL_WATER) {
      this._armed = true;
    }
  }

  /** The spheres making up the capsule, lowest lifted by a step when grounded. */
  #capsule() {
    const height = this.height;
    const r = BODY_RADIUS;
    const floor = (this.grounded ? STEP_HEIGHT : 0) + r;
    const top = Math.max(floor, height - r);
    const offsets = this._offsets;
    offsets.length = 0;
    offsets.push(floor);
    const mid = (floor + top) / 2;
    if (mid - floor > 0.05) offsets.push(mid);
    if (top - floor > 0.05) offsets.push(top);
    return offsets;
  }

  /**
   * Move along the integrator's delta, stopping at hulls and sliding along them.
   *
   * Standard iterate-and-project: sweep, advance to just short of the contact,
   * strip the component of both the remaining motion and the velocity that goes
   * into the surface, repeat. Four passes handles a corner (two walls) and a
   * corner with a floor; anything needing a fifth is a crack and stopping there
   * is the right answer.
   */
  #resolve() {
    const world = this.world;
    const body = this.body;
    this.contacts = 0;
    if (!world || !world.sweepSphere) return;
    const from = body.previous;
    let px = from.x, py = from.y, pz = from.z;
    let rx = body.delta.x, ry = body.delta.y, rz = body.delta.z;
    const offsets = this.#capsule();
    for (let pass = 0; pass < SLIDE_PASSES; pass++) {
      const dist = Math.hypot(rx, ry, rz);
      if (dist < 1e-6) break;
      const dx = rx / dist, dy = ry / dist, dz = rz / dist;
      const hit = sweepCapsule(world, px, py, pz, dx, dy, dz, dist,
                               BODY_RADIUS, offsets);
      if (!hit) {
        px += rx; py += ry; pz += rz;
        rx = 0; ry = 0; rz = 0;
        break;
      }
      this.contacts++;
      this.#contact(hit.nx, hit.ny, hit.nz, hit.material);
      const advance = Math.max(0, hit.t - SKIN);
      px += dx * advance; py += dy * advance; pz += dz * advance;
      // A floor-ish contact is ground, which is how you stand on a bunker roof
      // rather than only on the heightfield.
      const floorish = hit.ny >= MAX_GROUND_SLOPE;
      if (floorish) this.grounded = true;
      // Walking into a wall must not lift the body. A wall's normal has a small
      // upward component wherever the hull is not perfectly vertical, and
      // projecting 6 m/s of forward motion onto it converts a slice of that
      // into climb — which over a few seconds walks a body up the side of a
      // building. While grounded, a wall contact is flattened first so it can
      // only ever redirect sideways.
      let nx = hit.nx, ny = hit.ny, nz = hit.nz;
      if (this.grounded && !floorish) {
        const flat = Math.hypot(nx, nz);
        if (flat > 1e-6) { nx /= flat; ny = 0; nz /= flat; }
      }
      // What is left of the move, projected onto the contact plane.
      const left = dist - advance;
      rx = dx * left; ry = dy * left; rz = dz * left;
      const into = rx * nx + ry * ny + rz * nz;
      if (into < 0) { rx -= nx * into; ry -= ny * into; rz -= nz * into; }
      const v = body.velocity;
      const vInto = v.x * nx + v.y * ny + v.z * nz;
      if (vInto < 0) { v.x -= nx * vInto; v.y -= ny * vInto; v.z -= nz * vInto; }
    }
    body.position.x = px;
    body.position.y = py;
    body.position.z = pz;
  }

  /**
   * Refuse a horizontal move onto ground too steep to have walked up.
   *
   * `#resolve` cannot see this and is not meant to: the heightfield is never in
   * the sweep (see `WorldCollider.sweepSphere`), because a body standing on a
   * function of (x, z) is one lookup and a clamp rather than half a million
   * triangles. But that clamp is unconditional, so without this a body walks
   * into a cliff face and the clamp ratchets it up the outside — six metres a
   * second of forward input turning into six metres a second of climb.
   *
   * So the *same* `MAX_GROUND_SLOPE` the hull contacts are judged by is applied
   * to the terrain here, once, after the sweep and before the clamp: if the
   * move would put the feet on ground steeper than that and *higher* than where
   * they are, the uphill component of it is stripped and the across-the-face
   * component is kept, which is the wall behaviour in `#resolve` written for a
   * surface that is not in the sweep. Walking downhill, or off the world, is
   * never refused — you are allowed to fall off anything.
   *
   * Note this deliberately does not fire while airborne. Landing on a cliff is
   * landing; what happens next is a walk attempt, and that is judged here.
   */
  #refuseSteepGround() {
    const world = this.world;
    if (!this.grounded || !world || !world.surfaceHeight) return;
    const field = world.heightfield;
    if (!field || !field.normal) return;
    const p = this.body.position;
    const q = this.body.previous;
    let dx = p.x - q.x, dz = p.z - q.z;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return;
    if (!this.#tooSteep(p.x, p.z, p.y)) return;
    this.contacts++;
    // The heightfield normal's horizontal part points downhill, so a move with
    // a negative dot against it is a move up the face.
    const nx = _normal[0], nz = _normal[2];
    const flat = Math.hypot(nx, nz);
    const v = this.body.velocity;
    if (flat > 1e-6) {
      const ux = nx / flat, uz = nz / flat;
      const into = dx * ux + dz * uz;
      if (into < 0) { dx -= ux * into; dz -= uz * into; }
      const vInto = v.x * ux + v.z * uz;
      if (vInto < 0) { v.x -= ux * vInto; v.z -= uz * vInto; }
      p.x = q.x + dx;
      p.z = q.z + dz;
      // One pass, then give up: sliding across a face can land on another face
      // just as steep (the inside of a gully), and creeping up that one is the
      // bug this exists to stop.
      if (!this.#tooSteep(p.x, p.z, p.y)) return;
    }
    p.x = q.x;
    p.z = q.z;
    v.x = 0;
    v.z = 0;
  }

  /** Is the ground at (x, z) both above `y` and steeper than a body may climb? */
  #tooSteep(x, z, y) {
    const ground = this.world.surfaceHeight(x, z);
    // Level or downhill is always allowed, and so is a step small enough that
    // it is the lattice's own bilinear wobble rather than a face.
    if (!Number.isFinite(ground) || ground <= y + SKIN) return false;
    this.world.heightfield.normal(x, z, _normal);
    return Number.isFinite(_normal[1]) && _normal[1] < MAX_GROUND_SLOPE;
  }

  /**
   * Put the feet on whatever is under them: the heightfield, the sea surface,
   * or a hull.
   *
   * Terrain is a clamp rather than a sweep on purpose. The heightfield is a
   * function of (x, z) — `WorldCollider.surfaceHeight` is one bilinear sample
   * and already answers "ground or sea, whichever is higher" — so sweeping a
   * sphere against half a million terrain triangles to learn the same number
   * would be pure waste.
   *
   * Hulls get a downward **ray**, not a sweep, and that distinction was paid
   * for: a sweep returns the nearest contact of *any* orientation, so standing
   * under Wake's farm awning the nearest thing below the body was one of the
   * roof posts beside it, the floor underfoot was never reported, the body went
   * un-grounded, the capsule dropped its lowest sphere back into the floor it
   * had been standing on, and it wedged there for good. A vertical ray can only
   * meet what is actually underneath.
   */
  #settle() {
    const world = this.world;
    const p = this.body.position;
    const v = this.body.velocity;
    let ground = -Infinity;
    // The normal and material of whatever the feet end up on, for `#contact`.
    // Terrain answers with its own bilinear normal; the sea plane is flat and
    // is material 1, which is what keeps a jump from arming on open water.
    let groundNx = 0, groundNy = 1, groundNz = 0, groundMaterial = -1;
    if (world && world.surfaceHeight) {
      const h = world.surfaceHeight(p.x, p.z);
      if (Number.isFinite(h)) {
        ground = h;
        const level = world.waterLevel;
        if (level != null && Math.abs(h - level) <= 1e-6) {
          groundMaterial = MATERIAL_WATER;
        } else {
          if (world.heightfield && world.heightfield.normal) {
            world.heightfield.normal(p.x, p.z, _normal);
            if (Number.isFinite(_normal[1])) {
              groundNx = _normal[0]; groundNy = _normal[1]; groundNz = _normal[2];
            }
          }
          if (world.heightfield && world.heightfield.material) {
            groundMaterial = world.heightfield.material(p.x, p.z);
          }
        }
      }
    }
    if (world && world.cast) {
      // From a step up, straight down, far enough to catch both the lift onto a
      // kerb and the glue onto a descending ramp. `cast` answers for terrain and
      // sea as well, which only agrees with `surfaceHeight` above — harmless,
      // and it costs one entry in the collider's cast meter per tick.
      const hit = world.cast(p.x, p.y + STEP_HEIGHT, p.z, 0, -1, 0,
                             STEP_HEIGHT + SNAP_DOWN);
      if (hit && hit.ny >= MAX_GROUND_SLOPE && hit.y > ground) {
        ground = hit.y;
        groundNx = hit.nx; groundNy = hit.ny; groundNz = hit.nz;
        groundMaterial = hit.material;
      }
    }
    if (Number.isFinite(ground)) {
      if (p.y <= ground + SKIN) {
        p.y = ground;
        if (v.y < 0) v.y = 0;
        this.grounded = true;
        this.#contact(groundNx, groundNy, groundNz, groundMaterial);
      } else if (this.grounded && v.y <= 0 && p.y - ground <= SNAP_DOWN) {
        // Glued to ground falling away underneath, so walking down a dune is
        // walking rather than a sequence of small falls. Still a contact: a
        // soldier jogging down a slope may jump off it.
        p.y = ground;
        v.y = 0;
        this.#contact(groundNx, groundNy, groundNz, groundMaterial);
      } else {
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }
    // Held up by something the ground probe did not find — a hull face too
    // steep to stand on, or a body that has ended up inside geometry. It is
    // supported either way, and saying so matters twice over: without it the
    // downward velocity grows without bound behind the obstruction and fires
    // the body through the floor the instant it comes free, and the capsule
    // never lifts back to its step height, so a body that wedges stays wedged.
    // Only a real fall counts as wedged: at a jump's apex v.y is barely
    // negative and one tick moves the body less than the epsilon, and this
    // guard used to call that "supported" — one grounded tick a metre off
    // the floor, which re-armed a held jump into a mid-air double jump. A
    // genuinely blocked body gains two ticks of gravity within two ticks;
    // demanding that much fall costs it nothing.
    const wedgeMinFall = 2 * Math.abs(GRAVITY) / TICK_RATE;
    if (!this.grounded && v.y < -wedgeMinFall
        && p.y >= this.body.previous.y - 1e-4) {
      v.y = 0;
      this.grounded = true;
    }
    if (world && world.heightfield && this.grounded) {
      this.material = world.heightfield.material(p.x, p.z);
    }
  }
}

function clamp(value, lo, hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}
