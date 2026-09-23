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
// These modules import one thing outside themselves, `parachute.js`, which
// itself imports nothing — the parachute is a state machine over the body's
// velocity and height, not
// an integrator, so it lives beside this file rather than in it. It takes a
// duck-typed
// `world` with `surfaceHeight(x, z)`, `sweepSphere(...)` and `cast(...)` —
// which is exactly what `WorldCollider` is — so `tests/physics_harness.mjs` can
// drive the whole thing under node with no renderer, no GL and no three.js.
// Every one of the three is optional: a level exported before the collision
// flip has a heightfield and no hulls, and a body on one still walks.
//
// The pieces live in their own modules and this one re-exports them, so every
// importer keeps reading `./physics.js`:
//
//   `point-body.js`          gravity, wind, sub-steps, drag; `PointBody`
//   `fixed-step.js`          the 60 Hz tick, the catch-up cap; `FixedStep`
//   `soldier-pose.js`        pose flags, eye heights, body extents
//   `soldier-locomotion.js`  speed tables, ramp, dive, jump, step and slope
//   `walking-body.js`        `SoldierBody`, the capsule sweep and the resolve

export {
  GRAVITY, WIND, SUB_STEPS, DRAG_SUBMERSION_SCALE, PointBody,
} from './point-body.js';
export {
  TICK_RATE, TICK_DT, MAX_CATCH_UP_TICKS, FixedStep, lerp,
} from './fixed-step.js';
export {
  POSE_STAND, POSE_CROUCH, POSE_PRONE,
  POSE_FLAG_CROUCH, POSE_FLAG_PRONE, POSE_FLAG_JUMP, poseFromFlags,
  CHARACTER_HEIGHT, POSE_CAMERA_POS, EYE_HEIGHT, BODY_HEIGHT, BODY_RADIUS,
  POSE_TRANSITION,
} from './soldier-pose.js';
export {
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, directionalSpeed,
  ENGINE_TICK_RATE, RAMP_ACCEL, RAMP_DECEL, RAMP_LIMIT, RAMP_SCALE,
  RAMP_TO_FULL_SECONDS, RAMP_TO_STOP_SECONDS,
  applyMovementFactors, rampedDirectionalSpeed, rampedStrafeSpeed,
  DIVE_SPEED_FACTOR, DIVE_DURATION, SOLDIER_MASS, SOLDIER_DRAG,
  PARACHUTE_DRAG, PARACHUTE_SPEED, SOLDIER_BOUNDING_RADIUS,
  JUMP_IMPULSE, JUMP_COMMAND_KICK, JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER,
  LOCOMOTION_GAIN, STEP_HEIGHT, SNAP_DOWN, MAX_GROUND_SLOPE,
} from './soldier-locomotion.js';
export { SoldierBody } from './walking-body.js';
