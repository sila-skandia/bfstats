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

**Two unresolved wirings (HUD-10).** `Ammo/AmmoType`'s `.meme`-side value
(1–7) is not the same enumeration as `setHudAmmoType`'s `.con`-side six-value
enum (`operator>>` `0x004c4cd0`: `ATNone`…`ATIconAndHeatBar`, invalid → 7) —
something converts one into the other, and that converter was not found.
Separately, `AmmoHud::registerVariables` (`0x006e9f30`) is reached only
through a data vtable slot inside the HUD singleton `0x00a5f1a8`
(offset `0x9260fc`), never a direct constructor call, so which of that
singleton's roughly eighteen slots actually *owns* the Ammo group is still
open. A weak lead — `0x00a5f1a8[0xc]`'s own object (`0x006ccc20`, fifteen
embedded string slots) — looks more like a multi-weapon vehicle row than a
plausible home for one ammo-type integer.

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

## Open

- **HUD-1**: `RegisterPictureVariable`'s third argument — a real field
  pointer its own ctor body never reads.
- **HUD-4**: the nation key that selects `Icon_<nation>_soldier_<pose>.tga`.
- **HUD-8**: `TransformNode::draw`'s sixth-parameter branch, confirmed
  irrelevant to every static HUD rect measured but not itself traced.
- **HUD-10**: the `AmmoType` enum converter, and which slot of the
  `0x00a5f1a8` singleton owns `AmmoHud`.
- **VHUD-2**: `BfOccupiedVehicleData`'s live per-seat state selector — the
  table is read, the code that indexes into it per seat is not.
- **From the R2 verifier, not yet promoted to their own ledger rows**:
  `IconLookRotation`'s writer and unit (pushed value confirmed real, the
  writer is not); `Overheat/OverHeat`'s own registration function;
  `UnlimitedPrimaryAmmo`/`UnlimitedSecondaryAmmo`'s source (no match under
  any spelling, exhaustively re-checked); the sniper-scope's non-sniper
  "ring icon" branch (`SplitNode`@84626/`CullNode`@84618) was found but not
  traced.
