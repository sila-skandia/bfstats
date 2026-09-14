// Standing in a level on foot: a soldier's eye, his gait, and where he spawns.
//
// This is the **presentation half** of the first-person soldier, and it is only
// that. The motion is not here. `physics.js` owns the engine's gravity, its
// four-sub-step integrator, the two hardcoded speed tables, the pose camera
// offsets and the capsule sweep that stops a body at a wall; this file owns the
// camera that hangs off that body — the FOV, the pitch clamp, the view bob, the
// stance transition timing, the footstep clock — and picking a flag to spawn at.
//
// The split is the point. There is exactly one gravity constant, one speed
// table, one integrator and one collision resolver in this tree and all four
// are in `physics.js`; anything below that looks like a movement number is
// imported from there rather than restated. An earlier draft of this module
// carried its own `GRAVITY = 9.81`, its own `SPEED` table derived from footstep
// frequencies and stride lengths, and its own ray-ring sweep. All three have
// been superseded by numbers read straight out of `BF1942.exe` — see
// `features/bf1942-3d-models/first-person-soldier.md` §2 for what was wrong
// with the derivation and how the real values were found.
//
// Like `physics.js` and `collision.js` this imports no renderer and no DOM, so
// `tests/test_soldier.py` runs the real module under node against the real
// `WorldCollider`. The page owns the camera; this owns where it is allowed to
// be.

import {
  SoldierBody, FixedStep,
  EYE_HEIGHT, BODY_HEIGHT, BODY_RADIUS, STEP_HEIGHT, MAX_GROUND_SLOPE,
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, GRAVITY, JUMP_SPEED,
  POSE_STAND, POSE_CROUCH, POSE_PRONE, POSE_FLAG_CROUCH, POSE_FLAG_PRONE,
  POSE_FLAG_JUMP, directionalSpeed,
} from './physics.js';

// Re-exported so a caller that already has `soldier.js` does not have to reach
// past it for a number it is about to compare against. Every one of these is
// defined, cited and documented in `physics.js` — this is an alias list, not a
// second declaration.
export {
  EYE_HEIGHT, BODY_HEIGHT, BODY_RADIUS, STEP_HEIGHT, MAX_GROUND_SLOPE,
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, GRAVITY, JUMP_SPEED,
  directionalSpeed,
};

// -- what the game declares --------------------------------------------------

export const STANCES = ['stand', 'crouch', 'prone'];

/** The stance names this module speaks, against the pose indices physics uses. */
const STANCE_POSE = { stand: POSE_STAND, crouch: POSE_CROUCH, prone: POSE_PRONE };
const POSE_STANCE = ['stand', 'crouch', 'prone'];
const STANCE_FLAGS = { stand: 0, crouch: POSE_FLAG_CROUCH, prone: POSE_FLAG_PRONE };

/**
 * Eye height above the soldier's feet, per stance, in metres. Derived, by name,
 * from `physics.js`'s `EYE_HEIGHT` — this is the same three numbers keyed by
 * stance rather than by pose index.
 *
 * `Objects/Soldiers/Common/CommonSoldierData.inc` declares the *offsets*:
 *
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierStanding  0/0.65/0
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierCrouching 0/0.12/0
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierLying     0/-0.7/0
 *     ObjectTemplate.setCharacterHeight -1.00
 *
 * relative to a soldier origin that sits one metre above the contact point, so
 * the absolute heights are 1.65 / 1.12 / 0.30 m. The three offsets are shipped
 * data; reading `characterHeight` as the origin-to-feet distance is strong
 * inference, and it is the reading that makes all three numbers plausible at
 * once. See `physics.js`.
 */
export const EYE = Object.freeze({
  stand: EYE_HEIGHT[POSE_STAND],
  crouch: EYE_HEIGHT[POSE_CROUCH],
  prone: EYE_HEIGHT[POSE_PRONE],
});

/** Figure height per stance, for head clearance. `physics.js`'s `BODY_HEIGHT`. */
export const HEIGHT = Object.freeze({
  stand: BODY_HEIGHT[POSE_STAND],
  crouch: BODY_HEIGHT[POSE_CROUCH],
  prone: BODY_HEIGHT[POSE_PRONE],
});

/**
 * Top speed per gait, m/s. **Derived from the engine's own tables**, not from
 * stride lengths — this is `DIRECTIONAL_SPEED` and `WALK_SPEED_FACTOR` read out
 * by gait name, and it exists so the bob and the HUD can talk about a "run"
 * without re-deriving what a run is.
 *
 * `walk` is the run speed times `walkSpeedFactor` (1/3) because `c_PIWalk` is a
 * modifier on the standing speed, not a fourth table entry.
 */
export const GAIT_SPEED = Object.freeze({
  run: directionalSpeed(POSE_STAND, 1),
  walk: directionalSpeed(POSE_STAND, 1) * WALK_SPEED_FACTOR,
  crouch: directionalSpeed(POSE_CROUCH, 1),
  prone: directionalSpeed(POSE_PRONE, 1),
  stand: 0,
});

/**
 * Look clamp, degrees. `ObjectTemplate.setPointUpDownAngle 38.0 38.0`.
 *
 * The soldier carries this, not `SoldierCamera` — which declares no
 * `setInputToYaw/Pitch`, no `setMin/MaxRotation` and no `toggleMouseLook`, so
 * unlike a vehicle camera it is not a part that rotates. The body turns and the
 * camera rides it, which is why there is no free-look on foot in BF1942.
 */
export const PITCH_LIMIT_DEG = 38;

/**
 * `ObjectTemplate.setLiePointUpDownAngle 0.0 -6.0` — declared, and deliberately
 * NOT applied.
 *
 * Read literally against its standing twin it means "prone, you may look 0
 * degrees up and 6 degrees down", which is a view so narrow it is almost
 * certainly a modifier on the standing pair rather than a replacement for it.
 * Guessing which would be inventing a rule and calling it data, so prone uses
 * the same +-38 as standing and this constant sits here unread until somebody
 * settles it.
 */
export const LIE_POINT_UP_DOWN_DEG = [0.0, -6.0];

/**
 * Vertical FOV, degrees. `ObjectTemplate.set1pFov 0.47` — the only first-person
 * FOV in vanilla, identical in all 18 places any installed mod declares it.
 *
 * Its unit does not survive the data: read as a half-angle in radians it is
 * 2 x 0.47 rad = 53.9 degrees, read as the tangent of one it is
 * 2 x atan(0.47) = 50.4. Both land inside four degrees of each other, so the
 * ambiguity costs nothing; this takes the first.
 */
export const FOV_DEG = 53.86;

/**
 * Seconds between footsteps, per gait.
 * `Objects/Soldiers/Common/Sounds/SoldierSound.inc`, verbatim:
 * `setRunFrequency 0.36`, `setWalkFrequency 0.66`, `setCrouchFrequency 0.50`,
 * `setCrawlFrequency 0.6`. Drives the footstep clock, and through it the
 * footstep audio a later stage will hang off it.
 *
 * It used to drive the view bob's phase as well, on the reasoning that a
 * footstep period was at least an unambiguous cadence where the camera shake's
 * own rate was not. It is not that any more: `BOB` carries the engine's real
 * rates now, and a stride and a camera shake turn out to be unrelated clocks.
 *
 * Note what these are no longer used for. They were once half of a derivation
 * of the movement speeds — period times a stride length measured off the posed
 * feet — which produced 2.28 m/s for a run against the engine's actual 6. The
 * frequencies are real and shipped; the stride lengths are real and measured;
 * the product was wrong, because the locomotion clips are in-place and the
 * engine plays them at a rate driven by the speed rather than the other way
 * round. See the feature doc. They are a *cadence* here and nothing more.
 */
export const STEP_PERIOD = { run: 0.36, walk: 0.66, crouch: 0.50, prone: 0.60 };

/**
 * View bob, from the `setCameraShake*` declared on each locomotion state in
 * `animations/AnimationStates{Lower,Crouching,Lie}.con`, verbatim:
 *
 *     rem Lb_WalkForward                      rem Lb_RunForward
 *     setCameraShakeUpDown    0 0.06 7         0 0.08 15
 *     setCameraShakeLeftRight 0 0.01 0.5       0 0.02 5
 *     setCameraShakeYaw       0 0.10 3.0       0 0.15 8.0
 *     setCameraShakeFadeIn    0 0.6            0 0.6
 *
 *     rem Lb_CrouchForward                    rem Lb_LieForward
 *     setCameraShakeUpDown    0 0.07 10.0      0 0.04 5.0
 *     setCameraShakeFadeIn    0 0.3            0 0.3
 *
 * All three arguments are now read out of the binary rather than guessed, and
 * every one of them turned out to mean something other than what the shape of
 * the line suggests. `getCameraShakeTransform` (`0x00613e90`, and the symbol is
 * `dice::anim::AnimationStateMachineInstance::getCameraShakeTransform` in the
 * Linux server) computes, per channel and per frame:
 *
 *     value = amplitude * sin(rate * t) * fade * cameraShakeFactor
 *
 * with `t` a seconds accumulator the same function advances by `t += dt`. So:
 *
 *   - **The third argument is an angular rate in radians per second**, because
 *     it is the multiplier on seconds inside `sin()`. Not Hz. That is what an
 *     earlier draft could not pin down, and reading it as Hz is exactly why the
 *     run bob came out 2.4x too fast: 15 rad/s is 2.39 Hz, not 15.
 *   - **The first argument is a slot index**, 0..2. A state may chain three
 *     shakes, each with its own `timeToShake` and `fadeOut`, and the engine
 *     advances to the next when one expires. All of vanilla uses slot 0.
 *   - **`fadeIn` is a rate, not a duration**: `fade += fadeIn * dt`, clamped to
 *     one. `0.6` is therefore a 1.67 s ramp, not a 0.6 s one.
 *   - Nothing anywhere scales the shake by ground speed. The gait selects which
 *     state is current; within a state the rate is fixed in real time.
 *
 * `up`/`side`/`in` are metres of camera translation on Y/X/Z; `yaw` (and the
 * pitch and roll no locomotion state declares) is **degrees**, via the engine's
 * own `setRotateYDeg`. Crouching and lying declare a vertical bob and nothing
 * else — no sway, no yaw — which an earlier draft of this table invented for
 * them. `Lb_CrouchStrafe*`/`TurnLeft`/`TurnRight` declare `fadeIn 0.6` where
 * `Lb_CrouchForward`/`Backward` declare `0.3`; the gait here does not
 * distinguish the two, and takes the forward value.
 *
 * See `features/bf1942-engine-reference/ledger.md` rows CS-1..CS-6.
 */
export const BOB = {
  run:    { up: 0.08, upRate: 15, side: 0.02, sideRate: 5,   yaw: 0.15, yawRate: 8, fadeIn: 0.6 },
  walk:   { up: 0.06, upRate: 7,  side: 0.01, sideRate: 0.5, yaw: 0.10, yawRate: 3, fadeIn: 0.6 },
  crouch: { up: 0.07, upRate: 10, side: 0,    sideRate: 0,   yaw: 0,    yawRate: 0, fadeIn: 0.3 },
  prone:  { up: 0.04, upRate: 5,  side: 0,    sideRate: 0,   yaw: 0,    yawRate: 0, fadeIn: 0.3 },
};

/**
 * What the whole of `BOB` is multiplied by — and the reason this viewer walks
 * without a bob.
 *
 * `BFSoldier::updateCameraShake` (`0x004facd0`) drives a soldier's three
 * animation state machines. The upper body, which owns the `Ub_Fire*` weapon
 * recoil shakes, and the trigger machine, which owns `BigExplosion` /
 * `HitShake` / `DieShake`, are both passed a hardcoded `1.0f`. The **lower**
 * body — which owns every `Lb_Walk`, `Lb_Run`, `Lb_Crouch` and `Lb_Lie` state,
 * and therefore the entire walking view bob — is passed `cameraShakeFactor`.
 *
 * That is `DAT_0099000c`, a `PlayerControlObjectTemplate` console property. It
 * sits in BF1942.exe's *initialized* `.data` and the shipped bytes are
 * `00 00 00 00`. No static initialiser writes it; its only writers are the
 * console accessor behind the registrar at `0x004f1310`. Every `.con`, `.inc`
 * and `.tweak` in `Objects.rfa`, `animations.rfa`, `Game.rfa` and `menu.rfa`
 * was searched, and both `Settings/` trees: nothing assigns it.
 *
 * So the amplitudes above are real, carefully tuned, and **inert**. Retail
 * BF1942 has no first-person walking view bob, which is not what the authored
 * data looks like and is the trap anyone calibrating a soldier camera off the
 * `.con` files alone will fall into. This ships the engine's value; a caller
 * that wants the bob sets `soldier.cameraShakeFactor`, exactly as the console
 * property does, and gets the engine's real shape rather than an invention.
 */
export const CAMERA_SHAKE_FACTOR = 0;

/**
 * How long the eye takes to travel between stances, seconds. Not invented —
 * the animation state machine declares a clip and a rate for every one of these
 * transitions, and `frames / (fps x speed)` is how long it plays:
 *
 *     Lb_StandToCrouch  3PStand2CrouchLower.baf  5 frames  4.0x   48 ms
 *     Lb_CrouchToStand  3PStand2CrouchLower.baf  5 frames -4.0x   48 ms
 *     Lb_StandToLie     3PStand2CrouchLower.baf  5 frames  4.0x   48 ms
 *     Lb_CrouchToLie    3PCrouch2LieLower.baf    9 frames  1.6x  216 ms
 *     Lb_LieToCrouch    3PCrouch2LieLower.baf    9 frames -2.0x  173 ms
 *     Lb_LieToStand     3PCrouch2LieLower.baf    9 frames -3.0x  115 ms
 *
 * (`animations/AnimationStatesCrouching.con` and `...Lie.con`.) The one soft
 * term is the nominal clip rate, which no header states, and 26 fps is what the
 * walk cycle implies against its own declared step period. Getting
 * dropping-prone right at 48 ms and standing-up-from-prone right at 115 ms is
 * most of why BF1942 feels the way it does going down and coming up.
 *
 * These are handed to `SoldierBody.setPoseFlags` as the transition duration, so
 * the easing itself has one implementation and it is the body's.
 */
export const STANCE_TRANSITION = {
  'stand>crouch': 0.048, 'crouch>stand': 0.048,
  'stand>prone': 0.048, 'prone>stand': 0.115,
  'crouch>prone': 0.216, 'prone>crouch': 0.173,
};

// -- tuning that is purely runtime ------------------------------------------

const DEG = Math.PI / 180;
const PITCH_LIMIT = PITCH_LIMIT_DEG * DEG;

/**
 * How far below a spawn point to look for the floor it was authored on.
 *
 * Only `spawn()` uses it. A spawn authored slightly off its surface, or one the
 * level puts in the air over a rooftop, still has to arrive on the ground, and
 * the per-tick ground snap in `physics.js` is deliberately short (half a metre)
 * so that walking off a kerb is a fall rather than a teleport.
 */
const SPAWN_DROP = 600;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One soldier's camera, stance and gait, riding a `SoldierBody`.
 *
 * The page never writes anything but `input` and `look()`, and never reads
 * anything but the eye pose — the same seam `flight.js` keeps between
 * `VehicleState` and the presentation layer, for the same reason: a replay
 * should be able to write the state directly and the camera must not be able to
 * tell the difference.
 *
 * `step()` takes a **frame** dt, not a tick. Inside it a `FixedStep` accumulator
 * runs whole 60 Hz ticks of the body and leaves `clock.alpha` for the render to
 * interpolate with, so a recorded input stream replays to the same position on
 * a 30 fps machine and a 144 Hz one. That is the viewer's one deliberate
 * disagreement with retail, and the reason is in the header of `physics.js`.
 *
 * Yaw follows this page's own convention (`map.html`'s `lookVector`): forward is
 * `(sin yaw, 0, cos yaw)` in glTF space, so yaw 0 looks down +Z.
 */
export class Soldier {
  constructor({ collider = null, worldSize = 0 } = {}) {
    this.body = new SoldierBody({ world: collider });
    this.clock = new FixedStep();
    this.worldSize = worldSize;

    this.pitch = 0;
    this.stance = 'stand';

    this.speed = 0;           // horizontal, m/s, as actually achieved
    this.gait = 'stand';      // run | walk | crouch | prone | stand
    this.bobPhase = 0;        // 0..1 of the fade-in, not a clock
    this.bobTime = 0;         // seconds the current shake has been running
    this.bobGait = 'stand';   // the gait the fade-in belongs to
    this.stepPhase = 0;       // 0..1 through the current footstep
    this.steps = 0;           // footsteps taken, for the audio stage
    this.blocked = false;     // something stopped the last move
    this.casts = 0;           // collider queries spent on the last step()
    // `WorldCollider` treats the sea as one horizontal plane and reports it as
    // a surface, so standing on it is what falls out. BF1942 swims instead
    // (eight `3PSwim*` clips, `setSwimFrequency 1`), which is not this stage —
    // this flag exists so the page can say so rather than quietly lie.
    this.onWater = false;

    // Bob output, applied to the camera after the eye pose.
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
    // Per-soldier, because in the engine it is a template property a console
    // command can move, not a compile-time constant. Ships at the engine's
    // value, which is zero — see `CAMERA_SHAKE_FACTOR`.
    this.cameraShakeFactor = CAMERA_SHAKE_FACTOR;

    // Reused rather than reallocated: `step()` runs it up to twelve times.
    this._tickInput = { forward: 0, strafe: 0, walk: false };
  }

  // The body owns the position, the yaw and the world. These forward rather
  // than mirror, so there is never a stale copy to get out of step.
  get collider() { return this.body.world; }
  set collider(value) { this.body.world = value; }
  get x() { return this.body.position.x; }
  get y() { return this.body.position.y; }
  get z() { return this.body.position.z; }
  get yaw() { return this.body.yaw; }
  set yaw(value) { this.body.yaw = value; }
  get grounded() { return this.body.grounded; }
  get velocityY() { return this.body.velocity.y; }
  get pose() { return this.body.pose; }
  get height() { return BODY_HEIGHT[this.body.pose]; }
  get eyeHeight() { return this.body.eyeHeight; }
  get eyeY() { return this.body.position.y + this.body.eyeHeight; }

  /** Place the soldier's feet, facing `yaw`. Clears all motion. */
  spawn(x, y, z, yaw = 0) {
    this.body.place(x, y, z, yaw);
    this.body.setPoseFlags(0, 0);
    this.pitch = 0;
    this.stance = 'stand';
    this.gait = 'stand';
    this.speed = 0;
    this.bobPhase = 0; this.bobTime = 0; this.bobGait = 'stand';
    this.stepPhase = 0; this.steps = 0;
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
    this.blocked = false;
    this.onWater = false;
    this.clock.reset();
    this.settle();
    return this;
  }

  /**
   * Drop to the floor immediately, the way the engine does on spawn.
   *
   * The probe starts just above the feet, not above the head: a spawn under a
   * bunker roof or a bridge deck must land on the floor it was authored on, and
   * a probe that begins above the ceiling finds the ceiling's top instead.
   *
   * Deliberately **not** one `WorldCollider.cast`. The collider's terrain
   * component marches the height lattice and then bisects eight times, so its
   * precision is `maxDist / 256` — fine for a round's flight, and 2.3 m of
   * error on the 600 m probe a spawn drop wants. That error put a spawned
   * soldier a fifth of a metre under his own feet and silently ate the first
   * jump, which is what the node harness caught. So the two halves are asked
   * separately and the higher wins: hulls through the grid (exact,
   * Moller-Trumbore), ground and sea through `surfaceHeight` (exact, bilinear
   * off the same lattice) with no ray at all.
   *
   * This is spawn *placement*, not collision resolution — it runs once, off the
   * tick, and the body's own `#settle` is what holds the feet on the ground
   * every frame after it.
   */
  settle() {
    const collider = this.body.world;
    if (!collider) return this;
    const from = this.y + 0.5;
    let best = -Infinity;
    // `statics.cast`, not `collider.cast`: the latter folds the terrain marcher
    // in, and that is the imprecise half this method exists to route around.
    if (collider.statics) {
      const record = this._hit || (this._hit = {
        t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
        dx: 0, dy: -1, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
      });
      record.dx = 0; record.dy = -1; record.dz = 0;
      const hit = collider.statics.cast(
        this.x, from, this.z, 0, -1, 0, SPAWN_DROP, -1, record);
      if (hit) best = hit.y;
    }
    const ground = collider.surfaceHeight ? collider.surfaceHeight(this.x, this.z) : NaN;
    if (Number.isFinite(ground) && ground <= from && ground > best) best = ground;
    if (Number.isFinite(best)) {
      this.body.place(this.x, best, this.z, this.yaw);
      this.body.grounded = true;
    }
    return this;
  }

  /** Mouse delta, in the page's radians. Yaw is free, pitch is clamped. */
  look(dYaw, dPitch) {
    this.body.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /**
   * One frame: the stance the player asked for, then whole ticks of the body,
   * then the bob that rides them.
   *
   * `input` is the raw control state, named for the `c_PI*` actions BF1942's own
   * `Settings/Default/Controls/Infantry.con` binds:
   *
   *   forward  c_PIThrottle   W / S
   *   strafe   c_PIYaw        D / A   (strafe, not turn - the mouse turns you)
   *   walk     c_PIWalk       LeftShift, and it is the SLOWER gait
   *   crouch   c_PICrouch     LeftCtrl, held
   *   prone    c_PILie        Z, a toggle
   *   jump     c_PIAction     Space
   */
  step(frameDt, input = {}) {
    const collider = this.body.world;
    const castsBefore = collider ? collider.casts : 0;
    this.casts = 0;
    if (!(frameDt > 0)) return this;

    this.#applyStance(input);

    const forward = clamp(input.forward || 0, -1, 1);
    const strafe = clamp(input.strafe || 0, -1, 1);
    this.gait = this.#gaitFor(input, forward, strafe);
    this._tickInput.forward = forward;
    this._tickInput.strafe = strafe;
    this._tickInput.walk = !!input.walk;
    // Latched in the body, so a tap that lands between two ticks is not
    // swallowed. Held, it re-latches and you hop again on landing, which is
    // what holding Space does in the game.
    if (input.jump) this.body.jump();

    const startX = this.x, startZ = this.z;
    const ticks = this.clock.advance(frameDt);
    let contacts = 0;
    for (let i = 0; i < ticks; i++) {
      this.body.step(this.clock.dt, this._tickInput);
      contacts += this.body.contacts;
    }

    const travelled = Math.hypot(this.x - startX, this.z - startZ);
    this.speed = this.body.groundSpeed;
    this.blocked = contacts > 0;
    this.#updateWater();
    this.#advanceBob(frameDt, travelled);
    // The collider counts its own queries and `drainCost()` resets the counter,
    // so a frame that straddles a drain reads as zero rather than as negative.
    if (collider) this.casts = Math.max(0, collider.casts - castsBefore);
    return this;
  }

  /**
   * Eye position for a render: the body's interpolated eye, plus the bob.
   *
   * Interpolated between the last two ticks, so a 144 Hz monitor sees smooth
   * motion out of a 60 Hz sim rather than a 60 Hz stutter. `this.x/y/z` stay
   * the authoritative tick position — a check asserting where the feet ended up
   * must not read a number the renderer smoothed.
   */
  eye(out = { x: 0, y: 0, z: 0 }) {
    this.body.eye(this.clock.alpha, out);
    // Lateral sway rides the right vector of the look direction.
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    out.x += rightX * this.bobSide;
    out.y += this.bobUp;
    out.z += rightZ * this.bobSide;
    return out;
  }

  /** The view yaw, which is the body's plus the bob's roll of the head. */
  get viewYaw() { return this.yaw + this.bobYaw * DEG; }

  /** Is there room to be `height` tall here? */
  headroom(height) {
    const collider = this.body.world;
    if (!collider || !collider.cast) return true;
    return !collider.cast(this.x, this.y + 0.1, this.z, 0, 1, 0, height);
  }

  /**
   * Crouch is held, prone is a toggle, and the eye eases between them over the
   * duration the animation clip declares.
   */
  #applyStance(input) {
    const wanted = input.prone ? 'prone' : (input.crouch ? 'crouch' : 'stand');
    let want = wanted;
    // Standing up into a ceiling is not allowed; stay down instead.
    if (want !== this.stance && HEIGHT[want] > HEIGHT[this.stance]
        && !this.headroom(HEIGHT[want])) {
      want = this.stance;
    }
    if (want === this.stance) return;
    const duration = STANCE_TRANSITION[`${this.stance}>${want}`] || 0.05;
    this.stance = want;
    // The jump bit is the body's to set and clear, so it is carried across
    // rather than dropped by a stance change that happens mid-air.
    this.body.setPoseFlags(
      (this.body.poseFlags & POSE_FLAG_JUMP) | STANCE_FLAGS[want], duration);
  }

  #gaitFor(input, forward, strafe) {
    if (!forward && !strafe) return 'stand';
    if (this.stance === 'prone') return 'prone';
    if (this.stance === 'crouch') return 'crouch';
    return input.walk ? 'walk' : 'run';
  }

  /** Standing on the sea plane rather than on ground. */
  #updateWater() {
    const collider = this.body.world;
    const level = collider?.waterLevel;
    this.onWater = this.body.grounded && level != null
      && this.y <= level + 1e-6;
  }

  /**
   * View bob, and the footstep clock beside it. Two independent clocks that
   * used to be one.
   *
   * This is `getCameraShakeTransform`'s arithmetic — `amplitude *
   * sin(rate * t) * fade`, `t` in seconds, `fade` climbing at `fadeIn` per
   * second — carried out on the three channels a locomotion state declares.
   * There is deliberately no term in `travelled` or in `this.speed`: the engine
   * has none, and the gait's only job is to choose which row of `BOB` is live.
   *
   * Two details are the engine's rather than the obvious choice. A locomotion
   * shake does not fade *out* — no `Lb_*` state declares `setCameraShakeFadeOut`
   * — so standing still stops it dead and resets the clock, which is what the
   * engine does when the state machine enters an idle state carrying no shake.
   * And changing gait restarts the fade but not the clock, because
   * `setCurrentState` (`0x006127f0`) zeroes the fade factor and leaves the time
   * accumulator alone; the sine therefore never jumps mid-stride.
   */
  #advanceBob(dt, travelled) {
    const moving = travelled > 1e-5 && this.body.grounded;
    const shake = BOB[this.gait] || BOB.walk;
    if (!moving) {
      this.bobPhase = 0;
      this.bobTime = 0;
      this.bobGait = 'stand';
    } else {
      if (this.gait !== this.bobGait) {
        this.bobPhase = 0;
        this.bobGait = this.gait;
      }
      this.bobTime += dt;
      this.bobPhase = Math.min(1, this.bobPhase + shake.fadeIn * dt);
      const period = STEP_PERIOD[this.gait] || STEP_PERIOD.walk;
      // A stride is two steps; how far through the current one we are is what
      // says when a boot lands.
      const before = this.stepPhase;
      this.stepPhase = (this.stepPhase + dt / period) % 1;
      if (this.stepPhase < before) this.steps++;
    }
    const amount = this.bobPhase * this.cameraShakeFactor;
    if (amount <= 0) {
      this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
      return;
    }
    const t = this.bobTime;
    this.bobUp = Math.sin(shake.upRate * t) * shake.up * amount;
    this.bobSide = Math.sin(shake.sideRate * t) * shake.side * amount;
    this.bobYaw = Math.sin(shake.yawRate * t) * shake.yaw * amount;
  }
}

/** The pose index a stance name maps to, for a caller holding one of each. */
export function poseForStance(stance) { return STANCE_POSE[stance] ?? POSE_STAND; }

/** And back again. */
export function stanceForPose(pose) { return POSE_STANCE[pose] || 'stand'; }

// -- picking a spawn ---------------------------------------------------------

/**
 * The level's flags, each with the soldier spawns it owns.
 *
 * The join is the one the engine makes: a `SpawnPoint` declares `setGroup <n>`
 * and a `ControlPoint` declares `spawnGroupId <n>`, and the flag's team owns
 * every spawn in its group. Both halves are already in `scene.json` —
 * `controlPoints[].spawnGroupId` and `soldierSpawns[].group` — because
 * `extract_map.py` has emitted them since `spawn-points.md`.
 *
 * `team` 0 is a flag that starts neutral, and a group no control point claims
 * (a carrier's, from `GlobalSpawnGroups.con`) simply has no flag and is left
 * out rather than guessed at.
 */
export function spawnFlags(extras) {
  const points = extras?.controlPoints || [];
  const spawns = extras?.soldierSpawns || [];
  const byGroup = new Map();
  for (const spawn of spawns) {
    if (spawn?.group == null) continue;
    if (!byGroup.has(spawn.group)) byGroup.set(spawn.group, []);
    byGroup.get(spawn.group).push(spawn);
  }
  const flags = [];
  for (const point of points) {
    const group = point?.spawnGroupId;
    const owned = group == null ? null : byGroup.get(group);
    if (!owned || !owned.length) continue;
    flags.push({
      name: point.displayName || point.name || `flag ${group}`,
      team: point.team ?? null,
      group,
      position: point.position || null,
      uncapturable: !!point.unableToChangeTeam,
      spawns: owned,
    });
  }
  return flags;
}

/**
 * Which spawn of a flag's set to use, skipping the ones that would drop you out
 * of an aeroplane.
 *
 * `setSpawnAsParaTroper` is declared 489 times across vanilla's levels and is
 * **live 43 times**, in Market Garden (36), Liberation of Caen (6) and Coral Sea
 * (1) — the rest are explicit zeroes. Newly extracted levels carry the flag as
 * `soldierSpawns[].paratrooper`; every level extracted before that does not, so
 * a spawn sitting more than `airborne` metres above the ground under it is
 * treated as one too. That keeps already-shipped maps correct without a
 * re-extract.
 */
export function pickSpawn(flag, index = 0, { groundAt = null, airborne = 12 } = {}) {
  const spawns = flag?.spawns || [];
  const usable = spawns.filter(spawn => {
    if (spawn.paratrooper) return false;
    if (!groundAt || !spawn.position) return true;
    const ground = groundAt(spawn.position[0], spawn.position[2]);
    return !Number.isFinite(ground) || spawn.position[1] - ground < airborne;
  });
  const pool = usable.length ? usable : spawns;
  if (!pool.length) return null;
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/**
 * The page's look yaw that faces the way a spawn point was authored to face.
 *
 * `Object.rotation <yaw>/<pitch>/<roll>` is degrees in Refractor's frame, where
 * +Z is forward (measured in `camera-modes.md` §4 off the Corsair's own
 * propeller and rudder placements). The exporter mirrors Z, so a node's glTF
 * rotation is Ry(-yaw) and its forward becomes (sin yaw, 0, -cos yaw). This
 * page's own `lookVector` is (sin yaw, 0, cos yaw), so the two agree at
 * `PI - yaw`.
 */
export function spawnYaw(spawn) {
  const degrees = spawn?.rotation?.[0] || 0;
  return Math.PI - degrees * DEG;
}
