# Scorecard: FHSW (`fhsw`)

Generated 2026-10-12T05:08:10. Mod tier: **blocked**. Tiers fail closed: a gate that did not run, or is not installed, can only make a level `unverified`, never `ready`; an open blocker or major makes it `blocked`.

Levels: 0 ready, 0 ready-with-notes, 11 blocked, 0 unverified

## Gates

| Gate | Status | Findings | Detail |
|---|---|---|---|
| static | ran | 9561 | rc=1 |
| render | ran | 13 | 369 frames (339 models, 11 levels) |
| behaviour | failed-to-run | 0 | timed out |
| completeness | ran | 723 | rc=1 |
| rules | ran | 4 | 11 of 11 levels read from the archives |
| corpus | ran | 0 | 8 pass, 6 n/a, 0 fail |

## Levels

| Level | Tier | Blocker | Major | Minor | Accepted | First reason |
|---|---|---|---|---|---|---|
| berlin-1945 | blocked | 1 | 16 | 0 | 128 | soldier-spawn-floating (static): unnamedspawn1 - 12.7 m above ground at (1774,-1646) |
| battle_of_antarctica | blocked | 6 | 51 | 0 | 443 | ship-off-waterline (static): hornet(2) - y 18.9, water 20.0 |
| ramelle_neuville-1944 | blocked | 0 | 3 | 0 | 1 | weapon-script-ok-but-not-in-table (static): M8HMC_Bag - M8HMCGunBarrel: objects/Vehicles/Land/M8HMC/Sounds/M8HMCCannon.ssc |
| monster_des_stahles | blocked | 0 | 100 | 0 | 49 | ship-off-waterline (static): Yamato1944 - y 72.0, water 75.0 |
| prokhorovka-1943 | blocked | 0 | 5 | 0 | 23 | land-model-draws-nothing (static): Panzerjager1c - 0 triangles; the geometry templates its tree names are not declared: Panzer2G_H |
| gold_beach-1944 | blocked | 0 | 2 | 0 | 2 | weapon-script-ok-but-not-in-table (static): 2us_assaultgarand - BayonetM1Garand: objects/Handweapons/Bayonet/Sounds/BayonetM1Garan |
| midway-1942 | blocked | 0 | 15 | 0 | 7 | ship-off-waterline (static): pt_boat636 - y 30.2, water 130.2 |
| pakfront | blocked | 1 | 10 | 0 | 33 | spawn-buried (static): t-34_1942 - 2.1 m below ground at (945,-746) |
| hungary_forest-1945 | blocked | 2 | 17 | 1 | 9 | weapon-script-ok-but-not-in-table (static): Tas_APCR - TasGunBarrel_APCR: objects/Vehicles/Land/Tas_HF/Sounds/TasCannon.ssc |
| moscow_outskirts-1941 | blocked | 3 | 11 | 0 | 5 | land-model-draws-nothing (static): Pak36mobile - 0 triangles; the geometry templates its tree names are not declared: Pak36_barre |
| battle_of_foy | blocked | 0 | 3 | 0 | 262 | weapon-script-ok-but-not-in-table (static): M4A1(76mm)_AP - M4A1(76mm)GunBarrel_AP: objects/Vehicles/Land/M4A1(76mm)/Sounds/M4A1(7 |

## Blockers

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| render-white-magenta-black | render | 13 | - | audit_render.mjs / extract_all.py / extract_maps_all.py | Bunker_Turret_FT17; Pak43_41; Pak43_41_APCR | 0 px, white 0%, magenta 0%, black 0% |
| untextured-texture-in-install-but-unresolved | static | 5 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | texture/Schmei_r; texture/Lionfish_Hull01_H ; texture/o_bunker_conc1_a | 12 material(s) in 12 glb: FMGermanSoldier16__RandomGerSeizedSMG10.pose.glb, FMGermanSoldier16__RandomGerSeized |
| texture-opaque-white | static | 2 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | textures/fe/fed93074e20cf9691c5a451e1b82a9c6.webp; textures/91/91ad6356902a1ebc8c318069d164a147.webp | bf1942/levels/Battle_of_Antarctica/Texture/Telemark_factory_E_DA.dds 256x256; used by 1 glb: scene.glb |

## Major

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| weapon-script-ok-but-not-in-table | static | 286 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | Bunker_Turret_FT17; 2us_assaultgarandheatenerga; 3us_att20e2grenadem9a1 | FT17Cannon: objects/Vehicles/Land/FT17_BF1918/Sounds/FT17Cannon.ssc |
| menu-levels-missing-level | completeness | 265 | 265 | extract_hud_mods.py | berlin-1945 (berlin-1945); battle_of_antarctica (battle_of_antarctica); ramelle_neuville-1944 (ramelle_neuville-1944) | the level is in the mod's own levels folder but not in the Instant Battle list |
| level-not-extracted | completeness | 254 | 254 | extract_maps_all.py | 203_hill-1904 (203_hill-1904); 226 (226); 3rd_solomon_sea (3rd_solomon_sea) | the mod's own level archive ships it and the tree has no baked scene for it |
| level-dir-without-scene | completeness | 196 | 196 | extract_maps_all.py | 203_hill-1904 (203_hill-1904); 226 (226); 3rd_solomon_sea (3rd_solomon_sea) | a level directory with files but no scene.json (an interrupted bake) |
| land-model-draws-nothing | static | 148 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Nashorn_APCR; SextupleBofors; Panzerjager1c | 0 triangles; the geometry templates its tree names are not declared: Nashorn_Gun_barrel, Nashorn_Gun_shield, N |
| report-template-in-install-but-unresolved | static | 34 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | YahagiDaihatsuSpawner; AganoDaihatsuSpawner; NoshiroDaihatsuSpawner | 6 model(s): Yahagi_1943, Yahagi_1943.cockpit, Yahagi_1944, Yahagi_1944.cockpit, Yahagi_1945 |
| air-model-draws-nothing | static | 33 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | EntrySpawnObject64; EntrySpawnObject65; EntrySpawnObject66 | 0 triangles; the geometry templates its tree names are not declared: ratte_88_dummy_m1 |
| viewmodel-textures-missing | static | 25 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | GermanSoldier__M18_57mm_RLR; GermanSoldier__M18_57mm_RLR_Canister; GermanSoldier__M18_57mm_RLR_HE | texture/M18RR_Cart,texture/M18_57mm_RR,texture/PseudoShad |
| ship-off-waterline | static | 24 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | hornet(2) (battle_of_antarctica); Yamato1944 (monster_des_stahles); Kii (monster_des_stahles) | y 18.9, water 20.0 |
| engine-script-ok-but-no-layers | static | 22 | - | extract_map.py (sounds layer) / extract_vehicle_sounds.py | AMD35; Ark_Royal; ArkRoyal | objects/Vehicles/Land/AMD35_FHT/Sounds/AMD35Engine.ssc |
| kit-item-no-viewmodel | static | 11 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | 5German_EngineerK98AmmoInfantryAT; 1Rus_AssaultAS44; 3German_AT_WinterGeballteLadung | VolkssturmSoldier__GeballteLadung |
| emplacement-model-draws-nothing | static | 8 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | AApod_Nambu92; AApod_Nambu92_Deploy; Bren_PrayingMantis | 0 triangles; the geometry templates its tree names are not declared: SW_AAMGbase_tripodX_m1, SW_AAMGbase_tripo |
| land-no-collision | static | 5 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Bunker_Turret_FT17; ISU152; ISU_APC_SP66 |  |
| soldier-nation-unknown | static | 5 | 4 | extract_loadouts.py / extract_map.py / extract_kits.py | VolkssturmSoldier (berlin-1945); TurboWrenchJapaneseSoldier (monster_des_stahles); TurboWrenchUSSoldier (monster_des_stahles) |  |
| soldier-spawn-floating | static | 4 | 3 | extract_maps_all.py / extract_map.py / bf42/level.py | unnamedspawn1 (berlin-1945); unnamedspawn2 (berlin-1945); unnamedspawn29 (battle_of_antarctica) | 12.7 m above ground at (1774,-1646) |
| land-no-seats | static | 4 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Bunker_Turret_FT17; ISU152; ISU_APC_SP66 |  |
| bolt-rifle-no-bolt-clip | static | 4 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | GermanSoldier__GarandSniper; GermanSoldier__NagantRevolver; RussianSoldier__NagantRevolver |  |
| control-point-spawn-group-empty | static | 3 | 3 | extract_loadouts.py / extract_map.py / extract_kits.py | germancanalfartemplate (berlin-1945); bridge (ramelle_neuville-1944); SeaPointTemplate (midway-1942) | group 5 |
| sea-model-draws-nothing | static | 3 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | M4A3(75)Sherman; Panjandrum; ToyKGV | 0 triangles; the geometry templates its tree names are not declared: toy_KGV_R1_B, toy_KGV_R1_T, toy_KGV_R2_B |
| spawn-template-no-model | static | 2 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | timelimitedspawn82 (battle_of_antarctica); timelimitedspawn78 (battle_of_antarctica) | spawner ge_fortsoldierspawn82_spawner cp None |
| vehicle-seat-spawn-no-model | static | 2 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | timelimitedspawn82 (battle_of_antarctica); timelimitedspawn78 (battle_of_antarctica) | timelimitedspawn_soldierspawn82 |
| spawner-vehicle-unresolved | rules | 2 | 1 | extract_all.py / extract_map.py | timelimitedspawn78 (battle_of_antarctica); timelimitedspawn82 (battle_of_antarctica) | objectSpawns names a vehicle that is in no models.json entry, no kit pickup and no node of the level's scene.g |
| level-kit-unresolved | static | 2 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | 2German_AssaultK98HEAT40 (pakfront); 2Rus_AssaultNagantHEAT41 (pakfront) | team 1 slot 1 |
| loadout-kit-not-in-kits-json | rules | 2 | 1 | extract_kits.py | 2German_AssaultK98HEAT40 (pakfront); 2Rus_AssaultNagantHEAT41 (pakfront) | the level deals a kit kits.json lacks (--maps missing from extract_kits.py?) |
| level-template-defined-not-baked | static | 2 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | radioger (hungary_forest-1945); waldwind (hungary_forest-1945) | SimpleObject |
| texture-opaque-black | static | 2 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | textures/2a/2ae45818ae62588ad5ca6e5012104dc2.webp; textures/b0/b020d06a41ecbc42a009b41c517d5ddc.webp | texture/1p_TankAimGR.dds 32x32; used by 2 glb: effects.glb, scene.glb |
| minimap-icon-file-missing | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | PenetrateExplosion36cmVisible; SS_Bdoor | minimap_icon_artyshellbattleship |
| control-point-floating | static | 1 | 1 | extract_maps_all.py / extract_map.py / bf42/level.py | germancanalfartemplate (berlin-1945) | 25.3 m above ground |
| control-point-flag-not-baked | static | 1 | 1 | extract_loadouts.py / extract_map.py / extract_kits.py | undergroundbunker (berlin-1945) | flagge_m1 |
| spawn-buried | static | 1 | 1 | extract_maps_all.py / extract_map.py / bf42/level.py | t-34_1942 (pakfront) | 2.1 m below ground at (945,-746) |
| kit-worn-textures-missing | static | 1 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | Support_M2Flam | texture/M2flam |
| emplacement-no-weapon | static | 1 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | DeployedMortar |  |
| missing-_shared/hud/menu/menu-levels.json | completeness | 1 | - | extract_hud_mods.py | _shared/hud/menu/menu-levels.json | Instant Battle level list, nations, thumbnails [source: a mod tree carries its own hud pack]; present in 7/7 b |
| chain-template-not-extracted | completeness | 1 | - | extract_all.py | 353 of 4364 templates | the mod's chain defines them and models.json lacks them (extracted with --own?): 3inchATGunmobile_dummyRepairO |
| site-dossier-missing | completeness | 1 | - | scripts/extract_map_dossiers.py | 7 of 267 levels | tournament-images/dossiers/fhsw lacks: 3rd_solomon_sea, _texture_general, escape_from_leyte, july26-1945, oper |

## Minor (mod-wide and per level)

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| level-briefing-empty | completeness | 1 | 1 | extract_map.py | hungary_forest-1945 (hungary_forest-1945) | the archive ships Menu/Init.con |

## Accepted exceptions (review these)

| cause_key | gate | count | retail-faithful | evidence |
|---|---|---|---|---|
| air-model-draws-nothing-geometry-undeclared | static | 2 | True | as land-model-draws-nothing-geometry-undeclared |
| air-no-seats-never-placed | static | 32 | True | an aircraft no baked level places |
| cockpit-stick-deviation-applied | static | 6 | True | DEV-COCKPIT-IL2-STICK: IL2 control column authored 0.67 m ahead of and 0.25 m below the eye (every comparable FH aircraft: 0.27-0.42 ahead, 0.35-0.42  |
| emplacement-model-draws-nothing-geometry-undeclared | static | 8 | True | as land-model-draws-nothing-geometry-undeclared |
| emplacement-no-seats-never-placed | static | 74 | True | a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, `_unlimited` mounts): its seat is the host's |
| engine-script-unusable-in-install | static | 740 | True | the script is not in the install, or `#include`s a file the mod never shipped (Zuikaku includes ZuikakuEngine from a folder holding ShokakuEngine): si |
| engine-without-script | static | 584 | True | no `loadSoundScript` anywhere in the install's objects archives binds an Engine of the vehicle: silent in retail (carriers, remote-control bombers, gl |
| kit-icon-absent-from-install | static | 3 | True | the kit names an icon that is in no menu.rfa of the mod chain (Icon_ppsh_selected, Icon_TommygunUS_selected) |
| land-model-draws-nothing-geometry-undeclared | static | 7 | True | every geometry the vehicle's tree names is undeclared, so retail draws nothing for it either (FH's 45mmATGun; ledger GEO-1) |
| land-no-seats-never-placed | static | 152 | True | a land vehicle no baked level places |
| level-places-undefined-template | static | 13 | True | the level script `Object.create`s a name no ObjectTemplate.create defines; the engine places nothing too (Omaha's `beachsound`) |
| level-sound-wav-in-other-dir | static | 1 | True | the script loads `Sound/@RTD/x.wav` and the file ships only as `Sound/<rate>/Ambience/x.wav`; the engine does not search folders, so Gold Beach's 14 l |
| level-template-logic-not-baked | static | 31 | True | a ControlPoint/SpawnPoint/ObjectSpawner template of a mode layer the viewer does not play (SinglePlayer) |
| object-outside-world-authored | static | 4 | True | placed past the world's edge by the level script itself |
| object-outside-world-on-wrapped-terrain | static | 10 | True | past the heightmap's edge, at a height within 2.5 m of the wrapped terrain: the level was dressed on the wrapped ground, and the viewer draws and coll |
| object-stacked-duplicate | static | 35 | True | the level script places the same template twice at one position (editor leftovers); retail draws both too, the pixels are identical |
| report-geometry-undeclared | static | 54 | True | an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / _gun_base, |
| report-materialsWithoutShader | static | 9 | True | bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden (bf42/verify.py: nothing draws it) |
| report-template-not-in-install | static | 2045 | True | the geometry or template the model asks for is not in any archive |
| sea-no-seats-never-placed | static | 14 | True | a ship part no baked level places |
| spawn-floating-authored | static | 52 | True | the level's ObjectSpawns.con puts the spawner there (a bridge deck); the detail names the line |
| static-floating-authored | static | 816 | True | the level script's own `Object.absolutePosition` puts the object there, and the engine places a static exactly as written (no snap to the terrain): a  |
| texture-absent-from-install | static | 368 | True | the texture is not in any of the 1,541 .rfa archives of the install (every mod and level searched); retail draws these untextured too |
| texture-uniform-authored | static | 5 | True | a flat texture the game itself names for the purpose (notexture, black_o, e_richo_white_I) |
| untextured-generic-material-name | static | 10 | True | the shader is called `Material #N`, a name hundreds of `.rs` files share, so the glb cannot say which texture it wanted (here the Ju 88 cockpit, whose |
| untextured-texture-absent-from-install | static | 371 | True | a drawn material whose texture is in no archive of the install (sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it untextured too |
| uv-constant | static | 45 | True | authored: every vertex of the part carries one UV, so retail samples one texel too (a canopy, a gun mount); the glb reproduces the source |
| viewmodel-clip-absent-from-install | static | 26 | True | the first-person animation file the weapon names is in no archive (Binoculars' 1PFireBinoculars.baf) |
| weapon-script-unusable-in-install | static | 3088 | True | the gun's script, a file it includes, or every wav it plays is not in the install (coax1s.wav, jumplight.wav are in no archive) |

## Regression corpus

| Defect class | Status | Evidence |
|---|---|---|
| random-geometries-sound | pass | 4 templates have engine layers: ['GMC', 'Opelblitz', 'Zis5', 'Bedford'] |
| engine-script-candidates | pass | 2 templates have engine layers: ['B25', 'Ju52'] |
| stationary-guns-static | pass | stamped: ['Nebelwerfer@gold_beach-1944'] |
| engine-alpha-floor | pass | MASK |
| spelled-extension-texture | pass | 3 reports clean |
| missing-quote-texture-line | n/a | no live probe: guarded by audit cause / unit test |
| nan-uvs | n/a | no live probe: guarded by audit cause / unit test |
| bolt-operate-state-family | pass | 6 rigs have `bolt` |
| viewmodel-weapon-weld | n/a | no live probe: guarded by audit cause / unit test |
| rle-bottom-left-tga | n/a | no live probe: guarded by audit cause / unit test |
| v-is-coop-arms | n/a | no live probe: guarded by audit cause / unit test |
| object-script-spawn-groups | n/a | Omaha_Charlie is not baked in this tree |
| unable-to-change-team | pass | unable with finite timers |
| deployables-json | pass | 92 weapons, 88 objects |

## Verification steps

| Step | Status |
|---|---|
| v_outputs | pass |
| v_counts | pass |
| v_gz | pass |
| v_thumbs | pass |

## Residual human checks

Every level: first spawn feels right; vehicle handling and recoil feel; ambience mix against the real game.
* prokhorovka-1943: 3rd_ss unable point: spawns switch off while a Russian stands on it
* gold_beach-1944: push map: British beach spawn is the only one at the start, group 2 opens only when `front` falls; landing craft carry the British (LCT groups 67 and 74)
