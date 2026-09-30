# Helicopters: engines that do not point at the nose

Status (2026-09-30): built and checked in node and on DC Desert Shield. Not yet
committed or published.

Desert Combat's helicopters lift, hover, climb, pitch, roll and yaw on the
engine's own thrust law. The engine behaviour is ledger PHY-12..PHY-14, and
the narrative is `subsystems/physics.md` §5 and §7. This page covers what the
viewer does with it.

## The defect

`aircraft.js` pushed every `c_ETPlane` engine along the hull's nose, on the
spooled pedal. DC's AH-64 is three Engines placed `setRotation 0/270/0` under
three input-driven `RotationalBundle` racks, and it ended up being flown like a
car. Before this change, a full collective from the pad drove it along the
ground at 87 m/s and it never left the ground (the Mi-24 reached 47 m/s and the
UH-60 135 m/s).

## What the viewer does now

`aircraftSpec` measures each engine's rest thrust axis against the nose. If any
engine is more than `LIFT_ENGINE_ANGLE` (45 degrees) off it, the airframe is
`vectored`, and every one of its engines runs through `vectored-engines.js`:

- **Axis.** The thrust axis is the engine's own `-Z` through the chain of
  input-driven bundles above it. Each bundle is its rest pose times
  `R(yaw, pitch, roll)`, with the angles stepped by `clipAngleStep` (GUN-2's two
  laws). The force goes on the root at the engine's own position.
- **Throttle.** `T1` is the Engine's own roll axis (its `rig`: `c_PIThrottle`,
  or the UH-60's `c_PIAltFire` assist engine, or the Flettner's `c_PIYaw` tail
  engines), clipped into `[min, max]` and divided by `physics.maxRotation[2]`.
  The clip is where the idle floor comes from.
- **Revs.** The revs run through `engine-revs.js`'s gearbox (TANK-12/13), with
  the load `thrust()` samples each evaluation. `K = 0.1|revs| + e|e|`, the same
  law as the fixed-wing path, but on the revs.
- **Water and running.** An engine under water has its revs zeroed and makes
  nothing. `Aircraft.engineRunning` is `Engine+0x142`: when false, the inputs
  are ignored and the revs are held at 0.
- **Inertia.** A vectored airframe takes the engine's `/3` geometry inertia
  (`inertiaLaw: 'geometry'`). The solid box is kept only for the fixed-wing
  aircraft calibrated on it.

**Fixed-wing aircraft do not enter this code.** The survey covered every
extracted `VCAir` root with a `c_ETPlane` engine on this PC, 569 of them. In
the 491 fixed-wing aircraft, every engine is within 2 degrees of the nose
(FHSW's Ar196 at 2, all the rest at 0). The other 78 each have an engine at 90
degrees or more.

The vectored set is:

- DC and DC Final: every helicopter and the AV-8 Harrier.
- XPack2: the jetpack, and the Flettner in Raid on Agheila (a level-local
  object, so it is in the level bake and not in the model tree).
- FHSW: the Fa 223, the Flettners, the E16A1 (whose engine is turned round)
  and the Ju87f "Haunebu".
- EoD: the helicopters.

The A-10's right engine yaws ±1 degree on a `c_PIYaw` rack. It points at the
nose at rest, so it stays on the fixed-wing path, and the ±1 degree is not
modelled.

## What the glb already carries

No exporter change was needed. The extras already hold everything the law reads:

- the Engine's quaternion (its `setRotation`);
- each rack's `rig` axes with input, min, max, signed `maxSpeed`, `direction`
  and `acceleration`, plus the bundle's `automaticReset`;
- the Engine's own `rig` roll axis;
- the Engine's `physics.maxRotation` and `physics.acceleration` triples.

There are two gaps, and neither touches a DC helicopter:

- An Engine with no input binding has no `rig`, so its `minRotation` is not
  carried. `physics()` in `bf42/con.py` could emit `minRotation` next to
  `maxRotation`. The Flettner's rotor-spin engines are the only case seen, and
  they have `setDifferential 0`.
- A `RotationalBundle`'s `setPivotPosition` is not in its extras. No helicopter
  or VTOL rack authors one; only cameras do.

## How it was checked

- **The node harness** (`tests/flight_harness.mjs`, asserted in
  `tests/test_flight.py`) flies an AH-64 built from the `.con` data:
  - At the idle floor, `T1` is 0.3 on the ground and stays 0.3 with the
    collective reversed. It is 0.6 six ticks after full collective and 1.0
    after 0.25 s.
  - The revs match the gearbox fixed point that the harness re-derives from
    `engine-revs.js`: 0.3204 at idle and 0.7405 climbing.
  - Full collective climbs at 21.7 m/s. Releasing it sinks at 23 m/s and the
    aircraft lands.
  - A levelled hover needs a collective of 0.647.
  - Cyclic forward pitches the nose down 12 degrees and flies it forward.
  - Roll, yaw and pitch turn it the same way as the same stick turns a Corsair.
  - A stopped or drowned engine makes nothing.
  - Both `calculateAndClipAngle` laws are exercised, including the Flettner's
    servo-law collective, which holds where it is left.
- **The real glbs.** When the extracted model tree is present, the same test
  builds the DC AH-64, Mi-24, UH-60, Mi-8, AH-6, SA-342G and MH-53 from their
  glbs. Each climbs 49 to 105 m in 6 s from the idle floor and sinks when the
  collective is released. The F-15C, A-10 and Mig-29 are checked to stay on
  the fixed-wing path.
- **Fixed-wing before and after.** The Corsair, BF109, B17, Mustang, F-15C,
  Mig-29, A-10 and SU-25 were flown from their glbs on the same scripted 20 s
  of stick and throttle, through HEAD's `aircraft.js` and the new one. The
  sampled tracks are identical in every sample.
- **In the page.** On `map.html?mod=desertcombat&map=dc_desertshield`, the
  AH-64 was entered with `__enterOwner` and flown by an in-page pilot through
  the real keys (headless Chromium, Vulkan).
  - Parked, it sat at `T1` 0.3.
  - With W it climbed at 21.4 m/s.
  - It hovered at a latched collective of 0.64 (`vy` +0.3 m/s, revs 0.57).
  - Held at 12 degrees nose-down, it flew forward at 14.5 m/s and still
    accelerating, holding height.
  - With the collective released it sank at 16 m/s with `T1` back at 0.3.

## Open

- **The air seat latches W/S.** `world-vehicle-tick.js` clamps
  `c_PIThrottle` to 0..1 and holds it. Retail's control map is a held axis
  (+1 while W is down, 0 on release, -1 on S), and the Engine's own
  `setAutomaticReset` returns the collective to its floor when W is let go. The
  latch makes hovering easier than retail. It also means the Harrier's lift
  jets, which take `c_PIThrottle` with a negative `setAcceleration` (S raises
  them), can never fire in the viewer.
- **`engineRunning` is not driven.** Nothing clears it on leaving the seat or
  on critical damage (0x14), so an abandoned or critically damaged helicopter
  keeps idle revs. The engine-side sender of messages 4 and 5 is open
  (PHY-14).
- **The rotor and the engine note still read the spooled pedal.** Both follow
  `state.throttle`, not the revs.
- **The rack visuals share a servo.** The racks' visual tilt comes from the
  shared rig servo: one entry per control, input and axis, and the first part
  claiming the key sets the rate. So the ±2 degree rotor rack and the ±20
  degree engine racks, both on `c_PIPitch`, move together at one rate.
  Cosmetic only; the physics keeps its own angles per rack.
- **Bots.** `bot-vehicle-air.js` aims a helicopter as if it were a plane.
- **The nose-up tendency is in the data.** The AH-64's rotor-turning dummy
  engine sits 2.2 m forward of the others and pushes up, so hands-off it pitches
  nose-up about a degree a second. The pilot has to fly against it. Whether
  retail does the same was not measured against the game.
- **Ground contact.** On the ground the aircraft uses the viewer's clearance
  clamp and `settle`, as every aircraft does, not the `Spring` wheels.
- **A helicopter HUD.** Not started.
