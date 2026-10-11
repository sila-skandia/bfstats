# Scorecard: FH (`fh`)

Generated 2026-10-11T11:33:40. Mod tier: **blocked**. Tiers fail closed: a gate that did not run, or is not installed, can only make a level `unverified`, never `ready`; an open blocker or major makes it `blocked`.

Levels: 0 ready, 0 ready-with-notes, 6 blocked, 0 unverified

## Gates

| Gate | Status | Findings | Detail |
|---|---|---|---|
| static | ran | 262 | reused static.json |
| render | ran | 0 | 117 frames (99 models, 6 levels) |
| behaviour | ran | 290 | rc=0 (reused) |
| completeness | ran | 71 | reused completeness.json |
| rules | ran | 1 | 6 of 6 levels read from the archives |
| corpus | ran | 0 | 9 pass, 5 n/a, 0 fail |

## Levels

| Level | Tier | Blocker | Major | Minor | Accepted | First reason |
|---|---|---|---|---|---|---|
| gold_beach-1944 | blocked | 0 | 6 | 4 | 2 | veh.gun-silent (behaviour): Nebelwerfer#seat0(Nebelwerfer) - 4 shots, no weapon voice live (weapons []) |
| iwo_jima | blocked | 0 | 56 | 14 | 3 | veh.no-engine-sound (behaviour): Bunker_Hill - engine audio null, engineControl Bunker_Hill |
| omaha_charlie-sector-1944 | blocked | 0 | 9 | 0 | 1 | asset.404 (behaviour): AltSpawn01 - 404 /models/mods/fh/Oma_arty.wreck.glb?t=1791678197569 / 404 /models/Oma_arty.wr |
| prokhorovka-1943 | blocked | 0 | 46 | 16 | 19 | veh.audio-not-built (behaviour): Ju87G - audio rack entry never built for a driven hull ({"built":false,"building":true," |
| road_to_ramelle | blocked | 0 | 50 | 11 | 9 | veh.steer-reversed (behaviour): CivTrck - D (right) turned the nose -0.18 along the old right vector |
| tarawa-1943 | blocked | 0 | 47 | 17 | 3 | veh.audio-not-built (behaviour): Ha-Go - audio rack entry never built for a driven hull ({"built":false,"building":true," |

## Major

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| kit.weapon-leaves-hands | behaviour | 84 | 4 | - | scout@t1:ArisakaCarbine (Iwo_Jima); assault@t1:KnifeAxis (Iwo_Jima); assault@t1:Arisaka (Iwo_Jima) | weapon node moved 16 cm from its rest pose in camera space while firing |
| level-not-extracted | completeness | 67 | 67 | extract_maps_all.py | a_day_of_zitadelle (a_day_of_zitadelle); aberdeen (aberdeen); adak_island (adak_island) | the mod's own level archive ships it and the tree has no baked scene for it |
| veh.audio-not-built | behaviour | 15 | 5 | - | Corsair-R (Iwo_Jima); G4M2-E (Iwo_Jima); Ha-Go (Iwo_Jima) | audio rack entry never built for a driven hull ({"built":false,"building":true,"engine":null,"engineControl":n |
| kit.weapon-no-fire | behaviour | 10 | 4 | - | scout@t1:Binoculars (Iwo_Jima); scout@t2:Binoculars (Iwo_Jima); scout@t1:Binoculars (Prokhorovka-1943) | trigger held 1 s: shots 0, rounds Infinity -> Infinity |
| veh.gun-silent | behaviour | 7 | 5 | - | Nebelwerfer#seat0(Nebelwerfer) (Gold_Beach-1944); Ha-Go#seat0(Ha-Go) (Iwo_Jima); MXY-7(Baka)#seat0(MXY-7(Baka)) (Iwo_Jima) | 4 shots, no weapon voice live (weapons []) |
| kit.weapon-not-raised | behaviour | 7 | 3 | - | engineer@t1:ArisakaCarbine (Iwo_Jima); engineer@t1:Type99MagneticATGrenade (Iwo_Jima); engineer@t1:RepairPack (Iwo_Jima) | selecting slot 3 left nothing in hand |
| spawn.not-on-ground | behaviour | 5 | 1 | - | house_spawnpoint_1 (Gold_Beach-1944); house_spawnpoint_3 (Gold_Beach-1944); bunkers_spawnpoint_1 (Gold_Beach-1944) | soldier spawn at 1399.0,49.3,-1256.5: feet 49.40 vs ground 45.34 |
| veh.no-wreck | behaviour | 4 | 2 | - | AltSpawn01 (Omaha_Charlie-Sector-1944); EastAxis (Omaha_Charlie-Sector-1944); WestAxis (Omaha_Charlie-Sector-1944) | destroyed but never wrecked after 2.5 s: {"wrecked":false,"destroyed":false,"pos":[0,0,0]} wrecks=[{"owner":14 |
| asset.404 | behaviour | 3 | 1 | - | AltSpawn01 (Omaha_Charlie-Sector-1944); KettenKrad (Omaha_Charlie-Sector-1944); Mortar (Omaha_Charlie-Sector-1944) | 404 /models/mods/fh/Oma_arty.wreck.glb?t=1791678197569 | 404 /models/Oma_arty.wreck.glb?t=1791678197569 |
| veh.immobile | behaviour | 2 | 2 | - | Ha-Go (Iwo_Jima); Kurogane (Tarawa-1943) | full throttle 6 s: moved 0.0 m, speed 0.5 m/s |
| veh.no-engine-sound | behaviour | 1 | 1 | - | Bunker_Hill (Iwo_Jima) | engine audio null, engineControl Bunker_Hill |
| air.roll-reversed | behaviour | 1 | 1 | - | MXY-7(Baka) (Iwo_Jima) | ArrowRight (roll right) moved the roll by 0.1612, expected sign -1 |
| air.no-throttle | behaviour | 1 | 1 | - | TB3 (Prokhorovka-1943) | full throttle 3 s on the ground: moved 0.9 m |
| veh.gun-no-fire | behaviour | 1 | 1 | - | TB3#seat0(TB3) (Prokhorovka-1943) | trigger held 1.5 s: shots 0; fireArms 1 |
| veh.steer-reversed | behaviour | 1 | 1 | - | CivTrck (Road_To_Ramelle) | D (right) turned the nose -0.18 along the old right vector |

## Minor (mod-wide and per level)

| cause_key | gate | count | levels | owning script | examples | evidence |
|---|---|---|---|---|---|---|
| kit.reload-no-response | behaviour | 39 | 4 | - | scout@t1:ArisakaCarbine (Iwo_Jima); assault@t1:Arisaka (Iwo_Jima); assault@t1:Mortar-G (Iwo_Jima) | R pressed after 1 rounds spent: rounds 4 -> 3, clips idle |
| kit.no-fire-clip | behaviour | 8 | 4 | - | scout@t2:M1Carbine (Iwo_Jima); medic@t2:Bar1918A1Semi (Iwo_Jima); engineer@t2:RandomMarineEngineer2 (Iwo_Jima) | arms clip never changed while firing (idle) |
| kit.weapon-no-fire | behaviour | 4 | 2 | - | medic@t1:SatchelGerShort (Prokhorovka-1943); medic@t2:SatchelBritShort (Prokhorovka-1943); engineer@t1:SatchelGerShort (Road_To_Ramelle) | trigger held 1 s: shots 0, rounds 2 -> 2 |
| veh.wreck-falls-through | behaviour | 3 | 2 | - | LVT4 (Iwo_Jima); Barkasse (Tarawa-1943); LVT4 (Tarawa-1943) | wreck settled 6.1 m below spawn |
| veh.pitch-reversed | behaviour | 2 | 2 | - | PanzerIVF2#seat0(PanzerIVF2) (Gold_Beach-1944); BT7#seat0(BT7) (Prokhorovka-1943) | pitch look delta moved the muzzle the wrong way (0 -> -1.8888888888888893) |
| veh.wheels-static | behaviour | 2 | 2 | - | UniversalCarrier (Gold_Beach-1944); KV1 (Prokhorovka-1943) | 4 wheel-named nodes, none rotated after 36 m |
| flag.not-captured | behaviour | 2 | 1 | - | The_Beach (Gold_Beach-1944); Frontline (Gold_Beach-1944) | team 1 soldier stood on the flag 40 s: owner stayed 2 |
| veh.yaw-reversed | behaviour | 2 | 2 | - | BT7#seat0(BT7) (Prokhorovka-1943); StuartM3A1#seat0(StuartM3A1) (Tarawa-1943) | yaw look delta moved the muzzle the wrong way (0 -> 2.0000000000000004) |

## Accepted exceptions (review these)

| cause_key | gate | count | retail-faithful | evidence |
|---|---|---|---|---|
| air-no-seats-never-placed | static | 11 | True | an aircraft no baked level places |
| emplacement-no-seats-never-placed | static | 27 | True | a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, `_unlimited` mounts): its seat is the host's |
| engine-script-unusable-in-install | static | 3 | True | the script is not in the install, or `#include`s a file the mod never shipped (Zuikaku includes ZuikakuEngine from a folder holding ShokakuEngine): si |
| engine-without-script | static | 26 | True | no `loadSoundScript` anywhere in the install's objects archives binds an Engine of the vehicle: silent in retail (carriers, remote-control bombers, gl |
| kit-icon-absent-from-install | static | 4 | True | the kit names an icon that is in no menu.rfa of the mod chain (Icon_ppsh_selected, Icon_TommygunUS_selected) |
| land-model-draws-nothing-geometry-undeclared | static | 1 | True | every geometry the vehicle's tree names is undeclared, so retail draws nothing for it either (FH's 45mmATGun; ledger GEO-1) |
| land-no-seats-never-placed | static | 2 | True | a land vehicle no baked level places |
| level-places-undefined-template | static | 2 | True | the level script `Object.create`s a name no ObjectTemplate.create defines; the engine places nothing too (Omaha's `beachsound`) |
| level-sound-samples-absent | static | 1 | True | the level object's sound script names a wav that is in no archive (Prokhorovka's radio_german1.wav) |
| level-sound-wav-in-other-dir | static | 1 | True | the script loads `Sound/@RTD/x.wav` and the file ships only as `Sound/<rate>/Ambience/x.wav`; the engine does not search folders, so Gold Beach's 14 l |
| level-template-logic-not-baked | static | 2 | True | a ControlPoint/SpawnPoint/ObjectSpawner template of a mode layer the viewer does not play (SinglePlayer) |
| object-outside-world-on-wrapped-terrain | static | 4 | True | past the heightmap's edge, at a height within 2.5 m of the wrapped terrain: the level was dressed on the wrapped ground, and the viewer draws and coll |
| object-stacked-duplicate | static | 19 | True | the level script places the same template twice at one position (editor leftovers); retail draws both too, the pixels are identical |
| report-geometry-undeclared | static | 19 | True | an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / _gun_base, |
| report-materialsWithoutShader | static | 3 | True | bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden (bf42/verify.py: nothing draws it) |
| report-template-not-in-install | static | 36 | True | the geometry or template the model asks for is not in any archive |
| sea-no-seats-never-placed | static | 1 | True | a ship part no baked level places |
| spawn-floating-authored | static | 1 | True | the level's ObjectSpawns.con puts the spawner there (a bridge deck); the detail names the line |
| static-floating-authored | static | 7 | True | the level script's own `Object.absolutePosition` puts the object there, and the engine places a static exactly as written (no snap to the terrain): a  |
| texture-absent-from-install | static | 16 | True | the texture is not in any of the 1,541 .rfa archives of the install (every mod and level searched); retail draws these untextured too |
| texture-uniform-authored | static | 6 | True | a flat texture the game itself names for the purpose (notexture, black_o, e_richo_white_I) |
| untextured-generic-material-name | static | 3 | True | the shader is called `Material #N`, a name hundreds of `.rs` files share, so the glb cannot say which texture it wanted (here the Ju 88 cockpit, whose |
| untextured-texture-absent-from-install | static | 17 | True | a drawn material whose texture is in no archive of the install (sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it untextured too |
| uv-constant | static | 11 | True | authored: every vertex of the part carries one UV, so retail samples one texel too (a canopy, a gun mount); the glb reproduces the source |
| uv-nan-degenerate | static | 9 | True | the source .sm carries NaN texture coordinates, only on triangles of zero area: nothing is drawn from them |
| viewmodel-clip-absent-from-install | static | 11 | True | the first-person animation file the weapon names is in no archive (Binoculars' 1PFireBinoculars.baf) |
| weapon-icon-absent-from-install | static | 2 | True | the weapon names an icon that is in no menu.rfa of the mod chain |
| weapon-script-unusable-in-install | static | 17 | True | the gun's script, a file it includes, or every wav it plays is not in the install (coax1s.wav, jumplight.wav are in no archive) |

## Regression corpus

| Defect class | Status | Evidence |
|---|---|---|
| random-geometries-sound | pass | 4 templates have engine layers: ['GMC', 'Opelblitz', 'Zis5', 'Bedford'] |
| engine-script-candidates | pass | 2 templates have engine layers: ['B25', 'Ju52'] |
| stationary-guns-static | pass | stamped: ['Nebelwerfer@gold_beach-1944', 'Nebelwerfer@omaha_charlie-sector-1944', 'Nebelwerfer@road_to_ramelle'] |
| engine-alpha-floor | pass | MASK |
| spelled-extension-texture | pass | 3 reports clean |
| missing-quote-texture-line | n/a | no live probe: guarded by audit cause / unit test |
| nan-uvs | n/a | no live probe: guarded by audit cause / unit test |
| bolt-operate-state-family | pass | 5 rigs have `bolt` |
| viewmodel-weapon-weld | n/a | no live probe: guarded by audit cause / unit test |
| rle-bottom-left-tga | n/a | no live probe: guarded by audit cause / unit test |
| v-is-coop-arms | n/a | no live probe: guarded by audit cause / unit test |
| object-script-spawn-groups | pass | 19 carried spawns |
| unable-to-change-team | pass | unable with finite timers |
| deployables-json | pass | 8 weapons, 8 objects |

## Verification steps

| Step | Status |
|---|---|
| v_outputs | pass |
| v_counts | pass |
| v_gz | pass |
| v_thumbs | pass |

## Residual human checks

Every level: first spawn feels right; vehicle handling and recoil feel; ambience mix against the real game.
* gold_beach-1944: push map: British beach spawn is the only one at the start, group 2 opens only when `front` falls; landing craft carry the British (LCT groups 67 and 74)
* iwo_jima: landing beach 2 s capture; Marines spawn on LCT/LCI(R)
* omaha_charlie-sector-1944: Allied round opens on westallied/eastallied landing craft: they draw, move and a soldier can spawn on them; neutral beach flag needs two soldiers
* prokhorovka-1943: 3rd_ss unable point: spawns switch off while a Russian stands on it
* road_to_ramelle: mg_nest one-way flag; CoOp-only barn spawn group
* tarawa-1943: Allies spawn only on ships (two destroyers, an LCT); pier ratchet
