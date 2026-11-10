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
| A seat state at speed 0 (a still pose) divided by zero and aborted the seat-pose pass; the engine holds frame 0 | b722d1870 `extract_pose.clip_timeline` | `tests/test_bf1918_extract_fixes.py` |
| `Font/BF1942.tga` is a 32-bit truecolour TGA; the `hud` step accepted 8-bit grey only | b722d1870 `bf42/font.py` | `tests/test_bf1918_extract_fixes.py` |
| A weapon clip animates `load3`, a bone its skeleton lacks; the rig builder raised. The engine poses only the skeleton's bones | b722d1870 `extract_viewmodel.py` | the `viewmodels` step |
| Nine levels keep their statics in `SP/MPStaticObjects.con` chosen on `game.gamemode`, and eight run `TrainGuideRails.con`, all from the root `StaticObjects.con`; the exporter read the root file alone, so they baked bare and the train had no rails. The host takes the MP arm | 3faae2fe5 `bf42/level.py`, `extract_map.py` | `tests/test_mode_statics.py` `HostGameModeTests` |

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
| `vehicleFoV` (trench periscope, scoped MGs) | 50 | `ObjectTemplate.vehicleFoV 0.2` | fixed in code (VIEW-16); live after the re-runs below |
| Bayonet ammo sharing | 19 rifles | `ObjectTemplate.WeaponLink 3`, the set-less spelling the console accepts; read only as `setWeaponLink` | fixed in code (FA-8, CON-15); live after the re-runs below |
| `destroyOnExit` on deployed mortars and MGs | 51 | `giveDamage(pco, 1e10)` on a player's own exit | fixed in code (SEAT-38); live after the re-runs below |
| Zeppelin L30, Lebaudy airships | 8 | VCLand, seven `c_ETPlane` engines, buoyancy from `FloatingBundle`s with a huge hull height, crew as separate PCOs | partly; to test |
| Horses and cavalry | 41 | FHSW's horses; bf1918 adds a jump (`HorseJump`, alt-fire recoil 320), a horn and a lance | mostly; jump and lance to test |
| Batteries (one gunner, 2-5 guns) | 34 | peer RotationalBundles on one seat; staggered `fireDelay` | partly; to test |
| PushCage kill zones | 12 | a `SupplyDepot` at -1000 hp inside a no-capture cage | likely; to test |
| Deep-water damage | 102 templates | `damageFromDeepWater`, `hpLostWhileDamageFromDeepWater` | not modelled (minor) |
| Soldier speed table | all | `Soldier.setForwardSpeed` and friends in `CommonSoldierDataSound.inc` | not read; whether retail applies them is open |

## 2026-11-10: three words the tree missed

### `vehicleFov`: the periscope and the scoped MGs (VIEW-16)

`ObjectTemplate.vehicleFov` sits on the PlayerControlObject. Retail's
`Camera::setVehicleFOV` puts it on the render view unchanged while a Camera
under that PCO is the view: radians of the whole vertical angle, the unit of
`renderer.fieldOfView 1` and of a hand weapon's `zoomFov`. It is a constant of
the seat, not a toggle, and the function tests no view mode, so the seat's
chase looks through it too (VIEW-16 says what is inferred about the caller).

| Template | `vehicleFov` | Degrees | Placed on |
|---|---|---|---|
| `Scherenfernrohr` (trench periscope, also an artillery `Marker` seat) | 0.2 | 11.5 | 34 levels |
| `MG08_MGZF` | 0.1 | 5.7 | 7 |
| `Maxima_M1910`, `Maxima_M1910_Graben` | 0.9 | 51.6 | 15 |
| `Stationary_Lewis`, `StationaryAA_Lewis` | 0.9 | 51.6 | none placed |
| four `Stationary_Rifleshild_*` | 0.6 | 34.4 | none placed |
| `Stationary_Villar_Perosa` | 0.95 | 54.4 | none placed |
| `SMSDresdenLookout`, `SuffrenLookout` (ship lookouts) | 0.2 | 11.5 | none placed |

Built: `bf42/con.py` reads `vehicleFov` (and `setVehicleFov`) into
`extras.physics.vehicleFov` on the PCO node; `viewer/seat-survey.js` puts it on
the seat; `viewer/seat-view.js` `vehicleFovDegrees` turns it into degrees;
`viewer/seat-camera.js` `seatFov` makes it the camera's FOV in every view of
that seat, manned gun, pilot or driver alike. A seat without it keeps 57.3.

Vanilla: no bf1942 vehicle writes it (GUN-6). XPack2's `WasserfallRocket`
writes 1.5 (85.9 degrees) and now gets it, which is retail.

### `WeaponLink`: the bayonet rifles share the rifle's rounds (FA-8)

19 BF1918 bayonet items (`M98Bajo`, `P1914Bajo`, `CarcanoBajo`, `MosinBayonet`
and the rest) write `ObjectTemplate.WeaponLink 3`, the property's registered
name; FHSW and XPack1 write `setWeaponLink`. The console answers to both
(CON-15), the reader read only the second. `con.py` now files `weaponLink`
under `setweaponlink` (`_OBJECT_TEMPLATE_PROPERTIES`), so the weapon's
`magazine.link` is 3 and `hand-weapon.js` `ammoFor` draws from the slot-3
rifle's magazines (`kit-ammo.js` `linked`), as FHSW's Garand bayonet does.
Kits and loadouts carry no link; the weapon glb and its first-person rigs do.

### `destroyOnExit`: a deployed mortar or MG goes when its gunner leaves (SEAT-38)

`PlayerControlObject::exit` ends, once the soldier is out, in
`giveDamage(pco, 1e10)` with no attacker on the PCO he left when its template
says `destroyOnExit`. The object dies as any destroyed object does.
`exitPlayer()` never reads the word, so the rule is for a player's own exit.
BF1918's `DeployedStokes`, `DeployedWerfer16` and `DeployedHotchkiss_MG` (stood
by `StokesDeploy`, `Werfer16Deploy` and `HotchkissDeploy`, 51 levels together)
and XPack2's `WasserfallRocket` write it.

Built: `con.py` `destroy_on_exit` -> `extras.physics.destroyOnExit`;
`extract_deployables.py` writes `destroyOnExit` on the object's row of
`deployables.json` (the page stamps it on a glb that predates the word);
`vehicle-instance.js` `leave(playerId, { exited })` calls `env.destroyOnExit`
after a player's own exit, which the human's E (`vehicle-entry.js`) and a bot's
dismount (`bot-referee.js` `leaveVehicle`, not when killed or at the round's
end) pass; `map.html` `destroyOnExit` ends a deployed object through
`deployables-page.js` (its armour's death effects, then gone) and any other
damageable with 1e10 through the world's damage pass, which wrecks it.

## How it was checked (2026-11-10)

- Unit: `test_con` (both `weaponLink` spellings; `vehicleFov` and
  `destroyOnExit` into the PCO's physics), `test_seat_view`
  (`vehicleFovDegrees`), `test_vehicle_instance` (an exit hands the hook the
  PCO once the player is out; a death or a plain seat does not),
  `test_con_words` (`destroyonexit` left the orphan table; `subpos`, which
  the tree already mentions, with it).
- Scratch extract (`extract_models.py --mod bf1918` into the scratchpad):
  `Scherenfernrohr.glb` and `MG08_MGZF.glb` carry `physics.vehicleFov` 0.2 and
  0.1 on the PCO, `DeployedStokes.glb` `physics.destroyOnExit`, `M98Bajo.glb`
  `extras.weapon.magazine.link` 3; `extract_deployables.py` adds
  `destroyOnExit` to the three deployed objects and changes nothing else.
- On the page (headless Chrome, broodseinde, the scratch `deployables.json`
  served over the live one, the live bake's nodes given the value the new
  exporter writes): `MG08_MGZF` 5.73 degrees inside and in the chase, the
  periscope 11.46 both, the plain `MG08_MG` 57.3, back to 57.3 on foot. A
  German who took the `Ger_Werfer` pad kit fired `Werfer16Deploy`, the
  `DeployedWerfer16` stood, he took its seat and pressed E: he stood on foot
  and the object was gone from `__deployables.placed()` and the scene, with no
  page error.

## What has to re-run in the bf1918 tree

| What | Templates | Step |
|---|---|---|
| `vehicleFov` | `Scherenfernrohr`, `MG08_MGZF`, `Maxima_M1910`, `Maxima_M1910_Graben`, `Stationary_Lewis`, `StationaryAA_Lewis`, the four `Stationary_Rifleshild_*`, `Stationary_Villar_Perosa`, `SMSDresden`, `Suffren` | models; and a full bake (the `scene` layer) of the 60 exported levels whose `scene.glb` places one of them, since a placed PCO's `extras.physics` is the bake's node, not the model glb (counted 2026-11-10 off the live `scene.glb`s: broodseinde, chateau-thierry, paternkofel, krakau, lodz, ... every row of `maps.json` that places them) |
| `WeaponLink` | the 19 `*Bajo` / `MosinBayonet` items (59 kits carry one in slot 2 beside the rifle in slot 3) | `patch_weapon_stats.py --mod bf1918`: its dry run on 2026-11-10 would patch 29 glbs (16 weapon glbs, 13 first-person rigs) and their reports |
| `destroyOnExit` | `DeployedStokes`, `DeployedWerfer16`, `DeployedHotchkiss_MG` | `extract_deployables.py --mod bf1918 --out viewer/models/mods/bf1918` (enough for the page); models for the glbs' own extras |
| XPack2 | `WasserfallRocket` (`vehicleFov`, `destroyOnExit`) | models in the xpack2 tree |

Then optimise and publish as the pipeline does.

## Open items

* The `Lb_SitInBench` seat state a `PassengerInWilly` seat names is in no
  BF1918 archive: 32 (soldier, seat) poses fall back. Mod data.
- The client's call site of `Camera::setVehicleFOV` was not traced: that the
  chase views keep the vehicle FOV rests on the function testing no mode and on
  `getTransformation` restoring it by hand in mode 17.
- Whether the mouse look slows with a seat's `vehicleFov`, as it does with a
  weapon's `zoomFov` (VIEW-10), was not read; the page does not slow it.
- Which other paths call `PlayerControlObject::exit` (a death in the seat, a
  seat switch): the page destroys on an E press and a bot's own dismount only.
- A deployed object's 3 s `timeToLiveAfterDeath` and 1 s fade are not drawn:
  `deployables-page.js` removes it at once, as it always has for the DC mortar.
- The replay's seat lens (`replay-camera.js` `SEAT_LENS`) does not read
  `vehicleFov`.
- Bots do not share magazines across a weapon link; only the human's hand
  weapon counts rounds that way.
