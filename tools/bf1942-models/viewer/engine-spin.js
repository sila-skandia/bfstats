// What an Engine does to its visible rotor or propeller, once per tick.
//
// `PhysicsEngine::updatePhysics` (lnxded `0x0824cbb0`) ends in the same few
// lines for every engine that passes its type gate (`getEngineType() & 1`:
// `c_ETPlane` and `c_ETRocket`, never a car or a tank), above or below the
// water, with or without anyone aboard (ledger PHY-30):
//
//   child = the Engine's FIRST child, when it is a LodObject (ILodObject,
//           IID `0xc4e0`; `ICompositeObject` vt `+0x7c` is `getChild`)
//   child's selector.setLodSelectorCompareValue(|revs|)   0x0824cd0e / 0x0824cd17
//   alt   = the LodObject's current alternative           vt +0x28, 0x0824cd42
//   M     = alt's transformation                          vt +0x40 / +0x74
//   roll(M, revs * 20)      when |revs| >= 0.08           0x0824cdea (`0x86c0314`)
//   roll(M, revs * 400)     when |revs| <  0.08           0x0824cd45 (`0x86cfae4`)
//   setTransformation(alt, M)                             0x0824cdc3
//
// the split is the double `0x86d0cf8` = 0.08, compared at `0x0824cd2f`.
//
// `roll<float>` (`0x08061df0`) is `rotateAboutLine(M, row 2, angle)` with the
// angle in DEGREES: the alternative turns about its OWN Z axis, a fixed step
// each engine tick (30 Hz, LOOP-1), cumulatively. There is no clock and no
// throttle in it: the only input is the rev state `PhysicsEngine+0xa0`, which
// `Engine::handleUpdate` filters toward `2 * (T1 - L)` and clamps to
// [-1, 1.2] (TANK-12), and which is held at 0 while `Engine+0x142` is clear
// (nobody aboard, or critical damage: PHY-14).
//
// The alternative that is current is the LodObject's own selector's answer.
// A `CompareSelector` (every propeller and rotor pair, 59 across the mods)
// SQUARES each `addLodComparison` when it is built (`CompareLodSelector::init`
// `0x08212cf0`: `fmul st(0), st(0)` before the vector store) and looks the
// stored compare value up with `lower_bound` (`0x08212d80`), which is not
// squared. So alternative 1, the blurred disc, is current when
// `|revs| > comparison^2`, strictly: 0.0049 for the 0.07 every vanilla
// propeller declares, 0.25 for the Flettner's 0.5.

/** The engine's tick: `g_simulationFps`, LOOP-1. */
export const ENGINE_TICK_HZ = 30;

/** `|revs|` at and above which the slow factor applies (`0x0824cd0f`). */
export const SPIN_SPLIT = 0.08;
/** Degrees a tick per unit of revs at and above `SPIN_SPLIT` (`0x0824cd20`). */
export const SPIN_SLOW = 20;
/** Degrees a tick per unit of revs below `SPIN_SPLIT` (`0x0824cd6a`). */
export const SPIN_FAST = 400;

/**
 * How far the current alternative turns about its own Z axis in one engine
 * tick, degrees. Signed with the revs.
 */
export function spinDegreesPerTick(revs) {
  const r = Number.isFinite(revs) ? revs : 0;
  return Math.abs(r) >= SPIN_SPLIT ? r * SPIN_SLOW : r * SPIN_FAST;
}

/**
 * Whether a `CompareSelector` named `comparison` (the value `addLodComparison`
 * wrote, as the glb's `propellerBlur.comparisons[0]` carries it) answers its
 * second alternative, the blurred disc, for these revs.
 */
export function discAt(revs, comparison) {
  const c = Number.isFinite(comparison) ? comparison : 0;
  const r = Number.isFinite(revs) ? revs : 0;
  return Math.abs(r) > c * c;
}

/**
 * The roll axis of an Engine that binds no input, as `calculateAndClipAngle`
 * (GUN-2) sees it, or null when the engine never runs that call.
 *
 * `Engine::handleUpdate` (`0x0823e120`) runs the servo for an axis only when
 * the template's `maxSpeed` component is non-zero (`0x0823e18e`, `0x0823e1a4`,
 * `0x0823e1be` test `tmpl+0x174/0x178/0x17c`). An unbound engine has input 0,
 * so the angle goes nowhere by the law, and then the clip to `[min, max]`
 * moves it: an engine whose two bounds are equal sits ON that bound, `T1` =
 * `bound / maxRotation.z` = 1. A template that leaves `setAcceleration` out has
 * the `RotationalBundleTemplate` default 0.1 (`0x081d90c0`); only an explicit
 * 0 takes GUN-2's early return and never clips.
 *
 * @param {object} physics the Engine node's `extras.physics`
 * @returns {{input: null, min: number, max: number, free: false,
 *            maxSpeed: number, direction: number, acceleration: number,
 *            continuousRotation: number, automaticReset: boolean} | null}
 */
export function unboundRollAxis(physics) {
  if (!physics || !Array.isArray(physics.maxRotation)) return null;
  const max = physics.maxRotation[2];
  const maxSpeed = Array.isArray(physics.maxSpeed) ? physics.maxSpeed[2] : null;
  // An asset extracted before `minRotation` was exported cannot say where the
  // span's floor is, and an open span is the common case (the Stuka circles'
  // dummy engine). Nothing spins on a guess.
  if (!Array.isArray(physics.minRotation) || !Number.isFinite(max)) return null;
  if (!maxSpeed) return null;
  const accel = Array.isArray(physics.acceleration) ? physics.acceleration[2] : undefined;
  return {
    input: null,
    min: physics.minRotation[2] ?? 0,
    max,
    free: false,
    maxSpeed,
    direction: 1,
    acceleration: Math.abs(accel ?? UNDECLARED_ACCELERATION),
    continuousRotation: 0,
    automaticReset: !!physics.automaticReset,
  };
}

/** `RotationalBundleTemplate`'s `setAcceleration` default (`0x081d90c0`). */
export const UNDECLARED_ACCELERATION = 0.1;
