// An aircraft torpedo, once it is in the water.
//
// The only genuinely new mechanic in the plane secondary. A bomb is a shell
// that falls, which `gunfire.js` already integrates; a torpedo is a body that
// enters the sea without detonating, floats itself to a running depth, levels
// out and drives straight ahead until its 20 s `timeToLive` expires. Every term
// below comes from `AircraftTorpedo`'s five physics children, which reach the
// viewer for the first time this round as `spec.parts`:
//
//   Torpedo_Floater  FloatingBundle  x2 at 0/3/-2 and 0/3/2,
//                                    hullHeight 4.3, floatMin/MaxLift 5.9
//   Torpedo_Engine   Engine          c_ETTorpedo, torque 12.5, differential 5,
//                                    noPropellerEffectAtSpeed 120
//   Torpedo_Wing     Wing            x2, wingLift 0.2, one rolled -90
//
// Corpus: `features/bf1942-engine-reference/subsystems/bombs-and-torpedoes.md`
// section 4, ledger BOMB-11 and BOMB-12. Build record and the measured run:
// `features/plane-bombs-and-torpedoes/BUILD.md`.
//
// **There is no guidance and no homing.** `Torpedo_Engine` binds only
// `c_PIThrottle`, with `setAutomaticReset 1` and no steering axis at all
// (BOMB-12), so a torpedo runs on the heading it entered the water at and
// "it targets ships" is the pilot's aim, not the weapon's. Nothing in this file
// turns it.
//
// Deliberately free of `three` and of `flight.js` (which pulls the GLTFLoader)
// so `tests/bomb_release_harness.mjs` can step it under node.

import { GRAVITY } from './physics.js';
import { dragAcceleration } from './bomb-release.js';

/**
 * Gravity's normaliser for a force the data expresses "in units of gravity".
 *
 * `PhysicsFloatingBundle::updatePhysics` (lnxded `0x0824d640`) divides its lift
 * by the constant at `0x086d0d6c`, which is **-9.82** -- the same normalisation
 * `PhysicsSpring::updatePhysics` applies to `setStrength` and that
 * `flight.js` already carries as `GRAVITY_NORMALISER`. The engine runs at
 * -14.73 m/s^2, so an authored lift is multiplied by 14.73/9.82 = 1.49995
 * before it opposes gravity. Read 2026-09-22, this round; it is the difference
 * between a torpedo that floats and one that sinks (2 x 5.9 = 11.8 against a g
 * of 14.73 sinks; 2 x 5.9 x 1.49995 = 17.70 floats).
 */
export const LIFT_NORMALISER = Math.abs(GRAVITY) / 9.82;

/**
 * The band the wake plays in, metres below the surface.
 *
 * `e_WaterTorpedo`'s own gate: `minDistanceUnderwaterSurface 0` /
 * `maxDistanceUnderwaterSurface 50` on the EffectBundle
 * (`Objects/Effects/e_WaterTorpedo/Effects.con`). It doubles as the engine's
 * own "am I running in water" test, so it is what `running` reports.
 */
export const WAKE_MIN_DEPTH = 0;
export const WAKE_MAX_DEPTH = 50;

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `3.5 * differential / 0.94`.
 *  The same two constants `flight.js` derives and documents (gear is 1 for the
 *  life of every object in the game and `numberOfGears` defaults to 1, so the
 *  gear-ratio curve is always sampled at 100). */
const ENGINE_RATIO_SCALE = 3.5;
const GEAR_RATIO = 0.94;

/** `0.1 * |throttle|`: the part of propeller thrust that does not fade. */
const ENGINE_IDLE = 0.1;

/** A submerged surface makes ten times the lift. `PhysicsWing::updatePhysics`,
 *  the same `SUBMERGED_MEDIUM` `flight.js` carries for a ship's rudder. */
const SUBMERGED_MEDIUM = 10;

/** `calculateLift`'s trailing scale, and the small-angle slope of its
 *  coefficient curve, both off `flight.js`'s derivation of
 *  `PhysicsWing::updatePhysics`. Written out here rather than imported because
 *  `flight.js` drags in the GLTFLoader and this module is stepped under node. */
const LIFT_SCALE = 0.0025;
const DEG = 180 / Math.PI;

/** Fixed sub-steps per frame. The buoyancy spring is stiff -- two floaters over
 *  a 4.3 m hull height is 4.1 m/s^2 per metre of depth error, a 3.1 s period --
 *  and a 0.1 s frame integrated in one go rings. Four, matching the engine's
 *  own positional integrator (`0x00578aa0`). */
const SUBSTEPS = 4;

/** The engine's own `Vec3` surface, as much of it as `calculateLift` asks for.
 *  Plain objects so nothing here needs `three`. */
function length(v) { return Math.hypot(v.x, v.y, v.z); }

/**
 * The parts of a projectile that matter to a water run, sorted by class.
 *
 * `spec.parts` is every `Wing`, `FloatingBundle` and `Engine` the projectile
 * declares as an `addTemplate` child, with its placement and its own physics
 * words. A round with no parts -- which is every round in the game but the
 * torpedo and the three bombs -- yields empty lists and `isTorpedo` false.
 */
export function runParts(spec) {
  const parts = Array.isArray(spec?.parts) ? spec.parts : [];
  const of = kind => parts.filter(
    part => String(part.kind || '').toLowerCase() === kind);
  const floaters = of('floatingbundle');
  const engines = of('engine');
  const wings = of('wing');
  return { floaters, engines, wings, isTorpedo: floaters.length > 0 };
}

/**
 * Buoyancy from one `FloatingBundle`, m/s^2 upward.
 *
 * `PhysicsFloatingBundle::updatePhysics` (lnxded `0x0824d640`) forms a
 * submersion ratio from the floater's own world height against the template's
 * `hullHeight` (read at `+0x1b4` at `0x0824d704`), clamps it to the unit
 * interval (`fld1` at `0x0824d720`, `fldz` at `0x0824d73b` and `0x0824d74c`,
 * `-1.0` at `0x0824d763`), lerps the lift between `floatMinLift` and
 * `floatMaxLift` over it (`0x0824d77e`-`0x0824d79e`; the two values are copied
 * from the template into the physics node at `0x082410c5`-`0x082410e0`) and
 * divides the product by the constant at `0x086d0d6c`, which is **-9.82**.
 *
 * That divisor is the whole reason this function exists rather than returning
 * the authored number. An authored lift is expressed in units of a 9.82 m/s^2
 * gravity while the engine runs at -14.73, so it is scaled by 1.49995 before it
 * opposes gravity -- and for the torpedo that is the difference between
 * floating and sinking: two floaters at the authored 5.9 give 11.8 against a g
 * of 14.73 and it goes to the bottom, while 2 x 5.9 x 1.49995 = 17.70 holds it
 * up. Read this round; ledger BOMB-12 had `dragModifier` open and said nothing
 * about the normalisation.
 *
 * `setDragModifier 8000.0` is **not** modelled, and that is a finding rather
 * than an omission: the word is stored at `FloatingBundleTemplate+0x1c0`
 * (`setDragModifier`, `0x08241070`) and the only two reads of that offset in
 * the entire dedicated server are inside `FloatingBundleTemplate::makeScript`
 * (`0x08240d3a` and `0x08240d6c`), the serializer that echoes it back out.
 * `setPhysicsNodeComponent` copies `floatMaxLift` and `floatMinLift` into the
 * physics node and does not copy this one. It is write-only data. That settles
 * O-7 in the build record: the answer is "neither above nor below water".
 */
export function floaterLift(floater, submersion) {
  const hull = floater?.hullHeight;
  if (!(hull > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, submersion / hull));
  const min = floater.floatMinLift ?? 0;
  const max = floater.floatMaxLift ?? min;
  return ratio * (min + (max - min) * ratio) * LIFT_NORMALISER;
}

/**
 * `PhysicsWing::updatePhysics`'s lift, m/s^2, to be applied along -surfaceUp.
 *
 * Verbatim the expression `flight.js::calculateLift` documents: a coefficient
 * curve that peaks at 1.0 at 22.5 degrees of incidence and is hard zero past
 * +-45 (the engine's entire stall model), times the SQUARE of the flow speed,
 * times the surface's coefficient, times 0.0025.
 */
function wingLift(flow, upX, upY, upZ, coeff) {
  const len = length(flow);
  if (len === 0) return 0;
  const s = Math.min(1, Math.max(-1,
    (flow.x * upX + flow.y * upY + flow.z * upZ) / len));
  const a = Math.asin(s) * DEG;
  const c = Math.abs(a) >= 45 ? 0
    : a >= 0 ? a * (45 - a) / 506.25 : a * (45 + a) / 506.25;
  return (0.75 * c + 0.25 * s) * len * len * coeff * LIFT_SCALE;
}

/**
 * One aircraft torpedo running in water.
 *
 * Entered from `GunFire`'s projectile loop on the first water contact that
 * `detonateOnWaterCollision` does not detonate, and it replaces the ballistic
 * step from then on. The shot's position and velocity stay the shot's: `step`
 * mutates both in place, the way `FuseRoundBody.step` does, so the collision
 * sweep and the drawn mesh above it need no new contract.
 *
 * What is modelled, and what is not:
 *
 *  - **Depth.** Gravity against the floaters' buoyancy is a spring, and the
 *    torpedo settles where they balance. Two floaters 3 m ABOVE the body centre
 *    over a 4.3 m hull height balance a g of 14.73 at a submersion ratio of
 *    0.832, i.e. 3.58 m of floater depth, i.e. the body centre 6.58 m down.
 *    That is arithmetic from the data, not a tuned number.
 *  - **Levelling.** The horizontal `Torpedo_Wing` damps the vertical
 *    oscillation of that spring: a torpedo sinking through the water meets the
 *    flow at a negative incidence and the wing pushes back, which at 70 m/s and
 *    `wingLift 0.2 x SUBMERGED_MEDIUM` is a damping of about 2 per (m/s)
 *    against a natural frequency of 2.03 rad/s -- so it settles inside one
 *    cycle instead of porpoising for its whole run.
 *  - **Drag**, from the round's own `mass 800` / `drag 0.04` with PHY-7's 25x
 *    submerged scale.
 *  - **Thrust**, from the `c_ETTorpedo` engine. See `#thrust`.
 *
 *  - NOT modelled: the fore/aft floater COUPLE. The two floaters sit at z -2
 *    and +2, so a nose-down torpedo gets more lift at the deeper end and pitches
 *    up; that is a rigid-body moment and this round has no inertia tensor.
 *    Their lift is summed at the body centre instead, which is exact at
 *    equilibrium (they are symmetric in z) and understates the recovery from a
 *    steep entry. The drawn body still noses along its velocity, so the picture
 *    follows the levelling that IS modelled.
 *  - NOT modelled: the vertical `Torpedo_Wing` (the one rolled -90). With no
 *    lateral disturbance to resist it would contribute nothing.
 */
export class TorpedoRun {
  /**
   * @param {object} spec the round's projectile spec, with `parts`
   * @param {number} waterLevel world y of the sea surface
   * @param {number} boundingRadius the drawn body's own, for the drag law
   */
  constructor(spec, waterLevel, boundingRadius = 1) {
    const { floaters, engines, wings } = runParts(spec);
    this.spec = spec;
    this.waterLevel = waterLevel;
    this.boundingRadius = boundingRadius;
    this.floaters = floaters;
    this.wings = wings;
    // Thrust is the sum over the engines, which for the torpedo is one.
    this.engines = engines.filter(
      engine => String(engine.engineType || '').toLowerCase() === 'c_ettorpedo');
    // Every wing's `setWingLift` (plus `setFlapLift`, which a torpedo's has
    // none of), normalised the same way a floater's lift is. Only the
    // horizontal pair is used -- see the class comment.
    this.wingCoeff = wings.length
      ? ((wings[0].wingLift ?? 0) + (wings[0].flapLift ?? 0)) * LIFT_NORMALISER
      : 0;
    this.depth = 0;
    this._drag = { x: 0, y: 0, z: 0 };
  }

  /** True while the torpedo is in the band the wake plays in, which is also the
   *  engine's own "running in water" test. */
  get running() {
    return this.depth >= WAKE_MIN_DEPTH && this.depth <= WAKE_MAX_DEPTH;
  }

  /**
   * Thrust along the torpedo's own forward, m/s^2.
   *
   * `PhysicsEngine::updatePhysics`'s propeller expression, the same one
   * `flight.js` applies to every aircraft:
   *
   *     e = throttle - (v . fwd) / setNoPropellerEffectAtSpeed
   *     a = (0.1*|throttle| + e*|e|) * 3.5 * setDifferential / 0.94
   *
   * with the throttle pinned at **1.0**: `Engine::handleUpdate` (`0x0823e120`)
   * tests the engine type's bit 4 at `0x0823e16e` (`and eax,0x10`) and, when it
   * is set, stores `1.0f` into the throttle field at `0x0823e179`
   * (`mov DWORD PTR [edi+0x124],0x3f800000`). `c_ETTorpedo` is 0x19, so bit 4
   * is set and a torpedo is always at full throttle. There is no throttle
   * input, which is consistent: nobody is driving it.
   *
   * The air-density term `flight.js` carries is dropped, not forgotten: it is
   * `1 - clamp(y/1000, 0, 1)` and a torpedo runs at y ~ 0, where it is 1.
   *
   * **This is the number most likely to be wrong in this file, and it is
   * reported as such.** Taken straight, the expression's terminal speed is
   * where `0.1 + e|e| = 0`, i.e. `e = -sqrt(0.1)` and
   * `v = 120 x 1.3162 = 158 m/s` -- a torpedo that outruns the aircraft that
   * dropped it. The same arithmetic on a Corsair (`fadeSpeed 70`, the same
   * `differential 5`) gives 92 m/s, which is that plane's real top speed, so
   * the law is calibrated and it is the torpedo's own 120 that is generous.
   * Two links are unread and either could cap it: whether
   * `PhysicsEngine::updatePhysics` has a water medium factor the way
   * `PhysicsWing` has its `SUBMERGED_MEDIUM 10`, and whether a `Projectile`'s
   * child `Engine` is stepped at all (`Projectile::handleUpdate` `0x0831e940`
   * walks no children; the composite dispatcher was not read). The `& 0x10`
   * throttle pin exists specifically for rocket and torpedo engines, which is
   * the argument that it does run.
   */
  #thrust(velocity, fx, fy, fz) {
    let accel = 0;
    const along = velocity.x * fx + velocity.y * fy + velocity.z * fz;
    for (const engine of this.engines) {
      const fade = engine.noPropellerEffectAtSpeed;
      const differential = engine.differential;
      if (!(fade > 0) || !(differential > 0)) continue;
      const e = 1 - along / fade;
      accel += (ENGINE_IDLE + e * Math.abs(e))
        * ENGINE_RATIO_SCALE * differential / GEAR_RATIO;
    }
    return accel;
  }

  /** Total buoyancy at a body-centre depth, m/s^2 upward. */
  buoyancy(depth) {
    let lift = 0;
    for (const floater of this.floaters) {
      // The floater's own depth: it sits `position[1]` metres up the body's own
      // up axis, and a near-level torpedo's up axis is the world's.
      lift += floaterLift(floater, depth - (floater.position?.[1] ?? 0));
    }
    return lift;
  }

  /**
   * One frame. Mutates `position` and `velocity` in place; returns the distance
   * travelled, for the caller's trail spacing and collision sweep.
   */
  step(dt, position, velocity) {
    const h = dt / SUBSTEPS;
    let travelled = 0;
    for (let i = 0; i < SUBSTEPS; i++) {
      this.depth = this.waterLevel - position.y;
      const speed = length(velocity);
      let fx = 0, fy = 0, fz = -1;
      if (speed > 1e-6) {
        fx = velocity.x / speed; fy = velocity.y / speed; fz = velocity.z / speed;
      }
      let ax = 0, ay = GRAVITY, az = 0;
      if (this.depth > 0) {
        ay += this.buoyancy(this.depth);
        // The horizontal wing, its normal world up. `calculateLift` returns a
        // push along -up, so a torpedo sinking (flow arriving from below,
        // s < 0) gets a positive push upward.
        if (this.wingCoeff) {
          ay -= wingLift(velocity, 0, 1, 0,
                         this.wingCoeff * SUBMERGED_MEDIUM);
        }
        const thrust = this.#thrust(velocity, fx, fy, fz);
        ax += thrust * fx; ay += thrust * fy; az += thrust * fz;
      }
      // Submersion for the drag law is the depth of the body itself, clamped at
      // the bounding radius by `DRAG_SUBMERSION_SCALE`'s own min().
      dragAcceleration(this.spec, velocity, this.boundingRadius,
                       Math.max(0, this.depth), this._drag);
      ax += this._drag.x; ay += this._drag.y; az += this._drag.z;
      velocity.x += ax * h; velocity.y += ay * h; velocity.z += az * h;
      const dx = velocity.x * h, dy = velocity.y * h, dz = velocity.z * h;
      position.x += dx; position.y += dy; position.z += dz;
      travelled += Math.hypot(dx, dy, dz);
    }
    this.depth = this.waterLevel - position.y;
    return travelled;
  }
}
