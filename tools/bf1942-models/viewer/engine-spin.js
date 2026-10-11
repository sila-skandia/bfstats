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

import * as THREE from 'three';

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

// --- a propeller / rotor pair, as the page holds it -------------------------

/** A node name's match key: lowercased, with the scene document's
 *  duplicate-instance suffix dropped (`Flettner_Rotary_Static_1` is the
 *  stamp's `Flettner_Rotary_Static`). */
export const lodNodeKey = name => String(name || '').toLowerCase().replace(/_\d+$/, '');

/**
 * The Engine node a propeller/rotor LodObject hangs under, else null. The
 * retail tail turns the Engine's FIRST child when it is a LodObject, so a
 * LodObject that is not the first one carrying a propeller stamp is not
 * turned. Every pair of bf1942, XPack1, XPack2 and Desert Combat is that first
 * child (`.con` survey, 2026-10-11), bound to an input or not.
 */
export function engineOfLodPair(lod) {
  const engine = lod.parent;
  if (!engine || engine.userData?.templateKind !== 'Engine') return null;
  const first = engine.children.find(child => child.userData?.propellerBlur);
  return first === lod ? engine : null;
}

// A rotor alternative's authored rest rotation, by node: captured the first
// time the node is seen, so a re-collected pair (the cockpit graft) never
// reads a spun pose as its rest.
const restPoses = new WeakMap();
function restOf(node) {
  let rest = restPoses.get(node);
  if (!rest) {
    rest = node.quaternion.clone();
    restPoses.set(node, rest);
  }
  return rest;
}

/** The state a pair carries for the tail: each alternative's rest and turn. */
export function lodSpinState(staticNode, blurredNode) {
  return {
    staticRest: restOf(staticNode),
    blurredRest: restOf(blurredNode),
    staticAngle: 0,
    blurredAngle: 0,
    revs: undefined,
  };
}

/**
 * One frame of the tail for a pair: the rev state `revs` over `ticks` engine
 * ticks. Only the alternative the selector says is current turns (each keeps
 * the angle it reached). Updates `pair.revs`; the caller poses it
 * (`poseLodSpin`) and shows the current half (`discAt`).
 */
export function stepLodSpin(pair, revs, ticks) {
  pair.revs = revs;
  const turned = spinDegreesPerTick(revs) * Math.max(0, ticks);
  if (discAt(revs, pair.threshold)) pair.blurredAngle = (pair.blurredAngle + turned) % 360;
  else pair.staticAngle = (pair.staticAngle + turned) % 360;
}

const _spin = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 0, 1);

/** Rest rotation times a turn about the alternative's own Z. `roll`'s sign
 *  under the exporter's Z mirror is +1 (`SIGN.roll`). */
export function poseLodSpin(pair) {
  pair.static.quaternion.copy(pair.staticRest)
    .multiply(_spin.setFromAxisAngle(_axis, THREE.MathUtils.degToRad(pair.staticAngle)));
  pair.blurred.quaternion.copy(pair.blurredRest)
    .multiply(_spin.setFromAxisAngle(_axis, THREE.MathUtils.degToRad(pair.blurredAngle)));
}

/**
 * The revs a RUNNING engine settles at for a throttle-axis clip `t1`, with no
 * load (nothing resisting it): TANK-12's fixed point `2 * T1`, clamped to the
 * gearbox's [-1, 1.2]. What a parked engine shows with the pedal held at `t1`
 * (the model browser's "engine on").
 */
export function steadyRevs(t1) {
  const r = 2 * (Number.isFinite(t1) ? t1 : 0);
  return Math.max(-1, Math.min(1.2, r));
}
