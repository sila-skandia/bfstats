# Helicopters: engines that do not point at the nose

Status (2026-09-30): built and checked in node and on DC Desert Shield.
2026-10-06 (DC parity round, air-flight): the RollGrip ground friction, the
rotation law and the critical-damage engine stop corrected; see "How it was
checked" and "Open".

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
  are ignored and the revs are held at 0. It follows the driver's seat
  (`vehicle-instance.js`) and, since 2026-10-06, the hull's damage: critical or
  destroyed stops it, and re-boarding cannot restart it until the hull is out
  of critical (`world-vehicle-tick.js`, PHY-14).
- **Rotation.** A vectored airframe turns on the engine's own law
  (collision-response.md §4.2): the `/3` geometry inertia
  (`inertiaLaw: 'geometry'`), `inertiaModifier` read as x/y/z, x being pitch
  (`inertiaPairing: 'xyz'`, COL-13), and no gyroscopic term (COL-8). The solid
  box, the yaw/pitch/roll reading and the term are kept only for the fixed-wing
  aircraft calibrated on them.
- **Ground.** `groundFriction` runs each touching wheel through
  `addFriction`'s grip (PHY-2): DummyGrip asks the whole contact velocity
  back, RollGrip (a `c_PGFRollGripWhenOccupied` wheel while the seat is
  taken) only its component along the axle.

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
- **2026-10-06, the owner's Harrier and Black Hawk reports** (the DC parity
  round's air census). All in the flight harness, the keyed flights through
  the page's own `vehicleTick`:
  - `groundFriction` read a RollGrip wheel's axle velocity after overwriting
    it, so the dot was always 1 and every occupied wheel pushed along -axle.
    Parked level with the seat taken, the Harrier slid 247 m and turned 61
    degrees in 20 s, DC Final's UH-60 63 m and 176 degrees, its Mi-8 277 m.
    Now the AV-8B and DC Final's UH-60, Mi24D and Mi8 move 0.000 to 0.002 m.
  - The owner's sequence (S 3 s, W 4 s, ArrowDown 1 s, W 2 s): bank stays
    under 0.2 degrees (was 41 by the end of the W), heading under 0.2, and the
    pull is answered nose up.
  - Pedal alone in a hover, measured against the same hover without it: the
    UH-60 leans 0.19 degrees off it with no roll rate (was 22 degrees and
    38 deg/s); the AH64 0.42, the Mi24D 0.04.
  - The bot law now puts the UH-60 down 0.06 m off its point (was 5.5 m).
  - A bot flies the Harrier on the plane law: off the strip on the forward
    engine at 4.5 s, never below 50 m, at its point 3 km out at 41 s.
  - An AH-64 that goes critical in a climb loses its revs and falls at 23 m/s
    with full collective held, and climbs again once out of critical.
  - Every fixed-wing number in the harness is byte-identical.

## Open

- ~~**The air seat latches W/S.**~~ Closed: a vectored airframe's
  `c_PIThrottle` is the held axis since 75edb204, and the Harrier's lift jets
  fire on S (DC census items 2 and 4). The fixed-wing latch is the air-input
  package's.
- ~~**`engineRunning` is not driven.**~~ Closed: the seat drives it
  (`vehicle-instance.js` `#syncEngine`), and critical damage stops it
  (2026-10-06, PHY-14).
- ~~**The rotor and the engine note still read the spooled pedal.**~~ Closed:
  both follow the scripted engine's revs (DC census items 14 and 21).
- **Nothing damps a rotation.** A cyclic or pedal input leaves a rate that
  holds once it is let go: the UH-60 keeps a 20 deg/s roll after 1 s of Right.
  The engine's angular box drag is `drag |w| / mass`, negligible at 2500 to
  4000 kg, so retail may do the same; it needs a DC measurement.
- **The Harrier pitches itself nose up** in the hover and the transition:
  5.6 deg/s by the end of 3 s of S and 29 degrees after 4 s of W hands off,
  since its pitch axis became its light one (`0.8/2.5/1.5`, COL-13; it was
  11 degrees on the yaw/pitch/roll reading). It is the data's, and was not
  measured against the game.
- **The rack visuals share a servo.** The racks' visual tilt comes from the
  shared rig servo: one entry per control, input and axis, and the first part
  claiming the key sets the rate. So the ±2 degree rotor rack and the ±20
  degree engine racks, both on `c_PIPitch`, move together at one rate.
  Cosmetic only; the physics keeps its own angles per rack.
- **Bots.** A helicopter bot flies `helicopterControl`, a law of the
  viewer's own: the engine flies every airframe on `PlaneControl` (AI-60),
  helicopters with their own `ControlInfo3d` sensitivities. The Harrier flies
  the plane law, which is what its data gives it (2026-10-06): its AI is a
  jet's, and its positive `c_PIThrottle` is the forward engine, so the hover
  law drove it down the strip and never off it.
- **The nose-up tendency is in the data.** The AH-64's rotor-turning dummy
  engine sits 2.2 m forward of the others and pushes up, so hands-off it pitches
  nose-up about a degree a second. The pilot has to fly against it. Whether
  retail does the same was not measured against the game.
- **Ground contact.** On the ground the aircraft uses the viewer's clearance
  clamp and `settle`, as every aircraft does, not the `Spring` wheels.
- **A helicopter HUD.** Not started. DC ships no altimeter or helicopter HUD
  art (DC census item 20).
- **The fixed-wing aircraft beside these** (found in the same round, not this
  page's to build): they keep a gyroscopic term the engine does not have
  (COL-8) and read `inertiaModifier` as yaw/pitch/roll where the engine reads
  x/y/z (COL-13); and
  `hullGeometry` misses an exterior that is a `SimpleObject` under its cockpit
  LOD (the BF109, B17, Stuka, DC's AC-130 and jets), measuring every mesh under
  the root instead (COL-14). DC's AC-130 does not fly either way: its `drag
  2.2` over `mass 10000` meets its thrust at 13 m/s on the inflated box and
  21 m/s on the engine's, against an AI `maxSpeed` of 50.
