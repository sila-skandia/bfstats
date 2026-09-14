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

/** Our fixed tick. Not the engine's — see the file header. */
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
 * The 25x multiplier in the drag scale at `0x00578990`.
 *
 * The disassembly reads `scale = 1 + 24 * clamp(field(+0x44) / radius, 0, 1)`,
 * applied to the velocity before the wind is subtracted. What field +0x44 holds
 * is **open** — water submersion depth is the standing suspicion, since a 25x
 * drag multiplier at full immersion is about what wading through water should
 * cost. Callers pass `submersion` as a fraction of the bounding radius, and
 * every caller in this viewer passes 0, so the factor is inert until somebody
 * confirms what it is. Do not treat this constant as verified.
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
   *   - the velocity is pre-multiplied by `scale`, which is 1 unless field
   *     +0x44 is non-zero — see `DRAG_SUBMERSION_SCALE`.
   *
   * Applied once per update on the pre-integration velocity, not once per
   * sub-step. The engine asserts on mass 0 here ("Mass 0 when calculating
   * drag."), so a zero mass is a caller bug rather than a case to handle.
   */
  applyDrag(wind = WIND, submersion = 0) {
    if (!(this.drag > 0) || !(this.mass > 0)) return;
    const r = this.boundingRadius;
    const scale = 1 + DRAG_SUBMERSION_SCALE
      * Math.min(1, Math.max(0, r > 0 ? submersion / r : 0));
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
  updatePhysics(dt, { wind = WIND, submersion = 0 } = {}) {
    this.applyDrag(wind, submersion);
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
 * Jump velocity. **UNMEASURED — this is a tunable, not a fact.**
 *
 * The jump state exists in the client (`c_SstJump`, pose flag 0x80) but the
 * impulse constant was not found: it is not in the two speed tables, not in
 * `CommonSoldierData.inc`, and the state machine at `0x005013f8` only reads the
 * flag. 5.4 m/s is picked to give a ~1.0 m apex under `GRAVITY`
 * (`h = v^2 / 2g = 29.16 / 29.46`), which is roughly what the game looks like.
 *
 * To measure it properly: in wine, stand a soldier beside an object of known
 * height (a `stebarrel1_m1` is 0.86 m, a sandbag wall 1.1 m), jump, and record
 * whether the feet clear it; or time a flat-ground jump from leaving the floor
 * to landing, `t`, and read `v = |g| * t / 2`. Either gives the number to two
 * digits in one evening. Until then this stays labelled.
 */
export const JUMP_SPEED = 5.4;

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
 * of which is a movement volume. These are a plain vertical capsule sized off
 * the eye heights above: a man is about 0.15 m of skull above his eyes, and
 * 0.3 m is a shoulder's half-width. Prone is modelled as a short column rather
 * than a lying capsule, which is wrong in the pedantic sense and invisible in
 * the first-person view this drives.
 */
export const BODY_HEIGHT = Object.freeze([1.80, 1.30, 0.60]);
export const BODY_RADIUS = 0.3;

/**
 * How far a body is allowed to be lifted by an obstacle it walks into, and how
 * far it is glued to ground falling away beneath it. **Viewer choices.**
 *
 * Refractor's soldier does not step in this sense at all — it is a physics body
 * riding a contact solver. Without something like this a viewer body catches on
 * every 8 cm kerb in Berlin, so the lowest sphere of the capsule is lifted by
 * `STEP_HEIGHT` while grounded and a short downward sweep finds what to stand
 * on afterwards. Marked clearly because it is the one movement behaviour here
 * with no engine provenance whatsoever.
 */
export const STEP_HEIGHT = 0.45;
export const SNAP_DOWN = 0.45;

/**
 * Steepest surface that counts as standing on rather than sliding off.
 * **Viewer choice**, and permissive on purpose: BF1942 infantry climb dunes
 * that no modern shooter would allow.
 */
export const MAX_GROUND_SLOPE = Math.cos(60 * Math.PI / 180);

/**
 * Fraction of the ground speed a body may still steer with in the air.
 * **Viewer choice.** Retail's number is not known; 0 (pure ballistic) makes a
 * jump feel broken and 1 makes it feel like flight.
 */
export const AIR_CONTROL = 0.35;

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
    this._offsets = [];
    this._jumpQueued = false;
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

    // --- demanded velocity, off the two hardcoded tables -------------------
    const factor = walk ? WALK_SPEED_FACTOR : 1;
    const fwdSpeed = directionalSpeed(this.pose, forward) * factor;
    const sideSpeed = STRAFE_SPEED[this.pose] * factor;
    // Facing is +Z at yaw 0, matching the viewer's own look vector.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let wantX = sy * forward * fwdSpeed - cy * strafe * sideSpeed;
    let wantZ = cy * forward * fwdSpeed + sy * strafe * sideSpeed;
    // Diagonal input would otherwise beat both tables at once. The engine's own
    // combination of the two axes was not traced (the result is scaled again by
    // two per-soldier fields before use, `0x005013f8`), so this clamps the
    // resultant to the larger of the two authored speeds, which is the
    // conservative reading.
    const want = Math.hypot(wantX, wantZ);
    const cap = Math.max(fwdSpeed, sideSpeed);
    if (want > cap && want > 0) {
      wantX *= cap / want;
      wantZ *= cap / want;
    }

    const v = body.velocity;
    if (this.grounded) {
      // Infantry have no acceleration ramp in this game: you are at speed on
      // the frame you press the key and stopped on the frame you release it.
      v.x = wantX;
      v.z = wantZ;
    } else {
      v.x += (wantX - v.x) * Math.min(1, AIR_CONTROL * dt * TICK_RATE);
      v.z += (wantZ - v.z) * Math.min(1, AIR_CONTROL * dt * TICK_RATE);
    }

    if (this._jumpQueued) {
      this._jumpQueued = false;
      if (this.grounded && this.pose === POSE_STAND) {
        v.y = JUMP_SPEED;
        this.grounded = false;
        this.poseFlags |= POSE_FLAG_JUMP;
      }
    }

    // --- the engine's update ----------------------------------------------
    body.updatePhysics(dt);

    // --- and our resolve --------------------------------------------------
    this.#resolve();
    this.#refuseSteepGround();
    this.#settle();

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
    if (world && world.surfaceHeight) {
      const h = world.surfaceHeight(p.x, p.z);
      if (Number.isFinite(h)) ground = h;
    }
    if (world && world.cast) {
      // From a step up, straight down, far enough to catch both the lift onto a
      // kerb and the glue onto a descending ramp. `cast` answers for terrain and
      // sea as well, which only agrees with `surfaceHeight` above — harmless,
      // and it costs one entry in the collider's cast meter per tick.
      const hit = world.cast(p.x, p.y + STEP_HEIGHT, p.z, 0, -1, 0,
                             STEP_HEIGHT + SNAP_DOWN);
      if (hit && hit.ny >= MAX_GROUND_SLOPE && hit.y > ground) ground = hit.y;
    }
    if (Number.isFinite(ground)) {
      if (p.y <= ground + SKIN) {
        p.y = ground;
        if (v.y < 0) v.y = 0;
        this.grounded = true;
      } else if (this.grounded && v.y <= 0 && p.y - ground <= SNAP_DOWN) {
        // Glued to ground falling away underneath, so walking down a dune is
        // walking rather than a sequence of small falls.
        p.y = ground;
        v.y = 0;
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
    if (!this.grounded && v.y < 0 && p.y >= this.body.previous.y - 1e-4) {
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
