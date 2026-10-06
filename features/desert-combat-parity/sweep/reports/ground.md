I've finished the ground and sea census. Desert Combat's ground and sea vehicles score **78%**, and the gaps come from a few shared causes rather than vehicle-by-vehicle bugs.

# DC census: Ground and sea vehicles

## 1. Summary

**Domain score: 78%** (45.2 / 58 weighted). Guided launchers are left out because the weapons agent owns them. Counted here as Missing/High, the score would be about 74%.

- **What works:** the drive physics, measured on the real DC model files. All 26 wheeled and tracked vehicles DC 0.7 places settle level, reach the top speed their gearbox sets to within about 1.5%, steer the right way and stay upright. BMP-2, BRDM-2 and 2S1 (M-1974) swim. Collision meshes, wrecks, engine sounds and damage tables are complete. Bots crew and fire DC armour on levels that have AI.
- **What breaks:**
  - Non-amphibious vehicles drive on top of the sea and never take water damage.
  - The "static" Nimitz carriers can be sailed.
  - The Desert Patrol Vehicle spins out whenever it steers at speed.
  - Every wheeled vehicle uses the Willys jeep's mass, drag and inertia, so 10-tonne trucks turn like jeeps.
- **What's missing:** artillery spotting (the scout-camera view for artillery gunners). Five DC artillery vehicles and the Humvee's call-artillery seats depend on it.

Method: I loaded the real DC model files in node through the viewer's own modules (scripts in `~/.cache/dc-sweep/ground/`):
- `ground_census.mjs`: seat survey of every placed template.
- `ground_drive.mjs`: flat-ground drive and water float tests.
- `ground_ship.mjs`: ships.
- `ground_sim.mjs`: the headless match runner on real DC levels, with recipes `drive`, `throttle`, `wade` and `artillery`.
- `ground_turntrace.mjs`: turn traces.

I also ran 300 s bot matches. Baseline `test_ground`, `test_ship` and `test_seats` pass: 206 tests OK.

## 2. Inventory

Counts are placements across the 35 DC 0.7 level bakes, all modes, from the root vehicle objects in each level's `scene.glb`.

| Item | DC usage | Status | Weight | Evidence |
|---|---|---|---|---|
| Humvee family: drive, 5 seats, gunner, TOW seat | Humvee 82, Humvee_TOW 52, in 26/21 levels | Works | High | Top speed 111.5 km/h against the closed-form 112.6; full lock at 30 m/s gives 13.5 deg/s, no roll; reverse 27.8 km/h. Wheels stay on their springs (engine-axis fix, 30 Sep). Bots mount it (sim). |
| Light cars and technicals | Pickup 10, Technical 14, Technical_Recoilless 9, Lada 15, Forklift 5 | Works | Med | 95.1 against 96.5 km/h; Lada 111 against 112.6; turns 24–25 deg/s at 23 m/s, roll at most 9 deg. |
| Desert Patrol Vehicle (dune buggy) handling | 17 placements, 11 levels; the bots' favourite mount (11 of 40 on Desert Shield) | Broken (suspect) | Med | Full lock spins it about 190 deg within 2.25 s at 15, 22 and 30 m/s. Humvee, Willys and Kübelwagen at the same speed and lock turn 13–17 deg/s. Its origin sits 2.57 m behind the front axle and 0.94 m ahead of the rear. |
| Heavy wheeled (Ural5323, UralTanker, SA-19, BM-21, SCUD-B, Stryker, EE-9) | about 50 | Partial | Med | `GroundVehicle` uses `WILLYS` for mass, drag, bounding radius, inertia and wheel radius (`wheeled-vehicle.js:68`, 144, 153, 674; `map.html:835` passes no spec). SCUD-B turns 35.6 deg/s at 10 m/s. Its own wheel footprint gives 3.8x the Willys yaw inertia; Ural, Pantsyr and BM-21 2.1–2.4x. Pickup and EE-9 author drag 5.5 against the Willys' 1.5. Tracked vehicles read their own (`tracked-vehicle.js:147-149`). |
| Two-engine 6x6 trucks (Ural, Pantsyr) | 24 | Works | Low | Both engines are identical; one gearbox model drives all 8 wheels (`collectChassis` keeps the last). |
| BRDM-2 amphibious (wheeled) | 45 + 27 Spandrel | Partial | Med | Land 79.7 km/h; floats and swims at 25 km/h with rudder. The water kit is handed the Willys' mass 2500 and drag 1.5 against its own drag 0.041 (`wheeled-vehicle.js:144`). |
| Main battle tanks M1A1, T-72 | 79 + 73 | Works | High | 53.6 km/h (TANK §6 closed form); reverse 14.4; no pivot at zero throttle (TANK-2); turret and coax on the driver seat; MG seat. Bots fire both cannons on DC El Alamein. |
| IFVs M2A3 (Bradley), BMP-2 | 80 + 41 | Works | High | 53.6 km/h. BMP-2 swims at 12 km/h on Urban Siege (sim). Bots fire M2A3 TOW and BMP-2 AT-5 rounds. |
| Tracked AA M163, Shilka | 34 + 20 | Works | Med | 53.6 km/h; one seat aims and fires; barrel spin on `c_PIFire`. Bots fired 68 / 125 rounds. |
| Artillery: drive and fire (M-109, M-1974, MLRS, BM-21, SCUD-B) | 29 / 19 / 23 / 9 / 13 | Works | Med | The drive works. The driver seat has no entry point; players reach it by seat switch (`local-player.js:219`). Gun seats elevate to -85 / -89 deg and fire. |
| Artillery spotting and scout camera | `artPos 1` on all 5 artillery gun seats plus the mortar; `CallArtillary`/`AltCallArtillary` (`magType 2`) on Humvee passenger and gunner | Missing | Med | `artPos` and `magType` are read by neither exporter nor viewer. `features/artillery-spotting` is research only (SPOT-1..16). |
| Land vehicles in water | Every water map (Al Khafji, Sea Rigs, Bragg, Urban Siege, Oil Fields, No-Fly Zone, Desert Shield, remakes) | Broken | Med | The floor is max(terrain, water) (`world-collider.js:500-504`; `amphibious.js:46` says so). Sim on Bragg: Humvee at +0.38 m over 6.6 m of water reaches 31 m/s with HP 100 after 9 s, despite `damageFromWater 1`. M1A1 sits on 27 m-deep water unharmed. DC's `submarineData` crush depth (14 land vehicles, e.g. M1A1 1.5 m at 5 HP/s, PHY-3) is never read. |
| RHIB (DC names it `Lcvp`) | 9, in 3 DC levels and nested in carriers | Works | Med | Ship model: floats, 20.1 m/s (72 km/h), 28.7 deg/s at full rudder. Top speed is uncalibrated, as for all ships (viewer-ships §7). |
| OSA-2 missile boat | 5 (Midway, Guadalcanal) | Partial | Low | Drives at 31–35 m/s (about 125 km/h). Run into Midway's beach at 35 m/s it is thrown up and ends 11 m above the terrain, flagged aground. |
| "Static" Nimitz carriers | Nimitz_Static (Midway, Wake), _Heli (Sea Rigs), _Heli_UrbS (Urban Siege) | Broken | Med | DC writes `hasMobilePhysics 0` on every Nimitz. `con.py:2114` parses it, but it never reaches the extras. These variants classify as `ship` and sail: Sea Rigs carrier at 7.5 m/s after 50 s and still accelerating. The helm seat has 3 entry points. |
| Carrier point defence (CIWS, Sea Sparrow seats) | nested in every Nimitz | Partial | Low | Gun seats work. CIWS `autoFire` is not read; Sea Sparrow guidance belongs to the weapons agent. |
| WW2 ships on DC remakes (Fletcher, Hatsuzuki, Prince of Wales, Yamato, Shokaku, Gato, Sub7C) | about 20 | Works | Low | Fletcher on DC Midway: 15.2 m/s, matching viewer-ships §12.5. Prince of Wales 17.5 m/s. |
| Stationary MGs | Browning 159, MG42 58 | Works | High | Gun seats with aim axes; bots fire them (vanilla recipes share the path). |
| AA guns (ZPU-4, AA_Allies, flak38, Defgun) | 73 / 71 / 28 / 16 | Works | Med | Gun seats; `addFirearmsPosition` (multi-barrel) is read; a bot ZPU-4 scored a kill (Desert Shield sim). |
| SA-3 SAM site | 17 / 4 levels | Partial | Low | Seat works; the guided missile and `enableRadarMode` are the weapons agent's. |
| Damage and armour | all | Works | High | DC `damage.json` has 213 materials. Hits per kill: RPG/SMAW 35 against M1A1, 60 against Bradley/BMP; TOW 60 against MBT; M1A1 shell 40 against MBT, 500 against Humvee. Six damage scripts listed by DC are absent from DC itself. |
| Wrecks | all land vehicles | Works | Med | A wreck model exists for every DC land vehicle; static guns, RHIB and OSA have none. |
| Collision meshes | 34 hulls checked | Works | High | 100% geometry coverage in `_shared/collision-meshes.json`. |
| Engine sounds | all land and sea templates | Works | Med | Every template has an entry in `vehicle-sounds.json`; no missing files. |
| Seats, inputs, turrets, exits | all | Works | High | Bindings are only `c_PIYaw`, `c_PIMouseLookX/Y`, `c_PIFire` spin and `c_PIPitch`. `hasRestrictedExit` and `soldierExitLocation` are read. The Stryker's mouse-look driver camera is read. |
| Forklift forks (`c_PIPitch` on a ground vehicle) | 5 | Missing | Low | `world-vehicle-tick.js:204` feeds pitch to ships only. |
| Random body variants (Lada, Pickup `setRandomGeometries`) | 25 | Partial | Low | Always built as variant 1 (`assemble.py:2426`); no roll per spawn. |
| Depot repair by vehicle type (`addVehicleType`; Humvee carries 2 depots; carrier pads; Medina Ridge kill-traps) | many | Partial | Low | Exported as `supply.vehicleTypes`; `supply.js` never reads it (SUP-3, SUP-14). |
| Bots driving DC vehicles | AI on 2 of 16 DC levels (Basrah's Edge, Desert Shield) plus the remakes | Partial | Med | DC El Alamein: 33 mounts, cannon / TOW / AT-5 fire. Basrah's Edge: the tank nav map is 81.5% blocked inside the combat area, so bots log 943–1200 route failures in 40 s and move under 0.4 m. Artillery driver seats are never offered to bots (`bot-units.js:394` builds candidates from entry points). |
| DC Final extras (BMP-1, M6, SA-9, Humvee MK19 / minigun, M-923, Ural variants) | about 50 | Works | Low | Same drive classes, same numbers: BMP-1 swims at 15 km/h; M-923 at 72 km/h. |
| *Not scored (weapons agent):* guided launchers on vehicles | Humvee_TOW 52, M2A3, BMP-2 AT-5, BRDM-2 Spandrel 27, OSA Silkworm, Gato Tomahawk, SA-3 | Missing | (High) | No guidance code anywhere; rockets fly ballistic (`projectile-flight.js:460`). |

## 3. Root causes

1. **`GroundVehicle` is the Willys.** No caller passes a spec (`map.html:835`, `sim/stage.mjs:112`), so every wheeled vehicle uses `WILLYS` for mass, drag, bounding radius, inertia, wheel radius and suspension travel. The amphibious water kit gets the same numbers. `TrackedVehicle` already reads the hull's own mass and drag and the wheel footprint. This causes the heavy-wheeled and BRDM-2 rows, and the Pickup / EE-9 drag error.
2. **A land vehicle's floor is the sea surface.** `level.groundHeight` is `surfaceHeight`, which is max(terrain, water). Only amphibians re-wrap it with `bedGroundHeight`. A vehicle riding at +0.38 m never "touches water" (`world-damage.js` `inWaterOwners`), so `damageFromWater` never fires either. `submarineData` (PHY-3) has no consumer.
3. **Per-template words that are parsed but never delivered:** `hasMobilePhysics` (static carriers), `artPos` and `magType 2` (spotting), `addVehicleType` (depots), `setRandomGeometries` (per-spawn roll), `autoFire` (CIWS), `enableRadarMode`.
4. **Bot vehicle candidates come from entry points.** A driver seat with no entry point is invisible to bots; this covers all five DC artillery vehicles.

## 4. Work packages

**G1. Make wheeled vehicles read their own chassis.** Closes heavy wheeled and BRDM-2 water drag; size S.
- Problem: `wheeled-vehicle.js:68/144/153/674` use the Willys table. Read root `physics.mass` and `drag` the way `tracked-vehicle.js:147` does. Derive bounding radius and yaw / pitch / roll inertia from the wheel footprint, or better the collision box (`getGeometryInertia`, collision-response §4.2: Iy = (DX²+DZ²)/3). Measure wheel radius off the wheel mesh.
- Engine source: collision-response §4.2, TANK §6, physics.md §3 drag.
- Files: `viewer/wheeled-vehicle.js`, `viewer/ground-specs.js`, `tests/ground_harness.mjs`, `tests/test_ground.py`. **Hot file:** `wheeled-vehicle.js` is shared with G2 and G5; land this first.
- Proof: `ground_drive.mjs` SCUD-B turn at 10 m/s drops about 3.8x; the Willys and Kübelwagen numbers and `test_ground` stay unchanged.
- Re-extract: none (extras already carry mass and drag).

**G2. Land vehicles sink to the sea bed and take water and depth damage.** Closes land vehicles in water; size M.
- Problem: give every land vehicle `bedGroundHeight` (not only amphibians). Let `inWaterOwners` and `touchesWater` see a submerged hull. Implement the `submarineData` tick per PHY-3: every 0.5 s, crush damage below the 6th value at the rate of the 7th; oxygen and suffocation of the occupants from the 1st, 3rd and 5th.
- Engine source: PHY-3, HP-5 / COL-4 (water damage), collision-response §7. Needs an engine read on what a non-floating hull's springs do under water: is there drag, and are wheels on the bed driven?
- Files: `viewer/map.html` `buildHullDrive` plus its mirror `sim/stage.mjs` (shared hot file), `amphibious.js` `bedGroundHeight`, `wheeled-vehicle.js` / `tracked-vehicle.js` constructors (sequence after G1), `world-damage.js`, `vehicle-damage.js`.
- Proof: `ground_sim.mjs wade dc_operation_bragg Humvee/M1A1` sinks to the bed and loses HP; `wade dc_urban_siege BMP2` still swims at about 3.3 m/s; vanilla tests stay green.
- Re-extract: none.

**G3. Keep `hasMobilePhysics 0` vehicles static.** Closes static Nimitz; size S–M.
- Problem: emit `hasMobilePhysics` into the root's `extras.physics`; `rootDriveKind` (`seat-survey.js:333`) returns null for a static root, so the seat stays enterable but builds no drive.
- Engine source: needs an engine read of what a vehicle root with `hasMobilePhysics 0` gets (only TANK-7, refuted, touches the flag).
- Files: `bf42/assemble.py`, possibly `bf42/con.py`, `viewer/seat-survey.js`, a seats test.
- Proof: `ground_sim.mjs throttle dc_sea_rigs Nimitz` moves 0 m; vanilla Enterprise on Midway still sails.
- Re-extract: yes. Nimitz* models in the DC and DC Final trees, plus a full bake of DC Sea Rigs, Urban Siege, Midway and Wake (and DC Final's levels that place Nimitz_Static*). Then `optimise_mesh.py` and publish. `patch_scene --mod` does not accept DC.

**G4. Build artillery spotting.** Closes artillery spotting; size L.
- Problem: the marker weapon (`magType 2`: soldier binoculars, Humvee `CallArtillary`), the team marker list, `artPos` seats with `CVMExternTrace`, view mode 17, `c_PIAltFire` toggle and next / previous marker.
- Engine source: SPOT-1..SPOT-16 and the `features/artillery-spotting` README.
- Files: a new viewer module, `hand-fire.js` / `gunfire.js`, `seat-camera.js` / `seat-view.js`, `map.html` (hot), the netcode marker list; the exporter must emit `artPos` and `magType` (`con.py` / `assemble.py`).
- Proof: a node harness that places a marker and checks the view, plus a sim recipe.
- Re-extract: models for every tree with `artPos` (vanilla too) and a full bake of levels whose placed vehicles carry it.

**G5. Fix the DPV spin-out.** Size M; land after G1.
- Problem: measured above. Check it against the real game first (skill `bf1942-server-lab`: drive a DPV at 15 m/s, full lock), then fix tyre lateral grip and weight distribution as needed.
- Engine source: collision-response §8 (friction), §4.2 ("turns about its origin").
- Files: `wheeled-vehicle.js`, `ground-contact.js`.
- Proof: `ground_turntrace.mjs DesertPatrolVehicle 15 1 3` shows no spin past 90 deg; Humvee unchanged.
- Re-extract: none.

**G6. Make bots drive DC vehicles everywhere AI exists.** Size M.
- Problem, part (a): Basrah's Edge vehicle nav. The archive's `Tank0Level0Map.raw` is only 18 KB for a 1024 m world; the viewer decodes it 81.5% blocked inside the combat area. Decide whether the decoder is wrong or DC really authored it that way.
- Problem, part (b): offer door-less artillery driver seats via the gun seat plus a seat switch. Needs an engine read on how the SAI reaches a driver seat with no entry point (`BBChange`).
- Files: `viewer/nav-baked.js` / `nav-map.js`, `bot-units.js`.
- Proof: `ground_sim.mjs drive dc_basrahs_edge Humvee 40 150` moves more than 100 m; the M-109 driver seat appears as a root candidate.
- Re-extract: none if the fix is in the viewer decoder.

**G7. Read the small DC data words.** Size S, low value.
- Forklift `c_PIPitch` (`world-vehicle-tick.js:204`).
- Per-spawn random body roll (`assemble.py` plus `random-items.js`).
- Depot `vehicleTypes` (`supply.js`; SUP-3, SUP-14).
- CIWS `autoFire`.
- OSA beach launch (`ship.js` `settle`).
- Each is separate from the others; random geometry needs a re-extract of Lada and Pickup plus a full bake.

## 5. Open questions

1. **DPV:** does the real game also spin it out at full lock? The two vehicle bodies have the same footprint inertia, so this is a tyre or weight-distribution question.
2. **`hasMobilePhysics 0` on a root with engines:** truly immovable, or only without a driver?
3. **Basrah's Edge nav map:** authored that way, or mis-decoded?
4. **Door-less artillery driver seats:** does the real game's AI ever drive them?
5. **Ship top speeds** (RHIB 72 km/h, OSA 125 km/h) are uncalibrated pending the `underWater` read (viewer-ships §7). The OSA beach launch may share a root cause.
6. **The Humvee's `CallArtillary` (`magType 2`):** what does it do today when fired? Is it treated as an ordinary projectile weapon? I did not check in the page.
7. **Machine-gun rounds against vehicles:** DC lists `HeavyMachineGuns.con`, `AssaultRifles.con` and four other damage scripts it does not ship, leaving material 990 with no damage modifiers. Does the real game also do zero damage there? This is the weapons agent's question.
8. **Not in my domain, flagged:** DC Final's LCAC hovercraft (4 jet-type engines, 14 springs, 4 floats) classifies as an aircraft but no DC Final level places it. Operation Bragg's UST/IST/USK/ISK objects and the US_AA / US_Sniper_hvy kit pickups have no model file.

Raw outputs are in `~/.cache/dc-sweep/ground/`: `ground_census.json`, `ground_drive.json`, `ground_drive_dcf.json`, `sim_*`, `ground_damage_table.txt`.