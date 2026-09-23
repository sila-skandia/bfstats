// A land vehicle's engine and gearbox, as `PhysicsEngine` and
// `Engine::handleUpdate` run them: the engine-type bitfield, the gear-ratio
// and torque curves, the differential split, the EngineGrip contact-speed
// target, and `EngineState`, the rev filter both `GroundVehicle` and
// `TrackedVehicle` own. No geometry and no vehicle in it; the tracked-vehicle
// header in `tracked-vehicle.js` carries the TANK-3 reading this rests on.

import { ENGINE_TICK_HZ } from './ground-contact.js';

/** `PhysicsEngine::getCurrentRatio`, `0x0057bd90`: `ratio = 3.5 *
 * setDifferential / curve[idx]`. Declared again here (rather than imported)
 * because `flight.js` keeps its own copy private, the same way that file's
 * own gravity constant is "kept local... until physics.js... grows a shared
 * constants module". */
const ENGINE_RATIO_SCALE = 3.5;

/**
 * `setEngineType`'s enum, and it is a **bitfield** — re-derived from the
 * 26-entry jump table at `0x086cf7b0` that `operator<<(ostream&, EngineType)`
 * (`0x0823ef60`) switches on, each index matched to the case body that pushes
 * its string. `EngineTemplate::getEngineType()` is **virtual slot `+0xa0`**
 * (vtable `0x0872bd80`, vptr symbol+8 = `0x0872bd88`, slot → `0x0823fd00`),
 * which is why an exhaustive grep for direct `call` sites once found none and
 * ledger TANK-1 said nothing read it. There are nine call sites.
 *
 *   bit 0 (1)   propeller / thrust physics — the ONLY gate on
 *               `PhysicsEngine::updatePhysics`, which **returns at its second
 *               instruction** without it (`0x0824cc10`-`0x0824cc20`)
 *   bit 1 (2)   ground drivetrain: `feedbackLoop` clamps its load to [-1, +1]
 *   bit 2 (4)   differential steering, and the ±1 clamp that comes with it
 *   bit 3 (8)   thrust rather than propeller spin (ship, torpedo)
 *   bit 4 (16)  pinned throttle (rocket, torpedo)
 *
 * `c_ETCar` (2) and `c_ETTank` (6) both clear bit 0. **A ground vehicle gets
 * no hull thrust at all** — ledger TANK-7, refuted; `subsystems/
 * tank-driving.md` §5.
 */
export const ENGINE_TYPES = {
  c_etplane: 1, c_etcar: 2, c_ettank: 6,
  c_etship: 9, c_etrocket: 0x11, c_ettorpedo: 0x19,
};

/** `updatePhysics`'s gate: propeller/thrust physics. No ground vehicle. */
export const ENGINE_BIT_THRUST = 1;
/** `feedbackLoop` clamps its load sample to [-1, +1] (`0x0824c8ab`). */
export const ENGINE_BIT_LOAD_CLAMP = 2;
/** `getCurrentDifferentialRPM` splits and clamps per side (`0x0824c90f`). */
export const ENGINE_BIT_DIFFERENTIAL = 4;

/**
 * The bits an `engineType` name carries. **The `EngineTemplate` constructor's
 * own default is 0** (`0x0823f078 mov DWORD PTR [ebx+0x524],0x0`) — no bits,
 * so no `updatePhysics`, no differential and no load clamp — and an unknown
 * name has to read as that rather than as a guess. It costs nothing in the
 * installed corpus: **every one of the 1,309 ground-vehicle Engines across
 * the 18 installs authors `setEngineType`** (824 `c_ETTank`, 394 `c_ETCar`,
 * 91 `c_ETShip` on the amphibians' second engine), none leaves it unset.
 */
export function engineTypeBits(name) {
  return ENGINE_TYPES[String(name ?? '').toLowerCase()] ?? 0;
}

/**
 * `OverTimeDistribution::generateDistribution`, lnxded `0x081e7830`
 * (client twin `FUN_005094b0`), as `EngineTemplate::EngineTemplate`
 * `0x0823efc0` drives it: 101 slots, seeded to the constructor's default and
 * then filled **piecewise-linearly** between the authored control points.
 *
 *   v[j] = ((hi - j) * v[lo] + (j - lo) * v[hi]) / (hi - lo)   for j in lo..hi
 *
 * with two edge rules that both matter here:
 *
 *   - index 0 participates as a control point whether or not it is authored.
 *     The ratio curve does not author it, so slots 0..20 ramp from the ctor
 *     default 1.0 up to 3.5 — which is the whole reason the gear ladder is
 *     non-monotonic above five gears.
 *   - after the last authored index the value is held flat (the tail case at
 *     `0x081e78b8`). Moot for both curves below, which author index 100.
 *
 * THE CORRECTION THIS FUNCTION EXISTS TO CARRY (TANK-3, 2026-09-19): the
 * previous reading of this file had the curve as "1.0 everywhere except five
 * authored slots", which came from reading the constructor's default-fill loop
 * and the five stores and never following the eleven `CALL`s after them. That
 * model put the M3A1 at 17.5 and reduced every gear count but 1 and 5 to
 * exactly `3.5 * differential`. Both are wrong. Do not restore it.
 *
 * @param {Array<[number, number]>} points authored (index, value) pairs
 * @param {number} fallback the constructor's default, used for index 0 when
 *   the template does not author it
 */
function overTimeDistribution(points, fallback = 1.0) {
  const curve = new Array(101).fill(fallback);
  const authored = [...points].sort((a, b) => a[0] - b[0]);
  for (const [index, value] of authored) curve[index] = value;
  // Index 0 is always a knot; its value is whatever it already holds (the
  // authored one, or the ctor default).
  const knots = authored[0]?.[0] === 0 ? authored.map(p => p[0]) : [0, ...authored.map(p => p[0])];
  for (let n = 0; n < knots.length - 1; n++) {
    const lo = knots[n], hi = knots[n + 1];
    const span = hi - lo;
    for (let j = lo + 1; j < hi; j++) {
      curve[j] = ((hi - j) * curve[lo] + (j - lo) * curve[hi]) / span;
    }
  }
  const last = knots[knots.length - 1];
  for (let j = last + 1; j <= 100; j++) curve[j] = curve[last];
  return curve;
}

/**
 * `getCurrentRatio`'s curve (TANK-3). Control points 20 -> 3.5, 40 -> 2.2,
 * 60 -> 1.5, 80 -> 1.1, 100 -> 0.94; index 0 unauthored, so the first fifth of
 * it climbs from the constructor's 1.0. Sampled every ten slots it reads
 * 1.000 2.250 3.500 2.850 2.200 1.850 1.500 1.300 1.100 1.020 0.940.
 */
const GEAR_RATIO_CURVE = overTimeDistribution(
  [[20, 3.5], [40, 2.2], [60, 1.5], [80, 1.1], [100, 0.94]]);

/**
 * `getCurrentTorque`'s curve (TANK-4), a *different* 101-slot distribution at
 * a different offset, indexed by a normalised rev fraction rather than by the
 * gear. Control points 0 -> 0.70, 10 -> 0.80, 30 -> 0.90, 60 -> 1.00,
 * 85 -> 0.85, 100 -> 0.70: peak drive at 60 % revs, 70 % of peak at both ends.
 * Every ten slots: 0.700 0.800 0.850 0.900 0.9333 0.9667 1.000 0.940 0.880
 * 0.800 0.700.
 *
 * Its only caller is `PhysicsEngine::feedbackLoop`, which runs inside both
 * `updatePhysics` and `addFriction`. An earlier note in this corpus called it
 * "engine-sound RPM only"; that was never established and TANK-4 retired it.
 */
const ENGINE_TORQUE_CURVE = overTimeDistribution(
  [[0, 0.70], [10, 0.80], [30, 0.90], [60, 1.00], [85, 0.85], [100, 0.70]]);

/** Sample a 101-slot distribution at `t` in 0..100 the way both getters do:
 * truncate toward zero for the slot, lerp into the next one. */
function sampleDistribution(curve, t) {
  const x = t < 0 ? 0 : t > 100 ? 100 : t;
  const i = Math.min(100, Math.trunc(x));
  const frac = x - i;
  const lo = curve[i];
  const hi = curve[Math.min(100, i + 1)];
  return lo + (hi - lo) * frac;
}

/**
 * `PhysicsEngine::getCurrentRatio()`, lnxded `0x0824ca70` / client
 * `FUN_0057bd90` (TANK-3, re-read and corrected 2026-09-19):
 *
 *   idxf  = gear / numberOfGears * 100
 *   i     = trunc(idxf)                       // toward zero, the exe's _ftol
 *   ratio = 3.5 * differential / lerp(curve[i], curve[i+1], idxf - i)
 *
 * The 3.5 is a multiplier on `differential`, not a curve value and not a
 * divisor — it is numerically equal to `curve[20]`, which is exactly why a
 * five-speed's first gear comes out at the raw `differential`.
 *
 * Worked examples, all re-derived from the control points:
 *
 *   Sherman  `differential 4, numberOfGears 5`   4.000  6.364  9.333 12.727 14.894
 *   Willy    `differential 7, numberOfGears 5`   7.000 11.136 16.333 22.273 26.064
 *   M3A1     `differential 5, numberOfGears 4`   5.512  9.459 14.583 18.617
 *
 * The M3A1's first gear is **5.512**, not the 17.5 this file used to carry.
 *
 * @param {number} differential `setDifferential`
 * @param {number} [gear] 1-based; the engine seeds it to 1 and no code path
 *   read so far writes it again (TANK-7), so a tracked hull passes 1 — but the
 *   curve is indexed by it, so it is a parameter, not a folded constant.
 * @param {number} [numberOfGears] `setNumberOfGears`, default 1
 */
export function engineRatio(differential, gear = 1, numberOfGears = 1) {
  const gears = numberOfGears > 0 ? numberOfGears : 1;
  return (ENGINE_RATIO_SCALE * differential)
    / sampleDistribution(GEAR_RATIO_CURVE, (gear / gears) * 100);
}

/**
 * The whole ladder, gear 1..numberOfGears, for any gear count — installed mods
 * reach `numberOfGears 8` and `50`, and every one of those gears now gets a
 * real ratio instead of collapsing to `3.5 * differential`.
 *
 * **The ladder is not monotonic above five gears, and that is correct.**
 * Because the curve climbs from 1.0 to 3.5 across indices 0..20, a gear that
 * lands below index 20 samples a *smaller* divisor than first-of-a-five-speed
 * and so gets a *larger* ratio: `numberOfGears 8, differential 5` gives
 * g1 = 6.829 but g2 = 5.512. Do not sort it, clamp it or otherwise "fix" it.
 */
export function gearLadder(differential, numberOfGears) {
  const gears = Math.max(1, Math.round(numberOfGears > 0 ? numberOfGears : 1));
  const out = new Array(gears);
  for (let g = 1; g <= gears; g++) out[g - 1] = engineRatio(differential, g, gears);
  return out;
}

/**
 * `PhysicsEngine::getCurrentTorque()`'s curve factor (TANK-4), without the
 * `x torque` the engine applies on top: `lerp` into `ENGINE_TORQUE_CURVE` at
 * `min(|revs|, 1.0) * 100`.
 *
 * @param {number} revs engine speed as a fraction of full, signed or not
 */
export function engineTorqueFraction(revs) {
  return sampleDistribution(ENGINE_TORQUE_CURVE, Math.min(Math.abs(revs), 1) * 100);
}

/**
 * `PhysicsEngine::getCurrentDifferentialRPM(float side) const`, byte-exact
 * (TANK-10, independently re-hand-traced flag by flag against the raw
 * disassembly — the exact class of x87 trap that has bitten this corpus 11
 * of its last 13 rounds, and it held with no sign errors found). `side` is a
 * pure sign discriminator, not a magnitude: 0 for a wheel with no lateral
 * offset (a car's, or one authored dead on the centreline), positive for the
 * wheel on the vehicle's own +X (starboard) side, negative for -X.
 *
 * At `throttle == 0` both non-zero branches are exactly zero regardless of
 * `yaw` (TANK-17: a tank cannot pivot from a dead stop on the stick alone) —
 * a direct algebraic consequence of every branch multiplying by `throttle`,
 * not a separate case here.
 *
 * **This is the `engineType & 4` branch on its own.** The function the engine
 * calls is `getCurrentDifferentialRPM`, which tests the type first and
 * returns the rev state **raw and unclamped** when the bit is clear — see
 * `currentDifferentialRPM`. A car has wheels well off its centreline (a
 * Willy's rear springs sit at x = ±0.6) and must not reach this.
 *
 * @param {number} revs the engine's rev state, `PhysicsEngine+0xa0`. NOT the
 *   pedal: `getCurrentDifferentialRPM` loads `+0xa0` at `0x0824c9c0`
 * @param {number} steer `PhysicsEngine+0xb0`, the clipped yaw angle over
 *   `maxRotation.x`, -1..1
 * @param {number} side sign of the wheel's local X in the vehicle frame
 */
export function differentialRPM(revs, steer, side) {
  if (side === 0) return revs;
  const factor = side > 0 ? 1 - 1.5 * steer : 1 + 1.5 * steer;
  return Math.max(-1, Math.min(1, revs * factor));
}

/**
 * `PhysicsEngine::getCurrentDifferentialRPM(float side)` whole, `0x0824c990`,
 * hand-decoded flag by flag (the x87 trap that has bitten this corpus): the
 * type test at `0x0824c9d1`-`0x0824c9e0` is `and eax,0x4; je` straight to the
 * return, so
 *
 *   (type & 4) == 0   ->  the rev state, RAW — a car runs to +1.2
 *   (type & 4) != 0   ->  clamp(revs * (1 -/+ 1.5*steer), -1, +1)
 *   side == 0         ->  the rev state raw, even on a tank (0x0824ca4a)
 *
 * **This is where a tank's 1.0 ceiling lives** — not in the rev clamp, which
 * is `[-1.0, +1.2]` for every type alike (ledger TANK-9, TANK-12). So the
 * Sherman tops out at `ladder[5] * 1.0` = 14.89 m/s and the Willys at
 * `ladder[5] * 1.2` = 31.28.
 */
export function currentDifferentialRPM(revs, steer, side, bits) {
  if ((bits & ENGINE_BIT_DIFFERENTIAL) === 0) return revs;
  return differentialRPM(revs, steer, side);
}

// THERE IS NO `bodyThrust` IN THIS FILE ANY MORE, and nothing here may grow
// one back. It used to carry `PhysicsEngine::updatePhysics`'s propeller
// expression — `e = thr - v/noPropellerEffectAtSpeed`, `K = 0.1|thr| + e|e|`,
// `a = fwd*K*ratio` (`0x0824cf45`-`0x0824cf78`) — and apply it to a hull.
// That whole function is behind `getEngineType() & 1`, and the gate is not a
// gate on a block: `0x0824cc04 mov eax,[edi+0x9c]; 0x0824cc10 call [edx+0xa0];
// 0x0824cc16 and eax,0x1; 0x0824cc1e jne 0x0824cc28`, and the fall-through at
// `0x0824cc20` is the epilogue. **`c_ETCar` (2) and `c_ETTank` (6) clear bit 0
// and the function returns at its second instruction.** A ground vehicle gets
// no hull thrust, no `feedbackLoop` from that path, and never reaches
// `noPropellerEffectAtSpeed` (`tmpl+0x520`, read only at `0x0824cf45` inside
// `&1` AND `&8`). Ledger TANK-7, refuted; TANK-1's "nothing calls
// getEngineType" refuted with it. `flight.js` keeps the aircraft's own copy of
// the propeller law, which is where it belongs.
//
// What propels a ground vehicle — car and tank alike — is the EngineGrip
// contact-speed target below, on its `c_PGFEngineGrip` springs.

/**
 * EngineGrip contact-speed target, re-derived 2026-09-20 (TANK-9 corrected).
 * The engine's expression, `addFriction` lnxded `0x0825c2ed`-`0x0825c407`, is
 *
 *   T = (1 - 0.5*b) * ratio * differentialRPM(side) * fwd
 *       + 0.5*b * (Vt . fwd) fwd                        // the SAME fwd axis
 *
 * — a **blend between the commanded surface speed and the wheel's own
 * contact speed**, not a scale on the target. `0.5*b` is formed at
 * `0x0825c32b` (`fld ds:0x86b05e8` = 0.5, `fmul [edx+0xb8]`) for the first
 * term's `1 - 0.5*b` (`fsubr ds:0x86ba8d4` = 1.0) and again at `0x0825c3b1`
 * for the second; the two are summed at `0x0825c3d7`-`0x0825c407`.
 *
 * `b` is **PhysicsEngine** `+0xb8` (the object at `Engine+0x60`, not the
 * Engine itself), and it is **a one-shot lockout, not a constant**:
 * `Engine::handleUpdate` `0x0823e120` counts it down by `dt/gearChangeTime`
 * to zero (`0x0823e24f`/`0x0823e25a`), and a whole-binary store scan finds no
 * other writer at all -- not even a gear change re-arms it (ledger TANK-9,
 * TANK-12). So after the first `gearChangeTime` of a vehicle's life (0.05 s
 * for the Sherman and M3A1, the constructor's 1.0 s for the Willys) `b = 0` and
 *
 *   T = ratio * differentialRPM(side)      -> dV = T - Vt, zero at v = T
 *
 * The old reading took the constructor's seed `+0xb8 = 1.0` (`0x0824c756`
 * region) for the steady value and landed on a factor of **0.5**, which made
 * every gear's ceiling half what the engine gives. `differentialRPM` returns
 * the engine's **rev state** `+0xa0` (`0x0824c990`), not the pedal, so the
 * ceiling is `ratio * revs` and revs runs to `ENGINE_REV_CEILING`.
 *
 * @param {number} revs the engine's rev state, NOT the pedal
 * @param {number} [blend] the live gear-change timer `+0xb8`, 1 at the
 *   instant of a change and 0 in all steady driving
 * @param {number} [contactSpeed] `Vt . fwd`, the second term's input
 * @param {number} [bits] `getEngineType()`. Defaults to the differential bit
 *   because that is the branch this helper was written to pin; `EngineState`
 *   passes its vehicle's own, so a car's wheels never take the split
 */
export function engineGripTarget(revs, steer, side, ratio,
    blend = 0, contactSpeed = 0, bits = ENGINE_BIT_DIFFERENTIAL) {
  const b = Math.max(0, Math.min(1, blend));
  return (1 - 0.5 * b) * ratio * currentDifferentialRPM(revs, steer, side, bits)
    + 0.5 * b * contactSpeed;
}

/**
 * The engine's own rev ceiling, and the number `revLimit 356` was standing in
 * for. `Engine::handleUpdate` `0x0823e120` runs the rev state as a first-order
 * filter on the throttle and the drivetrain load,
 *
 *   revs += 0.05 * ((T1 - load) - 0.5*revs)        // 0x0823e2bf; fixed point 2*(T1-load)
 *   revs  = min(1.2, max(-1.0, revs))              // 0x0823e2f4 (ceiling), 0x0823e30b (floor)
 *
 * `T1` is not the raw pedal: it is the engine's clipped RotationalBundle roll
 * angle over `maxRotation.z` (`0x0823e1e0`-`0x0823e1f4`), which reaches 1.0
 * within about 0.1 s of full throttle on all three vanilla drivetrains. The
 * 0.05 is per engine tick, NOT scaled by dt. `EngineState` below carries the
 * whole filter; the kinematic `speed / ratio` inversion this file used to run
 * is gone (ledger TANK-12).
 *
 * **The clamp itself is type-independent.** Both arms apply to every engine
 * type alike; a tank's 1.0 comes from `getCurrentDifferentialRPM`'s own `& 4`
 * clamp, not from here. See `currentDifferentialRPM`.
 *
 * So an open throttle against no load pins revs at **1.2**, not 1. That is
 * what puts a Willy's top gear at `1.2 * 26.064` = 31.3 m/s rather than at
 * `ladder[top]`, and a Sherman's at `1.0 * 14.894` = 14.89. The asymmetric
 * floor of -1.0 is the engine's too, and is why reverse is slower than first.
 */
export const ENGINE_REV_CEILING = 1.2;

/** The same clamp's lower arm, `0x0823e30b`-`0x0823e31e`: revs floor at -1.0. */
export const ENGINE_REV_FLOOR = 1.0;

/**
 * `ds:0x86c08a8`, raw `cd cc 4c 3d` = 0.05f. The rev filter's gain, applied
 * **per `Engine::handleUpdate` call and NOT scaled by `dt`** — the only uses
 * of `dt` in that whole function are `fdiv [esi+0x374]` (the gear-change
 * lockout) at `0x0823e23f` and three `calculateAndClipAngle` calls. So the
 * filter's time constant is 40 engine ticks whatever the tick rate is, and
 * a viewer that normalises it per second gets the wrong spool-up.
 */
const ENGINE_REV_FILTER_GAIN = 0.05;

/**
 * `ds:0x86d0cdc`, raw `a4 70 7d 3f` = 0.99f. The car branch of
 * `feedbackLoop`'s running mean, `L = (L*n + L0) * 0.99 / (n + 1)`
 * (`0x0824c952`-`0x0824c97e`).
 */
const ENGINE_LOAD_MEAN_SCALE = 0.99;

/**
 * `setNumberOfGears` `0x0823fd10` **clamps its argument to [1, 5]**
 * (`cmp edx,0x5; jle` then `mov edx,5`; `test edx,edx; jle` then `mov edx,1`),
 * so TANK-3's non-monotonic `nGears 8` ladder is real in the curve but
 * unreachable from any `.con`. `gearLadder` deliberately does NOT clamp — it
 * is the curve, and the curve is what the ledger pins — so the clamp lives
 * here, where a template is read.
 */
const ENGINE_MAX_GEARS = 5;

/** `EngineTemplate`'s own constructor defaults, `0x0823efc0`: gears 1
 * (`0x0823f018`), differential 10.0 (`0x0823f022`), torque 60.0
 * (`0x0823f02c`), gearUp 0.7 (`0x0823f036`), gearDown 0.3 (`0x0823f040`),
 * gearChangeTime 1.0 (`0x0823f04a`), engineType 0 (`0x0823f078`). Used when a
 * `.con` omits the word, which is why they are transcribed rather than
 * invented. */
const ENGINE_DEFAULTS = {
  numberOfGears: 1, differential: 10.0, torque: 60.0,
  gearUp: 0.7, gearDown: 0.3, gearChangeTime: 1.0,
};

/**
 * The engine's own simulation tick, and the rate `EngineState.advance` steps
 * the filter at.
 *
 * `g_simulationFps` (`0x08716b5c`, raw `0000f041` = 30.0) is the figure the
 * friction budget above already spends, and **ledger LOOP-1 is CLOSED on it**
 * (2026-09-20): the simulation is a fixed 30 Hz tick, `dt = 1/30` exactly, on
 * client and server alike — `Setup::updateInputs` `0x080bc540` is an
 * accumulator, and the only `dt` that ever reaches `simulateFrame` is the
 * tick's own. The earlier "the loop targets `2 * g_simulationFps` and stores
 * a measured frame time" reading was of the render loop, not the simulation,
 * and nothing in this file hedges against it any more.
 *
 * So the filter runs at 30 Hz on an accumulator independent of the viewer's
 * own sub-step rate, which is also what makes spool-up frame-rate
 * independent. The 40-tick time constant is 1.33 s of wall clock.
 */
const ENGINE_TICK_SECONDS = 1 / ENGINE_TICK_HZ;

export const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

/**
 * The whole of `Engine::handleUpdate` (`0x0823e120`) and the drivetrain half
 * of `PhysicsEngine` — the rev filter, the gearbox, the brake byte, the
 * gear-change lockout and `feedbackLoop`'s load accumulator — as one object
 * both vehicle classes own. Ledger TANK-12 and TANK-13.
 *
 * What it replaces: `GroundVehicle` used to invert `revs = speed / ratio`
 * kinematically and `TrackedVehicle` had no rev state at all. The inversion
 * reaches the same ceiling but not the same spool-up, has no behaviour after
 * a shift, and cannot express the thing that actually governs a Refractor
 * drivetrain — **the load feedback**. In the engine, hard acceleration makes
 * `feedbackLoop`'s load large, the load pulls revs down, low revs lower the
 * EngineGrip target, and the target is the whole of the propulsion. That loop
 * is why `setTorque` matters (as the load's *divisor*, TANK-13) and why a
 * 25-tonne Sherman and a 2.5-tonne jeep with the same ratios would not drive
 * alike.
 *
 * Live fields carry their engine offsets: `revs` is `PhysicsEngine+0xa0`,
 * `load` `+0xa4`, `loadCount` `+0xac`, `steer` `+0xb0`, `braking` `+0xb4`,
 * `blend` `+0xb8`, `gear` `+0xbc`; `rollAngle`/`yawAngle` are the
 * `RotationalBundle` angles at `Engine+0x10c` / `+0x104`.
 */
export class EngineState {
  /**
   * @param {object} [physics] the Engine node's `extras.physics`
   * @param {boolean} [automaticReset] the Engine's `rig.automaticReset`
   */
  constructor(physics = {}, automaticReset = true) {
    const pick = (value, fallback) =>
      (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    this.torque = pick(physics.torque, ENGINE_DEFAULTS.torque);
    this.differential = pick(physics.differential, ENGINE_DEFAULTS.differential);
    this.numberOfGears = Math.max(1, Math.min(ENGINE_MAX_GEARS,
      Math.round(pick(physics.numberOfGears, ENGINE_DEFAULTS.numberOfGears))));
    this.gearUp = pick(physics.gearUp, ENGINE_DEFAULTS.gearUp);
    this.gearDown = pick(physics.gearDown, ENGINE_DEFAULTS.gearDown);
    this.gearChangeTime = pick(physics.gearChangeTime, ENGINE_DEFAULTS.gearChangeTime);
    this.engineType = physics.engineType ?? null;
    this.bits = engineTypeBits(this.engineType);
    // The Engine's own RotationalBundle, which is what the throttle and the
    // steer are read through. `maxRotation` is the divisor; the rate is
    // `setAcceleration` under the `automaticReset` law (GUN-2) and falls back
    // to `setMaxSpeed`, which every vanilla ground drivetrain authors equal
    // to it. Yaw/Pitch/Roll order, straight off the `.con`.
    const maxRotation = physics.maxRotation || [0, 0, 0];
    const rate = physics.acceleration || physics.maxSpeed || [0, 0, 0];
    this.maxRollAngle = Math.abs(maxRotation[2] || 0);
    this.maxYawAngle = Math.abs(maxRotation[0] || 0);
    this.rollRate = Math.abs(rate[2] || 0);
    this.yawRate = Math.abs(rate[0] || 0);
    this.automaticReset = automaticReset !== false;
    /** True when the Engine node carried no `maxRotation`, i.e. it came out
     * of a tree extracted before `con.py` emitted it. Both angle terms then
     * fall back to the raw input — see `tick`. Not a tuning knob: it is a
     * report on the asset tree, and it goes away when the lead re-extracts
     * every level's `scene.glb` and the `viewer/models` glbs. */
    this.stale = !(this.maxRollAngle > 0) || !(this.maxYawAngle > 0);
    /** `Engine+0x142`, the engine-on flag: `handleUpdate` forces the revs to
     * **0** when it is clear (`0x0823e2d3 cmp BYTE PTR [edi+0x142],0x0` and
     * the `0x0823e2e6`/`0x0823e2ec` arm that stores 0.0 to `+0xa0`), and
     * `handlePlayerInput` `0x0823e5ef` reads the same byte.
     *
     * It is the read answer to "what holds an UNOCCUPIED vehicle on a
     * slope": with the revs pinned at 0 the EngineGrip target is 0, every
     * driven wheel asks for its whole contact velocity back, and the static
     * latch answers it inside the break-away budget. Nothing in this viewer
     * clears it today, because `map.html` only integrates the hull the
     * player is sitting in — a parked one is a fixture and is never stepped.
     * Carried so the fact is in the code rather than in a report. */
    this.running = true;
    /** `getCurrentRatio()` for every gear (TANK-3). */
    this.ladder = gearLadder(this.differential, this.numberOfGears);

    /** `PhysicsEngine+0xbc`, 1-based. The engine seeds it to 1 and
     * `handleUpdate` is the only thing that ever writes it again — which the
     * old TANK-7 reading denied, and is why a Sherman used to be stuck in
     * first gear at 41 km/h instead of climbing to 53.6. */
    this.gear = 1;
    /** `PhysicsEngine+0xa0`, the filtered rev state, [-1.0, +1.2]. */
    this.revs = 0;
    /** `PhysicsEngine+0xb8`. The two `PhysicsEngine` constructors seed it to
     * **1.0** (`0x0824c74c`, `0x0824c7cc`) and `handleUpdate` counts it down
     * by `dt/gearChangeTime`; a whole-binary store scan finds no other writer
     * at all — **not even a gear change re-arms it**. So it is a one-shot
     * lockout that expires `gearChangeTime` into the object's life and stays
     * expired, and the old "steady factor of ½" reading mistook this seed for
     * a steady value and halved the whole fleet. */
    this.blend = 1.0;
    /** `Engine+0x10c` / `+0x104`: the clipped bundle angles, in the `.con`'s
     * own units (a Willy's roll runs to ±5000, a Sherman's to ±1). */
    this.rollAngle = 0;
    this.yawAngle = 0;
    /** `T1`, the rev filter's command: `rollAngle / maxRotation.z`. */
    this.throttleTerm = 0;
    /** `PhysicsEngine+0xb0`: `yawAngle / maxRotation.x`. */
    this.steer = 0;
    /** `PhysicsEngine+0xb4`, and it is a hard cut rather than a brake force:
     * `addFriction` discards the whole EngineGrip target when it is set
     * (`0x0825c28a`/`0x0825c293`), so the wheel asks for `0 - Vt` — all of its
     * contact velocity back, at whatever the ground can answer. */
    this.braking = false;
    /** `PhysicsEngine+0xa4`/`+0xac`/`+0xa8`. */
    this.load = 0;
    this.loadCount = 0;
    this.prevLoad = 0;
    this._clock = 0;
  }

  /** `PhysicsEngine::getCurrentRatio()` at the live gear. */
  get ratio() {
    return this.ladder[Math.min(this.ladder.length, Math.max(1, this.gear)) - 1];
  }

  /** `PhysicsEngine::getCurrentTorque()`: the TANK-4 curve at the live revs,
   * times `setTorque`. It is the **divisor of the load** (TANK-13), never a
   * multiplier on drive — at redline it returns 0.70x and so *raises* the
   * load feedback rather than adding power. */
  get torqueNow() {
    return engineTorqueFraction(this.revs) * this.torque;
  }

  /**
   * The EngineGrip contact-speed target for a wheel on `side`, in **metres
   * per second of contact-patch velocity** — no wheel radius anywhere on this
   * path (`SpinWheel` `0x0825b440` *divides* by one, for the visual angle
   * only). TANK-9 as corrected.
   *
   * @param {number} side sign of the wheel's local X
   * @param {number} [contactSpeed] `Vt . fwd`, for the gear-change blend
   */
  target(side, contactSpeed = 0) {
    if (this.braking) return 0;
    return engineGripTarget(this.revs, this.steer, side, this.ratio,
      this.blend, contactSpeed, this.bits);
  }

  /**
   * One contact's clamped longitudinal velocity change, as
   * `PhysicsEngine::feedbackLoop` (`0x0824c850`) takes it. TANK-13.
   *
   *   L0 = dot(dV, fwd) * getCurrentRatio() / getCurrentTorque()
   *   (type & 2)  ->  L0 clamped to [-1, +1]              (car AND tank)
   *   (type & 4)  ->  L is the frame MAX when revs >= 0, the frame MIN when
   *                   revs < 0                             (tank)
   *   else        ->  L = (L*n + L0) * 0.99 / (n + 1)      (car)
   *
   * **The min/max are that way round**, decoded from `0x0824c91f`'s
   * `fldz; fucompp` (ST = 0.0, SRC = revs, so `revs > 0` takes the `jne` to
   * `0x0824c942`, whose `fucom` keeps `L0` only when `L0 > L`). The
   * v4-gearbox verdict states them inverted. Physically the max is the one
   * that can hold an engine down, and the pair is symmetric in reverse.
   *
   * **`revs == 0` takes the MAX arm, not the MIN.** `fucompp` sets C3 on
   * equality, `test ah,0x45` is then non-zero, and the `jne` at `0x0824c926`
   * is taken to `0x0824c942` — the same branch `revs > 0` takes. Only the
   * fall-through at `0x0824c928`, which is `0.0 > revs`, is the MIN. It is
   * one tick of one sample, but it is the tick a tank pulls away on.
   *
   * **Only a `c_PGFEngineGrip` wheel feeds it.** `addFriction` dispatches on
   * the grip byte at `0x0825baf1`-`0x0825bafe` (`mov dl,[esi+0xb4];
   * and eax,0x4; test al,al; jne 0x0825c1b0`), and the `0x4` branch is the
   * only one that walks the node's ancestors for a `PhysicsEngine`
   * (`0x0825c1b0`-`0x0825c1fa`, storing it at `0x0825c556`). A RollGrip wheel
   * takes the `0x2` branch at `0x0825bb04` instead, so the pointer stays null
   * and the guard at `0x0825bc19` skips the call. The load is therefore the
   * mean over the DRIVEN wheels alone.
   *
   * Getting this wrong is not academic: counting a jeep's two free-rolling
   * fronts as zero samples halves the load, which pins the revs at
   * `2*(1 - 0.5)` = 1.0 — just above `gearUp 0.95` — so the box shifts
   * straight to top under full wheelspin and stays there. On Wake that jeep
   * never left second gear's worth of speed; it sat in fifth doing donuts.
   *
   * @param {number} dvLong metres per second per **engine tick**
   */
  sample(dvLong) {
    let l0 = dvLong * this.ratio / Math.max(1e-6, Math.abs(this.torqueNow));
    if (!Number.isFinite(l0)) return;
    if (this.bits & ENGINE_BIT_LOAD_CLAMP) l0 = clamp(l0, -1, 1);
    if (this.bits & ENGINE_BIT_DIFFERENTIAL) {
      if (this.revs >= 0) { if (l0 > this.load) this.load = l0; }
      else if (l0 < this.load) this.load = l0;
      return;
    }
    const n = this.loadCount;
    this.load = (this.load * n + l0) * ENGINE_LOAD_MEAN_SCALE / (n + 1);
    this.loadCount = n + 1;
  }

  /**
   * Carry the engine forward by `dt` of wall time, running whole
   * `ENGINE_TICK_SECONDS` ticks. The viewer sub-steps faster than the engine
   * does (60 Hz for a car, 120 for a tank, against the engine's 30), exactly
   * as `PointPhysicsNode` sub-steps inside one tick — so the load samples of
   * several sub-steps land in one tick's accumulator, which is what the
   * engine does too.
   */
  advance(dt, throttle, yaw) {
    this._clock += dt;
    let ticks = 0;
    while (this._clock >= ENGINE_TICK_SECONDS && ticks < 8) {
      this._clock -= ENGINE_TICK_SECONDS;
      this.tick(ENGINE_TICK_SECONDS, throttle, yaw);
      ticks += 1;
    }
    // A frame longer than eight engine ticks is a stall, not a simulation;
    // drop the backlog rather than spending minutes of spool-up in one frame.
    // The engine has no such cap (a stalled server just runs behind), so the
    // 8 is this file's own. [free, numerics]
    if (ticks >= 8) this._clock = 0;
  }

  /** One `Engine::handleUpdate`. */
  tick(dt, throttle, yaw) {
    const pedal = clamp(throttle, -1, 1);
    const steerInput = clamp(yaw, -1, 1);

    // The two RotationalBundle axes, under `setAutomaticReset`'s own law
    // (GUN-2): the angle ramps straight toward `input * maxRotation` at the
    // declared rate, in units per second, with no velocity register. Every
    // car/tank Engine in the 18 installs but one authors the flag. A Willy
    // reaches full roll in 5000/55000 = 0.091 s, a Sherman in 1/10 = 0.1 s,
    // and a Sherman's steer reaches full lock in 1/4 = 0.25 s.
    this.rollAngle = this.#ramp(this.rollAngle, pedal * this.maxRollAngle,
      this.rollRate * dt, this.maxRollAngle);
    this.yawAngle = this.#ramp(this.yawAngle, steerInput * this.maxYawAngle,
      this.yawRate * dt, this.maxYawAngle);
    // `T1 = Engine+0x10c / getMaxRotation().z` (`0x0823e1e0`-`0x0823e1f4`)
    // and the steering term is its sibling, `Engine+0x104 / maxRotation.x`.
    //
    // **THE PRE-EXTRACT PATH, and it is not optional.** `maxRotation`,
    // `maxSpeed` and `acceleration` only started reaching `extras.physics`
    // with this branch's `bf42/con.py`, and a published `viewer/maps` or
    // `viewer/models` tree can be older than the code that reads it — every
    // shipped `scene.glb` today was extracted with the previous `con.py` and
    // carries none of them. Throttle already degraded safely, because an
    // absent `maxRotation.z` falls back to the pedal and the ratio converges
    // to the same place. **Steering had no such fallback and degraded to a
    // dead stick**: `maxYawAngle = 0` made `steer` identically 0, and the
    // differential IS the whole of a tracked vehicle's steering, so on the
    // assets that exist today a Sherman turned 0.0 degrees in six seconds of
    // full lock and an M3A1 topped out at 30.7 km/h instead of 65.7.
    //
    // So both terms fall back to the input, which is what the servo
    // converges to in 0.1 s (throttle) and 0.25 s (steer) when the data is
    // there. The only thing lost without the data is that spool, and a mod
    // that authors an unusual `maxRotation`/`acceleration` pair gets the
    // vanilla response until its tree is re-extracted. `stale` says which
    // path a vehicle is on so a harness — and `window.__drive()` — can tell
    // a fallback from a reading.
    this.throttleTerm = this.maxRollAngle > 0
      ? this.rollAngle / this.maxRollAngle : pedal;
    this.steer = this.maxYawAngle > 0
      ? this.yawAngle / this.maxYawAngle : steerInput;

    // The gear-change lockout counts down and is never re-armed (0x0823e24f,
    // 0x0823e25a).
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend
        - dt / Math.max(1e-6, this.gearChangeTime));
    }

    // The brake byte: the pedal opposing the rev direction, against literal
    // ±0.1 doubles (`ds:0x86cf658`, `ds:0x86ba1d8`). Read off `Engine+0x124`,
    // the RAW input, not the clipped angle.
    this.braking = (pedal < -0.1 && this.revs > 0)
      || (pedal > 0.1 && this.revs < 0);

    // The filter itself. `0.05` is per call; the whole point of TANK-12.
    // An engine that is off has its revs stored as 0.0 instead
    // (`0x0823e2d3`, `0x0823e2e6`-`0x0823e2ec`).
    const delta = ENGINE_REV_FILTER_GAIN
      * ((this.throttleTerm - this.load) - 0.5 * this.revs);
    this.revs = this.running
      ? clamp(this.revs + delta, -ENGINE_REV_FLOOR, ENGINE_REV_CEILING) : 0;

    // Up needs the lockout expired, down does not (0x0823e391-0x0823e3f1).
    // The engine falls THROUGH the up-shift into the down-shift test, so both
    // run in one tick; with gearUp 0.95 against gearDown 0.4 the second can
    // never fire after the first.
    if (this.revs > this.gearUp && this.blend === 0
        && this.gear < this.numberOfGears) {
      this.gear += 1;
    }
    if (this.revs < this.gearDown && this.gear > 1) this.gear -= 1;

    // The tail: last tick's load is kept and the accumulator cleared, so the
    // samples `addFriction` adds after this belong to the next tick.
    this.prevLoad = this.load;
    this.load = 0;
    this.loadCount = 0;
  }

  /** Park it: the engine's own construction state. */
  reset() {
    this.gear = 1;
    this.revs = 0;
    this.blend = 1.0;
    this.rollAngle = 0;
    this.yawAngle = 0;
    this.throttleTerm = 0;
    this.steer = 0;
    this.braking = false;
    this.load = 0;
    this.loadCount = 0;
    this.prevLoad = 0;
    this._clock = 0;
  }

  #ramp(angle, wanted, step, limit) {
    let next = angle;
    if (wanted > angle) next = Math.min(wanted, angle + step);
    else if (wanted < angle) next = Math.max(wanted, angle - step);
    // `calculateAndClipAngle`'s clip, with the template's symmetric limits.
    return limit > 0 ? clamp(next, -limit, limit) : next;
  }
}
