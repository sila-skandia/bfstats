# Tank and half-track driving (`c_ETTank`)

Settled 2026-09-16 for the map viewer's `TrackedVehicle`
(`ground.js`). There is no tank-specific code path anywhere in the engine —
differential steering is a side-effect of the same wheel-friction code every
ground vehicle uses, reading whichever input axes an `Engine` happens to
expose. This doc assumes [physics.md](physics.md) §3 (the integrator), §5
(thrust) and §7 (an Engine node never poses its own subtree) as background;
it only covers what is specific to tracked steering and gearing.

## 1. `engineType` is parsed, stored, and used by nothing

`EngineTemplate::getEngineType()` (lnxded `0x0823fd00`, template `+0x524`)
is a real, working accessor — `operator<<`/`>>` round-trip it correctly
(`c_ETPlane=1, c_ETCar=2, c_ETTank=6, c_ETShip=9, c_ETRocket=0x11,
c_ETTorpedo=0x19`, client `0x00571180`) — but an exhaustive call-site grep
across all 2,408,565 lines of lnxded disassembly finds **zero calls to it**
anywhere in simulation code (TANK-1). Only two data-pointer references to
the function exist in the whole binary. A tank does not drive differently
from a car because the engine checks its type; it drives differently
because its `.con` file binds different input axes to different wheels, and
the *same* generic code produces different behaviour as a result.

## 2. Differential steering is ordinary per-wheel friction code

`getCurrentDifferentialRPM(float)` (client `0x0057bcb0`, TANK-2) is called
per `EngineGrip` wheel from `addFriction`, and reads the **same**
`roll`(throttle)/`yaw`(steering) axes any Engine has:

```
side == 0            -> throttle
side > 0  (right)    -> clamp(throttle * (1 - 1.5*yaw), -1, 1)
side < 0  (left)     -> clamp(throttle * (1 + 1.5*yaw), -1, 1)
```

Confirmed byte-exact: every `fnstsw`/`test ah, imm` in the function was
independently hand-traced from its raw flag encoding, not read off a
decompile. `side` is the sign of the wheel's local-frame X — it comes from
`addFriction`'s own wheel parameter (vtable `+0x34`); the wheel's owning
Engine is found by an ancestor walk to the nearest `CID_EngineTemplate`
(`0x086c2b30`). **A car's Engine just never binds `setInputToYaw` to
anything**, so all of its wheels resolve `side == 0` and the formula
degenerates to plain uniform throttle — the "tank steering formula" and
"car steering" are the literal same code path, differing only in which
axes the `.con` file wires up.

## 3. The gear-ratio curve: a 101-slot array, authored at five points

`getCurrentRatio()` (client `0x0057bd90`, TANK-3) computes
`ratio = differential × 3.5 / curve[idx]`, where
`idx = trunc(gear / numberOfGears × 100)`. **The truncation is genuine —
the MSVC `_ftol` idiom (`0x00804af0`) rounds to nearest and then applies a
residual-sign ±1 correction to convert that into truncation-toward-zero.**
This corrects an earlier reading that assumed `round()`.

`curve` is a **fully materialized 101-float array**
(`EngineTemplate::EngineTemplate`, `0x005715d0`, hand-disassembled in full
to confirm the exact fill pattern), `1.0` at every index except five
authored control points:

| idx | 20 | 40 | 60 | 80 | 100 |
|---|---|---|---|---|---|
| value | 3.5 | 2.2 | 1.5 | 1.1 | 0.94 |

**Only `numberOfGears ∈ {1, 5}` ever lands `idx` on one of those five
control points.** For any other integer gear count, `100 / numberOfGears`
never equals 20, 40, 60, 80 or 100, so `curve[idx]` is the default `1.0`
and the whole formula reduces to exactly `ratio = 3.5 × differential`.

Concrete consequence, the one number in this subsystem that actually
changes viewer behaviour: **Sherman = 4.0, Willy = 7.0** (both
`numberOfGears = 5`, so `idx = 20`, a genuine control point) — but
**M3A1 = 17.5, not the ≈5.5 a smooth-curve assumption would give.** M3A1
does not use 5 gears; its `idx` lands away from any control point, `curve[idx]`
is the default `1.0`, and `ratio` falls straight out to `3.5 × differential`
with `differential = 5.0`. Implement the full 101-slot table (or at minimum
its five real control points plus the `1.0` default), never a smooth
5-point spline — a spline gives every non-5-speed ground vehicle the wrong
ratio.

**A second, unrelated 101-float curve feeds only engine sound (TANK-4).**
`getCurrentTorque()` (`0x0057be10`) samples a separate curve at the
engine's own `+0x26c` (the ratio curve lives at `+0x42c`), same `idx`,
`× torque`. It feeds engine-sound RPM only and has no bearing on drive or
steering; its own control-point values were not read in detail.

**Field offsets, and why the two readings disagree by exactly 4 (TANK-5).**
The M-frame (`EngineTemplate::makeScript`, `0x00571290`) places
`numberOfGears`/`differential`/`torque` at `+0x40c`/`+0x410`/`+0x414`. The
E-frame (`getCurrentRatio`/`getCurrentTorque`) reads what is structurally
the same three fields 4 bytes earlier: `+0x410`/`+0x414`/`+0x418` — **E = M
− 4**, because the E-frame's `this` is an interface subobject sitting at
`object + 4`. Confirmed via three independent anchors: `numberOfGears`'s
`int` type (which disambiguates it from its float neighbours), the
distinctive `setNoPropellerEffectAtSpeed = 100.0` value landing at both
frames' matching offset, and the gear-ratio curve's own base address
matching between the constructor and the read sites.

## 4. Which wheels actually drive

Sherman's and M3A1's only load-bearing driven wheels are the rear bogie
`Springs`, carrying `EngineGrip` (TANK-6). Every other track wheel is either
non-physical (pure animation) or `EngineDummyGrip` — spin-only, contributing
nothing to friction or suspension. M3A1 additionally runs a plain
`RollGrip` steerable front axle, active *simultaneously* with the rear
differential drive — the same free-rolling steered-wheel code Willy's front
wheels already use, just paired with a tank-style rear end. Driven-wheel
radii were independently re-measured from `scene.glb`'s own mesh bounds:
Sherman ≈ 0.255 m, M3A1 rear ≈ 0.17 m.

**A tank cannot pivot from a dead stop on yaw alone.** At zero throttle,
`getCurrentDifferentialRPM` returns exactly `0` for both sides regardless of
`yaw` — both of §2's non-gate branches multiply by `throttle`, so a zero
throttle zeroes the whole expression before `yaw` gets a chance to act. This
is a direct algebraic consequence of TANK-2's formula, not a separate rule:
turning in place needs a small nonzero throttle nudge, always.

## Open

- **TANK-2 (client side)**: the ancestor walk and side-derivation are
  independently hand-disassembled and match exactly, but only in lnxded.
  `getCurrentRatio`'s client xrefs show 5 callers, not the 2 previously
  cited — `updatePhysics` and `feedbackLoop` are already-known and
  unrelated, a third (`0x0054f580`) decompiles to a string/ostream builder
  (very likely a debug console or HUD readout) and is ruled out as an
  `addFriction` candidate, and the true function entry for the remaining
  two boundary-less addresses (`0x00576d96`/`0x005770aa`, both ≤
  `0x00576b60`) is still unbracketed. **Closed 2026-09-19:** the client's
  `ResponsePhysics::addFriction` is `0x00576c50` (vtable `0x008fd770` slot
  +0x20, read from the live binary; Ghidra defines no function there yet), both
  sites fall between it and the next vtable function at `0x00577740`, and the
  server's `addFriction` makes exactly two `getCurrentRatio` calls — the
  EngineGrip path and the EngineDummyGrip early exit.
- ~~`SpinWheel`'s own internal gate~~ — **confirmed 2026-09-19**:
  `getPermanentGrip() & 4` or `& 2` (lnxded `0x0825b455`–`0x0825b470`), and the
  object must have a geometry. `SpinWheel` is purely visual.
- The `bit & 4` gate inside `getCurrentDifferentialRPM` — the same
  `queryInterface` pattern as `getCurrentRatio`/`getCurrentTorque`, testing
  the result of a further vtable call; plausibly an occupied/live-input
  check, not read.
- `getCurrentTorque`'s own curve control points (§3) — irrelevant to
  steering or drive, relevant only to engine-sound fidelity.
- The `PhysicsEngine::updatePhysics` preamble (`FUN_0053f250()`, vtable
  slots `0xd4`/`0xd8`/`0xdc`, gated on `|throttle| ≥ 0.05`) — independently
  re-observed matching the original description exactly. **Resolved
  2026-09-19:** those slots are `setIsAwake` / `setSleepiness` /
  `getSleepiness`. An engine with |input| ≥ 0.05 wakes the root physics node
  (unless its sleepiness is negative); otherwise the engine node copies the
  root's sleepiness ([collision-response.md](collision-response.md) §4.3).
- [physics.md](physics.md) PHY-4 (which drag law a vehicle gets) is
  settled separately (2026-09-17): every `PhysicsNode` always uses box/Advanced
  drag; this subsystem did not need that result.
- ~~The exact Coulomb friction force magnitude at a single wheel contact~~ —
  **closed 2026-09-19** ([collision-response.md](collision-response.md) §8): a
  per-tick velocity-change request clamped as a vector to `μ·N.y·14.73/30`
  m/s (1.5× while latched static), averaged over the touching parts. The
  differential-RPM stage sets the *target velocity* of that request.
