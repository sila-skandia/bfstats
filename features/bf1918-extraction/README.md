# BF1918: importing the WWI mod into the viewer (started 2026-11-10)

BF1918 3.4b (`Mods/bf1918`, chain bf1918 -> bf1942), 133 levels of its own, 112
of them with single-player (bot) data. Tree id `bf1918`:
`viewer/models/mods/bf1918`, `viewer/maps/mods/bf1918`.

## Budget

The owner gave this import at most **15 GB of the live volume** (30 GB free on
2026-11-10), bot-supported levels first (the pipeline's `--pick` order).

Measured on the first twelve bakes, after `optimise` moved the textures into
the shared store: a level is 15 to 81 MB on disk (`scene.glb` + `.gz` + `.br`
+ `scene.json`), 47 MB on average, a third of an FHSW level. The model tree is
343 MB and the tree's `_shared` 130 MB. All 112 bot levels come to about
5.5 GB, so the 21 levels without bot data fit as well if the owner wants them.

## Runs

| Run | Levels | Notes |
|---|---|---|
| 1 (pilot) | amiens, belleau_wood, Bombing_Albion, gallipoli, Kilimanjaro, winter_train, Galicia, passo_di_falzarego, toska_airbattle, suez_canal, falkland_islands, Siege_de_Maubeuge | chosen for spread: tanks, gas, train, Zeppelin raid, landing, mountains, air, desert, Africa |
| 2 | the other 100 levels with single-player data | `--behaviour-shards 4` |

All runs from a detached worktree; state file
`tools/bf1942-models/out/mod-pipeline/bf1918/state.json` in the main checkout.

## Defects found and fixed on the way

| Defect | Fix | Guard |
|---|---|---|
| A seat state at speed 0 (a still pose) divided by zero and aborted the seat-pose pass; the engine holds frame 0 | 29c07d3eb `extract_pose.clip_timeline` | `tests/test_bf1918_extract_fixes.py` |
| `Font/BF1942.tga` is a 32-bit truecolour TGA; the `hud` step accepted 8-bit grey only | 29c07d3eb `bf42/font.py` | `tests/test_bf1918_extract_fixes.py` |
| A weapon clip animates `load3`, a bone its skeleton lacks; the rig builder raised. The engine poses only the skeleton's bones | 29c07d3eb `extract_viewmodel.py` | the `viewmodels` step |
| Nine levels keep their statics in `SP/MPStaticObjects.con` chosen on `game.gamemode`, and eight run `TrainGuideRails.con`, all from the root `StaticObjects.con`; the exporter read the root file alone, so they baked bare and the train had no rails. The host takes the MP arm | 245cd2636 `bf42/level.py`, `extract_map.py` | `tests/test_mode_statics.py` `HostGameModeTests` |

The nine bare levels: basra, besika_bucht, cassino, fao_landing, krakau,
nuit_d_orage, vitry, ypern1914, ypres_streets. The train levels:
brusilov_offensive, chateau-thierry, galicia, gaza_town, gebirgspass,
ramskapelle, roye, sarikamis. Each is re-baked after the fix.

## Custom mechanics

From a census of the mod's scripts against the exporter and viewer
(2026-11-10). Most play-affecting first.

| Mechanic | Levels | How BF1918 builds it | State |
|---|---|---|---|
| Gas grenades | 22 | the round's ObjectSpawner stands an undrawn PCO whose `SupplyDepot` (radius 8, -3 hp) sits under a `RotationalBundle`; the exporter collected only direct-child depots, so no damage | in progress |
| Gas trench mortars (Livens) | 4 | the round stands `GasDamage`, a depot as a direct child (radius 12) | exported; not seen working in a page |
| Gas masks | 4 | team skins (`GerGas`, `EngGas`, `FrzGas`, `UsaGas`); no immunity in the data | works (`setTeamSkin`) |
| Flamethrower ground fire | 33 | material 256+ -> `e_FlamefuelGrnd` -> `e_BurningFlameEffect` (6 s) -> an ObjectSpawner inside the effect stands `FireDamage`, a depot under a rotator | in progress |
| Armoured train | 7 | a VCLand hull pushed by a `c_ETPlane` engine, held on invisible `*_Guide_m1` rails by sideways RollGrip springs; the cars are separate PCOs pushed by held 200 t `TrainPuller` couplers | in progress |
| `vehicleFoV` (trench periscope, scoped MGs) | 50 | `ObjectTemplate.vehicleFoV 0.2`; never read | in progress |
| Bayonet ammo sharing | 19 rifles | `ObjectTemplate.WeaponLink 3`, the set-less spelling the console accepts; read only as `setWeaponLink` | in progress |
| `destroyOnExit` on deployed mortars and MGs | 51 | answered, not built | in progress |
| Zeppelin L30, Lebaudy airships | 8 | VCLand, seven `c_ETPlane` engines, buoyancy from `FloatingBundle`s with a huge hull height, crew as separate PCOs | partly; to test |
| Horses and cavalry | 41 | FHSW's horses; bf1918 adds a jump (`HorseJump`, alt-fire recoil 320), a horn and a lance | mostly; jump and lance to test |
| Batteries (one gunner, 2-5 guns) | 34 | peer RotationalBundles on one seat; staggered `fireDelay` | partly; to test |
| PushCage kill zones | 12 | a `SupplyDepot` at -1000 hp inside a no-capture cage | likely; to test |
| Deep-water damage | 102 templates | `damageFromDeepWater`, `hpLostWhileDamageFromDeepWater` | not modelled (minor) |
| Soldier speed table | all | `Soldier.setForwardSpeed` and friends in `CommonSoldierDataSound.inc` | not read; whether retail applies them is open |

## Open items

* The `Lb_SitInBench` seat state a `PassengerInWilly` seat names is in no
  BF1918 archive: 32 (soldier, seat) poses fall back. Mod data.
