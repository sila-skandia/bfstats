# Vehicle physics, control and occupancy — parity gap audit

Audit only. Nothing here was implemented. Every claim carries a file path, a `.con`
citation, or a reproducing command; inferences about engine *behaviour* that neither the
shipped data nor a survey can settle are marked **UNVERIFIED**.

Repo at `/home/dylan/projects/skandia/bfstats`, HEAD `0380713`.
Game at `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/`.

---

## Method (reproduce everything below)

```bash
cd /home/dylan/projects/skandia/bfstats/tools/bf1942-models
# 1. unpack every vanilla .con
python3 -c "
from bf42.rfa import RfaArchive; from pathlib import Path
a=RfaArchive(Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/Objects.rfa')
out=Path('/tmp/vanilla')
[ (out/e).parent.mkdir(parents=True,exist_ok=True) or (out/e).write_bytes(a.read(e))
  for e in a.entries if e.lower().endswith(('.con','.inc')) ]"
# → 1753 files, 997 of them under Objects/Vehicles/

# 2. the template-type vocabulary
grep -rhiE '^\s*ObjectTemplate\.create\s+' /tmp/vanilla/Objects | awk '{print $2}' | \
  tr A-Z a-z | sort | uniq -c | sort -rn

# 3. directives the pipeline does not parse (the money list — reproduced in G4)
#    compares every ObjectTemplate.* in Objects/Vehicles against the quoted
#    token set in bf42/con.py
```

Catalogue script and its JSON output used throughout:
`…/scratchpad/catalogue.py`, `…/scratchpad/catalogue.json`.

**A correction to the brief up front:** BF1942 (Refractor 1) has **no `PhysicsType`
directive and no `c_PT*` constants** — `grep -rhio 'c_PT[A-Za-z]*' /tmp/vanilla` returns
nothing across all 1753 files. Those are Refractor 2 / BF2. In BF1942 the physics class
*is* the template type on `ObjectTemplate.create`: `Engine`, `Spring`, `Wing`,
`FloatingBundle`, `LandingGear`, `RotationalBundle`, `PlayerControlObject`. Engine
*behaviour* class is `setEngineType` — `c_ETPlane` (16 uses), `c_ETShip` (14),
`c_ETTank` (13), `c_ETCar` (5), `c_ETTorpedo` (2), `c_ETRocket` (1).

---

## Headline

The viewer can drive **3 of 49** categorised vanilla vehicles, all of them fighters, all
of them flying on one aircraft's numbers.

- 49 vanilla templates declare `setVehicleCategory` (21 `VCLand`, 14 `VCSea`, 13 `VCAir`,
  + `AA_Allies` which mis-declares bare `Land`). 120 nested `PlayerControlObject`s across
  them — 49 Land, 21 Air, 50 Sea crew stations.
- `viewer/map.html:1954-1956` can enter exactly three: `Corsair`, `Spitfire`, `Zero`, by
  hardcoded name, first match wins.
- All three get `CORSAIR` (`viewer/flight.js:511-545`) because
  `new Aircraft(node, currentRoot)` (`map.html:1961`) passes no `spec`.
- Across 30 vanilla Conquest maps there are **968 `ObjectSpawner` placements / 1,884
  team-slots**. The three pilotable templates fill **59 of 1,884 (3.1%)**.
- Every other placed vehicle is a **frozen statue**: `viewer/maps/wake/scene.glb` carries
  5 animation clips, all `FlagBlow *`. No propeller, no turret, no track.

---

## Coverage table — vanilla catalogue × pipeline stage

"physics data" = does *any* stage (con.py → assemble.py → glb extras → scene.json) carry
the class's motion parameters. "drivable" = you can control it in `map.html`.
"cockpit" = a shipped `models/<Name>.cockpit.glb`.
"weapons" = `fireArms` extras present in the export (they are; `gunfire.js` can fire them,
but see G9b for who actually gets to).

| Class (vanilla count) | Templates | Mesh extracted | Rig extracted | **Physics data extracted** | **Drivable** | Cockpit glb | Weapons data | Camera modes |
|---|---|---|---|---|---|---|---|---|
| Air — fighter (6) | Corsair, Mustang, Spitfire, Yak9, Zero, bf109 | 6/6 | 6/6 | **0/6** | **3/6** (Corsair, Spitfire, Zero) | 6/6 | 6/6 | 4 modes, 3/6 vehicles |
| Air — dive/torpedo bomber (6) | AichiVal, AichiVal-T, SBD, SBD-T, Stuka, Ilyushin | 6/6 | 6/6 | **0/6** | **0/6** | 5/6 (AichiVal-T missing) | 6/6 | 0/6 |
| Air — heavy bomber (1) | B17 | 1/1 | 1/1 | **0/1** | **0/1** | 1/1 | 1/1 | 0/1 |
| Land — tracked tank (7) | Sherman, PanzerIV, Chi-ha, T34, T34-85, Tiger, M10 | 7/7 | 7/7 | **0/7** | **0/7** | **0/7** | 7/7 | 0/7 |
| Land — SP artillery (4) | Priest, Sexton, Wespe, Katyusha | 4/4 | 4/4 | **0/4** | **0/4** | **0/4** | 4/4 | 0/4 |
| Land — wheeled scout (5) | Willy, Kubelwagen, KettenKrad, Lynx, BlackMedal | 5/5 | 5/5 | **0/5** | **0/5** | **0/5** | 2/5 (3 unarmed) | 0/5 |
| Land — half-track APC (3) | Hanomag, Ho-Ha, m3a1 | 3/3 | 3/3 | **0/3** | **0/3** | **0/3** | 3/3 | 0/3 |
| Land — emplaced (3) | AA_Allies, Defgun, **Flak_38** | 2/3 (`flak38` has **no browse model**) | 2/3 | **0/3** | **0/3** | **0/3** | 2/3 | 0/3 |
| Sea — landing craft / small boat (6) | Lcvp, Daihatsu, Elco80, Type38, Elco80Raft, Type38Raft | 6/6 | 4/6 | **0/6** | **0/6** | **0/6** | 4/6 | 0/6 |
| Sea — destroyer (2) | fletcher, Hatsuzuki | 2/2 | 2/2 | **0/2** | **0/2** | **0/2** | 2/2 | 0/2 |
| Sea — battleship (2) | Yamato, PrinceOW | 2/2 | 2/2 | **0/2** | **0/2** | **0/2** | 2/2 | 0/2 |
| Sea — carrier (2) | Enterprise, Shokaku | 2/2 | 2/2 | **0/2** | **0/2** | **0/2** | 2/2 | 0/2 |
| Sea — submarine (2) | Gato, Sub7C | 2/2 | 1/2 | **0/2** (incl. `submarineData`) | **0/2** | **0/2** | 2/2 | 0/2 |
| Sea — emplaced (2) | AA_Enterprise, Carrier_AA_Base | 2/2 | 2/2 | **0/2** | **0/2** | **0/2** | 2/2 | 0/2 |
| Stationary weapon (2 PCOs) | Stationary_Browning, Stationary_MG42 | 2/2 | 2/2 | n/a (no physics) | **0/2** | **0/2** | 2/2 | 0/2 |
| Parachute (1) | `Parachute` (AnimatedBundle, `Soldiers/Common/Parachute/Objects.con`) | not exported | n/a | n/a | **0/1** | n/a | n/a | n/a |

**Totals: 49 categorised vehicles. 47 have meshes. 0 have physics data in the pipeline.
3 are drivable. 12 have cockpits. All 12 cockpits are aircraft.**

Per-vehicle extracted camera/gun/rig counts (the source for the table above) are
reproducible from `viewer/models/*.report.json` — e.g. Yamato exports 4 cameras, 15
firearms and 30 rigged parts and is still an ornament.

---

## Gaps

### G1 — There is no ground-vehicle drive model. Not a stub, not a hook: no code path.

**Gap.** 22 vanilla land templates (7 tanks, 4 SP guns, 5 scout cars, 3 APCs, 3 emplaced)
carry a complete drivetrain in data — engine torque, differential, a 5-speed gearbox with
shift points, and 2–16 sprung wheels with per-wheel stiffness, damping and a traction
class — and the viewer implements none of it.

**Ground truth.** `Objects.rfa` → `Objects/Vehicles/Land/<Name>/Physics.con`.
`Objects/Vehicles/Land/Sherman/Physics.con:4-27`:

```con
ObjectTemplate.create Engine ShermanEngine
ObjectTemplate.setMinRotation -1/0/-1
ObjectTemplate.setMaxRotation 1/0/1          rem ±1° body lean, not an accumulator
ObjectTemplate.setMaxSpeed 4/0/10
ObjectTemplate.setAcceleration 4/0/10
ObjectTemplate.setInputToYaw c_PIYaw
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.setEngineType c_ETTank
ObjectTemplate.setTorque 4.0
ObjectTemplate.setDifferential 4.0
ObjectTemplate.setNumberOfGears 5
ObjectTemplate.setGearUp 0.95
ObjectTemplate.setGearDown 0.45
ObjectTemplate.setGearChangeTime 0.05
```

and `Physics.con:57-66` for one of six road wheels:

```con
ObjectTemplate.create Spring ShermanWheelL3
ObjectTemplate.Grip c_PGFEngineGrip
ObjectTemplate.setStrength 18
ObjectTemplate.setDamping 4
```

Counts across vanilla: `Spring` 154 templates (113 under `Vehicles/Land`), `setStrength`
/ `setDamping` 166 uses each, `Grip` 166 uses over 4 classes — `c_PGFEngineDummyGrip` 68,
`c_PGFRollGripWhenOccupied` 39, `c_PGFEngineGrip` 35, `c_PGFRollGrip` 12.
`setNumberOfGears` 21 uses, `setGearChangeTime` 15, `setTorque`/`setDifferential` 51 each.

Full land drivetrain table (`python3 scratchpad/catalogue.py`):

| Vehicle | engineType | torque | diff | gears | gearUp/Down | mass | drag | speedMod |
|---|---|---|---|---|---|---|---|---|
| Sherman / PanzerIV / T34-85 / Chi-ha | c_ETTank | 4.0 | 4.0 | 5 | .95/.45 | 25000 | 2.0 | 1 |
| Tiger / T34 / M10 / Priest / Sexton / Wespe | c_ETTank | 3.5 | 3.5 | 5 | .95/.45 | 25000 | 2.0–8.0 | 0.75–1 |
| Hanomag / m3a1 | c_ETTank | 5.0 | 5.0 | 4 | .95/.45 | 15000 | 2.0 | 1 |
| Ho-Ha | c_ETTank | 2.5 | 5.0 | 4 | .95/.45 | 15000 | 2.0 | — |
| KettenKrad | c_ETCar | 15.5 | 7.0 | 5 | .95/.40 | 2500 | 3.5 | 2 |
| BlackMedal | c_ETCar | 12.5 | 7.0 | 5 | .95/.40 | 2500 | 1.5 | — |
| Willy / Kubelwagen | c_ETCar | 10.5 | 7.0 | 5 | .95/.40 | 2500 | 1.5 | 1 |
| Lynx | c_ETCar | 8.0 | 3.5 | **1** | .95/.40 | 3600 | 1.5 | — |
| Katyusha | c_ETCar | 3.5 | 5.0 | 4 | .85/.40 | 4500 | 2.0 | — |

**Current state.** `viewer/flight.js` exports exactly one drivable subclass,
`class Aircraft extends Vehicle` (`flight.js:548`). `Vehicle` (`flight.js:221`) has
`applyRig`, `applyTransform`, `cameraPose` — and **no `integrate`**. `map.html:1952
setPilot()` looks up three aircraft names and constructs an `Aircraft`; there is no
branch, table or factory keyed on `setVehicleCategory` / `setEngineType` anywhere in the
viewer (`grep -n "VCLand\|c_ETTank\|c_ETCar" viewer/*.js viewer/*.html` → nothing).

**Size. L.** A `GroundVehicle extends Vehicle` with: a torque→wheel-force model with the
gearbox, per-`Spring` ray-cast suspension against the heightfield (`groundHeight()` at
`map.html:1934` already exists and is the right shape), a steering model that respects the
tracked-vs-wheeled split (`c_ETTank` binds `c_PIYaw` to a ±1° *lean* axis — the actual
turning is engine-side), plus the parse work in G4 and the collision work already
specced in `collision-and-crash.md`. Also needs `Grip` semantics, which is G-UNVERIFIED-1.

**Impact.** Highest in the audit. Land vehicles are 22 of 49 templates and fill **1,154 of
1,884 vanilla Conquest spawner team-slots — 61.3%** (Sherman 137, AA_Allies 132, PanzerIV
120, flak38 116, Willy 110, Defgun 94, Kubelwagen 79, m3a1 53 …); the two emplaced
`Stationary_Weapons` PCOs add another 390. Driving a Sherman on Wake is the single largest
unmet expectation for anyone who played the game.

---

### G2 — No sea-vehicle model, and buoyancy is entirely unmodelled.

**Gap.** 14 vanilla sea templates (6 boats, 2 destroyers, 2 battleships, 2 carriers, 2
submarines) declare hull displacement, float lift bounds, sinking speed and a drag
modifier through the `FloatingBundle` template, plus rudders and dive planes through
`Wing`. None of it is parsed, and the viewer has no water-interaction code beyond a flat
crash plane at `waterLevel`.

**Ground truth.** `Objects/Vehicles/Sea/fletcher/Physics.con:47-50`:

```con
ObjectTemplate.create FloatingBundle Fletcher_Floater
ObjectTemplate.setHullHeight 20
ObjectTemplate.setFloatMaxLift 2
ObjectTemplate.setFloatMinLift 2
```

21 `FloatingBundle` templates in vanilla (20 of them under `Vehicles/Sea`, 1 the torpedo);
`setHullHeight` / `setFloatMaxLift` / `setFloatMinLift` 22 uses each,
`setSinkingSpeedMod` 12, `setDragModifier` 3. The three that make lift *asymmetric* —
where a real buoyancy curve lives — are `Elco80_MiddleFloater` (min 3 / max 9),
`Type38_MiddleFloater` (3/9), and both submarines (`GatoFloater`, `Sub7C_Floater`:
0.8275/1.6275 — that spread *is* the dive).

Ship steering is `Wing`, the same template aircraft use (`flight-model.md` §1 already
establishes this): `Objects/Vehicles/Sea/fletcher/Physics.con:4-29` gives
`Fletcher_HullWing` (`setAcceleration 0/-10/0`) against `Fletcher_rudder`
(`setAcceleration 0/10/0`), both `setInputToPitch c_PIYaw`, `setWingLift 0`,
`setFlapLift 2` — bow and stern pulling opposite so the hull carves. `Gato` carries 5
Wings: a rudder, a hull wing, two front dive planes on `c_PIPitch` (`setFlapLift 0.025`)
and a stern stabiliser. Submarines additionally declare
`ObjectTemplate.submarineData 0.009 0.03 1.0 10 12.5 40 5` plus
`setSubmarineHudDepthModifier` / `setSubmarineHudDirModifier` (2 uses each,
`Gato/Objects.con`, `Sub7C/Objects.con`) — an entire seven-parameter dive model.

Sea engines: `c_ETShip`, torque 1.5 (carriers) → 23 (PT boats),
`setNoPropellerEffectAtSpeed` 15 (rafts) / 120 (capital) / 150 (PT boats).

**Current state.** `grep -n "FloatingBundle\|floatingbundle\|hullHeight\|FloatMaxLift" `
over `tools/bf1942-models/` → **zero hits outside my survey scripts**. `bf42/con.py` has
no field for any of them. `viewer/map.html:992 setupWater()` is a shader — two scrolling
colour layers and a depth ramp — with no physics coupling; `groundHeight()`
(`map.html:1934`) returns `max(terrainY, waterLevel)`, i.e. water is a floor, not a fluid.

**Size. M–L.** `FloatingBundle` is a small parse job and a plausible model (lift ∝
submerged depth clamped to min/max over `hullHeight`). A believable destroyer also needs
the `Wing` loop from `flight-model.md` §8 reused for rudders, which is shared work with
G3b.

**Impact.** High on 8 of 30 vanilla maps (Coral Sea, Midway, Wake, Guadalcanal, Iwo Jima,
Philippines, Truk, Omaha). Carriers and battleships are the most visually spectacular
objects in the extraction and are currently fixtures. Note `collision-and-crash.md` §6
already argues the carrier deck should be landable — that needs the carrier to at least
float stably, if not move.

**Not a gap:** *wave motion*. Refractor 1's water is a flat plane with scrolling normal
maps; no level or object data declares wave amplitude (`grep -rni wave /tmp/vanilla` → 0).
The viewer's flat water is correct. Wake/bow-spray *effects* are a separate gap — see G12.

---

### G3 — Pilot mode is a three-name hardcode, and every aircraft flies on Corsair numbers.

**3a. The lookup.**

**Gap.** Nine of twelve vanilla aircraft cannot be entered even though all twelve have
meshes, rigs, cockpits and engine audio.

**Current state.** `viewer/map.html:1954-1956`:

```js
const node = findVehicle(currentRoot, 'Corsair')
  || findVehicle(currentRoot, 'Spitfire')
  || findVehicle(currentRoot, 'Zero');
```

`flight.js:1039 findVehicles()` already returns *every* `PlayerControlObject` under the
`spawners` group — the data to offer a picker is there; the page throws it away.

**Ground truth.** 13 `Vehicles/Air` templates, 12 with `.cockpit.glb`
(`ls viewer/models/*.cockpit.glb`). Bombers with rear gunners (SBD, SBD-T, AichiVal,
AichiVal-T, Stuka, Ilyushin, B17) are all excluded.

**Size. S.** A vehicle picker over `findVehicles()` + a spec table. The blocker is 3b.

**3b. The spec is one aircraft's constants.**

**Gap.** `Aircraft` takes `options.spec` and `map.html` never passes it, so every aircraft
gets the Corsair's thrust, drag, roll rate, stall speed and gear thresholds.

**Ground truth.** The per-aircraft numbers exist and differ materially. `drag` spans 0.061
(Stuka/Ilyushin) → 0.125 (B17), a 2× spread. `setTorque` 2.6 (B17, per engine, ×4) → 15
(fighters). `mass` 2500 (fighters) / 3000 (dive bombers) / 25000 (B17).
`inertiaModifier` — declared on **all 13** aircraft, `Corsair/Objects.con:12`
`1.05/0.850/0.94` against `B17/Objects.con:13` `0.6/0.6/0.3` — is exactly the
per-axis relative inertia that `flight-model.md` §8 calls a free constant; the *absolute*
base is unknown but the *ratios* are shipped data and are discarded.
`setGearUpHeight` / `setGearDownHeight` (20 / 39 uses), `setGearUpEngineInput` /
`setGearDownEngineInput` (28 / 39) are per-aircraft and hardcoded to 25/23 in
`flight.js:543-544`.

**Current state.** `flight.js:511` `export const CORSAIR = {...}`; `flight.js:553`
`this.spec = options.spec || CORSAIR`; `map.html:1961` `new Aircraft(node, currentRoot)`.
Ten of the ~20 values in `CORSAIR` are annotated `[data]` in the source but are *typed in*
rather than read from the glb — nothing in the export carries them (see G4).

**Size. M.** Needs G4's parse work plus a per-template spec block in `scene.json`
(`sounds.vehicles[]` is the precedent — `extract_map.py:1601-1604` already resolves the
spawned template and ships per-vehicle data alongside the scene).

**Impact.** A B17 that rolls like a Corsair is worse than a B17 you cannot fly, because it
looks correct and is not.

---

### G4 — The physics property vocabulary is unparsed. `bf42/con.py` has no field for any of it.

**Gap.** Of the ObjectTemplate directives that appear in `Objects/Vehicles/`, the parser
handles the *rig* (rotation bounds, rates, inputs, acceleration sign) and the *art*
(geometry, skeleton, LOD, effects) and drops **every scalar the physics uses**.

**Ground truth / reproduce.**

```bash
cd /home/dylan/projects/skandia/bfstats/tools/bf1942-models && python3 - <<'PY'
import re, collections; from pathlib import Path
handled = set(re.findall(r'["\']([a-z0-9_]{4,})["\']', Path('bf42/con.py').read_text()))
cnt=collections.Counter()
for p in Path('/tmp/vanilla/Objects/Vehicles').rglob('*.con'):
    for l in p.read_text(errors='replace').splitlines():
        m=re.match(r'\s*ObjectTemplate\.(\w+)', l, re.I)
        if m: cnt[m.group(1).lower()]+=1
print([(d,c) for d,c in cnt.most_common() if d not in handled])
PY
```

Physics-relevant unhandled directives, with vanilla `Vehicles/` frequency:

| Directive | uses | On | What it is |
|---|---|---|---|
| `grip` | 166 | Spring | traction class (`c_PGFEngineGrip`, `c_PGFRollGripWhenOccupied`, …) |
| `setStrength` / `setDamping` | 166 / 166 | Spring | suspension stiffness and damping |
| `setFlapLift` | 141 | Wing | control-surface lift coefficient |
| `setPositionOffset` | 134 | Wing | force application point (already specced, `flight-model.md` §4b) |
| `setSoldierExitLocation` | 121 | PCO | where the occupant is put down |
| `setWingLift` | 118 | Wing | static lift coefficient |
| `seatFlags` | 103 | SeatObject | half-body / full-body / standing / outside |
| `setEntryRadius` | 66 | EntryPoint | how close you must be to board |
| `mass` | 59 | PCO | 800 → 35,000,000 |
| `drag` | 58 | PCO | linear drag, `0.061`→`3.25` |
| `setTorque` | 54 | Engine | peak drive acceleration |
| `setDifferential` | 54 | Engine | final-drive ratio |
| `setPitchOffset` | 54 | Wing | surface incidence |
| `setGearDownHeight` / `setGearDownEngineInput` | 39 / 39 | LandingGear | retraction automation thresholds |
| `speedMod` | 38 | PCO | collision-damage speed scaler |
| `setGearUp` / `setGearDown` | 37 / 37 | Engine | gearbox shift points |
| `setNoPropellerEffectAtSpeed` | 33 | Engine | thrust-zero speed |
| `setRegulateToLift` / `setWingToRegulatorRatio` | 27 / 27 | Wing | the 1 g regulator pair |
| `setHullHeight` / `setFloatMaxLift` / `setFloatMinLift` | 22 / 22 / 22 | FloatingBundle | buoyancy |
| `setNumberOfGears` | 21 | Engine | gearbox |
| `setGearUpHeight` | 20 | LandingGear | retraction altitude |
| `setGearChangeTime` | 15 | Engine | shift duration |
| `inertiaModifier` | 13 | PCO | per-axis relative inertia |
| `setSinkingSpeedMod` | 12 | FloatingBundle | how fast a wreck goes down |
| `setPivotPosition` | 30 | Camera / RotationalBundle | rotation centre |
| `submarineData` | 2 | PCO | 7-parameter dive model |
| `setDragModifier` | 3 | FloatingBundle | in-water drag multiplier |
| `damageFromWater` / `hpLostWhileDamageFromWater` | 34 / 34 | PCO | drowning |
| `hpLostWhileUpSideDown` | 38 | PCO | rollover damage |
| `exitTimer` / `hasRestrictedExit` / `exitSpeedMod` | 22 / 44 / 4 | PCO | egress rules |

**Current state.** `bf42/con.py:265-352` is the complete `ObjectTemplate` field list;
none of the above has a field. `con.py:493-750` is the parse switch; none has a case.
Downstream, `bf42/assemble.py:1497-1562` builds the glTF `extras` dict — the keys it emits
are `templateKind`, `geometry`, `control`, `fireArms`, `lodAlternative`, `cameraView`,
`rig`, `boundBone`, `alignedBone`, `skeleton`, `skin`, `animatedTextureSpeed`, `lightmap`,
plus `spinsWithEngine` (`assemble.py:1442`). **No physics key exists in the format.**

**Size. M for the parse, S per consumer.** The parse is mechanical — the switch already
has vec3, float and enum helpers. The design question is where physics lands: a
`physics` extras block on the PCO node, or a `vehicles[]` section in `scene.json`
mirroring `sounds.vehicles[]`.

**Impact.** Blocks G1, G2 and G3b outright. This is the keystone.

**Already partly documented:** `flight-model.md` §7 lists the *aircraft* subset of this
(6 priority items) and explicitly defers item 6, "Spring `setStrength`/`setDamping`,
`Grip` (ground handling, later)". What is new here is the land/sea half of the table
(gears, buoyancy, submarine data, occupancy scalars) and the confirmation that no physics
key reaches the glb at all.

---

### G5 — Entry points and seats are deleted at export. One line.

**Gap.** `EntryPoint` and `SeatObject` templates never reach a glb, so entry radius, seat
placement and seat flags are not in the asset even though `con.py` reads the tree.

**Ground truth.** 69 `EntryPoint` and 66 `SeatObject` templates in vanilla; 66
`setEntryRadius` values ranging 1.0 → 9.0 m (Willy 3.2, Sherman 3.6, B17 7.5, Yamato 9.0);
103 `seatFlags` (`c_SeatShowHalfBodySoldier` 46, `c_SeatShowFullBodySoldier` 23,
`c_SeatShowStandingSoldier` 23, `c_SeatIsOutside` 13); 121 `setSoldierExitLocation`.
`Objects/Vehicles/Land/Sherman/Objects.con:88-91, 360-362`:

```con
ObjectTemplate.create EntryPoint ShermanEntry
ObjectTemplate.setEntryRadius 3.6
...
ObjectTemplate.create SeatObject ShermanBrowningSeat
ObjectTemplate.seatFlags c_SeatShowHalfBodySoldier
ObjectTemplate.seatFlags c_SeatIsOutside
```

Sherman's `ShermanComplex` adds two `shermanEntry` instances at `0/0/1.2` and `0/0/-1.2`
— front and rear boarding points.

**Current state.** `bf42/assemble.py:1487`:

```py
is_camera = template.kind.lower() == "camera"
if mesh_index is None and not child_indices and not is_camera:
    return None
```

An `EntryPoint` has no geometry and no children, so it is dropped; a `SeatObject` likewise.
Confirmed empirically — `viewer/models/Sherman.report.json` `partTree` contains
`ShermanCamera (Camera)` and `ShermanCamera2 (Camera)` but **no `ShermanEntry` and no
`ShermanBrowningSeat`**, with `unresolvedTemplates: []`.

**Size. S.** Extend the `is_camera` escape to `entrypoint` / `seatobject` and stamp
`entryRadius` / `seatFlags` on the node, exactly as `cameraView` is stamped at
`assemble.py:1506-1507`. Then the parse fields from G4.

**Impact.** Blocks any "walk up and press E" interaction, any seat marker in the map HUD,
and any soldier-in-seat rendering. Cheap and load-bearing.

---

### G6 — No seat switching. 120 crew stations, the viewer picks the first camera it walks past.

**Gap.** Every multi-crew vehicle in the game is single-seat in the viewer, and which seat
you get is whichever `Camera` node the traversal happens to hit first.

**Ground truth.** 120 nested `PlayerControlObject`s in vanilla `Vehicles/` — Land 49, Air
21, Sea 50. Worst cases: `Yamato` 4 PCOs / 15 firearms, `PrinceOW` 4 / 11, `fletcher` 5 / 8,
`Enterprise` 5, `Shokaku` 5, `Hanomag`/`Ho-Ha`/`m3a1`/`Daihatsu`/`Lcvp` 6 each, `B17` 3.
Each PCO owns one `SeatObject`, one `EntryPoint`, one `Camera` and the parts that seat
drives — `input-and-cockpit.md` §4 documents the model. Switching is
`c_PIMenuSelect1..6`, bound to keys 1–6 in **every** control map
(`Settings/Default/Controls/{Air,Land,Infantry}.con`); `Land.con` is literally named
`LandSeaPlayerInputControlMap`, i.e. land and sea share one scheme. Explicit seat indices
exist in data: `setPcoId` 22 uses, `addPcoPosId` 9 (`Sea/fletcher/Objects.con:73-75`,
`Sea/PrinceOW/Objects.con:79,350,419,563`).

**Current state.** `flight.js:363 collect()`:

```js
if (!this.cameraNode && (data.cameraView || data.templateKind === 'Camera')) {
  this.cameraNode = obj;
}
```

First hit wins, permanently. `flight.js:316 attachCockpit()` filters grafts to
`source.userData.control === this.control` — correct, and its docstring says "When seat
switching arrives, the filter is where it changes". `map.html` binds no key to seats;
`map-hud-plan.md` §1.6 confirms keys 1–6 are unbound, so there is no conflict.

**Size. M.** Needs: a seat index built from nested PCO nodes (already tagged
`templateKind: "PlayerControlObject"` + `control`), rebinding the rig's `control` scope on
switch (`flight.js:42 keyOf()` already scopes inputs per seat), re-grafting the cockpit
per seat, and swapping the camera node and its clamps (G7). `input-and-cockpit.md` §8d
flags the concrete blocker: the SBD's rear gun is not a LodObject alternative, so a seat
switch has to graft *meshes* onto existing rigged nodes rather than reparent subtrees.

**Impact.** High. Gunner seats are where half the game is. It is also the prerequisite for
any replay of a multi-crew vehicle.

---

### G7 — Cockpit look clamps are the Corsair's, hardcoded, for everything.

**Gap.** 51 of the 54 distinct vanilla `Camera` template names declare their own free-look
limits, in 29 distinct min/max pairs (90 `create Camera` statements resolve to 54 names —
variants share definitions). The viewer applies one pair to every vehicle, and that pair
is used by 2 of the 54.

**Ground truth.** Reproduce with the survey in `…/scratchpad/` (walks every `Camera`
template in `/tmp/vanilla`):

| min (y/p/r) | max | count |
|---|---|---|
| `-90/-80/0` | `90/80/0` | 4 |
| `0/0/0` | `0/0/0` | 4 (locked) |
| `-180/-60/0` | `180/20/0` | 3 |
| `-70/-40/0` | `70/0/0` | 3 |
| `-110/-40/0` | `110/10/0` | 3 |
| `-60/-30/0` | `60/30/0` | 3 |
| **`-70/-40/0`** | **`70/5/0`** | **2 ← the one the viewer uses** |
| …22 more pairs | | 1–2 each |

Also on `Camera`: `setPivotPosition` 17 uses, `toggleMouseLook` 13, `setInputToRoll` 17,
`setContinousRotationSpeed` 8, `setHasTarget` 9.

**Current state.** `viewer/flight.js:794-803`:

```js
const LOOK_LIMITS = {
  // `CorsairCamera`: setMinRotation -70/-40/0, setMaxRotation 70/5/0. [data]
  cockpit: { yaw: Math.PI*70/180, pitchDown: -Math.PI*40/180, pitchUp: Math.PI*5/180 },
```

The comment is honest that the value is data — but it is *typed in*, because the clamps
never reach the glb. Root cause: `assemble.py:1533` gates the `rig` extra on
`mesh_index is not None or child_indices`, and a bare `Camera` node has neither, so its
`setMinRotation`/`setMaxRotation` — which `con.py:538-547` *does* parse — are discarded.
Verified: `viewer/models/Corsair.report.json` lists `CorsairCamera` under `cameras` and
**not** under `riggedParts`.

**Size. S.** Emit a `lookLimits` extra on camera nodes (the parse already exists), read it
in `VehicleCamera`. ~15 lines across two files.

**Impact.** Medium now (one aircraft), high the moment G3a or G6 lands — a tank
commander clamped to a fighter pilot's ±70°/−40°..+5° cannot look at his own turret.

---

### G8 — The four camera modes are aircraft-only in practice, and the per-seat availability flags are unread.

**Gap.** `C` cycles cockpit/chase/front/flyby only while `optPilot` is checked, which only
ever binds an `Aircraft`; no ground or sea vehicle ever gets a camera. The framing
constants are also aircraft-shaped (17 m back, 22 m lead) and there is no per-class
variant for a 263 m battleship.

**Ground truth.** `CVMInside/CVMChase/CVMFrontChase/CVMFlyBy/CVMTrace/CVMExternTrace` are
per-camera booleans; vanilla writes `CVMExternTrace` 10 times and the full set once
(`SoldierCamera`). Omission means on.

**Current state.** `flight.js:726 CAMERA_MODES`, `flight.js:738-791` `CHASE`/`FRONT`/
`FLYBY` constants, `map.html:1970` `view = new VehicleCamera(aircraft, {groundHeight})`
constructed only inside `setPilot`. `VehicleCamera` itself takes a `Vehicle`, not an
`Aircraft`, so it is already class-agnostic — the page is the constraint.
`Vehicle.cameraPose` (`flight.js:474`) falls back to a fixed `(0, 3, -12)` offset when a
template has no camera node, which is wrong at battleship scale.

**Size. S** to generalise the wiring, **M** to make the external framings scale off the
vehicle's exported `dimensions` (already in `models.json`, e.g. Yamato).

**Impact.** Medium. `camera-modes.md` §9 already records `CVM*` and `vehicleFov` as unread
and `setPivotPosition` as unmodelled; the *class generality* of the modes is the part that
is new here.

---

### G9 — There are no vehicle instruments, and no vehicle-scoped HUD at all.

**9a. Instruments.**

**Gap.** No speedometer, altimeter, compass, throttle indicator, gear indicator, fuel,
ammo counter, seat indicator, or damage readout. The `#hud` element is a one-line
key-hints strip.

**Current state.** `map.html:245` `<div id="hud">WASD fly · QE or scroll vertical · …`;
`map.html:2001` `HUD_PILOT = 'W/S throttle · A/D rudder · arrows pitch and roll · …'`.
That is the whole vehicle HUD. Meanwhile the state to drive real instruments already
exists: `VehicleState.airspeed`, `.throttle`, `.position.y`, `.orientation`,
`.inputs.get('c_PILandingGear')`, `.grounded` (`flight.js:192-209`), plus `groundHeight()`
for AGL and `gunfire.js` group state for rounds remaining.

**Ground truth for the art side.** Per-PCO HUD data *is* in the .con files and unparsed:
`setVehicleIcon` (119), `setVehicleIconPos` (109), `setMinimapIcon` (100),
`setPrimaryAmmoIcon`/`setPrimaryAmmoBar` (77/119), `setSecondaryAmmoIcon`/`Bar` (26/26),
`setNumberOfWeaponIcons` (77), `setCrossHairType` (119), `setHasTurretIcon` (7),
`setHealthBarIcon`, and the submarine depth/direction bar set
`DirBarXScale`/`DirBarYScaleAbove`/`Below`/`Min`/`Max`/`DirBarRotate` (11/11/11/11/11/4 —
`Sea/Gato/Objects.con`, `Sea/Sub7C/Objects.con`). `OutsideHudOffset` (13 uses, aircraft
only) is the outside-view reticle anchor and is correctly *not* a camera —
`camera-modes.md` §4 settled that.

**Size. M.** A canvas or DOM overlay plus an icon extraction pass (the icons are TGAs in
`menu.rfa`/`texture.rfa`; the `bf1942-map-images` skill already reads those archives).
An honest first cut — airspeed, altitude AGL, throttle %, gear, rounds — is **S** and needs
no new extraction.

**9b. Weapons are extracted for everything and firable by one thing.**

**Gap.** `fireArms` extras ship on every armed vehicle (Yamato 15 guns, PrinceOW 11,
fletcher 8, Hatsuzuki 7, Sherman 3) and `gunfire.js` is fully general, but `map.html`
only ever builds gun groups for the flown aircraft.

**Current state.** `map.html:1975` `collectGuns()` is called from `setPilot()` only;
`map.html:1905 releaseGuns()` tears them down on exit. `map.html:2507-2510` force-hides
every baked effect payload in the scene on load, so no other vehicle's muzzle can light.

**Size. S**, gated on G5/G6 (you need to be in a seat before a gun means anything).

---

### G10 — ObjectSpawners are placements only. The respawn lifecycle is not parsed.

**Gap.** The level declares per-spawner respawn delays, a destroyed-object lifetime, an
occupancy radius, a spawn cap and a score penalty. `level.py` reads two directives and
ignores the rest, so the viewer has no notion of a vehicle respawning, ever.

**Ground truth.** `bf1942/levels/Wake.rfa` →
`bf1942/levels/Wake/Conquest/ObjectSpawnTemplates.con`:

```con
ObjectTemplate.create ObjectSpawner HeavyTankSpawner
ObjectTemplate.setObjectTemplate 2 sherman
ObjectTemplate.setObjectTemplate 1 chi-ha
ObjectTemplate.MinSpawnDelay 70
ObjectTemplate.MaxSpawnDelay 110
ObjectTemplate.SpawnDelayAtStart 0
ObjectTemplate.TimeToLive 45
ObjectTemplate.Distance 40
ObjectTemplate.DamageWhenLost 10
```

Wake alone: lcvp `SpawnDelay 20`, ScoutCar 10–30, APC 35–55, LightTank 40–80, HeavyTank
70–110, Fighter 40–80, DiveBomber 40–80. Vanilla-wide directive counts (from the
`Vehicles/` sweep plus the level sweep): `minSpawnDelay`/`maxSpawnDelay` 12 each in
`Objects.rfa`, `timeToLive`, `distance`, `spawnOffset`, `holdObject`, `damageWhenLost`,
`maxNrOfObjectSpawned` (6), `teamOnVehicle`.

Fleet scale: **30 vanilla Conquest maps, 968 `ObjectSpawner` placements, 1,884 team-slots,
62 distinct templates.**

**Current state.** `bf42/level.py:741-771 parse_spawn_templates()` handles exactly
`setobjecttemplate` and `teamonvehicle`; `SpawnTemplate` has fields `name`, `vehicles`,
`owner_team` and nothing else. `extract_map.py:1353` calls `spawn_vehicle()` and bakes one
static instance per placement under a `spawners` group. `scene.json` carries
`objects.spawners: 32` (a count) and no per-spawner record at all — verified against
`viewer/maps/wake/scene.json`.

**Size. S to parse and export, M to simulate.** The parse is ~20 lines in `level.py`.
Exporting an `objectSpawns[]` array is already the shape `map-hud-plan.md` §2.3 proposes.
Simulating respawn needs a destroy path first (G-adjacent: `collision-and-crash.md`).

**Impact.** Medium alone; high for the stated replay goal, where a captured round replays
vehicles appearing and disappearing on their real timers.

---

### G11 — Ground/water interaction beyond "don't fall through the floor".

**Gap.** The only terrain interaction in the viewer is a single downward ray that clamps
the aircraft 1.2 m above `max(terrainY, waterLevel)`. There is no suspension, no per-wheel
contact, no slope limit, no traction, no drowning and no rollover.

**Ground truth.**
- Suspension/traction: G1's `Spring` table — 154 templates, `setStrength` 0–25,
  `setDamping` 0–12, four `Grip` classes. Note the *dummy* pattern:
  `ShermanWheelL3Dummy` carries `setStrength 0 / setDamping 0 / Grip c_PGFEngineDummyGrip`
  (68 of 166 wheels), i.e. visual-only road wheels vs. 35 real
  `c_PGFEngineGrip` load-bearing ones. A suspension model has to know the difference or a
  Sherman rides on twelve springs instead of four.
- Water damage: `damageFromWater 1` (34 uses), `hpLostWhileDamageFromWater 10` (34),
  `movetowatersurface` (31 across all of `Objects.rfa`). `Sherman/Objects.con:24-25`.
- Rollover: `hpLostWhileUpSideDown 10` (38 uses). `flight-model.md` §9 item 6 lists the
  ground-contact gating for this as an open binary question.
- Collision damage carries a velocity term and is already documented as unmodelled
  (`bf1942-3d-models/README.md` §"Requires deep dive").
- **Terrain deformation does not exist in BF1942** — `grep -rhiE "deform|terrainmod|crater"`
  over all 1753 vanilla `.con` files returns nothing. Tracks leave `e_wdust*` particle
  emitters, not geometry. Not a gap; do not build it.

**Current state.** `viewer/map.html:1934 groundHeight()` (raycast against the 16 terrain
tiles, floor = `waterLevel`); `flight.js:654-661` the clamp; `flight.js:663-667` the gear
automation. `extract_map.py:1565` `include_collision=False` means the scene has zero
collision hulls, so there is nothing to stand a wheel on but the heightfield.

**Size. M** for per-wheel heightfield suspension (the hard part is G1's chassis model);
**S** for water/rollover damage once a damage loop exists.

**Impact.** Directly gates G1 — a tank with no suspension on a heightfield jitters and
climbs cliffs.

**Already covered:** `collision-and-crash.md` §2 has the complete heightmap decode
(`Heightmap.raw` 512×512 u16, 4 m spacing, `raw/65535*256*yScale`), §1 has the hull
inventory including ground and sea vehicles, and §5 lists the five missing pieces. That
document is a spec with nothing implemented; this gap is its ground-vehicle half.

---

### G12 — Every placed vehicle is frozen, and the declared motion effects never play.

**12a. No rig runtime for unflown vehicles.**

**Gap.** A map scene's 968-placement fleet has no animation whatsoever: propellers still,
turrets still, tracks still, wheels still. Only the vehicle you pilot moves.

**Current state.** `viewer/maps/wake/scene.glb` carries 5 animation clips, all
`FlagBlow *` (verified by reading the glb JSON chunk). `map.html:2516` creates an
`AnimationMixer` for those clips only. `map.html` has **no** `animatedTextureSpeed`
handling (`grep -n animatedTextureSpeed viewer/map.html` → nothing), though
`index.html:2577` does. `flight.js:428 applyRig()` runs only for the piloted vehicle.
The level bake deliberately ships no spin clips — `flight.js:99-103` explains the
`spinsWithEngine` stamp exists precisely because of that.

**Size. S.** A per-frame pass over spawner PCO nodes driving `continuousRotation` and
idle-engine spin, plus the track-texture scroll `index.html` already implements.

**Impact.** Medium-high for the flythrough as a *flythrough* — a carrier with a dead
propeller and a Sherman with a rigid track are the two things an eye catches first.

**12b. Motion effects declared and unused.**

**Gap.** Wheel dust, water-touch spray, bow wave, stern wash and boat wake are all
authored as children of the physics parts and none reach the viewer.

**Ground truth.** Counted over `Vehicles/`: `e_wdustPanz`/`e_wdustPanzL` 27 each (tank
tracks), `e_wdustPlane`/`e_wdustPlaneL` 26 each + `e_WaterTouchPlane` 24 (aircraft wheels
— `Corsair/Physics.con:42-45`), `e_wdustWheelF`/`FL` 7 each, `e_wdirtWheel` 4,
`e_waterBoatSvall`/`Narrow`/`Sub` 5/9/4 (wake), `e_waterfrontBig` 7 + `e_WaterFrontPTBoat`
2 (bow), `e_waterBackBig` 7 + `e_WaterBackMedium` 2 + `e_waterbacksmall` 2 (stern).

**Current state.** They do not appear in the exported part tree —
`viewer/models/Sherman.report.json` `partTree` shows `ShermanWheelL3DummyMiddle` with no
children, while `Sherman/Objects.con:98-100` adds `e_wdustPanzL` and `e_wdustPanz` to it.
Muzzle-flash `EffectBundle`s *do* bake (`e_MuzzPanz`, `e_shell1250mm` are in the same
tree), so the filter is inside `assemble.py::_effect_bundle_node` — presumably the
additive-payload selection. **UNVERIFIED** which predicate excludes them.

**Size. S** to diagnose, **M** to drive (needs a ground-contact signal, i.e. G11).

---

### G13 — Cockpits exist for 12 of the 38 vanilla vehicle directories that have interiors. All 12 are aircraft.

**Gap.** `extract_models.py --cockpit` is gated on `reaches_first_person()`, not on
vehicle class, but the shipped asset tree has cockpits only for aircraft.

**Ground truth.** Vehicle directories whose tree contains `1P_*` geometry:
**Land 20** (AA_Base, BlackMedal, Chi-ha, Defgun, Flak_38, Hanomag, Ho-Ha, Katyusha,
KettenKrad, Lynx, M10, PanzerIV, Priest, Sherman, T34, T34-85, Tiger, Wespe, Willy, m3a1),
**Air 13**, **Sea 6** (Carrier_AA_Base, Daihatsu, Elco80, Lcvp, Type38, plus `Sea/Common`,
which is a shared-asset folder rather than a vehicle) — 38 real vehicles, 25 of them
non-aircraft.
Reproduce: `grep -rliE 'ObjectTemplate\.geometry\s+1P_' /tmp/vanilla/Objects/Vehicles/<cls>`.
Sherman's is `1P_Sherman_Gunner_M1` (`Objects.con:268`) behind
`lodShermanCockpit` / `shermancockpitSelector`, the same `DistCompareSelector`
`addLodComparison 0.5` pattern the aircraft use.

**Current state.** `ls viewer/models/*.cockpit.glb` → 12 files, all aircraft; `AichiVal-T`
is missing despite having 1P geometry. `flyable-vehicles/README.md` §Status claims "All 12
vanilla aircraft **and the 1P ground and sea vehicles** come out with no per-vehicle
handling" — the code may well do that, but **the published asset tree does not contain
them**. `input-and-cockpit.md` §8d separately notes `lodM3A1Cockpit`/`lodPriestCockpit`
declare 1P in *both* alternatives, so those two are genuinely special.

**Size. S.** Re-run `extract_all.py --cockpit` and republish; then confirm the two known
edge cases.

**Impact.** Gates first-person for every ground and sea vehicle, i.e. gates G1/G2 from
being *good* rather than merely working.

---

### G14 — `findVehicles()`'s exclusion rule does not match the data.

**Gap.** `flight.js:1044-1047` filters to nodes under the `spawners` group with the
comment "Only spawner-placed vehicles; the stationary Defguns and Brownings that share the
class are map furniture." On Wake the Defguns **are** spawner-placed.

**Ground truth.** `bf1942/levels/Wake/Conquest/ObjectSpawns.con` opens with six
`Object.create DefgunSpawner` placements; vanilla-wide, `defgun` fills 94 team-slots,
`aa_allies` 132, `flak38` 116, `stationary_browning` 196, `stationary_mg42` 194 — all
through `ObjectSpawner`s.

**Current state.** The filter is harmless today because `findVehicle(root, 'Corsair')`
matches by name, but any picker built on `findVehicles()` (G3a) will list Defguns and
Brownings alongside aircraft with no way to tell them apart — the discriminator is
`setVehicleCategory` / `setVehicleType`, which is not exported (G4).

**Size. S.** Export `vehicleCategory`/`vehicleType` and filter on them; fix the comment.

---

## Unverified claims

| # | Claim | Why unverified |
|---|---|---|
| U1 | `setTorque` is peak drive acceleration in m/s², and `setDifferential` a final-drive ratio | `flight-model.md` §2b marks the car reading `speculative`. Not in `features/bf1942-engine-reference/ledger.md` (grepped: no physics entries at all). Settling it needs `bf1942_lnxded.static` or a stopwatch protocol like `measurement-protocol.md`. |
| U2 | `Grip c_PGFEngineGrip` vs `c_PGFEngineDummyGrip` selects load-bearing vs cosmetic wheels | Inferred from `setStrength 0/setDamping 0` always accompanying the Dummy variant (68/68 cases). Consistent, not proven. |
| U3 | `setNumberOfGears`/`setGearUp`/`setGearDown`/`setGearChangeTime` implement a discrete gearbox that steps available torque | Universal 0.95/0.45 (tank) and 0.95/0.40 (car) values with `Lynx` at `setNumberOfGears 1` as the only variation. The uniformity is suspicious — it may be inert for everything but audio. |
| U4 | `setHullHeight` is the displacement depth over which `setFloatMinLift`→`setFloatMaxLift` ramps | Shape inferred from the submarine pair (0.8275/1.6275) and the Elco middle floater (3/9). No engine confirmation. |
| U5 | `submarineData <7 floats>` is a dive/ballast model | Name + the two `setSubmarineHud*Modifier` companions. Field meanings unknown. |
| U6 | Which predicate in `assemble.py::_effect_bundle_node` drops `e_wdust*` while keeping `e_Muzz*` | Observed from report part-trees; the code path was not traced. |
| U7 | Seat cycling on `c_PIMenuSelect1..6` is engine behaviour, not template-driven | `input-and-cockpit.md` §4 already marks this `strong inference`; no vehicle template consumes those inputs. |

---

## Priority table

Sorted by impact ÷ size. "Blocked by" names the gap that must land first.

| # | Gap | Size | Impact | Blocked by |
|---|---|---|---|---|
| 1 | **G4** — parse the physics vocabulary and get it into the glb / `scene.json` | M | **Critical** — keystone for G1, G2, G3b, G5, G14 | — |
| 2 | **G5** — stop deleting `EntryPoint`/`SeatObject` at `assemble.py:1487` | S | High | — |
| 3 | **G7** — emit per-camera look clamps instead of hardcoding the Corsair's | S | Medium now, High after G3a/G6 | — |
| 4 | **G3a** — vehicle picker over `findVehicles()` instead of three hardcoded names | S | High (9 aircraft unreachable) | G3b for honesty, G14 for filtering |
| 5 | **G13** — republish cockpits for the 25 non-aircraft templates that have 1P geometry | S | High (gates first-person for land/sea) | — |
| 6 | **G12a** — drive the rig for unflown vehicles (propellers, turrets, track scroll) | S | Medium-High (every map, every frame) | — |
| 7 | **G10** — parse spawner delays/TTL/caps and export `objectSpawns[]` | S parse / M sim | Medium; High for replay | — |
| 8 | **G3b** — per-aircraft spec instead of `CORSAIR` for all | M | High | G4 |
| 9 | **G2** — sea model: `FloatingBundle` buoyancy + `Wing` rudders | M–L | High on 8 maps | G4 |
| 10 | **G6** — seat switching across nested PCOs | M | High | G5, G7, G13 |
| 11 | **G9a** — real instruments (airspeed / AGL / throttle / gear / ammo) | S honest cut, M with game icons | Medium-High | — |
| 12 | **G8** — camera modes for every class, framing scaled to vehicle size | S wiring / M framing | Medium | G4 (category), G7 |
| 13 | **G11** — per-wheel suspension, traction, water damage, rollover | M | High but only as part of G1 | G4, G1 |
| 14 | **G1** — ground-vehicle drive model | **L** | **Highest** (22 templates, ~63% of spawner slots) | G4, G11, collision |
| 15 | **G12b** — wheel dust, wake, bow spray | S diagnose / M drive | Medium | G11 (contact signal) |
| 16 | **G9b** — firing from non-aircraft seats | S | Medium | G5, G6 |
| 17 | **G14** — fix the spawner-furniture filter and its comment | S | Low alone, blocks G3a's picker | G4 |

---

## Already covered — do not re-report

These are documented in the repo and were deliberately excluded from the gaps above.

- **Aircraft `Wing`/`Engine`/PCO physics reference, complete** —
  `features/flyable-vehicles/flight-model.md` §§1–8: per-surface aero architecture,
  the 18-command `Wing` vocabulary, `setPositionOffset` as force application point,
  `setRegulateToLift 4.91 = g/2` as the entire stall model, the throttle/thrust fade,
  and a full Corsair reimplementation spec.
- **`con.py` drops the aircraft physics fields** — `flight-model.md` §7, priority-ordered,
  including the explicit deferral of Spring/`Grip` as "(ground handling, later)". G4
  extends this to the land/sea half and adds the glb-format finding.
- **The provisional body-rate flight model needs replacing with §8's surface loop** —
  `flyable-vehicles/README.md` §Status item 2.
- **Collision is off in the map scene** (`extract_map.py` `include_collision=False`),
  TreeMesh trunk hulls skipped, swept-probe architecture, the full collision-damage
  matrix and the crash/wreck chain — `collision-and-crash.md`, entire document; also
  README §Status item 1.
- **Terrain heightmap decode and the `max(terrainY, 95.0)` crash surface** —
  `collision-and-crash.md` §2.
- **The seat/PCO data model** (each crew position is its own PCO owning one
  Seat/Entry/Camera; input scoping at `con.py:302` / `assemble.py:1197-1201`; `seatFlags`
  values and frequencies; `c_PIMenuSelect1..6`) — `input-and-cockpit.md` §4. G6 is the
  *implementation* gap, not the research.
- **Chase/front/fly-by framings are invented, not data**; the `Camera` vocabulary has no
  distance/lag/damping term in 37,000 files; `OutsideHudOffset` is a reticle anchor;
  `CVM*` and `vehicleFov` are parsed by nothing; `setPivotPosition` unmodelled —
  `camera-modes.md` §§1–5, §9.
- **Engine audio is already generic across aircraft, tanks and ships** —
  `engine-sound.md` §7; `sounds.vehicles[]` in `scene.json`; "a Zero, a Sherman or a
  destroyer needs no new code".
- **Rig/animation for ground vehicles is solved at the extraction layer** —
  `bf1942-3d-models/README.md` §"How vehicles move": Springs as visual children of the
  Engine, the accumulator-vs-±1°-lean span rule, turret traverse with absent limits,
  `setAnimatedTextureSpeed` track scroll with the Z-mirror sign flip, boats' hidden
  `createInvisible` wheel drivetrain.
- **Aileron mirroring via `setAcceleration` sign** — `flyable-vehicles/README.md` and
  `flight-model.md` §3; landed in `con.py`.
- **Landing gear synthesis as `c_PILandingGear`** — `con.py:417-452`, commit `b7d97df`.
- **Cockpit interiors as a pruned second export** — `input-and-cockpit.md` §8, commit
  `9bbe407`. G13 is about what was *published*, not the mechanism.
- **Draw distance / fog fidelity** and the warning not to inflate the far plane for
  piloting — `flythrough-fidelity-gap.md`; `flyable-vehicles/README.md` §hazards.
- **`objectSpawnerId` → `Object.setOSId` link is unexported**, and vehicle
  `setMinimapIcon` markers are not drawn on the full map — `spawn-points.md` §7,
  `map-hud.md` §Open. G10 is the *timer* half, which those documents do not touch.
- **BF1942 has no terrain deformation and no wave displacement.** Both confirmed absent
  from the data; the viewer's flat water and undeformed terrain are correct.
