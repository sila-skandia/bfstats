# Manned guns: aiming, firing, heat

Settled 2026-09-16 for the map viewer's `seats.js` gun runtime and
`gunfire.js`. All addresses `bf1942_lnxded.static` unless marked client. How
a seated gunner aims and fires a Defgun, an AA mount, a
Stationary_Browning/MG42, or a ship's secondary battery.

## 1. What a manned gun actually is

There is no dedicated "manned gun" class. A no-Engine `PlayerControlObject`
is either a real manned gun or a bare seat, and `vehicleType` is not a
reliable way to tell them apart (GUN-10). The discriminating shape,
independently reproduced byte-for-byte across 8,557 templates in vanilla
plus 17 mods: `PlayerControlObject` → `EntryPoint` + a yaw
`RotationalBundle` → a pitch `RotationalBundle` child → `FireArms` + a
neutered `Camera`. A gun needs a `RotationalBundle` that actually moves
(nonzero `maxSpeed`) *and* a `FireArms`; the same five-part tree with
neither is a bare seat someone just sits in.

## 2. `RotationalBundleTemplate`: the fields, defaults, and what doesn't
   exist

`makeScript` (`0x081d9450`, GUN-1) lays out `minRotation +0x150`,
`maxRotation +0x15c`, `pivotPosition +0x168`, `maxSpeed +0x174` (default
`1,1,1`), `acceleration +0x180` (default `.1,.1,.1`), `continousRotationSpeed
+0x18c` (the engine's own spelling), `inputToYaw/Pitch/Roll
+0x198/+0x19c/+0x1a0` (default `0x37` = `c_PINone`), `automaticReset
+0x1a4`, `automaticYawStabilization +0x1a5`, `automaticPitchStabilization
+0x1a6`, `rememberExcessInput +0x1a7`, `lesserYawAtSpeed +0x1ac` (with a flag
at `+0x1a8`). Vec3 "is this field still at its default" tests throughout are
epsilon-compared (±0.0001), never bit-exact. `setRegulatePitch` does not
exist as a property at all — zero string hits in either binary, so nothing
in the corpus's older notes about it should be trusted.

**`setInputToYaw/Pitch/Roll` names a Vec3 slot, not a fixed semantic axis
(GUN-11).** Yamato's `YamatoSmall1CannonBase` genuinely calls
`setInputToRoll c_PIMouseLookY` — roll-as-elevation is real, not a data
error. `AA_Allies_RotatingCrank` binds a raw integer `4` straight to pitch.
**Correcting an earlier example: Katyusha is yaw-only, not yaw+roll.**
`Katyusha_Ramp_Rot` has only `setInputToYaw c_PIMouseLookX`; its nonzero
roll slot in `setMinRotation`/`setMaxRotation` is unbound dead data, never
read by anything. An 18-install survey tallies `c_PIMouseLookY`/`X` at
14,275/11,952 bindings, `c_PIYaw`/`Pitch`/`Throttle` at 1,042/937/855, and
337 axes bound to `c_PIFire` — that last group was not traced into any
specific weapon's firing code.

## 3. The angle update: a first-order velocity servo (closed 2026-09-19)

`RotationalBundle::calculateAndClipAngle` (`0x081d7490`, GUN-2) was read in
full — all 361 instructions, with every `fnstsw` / `test ah` decoded from the
flag encoding, and then re-traced independently by a verifier. It is **a
first-order velocity servo**, not the product of two accumulators the 2026-09-16
pass described:

```
if (acceleration[a] == 0 && continousRotationSpeed[a] == 0) return;

X = rememberExcessInput ? spend(backlog) : rawInput[a]        // see below
s = (acc > 0) ? +X : (acc < 0) ? -X : 0.0f                    // literal 0.0 when acc == 0

if (automaticReset)                                           // a DIFFERENT law
    angle -> s * maxRotation[a]   at |acc| deg/s, clamped at the target both ways
else
    speed(+0x110) -> s * maxSpeed[a]  at |acc| deg/s^2
    angle(+0x104) += speed*dt + continousRotationSpeed*dt     // the second term is unconditional

if (maxRotation[a] == 0 && minRotation[a] == 0)  single +-360 correction   // the WRAP
else if (angle > max) angle = max; else if (angle < min) angle = min; else [this+0x141] = 0
```

Four corrections to the old reading, each of which changes what a viewer should
do:

- **`+0x110` is an angular-speed register in deg/s**, ramped toward
  `sign(acceleration) · input · maxSpeed` at `|acceleration|` deg/s². The angle
  is integrated from it. There is no "product of two registers".
- **`+0x128` is an input *backlog*, and it only exists under
  `rememberExcessInput`.** It accumulates raw input, is clamped to ±40
  (`0x86c866c`/`0x86c8670`), spends `clamp(backlog, ±1)` per tick and carries
  the rest, and is zeroed outright when the input's sign flips. `0x86b05ec` =
  −1.0 is the **lower end of that clamp, not a deadzone**.
- **`automaticReset` is a separate control law**, not a branch inside this one:
  the angle ramps straight toward `input × maxRotation` at `|acceleration|`
  **deg/s**, with no velocity register and no continuous-rotation term. 221
  vanilla declarations (steering wheels, Engines) currently run under the wrong
  law in our viewer.
- **The ±180 wrap needs `minRotation == 0 && maxRotation == 0`** — the template
  default, i.e. "this axis was never given a range" — not merely a zero-width
  range. A template declaring `min == max == 45` is *pinned at 45* by the
  engine; 346 axes across 16 installs do exactly that, three of them in vanilla.

`handleUpdate` (`0x081d78e0`) calls it per axis only when that axis's
`maxSpeed != 0`, and skips the block entirely when all three are zero — which is
the mechanism behind GUN-7. It has **eight** call sites, not three:
`Engine::handleUpdate` gates the same way, **`FloatingBundle::handleUpdate`
(`0x082401cd`) gates on `maxRotation.y` instead**, and **`Wing::handleUpdate`
(`0x0825099b`) does not gate at all**. A second `handleUpdate` branch gated on
`lesserYawAtSpeed` is unread but dead: `setLesserYawAtSpeed` has zero uses
across all 18 installs.

### The one thing still open: what an input unit is (GUN-2b)

The closed form gives the *shape*. It does not give the rate a Sherman's turret
actually turns at, because **`maxSpeed` is a gain — deg/s per unit of input —
and nothing establishes that the input is normalised to ±1**:

- The ±1 clamp lives **inside the `rememberExcessInput` branch only**, and of
  1,468 declarations of that word across 18 installs, **vanilla's 32 are all
  aircraft rudder and tail-flap `Wing` bundles**. Not one turret, manned gun,
  tank or `Objects.con` rotational bundle declares it. For every turret, `X` is
  the raw input.
- The wire format reserves headroom to **±16**: `PlayerAction::set`
  (`0x081128a0`) packs each `PlayerInput` float with `floatToFixed(v, 12,
  16.0f)` and `PlayerAction::get` (`0x0815c5a0`) decodes
  `((n/4095)·2 − 1)·16.0`. A ±1 quantity would leave 15/16 of the encoding dead.
- `RotationalBundle::handlePlayerInput` multiplies the input by 0.2 for a
  critically damaged vehicle (hitpoints-and-damage.md §7). Scaling a
  already-normalised unit that way would be odd.
- And the observation that motivated the viewer's own `TURRET_SPEED_SCALE` — "a
  soldier's head turns about nine times faster for the same hand movement" —
  compares two different control laws: `SoldierCamera` declares
  `setMaxSpeed 0/0/0`, so `handleUpdate` never enters this function for it, and
  `game.setInfMouseSensitivity` and `setLandSeaMouseSensitivity` are both 0.25
  by default.

So the claim that every vanilla gun traverses four times too fast is **not
safe**, and the scale must be left alone until someone reads the client's
mouse-axis → `PlayerInput` multiply. The trail runs as far as the
`ControlMap.addAxisToAxisMapping` registrars (`FUN_006bba90` / `FUN_006bbd90`,
strings `0x00920abc` / `0x00920bb4`). *If* `|input| ≤ 1` held, `ShermanTower`'s
`setMaxSpeed 35/25/0` with `setAcceleration 1000/0/0` would put a quarter turn
at 2.59 s and a full circle at 10.3 s; that is not obviously wrong for BF1942,
but it is not what `maxSpeed` guarantees either.

`RotationalBundle::setState()` (`0x081d8110`, GUN-3) — the function
`automaticReset` actually drives — **clamps** a stored angle into
`[minRotation, maxRotation]`. There is no spring-to-centre anywhere in this
code; it always rebuilds the transform from `pivotPosition + angle`, once
per call. `RotationalBundle::handlePlayerInput` (`0x081d8340`) never
references its own `dt` parameter at all; per-channel input is scaled ×0.2
when instance flag `+0xee` is set.

## 4. The gunner's camera

A gunner's `Camera` never moves itself — it rides the aiming
`RotationalBundle` as a child (GUN-7). Every sampled gunner camera declares
`setMaxSpeed 0/0/0` and `setAcceleration 0/0/0`; `CameraTemplate` is a
distinct class from `RotationalBundleTemplate`
(`CameraTemplate::makeScript` `0x081acd60`, `setHasTarget` `0x081ad3d0`,
`Camera::handlePlayerInput` `0x081aa490`).

**No vanilla manned gun zooms (GUN-6).** An exhaustive search of all 1,753
vanilla files: zero declare `vehicleFov`. All 22 `zoomFov`/`useScope`
declarations across every installed mod sit in exactly 17 `HandWeapons/`
files, none in `Vehicles/` or `Stationary_Weapons/`. If a mod's `FireArms`
ever does carry these words, treat it exactly like a hand weapon's zoom
([handweapon-view-and-deviation.md](handweapon-view-and-deviation.md)),
not as a new mechanism.

## 5. Firing: magazine, reload, and heat

Vanilla's magazine/reload/heat vocabulary on vehicle `FireArms`: `magSize
-1` plus `numOfMag 999` is the unlimited-ammo sentinel pairing. Heat words
(`heatAddWhenFire`/`coolDownPerSec`/`timeDelayOnOverHeat`) exist on exactly
**seven** files (GUN-4) — `Browning`, `Browning_Air`, `Mg42`,
`Coaxial_Browning`, `Coaxial_Mg42`, `Browning_unlimited`,
`MG42_unlimited` — inherited by every `Stationary_Browning`/`MG42` via
`addTemplate` (`Mg42_Air` ships the same words, commented out). Client
storage: `heatAddWhenFire → +0x4fc` (a plain float), `coolDownPerSec →
+0x500` (stored **per-tick** — divided by `g_simulationFps` = 30 on
write, multiplied back by 30 on read), `timeDelayOnOverHeat → +0x530` (plain float,
seconds).

**Fire is refused by a longer, and differently-ordered, gate than "reload
or empty" (GUN-5).** `isReadyToUseFire`/`isAnimationReadyToUse`
(`0x0828f660`/`0x0828f780`) check, in this order: two flags at `+0x1fc` and
`+0x20c` whose identity is unresolved; the eject-clip timer; the reload
timer; the overheat timer; **the fire-rate (`roundOfFire`) cooldown
timer** — not previously reported as its own gate; a third unidentified
flag at `+0x294`; and finally ammo (refused on an empty active magazine
unless the `-1` sentinel is set). **`getHasHeat()` is a strict
greater-than, not equality** — `0x0828d490` = `template+0x300 >
template+0x304`; what those two fields actually represent is still open.

Representative heat numbers, all reconfirmed exact: 0.04 add / 0.4
cooldown-per-second / 2 s overheat delay for the non-coaxial guns, 0.05 /
0.3 / 2 for the coaxial pair.

## 6. Projectile flight — reused from the general case

A gun's shell is an ordinary [projectile](projectiles-and-impacts.md): the
Defgun's is `velocity 125` m/s, default `gravityModifier 1.0`, a flat
`timeToLive` of 10 s, no `drag` word on any vanilla projectile (GUN-9). The
real integrator is the same fixed-tick, four-substep `PointPhysicsNode`
every other physics body uses ([physics.md](physics.md) §3) — `gunfire.js`'s
present one-explicit-step-per-rendered-frame approximation (GUN-8) matches
the *data* but not the *integration scheme*; `viewer/flight.js`'s
`axisAngle`/`RiggedPart` rig label is likewise a position-driven
approximation with no persisted state, correct-looking today only because
it has never yet had to drive a manned gun's actual control law — §3 above
is what closes that gap.

## Open

- ~~**GUN-2**: the exact closed form~~ — **closed 2026-09-19** (§3): a
  first-order velocity servo, `automaticReset` a separate law, the backlog a
  spend-and-carry that only `rememberExcessInput` enables.
- **GUN-2b**: what magnitude the client's mouse-look axis delivers as
  `PlayerInput[c_PIMouseLookX/Y]`. Until that is read, `maxSpeed` is a gain
  with no known unit and no absolute traverse rate can be quoted (§3). Next
  step: the client's `ControlMap.addAxisToAxisMapping` pipeline from
  `FUN_006bba90` / `FUN_006bbd90`.
- **GUN-5**: the two unidentified fire-gate flags at `+0x1fc`/`+0x20c` and
  the third at `+0x294`; what `getHasHeat`'s two compared fields represent.
- `automaticYawStabilization`/`automaticPitchStabilization` (`+0x1a5`/
  `+0x1a6`) — offsets confirmed twice now, consuming code still not
  located.
- The 337 `c_PIFire`-bound `RotationalBundle` axes — reproduced exactly as
  data, never traced into a specific weapon's firing behaviour.
- No client (`BF1942.exe`) twin exists for `RotationalBundle::handleUpdate`/
  `handlePlayerInput`/`calculateAndClipAngle`/`setState`, or for
  `CameraTemplate`'s constructor — everything in §2–§4 is lnxded-only so
  far.
- ~~[ingame-hud.md](ingame-hud.md)'s open items: `IconLookRotation`'s writer
  and unit~~ — **closed 2026-09-19** from the HUD side (VHUD-9): it is not read
  off this subsystem's rotation state at all, but recomputed each frame as
  `atan2(dot(pcoRight, camForward), dot(pcoForward, camForward))` in radians.
