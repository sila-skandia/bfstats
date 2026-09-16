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

## 3. The angle update: two accumulators, and an open closed form

`RotationalBundle::calculateAndClipAngle` (`0x081d7490`, GUN-2) drives the
angle each tick from **two cooperating per-axis registers**, not a single
accel/clamp formula:

- `+0x110` accumulates `|acceleration| × dt`.
- `+0x128` accumulates raw input, hard-clamped to **±40** (constants
  `0x86c866c`/`0x86c8670` — not the template's `maxSpeed`) and deadzoned
  against `±1.0` (`0x86b05ec`).
- `angle += reg[0x110] × reg[0x128]`, plus a further term
  `+= (…) × continuousRotationSpeed`.
- `automaticReset` (`+0x1a4`) branches whether the sign-corrected
  `|acceleration|` multiplies `maxRotation` or `maxSpeed` — this downstream
  use was not closed out.
- A **zero-width `[minRotation, maxRotation]` wraps the angle at ±180°**
  (constants `0x86c031c`/`0x86c0320`/`0x86c0324` = 180/360/−180) instead of
  clamping it — the engine's way of saying "this axis is unlimited."

**Do not ship the naive `accel·dt`, clamp-to-`maxSpeed` formula — it does
not match the binary.** The exact closed form these two registers combine
into is still open; what is confirmed is the structure (two registers, the
wrap behaviour, the clamp targets, and that `dt` threads through). A viewer
without the closed form should implement a tunable eased approach toward an
input-scaled target, not a literal transcription of the wrong formula.

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

- **GUN-2**: the exact closed-form magnitude of the two-register angle
  update — structure, wrap, and clamp targets are confirmed; the final
  formula the two registers combine into is not. Best next step: trace
  where the `automaticReset`-branch's `signedAccel × {maxRotation |
  maxSpeed}` product is actually consumed.
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
- [ingame-hud.md](ingame-hud.md)'s open items: `IconLookRotation`'s writer
  and unit for the turret-dial HUD icon feed off this subsystem's rotation
  state but were not traced from this side either.
