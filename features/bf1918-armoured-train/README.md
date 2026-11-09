# BF1918's armoured train

Status: the locomotive is built and verified (2026-11-10). It runs on its guide
rails on the real Gebirgspass bake, headless. The cars and the couplers are
designed below and not built.

BF1918 3.4b puts an armoured train on seven levels: brusilov_offensive,
chateau-thierry, gaza_town, gebirgspass, ramskapelle, roye and sarikamis.
Galicia and winter_train carry the guide rails but no train. It is built from
ordinary engine parts and no train code. The engine rules it composes are
ledger COL-25. This page says what retail does with them, what the viewer does,
and what is still open.

## What retail does

The locomotive is `ArmouredTrain_GILI`. It is a `VCLand` PlayerControlObject of
mass 50,000, defined in `objects.rfa`, `Vehicles/Land/ArmouredTrain_GILI/`.
Four levels carry their own copy under `objects/ArmouredTrain/`.

- **Drive.** `ArmouredTrain_Locomotive_EnginePower` is a `c_ETPlane` engine
  with the throttle on its roll axis. It pushes the hull along its own axis
  (PHY-12, PHY-27). It is the same propeller-sled drive as FH's aerosan
  (`seat-survey.js` `rootDriveKind`, `amphibious.js`, the air screw). Nothing
  steers the train.
- **Weight.** Four `ArmouredTrain_SurfaceWheel` springs (RollGrip, strength 100,
  damping 10, in no collision group) sit at x +-1.2 m, y -1.0 m. They stand the
  train on the visible rails. The rails are statics in `c_CGStaticObjects`,
  with an embankment top 0.72 m over the rail's origin.
- **Guidance.** Two Engines are added at `0/0/90` and `0/0/-90`. Each carries
  two `ArmouredTrain_GuideWheel` springs (`createInvisible 1`, RollGrip,
  strength 100). The springs are in `c_CGStaticObjects` and `c_CGLandscape`,
  mask 3. The roll puts them at x +-1.4 m, y -1.3 m, with their one-vertex
  probe 2 cm outboard.
- **Where the guide wheels push.** `c_CGLandscape` keeps them off the terrain
  (COL-20). The shared `c_CGStaticObjects` bit hides the visible rails from
  them (COL-24). What they meet are the invisible `*_guide_m1` statics a level
  runs from `TrainGuideRails.con`. Those are two inward-facing walls 2.93 m
  apart, 0.07 to 0.81 m high. A spring has no axis (PHY-5), so each wall
  pushes its wheel back inward along its normal (COL-21). The train runs
  between the walls with 4.5 cm of play each side.
- **Cars.** `ArmouredTrain_GunCarF`, `InfantryCarF` and `InfantryCarR` are
  PlayerControlObjects of their own. Each is stood by an `ObjectSpawner` child
  of the locomotive at z +13.2, +6.8 and -7.2 m, with no hold. Each has the same
  surface and guide wheels and a dummy `c_ETRocket` Engine with every input
  `c_PINone`, so a car is a free body on the rails.
- **Couplers.** `TrainPuller` is a PCO of mass 200,000 in `c_CGProjectiles` and
  `c_CGLandscape`, with an empty Engine. The locomotive holds one at each end
  (`TrainPuller_Spawner`, `holdObject 1`, z +3.66 and -4.07 m), and
  InfantryCarF holds one at its front (z +3.16 m). The hold (AI-121) puts a
  puller back at its spawner every frame, with the holder's velocity there. It
  never lets go, because the puller's engine never turns. So a puller is a
  massive body carried by its holder, and it pushes the next car by contact:
  `s = 50,000 / 250,000` gives the car 80% of the correction (COL-2). A
  holder's own puller is no contact to it (collision-response.md 6.2). The
  group mask keeps rounds and the ground away from a puller.
- **Push cages.** `PushCageTrain` boxes sit on the track. They are a separate
  mechanic (bf1918 census 1.11), and this page does not cover them.

## What the viewer did, and what it does now

| Ingredient | Before | Now |
|---|---|---|
| The plane engine on a land hull | The propeller sled: `ground`, `TrackedVehicle` with the air screw. It drove 12 m/s in 8 s | Unchanged |
| The guide wheels | Dropped from the body as a `c_CGLandscape` part. The drive still probed the terrain under them, so the train stood on them, 0.3 m too high | Kept as spring parts with their mask (`describeVehicleParts`). Off the terrain in the body (`terrainContact`) and in both drives (`suspension.js` `meetsTerrain`) |
| The group rule | Only rounds against statics (FF-1) | The static probe (`static-index.js` `castAmong`, `body-statics.js`) and the body pair loop (`body-contact.js` rule 5) as well |
| The guide rails | Not baked: `StaticObjects.con`'s `run` was not followed | Baked by the exporter fix `3faae2fe5`, a separate change; the seven levels were re-baked on 2026-11-10 |
| A spring on a static | The drive took the body world's push one tick late, so its force ran two ticks behind the pose. The train bounced off its embankment 0.8 m high | `TrackedVehicle.takeStaticPushes` stands each spring on the push at the pose it was measured at, merged with the terrain's there. The friction keeps the previous contact |
| Cars and pullers | Baked under the locomotive and drawn riding it rigidly. They have no collision of their own, because `describeVehicleParts` skips held-spawner nodes | Unchanged (open, below) |

These are general rules with nothing special to the train. FHSW's rail wagons
(`PJWagen_T-34_1942_GuideWheel`, `PT16_GuideWheel`, COL-20) put guide wheels in
the same mask and take the same path.

## Verified

- **`tests/test_armoured_train.py`** drives the real locomotive glb on a
  synthetic track (`armoured_train_harness.mjs`). The track has the
  embankment in `c_CGStaticObjects` and the walls in no group, laid along a
  60 m straight, a 100 m-radius 30 degree bend and a 60 m straight. The runs
  are seated through the page's `VehicleOccupancy`, use a real `BodyWorld` and
  `WorldCollider`, and run at 30 Hz.
  - The train rides at 1.716 m, on its road wheels.
  - It holds the whole bend within 5.8 cm of the centreline and 2.3 degrees of
    heading. The walls' pushes are horizontal (`ny` < 0.05).
  - Started 10 cm off centre, it is pushed back inside the walls.
  - With no walls it runs straight off the bend.
  - With the embankment in no group, the guide wheels ride its top face.
- **`tests/test_sim_vehicles.py` `ArmouredTrainLevelTests`** runs the real
  Gebirgspass bake through the headless runner (`sim_vehicles_harness.mjs`
  `armouredTrain`). A bot takes the locomotive and holds the throttle open for
  40 s.
  - It travels 416 m, climbing 4.5 m.
  - A level ray at guide-wheel height finds a wall within 1.6 m on both sides
    in 37 of the 40 samples. Each of the other three sits at a joint between
    two wall pieces.
  - The same recipe on the code before this change found walls on both sides
    in 10 of 40 samples. The train derailed at 25 s, fell 10 m off the
    embankment and stopped.
- `surveys/census_ground_drive.mjs` no longer flags `weak-turn` on a hull
  with no steered and no driven wheel. The train settles at 1.0 m on its road
  wheels on flat ground; before, it stood on its guide wheels at 1.3 m.
- The headless runner shares the page's modules, but this was not looked at in
  a browser page. The room server's world (`server/level-data.mjs`) runs the
  same `BodyWorld` and drive, so it takes the change too. That was not run.

Nothing needs re-extracting. The glbs already carry the springs' rotations,
grips and `heldSpawner` stamps. `collision-meshes.json` `groups` already gives
`armouredtrain_guidewheel: 3` and `trainpuller: 9`, and the levels'
`collisionGroups` give the visible rails 2.

## Open: the cars and the couplers

This is the faithful design. It is not built in this pass, because it needs
two pieces of engine-general work, each larger than the train:

1. **A land hull's baked child-spawner PCOs as objects of their own.**
   `spawned-craft.js` `detachSpawnedCraft` splits off only sea and air craft
   (`spawnedCraftUnder`) and the craft a static's spawner holds. The cars are
   `VCLand`, unheld, and baked under a hull that is itself under the
   `spawners` group, so they stay baked. The rule is SPAWN-30's: every child
   spawner of every hull stands an object of its own. It should apply to them
   as it does to a deck aircraft. The pullers then take the existing hold
   (`hull-bodies.js` `holdSpawned` / `holdSpawnedCraft`, AI-121), with a land
   hull as the host. `hostPointVelocity` must read a parked host's body too,
   not only a driven one's drive state.
2. **A parked body against the static world.** A car nobody is in is a parked
   body. A parked body meets no static at all (`body-world.js`: "Driven only,
   for now", deferred in features/viewer-ground-hull-collision because hulls
   are placed inside hangars). An unmanned car would fall through its
   embankment and have no walls to follow. At least the springs need the
   COL-21 pass for parked bodies: `collideSpringsWithStatics` and a static
   push into `WheelSpring`. Whether to take the hull parts as well is the
   hangar question that README already asks.

With both in place the coupling is not special either. A held puller is a body
of mass 200,000 pinned to its holder every tick, and `collideBodies` pushes the
car with the mass shares (COL-2). The pair filter needs the holder rule:
`handleCollision` returns false for a held object touching its holder
(collision-response.md 6.2). The groups already keep a puller off the ground
and away from rounds.

Until then the cars ride rigidly 13 m ahead of the locomotive and 7 m behind
it. On Gebirgspass's gentle bends that offsets them well under a metre. On a
100 m-radius bend the gun car would sit about 0.85 m off its rails.

Also open, all small:

- **The guide wheel's RollGrip axle.** The engine's guide wheel axle is its own
  X, which the Engine's roll turns vertical, so the wheel resists vertical
  slip along the wall. `TrackedVehicle` lays every axle along the hull's X.
  At a wall that axle is edge-on and asks for nothing.
- **Not checked against retail.** No lab recording of the train exists.
