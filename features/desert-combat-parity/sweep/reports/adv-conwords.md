I found 13 gaps in the DC port that the census missed, and four census verdicts that don't hold up. The three that matter most:

- **Missing helicopter parts:** con.py only reads `ObjectTemplate.geometry`, so 23 DC templates that write `setGeometry` get no mesh. The Apache has no chin gun or rocket pods, the Mi-24 has no chin turret, the Harrier has no nozzles.
- **Flipped vehicles never die:** nothing ever calls the upside-down damage tick.
- **Rifle spread while turning does nothing:** DC adds spread when you turn on every rifle, LMG and launcher. Vanilla never does, and the viewer's mouse units leave it dead below 15 rad/s.

Everything was traced from the archives through the exporter and glb extras to the viewer line that uses it. One measurement ran on the viewer's own `deviation.js` in node; nothing else was run, no browser was used, and nothing in the repo was changed.

**Census in numbers**
- 1,020 distinct statement words across DC 0.7, DC Final, vanilla, XPack1 and XPack2. DC uses 785 of them in 261,529 statements.
- 249 of DC's words (15,498 statements) never appear in any exporter string. Most are networking, rendering, AI look-ahead and Battlecraft defaults.
- 15 words appear only in DC. Most are typos the engine also ignores: `setRotatation`, `setPostion`, `hasResponsePhsics`, `objectTempalte`, `bjectTemplate`.
- 12 words DC uses at least 3× as often as vanilla. The ones that matter: `GeometryTemplate.scale` (70 vs 2), `proximityFusePrimer`, `weaponTemplate.exitVelocity` / `useAimerOnly`, `submarineData`, `startEffectTemplate`, `tracerScaler`.

The census's 13 known words check out (`hasMobilePhysics`, `artPos`, `magType 2`, `addVehicleType`, `setRandomGeometries`, `autoFire`, `enableRadarMode`, `submarineData`, spawner `TimeToLive`, `explosionForceMod`, `repairFactor`, hand `heatAddWhenFire`, `setAirKeyboardSensitivity`), with two clarifications:
- `magType` is exported (`assemble.py:2132`); only the viewer ignores it.
- `setAirKeyboardSensitivity` lives in the control profile's `Settings/Profiles/*/Controls/Air.con`, not in DC's archives.

## 1. Findings

| Id | Finding | Evidence | Impact | Confidence |
|---|---|---|---|---|
| CW1 | **`ObjectTemplate.setGeometry` is not parsed.** 23 DC templates (23 in DC Final) declare their only mesh this way, so the viewer draws nothing for them: the AH-64's M230 mount, nose sensors and Hydra pods; the Mi-24's gun turret, mount and barrel, S-5 pods, AT-2 tray and rear gear; the AH-6/OH-6/MH-6/MD500/MH500 parts; the AV-8's four exhaust nozzles. | `con.py` reads only `geometry`. In the glbs, AH64 `AH64M230Base`, `AH64NoseMount`, Mi24D `Mi24DGGunTurret` and AH-6 `AH6Parts` are nodes with `geometry: null` and no mesh; AH64 `AH64HydraBundle`, Mi24D `Mi24D_S5Pod` / `Mi24D_AT2Tray` and the AV-8B exhausts are missing entirely. The `.sm` files exist in `STANDARDMESH.rfa`. The engine string table has only `geometry`, and vanilla's 867 `setHasCollisionPhysics` lines (registered as `hasCollisionPhysics`, TM-5) show the console accepts the `set` spelling. | High: AH-64 on 15 spawns, Mi-24 on 23, H-6 family on 28 | High (the console's set-prefix strip itself is unread) |
| CW2 | **Upside-down damage never runs.** `VehicleDamage.update(dt, {inWater, upsideDown})` has a working upside-down tick, but nothing computes the flag. A flipped Humvee or tank lives forever and never frees its pad. | `vehicle-damage.js:518` passes only `{inWater}`; `world-damage.js:37` passes only `inWaterOwners`; no `upsideDown` caller in `viewer/` or `sim/`. Never wired since `d813ed13`. DC: 17 templates at 100 HP/s (helicopters), 24 at 10, 18 at 5. | High (all mods) | High |
| CW3 | **DC's turn deviation does nothing in the viewer.** Every DC rifle, LMG, sniper and AT weapon declares `setTurnDev` (M16 `2 0.1 0.2 0.1`, PKM `3 0.15 0.3 0.1`); vanilla's are 0. `deviation.js` divides look rate in rad/s by 30, so the per-tick raise never beats the 0.1 decay. | Node run of the real `DeviationModel`: M16 turn channel is 0.000 at 0.5, 1.5, 3, 6 and 15 rad/s and reaches 2.0 only at 30 rad/s; PKM stays 0 below 3 rad/s. The magnitude of the `MouseLookX/Y` input is an open question in the ledger (GUN-2b). | Med-High (every DC infantry fight) | High that it does nothing here; what retail does needs an engine read |
| CW4 | **Every shell bursts when its time-to-live runs out, whatever `hasOnTimeEffect` says.** Retail bursts only rounds that set it (PROX-7, already marked "not modelled" in the ledger but missing from the census). DC writes `hasOnTimeEffect 0` on the Shilka (TTL 1 s, 5 m splash) after removing its proximity fuse ("Tan changed"), so the viewer brings back flak airbursts DC took out. | `projectile-flight.js` calls `endRound(…, expired)` → `round-impact.js detonate` → `splashSpec` treats damageType 1/4 as end-of-life. 46 DC damageType-1 rounds lack the flag, e.g. Sabot (4 s, r 3), AC-130 howitzer (4 s, r 15), Spandrel, SA3RocketProjectile (1.5 s, r 20). Bullet-kind rounds (M163) take the tracer path and never burst. | Med (AA guns against helicopters) | High |
| CW5 | **`GeometryTemplate.scale` is not applied.** DC has 70 of these, vanilla 2. The AC-130 is drawn at 80% of its retail size. | Not in con.py's GeometryTemplate branch. Engine string `I@GeometryTemplate.scale ` (0x0091845e). AC-130 parts ×1.25 (fuselage 28.6 m in the glb), Pickup/Technical hull ×1.1, BRDM-2 wheels ×0.95, M-109 front wheels ×0.9, M2A3 wheels ×0.92, M1A1 MG console ×1.2, mortar/ammo-crate base ×4, Sandbag base ×0.001, in-flight SA-3 0.3/1/1, AC-130 Bofors barrel ×2. XPack2's Wasserfall (0.3/1/1) and K98 rifle grenade (2/2/2) too. | Low-Med (visual, maybe collision) | High on data; scope needs an engine read |
| CW6 | **`setBlastAmmoCount` is not parsed.** A-10 GAU-8 and SU-25 guns 5, Minigun 5, SA-342 gun pods 2, shotguns 1. Either a pull uses 5 rounds (the A-10's 1,350 rounds last 13.5 s, not 67 s) or it fires 5 projectiles (5× the damage). | No mention anywhere in the repo; registered word `blastAmmoCount` (0x008e2f3c). | Med (A-10 on 16 spawns, SU-25 on 18) | High that it's ignored; which meaning needs an engine read |
| CW7 | **`setAutomaticYawStabilization` / `setAutomaticPitchStabilization` are not parsed.** DC sets them on the Humvee and Humvee-TOW gunner mounts, DPV 50cal/Mk19, BRDM-2 turrets, EE-9 tower, M1A1/M-109 MGs and MH-53 50cal. | Same words exist in vanilla. `manned-guns.md` has the offsets (+0x1a5/+0x1a6), but the consuming code is unread. | Med (Humvee gunner every round) | Needs an engine read |
| CW8 | **A vehicle that blows up hurts nobody.** PCO `explosionDamage` / `explosionRadius` / `explosionForceMod` are not parsed. | The formula is closed (HP-9) and was researched in `features/viewer-collision-damage` R1/R2, but never built. DC: Guided_Tomahawk 200, weapon bunkers 20 at r50, the Medina landslide. | Med (all mods) | High |
| CW9 | **Capture-time guard assumes vanilla's range:** `captureDuration` turns `timeToGetControl 0` into 5 s. | `bot-referee.js:92`. DC Medina Ridge `oasis_town`, `outpost_pass`, `opposition_base` are 0. | Low | High on the code; retail's compare (`gettingControl` 0x08283f20) is unread |
| CW10 | **The Forklift steers backwards and parks as a boat.** Its rear wheels declare `setAcceleration -50/0/0`, and `wheeled-vehicle.js` gives every steered wheel the same steer, ignoring the rig's direction. Its root is `setVehicleCategory VCSea`, so `hull-bodies.js isSeaHull` gives it no parked body. | `wheeled-vehicle.js:534` vs `rig.axes.yaw.direction`; `hull-bodies.js:98`. | Low (5) | High |
| CW11 | **Pitch reaches only ships, but DC binds it on ground vehicles.** The Ural5323 ramp is live on `c_PIPitch`, which extends the known Forklift gap G7. The M2A3 ramp is inside `beginrem`, so it is dead in retail too. | `world-vehicle-tick.js:204`. | Low | High |
| CW12 | **Bots ignore `weaponTemplate.exitVelocity` and `useAimerOnly`.** They lead with the FireArms velocity. | DC sets 72 on MLRS/BM-21/SCUD, 300 on Hellfire/TOW/AT-5/Spandrel, 150 on Hydra, −5 on the CBU and Snakeye. AI-89 says the Aimer uses `Weapon::getExitVelocity`. Not parsed by con.py's weaponTemplate branch. | Low-Med (bot artillery and missiles) | High |
| CW13 | **`toggleMouseLook` isn't exported; the viewer guesses "root seat of an air hull".** DC also puts it on five non-root seats: the H-6 and SA-342 co-pilots, the SA-342 and MH-6 passengers, and the Stryker passenger (a land vehicle with no `c_PIMouseLook` key). | `mouse-look-key.js:54`. | Low | High on data; MLK-2/3 say what retail does with it |
| CW14 | **Collision ignores `setHasCollisionPhysics 0` on ordinary meshes; it only gates trees.** In DC that covers Sea Rigs' interior groups and helipad, market-building addons, wires and Pantsyr parts. The bare `hasCollisionPhysics` spelling (1,473 DC lines) isn't parsed at all; I checked that no tree uses it. | `assemble.py _object_emits_geometry_collision`; 14 collision nodes under Sea Rigs' interior and helipad placements. collision-response §5.2 says flag 0x200 is required for collision, but how it derives from this word is unread. | Low-Med (all mods) | Needs an engine read |
| CW15 | **Weapon fire camera shakes are not built.** DC declares 303 `setCameraShake*` lines on its fire states (`Ub_Fire<W>`), e.g. Stinger UpDown 1 at 500, M16A2 pitch 0.25. | `soldier.js` BOB covers walking bob only. CS-6 says fire shakes run at factor 1.0. | Low-Med (all mods) | High |
| CW16 | Same `set`-prefix miss in DC Final only: bare `damping` and `strength` on 5 springs fall back to defaults; `setHasMobilePhysics` on the DC Final mortar, fuel drum and ammo crate. | Spelling sweep: other spelling handled, this one not. | Low | High |

## 2. Census verdicts overturned

- **Air #28 "Crash and damage: Works (upside-down and water HP loss)".** Upside-down is dead code (CW2).
- **Weapons #19 "Ballistic rounds: Works" and #20 "Proximity fuses: Works".** The fuses themselves work, but every shell bursts when its time-to-live runs out, which DC explicitly turned off for the Shilka (CW4).
- **Weapons #2 "Rifles … deviation from data: Works".** DC's turn deviation is dead (CW3).
- **Ground "Forklift: Works".** It drives at the right speed, but steers inverted and parks as a boat (CW10).
- Minor: the ground report says `magType` isn't exported. It is; the viewer just doesn't read it.

## 3. Work packages

**A. Accept the `set`-prefix spellings in con.py and re-extract the helicopters and Harrier** (closes CW1, CW16; size S, plus an asset job).
- **Problem:** con.py's ObjectTemplate branch reads only one spelling of each command. My sweep found `setGeometry` (DC), `hasCollisionPhysics` (bare), `setHasMobilePhysics`, and in DC Final bare `damping` and `strength`.
- **Engine source:** TM-5 and HP-4 (property lookup ignores case). One engine read would confirm the console strips `set` generally.
- **Files:** `bf42/con.py` (normalise the command name before the elif chain). Shared hot file: kit-pickups touches `bf42/kit.py`, not con.py.
- **Proof:** a unit test that `setGeometry X` sets `obj.geometry`. After the re-extract, AH64 `AH64M230Base`, Mi24D `Mi24DGGunTurret`, AH-6 `AH6Parts` and AV-8B `AV8FrontExhaust_L` each carry a mesh.
- **Assets:**
  - Re-extract `AH64`, `Mi24D`, the H-6 family and `AV-8A/B/C/H/M` in the DC and DC Final trees, together with the cockpit re-extract already queued as air WP4.
  - The Nimitz decks bake AV-8As into `scene.glb`, so Midway, Wake, Iwo Jima and Sea Rigs need a full bake.
  - Then `optimise_mesh.py` and `publish-mesh-delta.py`.

**B. Make upside-down vehicles lose HP** (closes CW2; size S-M).
- **Engine source:** HP-5 (cadence). **Needs an engine read:** the upside-down test inside `Armor::update` 0x08172f40. The bots' `up·normal < 0.6914` (AI-44) is a different test.
- **Files:** `world-damage.js` (owned by ground-chassis), `vehicle-damage.js`, and the `sim/` mirror.
- **Proof:** a harness rolls a Humvee and an AH-64 past the threshold; HP falls 10 or 100 per second and the wreck appears.
- **Assets:** none; `hpLostWhileUpSideDown` is already in the extras.

**C. Burst at time-to-live only when the round sets `hasOnTimeEffect`** (closes CW4; size S).
- **Engine source:** PROX-7, HP-9d.
- **Files:** con.py and the projectile damage block (`assemble.py` and/or `extract_map.py`'s projectile table), plus `projectile-flight.js` (owned by the rounds agent).
- **Proof:** a DC Shilka round expires with no splash; vanilla `AA_Allies` and `Flak38` still burst between 240 and 420 m.
- **Assets:** a damage-layer re-extract for every tree (`patch_scene --mod` does not accept DC; ground report), or a model re-extract if the flag goes into the glb.

**D. Apply `GeometryTemplate.scale`** (closes CW5; size M).
- **Needs an engine read:** whether the scale reaches collision and LOD bounds as well as rendering (find `StandardMeshTemplate`'s scale consumer).
- **Files:** `bf42/con.py`, `bf42/assemble.py` (mesh node scale), `extract_collision_meshes.py`.
- **Proof:** the AC-130 fuselage measures 35.8 m; the Pickup wheel radius matches.
- **Assets:** re-extract the DC/DC Final models listed in CW5 and XPack2's Wasserfall and K98 grenade, plus full bakes of the levels that bake them.

**E. Settle the mouse-look magnitude so DC's turn spread works** (closes CW3; size S once the read is done).
- **Needs an engine read:** GUN-2b, the client's `ControlMap` pipeline (`FUN_006bba90` / `FUN_006bbd90`), i.e. what `PlayerInput[c_PIMouseLookX/Y]` carries per tick. Sharing this with air-input's mouse-flight work saves one read.
- **Files:** `deviation.js`, `hand-fire.js` (shared with hand-weapons).
- **Proof:** an M16 swung at retail's typical rate reaches the 2° cap; vanilla is unchanged (its turnDev is all zero).

**F. Small data words, one agent** (closes CW9, CW10, CW11, CW13, CW12; size S each).
- Read the steer direction per wheel (`wheeled-vehicle.js`, owned by ground-chassis).
- Classify the Forklift by drive type, not `VCSea` alone (`hull-bodies.js`, owned by spawner-pads).
- Feed `c_PIPitch` to roots whose seat binds it.
- Allow `timeToGetControl 0`, pending the `gettingControl` compare.
- Export `toggleMouseLook` per Camera, and stop inferring it (`assemble.py`, `mouse-look-key.js`).
- Parse `weaponTemplate.exitVelocity` and `useAimerOnly` into `vehicle-ai.json` and have the bots' lead use them (bots package).

**G. Vehicle death explosion** (closes CW8; size M). The engine side is HP-9 plus `viewer-collision-damage` R1/R2.
- **Files:** con.py/assemble.py (export the PCO's three words), the death path in `vehicle-damage.js`/`vehicle-wrecks.js`, `projectile-damage.js` for splash.
- **Proof:** a harness kills a Sherman next to a soldier; he takes `5·(1−d/8)` times the material modifier.
- **Assets:** model re-extract (all mods).

**H. Engine reads before building** (CW6, CW7, CW14):
- `FireArms::Fire`'s use of `blastAmmoCount`.
- The consumer of RotationalBundle +0x1a5/+0x1a6 (stabilization).
- How `hasCollisionPhysics` becomes object flag 0x200 for static meshes (handlers at 0x081b8625–0x081b8969).

Each then becomes a small viewer change.

**I. Weapon fire camera shakes** (closes CW15; size M, all mods). Extract `Ub_Fire<W>` shake states (CS-1..7) and play them on the hand-weapon fire event at factor 1.0. The CS rows already cover the engine side. Files: an extractor for `animationstates*.con`, `soldier-view.js`, `hand-fire.js`.

## 4. What I could not settle

- Whether the console accepts `setX` for every registered word `X`. The data says yes (vanilla's 867 `setHasCollisionPhysics`), but the dispatch code that strips `set` is unread.
- What `blastAmmoCount` does: rounds used per pull, or projectiles per pull.
- What automatic yaw/pitch stabilization does (world-frame hold or something else).
- Retail's mouse-look units (GUN-2b), which decide how strong DC's turn spread really is.
- Whether `GeometryTemplate.scale` scales collision.
- Whether a `hasCollisionPhysics 0` static mesh blocks soldiers.
- Retail's capture compare when `timeToGetControl` is 0.
- The real Armor upside-down test.
- Whether `spawnPointManager.groupStatus` and `game.assaultTeam` matter. Neither appears in the binary's strings, so they are probably dead lines.
- How the UH-60's `*_Cam_View` behaves in the page. It is a pilot camera bound to fire that swings 60° when fire is held, and judging it needs the browser.
- Owner decision, not a gap: DC's `SoldierCamera` allows chase, front-chase, fly-by and trace views on foot (vanilla allows only first person). The viewer keeps vanilla's single view, as decided on 2026-09-26.

Everything is in `~/.cache/dc-sweep/adv-conwords/`:
- `cw_table.tsv`: all 1,020 commands with per-mod counts, how many levels use them, the template classes, exporter and viewer hits, and DC's value ranges against vanilla's.
- `cw_verdicts.tsv`: the 33 rows I investigated, with a verdict each.
- `cw_outliers.tsv` and `cw_outliers_gameplay.txt`: the 425 numeric slots where DC goes outside vanilla's range.
- `inputs.json`, `binds_dc.json`, `kinds.json`: input bindings per class and root vehicle, and the classes DC creates.
- `node/turndev.mjs`: the deviation measurement.
- `dump/`: every .con/.inc from DC, DC Final, vanilla, XPack1 and XPack2.
- The scripts that produced them: `cw_*.py`.