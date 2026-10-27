# Ground-drive census

Status: built 2026-10-28. Every land hull of every model tree driven in node on
flat ground; eleven defect classes found, eight fixed (seven in the viewer's
drive, one in the exporter), the rest recorded below. Two of the recorded
classes were settled on the lab the same night ("The lab's answers", below):
the pushed 155s' wrong way was the page's (fixed, TANK-31), the high-speed
slide is retail (TANK-30).

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

| Tree | Land hulls | Before | After | After the lab |
|---|---:|---:|---:|---:|
| bf1942 | 19 | 0 | 0 | 0 |
| xpack1 | 23 | 0 | 0 | 0 |
| xpack2 | 31 | 0 | 0 | 0 |
| desertcombat | 45 | 4 | 3 | 1 |
| dc_final | 55 | 4 | 3 | 1 |
| eod | 63 | 3 | 3 | 3 |
| fh | 187 | 6 | 4 | 4 |
| fhsw | 977 | 118 | 64 | 53 |
| fhsweurope | 1,248 | 137 | 74 | 55 |

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
drive.

Done 2026-10-28: `patch_held_axes.py` over every in-scope tree restored the
axis in 512 glbs (1,186 nodes): vanilla 12,
xpack1 32, xpack2 32 (the four carriers' parked planes), FH 167, FHSW 127 + the
`operation_kikusui_day2` scene, FHSWEurope 140 + the `operation_kikusui_day2`
scene. The remote-only exported levels were measured from the volume's
`scene.glb.gz` JSON chunk; only FHSW's kikusui_day2 carried the gap and was
restored, patched and published. An after pass finds nothing. The patcher now
replaces each glb, `.gz` and `.br` atomically (temporary file and rename) and
only if the file is still the one it read, since other sessions audit and
patch the same trees overnight (`tests/test_patch_held_axes.py`
`PatchFileTests`). In node, FHSWEurope's SB2C at a 9 m/s taxi with full yaw
turned 0.8 degrees in 6 s before (rudder alone, no steered leg) and 150 degrees
after (one steered leg). Parked trees, counted only: DC 20 glbs, DC Final 30,
EoD 33; bf1918, GC, Interstate, Pirates, BG42 and FinnWars none.

## Recorded, not changed

| Hulls | Class | Why |
|---|---|---|
| 152H17Mobile, 155mmM1917A4Mobile, Obiceda155-14PBMobile, sFH414(f/i)Mobile, wz1917Mobile, French155mmMobile and their `_towedgun` variants (FHSW, FHSWEurope) | `wrong-way`: right lock turned them 6 degrees left (French155: 48) at 4 m/s | **Fixed after the lab (TANK-31)**: retail pivots them right; the page read the trail wheel's differential side across the hull instead of in its steering bundle's frame |
| Puma, sdkfz232, Technical family, komodo_dragon (FHSWEurope); DesertPatrolVehicle, Forklift (DC) | `crab`: 46-89 degrees of slip at full lock from 20-27 m/s | **Retail (TANK-30)**: the lab's Puma slid 68 degrees from 26 m/s and the page holds the run to a millimetre an ack; the census no longer flags a turn's slip |
| SdKfz 7, SdKfz 7 Flak18, SdKfz 10/4 (FH); M35G, M35Quad50 (EoD); KV-3 (FHSW) | `weak-turn`: 26-30 degrees at 10-21 m/s | `c_ETCar` half-tracks whose driven tracks resist the turn as EngineGrip; long trucks on 30-degree locks; a heavy tank. Borderline, the data's |
| Horse_x4, Horse-Type38FieldGun (FHSWEurope) | `weak-turn`: 5-19 degrees at 6.3 m/s | A four-horse team: `c_ETTank`, yaw servo at 2/s. The data's |
| T34_ste (FHSW, FHSWEurope) | `no-drive` | `setTorque 0`, `setMaxSpeed 0`: a dug-in tank by design |
| Type96_15cm_towed_ammocar, every `*_towed_dummy` | `no-drive`; 13 `*_towed_dummy` also `sinks` | Trailers no seat drives; their trail sits into the ground at rest without a tractor |
| Ratte_ (FHSW, FHSWEurope) | `sinks` 4.2 m | `RatteComplex collision 1` reaches 5 m under the origin. The drive stands on its wheels; what the body world does with that part on a level is unchecked |
| M10Wreckstay (FH, FHSW, FHSWEurope) | `weak-turn`: 0 degrees | A wreck with four EngineGrip springs and no steering. The data's |
| KettenKrad (DC, DC Final, EoD) | `rolls`, `not-level`, no turn | A stale extract: the two rear `createInvisible 1` springs are missing, which PHY-24 fixed in the exporter on 2026-10-07; vanilla's KettenKrad has them. These trees are parked; a re-extract fixes it |

## The lab's answers (2026-10-28, late)

Both open drive questions were settled against the retail server on a private
lab (`BF42_LAB=~/.cache/agentdrive/lab BF42_LAB_PORT_OFFSET=40`), driven by
`lab/veh_law_probe.mjs`. Every run is a Conquest layer with no bots. The
scenarios are `lab/scenarios/fhsw-{desert_hill,battle_of_gela,kharkov_winter}-cq-drive.json`.

FHSWEurope could not be used. Its levels load, but the retail server segfaults
in `NetServer::_update` (+1312, a ConnectAcceptAck writing through a bad `int*`
on the NetServerThread) when a sidecar connects. That happened on kharkov_winter
and on testfield_fhsweu, and vanilla and FHSW levels on the same private copy
took the join. The FHSW copies of the same templates were driven instead.

### The pushed 155s turn right (TANK-31)

The run was the Obiceda155-14PBMobile on battle_of_gela-1943, from the spawner
at (994, 1636).

**Seats.** Use put the sidecar in the gunner's seat (`Obiceda155-14PBMobileGunner`).
There, `c_PIYaw` drives the two `c_ETPlane` traverse engines and swings the
whole gun at 3 deg/s, with no throttle. `c_PIMenuSelect1` takes the root seat.
The root's control state does not decode in the sidecar (`ok: false` on every
state), so a second sidecar (`skandia-sc-obs`, `HOSTS=`) logged the hull's
ghost.

**Measured.** Both logs carry wall-clock `t` stamps, which line the two up.

| | retail | page before | page after |
|---|---:|---:|---:|
| top speed (m/s) | 4.03 | 4.04 | 4.04 |
| heading after 2.5 s of right lock (deg) | +75 | -6.4 | +82.8 |
| after 5 s | +191 | | |
| origin travel through the turn | 0.4 m | | pivots, 0.05 m/s left |
| pitch at rest (deg) | -2.74 | -2.97 | -2.97 |

**Why.** `addFriction` reads a driven spring's side relative to its physics
parent, and for the trail wheel that parent is the steering bundle. At 90
degrees of lock, the bundle's x is the hull's fore-aft axis. The contact normal
of a nose-down gun leans that way, so on right lock the trail is the starboard
track at -0.5 of the revs and drives itself out to the left.

**Fix.** `tracked-vehicle.js` `bundleX` and `steeredRightX`. All 22 such
templates in the two trees now turn right, 70-83 degrees in 2.5 s. Of the
two-axle trailers, B4/Br5 went from 22-24 to 47 degrees and H503/H607 from 27
to 36; Kugelpanzer and wz1902 changed by a degree or so. Nothing else in any
tree changed.

**In the browser.** `audit_behaviour.mjs --mod fhsweurope --levels bizerte-1943
--vehicle '^Obiceda155-14PBMobile$'` on port 5332 drove 22 m at 4 m/s, then
turned 134 degrees right in the audit's 2.5 s of lock, with no steer finding.
The direction matches retail. The rate is 1.8 times the lab's 75, but that was
a different level and ground, and the census's flat plane gives 83, so it is
left open. The audit's only finding was `asset.404`, from this worktree's
linked `glbs` store.

**Guard.** `test_ground.py`
`test_a_pushed_guns_trail_wheel_takes_its_side_in_its_bundles_frame`, the
`pushedGun` block of `ground_harness.mjs`. The same chassis stood nose up takes
the port side and turns left: the lean decides.

### The high-speed slide is retail (TANK-30)

The Puma was driven on FHSW desert_hill, south from the axis base onto open
sand: 6 s of throttle to 26 m/s, then 5 s of full right lock.

**Retail.** The slip angle rose to 68 degrees within 2 s while the speed fell
to 8 m/s, then held 26 degrees at 74 deg/s. The heading moved about 137 degrees
in the first 2.5 s. The census page drive turned 125 degrees with 55 degrees of
slip from 25.8 m/s.

**Page against retail.** The run is the fixture `tests/fixtures/vehicle_law_puma*`
(`lab/veh_law_fixture.py` now finds a mod tree's `_shared/damage.json`).
Replayed under the page's own reconciler, it holds 0.4-1.0 mm median, 15 mm
worst and 0.07 degrees of yaw an ack through the slide. Never corrected, it
ends 0.9 m and 5.7 degrees off. That is `PumaLawTests` in
`tests/test_vehicle_law.py`.

**The vanilla car.** The lab Kubelwagen at 19 m/s (TANK-29's fixture) slips 1
degree at 35 deg/s, and the page holds it to a millimetre.

**Outcome.** The page's tyre law is the server's, so nothing changed. The
census's turn-slip `crab` flag is gone. The straight-line one stays.

### The SdKfz251-Pak38 that turned 21 degrees

This was FHSW kharkov_winter-1941, from the spawner at (780, 150), heading -51
as placed. Retail ran the browser audit's own pattern: 5.5 s of throttle, then
right lock.

**Retail.** It reached 7.9 m/s and met a static 18 m out (2.9 m/s). Pressed
against it under lock, it swung 34 degrees in 3 s.

**Page.** The browser audit of FHSWEurope's copy, on port 5332, moved 23 m,
ended at 2.1 m/s and turned 30.6 degrees.

**Outcome.** The low turn is the level, not the drive. The audit's other
findings on that level were `asset.404` (this worktree's linked
cockpit/`glbs` store) and `veh.deploy-nothing-stood`, neither a drive finding.

**The half-track's drag was the replay's (closed 2026-10-28, TANK-32).** A
second run, on open ground from heading 123, is fixture
`tests/fixtures/vehicle_law_sdkfz251_pak38*`. Replayed, it once accelerated
slower than the server: 5.5 m/s against 7.8 at the same tick, a gear behind,
50 gear misses, the resistance accumulator (`vecC`) 1.5 times the server's.

Term by term against the server's acks, the extra contacts were not the page's.
`vehicle_law_harness.mjs` built the hull from the chassis's node list, which
carries no mark for the Springs the page's drive leaves out. So the replay's
drive took the two tow hooks (no geometry on the level) and the towed Pak 38's
two RollGrip wheels (under the spawned object `traverseOwn` stops at). The
towed wheels touched the ground and counted in the resistance sum and the
friction mean: six contacts where the server has four. The chassis's own
`wheels` list, written from the page's drive on the level, has 22 springs and
no tow parts, so the live page never carried them.

The four the server counts are the two EngineGrip wheels down (`3l`, `3r`) and
the two RollGrip fronts. The sixteen EngineDummyGrip rollers at strength 16
hold the hull up and add nothing. With the replay on the page's own wheels,
the page's `acc` and `fr` match the server's to 0.002 every ack through the
first 0.6 s of throttle. Dropping the fronts had closed the gap only because
it also took away two contacts.

The harness also seeded the server's spring pushes onto the page's sprung
wheels in tree order. The server networks a Spring by its networkableInfo,
not its strength: this hull sends its four EngineGrip springs and the two
hooks. Each networked spring now goes to the page wheel at its rest position,
and every wheel is first stood on the ground at the seeded pose.

| free (never corrected) | server | before | after |
|---|---:|---:|---:|
| speed at serial 1574 (m/s, gear) | 3.63, 1 | 3.16, 1 | 3.64, 1 |
| at 1628 | 7.81, 3 | 5.48, 2 | 7.97, 3 |
| at 1664 | 8.76, 4 | 6.85, 3 | 9.53, 4 |
| throttle phase, median / worst (mm) | | 1403 / 7186 | 127 / 651 |
| gear misses in the throttle | | 50 | 4 |

Under the page's reconciler (`lag`), the throttle holds 1.0 mm median, 26 mm
worst, with no gear misses, and the release holds 0.9 mm. The turn holds 9 mm
median. Its 260 mm worst comes at serial 1732, where the server's hull takes an
object contact (-44.6 m/s^2 in one tick) that the terrain-only replay lacks.
The page recovers within 0.3 s. Nothing in the drive changed, and every other
fixture's numbers are identical. The guard is `SdKfz251Pak38LawTests` in
`tests/test_vehicle_law.py`.

### Probe additions

`lab/veh_law_probe.mjs` gains four things:

- `SEAT_OK=1` treats a `Seat` control as seated.
- `APPROACH=lx,lz;...` walks to points in the hull's own frame before Use.
- Plan words accept `menu1`..`menu9`.
- Every log row carries a wall-clock `t`, so a driver's and an observer's logs
  line up.
