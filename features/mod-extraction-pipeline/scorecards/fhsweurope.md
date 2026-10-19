# Scorecard: FHSWEurope (`fhsweurope`)

Generated 2026-10-20T01:35:16. Mod tier: **blocked**. Tiers fail closed: a gate that did not run, or is not installed, can only make a level `unverified`, never `ready`; an open blocker or major makes it `blocked`.

Levels: 0 ready, 0 ready-with-notes, 8 blocked, 0 unverified

## Gates

| Gate | Status | Findings | Detail |
|---|---|---|---|
| static | ran | 8276 | rc=1 |
| render | ran | 29 | 1686 frames (1442 models, 86 levels) |
| behaviour | failed-to-run | 0 | timed out |
| completeness | ran | 350 | rc=1 |
| rules | ran | 6 | 8 of 8 levels read from the archives |
| corpus | ran | 0 | 8 pass, 28 n/a, 0 fail |

## Levels

| Level | Tier | Blocker | Major | Minor | Accepted | First reason |
|---|---|---|---|---|---|---|
| sector115-1946 | blocked | 0 | 14 | 0 | 79 | spawn-buried (static): activegatehouse1_large - 2.9 m below ground at (626,-1339) |
| invasion_of_usa-1948 | blocked | 2 | 18 | 0 | 104 | spawn-buried (static): killerCage_RemoverAxis - 5.5 m below ground at (438,-1341) |
| rush_to_baghdad | blocked | 4 | 3 | 0 | 14 | spawn-buried (static): killerCage_RemoverAxis - 5.5 m below ground at (438,-1341) |
| battle_of_palembang | blocked | 4 | 12 | 0 | 121 | spawn-buried (static): killerCage_RemoverAxis - 5.5 m below ground at (438,-1341) |
| battle_of_peleliu | blocked | 4 | 14 | 0 | 19 | spawn-buried (static): killerCage_RemoverAxis - 5.5 m below ground at (438,-1341) |
| battle_of_stalingrad | blocked | 2 | 4 | 0 | 3 | ship-off-waterline (static): riverboat - y 73.4, water 75.0 |
| battle_of_the_bulge | blocked | 0 | 1 | 0 | 0 | spawn-buried (static): M3A1-3inchATGun_APCR - 4.4 m below ground at (894,-558) |
| battle_of_the_solomon | blocked | 0 | 7 | 0 | 2 | ship-off-waterline (static): Hatsuzuki - y 107.0, water 75.0 |

## Blockers

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| render-white-magenta-black | render | 29 | 4 | audit_render.mjs / extract_all.py / extract_maps_all.py | AxiskillerCage25mHard; killerCage_RemoverAxis; AllieskillerCage25mHard | 0 px, white 0%, magenta 0%, black 0% |
| untextured-texture-in-install-but-unresolved | static | 1 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | texture/Lionfish_Hull01_H  | 4 material(s) in 4 glb: I507.glb, I508.glb, I509.glb, scene.glb |

## Major

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| opaque-material-cutout-texture | static | 502 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | texture/GENERAL_ETH/flags_o.dds; texture/GENERAL_US_PACIFIC/Fle_alfa_Z.dds; texture/GENERAL_RUS_WINTER/zis5bed.dds | 1 glb: battle_of_abyssinia-1936.skin.glb |
| level-not-extracted | completeness | 189 | 189 | extract_maps_all.py | adak_race (adak_race); battle_of_off_malay (battle_of_off_malay); battle_of_valirisk-1943 (battle_of_valirisk-1943) | the mod's own level archive ships it and the tree has no baked scene for it |
| level-dir-without-scene | completeness | 148 | 148 | extract_maps_all.py | battle_of_off_malay (battle_of_off_malay); battle_over_hokkaido-1945 (battle_over_hokkaido-1945); beginning_of_the_end (beginning_of_the_end) | a level directory with files but no scene.json (an interrupted bake) |
| ship-off-waterline | static | 98 | 35 | extract_maps_all.py / extract_map.py / bf42/level.py | sakigake (operation_ketsu4); sampanGB (sector115-1946); sakigake (sector115-1946) | y 28.3, water 30.0 |
| spawn-template-not-in-library | static | 89 | 25 | extract_loadouts.py / extract_map.py / extract_kits.py | panther_ii (invasion_of_usa-1948); 3us_atm18rr_smolep (invasion_of_usa-1948); 120mm (battle_of_peleliu) | spawner ger_pan2_spawner cp germanairbasetemplate |
| bolt-rifle-no-bolt-clip | static | 67 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | AussSoldier__Type99MagneticATQuad_4Linked; AussSoldier__Type99MagneticATStack_4Linked; BritishSoldier__Knife_CarcanoBayonet |  |
| static-floating | static | 50 | 13 | extract_maps_all.py / extract_map.py / bf42/level.py | B25spawnrotator (a_day_of_zitadelle); B251spawnrotator (a_day_of_zitadelle); SnowCloud_m1 (adak_island) | lowest point 105.2 m above the highest ground under it at (842,-79) |
| report-template-in-install-but-unresolved | static | 37 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | SubDummy_Spawner; BunkerHillPlanesSpawner_Front_Deck; Hornet(2)PlanesSpawner_Front_Deck | 69 model(s): I26, I26.cockpit, I400, I400.cockpit, I401 |
| spawn-buried | static | 36 | 21 | extract_maps_all.py / extract_map.py / bf42/level.py | activegatehouse1_large (alaska-1948); T22E1_APCR (apennines); civtrck (battle_of_gela-1943) | 2.9 m below ground at (626,-1339) |
| control-point-spawn-group-empty | static | 34 | 19 | extract_loadouts.py / extract_map.py / extract_kits.py | controlpoint_town_center (sector115-1946); landing (battle_of_peleliu); cassinobase_1_cpoint (203_hill-1904) | group 15 |
| soldier-nation-unknown | static | 23 | 17 | extract_loadouts.py / extract_map.py / extract_kits.py | IraqSoldier (rush_to_baghdad); DutchSoldier (battle_of_palembang); TurboWrenchJapaneseSoldier (226-1936) |  |
| kit-pickup-not-exported | static | 16 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | 3German_AT_WinterPanzerschreck_JetPack; 3German_CloseQuartersMp40_JetPack; 3Rus_ATLPG44 | Kit_Axis_JetPack |
| kit-worn-textures-missing | static | 9 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | US_MedicM1Carabine; US_MedicM1CarabineP; 1Rus_OfficerAK74 | texture/undefined |
| object-outside-world | static | 8 | 4 | extract_maps_all.py / extract_map.py / bf42/level.py | B251spawnrotator (a_day_of_zitadelle); Cloud2_m1 (battle_of_leyte_gulf_day2); EU_asp3_M1 (battle_of_orel-1943) | (901,99,-2158) |
| soldier-spawn-buried | static | 5 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | whitebeach2 (battle_of_peleliu); hungary_arty_position_spawn2 (battle_at_river_don); hungary_arty_position_spawn3 (battle_at_river_don) | 3.8 m below ground at (737,-2070) |
| marker-below-ground | static | 5 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | us_specopsm3s (fht_golf_hotel-1944); 3Rus_TankhunterNagantRPG43 (seelow-heights-1945); 5Jap_ArtilleryType94Ammo88mm (tulagi_island) | 9.2 m below ground at (1194,-1218) |
| spawner-vehicle-unresolved | rules | 4 | 2 | extract_all.py / extract_map.py | 3us_atm18rr_smolep (invasion_of_usa-1948); panther_ii (invasion_of_usa-1948); 120mm (battle_of_peleliu) | objectSpawns names a vehicle that is in no models.json entry, no kit pickup and no node of the level's scene.g |
| level-template-defined-not-baked | static | 4 | 4 | extract_loadouts.py / extract_map.py / extract_kits.py | Factory_Objective (battle_of_britain); lake (fht_golf_hotel-1944); Flakturm_Eleva (flak_tower) | PlayerControlObject |
| level-thumbnail-unnamed | completeness | 4 | 4 | extract_hud_mods.py | air_raid_kure-1945 (air_raid_kure-1945); battle_of_biak-1944 (battle_of_biak-1944); invasion_of_france (invasion_of_france) | menu-levels.json names none |
| weapon-in-table-under-another-script | static | 3 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | B17SP; Elco80; ValentineVIII_rocket | B17_MG2_FB: table objects/vehicles/air/common/sounds/mono_12,7mm800rpmhvfb.ssc, bound objects/Vehicles/Air/B17 |
| air-no-seats | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | ParaSpawnObject83; EntrySpawnObject64 |  |
| minimap-icon-file-missing | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | PenetrateExplosion36cmVisible; SS_Bdoor | minimap_icon_artyshellbattleship |
| kit-item-no-viewmodel | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | chi4; 5JapteishintaiDeploy_47mm | ChineseSoldier__sigke7 |
| texture-opaque-black | static | 1 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | textures/f8/f88dcea419c00de771a923e7a5e50150.webp | sky_DarkNight_m1_Material0 1024x1024; used by 1 glb: scene.glb |
| hull-sunk-in-static | static | 1 | 1 | extract_maps_all.py / extract_map.py / bf42/level.py | Chi-ha-ShortBarrel_Pillbox_HEAT (battle_of_iwo_jima) | hull 0.15 m into Stones_Pacif_L_m1, SW_trench_cover_m1 after the settle (placed 0.43 m in) at (820,-941) |
| weapon-script-ok-but-not-in-table | static | 1 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | cal50_AA_Shield_ShipAdd | ShipBell: objects/Vehicles/Sea/Common/Sounds/ShipBell.ssc |
| land-model-draws-nothing | static | 1 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Bench_01_Object | 0 triangles; the geometry templates its tree names are not declared: Bench_01_m1 |
| control-point-flag-not-baked | static | 1 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | syrianforwardbasetemplate (latakia-2016) | flagge_m1 |
| chain-template-not-extracted | completeness | 1 | - | extract_all.py | 49 of 4856 templates | the mod's chain defines them and models.json lacks them (extracted with --own?): BorgwardIV, FritzXGuided, Gol |

## Accepted exceptions (review these)

| cause_key | gate | count | retail-faithful | evidence |
|---|---|---|---|---|
| air-no-seats-never-placed | static | 31 | True | an aircraft no baked level places |
| emplacement-no-seats-never-placed | static | 74 | True | a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, `_unlimited` mounts): its seat is the host's |
| engine-script-unusable-in-install | static | 14 | True | the script is not in the install, or `#include`s a file the mod never shipped (Zuikaku includes ZuikakuEngine from a folder holding ShokakuEngine): si |
| engine-without-script | static | 607 | True | no `loadSoundScript` anywhere in the install's objects archives binds an Engine of the vehicle: silent in retail (carriers, remote-control bombers, gl |
| kit-icon-absent-from-install | static | 4 | True | the kit names an icon that is in no menu.rfa of the mod chain (Icon_ppsh_selected, Icon_TommygunUS_selected) |
| land-no-seats-never-placed | static | 141 | True | a land vehicle no baked level places |
| level-places-undefined-template | static | 188 | True | the level script `Object.create`s a name no ObjectTemplate.create defines; the engine places nothing too (Omaha's `beachsound`) |
| level-sound-samples-absent | static | 5 | True | the level object's sound script names a wav that is in no archive (Prokhorovka's radio_german1.wav) |
| level-sound-template-script-silent | static | 9 | True | the template's sound script parses to no sample, or to samples no archive holds (a commented-out patch, `Crickets_env_03.wav` shipped nowhere): retail |
| level-sound-wav-in-other-dir | static | 6 | True | the script loads `Sound/@RTD/x.wav` and the file ships only as `Sound/<rate>/Ambience/x.wav`; the engine does not search folders, so Gold Beach's 14 l |
| level-template-logic-not-baked | static | 32 | True | a ControlPoint/SpawnPoint/ObjectSpawner template of a mode layer the viewer does not play (SinglePlayer) |
| object-outside-world-authored | static | 41 | True | placed past the world's edge by the level script itself |
| object-outside-world-on-wrapped-terrain | static | 113 | True | past the heightmap's edge, at a height within 2.5 m of the wrapped terrain: the level was dressed on the wrapped ground, and the viewer draws and coll |
| object-stacked-duplicate | static | 2192 | True | the level script places the same template twice at one position (editor leftovers); retail draws both too, the pixels are identical |
| report-geometry-undeclared | static | 60 | True | an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / _gun_base, |
| report-materialsWithoutShader | static | 16 | True | bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden (bf42/verify.py: nothing draws it) |
| report-template-not-in-install | static | 380 | True | the geometry or template the model asks for is not in any archive |
| sea-no-seats-never-placed | static | 13 | True | a ship part no baked level places |
| spawn-floating-authored | static | 176 | True | the level's ObjectSpawns.con puts the spawner there (a bridge deck); the detail names the line |
| static-floating-authored | static | 1926 | True | the level script's own `Object.absolutePosition` puts the object there, and the engine places a static exactly as written (no snap to the terrain): a  |
| texture-absent-from-install | static | 67 | True | the texture is not in any of the 1,541 .rfa archives of the install (every mod and level searched); retail draws these untextured too |
| texture-uniform-authored | static | 13 | True | a flat texture the game itself names for the purpose (notexture, black_o, e_richo_white_I) |
| untextured-generic-material-name | static | 4 | True | the shader is called `Material #N`, a name hundreds of `.rs` files share, so the glb cannot say which texture it wanted (here the Ju 88 cockpit, whose |
| untextured-texture-absent-from-install | static | 74 | True | a drawn material whose texture is in no archive of the install (sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it untextured too |
| uv-constant | static | 95 | True | authored: every vertex of the part carries one UV, so retail samples one texel too (a canopy, a gun mount); the glb reproduces the source |
| viewmodel-clip-absent-from-install | static | 135 | True | the first-person animation file the weapon names is in no archive (Binoculars' 1PFireBinoculars.baf) |
| weapon-icon-absent-from-install | static | 1 | True | the weapon names an icon that is in no menu.rfa of the mod chain |
| weapon-script-unusable-in-install | static | 28 | True | the gun's script, a file it includes, or every wav it plays is not in the install (coax1s.wav, jumplight.wav are in no archive) |

## Regression corpus

| Defect class | Status | Evidence |
|---|---|---|
| random-geometries-sound | pass | 4 templates have engine layers: ['GMC', 'Opelblitz', 'Zis5', 'Bedford'] |
| engine-script-candidates | pass | 2 templates have engine layers: ['B25', 'Ju52'] |
| stationary-guns-static | n/a | Nebelwerfer and Type88 are placed in no baked level |
| engine-alpha-floor | pass | MASK |
| spelled-extension-texture | pass | 9 reports clean |
| missing-quote-texture-line | n/a | no live probe: guarded by audit cause / unit test |
| nan-uvs | n/a | no live probe: guarded by audit cause / unit test |
| bolt-operate-state-family | pass | 44 rigs have `bolt` |
| viewmodel-weapon-weld | n/a | no live probe: guarded by audit cause / unit test |
| rle-bottom-left-tga | n/a | no live probe: guarded by audit cause / unit test |
| v-is-coop-arms | n/a | no live probe: guarded by audit cause / unit test |
| object-script-spawn-groups | n/a | Omaha_Charlie is not baked in this tree |
| unable-to-change-team | n/a | Prokhorovka is not baked in this tree |
| deployables-json | pass | 103 weapons, 97 objects |
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
| v_outputs | fail |
| v_counts | pass |
| v_gz | pass |
| v_thumbs | fail |
| v_levels | pass |
| v_static | pass |
| v_harness | pass |

## Residual human checks

Every level: first spawn feels right; vehicle handling and recoil feel; ambience mix against the real game.
