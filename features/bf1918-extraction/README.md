# BF1918: importing the WWI mod into the viewer (started 2026-11-10)

BF1918 3.4b (`Mods/bf1918`, chain bf1918 -> bf1942), 133 levels of its own, 112
of them with single-player (bot) data. Tree id `bf1918`:
`viewer/models/mods/bf1918`, `viewer/maps/mods/bf1918`.

## Budget

The owner gave this import at most **15 GB of the live volume** (30 GB free on
2026-11-10), bot-supported levels first (the pipeline's `--pick` order).

Measured on the final tree (run 5): all 133 levels, 4.7 GB of `scene.glb`,
1.8 GB of `.gz`, 0.8 GB of `.br` and 0.2 GB of `scene.json` and shared files;
the model tree 1.75 GB; 1.5 GB of new textures in the shared store. **9.7 GB
live in all**, 5.3 GB under the budget. A level is 15 to 81 MB, 47 MB on
average after `optimise`, a third of an FHSW level. The 21 levels without bot
data (run 3) fitted inside the budget, so all 133 went in.

The upload is the slow part on this Mac: one `kubectl exec` stream per unit,
eight at once, 0.4 to 1.5 MB/s in all on its Wi-Fi (the owner moved the laptop
nearer the access point at 13:00). nginx's `try_files` needs the plain `.glb`
beside its `.gz` and `.br`, so the raw scenes cannot be left out.

## Runs

| Run | Levels | Notes |
|---|---|---|
| 1 (pilot) | amiens, belleau_wood, Bombing_Albion, gallipoli, Kilimanjaro, winter_train, Galicia, passo_di_falzarego, toska_airbattle, suez_canal, falkland_islands, Siege_de_Maubeuge | chosen for spread: tanks, gas, train, Zeppelin raid, landing, mountains, air, desert, Africa |
| 2 | the other 100 levels with single-player data | `--behaviour-shards 4`; 12 failed on a mid-edit `NameError`, re-run |
| re-bake | the 16 levels the `run` fix changes | `--force-steps --only-steps levels` |
| 3 | the 21 levels without single-player data | baked while the GPU was lent to a filming session |
| 4 | all 133, `--force-steps` | the first round of fixes: class words, gas, fire, zoom, bayonets, destroyOnExit, the train |
| 5 | all 133, `--force-steps` | the testers' fixes; the tree published |

All runs from a detached worktree; state file
`tools/bf1942-models/out/mod-pipeline/bf1918/state.json` in the main checkout.

## Status (2026-11-10, 14:45)

All 133 levels baked by run 5 with every fix below. The pipeline's quick
behaviour check over all 133 (pass 3, four headless pages): **0 blockers**,
16 majors, all explained:

* 13 `asset.404`: vanilla HUD, fonts and pose index files absent on the Mac's
  partial local tree (production has them; `serve_viewer.py --remote-vanilla`
  is the fix, which the run's server predated).
* `veh.immobile` on `KolossalMgGunnerExtra` (straits_field): the held crew
  platform rides its hull by rule (SPAWN-33); the audit now says so
  (`veh.held-crew-rides`).
* `spawn.not-on-ground` tgw_stalemate `alliedbase_spawn5`: a rubble spawn the
  world tester stood on; accepted with evidence.
* `veh.no-engine-sound` `Caudron_BR` (mont_kemmel): **open**. Its engines are
  `c_ETRocket` on a `VCAir` hull and `aircraft.js` has no rocket engine, so the
  page classes it static.

**Live (16:40).** The tree is on the volume (9.7 GB) and `models/mods.json`
carries BF1918's counts (575 models, 133 maps, 1,236 poses; the live registry
was spliced, not replaced). Checked on play.bfstats.io on gebirgspass, amiens,
Galicia, belleau_wood, falkland_islands and toska_airbattle: the loading music
streams and the loading picture loads; the team tab switches; a spawn is
chosen and the soldier stands up (on falkland_islands on SMS Emden's deck);
he walks 3.5 to 18.6 m in 3 s; his rifle fires (Mannlicher or M98, one round
out of the magazine); standing on a flag takes it in 21 to 25 s (toska has two
`unableToChangeTeam` bases and nothing to take); with 12 bots, 7 to 12 of
them travel past 20 m in 90 s and bots take flags (Galicia: Stockpile and
Train_Wreck; belleau_wood: forester taken and retaken). No page errors.

Four adversarial testers (cavalry and infantry, air, armour and artillery,
naval and world) each took a quarter of the levels plus a theme; nine fix
agents fixed what they found. Their write-ups follow.

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

## Seat guns, doors and lance horses (2026-11-10)

Four tester findings (T3 F3, T1 F-mortar-aim, T4 F5, T1 F-lancer-team).

- **Seat guns wait out `fireDelay`** (FA-13). `gun-cycle.js` `advanceGroups`
  holds a seat gun's press pending and fires it `delayTicks(fireDelay)` after
  (the press's tick the first off the timer), held or let go; the fire timer
  then starts a tick late (`delayedFireCycle`). Only groups collected with
  `SEAT_GUN_OPTIONS.fireDelay` take it, so a hand weapon's wind-up stays
  `hand-fire.js`'s; bots fire seat guns through the same world tick. No
  vanilla vehicle FireArms writes the word. Page (world ticks after one press):
  mont_kemmel `Ger150er_Batterie` 9/0/20/23/6 for 0.3/0/0.7/0.8/0.2;
  somme_gasattack `GasTrenchMortar` 0/5/12/21/26/36 for 0/0.18/0.42/0.72/0.9/1.22,
  `3erWerfer16` 9/0/2; nebelberg's deployed Stokes (`fireDelay 1`) 29.
- **The deployed Stokes points where it was set down** (SPAWN-34). The barrel
  was right relative to the mortar; the mortar was wrong: `poseObject` stood it
  up the slope's normal, and on nebelberg's 48-degree hill it sat nose-up, so
  the barrel (60 degrees up its own front) leaned back. A placed object whose
  PCO says `hasMobilePhysics 0` (DeployedStokes, DeployedWerfer16,
  DeployedHotchkiss_MG) now stands at the spawner's point turned as the round
  left the hand, and does not fall (SPAWN-30, HP-21). Page: thrown facing -z
  the mortar faces (0, 0, -1), barrel (0, 0.87, -0.5), the round lands 97 m
  ahead; thrown facing -x, 90 m along -x.
- **Doors and barriers swing** (GUN-24). A seat whose only RotationalBundle is
  on a key input now has a rig (`vehicle-occupancy.js` `rigFor`), which leaves
  the mouse to the seat's view (`local-look.js`). A part a rig swings on a hull
  that never moved takes its collision with it (`WorldCollider.syncRigParts`,
  called from `world-vehicle-tick.js` when the rig moved). Page: bold_venture's
  `Bunkertuer` opens 16 degrees in the first second of Arrow Up and stops at
  90; a ray through the shut leaf's centre meets the door shut, passes open,
  and meets it again shut; the open leaf answers where it is drawn.
  montblainville's `Schranke1` lifts to 80 and back.
- **An abandoned lance horse stays its side's** (SEAT-27). `bf42/con.py`
  carries `dontClearTeamOnExit` on the PCO's `physics`; the last man out
  leaves a stamp (`VehicleRegistry.leave`), and the room server keeps it
  (`room-control.mjs`). Page, gebirgspass, with the word put on the horse at
  run time (the tree's glbs predate it): team 1 rides and gets off, team 2 is
  refused, team 1 takes it again; without the word team 2 rides off.

### To re-extract

- `dontClearTeamOnExit` rides the PCO node's extras, so every glb that
  carries one of these hulls: the model glbs of bf1918's `Horse_spear`,
  `Cricket`, `DepthChargeboot`, `Gnat`, `Gneisenau`, `M1uboot`,
  `M1ubootCannonPCO2`, `Minensuchboot`, `SMSDresden`, `SMSEMDEN`,
  `SSRiverClyde`, `Scarab`, `Scharnhorst`, `Seabase`, `SteamSchooner`,
  `Suffren`, `Wickes` and vanilla's `Enterprise`, `Fletcher`, `Fletcher2`,
  `Gato`, `Hatsuzuki`, `Hatsuzuki2`, `Hiryu`, `Hornet`, `PrinceOW`,
  `Shokaku`, `Sub7C`, `Yamato`; and, because placed hulls are baked into
  `scene.glb` (gebirgspass's four `Horse_spear` carry their `physics` there),
  the full `scene` bake of every exported level that places one. Nothing else
  changed in any extract.

### Open

- The round's own rotation in flight is not ledgered: SPAWN-34 rests on
  `deployables.js`'s reading that nothing turns a round with no response
  physics, so a Stokes thrown while looking down stands pitched down.
- A static deployed object is not lifted out of a slope it is stood into
  (retail's rule, SPAWN-28): on nebelberg's steep hill the Stokes stands
  4 m into the ground, as the spawner's point puts it.
- A shot still pending its `fireDelay` when the gunner leaves goes with the
  gun (`GunFire.release`); whether retail's FireArms fires it after the exit
  was not read.
- A level `ObjectSpawner`'s `teamOnVehicle` is still not stamped.

## The level's own copy, the sky box, the sun, the load music and the submarine (2026-11-10)

Five tester findings (T4 F1-F4, F9; T2 F7). Ledger LOAD-32..LOAD-34, LDPIC-3,
SUB-7.

| Finding | Retail | Changed |
| Ambience twice (42 levels, 1023 emitters) | The level's `Init.con` declares `water1`, `bird`, `voegel` ... before the mod's `objects/Ambiente/`, whose `create` then makes nothing (LOAD-1, LOAD-2): one placement, one emitter, the level's 10..40 m ramp (LOAD-32) | `bf42/level.py` `discover_level_sounds` step 4 skips a template the level's `Sounds/*.con` declares; `_find_template_sound_script` (`shadowed`) and `_level_sound_children` treat a level-declared child as the level's |
| Ramskapelle's sky is the cloud sheet | `Sky.initSky` instances the geometry template named `SkyBox` (client `0x005be800`, LOAD-33) | `parse_init_con` keeps each geometry template's file by name (first create wins) and takes `SkyBox`'s; the only one of 536 installed levels it moves |
| Montblainville has no sun | **Not a defect.** `SkyAndSun.con` creates `TSun` with no textures and makes the sun from it before `include Lenz.con`, whose re-create configures nothing (LOAD-1, LOAD-34). `lensFlare: null` is what retail shows | `read_init_script` splices `include` inline (montblainville and bf1919's White_Guard are the only users); a second `create LensFlare` now configures nothing. The scene output is unchanged |
| Galicia plays the mod's load music | The level's `Menu/Init.con` `setLoadMusicFilename` (LDPIC-3) | `extract_loading_assets.py` `level_load_music`, `transcode_music`: Galicia's row is `_shared/music/vehicle3.mp3` |
| M1uboot: no submarine HUD | BF1918's `menu/InGame` draws the gauges, periscope and deep view as vanilla's does | `extract_hud_layout.py`: a submarine group is every top that carries one of its pictures (BF1918 moves the cockpit picture to a top of its own) and repeats no leaf another group holds (the capture flag folded into the deep fade's SplitNode drew twice). Vanilla's layout is byte-identical to the live one; all eight other installed mods decode periscope 7 / depthFade 1 / submarine 14. BF1918's layout now differs from vanilla's, so its pack needs its own `hud-layout.json`. Locally the testers' page also read a stale vanilla layout (5 Nov) out of `~/.cache/bfstats-mesh-remote`, which has no submarine groups at all |
| M1uboot stopped under water freezes | A float whose angle term is not 0 wakes the hull before its sleep test (`0x0824d640` -> `0x0824da48`, SUB-7), so a held setpoint never sleeps | `viewer/ship-law.js` `shipTick` and `viewer/body-float.js` `step` wake on a non-zero float angle. Vanilla's Gato and Sub7C share the law. `M1uboot.cockpit.glb` 404s for the Gato too: neither LodObject has a cockpit alternative, and the deep view's cockpit is the HUD picture `cockpit_512x512` |

The "sinks straight through the setpoint" half of F9 is the probe's depth
measure: she came to rest at y 69.333, a float-plane depth of 21.97 m for a
21.5 m setpoint, which is SHIP-7's setpoint + 0.5.

### What has to re-run

| Change | Levels | Step |
| Ambience | the 42 BF1918 levels with a doubled emitter: amiens, aube_de_soiree, battle_of_bazargic, battle_of_halen, battle_of_jaroslawice, battle_of_leget, battle_of_liege, battle_of_mons, battle_of_struga, belgrade, bismarck_archipel, bold_venture, brusilov_offensive, champ_de_feu, champagne, chateau-thierry, dawnville, fort_bismarck, galicia, hindenburg_line, kolubara, kosovo, langemarck, liberation_of_roeselare, masuren, masurian_lakes, mont_kemmel, montblainville, morava_offensive, mughar_ridge, nebelberg, ramskapelle, roye, saint_quentin_canal, siege_de_maubeuge, siege_of_antwerp, tabuaeran, tolmezzo, tsingtao, villers_bretonneux, vitry, ypern1914 (no other published tree has one) | `patch_scene.py --layer sounds --mod bf1918 --all` (a scratch run over all 133 changed only `<x>_static` rows, exactly these) |
| Sky box | bf1918 ramskapelle | full bake (`scene` layer: the sky is in `scene.glb`), then optimise and publish |
| Load music | bf1918 Galicia | `extract_loading_assets.py --mod bf1918` (writes `_shared/music/vehicle3.mp3` and the row) |
| Submarine HUD | the bf1918 pack | `extract_hud_mods.py --mod bf1918`, which now keeps its own `hud-layout.json` |
| Dive wake | none | page code |

### How it was checked

Unit tests: `tests/test_level_declares_first.py` (one emitter for a
level-declared template and child, the sky by name, `include`, the second
flare create), `test_extract_loading_assets` (Galicia's cue),
`test_hud_layout.Bf1918SubmarineGroupTests`, `test_ship_dive` (the key wakes a
sleeping root; stopped under water she holds and climbs). Pages, headless, off
a scratch overlay of the shared tree (scratch sounds patch, ramskapelle bake,
loading run, BF1918 layout): Battle of Leget 48 `water1` + 33 `birds` and no
`_static`; Ramskapelle draws `Sky_Elala_m1` with its clouds; Galicia's loading
screen fetches `vehicle3.mp3`; on falkland_islands the M1uboot dived from rest
on Arrow Up alone, held 13.1 m (keel 19.0) stopped and awake, at 30.5 m showed
the deep view (the red cockpit picture framing the map) with the air
draining, and on Arrow Down climbed back to her surface draft (keel 7.85 m,
air refilling); at 13 m the periscope ring, bearing scale and depth tapes
draw. Montblainville's `lensFlare` stays null.

## Airships, flying boats and the air audit (2026-11-10, t2 F1/F4/F6/F8/F9/F10, Q1)

- **The Zeppelin's spawn groups** (F1, F8). `Vehicles/Air/ZeppelinL30/Objects.con`
  binds its own groups 41/42 to the Axis, and so does `Common/Objects.con` for
  the Felixstowes' AI seat groups 122/123: a `spawnPointManager` line in any
  `objects/` script runs at load like every console word (SPAWNGRP-14). The
  exporter now reads them (`extract_map.py` `TemplateIndex.spawn_groups`,
  `bind_object_spawn_groups`, laid under each layer in `scene_layers.py`).
  Amiens' Axis deploy screen shows two Zeppelin rings (gondola V and H), a
  spawn stands on each at y 149, and a respawned Axis bot is seated by the
  `setAIEnterOnSpawn` point and flies the airship (round 5 of forced
  respawns: bots pick a random own flag, the Zeppelin's is one of eight).
- **A dead airship climbed** (F4). The falling-wreck floor held every dead
  air hull at 30 m/s down; the Zeppelin's own box drag (drag 5, a 208 m
  envelope) and its up/down engine's propeller term at revs 0 pushed it up
  harder every tick, so it climbed at 7..13 m/s. The floor is now the hull's
  own flat-fall terminal speed where that is slower (`world-vehicle-tick.js`
  `fallSinkFloor`: Zeppelin 3.3 m/s, balloon 13.7, every plane checked 30),
  and a falling wreck's engines are stopped (PHY-14). Amiens: the Zeppelin
  goes down at 3.1 m/s; Ramskapelle: the balloon falls from 123 m and lands
  in 8 s. Not drawn: the burning `e_wreck_Zeppelin` hull (`ZeppelinFusWreck`,
  `gravityModifier 0`, 80 s), which no tree carries as a wreck glb.
- **Flying boats parked 7.5 m over the sea** (F6, SHIP-8). A hull with floats,
  no spring and its pad over water now rests at the float law's draft
  (`hull-bodies.js` `floatsOnTheSea`, `floatToDraft`): Bombing Albion's
  Felixstowe at 56.88 (was 62.52), taxis off at 46 m/s as before. Amiens'
  Hansa W29 (pad over land) is unchanged.
- **Toska Airbattle's French airfield** (F9). A control point whose two groups
  are both its owner's draws a ring per group at its points' mean and spawns
  on the clicked group alone (`deploy-spots.js` `offeredGroupSpots`,
  `spawning.js`, `world-players.js`; SPAWNGRP-4, SPAWNGRP-10): `Entente_Base`
  is now the base (294/84/-335) and the airfield (1738/83/-458), and group 3
  spawns at `frz_flugplatz_1`. Vanilla's one such case, Kasserine Pass
  SinglePlayer's `axis_base` (1 and 6, both Axis at the start), gets two
  rings too.
- **The audit's air checks** (Q1, F10). The level-flight release is 1.3 times
  the speed the airframe lifted off at on its own roll, within 30..70 m/s
  (`audit_verdicts.mjs` `releaseSpeed`), and "diverges" is a nose past 0.6
  through the last third of 15 s hands off, or 250 m lost in 7 s
  (`airDiverges`). Amiens: Caudron lifts off at 29, released at 37.7, nose
  0.29 after 15 s (was `air.diverges` from 70); Breguet 14, Albatros C3 pass.
  F10's deaths at 400 m were the combat area (`combatTick`, 5 HP/s after
  10 s outside, CA-2): the probes fly hands off from the pad for half a
  minute. The audit now suspends the bleed while an aircraft is tested and
  restores it after. F10's roll damage is a collision with the plane parked
  ahead (Montfaucon: Albatros C3 into the FokkerRed 15.5 m ahead, 6 HP, then
  51 HP off the ground it bounced onto), HP-6, not a page fault. F10 (c),
  Basra's AlbatrossC3Turk dying on entry, did not reproduce (entered, rolled
  6 s, no damage). Vanilla and FHSW planes were not re-run: their trees are
  not on this machine; a fighter lifting off at 54 m/s or more keeps its 70.

What has to re-run: `patch_scene.py --layer spawns --mod bf1918` for amiens,
battle_of_liege, bombing_albion, gaza_town, midway, tabuaeran and tobruk (or
`--all`; the other 126 do not change). The rest is viewer code.

## The quick behaviour check's pass 2, triaged (2026-11-10)

The pipeline's `audit_behaviour.mjs --quick` on the re-extracted tree raised
41 unaccepted majors over 62 levels. Most were the audit asking BF1918's hulls
for what their own data does not do. Each is now judged by the hull's data.

- **The armoured train's `veh.no-steer`.** Nothing of `ArmouredTrain_GILI`
  binds `c_PIYaw`: its guide rails steer it (`features/bf1918-armoured-train`,
  COL-25). `testGround` reads the hull's bindings (`__inputBindings()`, new in
  `test-hooks-vehicles.js`) and does not judge the turn of a hull that binds no
  yaw. Every car, horse, gun and tank of the mod binds one.
- **Marker seats' `veh.gun-no-fire`.** `Scherenfernrohr` seat 0, the Lebaudy's
  pilot and the lookouts of SMSDresden (seat 2) and Suffren (seat 5) fire a
  `magType 2` weapon (SPOT-1). The earlier check wanted a fresh marker owned by
  the player, but a pull that hits nothing lists one with no owner
  (`spotter.js` `place`). A seat whose guns are all marker weapons (the page's
  stats, or the tree's `vehicle-spotting.json` `markerWeapons`) now passes on
  any marker its press placed. Checked: fao_landing, toska_airbattle,
  falkland_islands, each with one marker placed, hit 0.
- **Airships' `air.pitch-dead` and `air.roll-dead`.** Each stick axis is
  judged by what binds its input (`audit_verdicts.mjs` `airAxisRole`). A Wing
  is judged on the turn. An Engine's throttle is judged on the push: the
  Lebaudy's c_PIPitch runs `LebaudyEngineupdown`, and it pushed the craft
  5.45 m over hands off in 2.25 s. A bundle carrying an engine passes on
  either: the balloon's hover bundle pushed it 8.1 m on pitch and 6.0 m on
  roll. An input nothing binds is not judged (the Lebaudy's c_PIRoll).
  `testAir` itself only calls `judgeAirControls`.
- **M1uboot's `veh.no-engine-sound`.** The static sound table was keyed one
  row per subject, so M1uboot's torpedo row replaced its engine row
  (`engine-script-unusable-in-install`). `staticSoundTable` keeps every row.
  It is accepted now.
- **`asset.404` on vanilla files.** All 14 were vanilla paths:
  `maps/_shared/hud/*`, the fonts, `models/poses/index.json` and
  `models/viewmodels/index.json`. This Mac's vanilla tree is four entries;
  mesh.bfstats.io serves all of them. The `GerSoldier__PassengerInWilly-SitInBench`
  requests were the page guessing a vanilla path because the vanilla pose
  index 404'd. With production's index the pair is not asked. The fix is in
  the server, not the audit. `serve_viewer.py --remote-vanilla` fetches any
  missing file outside `maps/mods/`, `models/mods/` and the registry
  `models/mods.json`, and the pipeline's servers use it for every tree but
  vanilla's (`mod_pipeline.py` `viewer_remote_args`). That is more faithful
  than marking the rows as environment: the page then runs with the HUD,
  fonts and poses production gives it, and a mod file its bake failed to write
  still 404s. The registry is excluded because production lists BF1918 with no
  maps, and a page given that registry opened vanilla's aberdeen in place of
  toska_airbattle.
- **`spawn.not-on-ground` on broodseinde.** `__soldier().ground` is the higher
  of the terrain and the sea. The two trench spawns stand on the terrain
  (73.57 and 73.20) in 1.4 m of the level's 75 m sea, as T4 found. The check
  now compares feet with the heightfield alone (`__heightfield`, new). A
  soldier wading over that floor (not `grounded` in the page, no fall) counts
  as standing.
- **`veh.off-its-pad` on TsarTankSpawn (+4.3 m).** The spawner stands the
  origin at the pad (SPAWN-28). The 9 m wheels reach under it and the terrain
  lifts the hull onto them. Its lowest part is 0.35 m into the ground at the
  pad. This is info `veh.lifted-onto-its-wheels` now (`__hullBottom`, new).
  Felixstowe_blau's +7.5 m was a real defect; it is fixed on main
  (`fix(air): ... a flying boat rests at its draft`).
- **`veh.steer-reversed` on 18pdr_france.** The gun's steering bundle is its
  trail wheel, 2 m aft. On D it swings the nose left for half a second
  (-0.17 rad) while the c_ETTank differential turns the gun right (+58 degrees
  over the press). Three runs agree. The verdict now takes the whole press,
  summed a quarter second at a time, and a hull D brings round right is not
  reversed. That is the data's own sign, not a defect.
- **`bots.stalled` on champagne.** Three of the four were in the Fire plan
  (urgency 5.2 to 6.6 against MoveTo 3). `createFirePlan` stands, turns and
  fires, and has no strafing (bot-behaviours.md section 3). A firing bot is
  holding now. The fourth, bot_6 in MoveTo, is a single minor `bots.stuck`.
- **`ship.immobile` on BarkasseTransport (tabuaeran, from T3).** Seven landing
  boats are moored 8 to 10 m apart at a beach, and the first pushes against
  the others at revs 0.22. Astern it moved 5.7 m in 5 s. The ship check now
  backs a held hull off before calling it immobile, as `testGround` does.
- **The Spad7's 65 HP on entry (toska_airbattle, from the air agent).** This
  was a page defect. The aircraft law dropped each wheel's col0 vertex 0, but
  BF1918's wheels are 24-vertex rings, and vertex 0 is at the axle's height. On
  boarding the main wheels hung 0.39 m up, and the plane fell onto its
  fuselage at 1.47 m/s on rock. `checkVsTerrain` tests every vertex of a
  layer with more than three (TANK-20). The law now stands each leg on its
  lowest (AIRGND-13). All three Spad7s keep their 90 HP and their parked
  height to the centimetre. El Alamein's Spitfires and BF109 (3-vertex
  wheels) are unchanged, and `test_air_law` is green. Vanilla's Il-2
  (26- and 30-vertex wheels) changes the same way, by the same rule.
- **Not fixed: `Caudron_BR` silent (mont_kemmel, from T3).** Its
  `CaudronEngine.ssc` is in `objects.rfa` and in the sound table. The page
  classes the hull `static`, because its two Engines are `c_ETRocket` (always
  at full thrust, PHY-20) on a `VCAir` root with no `c_ETPlane`, so it gets no
  drive and no engine audio. Flying it needs the flight model to take rocket
  engines on a plane, which `aircraft.js` does not do. Its twelve floats
  (`hullHeight 80`) are part of the same open question.
- **Tooling.** `audit_render.mjs --levels a,b` renders those levels only, and
  the model pass draws only what they place. `--levels` on its own still
  means every baked level (`audit_render_rules.mjs` `levelFilter`).

Nothing in the asset tree has to be re-extracted for this. It is audit, server
and viewer code. The pipeline's own quick check picks it up once these
commits are on its checkout.

## The spent case that floated back into the Berthier (2026-11-10)

The owner, on argonnerwald with the French rifleman's Berthier: after a shot
something "floats in from the right ... into the gun", and the same on FHSW.
It was the case. `BerthierBoltOperate.baf` throws it 0.43 m right and ends
there; the rig carries the weapon's parts as tracks inside each arms clip, so
the page's fade from the bolt to the aim (the aim's morph factor 0.7, 1.43 s)
dragged it back across the screen. Retail never blends those bones: they are
the weapon's own state machine's, and its one-shot ends in `StopDummyState`,
whose `resetSkeleton` puts them home that frame (ledger ANIM-22).

`viewer/weapon-part-pose.js` now poses every `boundBone` node after the mixer
from the clip that owns the arms alone, and at rest once a one-shot's track for
it has run; `arms-rig.js` and `replay-viewmodel.js` call it. Page-only: no
re-extraction. Measured on a local page, one shot: the case was 0.42, 0.31,
0.20, 0.08 m off its seat at 0.1, 0.4, 0.7, 1.0 s after the bolt ended, and
is now 0 from the first frame. An offline scan of the rigs finds the same
ending in 213 of BF1918's 312 rigs (cases, rounds, grenade rings and pins), in
FHSW's No4s, and in vanilla's Thompson reload (the `flerp`, 0.125 m), which now
snaps home too. Guard: `tests/test_weapon_part_pose.py`.

## What the BF1918 exporter fixes change in vanilla, the packs and the community maps (measured 2026-11-10)

Measured, not re-extracted. Two detached worktrees, one at `c8a4f09f7` (the
commit before the first BF1918 fix) and one at `a386fc164`, each extracted
vanilla (21 levels), XPack1 (29), XPack2 (32) and the 77 community levels
into its own empty tree: levels, models, kits, loadouts, kit and shared
poses, effects, loading, HUD layout, deployables and first-person rigs. Then
the two trees were diffed file by file, with each glb's nodes matched by
name path rather than index. The scripts are `treediff.py` and `glbsem.py`
in the session scratchpad `vimpact/`.

**Unchanged in every tree.** Every `scene.json` (flags, spawns, tickets,
modes, fog, damage), every soldier pose, every first-person rig, the HUD
layouts, `deployables.json`, the loading blocks and `maps.json`. Community
Shigaisen D's `damage.projectiles` count moved 80 -> 81, but that is bake
order under `-j 4`: the final `damage.json` tables are identical.

**What changes when they are rebuilt.**

| Change | Where | In the page |
|---|---|---|
| A projectile-less `FireArms` is exported (FA-25): the horn | Willy (Battle of Britain's and Raid on Agheila's own copies), BlackMedal, Lynx, KettenKrad; XPack2's HD_XA42 and R75; community Kubelwagen, M3A1, Hanomag, Vespa | The driver's fire key honks. Battle of Britain, local page: 2 pulls in 1.5 s, no round, the jeep drives (24.6 m), and the HUD shows no new panel (only `Ammo/MaxPrimaryAmmo` -1, `PrimaryMag` 0, `ReloadTime` 1 appear). 16 bots for 120 s: 227 bot samples in jeeps, none firing, the same as live |
| `dontClearTeamOnExit` exported (SEAT-27) | every carrier, destroyer, battleship and submarine (vanilla 57 model files; Midway, Coral Sea, Wake, Iwo Jima, Guadalcanal, Omaha, Philippines, Husky; community Pearl Harbor, Oahu, Umi, Waterworld ...) | An abandoned ship stays its last crew's side and an enemy is refused at its door, as in retail. Not driven in a page: the code path is the one BF1918's horses and ships already use live |
| Class words in their class spelling (LOAD-19) | `controlpoint` -> `ControlPoint`, `bundle` -> `Bundle`, `simpleobject` ... on 34 vanilla scripts | Nothing: no page or tool compares those words case-sensitively |
| `vehicleFov 1.5`, `destroyOnExit` (VIEW-16, SEAT-38) | XPack2's WasserfallRocket only | The guided rocket's view takes its own FOV; leaving it destroys it |
| `levelSides` in `models.json` | all three trees | Only the tank-school and dogfight arenas read it; vanilla's vehicles are one side's everywhere |
| `kitActiveName` in `loadouts.json` | every kit | "ACTIVE SCOUTS" ..., the text the layout already shows |

Live vanilla is otherwise as built: every model in `models.json` has its
`sha`, and the plain `/models/<name>.glb` URLs 404 by design (the store,
`bf42/glbstore.py`). A first screenshot of the live jeep with no windscreen
was the cockpit blob still downloading.

**Found on the way, not from these fixes, and fixed.** `fireOnce` was not
exported for a seat gun and `gun-cycle.js` did not read it, so a held trigger
kept firing at `roundOfFire`, where retail fires once a press (GUN-22, the
`FireArms` class every seat gun is). The exporter writes it now and
`gun-cycle.js` latches a group collected with `SEAT_GUN_OPTIONS.fireOnce`
(`tests/test_seat_fire_once.py`; a hand weapon's press stays `hand-fire.js`'s
click pulse). Checked in a page on re-baked levels: Battle of Britain's
Willy, held 4 s, one honk; three taps, three. Invasion of the Philippines'
Elco80, held, one torpedo, where a held trigger had emptied both tubes in
0.29 s. Vanilla's `FloatingMineLauncher` is not `fireOnce` (its only line is
a `rem`'d `altfireOnce`).

**Live without a re-bake (2026-11-10).** A tree baked before the glb carried
the word gets it from a `scene.json` layer: `fireOnce`, the level library's
lower-case `FireArms` marked `fireOnce 1` (`scene_layers.fire_once_templates`,
`patch_scene.py --layer fireOnce`), which `gun-groups.js` `namedFireOnce`
asks when the glb does not say it. Patched from the live files and published
(568 `scene.json`, 0.48 GB, `~/.cache/fireonce-stage`): vanilla and the
community maps 97, XPack1 27, XPack2 30, BF1918 133, Desert Combat 35, EoD
237, FH 9. Live check: Invasion of the Philippines' Elco80, held 4 s, one
torpedo (two before). Not patched, because this Mac has no archive for them:
Kasserine Pass and Truk in vanilla, XPack1, XPack2 and EoD; Strasbourg
(community); FH's Road to Ramelle; and all of FHSW and FHSWEurope (no
install here). Those keep a held trigger firing at `roundOfFire` until they
are patched from the Linux PC (`patch_scene.py --layer fireOnce --mod <M> --all`)
or re-baked.

## Zoomed sights on the eye: every first-person rig rebuilt (2026-11-10)

The owner, in the retail client: zoomed, the rifle is raised dead centre;
ours sat right. Measured: the rounds were right (they leave the camera, the
cone and drop are retail's); the drawn rifle was 3.9 to 4.0 cm right of the
eye, so a zoomed front post sat about 2 degrees right and a shot laid on it
landed 1.7 m left at 50 m. Vanilla had it too, under its crosshair. The cause
was the rig extractor (ledger VIEW-17, `extract_viewmodel.first_person_locals`):
it held `Bip01` and `Spine Root` at their parsed rests, which on
`UsSoldier.ske` is the engine's frame plus -0.0392 m along x.

Rebuilt and published from the live pair lists (`~/.cache/rig-stage`,
`~/.cache/rig-publish`): vanilla 55 rigs and 162 painted pairs, XPack1 80/162,
XPack2 88/156, Desert Combat 33/33, FH 142/190, EoD 285/350, BF1918 312/929;
945 new store blobs (1.87 GB with their `.gz`), each tree's `index.json` with
its `sha` table, and the painted soldiers' `soldiers/*.skin.glb`. The vanilla
trees moved from the per-pair index (`bf1942-rig-index/1`) to the painted one
(`/2`) that BF1918 already used. Live, zoomed: BF1918's Berthier front post
0.04 degrees from centre, Berthier carbine 0.05, G88 0.04; vanilla K98 0.28
(6 mm, from about 2 degrees). Fire, reload and bots unchanged, no page errors
(argonnerwald, Wake, El Alamein).

* **Level paint was not republished.** `skins.json` and `skins/` stay as
  live: the fix moves no texture, and a staging root cannot re-decide level
  paint (the decision reads each pickup's model glb, which a remote tree
  holds only in the store), so a rebuild there drops levels it cannot see.
* **Not rebuilt: FHSW and FHSWEurope** (4,626 and 1,829 rigs), whose install
  is not on this Mac. Their rigs still draw 3.9 cm right until the
  `viewmodels` step re-runs on the Linux PC.
* **A macOS bug found on the way** (`remove_superseded_rigs`): a painted row
  spelled like its rig (`AnzSoldier__No12` against `AnzSoldier__no12`)
  unlinked the rig on a case-blind disk. Fixed, `test_delta_extract`.
* **Open:** VIEW-17 records that the hip view's right hand now sits about
  55 px left of the old OBS capture §3 was fitted to; the zoomed view is
  what the owner checked in retail.
