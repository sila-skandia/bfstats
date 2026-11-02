# Scorecard: FHSW (`fhsw`)

Generated 2026-10-29T02:00:06. Mod tier: **blocked**. Tiers fail closed: a gate that did not run, or is not installed, can only make a level `unverified`, never `ready`; an open blocker or major makes it `blocked`.

Levels: 0 ready, 0 ready-with-notes, 0 blocked, 10 unverified. 1 open findings are on baked levels this run did not gate; they count toward no tier here

## Gates

| Gate | Status | Findings | Detail |
|---|---|---|---|
| static | ran | 1791 | rc=1 |
| render | ran | 1 | 1830 frames (1842 models, 140 levels) |
| behaviour | failed-to-run | 0 | rc=2, no JSON: on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-1942, fht_dinant-1940, In_The_Hell_ |
| completeness | ran | 15 | rc=1 |
| rules | ran | 4 | 10 of 10 levels read from the archives |
| corpus | ran | 0 | 8 pass, 37 n/a, 0 fail |

## Levels

| Level | Tier | Blocker | Major | Minor | Accepted | First reason |
|---|---|---|---|---|---|---|
| in_the_hell_of_bocage-1944 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| eagles_nest-1946 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| simusyu_to-1945 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| tunis-1943 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| iron_monster | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| fht_conquest_of_java-1942 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| fht_dinant-1940 | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| warsaw_uprising | unverified | 0 | 0 | 0 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| operation_hailstone | unverified | 0 | 0 | 1 | 0 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |
| salerno-1943 | unverified | 0 | 0 | 0 | 3 | gate behaviour: failed-to-run (rc=2, no JSON:  on the volume; evict_levels.py restore): Eagles_Nest-1946, fht_conquest_of_java-194 |

## Blockers

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| render-white-magenta-black | render | 1 | - | audit_render.mjs / extract_all.py / extract_maps_all.py | BuildingSmokeIdleDark | 0 px, white 0%, magenta 0%, black 0% |

## Major

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| opaque-material-cutout-texture | static | 485 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | bf1942/levels/_TEXTURE_GENERAL/texture/GENERAL_RUS_AFRICA/T34-85_RearCog.dds; texture/GENERAL_US_PACIFIC/Fle_alfa_Z.dds; texture/GENERAL_RUS_WINTER/zi | 1 glb: desert_hill.skin.glb |
| bolt-rifle-no-bolt-clip | static | 51 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | AussSoldier__Deploy_Cavalry_Arisaka_HandFireArms; AussSoldier__Knife_CarcanoBayonet; AussSoldier__Knife_CarcanoBayonet_ID2 |  |
| report-template-in-install-but-unresolved | static | 7 | - | extract_all.py / bf42/assemble.py / bf42/rs.py | SubDummy_Spawner; independence_AIRSpawnerC; BunkerHillPlanesSpawner_Front_Deck | 40 model(s): I26, I26.cockpit, I54, I54.cockpit, I58 |
| kit-worn-textures-missing | static | 2 | - | extract_all.py / extract_kits.py / extract_viewmodel.py | US_MedicM1Carabine; US_MedicM1CarabineP | texture/undefined |
| chain-template-not-extracted | completeness | 1 | - | extract_all.py | 51 of 4142 templates | the mod's chain defines them and models.json lacks them (extracted with --own?): BorgwardIV, FritzXGuided, Gol |
| site-dossier-missing | completeness | 1 | - | scripts/extract_map_dossiers.py | 2 of 140 levels | tournament-images/dossiers/fhsw lacks: operation_a, scapaflow-1946 |

## Minor (mod-wide and per level)

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| level-briefing-empty | completeness | 1 | 1 | extract_map.py | operation_hailstone (operation_hailstone) | the archive ships Menu/Init.con |

## Accepted exceptions (review these)

| cause_key | gate | count | retail-faithful | evidence |
|---|---|---|---|---|
| air-no-seats-never-placed | static | 30 | True | an aircraft no baked level places |
| cockpit-stick-deviation-applied | static | 6 | True | DEV-COCKPIT-IL2-STICK: IL2 control column authored 0.67 m ahead of and 0.25 m below the eye (every comparable FH aircraft: 0.27-0.42 ahead, 0.35-0.42  |
| emplacement-no-seats-never-placed | static | 74 | True | a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, `_unlimited` mounts): its seat is the host's |
| engine-script-unusable-in-install | static | 14 | True | the script is not in the install, or `#include`s a file the mod never shipped (Zuikaku includes ZuikakuEngine from a folder holding ShokakuEngine): si |
| engine-without-script | static | 592 | True | no `loadSoundScript` anywhere in the install's objects archives binds an Engine of the vehicle: silent in retail (carriers, remote-control bombers, gl |
| kit-icon-absent-from-install | static | 5 | True | the kit names an icon that is in no menu.rfa of the mod chain (Icon_ppsh_selected, Icon_TommygunUS_selected) |
| land-no-seats-never-placed | static | 112 | True | a land vehicle no baked level places |
| level-sound-template-script-silent | static | 3 | True | the template's sound script parses to no sample, or to samples no archive holds (a commented-out patch, `Crickets_env_03.wav` shipped nowhere): retail |
| minimap-icon-absent-from-install | static | 1 | True | the vehicle names a minimap icon no menu archive of the chain ships (PenetrateExplosion36cmVisible's minimap_icon_ArtyShellBattleship): retail draws n |
| report-geometry-undeclared | static | 50 | True | an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / _gun_base, |
| report-materialsWithoutShader | static | 15 | True | bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden (bf42/verify.py: nothing draws it) |
| report-template-not-in-install | static | 68 | True | the geometry or template the model asks for is not in any archive |
| sea-no-seats-never-placed | static | 13 | True | a ship part no baked level places |
| texture-absent-from-install | static | 17 | True | the texture is not in any of the 1,541 .rfa archives of the install (every mod and level searched); retail draws these untextured too |
| texture-uniform-authored | static | 11 | True | a flat texture the game itself names for the purpose (notexture, black_o, e_richo_white_I) |
| untextured-generic-material-name | static | 4 | True | the shader is called `Material #N`, a name hundreds of `.rs` files share, so the glb cannot say which texture it wanted (here the Ju 88 cockpit, whose |
| untextured-texture-absent-from-install | static | 12 | True | a drawn material whose texture is in no archive of the install (sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it untextured too |
| uv-constant | static | 16 | True | authored: every vertex of the part carries one UV, so retail samples one texel too (a canopy, a gun mount); the glb reproduces the source |
| viewmodel-clip-absent-from-install | static | 171 | True | the first-person animation file the weapon names is in no archive (Binoculars' 1PFireBinoculars.baf) |
| weapon-script-unusable-in-install | static | 26 | True | the gun's script, a file it includes, or every wav it plays is not in the install (coax1s.wav, jumplight.wav are in no archive) |

## Regression corpus

| Defect class | Status | Evidence |
|---|---|---|
| random-geometries-sound | pass | 4 templates have engine layers: ['GMC', 'Opelblitz', 'Zis5', 'Bedford'] |
| engine-script-candidates | pass | 2 templates have engine layers: ['B25', 'Ju52'] |
| stationary-guns-static | n/a | Nebelwerfer and Type88 are placed in no local baked level; 2 on remote-only levels unchecked |
| engine-alpha-floor | pass | MASK |
| spelled-extension-texture | pass | 18 reports clean |
| missing-quote-texture-line | n/a | no live probe: guarded by audit cause / unit test |
| nan-uvs | n/a | no live probe: guarded by audit cause / unit test |
| bolt-operate-state-family | pass | 31 rigs have `bolt` |
| viewmodel-weapon-weld | n/a | no live probe: guarded by audit cause / unit test |
| rle-bottom-left-tga | n/a | no live probe: guarded by audit cause / unit test |
| v-is-coop-arms | n/a | no live probe: guarded by audit cause / unit test |
| object-script-spawn-groups | n/a | Omaha_Charlie is not baked in this tree |
| unable-to-change-team | n/a | Prokhorovka is not baked in this tree |
| deployables-json | pass | 99 weapons, 95 objects |
| hull-sunk-in-static | n/a | no live probe: guarded by audit cause / unit test |
| room-collision-primitives | n/a | no live probe: guarded by audit cause / unit test |
| static-out-of-any-world | n/a | no live probe: guarded by audit cause / unit test |
| lightmapped-lod-chain | pass | no lightmapped part ships a rung; 10 remote-only levels unchecked |
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
| pickup-only-kit-scope | n/a | no live probe: guarded by audit cause / unit test |
| spawn-in-combat-area-damage | n/a | no live probe: guarded by audit cause / unit test |
| menu-side-root-init | n/a | no live probe: guarded by audit cause / unit test |
| damage-table-keeps-level-rounds | n/a | no live probe: guarded by audit cause / unit test |
| level-kit-copy-weapons-modelled | n/a | no live probe: guarded by audit cause / unit test |
| bot-flies-bodiless-rounds | n/a | no live probe: guarded by audit cause / unit test |
| level-loadouts-row | n/a | no live probe: guarded by audit cause / unit test |
| worn-part-named-level-mesh | n/a | no live probe: guarded by audit cause / unit test |
| stock-items-not-asked-where-replaced | n/a | no live probe: guarded by audit cause / unit test |

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
