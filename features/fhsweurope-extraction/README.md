# FHSWEurope: extraction defects found on doomed_budapest (2026-10-14)

## Status at 15:00, 2026-10-14 (browser pass)

Eleven defects were reported on `doomed_budapest`. Their state:

| # | Defect | State | Where |
|---|---|---|---|
| 1 | Mod icon empty in the Custom Game dialog | Fixed, seen in the picker: FHSWEurope's row draws FHSW's blue H, version 0.84, URL in INFO. | `icons/mods/fhsweurope.png`, `build_mods_manifest.py` |
| 2 | Loading pictures upside down | Fixed. RLE bottom-origin TGAs are flipped. FHSWEurope and FHSW pictures regenerated. | `extract_loading_assets.py` |
| 3 | Soviet tank missing its top | Fixed. Assembler no longer drops `CreateInvisible` subtrees. T-34 and OT-34 rebuilt. `doomed_budapest` re-baked. | `bf42/assemble.py` |
| 4 | IS-2 with no camera, HUD or weapon control | Fixed, seen in the page: the driver's seat views over the cannon, the HUD shows the 122 mm round, compass and vehicle icon, and a shot takes 28 to 27. | `bf42/assemble.py` |
| 5 | Bridge with no deck | Fixed, driven in the page. The owner's bridge is `Woodbrdg_M1` by the Soviet base, not the plank pair: `brdg` added to the deck gate. | `viewer/collision-meshes.js` |
| 6 | Hungarian side speaks US radio | Fixed for FHSWEurope (voices re-extracted). FHSW's voices step not yet run. | `extract_capture_voices.py` |
| 7 | Snow skins missing on the Axis tanks | Fixed for `doomed_budapest` and checked in a headless browser: the level skin now covers the pad vehicles, and the viewer paints them. The other levels' rows still need the `--level-skins-only` run (Open item 6). | `extract_viewmodel.py` `pad_images`, `viewer/level-load.js`, `viewer/vehicle-wrecks.js` |
| 8 | Tank on the right floating above the ground | Fixed, seen in the page: the Nimrod pad at (1461, 120, -356) over a sandbag pile. | `viewer/vehicle-bodies.js` `standsOnAStatic` |
| 9 | Building transparency lost on the Axis side | Fixed: untextured `textureFade` seals drew white at range; now black. | `viewer/level-shading.js` `bindTextureFade` |
| 10 | Buildings too white | Fixed, every tree: lightmaps are coloured by the level's `Palette.pal` (ledger LM-5). | `extract_map.py`, `bf42/level.py`, `scene_layers.py` `lightmaps` |
| 11 | 37M 105mm: view should shake on fire | Implemented and measured in the page: 14 px at 720p, gone by 0.9 s. | `viewer/artillery-kick.js`, `map-spotter.js`, `map.html` `draw()` |

### How the browser pass was run

The Browser pane has no WebGL (`GL_VENDOR = Disabled`), so every 3D check was
Playwright with Vulkan against `serve_viewer.py` on :5273, one Chromium at a
time, `&shots=1&botCount=0`, the animation loop stopped, frames stepped with
`__renderOnce`. The owner's screenshots of 2026-10-14 08:06 to 08:19 (viewer
and retail pairs) were matched to places on the map first.

* **8, the floating tank.** It is the `gestug_spawner` pad (Nimrod for team 1,
  SU-76 for team 2), placed 1.75 m up over `pega_sandbag_C_t__m1`. The load
  settle skipped both: `standsOnAStatic` held any hull with ONE of its twelve
  lowest vertices over a static's top, and two (Nimrod) and one (SU-76) were
  over the bags. Retail drops it to the ground with the bags through the belly
  (a static is only ever the face side, COL-6). Now three of twelve
  (`REST_POINTS`) must rest on a static. On this level the hulls that really do
  stand on statics measure 5 to 12 of 12 (two Tas, the Char 2C, the Jagdtas on
  the bridge); the S-51 (1 of 12) now drops too. The Nimrod settles to 119.24.
  Guard: `tests/test_stands_on_static.py`
  `test_a_prop_under_one_corner_does_not_hold_the_hull`.
* **5, the bridge.** The owner's capture (GAZ under a railed wooden bridge,
  grid A8) is `Woodbrdg_M1` at (295, -328) by the Soviet tents, not the
  `longPlanks_m1` pair. `DRIVABLE_TOP_RE` had no match for the short spelling.
  `brdg` added; it also catches `Ironbrdg1_m1` and EoD's `O_KS_BrdgeSm_M1`.
  `Woodbrdg_M1` is a vanilla object, so this was never drivable on any of the
  8 vanilla levels that place it (levels per tree with a `brdg` name: vanilla
  8, xpack1 12, xpack2 15, fh 5, fhsw 48, fhsweurope 27, dc 7, dc_final 11, eod
  161). `tests/perf/decktrace.cjs --targets '^Woodbrdg' --vehicle '^Gaz'` from
  both ends: on the deck at 89.18 over a ditch down to 86.2, ride 0.34 m (0.35
  on the ground), no tick below the deck, none airborne. The collision suites
  (170) pass.
* **10, the white walls.** The owner's white facade is `Cass_6_M1` at
  (1474, -428), and the wall's object lightmap had texels at 248 that
  `2 * base * lightmap` clamps to white. The level's lightmaps are 8-bit type 1
  TGAs with an identity grey map, beside a `Palette.pal` that is not identity;
  every vanilla, FH, FHSW and FHSWEurope level is built so. The client reads
  the palette, not the files' maps (ledger LM-5, read from the binary). 248
  becomes (154, 146, 136), so the wall lights to about 1.2x instead of
  saturating. The bake now decodes through the palette, and the new
  `lightmaps` layer rewrites a level's `lightmaps/*.png` in place
  (`patch_scene.py --layer lightmaps --mod <M> --all`, about 3 s a level, no
  glb change). Every tree with lightmaps was relit (vanilla 23, xpack1 29,
  xpack2 32, fh, fhsw, fhsweurope, desertcombat, dc_final, eod); the old PNGs
  are in `~/.cache/lightmaps-before-palette-2026-10-14`. Wake's supply bunker
  wall over its whole west face: 72/70/65 before, 82/77/68 after (retail's
  tint, 97/93/82 on LM-4's patch). Tests: `tests/test_level.py`
  `ObjectLightmapPaletteTests`.
* **9, transparency.** `Cass_1..6_M1` Material8 is a seal
  (`textureFade true`) whose shader names `texture "texture/"`: it baked with
  no texture and drew as a white panel in every window past 55 m. All 69
  vanilla seals are `black_o`, so an untextured seal now draws black
  (inferred; what retail does with the empty name is unread).
* **11, the kick.** Seated in `37M105HowitzerBattery3` with the spotting table
  loaded, one shot moves the picture down 7 px of a 360 px frame by 0.17 s and
  back to 0 by 0.9 s; the control frame moves 0. Retail's clip shows the drift
  before the flash, ours after the shot: open.

**Pipeline state (13:06):** the completion run for the imported maps is still
going. FHSWEurope (10 imported) and FHSW (70 imported) have kits, loading,
loadouts, viewmodels and thumbnails done. The verify steps shown as failed in
the state file are from the earlier check; the completion's own verify runs
at the end of the FHSW pass. Pending after it: `optimise` for FHSWEurope models
(6,116 glbs rewritten by an orphaned pass have stale `.glb.gz` copies), and
the FHSW voices step.

**Imported set:** FHSWEurope 10 (alpenfestung-1945, alpine_line-1940,
battle_of_britain, battle_of_leyte_gulf_day2, battle_of_luzon,
battle_of_pavlov-1942, caen_streets, doomed_budapest, midway, scapaflow-1946).
FHSW 70. Pending imports (baked, not registered) are listed below. As of
2026-10-18 the FHSWEurope registry is 78 rows: stashuv_area and road_to_ramelle
were imported for the replay feed (see "2026-10-18" below).

**Still open:** item 7; FHSW's voices step. `optimise` for the FHSWEurope
models is done (2026-10-18, by the `models` step's own tail). New since
2026-10-18: Soviet kits never finish reloading, on 12 live levels; and a level's
own point sound emitters are left unresolved. Both are below.
A re-bake from a checkout without this pass's `extract_map.py` writes grey
lightmaps again: re-run `patch_scene.py --layer lightmaps` after it.

## Original summary

Four defect classes fixed in the pipeline, the models and
levels they touch being re-extracted and re-baked; four still open, with the
evidence each needs. Owner-reported on `doomed_budapest` (the Hungarian axis
side against the Soviet side), but every class is measured against the whole
chain, and the owner's point is that these are not level-specific.

FHSWEurope is FHSW's extension (0.84) and shares FHSW's chain:
`FHSWEurope -> FHSW -> FH -> bf1942` (its `init.con`'s `game.addModPath` lines).
It ships its own `standardmesh.rfa` (103 MB) and `texture.rfa` (365 MB) where
FHSW ships 673 MB and 636 MB, plus `texture_001.rfa` and `standardmesh_001.rfa`
in FHSW. A reader that opens only a mod's own archives loses the chain's
patches; `mod_chain` and `ArchivePool.add_dir` already read the chain in order.

## Fixed

1. **Hungarian and other nations spoke American radio.** `LANGUAGE_NATIONS`
   (`extract_capture_voices.py`) had no entry for any language the chain's
   soldiers declare with `setRadioLanguage` beyond the vanilla and FH set. A
   soldier with no `voices/languages.json` entry falls back to its flag nation,
   then to `voices/us` (`viewer/comms.js` `voiceDirs`, `viewer/capture.js`
   `captureVoiceDirs`). `doomed_budapest`'s team 1 is `HungarianSoldier`
   (`game.setTeamSkin 1 HungarianSoldier`, `setRadioLanguage "Hungarian"`), and
   its voices are `sound/44khz/Hungarian/*.wav` in FHSW's `sound.rfa`. Thirteen
   languages added: Hungarian, Dutch, Albanian, Amharic, Arabic, Chinese,
   Greek, Norwegian, Romanian, Slovak, Spanish, Srbcro, Thai. Guard:
   `tests/test_language_nations.py`. Re-extracted for FHSWEurope; FHSW's tree
   has the same gap (Dutch, Hungarian) and is pending the same step.
   Missing stems in the archives, recorded as data findings: `WeAreTakingHeavyCasualities`
   (Albanian, Amharic), `IWillAttackALT1` (Srbcro).

2. **Mod icon in the Custom Game dialog was empty.** Retail draws FHSW's icon
   for FHSWEurope's row. FHSW's icon is its own `serverInfo.dds` (16x16, the
   blue H). `icons/mods/fhsw.png` is byte-identical to its decode. FHSWEurope
   ships a `serverInfo.dds` of its own (the same H with a purple cross) that
   retail does not show. The mechanism that picks FHSW's is not established; we
   copy FHSW's icon as `icons/mods/fhsweurope.png`. `build_mods_manifest.py`
   also gained FHSWEurope's name, version (0.84) and URL from its `init.con`.

3. **Loading screens upside down.** `doomed_budapest/Menu/ls.tga` is an RLE TGA
   with the origin bit clear. PIL honours the origin and flips the picture; the
   engine reads an RLE TGA's rows as stored (`bf42/meshtga.py`, the rule the
   mesh and HUD readers keep). Every RLE loading picture the mods author reads
   upright that way: 166 checked. Fix: `extract_loading_assets.py`
   `convert_background_to_webp` flips an RLE bottom-left picture. Tests:
   `tests/test_loading_rle_orientation.py`. Blast radius: FHSWEurope 127 pictures,
   FHSW 2 (`Operation Rattrap`, `Varsity`), bf1918 39 latent, Pirates 2. The
   rule is inferred from the art; a retail screenshot of a loading screen would
   settle it.

4. **Tank tops missing; IS-2 with no cannon, HUD or camera.** One root cause in
   `bf42/assemble.py` `build_node`: a template with `ObjectTemplate.createInvisible
   1` returned `None` with its whole subtree unless it was a Spring. The engine
   withholds only the object's own draw (ledger PHY-24, refuted 2026-10-07): its
   physics and its children are built as any other's. Lost: `T34-85_random_Tower`
   (a RotationalBundle with the gun base, barrel, coaxial, camera and director),
   so the T-34 and OT-34 drove as hulls; `IS2_Turret` (cannon, cockpit, camera,
   coaxial and AA guns), so the IS-2 had no weapon, no HUD (the seat's HUD is
   gated on the camera) and a view on the snow. Fix: an invisible template's
   own mesh is undrawn (its collision probes kept, as the Spring branch does) and
   its children walked; an invisible effect bundle stays dropped. Verified on
   the rebuilt models: the T-34 gains its gun barrel, tower mesh and camera; the
   IS-2 gains cannon, cockpit, coaxial, AA machine guns and turret camera
   (`is2_mesharmor` 28 parts before, 40 after). 139 assembler tests pass.
   Re-extraction (`models`) is running for FHSWEurope (94 roots), FHSW (86) and
   XPack2 (2, Goblin and Natter landing gear). The levels whose `scene.glb`
   carries these spawners need a re-bake after it.

## Fixed in the viewer (not yet seen in a browser)

5. **Plank bridge with no deck.** `viewer/collision-meshes.js` `DRIVABLE_TOP_RE`
   names the ride surfaces a wheel may stand on. It had no `plank`, so the
   `longPlanks_m1` pair across the river at x 980 to 992 (top y 88.0) never
   carried a wheel; the wheel fell to the riverbed. `plank` added; `steplank1_m1`
   ramps match too. Blast radius: 259 baked levels carry plank collision
   (eod 154, fhsw 43, dc_final 18, xpack2 12, desertcombat 9, xpack1 9, fh 7,
   fhsweurope 7), so vehicles change on any level with a flat plank above
   ground. Verified under node by the owner's sim recipe suite
   (`tests/test_sim_vehicles.py`, 27 tests pass) and the python collision and
   ground suites (170 pass). Not verified in a browser: the pane has no WebGL
   context in this sandbox.

## Open

6. **Snow skins missing on the Axis side.** The Soviet side's pads come from
   `scene.glb`, which the bake textures from the level's own `alternativePath`
   list (`Init.con`: `GENERAL_RUS_WINTER`, `GENERAL_HUN_WINTER`,
   `SPECIAL_HUN_TANK_CAMO`); the Axis side's pads are clones of the registry's
   `models.json` glbs, which carry the summer `texture.rfa` copies. The
   engine's rule is `LOAD-3` (each basename is probed under the alt directories
   first). Owner: `viewer/level-statics.js` `loadPadVariants`, applying the
   level's winter images to the clones by basename.

   **Fixed (2026-10-14).** The bake was the wrong place for this: `scene.glb` carries
   only the side it placed, and adding a scene layer would mean touching
   `scene_layers.py`. The soldiers' level paint already had the mechanism:
   `viewmodels/skins.json` and `skins/<level>.skin.glb` (`extract_viewmodel.py`
   `write_level_skins`, applied by `viewer/level-skin.js`). `expected_level_skins`
   now adds `pad_images` to each level's images: every template a level's
   `objectSpawns` hands out, in every mode layer, mapped to its glbs as
   `vehicle-wrecks.js` `variantUrls` picks them (the drawn model and its wreck,
   mod tree then vanilla's). The level's alternative paths resolve them as
   before. `level-load.js` paints each pad glb with the level's skin before
   `loadPadVariants` clones it, and `vehicle-wrecks.js` paints a wreck with the
   page's paint. On `doomed_budapest` the skin went from 25 textures to 151. The
   Zrinyi and Nimrod read `texture/GENERAL_HUN_WINTER/*` and draw snow-white. The
   Toldi and Turan read `SPECIAL_HUN_TANK_CAMO`, which comes before
   `GENERAL_HUN_WINTER` in Init.con, so they keep a camo coat, as LOAD-3 says.
   Frames: `snow-before.jpg` and `snow-after.jpg` from the
   camera at (1446, 120, -344). Tests: `tests/test_viewmodel_level_skin.py`
   `PadVariantTests`. Only `doomed_budapest`'s row is rewritten so far (a scoped
   script; the backup is in the session scratchpad). Still to run: `extract_viewmodel.py --level-skins-only --maps
   <tree>/maps.json --mod <M> --out <models tree>/viewmodels` for every tree
   with pad variants (FHSWEurope, FHSW, FH, DC, EoD and vanilla alike), then
   `optimise_mesh.py` over the skins and publish. Until then `audit_mod.py`
   reports the missing rows as `soldier-level-paint-missing`.

7. **Pad vehicles hover.** A spawn's Y is the model origin; the IS-2's lowest
   visible point is 0.46 m below it (0.56 with wheels), and the level's
   heightfield is 0.8 m under the IS-2 tracks at (250, -330). The viewer copies
   the baked spawn pose with no ground settle (`level-statics.js` around line
   277). Retail settles hulls by physics (inferred). The tank in the owner's
   screenshot is not yet matched to a spawn; the nearest sandbag pile is at
   `budavari_palota` beside a `3Rus_ATPTRS` spawn, not an IS-2.

8. **Building transparency and whiteness on the Axis side.** Not a decoder fault:
   the building textures are opaque in every copy, and the glb webps match the
   decoded sources. The copy is `ENVIROMENT_WINTER` through FH's `texture.rfa`,
   the same copy the pool picks. The only transparency on that side is
   `textureFade` on the black `black_o` darkness planes of `citymesh2_m1`,
   `FH_ruscottage`, `FH_FRtwnhse`, `r_ruswh`. The viewer ramps their opacity
   between 20 and 55 m (`viewer/level-shading.js`, marked free and unmeasured),
   which likely reads as blurry grey. Separately, two materials bake with no base
   texture and render flat white: `armatura_Material0` (texture `texture/`,
   38 placements) and `Cass_1_M1_Material8` (12). Neither is on the Axis side.
   `texture/undefined` in `scene.json`'s `texturesMissing` is not located.
   To settle: the camera distance to a grey patch, and a retail capture of one
   doorway at a known range.

9. **Artillery shake (37M 105mm).** A retail clip (2026-10-14) shows the
   optic's picture drifting about 14 px down before the muzzle flash (about 0.9
   to 1.2 s), a flash at about 1.23 s, and a damped return by about 1.9 s. The
   HUD does not move: the top bar, bottom icons and minimap show zero offset
   throughout, so the HUD is not the shaking element. The 37M's cannons
   (`37M105HowitzerBatteryCannon1..3`, `FireArms`) declare no recoil and no
   shake, and no vehicle-cannon shake row exists in the ledger. Open: the
   amplitude and envelope from one clip, and whether the piece's recoil should
   move the seat camera. Needs the owner's answer on what "the piece shakes"
   covers.

## Pipeline state

* Re-extraction of the models for the three trees is running in the detached
  worktree `~/.cache/pipeline-wt-hun`. Snapshot of FHSWEurope's models before
  the run: `~/.cache/fhsweurope-models-before` (hardlinks, 29,894 entries).
* The `fhsweurope` `ModConfig` exists in the main checkout's working tree only
  (`tools/bf1942-models/mod_pipeline.py`, uncommitted). A worktree at HEAD does
  not know the tree; the run patched a one-line copy.
* Re-bake scope: the levels that place an affected template or spawn an
  affected vehicle, in each tree. FHSWEurope 40, FHSW 59, XPack2 3. Only the
  imported rows of each tree are registered and completed. The rest are baked
  but not registered; see "Pending imports" below.
* The imported set is the rows of `maps.json` that carry a `loading` block:
  FHSWEurope 10, FHSW 70. That is the set the owner tests, and it is the set
  the completion runs cover. Backups of the registries from before the
  restore are in the 2026-10-14 scratchpad.

## Pending imports (baked, not registered)

Only `testfield_fhsweu`, the mod's 603 MB developer test level: baked and
registered locally, kept off the volume (2026-10-27). Every other level the
install ships (274) is live. A publish of this tree must stage `maps.json`
without it (copy the file, never hard-link it: a running bake rewrites it in
place) and set `models/mods.json`'s fhsweurope `maps` count to 274.

## 2026-10-27 night: flag, spawn and bot findings from the behaviour audit

Four rows from `audit_behaviour.mjs --quick`, each reproduced alone, fixed and
re-run (`--only flags,spawns` / `--only bots`, port 5323).

* **`flag.law-mismatch` on eastern_blitz-1939** (INDUSTRIAL_ZONE, CITY_EAST,
  CITY_NORTH, CITY_SOUTH; battle_of_palembang `Oil_field4` since 2026-10-19).
  Not the law. FH's push maps cage a flag the attacker may not take yet. The
  level files each cage's ObjectSpawner under the flag *before* it in the
  push (`Object.setOSId` = that flag's `objectSpawnerId`, SPAWN-12): at
  INDUSTRIAL_ZONE `po_killerobject5m_spawner` has OSId 2 (COALMINE) and stands
  a `PushCage` while COALMINE is Polish. `PushCage` (FHSW
  `objects/Buildings/Common/PushCage`) carries `PushCageKillInside`, a
  SupplyDepot of radius 5 with `setHealth -1 -1000 0` (SUP-11), team 0. Retail
  kills a German on the flag within a second and the flag stays Polish. The
  page did the same; the audit's 7 s stand compared that with the law for a
  live man. Palembang's `Oil_field4` has `CageAxis1..3` with OSId 2
  (Oil_field3) and `AxiskillerCage25mHard`, the same class (read from the
  data; its glb is remote-only on this PC, so it was not re-run). Fix
  (audit, 9778936c): the stand asks `__killZones` where the tester stands; a
  trap that kills his side is info `flag.kill-trap` (retail_faithful) when he
  dies and the owner stays, major `flag.kill-trap-inert` when he lives.
  Before: 4 majors. After: 4 info `flag.kill-trap`, COALMINE still taken by
  the law at 10 s.
* **`spawn.not-on-ground` on falaise_pocket-1944**
  `new_control_point3_spawn2` (687.8, 82.2, -578.3). The point is inside
  `smlfrenchfarm_m1`, 0.51 m under the floor face (82.71) its sibling
  `spawn4` stands on. `settle()` probed down from half a metre over the
  feet, missed the floor, and left the capsule in the slab on the terrain:
  `blocked` every tick, never grounded. Retail: `GameServer::spawnPlayer`
  stands the origin 1.0 m over the point (SPAWN-26), the feet vertex a metre
  under it (PHY-10), and the narrow phase probes from the origin to each
  vertex (collision-response.md 5.5), so the ray to the feet crosses the
  floor's upper face and pushes him onto it. Fix (viewer, 8c55f5b0):
  `settle()` also stands him on a floor face inside that metre. Before: 1
  major. After: 40 points sampled, 0 bad. Guard:
  `tests/test_soldier.py` `test_a_spawn_just_under_a_floor_stands_on_it`.
* **`harness.phase-aborted` on falaise_pocket-1944** (and
  battle_of_the_solomon, 2026-10-19): `page.evaluate: Cannot read properties
  of null (reading 'hp')`. The flag stand read `window.__soldier().hp`, and
  `__soldier()` is null once he is dead. Here the round had ended under the
  stand: Allied_Base is run down at 25 s (FHR-4), team 2's tickets reach 0 at
  36 s, and the end game empties the field (ROUND-10). Fix (audit,
  9778936c): a null soldier ends the stand; an ended round is info
  `harness.round-ended`, any other death major `flag.tester-died` with the
  killing blow; the spawn sample re-deploys before each point. After: the
  phase completes, five flags, one info row.
* **`bots.stalled` on eastern_blitz-1939, kasserine_pass-1943,
  moscow_outskirts-1941.** Not the parked class: all three ship an AI layer
  (strategies, areas, pathfinding maps). Four of the eight bots stood at one
  spot all round, in Change: the SinglePlayer layer's `HanomagSP64bots`
  (FHSWEurope `objects/Vehicles/Land/Chi-ha_APCbots_SP`) carries
  `HanomagSoldierSpawn64b` at the hull's own origin (group 64,
  `setEnterOnSpawn 0`), so each bot stood inside the halftrack. To the engine
  every hull face is a back face from inside (5.5) and he walks out; the
  page's sweep is two-sided and held him. Fix (viewer, 8c55f5b0): a carried
  point whose carrier is over the soldier's head has his body look through
  that hull until he is clear of its footprint (`spawn.carrierReach`,
  `SoldierBody.ignoreHullWithin`); a deck he stands on is untouched. Before:
  4/8 stalled on each. After: eastern_blitz 0/8 stalled, the four now drive
  SdKfz222, Panzer38(t), PZIIIE and fly a Ju87B. Guard: `tests/test_soldier.py`
  `test_a_man_stood_inside_a_hull_walks_out_of_it`.
  kasserine_pass 0/8 (Wespe, P40, PanzerIVF2, an Apache among them),
  moscow_outskirts 1/8 (the Stationary_Vickers gunner, holding); no
  `bots.*` finding on any of the three.
* Open: eastern_blitz `bot_2` (Polish, Change to a Pzl11) is held 14 m on by
  the parked Pzl37 between them: his MoveTo is a straight line the nav map
  (no vehicles in it) calls clear. Under the stall threshold; not built.

## 2026-10-27 evening: the last 47 published (227 -> 274), live spot check

Published in two sends on the owner's call against the 160 GiB volume quota:
25 (batch 4 and the_merville_battery), then the remaining 22. Volume 157 GiB
after. All 48 passed the seven verify steps; their quick behaviour check has
not been run (8 h at the pace measured today).

* `spot_check_live.mjs` (new, adfe0d54, 4678d31b): loads levels on
  play.bfstats.io, spawns, walks, boards and drives, one frame a stage. Ten
  levels clean. It found the Ju87 pilot view filled by the hull's own
  fuselage until the cockpit glb loaded (fixed in the viewer, a2b8624c), two
  vanilla HUD icons never published (published), and the mod heartbeat 404
  (viewer, 1bbef485).
* Batch 3 quick behaviour, 25 levels: 30 majors, no blocker; known classes
  (FHX-30 deploy-hull-survived x8 and round-spawner-missing x3, FHX-31
  off-its-pad x4 incl. karelia's planks and kharkov_winter's UC-45mm),
  `veh.gun-silent` on RadioBetty/RadioStuka/MortarFlare, forgotten_hometown
  BT7 audio rack not built, bots stalled on kasserine_pass and
  moscow_outskirts (fixed the same night: bots stood inside their carried
  halftrack; see "flag, spawn and bot findings" above).
* crete-1941 kits re-checked after 73f011ad: no majors.

## 2026-10-27: batches 2 and 3 imported (182 -> 227), batches 4-5 held

Batch 2 (`--pick 20`): cretan_village .. fht_the_breaking_point-1940. Batch 3
(`--pick 25`): forgotten_hometown .. operation_coronet-1946. Both pass the seven
verify steps and are live (2.7 GB and 3.9 GB of level data; the shared models
tree was already current). Batches 4-5, the last 48, are under "Pending
imports".

* **A publish staged with `cp -al` is not frozen against a running bake**: the
  batch-4 `levels` step rewrote `maps.json` in place during batch 3's publish
  and 6 unfinished rows went live for ~10 min. Fixed by publishing a filtered
  copy; stage manifests by copy, not link, and check live rows == rows with
  `loading`.
* Batch 2 quick behaviour (20 levels, 170 min). Fixed: crete-1941 team 1
  spawning with no weapons (73f011ad, see the Crete section). Known classes,
  open: `deploy-hull-survived` x3 and `veh.immobile` on fall_weiss' C7P towing
  the wz.1917 (FHX-30 family), Hummel `round-spawner-missing` on eagles_nest
  (FHX-30), `off-its-pad` SdKfz251-Pak38 4.3 m and Ju88A 4.5 m low on
  el_alamein (FHX-31), eastern_blitz `INDUSTRIAL_ZONE` flag.law-mismatch
  (reproduces alone; palembang's Oil_field4 class, needs the flag-law trace),
  falaise_pocket `new_control_point3_spawn2` not grounded (reproduces; its
  siblings at the same height settle) and the flags phase aborting on a null
  hull's hp (the solomon harness class).
* Batch 3 quick behaviour was still running at the time of writing (slow: it
  shared the PC with the batch 4-5 bakes).

## 2026-10-27: Meuse River Line and ten more imported (171 -> 182)

`meuse_river_line-1944` had never been picked: it has no single-player data,
and `--pick` takes the single-player levels first. Named explicitly with the
pick's next ten: battle_of_valirisk-1943, battle_over_hokkaido-1945,
berlin-1945, berlin-1945-outskirts, berlin-1945-streets, berlin_uprising,
bizerte-1943, breakthrough-1944, chartres, counterattack-1940. Run from a
detached worktree at `-j 12`; all seven verify steps pass. Published (models
14.1 GB, the whole tree's models step having re-run; maps 1.7 GB) from a
staging root holding only this tree, so other trees' unpublished viewmodels
stayed behind; live `maps.json` 182, `mods.json` 4866 models / 182 maps.

* **`models` at `-j 20` is OOM-killed at the 24 GB step cap**: each
  `extract_models` worker holds ~1.2 GB of the chain flat, so 20 of them plus
  ~2.6 GB of parents start above the cap. `-j 12` (~17 GB) runs in 87 min.
* `poses_kit` done-with-findings: 6 pairs with no third-person aim clip, all
  from levels baked earlier (bryansk, latakia, palembang); mod data.
  `viewmodels` done-with-findings: 2 absent, 2 unanimated pairs; mod data.
* The 7 levels without a menu thumbnail or minimap ship none in their
  archives (the image extractor writes the same 289 files the volume holds);
  their dossiers were already live.
* Quick behaviour, 11 levels, 17 majors. Harness false positives, fixed:
  `asset.404` on a level's optional `assets.json` (db2db78d), BA-6's
  `BA-6_Binos_PCO3` spotter seat as `veh.gun-no-fire` (db2db78d), the Lebel's
  9 s reload as `kit.reload-never-completes` (aa6d066f). M16AA
  `selector-springs-back` on chartres passes alone (a neighbour's round).
  Known classes, open: `veh.round-spawner-missing` x7 (FHX-30: Hummel, IS2,
  Jagdtiger, B4howitzer, DeployedMortar, Mortar), Horse-Type38FieldGun_HEAT
  6.6 m off its pad (FHX-31, as on palembang), PTRS `kit.weapon-leaves-hands`
  10 cm (as on stashuv_area). New, with a background fix in hand: AMD35
  `veh.no-steer` (four EngineGrip springs, the fronts under c_PIYaw bundles;
  also live on battambang, euphrates_valley, merdjayoun, meigo_sakusen,
  savoy) and FordGPA waterguard springs back 2 deg on release.
* `behaviour_new.pending` holds these 11 until the open majors close; the 96
  earlier imports never checked are in `behaviour_new.deferred_backlog` in the
  state file (a quick check is 5-10 min a level).

## 2026-10-19 evening: the pipeline's own pick of five, and the replay-404 heal

Quick behaviour verdicts (after re-running bulge and solomon, whose first
pass raced the glb-store build rewriting the shared manifests — a worktree
without the `glbs/` link 404s every hash fetch; link `viewer/glbs` like the
other trees): palembang, peleliu, stalingrad, bulge, solomon all pass
vehicles, kits and spawns. Open rows: palembang `Horse-Type38FieldGun_HEAT`
off its pad 6.5 m (FHX-31 class) and `Oil_field4` flag.law-mismatch (needs
the flag-law trace); bulge `M12GMC` round-spawner-missing (FHX-30);
harness-side: bulge medic@t1:Mg42 `kit.weapon-not-raised` with the round
ending under the kit phase (the 2026-10-16 Katana class), bulge
`bots.stalled` 6/8, solomon flags phase aborted reading a null hull's hp.


battle_of_palembang, battle_of_peleliu, battle_of_stalingrad,
battle_of_the_bulge, battle_of_the_solomon (all single-player-capable, the
pick's preference), plus fhsw's five (fht_conquest_of_java-1942,
fht_dinant-1940, Warsaw_Uprising, Operation_Hailstone, Salerno-1943).
First batch on the delta extractors: the fhsw run took 32 min end to end.
palembang's Deploy_47mmType1mobile_HandFireArms exposed the engine-deleted
state-clone class in three checkers (poses 87d29d6d, rigs + kits audit
eb77d51e, with `viewmodels/absent.json` carrying the pairs); its two pairs
are accepted mod data. The replay-404 audit (54d337be,
`audit_replay_assets.mjs`) found 37 templates missing from this tree's
models (towed-gun accessory chains, RemoteStuka's guided-weapon class,
satchels); re-extracted via `reextract --templates-file` and published the
same evening. Open from the audit: ~~the Us_ColaBottleFighter pickup kits
(kit-stage scope)~~ — closed in code 2026-10-19 (FHX-34: the kits stage reads
the levels' statics and walks every placed object's own spawners, so a cola
machine's standing bottles get their `kits.json`/`loadouts.json` rows with
`"pickupOnly": true`, and the replay marks an unpicked standing kit by the
loadouts kit table instead of 404'ing `models/<kit>.glb` as a hull; the
census and the per-tree heal list are in
`features/mod-extraction-pipeline/README.md`, "The gates") — and
FHX-30/31/32/33 rows in fh-fhsw-open-issues.

## 2026-10-19: sector115-1946, invasion_of_usa-1948, rush_to_baghdad imported

Picked from the busiest FHSW server's 30-day map-popularity feed
(`/stats/data-explorer/servers/<id>/map-popularity?days=30`): sector115-1946
(2 rounds, 54 participants) and invasion_of_usa-1948 (1 round, 52) were the
only unexported FHSWEurope-own maps in its rotation; rush_to_baghdad was added
on the owner's ask. The same night the whole tree took its deferred
re-extraction with the 2026-10-17 code (kit pickups FHX-25, texture routes
FHX-26, seat poses), and the fhsw tree gained In_The_Hell_Of_Bocage-1944,
Eagles_Nest-1946, Simusyu_To-1945, Tunis-1943 and Iron_Monster from the same
feed. All eight published 2026-10-19 with dossiers, map images (the live
`maps/fhsw` and `maps/fhsweurope` image trees' first upload) and kit icons
(fhsweurope's first). `verify --no-gates` passes all seven steps on both
trees; no scorecard tier yet (`gates` not run). Quick behaviour verdicts:
every level's kits, spawns and flags pass; open majors are FHX-30
(mobile-gun deploy family: 94mmAA on both new sector115/invasion maps,
AMX50_APCR, rush_to_baghdad's Howitzer105mm), FHX-31 / the pad-settle class
(Simusyu's FordGPASpawn01 19 m under its water pad), and stashuv_area's
pre-existing Soviet reload defect (above).

## 2026-10-18: stashuv_area and road_to_ramelle imported

Asked for because the replay feed read "Not in the viewer yet" on both, which is
`playable` in `viewer/play/recordings-feed.js` — `own.rows.some(e => e.name === key)`
against the mod the recording names. Both recordings name `fhsweurope`, and the
live `maps.json` had neither row, so the cards could not play. The two were the
only unplayable cards on the feed.

Both are FHSWEurope overlays whose terrain comes from **FH**: the overlay archives
are 78 KB and 855 KB with no heightmap, and `FH/.../Road_To_Ramelle.rfa` (40 MB)
and `Stashuv_Area.rfa` (71 MB) carry the heightmap and terrain textures.
FHSWEurope's `init.con` chain is `FHSWEurope -> FHSW -> FH -> bf1942` and
`level_underlay` matches a level stem case-insensitively down it, so this needs
no special handling. `fh/road_to_ramelle` was already baked (2026-10-17) but
never registered, and is a different level: the FH bake spawns `tiger`,
`panzerivh`, `kubelwagen`, `m4a1sherman`; the round spawns `Sherman`,
`M5A1LT_Rand`, `M8A1GMC`, `M8HMC`, `SdKfz251/9`, `SdKfz251/10`, `MorrisLRC`,
`WillyFH`, `Pak38mobile`. Registering the FH bake would not have fixed the feed.

**Verified against real rounds**, not against the exporter: server recordings of
both levels on `FHSW 0.81+FHSWeu0.84` (slugs `nnnzjz8myz`, `9m9vhvfggv`), whose
`cp` lines carry each control point's name, template, position and starting team.
All 7 control points on each level match to within 6 mm with correct teams, and
all 16 of the round's vehicles are in the bake (9 of them absent from FH's).
Scene Z is negated (`bf42/gltf.py`), so compare with `(x, y, -z)`.

Findings carried out of the run, none of them caused by it:

* **`kit.reload-never-completes` x5, play-breaking, pre-existing and already
  live.** Soviet kits on stashuv_area (PPD40_202, SVT40, PTRS) start reloading
  and never finish. Not this bake: the rigs are shared and carry `reload` and
  `proneReload` clips, road_to_ramelle passed the same gate, and the three
  weapons are bound by 12 already-live levels (`a_day_of_zitadelle`,
  `battle_of_orel-1943`, `battle_of_pavlov-1942`, `fall_of_berlin-1945`, ...).
  Published anyway on the owner's call, since withholding fixes no reloads.
* **A level's own point sound emitters are not resolved.** `road_to_ramelle`'s
  `Sound/Environment.con` runs `War_ambience1`/`War_ambience2` (`SimpleObject`,
  each with its `.ssc`, placed 4 times by `StaticObjects.con`); `stashuv_area`'s
  `Sounds/radio1.con` creates `SimpleObject radio1`, placed inside FH's
  `Oldradio`. Both come out as `unresolvedTemplates`, so those emitters are
  silent. Narrow: both levels do carry their ambience and sound areas
  (2 + 44 and 2 + 301). Sounds are a `scene.json` layer, so the repair after a
  reader fix is `patch_scene.py --layer sounds`, not a re-bake.
* Open majors on stashuv_area: `veh.deploy-hull-survived` x2 (towed Flak 18/36),
  `veh.off-its-pad` x2 (`SdKfz251-Pak40` 12.1 m, `Zis22-ML-20` 6.5 m — the known
  unsettled pad-vehicle class), `kit.weapon-leaves-hands` x1 (PTRS, 9 cm).
* **Root-caused and fixed in the viewer (2026-10-19): stashuv_area's team-2
  Soviet kits could not reload** — `kit.reload-never-completes` x5 (PPD40_202,
  SVT40, PTRS, MosinNagant, NagantCarbine), plus `kit.weapon-no-fire` on
  SVT40/PTRS in the live-tree run. The reloads were never the defect: the
  soldier was DYING. Measured per frame headless (hp sampled alongside
  `__hw()`, every `Armor.damage` call stack recorded): every team-2 CoOp life
  began on spawn point `russianhq1`, took `combatTick`'s out-of-area damage
  (world-fields.js, the CA-5 material test — 10 s allowance, then 5 HP/s
  against 30 HP) and died at ~16 s; `soldier-view.js` gates `footFire` on
  `!soldierDead`, so a reload begun before death froze with `reloading` true
  and rounds 0, which is exactly the audit's evidence string. Two causes in
  layers:
  - **The mod's own data wart (stands in retail):** the overlay's
    `singleplayer/SoldierSpawns.con` places `russianhq1` at
    `144.53/81.30/347.85` — 1240 m west of `russianhqtemplate` (1384/361),
    on terrain material 7 ("Reserved (Outside map)") — a dropped digit
    beside its five siblings at x 1344..1467. The Conquest layer's six
    points are all inside the pocket, which is why the recorded real rounds
    (Conquest) never showed it. The baked `terrain/materials.png` is
    byte-faithful to FH's `materialmap.raw` (checked texel-for-texel), and
    all 7 control points and all 38 Conquest spawns sit on non-7 ground in
    the baked orientation.
  - **The viewer gap (fixed):** the engine draws `rand() %` over a group's
    active points (SPAWNGRP-10), so retail CoOp lands on the trap one life
    in six; the viewer's deterministic per-player walk landed on it EVERY
    life. `pickSpawn` (spawn-flags.js) now orders a point standing where
    the combat area deals damage (outside the rect, or on the CA-5
    material) out of the usable pool — the same shape as the existing
    `paratrooper`/`onlyForAI` filters, falling back to the full pool when
    the flag offers nothing else; `world-players.js` `outsideAreaOf` builds
    the predicate from the level's `CombatArea` and material map. Guard:
    `tests/test_combat_area_spawn_pick.py`. Re-measured after the fix: the
    audit's t2 spawns land at x 1344 (inside), all five kits fire AND
    reload (rounds refill at the weapon's own `reloadTime`). Post-fix
    kits-only audit (`audit_behaviour.py --mod fhsweurope --levels
    stashuv_area --only kits`, 2026-10-19, 10 kits, 882 s): zero
    `kit.reload-never-completes`, zero `kit.weapon-no-fire`. Still open,
    none of them the reload class and none moved by this fix:
    `kit.weapon-leaves-hands` x3 (t2 PTRS 8 cm hip and zoomed, the PTRS
    entry above; t1 Panzerfaust60 9 cm / 30 deg while firing),
    `kit.no-first-person-rig` t1 SatchelGerShort (`rigVisible false`
    although `FMGermanSoldier__SatchelGerShort.fp.glb` is on disk, so a
    runtime visibility question, not a missing export), and
    `kit.weapon-not-raised` t2 PTRS_Lay, whose evidence carries
    `"round":"endGame"` (the CoOp round ended under the probe: a harness
    timing artefact, not a kit defect).
* **Root-caused (2026-10-27): berlin-1945-streets' team-1 assault
  `RandomGerSeizedRifle8` "never finishes reloading" was the audit's clock,
  not the weapon.** `kit.reload-never-completes` (`magazine emptied, R
  pressed, 6 s later rounds still 0 (reloading seen true, clips reload)`).
  Death ruled out first: the tester's hp, sampled alongside `__hw()` through
  the change, stayed 30. The variant is FHSW's Lebel
  (`objects/Handweapons/!_PACK_COMMON/Compressed.con` includes
  `Lebel_BF1918/Lebel_BF1918.inc`, FHSW `objects.rfa`): `magSize 8`,
  `reloadtime 9` (a `rem`'d 2.5 beside it), and its tweak con slows the
  reload clip to 0.11 to match. `kits.json` and the glb's `fireArms` carry the
  9 faithfully and `hand-fire.js` completes the change at 9 s; the audit
  waited a fixed 6 s (30 x 6 frames). The other variants are 2..6 s, which is
  why only the Lebel tripped. Fix (`audit_behaviour.mjs` reload check): wait
  the weapon's own `reloadTime` + 3 s, never under 6 s, read from
  `__handWeapon().reloadTime` (new, with `reloadLeft`, in
  `test-hooks-soldier.js`), and record `reloadTime` and the tester's `hp` in
  `wr.reload` and in the finding's evidence, so a death mid-change reads as
  one. Before: 1 major `reload-never-completes`; after (same kits-only run,
  246 s): none, the Lebel refills with hp 30. Nothing to re-extract or
  publish. `engineer@t2:SatchelRusShort` did not reproduce as
  never-completes in either run (its `reloadTime` is 1; one run sampled the
  tester at hp 9 after his own charge, so the earlier report was most likely
  a death mid-change); both satchels still show the minor
  `kit.no-reload-clip` (idle only), which is a separate question.
* `poses_kit` and `viewmodels` both `done-with-findings`, both the mod's data:
  `RPG29` has no `Ub_StandAimRPG29` state with a 3P clip (2 soldiers), and
  `sigke7`/`sigke7_Lay` are named by Chinese and Japanese kits but declared
  nowhere in the chain or any level (4 pairs).

**`optimise` for the FHSWEurope models is no longer pending.** The `models`
step's own `run_then_optimise` tail did it: 13,047 of 18,924 glbs rewritten to
the shared texture store, 33,324 MB -> 12,952 MB. The rigs followed
(12,209 MB -> 6,616 MB) and the poses too (5,767 MB -> 1,621 MB); about 30 GB in
all, and `v_gz` passes on this tree for the first time — the 631 rigs with no
`.glb.gz` were the same wound, since `optimise` is what writes them. `verify`
passes all seven steps.

**Publishing.** A tree-wide send is refused while FHSW's rigs are inconsistent
("4413 glbs and their .gz disagree"), and would also carry another session's
21,516 changed FHSW map files. Scope it: hard-link your own files into a staging
root and `--root` it. `models/mods.json` is the same-size trap in its purest
form — 6807 bytes before and after, counts changing by equal digit width — and
`--hash` cannot catch it because there is no recorded hash to compare; it takes
`--hash-remote`.

## Other trees

XPack2's `v_levels` already failed before today's work: 23 inherited levels
(aberdeen, battle_of_britain, berlin and so on) have no first-person paint in
`viewmodels/skins.json`, which was last written 2026-10-12. Not caused by the
rebake. Open for the XPack2 pass.

## Evidence

* Ledger: PHY-24 (refuted 2026-10-07), CS-1..CS-11 (soldier shake; no vehicle
  row), LOAD-3 (alt-texture probe order, cited by the vehicle investigation).
* Checks run: `tests/test_assemble.py` (139), `tests/test_language_nations.py`
  (incl. two new guards), `tests/test_loading_rle_orientation.py` (3),
  `tests/test_build_mods_manifest.py` (6), `tests/test_collision.py`,
  `tests/test_ground.py`, `tests/test_ground_handling.py` (170 together),
  `tests/test_sim_vehicles.py` (27).

## Import batch, 2026-10-15

Twenty levels added with `mod_pipeline.py run --mod FHSWEurope --pick 20`
(the first unbaked levels with single-player data): 203_hill-1904, 226-1936,
Latakia-2016, a_day_of_zitadelle, aberdeen, adak_island, al_habbaniyah,
al_marj-1942, alaska-1948, apennines, aragon_offence-1938, arctic_convoy-1942,
argyrokastro-1940, arnhem-1944, bastogne-1944, battambang-1941,
battle_at_river_don, battle_for_ortona-1943, battle_isle-1944,
battle_of_angaur. The tree now registers 66 levels, all with a loading block.
`verify` passes all five checks. `viewmodels` finished with 89 kit pairs whose
weapon template no `.con` in the chain defines (mod data: `Luftfaust`,
`Astra_N`, `smoke_MN_green` and others). Published: textures 482 files,
models 3,297, maps 4,428. No gates run, so no scorecard tier yet. Dossiers
and map thumbnails for the stats site are not regenerated yet.

## 203 Hill: no kit on the Russians, a grenade that was a bare cylinder (2026-10-15)

Owner's report on 203_hill-1904 (Russia against Japan): the Russians wear no
kit (no cap), and their grenade is a big plain tan cylinder held upright in
first person, with no hands, that cannot be thrown.

**Cause: the level declares its own kit content, and two extractors read the
chain only.** The level's `Init.con` binds `game.setTeamSkin 2 RussianSoldier`
with kits `1Rus_AssaultNaganta`..`5Rus_AssaultNaganta`, all declared in the
level's own `objects/`, and so are what they carry: the cap `Rus_RJcap_m2`
(`objects/Ruskit/`, mesh `StandardMesh/Rus_nichirocap2.sm`), the grenade
`GrenadeRus` (`objects/RDG33/`, mesh `grenadeRus.sm`), the sabre `Shashka`,
the Japanese cap `JapNichirocap`, `GrenadeRJ` and `Arisaka30`. Nothing in
FHSWEurope, FHSW, FH or vanilla declares any of them.

1. `extract_kits.py` mounted the levels' textures but not their meshes, so
   the caps failed to build (`"glb": null` in `kits.json`) and both sides
   spawned bareheaded. Now `part_pools` builds a part a level declares with
   that level's archives behind the chain's. 28 of the 30 null worn parts on
   the 66 levels build; the two left are data (`NO_MESH` in
   `tests/test_kit_worn_glbs_on_disk.py`).
2. `extract_viewmodel.py` built its library from the chain alone, so every
   level-declared weapon was "no such weapon template", and the page drew the
   bare third-person `GrenadeRus.glb` at the eyeballed viewmodel offset. The
   grenade's states are level data too: FHSW's `AnimationStates.con` includes
   `CopyOfKnifeWeaponsMod.inc` and `singleShotWeaponsMod2.inc`, which only
   level archives ship, and 203 Hill's say `copyState2 GrenadeRus GrenadeAxis`
   (ledger LOAD-10, by data). A weapon the chain does not declare is now built
   through the first level that hands it out and declares it
   (`level_rig_hosts`, `level_rig_context`): its scripts first, its meshes and
   images behind the chain's, its `animations/` ahead of them
   (`ArchivePool.add_level_root`). A level's own copy of a kit
   (`levelVariants`) now has its items asked for as well.

**Blast radius.** The 2026-10-15 import's `viewmodels` log had 89 findings;
the same count over the 66 levels gives 90 pairs on 25 levels and 45 weapon
names, every one declared by a level (Latakia's AK74, RPG-7, PKM; Caen
Streets' Welrod and smoke grenades; Fall of Berlin's M-31; Abyssinia's
FN Mle 1930 and so on). After the fix 132 rigs are built through 20 levels'
loads and 86 of the 90 have a rig. The 4 left are kits naming a template the
level that hands them out does not declare: Argyrokastro's `CarcanoSniper`
(only Nikolayevka declares it) and Yellow Sea's `sigke7`/`sigke7_Lay`
(declared by Abyssinia, Guangxi and Wuhan). Retail hands out nothing for
those. A level weapon that has no rig now exits 2 and stops the
`viewmodels` step; the data findings still exit 1 (done-with-findings).

**Seen in the page** (headless, `map.html?map=203_hill-1904&mod=fhsweurope&botCount=6`,
port 5331): before, the bots' worn slots were `{hip: 1}` for the Russians and
`{}` for the Japanese, and `GrenadeRus` came up with `rig: null`,
`viewmodel: false`, drawn as the upright cylinder. After, every bot wears
`{head: 1, hip: 1}`, the grenade raises `RussianSoldier__GrenadeRus` (sleeves,
hands, the GrenadeAxis clips at the level's own rates), and a held trigger
throws it: one shot, one round in flight, the hand empty after.

**Pipeline.** `run --mod FHSWEurope --only-steps kits viewmodels loadouts
manifest manifest_final --force-steps --no-gates`, from a worktree with the
main checkout's state file: kits done, loadouts done, viewmodels
done-with-findings (the 5 data pairs below), manifest done. `verify --mod
FHSWEurope --no-gates`: all five pass. The fifth data pair is Golf Hotel's
level copy of a kit naming the rolled bundle `RandomSmokeItem4Ger`, since
fixed in `kit_pair_levels` (it rolls the kit's variants, which have rigs).

**Open.**
* ~~Third-person poses (`poses_kit`, `extract_pose.py --kit-poses`) have the
  same gap.~~ Fixed 2026-10-15: `kit_pose_plan` takes a level's own weapon
  as a candidate (`level_weapon_host`) and `export_hosted_rows` poses it
  through that level's load (`level_rig_context`, now in `extract_pose.py`),
  its grip merged into `gaits/` (`merge_level_gaits`). With `--kits --maps`
  every item the exported levels' kits hand out is posed, for the player's
  chase view (Doomed_Budapest's `SVT40Bay`, bayonet knife and `RDG33`). A
  level weapon with no pose exits 2; jobs and items the install gives no
  stand-aim clip exit 1 (done-with-findings). 203 Hill's
  `Handheld_Flag_Japan` fires at rate 0, which `export_gait_clips` now
  lists instead of dividing by.
* FHSW has the same classes: 68 rigs and 8 worn parts are listed `PENDING`
  in the two on-disk tests until its `kits` and `viewmodels` steps run; FH
  has 3 worn parts.

## Import batch, 2026-10-16

`mod_pipeline.py run --pick 10` on each tree, published the same morning.
FHSW (no single-player levels left, so picked at random): Desert_Hill,
Battle_Over_Hokkaido-1945, Berlin-1945-Outskirts, KORSUN_POCKET,
Operation_SpringAwakening, Siegfried_Line-1945, Operation_Varsity,
Westminster-1942, fht_battle_of_kohima-1944, Battle_for_ortona-1943.
FHSWEurope: battle_of_bougainville, battle_of_edson_s_ridge, battle_of_foy,
battle_of_iwo_jima, battle_of_khalkhin_gol, battle_of_kyoshu-if1945,
battle_of_leyte_gulf, battle_of_makin, battle_of_nikolayevka-1943,
battle_of_orel-1943. `verify`: FHSWEurope passes all seven checks; FHSW fails
`v_static` on 6 horse held-key axes and the DeployedMortar part. The first
`v_behaviour_new` run failed both trees (FHSW 23, FHSWEurope 17 open
blocker/major findings: fire-extinguisher seats, an immobile Chi-ha and 45 mm
AT gun, the scout Katana `isReady` page error, horse legs, rudder-dead and
diving aircraft, pad settle). A fix round the same day made it pass on both
trees (0 blockers, 0 majors); see the next section and
`features/fh-fhsw-open-issues` FHX-21, FHX-22 and FHX-23 for what stays open.

Instant Battle lists every level since 2026-10-16 (`viewer/play/skirmish.js`
`buildLevels`, a departure from the retail `inGameList` rule). A level without
`SinglePlayer<Side>.con` wears a dim NO BOTS tag (`play/menu-screen.js`
`NO_SP_TAG`) and starts in Conquest with `botCount=0`. All ten FHSW levels of
this batch are such levels, and FHSW has no single-player level left unbaked,
so every later FHSW batch will be too.

## v_behaviour_new on the ten battle_of_* levels (2026-10-16)

The quick behaviour check failed on the batch of 2026-10-16. Every finding was
measured in a page probe; the table and the fixes are in
`features/mod-extraction-pipeline/README.md`, "The 2026-10-16 batch". What is
this tree's own:

* **battle_of_iwo_jima's Chi-ha are dug in.** One stands in a trench tunnel
  (`SW_trench_tunnel_*`) with a `Plank_10m_m1` beam across its nose 3.9 m
  ahead, the other on the floor of `SW_trench_Fort_wide_Flak18_m1`. Both back
  out (5 m); the level placed them as emplacements.
* **battle_of_iwo_jima's `m4_poa` pad is 0.64 m under the beach.** The load
  settle springs its Sherman-POA_USMC 7 m up and 9.7 m down the slope.
  Open as FHX-22 (`features/fh-fhsw-open-issues`).
* **battle_of_nikolayevka-1943's six 45mmATGunmobile stand 1.2 m behind their
  own sandbags** (`pega_sandbag_str_m1`, `pega_sandbag_C_m1`) and push into
  them; they move backwards.
* **battle_of_makin's Hellcats are Hornet(2)'s deck aircraft** (held spawns),
  never level pad hulls; the first F4U-1A runs into its neighbour on the
  ground roll (150 to 50 hp).
* **battle_of_iwo_jima's A6M3a and battle_of_kyoshu-if1945's A6M5c hang on a
  flying spawn's arm** (`CounterSpawnA6M3a_SP78rotator`,
  `CounterSpawnA6M5c_SP64rotator`; the A6M3a 1018 m up), over the 1000 m lift
  ceiling.
* **battle_of_bougainville's AI areas are unreachable on foot**: `west`
  (7000, -1000) and `east` (1000, -7000) are outside the 4096 m world, `mid`
  (4000, -4000) is under 27 m of sea. Infantry bots hold their base; the
  pilots fly.
* **battle_of_foy's C47Radio_150** is FHSW `Battle_Of_Foy.rfa`'s own radio
  (underlaid): no sound script on its FireArms, as on the chain's C47Radio.
  Accepted in `audit_behaviour_accepted.json`.
* The texture-load page error on battle_of_nikolayevka-1943
  (`textures/c2/c257c22b979c90c66c126cd3fed4e5b4.webp`) was a transient: the
  file exists.

## Crete 1941: German kits with no weapons in CoOp (2026-10-27)

* **Symptom.** `kit.no-weapons` (blocker) on crete-1941, 2 to 5 of team 1's
  kits per quick run: "spawned kit scout for team 1 carries no weapon slots".
  The kit data was right; it was never the parachute.
* **Cause.** The level's SinglePlayer layer comes from FHSW's
  `Crete-1941.rfa` (`singleplayer/ControlPoints.con`, `SpawnPointManagerSettings.con`).
  Every control point there is `Object.setTeam 0`, and Chania's is
  `setTeam 7471174`, a garbage word in the mod's own file. The spawn groups
  are each on a side: Suda Bay's group 1 and four others are `groupTeam 2`,
  and the German airbase's group 2 is `groupTeam 1`. Retail's
  `ControlPoint::init` runs nothing for a neutral point (ledger SPAWN-19), so
  its groups keep their `groupTeam` (SPAWNGRP-4) and each side spawns on its
  own groups' points while every flag shows neutral. The page's `holdGroups`
  ran the disable on every neutral point at the start. That zeroed all six
  groups, so team 1 had only the Ju52's deck spawn and team 2 only Chania.
  The audit's `spawn` took the Ju52 seat, refused it as a seat, and stood the
  German up on the next flag, neutral Suda Bay. The kit lookup asked
  `flag.team`, which is 0 there, and no `game.setKit 0` exists, so he got no kit
  and no weapon slots. A real player could do the same with a number key.
  After about 10 s on the flag he captured it, so later kits passed. That is
  why the count moved between runs.
* **Fix (viewer).** `spawn-flags.js`: `holdGroups` no longer zeroes a neutral
  point's groups at the start. A neutral point offers the groups its one side
  holds, as `spawnSide`. `flagSide(flag)` gives the owner, else that side. The
  deploy screen (`deployFlagIndices`, `selectDeployFlag`,
  `preferredDeployTeam`, the seat team), `world-players.js` `spawnPlayer`,
  and the bot spawn and respawn pickers ask `flagSide`. `kit-loadout.js`
  `kitSide(flag)` hands the kit, soldier, primary and HP of the side the
  soldier spawns for, never team 0's. A vanilla neutral point (group
  `groupTeam 0`) is unchanged: every point is offered, and no side owns it.
  Census over every local tree: only crete-1941 (FHSW Conquest and
  SinglePlayer, FHSWEurope SinglePlayer) and FHSW berlin-1945's Conquest
  `Bunker_HQ` have a neutral point with a sided group.
* **Audit.** `audit_behaviour.mjs` `spawn` orders flags by the hook's new
  `side` field: the side's own flags, then flags of no side, then the other
  side's. `testKit` records `harness.kit-other-side` (info) and skips the kit
  when the tester stood up on the other side. Before this, the British kits
  were tested under team 1.
* **No re-extract.** `scene.json` already carries the group teams on
  `soldierSpawns[].team`. The fix is viewer code only, so nothing is
  re-published beyond the viewer itself.
* Guards: `tests/test_control_point_law.py`
  `test_a_neutral_point_offers_its_groups_to_their_own_side`,
  `tests/test_kit_level_js.py` `test_a_neutral_points_soldier_gets_his_sides_kit`.

## Two viewer-physics defects from the behaviour audit (2026-10-27)

* **AMD35 could not steer** (`veh.no-steer`, counterattack-1940: "D held
  2.5 s at 23.4 m/s: heading moved 0.9 deg"). The AMD35 is a four-wheel-drive
  `c_ETCar`: all four springs are `c_PGFEngineGrip`, the fronts under
  `c_PIYaw` bundles (+-40, 80 deg/s). `TrackedVehicle.#collide` drove every
  EngineGrip wheel along the hull's forward, and its `dV = T - Vt` takes away
  all the contact speed off that line, so the steered fronts asked for the
  hull's heading and fought their own lock. `addFriction` reads a wheel's
  forward from its physics parent's absolute row 2 (lnxded `0x0825b9cf`,
  `features/vehicle-collision-physics/reports/R1-terrain-friction.md`; TANK-23),
  which for a front spring is the steering bundle's posed heading, the same
  servo angle its RollGrip axle follows (TANK-27). Fix: a steered wheel drives,
  samples the load (`feedbackLoop`) and rolls along `steeredForward` (the
  bundle's servo angle on the hull's axes; `steeredAxle` is RollGrip's axle
  from the same angle). DC's Humvee, also all-wheel drive with driven steered
  fronts, had the same defect (harness: 0 deg turned, now 98). After: AMD35
  passes, 57.6 deg in the 2.5 s at 23.8 m/s; the vanilla Willys on Kursk still
  steers (70.6 deg). Guard: `tests/test_ground.py`
  `test_a_driven_steered_wheel_drives_along_its_bundle`.
* **FordGPA's waterguard "sprang back"** (`veh.selector-springs-back`,
  meuse_river_line-1944: "turned 12 deg on ArrowUp and went back 2 deg on
  release"). The viewer was holding the axis; the audit misread it.
  ArrowDown took the waterguard away from rest and it held. ArrowUp then
  drove it back toward rest, and the release lands a round trip after the
  audit's `during` sample, so the part kept going toward rest under the key,
  and that read as a spring back. It was intermittent (2-6 deg, or nothing,
  depending on the page's frame timing). Fix: `checkHeldAxes` judges a spring
  back only on a key that moved the part away from where the previous key left
  it, and records `heldTrace`. While there, the held-axis integrator
  (`vehicle-base.js` `heldAxisStep`) now runs GUN-2's speed register: it ramps
  at `|acceleration|` deg/s^2 and is kept through a release. The old comment
  "every ammo selector's is 1e7" does not cover the waterguard's
  `setAcceleration 100`. That axis takes 1.5 s to reach 150 deg/s and coasts
  on after a release, measured 8 deg held, then 16 deg. An axis with no
  acceleration still moves at full speed at once. After: FordGPA passes
  (`heldAxis: holds`, twice). Guard: `tests/test_held_axis.py`
  `test_a_held_part_ramps_and_coasts_on_its_speed_register`. DC's Forklift
  forks test now expects the ramp (`test_the_forks_move_at_their_own_rate`).
* The Willys run on Kursk reports `asset.404` for four `/glbs/<sha>.glb` that
  this PC's `viewer/glbs` store does not hold. That is an asset-tree gap and
  has nothing to do with these fixes.

## Cavalry: horses rolled over on hills; a stacked pad variant read as immobile (2026-10-27)

The overnight behaviour audit on operation_springawakening (CoOp) reported
`veh.immobile` on Cavalry_K98 (0.8 m in 6 s) and `veh.steer-reversed` on
Cavalry_PPSh (D turned the nose 0.21 rad left in 0.5 s). Every `Cavalry_*` and
`Deployed_Cavalry*` template in FHSW and FHSWEurope carries the same drive
(the HorseEngine `c_ETTank` and four springs, byte-identical in the glbs), so
one law covers all of them. FH's tree has no horses.

* **The drive law was already right.** On the flat the page's horse rests
  0.38 m up (the lab's retail horse 0.40 m, run 20261017-120533), gallops at
  11 m/s, and on right lock turns right at once, sheds its speed and spins at
  200 to 330 deg/s with its top tipped out of the turn. The lab's horse fell
  from 10.7 to 4.5 m/s in 1.6 s while passing 109 deg/s (TANK-14). Each
  spring meets the ground 0.4 m under its axle (`Horse_wheel_m1`'s col0 is a
  0.4 m wheel, handed over by `wheelContactDepths`). Commit 382f7515 (a driven
  steered wheel drives along its bundle) cannot touch a horse: none of its
  springs hangs under a `c_PIYaw` RotationalBundle.
* **The PPSh's reversed steer was a horse on its side.** Driven up an 11
  degree hill, the horse sank onto its belly (root 0.1 m off the ground) and
  rolled over (roll 85 deg, pitch to -87 deg), so the D press measured a
  horse that was lying down. The cause is `HorseRecover`, a FloatingBundle
  (`hullHeight 300000`) under `Cavalry_Common`. The page damped it with the
  root's drag, mass and 2 x 4 m box: a 0.5 m/s cap on any vertical speed, up
  or down. The engine damps a float with its physics PARENT's drag, mass and
  box, and `Cavalry_Common` authors no drag, so it holds the template default
  of 0. Retail's horse lifts and never damps (PHY-39, read in lnxded). The
  lab's spawn hop shows it: 0.65 m to 0.40 m in 0.6 s, matched to 0.015 m rms
  undamped and missed by 0.09 m damped. Fix: `body-float.js` `undampedByParent` gives
  such a float `parentDrag: 0`. Vanilla's floats all hang under their root
  and are untouched. After the fix the horse climbs the same hill at 11 m/s
  with no roll (`probe2`, CoOp).
* **The K98 was the pad's absent side, standing inside its live Nagant** in a
  barn (`loadPadVariants` places both at the pad). Driven, it was a hull
  inside another hull. The audit now reports such a run as info
  `veh.stacked-pad-variant`, not `veh.immobile`. After the float fix the K98
  climbs out of the Nagant anyway (15.7 m). Open, for the pad lane: whether a
  hidden absent variant still collides with the live one it stands in.
* The audit's steer check summed `turned` from end headings, so a horse that
  spun past 180 degrees read as one that barely turned (PPSh: 8.5 deg). It now
  sums the turn a quarter second at a time.

Before, then after (`audit_behaviour.mjs --only vehicles --vehicle '^Cavalry'`):
K98 0.8 m immobile, then 15.7 m and 101 deg; Nagant 37.5 m and 61 deg, then
57.2 m and 402 deg; PPSh 34 m reversed, then 54.1 m and passing. No findings
remain. Guards: `tests/test_ground.py`
`test_a_horse_climbs_a_hill_on_its_feet` and
`test_a_horse_on_full_lock_sheds_its_speed_and_spins`. Still open: a horse
that meets a static at a gallop rears to 70-80 degrees before it comes down,
which nobody has checked against retail. No extracted data changed.
