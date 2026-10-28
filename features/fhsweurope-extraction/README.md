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

   **Closed (2026-10-27).** The page now settles every pad hull at load
   (`hull-bodies.js` `settlePlacedVehicles`, the engine's law, SPAWN-28). The
   pads that still stood off at load were four other causes (towed guns taken
   for hull parts, an amphibian with no float term, spawners in the air, level
   placed planks), fixed or classed under FHX-31 in
   `features/fh-fhsw-open-issues/README.md`.

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
  (Oil_field3) and `AxiskillerCage25mHard`, the same class. Re-run
  2026-10-28 (scene restored with `evict_levels.py restore`): Oil_field4 is
  info `flag.kill-trap`, dead within 6 s, owner stays 2; 0 blocking. Fix
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
  **The 36 s round is retail's, checked 2026-10-28.** The co-op layer is
  FHSW's (`Coop.con` runs `SinglePlayer/*`, which FHSWEurope's rfa does not
  ship): tickets 100 / 90 at 10 a minute, every `areaValue` 30, so neither
  side ever passes the 99 the bleed needs and a fresh round with nobody on
  it, or with 8 bots, bleeds nothing. `allied_base` is `unableToChangeTeam
  1`, lose 25 s, `loseControlWhenEnemyClose 0`, group 2 (`groupTeam 2`, the
  Allies' only group, `groupEnableToChangeTeam` at the ctor's 1). The
  audit's German alone on it runs it down at 25 s (FHR-4); `CPDisable`
  writes 0 into group 2's team (SPAWN-22), so the Allies hold no group, and
  with nobody of theirs alive they bleed at the at-end 1000 a minute once
  the full 60 / (10 x 16/16) = 6 s countdown runs out (TKT-5, TKT-8): 90
  tickets gone at 25 + 6 + 89 x 0.06 = 36.3 s. The page did exactly that.
  Headless (`__round()`, 1 s samples; harness seconds run ~1.3x the page's
  clock because the tab's own animation frames tick between samples): 0
  bots, nobody deployed, 90 s: 100 / 90 throughout. 0 bots, German on the
  base: base off, team 2 stranded, 90 -> 0 in about 4 s, `endGame`, winner
  1. 8 bots (9 slots: 56 / 50), nobody on the base, 150 s: no bleed, only
  deaths. 8 bots, German on the base: base off at the same point, census
  team 2 groups 0, yet no bleed (Allied bots alive, TKT-5's "no live player"
  cleared); they take North_West_Flag and have a group again. Guard:
  `tests/test_control_point_law.py`
  `test_a_fixed_base_run_down_ends_the_round_only_with_its_side_dead`.
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

## Puma and Panzer III `veh.no-steer` on ramelle_neuville-1944 (2026-10-28)

The overnight audit flagged the Puma ("D held 2.5 s at 3.6 m/s: heading
moved 1.0 deg") and the PZIIINCamo ("3.2 m/s: 0.6 deg"). Two causes, one
real and one the audit's.

* **The Puma could not steer anywhere: a viewer defect, not a regression.**
  The Sd.Kfz. 234 hangs all eight springs under `c_PIYaw` bundles: the outer
  pairs `c_PGFEngineGrip` at +-40, the inner pairs `c_PGFEngineDummyGrip` at
  +-20, and both rear axles' bundles declare `direction -1`.
  `TrackedVehicle` stepped every steering servo toward `yaw x lock` and never
  read the bundle's direction, which `applyRig` (`axisDirection`) honours for
  the pose. Before 382f7515 every driven wheel pushed along the hull and the
  car went straight (node harness, flat ground, full right at 25 m/s: 0.0 deg
  in 2.5 s); after it, the rear driven pair steered the front's way, all four
  driven wheels lay parallel and the hull crabbed (-14.4 deg). The same
  repro on 382f7515~1 also reads `veh.no-steer` (0.4 deg), so 382f7515 did
  not cause it. Fix: a steered wheel's servo goes toward
  `yaw x sign(direction) x lock`. After: 137.5 deg in the harness; on
  sector318-1944, where the Puma's pad is clear, 277.8 deg in the 2.5 s at
  26 m/s (origin/main before the fix: 15 deg). The vanilla Kursk PanzerIV,
  T34, T34-85 and Willys still steer (146, 119, 124, 91 deg). Guard:
  `tests/test_ground.py`
  `test_an_eight_wheeler_steers_each_axle_its_own_bundles_way`.
* **Both hulls were wedged: an audit artefact.** Each drove into a field
  fence 21 m from its pad (`eu_fence_m1`; the tank also an `eu_cart_M1`),
  stopped dead and ground there under full throttle; the drive's `speed`
  kept reading 1-4 m/s, which passed the verdict's 3 m/s gate. The tank
  steers on flat ground (harness: 140 deg). `testGround` now backs a hull
  off 3 s when its last second under throttle covered under a metre, steers
  it in reverse with the direction mirrored (records `blocked`), and gates
  the verdict on the hull's ground speed over the press. After, on the
  level: Puma 244 deg, PZIIINCamo 118 deg in reverse, no `veh.no-steer`.
  The tank's gun test that follows once killed its tester with his own
  shell's splash against the fence (`veh.crew-killed-by-own-fire`, info,
  retail-faithful).

## Floats under a non-root part: breaker floats, the PBY, camels, a horse into a wall (2026-10-28)

Follow-up to the cavalry section above and PHY-39.

* **FloaterBreaker floats damp by their own part.** `PhysicsFloatingBundle::
  updatePhysics` takes a float's damping from its physics parent's drag, mass
  and own geometry box; the vertical speed is the root's at the float and the
  acceleration reaches the root unchanged, so only those three numbers move
  (PHY-39, the 2026-10-28 paragraph). FHSW's 115 and FHSWEurope's 149 ship
  templates hang four of their floats under `*FloaterBreaker*`
  RotationalBundles (drag 2-3, mass 1000) whose geometry is a 0 to 1 m marker
  mesh, so those four now damp at 0 to 0.1 of the root's coefficient
  (Kirishima's 1 x 1 m marker 1.7). Vanilla and both XPacks hang every float
  under its root and are untouched. `body-float.js` `parentDamping`.
  Retail check: Battle of Biak's Pennsylvania_1944 and fuso_1944 load under
  their draft and rise in the lab's server recording (run
  20261015-073151); the float law with parent damping follows the first 7 s
  to 0.061 and 0.093 m rms, with root damping 0.109 and 0.250 m
  (`tests/fixtures/float_breaker_rise_biak.json`). In the browser
  (3rd_solomon_sea-1944, Atlanta, 10 s at rest, 20 s full ahead, 30 s full
  rudder, 10 s stopped): at rest on her closed-form draft both before and
  after, 20.1 m/s, roll at most 4.8 deg in the turn against 4.3 before, heave
  inside 0.14 m.
* **PBY-5 at rest bobs, as retail's does.** Its three floats hang under
  `PBY-5Complex`, a Bundle with no drag, so since f78a3096 they lift undamped.
  On the page (july26-1945) the dropped PBY now heaves 75.5 to 78.1 m and
  rolls up to 6.7 deg for about 20 s before it settles; before f78a3096 it
  settled in 2 s. The lab's ObjectiveMode round on the same level (run
  20261028-012921, server recording, no client) shows retail's three pad PBYs
  heaving 75.9 to 77.7 m after the spawn and still bobbing 0.3 m and rolling
  3.8 deg a minute later. So the bob is retail's; the page's damps out
  sooner. Open: the page's aircraft box drag has no submerged multiplier
  (`ship.js` has it, `aircraft.js` `applyBoxDrag` does not), which would damp
  more, not less, so the faster settle is something else; not chased. Taking
  off: full throttle 50 m/s on the water, pulled up to 187 m, the same both
  ways.
* **Camels** (desert_rose-1942, Camel_No4): at rest 27.04 to 27.05 m, a
  gallop at 18.4 m/s, full lock and stop, no bounce or roll beyond 4.7 deg,
  the same before and after f78a3096.
* **The `Remote*` bombers** hang `*Floater2` (hullHeight 300000, lift 4.91)
  under their Complex Bundle (or a FloaterRot RotationalBundle); every one but the two FW190 variants (root drag 0.06)
  has root drag 0, so their float damping was already 0 and f78a3096 changed
  nothing for them. Not driven in the browser.
* **A galloping horse into a wall rears, and the law says it should.**
  Driven at 11 m/s head-on into a SuburbHouse on operation_springawakening,
  the K98's nose went up to 55 deg in about 1.3 s and stayed at 45 to 50 deg
  while W was held against the wall. Instrumented (`DrivenBody.flush` and
  `Response.solve` wrapped in the page): the contact is the head vertex of
  `Horse_Hull_m1`'s col0, 1.77 m above the root, `solveImpulse` posts half
  the closing speed there (8.4 m/s along the corner's normal, then the
  `setAdjust` sum of two faces), and the pitch rate reaches 1.86 rad/s over
  four ticks against the 6.8 m^2 per-mass box inertia of the 2 x 2.1 x 4 m
  header box. That is collision-response.md section 6.4 to the number: the
  impulse lands 1.75 m over the centre of mass, nothing in the law puts
  gravity's torque about it, and only the four weak springs (strength 4 to
  10) pull it back. No lab recording of a horse collision exists; five
  probe runs to make one (veh_law_probe, two pads, both teams) could not
  board a horse: the axis spawn on that level stands the soldier inside a
  tent he cannot walk out of, and at the village the Nagant refused Use from
  1.3 m. Left as law-faithful and unverified. Seen on the way and not
  chased: a horse that ran under a camouflage net at 11 m/s was pushed 1 m
  into the ground and rolled to 72 deg (body-statics.js divergence 1: a
  level face is two-sided on the page, culled from behind in the engine).
  All three are answered in "Three reports from Operation Spring
  Awakening" below: the tent and the Use are retail's, the roll was not
  the face rule.
## FHX-30: mobile guns, towing tractors and spawner rounds (2026-10-27)

The `veh.deploy-hull-survived`, `veh.immobile` and `veh.round-spawner-missing`
majors of batches 2 and 3 and the overnight run. The row in
[fh-fhsw-open-issues](../fh-fhsw-open-issues/README.md) (FHX-30) has the causes
and commits; this is the evidence.

| Level, unit | Before | After |
|---|---|---|
| fall_weiss `c7p-wz1897`/`wz1917`/`C7P-wz36` #seat0 | deploy-hull-survived x3 ("stood at 0.1 s", the killer's repair dummy) | `veh.deploy-sequence` info: towed gun stood at 2.0-2.2 s, tractor alive (killer 0 hp on a 109 hp hull: 613 has no cell on material 34) |
| fall_weiss `c7p-wz1917` drive (6 s full throttle) | 5.8 m, 1.4 m/s | 38.4 m, 8.6 m/s (engine fix alone: 10.9-12.7 m; bare `C7p` on eastern_blitz: 35.8 m, 6.4 m/s) |
| iron_monster `Flak18/36mobilestatic#seat1` | deploy-hull-survived (tested node `padAbsent`) | info: killer at 3.0 s, mobile gun stood at 4.1 s, tester dead with the static |
| kharkov_winter `BoforsM1936mobile#seat1`, `M3A1-BoforsM1936#seat0` | deploy-hull-survived x2 | info x2: Bofors dies at 2.93 s and the static stands at 4.03 s; the half-track unhitches its gun at 2.03 s and lives |
| pakfront `85mmAA_towedgun`/`85mmAAmobile`/`85mmAAmobilestatic` #seat1 | deploy-hull-survived x3 (overnight) | info x3 after the models re-extract: killer at 2.97-3.07 s, deploy object at 4.07-4.13 s |
| juno_beach `HanomagM#seat0` | deploy-hull-survived (a mine's undrawn icon read as a static) | no finding (no deploy seat) |
| rush_to_baghdad `Howitzer105mm#seat0` | round-spawner-missing, 32 shots, 0 rounds sampled, 2 objects stood | no finding: 2 spawner rounds launched |
| pakfront `Brummbar#seat0` | round-spawner-missing, 88 shots (overnight) | no finding: 1 launched |
| sector115 `94mmAA#seat0`, forager and nordwind `DeployedMortar#seat1` | deploy-hull-survived / round-spawner-missing | no finding: 2 launched each |
| raseiniai `Flak30mobilestatic#seat1` | deploy-hull-survived (tested node `padAbsent`) | info: killer at 3.03 s, mobile gun stood at 4.23 s |
| raseiniai `KV2Raseinia#seat0` | round-spawner-missing, 64 shots, 0 sampled | no finding: 1 launched |
| stalingrad_redsquare `Stationary_Dp1928#seat0` | round-depot-missing, 32 shots, depots stayed at 9 | no finding: its horn's `PeoplesbraveryWideProjectile` (0.01 s, carries `PeoplesbraveryWideSupplyDepot`) stood 1 depot round |
| prokhorovka `SdKfz7Tractor-Flak18/36` drive and #seat0 | veh.immobile (0.0 m, 0.2 m/s) and deploy-hull-survived | 42 m, 12 m/s; info, towed gun at 2.13 s, tractor alive |
| rheinuebung `Bismarckbots#seat2`, `Hoodbots#seat0` | deploy-hull-survived x2 (a shell's held `PenetrateExplosion36cm` beside an air-burst AA shell; later seats untested) | no deploy seat; all 6 and 7 seats tested, no finding |
| berlin-1945 `Hummel`, `IS2_mesharmor`, `Jagdtiger` #seat0 | round-spawner-missing x3 | no finding: 1 launched each (the Jagdtiger's periscope `DirectorAxis` seat now reads as a deploy, info, hull alive) |

What the spawners on those shells are: `PenetrateExplosion<cal>[Invis]` and
`ArtyEffectPCO*` (`!_PACK_COMMON`), 1 hp PlayerControlObjects of material 810 the
shell's spawner stands on its first frame and holds (`holdObject 1`,
`spawnDelayAtStart 0`, abandon clock `TimeToLive 10`, `Distance 20`,
`damageWhenLost 10`). Let go when the shell dies, they die to its splash or the
clock and play their armor effect (`e_ExploLarge`, `e_ExplMedRocket`) with the
incoming-shell sound script; `PenetrateExplosion*` also explode
(`explosionRadius 14`, `explosionDamage 5`). The page stands them (`stood` > 0
on every run); the audit had only failed to see the round.

The C7P towing tractors, for whoever comes back to the speed: the towed gun is
`towed_*_DummySpawner1/2` -> `*_towed_dummySpawnObj[First]` -> `*_towed_dummySpawner`
-> `*_towed_dummy`, all `holdObject 1` under `c7p-*_Spring` on the hook, baked
under the tractor. Fire throws `*_SpawnerProjectile` (stands `*_towedgun` 2 s
later, 1 m up) and `*_DummyKillerProjectile` (a depot at -1000 on the three
dummies); Alt throws `*_KillerProjectile` (8 m, 613: the towed gun dies, the
tractor not) whose spawner stands `*_dummyRepairObjRepairObj`, a depot that
heals the dummy chain back. The engine swap alone did not close the gap to
the bare C7p: the hook Springs also took a wheel radius off the towed
gun's carriage (fixed). After both, fall_weiss's `c7p-wz1917` makes 38.4 m at 8.6 m/s and
`C7P-wz36` 42.2 m at 8.9; eastern_blitz's absent `c7p-wz1897` still only 9.8 m (its pad
fields two variants at one spot; the audit stands the tested one up beside the other).
stashuv_area's `SdKfz7Tractor-Flak18/36` (14 m, 1.1 m/s) is wrecked by its own damage clock
during the drive (`stepVehicleDamage`, likely upside down on the slope off its pad); the same
template on prokhorovka drives 42 m and deploys clean, so that one is the level's pad, open.

Data: `mod_pipeline.py reextract --mod FHSWEurope` of 85mmAA_towedgun,
85mmAAmobile, 85mmAAmobilestatic, BoforsM1936mobile[_towedgun|static],
Flak18/36_towedgun, Flak18/36mobile[static], Flak30_Sd,Ah,51[_towedgun],
Flak30mobilestatic, M3A1-BoforsM1936, Morser18, Morser18mobile (28 files, not
published). 997 FHSWEurope models carry some round with a cleared physics word
(mostly the spotters' `Land_Spotter_Projectile`, which never flies on the page);
the level bakes' pad-placed mobile guns need the words too before their killers
ignore what stands in front of them.

## The NKL26 aerosan drove as an aeroplane (2026-10-28)

**Cause.** The Storm's `NKL26` (also in the FH and FHSW trees) is a `VCLand`
hull, mass 11700, on four `c_PGFRollGrip` ski Springs (the front pair under the
`c_PIYaw` glider bundles, +-20 degrees), and its only Engine is a pusher
propeller: `c_ETPlane`, torque 15, differential 1.9, turned 180 degrees about Y
at the tail, roll -5000..3000 on `c_PIThrottle`. It carries no `Wing`.
`seat-survey.js` `rootDriveKind` gave a `VCLand` hull its land model only for a
`c_ETCar`/`c_ETTank`, so the sled fell through to the last-Engine rule and
became `air`: the flight model, the air control profile, and the behaviour
audit's level flight, where a wingless hull fell 373 m (`air.fly`, major) and
the harness threw on the wreck.

**What retail does.** The engine has no vehicle class (`rootDriveKind`'s
header): every `c_ETPlane` pushes along its own axis at its own position with
`K` on its gearbox's revs (PHY-12, PHY-13), its water rule is bit 3 clear's
(revs zeroed under the surface, `0x0824cc89`), the springs stand the hull and a
RollGrip ski asks back only its speed along its posed axle (AIRGND-2), so the
steered pair turn the sled. `VCLand` picks the LandSea control profile (MLK-14).
No new binary reading: those rows already settle it.

**Fix.** `rootDriveKind`: a `VCLand` root with no land engine, a `c_ETPlane`,
wheel Springs and no `Wing` is `ground`. The land classes take the propeller as
`AmphibiousKit`'s air screw (`amphibious.js`): the same `VectoredEngine` thrust
the aircraft runs, only on a hull with no land engine of its own, so the idle
`c_ETPlane`s the 114 land-engined hulls below carry (CharB1's traverse engines
among them) stay as they were. The engine sound and the propeller disc follow the screw's revs
(`engineRevsOf`); `GroundVehicle` no longer drives a sled's skis off the
default engine, nor parks it on the static hold its free skis do not give.

**Census.** Every root of every tree with a `c_ETPlane` it owns: 3,857 are
`VCAir` and stay aircraft; 114 `VCLand` hulls carry one beside a land engine
(tanks, tractors, cars) and stay land; the only `VCLand` root with a plane
engine and no land engine and wheels is `NKL26`, in `fh`, `fhsw` and
`fhsweurope`. `GasExplosionVehicle` (VCLand, two Wings, no wheel) stays `air`;
the VCSea hovercraft (DC's LCAC, EoD's PACV) are untouched.

**Before / after.** `audit_behaviour.mjs --mod fhsweurope --levels the_storm
--only vehicles --vehicle '^NKL26'`: before, `air.diverges` major ("hands off,
full throttle 7 s from 70 m/s level: dy -372 m") and `harness.exception`;
after, `kind ground`, `drive TrackedVehicle`, 33 m driven at 15.5 m/s, 111
degrees of steer, 4 skis turning, engine sound 9 voices, no finding but the
FHX-31 `veh.rolls-off-pad` info. Node census (`surveys/census_ground_drive.mjs
--only '^NKL26$'`, which now takes a propeller sled): level and grounded at
rest, 21.7 m/s top, 111-120 degrees in 2.5 s of right lock from 8.9 m/s,
19.4 m/s reverse, no flag in any tree. Midway's Corsair and Zero still
`air`/`Aircraft` and fly (their two `asset.404`s are glbs missing from the
shared store, not this change). Guarded by `test_seats`
(`test_a_propeller_sled_drives_on_the_ground`) and `test_ground`
(`test_a_propeller_sled_is_pushed_along_on_its_skis`).

## Spawns on a floor under the water plane or the terrain lattice (2026-10-28)

The overnight behaviour audit, run with `8c55f5b0` in, still reported two
`spawn.not-on-ground` points: transcarpathia-1944 `river3` (892.8, 19.5,
-970.7) and trois_ponts-1944 `hill5` (344.0, 72.7, -455.5). Both soldiers
stood on a static's floor face that the body's ground ray never reached, so
the capsule's sweep held the feet on the face while `settleFeet` called him
airborne, every tick, for good (`blocked` true, `grounded` false, no fall).

* **trois_ponts `hill5`** is inside a Pak 40 trench fort
  (`SW_trench_Fort_Pak40_E_m1`): `SW_trench_tunnel_floor_s_m1`'s face is at
  71.7, the river's water plane at 72.0, the engine terrain at 70.59 and the
  tunnel ceiling at 74.2. `settle()` stood him on the water and he dropped
  0.3 m onto the floor. `groundUnder`'s ray (`world.cast`) stopped at the water
  plane, took that as "nothing underfoot", and the terrain under it was 1.1 m
  lower.
* **transcarpathia `river3`** is in a riverbank trench (`FH_hktrench_m1`),
  floor face at 19.33. The collider's terrain is its bilinear lattice,
  19.485 there, and the engine sampler (`engineSurface`, the terrain the body
  stands on) gives 18.74 on a 42-degree triangle. The ray stopped at the
  lattice, 0.15 m over the floor. That terrain answer is not a floor in the
  body (the engine sampler answers the terrain), so it saw nothing between.

Retail: the soldier's collision vertices meet a static's col faces
wherever they are (COL-6, COL-9; collision-response.md). Neither the water
plane nor the drawn lattice stands in front of them. The terrain contact is
`checkVsTerrain` against the engine's own sampler (PHY-34), here under the
floor. 0.3 m of water over his feet is far short of the 1.43 m swim entry
(PHY-11), so he stands on the tunnel floor and wades. Both are the page's
defect, not the audit's.

Fix (`viewer/soldier-resolve.js` `groundUnder`): the ray goes on through a
water or terrain hit (and the barbed-wire veto, as before) to the first face
under it, never lower than the ground already found plus 1 cm. On open
ground it still stops at the terrain, so a frame costs its four casts
(`test_a_frame_costs_four_collider_queries`).

Before / after (`audit_behaviour.mjs --only spawns --quick`):
transcarpathia-1944 9 sampled, 1 bad, then 0; trois_ponts-1944 11 sampled,
1 bad, then 0. Guard: `tests/test_soldier.py`
`test_a_floor_under_the_water_plane_is_stood_on` (a floor 0.4 m under a 1.0 m
sea, spawned on the bed and on the surface; before the fix he hung at 0.61,
ungrounded).

## FHX-46: the folding-wing Avengers flew on folded wings (2026-10-28)

The overnight audit of operation_a raised `air.diverges` on `Avenger_WingFold`
and `AvengerBomber_WingFold`: hands off at full throttle from 70 m/s level
they fell 356 and 358 m in 7 s, nose.y -0.74, 115 m/s. FHX-32's Hailstone
run had raised the same and wondered whether a folded plane is meant not to
fly. It is not meant to stay folded.

The data (`objects.rfa` `Vehicles/Air/!_PACK_USA/Compressed.con`): both
ailerons (`wingLift 2.1`, `flapLift 0.95`, the main lifting pair) hang under
`AvengerWingFoldingLeft` / `Right`, a `LandingGear` placed folded
(`setRotation -90/70/5`). Its retracted bound (`90/5/0` and `0/0/-70`,
accelerations `90/90/-90`) turns the wing square. `setGearUpHeight 0`,
`setGearUpEngineInput 0.01`: by PHY-25 the gear comes up over 0 m at revs
0.01. A parked Avenger is folded, opening the throttle on the deck spreads
it in 7.5 s (90 degrees of yaw at 12 deg/s), and nothing folds it again. The
plain `Avenger` has the same ailerons straight on the root. Spread, the
folding one's aileron is that aileron to 2e-6 degrees.

Retail (AIRGND-10, read this round): `Wing::handleUpdate` copies the Wing's
absolute transformation into its PhysicsWing every tick, and
`PhysicsWing::updatePhysics` lifts along that copy's row 1. The lift turns
with every parent's pose. The lift point is PHY-28's and does not move with
the fold. So this was the page's defect, two of them:

* `aircraftSpec` read each Wing's mount once at the rest pose, which is the
  folded one, so the main lift pushed 112 degrees off where it should.
* every LandingGear rode the first gear's lever, here the legs (26 m, revs
  0.95). On an 18 m deck the legs stay down, so the wings stayed folded.

Fix (`viewer/aircraft.js`): `gears` gives one channel per distinct gear law
(`c_PILandingGear:<n>` past the first; `vehicle-base.js` `isGearInput`) and
`autoGear` runs each one. `posedMountOf` records the rest rotations down to
each turning part above a Wing. `Aircraft.poseSurfaces` poses the Wing every
tick after the servos, with its lift point the parent's position plus its
own translation.

Census (every tree's glbs): Wings under a turning part are the four FHSW /
FHSWEurope Avenger WingFold variants (and the Blueranger, GambierBay and
Independence trees that nest them), the FM-2 / FM-2ASW flaps (a LandingGear
at -34 degrees below 79 m and revs 0.85: they now lift 34 degrees drooped
on takeoff, and the FM-2 leaves an 18 m deck at 27 m/s, not 30), the inert
DC AV-8 rack aileron, the FHSWEurope `Remote*` glide bombs' tail Wings on
`c_PIAltFire` and the FHSW Valentine rocket's fins. `B6N_WingFold` folds
only drawn ailerons; its lifting Wings hang on the root, so it flew already.
FH ships no WingFold. Vanilla's Midway Corsair has no fold; it is the
harness's `CORSAIR`, and every existing flight test passes unchanged.

Gear channels move other parts too, now on their own retail law: the
Avenger's bay doors open at revs 0.6 (`0/10000/0.6/10`) instead of with the
legs, and gear doors whose revs differ from the legs' by 0.05 keep their own
byte.

Node (`tests/flight_harness.mjs`, the real glbs): off an 18 m deck at full
throttle, 12 s roll and 4 s of back stick, the plain Avenger climbs to 86.0 m
and the folding one to 84.6 m (before: 30 m, folded lift). Then hands off at
70 m/s and 500 m for 7 s, both are at dy +32 m, nose.y -0.05.
Guard: `tests/test_flight.py`
`test_a_folding_wing_spreads_on_its_own_gear_and_lifts_as_it_is_posed`.

Before / after (`audit_behaviour.mjs --mod fhsweurope --levels operation_a
--only vehicles --vehicle WingFold`): `Avenger_WingFold` level flight dy -356 m,
nose.y -0.74, 115 m/s, then dy -17 m, nose.y +0.03, 94 m/s.
`AvengerBomber_WingFold` went from -358 / -0.74 to -18 / +0.03. Both now
have no `air.*` finding, and their stick, roll and rudder probes answer the
right way. The same run's `B6N_WingFold` `veh.wreck-falls-through` (minor,
the wreck settles 13.4 m under its pad on the carrier) is a wreck-placement
question, not a flight one, and is left open.


## Three reports from Operation Spring Awakening: the tent, the horse's Use, a horse under a net (2026-10-28)

The section above carried three things seen on the way, all on
operation_springawakening. Each was checked against the lab's server (scenario
`agtent-springawakening`, FHSW's copy of the level, run
`20261028-020859-agtent-springawakening`, server recordings; the sidecar walked
by waypoints, not by the `veh_law_probe` detour walker) and on the page.

* **The Axis soldier inside the tent walks out through its door, in retail and
  on the page.** `axis_base1_spawn2` stands him 1.0 m inside `BigTent_m1`. The
  tent's soldier collision is double-walled (every wall a face each way, 144
  triangles), so from inside the engine's one-sided narrow phase meets the
  canvas as surely as from outside (ledger COL-23), and the earlier sidecar,
  which walked straight at a horse behind the tent and turned 90 degrees when
  stuck, never found the door: that was the "tent he cannot walk out of". The
  door is 1.4 m wide and 1.9 m high in the tent's -Z end. Retail: from the
  spawn to the door and 4 m out in 2.5 s (the sidecar's waypoints
  `324.59,1711.48; 323.72,1710.52; 322.9,1709.6`, wire frame). The page
  (FHSWEurope tree, `__teleport` to the point, the same waypoints): out, at
  (322.97, -1709.68). Nothing to fix. Guard: `tests/test_tent_walkout.py`
  (the baked mesh in `tests/fixtures/bigtent_m1_col1.json`, the real soldier
  and collider: out through the door, held inside by the back and side
  walls).
* **The Nagant refused Use from 1.3 m because the door is at the horse's nose,
  and retail refuses there too.** `HorseEntry` is a metre ahead of the root at
  its height, `setEntryRadius 2.3`, measured from the soldier's origin (a metre
  over his feet, ledger SEAT-32). Behind the rump, 1.35 m from the root, the
  door is 2.42 m away. Retail (the village horse, `Cavalry_Nagant` at
  1105.92, 78.29, 1641.23 wire, facing 179 deg): beside the rump (1.83 m from
  the root, 2.65 m from the door) four presses refused; beside the saddle
  (1.87 m from the root, 1.71 m from the door) the first press seated him. The
  page offers the door at exactly the same spots (`__nearEntry`: null, null,
  Cavalry_Nagant). Nothing to fix. Guard: `tests/test_vehicle_entry_reach.py`
  `test_a_horse_is_mounted_where_the_lab_server_seated_and_refused`.
* **The horse under the camouflage net: not the two-sided face rule, and only
  partly fixed.** The net was FHSW's `greencammo_m1` (an SU85 parks under the
  one at 411.9, -1707.8): four 0.4 m poles (material 85) and a canopy whose
  side skirts run from the 4.2 m roof down to the ground (material 90), every
  surface a face each way. Measured on the page (`StaticIndex.castAmong`
  wrapped, the hit face's stored winding read against the ray): every face the
  horse's probes met was a front face by the engine's rule, and with the
  one-sided test emulated the horse rolled as far (84 against 85 deg). The
  binary says the same faces count: `checkFaceAndEdgeCollision` is one-sided
  by the stored normal and `checkObjectVsObject` drops a material-90 face only
  for a projectile (ledger COL-23). So `body-statics.js` divergence 1 was not
  the cause (its comment now says so, and that the bake's winding is
  consistent after all).
  **What does differ, A/B against retail on one track.** The lab's horse
  (`Cavalry_K98` from the uma3 pad, W held, 11 m/s) galloped past net 3
  (395.8, -1723.0), its root 3.7 to 4.5 m off the net's axis, with roll under
  0.6 deg and no deflection; down the middle of the tunnel, under 0.9 deg.
  Placed on retail's first track at retail's speed, the page's horse brushed
  the outer skirt with its left side spring (`HorseEngineSpring`, 1 m out and
  0.3 m down: 432 contacts) and rolled 14 deg; down the tunnel 2.7 deg. The
  spring's static push was taken instead of its terrain push whenever it was
  the deeper (`tracked-vehicle.js`, `suspension.js` `staticSpringContact`), so
  brushing a wall took the ground from under that side. The engine posts both
  contacts on the wheel's one response, merges them per axis (`setAdjust`) and
  moves the wheel along their mean normal (collision-response.md 6.3, 6.4):
  built (`suspension.js` `mergeWheelPush`, used by both laws when the wheel is
  also on the ground; off the ground the static push stands alone as before;
  `tests/test_static_spring_merge.py`). After: 9 deg on retail's track (14
  before), 2.0 in the tunnel (2.7), and the head-on corner case that started
  this still rolls (75 deg against 85). Still open, and the likely rest of it:
  the bake keeps a mesh's last collision layer for vehicle parts as for
  statics (`assemble.py` `_collision_mesh_indices`), so the page probes the
  horse's springs with `Horse_wheel_m1`'s col1, a 3-vertex point, where the
  engine takes col0 vertices (collision-response.md 5.4): a 16-vertex 0.4 m
  disc. Vanilla, origin against the merge (Kursk's `greencammo_m1`, 8 m/s):
  a Willy down the middle unchanged (no contact, roll 11.7 and 11.6 deg from
  the placement); a Willy 2.8 m off the axis held at the pole both ways
  (5 deg); a T34 2.8 m off held at the net before and through it after (135
  contacts, then 4), which no lab run has checked. A Sherman driven at
  Bocage's stone bridge dropped into the stream bed under it both ways and
  wedged there (orig 93 contacts, 71 of them on faces the engine would cull;
  after 21): no clean comparison, and a case for the one-sided rule.
## FHX-47: HellcatFB's dive is the engine's thrust line (2026-10-28)

The overnight operation_kikusui_day1 run raised `air.diverges` on `HellcatFB`
(dy -271 m, nose.y -0.47, 120 m/s). The same run listed
`AvengerBomber_WingFold`, which is FHX-46 and fixed. The Hellcat is a
different case: no Wing hangs under a turning part. Its engine
(`HellcatEngine`, `setPosition 0/0.5612/3.9178`) sits 0.56 m above the root,
and nothing sets a centre of mass offset. `PhysicsEngine::updatePhysics`
pushes the thrust on the root at the engine's absolute position (PHY-12,
the arm PHY-21), so at full throttle the nose goes down. The plain
`Hellcat`, `Hellcat20mm` and `Hellcat_CP` share the 9400 kg body and the
engine, and all four dive alike in node: dy -208 m over the 7 s.

To check the cause, the same flight was run in node with the engine moved
onto the thrust line: it falls 82 m, the same order as the SBD and the SB2C
(-110 m). So the dive is retail behaviour. The four templates are accepted
as `air.diverges` / retail_faithful in `audit_behaviour_accepted.json`.

## Ship round selectors dead afloat; carrier-deck wrecks fell into the sea (2026-10-28)

**`veh.selector-dead` (major), battle_of_off_malay.** The Hamakaze's front gun
rolls `HamakazeCannon_Invis_GunSelector` (-180..0) and its HUD needle
`Shipgun_AmmoNeedle_Rot` (-90..0) on the arrows (`c_PIPitch`, not
`setAutomaticReset`, held per GUN-2); the HMS_Laforey's has two selectors and
a needle the same way. All of them belong to the ship's root seat, whose rig
leaves its levers to the drive (`vehicle-occupancy.js` `rigFor`). Since the
ship tick law (f287d446, 2026-10-23) the drive afloat is `ship.js`
`#integrateLaw`, and `shipTick` turns only the Engine's and the rudders' law
registers: `advanceSurfaces` ran only on the beaching model, so no part on a
key moved while a ship floated. The extracted data was right; nothing needed
re-extracting or publishing.

Fix: `#integrateLaw` runs `advanceSurfaces(SHIP_TICK)` once a law tick (a
tick handed to the beaching model already runs it in its sub-steps). The law
reads none of what it writes, so the hull's motion is unchanged
(`test_ship_law` still within a millimetre of the lab Daihatsu).

The same gap held every held key part on every floating ship's own seat.
Census of the model glbs (ship controls: `VCSea` with a `c_ETShip` Engine,
mobile; parts: a RotationalBundle on a key channel, not reset, not free):

| Tree | Ship controls with held key parts | With a round selector or needle | Parts by kind |
|---|---|---|---|
| fhsweurope | 191 | 132 | 378 selector/needle, 78 ramp, 49 other (LCT wheels, plane launchers) |
| fhsw | 139 | 91 | 260 selector/needle, 64 ramp, 42 other |
| fh | 11 | 0 | 12 ramps |
| eod | 4 | 0 | 5 ramps |
| bf1942, xpack1, xpack2, desertcombat, dc_final | 1 to 3 each | 0 | the LCVP and Daihatsu ramps |
| bf1918, gcmod, interstate, pirates | 0 | 0 | |

So vanilla's LCVP ramp and Daihatsu ramps were frozen afloat too.

Before / after (`audit_behaviour.mjs --mod fhsweurope --levels
battle_of_off_malay --only vehicles --vehicle '^(Hamakaze|HMS_Laforey)$'`):
two `veh.selector-dead`, then none; ArrowDown turns needle and selectors 90
and 180 degrees and they hold on release, ArrowUp brings them back. In the
page the selection moves the round: at rest `HamakazeGun_APHE` points along
the barrel (forward y 0) and `HamakazeGun_AA` into the sea (-0.95); after
ArrowDown the two swap, after ArrowUp they swap back. Guard:
`tests/test_ship_held_axis.py` (the lab Daihatsu's hull with the Hamakaze's
two parts, on the law throughout: the arrow rolls them and release holds,
the other arrow brings them back, the hull's track is identical with and
without them).

**`veh.wreck-falls-through` (minor), operation_a and
operation_kikusui_day1.** A plane killed parked on a carrier deck was taken
for one killed in the air: `vehicle-wrecks.js` `fallingDriveFor` measured
its height over the terrain and the sea only, read the B6N on the Shokaku as
13 m up, and put it on the wreck list, which forces a minimum sink each tick;
it went through the deck and stopped in the sea. Retail's wreck is the same
body and still meets the ship's deck. Fix: `surfaceUnder` takes the drive's
own floor as well, the deck its wheels stand on (`hull-bodies.js`
`aircraftOnShipDecks`, a ray reaching a few metres under the hull), for both
the airborne test and the landing test. A plane killed on the deck burns
where it stands; one shot down over the carrier crashes on the deck.

Before / after (`--levels operation_a --vehicle '^(B6N_WingFold|A6M5c)$'`):
`B6N_WingFold` 13.4 m and `A6M5c` 12.6 m under the spawn, then no finding.
`HellcatFB` on operation_kikusui_day1 (18.2 m in the coordinator's run) did
not fall in either of this run's before and after; it is the same path.
Guard: `tests/test_vehicle_wrecks.py`
`test_a_plane_killed_on_a_carrier_deck_burns_where_it_stands`,
`test_a_plane_shot_down_onto_a_carrier_deck_crashes_on_it`.

Open: the chosen round's FireArms sits 25 m under the visible gun (the
`Invis` rig, as item 12's Flak); which node the page spawns the round from
was not changed here. A wreck frozen on a deck does not ride a carrier that
then moves.


## Wake's A6M2b wrecked 8 s after boarding (2026-10-28)

Reported by the audio agent (vehicle-sound-coverage D18): on Wake the `A6M2b`
at the airfield's fighter pads was a wreck about 8 s after the tester sat in
it, standing still, on every run (`audit_behaviour.mjs --mod fhsweurope
--levels wake --only vehicles --vehicle '^A6M2b$'`).

**Cause.** One terrain contact, not a damage area. Per-tick instrumenting of
the hull's Armor and of `BodyWorld.#drivenTerrainDamage` showed a single
`onBodyDamage` of 108.4 of its 120 HP on the first driven tick, then
`hpLostWhileCriticalDamage` 1.5 a second to 0. The pads are the F4F-3's
(`fighterspawner`, `fighterspawner2`: team 1 `a6m2b`, team 2 `f4f-3`), posed
14.4 degrees nose-up for the Wildcat. Stood at that pose the A6M2b's tail is
1.9 m in the ground. Retail stands a pad's hull at the spawner's pose and the
terrain lifts it out (SPAWN-28), and the page's load settle does the same for
the pad's other-side hull (`settlePlacedVehicles`): it lifts the A6M2b out
and rests it on its three wheels. But the A6M2b never goes to sleep on them.
Its velocity flips sign every tick, +-0.37 m/s, with 0.06 m/s net. The F4F-3
on the same pad sleeps at 4 s. `settleBodies` judged rest on the last tick's
velocity alone, so it called the A6M2b still moving and kept the spawner's
pose, with the tail buried. Boarding handed that pose to the aircraft drive,
which has no hull push-out from the terrain, only its springs. The springs
lifted the fuselage out at 3 m/s with its col0 vertices still under the
ground, and the contact damage (`speedMod` 2.0, `|c|^3 V^2`) billed 108 HP.
None of the other suspects applies. Nothing on the pad is water, a kill zone,
a depot, the combat area or a static, and the hull was upright.

**Fix.** `body-world.js` `settleBodies` / `atRest` judges standing over the
last second as well (`REST_WINDOW_TICKS` 30). A hull that is upright (up row
`>= 0.7`) and has moved under 0.1 m/s net and turned under 0.1 rad/s net
over that second is at rest, however fast its last tick was. A hull that
fell on its side still keeps the level's pose: Karelia's second Katyusha,
27.9 m up at its spawner, chatters on its side on the ground. Guard:
`tests/test_vehicle_bodies.py` `test_a_settle_hands_back_only_the_bodies_that_came_to_rest`,
where a chattering body is handed back and one chattering at 0.5 m/s net is
not. The test fails on the old rule.

**Measured.** Before, every run (`/tmp/claude-1000/ar/a6-natural-after-1.json`
and three instrumented runs): hull 0/120, pilot dead in his seat, harness
exception. After (`/tmp/claude-1000/a6m2b-after.json`): no finding, a 61 m
ground roll with no damage, and the flight checks pass. A node settle of
the pad (the page's own body world): the hull rests 0.97 m above the
spawner, upright (up 0.99), lowest col0 vertex +0.25 m.

**Blast radius.** A census ran every placed hull and pad variant through the
page's settle on the 228 locally present levels of the exported trees.
Most fhsweurope levels are evicted to the volume and were not run. 185 hulls
moved from "kept the level's pose" to "settled", and none moved the other
way: fhsweurope 132, dc_final 27, desertcombat 10, eod 8, fh 4, vanilla 3,
xpack2 1. The A6M2b is among them on fht_pasir_panjang-1942 (it rose 1.8 m)
and both Wake pads. So is FH tarawa's Zero, with Panthers, Tigers, KV1s and
Mi8s. Most are tanks and planes that chatter on their springs. Two had a
col0 vertex more than 0.3 m under the ground at the level's pose, and 20
hovered more than 1.5 m over it. Twelve end more than 5 m from their
spawner, which needs a look. Among them are DC el_alamein's F16 (slid
19.6 m), soletschnogorsk's three stacked `KV1spawnpanzer*` (6.2 m, pushed
apart by their twins on the same spots) and hokkaido's T-29-95 and KV85
(7 m). Full list: `/tmp/claude-1000/settle-census-2026-10-28.txt`.

**Open.** Two items, both closed the same day ("The A6M2b's two open items", below). First, why an A6M2b chatters on its springs where an
F4F-3 sleeps. The chatter is in the parked body and in the driven ground
law (+-0.4 m/s a tick, for as long as it is parked). Second, a driven
aircraft has no hull push-out from the terrain (`#drivenTerrainDamage` bills
the damage half only). Any other way a plane comes to be boarded with its
hull in the ground still costs it the same scrape.

## Where a selector gun's round starts: `projectilePosition` beside the barrels (2026-10-28)

The open note of "Ship round selectors dead afloat" above, measured. The chosen round's FireArms does hang 25 m
under the drawn gun, and the `.con` lifts the round back to the barrel with
`projectilePosition`; the page dropped that offset on every gun that also
declares `addFireArmsPosition` barrels, so the chosen round left 25 to 26 m
under the gun. Fixed in the page; no extracted data changed.

**Retail.** `FireArms::fireBarrel` (lnxded `0x0828aba0`, ledger XHIT-16)
puts the round at the launch matrix's position plus `projectilePosition +
barrel[i].position`, summed raw at `0x0828b093` (`tmpl+0x204..0x20c` plus
`tmpl[+0x210] + i*12`), on the rows of the barrel's turn times the matrix. A
gun with no barrels (index -1) adds `projectilePosition` alone. The
Hamakaze's two hidden guns declare two barrels at `±0.4/0/5.9` and
`projectilePosition 0/26/1`; its drawn `HamakazeGun_Dummy` (which fires
`ChangeAmmo_FakeProjectile` for the flash) declares `0/1/1` on the same
barrels. So the engine starts the chosen round at the dummy's own launch
point, 1 m over and 1 m ahead of the drawn muzzle, and the other one 26 m
the other way from a FireArms 25 m down: about 40 m under the gun, where its
`BulletCatcher25m` sits. No "invisible gun placed back by a parent" is
involved; the rig in the glb is the `.con`'s.

**The page before.** The exporter writes each barrel as a muzzle node and
carries `projectilePosition` beside the barrels (`fireArms.
projectilePosition`) when a gun declares both, since 4f77bc6e. Nothing in
the viewer read it: `round-launch.js` launched from the muzzle node,
`gun-groups.js` `cameraLaunch` from the camera plus the barrel offset, and
`replay-hulls.js` `recordedLaunch` from the recorded matrix plus the barrel
offset. All three also put the barrel offset on the untouched frame rather
than the barrel's turned one.

**Measured in the page** (`map.html?mod=fhsweurope&map=battle_of_off_malay`,
team 1, the Hamakaze's own seat, `__getFire().inFlight[].origin`, which this
change adds; world metres):

| Selector | Drawn muzzle (Dummy) | Chosen gun's muzzle node (the launch before) | Chosen round's start (after) | Other round's start (after) |
|---|---|---|---|---|
| rest: APHE | 7972.42, 96.36, -628.14 | 7972.42, 71.36, -628.14 (25.0 m under) | 7971.72, 97.36, -628.85, 460 m/s level | AA: in the sea before the first sample (0.17 s) |
| ArrowDown: AA | same | 7972.42, 71.36, -628.14 | 7971.72, 97.36, -628.85, 859 m/s level | APHE from 7992.01, 56.77, -607.43, down at -439 |
| ArrowUp: APHE | same | same as rest | same as rest | AA from 7992.01, 56.77, -607.43, 859 m/s, down at -812 |

The chosen round now starts exactly where the dummy's flash round does
(both 7971.72, 97.36, -628.85 for barrel 1, 7971.15, 97.36, -628.28 for
barrel 2). The Flak 18/36 (`Flak18_36.glb`) declares no barrels: its one
muzzle node is `projectilePosition 0/19.963/2.367` under a selector 20 m
down, so its launch point was already the engine's and did not move. That
point is 1.98 m behind the drawn barrel's muzzle, inside the barrel, in
retail too (`tests/test_barrel_launch.py` measures it off the glb).

The same probe on `desert_rose-1942`'s `Flak18/36NoShield` (team 2, the pad
at 1609.9, 26.7, -1272.9; same rig, `Flak1836Gun*` once baked):

| Selector | Drawn barrel's flash round starts | Chosen round starts | Other round starts |
|---|---|---|---|
| rest: AP | 1606.52, 28.21, -1269.99 | AP 1607.91, 28.21, -1271.40, 405 m/s along the barrel | AA 1623.87, 2.73, -1286.46, 633 m/s down at -624 |
| S: AA | same | AA from the AP's point, 633 m/s along the barrel | AP from 1623.87, 2.73, -1286.46, down at -400 |
| W: AP | same | as rest | as rest |

The chosen round starts 1.98 m behind the flash, on the barrel's line, as
the glb says, and did not move with this change.

**Census.** 4,388 FireArms in the model trees carry both (fhsweurope 2,084,
fhsw 1,695, fh 198, eod 93, desertcombat and dc_final 141, xpack1 and
xpack2 61, vanilla 26); 833 of them by more than 5 m. Vanilla's: the Yamato
main battery (`projectilePosition 0/0/-14` beside a barrel at `0/0/14.5`, so
the round leaves 0.5 m ahead of the FireArms and the page launched it 14 m
further on), the Prince of Wales' 16 m pipes, the Type VIIC's torpedo tubes
(10 m), the PT boats' torpedoes (3.6 m), every fighter's guns (2 to 2.5 m)
and the dive bombers' racks (0.35 to 1 m). FHSW's radio-called artillery
(`Radio*_GunBarrel`, `0/50/200`: the shell appears 50 m up and 200 m out)
and the KM ships' 10.5 cm selectors (`0/41/-50`) are the same law.

**Fix.** `round-launch.js` `barrelLaunch` (the launch point off a gun's own
muzzle node: the FireArms' position plus the muzzle's world turn applied to
barrel offset + `projectilePosition`), used by `muzzleVelocity`;
`gun-groups.js` `cameraLaunch` adds `projectilePosition` and puts both
offsets on the turned frame; `replay-hulls.js` `recordedLaunch` adds it to a
recorded round (the recorder writes `fireBarrel`'s matrix argument, before
the engine adds either offset: features/server-replay-recorder
`write_fire`). Guard: `tests/test_barrel_launch.py` (synthetic Yamato, a
turned barrel, a barrel-less gun, the camera path, a recorded round, and the
Hamakaze and Flak glbs with the selector at both ends);
`tests/test_bomb_release.py` now expects the Stuka rack's bombs 0.4 m lower
and 0.2 m aft.

~~Still open: the round of the gun not chosen flies 40 m down into the sea or
the ground and, for the AA shells, bursts on its timer far below.~~ Fixed the
same day: the page's rounds now meet their own hull's catcher ("The unchosen
round meets its own catcher" below).

## The A6M2b's two open items, and the census's twelve far hulls (2026-10-28)

Follow-ups to the section above.

**Why the A6M2b chatters: retail's own springs, so it stays.** Both planes
stand on three k 24 / c 12 RollGripWhenOccupied springs; the A6M2b's
`inertiaModifier 0.4/0.6/1` (COL-13: 0.4 on pitch) over its box leaves the
damper's heave-and-pitch mode over-correcting every tick, where the F4F-3's
0.76 lets it sleep at 4 s. The lab measured retail's: fht_pasir_panjang-1942
Conquest, no bots, the axis base's parked A6M2b watched for 4.5 minutes
(`lab/scenarios/fhsweurope-pasir_panjang-cq-zero.json`,
`lab/veh_law_probe.mjs HOSTS=A6M2b`). The server never puts it to sleep:
a ghost state every tick or two, its height flipping by 14 mm, and a creep of
2.9 m and 22 degrees of heading. The page's body law from the same spawner
chatters the same way at the server's height to 3 cm. Ledger AIRGND-11; the
page keeps the law and the load settle's net-movement rule (above). Open:
the page creeps 1.8 m and 1 degree where the server creeps 2.9 m and 22.
Detail: [aircraft-ground-law](../aircraft-ground-law/README.md), 2026-10-28.

**A driven aircraft's hull now meets the terrain** (AIRGND-12). It is pushed
out by each mobile part, the closing speed is taken off through the next
root step, and its friction and damage are taken in the same pass, as for
any hull. A plane handed to its drive with its col0 vertices under the
ground is first stood out of it at rest
(`BodyWorld.standDrivenOut`, from `adoptDrivenBody`). Retail's collision
pass would have lifted it the tick after its spawner placed it. Measured with
the settle's old last-tick rule put back by hand, which boards Wake's A6M2b
with its tail 1.9 m in the ground: before, hull 0/120 at 8 s and the pilot
dead in his seat. With the push-out alone, still a wreck at 8.1 s: the
drive's first tick sprang the buried hull up before the body world's pass
reached it. With the boarding stand-out as well, the A6M2b rolls 64.6 m,
climbs to 470 m and flies level.
With the rule as it is now (`audit_behaviour.mjs --mod fhsweurope --levels
wake --only vehicles --vehicle '^(A6M2b|F4F-3)$'`, 2026-10-28): the A6M2b
rolls 62.2 m and flies, the F4F-3 42 m, the same as origin/main's run. One
run billed the F4F-3 1 HP in its ground roll (`air.roll-damaged`); a
second run alone did not.

**The census's twelve hulls more than 5 m from their spawner were the
census's.** It settled every game mode's vehicles in one world; the page
(`level-load.js` `pruneToMode`) and the play server (`server/level-data.mjs`)
drop the other modes' first. Soletschnogorsk's `KV1spawnpanzer1..3` are the
SinglePlayer copies of Conquest's `KV1_spawnpanzer1..3` on the same three
spawners, and the two sets pushed each other 6.2 m. Hokkaido's T-29-95 and
KV85, Breakthrough's HurricaneMKIID, Prokhorovka's StuG3G, DC El Alamein's
F16, and DC Final's Mig29, UH-60, Humvee and BRDM2 the same: on the same
eight levels with the mode pruned, none settles more than 3 m from its
spawner horizontally, in Conquest or in co-op. Re-run over all 228 local
levels with the mode pruned (Conquest), 78 hulls move from "kept the level's
pose" to "settled" (not 185) and none of them more than 3 m; co-op, 68 and
none. Nothing to fix on the page; DC and DC Final were measured only.
Outside this question, the pruned census still shows hulls the OLD rule
settles far from their spawners (a pad variant on Bizerte and two on Mareth
Line dropping 18-20 m, Way to Paris's AMX13 rising 36 m out of a buried
spawner), which 2628ca8b did not change.


## The unchosen round meets its own catcher (2026-10-28)

The open note above, fixed. Retail tests a round against every part of every
hull, its firer's own included; the only firer test is FF-1's, for his
soldier (ledger COL-24, read in `checkObjectVsObjects` `0x0825d820`,
`PointResponsePhysics::checkObjectVsObject` `0x08257030` and
`Projectile::handleCollision` `0x0831ee80`). So the round of the selector gun
not chosen, which starts about 40 m under the drawn gun, meets the hull's own
`BulletCatcher_new` cubes there. The page skips the firer's hull outright,
because its muzzles start inside it and it tests faces two-sided where
retail's are one-sided (COL-23), so that round went on to the sea floor.

**Fix.** `static-index.js` `cast` takes `ownHits`, a collision-group mask
whose parts of the skipped owner are still tested, and with `ownOnly` an
`onlyOwner` query tests those parts alone; `world-collider.js` `cast` and
`castMoved` pass it through, so a ship driven off its bake (a moved owner)
keeps its catcher. `projectile-flight.js` passes `CG_OWN_CATCHERS`
(`c_CGLandscape`) for a round's sweep and a fuse round's probe. No part a
hull stands or is struck on is in `c_CGLandscape`; FH's and FHSW's catchers
are (`collisionGroups` `bulletcatcher_new: 3` in all 140 FHSW and 275 FHSWEurope level bakes). A round
still never meets the rest of its own hull. The hit record's `owner` equals
its `firer` only for such a catch.

**Measured** (`map.html?mod=fhsweurope&map=battle_of_off_malay&mode=ObjectiveMode`,
team 1, the Hamakaze's own seat, both barrels of the front gun fired once;
before is origin/main `e6227638`, after is this change):

| Selector | Round | Before | After |
|---|---|---|---|
| rest | AA (not chosen), from 7992.0, 56.8, -607.4 | down 57 m to the sea floor (y 0) at 7979.6, -619.7, `e_ExplMedRocket` there | meets `BulletCatcher_new` 0.5 m under its start, owner the Hamakaze, no effect, damage 0 |
| rest | APHE (chosen), from 7971.7, 97.4, -628.8 | water at about 450 m, `e_waterImpactLarge` | the same |
| ArrowDown | APHE (not chosen), from 7992.0, 56.8, -607.4 | the sea floor at 7978.3, -620.6, `e_ExploLarge` | caught 0.5 m under its start, damage 0 |
| ArrowDown | AA (chosen) | water at about 500 m | the same |

The Hamakaze kept its 2460 hit points both ways: the catch costs the hull
nothing on this table (the AA and APHE shells against the catcher's
material). Guard: `tests/test_own_catcher.py` (`own_catcher_harness.mjs`: the
unchosen round stops in its own catcher and in no other own part, another
hull's round meets both, and a driven hull carries its catcher).

### The Yamato page run on vanilla Midway: not reproduced

The agent note said the browser tab crashed right after boarding the Yamato
(the scratch `muz_probe.mjs`, 2026-10-28 09:13: "Target page, context or
browser has been closed" on the first read after boarding). Run again on
this tree, under the chromium lock, nothing crashed:

- the same `muz_probe.mjs` twice, on vanilla Midway Conquest (the Yamato,
  all three salvos at rest, after ArrowDown and after ArrowUp, 5 rounds each);
- `audit_behaviour.mjs --mod bf1942 --levels Midway --gametype Conquest
  --only vehicles --vehicle '^Yamato'`: all four seats yawed, pitched and
  fired (10, 4, 75 and 60 shots, at most 18 rounds in flight). Without
  `--gametype` the run takes Midway's CoOp layer, which places no Yamato, so
  it tests no vehicle;
- a stress run holding both triggers of every seat for 6 s each: the JS heap
  stayed between 112 and 154 MB, 237 geometries and 511 textures, at most 20
  rounds in flight.

The rounds' launch change (`c2526987`) moves the main battery's start 14 m
back and changes no count of rounds or effects. Nothing was found to fix.
The 09:13 run shared the machine with a lab server, a sidecar and other
sessions' headless browsers.

## Load-settle outliers: Bizerte, Mareth Line, Way to Paris (2026-10-28)

Follow-up to "The A6M2b's two open items, and the census's twelve far hulls"
above: the hulls the pruned census still settled far
from their spawners. Census in node, the page's own settle over the room
server's level load (`level-load.js` `pruneToMode`, `loadPadVariants`, then
`hull-bodies.js` `settleSome`'s rule per group), every hull of all 121 local
FHSWEurope levels, before (origin/main) and after.

**Mareth Line and Bizerte: the body world's terrain normal pushed hulls off
the quay.** Mareth's `jeeps` pad (osId 5, Willy or KubelwagenDAK) stands on
a dead-flat cell 4.3 m from a 21 m quay wall (`Berlin_waterwall2_M1`).
`body-pose.js` `bodyTerrain` read the bilinear height with
`Heightfield.normal`, a central difference over two cells, so at the pad the
normal took in the wall: `(0.85, 0.52, 0)`, 58 degrees off vertical on
ground that is flat to the millimetre. The first tick's contact pushed the
jeep 0.11 m towards the wall and it rolled, accelerating, off the edge at
tick 70 and came to rest 20.4 m down and 26.7 m out in the harbour (the
Kubelwagen 31 m). Bizerte's `truck` pad (osId 6, SPA38R or GMC) is the same:
2 m from the quay edge beside the moored `StaticDithmarschen`; the GMC
settled 18.6 m down, and the SPA38R, still moving at 10 s, kept the pad's
pose only because the settle gives up on a hull that never rests.
Retail's `ResponsePhysics::checkVsTerrain` asks
`PatchTerrain::getHeightAndNormal` (`0x0825a960` calls the terrain's vtable
`+0x54`, which is `0x083d6f10`): the triangle's plane and its face normal
(TERR-16), flat on a flat cell. **Fix**: `bodyTerrain` and
`vehicle-bodies.js` `staticFloorTerrain` read `Heightfield.engineSurface`, as
the driven tank's and aircraft's springs and the walking soldier already did.
Both quay hulls now rest 0.04 to 0.25 m from their pads. Across the tree the
same normal had settled five more hulls 5 to 37 m from their pads: Breaking
Point's Somua S35 and Panzer 38(t) (23 m out, 28.6 m down), Coronet's GMC,
Type2_Keto and Type94 twin AA; they rest within 0.1 m now. Nine more that
never came to rest, and so stood at their pads' poses, now rest on them
(Helsinki's GAZ-AA, Remagen's Priest, Cretan Village's Bedford, Hong Kong's
LightAA_MkI, Trois Ponts' PantherCapt_D, Berlin outskirts' JagdpanzerSkirt,
Coronet's Ho-Ri2 and Chi-ha, Beginning of the End's Lowe).

**Way to Paris: retail's own.** The AMX13 is the fourth `armedUC_Spawner`
of both layers' `ObjectSpawns.con`, whose position line is
`Object.absolutePosition825.06/47.37/1067.69`, with no space. The console
reads the first word up to whitespace, so the word is the whole line,
`Object` + `absolutePosition825.06/...` is no console object, and the line
is dropped (CON-19, new; CON-11). Nothing else places the spawner, so it
stays where `Object.create` made it, an identity transform: the world's
origin, rotated 135 by the next line. Its hull stands 36.9 m under the
terrain at the map's corner and the terrain lifts it out (SPAWN-28). The
exporter already reads the line this way (`bf42/level.py`
`parse_static_objects`). FHSW's own Way to Paris carries the same line;
no other level of FHSWEurope, FHSW, FH, vanilla, the two packs, DC, DC Final
or EoD does. The page's AMX13 now ends upright on the corner's ground 10.4 m
from the origin (5.4 before; the other side's PTRSDPCarrier never rests and
keeps the spawner's pose, as before with a 36 m fall still to come).

**Hulls placed a little over a static fell through it.** The rule that
holds a hull on a static (`vehicle-bodies.js` `standsOnAStatic`) asked for
three of its twelve lowest col0 vertices within 0.75 m of a static's top;
one placed higher fell through to the terrain in the terrain-only settle
world. Ural Mountains' IS4 and IS3_D-30 stand 1.0 m over `hangar1_m1`'s
floor and dropped 40.2 m to the terrain under it; The Great Pursuit's
KingtigerP 0.9 m over `Hang_Bridge_M1` dropped 17.8 m to the river bed and
its ba64_sp80 5.8 m. In retail the hull's col0 meets the static's faces as
it falls (collision-response.md section 5). **Fix**: `dropsOntoAStatic`
(the same three of twelve within 1.5 m, `STANDS_ON_A_STATIC`) lets such a
hull down onto the static alone, as a hull sunk into a level floor already
was (`static-settle.js` `letDown`). The same rule now stands 16 planes and
tanks on the runway slabs and pads they were placed 0.6 to 2.2 m over,
where they had sunk through them to the ground: FHSWEurope Invasion of USA's XP72,
P51D-b, P51H and AT17SP69, Prokhorovka's Ju87G, Gazaps' Valentine, Moscow
outskirts' KV1 (FHSW's too), vanilla Battle of Britain's two BF109s, FH Iwo
Jima's N1K1s and Tarawa's Zero, DC Battle of the Bulge's Humvee_Tow, DC
Final Battle of Britain's SU-25, FHSW Bombing the Reich's Bf109-K6.

**The room server settled static roots.** Its `server/level-bodies.mjs`
`bodySpecFor` left out ships alone; the page's also leaves out a root
whose `hasMobilePhysics` is clear (PHY-17). In the room's settle Earned in
Blood's `killerCage_RemoverAllies` (a supply dummy with a cockpit hull and
no wheels) tumbled 12 m up out of its pad and, with the new terrain, shoved
the T34-85 beside it 33 m. It is left out now, as on the page (967 such
roots across FHSWEurope's levels, 64 in FHSW's, 25 in FH's).

Before and after, every hull of the local trees (`settled` far = more than
3 m from its pad horizontally or vertically; vertical drops from pads in
the air and lifts out of buried ones are SPAWN-28's own and stay):

| tree | hulls | far before | far after |
|---|---|---|---|
| FHSWEurope (121 levels) | 6474 | 34 | 17 |
| FHSW (14) | 752 | 4 | 4 |
| DC Final (48) | 1401 | 2 | 1 |
| DC (12), EoD (3), FH (4), vanilla (17) | 1009 | 1 | 1 |

The 17 left in FHSWEurope: planes on pads 3 to 4 m over the ground that
drop onto it (Bombing the Reich's two Mosquitos, El Alamein's Wellington and
Ju88) and Rat Trap's Ratte from a pad 16 m up; hulls whose spawner stands
with their col0 under the terrain, lifted out (SPAWN-28): Spring
Awakening's ISU152 (SPAWN-28's own lab case), Counterattack's Panzer 38(t),
Gazaps' Ju52 and Manchuria's TB3 (their gear under a ground-level spawner),
Way to Paris's AMX13; Varsity's and The Great Pursuit's PT16, 3 m over
ground whose only static is 0.3 m tall; Spurning Fate's Kingtiger, whose
`NA_SpareSpawner2` is turned `90/90/90` and stands it on its side, so it
tips 3.6 m onto its tracks; and four that move 3 to 4.3 m on their pads
(Pasir Panjang's Type94 inside `O_NVAoutpost_M1`, Black Knight's Cub, The
Storm's T-34_1942, testfield's Zrinyi2). Those four are open: none sits on a
slope, and the outpost's walls, which the settle world does not have, would
hold the Type94 in retail. (Settled in "Four hulls that moved on their pads" below:
three were shoved by hulls the round never opens with, the Cub is retail's.)

Guards: `tests/test_load_settle_terrain.py` (a synthetic quay cell, and the
room's level settle of Mareth, Bizerte, Way to Paris, Ural Mountains, The
Great Pursuit and Earned in Blood; the glued position line).

## Two flag stands that died with "no killing blow recorded" (2026-10-28)

The behaviour audit's flags phase reported `flag.tester-died` (major) on
raseiniai's `Barn` ("team 1 died 18 s into a 60 s stand at
84.0,76.2,-705.7") and soletschnogorsk-1941's `Axis_Base_2` (18 s into 24 s,
1323.7,75.9,-901.0), both with no killing blow.

**The death is retail's: both flags stand outside the combat area.** Both
are team-1 flags past the level's playable pocket, on terrain material 7
("Reserved (Outside map)"), which the server counts as outside (CA-5;
`materialToGiveDamage` stays 7, no `.con` in the install sets it). Measured
per frame headless on raseiniai: HP 30 at 6 s, 17.3 at 12 s, 0 at 18 s;
every hit `Armor.damage(1/6)` from `combatTick` (world-fields.js), the 10 s
allowance and then 5 HP/s of CA-2, dead 16 s in. The baked material map
puts 90% of raseiniai's 1024 m square on 7: `Barn`, `Farmhouse` and
`reinforcements_from_dubissa` sit on it, the six others and all 43 soldier
spawns on material 3. Soletschnogorsk's `Axis_Base_2` is the only one of its
seven points on 7. None of these flags owns a spawn, so a player only gets
there by walking out of the pocket, and the game bleeds him as the page
does. Nothing to fix in the viewer.

**The audit was what lost the cause.** The blow was recorded every time, by
`combatTick` through `Armor.applyDamage`. The stand took its baseline as
`__killBlows.length`, but that list is capped at 64 and drops its oldest
entry, and in a full run hulls burning out on their pads (the critical-damage
burn, 10 HP a second at 200 HP) had filled it before the flags phase, so
`slice(64)` was always empty. In a flags-only run it named a hull's burn
instead, because it took the newest blow of any Armor. Fixed in
`audit_behaviour.mjs`:
- every blow carries a `seq` that only grows (`window.__killSeq`), and the
  stand keeps blows newer than its start, to an Armor of the tester's own
  max HP;
- `Armor.prototype.hitPoints` is also an accessor, so a body built after
  `Session.open` (every fresh spawn) reports a death by a plain write too.
  The method wraps stay because the hulls placed at load own the field;
- the stand reads `__combatArea()` every frame. A death with the clock
  running, or a blow from `combatTick`, is `flag.outside-combat-area` (info,
  retail-faithful). Its evidence names the material or the box, the
  allowance and the rate, and the stand is marked skipped.

- a death whose blow is `obstacleTick` (barbed wire at the flag, 5 HP a
  second) is `flag.stand-in-barbed-wire` (info, retail-faithful): the
  harness set him down in the wire.

After (`audit_behaviour.mjs --mod fhsweurope --levels raseiniai --only flags
--quick`, and soletschnogorsk-1941 `--only flags` over all 15 flags): both
stands now read `info:flag.outside-combat-area`, "terrain material 7, the
server's materialToGiveDamage 7, CA-5 ... blow damage 0.17 from
Armor.applyDamage < combatTick". The full soletschnogorsk run also showed
two stands the quick run never reaches. `City_West` died 6 s in of
barbed wire (`obstacleTick`), now classified as above. One
`flag.kill-trap-inert` remains on `Ausrustung_und_Munition` (onlyTakeableByTeam 1,
minNrToTakeControl 2): a depot that hurts both sides, where the
tester died yet the owner went 2 -> 1. It is not this class; it is
closed in the next section.

Guard: `tests/test_audit_behaviour.py`
`test_a_stand_outside_the_combat_area_names_the_bleed`.

## Rheinuebung's deck bots: `bots.stalled` was retail's own (2026-10-28)

The overnight re-audit of `rheinuebung-1941` (Bismarck against Hood, co-op)
reported `bots.stalled`, major: 5 of 8 bots under 8 m in 20 s, 5 wanting to
move. Per bot, before: four Allied bots spawned on the `Hoodbots` deck points
(`hoodss3/4/9/10`, `setEnterOnSpawn 0`, `setAIEnterOnSpawn 0`) and stood
there on foot, MoveTo or Scout, each pressed against the deck edge on the way
to its order (`routes`, 500 m away over the sea); one Axis bot on the
`PrinzEugenbots` deck stood the same way; the other three swam, flew the
He111 or drove the Schnellboot. None was aboard a moving ship, waiting for a
seat or inside geometry. The level ships its AI layer (strategies, areas and
the four baked search maps; the infantry map is free everywhere, sea
included).

**What retail does there, measured on the lab server** (server recorder, 8
bots, ledger AI-160):

- `lab/scenarios/fhsweurope-rheinuebung-coop-lod0-rec.json`, every bot at AI
  LOD 0 (`aiSettings.lodEnable 0`), so the physics moves them as the page
  does: the Hood's deck bot walked 13 m in 6 s and stood on the deck for the
  remaining 400 s; one Bismarck bot walked 30 m towards the hull's middle and
  stood the rest of the round, another took the Bismarck's `Ar196-Supply` at
  39 s. None reached a gun, a helm or the water.
- `lab/scenarios/fhsweurope-rheinuebung-coop-rec.json`, the default LOD 2 of
  a bots-only server (AI-136): every deck bot went down through the deck
  within a second, swam through the hull towards its order (about 460 m in
  75 s) and drowned; one swam to the Hood's middle and took its helm. That is
  the AI mover with the physics off, which the page, simulating every bot in
  full, never does.

So standing on the deck is what the engine's bots do there. Two changes:

1. **The audit** (`audit_verdicts.mjs` `botHolding`, test in
   `tests/test_audit_verdicts.mjs`): a bot on foot whose feet are on a `sea`
   hull's deck in every sample (a ray down from his feet, the hull's
   models.json category) is holding, not stalled, and the finding names him
   (`bot_0 on Hoodbots`).
2. **The data** (`extract_vehicle_ai.py` `level_roots`): `Hoodbots`,
   `Bismarckbots`, `PrinzEugenbots` and `Lionbots` are roots the level
   declares in `objects/<Ship>/Objectos.con` outside any AI folder, linked to
   FHSW's `AtlantaAI` / `LionAI` by their own `aiTemplate` line (AI-137);
   the level pass read only folders with `AI/Objects.con`, so the page had
   no record for them and offered their seats to nobody, though the LOD 2
   round shows a retail bot taking the `Hoodbots` helm. The pass now adds a
   level's boardable root (a PlayerControlObject no template adds, with an
   `EntryPoint` in its tree and a declared unit) after every level's folder
   records, so a folder record keeps a name another level also roots.
   Additive in every tree, no record changed: FHSWEurope +360 (escape_from_leyte
   30, Latakia-2016 25, bryansk-1942 25, ...), FHSW +95, FH +26, vanilla,
   XPack1 and XPack2 +9 each (Coral Sea's `Hiryu` and `Hornet` and their AA
   batteries, Battle of Britain's `Ju88A`, its radar towers' AA and the AI
   factory's seat), DesertCombat +10, DC Final +12. Re-extracted for those
   eight trees and published (DC Final's tree is local only,
   `UNPUBLISHED_MODS`); EoD and the other parked mods were not run.

After (`audit_behaviour.mjs --levels rheinuebung-1941 --only bots --quick`):
no `bots.stalled`; `bots.holding` (info, retail-faithful) with `bot_0`,
`bot_2`, `bot_4` on `Hoodbots` and `bot_1` on `PrinzEugenbots`, two bots in
the `Ar196-Supply` (as in retail) and one at each of the Hood's and the Prinz
Eugen's helm.

Open: the page's deck bots now Change towards a Hood seat
(`Hood_SternCannonTower`, `u` 369.9) whose PlayerControlObject sits at the
hull's origin, 11 m under the deck, so the Use press (12.375 m, 3D) never
comes and they stand in Change rather than MoveTo; retail's LOD 0 bots stood
the same way, but their plan was not recorded. Two page bots took a helm
within 20 s, which no LOD 0 retail bot did in 400 s, and the helm bot then
scouts with the hull at rest.

## Four hulls that moved on their pads (2026-10-28)

Follow-up to the four open hulls of "Load-settle outliers" above. None of
them is a slope or a missing static: each was shoved by another hull the
load settle had beside it. The settle world is the terrain and the parked
hulls alone (`static-settle.js` asks the statics only whether a hull stands
on one, `holdOnAStatic`), so an outpost's walls were never in it for any
hull; the Type94 did not need them.

**Pasir Panjang's Type94, The Storm's T-34_1942, testfield's Zrinyi2: a hull
the round does not open with.** The page has every template a pad can hand
out at the pad's pose at load (the baked one, and the other side's from
`loadPadVariants`), and `settlePlacedVehicles` settled all the baked ones in
one world. Retail has a pad's hull only once the pad spawns it, and only the
template of the pad's live team; a team with no entry spawns nothing
(SPAWN-2, SPAWN-12, SPAWN-28).

- Pasir Panjang: `mobile_aa_allies` (only a team-2 `lightaa_mki`) and
  `mobile_aa_axis` (only a team-1 Type94 twin AA) stand 0.5 m apart, both
  filed under `axisbase` (osId 2), team 1, `unableToChangeTeam`. The
  LightAA_MkI is never spawned in any round, and it pushed the Type94 4.25 m.
- The Storm: the `SOTANK` pad at (475, -190) has only a team-2 T-34_1942 and
  is filed under `openbase_2_cpoint` (osId 5), which team 1 holds at the
  start; `SOTANK6Alt`'s team-1 KV9 (osId 4, team 1) stands 2.3 m from it. The
  pair shoved each other 2.1 and 3.2 m.
- testfield: `tank238` hands out T88HMC to the axis base that holds it and
  Zrinyi2 never; the baked Zrinyi2 was pushed 4.1 m and lifted 4.5 m by the
  baked Ratte of `tank239` (T95 for the holder), another hull never spawned.

**Fix**: `pad-nodes.js` `settleGroupsOf` sorts the hulls into the ones
the round opens with (every hull that is no pad's, and the node each pad
stands first, `padFirstTemplate`: the pad's own `SpawnerPad` given its
point's starting team) and the rest, each settled alone, as the engine
stands it at its pad only when the pad spawns it. `hull-bodies.js`
`settlePlacedVehicles` and `settleOnDecks` and the room's
`server/level-bodies.mjs` `settle` all use it.

**A template named with digits was no pad's.** The Storm's T-34_1942 still
settled with the round after that: `padTemplateOf` cut `_<digits>` off the
node's `control` tag as well as off its GLTFLoader-suffixed name, so
`T-34_1942` read as `T-34` and `bakedPadNode` found no node for any pad of
it. Such a pad had no record on the page or in a room: it never spawned,
never changed sides and never timed a respawn. 118 templates over the local
trees end in `_<digits>` (FHSWEurope's T-34_1942, t34-85_1943, L3_33,
Flak103_38, Pak43_41, Tiger_71, the LCVPs and LCTs, the carriers Yahagi_1944
and Zuiho_1944). `padTemplateOf` now takes the tag whole, as
`vehicle-wrecks.js` `templateNameOf` already did; `hull-bodies.js`
`bindCarriers` reads it too.

**Black Knight's Cub: retail's own.** `rocketer` (Cub_Rosie_the_Rocketeer)
and `alliedplane3` (Mosquito_FBMkXVIII) are both team 2 under
`Brit_Basecamp` (osId 2), team 2 and `unableToChangeTeam`, with no
`spawnDelayAtStart`, so both spawn on the round's first frame (SPAWN-10)
and nothing checks the room between them (SPAWN-14 holds a land hull back
from a human soldier only). Their pads are 5.1 m apart, and at the pads'
poses 5 of the Cub's 10 col0 vertices are inside the Mosquito's body box,
up to 1.8 m deep. Settled alone the Cub moves 0.4 m; with the Mosquito the
first tick pushes it 1.7 m and it rests 3.9 m from its pad, upright. Left
as it is.

Census (every hull of the local trees, the same rule as the section above):
FHSWEurope far from its pad 17 -> 14 (the Type94, the T-34_1942 and the
Zrinyi2 within 0.1 m now; eastern_blitz's 7TP and Panzer 38(t), Black
Knight's Bf110-G4 and the KV9 also 1-2.6 m nearer); FHSW 4 -> 4, three
Battle of Foy hulls (M3A1, M16AA, T19HMC) 1.2 to 2.1 m nearer their pads;
FH, DC, DC Final, EoD, vanilla and the two packs unchanged. The behaviour
audit on The Storm and Pasir Panjang (`--only vehicles --gametype Conquest`)
reports no finding for the four templates.

**The audit's pad verdict reads the statics.** `audit_verdicts.mjs`
`padGroundVerdict` measured a hull against the terrain alone, so a hull that
fell through a hangar floor or a bridge deck to the ground under it read as
a pad in the air (`over-ground`, retail_faithful). It now takes `padFloor`
and `hullFloor`, the top of a level static under each, which the page
answers through the new `window.__staticTopAt(x, y, z)` (`hull-bodies.js`
`staticTopAt`, the load settle's own statics-only probe): the pad's ground
is the higher of the terrain and that floor, and a hull counts as fallen
from the air only when it stands on the surface under its pad.

Guards: `tests/test_load_settle_terrain.py` (the room's settle of Pasir
Panjang's Type94, The Storm's KV9 and T-34_1942, Black Knight's Cub;
`padFirstTemplate`'s six cases; a tag with digits), and
`tests/test_audit_verdicts.mjs` (a hull through a hangar floor, one let down
onto a floor, one onto a bridge deck and through it, a roof and a buried
foundation that are no floor).

## `Ausrustung_und_Munition` went 2 -> 1 under one soldier (2026-10-28)

The report: soletschnogorsk-1941's `Ausrustung_und_Munition`
(`onlyTakeableByTeam 1`, `minNrToTakeControl 2`) read
`major:flag.kill-trap-inert`, "a depot on it hurts team 1 (sides 1,2), yet
he died and the owner went 2 -> 1".

**The control point law is retail's, and one soldier did not take it from
two.** A setter traced on the flag's `team` for the whole flags phase caught
both writes, and both were `controlPointStep` from `captureTick`, two stands
before this flag's own, while the tester stood on `bridgesoldiersp` at
1049,84,-1102, 20 m from the point. The audit plays CoOp, and the level's
CoOp copy of the point (its `SinglePlayer` layer) is not Conquest's: radius
25 (Conquest 3), `minNrToTakeControl 1` (Conquest 2),
`loseControlWhenEnemyClose 1`. So he was inside it, ran it down over its
10 s `timeToLoseControl` (losing counts no heads, AI-100) and took it alone
1 s later, as the server would. By the time the flag's own stand began it
was team 1's, the depot killed him, and the flag stayed team 1's: the kill
trap working.

**The audit judged the stand against a stale owner.** The phase lists every
flag once, before any stand, and the kill-trap branch compared the owner
after the stand with that listed owner (2), not the owner the stand began
from (1). Fixed in `audit_behaviour.mjs` `flagPhase`: the stand reads
`owner0` from the live flag as it starts, judges the trap and the
law-mismatch evidence against it, and names a move an earlier stand made
("an earlier stand in its radius moved it 2 -> 1"). The record keeps the
listed owner as `listed`.

Guards: `tests/test_control_point_law.py`
`test_one_soldier_cannot_take_a_point_that_needs_two` (the Conquest copy: a
lone attacker leaves it neutral at 10 s and never takes it, two take it; the
CoOp copy: one takes it) and `tests/test_audit_behaviour.py`
`test_a_stand_judges_the_owner_it_starts_from`.
Still open: the round of the gun not chosen flies 40 m down into the sea or
the ground and, for the AA shells, bursts on its timer far below. Retail
catches it in the hull's own `BulletCatcher25m` (item 12 of
features/fhswe-mechanics-audit); the page's rounds ignore their own hull, so
nothing catches it here.

### FHX-30 re-audit regression (2026-10-28)

The re-audit on main d4bba434 raised `veh.deploy-nothing-stood` on pakfront
`85mmAAmobile#seat1` and soletschnogorsk `Flak18/36mobile#seat1`. It was the audit,
from `096eb7ac`. An earlier test leaves its deployed statics on the same spot.
The seat's own killer (613, 6 m) destroys them at about 3 s, and the pool hands one
of their freed nodes to the new static at about 4 s. A trace of one run read
2 standing, then 0, then 1, so counting statics against the starting 2 and
matching them by node (the same uuid) both said nothing new stood. Each standing
now carries a serial (`round-spawners.js` `state().standing[].serial`), and the
audit waits for a serial past the one it took as the trigger went down
(`de9ef665`). When a deploy stands nothing, the audit now records the pool, the
page's own refusals (`refuse`) and a coarse trace.

After: pakfront 85mm x3, iron_monster Flak18/36mobile and Flak18/36mobilestatic,
soletschnogorsk and stalingrad_urban_area Flak18/36mobile all `veh.deploy-sequence`
info. The killer hits at 2.93-3.13 s and the deploy object stands at 4.0-4.2 s.
stalingrad_urban_area passed three runs in three; its overnight
`deploy-hull-survived` did not reproduce.
