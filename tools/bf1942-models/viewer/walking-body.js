// A walking body: the engine's per-tick soldier law, our hull resolve.
//
// Split out of `physics.js`, which re-exports it; see that file's header for
// the engine facts this rests on and for the duck-typed `world` it walks on.
// The collision resolve itself is `soldier-resolve.js`.
//
// The law a tick runs on foot is the dedicated server's own (PHY-34), held to
// the lab server to a millimetre an acknowledged tick by
// `tests/test_move_law.py` (Wake, the move-law probe of 2026-10-22):
//
//   handlePlayerInput 0x08273c70   the ramps (PHY-6), sgn(r) r^2 of the table
//                                  (PHY-9), the command capped at the unramped
//                                  table, acc += 0.75 vCmd EVERY tick
//   PhysicsNode::updatePhysics     box drag (PHY-22), then ONE Euler step:
//     0x082543d0 / 0x08253570      v += acc dt; v += fr dt; x += v dt
//   checkVsTerrain 0x0825a960      the feet vertex against the engine's
//                                  checkerboard triangles (TERR-16): pushed out
//                                  along the face normal, the speed adjustment
//                                  into the next tick's accumulator
//   addFriction 0x0825b6e0         the soldier arm's static/kinetic latch
//                                  toward vCmd, as next tick's `fr`
//
// What is NOT the engine's here, and says so where it lives: the hull
// contacts (`soldier-resolve.js`'s capsule sweep and hull floors stand in for
// the five skeleton vertices against statics), the prone dive's speed under
// the cap, swimming and the parachute (both still step the old point body),
// and ladders (`ladder-climb.js`).

import { PARACHUTE_DRAG } from './parachute.js';
import { PointBody, GRAVITY } from './point-body.js';
import { lerp } from './fixed-step.js';
import {
  POSE_STAND, POSE_FLAG_CROUCH, POSE_FLAG_PRONE, POSE_FLAG_JUMP, poseFromFlags,
  EYE_HEIGHT, BODY_HEIGHT, POSE_TRANSITION,
} from './soldier-pose.js';
import {
  DIRECTIONAL_SPEED, STRAFE_SPEED,
  applyMovementFactors, rampedDirectionalSpeed, rampedStrafeSpeed,
  SOLDIER_MASS, SOLDIER_DRAG, SOLDIER_BOUNDING_RADIUS, SOLDIER_DRAG_AREAS,
  SOLDIER_STATIC_GRIP, SOLDIER_KINETIC_GRIP, CONTACT_IMPULSE_GAIN,
  SOLDIER_HANDLER_SPEED_SQ, SOLDIER_MATERIAL, commandCap,
  JUMP_IMPULSE, JUMP_COMMAND_KICK, JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER,
  LOCOMOTION_GAIN, SLOW_DOWN_MOD, ENGINE_TICK_RATE, SoldierJumpState,
} from './soldier-locomotion.js';
import { resolveMove, refuseSteepGround, settleFeet } from './soldier-resolve.js';

/** `addFriction`'s floor on a delta-v worth scaling, `|dV|^2 > 1e-6`
 *  (`0x086d139c`, PHY-2). */
const FRICTION_EPSILON_SQ = 1.0000001e-06;

/** `MaterialManager.materialFriction` / `materialResistance` for a material
 *  the level's tables do not carry: material 0's (vanilla 1.0 and 0.02). */
const DEFAULT_MATERIAL_FRICTION = 1.0;
const DEFAULT_MATERIAL_RESISTANCE = 0.02;

/**
 * A walking body: the engine's per-tick soldier law, our hull resolve.
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
    /**
     * The swim state, or `null` for a body that does not model swimming.
     *
     * **Injected, not imported.** `viewer/swim.js` carries the whole law —
     * `updateSwimming`'s two thresholds, the draft, the `5.0 * vCmd` gain and
     * the `c_AsmIsSwimming` flag — and this module reads it duck-typed
     * (`update()`, `swimming`, `gain`) so that the soldier's physics keeps
     * `parachute.js` as its single outside import and every harness that copies
     * it keeps working unchanged. `soldier.js` supplies one.
     *
     * With no collaborator a body still cannot stand on the sea (`#settle` does
     * not treat the water plane as ground at all); it just falls through it and
     * keeps falling, which is the honest "not modelled" rather than the old
     * "walks on water".
     */
    this.swim = null;
    /** `c_AsmIsSwimming` as of this tick, mirrored off the collaborator. */
    this.swimming = false;
    /** The collaborator's depth: the water over his ORIGIN, a metre over his
     *  feet, which is what `updateSwimming` measures (`swim.js`). */
    this.swimDepth = 0;
    /** The water over his FEET, the lowest vertex of his collision hull:
     *  what `checkVsTerrain` hands `setUnderWater` (`swim.js`,
     *  `SWIM_SPEED_CEILING_FACTOR`). PHY-7's drag reads this one. */
    this.underWater = 0;
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
    // The current lower-body animation state's own `setSpeed` forward term and
    // what is left of it (PHY-7, `setStateSpeed`). 1 for every state vanilla
    // ships bar the prone dive, so this is normally a multiply by one.
    this.stateSpeed = 1;
    this.stateSpeedLeft = 0;
    // The most-upward contact normal of the previous tick, and whether that
    // contact armed a jump. `handleCollision` keeps the most upward normal of
    // the frame at soldier `+0x400` (lnxded `0x0827d4d5`-`0x0827d503`) and the
    // arming bit is cleared every tick, so both are per-tick state that the
    // *next* tick's input handling reads. Flat ground until proven otherwise.
    this.contactNormal = { x: 0, y: 1, z: 0 };
    this.contactMaterial = -1;
    this.jumpArmed = false;
    // The lower body's gait state, which refuses a jump while it is still in
    // a jump state (`SoldierJumpState`, PHY-35), and the pose the jump gate
    // reads: the one the PREVIOUS tick left, because `handlePlayerInput` tests
    // the pose flags (`& 0x60`) before it writes this tick's stance into them
    // (measured: a press on the word that lets go of crouch jumps a tick
    // later, lab/jump_law_probe.mjs).
    this.lowerBody = new SoldierJumpState();
    this.gatePose = POSE_STAND;
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
    // The hull just stepped out of, which the resolve looks straight through
    // for `ignoreOwnerLeft` more seconds (`ignoreHull`). -1 is nobody.
    this.ignoreOwner = -1;
    this.ignoreOwnerLeft = 0;
    // The friction solve's carried state (`#contactLaw`): `addFriction`'s
    // delta-v, spent by the next tick's integrate as `v += fr * dt`
    // (`PhysicsNode::addFrictionAtAbsolutePosition` 0x08254e50), and the
    // static latch, the grip byte's 0x80 (PHY-2), which only the solve flips.
    this.friction = { x: 0, y: 0, z: 0 };
    this.frictionLatched = true;
    // What the terrain pushed out this tick (`soldier-resolve.js`
    // `settleFeet`): the face normal and the depth, for the speed adjustment
    // `solveImpulse` hands the next tick.
    this._terrainNormal = { x: 0, y: 1, z: 0 };
    this._terrainDepth = 0;
    this._offsets = [];
    this._jumpQueued = false;
    /** Ticks this body has jumped on, a running count: the hand weapon's
     *  misc deviation channel is raised on each (ledger DEV-15). */
    this.jumpTicks = 0;
    this._armed = false;
    this._bestNormalY = -Infinity;
    this._waterEntry = false;
    // Barbed wire (`obstacle.js`). The `Obstacle`s this tick's resolve passed
    // through, `{ id, x, y, z }` each, for the world's soldier tick to bill;
    // and the soldier's `+0x578` byte, which `BFSoldier::handleCollision`
    // (0x0827dc81) sets on the touch and the NEXT `handlePlayerInput`
    // (0x08274792) reads and clears, scaling the speed by the template's
    // `slowDownMod`.
    this.obstacleContacts = [];
    this.obstacleSlow = false;
    this.slowDownMod = SLOW_DOWN_MOD;
    this._obstaclePass = false;
    /**
     * A blast's flight and landing (`knockback.js` `Knockback`, KNOCK-1/2/8),
     * or `null` for a body no blast has reached. Injected like `swim`, by
     * whoever pushes him first (`vehicle-hits.js`), and read duck-typed
     * (`stamp`, `update`, `reset`, `locked`): stamped by `blast`, stepped at
     * the bottom of every tick off what the tick left.
     */
    this.knockback = null;
    // A blast's speed, banked by `blast` for the next tick's accumulator.
    this._blastDv = { x: 0, y: 0, z: 0 };
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
    this.ignoreOwner = -1;
    this.ignoreOwnerLeft = 0;
    this.friction.x = this.friction.y = this.friction.z = 0;
    this.frictionLatched = true;
    this._terrainDepth = 0;
    this.forwardRamp = 0;
    this.strafeRamp = 0;
    this.jumpArmed = false;
    this.lowerBody.reset();
    this.gatePose = this.pose;
    this.contactNormal.x = 0;
    this.contactNormal.y = 1;
    this.contactNormal.z = 0;
    this.contactMaterial = -1;
    this.contacted = false;
    this.obstacleSlow = false;
    this.obstacleContacts.length = 0;
    this.knockback?.reset();
    this._blastDv.x = this._blastDv.y = this._blastDv.z = 0;
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

  /**
   * Enter a locomotion state whose own `setSpeed` scales the speed table
   * (PHY-7), for `seconds` — the length of the clip that state plays once.
   *
   * `seconds <= 0` puts it back to 1 immediately, which is what the timer
   * running out does. The only caller in vanilla's data is the prone dive.
   */
  setStateSpeed(factor, seconds) {
    const wanted = Number.isFinite(factor) ? factor : 1;
    if (!(seconds > 0) || wanted === 1) {
      this.stateSpeed = 1;
      this.stateSpeedLeft = 0;
      return;
    }
    this.stateSpeed = wanted;
    this.stateSpeedLeft = seconds;
  }

  /**
   * The parachute is a drag swap and nothing else — `setIsParachuting`
   * (lnxded `0x08276f90`) hands `BFSoldierTemplate+0x2e4` (`setParachuteDrag
   * 24`) or `+0x44` (`ObjectTemplate.drag 1.0`) to
   * `PointPhysicsNode::setDrag` and does nothing else to the physics.
   *
   * `drag` lets the caller pass the value already scaled for this body's
   * bounding radius, which is what `parachute.js`'s `effectiveParachuteDrag`
   * exists for: only `r^2 * drag` reaches the integrator, and the radius this
   * viewer carries is not the engine's. Omitted, the shipped 24 is used.
   */
  setParachute(on, drag = PARACHUTE_DRAG) {
    this.parachute = Boolean(on);
    this.body.drag = on ? drag : SOLDIER_DRAG;
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

  /**
   * Lift the body `height` metres straight up and let it fall from there, as
   * if it had last touched ground up there (HP-14's `F` is
   * `lastCollisionHeight - y`). The vertical speed and whatever the last
   * contact had handed the next tick (the speed adjustment in the
   * accumulator, the friction's `fr`) are dropped with it, so the fall
   * starts the same whichever tick the lift lands after. A test hook's
   * (`__dropFromHeight`) and a harness's, not a game path.
   */
  lift(height) {
    const b = this.body;
    b.position.y += height;
    b.previous.y += height;
    b.velocity.y = 0;
    b.accel.x = b.accel.y = b.accel.z = 0;
    b.seedGravity();
    this.friction.x = this.friction.y = this.friction.z = 0;
    this.grounded = false;
    this.lastCollisionHeight += height;
  }

  /** Queued rather than applied, so a keypress between ticks is never lost. */
  jump() { this._jumpQueued = true; }

  /**
   * A blast reached him: `handleExplosionOnObject`'s push and stamp (KNOCK-4,
   * KNOCK-6). The push is an acceleration in the same accumulator gravity is
   * seeded into (the soldier's node is a `PhysicsNode`, PHY-34, whose
   * `addAccelerationAtAbsolutePosition` `0x08255110` adds it to the linear
   * accumulator of a root and is mass-independent, PHY-21), spent and zeroed
   * by one 1/30 s engine tick, so it leaves `a / 30` m/s and no more
   * (`knockback.js` `soldierBlastAcceleration` is `a`). This body ticks at
   * its own rate, so the push is banked as that speed and handed to the next
   * tick's accumulator as `dv / dt`, the jump's own arrangement: the same
   * `a / 30` at any tick rate. The stamp is `triggerFallingAnimation`, which
   * the engine calls even when the push came out zero; `ai` is whether his
   * player is a bot (KNOCK-8).
   *
   * Speed his legs did not make: the friction solve's latch bleeds it off
   * at PHY-2's kinetic budget once it is past the static one.
   */
  blast(ax = 0, ay = 0, az = 0, { ai = false } = {}) {
    if (ax || ay || az) {
      this._blastDv.x += ax / ENGINE_TICK_RATE;
      this._blastDv.y += ay / ENGINE_TICK_RATE;
      this._blastDv.z += az / ENGINE_TICK_RATE;
    }
    this.knockback?.stamp({ ai });
  }

  /**
   * A tick the climb took whole, so `step` did not run (`soldier.js`
   * `#stepLadder`). The engine's climber is still a physics node, but
   * `handlePlayerInput` stores the climb's own velocity into it every tick
   * (`setPositionalSpeed`, LADDER-4) and each tick's integrate spends and
   * zeroes the accumulator (`0x082562aa`, KNOCK-6): a blast's push lasts the
   * tick it lands in and never the climb. So the banked speed is dropped here,
   * not held for the first tick off the ladder (the one tick of drift it
   * would have given is not modelled), and the explosion clocks run on at
   * the climb's own speed, which throws nobody.
   */
  climbTick(dt, input = {}) {
    this._blastDv.x = this._blastDv.y = this._blastDv.z = 0;
    // On the ladder the lower body runs the climb states, none of them a jump.
    this.lowerBody.reset();
    this.gatePose = this.pose;
    const v = this.body.velocity;
    this.knockback?.update({
      dt, dead: Boolean(input.dead), vx: v.x, vy: v.y, vz: v.z, yaw: this.yaw,
      canopy: this.parachute, contact: null,
    });
  }

  /**
   * Let the resolve pass through one hull's collision for `seconds`.
   *
   * For a man stepping out of a moving aircraft. The exit location puts him
   * on or against the airframe, which is still doing 50 m/s beside him, and
   * the resolve sweeps against where the hull stands this tick rather than
   * against its motion. So the first tick found the wing under his boots,
   * called him grounded and the friction solve pulled him onto his command,
   * which is zero: bailing out of a climbing plane stopped him dead in the
   * air. This is the viewer's: the engine never lets a soldier through the
   * hull he left. Its 2 s after an exit only spare him the contact's
   * damage, and the hull still pushes him (ledger SEAT-33).
   */
  ignoreHull(owner, seconds) {
    this.ignoreOwner = owner >= 0 && seconds > 0 ? owner : -1;
    this.ignoreOwnerLeft = this.ignoreOwner >= 0 ? seconds : 0;
  }

  /**
   * One fixed tick.
   *
   * `input` is `{ forward, strafe, walk, look }` with the two axes in -1..1,
   * which is what a keyboard, a stick or a replay all reduce to; `look` is the
   * tick's `c_PIMouseLookX`, which only the lower body's gait reads (a turning
   * man's jump is a standing one, PHY-35). The yaw the body faces is
   * `this.yaw`; the caller owns looking around.
   */
  step(dt, input = {}) {
    const body = this.body;
    const forward = clamp(input.forward ?? 0, -1, 1);
    const strafe = clamp(input.strafe ?? 0, -1, 1);
    const walk = Boolean(input.walk);
    // The jump clip has run on since the last tick (the engine runs it on the
    // draw clock, between ticks), and hands over when it has run out.
    this.lowerBody.begin(dt);

    // The swim state is NOT updated here. It is updated at the bottom of the
    // tick, after the resolve, because that is where the engine updates it:
    // `BFSoldier::updateSwimming` (lnxded `0x08282190`) runs out of
    // `handleUpdate`, and `handlePlayerInput` -- this function -- reads the flag
    // the PREVIOUS `handleUpdate` left. Getting that order wrong is not
    // cosmetic: the swim pin puts the feet at `surface - 0.4` every tick, so a
    // depth measured before the resolve is *always* 0.4 and the 0.35 exit test
    // can never fire. A man swimming at a beach would never be able to stand up.
    // Measured after the resolve, the seabed has had its say: `#settle` puts him
    // on the bottom in the shallows, the depth falls under 0.35 there, and he
    // wades out. See `#updateSwim`.

    // --- the ramp, then the tables it indexes (PHY-6) ----------------------
    this.forwardRamp = applyMovementFactors(forward, this.forwardRamp, dt);
    this.strafeRamp = applyMovementFactors(strafe, this.strafeRamp, dt);
    // PHY-7: the lower body's current animation state multiplies the forward
    // table. Applied before the diagonal clamp below, or the dive's 6.0 would
    // be clamped straight back down to the prone table it is scaling.
    // The wire's slow, read and cleared here as `handlePlayerInput` does
    // (0x08274792-0x082747ae): 1.0, or `slowDownMod` the tick after a touch,
    // multiplying both the forward and the strafe command (0x0827489c..).
    const slow = this.obstacleSlow ? this.slowDownMod : 1;
    this.obstacleSlow = false;
    // Every explosion state's legs declare `setSpeed 0 0 0`, and PHY-8 makes
    // the lower state's own speeds the multiplier of both tables: thrown,
    // landing and getting up, he has no command at all (`knockback.js`).
    const held = this.knockback?.locked ? 0 : 1;
    // The state this tick's command runs in: its speed scales the table and
    // the cap below alike (`vCmd` and `T` in `handlePlayerInput` read one
    // state), even on the tick the dive's clip runs out.
    const stateSpeed = this.stateSpeed;
    const fwdSpeed = rampedDirectionalSpeed(this.pose, this.forwardRamp, walk)
      * stateSpeed * slow * held;
    const sideSpeed = rampedStrafeSpeed(this.pose, this.strafeRamp, walk) * slow * held;
    if (this.stateSpeedLeft > 0) {
      this.stateSpeedLeft -= dt;
      // `addTransitionWhenDone`: the clip ends and the plain lie/stand state,
      // with its own `setSpeed 1.0`, takes over.
      if (this.stateSpeedLeft <= 0) this.setStateSpeed(1, 0);
    }
    // Facing is +Z at yaw 0, matching the viewer's own look vector. Both speeds
    // are already signed by their ramp register, so the input axes do not
    // reappear here.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let cmdX = sy * fwdSpeed - cy * sideSpeed;
    let cmdZ = cy * fwdSpeed + sy * sideSpeed;
    // The engine's cap on the sum (`commandCap`): the unramped forward table
    // times the state's own speed, so a full diagonal runs at the forward
    // table's 6 m/s. The dive's 6.0 is inside `stateSpeed` and so inside the
    // cap too (`0x0827480d`), which is what keeps the prone slide.
    const cap = commandCap(this.pose, this.forwardRamp, stateSpeed);
    const want = Math.hypot(cmdX, cmdZ);
    if (want > cap && want > 0) {
      cmdX *= cap / want;
      cmdZ *= cap / want;
    }

    const v = body.velocity;
    // The jump is resolved **first**, and that ordering is load-bearing:
    // PHY-1's `-0.25 * vCmd` lands on the **actual** velocity, so a soldier
    // pressed into a wall (velocity ~0, command 6 m/s into it) is kicked
    // 1.5 m/s back off the wall. Measured on Berlin (Bernauer_Strasse_HQ, yaw
    // pi) and Wake (The_Airfield, yaw pi/4) when the ground arm here was an
    // assignment and ran first: the body never left the wall.
    const pressed = this._jumpQueued && !this.swimming;
    const jumped = this.swimming ? false : this.#tryJump(dt, cmdX, cmdZ);
    // Then the lower body's input transitions, on the same word and behind the
    // gate (`checkTransitions` 0x08274493): a press from any standing gait
    // enters a jump state, impulse or none. A crouching, prone or swimming
    // body is in other states, none of them a jump.
    if (this.gatePose === POSE_STAND && !this.swimming) {
      this.lowerBody.transitions({ thr: forward, yaw: strafe, look: input.look, walk, act: pressed });
    } else {
      this.lowerBody.reset();
    }
    if (this.swimming) {
      // PHY-6's other half: the swimming force is `5.0 * vCmd` (`0x086c5288`,
      // applied at `0x08274b6f`), an acceleration every tick. A swimmer's
      // speed is the balance between it and the water's drag, which is why he
      // does not reach the 6 m/s the stand row of `directionalSpeed` names.
      // There is no swim entry in `directionalSpeed` (`0x0872edec`) and
      // `getPose()` (`0x0827ddc0`) can only answer 0, 1 or 2: a swimming
      // soldier is posed standing and reads the standing row.
      const gain = Number.isFinite(this.swim?.gain) ? this.swim.gain : 5.0;
      body.addAcceleration(gain * cmdX, 0, gain * cmdZ);
      // A queued jump is spent rather than banked: coming out of the water
      // holding Space must not fire a jump that was pressed mid-stroke.
      this._jumpQueued = false;
    } else if (jumped) {
      // `vCmd` is zeroed outright, not damped, and the engine's jump branch
      // forward-jumps clean over the locomotion block -- so a jump tick carries
      // no locomotion force and no surface speed for the friction solve.
      cmdX = 0;
      cmdZ = 0;
    } else {
      // `acc += 0.75 * vCmd` (`0x08274a09`), every tick. Its gate is the
      // impulse count `IResponsePhysics+0xa4`, and `addFriction` clears that
      // count at the end of the tick that set it (`0x0825bd70`), so the gate
      // this tick reads is always open (PHY-34): on the ground as much as in
      // the air. On the ground the friction solve then pulls the speed onto
      // the command; in the air it is the whole of a jump's steering, 4.5
      // m/s^2 at a full run, and a tap of air-strafe carries almost none.
      body.addAcceleration(LOCOMOTION_GAIN * cmdX, 0, LOCOMOTION_GAIN * cmdZ);
    }

    // A blast's banked speed (`blast`): this tick's accumulator spends it,
    // after the locomotion force, as the engine's next tick would.
    const bdv = this._blastDv;
    if (bdv.x || bdv.y || bdv.z) {
      body.addAcceleration(bdv.x / dt, bdv.y / dt, bdv.z / dt);
      bdv.x = bdv.y = bdv.z = 0;
    }

    // --- the engine's update ----------------------------------------------
    const wasGrounded = this.grounded;
    if (this.swimming || this.parachute) {
      // **Not the engine's**: a swimmer and a man under canopy still step the
      // old point body (four sub-steps, the sphere drag with PHY-7's
      // submersion scale, `parachute.js`'s drag), which their own ceilings and
      // drags were tuned against (`swim.js` `SWIM_SPEED_CEILING_FACTOR`,
      // `parachute.js` `effectiveParachuteDrag`). The engine's soldier is one
      // PhysicsNode in both (PHY-34); neither has been measured on the lab.
      const fr = this.friction;
      body.addAcceleration(fr.x, fr.y, fr.z);
      fr.x = fr.y = fr.z = 0;
      body.updatePhysics(dt, { underWater: this.swimming ? this.underWater : 0 });
    } else {
      this.#updateNode(dt);
    }
    if (this.swimming) this.#capSwimSpeed();
    // The impact velocity, captured before anything clamps it.
    const ivx = v.x, ivy = v.y, ivz = v.z;

    // --- the contacts -----------------------------------------------------
    this._armed = false;
    this._bestNormalY = -Infinity;
    this._terrainDepth = 0;
    this.landed = false;
    this._waterEntry = false;
    // The hulls (ours: the capsule sweep, `soldier-resolve.js`), then the
    // ground under the feet: the terrain by the engine's law, a hull floor by
    // ours. Then the friction solve over whatever was touched.
    this.#resolve();
    this.#refuseSteepGround();
    this.#settle();
    this.#contactLaw(dt, cmdX, cmdZ);
    if (this.obstacleContacts.length) this.obstacleSlow = true;
    // `handleUpdate`'s own place in the tick. The pin lands inside it.
    this.#updateSwim(dt, forward, input);

    // A landing is a tick that ends grounded having not begun so. `F` is the
    // engine's `getLastCollisionHeight() - pos.y` (Armor `+0x28`), which is the
    // height of the last *contact*, not the apex: a jump straight up therefore
    // lands with `F = 0` and a jump off a ledge is billed the ledge, not the
    // apex above it.
    if ((this.grounded && !wasGrounded) || this._waterEntry) {
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
      this.fallHeight = this.lastCollisionHeight
        - (this._waterEntry ? this._waterEntryY : this.body.position.y);
    }
    this.jumpArmed = this._armed;
    this.contacted = this._bestNormalY > -Infinity;
    // The explosion states (`knockback.js`): the landing off this tick's own
    // contact, the throw off the speed the integrator and resolve left -- the
    // collision and `handleUpdate`'s halves of one engine tick.
    this.knockback?.update({
      dt, dead: Boolean(input.dead), vx: v.x, vy: v.y, vz: v.z, yaw: this.yaw,
      canopy: this.parachute, contact: this.contacted ? this.contactNormal : null,
    });
    if (this.ignoreOwner >= 0 && (this.ignoreOwnerLeft -= dt) <= 0) this.ignoreHull(-1, 0);
    if (this.grounded) this.lastCollisionHeight = this.body.position.y;

    if (this.grounded) this.poseFlags &= ~POSE_FLAG_JUMP;
    this.gatePose = this.pose;
    this.previousEyeHeight = this.eyeHeight;
    const target = EYE_HEIGHT[this.pose];
    if (this.eyeProgress >= 1) {
      this.eyeHeight = target;
    } else {
      this.eyeProgress = Math.min(1, this.eyeProgress + dt / this.eyeDuration);
      this.eyeHeight = this.eyeFrom + (target - this.eyeFrom) * this.eyeProgress;
    }
  }

  // The collision resolve (`soldier-resolve.js`): move along the integrator's
  // delta against the hulls, refuse steep terrain, put the feet on the ground.
  #resolve() { resolveMove(this); }
  #refuseSteepGround() { refuseSteepGround(this); }
  #settle() { settleFeet(this); }

  /**
   * `PhysicsNode::updatePhysics` (`0x082543d0`) for the soldier's node: the
   * box drag, then ONE Euler step (`0x08253570`) -- `v += acc * dt`, then the
   * friction solve's `v += fr * dt`, then `x += v * dt` -- and the
   * accumulator re-seeded with gravity (PHY-34).
   *
   * Not the point body's four sub-steps (`PointPhysicsNode`, which the
   * corpus took the soldier for): the soldier is a `PhysicsNode`
   * (`PhysicsNode::updatePhysics` tests his class id `0x9493` near
   * `0x08254400` and takes the node arm), and one step is what the move-law
   * replay holds to the lab server inside a millimetre an acknowledged tick
   * (`tests/test_move_law.py`). The drag is `updatePositionalDragAdvanced`
   * (`0x08252f50`, PHY-22): per row of his own frame,
   * `row * (-drag * |v| / mass) * area * (v . row)`, the areas fitted
   * (`SOLDIER_DRAG_AREAS`).
   */
  #updateNode(dt) {
    const body = this.body;
    const v = body.velocity;
    const a = body.accel;
    const p = body.position;
    if (body.drag > 0 && body.mass > 0) {
      const k = -body.drag * Math.hypot(v.x, v.y, v.z) / body.mass;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      // forward (sy, 0, cy), right (-cy, 0, sy), up (0, 1, 0)
      const vf = v.x * sy + v.z * cy;
      const vr = -v.x * cy + v.z * sy;
      const ff = k * SOLDIER_DRAG_AREAS.forward * vf;
      const fr = k * SOLDIER_DRAG_AREAS.right * vr;
      a.x += sy * ff - cy * fr;
      a.z += cy * ff + sy * fr;
      a.y += k * SOLDIER_DRAG_AREAS.up * v.y;
    }
    const f = this.friction;
    body.previous.x = p.x; body.previous.y = p.y; body.previous.z = p.z;
    v.x += a.x * dt + f.x * dt;
    v.y += a.y * dt + f.y * dt;
    v.z += a.z * dt + f.z * dt;
    const d = body.delta;
    d.x = v.x * dt; d.y = v.y * dt; d.z = v.z * dt;
    p.x += d.x; p.y += d.y; p.z += d.z;
    a.x = 0; a.y = 0; a.z = 0;
    body.seedGravity();
    f.x = f.y = f.z = 0;
  }

  /**
   * The contact half of the tick: `solveImpulse`'s speed adjustment for a
   * terrain push-out and `addFriction`'s soldier arm, both landing in the NEXT
   * tick (the accumulator and `fr`). PHY-2, PHY-34.
   *
   *   N   the most upward contact normal of the tick, which
   *       `BFSoldier::handleCollision` (`0x0827d3b0`) writes to `resp+0x98`
   *       (`0x0827d52f`..`0x0827d541`) -- only when the handler runs at all,
   *       `|v|^2 >= 0.1`; below it N is zero and so is the budget
   *   A   the mean `materialFriction` of his material and the ground's
   *       (`impulseOn` `0x08258900`); the resistance is the same mean
   *   V   v - vCmd (`setSurfacePositionalSpeed`, `0x08274e2f`), with one
   *       tick of gravity added to its y; Vt is V less its N component
   *
   * `acc -= resistance * Vt`; the wanted delta-v `-Vt` goes through the
   * static/kinetic latch (`0x0825bb72`..`0x0825bf47`): latched, past
   * `A 7.2 g dt Ny^5` it unlatches and is held to the sliding budget
   * `A 4.8 g dt Ny^5`; unlatched, past the sliding budget it is held there,
   * else the latch closes and the whole of it lands. `fr = dV / dt`.
   *
   * A tick with no contact leaves the latch where it was and carries no `fr`.
   */
  #contactLaw(dt, cmdX, cmdZ) {
    const body = this.body;
    const v = body.velocity;
    const f = this.friction;
    f.x = f.y = f.z = 0;
    if (this._terrainDepth < 0) {
      // `impulseOn` keeps `-(v . n) n` as the speed adjustment, and
      // `solveImpulse` hands it on as `* 30 * (1 + e) * 0.5`, e = 0.
      const n = this._terrainNormal;
      const k = -(v.x * n.x + v.y * n.y + v.z * n.z) * CONTACT_IMPULSE_GAIN / (ENGINE_TICK_RATE * dt);
      body.addAcceleration(n.x * k, n.y * k, n.z * k);
    }
    if (!(this._bestNormalY > -Infinity)) return;
    const world = this.world;
    const A = 0.5 * (materialValue(world?.materialFrictionById, SOLDIER_MATERIAL, DEFAULT_MATERIAL_FRICTION)
      + materialValue(world?.materialFrictionById, this.contactMaterial, DEFAULT_MATERIAL_FRICTION));
    const res = 0.5 * (materialValue(world?.materialResistanceById, SOLDIER_MATERIAL, DEFAULT_MATERIAL_RESISTANCE)
      + materialValue(world?.materialResistanceById, this.contactMaterial, DEFAULT_MATERIAL_RESISTANCE));
    const handled = v.x * v.x + v.y * v.y + v.z * v.z >= SOLDIER_HANDLER_SPEED_SQ;
    const c = this.contactNormal;
    const nx = handled ? c.x : 0, ny = handled ? c.y : 0, nz = handled ? c.z : 0;
    const ny5 = ny * ny * ny * ny * ny;
    const lo = A * SOLDIER_KINETIC_GRIP * dt * ny5;
    const hi = A * SOLDIER_STATIC_GRIP * dt * ny5;
    let Vx = v.x - cmdX, Vy = v.y + GRAVITY * body.gravityModifier * dt, Vz = v.z - cmdZ;
    const nn = nx * nx + ny * ny + nz * nz;
    if (nn > 0) {
      const into = (Vx * nx + Vy * ny + Vz * nz) / nn;
      Vx -= nx * into; Vy -= ny * into; Vz -= nz * into;
    }
    if (res > 0) body.addAcceleration(-res * Vx, -res * Vy, -res * Vz);
    let dx = -Vx, dy = -Vy, dz = -Vz;
    const m2 = dx * dx + dy * dy + dz * dz;
    if (this.frictionLatched) {
      if (m2 > hi * hi && m2 > FRICTION_EPSILON_SQ) {
        this.frictionLatched = false;
        let s = Math.abs(hi) / Math.sqrt(m2);
        dx *= s; dy *= s; dz *= s;
        const m2b = dx * dx + dy * dy + dz * dz;
        if (m2b > lo * lo && m2b > FRICTION_EPSILON_SQ) {
          s = Math.abs(lo) / Math.sqrt(m2b);
          dx *= s; dy *= s; dz *= s;
        }
      }
    } else if (m2 > lo * lo && m2 > FRICTION_EPSILON_SQ) {
      const s = Math.abs(lo) / Math.sqrt(m2);
      dx *= s; dy *= s; dz *= s;
    } else {
      this.frictionLatched = true;
    }
    f.x = dx / dt; f.y = dy / dt; f.z = dz / dt;
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
   * `MAX_GROUND_SLOPE` (PHY-1, item 2); the previous tick's pose, standing
   * (`gatePose`); and the lower body out of its jump state, the sound trigger
   * `c_SstJump` (PHY-35): 28 ticks after a standing jump, 26 after a running
   * one, whether or not the man has landed. A press refused is spent.
   *
   * `cmdX`/`cmdZ` are this tick's commanded movement — `vCmd` — which the
   * caller has not yet spent on anything, so both terms below land where the
   * engine puts them.
   */
  #tryJump(dt, cmdX, cmdZ) {
    if (!this._jumpQueued) return false;
    this._jumpQueued = false;
    if (!this.jumpArmed || this.gatePose !== POSE_STAND || this.lowerBody.jumping) return false;
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
    // already seeded into, so the tick's one step spends the jump and the
    // tick's own gravity together (and the resting contact's 2 g dt into the
    // ground, which the jump starts from: PHY-34). The `* fps` is `/ dt` at
    // the engine's own rate; written as `/ dt` it delivers exactly
    // `JUMP_IMPULSE` of delta-v from the jump term at any tick rate.
    const inv = 1 / dt;
    this.body.addAcceleration(
      (-JUMP_COMMAND_KICK * cmdX) * inv,
      (K * n.y * JUMP_IMPULSE) * inv,
      (-JUMP_COMMAND_KICK * cmdZ) * inv);
    this.grounded = false;
    this.jumpArmed = false;
    this.poseFlags |= POSE_FLAG_JUMP;
    this.jumpTicks += 1;
    return true;
  }

  /**
   * One tick of the injected swim state, and the draft it asks for.
   *
   * The water surface is asked for as a function of (x, z) and nothing else,
   * which is the engine's own shape: `updateSwimming` calls
   * `terrainBase->vtbl+0x5c(pos.x, pos.z)` (`0x08282215`) and subtracts the
   * body's y from the answer -- his origin's, a metre over the feet this body
   * carries, which `swim.js` adds back. That is the same trap HP-5's
   * `touchesWater` documents on the vehicle side — `surfaceHeight` cannot tell
   * you whether you are *in* the water, only where the water is; altitude
   * decides.
   *
   * `this.world.waterLevel` is that surface: the collider carries one horizontal
   * plane over the whole world, and so does the engine (`WaterPatch`'s level is
   * per terrain, not per cell).
   */
  #updateSwim(dt, forward, input) {
    const swim = this.swim;
    if (!swim || typeof swim.update !== 'function') {
      this.swimming = false;
      this.swimDepth = 0;
      this.underWater = 0;
      return;
    }
    const level = this.world ? this.world.waterLevel : null;
    const feetY = this.body.position.y;
    const pin = swim.update({
      dt,
      surfaceY: Number.isFinite(level) ? level : null,
      feetY,
      // The entry's other arm tests the surface against his camera
      // (`0x082823bc`), which is this body's eye.
      eyeY: feetY + this.eyeHeight,
      // `c_PIThrottle`, which is the forward axis and not the ramp: the swim
      // states' `addTransitionOne` clauses read the raw input.
      throttle: forward,
      climbing: Boolean(input.climbing),
      dead: Boolean(input.dead),
    });
    this.swimming = Boolean(swim.swimming);
    this.swimDepth = Number.isFinite(swim.depth) ? swim.depth : 0;
    // Where the swim state measured, after the tick's resolve and before the
    // pin -- only from the feet rather than the origin.
    const under = Number.isFinite(level) ? level - feetY : 0;
    this.underWater = under > 0 ? under : 0;
    this.#floatAtDraft(pin);
  }

  /**
   * Hold a swimmer's horizontal speed under the ceiling the collaborator names.
   *
   * The whole of why this exists is in `swim.js` beside
   * `SWIM_SPEED_CEILING_FACTOR`: the engine's `5.0 * vCmd` is balanced by the
   * **box** drag law (PHY-4) and this module carries the sphere one, so without a
   * ceiling a swimmer accelerates to 167 m/s. The factor is a viewer number and
   * is labelled as one there; the table entry it scales is the engine's.
   *
   * Un-ramped deliberately: the ceiling stands in for a drag, and a drag does not
   * disappear when the key comes up. Using the ramped speed would stop a swimmer
   * dead the instant he let go, which is the one thing water does not do.
   */
  #capSwimSpeed() {
    const factor = Number.isFinite(this.swim?.ceilingFactor)
      ? this.swim.ceilingFactor : 1 / 3;
    const cap = Math.max(DIRECTIONAL_SPEED[this.pose * 2],
                         STRAFE_SPEED[this.pose]) * factor;
    if (!(cap > 0)) return;
    const v = this.body.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed <= cap) return;
    const k = cap / speed;
    v.x *= k;
    v.z *= k;
  }

  /**
   * Pin a swimmer's feet to the draft the engine teleports him to.
   *
   * `updateSwimming`'s last act, while the surface is above the body, is
   * `setPosition(x, surfaceY - 0.4, z)` through the object's own vtable slot
   * `+0x3c` (`0x082822d4`-`0x0828227b`). That is his origin, a metre over his
   * feet, so `pin` -- `swim.js`'s answer -- is feet 1.4 m under the surface
   * (`SWIM_FEET_DRAFT`). It is a position write and not a force, so a
   * swimmer's vertical motion is not solved at all: he is placed at his draft
   * every tick, which is why a man who falls into the sea from a bomber
   * surfaces instantly instead of sinking and bobbing.
   *
   * The one thing added here is zeroing a downward velocity, and it is added for
   * the reason `#settle`'s wedge guard is: gravity keeps seeding the accumulator
   * every tick, and behind a hard position clamp that velocity grows without
   * bound until the clamp stops applying and fires the body at the seabed. The
   * engine has the same shape and gets away with it because its own
   * `setPosition` resets the physics node; this is that reset.
   */
  #floatAtDraft(pin) {
    if (pin === null || pin === undefined || !Number.isFinite(pin)) return;
    const p = this.body.position;
    const v = this.body.velocity;
    p.y = pin;
    if (v.y < 0) v.y = 0;
    // Floating is not standing: nothing to jump off, nothing to bill a fall
    // against, and no footfalls. `#contact` already refuses to arm a jump on
    // Water, and this makes the whole surface agree with that.
    this.grounded = false;
    this.lastCollisionHeight = pin;
  }

}

/** A level's per-material table (`level-terrain.js` builds them from
 *  `damage.json`), or the fallback for no table or an id it does not carry. */
function materialValue(table, id, fallback) {
  if (!table || !Number.isInteger(id) || id < 0) return fallback;
  if (id < table.length && Number.isFinite(table[id])) return table[id];
  return Number.isFinite(table[0]) ? table[0] : fallback;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}
