// A walking body: the engine's speeds and integrator, our collision resolve.
//
// Split out of `physics.js`, which re-exports it; see that file's header for
// the engine facts this rests on and for the duck-typed `world` it walks on.

import { PARACHUTE_DRAG } from './parachute.js';
import { GRAVITY, PointBody } from './point-body.js';
import { TICK_RATE, lerp } from './fixed-step.js';
import {
  POSE_STAND, POSE_FLAG_CROUCH, POSE_FLAG_PRONE, POSE_FLAG_JUMP, poseFromFlags,
  EYE_HEIGHT, BODY_HEIGHT, BODY_RADIUS, POSE_TRANSITION,
} from './soldier-pose.js';
import {
  DIRECTIONAL_SPEED, STRAFE_SPEED,
  applyMovementFactors, rampedDirectionalSpeed, rampedStrafeSpeed,
  SOLDIER_MASS, SOLDIER_DRAG, SOLDIER_BOUNDING_RADIUS,
  JUMP_IMPULSE, JUMP_COMMAND_KICK, JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER,
  LOCOMOTION_GAIN, STEP_HEIGHT, SNAP_DOWN, MAX_GROUND_SLOPE,
} from './soldier-locomotion.js';

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
    /** `max(0, waterSurface - feetY)`, the engine's own quantity. */
    this.swimDepth = 0;
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
    this._waterEntry = false;
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
    const fwdSpeed = rampedDirectionalSpeed(this.pose, this.forwardRamp, walk)
      * this.stateSpeed;
    const sideSpeed = rampedStrafeSpeed(this.pose, this.strafeRamp, walk);
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
    const jumped = this.swimming ? false : this.#tryJump(dt, cmdX, cmdZ);
    if (this.swimming) {
      // PHY-6's other half, and the part the ledger says is the important one:
      // the swimming force is `5.0 * vCmd` (`0x086c5288`, applied at
      // `0x08274b6f`) and it is **not** under the `IResponsePhysics+0xa4 == 0`
      // gate the `0.75 * vCmd` walk force is under — `0x08274a03`'s `jne` lands
      // past the 0.75 block and before the swim test at `0x08274b5f`. So it is
      // an acceleration, every tick, in contact or not, and there is no
      // `v = vCmd` assignment: a swimmer's speed is the balance between this
      // and the drag the water puts on him, which is why he does not reach the
      // 6 m/s the stand row of `directionalSpeed` names.
      //
      // The table row itself is unchanged. There is no swim entry in
      // `directionalSpeed` — the lnxded table at `0x0872edec` holds the same six
      // values as the client's `0x009581b4` and the two floats after it are
      // `strafeSpeed[0..1]`, not a fourth pose row — and `getPose()`
      // (`0x0827ddc0`) can only answer 0, 1 or 2. A swimming soldier is posed
      // standing and reads the standing row.
      const gain = Number.isFinite(this.swim?.gain) ? this.swim.gain : 5.0;
      body.addAcceleration(gain * cmdX, 0, gain * cmdZ);
      // A queued jump is spent rather than banked: coming out of the water
      // holding Space must not fire a jump that was pressed mid-stroke.
      this._jumpQueued = false;
    } else if (jumped) {
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
    // PHY-7's submersion drag, live: `scale = 1 + 24 * min(underWater/r, 1)`
    // with `underWater` the same `max(0, surface - y)` the swim state computed.
    // It is the engine's own coupling (`setUnderWater`, `0x08256ad0`), and it is
    // the reason a body in water sinks slowly rather than like a stone.
    body.updatePhysics(dt, { underWater: this.swimming ? this.swimDepth : 0 });
    if (this.swimming) this.#capSwimSpeed();
    // The impact velocity, captured before anything clamps it.
    const ivx = v.x, ivy = v.y, ivz = v.z;

    // --- and our resolve --------------------------------------------------
    this._armed = false;
    this._bestNormalY = -Infinity;
    this.landed = false;
    this._waterEntry = false;
    this.#resolve();
    this.#refuseSteepGround();
    this.#settle();
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

  /**
   * One tick of the injected swim state, and the draft it asks for.
   *
   * The water surface is asked for as a function of (x, z) and nothing else,
   * which is the engine's own shape: `updateSwimming` calls
   * `terrainBase->vtbl+0x5c(pos.x, pos.z)` (`0x08282215`) and subtracts the
   * body's y from the answer. That is the same trap HP-5's `touchesWater`
   * documents on the vehicle side — `surfaceHeight` cannot tell you whether you
   * are *in* the water, only where the water is; altitude decides.
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
      return;
    }
    const level = this.world ? this.world.waterLevel : null;
    const pin = swim.update({
      dt,
      surfaceY: Number.isFinite(level) ? level : null,
      feetY: this.body.position.y,
      // `c_PIThrottle`, which is the forward axis and not the ramp: the swim
      // states' `addTransitionOne` clauses read the raw input.
      throttle: forward,
      climbing: Boolean(input.climbing),
      dead: Boolean(input.dead),
    });
    this.swimming = Boolean(swim.swimming);
    this.swimDepth = Number.isFinite(swim.depth) ? swim.depth : 0;
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
   * `+0x3c` (`0x082822d4`-`0x0828227b`). It is a position write and not a
   * force, so a swimmer's vertical motion is not solved at all: he is placed at
   * his draft every tick, which is why a man who falls into the sea from a
   * bomber surfaces instantly instead of sinking and bobbing.
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
      const level = world.waterLevel;
      // **A man does not stand on the sea**, and this is where he used to.
      // `WorldCollider.surfaceHeight` answers `max(heightfield, waterLevel)`,
      // which is the right question for a vehicle on a bridge and the wrong one
      // for a soldier in the water: it put the feet on the water plane, reported
      // `grounded`, and let him walk out to sea. The engine has no such surface
      // for a soldier — `updateSwimming` is the only thing that ever puts a
      // soldier's y on the water, and it puts it 0.4 m *under*.
      //
      // So where the sea is the higher surface, ask the heightfield what is
      // actually underfoot. Standing in shallow water is then standing on the
      // seabed, with the seabed's own normal and material; deep water leaves
      // nothing to stand on and the body falls, which is what hands it to
      // `#updateSwim`.
      const isSea = Number.isFinite(h) && level != null
        && Math.abs(h - level) <= 1e-6;
      // The surface is not a floor, but it **is** a collision: HP-14's water
      // landing damage comes from `GameServer::handleCollisionLandOrWater`'s
      // `param_7 == 1` arm (`0x08154960`, and material 1 is hardcoded into all
      // three of its lookups), so a man who falls in is billed for it -- about
      // 67x more gently than the same drop onto land, because water's
      // `damageMod` is 1.5e-05 against dirt's 0.001. Registered here as a
      // one-tick contact on the crossing, with no clamp and no `grounded`.
      if (isSea && p.y <= level + SKIN
          && this.body.previous.y > level + SKIN) {
        this._waterEntry = true;
        // The drop is billed to the surface, not to wherever inside the tick's
        // step the body ended up, so that the same 10 m fall is the same `F`
        // whether it ends on dirt or in the sea and the only thing that differs
        // is the material's own `damageMod`.
        this._waterEntryY = level;
        this.contacts++;
        this.#contact(0, 1, 0, MATERIAL_WATER);
      }
      const bed = isSea && world.heightfield && world.heightfield.height
        ? world.heightfield.height(p.x, p.z) : NaN;
      const solid = isSea ? bed : h;
      if (Number.isFinite(solid)) {
        ground = solid;
        if (isSea && !(bed < level)) {
          // The sea and the bed agree to within the epsilon: a shoreline cell
          // exactly at water level. Keep the old material so a jump is still
          // refused there.
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
      // The cast answers for the water plane too (`collision.js`'s `kind ===
      // 'water'` arm), and that answer is not a floor for a man: without this
      // the sea came straight back in through the hull probe the moment the
      // surface test above stopped offering it.
      if (hit && hit.kind === 'water') {
        // nothing underfoot here
      } else if (hit && hit.ny >= MAX_GROUND_SLOPE && hit.y > ground) {
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
