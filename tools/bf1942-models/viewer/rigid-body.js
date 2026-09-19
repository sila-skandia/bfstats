// The root-node integrator every collidable vehicle runs: one semi-implicit
// Euler step per 30 Hz tick, a box-shaped inertia that ignores mass, and the
// sleep countdown that lets a parked, undriven vehicle stop being simulated.
//
// This is `PhysicsNode::updatePhysics` (`collision-response.md` §3-4;
// `R2-integrator.md` F3-F10, cross-checked by `V2-verification-of-R2.md`),
// ported, not re-derived: every branch and every constant here cites the
// finding it came from, and the arithmetic was checked against the reference
// `Model` in `vehicle-collision-physics/tools/emulator/r2_node_test_lib.py`
// (itself run as the game server's own machine code under Unicorn) by
// `tests/fixtures/make_rigid_body_golden.py` and `tests/test_rigid_body.py`.
//
// Only a ROOT node integrates (§3): a child part (engine, spring, wing,
// float) has nowhere to run in this module — the lead's adapters and track D
// call `addAccelerationAt`/`addFrictionAt` on the root directly, exactly as
// `PhysicsEngine`/`PhysicsSpring`/`PhysicsWing` do in the retail code (F9).
// This class models that root only.
//
// Deliberately NOT modelled here, because the briefing (§ "Tracks") gives it
// to someone else or leaves it out on purpose:
//   - drag. `updatePhysics` applies box (or sphere) drag to an awake root
//     before the linear step (physics.md §3, F8's `if drag > 0: ...` line).
//     Rather than duplicate the viewer's own box-drag arithmetic here, `step`
//     calls an optional `dragHook(body, dt)` at exactly that point — plug the
//     existing code in there. No drag runs unless a caller supplies one.
//   - collision detection, response shares, friction *solving* (that's
//     `body-contact.js`, §5-6, §8) — this module only exposes the four
//     accumulator adders those write into.
//
// Framework-free like `armor.js`/`physics.js`/`collision.js` — no three.js,
// no DOM — so `tests/rigid_body_harness.mjs` runs the real thing under plain
// node. No per-tick allocation: `step` and every adder work in scalars or
// mutate preallocated arrays in place.

// --- constants ---------------------------------------------------------

/** The fixed server tick (`collision-response.md` notation, top of file). */
export const TICK = 1 / 30;

/**
 * `BasicPhysicsSystem`'s gravity, m/s^2 downward (`physics.js`'s own citation
 * of `0x00578f00`; restated here because this module re-seeds it every tick —
 * F8: `acc.y += basicPhysicsSystem.getGravity() * gravityModifier`).
 */
export const GRAVITY = -14.73;

/**
 * `PhysicsNode::mFramesBeforeSafeToSleep` (F10): what `setIsAwake()` resets
 * the countdown to, and so also a freshly constructed or just-respawned
 * body's starting `sleepiness` (§4.3, "a new or just-woken node gets no
 * gravity in its first integrated tick" — see the constructor).
 */
export const FRAMES_BEFORE_SLEEP = 100;

/**
 * The `|acc|^2`/`|racc|^2` clamp (F5/F6, both share the one `1e6`/`1000`
 * pair): over the limit, the vector is *scaled down* to length 1000, not
 * dropped — one tick can still change velocity by at most 1000*dt = 33.3 m/s.
 */
export const ACCEL_CLAMP_LIMIT_SQ = 1e6;
export const ACCEL_CLAMP_SPEED = 1000;

/** `|fr|^2` over this and positional friction is dropped whole (F5). */
export const POSITIONAL_FRICTION_ZERO_SQ = 62500;

/**
 * `|rfr|^2` over this and rotational friction is dropped whole (F6) — but
 * only for the Y/X terms: the Z-axis term uses the sum from *before* this
 * test (`Tpre`), so an over-limit `rfr` still acts about body Z. See `step`.
 */
export const ROTATIONAL_FRICTION_ZERO_SQ = 40000;

/** The three `setIsAwake()` triggers (F8), each a strict `>=`. */
export const WAKE_ACCEL_SQ = 2.5;
export const WAKE_LINEAR_SPEED_SQ = 0.25;
export const WAKE_ANGULAR_SPEED_SQ = 0.25;

/**
 * `|w|^2` over this and the Rodrigues rotation actually runs (F6, constant
 * `0x86d139c`). The briefing calls this "1e-6"; the emulated machine code
 * disagrees with a round number by one ULP of single precision — R2's own
 * harness and `v2-emu-extra.py` both compare against `1.0000001e-06`, and
 * that is the value used here and in the golden generator, not `1e-6` itself.
 */
export const ROTATION_THRESHOLD_SQ = 1.0000001e-6;

/**
 * The geometry-less fallback's per-tick divisor (F6, constant `0x86d1398`):
 * `dw = (racc + rfr) * dt / FALLBACK_INERTIA`, no inertia tensor at all. See
 * `RigidBody`'s `box` option and `step`'s fallback branch.
 */
export const FALLBACK_INERTIA = 0.0314;

/** A static body's mass (briefing's body interface: "mass 1e12, never moves"). */
export const STATIC_MASS = 1e12;

// --- inertia -------------------------------------------------------------

/**
 * `getGeometryInertia` (F7): four times a solid box's inertia per unit mass,
 * from the object's own full bounding-box extents — **not** half-extents,
 * and **not** scaled by mass (mass never enters rotation anywhere in this
 * module). `dx, dy, dz` are `max - min` on each axis.
 *
 * F7's own out-parameters come back in `z, y, x` order; this returns the
 * more readable `[Ix, Iy, Iz]` and callers index by the axis they mean.
 */
export function boxInertia(dx, dy, dz) {
  return [
    (dy * dy + dz * dz) / 3,
    (dz * dz + dx * dx) / 3,
    (dx * dx + dy * dy) / 3,
  ];
}

// --- small vector helpers (scalars in, mutate-in-place out; no allocation) -

function lenSq3(v) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; }

function zero3(v) { v[0] = 0; v[1] = 0; v[2] = 0; }

/** F5/F6's NaN/Inf guard: any non-finite component zeroes the whole vector. */
function sanitizeFinite3(v) {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
    zero3(v);
  }
}

/** Scale `v` down to length `speed` if `|v|^2 > limitSq`; direction kept. */
function clampToSpeed(v, limitSq, speed) {
  const sq = lenSq3(v);
  if (sq > limitSq) {
    const s = speed / Math.sqrt(sq);
    v[0] *= s; v[1] *= s; v[2] *= s;
  }
}

/**
 * `out += proj(T, e) * k`, `proj(T, e) = e * (dot(T, e) / dot(e, e))`, or no
 * contribution when `e` is the zero vector (F6's `proj` footnote). `out` is
 * the caller's scratch accumulator — never allocated here.
 */
function addProjScaled(out, ex, ey, ez, Tx, Ty, Tz, k) {
  const l2 = ex * ex + ey * ey + ez * ez;
  if (l2 === 0) return;
  const s = (Tx * ex + Ty * ey + Tz * ez) / l2 * k;
  out[0] += ex * s; out[1] += ey * s; out[2] += ez * s;
}

/**
 * Rodrigues rotation of every row of `axes` about the unit axis `(nx,ny,nz)`
 * by `angle` radians, in place. Row 3 (translation) does not exist here —
 * `axes` holds only the three orientation rows, which is why `step` rotates
 * about the object's own origin and never touches `pos` (F6: "only the 3x3
 * rows change... the body turns about the object origin").
 */
function rotateAxesAbout(axes, nx, ny, nz, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const oneMinusC = 1 - c;
  for (let i = 0; i < 3; i++) {
    const r = axes[i];
    const rx = r[0], ry = r[1], rz = r[2];
    const d = nx * rx + ny * ry + nz * rz;
    const cx = ny * rz - nz * ry, cy = nz * rx - nx * rz, cz = nx * ry - ny * rx;
    r[0] = rx * c + cx * s + nx * d * oneMinusC;
    r[1] = ry * c + cy * s + ny * d * oneMinusC;
    r[2] = rz * c + cz * s + nz * d * oneMinusC;
  }
}

function copyVec3(v) { return [v[0], v[1], v[2]]; }
function copyAxes(axes) { return [copyVec3(axes[0]), copyVec3(axes[1]), copyVec3(axes[2])]; }

// --- the body --------------------------------------------------------------

/**
 * One root `PhysicsNode`: the state `updatePhysics` integrates, and the four
 * accumulator adders every force source (gravity, an engine, a spring, a
 * collision impulse) writes into. Implements the briefing's body interface
 * (`mass`, `isStatic`, `pos`, `axes`, `v`, `w`, `sleeping`, `wake`,
 * `tangentSpeed`, `translate`, `addAccelerationAt`, `addAcceleration`,
 * `addFrictionAt`) plus the extra fields/methods this track's callers need
 * for setup and testing.
 */
export class RigidBody {
  /**
   * @param {object} [opts]
   * @param {number} [opts.mass=1] collision-share metadata only (§6.1,
   *   track B) — never read by this module's own integration (F6: "mass
   *   never enters rotation"; the linear step is likewise a bare `v += a*dt`
   *   with no `/mass` anywhere in `updatePositionalPhysics`).
   * @param {[number,number,number]} [opts.inertiaModifier=[1,1,1]] per-axis
   *   `x,y,z` divisor on the rotational step (§4.2's `inertiaModifier`).
   * @param {[number,number,number]|null} [opts.box=null] full bounding-box
   *   extents `[dx,dy,dz]` used to build the box inertia (`boxInertia`).
   *   `null` selects the geometry-less fallback branch (F6 else-branch,
   *   `FALLBACK_INERTIA`) for every tick this body integrates.
   * @param {number} [opts.gravityModifier=1] multiplies `GRAVITY` when it is
   *   reseeded at the end of each awake tick (F8).
   * @param {[number,number,number]} [opts.comOffset=[0,0,0]] world-axis,
   *   unrotated centre-of-mass offset (F4) — zero for every shipped vehicle
   *   (V2 §6 item 4); only `addAccelerationAt`'s torque arm subtracts it.
   * @param {[number,number,number]} [opts.position=[0,0,0]] initial `pos`.
   * @param {[[number,number,number],[number,number,number],[number,number,number]]} [opts.axes]
   *   initial orientation rows (body X, Y, Z in world); defaults to identity.
   * @param {boolean} [opts.isSoldier=false] exempts this body from the
   *   automatic wake tests and sleep countdown (F8: `templateClassId !=
   *   0x9493`) — `isSleeping()` still gates integration either way.
   */
  constructor({
    mass = 1,
    inertiaModifier = [1, 1, 1],
    box = null,
    gravityModifier = 1,
    comOffset = [0, 0, 0],
    position = [0, 0, 0],
    axes = null,
    isSoldier = false,
  } = {}) {
    this.mass = mass;
    this.isStatic = false;
    this.inertiaModifier = copyVec3(inertiaModifier);
    this.hasGeometry = box != null;
    this.inertia = this.hasGeometry ? boxInertia(box[0], box[1], box[2]) : null;
    this.gravityModifier = gravityModifier;
    this.comOffset = copyVec3(comOffset);
    this.isSoldier = isSoldier;

    this.pos = copyVec3(position);
    this.axes = axes ? copyAxes(axes) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    // Born awake (§4.3) with a zero accumulator: the first call to `step`
    // therefore integrates with no gravity at all, exactly like a body the
    // engine has just constructed or just woken (F8's "gravity used in tick
    // N was written at the end of tick N-1").
    this.acc = [0, 0, 0];
    this.racc = [0, 0, 0];
    this.fr = [0, 0, 0];
    this.rfr = [0, 0, 0];
    this.frictionSamples = 0;
    this.sleepiness = FRAMES_BEFORE_SLEEP;

    /**
     * `(body, dt) => void`, called on an awake root right before the linear
     * step — where retail applies box/sphere drag (physics.md §3). Left
     * `null` by this module; the lead wires the viewer's existing drag code
     * in here so it runs at the same point in the tick the engine runs it.
     */
    this.dragHook = null;

    // Per-tick rotational scratch. One array, allocated once, reused by
    // every `step` call — see the module header's no-allocation rule.
    this._dw = [0, 0, 0];
  }

  /** `isSleeping()` (F10): `sleepiness <= 0`. */
  get sleeping() { return this.sleepiness <= 0; }

  /** `setIsAwake()` (F10): reset the countdown, nothing else. */
  wake() { this.sleepiness = FRAMES_BEFORE_SLEEP; }

  /** `setSleepiness(int)` (F10) — a negative value means "never wake". */
  setSleepiness(n) { this.sleepiness = n; }

  /** `getTangentSpeed(p)` (F3): `v + w x (p - pos)`, arm from the origin. */
  tangentSpeed(p, out) {
    const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2];
    const w = this.w;
    out[0] = this.v[0] + (w[1] * rz - w[2] * ry);
    out[1] = this.v[1] + (w[2] * rx - w[0] * rz);
    out[2] = this.v[2] + (w[0] * ry - w[1] * rx);
    return out;
  }

  /** An immediate positional correction (a collision's `posAdjust`). Not an
   * accumulator: bypasses drag, clamps and sleeping entirely, exactly like
   * `solveImpulse`'s own `setAbsolutePosition` call (§4.3: applies even to a
   * sleeping body, without waking it). */
  translate(dp) {
    this.pos[0] += dp[0]; this.pos[1] += dp[1]; this.pos[2] += dp[2];
  }

  /**
   * `addAccelerationAtAbsolutePosition(p, a)` (F4): `acc += a; racc +=
   * cross(p - pos - comOffset, a)`. Not gated on sleeping — the resolve pass
   * posts into a sleeping victim's accumulators too; it is `step`'s asleep
   * branch that discards them next tick (§4.3).
   */
  addAccelerationAt(p, a) {
    this.acc[0] += a[0]; this.acc[1] += a[1]; this.acc[2] += a[2];
    const com = this.comOffset;
    const rx = p[0] - this.pos[0] - com[0];
    const ry = p[1] - this.pos[1] - com[1];
    const rz = p[2] - this.pos[2] - com[2];
    this.racc[0] += ry * a[2] - rz * a[1];
    this.racc[1] += rz * a[0] - rx * a[2];
    this.racc[2] += rx * a[1] - ry * a[0];
  }

  /**
   * `addAccelerationAtRelativePosition(0,0,0, a)` (F4): the entry point an
   * engine or a spring on this root uses. Documented contract is `acc += a`
   * only — exact when `comOffset` is zero, which the spec finds true for
   * every shipped vehicle (V2 §6 item 4); see this module's header/report
   * for the non-zero-`comOffset` caveat.
   */
  addAcceleration(a) {
    this.acc[0] += a[0]; this.acc[1] += a[1]; this.acc[2] += a[2];
  }

  /**
   * `addFrictionAtAbsolutePosition(p, f)` (F4): a running mean (not a sum),
   * arm from the object origin with **no** comOffset subtraction, one shared
   * sample count for both the positional and rotational mean.
   */
  addFrictionAt(p, f) {
    const n = this.frictionSamples;
    const k = 1 / (n + 1);
    const fr = this.fr, rfr = this.rfr;
    fr[0] = (fr[0] * n + f[0]) * k;
    fr[1] = (fr[1] * n + f[1]) * k;
    fr[2] = (fr[2] * n + f[2]) * k;
    const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2];
    rfr[0] = (rfr[0] * n + (ry * f[2] - rz * f[1])) * k;
    rfr[1] = (rfr[1] * n + (rz * f[0] - rx * f[2])) * k;
    rfr[2] = (rfr[2] * n + (rx * f[1] - ry * f[0])) * k;
    this.frictionSamples = n + 1;
  }

  /**
   * A pad respawn: zero every speed and accumulator and stand the body back
   * up awake (§4.3's "acc zero so the first integrated tick has no gravity"
   * — same reasoning as the constructor, since a respawn is just a second
   * birth at a new transform).
   */
  reset({ position, axes } = {}) {
    if (position) { this.pos[0] = position[0]; this.pos[1] = position[1]; this.pos[2] = position[2]; }
    if (axes) {
      for (let i = 0; i < 3; i++) {
        this.axes[i][0] = axes[i][0]; this.axes[i][1] = axes[i][1]; this.axes[i][2] = axes[i][2];
      }
    }
    zero3(this.v); zero3(this.w);
    zero3(this.acc); zero3(this.racc);
    zero3(this.fr); zero3(this.rfr);
    this.frictionSamples = 0;
    this.sleepiness = FRAMES_BEFORE_SLEEP;
  }

  /**
   * `PhysicsNode::updatePhysics(dt)` for a ROOT node (F8), in order:
   *
   *  1. sleep bookkeeping against the accumulator/speeds *as they stand*
   *     (§4.3) — may wake the body, may count the sleep countdown down;
   *  2. if asleep: zero every speed and accumulator, seed no gravity, return;
   *  3. `dragHook` (awake root only, before anything else moves);
   *  4. linear step: NaN-guard, clamp, integrate `v` then `pos`, clear;
   *  5. angular step: NaN-guard, clamp `racc`, the geometry (or fallback)
   *     torque-to-`Δω` branch, integrate `w`, Rodrigues-rotate `axes`, clear;
   *  6. reseed `acc.y = GRAVITY * gravityModifier` for the *next* tick.
   */
  step(dt = TICK) {
    // 1-2. sleep bookkeeping (F8; soldiers exempted from the automatic
    // tests, but not from the isSleeping() gate right after).
    if (this.sleepiness >= 0 && !this.isSoldier) {
      if (lenSq3(this.acc) >= WAKE_ACCEL_SQ
        || lenSq3(this.v) >= WAKE_LINEAR_SPEED_SQ
        || lenSq3(this.w) >= WAKE_ANGULAR_SPEED_SQ) {
        this.sleepiness = FRAMES_BEFORE_SLEEP;
      } else if (this.sleepiness > 0) {
        this.sleepiness -= 1;
      }
    }

    if (this.sleepiness <= 0) {
      zero3(this.v); zero3(this.w);
      zero3(this.acc); zero3(this.racc);
      zero3(this.fr); zero3(this.rfr);
      this.frictionSamples = 0;
      return;
    }

    // 3. drag (physics.md §3) — left to the caller.
    if (this.dragHook) this.dragHook(this, dt);

    // 4. linear (F5).
    const acc = this.acc, fr = this.fr, v = this.v, pos = this.pos;
    sanitizeFinite3(acc);
    sanitizeFinite3(fr);
    clampToSpeed(acc, ACCEL_CLAMP_LIMIT_SQ, ACCEL_CLAMP_SPEED);
    if (lenSq3(fr) > POSITIONAL_FRICTION_ZERO_SQ) zero3(fr);
    v[0] += acc[0] * dt; v[1] += acc[1] * dt; v[2] += acc[2] * dt;
    v[0] += fr[0] * dt; v[1] += fr[1] * dt; v[2] += fr[2] * dt;
    pos[0] += v[0] * dt; pos[1] += v[1] * dt; pos[2] += v[2] * dt;
    zero3(acc); zero3(fr);

    // 5. angular (F6).
    const racc = this.racc, rfr = this.rfr, axes = this.axes, imod = this.inertiaModifier;
    sanitizeFinite3(racc);
    sanitizeFinite3(rfr);
    clampToSpeed(racc, ACCEL_CLAMP_LIMIT_SQ, ACCEL_CLAMP_SPEED);

    const dw = this._dw;
    dw[0] = 0; dw[1] = 0; dw[2] = 0;

    if (this.hasGeometry) {
      const I = this.inertia;
      // Tpre uses rfr BEFORE the 40000 zeroing; Tpost after. Z is projected
      // against Tpre, Y and X against Tpost — the quirk F6 flags: an
      // over-limit rotational friction still acts about body Z and is only
      // dropped for X/Y.
      const preX = racc[0] + rfr[0], preY = racc[1] + rfr[1], preZ = racc[2] + rfr[2];
      if (lenSq3(rfr) > ROTATIONAL_FRICTION_ZERO_SQ) zero3(rfr);
      const postX = racc[0] + rfr[0], postY = racc[1] + rfr[1], postZ = racc[2] + rfr[2];

      addProjScaled(dw, axes[2][0], axes[2][1], axes[2][2], preX, preY, preZ, dt / (imod[2] * I[2]));
      addProjScaled(dw, axes[1][0], axes[1][1], axes[1][2], postX, postY, postZ, dt / (imod[1] * I[1]));
      addProjScaled(dw, axes[0][0], axes[0][1], axes[0][2], postX, postY, postZ, dt / (imod[0] * I[0]));
      if (!Number.isFinite(dw[0]) || !Number.isFinite(dw[1]) || !Number.isFinite(dw[2])) zero3(dw);
    } else {
      // Geometry-less fallback (F6 else-branch). Quirk, read from the
      // address ordering rather than exercised by emulation (V2 §0: "the
      // fallback guard stays unexercised, dead branch anyway"): the 40000
      // rotational-friction zeroing test sits inside the geometry branch
      // only, so the fallback uses the *raw* racc+rfr with no such clamp,
      // then drops (not scales) the result if it is itself too large.
      const k = dt / FALLBACK_INERTIA;
      dw[0] = (racc[0] + rfr[0]) * k;
      dw[1] = (racc[1] + rfr[1]) * k;
      dw[2] = (racc[2] + rfr[2]) * k;
      if (lenSq3(dw) > ACCEL_CLAMP_LIMIT_SQ) zero3(dw);
      if (!Number.isFinite(dw[0]) || !Number.isFinite(dw[1]) || !Number.isFinite(dw[2])) zero3(dw);
    }

    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];

    const wSq = lenSq3(this.w);
    if (wSq > ROTATION_THRESHOLD_SQ) {
      const wl = Math.sqrt(wSq);
      rotateAxesAbout(axes, this.w[0] / wl, this.w[1] / wl, this.w[2] / wl, wl * dt);
    }

    zero3(racc); zero3(rfr);
    this.frictionSamples = 0;

    // 6. gravity for the NEXT tick only (acc is already [0,0,0] here).
    this.acc[1] = GRAVITY * this.gravityModifier;
  }
}

/**
 * A never-moving body (a `StaticPhysicsNode`/`StaticResponsePhysics`, §3's
 * table: "every adder a no-op"). `mass` is the engine's own snap threshold
 * from §6.1's collision-share table (`s > 0.95` treats the heavier side as
 * effectively this), not a physically meaningful number.
 */
export function staticBody({ position = [0, 0, 0], axes = null } = {}) {
  const pos = copyVec3(position);
  const ax = axes ? copyAxes(axes) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return {
    mass: STATIC_MASS,
    isStatic: true,
    pos,
    axes: ax,
    v: [0, 0, 0],
    w: [0, 0, 0],
    sleeping: true,
    wake() {},
    tangentSpeed(p, out) { out[0] = 0; out[1] = 0; out[2] = 0; return out; },
    translate() {},
    addAccelerationAt() {},
    addAcceleration() {},
    addFrictionAt() {},
  };
}
