// Standing in a level on foot: a soldier's eye, his gait, and where he spawns.
//
// This is the **presentation half** of the first-person soldier, and it is only
// that. The motion is not here. `physics.js` owns the engine's gravity, its
// four-sub-step integrator, the two hardcoded speed tables, the pose camera
// offsets and the capsule sweep that stops a body at a wall; this file owns the
// camera that hangs off that body — the FOV, the pitch clamp, the view bob, the
// stance transition timing, the footstep clock. Picking a flag to spawn at is
// `spawn-flags.js`, re-exported from here.
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
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, GRAVITY, JUMP_IMPULSE,
  POSE_STAND, POSE_CROUCH, POSE_PRONE, POSE_FLAG_CROUCH, POSE_FLAG_PRONE,
  POSE_FLAG_JUMP, directionalSpeed, MATERIAL_WATER,
  RAMP_ACCEL, RAMP_DECEL, RAMP_LIMIT, RAMP_SCALE, ENGINE_TICK_RATE,
  RAMP_TO_FULL_SECONDS, RAMP_TO_STOP_SECONDS,
  DIVE_SPEED_FACTOR, DIVE_DURATION,
} from './physics.js';
import {
  Parachute, effectiveParachuteDrag, landingImpactSpeed,
  PARA_NONE, PARA_FALLING, PARA_OPEN, PARA_LANDED,
} from './parachute.js';
import {
  SwimState, DrownTimer, SWIM_CLIPS,
  SWIM_ENTER_DEPTH, SWIM_LEAVE_DEPTH, SWIM_FLOAT_DRAFT, SWIM_ACCEL_GAIN,
  WATER_DAMAGE_DELAY, HP_LOST_WHILE_DAMAGE_FROM_WATER, WATER_DAMAGE_INTERVAL,
} from './swim.js';
import { ClimbState, climbStart, climbTick } from './ladder-climb.js';

// Re-exported so a caller that already has `soldier.js` does not have to reach
// past it for a number it is about to compare against. Every one of these is
// defined, cited and documented in `physics.js` — this is an alias list, not a
// second declaration.
export {
  EYE_HEIGHT, BODY_HEIGHT, BODY_RADIUS, STEP_HEIGHT, MAX_GROUND_SLOPE,
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, GRAVITY, JUMP_IMPULSE,
  directionalSpeed, MATERIAL_WATER,
  RAMP_ACCEL, RAMP_DECEL, RAMP_LIMIT, RAMP_SCALE, ENGINE_TICK_RATE,
  RAMP_TO_FULL_SECONDS, RAMP_TO_STOP_SECONDS,
  DIVE_SPEED_FACTOR, DIVE_DURATION,
};
export { PARA_NONE, PARA_FALLING, PARA_OPEN, PARA_LANDED };
export { spawnFlags, pickSpawn, spawnYaw } from './spawn-flags.js';
export {
  SWIM_CLIPS, SWIM_ENTER_DEPTH, SWIM_LEAVE_DEPTH, SWIM_FLOAT_DRAFT,
  SWIM_ACCEL_GAIN, WATER_DAMAGE_DELAY, HP_LOST_WHILE_DAMAGE_FROM_WATER,
  WATER_DAMAGE_INTERVAL,
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
 * Vertical FOV, degrees: `renderer.fieldOfView 1` (Settings/VideoDefault.con),
 * one radian. `RenderView::setFieldOfView` (lnxded 0x08444260) keeps the value
 * and its tan(fov/2) ratio against the start-up value, and
 * `Frustum::setupFrustum` (0x08440c70) halves it for the top and bottom planes
 * and divides by the 0.75 aspect for the sides — a whole vertical angle in
 * radians, 57.30 degrees. `set1pFov 0.47` is not this camera's FOV at all: it
 * is what `setFirstPersonFov` hands each first-person part (corpus doc
 * `handweapon-view-and-deviation.md` §3), and the soldier's `vehicleFov`
 * (PlayerControlObjectTemplate +0x248) is a different field, unset for
 * soldiers, so the view keeps the renderer's default.
 */
export const FOV_DEG = 57.30;

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

/**
 * The upward escape `settle()` is allowed, and what makes it fire.
 *
 * A `SpawnPoint` is an authored coordinate and the engine does not validate
 * it: `BFSpawnPoint::spawn` (`0x08163d70`) is
 * `soldier->setAbsolutePosition(this->getAbsolutePosition())` and nothing else.
 * What saves a point authored inside solid geometry is the ordinary contact
 * path — the soldier is the vertex side at weight 1.0 against the ship's col1
 * faces (collision-response.md §5.3-5.4), the mass share is 0.95+, so he takes
 * the whole correction and is pushed clear.
 *
 * `settle()` probes downward only and so cannot do that. This is the narrowest
 * stand-in that is still honestly the engine's: **when the surface the soldier
 * would stand on leaves him no room to stand up, climb onto whatever is
 * pressing on his head.** A body that cannot stand is a body the engine would
 * have ejected; a body with headroom is left exactly where it was, which is
 * what keeps a legitimate indoor spawn — Stalingrad, a bunker, a carrier's
 * hangar deck under the flight deck — working.
 *
 * `STAND_ROOM` is the standing figure height plus a little
 * (`physics.js` `BODY_HEIGHT[POSE_STAND]`). `SLAB_LIMIT` caps how thick a thing
 * may be and still be climbed onto: past it, it is not a deck over your head,
 * it is the inside of something, and the honest answer is to stay put rather
 * than teleport a player through a wall. `ESCAPE_STEPS` bounds the walk for a
 * stack of decks.
 */
const STAND_ROOM = HEIGHT.stand + 0.05;
const SLAB_LIMIT = 2.0;
const ESCAPE_STEPS = 4;

/** How many undrained bail-out events to keep. A whole fall produces six. */
const PARACHUTE_EVENT_CAP = 64;
/** Shared empty result, so draining nothing costs no allocation per frame. */
const EMPTY_EVENTS = Object.freeze([]);

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
    // In the water, and the clock that kills him there. The law is `swim.js`:
    // `BFSoldier::updateSwimming` for the state and the draft, `Armor::update`'s
    // water-damage timer for the drowning. The body reads the state duck-typed
    // (it is injected, not imported, so `physics.js` keeps its one dependency).
    this.swim = new SwimState();
    this.body.swim = this.swim;
    this.drown = new DrownTimer();
    /** HP the water owes the caller's `Armor`; drained with `drainDrowning()`. */
    this.drownDamage = 0;
    /** True while the feet are on the water plane. Kept for the page's readout;
     *  it is now "he is swimming", because a man cannot stand on the sea. */
    this.onWater = false;
    this.landing = null;

    // Bob output, applied to the camera after the eye pose.
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
    // Per-soldier, because in the engine it is a template property a console
    // command can move, not a compile-time constant. Ships at the engine's
    // value, which is zero — see `CAMERA_SHAKE_FACTOR`.
    this.cameraShakeFactor = CAMERA_SHAKE_FACTOR;

    // Reused rather than reallocated: `step()` runs it up to twelve times.
    this._tickInput = { forward: 0, strafe: 0, walk: false, dead: false };

    // Bailing out. The state machine and both engine forces are in
    // `parachute.js`; this owns the pitch the free-fall term steers on and the
    // tick loop the whole thing runs in.
    this.chute = new Parachute();
    // Ladders (Gap 16): the state machine and the climb law live in
    // `ladder-climb.js`; the collider carries the level's ladder index
    // (`collider.ladders`, built from the exported `extras.isLadder` nodes)
    // and the body reads it duck-typed the way it reads `collider.statics`.
    this.climb = new ClimbState();
    /** Sound and animation events the last `step()` produced, oldest first. */
    this.parachuteEvents = [];
    /** Footstep cadence events produced by movement, drained with `drainFootstepEvents()`. */
    this.footstepEvents = [];
    /** The drag `parachute.js` asks for, pre-scaled for this body's radius. */
    this._chuteDrag = effectiveParachuteDrag(this.body.body.boundingRadius);
    this._chuteForward = { x: 0, y: 0, z: 0 };
    this._chuteBodyForward = { x: 0, y: 0, z: 0 };
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
    this.landing = null;
    this.clock.reset();
    this.chute.reset();
    this.swim.reset();
    this.drown.reset();
    this.drownDamage = 0;
    this.parachuteEvents.length = 0;
    this.footstepEvents.length = 0;
    this.body.setParachute(false);
    this.climb.reset();
    this.settle();
    return this;
  }

  /**
   * Step out of a flying aircraft: placed, moving, and **not** dropped to the
   * floor.
   *
   * `spawn()` ends in `settle()`, a 600 m probe that puts the feet on whatever
   * is underneath — right for a spawn pad and wrong for a bail-out, which is
   * why leaving a plane at altitude used to teleport the pilot to the ground
   * under it. Bailing out is not gated in the engine (SEAT-5/SEAT-8: the exit
   * check is pure geometry), so the whole of what should happen next is the
   * fall, and the fall needs the body left where the aircraft was.
   *
   * The inherited velocity is the aircraft's: a man who steps out of something
   * doing 90 m/s keeps doing 90 m/s. That is the ordinary consequence of the
   * exit not changing the body's momentum, and it is what makes the free-fall
   * gate (`vy < -8`) take a moment to arm after a level bail-out.
   *
   * `hull` is the owner id of the aircraft he left and `hullGrace` how long
   * the resolve looks through it (`SoldierBody.ignoreHull`): the exit point
   * is on the airframe, and without it the first tick stood him on the wing
   * and threw the momentum away.
   */
  bailOut(x, y, z, yaw = 0, vx = 0, vy = 0, vz = 0, { hull = -1, hullGrace = 0 } = {}) {
    this.body.place(x, y, z, yaw);
    this.body.setPoseFlags(0, 0);
    this.body.body.setVelocity(vx, vy, vz);
    this.body.ignoreHull(hull, hullGrace);
    this.body.grounded = false;
    this.body.contacted = false;
    this.body.jumpArmed = false;
    this.body.lastCollisionHeight = y;
    this.pitch = 0;
    this.stance = 'stand';
    this.gait = 'stand';
    this.speed = 0;
    this.bobPhase = 0; this.bobTime = 0; this.bobGait = 'stand';
    this.stepPhase = 0; this.steps = 0;
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
    this.blocked = false;
    this.onWater = false;
    this.landing = null;
    this.clock.reset();
    this.chute.reset();
    this.swim.reset();
    this.drown.reset();
    this.drownDamage = 0;
    this.parachuteEvents.length = 0;
    this.body.setParachute(false);
    this.climb.reset();
    return this;
  }

  /**
   * Hand a freshly `spawn`ed body the velocity of the hull it stepped out of.
   *
   * Nothing in the engine stops a man who leaves a moving jeep: he keeps its
   * speed, and on the ground the soldier's friction (the static/kinetic latch
   * in `SoldierBody.step`) bleeds it off, so he stumbles a few metres rather
   * than planting where the door was.
   */
  carry(vx = 0, vy = 0, vz = 0) {
    if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
      this.body.body.setVelocity(vx, vy, vz);
      this.body.sliding = vx !== 0 || vz !== 0;
    }
    return this;
  }

  /** `none` | `falling` | `open` | `landed` — the engine's four states. */
  get parachuteState() { return this.chute.state; }

  /**
   * Take the bail-out sound and animation triggers produced since the last
   * call, oldest first, and empty the queue.
   *
   * A queue rather than a per-frame array because a frame runs whole ticks
   * and a caller reads once per frame; a sound trigger that landed on the
   * first of three ticks must not be thrown away by the third.
   */
  drainParachuteEvents() {
    if (!this.parachuteEvents.length) return EMPTY_EVENTS;
    return this.parachuteEvents.splice(0, this.parachuteEvents.length);
  }

  /**
   * Take the footstep sound triggers produced since the last call, oldest first,
   * and empty the queue.
   */
  drainFootstepEvents() {
    if (!this.footstepEvents.length) return EMPTY_EVENTS;
    return this.footstepEvents.splice(0, this.footstepEvents.length);
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
    // Whether the floor is a hull's or the world's. `#escapeUp` needs to know:
    // being wedged under something with the ground under your boots is not the
    // same as being wedged under something inside a ship.
    const onStatic = Number.isFinite(best);
    const ground = collider.surfaceHeight ? collider.surfaceHeight(this.x, this.z) : NaN;
    if (Number.isFinite(ground) && ground <= from && ground > best) best = ground;
    if (Number.isFinite(best)) {
      if (onStatic && best !== ground) best = this.#escapeUp(collider, best);
      this.body.place(this.x, best, this.z, this.yaw);
      // `plant`, not a poke at `.grounded`: PHY-1's jump gate is the previous
      // tick's *contact*, and spawn placement runs off the tick, so the body
      // has to be told it is resting on something or it refuses its first
      // jump. Water spawns stay unarmed, which is what `plant` checks for.
      const level = collider.waterLevel;
      const onWater = level != null && Math.abs(best - level) <= 1e-6;
      this.body.plant(1, onWater ? MATERIAL_WATER : -1);
    }
    return this;
  }

  /**
   * Climb out from under a deck there is no room to stand under.
   *
   * See `STAND_ROOM`. The walk is: is there a surface within standing height
   * of `floor`? If not, stop — this is a place a man fits, and a low ceiling he
   * can crouch under is his business. If there is, find that thing's far side
   * by continuing the ray past it, and if it is thin enough to be a deck rather
   * than the inside of something, stand on top of it and ask again.
   *
   * The caller's gate — that the floor is a *static hit*, not the terrain or
   * the sea — is what makes this safe, and it is not a detail. The engine's
   * push-out goes along the contact normal, i.e. the shortest way out, and for
   * a man on open ground under a low beam the shortest way out is downward:
   * the engine does not lift him onto the beam, it refuses to let him stand up.
   * Up is only the way out when he is *inside* something, and having a hull's
   * own surface under his boots rather than the world's is the cheap and
   * honest version of that question. (The exact version is a capsule push-out
   * against the penetrating faces; a downward ray cannot ask it.)
   *
   * Vanilla gives this nothing to do today: across Midway, Wake, Coral Sea, Iwo
   * Jima and Guadalcanal, all 73 ship deck spawns land on a hull surface with
   * at least 3.0 m of headroom once the extractor's double-mirror is fixed and
   * the hull is at its own draft. It is here for the authored-inside case the
   * research predicted and for the mods that will have it.
   */
  #escapeUp(collider, floor) {
    if (!collider.statics) return floor;
    const record = this._up || (this._up = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 1, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
    });
    let at = floor;
    for (let step = 0; step < ESCAPE_STEPS; step++) {
      record.dx = 0; record.dy = 1; record.dz = 0;
      const ceiling = collider.statics.cast(
        this.x, at + 0.02, this.z, 0, 1, 0, STAND_ROOM, -1, record);
      if (!ceiling) return at;
      const under = ceiling.y;
      record.dx = 0; record.dy = 1; record.dz = 0;
      const over = collider.statics.cast(
        this.x, under + 0.02, this.z, 0, 1, 0, SLAB_LIMIT, -1, record);
      // Thicker than a deck, or unbounded: this is not something to climb onto.
      if (!over || !(over.y > at)) return floor;
      at = over.y;
    }
    return at;
  }

  /** Mouse delta, in the page's radians. Yaw is free, pitch is clamped. */
  look(dYaw, dPitch) {
    this.body.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /**
   * Where `look(dYaw, dPitch)` WOULD leave the view, without turning anybody.
   *
   * The same two lines as `look`, including the same clamp against the same
   * `setPointUpDownAngle` limit — that is the point of it being here rather
   * than in the caller. A renderer drawing between ticks uses it to show the
   * rotation the pending mouse counts have already bought (map.html), so the
   * displayed view leads the simulated one by exactly the amount the next
   * tick is going to apply and the hand-off costs no step.
   *
   * `viewYaw`, not `yaw`: the bob's roll of the head belongs to the view.
   */
  lookPreview(dYaw, dPitch, out = { yaw: 0, pitch: 0 }) {
    out.yaw = this.viewYaw + dYaw;
    out.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    return out;
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
    // A climbing body owns its own motion (ladder-climb.js) and owns nothing
    // of the gait: hang it at 'stand' so the run bob and the walk-cycle
    // readout stay quiet while his hands are full.
    if (this.climb.active) this.gait = 'stand';
    this._tickInput.forward = forward;
    this._tickInput.strafe = strafe;
    this._tickInput.walk = !!input.walk;
    this._tickInput.dead = !!input.dead;
    // Kept so `#stepParachute` can put them back on the tick after the chute
    // stops suppressing them; a frame can run up to twelve ticks and the
    // suppression is per tick, not per frame.
    this._inputForward = forward;
    this._inputStrafe = strafe;
    // Latched in the body, so a tap that lands between two ticks is not
    // swallowed — but only on the press edge. The game never re-jumps a held
    // Space: landing with the key still down leaves you on the floor until
    // it is released and pressed again. (An earlier build re-latched every
    // frame, which read as the soldier bouncing whenever Space was held.)
    // On a ladder the press is `stopClimbing`'s other way out: the climb
    // ends and the queued impulse below fires on the next tick, which is
    // the leap off the ladder.
    if (input.jump && !this._jumpHeld) {
      if (this.climb.active) this.climb.reset();
      this.body.jump();
    }
    this._jumpHeld = !!input.jump;

    const startX = this.x, startZ = this.z;
    const ticks = this.clock.advance(frameDt);
    let contacts = 0;
    // A landing is per-*tick* state and a frame may run several ticks, so it is
    // latched here rather than read off the body afterwards — otherwise a frame
    // that straddled the landing would drop the fall on the floor. Cleared each
    // frame; a caller reads it once, right after `step`.
    this.landing = null;
    // `parachuteEvents` is deliberately NOT cleared here. A frame can run
    // several world ticks and each one calls this method, so clearing per
    // call drops every event but the last tick's — which is how the 2.3 s
    // `fhs2` layer went missing from the first page trace. The caller drains
    // it (`drainParachuteEvents`); the cap below is what keeps a caller that
    // never does from growing it without bound.
    for (let i = 0; i < ticks; i++) {
      this.#stepParachute(this.clock.dt, input);
      // The chute bit as the collision will see it. `#stepParachute` has just
      // run, which is the engine's order too — `BFSoldier::handleUpdate` sets
      // and clears `+0x3e6` bit `0x10`, and `handleCollision` reads it during
      // the resolve that `body.step` is about to do.
      const underCanopy = this.chute.open;
      // Ladders first: a climbing tick is handled whole by `#stepLadder`
      // (`startClimbing`/`updateClimbing` replace the walk-and-resolve, the
      // engine's collision-group swap standing in here for skipping
      // `body.step`), and only a tick the climb does not take runs the
      // ordinary body.
      if (!this.#stepLadder(this.clock.dt, input)) {
        this.body.step(this.clock.dt, this._tickInput);
      }
      // `Armor::update`'s water-damage timer, on the same tick the body just
      // spent. Accumulated rather than applied: the `Armor` a soldier's HP lives
      // in belongs to the page, which is where `Armor::update` would apply it.
      this.drownDamage += this.drown.update(this.clock.dt, this.swim.swimming);
      contacts += this.body.contacts;
      if (this.body.landed) {
        this.landing = {
          // `BFSoldier::handleCollision` 0x0827d470-0x0827d4a5 forwards a zero
          // Vec3 in place of the speed while the parachute bit is set, so
          // HP-14 sees |v| = 0, subtracts its 8.0 and returns with nothing.
          // See `landingImpactSpeed` in parachute.js.
          impactSpeed: landingImpactSpeed(underCanopy, this.body.impactSpeed),
          bodyImpactSpeed: this.body.impactSpeed,
          underCanopy,
          fallHeight: this.body.fallHeight,
          cosTheta: this.body.impactCosTheta,
          normalY: this.body.impactNormalY,
          material: this.body.impactMaterial,
        };
      }
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
   * One tick of `parachute.js`, and the two things it answers with.
   *
   * Run **before** `SoldierBody.step`, because the acceleration it returns has
   * to land in the same accumulator the tick is about to spend and zero
   * (`PointBody.updatePhysics`: drag, integrate, re-seed gravity), which is
   * exactly where the engine's own
   * `addAccelerationAtRelativePosition(zero, forward * parachuteSpeed)` lands.
   *
   * The third thing it does is a *suppression*. Both free-fall and glide
   * states declare `AnimationStateMachine.setSpeed 0 1 0`, and PHY-8 has that
   * forward term multiplying the locomotion table — so WASD is worth nothing
   * in either, and the engine substitutes the look/facing term as the only air
   * control there is. Zeroing the tick input is how that reads here.
   *
   * `height` is above the **terrain**, not above the nearest surface: the
   * engine's own gate is `pos.y - terrainBase->getHeight(x, z)`
   * (`0x08275f10`), so `surfaceHeight` and not a downward cast is the right
   * question to ask the collider.
   */
  #stepParachute(dt, input) {
    const collider = this.body.world;
    const ground = collider?.surfaceHeight
      ? collider.surfaceHeight(this.x, this.z) : NaN;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const view = this._chuteForward;
    view.x = sy * cp; view.y = sp; view.z = cy * cp;
    const facing = this._chuteBodyForward;
    facing.x = sy; facing.y = 0; facing.z = cy;
    this.chute.update({
      dt,
      velocityX: this.body.body.velocity.x,
      velocityY: this.body.body.velocity.y,
      velocityZ: this.body.body.velocity.z,
      height: Number.isFinite(ground) ? this.y - ground : null,
      // In the sea is down, too: a swimmer is never `grounded`, and without
      // this a man who fell into the water stayed in free fall -- and in its
      // looping wind -- for as long as he swam.
      grounded: this.body.grounded || this.swim.swimming,
      deploy: !!input.deploy,
      dead: !!input.dead,
      forward: view,
      bodyForward: facing,
    });
    if (this.chute.events.length) {
      for (const event of this.chute.events) this.parachuteEvents.push(event);
      const over = this.parachuteEvents.length - PARACHUTE_EVENT_CAP;
      if (over > 0) this.parachuteEvents.splice(0, over);
    }
    const state = this.chute.state;
    const flying = state === PARA_FALLING || state === PARA_OPEN;
    this.body.setParachute(this.chute.open, this._chuteDrag);
    // No deviation here. HP-14 bills `F = getLastCollisionHeight() - y` and the
    // engine never lowers that field — `Armor::update` raises it to the current
    // `y` every tick the object is out of contact (`0x081730b0`-`0x081730e7`,
    // guarded by `Armor+0x129`), so `F` really is the whole drop for a
    // parachutist too. What makes the landing free is not the height term and
    // not the radius: `BFSoldier::handleCollision` hands the collision handler
    // a zero speed vector while the chute bit is set, which `step` applies
    // through `landingImpactSpeed`. See parachute.js.
    if (flying) {
      const a = this.chute.accel;
      if (a.x || a.y || a.z) this.body.body.addAcceleration(a.x, a.y, a.z);
      this._tickInput.forward = 0;
      this._tickInput.strafe = 0;
    } else {
      this._tickInput.forward = this._inputForward ?? 0;
      this._tickInput.strafe = this._inputStrafe ?? 0;
    }
  }

  /**
   * One tick of the ladder state (Gap 16, `ladder-climb.js`). True when the
   * tick was a climb tick and the ordinary body step must not run.
   *
   * A climb tick replaces the whole walk-and-resolve: the engine puts the
   * climbing soldier in collision group 4 (`startClimbing` 0x08281b20) and
   * out of the ordinary physics, and the motion along the ladder is a
   * constant rate (see the module header for why it must be). The dead body
   * falls out of the climb, and a jump press has already torn the climb off
   * at the queue site above — this method only moves, exits and grabs.
   */
  #stepLadder(dt, input) {
    const climb = this.climb;
    if (climb.active) {
      if (input.dead) {
        climb.reset();
        return false;   // a dead body falls the ordinary way
      }
      const ended = climbTick(climb, this.body, dt, clamp(input.forward || 0, -1, 1));
      // 'bottom' resumes the walk on the ground under the ladder; 'top' has
      // already been stepped through onto the deck. Both let the next tick
      // settle the feet the ordinary way.
      if (ended !== null) return false;
      return true;
    }
    // The grab. Forward into the ladder from the ground is the engine's own
    // start; backward out of it only takes near the TOP, which is stepping
    // backwards off a deck onto the ladder to climb down. Neither fires in
    // the air, in the water or under a canopy.
    if (!this.body.grounded || this.chute.open || this.swim.swimming) {
      return false;
    }
    const ladders = this.body.world?.ladders;
    if (!ladders || !ladders.length) return false;
    const forward = clamp(input.forward || 0, -1, 1);
    if (forward === 0) return false;
    if (forward > 0) return climbStart(climb, this.body, ladders);
    // Backward grab: only where the feet are beside the ladder's top rungs.
    const p = this.body.position;
    for (const ladder of ladders) {
      const atTop = ladder.ty - 0.5 <= p.y && p.y <= ladder.ty + 1.0;
      if (!atTop) continue;
      const dx = p.x - ladder.x, dz = p.z - ladder.z;
      const ax = ladder.tx - ladder.x, az = ladder.tz - ladder.z;
      const span2 = ax * ax + az * az;
      const horizontal2 = span2 > 0
        ? Math.max(0, dx * dx + dz * dz
            - (dx * ax + dz * az) ** 2 / span2)
        : dx * dx + dz * dz;
      if (horizontal2 <= 1.0 * 1.0) return climbStart(climb, this.body, ladders);
    }
    return false;
  }

  /**
   * Eye position for a render: the body's interpolated eye, plus the bob.
   *
   * Interpolated between the last two ticks, so a 144 Hz monitor sees smooth
   * motion out of a 60 Hz sim rather than a 60 Hz stutter. `this.x/y/z` stay
   * the authoritative tick position — a check asserting where the feet ended up
   * must not read a number the renderer smoothed.
   *
   * `alpha` defaults to this body clock's own leftover, which is what a caller
   * stepping the soldier at the DISPLAY rate wants. A caller stepping it from
   * inside a coarser fixed tick — the world's 30 Hz, which is exactly two of
   * this clock's 60 Hz ticks and therefore always leaves an alpha of zero —
   * must pass **1** to read this tick's own finished pose and do its own
   * interpolation against the coarser clock. map.html does that; there is no
   * body-clock alpha to read in the headless-World arrangement.
   */
  eye(out = { x: 0, y: 0, z: 0 }, alpha = this.clock.alpha) {
    this.body.eye(alpha, out);
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
   *
   * One of those transitions is not just a clip. Dropping prone from a stand
   * while not moving backward enters `Lb_RunStandToLie`, which declares
   * `setSpeed 6.0 1.0 1.0` — six times the prone table, i.e. a full run — for
   * the length of its own dive clip. That is BF1942's prone slide, and
   * `physics.js`'s `DIVE_SPEED_FACTOR` carries the engine reading (PHY-7). The
   * eye takes the same 0.282 s down, because it is one state, not two.
   *
   * The other two routes to the floor are ordinary: `Lb_StandToLie` (moving
   * backward when you press it) and `Lb_CrouchToLie` (from a crouch) both
   * declare `setSpeed 1.0 1.0 1.0`, so they stop you dead the way this module
   * always did.
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
    // The engine's own test is `forwardInput * currentState.speedForward < 0`,
    // and every stand/walk/run state declares 1.0, so it is the input's sign.
    const dive = want === 'prone' && this.stance === 'stand'
      && !((input.forward || 0) < 0);
    const duration = dive
      ? DIVE_DURATION
      : (STANCE_TRANSITION[`${this.stance}>${want}`] || 0.05);
    this.stance = want;
    // The jump bit is the body's to set and clear, so it is carried across
    // rather than dropped by a stance change that happens mid-air.
    this.body.setPoseFlags(
      (this.body.poseFlags & POSE_FLAG_JUMP) | STANCE_FLAGS[want], duration);
    // Leaving the dive — standing up, or crouching out of it — is a state with
    // a plain 1.0, so any slide still running is cancelled by the same call.
    this.body.setStateSpeed(dive ? DIVE_SPEED_FACTOR : 1, dive ? DIVE_DURATION : 0);
  }

  #gaitFor(input, forward, strafe) {
    if (!forward && !strafe) return 'stand';
    if (this.stance === 'prone') return 'prone';
    if (this.stance === 'crouch') return 'crouch';
    return input.walk ? 'walk' : 'run';
  }

  /**
   * In the water: the `c_AsmIsSwimming` flag, which is the only answer there is.
   *
   * This used to be "grounded, and the ground is the sea plane", because that
   * was what the collider offered. It is not a state the engine has — nothing
   * ever puts a soldier's feet *on* the water — so the flag the engine does have
   * is what the page reads now.
   */
  #updateWater() {
    this.onWater = this.swim.swimming;
  }

  /**
   * Take the HP the water has earned since the last drain.
   *
   * Handed out rather than applied for the same reason `parachuteEvents` is: the
   * soldier's `Armor` belongs to the page. A frame can run twelve ticks and the
   * timer can fire on more than one of them, so this is a sum and not a flag.
   */
  drainDrowning() {
    const owed = this.drownDamage;
    this.drownDamage = 0;
    return owed;
  }

  /** Seconds of grace left before the water starts taking HP, for a HUD. */
  get drownGrace() { return this.drown.graceLeft; }

  /** The lower/upper clip pair the swim state owes, or `null` when dry. */
  swimClips(dead = false) { return this.swim.clips(dead); }

  /**
   * `getCurrentStateFlags()` of the lower animation machine — the word the
   * engine's own readers test. Only the swim states contribute one here; every
   * other state this page models declares no flags.
   */
  get stateFlags() { return this.swim.stateFlags; }

  /**
   * Is there an active item at all? The engine's `c_AsmHideWeapon` gate.
   *
   * `swim.js`'s `itemsLocked` carries the three call sites. The short of it: a
   * swimmer's `BFSoldier::handleMessage` discards Fire, AltFire and every
   * MenuSelect (`0x082772ac`), `selectBestLoadedWeapon` bails out
   * (`0x08273af4`) and `enableItem` refuses (`0x082784b2`). So the page must not
   * special-case the trigger — it must take the weapon out of his hands, which
   * is what the owner means by "locked down".
   */
  get itemsLocked() { return this.swim.itemsLocked; }

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
    // The gait is the engine's criterion, not the distance: `Lb_*` states carry
    // the shake and an idle state carries none, so entering the idle state is
    // what stops it. That used to be indistinguishable from `travelled == 0`,
    // because the body stopped on the frame the key came up. It is not any
    // more — PHY-6's ramp coasts a released soldier for 0.35 s — and without
    // the gait test a stop now restarts the bob faintly as a *walk* shake for
    // a third of a second. `travelled` stays as the second half of the test so
    // that running into a wall still kills the bob.
    const moving = this.gait !== 'stand' && travelled > 1e-5 && this.body.grounded;
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
      if (this.stepPhase < before) {
        this.steps++;
        if (this.grounded && !this.swim.swimming && !this.chute.open) {
          this.footstepEvents.push({
            gait: this.gait,
            x: this.x,
            y: this.y,
            z: this.z,
          });
          if (this.footstepEvents.length > 32) {
            this.footstepEvents.splice(0, this.footstepEvents.length - 32);
          }
        }
      }
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
