## adv-modsystem: does the DC port follow vanilla's conventions?

**Short answer:** mostly yes. The tree layout matches vanilla's, and the mod-path resolution (textures, sounds, level overlays, the HUD pack, poses) checks out. The gaps are in the exporter. The current exporter now quietly drops data, and the DC tree is out of date in two layers the census thought were current.

- **Most urgent:** re-running two of the planned steps with today's exporter would break bots. Re-extracting DC's `loadouts.json` (kit-pickups' plan) strips bot weapon AI from almost every firearm. The queued DC/DC Final scene re-bake would erase all bot cover values. One fix (WP-A) unblocks both, and vanilla is already affected.
- **Checked and fine:**
  - 0 of 5,280 DC model texture lookups took vanilla's copy where DC ships the same path.
  - 0 of 88 DC sound overrides were baked from vanilla's wav.
  - DC level overlays win over vanilla's `_000`/`_003` patches, as the engine does.
  - The HUD pack is built from a content diff (243 own files, 407 identical, 0 listed-but-missing), so falling back to vanilla is correct.
  - Every soldier × kit pose and weapon glb exists with exact case.
  - Nose-cam offsets, `attachToListener`, ambient `distanceVolume` and the strategic-area boxes all come from DC's own data.
  - Re-running the kits, vehicle-AI, bot-names, seat-poses, radio, chat and menu extractors gave identical output.

### 1. Findings

| Id | Finding | Evidence | Player impact | Confidence |
|---|---|---|---|---|
| MS-1 | **Re-extracting `loadouts.json` with today's code deletes bot weapon AI.** `extract_models.load_order` drops every `/ai/` script, and every `weaponTemplate.create` lives in `<weapon>/AI/Weapons.con`. The engine runs `/ai/` scripts on AI levels (LOAD-8). | `extract_loadouts.py --mod DesertCombat` to scratch: `aiWeapons` goes 44 → 7 (all 37 DC firearms lost, AK47 to VSS). Headless runner, DC El Alamein, 6v6, no vehicles, seed 2, 240 s: 22 shots / 6 kills with today's file, 6 shots / 0 kills with the regressed one. Vanilla's tree was already regenerated on 10-03 (aabf919a) and has 6 of 28; vanilla El Alamein fires 38 shots, 200 with my fixed file. Keeping `/ai/` scripts brings DC back to 44 identical entries (+1) and vanilla to 24. | High (bots stop using rifles once kit-pickups re-extracts; vanilla already) | High (measured) |
| MS-2 | **Same cause: the AI layer and any full bake set `scene.json` `ai.coverValues` to nothing.** All 139 vanilla `coverValue` lines sit in `/Ai/` scripts. | `patch_scene --layer ai` on scratch copies: El Alamein (vanilla) 26 → 0; DC El Alamein 27 → 0; Desert Shield and Gazala the same. Full bakes compose through `scene_layers`, so the queued 73426358 re-bake would wipe DC's 525 and DC Final's 582 entries. | Med (bots' TakeCover loses every cover object) | High |
| MS-3 | **DC vehicle-gun burst tails are missing because the data is out of date, not the code.** The trigger exists: `map.html:1026` `guns.onRelease` → `vehicle-audio.js:619` `release()` (75edb204). Vanilla's sounds were re-patched on 10-03 and play them. | Re-patching the sounds layer on scratch copies of all 35 DC levels: 472 vehicle sound entries (90 templates) gain `release`, 29 gain `press` (M163 `avenger_spinup`), and 32 samples DC lacks are needed (`browning_release`, `NVST_release`, `autocannon_release_*`, `mgdist1..20`, `C_A10_Shell`). DC Final has 0 of 1,604 entries with tails. `_shared/vehicle-sounds.json`: vanilla 36 of 99 weapons have tails, DC 0 of 197. | Med (every MG, cannon and jet gun burst ends dead) | High |
| MS-4 | **`fireInCameraDof` is never exported for vehicle FireArms**, so the viewer uses a hard-coded vanilla/XPack1/XPack2 name table. `assemble.py` `_fire_arms` leaves the word out; the comment in `camera-dof.js` claiming glbs after 09-25 carry it is wrong (0 nodes in the vanilla, DC or fresh trees). DC sets the word on 25 vehicle FireArms and only 5 share a vanilla name. | 906 placed DC gun instances (DC Final 786) fire from the barrel where retail fires from the seat camera: Iraqi coax 118, NSVT 80, M2A3 TOW 80, Humvee TOW 52, BMP-2 AT-5 41, minigun 41, Spandrel 27, M230 22, Mi-24 gun 18, Mk19 17, AH-6 minigun 10, recoilless 9, AC-130 Vulcan 6. Bots aim through the same switch. | Med (rounds miss the crosshair by the barrel-to-camera offset on most DC armour and helicopter guns) | High (data and code) |
| MS-5 | **Effects a level declares are never exported.** `_shared/effects.glb` is mod-wide only. | 5 death effects (`e_*WRECKPCO`) for No Fly Zone, No Fly Zone Day 2 and Weapon Bunkers objective buildings (9 templates) are absent; `effects.play` finds nothing and plays silently. Vanilla Battle of Britain has the same gap. Other DC names that don't resolve (`e_BM21Damage/Fire`, `e_ScrapMetal_AC-130`, `e_scrapmetal_Forklift`) are defined nowhere in DC's data, so retail has them missing too. | Low–Med (blowing up the objective shows nothing) | High |
| MS-6 | **DC Final's model tree predates the LOAD-5 load-order fix.** The engine runs scripts in path order, so DC 0.7's `AC-130_Bofors/Objects.con` declares `AC-130_Howitzer` before DC Final's own file. | Retail DC Final: 0.25 rps, shell lifetime 4 s; the DC Final tree: 0.5 rps, 10 s. Metal sparks and rocket back-blast effects also change. DC 0.7 has 33 template differences; only the OSA's flag skeleton/sound, the Hatsuzuki camera holder and the unused heads 2/3 matter (full 221-template re-extract checked). | Low (Med for DC Final's AC-130) | Med (rests on LOAD-5) |
| MS-7 | **No tree has `poses/index.json`**, the file behind LOAD-7's case-blind pose lookup. Today's `extract_pose` writes it. | Missing in vanilla, DC and DC Final. DC's bound kits spell exactly (0 case-sensitive misses), so it only matters for the new spawner kits (M82, US_AA). | Low | High |
| MS-8 | **The viewer guesses which cameras recentre** ("pilot seat of an air hull") because `toggleMouseLook` is not exported. | DC sets it on 24 cameras, including two passenger cameras (`MH6PassengerCamera`, `SA342PassengerCamera`); the guess gives those passengers free look. | Low | Med |
| MS-9 | **The next Medina Ridge bake will change.** 20 level object scripts (`LandslidePiece/LSP.con`, `Geometries.con`) are outside the `Init.con` run graph (298b1cd1). | The current bake has 160 `LandslidePieceM` nodes. No Fly Zone (both days) and Urban Siege also have unreached scripts. | Low | Med (needs a scratch bake) |
| MS-10 | **Viewer fallbacks are two-level (mod, then vanilla), not the mod's `init.con` chain.** DC Final skips DC 0.7; `mods.json` records no chain. | `pose-bases.js`, `kit-worn.js`, `kit-catalogue.js`, voices, `hud-pack.js`. Harmless today because DC Final's tree is complete for its levels. | Low | High |

**Freshness table** (each producer's last commit vs the DC file date; scratch re-runs where noted):

| Artifact | Producer | Last producer change | DC file | Stale? |
|---|---|---|---|---|
| Vehicle/weapon glbs | `extract_models`, `assemble.py` | 10-06 73426358 | 09-29..09-30 | Yes: seat-gun deviation on 124 glbs (known), cockpit LOD nodes on BMP2/M2A3/Mi8, plus MS-6 |
| `scene.glb` | `extract_map` | 10-06 | 09-29..09-30 | Yes (known), plus MS-4 |
| `scene.json` sounds layer | `extract_map._trigger_slots` | 298b1cd1 (10-01) | 09-30 | **Yes (MS-3)** |
| `scene.json` AI layer | `scene_layers` / `load_order` | 880f7220 | 09-30 | Current file is good; **the exporter has regressed** (MS-2) |
| `scene.json` control points, spawns, game, environment, damage | `scene_layers` | 10-01 | 09-30 | No (dry run) |
| `_shared/vehicle-sounds.json` | `extract_vehicle_sounds` / `extract_map` | 10-01 | 09-30 13:25 | **Yes (MS-3)** |
| `sounds/weapons.json` | `extract_weapon_sounds` | 75edb204 | 09-30 13:25 | Yes (known; re-run gives 25 of 54 with tails) |
| `_shared/loadouts.json` | `extract_loadouts` | aabf919a (10-03) | 09-30 | Older but better; **re-extract regresses** (MS-1) |
| `kits.json` + kit glbs, `vehicle-ai.json`, `bot-names.json`, `seat-poses.json`, radio/chat/menu layouts | various | ≤ 10-03 | 09-30 | No (scratch re-run identical) |
| `deployables.json` | `extract_deployables` | 75edb204 | 09-30 | Only `Mortar.radius` drops |
| `poses/index.json` | `extract_pose` | 298b1cd1 | none | **Missing** (MS-7) |
| `gaits.json`, viewmodels | `extract_pose`, `extract_viewmodel` | 298b1cd1 | 09-30 | Not re-run (cost); graft path already present |
| `effects.glb`, collision meshes, trees, load screens, music, movie, voices, HUD pack | various | ≤ 09-30 | 09-30 | No |

### 2. Census verdicts overturned

1. **Soldier A2 (vehicle half) / WP3:** "slots 2..4 are never triggered … no re-extract expected" is wrong. The trigger is built and vanilla plays the tails. DC needs only a sounds-layer re-patch plus publish (MS-3).
2. **Levels:** "a dry run of the con layers changes nothing" is true only for those layers. The sounds layer is out of date, and re-running the AI layer destroys data (MS-2).
3. **Levels item 28 baselines** ("vanilla El Alamein 0 kills", "vanilla Battleaxe and Kharkov also freeze") were measured on a vanilla tree whose loadouts lost 22 of 28 AI weapons on 10-03. It is not a valid control.
4. **Weapons WP2, soldier WP1, kit-pickups:** "re-extract DC and DC Final `loadouts.json`" is unsafe until WP-A lands (MS-1).
5. **Lead's asset job** "stale DC scene bakes vs 73426358": a full re-bake today would zero cover values. Run it after WP-A, together with WP-C.

### 3. Work packages

**WP-A. Keep `/ai/` scripts in the object library** (MS-1, MS-2). Size S. Blocks kit-pickups' re-extract and every re-bake.
- **Problem:** `load_order` (`extract_models.py:453`) removes `/ai/` paths unconditionally. `build_library`, `extract_map.LevelFirst` and `scene_layers` all go through it, so AI weapons, cover values and control info disappear.
- **Engine source:** LOAD-5 and LOAD-8 (`Game::loadAllConFiles` runs `/ai/` paths when `Game::getIsAiLevel`).
- **Files:** `extract_models.py`, `extract_map.py` (`LevelFirst`), `tests/test_extract_loadouts.py`, plus a new cover-values test.
- **Proof:**
  - DC loadouts give 44 or more AI weapons, identical to today's tree.
  - Vanilla gives 24.
  - `patch_scene --layer ai` on a scratch El Alamein keeps 26 cover values.
  - Headless runner, El Alamein, `--no-vehicles --seed 2`: shots go back up.
  - Validated by monkeypatch: `~/.cache/dc-sweep/adv-modsystem/loadouts_fixed.py`.
- **Assets:** re-extract and publish vanilla `_shared/loadouts.json` (bots are crippled now; also check whether the 10-03 file is live). DC's own tree is fine until it is re-extracted.

**WP-B. Re-patch the DC and DC Final sounds layer** (MS-3). Size S. Independent of WP-A, since the sounds layer pulls in no other layer.
- **Command:** `patch_scene.py --layer sounds --mod DesertCombat --all`, the same with `--mod DC_Final`, then `publish-mesh-delta.py maps --hash`. This includes the 32 new samples and `_shared/vehicle-sounds.json`.
- **Proof:** `test_vehicle_audio.mjs` pointed at the DC trees; count `release` entries (expect 472 for DC).

**WP-C. Export `fireInCameraDof` on vehicle FireArms** (MS-4). Size S in code, plus the bakes.
- **Files:** `bf42/assemble.py` `_fire_arms`; fix the comment in `viewer/camera-dof.js`; `tests/test_camera_dof.py` / `camera_dof_harness.mjs` with DC's T-72 NSVT and M2A3 TOW. `assemble.py` is shared with the deviation re-bake.
- **Engine source:** XHIT-12 and the header of `camera-dof.js` (0x0828a1c1).
- **Assets:** do it inside the pending DC/DC Final model re-extract and full scene re-bake (after WP-A), then `optimise_mesh.py` and publish. Other mods gain it too.

**WP-D. Export the effects a level declares** (MS-5). Size M.
- **Files:** `extract_effects.py` (level EffectBundles into a per-level `effects.glb` or a level-keyed table), `map.html` effects load, `effects.js`.
- **Proof:** destroying the No Fly Zone control tower plays `e_air_control_tower_desWRECKPCO`.
- **Assets:** an effects extract per affected level.

**WP-E. Write `poses/index.json` for every tree** (MS-7). Size S.
- Run `extract_pose` in its index-only mode for vanilla, DC, DC Final and XPack1/2, then publish.

**WP-F. Export `toggleMouseLook` in the camera extras and let the viewer read it** (MS-8). Size S, but needs an engine read on what the word does for a passenger camera.

The DC Final AC-130 (MS-6) needs no code: it is fixed by re-extracting DC Final after WP-A. Order the asset work as WP-A, then WP-B, then the full re-extract and re-bake with WP-C.

### 4. What I could not settle

- **Medina Ridge:** does retail draw `LandslidePiece` at all (outside the run graph)? Needs a scratch bake plus an engine or script read.
- **Passenger cameras:** what `toggleMouseLook` does on `MH6PassengerCamera` and `SA342PassengerCamera`. Needs an engine read.
- **Basename texture fallback:** the Nimitz's `texture/DesertCombat/Nimitz/Lcvp_h` resolves to vanilla `texture/Lcvp_h` through `ArchivePool._basename`. LOAD-3 describes only alternative-path basename probing, so retail may draw that part untextured. Needs an engine read of the texture fallback with no alternative path set (8 DC glbs).
- **What is live:** whether the 10-03 vanilla loadouts with 6 AI weapons reached mesh.bfstats.io (aabf919a says it needed publishing). I did not probe the live site.
- **Not re-run:** `gaits.json` and the viewmodels against 298b1cd1 (too costly here).

Scratch work is in `~/.cache/dc-sweep/adv-modsystem/`. The main scripts are `fresh.py`, `schema.py`, `loadorder.py`, `glbdiff2.py` and `loadouts_fixed.py`. The re-extracts are in `rexall/`, `rexkits/` and `rexmisc/`, the re-patched DC scenes in `scratchall/`, and the runner outputs in `sim*-base/`, `sim*-regressed/` and `simv-fixed/`. Nothing in the repo or the asset trees was changed.