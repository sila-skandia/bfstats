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
FHSW 70. Pending imports (baked, not registered) are listed below.

**Still open:** item 7; FHSW's voices step; `optimise` for the FHSWEurope models.
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

A bake registers every level it writes, so the 2026-10-14 rebake added 60 rows
the owner had not imported. They were restored out of `maps.json` on the same
day. Their `scene.glb` and `scene.json` are current, and they are the scope for
the next import batches (ten at a time). Each still lacks the content a bake
never writes: a loading block, a kit binding, a `loadouts.json` entry and
first-person paint in `viewmodels/skins.json`.

FHSWEurope, 36 levels:
3rd_solomon_sea-1944, air_raid_kure-1945, battle_of_abyssinia-1936,
battle_of_antarctic, battle_of_biak-1944, battle_of_gela-1943,
bombing_the_reich-1945, fall_of_berlin-1945, fall_of_singapore,
fht_golf_hotel-1944, flak_tower, husky-1943, ilomantsi-1944,
invasion_of_the_philippines, iwo_jima, july26-1945, kushira, malta-1942,
meigo_sakusen-1945, naichi-1945, omaha_charlie-sector-1944, operation_da-1943,
operation_ketsu4, operation_lilliput, operation_sea_lion-1942,
operation_unthinkable-1945, reichsbahn-1945, remagen_jet, saipan-1944,
seelow-heights-1945, siegfried_line-1945, the_nebelwerfer_hunt1944,
tigerpass-1943, tulagi_island, wake_night, yellow_sea-1937

FHSW, 24 levels:
Air_Raid_Alert_-Kure-1945, Battle_of_Gela-1943, Battle_of_Off_Malay,
Battle_of_Peleliu, Bombing_The_Reich-1945, Dover_Strait, Fall_of_Berlin-1945,
Fall_of_Singapore, fht_hong_kong-1941, fht_operation_longcloth-1943,
fht_pasir_panjang-1942, fht_the_breaking_point-1940, Forgotten_Hometown,
Gazaps-1945, ilomantsi-1944, kushira, Manchuria-1945, Naichi-1945,
Operation_A, Operation_Coronet-1946, Operation_Kikusui_day1, Saipan-1944,
Seelow-Heights-1945, Transcarpathia-1944

To import one: add it to the tree with the `levels` step (it registers the
row), then run the completion for the tree, then `verify`.

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
