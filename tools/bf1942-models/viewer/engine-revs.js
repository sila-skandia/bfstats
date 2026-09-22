// The engine's gearbox: the rev state, the two authored curves, and the load.
//
// `PhysicsEngine::updatePhysics` (`0x0824cbb0`) does NOT read the pedal. The
// `throttle` in its thrust law
//
//     e = throttle - rho*(v.fwd)/setNoPropellerEffectAtSpeed
//     K = 0.1*|throttle| + e*|e|
//
// is `PhysicsEngine+0xa0` — read at `0x0824cf4b` (`fsubr [edi+0xa0]`) and again
// at `0x0824cf5d` for the `0.1*|throttle|` term — and `+0xa0` is written in
// exactly one place: `Engine::handleUpdate` (`0x0823e120`), the gearbox
// (ledger TANK-12, `subsystems/tank-driving.md` §4). So a pedal pressed to the
// floor does not give the thrust law a 1.0; it gives it a first-order rev state
// that has to spool, is dragged down by a **load feedback**, and saturates at
// 1.2 rather than 1.0.
//
// This module is that state machine and the two curves it needs, with no
// three.js and no DOM, so `tests/engine_revs_harness.mjs` runs the real thing
// under node.
//
// --- the filter (TANK-12, `0x0823e2bf`-`0x0823e2e4`) -------------------------
//
//     revs += 0.05 * ((T1 - L) - 0.5*revs)          clamped to [-1.0, +1.2]
//
// `0.05` is `ds:0x86c08a8` and it is **per call, not per second** — the only
// uses of `dt` in the whole function are the gear-change lockout's
// `fdiv [esi+0x374]` and three `calculateAndClipAngle` calls — so the time
// constant is 40 engine ticks whatever the tick rate is. The clamp arms are
// `ds:0x86c4f64` = 1.2f and `ds:0x86b05ec` = -1.0f, and both are
// type-independent: a ship saturates at 1.2 exactly as a tank does.
//
// `T1` is **not** the pedal either: `0x0823e1e0`-`0x0823e1f4` builds it as
// `Engine+0x10c / getMaxRotation().z`, the *clipped* `RotationalBundle` roll
// angle over `maxRotation.z`. For `Fletcher_Engine` (`setMinRotation 0/0/-4000`,
// `setMaxRotation 0/0/5000`, `setMaxSpeed 0/0/5000`) that is +1.0 ahead and
// **-0.8** astern, reached in a second — which is where `ship.js`'s
// `throttleMin` comes from.
//
// --- the load (TANK-13, `PhysicsEngine::feedbackLoop` `0x0824c850`) ----------
//
//     L0 = dot(force, dir) * getCurrentRatio() / getCurrentTorque()
//     L  = 0.99 * (L*n + L0) / (n + 1)        // n = +0xac, the per-tick count
//
// with `0.99` at `ds:0x86d0cdc` and the count's `+1.0` at `ds:0x86ba8d4`.
// `Engine::handleUpdate` clears `+0xa4` (L) and `+0xac` (n) at its tail
// (`0x0823e3fd` / `0x0823e407`) after using them, so the L the filter sees is
// the previous tick's accumulation — which is the order this module's callers
// must keep.
//
// **For a ship, `L0` is the thrust, not the wheel slip.** `tank-driving.md` §4
// gives `L0 = dot(v, fwd)*ratio/torque`, which is right for the ground-vehicle
// caller (`ResponsePhysics::addFriction` `0x0825bc45`, which passes a friction
// velocity change). A ship's `feedbackLoop` caller is
// `PhysicsEngine::updatePhysics` itself, at `0x0824cfc1`: the by-value `Vec3`
// it pushes is `K*fwd` (built at `0x0824cf7e`-`0x0824cfa0`, each component
// multiplied by `[ebp-0xa0]` = K) and the `const Vec3&` is `fwd` itself
// (`lea ebx,[ebp-0x28]` at `0x0824cf07`, the transform's own row 2), so the dot
// is `K` and
//
//     L0 = K * getCurrentRatio() / getCurrentTorque()
//
// A ship's engineType has bits 1 and 2 clear (`c_ETShip = 9`), so it takes
// neither the `& 2` clamp (`0x0824c8ab`) nor the `& 4` frame min/max
// (`0x0824c90f`) — it takes the running mean at `0x0824c952`.
//
// That single term is what holds a destroyer down to a destroyer's speed: at
// full pedal a Fletcher's revs settle near 0.46, not 1.0, and settle lower the
// faster she goes, because K climbs with `e` and L climbs with K.
//
// --- the curves (TANK-3/TANK-4, `subsystems/tank-driving.md` §3) -------------
//
// Both are `OverTimeDistribution`s: 101 floats, filled 1.0 by the constructor,
// then a handful of authored control points each followed by
// `generateDistribution` (`0x081e7830`), which linearly fills the slots between
// consecutive authored indices and holds the last value flat to the end.
// `getCurrentRatio` (`0x0824ca70`) samples the ratio curve at
// `100*gear/numberOfGears`; `getCurrentTorque` (`0x0824cb10`) samples the
// torque curve at `100*min(|revs|, 1)`, a different index — its own sampler,
// not the gear.

/** `ds:0x86c08a8`, the filter gain — per engine tick, not per second. */
export const REV_GAIN = 0.05;

/** The `0.5*revs` self-damping term, `ds:0x86b05e8`. */
export const REV_DAMP = 0.5;

/** `ds:0x86c4f64`: revs saturate above 1.0, at 1.2. */
export const REV_MAX = 1.2;

/** `ds:0x86b05ec`. */
export const REV_MIN = -1.0;

/** `ds:0x86d0cdc`: the load mean's own decay. */
export const LOAD_DECAY = 0.99;

/** `getCurrentRatio`'s numerator multiplier on `setDifferential`, `ds:0x86d0ce0`. */
export const RATIO_SCALE = 3.5;

/** `EngineTemplate::EngineTemplate` defaults `numberOfGears` (`tmpl+0x360`) to
 *  **1** (`0x0823f018` / `0x0823f288`, `mov DWORD PTR [ebx+0x360],0x1`), and
 *  `setNumberOfGears` clamps to [1, 5]. No vanilla ship authors the word, so
 *  every ship samples the ratio curve at index 100 forever. */
export const DEFAULT_GEARS = 1;

/** `PhysicsEngine`'s ctor seeds the gear to 1 (`0x0824c770`). */
export const DEFAULT_GEAR = 1;

const CURVE_SLOTS = 101;

/**
 * An `OverTimeDistribution` as the constructor plus `generateDistribution`
 * leaves it: `fill` everywhere, then straight lines between the authored
 * indices, then flat past the last one.
 *
 * Slot 0 counts as an anchor at `fill` when it is not authored, which is what
 * makes the ratio curve ramp 1.0 -> 3.5 across indices 0-20 rather than sit
 * flat there (tank-driving.md §3: "Index 0 of the ratio curve is not authored,
 * so slots 0-20 ramp from the constructor's default 1.0 up to 3.5").
 *
 * @param {Record<number, number>} points authored index -> value
 * @param {number} fill the constructor's default
 */
export function distribution(points, fill = 1) {
  const curve = new Array(CURVE_SLOTS).fill(fill);
  const values = new Map();
  for (const key of Object.keys(points)) values.set(Number(key), points[key]);
  if (!values.has(0)) values.set(0, fill);
  const anchors = [...values.keys()].sort((a, b) => a - b);
  for (let k = 0; k < anchors.length; k++) {
    const lo = anchors[k];
    curve[lo] = values.get(lo);
    const hi = anchors[k + 1];
    if (hi === undefined) {
      for (let j = lo; j < CURVE_SLOTS; j++) curve[j] = values.get(lo);
      break;
    }
    const a = values.get(lo), b = values.get(hi);
    for (let j = lo; j <= hi; j++) curve[j] = ((hi - j) * a + (j - lo) * b) / (hi - lo);
  }
  return curve;
}

/** `tmpl+0x378`. Authored 20:3.5, 40:2.2, 60:1.5, 80:1.1, 100:0.94. */
export const RATIO_CURVE = distribution({ 20: 3.5, 40: 2.2, 60: 1.5, 80: 1.1, 100: 0.94 });

/** `tmpl+0x1b8`. Authored 0:0.70, 10:0.80, 30:0.90, 60:1.00, 85:0.85, 100:0.70 —
 *  peak at 60% revs, 70% of peak at both ends. */
export const TORQUE_CURVE = distribution(
  { 0: 0.70, 10: 0.80, 30: 0.90, 60: 1.00, 85: 0.85, 100: 0.70 });

/**
 * One curve read, the way both samplers do it: truncate toward zero, lerp with
 * the next slot.
 *
 * The engine reads `curve[i]` and `curve[i+1]` unguarded — at index 100 the
 * second read is off the end of the array, and is harmless only because its
 * weight is exactly zero. Clamped here rather than reproduced.
 */
export function sampleCurve(curve, index) {
  const clamped = Math.max(0, Math.min(CURVE_SLOTS - 1, index));
  const i = Math.trunc(clamped);
  const frac = clamped - i;
  const hi = curve[Math.min(i + 1, CURVE_SLOTS - 1)];
  return (1 - frac) * curve[i] + frac * hi;
}

/**
 * `PhysicsEngine::getCurrentRatio()` (`0x0824ca70`).
 *
 * `3.5 * setDifferential / ratioCurve[100 * gear / numberOfGears]`. With the
 * shipped default of one gear the index is 100 and the divisor is 0.94, so a
 * Fletcher's `setDifferential 2` is `3.5*2/0.94 = 7.4468` at every rev — the
 * value is constant for a ship, and the corpus's "rev-dependent" note is a
 * mislabelling of `PhysicsEngine+0xbc`, which TANK-12 and physics.md §5 both
 * read as the **gear**, not the rev.
 */
export function currentRatio(differential, gear = DEFAULT_GEAR, gears = DEFAULT_GEARS) {
  const n = gears > 0 ? gears : DEFAULT_GEARS;
  return RATIO_SCALE * differential / sampleCurve(RATIO_CURVE, (gear / n) * 100);
}

/**
 * `PhysicsEngine::getCurrentTorque()` (`0x0824cb10`).
 *
 * `torqueCurve[100 * min(|revs|, 1)] * setTorque`. It is the **divisor of the
 * load** (TANK-13), never a multiplier on drive force, so the curve's dip at
 * both ends *adds* load feedback rather than removing power.
 */
export function currentTorque(setTorque, revs) {
  return sampleCurve(TORQUE_CURVE, 100 * Math.min(Math.abs(revs), 1)) * setTorque;
}

/**
 * One tick of `Engine::handleUpdate`'s rev filter, clamped.
 *
 * @param {number} revs `PhysicsEngine+0xa0` as it stands
 * @param {number} t1 the clipped roll angle over `maxRotation.z`
 * @param {number} load `PhysicsEngine+0xa4`, last tick's accumulation
 */
export function revStep(revs, t1, load = 0) {
  const next = revs + REV_GAIN * ((t1 - load) - REV_DAMP * revs);
  return Math.max(REV_MIN, Math.min(REV_MAX, next));
}

/**
 * `revStep` run `ticks` times, for a caller whose tick is not the engine's.
 *
 * The filter is affine in `revs`, so the closed form is exact and fractional
 * ticks are meaningful: `revs -> target + (revs - target)*(1 - 0.025)^n` with
 * `target = 2*(T1 - L)`. The clamp is applied after, which matches the engine
 * whenever the target is inside the arms and is the only sane reading when it
 * is not.
 */
export function revAdvance(revs, t1, load = 0, ticks = 1) {
  if (!(ticks > 0)) return revs;
  const target = (t1 - load) / REV_DAMP;
  const decay = (1 - REV_GAIN * REV_DAMP) ** ticks;
  const next = target + (revs - target) * decay;
  return Math.max(REV_MIN, Math.min(REV_MAX, next));
}

/**
 * One `feedbackLoop` sample folded into the per-tick load mean
 * (`0x0824c952`-`0x0824c97e`).
 *
 * @param {number} load the mean so far, `+0xa4`
 * @param {number} count the samples so far, `+0xac`
 * @param {number} l0 this sample
 */
export function loadSample(load, count, l0) {
  return LOAD_DECAY * (load * count + l0) / (count + 1);
}
