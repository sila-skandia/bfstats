## Desert Combat census: levels, game modes, world and bots

### 1. Summary

**Domain score: about 79%** (52.0 of 66 weighted points).

- The level bakes are thorough and up to date. All 35 DC 0.7 levels are baked, they all load in the headless runner, and every one of the 10,855 textures they point at exists. A dry run of the con layers (control points, spawns, game, environment) over a scratch copy of all 35 `scene.json` files changes nothing.
- The gaps are in the round rules rather than the data:
  - Vehicle pads never switch to the capturing side's vehicle.
  - Abandoned vehicles never time out.
  - Destroying an object that carries spawn points never removes those spawns.
  - CTF is not wired into the page at all.
  - Per-vehicle-type repair pads do nothing.
- Bots play on the 22 levels the game ships AI data for, but on several of them up to a third of a side stands still all round. Medina Ridge's ground texture is scrambled.

### 2. Inventory

| # | Item | DC usage | Status | Weight | Evidence |
|---|---|---|---|---|---|
| 1 | Level roster and bake completeness | 35 level archives = 35 `maps.json` rows. 19 are `dc_*`/DC-made, 16 are vanilla-named DC overlays (14 to 22 files each, mounted over vanilla). Each has `scene.glb` + `.gz`, `terrain/`, `sky/`, `lightmaps/`, `minimap/` | Works | High | `levels_scene.py`; loading backgrounds and music all exist |
| 2 | Terrain (heightmap, tiles, detail, materials) | 34 levels correct. Sea Rigs has no terrain at all (0 tiles, all water) | Works | High | `scene.json.terrain` |
| 3 | Medina Ridge terrain texture | Ships 8x8 texture tiles over a 1024 m world. The bake draws Tx00..03 at a fixed 256 m patch, so the top-left quadrant is stretched over the whole map | Broken | Low | `missingTiles`=48. The 8x8 mosaic matches the minimap and the 4x4 does not: `~/.cache/dc-sweep/levels/levels_medina_compare.png`. DC Final has the same fault |
| 4 | Sky, fog, lighting, env map, lens flare | Every level has a sky; lens flare on 19 | Works | High | Each level's own sky since `56965780` |
| 5 | Night level (Basrah Nights) | Dark fog (0.09) ending at 130 m, ambient 0.08, own sky, 294 lightmaps | Works | Med | From data; not seen in a browser |
| 6 | Water | 30 levels; Sea Rigs is water only | Works | Med | `scene.json.water` |
| 7 | Lightmaps | All 35 | Works | Med | |
| 8 | Minimap | All 35 | Works | High | |
| 9 | Loading screen and music | Nine DC load pictures, `vehicle4.mp3` | Works | Med | `maps.json` |
| 10 | Briefing | 34 have one. 73 Easting ships none; No Fly Zone shows the raw key `MULTIPLAYER_MAP_TYPE_CONQUEST_MAP` | Works (same as retail) | Low | DC `lexiconall.dat` lacks the key |
| 11 | Placed statics | 232 to 1,948 per level | Works | High | Unresolved names are only sound/sky templates (`coastline`, `lake`, `island*`, `Tsun`) and DC's own typo `BRMD2`. The missing meshes are vehicle parts no archive ships |
| 12 | Trees and foliage | 97 billboards | Partial | Low | `_shared/trees.json.missing`: 12 Pacific palms, ferns and jungle trees (Guadalcanal, Wake, Midway, Iwo Jima) |
| 13 | Ambient and area sounds, DC radios | Area sounds on 32 levels; `iraq_radio`/`us_radio` play as point sources | Works | Med | `sounds.areas` |
| 14 | Ladders | `isLadder` on 32 levels | Works | Med | Generic ladder code |
| 15 | Supply depots | Heal and ammo work. **102 DC repair points** (`repairpoint`, `Coalition_/Opposition_Repairpoint`, `Airplane1/2Repairpoint`, `NimitzRepairpoint`) carry only `addVehicleType` rates | Partial | Med | `extras.supply.vehicleTypes` is exported by `bf42/assemble.py:3026` and read by nothing in `viewer/` |
| 16 | Combat area | 20 levels declare one, the rest default to the whole terrain | Works | Med | `combat-area.js` |
| 17 | Conquest | All 35 levels; both sides get spawns in every game type | Works | High | `levels_spawnflags.mjs` run through the viewer's own `spawnFlags()` |
| 18 | CTF | Offered on **24** DC levels (37 in DC Final). Every one has 2 `flagBases` | **Missing** | Med | `viewer/ctf.js` (salvaged work in progress, `75edb204`) is imported only by `tests/ctf_harness.mjs`. No page code draws a flag base or runs pick-up/capture |
| 19 | TDM | 18 levels | Works | Low | `round-state.js` scores TDM; judged from code |
| 20 | Co-op layer and game-type mapping | 18 levels. `Search_And_Destroy` is a Conquest alias | Works | Med | `game-modes.js`, `gamePlayModeOf` |
| 21 | Soldier spawns, including spawns carried by objects | No Fly Zone Day 2 hangars, Weapon Bunkers, Urban Siege Nimitz, Bragg Talil, AC-130 | Works | High | level-archive-mounts §1 |
| 22 | Destroyed carrier drops its spawns | Weapon Bunkers (Iraq's only spawns: 35 points in 3 bunkers that never respawn, 9999 s); No Fly Zone Day 2 airbase | **Missing** | Med | `hull-bodies.js:155` `shipFlagInactive` covers floating hulls only (SPAWN-5). Weapon Bunkers' destroy-the-bunkers objective cannot be won |
| 23 | Vehicle pads: placement and respawn after destruction | 8 to 185 per level | Works | High | `vehicle-wrecks.js` uses min/max delay (uniform random, not `calcSpawnDelay`) |
| 24 | Team-dependent pads after a capture | **364 pads at capturable flags on 30/35 levels** spawn different vehicles per side (T72/M1A1, BMP2/M2A3, Mi24/AH64). DC Final: 414 on 39 levels | **Broken** | High | Engine picks the template by the spawner's live team (SPAWN-2, `CPEnable`). The viewer bakes one vehicle per pad and only hides it while the flag is neutral (`level-statics.js:283`). A capturer gets the other side's tank |
| 25 | Abandoned-vehicle timeout and start delay | All 1,529 DC spawner templates set `TimeToLive` (1,415 at 45 s) and `Distance`; 6 set `spawnDelayAtStart` 15 or 60 | Missing | Med | `AbandonClock`/`calcSpawnDelay` exist in `deployables.js` but are used only for kit pads. `objectSpawns` does not even export TTL/Distance |
| 26 | DC scripted level mechanics | Medina Ridge "push" (`flagkill`, `FlagBox`, `Landslide`, a `fk1` depot at -1000 HP/s). Bragg Talil: `UST`/`IST` carriers on a neutral flag plus `IS_Kill`/`USS_Kill` depots that drain the other side's carrier | Broken | Low | Runner: Bragg `USK`/`ISK` die and respawn every ~15 s; Medina 186 unattributed object deaths in 300 s. Both Talil spawn sets are live from round start |
| 27 | Bot AI data | Strategic areas and baked search maps on 22 levels: 7 DC-made (Basrah's Edge, Desert Shield, Bocage D2/D3, El Alamein D2/D3, Kharkov D2) and 15 overlays inheriting vanilla AI. 13 levels ship none, as in retail | Works | Med | `pathfinding/` exists exactly where `ai` does |
| 28 | Bot play on AI levels | Headless runner, 6v6, 300 s, seed 1 (table below) | Partial | High | Bots freeze in `Change` |
| 29 | Bot vehicle AI records | 98 DC records | Partial | Med | `H-6` record has `seats: []`, so AH-6/MH-6/OH-6/MH-500 (each its own `aiTemplate`) are unboardable. `A10_B`/`A10_C` (`aiTemplate A10`) and `Mirage` are unindexed. All are used on AI levels |
| 30 | Level load and data integrity | All 35 load in `sim/run.mjs` (0.7 to 7.8 s). Biggest download: No Fly Zone, 58 MB glb / 30 MB gz | Works | High | 0 bot errors in 35 runs. Every `.glb.gz` present |

Not scored: bots on the 13 levels without AI data. Retail offers none there; the viewer's fallback (walk to the nearest enemy flag, nav grid built at load) gives 0 to 6 captures and 11k to 43k route failures per 300 s (Sea Rigs 41,108, Al Khafji 42,769).

**Bot runs (item 28), DC versus vanilla, same parameters:**

| Level | Bots frozen in `Change` all round | Route failures | Notes |
|---|---|---|---|
| DC El Alamein | 0 | 0 | 6 kills, 3 captures; vanilla: 0 kills, 3 captures |
| DC Bocage Day 2 | 0 | 2 | |
| DC El Alamein Day 2 | 1 | 89 | 9 kills |
| DC Basrah's Edge | **4 of 6 Iraqi** | **51,793** | 0 kills, 0 shots |
| DC Desert Shield | 3 | 10,742 | |
| DC Kharkov Day 2 | 5 | 180 | |
| DC Battleaxe | 3 | 201 | Vanilla Battleaxe and Kharkov also freeze 3 each, so the freeze itself is generic. Basrah's Edge and Desert Shield add the route failures |

On Basrah's Edge (`--why bot_0 30`), all four frozen bots chase the same Lada, one of them from 1.97 m. Their plan is `InfanteryMoveTo` with no route, failing every 30 Hz tick from the spawn point.

### 3. Root causes

- **A. ObjectSpawner rules are applied only to kit pads.** Team selection (SPAWN-2, `CPEnable`/`CPDisable`), the abandon clock and the start delay are all decoded in `deployables.js` but never used for vehicle pads or spawn-carrying objects. This one cause is behind items 24, 25 and most of 26.
- **B. Spawn deactivation on carrier death is ship-only.** `shipFlagInactive` walks floating hulls only. Items 22 and 26 (Bragg).
- **C. Exported data the viewer never reads.** `supply.vehicleTypes` (items 15 and 26) and `modes.Ctf.flagBases` (item 18, its module is not wired in).
- **D. `extract_vehicle_ai.py` keys records by folder.** A folder holding several aircraft (H-6), variants that share another vehicle's `aiTemplate` (A10_B/C), and Mirage are lost. Item 29.
- **E. Terrain patch size is a fixed 256 m.** Medina Ridge (and FHSW Fall of Berlin, EoD Closefire) ship denser tile grids. Item 3.

### 4. Work packages (most valuable first)

**WP1. Make a vehicle pad spawn its controlling side's vehicle** (items 24, 26-Bragg). Size L.
- **Problem:** see item 24. `objectSpawns[].templates` and `osId` are already in every DC scene, so no data change is needed; only one variant is baked into the glb.
- **Engine source:** SPAWN-1, SPAWN-2; `CPEnable` 0x082840e0 / `CPDisable` 0x08284200; `deployables.js` `SpawnerPad` already models the law.
- **Files:** `level-statics.js`, `hull-bodies.js` (`syncVehicleSpawnOwnership`), `vehicle-wrecks.js` (`respawnVehicle`), and either variant glbs loaded at runtime from `models/mods/<mod>/` or `extract_map.py` `union_object_spawns` baking both variants tagged by team. **Hot files:** `hull-bodies.js` and `vehicle-wrecks.js` are shared with vehicle packages.
- **Proof:** a node harness for pad team changes, then a seeded `sim/run.mjs` match on DC Gazala where a captured open-base pad respawns the capturer's template.
- **Re-bake:** none if variants load at runtime. Baking both variants means a full scene re-bake of every tree, so prefer runtime loading.

**WP2. Give vehicle pads the abandon clock and the start delay** (item 25). Size M. Run after WP1 or give both to one agent, since they touch the same files.
- **Engine source:** `AbandonClock` (`PlayerControlObject::handleFrameUpdate`), `calcSpawnDelay` 0x08314430, cited in `deployables.js`.
- **Files:** `extract_map.py` (`_object_spawn_report`: add `timeToLive`, `distance`; `spawnDelayAtStart` is already there), `vehicle-wrecks.js`, `hull-bodies.js`.
- **Proof:** a harness case, plus a runner check that an abandoned M1A1 more than 100 m from anyone dies about 45 s later and respawns on its pad.
- **Re-bake:** `patch_scene.py --layer spawns --all` in every tree, then `publish-mesh-delta.py maps --hash`.

**WP3. A destroyed spawn carrier stops being a spawn** (items 22, 26-Bragg). Size M.
- **Engine source:** SPAWN-5 (`BFSpawnPoint::getActive` 0x08163dd0 checks the nearest armour's `isCriticalDamaged`), SPAWNGRP-9, SPAWNGRP-10.
- **Files:** `hull-bodies.js` (generalise `shipFlagInactive` to any carrier owner), `spawning.js`, `spawn-flags.js` (`groupSpot` should leave out dead carriers' points), and the bot respawn pick.
- **Proof:** `tests/carried_spawn_flags_harness.mjs` plus a runner case on DC Weapon Bunkers: destroy the three bunkers and the Iraqi side has no spawn.
- **Re-bake:** none.

**WP4. Wire CTF into the page** (item 18). Size L.
- **Engine source:** the addresses in `ctf.js`'s header (`FlagBase::handleUpdate` 0x08292b30, `Flag::handlePickup`/`handleDrop`/`handleUpdate`). The CTF-1..8 ledger rows it cites were never written, so promote them first. Bot behaviour in CTF needs an engine read.
- **Files:** `map.html` (**hot**), `ctf.js`, `round-state.js`, the HUD and feed, the flag-base and flag meshes (`flagBases[].geometry`, `flag.geometry`), CTF sound patches.
- **Proof:** `tests/ctf_harness.mjs` plus a page-free round in the runner if it gains a CTF mode.
- **Re-bake:** possibly none, if the flag meshes load from the models tree.

**WP5. Stop bots freezing in `Change` and fix the DC route failures** (item 28). Size M.
- **Engine source:** `BBChange` (0x0855e0c0, 0x0855ee25, `unitReachable`), AI rows, `features/bf1942-ai-research-2026-09-21/bot-behaviours.md`. Needs an engine read on what the pathfinder does when the bot's own start cell is blocked.
- **Files:** `bot-mount.js`, `bot-route.js`, `bot-plans.js`, `nav-baked.js`, `nav-grid.js`.
- **Proof:** `node sim/run.mjs --map dc_basrahs_edge --maps viewer/maps/mods/desertcombat --models viewer/models/mods/desertcombat --bots 6 --time 300 --seed 1`. Today 4 bots are frozen and there are 51,793 route failures. Also Desert Shield, Kharkov Day 2, and vanilla Battleaxe and Kharkov. Vanilla El Alamein and Bocage must stay unchanged.
- **Re-bake:** none.

**WP6. Give every DC aircraft a bot AI record** (item 29). Size S.
- **Engine source:** each object's `ObjectTemplate.aiTemplate` (`SimpleObject::SimpleObject` 0x081da0d0, quoted in `bot-units.js`).
- **Files:** `extract_vehicle_ai.py`, `tests/test_extract_vehicle_ai.py`, `tests/bot_units_ai_of_harness.mjs`.
- **Proof:** the tests, plus a runner `--seat` on a pad that spawns an AH-6 or an A10_B.
- **Re-bake:** none. Publish `_shared/vehicle-ai.json` for both DC and DC Final.

**WP7. Repair vehicles at the rate `addVehicleType` gives** (items 15, 26-kill depots). Size S to M.
- **Engine source:** SUP-1, SUP-3, SUP-11, SUP-13, SUP-14 and `subsystems/supply-depots.md` §5. Needs an engine read on whether `repairVehicle` uses `setHealth` or the vehicle-type rate when both are present.
- **Files:** `supply.js`, `world-fields.js` and `level-load.js` (depot construction).
- **Proof:** `tests/supply_harness.mjs`, with a case for Nimitz/airfield pads and a `-1000` kill depot.
- **Re-bake:** none; the data is already in the glb extras.

**WP8. Size terrain patches from the shipped tile grid** (item 3). Size S, plus re-bakes.
- **Engine source:** needs an engine read on how `PatchTerrain` maps `Tx` tiles to the world. Measured evidence: the 8x8 mosaic matches the minimap.
- **Files:** `bf42/terrain.py`, `bf42/level.py` (`PATCH_METERS`, `tile_world_origin`), `extract_map.py`.
- **Proof:** compare a mosaic or render against the minimap.
- **Re-bake:** full level bake of `dc_medina_ridge` in DC and DC Final (and check FHSW Fall of Berlin, Pegasus, D-Day Drops and EoD Closefire), then `optimise_mesh.py` and publish.

**WP9. DC's scripted objectives** (item 26). Size M. Do this after WP1, WP3 and WP7.
- Covers Medina Ridge's push order and Bragg's Talil swap once A and C are fixed.
- Needs a read of DC's scripts and the engine. Also stop the `flagkill`/`USK` death-and-respawn churn if retail does not do the same.

**WP10. Pacific tree billboards for the DC tree** (item 12). Size S. Extract the 12 missing billboards and publish `trees.json` and `trees/`.

### 5. Open questions

- Is a DC "push" map (Medina Ridge) enforced only by the `flagkill`/`FlagBox` objects and `fk1` depots, or by something else? This needs a read of DC's scripts.
- Does retail BF1942 allow bots on a level with no `AI/` data? If not, should the page refuse or flag bots on the 13 DC levels without it rather than run the fallback?
- Did retail DC 0.7 list the vanilla levels it inherits but never re-dressed (Aberdeen, Coral Sea, Market Garden and others)? DC Final ships its own versions of them.
- **Stale glbs:** all DC and DC Final `scene.glb` files predate `73426358` (seat-gun deviation extras). That belongs to the weapons domain, but it needs a scene re-bake of both trees.

### DC Final
- All 48 levels are baked; 23 have AI and 37 offer CTF.
- 14 levels exist only in DC Final, including Battle of Britain, whose `ObjectiveMode` is handled by `round-state.js`.
- Root causes A to E apply unchanged, and Medina Ridge's terrain is identical.

Scratch files are in `~/.cache/dc-sweep/levels/`: `levels_inv.py`, `levels_scene.py`, `levels_spawners.py`, `levels_spawnflags.mjs`, `sim_batch.txt`, the `sim-*/summary.json` files and `levels_medina_compare.png`.