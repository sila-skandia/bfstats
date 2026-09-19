// The Coulomb friction solver every touching collidable part runs after
// `solveImpulse`, on the contact averages `impulseOn` left behind — terrain
// and object contacts alike. This is `ResponsePhysics::addFriction`
// (`features/bf1942-engine-reference/subsystems/collision-response.md` §8,
// call it "the spec" below) as pinned down by
// `features/vehicle-collision-physics/reports/R1-terrain-friction.md` F5/F8/F9
// and corrected/confirmed by `.../V1-verification-of-R1.md` (cited inline as
// R1/V1). There is no force and no mass anywhere in here: each touching part
// asks for a per-tick VELOCITY CHANGE its grip wants, the vector is clamped
// to a Coulomb disc, and the clamped result is handed to the root at the
// contact point.
//
// Framework-free like `rigid-body.js` and `body-contact.js` — no three.js,
// no DOM — so `tests/body_ground_harness.mjs` runs it under plain node. A
// **response** is duck-typed to the exact shape `body-contact.js`'s
// `Response` class already implements (`IMPLEMENTATION.md`'s "Shared
// interfaces"): `count`, `avgNormal`/`avgSpeed`/`avgRelPos`, `friction`/
// `resistance`, `grip`/`liveGrip`, `surfaceSpeed`, `kind`, and a
// `clearContacts()` method — this module never imports `Response`, it only
// reads and writes those fields, exactly the way `crash-damage.js` reads
// `body-contact.js`'s contract without importing it. A **body** is the same
// duck-typed interface `body-contact.js` and `rigid-body.js` already share
// (`addAcceleration`, `addFrictionAt`, `wake`), plus the one extra field this
// solver's own wake test needs and the shared interface list omits —
// `body.sleepiness`, present on every `RigidBody` — see this track's report
// for why that is flagged as a contract gap rather than silently assumed.
//
// The one import this module does take is `GRAVITY` from `rigid-body.js`
// (track A's own file, explicitly in this track's reading list): the spec's
// `V.y += g/30` term reads the SAME configurable gravity the integrator
// seeds every tick, in deliberate contrast to the Coulomb limit's `1.5*9.82`,
// which R1/V1 (C2) confirm is a hard-coded literal in the binary, never
// `getGravity()` — so this file keeps those two numbers visibly distinct
// rather than letting one drift out of sync with `rigid-body.js`'s own
// constant.
//
// No per-tick allocation in hot paths: every intermediate vector below is a
// module-level scratch array, reused by every `addFriction` call (this
// module is never reentrant — one call completes before the next begins).

import { GRAVITY } from './rigid-body.js';

// --- the grip bitfield (physics.md §6, "Grip is a bitfield, not an enum") --

/** `c_PGFNoGrip`. */
export const GRIP_NONE = 0;
/** `c_PGFContactGrip` — the whole tangential velocity is asked to stop. */
export const GRIP_CONTACT = 1;
/** `c_PGFRollGrip` — only the component along the wheel's own axle. */
export const GRIP_ROLL = 2;
/** `c_PGFEngineGrip` — the target is the engine's own surface speed. */
export const GRIP_ENGINE = 4;
/** `c_PGFRollGripWhenOccupied` — never reaches this solver: `PhysicsSpring`
 *  rewrites it to `GRIP_CONTACT|GRIP_ROLL_WHEN_OCCUPIED` (empty) or
 *  `GRIP_ROLL|GRIP_ROLL_WHEN_OCCUPIED` (occupied) first (R1 F9). Exported so
 *  a caller building the authored byte off a glb's `physics.gripFlags` can
 *  test for it — see `parkedGrip`. */
export const GRIP_ROLL_WHEN_OCCUPIED = 8;
/** `c_PGFDummyGrip` alone (without `GRIP_ENGINE`) — falls through to the
 *  ordinary `GRIP_CONTACT` path (R1 F5, C3's own correction of the briefing's
 *  JS notes). */
export const GRIP_DUMMY = 0x20;
/** `c_PGFEngineDummyGrip` = `GRIP_DUMMY|GRIP_ENGINE`: the early exit that
 *  spins the wheel visually and touches nothing else (R1 F5's `ENGINE_DUMMY`
 *  label, V1 C3). */
export const GRIP_ENGINE_DUMMY = GRIP_DUMMY | GRIP_ENGINE;
/** `c_PGFStaticFriction` — the cross-tick latch bit of `liveGrip`. */
export const GRIP_STATIC_FRICTION = 0x80;

// --- named spec constants (§8, R1 F5, V1 C2) --------------------------------

/**
 * The engine's fixed simulation rate, `g_simulationFps` (`0x08716b5c`) — V1's
 * C2 found this is a *mutable* `.data` global the binary never actually
 * changes from its 30.0 default, in contrast to the Coulomb limit's `9.82`
 * literal below, which truly is baked into the instruction stream. Used both
 * to divide the Coulomb budget into a per-tick velocity step and to multiply
 * the clamped result back into an acceleration for `addFrictionAt`.
 */
export const SIMULATION_FPS = 30;

/**
 * The Coulomb limit's own hard-coded "gravity" (R1 F5, V1 C2: rodata
 * `0x086d16e4`, "hard-coded `9.82*1.5`/`9.82*2.25`... only `V.y +=
 * getGravity()/fps` follows a changed gravity"). Deliberately NOT derived
 * from `GRAVITY` even though `1.5*9.82 === -GRAVITY` at the shipped value —
 * porting that coincidence as one shared constant would silently break a mod
 * that changes gravity but not this literal.
 */
export const COULOMB_GRAVITY = 9.82;

/** `limKinetic`'s own coefficient: `mu * N.y * 1.5 * COULOMB_GRAVITY / SIMULATION_FPS`. */
export const COULOMB_KINETIC_COEFFICIENT = 1.5;

/** `limStatic = COULOMB_STATIC_MULTIPLIER * limKinetic` (R1's `limA`, "1.5x that
 *  while the static latch holds" — physics.md §6). */
export const COULOMB_STATIC_MULTIPLIER = 1.5;

/**
 * `|avgContactSpeed|^2` over this and, sleepiness permitting, the root wakes
 * (R1 F5 housekeeping). The same literal value as `body-contact.js`'s
 * `HANDLER_SPEED_THRESHOLD_SQ` and `checkVsTerrain`'s own handler gate — all
 * three read the one rodata float `0x086b1ca0` — kept as a separate local
 * constant here rather than imported, so this module stays a standalone leaf
 * like `body-contact.js` and `crash-damage.js` (see this file's header).
 */
export const WAKE_CONTACT_SPEED_SQ = 0.1;

/**
 * The Coulomb clamp's own floor (R1 F5 `0x086d139c`, V1 §2 confirms the same
 * address): below this squared magnitude, `dV` passes through un-scaled even
 * when it nominally exceeds the limit (guards a division by ~0). This is the
 * SAME memory address `rigid-body.js`'s `ROTATION_THRESHOLD_SQ` cites for the
 * Rodrigues-rotation guard, and R2's emulation there found the binary's own
 * float32 constant reads back as `1.0000001e-6`, one ULP off the round
 * `1e-6` a source literal would produce — used here for the identical
 * reason: bit-exact agreement with the traced machine code, not a
 * convenience rounding.
 */
export const FRICTION_MIN_MAGNITUDE_SQ = 1.0000001e-6;

// --- grip fix-up for a definitionally-unoccupied vehicle --------------------

/**
 * `PhysicsSpring::updatePhysics`'s per-tick grip rewrite (physics.md §6, R1
 * F9), applied ONCE instead of every tick: a wheel whose authored flags
 * include `GRIP_ROLL_WHEN_OCCUPIED` (8) becomes `GRIP_CONTACT|
 * GRIP_ROLL_WHEN_OCCUPIED` (9) while nobody is driving. `body-ground.js`'s
 * `ParkedVehicle` — definitionally unoccupied — calls this once at
 * construction rather than re-deriving "is anyone in the seat" every tick;
 * a caller modelling an occupied vehicle would instead rewrite to
 * `GRIP_ROLL|GRIP_ROLL_WHEN_OCCUPIED` (10) and keep doing it live. A flag
 * with no `GRIP_ROLL_WHEN_OCCUPIED` bit passes through unchanged.
 */
export function parkedGrip(authoredGrip) {
  if (authoredGrip & GRIP_ROLL_WHEN_OCCUPIED) {
    return GRIP_CONTACT | GRIP_ROLL_WHEN_OCCUPIED;
  }
  return authoredGrip;
}

// --- small vector helpers (no allocation; every scratch is module-level) ---

function dot3(ax, ay, az, bx, by, bz) { return ax * bx + ay * by + az * bz; }

const ZERO3 = Object.freeze([0, 0, 0]);

const _V = [0, 0, 0];
const _Vt = [0, 0, 0];
const _dV = [0, 0, 0];
const _F = [0, 0, 0];
const _resistAccel = [0, 0, 0];
const _armPos = [0, 0, 0];
const _F30 = [0, 0, 0];
const _axleTangent = [0, 0, 0];

/**
 * `ResponsePhysics::addFriction` (§8, R1 F5, V1). Runs once per touching
 * part, on the contact averages `impulseOn` (`body-contact.js`'s
 * `Response.impulseOn`) left this tick, AFTER that part's `solve()` — the
 * spec's `solveImpulse` then `addFriction` ordering.
 *
 * @param {object} response a `Response`-shaped object: `count`, `grip`
 *   (authored byte), `liveGrip` (mutated in place — the cross-tick 0x80
 *   latch), `avgNormal`/`avgSpeed`/`avgRelPos` (3-vectors), `friction`,
 *   `resistance`, `surfaceSpeed` (3-vector), `kind`
 *   (`'body'|'spring'|'soldier'|'projectile'`), and `clearContacts()`.
 * @param {object} body a duck-typed body: `addAcceleration(a)`,
 *   `addFrictionAt(p,f)`, `wake()`, and `sleepiness` (a number; a body that
 *   omits it — outside the documented shared interface, see this file's
 *   header — is treated as always eligible to wake).
 * @param {number[]} partPos this part's own current world position (its
 *   `worldPos()`, not the root's — matches `body-contact.js`'s `solve`).
 * @param {{axle?: number[], engineSurfaceSpeed?: number[]}} [opts]
 *   `axle`: the wheel's own axle direction, world space, for `GRIP_ROLL`
 *   (§8: "the component of Vt along the wheel's own axle projected into the
 *   contact plane") — irrelevant, and omittable, for any other grip.
 *   `engineSurfaceSpeed`: `T`, already tangent to the contact normal, for
 *   `GRIP_ENGINE` — the caller supplies zero (the default) for a parked,
 *   engine-off part; this module has no engine model of its own.
 * @returns {{applied: boolean, spin: boolean, F: number[]|null,
 *   latched: boolean|null, woke: boolean}} `spin: true` for the
 *   `GRIP_ENGINE_DUMMY` early exit (visual wheel spin only — out of this
 *   module's scope, no engine to spin it from); `applied: false` for either
 *   early exit; otherwise the clamped `dV` (NOT yet multiplied by
 *   `SIMULATION_FPS` — `body.addFrictionAt` already received that scaled
 *   copy) and the latch state after this call.
 */
export function addFriction(response, body, partPos, opts = {}) {
  const P = response.grip;

  // ENGINE_DUMMY (R1 F5 entry, V1 C3): P & 0x24 === 0x24. Spin only — no
  // friction sample, no reset of the contact averages, no latch touched.
  if ((P & GRIP_ENGINE_DUMMY) === GRIP_ENGINE_DUMMY) {
    return { applied: false, spin: true, F: null, latched: null, woke: false };
  }

  // No contact this tick, or NoGrip: clear the latch (the WHOLE live byte,
  // not just bit 0x80 — R1 F5 "L = 0"), leave the contact averages alone.
  if (response.count === 0 || P === 0) {
    response.liveGrip = 0;
    return { applied: false, spin: false, F: null, latched: false, woke: false };
  }

  const isSoldier = response.kind === 'soldier';
  // F8: a soldier's normal (+0x98) is written by nothing, so N is always
  // zero — read-only here, never mutated.
  const N = isSoldier ? ZERO3 : response.avgNormal;
  const mu = response.friction;

  const limKinetic = mu * N[1] * (COULOMB_KINETIC_COEFFICIENT * COULOMB_GRAVITY) / SIMULATION_FPS;
  const limStatic = COULOMB_STATIC_MULTIPLIER * limKinetic;

  // V = avgSpeed - surfaceSpeed; V.y += GRAVITY/fps (next tick's gravity, so
  // a held body does not creep — §8).
  const avgSpeed = response.avgSpeed, surfaceSpeed = response.surfaceSpeed;
  _V[0] = avgSpeed[0] - surfaceSpeed[0];
  _V[1] = avgSpeed[1] - surfaceSpeed[1] + GRAVITY / SIMULATION_FPS;
  _V[2] = avgSpeed[2] - surfaceSpeed[2];

  // Vt = V - N*(V.N)/(N.N), or V itself when N.N == 0 (F8's soldier case
  // falls out of this same line, no special branch needed).
  const nn = dot3(N[0], N[1], N[2], N[0], N[1], N[2]);
  if (nn === 0) {
    _Vt[0] = _V[0]; _Vt[1] = _V[1]; _Vt[2] = _V[2];
  } else {
    const k = dot3(_V[0], _V[1], _V[2], N[0], N[1], N[2]) / nn;
    _Vt[0] = _V[0] - N[0] * k; _Vt[1] = _V[1] - N[1] * k; _Vt[2] = _V[2] - N[2] * k;
  }

  // (a) resistance: an acceleration, summed, at the root's own origin.
  if (response.resistance > 0) {
    _resistAccel[0] = -response.resistance * _Vt[0];
    _resistAccel[1] = -response.resistance * _Vt[1];
    _resistAccel[2] = -response.resistance * _Vt[2];
    body.addAcceleration(_resistAccel);
  }

  // (b) the wanted velocity change dV, by LIVE grip (liveGrip's low 7 bits
  // were refreshed to match `grip` by this tick's impulseOn calls, since
  // count > 0 here — §8, R1 F5).
  const L = response.liveGrip;
  if (L & GRIP_ENGINE) {
    const T = opts.engineSurfaceSpeed || ZERO3;
    _dV[0] = T[0] - _Vt[0]; _dV[1] = T[1] - _Vt[1]; _dV[2] = T[2] - _Vt[2];
  } else if (L & GRIP_ROLL) {
    const axle = opts.axle || ZERO3;
    let ax = axle[0], ay = axle[1], az = axle[2];
    if (nn !== 0) {
      const k = dot3(ax, ay, az, N[0], N[1], N[2]) / nn;
      ax -= N[0] * k; ay -= N[1] * k; az -= N[2] * k;
    }
    _axleTangent[0] = ax; _axleTangent[1] = ay; _axleTangent[2] = az;
    const xtxt = dot3(ax, ay, az, ax, ay, az);
    if (xtxt === 0) {
      // Numerical guard, not a spec branch (mirrors `rigid-body.js`'s
      // `addProjScaled` zero-length guard): a degenerate axle exactly along
      // the contact normal removes nothing rather than dividing by zero.
      _dV[0] = 0; _dV[1] = 0; _dV[2] = 0;
    } else {
      const k2 = dot3(_Vt[0], _Vt[1], _Vt[2], ax, ay, az) / xtxt;
      _dV[0] = -ax * k2; _dV[1] = -ay * k2; _dV[2] = -az * k2;
    }
  } else {
    // ContactGrip, and bare DummyGrip (R1 F5, V1 C3).
    _dV[0] = -_Vt[0]; _dV[1] = -_Vt[1]; _dV[2] = -_Vt[2];
  }

  // (c) the Coulomb clamp with the 0x80 static latch — identical shape for
  // all three grips (R1 F5(c), V1 confirms the common tail at 0x825bb54).
  const magSq = dot3(_dV[0], _dV[1], _dV[2], _dV[0], _dV[1], _dV[2]);
  const wasLatched = (L & GRIP_STATIC_FRICTION) !== 0;
  let latched = wasLatched;
  _F[0] = _dV[0]; _F[1] = _dV[1]; _F[2] = _dV[2];

  if (wasLatched) {
    if (magSq > limStatic * limStatic && magSq > FRICTION_MIN_MAGNITUDE_SQ) {
      latched = false;
      const scale = Math.abs(limKinetic) / Math.sqrt(magSq);
      _F[0] *= scale; _F[1] *= scale; _F[2] *= scale;
    }
    // else: F = dV in full, the contact holds.
  } else {
    if (magSq > limKinetic * limKinetic && magSq > FRICTION_MIN_MAGNITUDE_SQ) {
      const scale = Math.abs(limKinetic) / Math.sqrt(magSq);
      _F[0] *= scale; _F[1] *= scale; _F[2] *= scale;
    } else {
      latched = true;
    }
  }
  response.liveGrip = latched ? (L | GRIP_STATIC_FRICTION) : (L & ~GRIP_STATIC_FRICTION);

  // (d) apply. Soldier: no avgRelPos offset (R1 F5 "(d) apply", V1 confirms
  // "+ +0x8c unless soldier").
  const avgRelPos = response.avgRelPos;
  if (isSoldier) {
    _armPos[0] = partPos[0]; _armPos[1] = partPos[1]; _armPos[2] = partPos[2];
  } else {
    _armPos[0] = partPos[0] + avgRelPos[0];
    _armPos[1] = partPos[1] + avgRelPos[1];
    _armPos[2] = partPos[2] + avgRelPos[2];
  }
  _F30[0] = _F[0] * SIMULATION_FPS; _F30[1] = _F[1] * SIMULATION_FPS; _F30[2] = _F[2] * SIMULATION_FPS;
  body.addFrictionAt(_armPos, _F30);

  // (e) housekeeping: wake on a fast-enough averaged contact, unless this
  // body is permanently held asleep (sleepiness < 0 — the AI's
  // disablePhysics; `sleepiness` sits outside the documented shared body
  // interface, see this file's header, so its absence reads as "eligible").
  let woke = false;
  if (dot3(avgSpeed[0], avgSpeed[1], avgSpeed[2], avgSpeed[0], avgSpeed[1], avgSpeed[2]) > WAKE_CONTACT_SPEED_SQ) {
    const eligible = typeof body.sleepiness !== 'number' || body.sleepiness >= 0;
    if (eligible) { body.wake(); woke = true; }
  }

  response.clearContacts();

  return { applied: true, spin: false, F: [_F[0], _F[1], _F[2]], latched, woke };
}
