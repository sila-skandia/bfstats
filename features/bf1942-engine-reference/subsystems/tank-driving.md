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

## 3. The two gear curves: piecewise-linear, authored at a handful of points

> **Rewritten 2026-09-19. The previous reading of this section was wrong.** It
> described the ratio curve as a fully materialized array that is `1.0`
> everywhere except five control points, and concluded that only
> `numberOfGears ∈ {1,5}` ever touches its shape and that M3A1's ratio is 17.5.
> The constructor's flat fill is real, but it is only the *starting point*:
> every control-point store is followed by a call to
> `OverTimeDistribution::generateDistribution`, which interpolates the slots
> between the authored indices. The earlier pass read the fill loop and the
> five stores and never followed the eleven `CALL`s. There is also a **lerp**
> at the read site, which it missed as well.

`getCurrentRatio()` (lnxded `0x0824ca70`, client `0x0057bd90`, TANK-3):

```
idxf  = gear / numberOfGears * 100          // gear and numberOfGears are ints
i     = trunc(idxf)                         // genuine round-toward-zero
frac  = idxf - i
ratio = 3.5 * differential / lerp(curve[i], curve[i+1], frac)
```

The truncation is genuine on both binaries — lnxded sets round-toward-zero with
`fldcw 0x0c00` before `fist`, and the client uses the MSVC `_ftol` idiom
(`0x00804af0`). The `3.5` (`ds:0x86d0ce0`, read as bytes `00 00 60 40`;
client `0x008fdfa8`) is a **numerator multiplier on `differential`**, not a
divisor and not a curve value — though it is numerically equal to `curve[20]`,
which is exactly why the first gear of a 5-speed comes out at `differential`.

The curve is an `OverTimeDistribution` (ctor `0x081e7800`, 101 floats from
`+0x4`, a 128-bit authored mask at `+0x198`) built in
`EngineTemplate::EngineTemplate` (lnxded `0x0823efc0`, client `0x005715d0`) at
`tmpl+0x378` for the ratio and `tmpl+0x1b8` for the torque, with
`generateDistribution` (`0x081e7830`, client twin `FUN_005094b0`) called after
**every** control point — eleven calls in all. That function scans forward for
the next authored index and fills `v[j] = ((hi−j)·v[lo] + (j−lo)·v[hi]) /
(hi−lo)`; when nothing above `lo` is authored it holds the value flat to the
end instead.

Authored points, each index cross-checked against both its store offset and its
mask bit:

| ratio idx | 20 | 40 | 60 | 80 | 100 |
|---|---|---|---|---|---|
| value | 3.5 | 2.2 | 1.5 | 1.1 | 0.94 |

| torque idx | 0 | 10 | 30 | 60 | 85 | 100 |
|---|---|---|---|---|---|---|
| value | 0.70 | 0.80 | 0.90 | 1.00 | 0.85 | 0.70 |

**Index 0 of the ratio curve is not authored**, so slots 0–20 ramp from the
constructor's default 1.0 up to 3.5. Recomputed from the control points alone
in extended precision, ratio idx 0..100 by 10 is

```
1.000 2.250 3.500 2.850 2.200 1.850 1.500 1.300 1.100 1.020 0.940
ratio[25] = 3.175   ratio[50] = 1.850   ratio[75] = 1.200
```

so **every** gear count gets a real ratio, not just 1 and 5. The ladders:

| vehicle | nGears | differential | gears |
|---|---|---|---|
| Sherman | 5 | 4 | 4.000, 6.364, 9.333, 12.727, 14.894 |
| Willy | 5 | 7 | 7.000, 11.136, 16.333, 22.273, 26.064 |
| M3A1 | 4 | 5 | **5.512**, 9.459, 14.583, 18.617 |

**M3A1 is 5.512, not 17.5** — `idx = 25`, `curve[25] = 3.175`. Sherman 4.0 and
Willy 7.0 stand.

**Warning for anyone implementing it: the ladder is not monotonic.** Because
the curve *rises* from 1.0 to 3.5 across indices 0–20, any gear that lands
below index 20 gets a *higher* ratio than first-of-a-5-speed. `numberOfGears 8,
differential 5` gives g1 = 6.83 but g2 = 5.51. A viewer that assumes gears
descend will mis-model an 8- or 50-gear mod template, and both exist.

No `.con` word authors either curve: `EngineTemplate::makeScript`
(`0x0823f580`) emits only the twelve Engine words and no rodata string matches a
gear-curve setter. Constructor defaults are `numberOfGears = 1`,
`differential = 10.0`, `torque = 60.0`.

**`getCurrentRatio` is load-bearing physics, not sound.** Five call sites:
`PhysicsEngine::feedbackLoop` `0x0824c87a`, `PhysicsEngine::updatePhysics`
`0x0824cfe6` (the result multiplies a Vec3 handed to `[esi+0x68]`),
`ResponsePhysics::addFriction` `0x0825c252` and `0x0825c6fc`, and
`AnimatedBundle::updateAnimations` `0x082665ff`.

**The second curve (TANK-4).** `getCurrentTorque()` (lnxded `0x0824cb10`,
client `0x0057be10`) samples the torque curve with a **different index**:
`min(|engine[+0xa0]|, 1.0) × 100`, a normalised throttle/rev fraction, **not**
the gear — an earlier note here said "same `idx`", which is wrong. Peak at 60%
revs, 70% of peak at both ends. Its only caller is `feedbackLoop`, itself called
from `updatePhysics` and `addFriction`, and its return value is discarded, the
lasting effect being the rev state at `+0xa4`/`+0xac` — so the old claim that it
"feeds engine-sound RPM only" is **not established** and should not be repeated.

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
  `0x00576b60`) is still unbracketed.
- `SpinWheel`'s own internal gate (`getPermanentGrip() & (EngineGrip |
  RollGrip)`) — inherited as inferred from the original research pass, not
  independently re-checked this round.
- The `bit & 4` gate inside `getCurrentDifferentialRPM` — the same
  `queryInterface` pattern as `getCurrentRatio`/`getCurrentTorque`, testing
  the result of a further vtable call; plausibly an occupied/live-input
  check, not read.
- `getCurrentTorque`'s own curve control points (§3) — irrelevant to
  steering or drive, relevant only to engine-sound fidelity.
- The `PhysicsEngine::updatePhysics` preamble (`FUN_0053f250()`, vtable
  slots `0xd4`/`0xd8`/`0xdc`, gated on `|throttle| ≥ 0.05`) — independently
  re-observed matching the original description exactly; its purpose (a
  sound trigger? a network dirty flag?) is still unresolved.
- [physics.md](physics.md) PHY-4 (which drag law a vehicle gets) is
  settled separately (2026-09-17): every `PhysicsNode` always uses box/Advanced
  drag; this subsystem did not need that result.
- The exact Coulomb friction force magnitude at a single wheel contact
  remains open ([physics.md](physics.md) PHY-2) — this round narrows
  *where* the left/right asymmetry is injected (the differential-RPM stage,
  now fully confirmed), not the downstream per-wheel force law. A viewer's
  own tyre model here is exactly as speculative as Willy's.
