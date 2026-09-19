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
own: `TANK.mu` (1.1), `corneringStiffness` (30, stiffened well past Willy's
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

- Every constant above is still `[free]`. `lateralMu`, `trackDifferential`
  and `yawDamping` join `mu`/`corneringStiffness`/`trackResistance`/
  `angularDamping` on the standing ask for a recorded drive against the real
  game; nothing here is a measurement of retail.
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
