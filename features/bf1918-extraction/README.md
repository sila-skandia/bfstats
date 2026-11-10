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
| Gas grenades | 22 | the round's ObjectSpawner stands an undrawn PCO whose `SupplyDepot` (radius 8, -3 hp) sits under a `RotationalBundle`; fixed in code (SUP-23, HP-22): the depot sweeps onto the cloud in 0.9 s; live after the re-runs below |
| Gas trench mortars (Livens) | 4 | the round stands `GasDamage`, a depot as a direct child (radius 12) | exported; not seen working in a page |
| Gas masks | 4 | team skins (`GerGas`, `EngGas`, `FrzGas`, `UsaGas`); no immunity in the data | works (`setTeamSkin`) |
| Flamethrower ground fire | 33 | material 256+ -> `e_FlamefuelGrnd` -> `e_BurningFlameEffect` (6 s) -> an ObjectSpawner inside the effect stands `FireDamage`, a depot under a rotator | fixed in code (EMT-14): an effect's spawners stand their objects; live after the re-runs below |
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

## Gas and the burning ground (2026-11-10)

Both are an undrawn PlayerControlObject whose damage is a `SupplyDepot`
hung 50 m up a self-turning `RotationalBundle` 50 m ahead of it. The gas
grenades' round stands `GasGrenadeDamage` (radius 8, 3 HP/s) through its
`GasGrenadeDamageSpawner`; the flamethrower's round (`material 256`) plays
`e_BurningFlameEffect` on the ground, whose own `FireDamageSpawner` stands
`FireDamage` (radius 5, 1 HP/s). The trench mortar's `GasDamage` carries its
depot as a direct child and needed nothing new.

What retail does, from the ledger:

| Question | Answer | Row |
|---|---|---|
| Where is a depot under a bundle? | At its own absolute position every cycle. BF1918's rotator pitches down at 100 deg/s to its -90 stop, so the depot starts 70.7 m off and 50 m up and sits on the object's origin from 0.9 s (inside the gas's 8 m from 0.81 s). The trick delays the damage about a second | SUP-23 (with GUN-2, GUN-20, MLK-17) |
| How long does the cloud live? | `hpLostWhileCriticalDamage` unwritten is 1.0 a second, and the spawner goes with its 4.05 s round, so the abandon clock (`TimeToLive 1`, then 1 a second with no spawner) bills a second HP a second. `GasGrenadeDamage` (25 at 25) lasts about 13 s, hurting from about 4.9 s to 17 s after the throw; the drawn `GasEffect` cloud (60 at 60) about 30 s. `FireDamage` (3 at 3) stands beside its live spawner, so it only bleeds: 3 s | HP-22, HP-17, SPAWN-13 |
| When do the grenade's objects appear? | `SpawnDelayAtStart 4` on a 4.05 s round. The pad law spawns the frame after the delay reaches 0 (SPAWN-11), the 122nd at 30 Hz, the frame the round dies; the page gives a dying round's spawners that frame. That retail does the same is inferred from the mod's own timing (without it nothing would ever stand), not read | SPAWN-11 |
| Does the fire need anything special? | An ObjectSpawner inside an EffectBundle is built with it and runs where it plays. A dedicated server plays no collision effect at all (`dedicatedServer`), so in retail the burning ground hurts only in a game that is its own server: single player, or a locally hosted round | EMT-14 |
| Do materials 256 and up reach the effect lookup? | Yes. `damage.json` keys attackers by string; row `256` against the ground is `e_BurningFlameEffect` (last-wins over `e_FlamefuelGrnd`) | IMP-2 |

What was built:

- `bf42/assemble.py`: `logic_object_record` walks through bundles to the
  depots under them (`_logic_children`), and a depot under a self-turning
  bundle carries `sweep`, its links with each bundle's `spin`
  (`_depot_record`, `bundle_spin`, `depot_offset_at`). Spawners and spawn
  points are still read from direct children only.
- `bf42/effects.py` keeps a bundle's ObjectSpawner children
  (`BundleNode.spawners`), and `bake_effect_library` writes them on the
  bundle as `effectBundle.spawners`, in the round record's shape.
- `viewer/round-spawners.js`: `depotOffsetAt` places a sweeping depot at
  each cycle; `onEffect` runs an effect's spawners for the bundle's
  `timeToLive`; a `drawn: false` object no level parked grows from a mould
  made on the spot (`level-statics.js` `logicMould`), so a hand weapon's
  round and an effect's spawner can stand one.
- `viewer/effects.js` `spawnersAt`, `round-impact.js` (a live hit only) and
  `map.html` `guns.onEffectSpawners` wire the fire in.
- The default bleed: `armor.js` `HP_LOST_WHILE_CRITICAL_DEFAULT`, read by
  `vehicle-damage.js`, `supply.js` `heldObjectLife` and
  `deployables-page.js` (the human's `GasEffect` cloud).

Checked in the page (2026-11-10, amiens, headless Chrome on the worktree's
own server, the six gas glbs, amiens' `scene.glb` and `_shared/effects.glb`
patched into a worktree-only overlay of the asset links): a `Ger_Flamer`
burst at the ground 1.75 m ahead stood two `FireDamage` 1 s after the hits,
each 3 s, a second pair at 4-6.5 s, and none after the bundle's 6 s; the
man lost 30 -> 22.5 HP, 1 HP/s a fire. A `Hand-Gasbombe` at his feet stood
`GasGrenadeDamage` and `GasEffect` at 4 s; his HP fell from 5.3 s at 3 HP/s
and he died at 11.5 s; the damage object went at about 16 s, the cloud at
about 31 s. Parked pool nodes of both bleed while parked and are passed over
once destroyed; the pool grows a fresh one.

Tests: `tests/test_bf1918_area_damage.py` (the extractor, from the mod's own
words), `test_round_spawners.py` `EffectSpawnerTests`, `test_supply.py`.

To publish: `patch_round_spawners.py --mod bf1918` (the six gas grenade
glbs, their poses and viewmodels, and the kit nodes of 15 exported level
scenes: 37 glbs, measured with `--dry-run`), and `extract_effects.py --mod
bf1918` for `_shared/effects.glb` (three bundles carry the spawner:
`e_BurningFlameEffect` and the two that nest it). No scene layer changes.
Vanilla, FH, DC Final and EoD gain nothing from the patch (`--dry-run`: 0
glbs).

Open:

- `GasEffect` and `GasGrenadeDamage` are stood from the nodes the level
  parked for its kit nodes, so a level whose `scene.glb` was not patched
  stands a `GasGrenadeDamage` with no depot: the patch must reach the
  scenes as well as the models. A level with no kit node carrying a gas
  grenade parks no `GasEffect`, and then no cloud is drawn (the damage
  still stands, from a logic mould).
- `deployables-page.js` placed nothing for the human's throw in the page
  check (`__deployables.placed()` empty); round-spawners stood the cloud.
  Not looked into.
- `GasDamage` (the trench mortar) is 20 at 19.9 and starts above its
  threshold, so it lives until `hpLostWhileUpSideDown` or a hit takes it
  under; the page does not bill the upside-down rate on a stood object.
- `Exploding_steel_barrel1`'s 4 HP armour tier plays `e_BurningFlameEffect`
  four times, and `e_Barrel_Explosion` nests it; the page's armour tiers do
  not run an effect's spawners yet (`Game::playEffect` has the same
  `dedicatedServer` gate, EMT-14).
- When exactly an EffectBundle is destroyed after its `timeToLive` was not
  traced (EMT-14); the page ends the spawner at the `timeToLive`.

## Whistles, bells, wire, speeds and coats (T1's rows, 2026-11-10)

Five of tester T1's rows (`t1-cavalry-infantry-findings.md`), fixed by engine
rule, none by a BF1918 case.

* **The officer whistle and `BottleHeal` throw their round (SUP-27).** The page
  took any hand weapon whose AI entry says `healing 1` for a medic bag, so the
  whistle ran `useMedPack`'s branch, spent its round on nothing and threw no
  `Officer-Ger-Kiste`. The engine picks the packs by template name
  (`BFSoldierTemplate::init` keeps the ids of `MedPack` and `RepairPack`;
  `handleMessage` compares). `kit-loadout.js` `healingPackKind` now does the
  same. The whistle's child `Officer-GerAlt` (a `velocity 0`, `timeToLive 0`
  placeholder) was dropped by `gun-groups.js`' placeholder guard; an alternate
  fire on `c_PIAltFire` is kept now, so the right button blows the whistle
  (its own `.ssc`) instead of toggling a zoom the whistle has no sight for.
  Checked on gebirgspass (`Kuk_Officer3` pad kit, 10 HP, Steyr emptied):
  `shots` 0 -> 1 0.4 s after the press, the round stood its two depots
  (35 -> 37), HP 10 -> 30, the Steyr 0 -> 3 magazines; the right button fired
  the blast (`alt.shots` +1) and left `zoomed` false. `BottleHeal`: `shots`
  +2 over three presses, its depot stood each time.
* **Projectile-less FireArms are exported (FA-25).** `bf42/assemble.py` built a
  FireArms' muzzle and extras only with a `projectileTemplate`; the bell
  (`bicycle_bell`), vanilla's four horns and BF1918's twenty never reached a
  glb. A plain FireArms with none is kept now (`projectile` absent), and the
  page keeps its group and fires it as a sound. A HandFireArms with none (the
  packs) stays out. BF1918's `AimSound` (the rifles' shouldering sound, a
  projectile-less FireArms on `c_PIAltFire`) rides along: `hand-alt-fire.js`
  marks such a child `soundOnly`, it plays on the press and the press still
  reaches the rifle's zoom; its 1 s cycle holds the rifle's trigger (FA-11),
  which is what the engine's rule gives.
* **Deployed wire is wire, not a wall (OBS-2..OBS-6).** The pioneer's
  `BarbWire5` comes out of the level's parked pool as a moved owner, and
  `WorldCollider.sweepSphere` dropped `passObstacles` before it swept the
  moved owners, so its triangles stopped the soldier while the owner-level
  check billed him. The flag now holds through the moved pass, and
  `CollisionIndex.addOwner` tags an Obstacle's triangles when a wire is grown
  into the index instead. Checked on gebirgspass (`KuK_Engineer`, slot 5):
  run through the coil at 6.1 m/s, slowed on the touch tick, billed 5 HP
  once, through and out the far side; before, a dead stop 1 m in.
  `tests/test_obstacle.py` walks the same coil placed, added and moved.
* **The `Soldier.*` globals (PHY-40..PHY-43, CS-15).** `bf42/con.py` reads
  `Soldier.setForwardSpeed`, `setStrafeSpeed`, `setWalkSpeedFactor` and
  `cameraShakeFactor` into one engine-wide record; `extract_pose.py` writes it
  resolved as `gaits.json` `soldierBody.movement` (absent for vanilla);
  `foot-body.js` writes it into `soldier-locomotion.js`' tables in place, so
  the human and the bots both move by it, and sets the bob's global.
  Gebirgspass with the patched `gaits.json`: forward 6.13, back 3.04, strafe
  3.07 (PHY-34's cap is the not-forward slot, 3), walk 2.76, crouch 2.56 /
  1.28 m/s; `bobUp` 0.047 m at a run where it was 0.
  `setMoveAccelerationDeacceleration` is no BF1942.exe command and is not read.
  The animation bands (`gait-select.js`, `remote-gait.js`) keep vanilla's
  speeds: a clip choice, not a speed.
* **A model glb walks its random children (KIT-2, LOAD-6).** `extract_models`
  starts the counter at 0 per model, so a horse's body, harness and eight
  legs take consecutive variants (`Random1..10`) and the authors' ordering
  gives one coat; before, every part was variant 1 and a horse wore seven
  coats. A level bake already rolled per placement (gebirgspass' four parked
  `Horse_spear`s wear coats 7, 6, 5, 4, each whole). Side effect: a BF1918
  soldier model's head and body now draw variants 1 and 2 (they were 1 and 1);
  kits and first-person rigs do not use the counter. A start per spawned
  horse would need every coat in the glb and is not done.

What has to re-run (bf1918 tree unless named):

| What | Step |
|---|---|
| bell and horns, `AimSound` | models for the vehicles in the folders whose `Weapons.con` declares a projectile-less FireArms (`Bicycle_albelt`, `Barkasse`, `Daimler_Truck`, `Dennis`, `FordT`, `Frz_Bus`, `HotchMit`, `Minerva`, `RenaultTaxi`, `RollsRoyce`, `Simplex`, `Sulky`, `Austin`, `Austin2s`, `Autocarmg`, `Autocarsup`, `Puggy`, `Puggy37`) and every hand weapon under the ten folders that `addTemplate AimSound` (`Carcano`, `M98`, `P1914`, `Berthier`, `Lebel`, `MosinNagant`, `K88`, `Mannlicher93`, `SMLE`, `Arisaka`); viewmodels (first-person rigs) of those rifles; a full bake (`scene` layer) of every exported level that places one of those vehicles (ypres_streets, siege_of_antwerp, aube_de_soiree, first_battle_of_arras, ypern1914 for the bicycle). Vanilla: models `Willy`, `Kettenkrad`, `Lynx`, and the scene layer of the levels that place them; XPack2: `HD_XA42`, `R75`, `Krupp`, `Willy` |
| `Soldier.*` globals | `extract_pose.py --mod bf1918 --die --out viewer/models/mods/bf1918/poses` (rewrites `gaits.json`; checked into a scratch copy) |
| horse coats | models for `Horse`, `Horse_spear`, `Cavalry_*` and the soldier models (the counter changes every model with two or more random children) |
| whistle, wire | page code only |

## Open items

* The officer whistle refills itself: its round's `OfficerGerSupplyDepot`
  serves ammo types 1 and 2, the whistle is `AmmoType 3`, but the exporter
  does not carry `AmmoType` (SUP-2), so the page serves an untagged item from
  any row. Retail gives one whistle a life unless another depot serves type 3.

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

## Held objects on a hull: the Kolossal's platform, the Zeppelin's gunners, the train's cars (2026-11-10)

Testers T3 F5 and T2 F5. Five of the Kolossal's twelve crew positions (the
`KolossalMgGunnerExtra` platform: four MGs and `KolossalCommander`) and two of
the Zeppelin L30's eight guns (`ZeppelinL30GunnerZusatz` twice) could not be
manned. Each is an object its hull's own `ObjectSpawner` holds (`holdObject 1`;
the Zeppelin file says why: no more than six PCOs). The hull's seat row leaves
a held object out (`seat-survey.js`, AI-121), and the rule that makes one a
vehicle of its own looked only under ships and statics. The armoured train's
three cars, 15 crew seats, were cut out the same way.

Retail is SPAWN-33 (AI-121, SPAWN-23 and SPAWN-30 with no host named): the
held object is an object of its own, put back at its spawner every frame with
the hull's own point speed, until its engine turns. Both mods' held crew carry
a dummy Engine with no input, so they ride for the hull's life.

What changed:

- `viewer/spawned-craft.js` `hullHeldCraftUnder`: under every hull of the
  level's `spawners` group except a ship, a nested PCO with a spawner stamp,
  mass and a door of its own is split off as a vehicle of its own, the hull its
  hold's host (`onHull`). A held object with no door stays (FHSW's attitude
  indicator, a map mark of its hull's), and so does a ship's held land vehicle
  (EoD's LCT: no land drive stands on a moving deck once let go).
- A car stood without a hold (`stood`) is the same, kept where it was stood on
  the locomotive and never let go by the throttle rule. That is the rigid ride
  the bake drew before, now with its own seats, guns, HUD, armour and map mark.
  The faithful coupling is still open (below).
- `hullHeldActive`, read by `level-statics.js` `vehicleSpawnActive`: on the
  hold, the object is in the world exactly while its hull is (a pad's
  other-side Kolossal not yet stood has its platform on it; a hull's cleared
  wreck takes it until the next one stands).
- `hull-bodies.js` `stepSinkingHulls` draws the held craft on every level, not
  only one that floats a ship. On a level with no ship the held craft were
  drawn on the body's tick pose, up to 0.2 m off a driven hull's drawn pose.
  `presentHeldCraft` also draws a craft whose drive outlived its crew.
- The room server takes the same craft (`detachSpawnedCraft` with
  `shipCraft: false` still leaves ships' alone); `server/held-craft.mjs` keeps a
  stood car on.

Checked: `tests/test_hull_held_craft.py` (synthetic hulls, and the real
Kolossal, Zeppelin, train and FHSW B-29 glbs); the held, deck, strip, pad and
seat suites unchanged. Headless page on port 5401: battle_of_the_giants, every
platform seat entered at its own door, its MG fired, the platform riding a
Kolossal driven 17 m at offset 0; amiens, both gondola gunners entered and
fired, riding the Zeppelin at its spawners; gebirgspass, all 15 car seats
entered, the cars riding the driven locomotive at their stood offset, 0 mm off
its drawn pose frame by frame.

Nothing to re-extract: the glbs already carry the `heldSpawner` stamps.

Open:

- The train's cars as free bodies pushed by the held `TrainPuller`s
  (features/bf1918-armoured-train "Open": a parked body against the static
  world, puller bodies with the holder pair filter). Until then a car does not
  lag on a bend, and a dead locomotive's cars go with its wreck instead of
  standing where they were.
- In retail a held object stays where its hull's wreck was removed (the
  spawner's `destroy` drops the hold, SPAWN-30); the page takes it with the
  wreck and brings it back on the next hull.
- A held object with no Engine is let go on its first frame in retail
  (AI-121); the page holds it. None of BF1918's has no Engine.
- The room server holds the craft at rest, not at the hull's point speed. Its
  vehicle table is built from pad rows only (`server/vehicle-table.mjs`), so a
  hull's held craft is held in the room's world but is no table entry: in a
  room it cannot be mounted and is not drawn (`stripSpawnedCraft` takes it off
  the hull's model), as before this change and as FH's flying-spawn craft.

## Sides, tanks, kit names and ticket flags (2026-11-10)

Four tester findings (T3 F1/F2, T1 F-kitnames, T4 F6/F8, T2 F11), one cause
each: the pipeline read BF1918 through WWII's tables.

**Sides are teams (SIDE-4).** `bf42/roster.py` named a side from a nation
label (`AXIS_NATIONS`), knew none of BF1918's soldier or kit tokens, and put
Italy and Japan on the Axis. The engine has only team numbers, so the roster
now records the team of every soldier a level dresses (`setTeamSkin`), every
template it spawns (`setObjectTemplate <team>`) and everything a kit carries
(`setKitTeam`); `sides` is those teams' (team 1 "Axis", team 2 "Allied", the
words the schools and the Range already use), and the nation table is only
the fallback. `models.json` rows gain `levelSides` (`{level: [sides]}`)
because a tree-wide side pairs nothing here: the A7V is team 1's on
Hindenburg Line and both teams' on Carriere. The BF1918 labels are added
(Austro-Hungarian, Ottoman, Bulgarian, Serbian, Romanian, Russian, ANZAC,
Belgian, Senegalese, ...). Roster diff over every template: vanilla, XPack1,
XPack2 unchanged; FH two (its unresolved `FMGermanSoldier`, now Axis);
Desert Combat, DC Final and EoD move their team-1 armies to "Axis" (SIDE-2).
The vanilla schools' arenas are identical.

**The tank school.** `tank-arena.js` `tankRow` takes BF1918's `HeavyTank`
and `LightTank` rows (not `UnarmedTank`), and `arenasFrom` (and the dogfight
school's) pairs by `sidesOn(row, level)`. Over the patched catalogue BF1918
offers 17 arenas: Hindenburg Line Mark IV v A7V, Aube de Soiree Chamond v
A7V, Battle of the Vosges FT-17 v Beute FT-17, Bocage, Chemin des Dames ...

**Kit names (KIT-7).** The deploy screen's row has two labels, both the
kit's: `setKitName` (`Kit/Strings/KitName<n>`) and `setKitActiveName`
(`Kit/Strings/ActiveKitName<n>`, the word beside the count: vanilla's
"ACTIVE SCOUTS"). BF1918 writes only the second, with its class names, so
`con.py` now reads it, `extract_loadouts.py` carries `kitActiveName` resolved
through the chain lexicon (all 383 bound kits resolve; umlauts survive:
UTF-16 lexicon, latin-1 .con keys such as `RESPAWN_SCHARFSCHÜTZE`), and the
deploy screen draws it beside the count. The row name of a kit with no
`setKitName` is blank, as `SpawnInterface::update` copies the empty string
(read in the Mac build; not yet in our BF1942.exe). EoD's "Active Riflemen"
and DC's "Active Heavy Assault" now show too.

**Ticket flags.** The briefing card, the chat rows and the replay's side
flag built `flag_ticket_<nation>` themselves; they now ask
`mapSurfaces.ticketFlag(team)` (`nation.js` `ticketFlagKey`), the soldier's
own `setTicketIcon` the in-game counter already used (HUD-11). Every BF1918
soldier a level fields has its `conp_*` in the pack; `GreekSoldier`,
`PolishSoldier` and `UkrSoldier` point at `flag_ticket_bel/pol/Ukr`, which
the mod does not ship, but no level dresses a side in them.

What must re-run in the bf1918 tree: `models` (the roster: `sides`,
`levelSides`, factions; `extract_models.py`, or the models step), `loadouts`
(`kitActiveName`), `kits` (`kits.json` `side` follows a kit's `setKitTeam`:
BF1918's Italian and Japanese kits read Allied) and `tank_school` (its
sheet, now with the BF1918 tanks).
`extract_pose.py --match-side` reads the same sides but no pipeline step
passes it. Every other tree picks up `levelSides` and the active names
on its next models and loadouts run; nothing breaks before then (the page
falls back to `sides` and the layout's strings).

Checked in the page (port 5403, the patched `models.json`, `loadouts.json`
and a `mods.json` with bf1918's counts served by request interception; the
live registry still counts bf1918 at 0 models / 0 maps, so `tanks.html?mod=
bf1918` falls back to vanilla until the registry step runs): `tanks.html?
mod=bf1918` opens on Bocage, Chamond / Schneider / FT-17 v A7V / Beute FT-17;
fao_landing's briefing shows the Ottoman and British flags with no 404; its
deploy screen reads "0 CombatPatrol / Regular / Medic / Officer / Pioneer"
(Entente: Patrol, Regular, Medic, Officer, Engineer); gebirgspass reads
Scharfschütze, Kaiserschütze, Richtschütze, Offizier, Kaiserjaeger (umlauts
drawn by the bitmap font) and the Russians' Metki-Strelok, Pekhotinec ...;
vanilla Kharkov's deploy screen is unchanged.
