# FH mechanics vanilla does not have

Status: surveyed 2026-10-11. Built the same day: the flying spawn and
spawn-into-a-seat (sections 1 and 2), on Tarawa. The rest of section 3 is not
built. FH 0.7 adds no engine code. Every
mechanic below is vanilla script words composed in a way the three vanilla
packs never compose them, so the exporter and viewer meet shapes they were
never written for.

Find them before extracting a level:

```bash
features/bf1942-engine-reference/surveys/mod_mechanics.py --mod FH                 # whole mod
features/bf1942-engine-reference/surveys/mod_mechanics.py --mod FH --level Tarawa-1943
```

The tool takes any mod folder (`--mod FHSW`, `--mod DesertCombat`). It diffs
template classes and script words against bf1942 + XPack1 + XPack2 and reports
the structural patterns in the table at the end. It reads scripts without
running them, so both arms of an `if` count, and a spawner whose object is
defined only by another level's archive prints as `unresolved`.

## 1. Flying spawn (the Tarawa planes)

FH's own name for it (`Buildings/Common/Hellcatspawnrotator/Objects.con`,
`rem "Flying Spawn"`). Four vanilla features stacked:

| Layer | Script | Engine rule |
|---|---|---|
| A static placed in `StaticObjects.con` | `Bundle Hellcatspawnrotator` at 1048/9/1360, geometry `bullet_m1` | an ordinary static |
| which carries a part that turns for ever | `RotationalBundle Hellcatspawnrotation1`, `setContinousRotationSpeed 7/0/0` | GUN-2: 7 deg/s of yaw, every tick, no input. One turn in 51.4 s |
| which carries a vehicle spawner on a long arm | `ObjectSpawner AirHellcatSpawner` at `140/300/0`, `holdObject 1`, `SpawnDelay 30`, `MaxNrOfObjectSpawned 2`, `team 2` | AI-121: the spawned plane is its own object, put at the spawner's absolute transform every frame while its engine revs are under 0.1. The arm sweeps a 140 m circle 300 m up at 17 m/s, none of which the plane has: it is held at rest (SPAWN-23) |
| and the plane carries a spawn point | `SpawnPoint HellcatPilotSpawn`, `setGroup 66`, `setEnterOnSpawn 1`, `setAIEnterOnSpawn 1` | group 66 is team 2 in FH's `GlobalSpawnGroups.con` (SPAWN-7). The point is active only while `BFfindEntryPoint` finds a free seat within 5 m (ships research 3.3, step 6), and spawning seats the player |

So the deploy screen shows a spawn that circles the island, picking it puts
you in the cockpit at 300 m, and opening the throttle drops the hold. The
spawner then makes the next plane 30 s later, up to two alive. A taken plane
has no free seat, so its point is off until the next one appears (the Betty has
gunner seats, so hers stays on).

Tarawa has two: `hellcatspawnrotator` (F6F) and `cubspawnrotator` (Piper Cub,
group 73), both Allied. They are the Allies' only aircraft.

The plane is let go at rest (SPAWN-23). The hold gives it the tangent speed
of the spawner's root, each frame and once more when it drops, and the root
is the static: its `StaticPhysicsNode::getTangentSpeed` (lnxded `0x0825e6c0`)
returns zero, and the turning part between the two is never asked. So the
throttle drops a Hellcat with no airspeed from 300 m, and the pilot dives out
of the stall.

The spawner's count and clock (SPAWN-24): `MaxNrOfObjectSpawned` slots, each
taken until its plane is destroyed or gone. The delay is drawn when a plane
spawns and runs only while the last plane spawned is more than `radius` (5 m)
from the spawner, destroyed or gone, so it starts when the plane on the arm is
flown off, and the next stands on the arm `SpawnDelay` later. A plane lost
while its successor still sits on the arm is not replaced until the successor
leaves. A plane flown off and left empty is destroyed by its own clock:
`TimeToLive 10`, `Distance 0`, `damageWhenLost 100` are 10 s with no crew and
nobody near, then 100 hit points a second (SPAWN-13).

### What is built (2026-10-11)

No re-bake of `scene.glb`: the bake already carried the plane under the arm
with its `heldSpawner` record and an `ambient` clip that turns the arm.

* `spawned-craft.js` `detachSpawnedCraft` splits a craft a static's spawner
  holds off the static as a vehicle of its own, held on the arm it was baked
  under (the hold ships' deck aircraft already had, `hull-bodies.js`
  `holdSpawnedCraft`). It circles until its pilot's throttle reaches 0.1 and
  is let go at rest (SPAWN-23).
* The spawner's count and delay (SPAWN-24). `detachSpawnedCraft` copies the
  baked plane once per further `MaxNrOfObjectSpawned` slot, before the scene
  is indexed, so each is a vehicle of its own. `level-statics.js`
  `buildHeldPads` gives the spawner a pad record and the pads' law
  (`deployables.js` `SpawnerPad`): the copy is out of the world until the
  delay, which starts when the plane on the arm is flown off, stands it up
  held on the arm. `vehicle-wrecks.js` `stepAbandoned` runs the abandon clock
  off the record. The delay comes from `heldSpawner.minSpawnDelay` /
  `maxSpawnDelay`, which `bf42/con.py` `spawner_record` writes since
  2026-10-11; Tarawa's `scene.glb` predates that, so until its `scene` layer
  is re-baked the page draws the engine's default window (30 to 60 s by how
  full the server is) where the Hellcat's script says 30.
* `extract_map.py` `_vehicle_soldier_spawn_report` walks statics and pad
  objects for child spawners (`TemplateIndex.carried_spawners`) and keeps
  `setEnterOnSpawn 1` points, flagged `enterOnSpawn`. A held craft's point
  also carries `carrierLocal`, its offset in the craft's frame. This is the
  `spawns` layer: `patch_scene.py --layer spawns`.
* `hull-bodies.js` `bindCarriers` places a `carrierLocal` point off its craft
  and switches a seat point off while the craft's driver seat is taken.
  `spawning.js` seats the player after the spawn. `spawn-flags.js`
  `pickSpawn` offers a seat point only to a spawn that will seat (`enter`),
  and a flag of nothing but seat points is `enterOnly`, which no bot picks.

Checked in a headless page on Tarawa: both planes hold a 140 m circle at
309 m about their rotators, the deploy screen lists `hellcatpilotspawn` and
`cubpilotspawn`, spawning seats the pilot, the flag goes inactive, throttle
releases the plane and back stick recovers it after about 95 m of height.
`lvtsoldierspawn` seats the driver of an LVT. Pins:
`tests/test_vehicle_deck_spawns.py` `HeldCraftSpawnTests`,
`tests/test_carried_spawn_flags.py`
`test_a_seat_point_is_offered_only_to_a_spawn_that_seats`.

The spawner, checked in a headless page on Tarawa (the page's own loop
stopped, frames stepped at 1/30 s): a piloted Hellcat on the arm reads 0 m/s;
on the tick the throttle passes 0.1 its velocity is 0/0/0 and one tick later
0.49 m/s down. With the stick back from release it bottoms out at 116 m, 193 m
under the arm (the 95 m above was measured with the arm's 17 m/s). The second
Hellcat stood up 60 s after the release, on the arm (140 m from the rotator,
309 m up) and circling, with the first still flying: two alive, and no third
in the 15 s after. 60 s is the default window at one player; the unit harness
with the script's `SpawnDelay 30` stamped gives 30.0 s. The first, left empty
in the air with the second on the arm, was destroyed between 11 and 12 s after
its pilot jumped, and the spawner's delay did not move while the second stayed
held. A first plane flown into the ground came back on the arm 60 s after its
release, not after its wreck cleared. Pins: `tests/test_vehicle_pads.py` (the
three `held` tests), `tests/test_sim_vehicles.py`
`test_a_statics_held_plane_rides_its_arm_at_rest`, `tests/test_con.py`
`test_a_held_spawner_carries_its_delay_window_and_radius`.

Open:

1. Settled: the release speed is zero (SPAWN-23), and built.
2. Built for a static's spawner (SPAWN-24). Left: the seat point is bound to
   the first slot's plane (`bindCarriers`), so the second plane on the arm is
   not offered on the deploy screen (`spawned-craft.js` `heldSlotsOf` lists a
   spawner's planes, `spawnHoldOf(node).released` says which is on the arm);
   the `scene` layer re-bake that carries the authored delay; a ship's
   spawner with `MaxNrOfObjectSpawned` above 1 (the Fletcher's three LCVPs)
   still has one craft; a room's server does not run these spawners.
3. Bots never use a seat point (`setAIEnterOnSpawn 1` says they should).
4. "A seat to give" is the driver's seat alone; a Betty with free gunner
   seats reads as taken.
5. A room's server places its copy of the player on the point, not in the
   seat.
6. Only Tarawa's `scene.json` is patched. Every other FH level, and every
   other tree, still has the old `spawns` layer.

### Where else

| Rotator | Plane | Levels |
|---|---|---|
| `Hellcatspawnrotator` | F6F_Hellcat | Tarawa-1943 |
| `Cubspawnrotator` | Piper_Cub | Tarawa-1943 |
| `Bettyspawnrotator` | G4M1 | Midway, Wake |
| `B25spawnrotator` | **the level decides**: IL2-B on A_Day_of_Zitadelle and Cretan_Village's archive, Bf109 on Kiew | A_Day_of_Zitadelle, Cretan_Village, Kiew |
| `B251spawnrotator` | Ju87G | A_Day_of_Zitadelle |
| `Valspawnrotator` | Val | Tulagi_Island |
| `Zekespawnrotator` | Zeke | defined in Invasion_Of_The_Philippines, never placed |

The `B25spawnrotator` row is the trap: the mod-wide template says B-25 and the
level archive redefines `AirB25Spawner`. Resolve a spawner's object against the
level's own scripts first.

## 2. Spawn straight into a vehicle seat

`setEnterOnSpawn 1` on a carried point. Vanilla has ten such templates and its
levels leave them off the fleet ships; FH uses twenty and builds its landings
on them. Same exporter line drops all of them.

| Carrier | Points | Levels |
|---|---|---|
| LCVP (`Lcvp_Omaha`, `_2`, `_3`), groups 72 to 74 | 3 | Omaha_Charlie-Sector-1944 |
| LVT-4, LVT(A)-4 | 2 | Tarawa-1943, Iwo_Jima, Tulagi_Island, Saipan, Saipan-1944 |
| Ford GPA | 2 | Supercharge-1942 |
| Planes: B-25, Cub, Hellcat, G4M1, Val, Zeke | 6 | the flying-spawn levels |
| Transports: C-47, Ju 52, Waco glider | 4 | A_Day_of_Zitadelle, Cretan_Village, Crete-1941, Liberation_Of_Caen |
| Carriers and a U-boat: Yorktown, Lexington, Sub7C | 3 | Coral_Sea, Midway, Rheinuebung-1941 |

Fifteen levels in all, three of them already extracted (Tarawa, Omaha, Iwo
Jima). Tarawa's LVTs can be spawned into since 2026-10-11; Omaha and Iwo Jima
need their `spawns` layer patched.

## 3. Everything else the survey found

"Ours" is what is known about the viewer, not a promise: where it says
unchecked, nobody has looked.

| Mechanic | How FH scripts it | Levels | Ours |
|---|---|---|---|
| Spawn shells | A meshless `PlayerControlObject` that only carries spawn points, made by an `ObjectSpawner` with a different object per team, so the spawn follows whoever owns the pad (`AltSpawn01`, `EastAxis`, `BarnSpawn`, `BridgeSpawnObject`, `ParatrooperSpawnObject`) | Omaha, Road_To_Ramelle, Soletschnogorsk-1941, Stashuv_Area, In_The_Hell_Of_Bocage-1944, Liberation_Of_Caen, The_Attack_on_Carentan-1944 | carried points ride any carrier (SPAWNGRP-10); the shells are skipped as meshless in the behaviour audit |
| Paratroop spawns | `setSpawnAsParaTroper 1`, on remote transports (`RemoteC47-2`, `RemoteJu52`) and level objects | Market_Garden, In_The_Hell_Of_Bocage-1944, Stashuv_Area, Cretan_Village | vanilla has it (Market Garden); unchecked for moving carriers |
| Call-in air raids | An `EffectBundle` (`e_B25Bombrun`, `e_B17`, `e_He111`, `e_Ar234`, `e_C47`) holding a spawner; the spawned `Bundle` has slow rotating "path" parts (0.5 to 2 deg/s) carrying a held bomber, whose own spawners drop `*-bombVehicle` objects. The C-47 variant carries a paratroop spawn point instead of bombs. What fires the effect was not traced | not placed by any level layer; reached from weapons | unchecked; an effect that spawns objects is outside `extract_effects.py` |
| Off-map barrage | `88mm/105mm/150mm/NebelwerferShelldispenser`: three nested rotators (80, 150, -450 deg/s) flinging a spawner that makes a shell "vehicle" every 20 to 40 s. Also `BeachBombardment_body1..5` | Soletschnogorsk-1941 (static), others through spawners | unchecked |
| Remote bombers | `RemoteB17`, `RemoteC47`, `RemoteJu52` and nine more: a bomber flown from a bomb-sight seat, with an `e_Detonator` effect that spawns a held `DetonatorVehicle` | Berlin-1945-Streets and wherever spawned | unchecked |
| Deployable weapons | A `Projectile` with an `ObjectSpawner` child: firing it plants a tripod MG or mortar (`Mg42DeployProjectile`, `MortarDeployProjectile`, 18 of them), also from half-track seats (`SdKfz251/1MGDeploySpawner`) | any level with those kits or half-tracks | half-track gun reported silent and accepted as data (BEHAVIOUR.md); planting unchecked |
| Destructible scenery | A `PlayerControlObject` with armour and no seat, spawned by a level spawner or placed as a static; its wreck effect holds a spawner for the wreck (`brigde_dest` stone bridge, `betio_bdoor`, `Omaha_Bdoor`, `quonset_dest1..4`, `radartower`, `German_Factory1..4`, `Pegasus_House01` wood and glass, `FH_Barbwire_m1`, `FuelBarrel`) | Prokhorovka-1943, Tarawa-1943, Midway-1942, Battle_Of_Britain, Bombing_The_Reich-1943, Pegasus, Kiew and more | `Oma_arty` wreck fixed (BEHAVIOUR.md); the rest unchecked |
| Usable buildings | `PlayerControlObject` in `StaticObjects.con` with a seat: `ActiveGatehouse1_large` (a barrier arm you raise), `ControlTower`, `ActiveRadarbunker`, `FH_Tower_spotlight` (spotlight spawned by the tower) | Prokhorovka-1943, Eastern_Blitz-1939, Operation_Blackknight-1945, Bombing_The_Reich-1943, Gold_Beach-1944, Omaha | unchecked; ten such templates, none in vanilla |
| Vehicles that carry vehicle pads | LCT Mk5 spawning a Sherman, Churchill or GMC on its deck; G4M2-E carrying the Baka; C-47 towing a Waco; carriers with an `EnterpriseElevator` lift on a +/-5000 deg/s "shaker" | Gold_Beach-1944, Tarawa-1943, Iwo_Jima, Saipan, Midway-1942 and the naval levels | ship-carried pads exist for vanilla (AI-121); a pad on a boat that is itself spawned is unchecked |
| Level-local templates | 39 of 73 level archives carry `Objects/` scripts: their own kits, ships, rotators, and overrides of mod templates under the same name (Tarawa's `Fletcher`) | 39 levels | level archives are mounted (level-archive-mounts); an override of a mod template changes the shared library per level |
| Level animation scripts | `animations/AnimationStatesMod.con`: per-level 1P/3P animation speeds and camera shake | Soletschnogorsk-1941, Spurning_Fate-1945, Todtenbruch-1944, Cretan_Village | not read |
| Objective mode | `DestroyTargetObjective`, `TimerObjective`, `ANDCompositeObjective` through spawners | Bombing_The_Reich-1943 | OBJ rows cover the engine; FH's root script has no `GameTypes/` file (FHR-5) |
| Capture head-count | `ObjectTemplate.minNrToTakeControl` on control points, 46 uses, none in vanilla scripts | Aberdeen and others | not read by `parse_control_point_templates` (unchecked in the engine) |
| Soldier movement | `soldier.setForwardSpeed`, `setStrafeSpeed`, `setWalkSpeedFactor`, `setMoveAccelerationDeacceleration`, `cameraShakeFactor` in `CommonSoldierData.inc` | mod-wide | unchecked |

Words FH writes that the engine does not register are FHR-6; `v_is_coop` arms
are FHR-3 and FHR-9.

## The survey's patterns

| Pattern | FH | Baseline | FH levels |
|---|---|---|---|
| `static-spawner`: a spawner reached from `StaticObjects.con` | 9 | 0 | 15 |
| `rotating-carrier`: a continuously turning part carrying a spawner, spawn point or vehicle | 38 | 0 | 14 |
| `enter-on-spawn` | 20 | 10 | 15 |
| `paratroop-spawn` | 21 | 24 | 4 |
| `carried-spawner`: a spawner that is another template's child | 308 | 17 | 27 |
| `spawns-non-vehicle`: a spawner whose object is no vehicle or kit | 38 | 7 | 39 (includes unresolved names) |
| `static-vehicle`: a `PlayerControlObject` in `StaticObjects.con` | 10 | 0 | 9 |
| `level-templates` | 39 | 6 | 39 |

Levels with none of these: Battle_Isle-1944, Falaise_Pocket-1944,
Kharkov_Outskirts-1943, Operation_Goodwood-1944, Pegasus, Stalingrad.
