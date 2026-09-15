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

**Suspension is the shipped numbers, and they are better than they look.**
Each wheel is a vertical ray from its rest position; compression times
`setStrength` plus compression-rate times `setDamping`, per mass (the same
units reading as `setTorque`). The evidence for that reading: four wheels
give the heave mode `2*sqrt(4*25) = 20` of critical damping, and `4*5 = 20`
is exactly what the data supplies — someone at DICE tuned the Willys
critically damped, and the coincidence only works in per-mass units. The
static solution (100·x = 14.73, x = 0.147 m; front axle carrying 2/3 by the
wheelbase lever) is asserted in the tests to two decimal places.

**The gearbox uses the declared shift points; the ratios are ours.** The game
declares `numberOfGears 5`, `gearUp 0.95`, `gearDown 0.4` — and *no per-gear
ratio anywhere in the vanilla data* (checked: `Physics.con` has no other
gearbox keys; parse-side there is nothing more to extract). The shift points
only make sense as fractions of a rev ceiling, and with the ratio ladder
`[3.8, 2.6, 1.8, 1.25, 1.0]` [free] the automatic never hunts: a 0.95 upshift
lands revs at 0.65–0.76, above the 0.4 downshift line. Reverse borrows first
gear, which is what caps it near 17.5 km/h.

**Top speed is an equilibrium closed by one fitted number.** `revLimit = 356
rad/s` [free] closes `v = revLimit·R/(diff·topGear)` at 18.5 m/s; torque
fades linearly over the last `1 − gearUp` of the rev range (the same shape
`setNoPropellerEffectAtSpeed` gives aircraft), so the model settles at
**18.3 m/s = 65.8 km/h** — inside the 60–70 km/h the game's Willys does.
Incidentally 356 rad/s is ~3,400 rpm, the right neighbourhood for the real
jeep's Go-Devil engine, but nothing leans on that.

**Drive is `setTorque` as acceleration, first gear gets it all.** 10.5 m/s²
in first, scaled down by ratio per gear, applied at the rear contact patches
(the axle `c_PGFEngineGrip` marks), inside a per-wheel friction circle
`mu·load` with `mu = 1.0` [free]. Launch is therefore traction-limited at
~6 m/s² — the rear axle carries only a third of the weight — which is a
behaviour, not a tuning.

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
`gearRatios`, `revLimit 356`, `mu 1.0`, `corneringStiffness 7`,
`rollingResistance 0.55`, `engineBraking 0.4`, `brakeDecel 8`,
`suspensionTravel 0.30`, `bumpStiffness 5`, inertia (box estimate:
0.40/1.27/1.29 m² per-mass roll/pitch/yaw), `angularDamping 0.8`,
`boundingRadius 1.8` (drag equation only), `slipFloor`/authority ramp
(numerics), `throttleEase` (audio only).

What the model produces with them: top speed 65.8 km/h; 0→60 km/h in ~5 s
(traction-limited launch); brake from top speed in ~2.2 s; reverse 17.5 km/h;
half-lock at speed ≈ 47°/s of yaw with ~13° of body roll; coast 18→3 m/s
over 15 s.

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
  unread. One `mu` covers everything.
- **The exe's car integrator is unread.** The point-body integrator, gravity
  and the drag equation are decompiled fact (`physics.js`); the spring/tyre/
  gearbox path is not, and this model's shape is reconstruction. The spring
  solver noted at `0x0057f0d0` (it divides by 9.82) is the place to start.
- **Vertical-ray suspension.** Rays are world-vertical, correct on the flats
  and increasingly wrong past ~20° of lean; slopes also need the heightfield
  normal for the contact frame. Fine for v1, wrong on a dune face.
- **No hull collision.** Wheels see the ground function; the body sees only a
  belly failsafe. Driving into a wall, another vehicle, or Wake's pier is not
  resolved. `WorldCollider.sweepSphere` is sitting there for it.
- **Tanks and half-tracks.** `c_ETTank` steers by differential (`WillyEngine`
  has no `setInputToYaw`; `ShermanEngine` does — yaw and roll both ±1°, the
  body-lean documented in `bf42/con.py`). The gearbox and springs transfer
  as-is; the steering model does not.
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
