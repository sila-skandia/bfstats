# Scorecard: FHSW (`fhsw`)

Generated 2026-10-19T22:41:16. Mod tier: **blocked**. Tiers fail closed: a gate that did not run, or is not installed, can only make a level `unverified`, never `ready`; an open blocker or major makes it `blocked`.

Levels: 0 ready, 0 ready-with-notes, 9 blocked, 1 unverified

## Gates

| Gate | Status | Findings | Detail |
|---|---|---|---|
| static | ran | 7781 | rc=1 |
| render | ran | 54 | 2022 frames (1695 models, 114 levels) |
| behaviour | failed-to-run | 0 | timed out |
| completeness | ran | 62 | rc=1 |
| rules | ran | 3 | 10 of 10 levels read from the archives |
| corpus | ran | 0 | 9 pass, 27 n/a, 0 fail |

## Levels

| Level | Tier | Blocker | Major | Minor | Accepted | First reason |
|---|---|---|---|---|---|---|
| in_the_hell_of_bocage-1944 | blocked | 5 | 8 | 0 | 30 | spawn-buried (static): pushcage - 3.6 m below ground at (1754,-1656) |
| eagles_nest-1946 | blocked | 5 | 13 | 0 | 1 | soldier-spawn-floating (static): AxisSpawnPoint_Bridge_1 - 54.1 m above ground at (570,-420) |
| simusyu_to-1945 | blocked | 3 | 23 | 0 | 4 | ship-off-waterline (static): type38 - y 77.0, water 78.5 |
| tunis-1943 | blocked | 0 | 8 | 0 | 21 | spawn-buried (static): SdKfz222 - 1.6 m below ground at (64,-154) |
| iron_monster | blocked | 2 | 5 | 0 | 4 | spawn-buried (static): SdKfz222 - 1.6 m below ground at (64,-154) |
| fht_conquest_of_java-1942 | blocked | 4 | 28 | 0 | 2 | ship-off-waterline (static): sampan - y 88.2, water 90.0 |
| fht_dinant-1940 | blocked | 4 | 24 | 0 | 16 | spawn-buried (static): civtrck - 5.8 m below ground at (751,-1150) |
| warsaw_uprising | unverified | 0 | 0 | 0 | 3 | gate behaviour: failed-to-run (timed out) |
| operation_hailstone | blocked | 0 | 12 | 1 | 18 | ship-off-waterline (static): hatsuzuki - y 73.2, water 78.5 |
| salerno-1943 | blocked | 0 | 2 | 0 | 6 | level-sound-template-not-baked (static): birds_and_trees - declared in Sounds/Birds_and_Trees.con (Birds_and_Trees.ssc) and placed |

## Blockers

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| render-white-magenta-black | render | 54 | 2 | audit_render.mjs / extract_all.py / extract_maps_all.py | AllieskillerCage5mHard; AlliesKillerObject25m; AxiskillerCage5mHard | 0 px, white 0%, magenta 0%, black 0% |
| spawn-at-origin | static | 4 | 2 | extract_maps_all.py / extract_map.py / bf42/level.py | fog_rain_pco (guadalcanal); LVTa4NSP (guadalcanal); bigben_axis_sp_killer (westminster-1942) |  |
| untextured-texture-in-install-but-unresolved | static | 1 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | bf1942/levels/A_Day_of_Zitadelle/customtexts/lfrfs1_s | 1 material(s) in 1 glb: scene.glb |

## Major

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| opaque-material-cutout-texture | static | 466 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | bf1942/levels/_TEXTURE_GENERAL/texture/GENERAL_RUS_AFRICA/T34-85_RearCog.dds; texture/GENERAL_US_PACIFIC/Fle_alfa_Z.dds; texture/GENERAL_RUS_WINTER/zi | 1 glb: desert_hill.skin.glb |
| ship-off-waterline | static | 80 | 34 | extract_maps_all.py / extract_map.py / bf42/level.py | type38 (air_raid_alert_-kure-1945); Lcvp_Omaha_3 (battle_for_ortona-1943); type38 (battle_of_makin) | y 77.0, water 78.5 |
| report-template-in-install-but-unresolved | static | 59 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | SubDummy_Spawner; independence_AIRSpawnerC; BunkerHillPlanesSpawner_Front_Deck | 51 model(s): I26, I26.cockpit, I54, I54.cockpit, I58 |
| bolt-rifle-no-bolt-clip | static | 51 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | AussSoldier__Deploy_Cavalry_Arisaka_HandFireArms; AussSoldier__Knife_CarcanoBayonet; AussSoldier__Knife_CarcanoBayonet_ID2 |  |
| control-point-spawn-group-empty | static | 40 | 26 | extract_loadouts.py / extract_map.py / extract_kits.py | village_south (in_the_hell_of_bocage-1944); AXIS_Tunnel (eagles_nest-1946); AXIS_Mountain_Pass (eagles_nest-1946) | group 8 |
| spawn-buried | static | 37 | 25 | extract_maps_all.py / extract_map.py / bf42/level.py | pushcage (berlin-1945); killerCage_RemoverAxis (fht_operation_longcloth-1943); pushcage (operation_coronet-1946) | 3.6 m below ground at (1754,-1656) |
| level-not-extracted | completeness | 29 | 29 | extract_maps_all.py | apennines (apennines); battle_at_river_don (battle_at_river_don); battle_of_angaur (battle_of_angaur) | the mod's own level archive ships it and the tree has no baked scene for it |
| level-dir-without-scene | completeness | 22 | 22 | extract_maps_all.py | apennines (apennines); battle_at_river_don (battle_at_river_don); battle_of_angaur (battle_of_angaur) | a level directory with files but no scene.json (an interrupted bake) |
| soldier-spawn-floating | static | 21 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | AxisSpawnPoint_Bridge_1 (eagles_nest-1946); AxisSpawnPoint_Bridge_2 (eagles_nest-1946); AxisSpawnPoint_Bridge_3 (eagles_nest-1946) | 54.1 m above ground at (570,-420) |
| spawn-template-not-in-library | static | 17 | 13 | extract_loadouts.py / extract_map.py / extract_kits.py | knil_fortificationsmokemortar (fht_conquest_of_java-1942); GearingMid1942 (operation_hailstone); 3german_atpanzeschreck (arnhem-1944) | spawner smokemortar_kit cp black_force_hq |
| soldier-nation-unknown | static | 14 | 11 | extract_loadouts.py / extract_map.py / extract_kits.py | DutchSoldier (fht_conquest_of_java-1942); TurboWrenchBritishSoldier (battle_of_off_malay); VolkssturmSoldier (berlin-1945) |  |
| level-template-defined-not-baked | static | 11 | 5 | extract_loadouts.py / extract_map.py / extract_kits.py | birds_and_trees (salerno-1943); wracked_pantherd (a_day_of_zitadelle); niinii2 (air_raid_alert_-kure-1945) | SimpleObject |
| marker-below-ground | static | 8 | 5 | extract_maps_all.py / extract_map.py / bf42/level.py | 4pol_tankhunterwz29 (eastern_blitz-1939); 3us_atbazookap (kasserine_pass-1943); 5US_EngineerNo4AmmoInfantryAT (sector318-1944) | 13.8 m below ground at (908,-328) |
| control-point-flag-not-baked | static | 7 | 2 | extract_loadouts.py / extract_map.py / extract_kits.py | undergroundbunker (berlin-1945); suda_baytemplate (crete-1941); germanairbasetemplate (crete-1941) | flagge_m1 |
| soldier-spawn-buried | static | 3 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | whitebeach2 (battle_of_peleliu); garrison_spawn1 (fht_battle_of_kohima-1944); japan_position_spawn7 (manchuria-1945) | 3.8 m below ground at (737,-2070) |
| weapon-in-table-under-another-script | static | 3 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | B17G; B40; ChurchillVCS | B17_MG2_FB: table objects/vehicles/air/common/sounds/mono_12,7mm800rpmhvfb.ssc, bound objects/Vehicles/Air/B17 |
| menu-levels-missing-level | completeness | 3 | 3 | extract_hud_mods.py | _texture_general (_texture_general); _texture_general_ger (_texture_general_ger); _texture_special (_texture_special) | the level is in the mod's own levels folder but not in the Instant Battle list |
| spawner-vehicle-unresolved | rules | 2 | 2 | extract_all.py / extract_map.py | knil_fortificationsmokemortar (fht_conquest_of_java-1942); GearingMid1942 (operation_hailstone) | objectSpawns names a vehicle that is in no models.json entry, no kit pickup and no node of the level's scene.g |
| texture-in-install-but-unresolved | static | 2 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | bf1942/levels/A_Day_of_Zitadelle/customtexts/lfrfs1_s; bf1942/levels/Midway-1942/Texture/HANgarROof3_S | 1 model(s): level:a_day_of_zitadelle |
| static-floating | static | 2 | 2 | extract_maps_all.py / extract_map.py / bf42/level.py | tankobs_ste_M1 (supercharge-1942); ste_Lantern_m1 (wake_night) | lowest point 20.8 m above the highest ground under it at (968,-28) |
| minimap-icon-file-missing | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | PenetrateExplosion36cmVisible; SS_Bdoor | minimap_icon_artyshellbattleship |
| land-no-seats | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Rat_NorthFactory; Rat_SouthFactory |  |
| kit-worn-textures-missing | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | US_MedicM1Carabine; US_MedicM1CarabineP | texture/undefined |
| level-sound-template-not-baked | static | 1 | 1 | extract_map.discover_level_sounds (step levels) | birds_and_trees (salerno-1943) | declared in Sounds/Birds_and_Trees.con (Birds_and_Trees.ssc) and placed; not in sounds.areas |
| texture-opaque-black | static | 1 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | textures/48/48e6cf57ad9bf3b4a54ff3031641affa.webp | Tx05x07 512x512; used by 1 glb: scene.glb |
| spawn-floating | static | 1 | 1 | extract_maps_all.py / extract_map.py / bf42/level.py | GB_SpecOpsStenMK2S (fht_hong_kong-1941) | 77281.5 m above ground at (345,-93) cp None |
| hull-sunk-in-static | static | 1 | 1 | extract_maps_all.py / extract_map.py / bf42/level.py | T34-57 (moscow_outskirts-1941) | hull 0.30 m into Plank_10m_m1, trainplatform_m1, Plank_10m_m1, RailRoad_Straight5_m1 after the settle (placed  |
| weapon-script-ok-but-not-in-table | static | 1 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | cal50_AA_Shield_ShipAdd | ShipBell: objects/Vehicles/sea/Common/Sounds/ShipBell.ssc |
| engine-script-ok-but-no-layers | static | 1 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | Lion45+10000 | objects/Vehicles/sea/Lion45/Sounds/Lion45Engine.ssc |
| air-no-seats | static | 1 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | EntrySpawnObject64 |  |
| chain-template-not-extracted | completeness | 1 | - | extract_all.py | 50 of 4141 templates | the mod's chain defines them and models.json lacks them (extracted with --own?): BorgwardIV, FritzXGuided, Gol |

## Minor (mod-wide and per level)

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| level-briefing-empty | completeness | 1 | 1 | extract_map.py | operation_hailstone (operation_hailstone) | the archive ships Menu/Init.con |

## Accepted exceptions (review these)

| cause_key | gate | count | retail-faithful | evidence |
|---|---|---|---|---|
| air-no-seats-never-placed | static | 29 | True | an aircraft no baked level places |
| cockpit-stick-deviation-applied | static | 6 | True | DEV-COCKPIT-IL2-STICK: IL2 control column authored 0.67 m ahead of and 0.25 m below the eye (every comparable FH aircraft: 0.27-0.42 ahead, 0.35-0.42  |
| emplacement-no-seats-never-placed | static | 74 | True | a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, `_unlimited` mounts): its seat is the host's |
| engine-script-unusable-in-install | static | 14 | True | the script is not in the install, or `#include`s a file the mod never shipped (Zuikaku includes ZuikakuEngine from a folder holding ShokakuEngine): si |
| engine-without-script | static | 601 | True | no `loadSoundScript` anywhere in the install's objects archives binds an Engine of the vehicle: silent in retail (carriers, remote-control bombers, gl |
| kit-icon-absent-from-install | static | 4 | True | the kit names an icon that is in no menu.rfa of the mod chain (Icon_ppsh_selected, Icon_TommygunUS_selected) |
| land-no-seats-never-placed | static | 110 | True | a land vehicle no baked level places |
| level-places-undefined-template | static | 232 | True | the level script `Object.create`s a name no ObjectTemplate.create defines; the engine places nothing too (Omaha's `beachsound`) |
| level-sound-samples-absent | static | 5 | True | the level object's sound script names a wav that is in no archive (Prokhorovka's radio_german1.wav) |
| level-sound-template-script-silent | static | 20 | True | the template's sound script parses to no sample, or to samples no archive holds (a commented-out patch, `Crickets_env_03.wav` shipped nowhere): retail |
| level-sound-wav-in-other-dir | static | 13 | True | the script loads `Sound/@RTD/x.wav` and the file ships only as `Sound/<rate>/Ambience/x.wav`; the engine does not search folders, so Gold Beach's 14 l |
| level-template-logic-not-baked | static | 82 | True | a ControlPoint/SpawnPoint/ObjectSpawner template of a mode layer the viewer does not play (SinglePlayer) |
| object-outside-world-authored | static | 113 | True | placed past the world's edge by the level script itself |
| object-outside-world-on-wrapped-terrain | static | 619 | True | past the heightmap's edge, at a height within 2.5 m of the wrapped terrain: the level was dressed on the wrapped ground, and the viewer draws and coll |
| object-stacked-duplicate | static | 289 | True | the level script places the same template twice at one position (editor leftovers); retail draws both too, the pixels are identical |
| report-geometry-undeclared | static | 50 | True | an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / _gun_base, |
| report-materialsWithoutShader | static | 15 | True | bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden (bf42/verify.py: nothing draws it) |
| report-template-not-in-install | static | 366 | True | the geometry or template the model asks for is not in any archive |
| sea-no-seats-never-placed | static | 13 | True | a ship part no baked level places |
| spawn-floating-authored | static | 316 | True | the level's ObjectSpawns.con puts the spawner there (a bridge deck); the detail names the line |
| static-floating-authored | static | 3529 | True | the level script's own `Object.absolutePosition` puts the object there, and the engine places a static exactly as written (no snap to the terrain): a  |
| texture-absent-from-install | static | 18 | True | the texture is not in any of the 1,541 .rfa archives of the install (every mod and level searched); retail draws these untextured too |
| texture-uniform-authored | static | 13 | True | a flat texture the game itself names for the purpose (notexture, black_o, e_richo_white_I) |
| untextured-generic-material-name | static | 4 | True | the shader is called `Material #N`, a name hundreds of `.rs` files share, so the glb cannot say which texture it wanted (here the Ju 88 cockpit, whose |
| untextured-texture-absent-from-install | static | 40 | True | a drawn material whose texture is in no archive of the install (sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it untextured too |
| uv-constant | static | 72 | True | authored: every vertex of the part carries one UV, so retail samples one texel too (a canopy, a gun mount); the glb reproduces the source |
| viewmodel-clip-absent-from-install | static | 167 | True | the first-person animation file the weapon names is in no archive (Binoculars' 1PFireBinoculars.baf) |
| weapon-script-unusable-in-install | static | 26 | True | the gun's script, a file it includes, or every wav it plays is not in the install (coax1s.wav, jumplight.wav are in no archive) |

## Regression corpus

| Defect class | Status | Evidence |
|---|---|---|
| random-geometries-sound | pass | 4 templates have engine layers: ['GMC', 'Opelblitz', 'Zis5', 'Bedford'] |
| engine-script-candidates | pass | 2 templates have engine layers: ['B25', 'Ju52'] |
| stationary-guns-static | pass | stamped: ['Nebelwerfer@in_the_hell_of_bocage-1944', 'Nebelwerfer@eagles_nest-1946'] |
| engine-alpha-floor | pass | MASK |
| spelled-extension-texture | pass | 18 reports clean |
| missing-quote-texture-line | n/a | no live probe: guarded by audit cause / unit test |
| nan-uvs | n/a | no live probe: guarded by audit cause / unit test |
| bolt-operate-state-family | pass | 30 rigs have `bolt` |
| viewmodel-weapon-weld | n/a | no live probe: guarded by audit cause / unit test |
| rle-bottom-left-tga | n/a | no live probe: guarded by audit cause / unit test |
| v-is-coop-arms | n/a | no live probe: guarded by audit cause / unit test |
| object-script-spawn-groups | n/a | Omaha_Charlie is not baked in this tree |
| unable-to-change-team | n/a | Prokhorovka is not baked in this tree |
| deployables-json | pass | 99 weapons, 95 objects |
| hull-sunk-in-static | n/a | no live probe: guarded by audit cause / unit test |
| room-collision-primitives | n/a | no live probe: guarded by audit cause / unit test |
| static-out-of-any-world | n/a | no live probe: guarded by audit cause / unit test |
| lightmapped-lod-chain | pass | no lightmapped part ships a rung |
| shared-gait-hubs | pass | all 7 gait clips |
| held-spawn-offset | n/a | no live probe: guarded by audit cause / unit test |
| seat-spawn-late-rig | n/a | no live probe: guarded by audit cause / unit test |
| held-key-axis | n/a | no live probe: guarded by audit cause / unit test |
| gun-seat-key-levers | n/a | no live probe: guarded by audit cause / unit test |
| twin-gunner-sights | n/a | no live probe: guarded by audit cause / unit test |
| held-objects-on-the-map | n/a | no live probe: guarded by audit cause / unit test |
| seaplane-floats | n/a | no live probe: guarded by audit cause / unit test |
| ship-col0-underside | n/a | no live probe: guarded by audit cause / unit test |
| held-depot-burn-down | n/a | no live probe: guarded by audit cause / unit test |
| round-held-attitude | n/a | no live probe: guarded by audit cause / unit test |
| loading-holds-for-the-level | n/a | no live probe: guarded by audit cause / unit test |
| mode-cut-covers | n/a | no live probe: guarded by audit cause / unit test |
| ship-col0-vertices | n/a | no live probe: guarded by audit cause / unit test |
| static-parts-stay-dry | n/a | no live probe: guarded by audit cause / unit test |
| level-declared-kit-content | n/a | no live probe: guarded by audit cause / unit test |
| player-shot-cone | n/a | no live probe: guarded by audit cause / unit test |
| wreck-has-no-door | n/a | no live probe: guarded by audit cause / unit test |

## Verification steps

| Step | Status |
|---|---|
| v_outputs | pass |
| v_counts | pass |
| v_gz | pass |
| v_thumbs | pass |
| v_levels | pass |
| v_static | pass |
| v_harness | pass |

## Residual human checks

Every level: first spawn feels right; vehicle handling and recoil feel; ambience mix against the real game.
