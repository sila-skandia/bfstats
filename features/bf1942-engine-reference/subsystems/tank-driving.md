# Tank and half-track driving (`c_ETTank`)

Settled 2026-09-16 for the map viewer's `TrackedVehicle` (`ground.js`), and
**substantially rewritten 2026-09-20**. This doc assumes
[physics.md](physics.md) §3 (the integrator), §5 (thrust) and §7 (an Engine
node never poses its own subtree) as background; it covers what is specific to
ground drivetrains and tracked steering.

> **The old headline of this file was wrong.** "There is no tank-specific code
> path anywhere in the engine" rested on an exhaustive grep that could not see a
> virtual call (§1). `engineType` is a **bit field** read at nine sites, and its
> bit 0 decides whether `PhysicsEngine::updatePhysics` runs *at all*. What
> survives is the *steering* half: the differential really is ordinary per-wheel
> friction code (§2). What does not survive is the belief that a ground vehicle
> is pushed by a hull thrust (§5) — it is not, and that is the single largest
> parity error the round found.

## 1. `engineType` is a bit field, read nine times

`EngineTemplate::getEngineType()` is **virtual slot `+0xa0`** of the
`EngineTemplate` primary vtable (`0x0872bd80`, vptr = symbol + 8 =
`0x0872bd88`) → `0x0823fd00`, template field `+0x524`, written by
`setEngineType` `0x0823fce0` which rejects anything above `0x1a`. The 2026-09-16
"zero calls" reading counted **direct `call` targets**, which a virtual call
never is (TANK-1, refuted).

The enum was re-derived from the jump table rather than from a comment:
`operator<<(ostream&, EngineType)` (`0x0823ef60`, client `0x00571180`) does
`cmp eax,0x19; ja default; jmp [eax*4+0x86cf7b0]`, and all 26 entries were
dumped and matched to the case body that pushes each string —
`c_ETPlane = 1` (`0x0823ef78`), `c_ETCar = 2` (`0x0823ef92`),
`c_ETTank = 6` (`0x0823ef9b`), `c_ETShip = 9` (`0x0823efa4`),
`c_ETRocket = 0x11` (`0x0823efad`), `c_ETTorpedo = 0x19` (`0x0823efb6`).

The bit meanings fall straight out of the masks:

| bit | meaning | set for |
|---|---|---|
| 0 (`& 1`) | propeller / thrust physics — **the `updatePhysics` gate** | plane, ship, rocket, torpedo |
| 1 (`& 2`) | ground drivetrain — clamps the `feedbackLoop` load | car, tank |
| 2 (`& 4`) | differential steering, and the rev clamp that comes with it | tank |
| 3 (`& 8`) | thrust rather than propeller spin | ship, torpedo |
| 4 (`& 0x10`) | pinned throttle | rocket, torpedo |

The nine call sites and their masks:

| address | function | mask | effect |
|---|---|---|---|
| `0x0823e06e` / `0x0823e0de` | `Engine::Engine` | `& 0x10` | `handleMessage(4)` — auto-start |
| `0x0823e165` | `Engine::handleUpdate` | `& 0x10` | pins `Engine+0x124` (the roll input) to 1.0 |
| `0x0824c8a2` | `feedbackLoop` | `& 2` | clamp `L0` to [−1,1] and rescale `v` |
| `0x0824c906` | `feedbackLoop` | `& 4` | `L` is a frame min/max instead of a running mean |
| `0x0824c9d1` | `getCurrentDifferentialRPM` | `& 4` | differential steering, and the clamp to [−1,+1] |
| `0x0824cc10` | `updatePhysics` | `& 1` | **the gate — see §5** |
| `0x0824cc80` | `updatePhysics` | `& 8` | thrust vs propeller spin |
| `0x0824d03e` | `updatePhysics` | `& 8` | pins `PhysicsEngine+0xa0` to 1.0 at `0x0824d06d` |

plus the console accessor at `0x08245466`.

## 2. Differential steering is ordinary per-wheel friction code

`getCurrentDifferentialRPM(float)` (client `0x0057bcb0`, TANK-2) is called
per `EngineGrip` wheel from `addFriction`, and reads the **same**
`roll`(throttle)/`yaw`(steering) axes any Engine has:

```
side == 0            -> throttle
side > 0  (right)    -> clamp(throttle * (1 - 1.5*yaw), -1, 1)
side < 0  (left)     -> clamp(throttle * (1 + 1.5*yaw), -1, 1)
```

**Corrected 2026-09-20: the branch is `engineType & 4`, and "throttle" is the
rev state.** The lnxded twin `0x0824c990` reads `fld [ebx+0xa0]` — the rev
state `Engine::handleUpdate` filters (§4), not the pedal — then
`call [eax+0xa0]` = `getEngineType()` at `0x0824c9d1` and `and eax,0x4` at
`0x0824c9da`. So:

- **`(type & 4) == 0` — a `c_ETCar` — returns the rev state UNCLAMPED**, which
  means a car reaches the filter's `+1.2` ceiling;
- **`& 4` — a `c_ETTank` — returns `clamp(revs·(1 ∓ 1.5·yaw), −1, +1)`**, the
  clamp hand-decoded at `0x0824ca10`–`0x0824ca2a`, with `1.5` at
  `ds:0x86be4d0`.

**That `±1` is where a tank's top speed cap really lives** — not in a per-type
rev ceiling, and not in the `[−1.0, +1.2]` clamp inside the filter, which is
type-independent. The `& 4` gate listed as open at the bottom of this file
("plausibly an occupied/live-input check, not read") is therefore closed: it is
the engine-type test.

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
differential 5` gives g1 = 6.83 but g2 = 5.51.

**But no shipped or moddable template can reach that case** (added 2026-09-20):
`EngineTemplate::setNumberOfGears` (`0x0823fd10`) **clamps its argument to
[1, 5]** — `cmp edx,0x5; jle` then `mov edx,5`; `test edx,edx; jle` then
`mov edx,1`. The 8- and 50-gear declarations in installed mods are silently
five. The curve's shape still rises, so the warning stands for anyone computing
the ladder from first principles; it is not a case a `.con` can produce.

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
revs, 70% of peak at both ends. Its only caller is `feedbackLoop`, and the old
claim that it "feeds engine-sound RPM only" is refuted.

**What it actually does, settled 2026-09-20 (TANK-13): it is the *divisor of the
load*, not a multiplier on drive force.** `feedbackLoop` computes
`L0 = dot(v, fwd) · getCurrentRatio() / getCurrentTorque()`, so at redline —
where the curve returns `0.70 × setTorque` — it **shrinks the denominator** and
*adds* load feedback rather than removing power. A model that multiplies drive
by a torque fraction moves in the same monotonic direction by a different
mechanism, and should say so rather than claim the curve. §4 has the rest.

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

## 4. The gearbox — `Engine::handleUpdate` (`0x0823e120`)

Read in full 2026-09-20, all 0x307 bytes hand-traced with the x87 stack depth
tracked through every `fucom`/`fucomp`/`fucompp`. **Nobody had opened it
before**, and it is the whole gearbox: the rev state, the shift rule, the brake
byte and the gear-change lockout all live here and nowhere else. Ledger TANK-12.

Register identities, both proved rather than assumed: `edx = [edi+0x60]` is the
**`PhysicsEngine`** (the `0x0823e499` error path prints `"No physicsNodeComp!"`,
string `0x086c11e3`), and `esi` is the **`EngineTemplate`**
(`[edi+0x4c]->queryInterface(0x8c230)` then `−0x1b0`, the same pattern
`PhysicsEngine::init` `0x0824c82f` caches at `+0x9c`).

### The rev filter

```
revs += 0.05 * ((T1 - L) - 0.5 * revs)          clamped to [-1.0, +1.2]
```

stored to `PhysicsEngine+0xa0` at `0x0823e37f` (or forced to 0.0 at
`0x0823e2ec` when the engine-off flag `Engine+0x142` is clear — the same flag
`handlePlayerInput` `0x0823e5ef` reads). Filter at
`0x0823e2bf`–`0x0823e2e4`; clamp arms `0x0823e2f4`–`0x0823e309` against
`ds:0x86c4f64` = **1.2f** (`9a 99 99 3f`) and `0x0823e30b`–`0x0823e31e`
against `ds:0x86b05ec` = **−1.0f** (`00 00 80 bf`). **Both arms are
type-independent** — a tank's effective 1.0 is §2's `& 4` clamp, not this.

**`0.05` is `ds:0x86c08a8` and it is per call, not per second.** The only uses
of `dt` in the whole function are `fdiv [esi+0x374]` at `0x0823e23f` (the
gear-change lockout) and the three `RotationalBundle::calculateAndClipAngle`
calls. So the filter's time constant is **40 engine ticks**, whatever the tick
rate is, and a model that normalises it per second spools up wrongly at any
other rate.

### `T1` is not the pedal

The first term is **not** `Engine+0x124`, the raw roll input. It is computed at
`0x0823e1e0`–`0x0823e1f4` as

```
T1 = Engine+0x10c / getMaxRotation().z
```

— the **clipped `RotationalBundle` roll angle** over `maxRotation.z`
(`getMaxRotation` `0x0823fd50` returns `tmpl+0x15c/+0x160/+0x164`; angles live
at `Engine+0x104 + 4·axis` and inputs at `+0x11c + 4·axis`, per
`calculateAndClipAngle` `0x081d7490`). The sibling
`Engine+0x104 / maxRotation.x` becomes `PhysicsEngine+0xb0`, the steering term
§2's differential multiplies by 1.5.

Numerically a pedal reading gets away with it — the Willys'
`setMaxRotation 0/0/5000` with `setMaxSpeed 0/0/55000` reaches T1 = 1.0 in about
0.09 s, and the Sherman's and M3A1's `0/0/1` with `setMaxSpeed 4/0/10` in about
0.1 s, so **T1 = 1.0 at full throttle on all three**. But the identity is wrong,
and it is exactly why a mod that changes `maxRotation` or `maxSpeed` on an
`Engine` changes its throttle response.

`Engine+0x124` is read **once**, at `0x0823e260`, to set the brake byte:

> `PhysicsEngine+0xb4 = 1` iff (`P < −0.1` and `revs > 0`) or (`P > +0.1` and
> `revs < 0`) — the pedal opposing the rev direction. Thresholds
> `ds:0x86cf658` = −0.1 and `ds:0x86ba1d8` = +0.1, both **doubles**. Set at
> `0x0823e2b8`, cleared at `0x0823e472`. §5's grip target tests it and zeroes
> itself on it.

### The load, `L`

`PhysicsEngine+0xa4`, cleared every `handleUpdate` at `0x0823e3fd` (with the
count `+0xac` at `0x0823e407`, and the previous value saved to `+0xa8` at
`0x0823e3f7`). Its **only** writer is `PhysicsEngine::feedbackLoop`
(`0x0824c850`), whose only ground-vehicle caller is `addFriction` at
`0x0825bc45`, passing the Coulomb-clamped friction velocity change and the
wheel forward — **unscaled**; the `×30` at `0x0825bc67` happens afterwards.

```
L0 = dot(v, fwd) * getCurrentRatio() / getCurrentTorque()
  & 2 (car, tank) : clamp L0 to [-1, 1] and rescale v by the ratio
  & 4 (tank)      : L = frame MIN of L0 when revs > 0, MAX when revs <= 0
  otherwise (car) : L = (L*n + L0) * 0.99 / (n + 1)
```

`0x0824c877` dot, `0x0824c885` `fmulp`, `0x0824c89d` `fdivrp`; `& 2` test
`0x0824c8ab`; `& 4` test `0x0824c90f` with the min/max block
`0x0824c917`–`0x0824c950`; car mean `0x0824c952`–`0x0824c97e` with `0.99` at
`ds:0x86d0cdc` and the count at `+0xac`.

### Shifting

- **Up** (`0x0823e391`–`0x0823e3c7`): `revs > gearUp` **and** `b == 0` **and**
  `gear < numberOfGears` → `gear++`.
- **Down** (`0x0823e3d0`–`0x0823e3f1`): `revs < gearDown` and `gear > 1` →
  `gear--`. **No `b` gate.**
- `gearUp` / `gearDown` / `gearChangeTime` are read **here and nowhere else** —
  an exhaustive `[reg+0x36c/0x370/0x374]` scan finds only the two ctors,
  `makeScript`, and the `ConsoleClass65/66/67` setter/getter pairs.
- `PhysicsEngine+0xbc`, the gear index, is written only here and by the ctors.
- `b` is `PhysicsEngine+0xb8`, the gear-change lockout §5 needs. Ctor defaults:
  `gearUp` **0.7**, `gearDown` **0.3**, `gearChangeTime` **1.0**.

### Not the gearbox

The `[esi+0x528]` / `[esi+0x52c]` block at `0x0823e320`–`0x0823e371` is **engine
heat** — `HeatIncrement` / `CoolingFactor`, cf. `Engine::hasHeat`
(`0x0823ec5f`) — gated on `HeatIncrement > 0`, whose ctor default at
`0x0823f082` is **−1.0**. No ground vehicle authors it, so none enters the
block. At heat ≥ 1.0 it sets `Engine+0x142 = 0` and the revs to 0.

## 5. What actually propels a ground vehicle

**Not a hull thrust.** `PhysicsEngine::updatePhysics` (`0x0824cbb0`) **returns
at its second instruction** for a car or a tank:

```
824cc04: mov eax,[edi+0x9c]       ; the EngineTemplate cached by PhysicsEngine::init
824cc10: call [edx+0xa0]          ; getEngineType()
824cc16: and eax,0x1
824cc1e: jne 824cc28              ; ... the body
824cc20: lea esp,[ebp-0xc] ... ret
```

`c_ETCar` (2) and `c_ETTank` (6) clear bit 0. So a ground vehicle gets **no hull
thrust, no `feedbackLoop` from this path, and never reaches
`noPropellerEffectAtSpeed`** (`tmpl+0x520`, ctor default 100.0 at `0x0823f06e`,
read only at `0x0824cf45` inside `& 1` **and** `& 8`). Only `c_ETPlane`,
`c_ETShip`, `c_ETRocket` and `c_ETTorpedo` run the body — and **ships are on
the thrust branch, not the propeller-spin one** (`& 8` at `0x0824cc89`), with
`& 8` again at `0x0824d047` pinning `PhysicsEngine+0xa0` to 1.0 at
`0x0824d06d`. Ledger TANK-7, refuted.

**What does propel it is the EngineGrip wheel target** — the same one a car uses
— inside `ResponsePhysics::addFriction` (`0x0825b6e0`). Ledger TANK-9,
corrected:

```
T = (1 - 0.5b) * (ratio * diffRPM) * fwd  +  0.5b * ((Vt . fwd)/|fwd|^2) * fwd
```

a **blend against the same axis**, not a scale. First term
`0x0825c2ed`–`0x0825c346` (0.5f at `ds:0x86b05e8`, `fmul [edx+0xb8]`, `fsubr`
1.0f at `ds:0x86ba8d4`); the projection of the contact velocity
`0x0825c4e6`–`0x0825c543`; second term `0x0825c3b1`–`0x0825c3d2`; summed
`0x0825c3d7`–`0x0825c407`. Both go through
`operator*(float, BaseVector3 const&)` (`0x081906e0`, sret `[ebp+0x8]`, scalar
`[ebp+0xc]`, vector `[ebp+0x10]`, `ret 0x4`).

**`b` is `PhysicsEngine+0xb8` — not the `Engine`'s — and it is a one-shot
lockout nothing re-arms.** A whole-binary store scan finds four writers and no
more: the two ctors `0x0824c74c`/`0x0824c7cc` seed **1.0**, and
`Engine::handleUpdate` subtracts `dt/gearChangeTime` (`0x0823e24f`) and floors
it at 0 (`0x0823e25a`). **Not even a gear change re-arms it** — the gear-up at
`0x0823e3b8` reads `+0xb8` and writes only `+0xbc`. So `b` expires
`gearChangeTime` seconds into the object's life (Sherman and M3A1 0.05 s; the
Willys does not author it, so the ctor default 1.0 s at `0x0823f04a`) and stays
expired. **In all steady driving `b = 0` and `T = ratio · diffRPM · fwd`.**

The old reading — "`+0xb8` defaults to 1, so the steady factor is ½" — mistook a
countdown's seed for its steady value and halved the entire fleet.

**The units are metres per second of contact-patch velocity, with no wheel
radius**, three ways:

1. `T` is differenced against `Vt`, a linear relative velocity built at
   `0x0825b9c3` (the brake branch at `0x0825c2a3`–`0x0825c2b8` computes
   `0 − Vt`).
2. The only wheel radius anywhere on this path is inside
   `ResponsePhysics::SpinWheel` (`0x0825b440`), and it **divides**:
   `0x0825b4d9`–`0x0825b4f9` takes the mesh bound
   `([eax+0x10] − [eax+0x4])·0.5` as the radius and accumulates `speed / radius`
   as degrees at `+0xc0`. Visual only.
3. `getBoundingRadius` is never called here.

The brake byte `PhysicsEngine+0xb4` (§4) is tested at `0x0825c28a`: set, it
discards the target and zeroes it (`0x0825c293`).

**A tank turns because its two sides' targets differ**, through §2's `& 4`
branch on the two `c_PGFEngineGrip` bogie springs — nothing applies a yaw torque
to the hull.

## 6. The fleet, against the real vehicles

With §4's rev ceiling and §2's per-type cap, the closed form is
`top = ratio_top × revcap` in m/s, `revcap` = **1.2 for a `c_ETCar`** (the
unclamped `diffRPM`) and **1.0 for a `c_ETTank`** (the `& 4` clamp).

| | ladder top | top | reverse |
|---|---|---|---|
| Willys (`c_ETCar`, 5 gears, `differential 7`) | 26.0638 | **31.28 m/s = 112.6 km/h** | 7.00 m/s = 25.2 km/h |
| Sherman (`c_ETTank`, 5, `differential 4`) | 14.8936 | **14.89 m/s = 53.6 km/h** | 4.00 m/s = 14.4 km/h |
| M3A1 (`c_ETTank`, 4, `differential 5`) | 18.6170 | **18.62 m/s = 67.0 km/h** | 5.51 m/s = 19.8 km/h |

Per-gear ceilings: Willys 8.40 / 13.36 / 19.60 / 26.73 / 31.28 m/s; Sherman
4.00 / 6.36 / 9.33 / 12.73 / 14.89; M3A1 5.51 / 9.46 / 14.58 / 18.62.

**Nothing holds a vehicle below that.** The filter's steady state is
`revs = 2·(T1 − L)`, so revs pin at 1.2 for any `L < 0.4`; at cruise `T ≈ Vt`,
the friction demand goes to zero and `L → 0`. **No vanilla ground vehicle
authors `setDrag`, `setMass`, `setModDrag` or `setGravityModifier` anywhere in
the Objects archive**, so the only thing between the vehicle and the ceiling is
the friction solver's residual. The shift rule does not hold it down either —
each upshift lands the next gear at 0.55–0.81 of its ceiling, clear of the
0.40/0.45 downshift lines, and the `b == 0` upshift gate is permanently open
after about a second of object life.

The decisive check is not one vehicle but the whole fleet, under the same two
caps:

| model | engine | real vehicle |
|---|---|---|
| Willys, Kübelwagen, KettenKrad, BlackMedal (`c_ETCar`, `diff 7`, 5) | 112.6 km/h | Willys MB 105; Kübelwagen 80 |
| Katyusha (`c_ETCar`, `diff 5`, 4) | 80.4 | ZiS-6 ~75 |
| M3A1, Hanomag, Ho-Ha (`diff 5`, 4) | 67.0 | M3 72 |
| Sherman, PzIV, T34-85, Chi-ha (`diff 4`, 5) | 53.6 | M4 48, PzIV 42, T-34-85 55 |
| Tiger, T-34, Priest, Sexton, Wespe, M10 (`diff 3.5`, 5) | **46.9** | **Tiger I 45** |

Six distinct `differential` values landing within about 10% of six real road
speeds, in the right order, is not a coincidence — and under the retired ½
factor every one of them halves, giving a 23 km/h Tiger and a 56 km/h jeep.

**Undetermined below about 5%:** the settled speed against the 112.6 km/h
ceiling depends on the `PhysicsNode` drag default, which was not read;
independent tick-level simulations landed at 109.6 and 107.6 km/h, inside that
gap. A sanity check from the world rather than the code: Wake's playable
statics span 942 × 857 m and its longest control-point leg,
`ALLIES_north_village → The_Airfield`, is 553 m — 17.7 s at 31.28 m/s, and 42.8 s
at the 12.93 m/s a halved model produces. A jeep dash across Wake is not a
43-second drive in retail.

## 7. Which wheels actually drive

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
- ~~The `bit & 4` gate inside `getCurrentDifferentialRPM`~~ — **closed
  2026-09-20**: it is `getEngineType() & 4` (§1, §2), the differential-steering
  bit, and it brings the `[−1, +1]` clamp that is a tank's real top-speed cap.
  Not an occupancy check.
- ~~`getCurrentTorque`'s own curve control points — relevant only to engine-sound
  fidelity~~ — **closed 2026-09-20**: the points are read (§3) and the curve is
  load-bearing drivetrain, as the divisor of `feedbackLoop`'s load (§4).
- **The `PhysicsNode` drag default** is the one number between §6's closed-form
  ceiling and a settled top speed, and it was not read. Everything above it is
  settled; the gap is about 5%.
- **`Engine::handleUpdate`'s own client twin** has not been located. Every
  address in §4 is lnxded.
- The **`& 2` rescale of `v`** inside `feedbackLoop` (`0x0824c8ab`) was read as
  a clamp-and-rescale but its factor was not traced to a name.
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
