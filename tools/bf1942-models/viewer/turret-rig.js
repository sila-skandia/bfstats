// A manned gun's aim rig: one `TurretAxis` per mouse-driven
// RotationalBundle axis, run as the engine's own velocity servo, and the
// `TurretRig` that routes a seat's mouse-look pair onto them. Split out of
// `seats.js`, which re-exports everything here.

import * as THREE from 'three';
import { AXES, isAimAxis } from './seat-survey.js';

// --- manned-gun aiming (GUN-2 and GUN-2b, both closed) ---------------------
//
// `RotationalBundle::calculateAndClipAngle` (lnxded `0x081d7490`) was read
// end to end in the 2026-09-19 round -- all 361 instructions, re-traced
// independently -- so the shape below is a transcription, not an
// approximation. It is a **first-order velocity servo**, and the earlier
// reading here ("two accumulators whose PRODUCT drives the angle", a +-40
// input register, a +-1.0 deadzone, a `lo == hi` wrap) was wrong on every
// one of those four points:
//
//   speed  ->  sign(acceleration) * input * maxSpeed,  ramped at
//              |acceleration| deg/s^2
//   angle  +=  speed * dt  +  continousRotationSpeed * dt
//   then:  minRotation == 0 && maxRotation == 0  ->  a single +-360 wrap
//          otherwise  angle > max -> max,  else  angle < min -> min
//
// Degrees throughout. Three consequences the viewer never had:
//
//   * `continousRotationSpeed * dt` is added EVERY tick, whatever the input
//     is doing, in the non-`automaticReset` path.
//   * `automaticReset` is a different control law entirely -- see
//     `_stepAutomaticReset`. 221 vanilla templates declare it.
//   * The wrap test is on the two bounds being ZERO, not on their being
//     equal. `min == max == 45` pins the axis at 45; it does not spin.
//
// `direction = sign(acceleration)` (`con.py`) matches the engine's
// `fchs`-on-negative-acceleration exactly and is kept.
//
// **GUN-2b is now closed too, and this file no longer owns any part of it.**
// `maxSpeed` is a gain -- deg/s per unit of input -- and the magnitude of
// `PlayerInput[c_PIMouseLookX/Y]` has been read end to end out of the client's
// DX8 mouse device: it is a RATE,
//
//     input = 0.001 x (mouse counts per second) x (5 x sensitivity + 0.1)
//
// computed once per pumped frame, held for every simulation tick of that
// frame, then clamped to +-16 and quantised on the way into the simulation.
// `viewer/mouse-input.js` is that whole stage, with the addresses; a Sherman
// tower (`setMaxSpeed 35`) at the shipped 0.25 is therefore commanded at
// **47.25 deg/s for 1000 counts a second**, saturating at about 11,852.
//
// So the two constants this file used to carry -- `TURRET_DEGREES_PER_PIXEL`,
// which turned a pixel into degrees of ask, and `TURRET_SPEED_SCALE = 4`,
// which multiplied every declared `setMaxSpeed` to make the result feel right
// -- are **gone**. There was never anything in the engine behind either of
// them; between them they were a hand-fitted stand-in for the 0.001-per-count
// rate, and the saturating normalisation they needed ("a hand asking for more
// than the ceiling delivers input 1") had the side effect of making every fast
// hand identical. It does not any more: an input above 1 really does command
// more than `maxSpeed`, exactly as the engine's servo does, up to the wire's
// +-16.
//
// `step` now takes the engine's own number. The one tunable left is
// `countsPerPixel` in `mouse-input.js` -- whether a browser `movementX` pixel
// is one DirectInput count -- and `?turret=` multiplies that.

const RIG_AXIS = { yaw: 'y', pitch: 'x', roll: 'z' };   // flight.js's own convention, mirrored
const RIG_SIGN = { yaw: -1, pitch: -1, roll: 1 };       // (unexported there; kept identical here)

// The ramp rate for an axis whose extract does not carry its own
// `setAcceleration`, deg/s^2. An axis that does carry it uses that number
// (`spec.acceleration`, emitted by `con.py` since 2026-09-17); this is the
// fallback for every glb baked before then.
//
// 90 deg/s^2 is the middle of the 30-150 band `setAcceleration` occupies
// across vanilla (flight-model.md §2a, confirmed). Still a fallback, not a
// measurement -- the fix is to re-extract, after which the gun's own number
// wins. A Sherman tower's real number is 1000, an MG42's 5000; at those
// rates the ramp is essentially instant and the cap is what the hand feels.
//
// It used to be scaled alongside the cap, to hold the wind-up TIME at the
// game's `maxSpeed/acceleration` ratio while `TURRET_SPEED_SCALE` moved the
// cap. Both are gone: the ratio is now simply the game's, because neither
// number is scaled by anything.
export const TURRET_ACCELERATION = 90;

/** A surveyed seat's mouse traverse limits `[min, max]` in radians from the
 *  rest pose, or null for a traverse that wraps (`minRotation == 0 &&
 *  maxRotation == 0`) or a seat with no mouse yaw axis. `TurretRig.
 *  yawLimitsRadians` for a seat nobody sits in yet (a bot weighing it). */
export function seatYawLimits(seat) {
  const spec = seat?.axes?.yaw?.spec;
  if (!isAimAxis(spec)) return null;
  const lo = Number(spec.min ?? 0), hi = Number(spec.max ?? 0);
  if (lo === 0 && hi === 0) return null;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const a = THREE.MathUtils.degToRad(lo * RIG_SIGN.yaw), b = THREE.MathUtils.degToRad(hi * RIG_SIGN.yaw);
  return [Math.min(a, b), Math.max(a, b)];
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/**
 * One RotationalBundle axis, run as the engine's own first-order velocity
 * servo (GUN-2, lnxded `0x081d7490`).
 *
 * Two registers, both on the instance and both persisting between ticks:
 * `angle` (engine `+0x104`, degrees from the authored rest pose) and `speed`
 * (engine `+0x110`, deg/s). Each tick the servo ramps `speed` toward
 * `sign(acceleration) * input * maxSpeed` at `|acceleration|` deg/s^2 and
 * integrates it, plus the continuous term, into `angle`.
 *
 * This replaced a bank-and-spend model in which `feed` accumulated DEGREES
 * OF AIM into a `pending` register clamped to +-40 and `step` paid them out.
 * Every part of that had a citation that turned out to be a misreading of the
 * same function: the engine's `+0x128` register is an **input backlog in
 * input units**, its +-40 clamp and its `-1.0` companion both live inside the
 * `rememberExcessInput` branch, and **no** turret, manned gun or tank in any
 * of 18 installs declares that flag -- so for every gun in this viewer that
 * register does not exist at all. There is no deadzone, no idle decay and no
 * "never turn further than was asked": those were feel patches compensating
 * for a bank the engine never had.
 *
 * The accumulate-pixels-then-normalise half of the old model is gone with it.
 * `setInput` is handed the engine's own `PlayerInput[c_PIMouseLookX/Y]` for
 * the current frame, already a rate and already quantised
 * (`viewer/mouse-input.js`), and it is NOT consumed by `step`: the engine
 * hands the same value to every tick of a frame, so several ticks of one
 * frame read it unchanged, and the next pump replaces it -- with 0 when the
 * hand stopped.
 */
export class TurretAxis {
  constructor(axisName, node, spec, peers) {
    this.axisName = axisName;
    this.node = node;
    this.spec = spec;
    this.peers = peers || [node];
    // Each peer has its own authored rest quaternion.
    this.peers = this.peers.map(n => ({
      node: n,
      base: n.quaternion.clone(),
    }));
    this.angle = 0;      // degrees from the authored rest pose (engine +0x104)
    this.speed = 0;      // deg/s, the servo's velocity register (engine +0x110)
    this._input = 0;     // this frame's axis value, held for all of its ticks
  }

  /** This frame's `PlayerInput[c_PIMouseLookX/Y]`, in engine units. Replaces;
   *  `step` reads it without clearing it. */
  setInput(value) {
    this._input = Number.isFinite(value) ? value : 0;
  }

  /** What the last pump handed this axis. */
  get input() { return this._input; }

  /**
   * One tick.
   *
   * `inputScale` multiplies the sampled input before the servo sees it, which
   * is exactly where the engine applies HP-15's damage penalty:
   * `RotationalBundle::handlePlayerInput` (`0x081d834f`) scales all three
   * axes by the double at `ds:0x86c8678` = **0.2** when `SimpleObject+0xee`
   * is set, i.e. while the vehicle is critically damaged. `map.html` passes
   * that 0.2 in; everything else passes nothing and gets 1.
   */
  step(dt, inputScale = 1) {
    if (!(dt > 0)) return;

    // GUN-2b, transcribed rather than invented now: the engine's `input` is
    // `PlayerInput[c_PIMouseLookX/Y]` exactly as `mouse-input.js` produces it
    // -- a rate, unnormalised, already saturated at the wire's +-16 -- and
    // `maxSpeed` is the deg/s it buys per unit of it. No clamp to +-1 here:
    // that clamp lives only inside the engine's `rememberExcessInput` branch,
    // which no turret, manned gun or tank in any of 18 installs declares.
    const cap = Math.abs(this.spec.maxSpeed || 0);
    // `direction` is `sign(acceleration)`, the engine's own
    // `fchs`-on-negative-acceleration; `inputScale` is HP-15's 0.2.
    const input = this._input * (this.spec.direction || 1) * inputScale;

    // `|acceleration|`, the axis's own `setAcceleration`, unscaled.
    // NOTE: `con.py` omits a zero `setAcceleration` rather than emitting 0, so
    // the engine's own early-out (`acceleration == 0 && continousRotationSpeed
    // == 0` returns without touching either register) cannot be told apart
    // from "this glb predates the field". The fallback is applied in both
    // cases, which is the pre-existing behaviour and the safe one.
    const accel = Math.abs(this.spec.acceleration || TURRET_ACCELERATION);

    if (this.spec.automaticReset) {
      this._stepAutomaticReset(dt, input, accel);
    } else {
      // The servo proper. `speed` chases the commanded rate; `angle`
      // integrates it AND the continuous term, which is added every tick
      // whatever the input is doing -- that unconditional `+=` is the whole
      // of `setContinousRotationSpeed`'s effect here.
      const target = input * cap;
      const maxStep = accel * dt;
      const change = target - this.speed;
      this.speed += Math.max(-maxStep, Math.min(maxStep, change));
      this.angle += this.speed * dt + (this.spec.continuousRotation || 0) * dt;
    }
    this._clip();
    this._apply();
  }

  /**
   * `automaticReset`'s law, which shares nothing with the servo but the
   * clip: the angle ramps STRAIGHT toward `input * maxRotation` at
   * `|acceleration|` **deg/s** -- a rate, not an acceleration -- with no
   * velocity register and no continuous-rotation term. Release the input and
   * the target is 0, so the part returns to rest at the same rate: that is
   * what makes a steering wheel self-centre and why 221 vanilla templates
   * (steering wheels and Engines) declare it.
   *
   * `maxRotation` is the per-axis `setMaxRotation` component, which `con.py`
   * drops when the axis is free -- and free means both bounds are zero, so
   * an absent `max` here really is the engine's 0 and the part ramps home.
   */
  _stepAutomaticReset(dt, input, accel) {
    const target = input * (this.spec.max || 0);
    const limit = accel * dt;
    const delta = target - this.angle;
    this.angle += Math.max(-limit, Math.min(limit, delta));
    this.speed = 0;
  }

  /**
   * The engine's own tail, in its own order (`0x081d7645` onward).
   *
   * The wrap gate is `minRotation == 0 && maxRotation == 0` -- the template
   * default -- and NOT a zero-width range: `min == max == 45` clamps to 45.
   * `con.py`'s `free` carries that test. When it fires it is a single +-360
   * correction, not a modulo, which is why a tick big enough to travel more
   * than a full turn is not normalised (the engine does not normalise it
   * either).
   *
   * The clamp tests `> max` FIRST and `< min` second, on the authored
   * components in the order the `.con` gave them -- it does not sort them.
   * Nothing zeroes the velocity register at a bound, so an axis held against
   * its stop keeps its speed and answers a reversed input by ramping through
   * zero, exactly as it would in mid-travel.
   */
  _clip() {
    if (this.spec.free) {
      if (this.angle > 180) this.angle -= 360;
      else if (this.angle < -180) this.angle += 360;
    } else {
      const hi = this.spec.max ?? 0;
      const lo = this.spec.min ?? 0;
      if (this.angle > hi) this.angle = hi;
      else if (this.angle < lo) this.angle = lo;
    }
  }

  _apply() {
    _euler.set(0, 0, 0);
    _euler[RIG_AXIS[this.axisName]] = THREE.MathUtils.degToRad(this.angle * RIG_SIGN[this.axisName]);
    _quat.setFromEuler(_euler);
    for (const peer of this.peers) {
      peer.node.quaternion.copy(peer.base).multiply(_quat);
    }
  }
}

/**
 * One seat's whole aim rig -- usually a yaw parent plus a pitch child
 * (GUN-6/GUN-21), occasionally a single axis (a hand-cranked AA mount) or a
 * yaw+roll pair where roll is doing elevation (Yamato, GUN-22).
 *
 * Routed by each axis's own bound input rather than by its yaw/pitch/roll
 * label: GUN-2 confirms every real manned gun binds `c_PIMouseLookX/Y`, and
 * `con.py`'s `rig()` already resolves a raw-int binding (`AA_Allies_
 * RotatingCrank`'s bare `4`) to the same symbolic name, so checking
 * `spec.input` handles Yamato's roll-as-elevation and the raw-int mounts
 * alike without a special case. An axis bound to anything else (a hand-turned
 * `c_PIYaw`/`c_PIPitch` crank, or `c_PIFire`'s recoil-animation axes, GUN-23)
 * is not driven by the mouse this round -- open, not approximated.
 */
export class TurretRig {
  constructor(seat) {
    // Only the axes this rig actually drives. It used to take every axis the
    // seat had and then feed none but the mouse-look pair, which pinned the
    // rest to their rest pose every frame instead of leaving them to
    // `applyRig`. Harmless while this was built for manned guns only — the
    // six vanilla/mod seats that mix inputs all pair mouse-look with a
    // `c_PIFire` barrel-spin axis nothing feeds either way — but not once a
    // drivetrain root can have one: the V-100's driving seat carries a turret
    // pitch beside `V-100FrontWheelR`'s own `c_PIYaw`, and claiming that
    // second axis would weld its front wheels straight.
    this.axes = AXES
      .filter(name => isAimAxis(seat.axes[name]?.spec))
      .map(name => new TurretAxis(name, seat.axes[name].node, seat.axes[name].spec, seat.axes[name].peers));
    /**
     * A single multiplier on everything the player asks this rig for, set from
     * outside — **HP-15**, and the one hook the vehicle's damage state needs
     * in this file.
     *
     * `RotationalBundle::handlePlayerInput` (lnxded 0x081d834f) picks between
     * two near-identical duplicated blocks; the one it takes when the object's
     * `+0xee` byte is set multiplies each of the three input axes by the
     * double at `ds:0x86c8678` = **0.2** (0x081d83af / 0x081d83b7). So a
     * critically damaged vehicle still traverses, at a fifth of the rate. A
     * destroyed one is a separate, harder gate one level up —
     * `PlayerControlObject::handlePlayerInput` (0x08318920) returns before
     * forwarding input to any child at all — and reaches here as **0**.
     *
     * It is deliberately a scale on the **input**, applied here rather than
     * inside `TurretAxis`: the engine scales `PlayerInput` on its way into the
     * bundle, not the servo's own maxSpeed or acceleration, so a critical
     * turret's wind-up profile is unchanged and only the amount asked for
     * shrinks. It also keeps the whole of HP-15 out of `TurretAxis`, whose
     * servo is being replaced under GUN-2.
     *
     * `map.html` owns the value; `vehicle-damage.js`'s `inputGate` is the
     * rule that produces it.
     */
    this.inputScale = 1;
  }

  /**
   * This frame's mouse-look axis pair, in ENGINE units -- what
   * `mouse-input.js`'s `pump()` just produced, not pixels. Called once per
   * pumped frame, before the frame's ticks; the value is held for all of them
   * because that is what the engine does (`mouse-input.js`'s header for the
   * `dt <= 0` gate that makes it so).
   *
   * `x` positive rightwards, `y` positive downwards, in the browser's own
   * screen sense and in DirectInput's, which agree. NOT negated by the caller:
   * `lookDelta` used to pass `(-dx, -dy)`, borrowed from the soldier's own
   * `look()`, whose yaw counts the other way, and the negation landed on top
   * of `RIG_SIGN`'s own flip inside `_apply`, so the sum of the two inverted
   * both axes -- the mouse pushed right swung a gun left, and pushed down
   * raised it. Measured on the Sherman's hull Browning as well as its main
   * gun, so it was wrong for every manned gun in the viewer.
   */
  aim(x, y) {
    // HP-15: a wreck takes no player input at all --
    // `PlayerControlObject::handlePlayerInput` (0x08318920) returns before
    // forwarding anything to a child. Zeroed rather than skipped, because the
    // value is now HELD rather than consumed: leaving the last frame's rate in
    // place would spin the gun forever. The CRITICAL vehicle's 0.2 is
    // deliberately NOT applied here -- see `step`.
    const dead = !(this.inputScale > 0);
    for (const axis of this.axes) {
      if (axis.spec.input === 'c_PIMouseLookX') axis.setInput(dead ? 0 : x);
      else if (axis.spec.input === 'c_PIMouseLookY') axis.setInput(dead ? 0 : y);
    }
  }

  /**
   * One tick for every axis this rig drives.
   *
   * `inputScale` is passed straight through to each `TurretAxis.step` and is
   * HP-15's damage penalty: **0.2** while the vehicle is critically damaged,
   * 1 otherwise. `map.html` owns deciding which, since it is the only thing
   * that knows the hull's live Armor, and it sets it on `this.inputScale`.
   *
   * It is spent HERE, on the axis value entering the servo, not on the
   * pointer motion in `aim()`. That is where the engine spends it:
   * `RotationalBundle::handlePlayerInput` (`0x081d834f`) multiplies the three
   * `PlayerInput` axes by the double at `ds:0x86c8678` = 0.2 as they enter the
   * bundle, i.e. after the wire's own clamp and quantisation, never before.
   * Two wave-2 streams each added the multiplier, in the two shapes, and git
   * merged them without a conflict; this is the one that survives. It matters
   * less than it did -- the viewer no longer saturates the input at +-1, so
   * the two shapes now differ only above the wire's own +-16 -- but "the
   * engine scales what enters the bundle" is the reason, and it has not
   * changed.
   *
   * An explicit argument still wins, so a caller can ask for a scale the rig
   * is not carrying.
   */
  step(dt, inputScale) {
    const scale = inputScale === undefined ? this.inputScale : inputScale;
    for (const axis of this.axes) axis.step(dt, scale);
  }

  /** The traverse this rig currently sits at, in radians, in the same sense
   *  the node itself is rotated about its own up axis — i.e. already through
   *  `RIG_SIGN`, so a caller does not have to know this file's convention.
   *  Zero when the seat has no yaw axis to traverse (a fixed mount that only
   *  elevates).
   *
   *  NOT what the HUD's turret dial wants: see `turretYawRadians`. */
  headingRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'yaw') {
        return THREE.MathUtils.degToRad(axis.angle * RIG_SIGN.yaw);
      }
    }
    return 0;
  }

  /** The traverse's limits `[min, max]` in radians from the rest pose, or
   *  null for a rig that wraps (`minRotation == 0 && maxRotation == 0`) or
   *  has no yaw axis: a bot's `validateCameraDirectionYaw` for a fixed gun. */
  yawLimitsRadians() {
    for (const axis of this.axes) {
      if (axis.axisName !== 'yaw') continue;
      const lo = Number(axis.spec?.min ?? 0), hi = Number(axis.spec?.max ?? 0);
      if (lo === 0 && hi === 0) return null;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      const a = THREE.MathUtils.degToRad(lo * RIG_SIGN.yaw), b = THREE.MathUtils.degToRad(hi * RIG_SIGN.yaw);
      return [Math.min(a, b), Math.max(a, b)];
    }
    return null;
  }

  /** The elevation axis's angle, radians (0 when the rig has none); a bot's
   *  aim reference beside `headingRadians`. */
  elevationRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'pitch') {
        return THREE.MathUtils.degToRad(axis.angle * RIG_SIGN.pitch);
      }
    }
    return null;
  }

  /**
   * The same traverse, in the ENGINE's sign rather than three.js's — positive
   * to the controlled PCO's right, which is what VHUD-9's
   * `IconLookRotation = atan2(dot(pcoRight, camForward), dot(pcoForward,
   * camForward))` measures for a tank driver whose camera rides the turret.
   *
   * It exists because `headingRadians()` has `RIG_SIGN.yaw = -1` baked in, and
   * the HUD dial used to be fed from it. That was two errors cancelling: the
   * engine's `RotateEffect` (`0x007edbf0`: `x' = x·c + y·s`, `y' = -x·s + y·c`)
   * is **counter-clockwise** on a y-down HUD frame while canvas `rotate(+θ)`
   * is clockwise, and the extra `-1` hid it. `hud.js` now rotates by `-angle`,
   * so the value it is given has to be the un-negated engine one — the two
   * halves only look right together. `undefined`, not 0, when the seat has no
   * traverse, so `map.html` can tell "no dial" from "dial at twelve o'clock".
   */
  turretYawRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'yaw') return THREE.MathUtils.degToRad(axis.angle);
    }
    return undefined;
  }

  /** Re-assert every axis's current angle on its node without advancing time.
   *  `applyRig` overwrites these nodes from the vehicle's own surface table
   *  every frame, so a rig that is not being stepped this frame — one whose
   *  seat has just become active again — needs this before anything reads a
   *  world pose off it. */
  apply() {
    for (const axis of this.axes) axis._apply();
  }
}
