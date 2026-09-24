# In-game HUD: one variable registry, three fill-node classes

Settled 2026-09-16 for the map viewer's `hud.js`. Client-only
(`BF1942.exe`, sha256 `60c9452d…`) — the HUD is drawn, so there is no lnxded
twin; every address below is a client address. The `menu/InGame` data this
code drives is read by [meme.py](../../../tools/bf1942-models/bf42/meme.py)
and flattened by
[extract_hud_layout.py](../../../tools/bf1942-models/extract_hud_layout.py)
into `hud-layout.json` (ledger MEME-14): eleven independently-gated top-level
groups — soldierIcon, soldierAmmo, vehicleIcon, vehicleHealth, vehicleSeats,
primaryAmmo, secondaryAmmo, supplyIcon, hitIndicator, weaponBar, crosshair —
each already absolutely positioned in the 800×600 virtual screen, the same way
as the spawn screen's `MEME-12` neighbours. This doc is the engine code
*behind* those groups' `Variable`/`Maximum`/`Fill order`/`AmmoType` fields:
where a number comes from, how often it changes, and what the three shared
picture classes do with it.

## 1. One generic registry, four typed wrappers

Every named HUD variable — `Soldier/SoldierHitPoints`, `Ammo/PrimaryAmmo`,
`Vehicle/VehicleIcon` — goes through the same mechanism (HUD-1). A group
object (`SoldierHud`, the vehicle registrar, `AmmoHud`, …) owns a set of raw
C++ fields; at construction it hands each one to a typed registrar —
`RegisterIntVariable` `0x0069eb50`, `RegisterBoolVariable` `0x0069b810`,
`RegisterFloatVariable` `0x006b3ae0`, `RegisterPictureVariable` `0x0069b880`
— which wraps the field's address into the group's registry through a shared
`register()` (`0x007ebab0`), keyed by name and an `onCreate` flag. A
`.meme` file never hard-codes a value; every `Variable=`/`Maximum=` binding
on a fill node is a **name** that resolves, at load time, to one of these
live pointers.

The picture registrar takes a third argument beyond `(name, group)` — the
address of a default-path field — but its own ctor body (`0x007e9e20`) never
reads that argument, so exactly what it is for is unresolved.

## 2. The Soldier group: pose, icon and health-bar art

`SoldierHud` (ctor `0x006e95e0`, dtor `0x006e9640`, `registerVariables`
`0x006e92a0`) is the client's own on-foot HUD state, registering names to
seven raw fields at `+0x14/+0x18/+0x1c/+0x20/+0x24/+0x44/+0x64` (HUD-2). Six
are named directly in the registration code: `SoldierHitPoints`,
`SoldierMaxHitPoints`, `SoldierHealthBarIcon`, `SoldierHealthBarFullIcon`,
`SoldierIcon`, `ShowSoldierIcon`. `SoldierBarSize` and `SoldierType` are the
remaining declared names, but the client itself never writes either — a
0-hit exhaustive string search confirms nothing sets them at runtime, so a
viewer should treat `SoldierBarSize` as the file's own authored constant
(64 in vanilla) rather than something game state changes.

**Update cadence — once per rendered frame, not the 30 Hz sim tick (HUD-3).**
`0x006ad0a0` has exactly two call sites, both from `Renderer_drawFrame`
(`0x00466d80`). It calls `SoldierHud::setPoseAndIcon` (`0x006e9430`) when the
current control object's class id is `0x9493` (`CID_BFSoldierTemplate`) —
writing the stance pose and pushing the stance-icon path through a cached
picture handle — or `SoldierHud::reset` (`0x006e9570`) otherwise, which zeros
the pose and falls back to a cached icon. So switching into a vehicle does
not hide the soldier icon outright; it resets it to standing + fallback art.
Health-bar icon refresh is a separate call, `SoldierHud::setHealthBarIcons`
(`0x006e94b0`), gated on the player's own body independent of vehicle
occupancy; its two feeders (`0x006ac780`/`0x006ac760`) were not opened.

The numeric values behind `SoldierHitPoints`/`SoldierMaxHitPoints` are not
pushed by this per-frame function at all — they are the live fields on the
soldier's own `Armor` component ([hitpoints-and-damage.md](hitpoints-and-damage.md)),
written whenever `Armor::setHitPoints`/`heal`/`damage` run during simulation.
HUD-3 says how often the *icon selection* refreshes, not how often the
*numbers underneath the bar* change.

**Stance formula (HUD-4).** `getSoldierPose` (`0x004f6ca0`):
`(flags & 0x20) ? 1 : (flags & 0x40) >> 5` — 0 standing, 1 crouching,
2 lying, from the same flag family as movement-speed selection. Which
nation key turns that pose into `Soldier/Icon_<nation>_soldier_<pose>.tga`
was not read — open.

## 3. Three fill-node classes, one `draw()`

`BfPictureFillNode`, `BfVariablePictureFillNode` and
`BfVariablePictureFillNode2` all share one draw path: their vtable `+0x54`
slot is the *same address*, `0x007e74c0`, confirmed by a direct memory read
of all three vtables (not inferred from behaviour) — 69 xrefs delegate on to
`PictureNode::draw` `0x007ebfd0` (HUD-5). Only their `update()` (vtable
`+0x68`) differs: `0x007dcb10` / `0x007dccf0` / `0x007dceb0` respectively.
`BfVariablePictureFillNode2` is the class every HUD bar in vanilla actually
uses — health, ammo, heat, reload, recover.

**The fill fraction (HUD-6).** The base helper `0x007dc610` computes
`visibleFraction = (Size / textureNativeDimension) × (Variable / Maximum)`;
the Size-variant `0x007dc690` divides by the node's own `Size` field instead
of an external texture dimension. Either way, a fill node with no `Maximum`
binding reads as **0**, not full — an unbound bar shows empty, not solid.

**`Fill order` only affects vertical bars (HUD-7).** `false` = top-anchored,
fills downward; `true` = bottom-anchored, fills upward — read directly out
of `0x007dceb0`'s `update()`. The horizontal branch (`0x007dc710`) never
tests that bit at all. Data-confirmed: the retail health bar's `Fill order`
is `True` (bottom-anchored, fills up as HP rises); the ammo bar's own
`Fill order` (`False`) is moot because that bar is horizontal.

## 4. `TransformNode`: the whole coordinate law

`TransformNode::draw` (`0x007e92b0`, HUD-8) is where every rect in
`hud-layout.json` ultimately comes from: a child accumulates
`parent.xy + local.xy`, plus its own `w`/`h`; a sibling that is not itself a
`TransformNode` just reuses the parent's rect unmodified. This was confirmed
by full register-level disassembly, not the decompiler alone — Ghidra
mistypes a parameter here. There is a second, context-gated branch (a sixth
"context" parameter, a call to `0x007f46a0`, a sign-flip) that was not
traced. It is confirmed irrelevant to every static HUD bar — every rect this
round measured reproduces to the pixel under the simple accumulation rule —
but that is not the same as proving it covers 100% of the class's behaviour.

## 5. The hand-weapon ammo panel

When `Ammo/AmmoType == 1` (magazine weapon), the panel is a
`BfVariablePictureFillNode2` bound to `SoldierAmmoBar`/`Fill`/
`Ammo/PrimaryAmmo`/`Ammo/MaxPrimaryAmmo`/`SoldierAmmoBarSize` (20), positioned
through a `BfTransformNode` whose `PosX`/`PosY` are themselves OBJ-bound
variables rather than file constants — vanilla's own data reads
`SoldierAmmoPosX=6`, `PosY=4294967279` (−17 as an unsigned 32-bit write).
`PrimaryAmmo` (rounds in the active magazine) sits top-right; `PrimaryMag`
(spares) sits in its own black-tinted box (an `EffectNode` wrapping
`ColorEffect(0,0,0,1)`), gated visible by `SoldierAmmoHasMag` and hidden
outright when `PrimaryMag == -1` (HUD-9).

**The two enumerations are one enumeration (HUD-10, closed 2026-09-19).**
`Ammo/AmmoType`'s `.meme`-side value and `setHudAmmoType`'s `.con`-side value
are the **same** enum, and there is no converter to find — the row's premise was
wrong. `operator>>` (`0x004c4cd0`), decompiled in full, gives **seven** named
values plus a fallback:

| value | name | what the panel draws |
|---|---|---|
| 0 | `ATNone` | nothing (no leaf tests 0) — vanilla's knives |
| 1 | `ATAmmoBar` | magazine panel + fill bar + rounds + mag box |
| 2 | `ATIcon` | panel + icon + **rounds text**, no bar — Bazooka, Panzerschreck, ExpPack, Detonator, Landmine |
| 3 | `ATIconAndStrengthBar` | panel + icon + rounds + bar (heatbar art) — grenades |
| 4 | `ATIconAndReloadBar` | panel + icon + reload bar, **no** rounds — RepairPack |
| 5 | `ATIconNoText` | panel + icon only |
| 6 | `ATIconAndHeatBar` | panel + icon + heat bar — MedPack |
| 7 | anything unrecognised | panel + icon + reload bar |

`menu/InGame` gates three mutually exclusive copies of the soldier panel on the
numeric value directly: `eq 1`; `∈ {2,3,4,5}` with the rounds text gated
`ne 4 && ne 5 && ne 6` and `eq 3`/`eq 4` selecting the strength/reload bar; and
`∈ {6,7}` with `eq 6`/`eq 7` doing the same. So **2 is tested** — as a member of
that group; an earlier reading that "0 and 2 are tested by nothing" was wrong —
and a **dead `eq 6` leaf nested inside the `{2,3,4,5}` group** can never fire.
The shifted-by-one hypothesis is excluded because `.meme 1` draws a magazine
panel and would otherwise have to be `ATNone`.

The practical consequence is one line in the viewer: feed the weapon's own
value, so an `aticon` weapon gets **2** and shows its rocket count, not 6, which
is the MedPack's heat bar. `setHudAmmoType` has been parsed by `bf42/con.py`
(as `hud_ammo_type`, emitted `hudAmmo`) since before this round — the claim that
it is a missing extractor word is false.

Survey across all archives of 18 installs: `ATAmmoBar` 1076, `ATIcon` 542,
`ATIconAndStrengthBar` 379, `ATNone` 229, `ATIconAndHeatBar` 54,
`ATIconAndReloadBar` 23, `ATIconNoText` 1; vanilla declares 37.

**Still open from that row:** `AmmoHud::registerVariables` (`0x006e9f30`) is
reached only through a data vtable slot inside the HUD singleton `0x00a5f1a8`
(offset `0x9260fc`), never a direct constructor call, so which of that
singleton's roughly eighteen slots actually *owns* the Ammo group is unresolved.
A weak lead — `0x00a5f1a8[0xc]`'s own object (`0x006ccc20`, fifteen embedded
string slots) — looks more like a multi-weapon vehicle row than a plausible home
for one ammo-type integer. Note also that the weapon-icon registrar puts
`NumberOfWeaponIcons` at `+0xc` of a *different* object in the same `"Ammo"`
group, so `+0xc` alone does not identify the owner.

## 6. Vehicle and manned-gun HUD

One client constructor, `0x006d6500`, registers the entire `Vehicle/*`
namespace plus `Occupied/OccupiedData` in a single pass (VHUD-1):
`ShowVehicleIcon`/`ShowTurretIcon` (bool), `VehicleHitPoints`/
`VehicleMaxHitPoints` (float, via the same `0x006b3ae0` the soldier group
uses), `VehicleIcon` (picture, handle cached at `+0x54`), `RedrawVehicleIcon`
(bool), ten-slot `VehiclePosX1..10`/`VehiclePosY1..10` (int arrays), and a
seven-slot `VehiclePlayersText1..7` (string array) behind
`ShowVehiclePlayers`. Vanilla only ever wires six of each ten/seven-slot
capacity — the rest exist for a mod, unused shipped.

**One shared occupied-vehicle icon table, not one per seat (VHUD-2).**
`Occupied/OccupiedData` (class `BfOccupiedVehicleData`, ctor `0x007dd8b0`) is
constructed exactly once inside `0x006d6500` and registered under the group
name `"Occupied"`; every `BfOccupiedVehicleNode` in the file references the
same object by name. Its vtable (`0x0093f300`, read directly as raw bytes)
holds a five-state table: `0` empty, `1` `Icon_vehicledot_local.tga`, `2`
`Icon_vehicledot_empty.tga`, `3` `Icon_vehicledot_friend.tga`, `4`
`Icon_vehicledot_enemy.tga`. Which live state a given seat dot resolves to —
the part that actually needs the occupying player's team and identity — is
unread; that is [seats-and-entry-points.md](seats-and-entry-points.md)'s
territory, not this doc's.

**Ammo-bar enum and its own asymmetry (VHUD-3, VHUD-4).**
`Ammo/PrimaryAmmoBar`/`SecondaryAmmoBar` decode 0–7 via `operator>>`
`0x004c4ef0`: `None, AmmoBarOnly, AmmoBarHeatBar, AmmoBarReloadBar,
HeatBarOnly, ReloadBarOnly, IconOnly, <anything else>`. The bare `.con`
spelling `ABAmmoBar` (no suffix — 520 uses across installed mods) silently
falls through to the same numeric default as a typo: **7** — distinct from
the *named* `IconOnly` (6), one slot earlier in the enum. The count bar's
own visibility test is not symmetric between the panel's two layouts: the
two-icon copy hides it for values `{0,4,5}`, the single-icon copy (and the
secondary weapon's own copy) hides it for `{0,4,5,6}` — read directly out of
both sites in the raw `menu/InGame` dump, not inferred from behaviour.
Neither exclusion set contains 7, so this fallback value does **not** read
as "icon-only" in either layout — do not conflate it with `IconOnly`.

**Crosshair enum and the periscope gate (VHUD-5).**
`CrossHair/CrossHairType` (`operator>>` `0x004c5110`): `None=0, Icon=1,
CrossHair=2, <anything else>=3` — a typo'd spelling falls to 3 exactly like
the ammo-bar enum (44 typo'd instances across 4 variants found in a survey of
8,868 `None` / 2,607 `Icon` / 1,077 `CrossHair` declarations). The entire
crosshair region — the plain crosshair and the sniper-scope overlay both —
is additionally gated behind `NotData(Submarine/ShowPeriscope)`, so a
periscope view suppresses both rather than one replacing the other.

**A `CullNode`'s inline default is not its "shown" value (VHUD-6).** Five
independent gates (`ShowWeaponIcon`, `ShowSoldierIcon`, `ShowCrossHair`,
`Time/ShowTime`, `ControlPoint/ShowControlPoints`) are all
True-by-default *and* shown-by-default, which only makes sense if a plain
named `BoolData` gating a `CullNode` shows its content when the variable is
currently true — the file's `[Value=…]` is that variable's authored resting
default, not a threshold the runtime value must match. No single
instruction implementing `CullNode`'s own runtime test was located; only its
file reader, `meme_CullNode__read` (`0x007f00d0`), lives in the corpus.

**Every rect independently re-walked (VHUD-7).** Vehicle icon: fixed 128×128
native size at (200,462). Health bar: 32×64 at (174,525), gated by a
`CullNode` at file offset 57017. Seat dots: six 8×8 squares at
`(192+VehiclePosX[i+1], 452+VehiclePosY[i+1])`. Turret dial (also gated on
`ShowTurretIcon`): back-plate 64×64@(400,540), pipe 16×32@(418,540), rotating
body 32×32@(410,550). Vehicle-players popup: 220×85@(201,502), six rows at
15 px pitch, clears itself after `VehiclePlayersTimeOut` (3 s). Ammo panel:
two-icon primary/secondary at (600,514)/(720,514); one-icon fallback at
(710,514) — the same anchor as the two-icon primary; the soldier-skin panel
background (shown when `NotData(Vehicle/ShowVehicleIcon)`) sits at
(589,525).

### The turret dial: its trigger, its angle, and which way it turns (VHUD-9, closed 2026-09-19)

Both values are written by the per-frame HUD updater `FUN_006ad0a0` — HUD-3's
function, so once per rendered frame, not per sim tick.

**`Vehicle/ShowTurretIcon` = `(seatCamera->getViewMode() == 3) &&
pcoTemplate->getHasTurretIcon()`.** Client `0x006ae597`–`0x006ae5d1`:
`CALL [EBX_vt+0x34]` (getCameras) → `CALL [+0x14]` (getViewMode) → `CMP EAX,3`,
and on equality `CALL [ESI+0x60]` where `ESI` is
`template->queryInterface(*0x008de480)`; `AL` goes to `HUD_singleton[3] + 0xac`.
**`*0x008de480` is `0xc4c4` = `IID_IPlayerControlObjectTemplate`** (lnxded names
it at `0x086d3c4c`) — an earlier report proposed an invented
`IID_BFArmorOrHudAspect_c4a4` with a guessed value here, which is wrong on both
counts. Dumping that interface's group of `vtable for
PlayerControlObjectTemplate` (`0x0873eba0`, vptr = sym+0x20c) puts
`getHasTurretIcon()` (`0x0831b850`) at exactly **vptr+0x60**, matching the
client instruction; the same table gives `getVehicleIconPos()` at vptr+0x30 and
`getCrossHairType()` at vptr+0x68 (**not** the +0x78 that report claimed). The
neighbouring dword `0x008de484` is `IID_IPlayerControlObject` = `0xc4c5`, which
*is* correct as the corpus had it — only the `0x008de480` entry was wrong.

So the dial is not "any seat with a traverse": it needs the template's own
`setHasTurretIcon` **and** an inside view. In vanilla that word appears on seven
templates — Sherman, Tiger, PanzerIV, T34, T34-85, M10, Chi-ha — always on the
vehicle **root** PCO, never on a casemate hull; 4,195 declarations across 18
installs, 4,160 of them `1`. `bf42/con.py` does not parse it.

**`IconLookRotation` is `atan2(dot(pcoRight, camForward), dot(pcoForward,
camForward))`, in radians**, positive to the PCO's right, pivoted on the
*controlled* PCO's own axes — the hull, for a tank driver. Client
`0x006ae5d9`–`0x006ae616`: two dots, an `FCHS`, `FPATAN`, another `FCHS`, then
`FSTP [EBP+0x320]`. The rows come from `pco->getAbsoluteTransformation()` at
`0x006ad5df` (`+0x20` → row 2 = forward; no offset → row 0 = right; `+0x30` →
translation). Note the layout's own variable name is the bare
`IconLookRotation`, not `Vehicle/IconLookRotation` as this doc and the ledger
used to write it.

**The rotation senses are opposite.** `RotateEffect` ends in
`meme_rotateQuadAboutPivot` (`0x007edbf0`), which computes
`x' = x·cos + y·sin`, `y' = −x·sin + y·cos`: on a y-down HUD frame, `(0,−1)` at
+90° maps to `(−1,0)` — top to the left, **counter-clockwise**. HTML canvas
`ctx.rotate(+θ)` sends top to the right. A viewer that puts the engine's own
value on the wire must therefore rotate by `−angle`, and the two changes have to
land together or the dial mirrors.

`angleMultiplier` scales a draw-context scalar, not the bound variable:
`RotateEffect::read` (`0x007e23a0`) reads `Angle` into `this+4` and
`"Angle multiplyer"` into `this+8`, and `RotateEffect::apply` (`0x007e2300`)
computes `Angle + drawCtx[+0x18] × AngleMultiplier` before calling the quad
rotator — the identity of `drawCtx[+0x18]` is unverified. `hud-layout.json`'s
seven `rotation` blocks all author the multiplier as **0** — six with static angles (3.9, −3.14, 1.57, 2.5,
0.8, −0.8) and one bound to `IconLookRotation`. Leaving it unapplied is correct.

### The `Ammo` and `Overheat` registrar tables (VHUD-10, corrected 2026-09-19)

Re-read from raw bytes with their name strings, because both registrar
functions have vanished from the Ghidra project since the last round.

The weapon-icon registrar (`0x006e8ca0`, group name `"Ammo"`) registers
**thirteen** variables, not twelve: `NumberOfWeaponIcons` +0xc,
`PrimaryAmmoBar` +0x10, `PrimaryAmmoIcon` +0x14, `PrimaryAmmoText` +0x34,
`RedrawPrimaryAmmo` +0x38, `SecondaryAmmo` +0x3c, `SecondaryAmmoBar` +0x40,
**`SecondaryAmmoIcon` +0x44**, `SecondaryAmmoText` +0x64, `MaxSecondaryAmmo`
+0x68, `RedrawSecondaryAmmo` +0x6c, **`UnlimitedPrimaryAmmo` +0x6d** and
**`UnlimitedSecondaryAmmo` +0x6e**. The last two close this document's own
open item: the `Unlimited*` variables do exist, as bools on the weapon-icon
group.

The overheat registrar (`0x006e9820`, group name `"Overheat"`) registers
exactly three: `OverHeat` float +0x8, `ShowRecover` **int** +0xc, `Recover`
float +0x10. **`SniperSight` (bool +0x84) is not one of them** — it belongs to
the `"CrossHair"` group, registered by a different function at `0x006e9a60`.

One shared feeder, `FUN_006d6af0`, computes
`f = heat > 0.1 ? heat/heatMax : (reload > 0.1 ? reload/reloadMax : 0)` and
stores **`1 − f`** into `[this+0x14]+0x8` (selector 1) or `+0xc` (selector 2):
inverted, heat wins, a strict 0.1 dead band on the raw values. **Do not record
field names for those destinations.** `[this+0x14]` is an unidentified group
object — its only caller passes a container of group pointers and reads
`[EDI+0xc]` as the weapon-icon group — and a float written to `+0xc` is
inconsistent with the Overheat group's `int` there.

Also corrected: lnxded's `FireArmsBundle::getAmmo` (`0x08290cd0`) is **not** an
ammo accessor. Its body is the inlined `std::vector::erase(begin,end)` idiom on
`this+0x110` and it reports no count while destructively emptying the vector;
`FireArmsBundle::getTotalAmmo` (`0x08290d20`) is the real reader. Still open:
the client instruction that writes `PrimaryAmmoText` for a drivetrain root, and
which FireArm fills primary versus secondary.

### The seat dots' positions are in the data after all (VHUD-11)

This document recorded that "the dots' positions are live-bound per vehicle and
nothing in the extracted data carries them". They are carried — by
`ObjectTemplate.setVehicleIconPos <x>/<y>`, a `Vec2` on the
**PlayerControlObject template** that the root and every seat PCO declares for
itself (setter lnxded `0x0831b5f0`, getter `0x0831b620` at
`IPlayerControlObjectTemplate` vptr+0x2c/+0x30). The values are positions inside
the 128×128 vehicle-icon texture, which is exactly the space VHUD-7's dot anchor
works in: Sherman's root `54/103` lands at `(192+54, 452+103) = (246, 555)`,
inside the icon's `(200,462)`–`(328,590)` rect.

19,089 declarations across 17 mods, 19,085 of them a single `x/y` token; vanilla
183, all integers, X 12…99 and Y 43…120. Sherman root `54/103` and
`shermanBrowning_PCO1` `32/61`; Yamato root `66/78` with Rear `32/57`, Left
`57/62`, Right `37/73`; Willy root `40/79` and passenger `21/84`. `con.py` does
not parse the word.

**Hit points are not per seat (VHUD-8).** Naval AA mounts are uniformly
`ABIconOnly`; big naval guns are `ABReloadBarOnly`; land/deck MGs are
`ABHeatBarOnly`; torpedo tubes are `ABAmmoBarReloadBar` — every seat of a
multi-PCO vehicle really does carry its own icon and ammo-bar words. But
`hasArmor`/`hitpoints`/`maxhitpoints` are set exactly once, on a vehicle's
**root** `PlayerControlObject`. A survey of twenty-plus companion seat PCOs
across eleven vehicles (Fletcher, Hatsuzuki, PrinceOW, Yamato, Elco80,
Type38, Lcvp, Daihatsu, Enterprise, Shokaku, Sherman) found zero that set
their own hitpoints — one shared `Armor` backs every seat. The HUD's
vehicle-health bar must bind to the vehicle **root**, not the occupied seat;
switching seats within one vehicle never changes the displayed HP (see also
[hitpoints-and-damage.md](hitpoints-and-damage.md) HP-12).

## 7. Crosshair hit indication (XHIT-1..XHIT-10, 2026-09-24)

The four short diagonals that flash at the corners of the crosshair when the
local player's round hits someone. Asked from the owner's recording (Berlin,
DP on foot, 1280×720 of a 2560×1440 game) and traced end to end through both
binaries.

**It is data, not code.** `menu/InGame`'s crosshair top has a third branch
beside the crosshair itself and the scope overlay: a `TransformNode`
(390,290,20,20) whose children are three effects and four quads.

```
BfMultiplyColorEffect2 { Alpha = CrossHair/HitIndicationTime }
VariableColorEffect    { CrossHairRed/256, CrossHairGreen/256, CrossHairBlue/256, CrossHairAlpha }
RotateEffect           { Angle 0.8, multiplier 0 }
PictureNode '' at (-3,-2) 1x3     top-left, turns into  \
PictureNode '' at (18,-1) 3x1     top-right             /
PictureNode '' at (-3,20) 3x1     bottom-left           /
PictureNode '' at (19,19) 1x3     bottom-right          \
```

Its only gates are the group's `ShowCrossHair` and not-periscope — no
`CrossHairType`, no `ScopeIndex` — so it draws over a scope, an icon crosshair
or no crosshair at all, which is why the owner sees it in a plane, a tank and
on foot alike. 17 of 18 installs carry it byte for byte; bfheroes draws a
96×96 picture instead. The flattener used to lose both the rotation and the
alpha binding, so the four quads came out as always-on near-black ticks and
the viewer had to hide the whole group in hip fire to keep them off screen.

**Colour and alpha.** `VariableColorEffect::apply` (`0x006017c0`) *sets* the
quad's four vertex colours; `BfMultiplyColorEffect2::apply` (`0x007d5990`)
*multiplies* them. The effect list is walked innermost first (`0x007ed780`),
so the multiply lands last and the marks are
`(R/256, G/256, B/256, CrossHairAlpha × t)`. `CrossHairAlpha` is never
registered by the client and keeps the file's 1.0. R/G/B are the profile's
`game.setCrossHairColor` (0–255): the shipped default profile is yellow
`255 255 0`, the owner's is red `255 0 0`.

**The timer.** `HitIndicationTime` is a HUD float at `+0x26c`, copied once per
rendered frame from the local player's `+0x1cc` (`0x006aeba1`). A hit sets it
to 1.0; `BFPlayer::update` (`0x00406890`, lnxded `0x080522d0`) runs it down
`t = max(0, t − dt)`. One hit is one second from full to nothing; another hit
resets it to 1.0, so an automatic weapon holds the marks at full for the
length of the burst — the capture's DP bursts do exactly that.

**What raises it — the server decides.** `GameServer::giveDamage` (lnxded
`0x0814b2e0`), before any damage is computed:

- `game.serverHitIndication` is on (`setup+0x324`; the shipped
  `ServerSettings.con` says `1`);
- the attacker id is not −1 and the firing weapon's stat id is ≥ 0;
- the attacker has a `BFPlayer`;
- the damaged object's root parent is a `PlayerControlObject` whose
  `getTeam()` is non-zero.

There is no team comparison, so a friendly hit marks exactly like an enemy one
(the owner's observation), and it runs before `calcDamage`, so a friendly-fire
setting that zeroes the damage does not suppress it. Only
`handleCollisionForProjectile` passes a real attacker and stat id (the round's
owner and `FireArms::fireBarrel`'s stat id). Vehicle rams, falls, `killPlayer`
and the combat-area damage all pass −1. Explosions never reach `giveDamage`:
`handleExplosionOnObject` queues the damage and `gameStatusPlaying` applies it
through `_giveDamage`, which has no hit-indication code. **So: a direct
projectile hit, never splash.** A vehicle's team is its occupants'
(`setTeam` counts them in, `clearTeam` zeroes the team when the last leaves),
so an empty vehicle or emplacement never marks.

**Delivery** (XHIT-6): a listen server writes its own player's timer
directly; a remote shooter's connection gets a `GhostManager` flag, sent as
one bool of the next control-object state and cleared once sent, which the
client turns into `timer = 1.0`.

**Geometry** (XHIT-8, inferred from the capture): each quad turns about its
own centre, in the 800×600 frame, before the HUD's per-axis stretch; the four
predicted mark centres land within a pixel of the capture's.

**Still open:** XHIT-9, whether the HUD batch alpha-tests (which would cut the
marks off before `t` reaches 0 — the capture cannot say through its H.264 skip
blocks); XHIT-5's keep-team template flag; XHIT-10's callers of the
`CrossHair` group's `show()`/`hide()`.

## 8. Hit direction and the red wash (HFD-1..HFD-13, 2026-09-24)

The victim's side of a hit: the whole screen washes red, and an arc marks the
side the damage came from. The viewer used to skip the full-screen quad as an
"artifact". The owner's recording shows it at 9.93 s.

**Two fields, one setter.** `BfMenu` holds `HitFromDir` (an int at `+0x358`,
0 off, 1..8 the octant) and `HitFromDirAlpha` (a float at `+0x360`), and
`BfMenu::setHitFromDir` (`0x006acb60`) is the only code that writes them. It
writes both at once. Nothing in code fades the alpha.

**What the layout does with them.** The `hitIndicator` top (root chain index
37) is:

```
CullNode(HitFromDir)                 draws while HitFromDir != 0, no fade
  TransformNode 0,0,800,600          the wash
    VariableColorEffect {1, 0, 0, HitFromDirAlpha}
    PictureNode ''
  TransformNode ... x8               the arcs; direction 1 behind BoolData{False}
  TimeoutActionNode 0.2              then SetVariableAction HitFromDir := 0
```

So the wash and the arc are one alpha, held until the timeout puts the
direction back to 0. The timer only counts while the chain is shown and fires
in the same update that still draws the frame. Nothing restarts it on a second
hit, so a burst turns the arc and sets a new alpha but ends when the first
hit's flash would have.

**The menu's clock is not wall time.** `BfMenu::paint` updates its menu screen
with `Setup+0x184` once per rendered frame, and that is `1 / g_simulationFps`
= 1/30, a constant. Every `TimeoutActionNode` in `menu/InGame` therefore counts
painted frames: the 0.2 timeout is **six painted frames** (it fires on the
sixth, which still draws), 0.1 s at 60 fps and about 55 ms at the owner's
~110 fps. The recording's three washes last three to four 60 fps frames, and
two hits 0.13 s apart show as two separate flashes, which a wall-clock 0.2 s
could not produce.

**The alpha** is `damage / victimMaxHitPoints`, held to 0..0.75 (a remote
client receives it as `trunc(a × 255) / 255`). The recording's first wash
measures 0.545 on the sky.

**The octant.** The engine looks from the victim's own position at the
damage's point `Pos3` (a 3-D unit direction, so height counts), and dots that
with the victim's forward and right rows at cos 22.5° (0.9238) and cos 67.5°
(0.3826). A right dot of exactly 0 counts as the right side. `Pos3` is:

| Damage | `Pos3` |
|---|---|
| a round, direct | the barrel's world position when it fired (`Projectile+0x134`) |
| splash | the blast's centre |
| a landing | the contact point |
| water, the combat area, `Armor::update`'s drowning / upside-down / critical bleed | the world origin |

Every one of those goes through `_giveDamage`, so any damage the player takes
washes his screen.

**In a vehicle (HFD-10..HFD-13).** `_giveDamage` walks up from the damaged
object to the first `PlayerControlObject` and washes every player that PCO's
`getPcos()` names. That is the seat map SEAT-7's number keys use. Only a root
PCO fills it, with itself and every seat under it. A child seat's map stays
empty, because its `init()` runs after it has been attached. A soldier's map is
himself. So a hit soldier washes only his own screen, and a hit hull washes
everyone seated anywhere in the vehicle.

The frame is the damaged object's own: its absolute position is the eye, and
its absolute forward and right rows are the axes. In vanilla, XPack1 and XPack2
that object is always the hull's root. A round, a crash and `Armor::update`
all damage the owner of the nearest Armor, a landing damages the root, and a
splash only finds roots. Every vehicle declares `hasArmor 1` on its root PCO and
on nothing under it (`surveys/hull_armor_owner.py`). So the gunner in a
Sherman's MG seat sees the arc relative to the hull's nose, not to his gun or
his view. The alpha is the damage over the hull's max HP, which is 100 for a
Sherman: one 40-point shell washes the whole crew at 0.4.

The hull's `Pos3`s:

| Hull damage | `Pos3` |
|---|---|
| a round, direct | where it was fired from |
| splash | the blast's centre (queued as the point on the hull's bounding sphere along the same ray, so the same octant) |
| a crash into the ground | the contact point |
| a crash into water, or into another object | the world origin |
| `Armor::update` (critical burn, water, upside-down, one tick a second) | the world origin |

A splash also hits each seated man whose object flag bit 0 is clear
(`handleExplosion`'s second pass). That is his own damage, so it washes him from
his own frame. Being run over points the arc at the world origin, as any
object-vs-object crash does.

**Draw order.** The wash is drawn after the crosshair, supply icons, map, weapon
bar, soldier and vehicle panels and the tickets, and before chat, kill
messages and the combat-area warning. It tints the first set and not the
second, as the recording shows for the chat lines.

**In the viewer.** `hud.js` draws the quad and paints its groups in this chain
order (`PAINT_ORDER`). `soldier-hud.js` runs the timeout as six painted frames
at a float32 `1/30` step. `local-player.js` takes the octant from the
soldier's position toward the damage's point, with his screen-right
`(−cos yaw, 0, sin yaw)`: the old `(cos yaw, 0, −sin yaw)` was his left and
mirrored every arc. The page's HP poll catches damage that never passes
through `applyDamageToPlayer`, and raises direction 1: the wash with no arc,
because it cannot name the source. The viewer's minimap and DOM crosshair are
separate layers above the HUD canvas, so the wash does not tint them, where
the engine's does.

## Open

- **HUD-1**: `RegisterPictureVariable`'s third argument — a real field
  pointer its own ctor body never reads.
- **HUD-4**: the nation key that selects `Icon_<nation>_soldier_<pose>.tga`.
- **HUD-8**: `TransformNode::draw`'s sixth-parameter branch, confirmed
  irrelevant to every static HUD rect measured but not itself traced.
- **HUD-10**: ~~the `AmmoType` enum converter~~ (closed 2026-09-19 — there is
  none; it is one enumeration, §5), and which slot of the `0x00a5f1a8`
  singleton owns `AmmoHud`, which is still open.
- **VHUD-2**: `BfOccupiedVehicleData`'s live per-seat state selector — the
  table is read, the code that indexes into it per seat is not. (The dots'
  *positions* are no longer open: VHUD-11, §6.)
- **VHUD-10**: the client instruction that writes `Ammo/PrimaryAmmoText` for a
  drivetrain root, which FireArm fills primary versus secondary under
  `NumberOfWeaponIcons 2`, and the identity of `[this+0x14]` in
  `FUN_006d6af0`. The registrar tables themselves are closed (§6).
- **From the R2 verifier, not yet promoted to their own ledger rows**:
  ~~`IconLookRotation`'s writer and unit~~ (closed, VHUD-9);
  ~~`Overheat/OverHeat`'s own registration function~~ (`0x006e9820`, §6);
  ~~`UnlimitedPrimaryAmmo`/`UnlimitedSecondaryAmmo`'s source~~ (bools at
  weapon-icon group `+0x6d`/`+0x6e`, §6); the sniper-scope's non-sniper
  "ring icon" branch (`SplitNode`@84626/`CullNode`@84618) was found but not
  traced.
- `RotateEffect`'s `drawCtx[+0x18]` — the scalar `angleMultiplier` multiplies.
  Moot for vanilla, which authors the multiplier as 0 everywhere.
- **HFD-9**: where a soldier object's `getPosition()` sits (the octant's eye,
  taken as his feet here, 1 m above them in `soldier-pose.js`).
  ~~The object-vs-object collision's `Pos3`~~ (the world origin, HFD-13) and
  ~~which players a hit hull's `PlayerControlObject` sends the wash to~~
  (everyone seated in the vehicle, framed by the hull, HFD-10/HFD-11) closed
  2026-09-24.
