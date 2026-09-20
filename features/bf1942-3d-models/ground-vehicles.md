# Ground vehicles: the Willys drive model

`viewer/ground.js` is the first land-vehicle drive model — a `GroundVehicle
extends Vehicle` that closes parity-audit gap G1 for one vehicle class, the
scout car, on the same seam the flight model uses:

    input source  ->  VehicleState  ->  presentation (rig, camera, audio)

Verified headlessly: `tests/ground_harness.mjs` drives the model under node
against an analytic floor and `python3 -m unittest tests.test_ground` asserts
25 cases over it (settling statics, top speed, steering sign and rate, a 2 m
drop, brake/reverse). No page work is in this change; wiring a jeep picker
into `map.html` is the next, separate step.

## What the glb actually carries (audited, Willy.glb)

The G1 audit promised the drivetrain reaches the glb, and it does. Field by
field, from `viewer/models/Willy.glb` (extras verified against
`Objects/Vehicles/Land/Willy/{Objects,Physics}.con` in `Objects.rfa`):

| node | `extras.physics` | source |
|---|---|---|
| `Willy` (PCO) | `mass 2500`, `drag 1.5`, `speedMod 1`, VCLand/VTScoutCar, exit data | Objects.con |
| `WillyEngine` | `engineType c_ETCar`, `torque 10.5`, `differential 7`, `numberOfGears 5`, `gearUp 0.95`, `gearDown 0.4` | Physics.con |
| `WillyFrontSpringR/L` | `grip c_PGFRollGrip`, `strength 25`, `damping 5` | Physics.con |
| `WillyBackSpringR/L` | `grip c_PGFEngineGrip`, `strength 25`, `damping 5` | Physics.con |

Plus the rigs, which double as chassis data: the front wheels'
`RotationalBundle` (`yaw ±30° from c_PIYaw, setMaxSpeed 200`) *is* the
steering — lock angle and servo rate both — and `WillyEngine`'s ±5000 roll
accumulator is the rev counter. Wheel positions come off the node transforms
(fronts at `±0.6/-0.139/-0.75` in the root frame, rears at `±0.6/-0.122/1.46`;
-Z forward). The wheel radius is not declared anywhere but is measured off the
`Willy_WheelR_M1` vertex bounds in the same glb: **0.364 m**.

`collectChassis()` reads all of the above from the node tree — a `Spring`
node with a `physics` extra is a wheel, an ancestor yaw rig on `c_PIYaw`
makes it steered, `c_PGFEngineGrip` makes it driven — so a Kubelwagen or a
six-wheel Sherman side arrives through the same walk with no per-vehicle
table. The `WILLYS` spec covers only what the data does not say.

## Decisions

> **Superseded in three places by the 2026-09-19 research round.** The gear
> ladder, the friction coefficient and the spring force law are all data now.
> The paragraphs below are kept as written because the arguments in them are
> what the new readings had to displace; each one carries a pointer to
> [what changed](#what-the-2026-09-19-round-made-data).

**Suspension is the shipped numbers, and they are better than they look.**
Each wheel is a vertical ray from its rest position; compression times
`setStrength` plus compression-rate times `setDamping`, per mass (the same
units reading as `setTorque`). The evidence for that reading: four wheels
give the heave mode `2*sqrt(4*25) = 20` of critical damping, and `4*5 = 20`
is exactly what the data supplies — someone at DICE tuned the Willys
critically damped, and the coincidence only works in per-mass units. The
static solution (100·x = 14.73, x = 0.147 m; front axle carrying 2/3 by the
wheelbase lever) is asserted in the tests to two decimal places.
*(PHY-5 keeps the per-mass reading and refutes the rest: there is no ray, the
axis is the hull's own, the strength is multiplied by 1.5, and the "exactly
critical" coincidence was an artefact of dropping that 1.5.)*

**The gearbox uses the declared shift points; the ratios are ours.** The game
declares `numberOfGears 5`, `gearUp 0.95`, `gearDown 0.4` — and *no per-gear
ratio anywhere in the vanilla data* (checked: `Physics.con` has no other
gearbox keys; parse-side there is nothing more to extract). The shift points
only make sense as fractions of a rev ceiling, and with the ratio ladder
`[3.8, 2.6, 1.8, 1.25, 1.0]` [free] the automatic never hunts: a 0.95 upshift
lands revs at 0.65–0.76, above the 0.4 downshift line. Reverse borrows first
gear, which is what caps it near 17.5 km/h.
*(TANK-3: the ratios are not authored in a `.con` and never were — they are
compiled into `EngineTemplate`'s constructor. The ladder is data.)*

**Top speed is an equilibrium closed by one fitted number.** `revLimit = 356
rad/s` [free] closes `v = revLimit·R/(diff·topGear)` at 18.5 m/s; torque
fades linearly over the last `1 − gearUp` of the rev range (the same shape
`setNoPropellerEffectAtSpeed` gives aircraft), so the model settles at
**18.3 m/s = 65.8 km/h** — inside the 60–70 km/h the game's Willys does.
Incidentally 356 rad/s is ~3,400 rpm, the right neighbourhood for the real
jeep's Go-Devil engine, but nothing leans on that.
*(Gone. Full revs in a gear is the engine's own EngineGrip target, and the
model now settles at 46.5 km/h — outside the remembered band, and said so
rather than fitted back into it.)*

**Drive is `setTorque` as acceleration, first gear gets it all.** 10.5 m/s²
in first, scaled down by ratio per gear, applied at the rear contact patches
(the axle `c_PGFEngineGrip` marks), inside a per-wheel friction circle
`mu·load` with `mu = 1.0` [free]. Launch is therefore traction-limited at
~6 m/s² — the rear axle carries only a third of the weight — which is a
behaviour, not a tuning.
*(PHY-2: `mu` is the mean of the two contacting materials' `materialFriction`,
so the jeep launches at 0.9 on grass and 0.55 in water.)*

**Steering reads the rig, not a constant.** The physics takes its steer angle
from the same rate-limited surface `applyRig` poses the front wheels with, so
the wheels can never point anywhere the model is not steering. Sign keeps the
aircraft convention: positive `c_PIYaw` turns right (negative yaw rate).
Lateral force is linear in slip angle (`corneringStiffness 7` per rad per
unit load [free]), saturating against the friction circle at ~8° of slip.
Load-proportional stiffness makes the jeep neutral-steer analytically; at the
limit the driven axle's circle is eaten by drive and it pushes wide.

**Brake/reverse is the game's one-axis behaviour.** Opposed throttle brakes
(8 m/s² [free], load-distributed, in the circle) until below 0.5 m/s, then
the same input drives the other way.

**The Engine rig is deliberately not spun.** `applyRig`'s rate-driver
fallback would swing the whole wheel assembly around the crankshaft (no
`spinsWithEngine` flags exist on the Willy, and its Engine node parents all
four wheels), so `GroundVehicle.advancePropeller` is a no-op and each wheel
is rolled individually from its own contact speed. Suspension compression
slides each spring node up its travel, which also keeps the tyres visually on
the ground instead of buried by the static sag.

## Constants: data vs fitted

[data] — transcribed, will not move: mass 2500, drag 1.5, torque 10.5,
differential 7, numberOfGears 5, gearUp 0.95, gearDown 0.4, strength 25,
damping 5, steering lock ±30° at 200°/s, wheel radius 0.364 (measured from
the mesh), gravity −14.73 (`physics.js`).

[free] — fitted, each awaiting measurement against the real game:
~~`gearRatios`~~, ~~`revLimit 356`~~, ~~`mu 1.0`~~, `corneringStiffness 7`,
`rollingResistance 0.55`, `engineBraking 0.4`, `brakeDecel 8`,
`suspensionTravel 0.30`, `bumpStiffness 5`, inertia (box estimate:
0.40/1.27/1.29 m² per-mass roll/pitch/yaw), `angularDamping 0.8`,
`boundingRadius 1.8` (drag equation only), `slipFloor`/authority ramp
(numerics), `throttleEase` (audio only).

What the model produced with them: top speed 65.8 km/h; 0→60 km/h in ~5 s
(traction-limited launch); brake from top speed in ~2.2 s; reverse 17.5 km/h;
half-lock at speed ≈ 47°/s of yaw with ~13° of body roll; coast 18→3 m/s
over 15 s. What it produces now is in the next section.

## What the 2026-09-19 round made data

Three of the constants above stopped being `[free]`, one more was deleted
outright, and two were kept but relabelled as inventions rather than as
unmeasured facts. Ledger rows TANK-3, TANK-4, PHY-2 and PHY-5; the brief is
`features/bf1942-parity-round-2026-09-19/viewer-changes.md` items 15–17.

| constant | was | now |
|---|---|---|
| `gearRatios [3.8, 2.6, 1.8, 1.25, 1.0]` | [free], five steps chosen so the automatic never hunts | **gone — data.** `gearLadder(differential, numberOfGears)` builds `getCurrentRatio()` per gear off the engine's own 101-slot curve, for any gear count |
| `reverseRatio 3.8` | [free] | **gone.** It was authored equal to `gearRatios[0]`; reverse borrows `ladder[0]` |
| `revLimit 356` | [free], fitted to land inside the remembered 60–70 km/h | **gone.** Full revs in a gear is the engine's own EngineGrip target, `0.5 x ratio` (TANK-9) |
| `mu 1.0` (Willy), `mu 1.1` (tank) | [free], one coefficient for every surface | **gone — data.** `0.5 x (materialFriction[wheel] + materialFriction[ground])` per wheel, plus a 1.5:1 break-away hysteresis (PHY-2) |
| `lateralMu 0.55` | [free], "a track skids sideways" | **gone as a coefficient**, kept as `lateralGripFraction` — a fraction of the material cap, and labelled an invention: the engine's clamp is isotropic |
| `springStrength` / `springDamping` as read | [data], with the "DICE tuned it critically damped" argument on top | **still [data], and the law around them is now read too**: 1.5x the authored strength, a backward-difference damper, and a hull-frame axis (PHY-5). The critical-damping coincidence is gone — the ratio is 1/sqrt(1.5) = 0.816 |
| `corneringStiffness` (7 / 12 / 7) | [free], awaiting measurement | **still free, and now known to be an invention.** There is no slip-angle curve anywhere in the engine; this is kept for feel, not for parity |
| `lateralGripFraction` (Willy 1/1.5) | did not exist | **new [free], invented.** The break-away hysteresis raised what a latched wheel may pull by half and rolled the jeep; this puts the lateral ceiling back where the fitted `corneringStiffness` was sized for |
| `PARKING_HOLD_SPEED 3.0` | did not exist | **new [free], numerics.** A leaning suspension gives a hull on its own static rake a forward push; the hold that answers it is the engine's own law (`dV = T - Vt` at a closed throttle, x30) faded out above this speed |
| `SPRING_AXIS_FLOOR 0.2` | did not exist | **new [free], numerics.** Where the spring axis barely points at the ground, the probe's Newton step runs away |
| `rollingResistance`, `engineBraking`, `brakeDecel`, `suspensionTravel`, `bumpStiffness`, inertia, `angularDamping`, `yawDamping`, `trackResistance`, `trackDifferential`, `slipFloor`, `throttleEase` | [free] | **still [free].** Nothing this round touched any of them |

### What the model produces now

Measured off `tests/ground_harness.mjs`, before and after, on flat analytic
ground with `materialFriction` at the default 1.0 so only the drivetrain and
spring changes show:

| | before | after |
|---|---|---|
| Willy top speed | 18.29 m/s, 65.8 km/h | **12.93 m/s, 46.5 km/h** |
| per-gear ceilings (m/s) | 4.87 / 7.12 / 10.28 / 14.81 / 18.51 | **3.50 / 5.57 / 8.17 / 11.14 / 13.03** |
| observed upshift speeds (m/s) | 4.72 / 6.81 / 9.79 / 14.08 | **3.38 / 5.32 / 7.77 / 10.60** |
| 0 to 95 % of top | 4.90 s | **3.50 s** |
| brake to stop from 10 m/s | 5.41 m | **5.98 m** |
| brake to stop from top speed | 20.02 m (from 18.29 m/s) | **10.58 m** (from 12.93 m/s) |
| reverse | 4.86 m/s, 17.5 km/h | **3.48 m/s, 12.5 km/h** |
| static compression | 0.147 m | **0.098 m** |
| heave damping ratio | 1.000 | **0.816** |
| Sherman ratio / top speed | 4.0, 33.7 km/h | 4.0, **35.0 km/h** |
| M3A1 ratio / top speed | **17.5**, 114.5 km/h | **5.512**, 56.1 km/h |

The M3A1 is the headline: a half-track that outran every fighter on the map
was an artefact of a gear ratio read out of a curve that was assumed flat.

### What the surface now does

The material under each wheel, `0.5 x (1.0 + ground)` because a wheel's own
material (37, 38, 178) is undefined in vanilla and falls back to material 0:

| surface | id | `materialFriction` | pair mean | 0 to 10 m/s |
|---|---|---|---|---|
| water | 1 | 0.1 | 0.55 | 3.83 s |
| mud, outside map | 6, 7 | 0.5 | 0.75 | 3.02 s |
| rock | 12 | 0.6 | 0.80 | 2.92 s |
| grass, wet dirt, frozen, sand | 2, 3, 5, 9, 10, 11 | 0.8 | 0.90 | 2.75 s |
| default, dry dirt, sand road, dirt road | 0, 4, 13, 14 | 1.0 | 1.00 | 2.48 s |
| gravel, paved road | 8, 15 | 1.1 | 1.05 | 2.48 s |

Before this, every one of those was 1.0 and every row read 2.48 s.

**It shows in traction, not in braking.** First gear asks 10.5 m/s² of two
rear wheels carrying a third of the weight, so a launch runs at the Coulomb
cap itself and the surface is the whole of the answer. The brake pedal is a
free `8 m/s²`, which is less than even mud's `0.75 x 14.73 = 11.0`, so every
surface but water stops in the same distance. Paved and dirt-road come out
identical off the line for the same reason from the other side: above a pair
mean of about 1.0 the engine's own torque is the limit rather than the grip.

**And it shows for a jeep, not for a tank.** A tracked hull's propulsion is
`bodyThrust` applied once at the hull (TANK-7), not through the contact
patches, so the Coulomb cap does not gate its launch: on Wake the M3A1 reaches
10 m/s in 2.67 s on grass and 2.67 s over water, where the Willy takes 2.60 s
and 3.53 s. That is a property of the viewer's tracked model, not a reading of
the engine, and it is the clearest remaining place where the two classes
disagree about what drives a vehicle.

### On the page, on a real level

Driven headless on Wake with Playwright (`?shots`, `__car` stepped at 1/60 so
the sim does not run at the 1.5 fps the renderer manages on that level), from
a real seat entered through a real `EntryPoint`. Wake's material map carries
juicy grass (3), dry and wet sand (10, 11) and sand road (13); the spot chosen
for 11 sits below the water line, so the page's own rule hands it water's 0.1
and the pair mean comes out 0.55 — which is the wiring working, not a fault.

| | grass (0.9) | dry sand (0.9) | submerged (0.55) |
|---|---|---|---|
| Willy top speed | 48.8 km/h | 46.7 km/h | 46.5 km/h |
| Willy 0 to 10 m/s | 2.60 s | 2.60 s | **3.53 s** |
| Willy brake to stop | 11.67 m / 1.72 s | 9.60 m / 1.67 s | 9.56 m / 1.72 s |
| Sherman top speed | 35.9 km/h | 35.0 km/h | 34.9 km/h |
| M3A1 top speed | 48.3 km/h | 48.4 km/h | 48.4 km/h |
| M3A1 0 to 10 m/s | 2.67 s | 2.65 s | 2.67 s |

The ladders read off the live page are the engine's: Willy
`7 / 11.136 / 16.333 / 22.273 / 26.064`, Sherman
`4 / 6.364 / 9.333 / 12.727 / 14.894`, M3A1
`5.512 / 9.459 / 14.583 / 18.617`, with the two tracked hulls running on
`ladder[0]` for life as TANK-7 says.

Top speeds on the page run a little above the flat-ground harness figures
because Wake is not flat; the grass run is downhill.

## Open gaps

- **Reference measurements.** Every [free] constant above is falsifiable with
  a recorded drive in wine: top speed on Kasserine's flats (times a known
  distance), a stopwatch on 0→top and brake-to-stop, a steering-circle
  diameter at full lock, and a kerb drop for the suspension travel. The
  measurement protocol in `features/flyable-vehicles/measurement-protocol.md`
  transfers directly.
- **Grip classes.** `c_PGFRollGrip` vs `c_PGFEngineGrip` (and vanilla's other
  two, `c_PGFEngineDummyGrip`, `c_PGFRollGripWhenOccupied`) are read only as
  driven/free markers; whatever friction difference the engine gives them is
  unread. One `mu` covers everything. **Closed 2026-09-19 (ledger PHY-2):
  `mu` is not a free constant — it is `MaterialManager.materialFriction`,**
  the mean of the two contacting materials' values, and the engine clamps a
  per-tick tangential velocity change to `A·1.5·9.82·L/30` m/s (×1.5 while the
  static latch holds), isotropically on the tangential plane. Vanilla's table
  runs 0.1 water, 0.5 mud, 0.6 rock, 0.8 grass and sand, 1.0 dirt road, 1.1
  gravel and paved; 13 installed mods carry the word and Interstate 82 ships a
  wholly different set. There is **no slip-angle curve and no `lateralMu`** in
  the engine at all.
- **The exe's car integrator is unread.** The point-body integrator, gravity
  and the drag equation are decompiled fact (`physics.js`); the spring/tyre/
  gearbox path is not, and this model's shape is reconstruction.
  **Closed 2026-09-19 for the spring (ledger PHY-5) and the gearbox
  (TANK-3):** the spring is
  `accel = −(strength·g·(−1/9.82)·D + damping·(D − D_prev)/dt)` applied to the
  **root** at a root-relative position, `D` a displacement from an authored
  mount offset and `D_prev` a one-tick backward difference; and the gear
  ratios are read data, not ours (below). The tyre path is PHY-2 above; what is
  still unread is `ResponsePhysics::solveImpulse` and `impulseOn`'s restitution
  and penetration handling.
- **Vertical-ray suspension — and there is no ray in the engine at all.**
  Our rays are world-vertical, correct on the flats and increasingly wrong past
  ~20° of lean; slopes also need the heightfield normal for the contact frame.
  Fine for v1, wrong on a dune face. **What 2026-09-19 settled is that the
  engine casts nothing** (ledger PHY-5): `Spring::handleCollision` only records
  that the wheel is touching and which material it touched, contacts come from
  `checkVsTerrain` walking the collision mesh's own vertices and faces, and the
  binary's single line-versus-triangle routine has two callers, both in AI
  pathfinding. The spring's axis is authored data (`setAxisFixation`), never
  world-vertical. So the ray is a viewer approximation of a vertex-contact
  solver, and it should be labelled as one rather than as the engine's shape.
- **No hull collision.** Wheels see the ground function; the body sees only a
  belly failsafe. Driving into a wall, another vehicle, or Wake's pier is not
  resolved. `WorldCollider.sweepSphere` is sitting there for it. *(Since wired:
  the hull is swept as a sphere against the static collider and stops dead —
  so another vehicle is a fixed wall. What the engine does instead — a
  mass-ratio push applied at the contact point, a friction pass, and crash
  damage to both — is read from the binary in
  [collision-response.md](../bf1942-engine-reference/subsystems/collision-response.md), 2026-09-19, with an
  ordered implementation plan in
  [`features/vehicle-collision-physics/`](../vehicle-collision-physics/README.md).
  The same document closes the two items above it: there is no ray in the
  engine's wheel path — a wheel is a spring node whose layer-0 collision
  vertices are dropped on the heightfield — and the tyre model is a per-tick
  velocity-change request clamped to `mu x N.y x 14.73/30`, section 8.)*
- **Tanks and half-tracks.** Addressed below (`TrackedVehicle`) rather than
  open any more: `c_ETTank` steers by differential, not a steered wheel pair,
  and `ShermanEngine`/`M3A1Engine` do bind `setInputToYaw` (yaw and roll both
  ±1°, a cosmetic body-lean rather than a steering angle — see
  `TrackedVehicle`'s own `#step` comment for why that field name is a trap).
- **Passenger seat.** `WillyPassengerPCO` is discovered as its own
  PlayerControlObject; seat switching is the same future problem the B17's
  gunners are.

## The page wiring: drive mode and the E key (`viewer/map.html`)

The "next, separate step" above is done. The pilot checkbox and the E key
share one seat-management path, and the model is untouched — everything below
is presentation and routing.

**Classification is the engine's own taxonomy, not a name table.**
`classifyVehicle(node)` walks a spawned PCO's subtree for the one `Engine`
node with `extras.physics.engineType` — stopping at every nested
PlayerControlObject, so a passenger seat cannot borrow the driver's engine
and a carrier is not classified by its parked aircraft — and maps `c_ETPlane`
to the flight model, `c_ETCar` to `GroundVehicle`. Ships (`c_ETShip`), tanks
(`c_ETTank`, the differential-steering gap above) and engineless mounts
(Defgun, Stationary_Browning) classify null and stay furniture. `setPilot`
now takes an optional node — `setPilot(true, node)` binds the mode to THAT
vehicle — and without one prefers the first aircraft, then the first car,
then the old Corsair/Spitfire/Zero name trio for extracts that predate
`extras.physics`.

**Drive mode is the pilot shell with car pedals.** `drive(dt)` mirrors
`pilot(dt)`: W/S onto `c_PIThrottle` and A/D onto `c_PIYaw` through the same
`axisToward` spring (unlike the aircraft's latching throttle, the pedal
springs back — a lifted foot is engine braking), Space onto `c_PIFire` for
whatever armed car arrives later, `integrate`, guns, `VehicleCamera` pose. C
cycles the same four views; the engine audio, ambience duck and weapon-audio
paths all read `aircraft || car` now. The dashboard — `<control> · km/h ·
gear` (gear `R` below −0.25 m/s of signed forward speed) — rides the `#ammo`
element, which is the rifleman's ammo line and is exactly vacant while he
drives.

**E is `c_PIEnterExitVehicle`.** On foot, `scanForEntry` sweeps every cached
`EntryPoint` node four times a second (`extras.seat.entryRadius`, 2.3 m on a
Willys; 4 m [free] when a mod declares none; only entry points whose
`seat.control` matches the vehicle root's control — the driver's door, not
the passenger's) and offers the nearest on the HUD: `E — enter the Willy`.
Entering suspends the soldier rather than tearing him down — weapon,
magazines and flag selection all wait; only the viewmodel, crosshair and
on-foot FOV are packed away — so gun groups now coexist: `collectGuns` passes
`replace: false` and `releaseGuns` splices surgically, the same courtesy
`loadHandWeapon` already extended in the other direction.

**Exit placement is the vehicle's own datum.** E from a seat (aircraft only
when grounded or under 3 m/s) parks the vehicle exactly where it stands via
`leaveVehicle` — velocity zeroed, controls centred, exterior restored, and
deliberately *not* `reset()`, which is the teleport back to spawn that the R
key remains — then places the soldier at `extras.physics.soldierExitLocation`
off the PCO root (`setSoldierExitLocation`; the Willys declares
`-1.5/0/-0.8`, its left running board). The declared vector is in Refractor's
z-forward frame, so its Z is negated at the boundary, the same fix `rig`
angles get; a vehicle that declares none puts the soldier 2 m to its left
[free]. `soldier.spawn` then settles him to the floor and he steps out facing
the vehicle's heading, rifle back in hand.

Constants added by the wiring, all [free]: the 4 m fallback entry radius, the
0.25 s entry-scan period, the 3 m/s airborne-exit threshold, and the 2 m
left-side exit fallback. Headless surface: `?shots` now exposes `__car`
beside `__aircraft`.

## Tanks and half-tracks: `TrackedVehicle`

`viewer/ground.js` now exports a second drive model, `TrackedVehicle extends
Vehicle` — same constructor and public interface as `GroundVehicle` (a page
can `new TrackedVehicle(node, parent, options)` in its place), covering any
`c_ETTank` hull: a Sherman's tracks, or a half-track's tracks plus an
ordinary steered front axle. It stands beside `GroundVehicle` rather than
under it — `GroundVehicle`'s per-tick work lives in true (`#`-private)
methods, which JavaScript does not let a subclass reach — sharing the
module's constants and the `Wheel` bookkeeping class instead.

**Wired into `viewer/map.html`.** `VehicleOccupancy.ensureDrive` picks
`TrackedVehicle` for `c_ETTank` roots (same cockpit graft path as Aircraft).

### What `verify-r7.md` confirmed, byte for byte

> **Corrected 2026-09-20 (ledger TANK-1, TANK-7, TANK-9).** The first sentence
> below is wrong and the rest of the paragraph is right. `engineType` **is**
> consulted — it is a bit field read at nine *virtual* call sites, which the
> exhaustive grep behind "no tank-specific code path" could not see — and its
> bit 0 makes `PhysicsEngine::updatePhysics` return at its second instruction
> for a car or a tank, so **neither gets a hull thrust** and `TrackedVehicle`'s
> `bodyThrust` model is wrong at the root. The wheel formula below survives
> intact, and it is now the *whole* of a ground vehicle's propulsion; its `& 4`
> branch is the engine-type test, and it brings the ±1 clamp that caps a tank.
> See [subsystems/tank-driving.md](../bf1942-engine-reference/subsystems/tank-driving.md)
> §1 and §5.

The engine has no tank-specific code path anywhere. Any `c_PGFEngineGrip`
wheel's commanded spin is `getCurrentRatio() * engine.getCurrentDifferentialRPM
(side)`, reading the same `roll` (throttle) / `yaw` (steer) axes any Engine
exposes; a car's Engine simply never binds `setInputToYaw`, so its wheels all
pass `side == 0` and the formula degenerates to the plain uniform throttle
`GroundVehicle` already models. `differentialRPM(throttle, yaw, side)`
(exported for direct testing) is that formula, hand-traced flag by flag
against the raw disassembly:

    side == 0          -> throttle
    side > 0  (right)  -> clamp(throttle * (1 - 1.5*yaw), -1, 1)
    side < 0  (left)   -> clamp(throttle * (1 + 1.5*yaw), -1, 1)

At `throttle == 0` both non-zero branches are exactly zero regardless of
`yaw` — a tank cannot pivot on the stick alone from a dead stop, a direct
algebraic consequence rather than a case this file has to implement
separately.

**The gear-ratio curve correction is the reason this round exists.**
`getCurrentRatio()` samples a full 101-entry array (`GEAR_RATIO_CURVE`), not
five control points on a spline: every slot is 1.0 except the five
`EngineTemplate`'s constructor writes by hand (indices 20/40/60/80/100 =
3.5/2.2/1.5/1.1/0.94). The sample index is `idx = trunc(gear / numberOfGears
* 100)` with `gear` permanently 1 — no vehicle in either binary ever shifts
it — so only `numberOfGears` of 1 or 5 ever land on an authored point; every
other integer count reduces the whole lookup to exactly `3.5 * differential`.
`engineRatio(differential, numberOfGears)` (exported) is computed once at
construction, never resampled — the retail engine never resamples it either.

| vehicle | differential | numberOfGears | idx | ratio |
|---|---|---|---|---|
| Sherman | 4 | 5 | 20 (authored) | **4.0** |
| Willy | 7 | 5 | 20 (authored) | **7.0** |
| M3A1 | 5 | 4 | 25 (not authored, not adjacent to one) | **17.5**, not the ~5.5 a smooth 5-point spline would give |

> **The paragraph and table above are wrong, and were corrected on 2026-09-19
> (ledger TANK-3, `subsystems/tank-driving.md` §3).** The 101-slot array is
> real, but the constructor's flat fill is only its starting point: each
> control-point store is followed by a call to
> `OverTimeDistribution::generateDistribution`, which **interpolates the slots
> between the authored indices**, and there is a **lerp at the read site** as
> well. The earlier pass read the fill loop and the five stores and never
> followed the eleven `CALL`s. The real formula is
> `ratio = 3.5·differential / lerp(curve[i], curve[i+1], frac)`, and index 0 of
> the ratio curve is *not* authored, so slots 0–20 ramp up from 1.0 to 3.5.
>
> Sherman 4.0 and Willy 7.0 stand. **M3A1 is 5.512, not 17.5** — `idx = 25`,
> `curve[25] = 3.175` — and its four gears are 5.512 / 9.459 / 14.583 / 18.617.
> Every gear count gets a real ratio, so `numberOfGears` of 4, 8 or 50 are not
> degenerate cases. **And the ladder is not monotonic:** because the curve rises
> over indices 0–20, a gear landing below index 20 gets a *higher* ratio than
> first-of-a-5-speed (`nGears 8, differential 5` → g1 6.83, g2 5.51). Rebuild
> `GEAR_RATIO_CURVE` from the five control points with the piecewise-linear fill
> rather than from the flat default, and stop assuming five gears.
>
> The second curve (`getCurrentTorque`) is indexed by a **normalised rev
> fraction**, `min(|engine[+0xa0]|, 1.0)·100`, not the gear; its control points
> are 0→0.70, 10→0.80, 30→0.90, 60→1.00, 85→0.85, 100→0.70.

### What the glb carries, extended for a tracked chassis

`collectChassis()` reads the same shapes `GroundVehicle`'s does (an `Engine`
node's `extras.physics`, a `Spring` node's own), extended for the two grip
classes a tracked vehicle's wheels use that a Willys never needs — verified
against the live Wake scene, not merely assumed from the grip name:

- `c_PGFEngineGrip` — driven. Sherman and M3A1 both carry **two** per side
  (TANK-14's "x2 per side"; a first pass at the test fixture built only one
  and got the standing suspension load wrong), `strength 18`/`20`.
- `c_PGFEngineDummyGrip` — idler/return-roller road wheels, spin-only
  (TANK-14). Every one on both vehicles ships `setStrength 0`/`setDamping 0`,
  so the existing spring formula already prices them at zero without this
  file special-casing them for it.
- `c_PGFRollGrip` under a yaw-bound `RotationalBundle` ancestor — a
  half-track's ordinary steered front axle (`M3A1Wheel1`, ±40°). Found the
  identical way Willy's own front wheels are, with one correction
  `GroundVehicle`'s walk didn't need: the ancestor must be a
  `RotationalBundle` specifically, not merely any ancestor with a `c_PIYaw`
  axis — a `c_ETTank` Engine now has one of its own (the body-lean below),
  and it sits between every wheel and the root, so the unfiltered walk marked
  every wheel on the vehicle "steered" the first time this was run against
  real data.

A wheel's rolling radius is measured off its own mesh bounds
(`measureWheelRadius`) — the same reading TANK-14/15 took by hand off the
Sherman and M3A1 collision meshes, generalised so a tank from any mod answers
for its own wheel size rather than needing a per-vehicle number; confirmed to
reproduce TANK-14/15's own figures (≈0.255 m, ≈0.17 m) against the live scene.
Root PCO mass/drag are read off the node too (`Sherman` 25 t, `M3A1` 15 t) —
unlike `GroundVehicle`, which still gets both from `WILLYS`, because this
class has to answer for two very different vehicles at once rather than one
Willys.

### Decisions

**The Engine's own roll/yaw axes are read as the throttle/steer input,
already rate-limited.** A `c_ETTank` Engine's roll (throttle) and yaw (steer)
axes are ordinary `driver: "position"` axes here — a ±1 degree body-lean
span, not the wide accumulator range a car's throttle axis gets — so
`Vehicle.advanceSurfaces` has *already* put both through the same
declared-`setMaxSpeed` servo every other rig part answers to, and
`s.surfaces` holds them normalised back to -1..1. Reading them from there,
rather than the raw stick the way `GroundVehicle` reads `c_PIThrottle`, is
this file's reading of the round's recipe ("axisToward('roll')/('yaw')"):
verify-r7.md pins the *formula* these feed (TANK-10) but not the rate a
keypress becomes the `PhysicsEngine`-internal value it reads, so the rate is
an approximation — the one the vehicle's own data happens to declare for
these exact axes, not a byte reading of `PhysicsEngine`'s own smoothing.
[free, shape only]

**A half-track's front-axle steering key collides with its Engine's own
body-lean axis.** Both are keyed `(control, c_PIYaw, yaw)` in
`Vehicle.servoAxes()`'s shared map, which dedupes strictly by that triple —
correct for a mirrored aileron pair, its designed case, wrong for two
unrelated mechanisms that happen to share an input name. Whichever axis's
`setMaxSpeed` wins the race governs the *rate* `s.surfaces` converges at
(Engine 4°/s over a 1° span, `M3A1Wheel1` 2°/s over 40° — both settle inside
half a second either way), never which value it converges *to*
(`this.input('c_PIYaw')`, read once, shared) — bounded and harmless, but a
real gap in `Vehicle`'s shared key scheme this file works around rather than
fixes, since `flight.js` is outside this track's ownership.

**Forward propulsion and the per-side drive split are this file's own bridge
between two confirmed formulas, not a third one.** `Aircraft.step` already
carries `PhysicsEngine::updatePhysics`'s confirmed shape verbatim (`e =
throttle - rho*(vel.fwd)/fadeSpeed`, `K = 0.1*|throttle| + e*|e|`, `F = fwd *
K * ratio`) — real, shared code every Engine-derived vehicle runs, but only
ever read for the single whole-body throttle a plane or a car presents,
because neither binds `setInputToYaw`. `driveAccel` (exported) evaluates the
identical shape once per side, with that side's own `differentialRPM`
standing in for the whole-vehicle throttle the confirmed function reads. It
degenerates to exactly the confirmed case when `yaw == 0`. Applied at that
side's driven wheels and clamped by their own friction circle — not, as
`Aircraft.step` applies its own, as an unconstrained body force — because a
tank's tractive effort is bounded by what its tracks can grip the same as a
Willys' rear axle is, and an aircraft's thrust is not bounded by anything the
wheels touch.

**`TANK.trackResistance` closes the top-speed equation, not the confirmed
formula's own governor term.** Applied unconstrained, `driveAccel`'s governor
alone asymptotes toward the same ~131 m/s for *any* vehicle regardless of
`ratio` (`fadeSpeed` = 100 m/s is tuned for aircraft cruising in that range);
`ratio` only changes how fast a vehicle approaches that shared ceiling, not
where it sits. Nothing in verify-r7.md gives a ground vehicle's own top
speed the way a car's `revLimit` does for `GroundVehicle`, so a driven
wheel's own resistance term (linear in its own contact speed) is what
actually closes the equation at a tank-scale speed here, fitted so the two
vanilla tanks land in a plausible band — Sherman ≈33 km/h, M3A1 ≈112 km/h —
while still showing the corrected ratio's real effect: the M3A1 markedly
livelier than the Sherman, in the same order as both vehicles' real top
speeds. Not a measurement. [free]

**A driven wheel's own visual roll follows the differential, not the body's
integrated speed.** The entire visible point of this steering law: the wheel
a player watches spin is driven by `ratio * differentialRPM(side)` directly,
so the two tracks visibly move at different rates mid-turn, which can read
slightly ahead of or behind the hull's own separately-integrated motion —
see `driveAccel`'s own comment for why propulsion and the visual per-wheel
rate are two different mechanisms here. Every other wheel, dummy rollers
included, rolls off its own actual contact speed the way `GroundVehicle`'s
wheels all do.

**The half-track's front axle reuses Willy's tyre model unchanged, at
Willy's own stiffness, not the tracks' stiffened one.** TANK-15: "an
ordinary steerable front axle" — free-rolling, never engine-connected, so it
gets only passive rolling resistance longitudinally and the same
cornering-stiffness lateral model Willy's own front wheels use. Reusing the
*track* stiffness there instead very nearly rolled the M3A1 in a held turn:
that wheel, unlike a track wheel, is actively deflected by the steer angle,
so real slip runs through a coefficient four times Willy's own. Kept as a
separate constant, `TANK.frontAxleCorneringStiffness`, once this was found.

### Constants: data vs fitted

[data] — off the live Wake scene, confirmed against `verify-r7.md`'s own
citations: Sherman mass 25000/drag 2, M3A1 mass 15000/drag 2, both engines'
differential/numberOfGears/torque, every wheel's grip class and
strength/damping, the front axle's ±40° lock, wheel radii (measured, not
declared — same situation `WillyRadius` is in).

[free] — fitted, each awaiting a reference measurement no more than Willy's
own. ~~`TANK.mu` (1.1)~~ and ~~`lateralMu` (0.55)~~ left this list on
2026-09-19 (PHY-2): a track wheel's material is as undefined as a tyre's, so
both fall back to material 0 and the coefficient comes from the ground.
`lateralGripFraction` replaces `lateralMu` as a fraction of that material cap
and is labelled an invention. The rest stand: `corneringStiffness` (30, stiffened well past Willy's
7 on the basis that a track resists sliding harder than a tyre, not a
measurement), `frontAxleCorneringStiffness` (7, Willy's own, for the one
wheel on a tank that actually is a tyre), `trackResistance` (0.8, the
top-speed closure above), `rollingResistance` (0.5, the front axle's own,
Willy's shape), `suspensionTravel` (0.35 — needs to be generous specifically
*because* the dummy wheels are legitimately worth nothing: a Sherman's whole
hull rests on only 4 real springs, so standing still alone already asks for
~0.20 m of the 0.35), `angularDamping` (15.0 — see below), `halfWidth`/
`halfLength`/`hullHalfHeight`/`boundingRadius`/`wheelRadius` (fallbacks only;
`collectChassis` measures the first two, and per-wheel radius, off the
actual node tree whenever there is one to measure).

`angularDamping`'s value is the one constant this track spent the most
tuning on, because it is the one that turned up two rollovers rather than a
speed that merely looked wrong. Held from a stand-still, a sustained turn
rolled the M3A1 onto its roof somewhere between yaw input 0.2 and 0.3 at
Willy's own damping-equivalent order of magnitude; raising it to 5.0 fixed
that case but not a harder one — the same turn entered from the vehicle's
own straight-line top speed (~31 m/s) rather than accelerated into, where
the extra entry speed alone very nearly doubles the centripetal load through
the identical suspension formula. 12.0 was the lowest value that survived
both in testing; 15.0 is what shipped, for margin.
`corneringStiffness` made no difference to either case at any value tried —
the wider track (M3A1's own wheels sit up to 3 m from the root, at the front
axle) puts a given yaw rate through a far larger torque than Willy's tighter
wheelbase does through the identical formula, which damping resists directly
and stiffness does not.

### Open gaps (`TrackedVehicle`)

- **The shared-key collision** between a half-track's front-axle steering
  and its Engine's own body-lean axis (`Vehicle.servoAxes()`'s dedupe, see
  Decisions above) is worked around here, not fixed. A real fix touches
  `flight.js`.
- **Reference measurements**, same ask `GroundVehicle`'s own open gaps make
  for Willy: nothing in the `mu`/`corneringStiffness`/`trackResistance`/
  `angularDamping` table above is a recorded drive against the real game.
- **The exact retail force law a tracked wheel's own friction applies** is
  still unread (verify-r7.md's own Open section, PHY-2/PHY-4) — body thrust
  is applied once per step (TANK-7); EngineGrip builds a target-velocity
  band rather than a second copy of that thrust.
- **Vertical-ray suspension and no hull collision**, inherited unchanged from
  `GroundVehicle`'s own open gaps — everything said there about a tank's
  much larger hull applies at least as much as it does to a jeep's.
- **A wreck/destroyed state** is not modelled; `state.destroyed` exists on
  `VehicleState` but nothing here ever sets it.

## 2026-09-17: the Sherman would not steer, and juddered while it failed to

Reported from play: "the drive train doesn't work, it's very stilted."
Measured, before any change — a Sherman at full throttle on Aberdeen:
**18.5 km/h** in a straight line and **1.4 deg/s** of yaw at full lock, which
is a four-minute 360. Four separate defects, each found by measurement rather
than by reading:

**1. A period-2 limit cycle, every frame, for as long as the turn was held.**
Driven at full lock the model settled into a textbook alternating
oscillation: body roll rate flipping −15.08 deg/s / +14.91 deg/s and the four
wheel loads swapping sides (`[5.39, 4.37, 3.00, 1.98]` ↔
`[3.22, 2.18, 5.22, 4.18]`) on alternate frames, indefinitely. That is the
judder, and because every track force here scales with the load it is applied
at, it also scrambled the differential the class exists to model. The cure was
the friction ellipse below — measured, not assumed: the cycle is gone at 60 Hz
with that in place, and 60/120/240/480 Hz now agree to four decimals on every
figure the harness reports. `TrackedVehicle.integrate` sub-steps at 120 Hz
regardless, which is the engine's own rate (`physics.md` §3: a fixed 30 Hz
tick with four `PointPhysicsNode` substeps), as margin against a mod's
stiffer numbers and against the 0.1 s `dt` clamp upstream. `tankSteadyTurn`
in the harness counts roll-rate sign changes over a second of a settled turn:
0 now, one per frame before.

**2. An isotropic friction circle on a tracked vehicle.** The class inherited
`GroundVehicle`'s single `mu` for both axes. That is a tyre's property, not a
track's — steel grousers bite hard along the track and the same track slides
sideways comparatively freely, which is the entire reason a tracked vehicle
can steer by scrubbing. One circle at the tracks' own high `mu` got both
halves wrong at once: it starved the differential of the longitudinal force
that is a tank's only yaw authority, while handing every hull a lateral force
big enough to roll it. At `mu` 1.1 against GRAVITY 14.73 a full-lock turn
asks 10.9 of roll moment about the contact patches where the springs can
answer at most `sum(load) * halfWidth` = 12.5 — the model could out-grip its
own track width, and the M3A1 duly went onto its roof the moment anything let
it turn quickly. `lateralMu` (0.55) is a separate, lower limit; `mu` (1.1) is
untouched. `corneringStiffness` drops 30 → 12, which is now only how fast
that limit is reached, not how large it is: at 30 the tracks reached it
inside a tenth of a degree of slip, which read as a hull welded to its
heading.

**3. Steering authority was hostage to the top-speed governor.** One
constant, `trackResistance`, was both the EngineGrip damper that closes the
top-speed equation and the thing that made the two tracks' targets differ, so
every unit of turn rate cost a proportional unit of cruise. Split: the part
of the target both tracks share (`vMean`, the yaw-0 target) keeps
`trackResistance`; the part that differs between them — the whole of the
steering signal — gets `trackDifferential` (20.0). At `yaw == 0` they are
equal and the whole term reduces, term for term, to the line it replaces, so
acceleration, top speed, reverse and TANK-17's no-pivot-from-rest are
unchanged; `differentialRPM` and `engineRatio` are untouched.

The steering half is a **couple**, not a brake, and that took three attempts
worth recording:

  - *Brake* (each track damped toward its own lower target) is what reading
    TANK-2 literally gives, since `differentialRPM` clamps the outer track at
    1.0 and only ever slows the inner one. At the gain that actually turns a
    25-tonne hull, that brake is several times `bodyThrust`: a held full-lock
    turn dragged the Sherman from 32 km/h to walking pace and kept it there.
  - *Couple sized off each wheel's live load* sums to zero only while the
    load is even. A turn loads the outer track, so the pair stopped
    cancelling and the residual was a net forward push — Sherman gaining
    speed to 61 km/h mid-turn, M3A1 to 178 and onto its roof.
  - *Couple sized off the hull's static weight share* fixed the tank and not
    the half-track, whose driven tracks carry only part of its weight (a
    free-rolling front axle carries the rest), so a static share over-drove
    them past the grip they had.

  What shipped: sized and capped off one shared number, `_coupleLoad` — the
  least-loaded *grounded* driven wheel as of the previous sub-step — so both
  halves are identical in magnitude however the weight has shifted. The
  governor half still reads each wheel's own live load, because that half is
  a real friction-scaled contact force rather than a split of engine effort.

**4. `angularDamping` 15.0 was damping yaw as well as roll.** Both rollover
cases it was fitted against are failures about the *roll* axis; nothing in
that tuning record measured what it did to heading. What it did was divide
differential steering by 15. `yawDamping` (2.0) is now its own term; roll and
pitch keep 15.0.

`trackResistance` was also re-fitted, 0.8 → 0.25, to put both hulls back in
the band this file already quotes (Sherman ~9 m/s / 33 km/h, M3A1 ~31 m/s /
112 km/h). The TANK-7 correction — body thrust applied once at the hull
instead of per driven side — halved the propulsion that number was fitted
against and nothing re-fitted it afterwards, which is why the Sherman had
quietly been sitting at 18.5 km/h.

### What it measures now (`tests/ground_harness.mjs`)

| | before | after |
|---|---|---|
| Sherman straight line | 18.5 km/h | **33.7 km/h** |
| Sherman yaw, half lock held | 1.4 deg/s | **27.6 deg/s** |
| Sherman turn radius at a matched 8 m/s | ~340 m | **16.1 m** |
| M3A1 straight line | 67.4 km/h | **114.5 km/h** |
| M3A1 yaw, half lock held | 18.0 deg/s | **10.9 deg/s** |
| Roll-rate sign flips per second, settled full-lock turn | ~59 | **0** |
| Worst `up.y` across every stability case | 0.99 | **0.946** |
| Pivot from a dead stop on yaw alone (TANK-17) | 0 | **0** |

One test changed its premise rather than its threshold:
`test_the_m3a1s_front_axle_turns_it_tighter_than_the_sherman` compared the
two hulls' yaw rate at full throttle — i.e. a 34 km/h vehicle against a
114 km/h one, where the faster is grip-limited, so it answered a question
about top speed rather than about the front axle. Replaced by
`test_both_hulls_turn_at_a_vehicles_radius_at_a_matched_speed`, which holds
both at ~8 m/s and reads turn radius: 16.1 m and 20.3 m, neither tighter by a
margin worth asserting, so what is asserted is the thing that actually
regressed — that both can steer at all.

### Still open after this

- `mu` and `lateralMu` are no longer on this list — see
  [What the 2026-09-19 round made data](#what-the-2026-09-19-round-made-data).
  `trackDifferential`, `yawDamping`, `corneringStiffness`,
  `lateralGripFraction`, `trackResistance` and `angularDamping` remain on the
  standing ask for a recorded drive against the real game; nothing there is a
  measurement of retail.
- `trackResistance 0.25` is now known to be a heavily detuned version of a
  read constant rather than a free parameter of its own: the engine hands the
  friction solver a wanted velocity change multiplied by 30, and this term is
  that multiplication. It was fitted down to 0.25 against a Sherman driven by
  an M3A1 ratio of 17.5; with the corrected 5.512 the case it was fitted for
  no longer exists, and re-deriving it from the engine's own x30 is the
  obvious next piece of work on the tracked model.
- The Sherman gains a little speed in a hard turn (33.7 → ~39 km/h in the
  harness) rather than losing a little. The couple cancels exactly; the
  residual comes from the friction ellipse scaling the two sides' totals
  differently once their lateral forces diverge.
- ~~**A tank's turret does not traverse from the driver's seat.**~~ **Fixed
  2026-09-17** — `seats-and-manned-guns.md` has the five things that were in
  the way, including an inverted aim that turned out to affect every manned
  gun in the viewer, not only tanks. What is still open from it: the external
  camera modes (chase/front) frame the hull's heading rather than the
  turret's, so cycling away from the cockpit on a tank gives a view that does
  not follow the gun.

## 2026-09-20: the review of the 2026-09-19 drivetrain change

An adversarial re-derivation of what the 2026-09-19 round left. Three of its
conclusions stood, three did not, and one whole ledger row about the engine
turns out to be wrong in a way that matters to every ground vehicle.

### The 0.5 in the EngineGrip target is a gear-change blend, not a scale

`ResponsePhysics::addFriction` builds the target at lnxded `0x0825c2ed` to
`0x0825c407`, and the expression is

```
T = (1 - 0.5*b) * ratio * getCurrentDifferentialRPM(side) * fwd
    + 0.5*b * (Vt . fwd) fwd
```

against the **same** forward axis — a blend between the commanded surface speed
and the wheel's own contact speed, not a halving of the command. `0.5*b` is
formed twice, at `0x0825c32b` (`fld ds:0x86b05e8` = 0.5, `fmul [edx+0xb8]`,
`fsubr ds:0x86ba8d4` = 1.0) and at `0x0825c3b1`, and the two terms are summed
at `0x0825c3d7`-`0x0825c407`.

`b` is engine `+0xb8`, and it is **the gear-change timer**. `Engine::handleUpdate`
lnxded `0x0823e120` counts it down by `dt / gearChangeTime` to zero
(`0x0823e24f`, `0x0823e25a`) and nothing on the server re-arms it, so after the
first `gearChangeTime` of a vehicle's life `b = 0` and the target is the command
in full. Its constructor seed of `1.0` (`0x0824c756` region) is what the earlier
reading took for the steady value, and that is where 46.5 km/h came from.

### The rev ceiling is 1.2, and the floor is 1.0

The same `handleUpdate` is the whole gearbox:

```
revs += 0.05 * ((pedal - load) - 0.5*revs)      // fixed point 2*(pedal - load)
revs  = min(1.2, max(-1.0, revs))               // 0x0823e2bf onward
if (revs > gearUp   && gearChangeTimer == 0 && gear < numberOfGears) gear += 1
if (revs < gearDown && gear > 1)                                     gear -= 1
```

`pedal` is the Engine's own roll angle over `getMaxRotation().z`; `load` is
`+0xa4`, the running mean `feedbackLoop` `0x0824c850` leaves there from the
friction the wheels actually delivered (`dot(fwd, F) * ratio / torque`, clamped),
and `handleUpdate` zeroes it every tick. `setGearUp`, `setGearDown` and
`setGearChangeTime` are read here and nowhere else, which is the first time
anything in the corpus has shown them being read at all.

So the road speed a gear reaches is `ratio * revs`, and revs run to **1.2**, not
1. Top gear is `1.2 * ladder[top]`; reverse borrows first gear and the clamp's
lower arm, which is exactly `-1.0`, so reverse is 1/1.2 of forward in first.

| | `ladder[top]` | `x revs cap` | engine, simulated | viewer, harness |
|---|---|---|---|---|
| Willys (car) | 26.064 | 31.28 m/s = 112.6 km/h | 30.4 m/s, **109.6 km/h** | **107.6 km/h** |
| Sherman (tank) | 14.894 | 14.89 m/s = 53.6 km/h | 14.85 m/s, **53.5 km/h** | 41.2 km/h |
| M3A1 (tank) | 18.617 | 18.62 m/s = 67.0 km/h | 18.57 m/s, **66.8 km/h** | 64.2 km/h |

The "engine, simulated" column is a tick-level simulation of `handleUpdate`'s
rev filter against `addFriction`'s EngineGrip target and the Coulomb budget; it
is robust to the surface coefficient and to the resistance term (109-112 km/h
for the Willy across `mu` 0.6-1.1 and `resistance` 0.01-0.05). A tank's driven
wheels carry a side, so `getCurrentDifferentialRPM` clamps their share to
[-1, 1] and their ceiling is `1.0 * ratio` rather than `1.2 * ratio`.

**And `revLimit 356` was never a measurement.** The comment that carried it said
so: `[free]`, "fitted... to land inside the 60-70 km/h band the game's Willys is
*remembered* to do", and the Open gaps section above still lists the reference
drive that would settle it as not taken. Nothing in this repository measures a
vanilla Willy's top speed. 65.8 km/h was a fit to a memory; 46.5 km/h was a
misread constant; 109.6 km/h is what the engine's own code does.

### `engineType` is load-bearing, and body thrust is gated off for ground vehicles

`EngineTemplate::getEngineType()` is virtual slot `+0xa0`, and it is called from
four places that all matter:

- `PhysicsEngine::updatePhysics` `0x0824cbb0`: `if ((getEngineType() & 1) == 0)
  return;` — the **entire body-thrust block**, the one `getCurrentRatio()`
  multiplies a Vec3 in, runs only for `c_ETPlane` (1), `c_ETRocket` (0x11) and
  `c_ETTorpedo` (0x19). `c_ETCar` (2) and `c_ETTank` (6) never reach it.
- `getCurrentDifferentialRPM` `0x0824c990`: `& 4` gates differential steering —
  tanks only. It also returns the **rev state `+0xa0`**, not the pedal.
- `feedbackLoop` `0x0824c850`: `& 2` clamps its value to [-1, 1]; `& 4` chooses a
  max-hold over a running mean.
- `Engine::handleUpdate`: `& 0x10` pins the throttle at 1.0 — rocket and torpedo.

Two ledger rows do not survive that. TANK-1's "no simulation code anywhere calls
`getEngineType()`" missed the virtual dispatch (its grep was for direct `call`
sites). TANK-7's "tank propulsion is shared `updatePhysics` body thrust" is the
opposite of what the gate does: **a tank and a car get no body thrust at all**,
and every newton of a ground vehicle's propulsion is the EngineGrip friction
target. `noPropellerEffectAtSpeed` (template `+0x520`, default 100.0 at
`0x0823f06e`) belongs to that block and so never touches a ground vehicle.

`TrackedVehicle` still carries its propulsion in `bodyThrust` at a fixed gear 1,
which is why the Sherman reads 41 km/h against the engine's 53.5. Replacing it
with the EngineGrip governor — and re-deriving `trackResistance` from the
engine's x30 at the same time, as the section above already asks — is the next
piece of tracked-model work, and it is now a bigger one than "re-fit a constant".

### The first-contact damper guard was guarding the wrong thing

The claim was that an unguarded backward difference launched the M3A1 29 m into
the air. It does — but only from a hull spawned 0.8 m **inside** the ground,
which is what the harness's `y: 0.6` does to a tank whose resting height is
1.403 m. From any height at or above its own rest the unguarded damper costs at
most a 0.55 m overshoot, and from a real drop it costs nothing at all.

What the guard did cost is the damper itself. `prevCompression` is set to `null`
on **every** airborne tick, not only the first, so zeroing the rate there turned
the damper off for a tick on every re-contact: 4 % of a jeep's contact ticks over
rough ground and 8 % of a half-track's — landings, crests and kerbs, which is
when a damper earns its keep. The rate is now seeded from the axle's own closing
speed along the spring axis (`-u.y` in the body frame), which is what a
continuous displacement would have been changing at.

### A parked vehicle now stands still, because the latch is a constraint

PHY-5 leaning the spring axis with the hull gives a parked vehicle a real
horizontal component of suspension force. A velocity-proportional per-wheel hold
can only balance that, not cancel it, so it settles at `rake x substep`: 5 mm of
drift over ten parked seconds on flat analytic ground, and **0.74 m for a jeep
and 0.30 m for a Sherman on Wake's own terrain**, against a main checkout that
does not move at all. (The hold also asked for a whole velocity back per *engine*
tick rather than per substep; `1/h` rather than 30 took the M3A1's creep from
0.054 m/s to 0.014 on its own.)

`collision-response.md` section 8 says what a latched static contact is — "F = dV
in full", a velocity constraint, not a force. `staticHold` applies it where that
belongs: after the forces are summed, a hull that is stopped, idle, settled and
standing entirely on latched contacts has its horizontal acceleration and
velocity zeroed, while the demand fits inside the summed break-away budget. Past
that budget it lets go and slides, which is the latch's own rule. A one-second
dwell keeps it off a hull that is still settling — a jeep dropped onto a 16.7
degree ramp crosses every threshold transiently on the way down, and freezing it
there left it 1.27 degrees off the slope with the wrong load on its springs.

Parked drift on Wake, measured through a real `EntryPoint` entry and ten idle
seconds: 0.000 m for all three hulls, with every wheel's compression identical
across the window. Main: 0.006 to 0.011 m, compressions still moving.

### What a driver feels, against main

Measured in the harness on flat ground (`tests/ground_harness.mjs`), main's
`ground.js` against this branch's:

| | main | this branch |
|---|---|---|
| Willys top speed | 18.30 m/s, 65.8 km/h | **29.90 m/s, 107.6 km/h** |
| Willys at 5 s from rest | 17.60 m/s (already at 96 %) | 20.53 m/s (69 %) |
| Willys reverse | 4.86 m/s, 17.5 km/h | **6.96 m/s, 25.0 km/h** |
| Willys brake to a stop | 2.17 s from 18.29 m/s | 3.77 s from 29.89 m/s |
| Willys coast, 15 s off the pedal | 3.11 m/s left | 18.49 m/s left |
| Willys full lock, 12 s | 287.6 deg, 46.9 deg/s | **108.7 deg, 18.1 deg/s** |
| Willys worst body roll, full lock | 12.9 deg | **5.0 deg** |
| Sherman straight line | 33.7 km/h | 41.2 km/h |
| M3A1 straight line | 114.5 km/h | 64.2 km/h |
| landing after a 2 m step | -6.85 m/s worst vy | -6.93 m/s |
| parked drift, 10 s, on Wake | 0.006 to 0.011 m | **0.000 m** |
| per-surface 0 to 10 m/s | identical everywhere | water 3.8 s, mud 3.0, rock 2.9, grass 2.8, road 2.5 |

The jeep is transformed. It does most of a hundred km/h, it takes nearly three
times the room to turn at full lock, and it leans **less** doing it — the turn
is wider rather than harder, because the circle grows faster than the entry
speed. It no longer stops in a car length, and it no longer coasts to a halt in
fifteen seconds: that last row is the clearest thing in the table pointing at
the fitted coast law, which was sized against a top speed that has since
doubled. The tanks are steadier rather than quicker, the M3A1 markedly slower
now that 17.5 is gone. And a vehicle left alone is left alone.

### The two lateral inventions earn their keep, and what they stand in for

Item 16 says to keep `corneringStiffness` and the lateral anisotropy only if
they earn it. Measured, jeep at full lock for twelve seconds from 103 km/h:

| | turned in 12 s | exit speed | worst body roll |
|---|---|---|---|
| as shipped | 60 deg | 33 km/h | 4.6 deg |
| `lateralGripFraction` 1 (the engine's isotropic clamp) | **16 deg** | 26 km/h | 8.8 deg |
| `corneringStiffness` 0 | 78 deg | **133 km/h** | 0.1 deg |
| `corneringStiffness` 3 | **+36 deg** (the wrong way) | 22 km/h | 8.8 deg |

Both keep their places. Isotropic, the jeep understeers to nearly straight and
leans twice as hard doing it. Without the slip force at all it is a sled: it
yaws from the steer torque, slides sideways without scrubbing, and *gains*
30 km/h through the corner. And the constant is not a smooth dial — at 3 the
turn inverts.

What they are standing in for is a real omission rather than a taste. The
Coulomb clamp only **limits** a tangential demand; it never creates one. In the
engine the lateral demand comes from the grip modes themselves — RollGrip asks
for `dV = -(the component of Vt along the wheel's own axle)`, and ContactGrip
for `dV = -Vt` — so a rolling wheel is *continuously* asked to cancel its own
sideways slip, and the clamp is only what bounds the answer. The viewer
implements the clamp and not the ask, and `corneringStiffness` is the hole that
leaves. Implementing RollGrip is what would retire both constants, and it is the
same job as replacing `bodyThrust` on the tracked hull.

### Still open after this review

> **All four of these were closed on 2026-09-20 by the wave-3 section at the
> end of this file.** They are left as written because the reasoning that
> opened them is what the closing had to answer.

- **`TrackedVehicle`'s propulsion** is `bodyThrust`, which the engine-type gate
  refutes. Until it becomes the EngineGrip governor the Sherman will read low.
- **The coast law.** `rollingResistance` and `engineBraking` are `[free]` and
  were fitted against a 12.8 m/s top speed. From 29.8 m/s, fifteen seconds off
  the pedal still leaves 18.5. The engine's own closed-throttle EngineGrip law
  (`dV = -Vt`, which `ground.js` already describes and deliberately fades out)
  is the thing that should replace them, and it is one job with the tracked
  rewrite above.
- **Driving off the island.** A hull that leaves Wake's terrain keeps
  accelerating downward without ever finding water or a sea floor — 245 km/h on
  main's `ground.js`, 300-700 on this branch, which only differs because a
  faster vehicle reaches the edge sooner. Pre-existing, shared, and not a
  drivetrain problem.
- **A reference drive in the real game** remains the one measurement that would
  settle the absolute numbers. It is now a much sharper question than it was:
  the engine's own code says 110 km/h for a Willy, and the only thing arguing
  for 60-70 is a memory.


## 2026-09-20 (wave 3): the drivetrain is the engine's, and the wheels drive it

Wave 2 left `ground.js` with a propulsion model that was wrong at the root and
two lateral constants labelled as inventions. All four of the round's open
drive items are closed here — items 1 to 4 of
`features/bf1942-parity-round-2026-09-19/viewer-changes.md`, "Open after
wave 2". Ledger rows: TANK-1, TANK-3, TANK-4, TANK-7, TANK-9, TANK-12,
TANK-13, PHY-2, PHY-5.

### What propels a ground vehicle, and what does not

`PhysicsEngine::updatePhysics` (`0x0824cbb0`) **returns at its second
instruction** for a car or a tank:

```
824cc04: mov  eax,[edi+0x9c]       ; the EngineTemplate PhysicsEngine::init cached
824cc10: call [edx+0xa0]           ; getEngineType()  -- virtual slot +0xa0
824cc16: and  eax,0x1
824cc1e: jne  824cc28              ; ... the body
824cc20: lea  esp,[ebp-0xc] ...    ; the epilogue
```

`c_ETCar` (2) and `c_ETTank` (6) clear bit 0. `TrackedVehicle.bodyThrust` was a
transcription of the `& 1`-and-`& 8` propeller expression applied to a class
that never reaches it, and it is **deleted** — the file now carries a comment
where it stood saying so, because it is the kind of thing that grows back.

What propels both is the **EngineGrip contact-speed target** on the
`c_PGFEngineGrip` springs, `dV = T - Vt` with
`T = getCurrentRatio() * getCurrentDifferentialRPM(side)` along the wheel's
forward axis, asked for at the engine's own `F * 30` (`ds:0x8716b5c`, applied
at `0x0825bc67`). A tank turns because its two sides' targets differ — nothing
applies a yaw torque to the hull, and the hand-built steering couple
`trackDifferential` is gone with the thrust it was compensating for.

**The gain matters and is not free.** Writing `dV / h` instead of `dV * 30`
makes the demand four times stiffer at this file's 120 Hz sub-step than the
engine's is, saturates the Coulomb clamp every sub-step, pins the load at its
own clamp of 1.0 and holds the revs below `gearUp` for ever: a Sherman that
never leaves third at 30 km/h.

### The gearbox is a filtered state with load feedback

`Engine::handleUpdate` (`0x0823e120`) is the whole of it, and this viewer had
none of it — `GroundVehicle` inverted `revs = speed / ratio` kinematically and
`TrackedVehicle` had no rev state at all. It is now one shared `EngineState`:

```
T1    = clip(rollAngle, +-maxRotation.z) / maxRotation.z      NOT the pedal
revs += 0.05 * ((T1 - L) - 0.5*revs),  clamped [-1.0, +1.2]   per TICK, not per second
brake = (pedal < -0.1 && revs > 0) || (pedal > +0.1 && revs < 0)
up    : revs > gearUp   AND blend == 0 AND gear < numberOfGears
down  : revs < gearDown AND gear > 1                          no blend gate
blend-= dt / gearChangeTime, floored at 0, and NOTHING re-arms it
```

and the load `L` is `feedbackLoop`'s (`0x0824c850`):

```
L0 = dot(dV_clamped, fwd) * getCurrentRatio() / getCurrentTorque()
(type & 2)  L0 clamped to [-1, +1]                        car and tank alike
(type & 4)  L = the frame MAX while revs > 0, MIN while revs <= 0
else        L = (L*n + L0) * 0.99 / (n + 1)
```

That loop is the whole governor: hard acceleration makes `L` large, `L` pulls
the revs down, low revs lower the target, and the target is the propulsion.
It is also what makes `setTorque` load-bearing — as the **divisor of the
load** (TANK-13), never as a multiplier on drive.

Two readings had to be corrected against the `v4-gearbox` verdict, both
hand-decoded here:

- **The tank's min/max are the other way round.** `0x0824c91f`'s
  `fldz; fucompp` compares 0.0 against the revs, so `revs > 0` takes the `jne`
  to `0x0824c942`, whose `fucom` keeps `L0` only when `L0 > L` — a MAX. The
  verdict states MIN for `revs > 0`. The max is the one that can hold an
  engine down, and the pair is symmetric in reverse.
- **Only a `c_PGFEngineGrip` wheel feeds the load at all.** `addFriction`
  dispatches on the grip byte at `0x0825baf1`-`0x0825bafe`
  (`mov dl,[esi+0xb4]; and eax,0x4; test al,al; jne 0x0825c1b0`) and only the
  `0x4` branch walks the node's ancestors for a `PhysicsEngine`
  (`0x0825c1b0`-`0x0825c1fa`, stored at `0x0825c556`); a RollGrip wheel takes
  the `0x2` branch at `0x0825bb04` and the guard at `0x0825bc19` skips the
  call. Getting this wrong cost a day: counting a jeep's two free-rolling
  fronts as zero samples halves the load, which pins the revs at
  `2*(1 - 0.5)` = 1.0, just above `gearUp 0.95`, so the box shifts straight to
  top under full wheelspin and stays there. On Wake that jeep sat in fifth
  doing donuts at walking pace.

**`setGearChangeTime` is very nearly a dead word.** A whole-binary scan for
stores to `[reg+0xb8]` finds four and no more — the two `PhysicsEngine`
constructors seeding 1.0 and `handleUpdate`'s own countdown — so the lockout
expires `gearChangeTime` into the object's life and is never re-armed. After
that the box can shift one gear per tick. Reproduce with:

```
objdump -d -M intel bf1942_lnxded.static \
  | grep -E '(fstp?|mov) +(DWORD PTR )?\[e..\+0xb8\]'
```

### The tick rate, and LOOP-1

The filter's `0.05` is per call and **not** scaled by `dt` — the only uses of
`dt` in `handleUpdate` are the lockout's `fdiv [esi+0x374]` at `0x0823e23f`
and three `calculateAndClipAngle` calls. So the wall-clock spool-up follows
the tick rate, and the viewer has to choose one.

It runs at **30 Hz**, on an accumulator independent of the 60/120 Hz sub-step
rate, because that is `g_simulationFps` and the figure the friction budget in
this same file already spends. **Ledger LOOP-1 is CLOSED on it** (2026-09-20):
the simulation is a fixed 30 Hz tick with `dt = 1/30` exactly, on client and
server — `Setup::updateInputs` `0x080bc540` is the accumulator, and the only
`dt` that reaches `simulateFrame` is the tick's own. The earlier
`2 * g_simulationFps` reading was of the render loop. The 40-tick time
constant is therefore 1.33 s of wall clock, and nothing here is hedged.

### RollGrip, and the two inventions it retires

`corneringStiffness`, `lateralGripFraction`, `slipFloor` and the tracked
class's `frontAxleCorneringStiffness` are gone, and the friction limit is a
**circle** again for both classes. What they stood in for is RollGrip's own
demand, which this file had never written out:

```
RollGrip     dV = -(the component of Vt along the wheel's own axle)
EngineGrip   dV = T - Vt          -- the same lateral term, plus drive
```

The previous reviewer deleted `corneringStiffness` without putting that in its
place and measured the jeep turning 16 degrees in 12 s instead of 60, and kept
the constants on the strength of it. The reason is exact: **the Coulomb clamp
bounds a lateral demand and never creates one**, so with the stiffness gone
there was no lateral force at all. With the demand written out the same jeep
turns **120 degrees in 12 s** at 31 m/s, against 108 on `main` and 92 with the
fitted model.

The ellipse's other job was stopping a tank rolling itself over. That is
answered too, and by the engine's own mechanism rather than a shape: the two
demands now compete for one budget, so a wheel spending it on drive has none
left to corner with — `collision-response.md` section 8's "power slide".
Measured `worstUp >= 0.974` at every yaw from 0.3 to full lock on both hulls,
and `>= 0.987` entering a turn from straight-line top speed, the two cases the
ellipse was fitted against. The per-frame limit cycle is gone with it: 0 roll
sign flips a second and a worst per-frame load step of 0.0000, against 59 and
14 % before.

### Every drive constant, and what it is now

| constant | was | now |
|---|---|---|
| `bodyThrust()` | the propeller law on a hull | **gone** — `updatePhysics` is gated off for both ground types (TANK-7) |
| `FADE_SPEED_DEFAULT` / `noPropellerEffectAtSpeed` | read off the Engine | **gone** from the drivetrain — it lives inside `& 1` AND `& 8`, which no ground vehicle reaches |
| `trackResistance 0.25` | fitted damper toward the target | **gone** — it stood in for the engine's own `x30` on that term, and both things it was fitted against (a 17.5 M3A1 ratio, a body thrust) were refuted |
| `trackDifferential 20.0` | hand-built steering couple | **gone** — the differential is in the two sides' targets |
| `rollingResistance` | always-on drag | **gone** — the engine has none; a RollGrip wheel has no longitudinal demand at all |
| `engineBraking 0.4` | closed-throttle drag | **gone** — the rev state decays and the target decays with it; that is the coast |
| `brakeDecel 8` | brake force | **gone** — the brake byte discards the target, so the brake is `mu * \|g\|` |
| `reverseBelow 0.5` | brake-to-reverse threshold | **gone** — the brake byte clears when the revs cross zero |
| `PARKING_HOLD_SPEED 3.0` | low-speed hold fade | **gone** — the grip law asks for the whole correction at every speed |
| `corneringStiffness`, `lateralGripFraction`, `slipFloor` | invented tyre model | **gone** — RollGrip's `dV = -(Vt along the axle)`, isotropic clamp |
| `revs` | `speed / ratio`, kinematic | **read** — the filter, TANK-12 |
| `gear` | 1..n for a car, pinned at 1 for a tank | **read** — `handleUpdate` writes `+0xbc` for both |
| `engineType` | not carried | **read** — `extras.physics`, bits per TANK-1 |
| `maxRotation` / `maxSpeed` / `acceleration` | rig only | **read** — `extras.physics`, TANK-12's `T1` and steer terms |
| `ENGINE_REV_CEILING 1.2` / `_FLOOR 1.0` | read | **read**, and now known to be type-independent |
| `ENGINE_REV_FILTER_GAIN 0.05` | absent | **read**, `ds:0x86c08a8`, per tick |
| `ENGINE_LOAD_MEAN_SCALE 0.99` | absent | **read**, `ds:0x86d0cdc` |
| `ENGINE_MAX_GEARS 5` | absent | **read** — `setNumberOfGears` `0x0823fd10` clamps [1,5] |
| `ENGINE_DEFAULTS` | absent | **read** — `EngineTemplate::EngineTemplate` `0x0823efc0` |
| `ENGINE_TICK_HZ 30` | the friction budget's | **read**, and now the filter's too — LOOP-1 **closed** on it, `Setup::updateInputs` `0x080bc540` |
| `COULOMB_SLIDING/_BREAKAWAY/_GRAVITY` | read (PHY-2) | read, unchanged; `coulombCaps` now returns the unweighted `A * \|g\|` |
| `SPRING_*`, `suspensionTravel`, `bumpStiffness` | free / read (PHY-5) | unchanged — the force law is read, the travel and the bump stop are **still free** |
| `STATIC_HOLD_*` | free, numerics | **still free**, and the settle test now gates entry only |
| inertia, `angularDamping`, `yawDamping`, `boundingRadius`, `hullHalfHeight` | free | **still free** |

### Measured, before and after

Analytic flat ground, `tests/ground_harness.mjs`:

| | main | wave 3 | the engine's own |
|---|---|---|---|
| Willys top | 107.6 km/h | **111.2** | 112.6 |
| Sherman top | 41.2 | **53.6** | 53.6 |
| M3A1 top | 64.2 | **67.2** | 67.0 |
| Willys reverse | 25.0 | **25.1** | 25.2 |
| Sherman reverse | — | **14.4** | 14.4 |
| full-lock circle, 12 s at 31 m/s | 108.7 deg | **136.7 deg** | — |
| worst body roll in it | 5.0 deg | **8.3 deg** | — |
| brake to stop | 3.77 s from 29.9 | **8.25 s from 30.9** | driven axle only |
| coast, 15 s off the pedal | 18.5 m/s left | **10.3 m/s left** | — |
| parked creep, 10 s | 0.000 m | **0.000 m** | 0 |
| tank rollovers, full yaw sweep | none | **none** (worstUp 0.974) | — |
| roll sign flips per second, settled turn | 59 | **0** | — |

On Wake itself, through `window.__drive()` stepped at 1/60 (the page's own
heightfield and material map, `mu` 0.9 on grass):

- All three hulls sit at their real spawns for ten seconds with **0.000 m** of
  drift and every contact latched.
- A Willy placed on a clear 220 m lane reads **74.5 / 84.9 / 92.2 / 102.3
  km/h** at one-second marks, climbing gear 4 to 5 with the revs going
  0.944 → 0.908 → 0.985 → 1.2. The lane then runs out.
- Reverse **25.7 km/h**, brake-to-stop 3.5 s, full lock 94.6 deg/s.

### Still open after this

- **The brake is the driven axle's alone**, so a rear-wheel-drive Willy stops
  at about `mu * \|g\| / 3` and takes 8 s from 31 m/s. That follows from
  RollGrip having no longitudinal demand, which is read — but the size of it
  depends on the viewer's load weighting, below.
- **The friction accumulator is a MEAN over parts in the engine and a
  load-weighted SUM here.** `coulombCaps`'s comment names it. The two agree on
  flat ground for a fully-driven vehicle and disagree wherever the driven
  wheels carry a different fraction of the weight than of the part count: the
  engine gives a jeep's rear axle half the budget, this file gives it the
  third of the weight it carries. It is also the likeliest explanation of the
  one behaviour pinned as a measurement rather than defended — **a jeep held
  at full throttle out of a half-lock turn at 31 m/s does not straighten**,
  because its inside rear leaves the ground and the tractive effort is then
  all on one side of the hull. A mean that averages the application points as
  well as the forces would cancel exactly that couple. Lifting the throttle
  ends it either way, and `test_a_floored_jeep_does_not_come_out_of_a_hard_turn_by_itself`
  pins both halves.
- **`bumpStiffness` and `suspensionTravel` are still free**, and they now meet
  much higher speeds: the jeep's apex over the harness's synthetic washboard
  went from 3 m at 18.5 m/s to 4.5 m at 31.
- **Driving off the island** still accelerates downward for ever. Pre-existing,
  shared, and not a drivetrain problem.
- **A reference drive in the real game** remains the one measurement that would
  settle the absolute numbers.

## 2026-09-20 (wave 3, post-review): the solver works in the contact plane

Five defects came back from review. Four are closed against the bytes.

**The tyre frame is the contact plane, not the hull's.** `addFriction`'s
RollGrip branch (`0x0825bf99`) takes the node's transform row 0 — the axle —
and projects it: `0x0825c14b`-`0x0825c171` forms `s = (axle . N)/|N|^2`
against the averaged contact normal at `ResponsePhysics+0x68`, and
`0x0825bfff`-`0x0825c021` computes `axle - s*N`, with `|N|^2 == 0`
(`0x0825bfe4`) and `|proj|^2 == 0` (`0x0825c063`) both zeroing that contact's
demand. `collision-response.md` section 8 says the same of EngineGrip's
forward axis ("tangent to N") and of `Vt`. Proved here for RollGrip; taken
from section 8 for EngineGrip. This file had been using the hull's own XZ
plane, so a Coulomb-saturated longitudinal demand on a pitched hull was
largely world-vertical thrust — the jeep reached 453.7 km/h and a 148 m apex
on a 0.35 m washboard. With the frame in the contact plane it is 3.32 m and
120.0, against `main`'s 1.13 m and 58.0.

**Springs sum, tyres mean.** `PhysicsNode::addFrictionAtAbsolutePosition`
`0x08254e50` keeps a running mean over the tick's contacts (linear `+0x40`,
`0x08254eab`-`0x08254f35`; angular `+0x4c` with `r x v`,
`0x08254fc0`-`0x0825503f`; count `+0x64`, `0x08255042`; cleared
`0x08253dcd`-`0x08253ddc`), where `addAccelerationAtAbsolutePosition`
`0x08255110` plain-sums at `0x08255156`. **No normal load enters the
tangential solve anywhere.** The load-weighted sum this file used braked a
rear-wheel-drive jeep at 0.34 of budget instead of 0.50, and — worse — let a
washboard load spike of 100 against a standing 4.9 multiply the budget
sevenfold. Brake 8.38 s / 128.5 m to 4.48 / 68.7 (`main` 3.88 / 56.5).

Three read facts make the mean stable where a first attempt at it rolled the
M3A1 over: the budget's own `N.y` (`0x0825b80c fld [eax+0x4]`), the contact
plane above, and **a dummy roller not counting**. `c_PGFEngineDummyGrip`
(0x24) leaves through `SpinWheel` at `0x0825c669`/`0x0825c680` and never
reaches the accumulator, so a Sherman's eight dummies were dividing its whole
answer by three — brake 1.18 s to 3.35 s, and a 25-degree slope into a 146 m
slide. A plain `c_PGFDummyGrip` (0x20) is *not* excluded.

**`V.y += g/30`.** Section 8's own line, with its own reason — "so a held body
does not creep" — had never been implemented, so the solver only ever saw the
velocity gravity had already produced. Both tanks now hold at every angle
measured (Sherman 25 degrees 2.27 m to 0.000; M3A1 2.63 to 0.052).

**The pre-extract path.** `maxRotation`, `maxSpeed` and `acceleration` reach
`extras.physics` only with this branch's `con.py`, and every published tree
predates it. Throttle degraded safely; steering degraded to a dead stick, and
a tracked hull's steering *is* the differential — a Sherman turned 0.0 degrees
in six seconds of full lock on the assets that exist today. Both terms now
fall back to the raw input and `EngineState.stale` says which path a vehicle
is on.

### Still open

- **The M3A1 leans 39 degrees** entering a full-lock turn from its own top
  speed (`up.y` 0.769, against 5 degrees on `main`), and turns 22 degrees
  where `main` turns 121. It does not go over anywhere in the yaw sweep. This
  is the price of the mean: a barely-loaded contact answers at the full
  `A*N.y*|g|`, and a half-track has six counting contacts with most of its
  weight on four. Reported rather than tuned away.
- **Roll reversals at full lock**: 28 a second for the jeep against `main`'s
  0.6, at a lower peak roll (4.85 against 4.62). Same root.
- **A jeep on a slope at zero throttle still rolls** (7.6 m in 10 s at 5
  degrees). The mechanism is the engine's own filter — at zero throttle the
  steady state is `revs = -2L`, so the load feedback drives the revs negative
  and the EngineGrip target commands the roll — and only a jeep's two driven
  wheels carry a longitudinal demand at all. The read answer for an
  *unoccupied* vehicle is `Engine+0x142`, the engine-on flag that pins the
  revs to 0 (`0x0823e2d3`, `0x0823e2e6`-`0x0823e2ec`), now carried as
  `EngineState.running`; `map.html` never steps an unoccupied hull, so it
  cannot be exercised from the page. The occupied case is **unverified
  against retail**.

## 2026-09-20 (wave 3, second review): the probe's two remaining lies

### A spring cannot push against a face it is edge-on to

A jeep straddling a 25 m drop reached **251.8 km/h** and ended inverted, out
of a fall worth 80. Same mechanism as the washboard launch, through a
different door: the probe runs down the hull's own +Y (PHY-5, read), so on a
near-vertical face it reads metres of compression, and the bump stop pushed
about 101 m/s^2 along the hull's up while the tyres — `N.y` near 0.12 — had
1.8 m/s^2 to answer with.

The ground answers along its own normal, so the reaction available along the
spring axis is at most `N . axis` of it. That is the same quantity the
friction budget already spends as `N . world-up`, which **is** read
(`0x0825b80c fld [eax+0x4]`, `eax = this+0x68`). The engine needs no
equivalent, because its wheel is a body whose displacement comes from its own
contact rather than from a probe down an axis — so the precedent is read and
the transfer is this file's, marked `[free, numerics]`. The damper is bounded
the same way and for the reason its first-contact seed already was: a backward
difference of a probe reported 96 m/s of closing speed where the axle was
doing 8.

| jeep straddling the shoulder | main | before | now |
|---|---|---|---|
| sharp cliff, peak | 131.5 km/h | 256.0 | **98.6** |
| rounded shoulder, peak | 107.1 | 251.8 | 113.3 |
| M3A1 rounded, peak / apex | — | 208 / 106.6 m | **67.3 / 1.4 m** |

### The tyre force is applied where the wheel is

The spring is compressed, so the contact patch sits `travel` higher than
`rest.y - radius`. `#applyWheels` had been moving the visible wheel by exactly
that while the force application point stayed at the axle's rest. The engine
has no such gap: it applies at `part.pos + avgContactRelPos`, and `part.pos`
is the wheel body's live position.

### The M3A1 lean: what was read, and why it is still open

`getGeometryInertia` `0x08253930` derives a body's inertia from its geometry's
**bounding box** — slot `+0x1c` returns min at `+0x0` and max at `+0xc`,
`0x0825398b`-`0x082539c9` forms `K * (d_j^2 + d_k^2)` per axis with `K` at
`ds:0x86d1390` — and `updateRotationalPhysics` calls it at `0x08253e96` and
divides the angular impulse by it at `0x0825408a`. That is the same box law
this viewer already uses; it sets how fast a hull rolls, not whether it tips.
`inertiaModifier` is parsed and emitted by `con.py` already, and **no vanilla
land vehicle authors it** (zero hits over `bf1942/Objects.rfa`, alongside zero
`setCenterOfMassOffset`), so neither can help the M3A1.

Applying the force at the real contact took the lean from 42.0 to 37.8 degrees
and gave back the full-lock turn-in that had been lost (-22.6 degrees in 8 s
to -213.7). **It is not enough, and the arithmetic says why.** The M3A1's
patches sit 1.38 m below the hull origin with the springs loaded, against a
half-track of 0.97 m; the isotropic Coulomb coefficient is
`1.5 * 9.82 / 14.73` = **1.0** exactly; `0.97 / 1.38 = 0.70 < 1.0`, so it
tips. The Willys (`0.60 / 0.50`) and the Sherman do not. Nothing in the engine
bounds the per-contact tangential demand except `A * N.y`: the six floats
`ResponsePhysicsManager::update` `0x0825d0b0` pushes into `addFriction` at
`0x0825d11d`-`0x0825d130` are dead, `addFriction` runs once per part per tick,
and there is no load weighting anywhere.

So either the engine's own M3A1 leans like this and retail footage would show
it, or there is a mechanism two readers have now failed to find. It is
reported rather than tuned away, and the bound the review set — 8 degrees and
`up.y >= 0.98` — is **not met**: the sweep reads 31.8 to 37.8 degrees,
`up.y` 0.79 to 0.85.

### An occupied jeep on a slope at zero throttle: deliberate

5 degrees walks it **7.65 m in 10 seconds**, ending at 0.79 m/s; 12 degrees
19.9 m; 25 degrees 39.2 m. `main` gives 0.00 / 0.45 / 1.00. This is a
deliberate consequence of the read law, not an accident:

- the brake byte needs `|pedal| > 0.1` and is **not set** at zero input
  (`0x0823e260` against `ds:0x86cf658` and `ds:0x86ba1d8`, both arms);
- break-away is not the binding constraint — at 5 degrees the pull is
  1.28 m/s^2 against a 22.0 m/s^2 static cap, and the contact is latched and
  applying its demand in full;
- the demand simply *is* "roll", because a jeep's only longitudinal demand
  comes from its two `c_PGFEngineGrip` wheels, whose target is `ratio * revs`,
  and the rev filter's steady state at zero throttle is `revs = -2L`. The load
  feedback assists the roll in both orientations.

An **unoccupied** vehicle is a different case and the engine answers it:
`Engine+0x142` pins the revs to 0 (`0x0823e2d3`, set and cleared by
`Engine::handleMessage` `0x0823e730`), which is carried here as
`EngineState.running`. Nothing in the viewer needs it wired: `map.html`
integrates only the hull the player is in, and the vehicle-collision work's
own `ParkedVehicle` (`viewer/body-ground.js`) runs a separate, engine-less
spring model. **The occupied case remains unverified against retail** and is
waiting on thirty seconds of footage.
