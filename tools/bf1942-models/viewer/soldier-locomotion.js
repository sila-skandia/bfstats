// The engine's numbers for how a soldier moves: the speed tables and the ramp
// that reaches them, the prone dive, mass and drag, the jump and the contact
// that arms it, the airborne locomotion gain, and the viewer's own step and
// slope limits.
//
// Split out of `physics.js`, which re-exports all of it; see that file's header
// for the engine facts behind these numbers.

import { PARACHUTE_DRAG, PARACHUTE_SPEED } from './parachute.js';

// --- the speed tables ------------------------------------------------------

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

// --- the animation state's own speed, and the prone dive (PHY-7) -------------

/**
 * A locomotion state can multiply the speed table, and exactly one of them does.
 *
 * `BFSoldier::handlePlayerInput` (lnxded `0x08273c70`) does not reach
 * `directionalSpeed` unscaled. Before the tables it runs both state machines'
 * `AnimationStateMachineInstance::checkTransitions(input, float&, float&,
 * float&)` and keeps the **lower body's** three floats (`0x08275a??`, the
 * `iVar20 == 0` arm of the two-machine loop); the first of them survives as a
 * multiplier into
 *
 *     vCmd = soldier[0x4b] * directionalSpeed[pose*2 + (ramp <= 0)] * stateSpeed
 *
 * and the three floats are the state's own `AnimationStateMachine.setSpeed
 * <fwd> <?> <strafe>`. Every walk, run, stand, crouch and lie state in
 * `animations/AnimationStates*.con` declares `setSpeed 1.0 1.0 1.0`, so the
 * multiplier is inert — with **one exception**:
 *
 *     AnimationStateMachine.createState Lb_RunStandToLie
 *     AnimationStateMachine.addAnimation Animations/Lie/LowerBody/3PJump2LieLower.baf 1.5 c_AsmPlayOnce
 *     AnimationStateMachine.addTransitionWhenDone Lb_Lie
 *     AnimationStateMachine.setSpeed 6.0 1.0 1.0
 *     AnimationStateMachine.setFlag c_AsmIsLying
 *
 * That state is the dive to the ground, and it is where BF1942's prone slide
 * comes from. `getPose()` (`0x0827ddc0`) reads the animation machine's own
 * current flags, so `c_AsmIsLying` means the pose is already PRONE for the
 * whole of it and the table hands out 1 m/s — times `setSpeed`'s 6.0, which is
 * exactly the standing run. You keep running speed for the length of the clip,
 * then drop to a 1 m/s crawl when `Lb_Lie` takes over.
 *
 * Which of the two lie transitions you get is decided in the same function: it
 * multiplies the forward input by the *current* state's own forward speed and
 * branches on the sign (`0x08275xxx`, the `fStack_268 < 0.0` test). Moving
 * backward gives `Lb_StandToLie` — `setSpeed 1.0 1.0 1.0`, no slide. Anything
 * else, standing still included, gives the dive; standing still just has no
 * ramp for the 6.0 to multiply. From a crouch it is `Lb_CrouchToLie`, also 1.0.
 */
export const DIVE_SPEED_FACTOR = 6;

/**
 * How long the dive lasts: `3PJump2LieLower.baf` is **11 frames** and
 * `Lb_RunStandToLie` plays it at **1.5x**, so `frames / (fps * rate)` at the
 * same nominal 26 fps `soldier.js`'s `STANCE_TRANSITION` is derived against —
 * **0.282 s**, about 1.7 m at a 6 m/s run.
 *
 * The soft term is the same one that table carries: no `.baf` header states a
 * nominal frame rate, and 26 fps is what the walk cycle implies against its own
 * declared step period. `3pAnimationsTweaking.con` separately says
 * `set3pAnimationSpeed Lb_RunStandToLie 1.40`, which would make it 0.302 s;
 * this uses the `addAnimation` rate, for consistency with `STANCE_TRANSITION`,
 * and the two answers are 20 ms apart.
 */
export const DIVE_DURATION = 11 / (26 * 1.5);

/**
 * `CommonSoldierData.inc`: `mass 100`, `drag 1.0`. Both shipped, both read.
 */
export const SOLDIER_MASS = 100;
export const SOLDIER_DRAG = 1.0;

/**
 * `setParachuteDrag 24.00` / `setParachuteSpeed 30.00`, same file.
 *
 * Both are re-exported from `parachute.js`, which owns the parachute and
 * carries the evidence. The one thing to carry here, because it used to be
 * recorded the other way round: **`setParachuteSpeed` is an acceleration**,
 * 30 m/s^2 along a forward axis, handed to
 * `PointPhysicsNode::addAccelerationAtRelativePosition` once per tick by
 * `BFSoldier::handleUpdate` (`0x08272700`, `0x082727e3`). It is not a speed
 * and it is not a terminal velocity.
 */
export { PARACHUTE_DRAG, PARACHUTE_SPEED };

/**
 * The soldier's bounding radius, for the drag term only. **Inferred.**
 *
 * The engine reads it from a virtual getter, not from any `.con`, so it is not
 * in the shipped data. 0.8 m was originally chosen because it makes the drag
 * equation land on 30.5 m/s of terminal velocity against the shipped
 * `setParachuteSpeed 30.00` — **and that argument is refuted**: the 30.00 is an
 * acceleration along the body's forward axis, not a speed (see
 * `parachute.js`'s `PARACHUTE_SPEED`), so the two numbers were never
 * commensurable and the agreement is a coincidence.
 *
 * What is now known about the engine's own number: the soldier's collision
 * geometry radius is exactly **1.0** (the 17-vertex hull
 * `SkeletonCollisionMeshTemplate`'s constructor hard-codes, `0x083af34a` on),
 * and `BCompositeObject::getBoundingRadius` (`0x08165630`) then takes the max
 * against every child's `|pos| + radius`. Neither end is settled; see
 * `parachute.js`'s `PARACHUTE_DRAG_RADIUS` for the bounds and the choice.
 *
 * 0.8 is kept here because every fall-damage figure in the corpus (HP-14: no
 * damage below 3.97 m, lethal at 7.55 m) was measured against it, and at the
 * soldier's own `drag 1.0` the whole term is inert either way — terminal
 * velocity is 730 m/s at 0.8 and 145 m/s at 1.8, and a man falls essentially
 * in vacuum at both. The parachute, where the drag is 24x larger and the
 * radius therefore decides whether a landing kills you, does not use this.
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
