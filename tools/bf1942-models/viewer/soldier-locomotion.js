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
 * is called once per simulation tick, which is a fixed 1/30 s (LOOP-1:
 * `Setup::updateInputs` re-quantises the 60 Hz pacing loop into whole 1/30 s
 * ticks). **0.212 s to full speed is the engine's wall-clock figure.**
 *
 * The ramp is carried as a rate per second and stepped by `dt`. The page's
 * soldier steps at the engine's 1/30 s (`soldier.js`), where it walks the
 * engine's integer ladder exactly — `600 * (1/30)` is 20.0 and `360 * (1/30)` is 12.0 in binary
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
 * The ramp register's share of the table, `sgn(r) * r^2` with `r = state/127`.
 * **PHY-9, settled squared** (lnxded `0x082747c6` scales by 1/127 once, then
 * `0x0827481b` multiplies r by r and `0x0827482c` restores the sign; the
 * strafe twin is `0x08274888`..`0x082748b0`). The page carried it linear
 * until 2026-10-22, when the move-law probe against the lab server (Wake,
 * `tests/test_move_law.py`) showed the linear ramp running ahead of the
 * server by centimetres in every ramp up and ramp down.
 */
export function rampShare(state) {
  const r = state * RAMP_SCALE;
  return r < 0 ? -r * r : r * r;
}

/**
 * `walkSpeedFactor` applies to a STANDING soldier only: both multiplies
 * (`0x08274850` forward, `0x082748d0` strafe) are skipped unless the walk
 * input is set AND `getPose()` (`0x0827ddc0`, in `edx`) is 0 (`test edx,edx;
 * jne` at `0x0827484c` / `0x082748cc`). A crouched or prone man holding walk
 * moves at his pose's full table.
 */
function walkScale(pose, walk) {
  return walk && pose === 0 ? WALK_SPEED_FACTOR : 1;
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
  return slot * rampShare(state) * walkScale(pose, walk);
}

/** Signed strafe speed. `strafeSpeed` is indexed by pose alone — no slot flip. */
export function rampedStrafeSpeed(pose, state, walk = false) {
  return STRAFE_SPEED[pose] * rampShare(state) * walkScale(pose, walk);
}

/**
 * The cap on the combined command: `|vCmd|` is held to the forward table's
 * entry for this pose and ramp slot times the state's own speed, UNRAMPED,
 * unwalked and unslowed. `handlePlayerInput` forms `T = table * stateSpeed`
 * (`0x082747ef`..`0x0827480d`, times a per-soldier float at `[ebp-0x2d0]`
 * that is 1 in every measured case) and keeps it on the x87 stack under the
 * ramped speeds until `0x082748e5` stores it at `[ebp-0x328]`; once both rows
 * are summed, `0x0827493b`..`0x08274988` test `|vCmd|^2` against `T^2` and
 * scale all three components by `T / |vCmd|` (`fsqrt` `0x08274976`). A full
 * standing diagonal (6 forward, 4 strafe) is therefore 6 m/s, not 7.2, and
 * back with strafe is held to 4. Read, and held to the lab server by the
 * move-law probe (`tests/test_move_law.py`).
 */
export function commandCap(pose, forwardState, stateSpeed = 1) {
  return DIRECTIONAL_SPEED[pose * 2 + (forwardState <= 0 ? 1 : 0)] * stateSpeed;
}

// --- the animation state's own speed, and the prone dive (PHY-8) -------------

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
 * The soldier's box-drag areas, m^2, on his own right, up and forward rows.
 * **Fitted, not read.** The soldier is a `PhysicsNode`, not a
 * `PointPhysicsNode` (PHY-34: `PhysicsNode::updatePhysics` `0x082543d0` is the
 * update his node runs), so he drags by the box law, PHY-4 / PHY-22:
 * `updatePositionalDragAdvanced` `0x08252f50` adds
 * `row * (-drag * |v| / mass) * area * (v . row)` per row, the areas
 * `3.14 * 0.25` times the products of his geometry box's extents. That box was
 * not read; the areas are fitted from **retail air data** (2026-10-22): the lab
 * server's 30 Hz canopy, free-fall and bail-out windows and 98 human free falls
 * from client recordings give right 1.14 +-0.05, up 0.50 +-0.02, forward
 * 1.14 +-0.02 m^2 -- a 0.80 x 1.82 x 0.80 m box, `pi/4` times each pair of
 * extents -- and the box law fits them far better than any sphere does. A
 * Lancaster bail-out goes 48.7 -> 30.7 m/s in 1 s, where this law predicts
 * 30.8; the steady canopy is 8.98 m/s down and 8.02 forward, against the
 * bots' ~9.1 / 8.2. On the ground the drag barely matters (at a 6 m/s run it
 * is ~0.4 m/s^2, which the friction solve cancels against the command): the
 * move-law replay (`lab/move_law_check.py --area-x/--area-z`) moves by about
 * a millimetre an ack between these and the old ground-only 1.3 / 0.3 / 1.3.
 * The vertical speed cap the same study saw (-31.9 m/s standing outside
 * `Lb_ParachuteFall`) is not modelled here; it is being read in the binary.
 */
export const SOLDIER_DRAG_AREAS = Object.freeze({ right: 1.14, up: 0.50, forward: 1.14 });

/**
 * `addFriction`'s soldier arm (PHY-2, `0x0825c5d2`): the per-tick tangential
 * delta-v budgets are `A * 7.2 * 9.82 / 30 * n.y^5` to break the static latch
 * and `A * 4.8 * 9.82 / 30 * n.y^5` while sliding (7.2 at `0x086d16e8`, 4.8 at
 * `0x086d16ec`), `A` the mean `materialFriction` of the two materials.
 */
export const SOLDIER_STATIC_GRIP = 7.2 * 9.82;
export const SOLDIER_KINETIC_GRIP = 4.8 * 9.82;

/**
 * `ResponsePhysics::solveImpulse` (`0x08258d30`) hands the summed speed
 * adjustment to the NEXT tick's accumulator as `spdAdj * 30 * (1 + e) * 0.5`;
 * a soldier's contact has `e = 0`.
 */
export const CONTACT_IMPULSE_GAIN = ENGINE_TICK_RATE * 0.5;

/**
 * `BFSoldier::handleCollision` (`0x0827d3b0`) runs only above this contact
 * speed squared (collision-response.md section 6.2), and it is what writes
 * the friction normal `resp+0x98`; below it the normal stays zero and the
 * friction budget with it.
 */
export const SOLDIER_HANDLER_SPEED_SQ = 0.1;

/** The soldier's own collision materials (`setSkeletonCollisionBone`, 40..42),
 *  which `damage.json` resolves to material 0's friction and resistance. */
export const SOLDIER_MATERIAL = 40;

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
 * would land at 1.166 m. The engine's tick is a fixed 1/30 s (LOOP-1), so
 * 1.12 m is retail's apex on any machine, and it is the page's: the soldier
 * steps at the engine's tick whatever the frame rate (`soldier.js`).
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
 * needs a *fresh* upward contact, so no jump starts in mid-air. (What stops
 * a jump on landing is the jump clip's wait, `SoldierJumpState`, PHY-35.)
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
 * The locomotion force. It is **not** multiplied by `g_simulationFps` -- unlike
 * the jump -- so it is an acceleration of `0.75 * vCmd` m/s^2, `vCmd / 40` of
 * delta-v per engine tick. Its gate, `IResponsePhysics+0xa4 == 0`, reads the
 * impulse count, and `ResponsePhysics::addFriction` (`0x0825b6e0`) clears that
 * count at the end of every tick (the clear tail at `0x0825bd70`), so by the
 * time the next `handlePlayerInput` reads it the gate is **always open**: the
 * force lands every tick, on the ground and in the air (PHY-34). What moves a
 * grounded soldier at his command is the friction solve that follows it
 * (`walking-body.js` `#contactLaw`), which this force only nudges ahead of.
 *
 * Swimming's `5.0 * vCmd` (`0x08274b6f`, `0x086c5288`) is the other arm.
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

/**
 * Barbed wire's two soldier numbers (`obstacle.js`, which re-exports them;
 * they live here so every module the walking body is built from stays the
 * set its harnesses already copy).
 *
 * `ObjectTemplate.slowDownMod` on a `BFSoldierTemplate` (+0x2f8): the
 * constructor's `0x3ecccccd` (0.4) at 0x0827a3ae; no vanilla, XPack1 or
 * XPack2 soldier sets it. `handlePlayerInput` multiplies the forward and the
 * strafe command by it on the tick after a touch.
 */
export const SLOW_DOWN_MOD = 0.4;

/** The collision handlers' gate, `|vRel|^2 > 0.1` (collision-response.md
 *  §6.2): below it no handler runs and an `Obstacle` is as solid as any
 *  static. */
export const OBSTACLE_HANDLER_SPEED_SQ = 0.1;

// --- the jump's wait: the lower body's gait states (PHY-35) -----------------
//
// BF1942 refuses a jump while the lower body is still in a jump state, not
// while the key is held: `BFSoldier::handlePlayerInput` (lnxded 0x08273c70)
// skips the impulse when `BFSoldier::getSoundTrigger()` (0x08276f40) answers
// `c_SstJump` (4), and only the three jump states carry that trigger
// (`animations/AnimationStatesJump.con`). A jump state is a one-shot clip: it
// takes no input transitions and hands over when its clip has run once, and
// a clip runs once in `1 / |speed|` seconds (ANIM-2). So the wait between two
// jumps is the clip's length, and which clip depends on the gait the press
// came from. Measured on the lab server (lab/jump_law_probe.mjs, PHY-35):
//
//   Lb_StandJump        1.10  standing, walking, turning      28 ticks
//   Lb_RunJump          1.18  running forward, strafing      26 ticks
//   Lb_RunJumpBackward -1.20  running backward               26 ticks
//
// (speeds from `3pAnimationsTweaking.con`, which overrides the
// `addAnimation` rates, ANIM-3). A press inside the wait is lost: the engine
// reads the jump as a level each tick, and the page's wire carries a press for
// one word (`sidecar/input.mjs` `ONE_SHOT_BUTTONS`).
//
// Which jump state a press enters is the lower machine's business: each state
// tests its `addTransitionOne` clauses in order against the tick's input
// (first match wins, `AnimationState::checkTransitions` 0x0832a0f0), and a
// taken transition is chased through the new state's own list in the same
// call (`AnimationStateMachineInstance::checkTransitions` 0x0832b570
// recurses). So a press from a standstill with forward held goes
// Lb_Stand -> Lb_RunForward -> Lb_RunJump, and a strafe with the mouse moving
// goes Lb_Stand -> Lb_TurnLeft -> Lb_StandJump. The transition is checked after
// the jump gate in the same tick (0x08274493, behind the gate at 0x082741ad),
// whether or not the impulse was taken: a press in mid-air enters a jump state
// too.
//
// The clip runs on the draw clock, not the tick: `updateState` is called from
// `BFSoldier::handleVisualUpdate` (0x08270fd0) once per server frame, which
// sets the clip's phase to 0 on its first frame and advances it by the frame's
// time after. `JUMP_STATE_ENTRY_TICKS` stands for that first frame; it puts
// the three waits where the lab measured them (any value over 0 and up to
// 0.57 does)
// and is not read from the binary.

/** `3pAnimationsTweaking.con`'s speeds for the three jump states. */
export const JUMP_STATE_SPEED = Object.freeze({
  standJump: 1.10, runJump: 1.18, runJumpBackward: -1.20,
});

/** Where each jump state hands over (`addTransitionWhenDone`). */
const JUMP_STATE_DONE = Object.freeze({
  standJump: 'stand', runJump: 'runForward', runJumpBackward: 'runBackward',
});

/** The draw clock's first frame in a new state, in ticks (fitted, see above). */
export const JUMP_STATE_ENTRY_TICKS = 0.25;

/** How many ticks a jump state lasts: the tick a press may next jump on. */
export function jumpStateTicks(state) {
  const speed = JUMP_STATE_SPEED[state];
  return Math.ceil(ENGINE_TICK_RATE / Math.abs(speed) + JUMP_STATE_ENTRY_TICKS);
}

// One clause: every named channel's value inside its [lo, hi] band.
const band = (spec) => (i) => {
  for (const k in spec) {
    const v = i[k];
    if (v < spec[k][0] || v > spec[k][1]) return false;
  }
  return true;
};
const FWD = [0.5, 1], BACK = [-1, -0.5], ON = [0.5, 1];
const LEFT = [-1, -0.01], RIGHT = [0.01, 1];

/**
 * `animations/AnimationStatesLower.con`, vanilla, each state's clauses in its
 * own order and the state `returnToState` names when none matches. `thr` is
 * `c_PIThrottle`, `yaw` `c_PIYaw` (the strafe), `look` `c_PIMouseLookX`,
 * `walk` `c_PIWalk`, `act` `c_PIAction` (the jump). Lb_StandRelax, the idle
 * fidget, has Lb_Stand's clauses and is folded into it.
 */
const LOWER = {
  stand: [[band({ thr: FWD }), 'runForward'], [band({ thr: BACK }), 'runBackward'],
    [band({ look: LEFT }), 'turnLeft'], [band({ look: RIGHT }), 'turnRight'],
    [band({ yaw: LEFT }), 'strafeLeft'], [band({ yaw: RIGHT }), 'strafeRight'],
    [band({ act: ON }), 'standJump']],
  walkForward: [[band({ act: ON }), 'standJump'], [band({ thr: FWD, walk: ON }), 'walkForward'],
    [band({ thr: [-9999, -0.5], walk: ON }), 'walkBackward'], [band({ thr: FWD }), 'runForward'],
    [band({ thr: BACK }), 'runBackward'], [band({ yaw: [0.5, 1], walk: ON }), 'walkForward'],
    [band({ yaw: [-1, -0.5], walk: ON }), 'walkForward']],
  walkBackward: [[band({ act: ON }), 'standJump'], [band({ thr: FWD, walk: ON }), 'walkForward'],
    [band({ thr: [-9999, -0.5], walk: ON }), 'walkBackward'], [band({ thr: FWD }), 'runForward'],
    [band({ thr: BACK }), 'runBackward']],
  runForward: [[band({ act: ON }), 'runJump'], [band({ walk: ON }), 'walkForward'],
    [band({ thr: FWD }), 'runForward']],
  runBackward: [[band({ act: ON }), 'runJumpBackward'], [band({ walk: ON }), 'walkBackward'],
    [band({ thr: BACK }), 'runBackward']],
  turnLeft: [[band({ act: ON }), 'standJump'], [band({ thr: FWD }), 'runForward'],
    [band({ thr: BACK }), 'runBackward'], [band({ yaw: LEFT }), 'strafeLeft'],
    [band({ yaw: RIGHT }), 'strafeRight'], [band({ look: LEFT }), 'turnLeft']],
  turnRight: [[band({ act: ON }), 'standJump'], [band({ thr: FWD }), 'runForward'],
    [band({ thr: BACK }), 'runBackward'], [band({ yaw: LEFT }), 'strafeLeft'],
    [band({ yaw: RIGHT }), 'strafeRight'], [band({ look: RIGHT }), 'turnRight']],
  strafeLeft: [[band({ act: ON }), 'runJump'], [band({ yaw: LEFT, walk: ON }), 'walkForward'],
    [band({ thr: FWD }), 'runForward'], [band({ thr: BACK }), 'runBackward'],
    [band({ yaw: LEFT }), 'strafeLeft'], [band({ look: LEFT }), 'turnLeft'],
    [band({ look: RIGHT }), 'turnRight']],
  strafeRight: [[band({ act: ON }), 'runJump'], [band({ yaw: [0.5, 1], walk: ON }), 'walkForward'],
    [band({ thr: FWD }), 'runForward'], [band({ thr: BACK }), 'runBackward'],
    [band({ yaw: RIGHT }), 'strafeRight'], [band({ look: LEFT }), 'turnLeft'],
    [band({ look: RIGHT }), 'turnRight']],
};

export class SoldierJumpState {
  constructor() { this.reset(); }

  reset() {
    this.state = 'stand';
    this.left = 0;     // seconds of the jump state still to run
    return this;
  }

  /** Is the lower body in a jump state, so a press this tick is refused? */
  get jumping() { return this.left > 0; }

  /**
   * The start of a tick: the draw clock has run the jump clip on since the
   * last one, and a clip that has run out has handed over.
   */
  begin(dt) {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 1e-9) {
      this.left = 0;
      this.state = JUMP_STATE_DONE[this.state] ?? 'stand';
    }
  }

  /**
   * The tick's input transitions, after the jump gate. `input` is
   * `{ thr, yaw, look, walk, act }` with the axes in -1..1 and the two
   * buttons as booleans. Returns the jump state entered, or null.
   */
  transitions(input) {
    if (this.left > 0) return null;
    const i = {
      thr: +input.thr || 0, yaw: +input.yaw || 0, look: +input.look || 0,
      walk: input.walk ? 1 : 0, act: input.act ? 1 : 0,
    };
    // A loop of clauses can only revisit states; eight hops is more than
    // the longest chain the table has (stand -> turn -> strafe -> jump).
    for (let hop = 0; hop < 8; hop++) {
      const clauses = LOWER[this.state];
      if (!clauses) { this.state = 'stand'; return null; }
      let next = 'stand';
      for (const [test, to] of clauses) if (test(i)) { next = to; break; }
      if (next === this.state) return null;
      this.state = next;
      if (JUMP_STATE_SPEED[next] !== undefined) {
        this.left = jumpStateTicks(next) / ENGINE_TICK_RATE;
        return next;
      }
    }
    return null;
  }
}
