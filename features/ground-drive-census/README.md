# Ground-drive census

Status: built 2026-10-28. Every land hull of every model tree driven in node on
flat ground; eleven defect classes found, eight fixed (seven in the viewer's
drive, one in the exporter), the rest recorded below.

Two drive bugs were found by luck on 2026-10-28 (`382f7515`, a driven steered
wheel drives along its bundle; `f8dfe88c`, a tracked drive's steered wheel takes
its bundle's `direction`). The behaviour audit's `veh.no-steer` passes anything
that turns more than about a degree, so a hull that turns 15 degrees where it
should turn 140 gets through. This census asks how far each hull drives and turns.

## The tool

`tools/bf1942-models/surveys/census_ground_drive.mjs` (node, no Chromium,
about 2 minutes for all trees):

```bash
cd tools/bf1942-models
node surveys/census_ground_drive.mjs --json /tmp/census.json        # every tree
node surveys/census_ground_drive.mjs --trees fhsweurope --only '^ISU' --trace
```

It takes the base glb of every template in `models.json` (or every `<Name>.glb`
in a tree with no manifest), keeps the ones whose JSON chunk has Springs and a
`c_ETCar`/`c_ETTank` Engine, and builds the drive the page and the room build:
`server/glb-scene.mjs` `buildSceneTree` (nodes, collision meshes, wheel meshes),
`VehicleOccupancy.ensureDrive`, then `describeVehicleParts` +
`wheelContactDepths` off the tree's `collision-meshes.json` and `damage.json`,
as `adoptDrivenBody` and `mountIntoSeat` do. On an analytic plane it measures:

| Phase | What |
|---|---|
| settle | 3 s, no input, dropped 0.15 m above its lowest wheel or hull vertex (a `c_CGLandscape` part, COL-20, does not count): pitch, roll, grounded, hull below ground, wheel gap |
| forward | 8 s full throttle: top speed, heading drift, slip while straight |
| turn | 4 s throttle, then 2.5 s full right lock with throttle: heading turned (+ is right), slip, roll |
| reverse | 6 s full reverse from rest |

Flags: `no-drive` (< 1.5 m/s), `no-reverse` (< 0.5 m/s), `wrong-way` (right lock
turned left more than 5 degrees), `weak-turn` (under 30 degrees, from 6 m/s or
more; a crew-pushed gun at walking pace is not judged), `crab` (straight-line
slip over 10 degrees, or a car's turn slip over 45), `rolls` (pitch or roll past
60 degrees), `not-level` (settled past 8 degrees), `sinks` (hull more than
0.5 m under), `floats` (not grounded, or wheels 0.3 m clear).

What it does not have: the body world (`adoptDriven`), so a hull part that
meets the ground (a belly, a trail spade) is not tested; statics; water.

## Totals (2026-10-28)

2,648 land hulls in nine trees (bf1918, gcmod, interstate and pirates carry no
land drive). Flagged, against `28bef1ce` (before) and after these fixes:

| Tree | Land hulls | Before | After |
|---|---:|---:|---:|
| bf1942 | 19 | 0 | 0 |
| xpack1 | 23 | 0 | 0 |
| xpack2 | 31 | 0 | 0 |
| desertcombat | 45 | 4 | 3 |
| dc_final | 55 | 4 | 3 |
| eod | 63 | 3 | 3 |
| fh | 187 | 6 | 4 |
| fhsw | 977 | 118 | 64 |
| fhsweurope | 1,248 | 137 | 74 |

What is left after is mostly by design: 47 `*_towed_dummy` trailers per FHSW
tree that no seat drives, and the classes under "Recorded" below.

## Fixed

| Class | Hulls | Owner | Fix |
|---|---|---|---|
| The drivetrain was the walk's last land Engine. FHSW's towing combos hang the towed gun, a `PlayerControlObject` with a 0.6-differential crawl engine, off a hook behind the tractor: the SdKfz 251 + Pak, Zis-22, M3A1, MunitionsPanzer, SdKfz 7 tractor, Lorraine, C7P, T-20, Universal Carrier and Ho-Ki combos ran 0 to 2 m/s flat out | ~60 per FHSW tree | viewer | `tracked-vehicle.js` `collectChassis`: the hull's own Engine (not under a nested control object); a drive spring under another control object's Engine is not driven. The FHX-30 work landed `traverseOwn` the same night (`0c42b0f6`, `5e4e6f3d`), which leaves a spawner-held towed gun out of the walk altogether; both rules stand, and the census numbers below are with both |
| A Spring with no geometry was a wheel. Its radius came off the towed gun's whole mesh (1.1 m) and stood the tractor's tail on it. Such a part has no collision mesh and is never tested (COL-19) | the same combos | viewer | `collectChassis` skips `geometry: null` springs |
| Grip words compared as spelled. FH's `c_PGFEngineDUmmyGrip` idlers (Pz 739, Somua S35, all three FH trees) and `c_PGFrollGrip` read as contact grips and braked the tank to 0.2-0.4 m/s. The console resolves the word case-blind (CON-15) | 2 per FH tree, plus Voroshilovets | viewer | `suspension.js` `gripOf` |
| `c_PGFRollGripWhenOccupied` read as a contact grip: DC's Lada and EE-9 rear pairs braked the car to 0.6 m/s. Under a driver it is a roll grip (`body-friction.js` `parkedGrip` is the parked half) | Lada, EE-9 (DC, DC Final) | viewer | `tracked-vehicle.js` friction branch |
| The origin failsafe held the origin at the ground. FHSWEurope's Char 2C has its origin at the hull's floor and its wheels 0.35 m up it: it stood on air, asleep, 0 m/s | Char 2C | viewer | `#originDrop`: the origin may rest as far under the ground as the lowest wheel's contact sits above it |
| `inertiaGeometryNode` step 2 wanted a drawn mesh. FHSW's `ISU122_Complex` carries its hull geometry (3.3 x 2.2 x 7.1 m header box) as collision only and draws through a sibling, so step 3 took the cockpit LOD's 0.8 m mantlet: a 46-tonne hull on a 0.6 m^2 inertia somersaulted off its springs | ISU-122, -122S, -122BM, -130, -152, -152BM | viewer | `geometry-search.js` step 2 takes an alternative whose geometry has only collision meshes; `ship-spec.js` `inertiaGeometryBox` measures those without the sidecar |
| `browse_rig` stripped the front wheels' `c_PIYaw` of a vehicle whose Springs are all `createInvisible 1`: FHSWEurope's ski, Deployed_ski and `rower_pol` bicycle turned 0 degrees at full lock in their model glbs (level bakes keep every axis and were right) | 3 | exporter | `bf42/assemble.py` `browse_rig(steers_spring=)`; re-extracted with `mod_pipeline.py reextract --mod FHSWEurope ski Deployed_ski rower_pol` and published (below) |

Guards: `tests/test_ground.py` (`test_a_towed_gun_neither_drives_nor_props_the_tractor`,
`test_a_grip_word_is_read_case_blind`,
`test_a_hull_whose_wheels_sit_above_its_origin_stands_on_them`,
`test_roll_grip_when_occupied_rolls_under_a_driver`,
`test_the_inertia_box_takes_a_geometry_drawn_only_as_collision`, the `census`
block of `ground_harness.mjs`) and `tests/test_assemble.py`
(`test_a_wheel_steering_bundle_keeps_its_yaw_without_visible_springs`).

Census numbers for a sample, before and after: SdKfz251-Pak40 0 -> 11.2 m/s and
136 degrees; Pz 739 0.2 -> 12.6 m/s and 121 degrees; ISU-152 airborne at 5 m
and rolling -> 10.3 m/s, 81 degrees, level; Char 2C 0 -> 5.4 m/s; Lada 0.6 ->
26.7 m/s; ski 0 -> 104 degrees.

In the browser (`audit_behaviour.mjs --only vehicles`, port 5328, this
worktree): kharkov_winter-1941's Pz 739 drove 36.8 m and turned 133 degrees, its
SdKfz251-Pak38 drove 20.1 m; berlin_uprising's ISU-152 drove 30.6 m and turned
157 degrees. Their other findings there (`veh.deploy-hull-survived`, a gun
check's `crew-killed-by-own-fire`, `veh.off-its-pad` on a Universal Carrier)
are not drive findings.

### Published

FHSWEurope `models/mods/fhsweurope/{ski,Deployed_ski,rower_pol}.{glb,glb.gz,report.json}`
and `models.json` (the three rows' `rigged` count is the only difference from
the live file), staged under a copy and sent with
`scripts/publish-mesh-delta.py --root <stage> textures models --hash`; the three
live glbs (`?cb=`) compare byte-equal to the staged ones.

The exporter fix reaches further than the census's hulls: `patch_held_axes.py`
(which now restores the same axis) finds 438 model glbs in FH, FHSW and
FHSWEurope whose aircraft tail wheels lost their steering the same way (an SB2C,
a carrier's parked planes, hangars). That is the aircraft side and not a land
drive; it is a follow-up, run `patch_held_axes.py --mod fh --mod fhsw --mod
fhsweurope` and publish.

## Recorded, not changed

| Hulls | Class | Why |
|---|---|---|
| 152H17Mobile, 155mmM1917A4Mobile, Obiceda155-14PBMobile, sFH414(f/i)Mobile, wz1917Mobile, French155mmMobile and their `_towedgun` variants (FHSW, FHSWEurope) | `wrong-way`: right lock turns them 6 degrees left (French155: 48) at 4 m/s | Crew-pushed guns whose one steered, driven wheel is at the trail (`z +4`) with `direction 1` and 90 degrees of lock. Under the ported law (TANK-27, `382f7515`) it drives the trail sideways to the right, so the nose goes left; the Forklift and the Puma's rear axles declare `direction -1` for this reason. Retail is unverified: a lab push of one of them settles it |
| Puma, sdkfz232, Technical family, komodo_dragon (FHSWEurope); DesertPatrolVehicle, Forklift (DC) | `crab`: 46-89 degrees of slip at full lock from 20-27 m/s | The same open question as `originLever` in `test_ground.py`: the viewer spins a short-wheelbase or all-wheel-steered hull at speed where DC's lab bots did not. Open |
| SdKfz 7, SdKfz 7 Flak18, SdKfz 10/4 (FH); M35G, M35Quad50 (EoD); KV-3 (FHSW) | `weak-turn`: 26-30 degrees at 10-21 m/s | `c_ETCar` half-tracks whose driven tracks resist the turn as EngineGrip; long trucks on 30-degree locks; a heavy tank. Borderline, the data's |
| Horse_x4, Horse-Type38FieldGun (FHSWEurope) | `weak-turn`: 5-19 degrees at 6.3 m/s | A four-horse team: `c_ETTank`, yaw servo at 2/s. The data's |
| T34_ste (FHSW, FHSWEurope) | `no-drive` | `setTorque 0`, `setMaxSpeed 0`: a dug-in tank by design |
| Type96_15cm_towed_ammocar, every `*_towed_dummy` | `no-drive`; 13 `*_towed_dummy` also `sinks` | Trailers no seat drives; their trail sits into the ground at rest without a tractor |
| Ratte_ (FHSW, FHSWEurope) | `sinks` 4.2 m | `RatteComplex collision 1` reaches 5 m under the origin. The drive stands on its wheels; what the body world does with that part on a level is unchecked |
| M10Wreckstay (FH, FHSW, FHSWEurope) | `weak-turn`: 0 degrees | A wreck with four EngineGrip springs and no steering. The data's |
| KettenKrad (DC, DC Final, EoD) | `rolls`, `not-level`, no turn | A stale extract: the two rear `createInvisible 1` springs are missing, which PHY-24 fixed in the exporter on 2026-10-07; vanilla's KettenKrad has them. These trees are parked; a re-extract fixes it |
