// The fallback tables a driven land vehicle reads only where its node tree
// says nothing: `WILLYS` for `GroundVehicle` (and every `Wheel`'s spring
// defaults), `TANK` for `TrackedVehicle`. Plain data; imports nothing.

/**
 * Willys jeep numbers. Every one is either read from the shipped data (and the
 * glb now carries it, so the fallback here should never fire on a current
 * extract) or marked as fitted and awaiting measurement against the game.
 */
export const WILLYS = {
  // `Objects.con`: `mass 2500`, `drag 1.5`. Mass never appears alone in this
  // model — every force is kept in acceleration units, the same reading of
  // `setTorque` the flight model uses — but the exe's drag equation divides by
  // it, so it is real data doing real work below. [data]
  mass: 2500,
  drag: 1.5,
  // Enters the retail drag equation as pi r^2 / mass (`physics.js`,
  // `applyDrag`, 0x00578990). Not declared for vehicles anywhere we can read;
  // 1.8 m is the jeep's rough envelope. At these numbers aero drag is
  // 0.11 m/s^2 at top speed — present, and nearly decorative. [free]
  boundingRadius: 1.8,

  // --- drivetrain, `Physics.con` --------------------------------------------
  // `setTorque`, read the way flight-model.md section 2b reads it for
  // aircraft: peak drive as acceleration, m/s^2, mass already inside. For a
  // car we take that peak to be first gear's, and scale the other gears down
  // by ratio — see `gearRatios`. [data; the units are strong inference]
  torque: 10.5,
  // `setDifferential 7`: final drive between engine revs and wheel revs.
  // With the measured wheel radius it is one leg of the top-speed arithmetic
  // below, which is the strongest evidence for reading it as a ratio. [data]
  differential: 7,
  // `setNumberOfGears 5`, `setGearUp 0.95`, `setGearDown 0.4`: the gear count
  // and the shift points as fractions of maximum revs. This is the whole of
  // what the game *authors* about the gearbox — but it is no longer the whole
  // of what the game knows, because the ratio ladder is a curve compiled into
  // `EngineTemplate`'s constructor rather than a `.con` word (TANK-3). See
  // `GEAR_RATIO_CURVE` and `gearLadder`. [data]
  numberOfGears: 5,
  gearUp: 0.95,
  gearDown: 0.4,
  // There is no `gearRatios`, no `reverseRatio` and no `revLimit` here any
  // more. All three were inventions and all three are now derived (TANK-3,
  // TANK-9):
  //
  //   the ladder      `gearLadder(differential, numberOfGears)` — the engine's
  //                   own `getCurrentRatio()` per gear, for any gear count.
  //   reverse         gear 1's ratio, which is what `reverseRatio 3.8` was
  //                   standing in for (it equalled `gearRatios[0]`).
  //   the rev ceiling  revs are a fraction of full, and the road speed a gear
  //                   reaches at a given rev fraction is the engine's own
  //                   EngineGrip target, `ratio * revs`. Full is not 1:
  //                   `Engine::handleUpdate` clamps revs to
  //                   `ENGINE_REV_CEILING` (1.2), so top gear tops out at
  //                   `1.2 * ladder[top]`. `revLimit 356` was fitted to put
  //                   that at 18.5 m/s; the read relation puts it at 31.3 and
  //                   owes nothing to a fit.
  //
  // Torque still fades linearly over the last (1 - gearUp) of the rev range so
  // that top speed is an equilibrium rather than a wall. That shape is still a
  // viewer choice; its endpoints are now both data. [free, shape only]
  //
  // --- wheels ---------------------------------------------------------------
  // Measured off `Willy_WheelR_M1`'s vertex bounds in the glb: the tyre spans
  // -0.364..0.364 in Y and Z. Not declared in any .con — the engine gets it
  // from the collision mesh, and so, indirectly, do we. [data, measured]
  wheelRadius: 0.364,
  // `setStrength 25` / `setDamping 5`, per wheel. The units are acceleration
  // per metre and per metre-per-second — per-mass, like torque — and the
  // evidence is too tidy to be coincidence: four wheels give the heave mode
  // 2 x sqrt(4 x 25) = 20 of critical damping, and 4 x 5 = 20 is exactly what
  // the data provides. Somebody at DICE tuned this critically damped. [data;
  // units strong inference]
  springStrength: 25,
  springDamping: 5,
  // How far a spring may compress before it is riding on the bump stop, and
  // how much stiffer the stop is. Neither is declared. [free]
  suspensionTravel: 0.30,
  bumpStiffness: 5,

  // --- tyres ----------------------------------------------------------------
  // There is no `mu` here any more. The coefficient is material data (PHY-2):
  // `0.5 * (materialFriction[wheel] + materialFriction[ground])`, looked up
  // per wheel through the `surfaceFriction` the page injects. A jeep runs at
  // 0.9 on grass, 0.75 in mud, 1.05 on a paved road and 0.55 in water,
  // instead of at a flat fitted 1.0 everywhere — and it breaks away at 1.5x
  // that before it starts sliding. `DEFAULT_MATERIAL_FRICTION` is what a
  // level with no material map falls back to, which is also what the old
  // constant happened to be.
  //
  // THREE MORE CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK, and
  // these three were the file's last labelled inventions:
  //
  //   `corneringStiffness 7`     lateral force per radian of slip angle.
  //   `lateralGripFraction 1/1.5` how much of the Coulomb budget the lateral
  //                              axis could reach.
  //   `slipFloor 1.5`            the floored denominator a slip angle was
  //                              read against, plus a speed fade, because a
  //                              tyre model with authority at zero speed is
  //                              an oscillator.
  //
  // All three stood in for **RollGrip's own demand**, `dV = -(Vt along the
  // axle)` (collision-response.md section 8), which this file had never
  // written out: the Coulomb clamp BOUNDS a lateral demand and never CREATES
  // one, so deleting the stiffness without putting RollGrip in its place left
  // the jeep with no lateral force at all — 16 degrees of turn in 12 s
  // instead of 60, which is what a previous reviewer measured and why they
  // were kept. With the demand written out the same jeep turns **120 degrees
  // in 12 s** at 31 m/s, against 108 on `main` and 92 with the fitted model,
  // and the worst body roll is 8.7 degrees.
  //
  // And the clamp is **isotropic** again, as PHY-2 says it is: no ellipse,
  // no anisotropy, no slip-angle curve anywhere. What replaces the ellipse's
  // rollover protection is that the two demands now genuinely compete for one
  // budget — a wheel spending it on drive has none left to corner with, which
  // is collision-response.md's own "power slide" note, and a tank measured
  // `worstUp >= 0.974` across the whole yaw sweep where the ellipse was put
  // there to stop it rolling.
  // --- resistance and brakes ------------------------------------------------
  // FOUR CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK. All four were
  // fitted against the kinematic `revs = speed / ratio` drivetrain, and all
  // four are things the engine gets for free out of the EngineGrip target:
  //
  //   `rollingResistance 0.55`  a always-on drag. The engine has none. Off
  //   `engineBraking 0.4`       the pedal the rev state decays toward zero
  //                             with a 40-tick time constant, the target
  //                             `ratio * revs` decays with it, and the wheel
  //                             asks for `T - Vt` — a deficit that grows as
  //                             the target falls. That IS the coast, and it
  //                             is a firm one: the engine really does stop a
  //                             BF1942 jeep in a couple of seconds.
  //   `brakeDecel 8`            a brake force. The engine's brake is the byte
  //                             `PhysicsEngine+0xb4`, which `addFriction`
  //                             tests at `0x0825c28a` to **discard the target
  //                             entirely** (`0x0825c293` zeroes it): the
  //                             wheel then asks for `0 - Vt`, its whole
  //                             contact velocity back, and the Coulomb clamp
  //                             decides how much of that the ground answers.
  //                             So the brake is exactly `mu * |g|` and 8 was
  //                             below even mud's 11.0.
  //   `reverseBelow 0.5`        a speed under which an opposed pedal stops
  //                             braking and starts driving. The engine has no
  //                             such threshold: the brake byte is set while
  //                             the pedal opposes the REV DIRECTION, so it
  //                             clears by itself the moment the revs cross
  //                             zero and reverse drive begins from there.

  // --- the rigid body -------------------------------------------------------
  // Per-mass inertia (radius of gyration squared, m^2) about roll/pitch/yaw,
  // from a 1.6 x 1.5 x 3.6 m box, by the ENGINE's own formula rather than a
  // solid box's. `getGeometryInertia` (lnxded `0x08253930`, client
  // `0x0053fc30`, collision-response.md §4.2) reads the geometry bounding
  // box's full extents and returns
  //
  //     Ix = (DY² + DZ²)/3   Iy = (DZ² + DX²)/3   Iz = (DX² + DY²)/3
  //
  // which is **four times** a solid box's inertia per unit mass, and the
  // corpus is explicit that it is the only inertia there is: mass never
  // enters rotation, there is no gyroscopic term, and the body turns about
  // its ORIGIN rather than its centre of mass. These used to be the /12
  // values (0.40 / 1.27 / 1.29). The Willys declares no `inertiaModifier` the
  // way every aircraft does, so the modifier is 1 here.
  inertiaRoll: 1.60,
  inertiaPitch: 5.07,
  inertiaYaw: 5.17,
  // s^-1, on the body rates. The suspension already damps pitch and roll
  // hard (the dampers work on a lever); this mops up yaw and the airborne
  // case. [free]
  angularDamping: 0.8,

  // --- steering -------------------------------------------------------------
  // `WillyFrontWheelR/L`: `setMinRotation -30`, `setMaxRotation 30` about yaw
  // from `c_PIYaw` — the physical steering lock, and the same rig
  // `applyRig` poses the wheels with, so the physics and the visual read one
  // number. Fallback only; the live value comes off the node. [data]
  maxSteer: 30,

  // s^-1 ease on the audio rpm written to `state.throttle` (gearbox revs /
  // pedal floor) — the drive itself answers the pedal at once. [free]
  throttleEase: 3,
};

/**
 * Sherman numbers [data, `Objects.con`/`Physics.con`, TANK-4 byte-confirmed]
 * — used only when the node tree gives `collectChassis` nothing to read (an
 * extract from before `extras.physics` carried these, or a test double), and
 * for the geometry-derived fields, only when a wheel walk finds no wheels at
 * all to measure a footprint from.
 */
export const TANK = {
  mass: 25000,
  drag: 2,
  differential: 4,
  numberOfGears: 5,

  // Half-extents of the wheel footprint, and the one dimension no wheel walk
  // can ever supply (hull height) — fallbacks only; `collectChassis` measures
  // the first two off the actual wheel layout whenever there is one. [free]
  halfWidth: 1.0,
  halfLength: 2.5,
  hullHalfHeight: 1.1,
  boundingRadius: 3.0,
  wheelRadius: 0.33,

  // Suspension: `GroundVehicle`'s own shape: no tank-specific reading of the
  // spring solver exists any more than a car's does. The travel needs to be
  // generous precisely *because* the dummy wheels are legitimately worth
  // nothing (TANK-14): a Sherman's whole 25-tonne hull rests on only 4 real
  // springs (2 per side, `strength 18`), so standing still alone already
  // asks for ~0.20 m of compression (14.73 / (4*18)) — this is sized with
  // headroom above that static point, not tuned to a drive test. [free]
  suspensionTravel: 0.35,
  bumpStiffness: 5,

  // `mu 1.1` is gone: a track wheel's material (38, 178) is as undefined in
  // vanilla as a jeep's 37, so all of them fall back to material 0 at 1.0 and
  // the coefficient comes from the ground, per wheel, like everyone else's
  // (PHY-2). There never was a tank-specific reading to lose.
  //
  // The ANISOTROPY is gone too, with the same four names `WILLYS` lists —
  // `lateralGripFraction 0.5`, `corneringStiffness 12`,
  // `frontAxleCorneringStiffness 7`, `slipFloor 1.0`. The ellipse existed to
  // stop a track that resisted sliding sideways as hard as it gripped
  // lengthwise from rolling the hull over. With RollGrip written out, the
  // lateral demand competes with the drive for one isotropic budget instead
  // of being added to it, and a tank that is driving has no spare lateral
  // force to roll itself with: measured `worstUp >= 0.974` at every yaw from
  // 0.3 to full lock on both hulls, and >= 0.987 entering a turn from
  // straight-line top speed — the two cases the ellipse was fitted against.

  // THREE CONSTANTS ARE GONE FROM HERE AND MUST NOT COME BACK.
  //
  //   `rollingResistance 0.5`  a free-rolling front axle's drag. The engine
  //                            gives a RollGrip wheel NO longitudinal demand
  //                            at all (collision-response.md section 8):
  //                            `dV = -(Vt along the axle)`, lateral only.
  //   `trackResistance 0.25`   a fitted damper toward the track's target,
  //                            standing in for the engine's own `x30` on that
  //                            exact term. It was fitted against an M3A1 gear
  //                            ratio of 17.5 that TANK-3 refuted, then
  //                            re-fitted in the same breath against a body
  //                            thrust TANK-7 refuted. Both of its anchors are
  //                            gone; the term it stood in for is now written
  //                            out, so it is retired rather than re-fitted a
  //                            third time.
  //   `trackDifferential 20`   a hand-built steering couple, needed only
  //                            because `bodyThrust` propelled the hull and
  //                            the wheels' own targets had nothing to do. The
  //                            differential is now where the engine puts it —
  //                            in the two sides' contact-speed targets — and
  //                            the hull turns because they differ, with
  //                            nothing applying a yaw torque to it
  //                            (tank-driving.md section 5).

  // s^-1, on the *roll and pitch* body rates. Willy needs only 0.8 for the
  // same job (mopping up the airborne case); a tank's wheels sit much
  // farther from the root than a jeep's (the M3A1's own front axle 3 m ahead
  // of it), so the same body rate puts a far larger torque through the
  // identical suspension formula. Found by driving one through a sustained
  // turn and watching it roll itself onto its roof — twice: held from a
  // stand-still it tipped somewhere between yaw input 0.2 and 0.3 (fixed at
  // 5.0), and a second, harder case survived that fix and still rolled the
  // M3A1 at yaw 0.6 entered from its own straight-line top speed (~31 m/s)
  // rather than accelerating into the turn — the extra speed alone very
  // nearly doubles the centripetal load a held turn puts through the
  // suspension. 12.0 was the lowest value that survived both; this carries
  // margin above it. corneringStiffness made no difference to either case at
  // any value tried. [free]
  angularDamping: 15.0,

  // s^-1, on the **yaw** rate alone, and much lighter than the roll/pitch
  // figure above. Both rollover cases `angularDamping` was fitted against
  // are failures about the *roll* axis — the hull going over on its side —
  // and nothing in that tuning record ever measured what 15.0 did to
  // heading. What it did was flatten differential steering to nothing: a
  // tank's only yaw authority is the small left/right split in track force
  // `differentialRPM` produces, and dividing its steady state by 15 left the
  // Sherman turning 1.4 deg/s at full lock — a 4-minute 360, which is what a
  // player reads as "the drivetrain doesn't work". Yaw is damped on its own
  // term now, sized so the two vanilla tracked hulls turn at a believable
  // rate while both rollover cases above still survive (they are asserted in
  // tests/test_ground.py and were re-run against this value). Still fitted,
  // not measured — the same standing ask every other [free] constant here
  // carries. [free]
  yawDamping: 2.0,

  // A steered front axle's lock, used only if its own bundle somehow
  // declares no min/max at all to measure. M3A1's own is +-40 (TANK-15),
  // read off the node before this ever applies.
  maxSteer: 40,
};
