"""The flight model (`viewer/aircraft.js` on `vehicle-base.js`) under node: a
Corsair flown, not a Corsair read.

Same pattern as `test_physics.py` and `test_collision.py` — one node run,
many assertions, because starting the runtime is the slow part. The one thing
those two did not have to solve is that the flight model imports three.js, so
`run_harness` stands the vendored `three.module.js` up as a one-file package
under `node_modules` and mirrors `vendor/loaders/` next to the module. That is
enough to import the viewer's file byte-for-byte, which is the point: a test
that had to edit the module to run it would be testing the edit.

Why this file exists at all. A user reported that the aircraft would not sink,
and then fell backwards "like you're playing in reverse". All three halves of
that — no sink, no stall, nose frozen off the flight path — were one line in
`integrate` that lerped the whole velocity onto the fuselage axis, and none of
them were catchable by anything in the repository, because there was no way to
fly the model without a browser.

What it asserts has changed shape since. The model is no longer a lumped
authority shim over flight-model.md section 8 — it *is* section 8, running the
equations read out of the retail client — so the cases below split in two:

* the engine's arithmetic, asserted directly and exactly. `calculateLift`'s
  22.5 degree peak, its cliff at 45, its square in speed; the wing coefficient
  being `(setWingLift + setFlapLift) * g/9.82`; the thrust scalar's signed
  square; the 1000 m lift ceiling. These are not tuning targets and have no
  error bars — they are the binary.
* the behaviours, which are bounds and stay loose on purpose: the nose follows
  the flight path, the aircraft sinks when it is slow, and there is no stable
  backward flight anywhere in the envelope.

Everything the old lumped model was calibrated against — `K_LIFT`, `AOA_CLAMP`,
`THRUST` from `setTorque`, the linear thrust fade, `WEATHERVANE`,
`WEATHERVANE_YAW`, `SLIP_DAMP` — is retired, and
`test_every_fitted_constant_is_gone` is what keeps it retired.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "flight_harness.mjs"

# The flight model's modules (`vehicle-base.js`, `aircraft.js`, `vehicle-camera.js`,
# `vehicle-discovery.js`) under their own names next to the harness, plus the
# two vendored files they reach for at their own relative paths.
MODULES = {
    "vehicle-camera.js": VIEWER / "vehicle-camera.js",
    "vehicle-discovery.js": VIEWER / "vehicle-discovery.js",
    "vehicle-base.js": VIEWER / "vehicle-base.js",
    "model-file.js": VIEWER / "model-file.js",
    "camera-pivot.js": VIEWER / "camera-pivot.js",
    "aircraft.js": VIEWER / "aircraft.js",
    "ship-spec.js": VIEWER / "ship-spec.js",
    "bot-vehicle-air.js": VIEWER / "bot-vehicle-air.js",
    # `aircraft.js` flies an airframe whose engines point off its nose (a
    # helicopter) through `vectored-engines.js`, which runs the gearbox
    # (`engine-revs.js`) at the engine tick rate (`body-friction.js`, which
    # imports `rigid-body.js`).
    "vectored-engines.js": VIEWER / "vectored-engines.js",
    "engine-revs.js": VIEWER / "engine-revs.js",
    "body-friction.js": VIEWER / "body-friction.js",
    "rigid-body.js": VIEWER / "rigid-body.js",
    # The page's air-seat tick (`vehicleTick`), so the owner's Harrier flight
    # is keyed through the same W/S and stick shaping the page applies; it
    # reaches `vehicle-damage.js` for the HP-15 gate, which needs the other three.
    "world-vehicle-tick.js": VIEWER / "world-vehicle-tick.js",
    "world-input.js": VIEWER / "world-input.js",
    # The air-input package's `world-input.js` imports it (the wire's axis
    # range); staged already so the two land in either order.
    "mouse-input.js": VIEWER / "mouse-input.js",
    "vehicle-damage.js": VIEWER / "vehicle-damage.js",
    "armor.js": VIEWER / "armor.js",
    "effects-core.js": VIEWER / "effects-core.js",
    "projectile-damage.js": VIEWER / "projectile-damage.js",
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
    # The bare specifier `three` is an import map entry in the page; node needs
    # a package, so the same file is published as one.
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})

# Gravity: `BasicPhysicsSystem::BasicPhysicsSystem`, client 0x00578f00.
G = 14.7295379
# `airDensityZeroAtHeight`, same constructor, +0x30.
CEILING = 1000.0


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        # The extracted model tree is not in the repository; when this PC has
        # one, the harness also flies the real Desert Combat glbs out of it.
        env = {**os.environ, "BF42_VIEWER_MODELS": str(VIEWER / "models"),
               "FLIGHT_FIXTURES": str(Path(__file__).resolve().parent / "fixtures")}
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900, env=env)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class FlightModelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the lift equation, read at 0x0057fa90 -----------------------------

    def test_the_lift_coefficient_peaks_at_twentytwo_and_a_half_degrees(self) -> None:
        # c = a*(45 - a)/506.25 peaks at exactly 1.0 at a = 22.5, so the whole
        # bracket there is 0.75 + 0.25 sin(22.5). Nothing about this is fitted.
        curve = self.results["liftEquation"]
        self.assertAlmostEqual(curve["peakExpected"], curve["peak"], places=6)
        for angle in ("1", "5", "10"):
            self.assertLess(curve["curve"][angle], curve["peak"])
        # ...and it really is a peak: past it the coefficient falls again.
        self.assertLess(curve["curve"]["30"], curve["peak"])
        self.assertLess(curve["curve"]["44"], curve["curve"]["30"])

    def test_the_coefficient_falls_off_a_cliff_at_fortyfive_degrees(self) -> None:
        # This is the engine's entire stall model, and it is a cliff in the
        # COEFFICIENT rather than in the return: past +-45 the `c` term is hard
        # zero and only the 0.25 sin survives.
        curve = self.results["liftEquation"]
        self.assertAlmostEqual(curve["residualExpected"], curve["justAbove45"], places=6)
        self.assertGreater(curve["justBelow45"], curve["justAbove45"])
        # Three quarters of peak lift gone by 45 degrees.
        self.assertLess(curve["justAbove45"], curve["peak"] * 0.25)
        # And the residual is real rather than zero, which is what stops a
        # tumbling aircraft from being weightless.
        self.assertGreater(curve["curve"]["90"], 0.2)

    def test_the_speed_exponent_is_two(self) -> None:
        # `len*len`, settling flight-model.md section 9c item 1. The old model
        # was linear in v and every constant hung off that.
        self.assertAlmostEqual(4.0, self.results["liftEquation"]["speedRatio"], places=6)

    def test_the_small_angle_slope_is_the_one_the_binary_folds(self) -> None:
        # 0.75 x 45/506.25 + 0.25 x pi/180 = 0.07103 per degree. MSVC folded
        # the /506.25 into a multiply, which is why a byte search for it misses.
        curve = self.results["liftEquation"]
        self.assertAlmostEqual(curve["slopeExpected"], curve["slopePerDegree"], places=5)

    def test_zero_flow_is_exactly_zero_lift(self) -> None:
        self.assertEqual(0, self.results["liftEquation"]["zeroFlow"])
        self.assertEqual(0, self.results["liftEquation"]["curve"]["0"])

    # --- the constants and the surface table -------------------------------

    def test_gravity_is_the_engines(self) -> None:
        # BasicPhysicsSystem ctor, 0x00578f00. Same value physics.js carries.
        self.assertAlmostEqual(G, self.results["constants"]["gravity"], places=4)
        self.assertAlmostEqual(G, self.results["constants"]["specGravity"], places=4)

    def test_every_fitted_constant_is_gone(self) -> None:
        # The whole point of the change. `K_LIFT`, `AOA_CLAMP`, `THRUST` (which
        # was `setTorque`, an audio parameter), the linear thrust fade, and the
        # three lumped shims that were all calibrated off `K_LIFT`. A spec that
        # answers to any of these still has a free parameter where the engine
        # has arithmetic.
        self.assertEqual([], self.results["constants"]["retired"])

    def test_the_wing_coefficient_sums_the_two_authored_lift_values(self) -> None:
        # `PhysicsWing::updatePhysics`, 0x0057fbf0:
        #   coeff = (setWingLift + setFlapLift) * getGravity() * -0.101833
        # which at the shipped g is a flat x1.49995. This corrects
        # flight-model.md section 4a: there is no flapLift x deflection term.
        table = {row["id"]: row for row in self.results["surfaceTable"]}
        scale = G / 9.82
        for surface, wing_lift, flap_lift in [
            ("ailL", 1.85, 1.7), ("ailR", 1.85, 1.7),
            ("elevL", 0.5, 0.5), ("elevR", 0.5, 0.5),
            ("rud", 1.0, 1.0), ("regL", 0.0, 4.0), ("regR", 0.0, 4.0),
            ("fin", 2.0, 0.0),
        ]:
            self.assertAlmostEqual((wing_lift + flap_lift) * scale,
                                   table[surface]["coeff"], places=2, msg=surface)

    def test_flap_lift_is_the_moving_share_of_one_surface(self) -> None:
        # ...and this is where the two values ARE told apart. `Wing::handleUpdate`
        # poses the surface at `deflection * flapLift/(wingLift + flapLift)
        # - pitchOffset`. So a rudder (0/2) swings its whole area, a body fin
        # (2/0) none of it, and a Corsair elevator (0.5/0.5) half — 20 degrees
        # of hinge is ten degrees of aerodynamic angle.
        table = {row["id"]: row for row in self.results["surfaceTable"]}
        self.assertAlmostEqual(1.0, table["regL"]["flapShare"], places=3)
        self.assertAlmostEqual(0.0, table["fin"]["flapShare"], places=3)
        self.assertAlmostEqual(0.5, table["elevL"]["flapShare"], places=3)
        self.assertAlmostEqual(1.7 / 3.55, table["ailL"]["flapShare"], places=3)

    def test_the_regulators_apply_their_lift_at_the_centre_of_mass(self) -> None:
        # `setPositionOffset` exactly negates the attach position on both, which
        # is what keeps sustaining lift from pitching or rolling the aircraft.
        table = {row["id"]: row for row in self.results["surfaceTable"]}
        for surface in ("regL", "regR"):
            self.assertTrue(table[surface]["regulates"])
            for axis in table[surface]["apply"]:
                self.assertLess(abs(axis), 0.01)
        # The tail is a long way behind it, which is where static stability
        # comes from, and the ailerons sit just ahead.
        self.assertGreater(table["elevL"]["apply"][2], 3.0)
        self.assertLess(table["ailL"]["apply"][2], 0.0)

    def test_the_rig_and_the_physics_surfaces_are_one_servo_each(self) -> None:
        rig = self.results["rig"]
        self.assertEqual(5, rig["parts"])
        self.assertEqual(8, rig["physicsSurfaces"])
        # Three player axes, plus the body fin — the five rig parts collapse
        # onto three keys, because a mirrored pair is commanded together and
        # shares an entry. The two regulators run their own velocity servo
        # (`Surface.servoLaw`, GUN-2), not the rig's.
        self.assertEqual(4, rig["servos"])
        self.assertTrue(rig["hasCamera"])
        self.assertEqual("Corsair", rig["found"])

    def test_a_mirrored_pair_travels_at_its_declared_max_speed(self) -> None:
        # The `advanceSurfaces` defect, as a number. It keyed a deflection on
        # control/input/axis and then stepped it once per *part*, so the two
        # elevators — which share all three — drove the one shared entry twice
        # a frame and it travelled at 120 deg/s against `setMaxSpeed 60`.
        #
        # Elevator: 60 deg/s over a 20 degree half-range is 3 of normalised
        # travel a second, so three 30 Hz ticks are 0.3. Reading 0.6 is the
        # defect back.
        rig = self.results["rig"]
        self.assertAlmostEqual(-0.3, rig["elevator"], places=3)
        # The ailerons are a mirrored pair too, but they are keyed together and
        # were always right: 120 deg/s over 30 is 4, so 0.1 s is 0.4.
        self.assertAlmostEqual(0.4, rig["aileron"], places=3)
        # And a second later everything is at the stop.
        self.assertAlmostEqual(-1.0, rig["stops"]["c_PIPitch"], places=6)
        self.assertAlmostEqual(1.0, rig["stops"]["c_PIRoll"], places=6)

    def test_an_engine_spins_its_propeller_and_never_its_own_subtree(self) -> None:
        # `EngineTemplate` derives from `RotationalBundleTemplate`, which is the
        # only reason a `.con` may write `setInputToRoll c_PIThrottle` on an
        # Engine at all — but the object it creates is a `PhysicsEngine`
        # deriving from `PhysicsNode`, and `RotationalBundle::handleUpdate` is
        # the one place those numbers become a transform. The Engine node is
        # never posed by that axis, so it must never pose its subtree.
        #
        # This was a live bug on production: a Corsair whose landing gear, both
        # wheels, tail wheel and two bay hatches orbited the prop shaft.
        spin = self.results["engineSpin"]

        # Named children: spin exactly those, and nothing else moves.
        self.assertEqual(["lodCorsairPropeller"], spin["named"]["spun"])
        self.assertAlmostEqual(90.0, spin["named"]["propeller"], places=1)
        self.assertAlmostEqual(0.0, spin["named"]["engine"], places=1)
        self.assertAlmostEqual(0.0, spin["named"]["gear"], places=1)

        # No list, but the children carry the older per-child stamp: that is the
        # intermediate asset generation and the stamps still decide.
        self.assertEqual(["lodCorsairPropeller"], spin["stamped"]["spun"])
        self.assertAlmostEqual(90.0, spin["stamped"]["propeller"], places=1)

        # Present but empty, and neither field at all: spin nothing. The Engine
        # node itself must stay put in every case, because an Engine node
        # spinning itself is never correct — that fallback is what dragged the
        # gear round on production.
        for case in ("empty", "legacy"):
            self.assertEqual([], spin[case]["spun"], case)
            self.assertAlmostEqual(0.0, spin[case]["propeller"], places=1, msg=case)
        for case in ("named", "empty", "stamped", "legacy"):
            self.assertAlmostEqual(0.0, spin[case]["engine"], places=1, msg=case)
            self.assertAlmostEqual(0.0, spin[case]["gear"], places=1, msg=case)

    def test_the_blade_mesh_gives_way_to_the_blurred_disc_at_the_declared_threshold(
            self) -> None:
        # A user reported the browser's propeller spinning but never blurring
        # — because the extractor threw the real `PropellerBlurred` mesh away
        # and the viewer had nothing to swap to. `_propeller_blur` keeps both
        # and stamps the engine's own `addLodComparison` (0.07 on every
        # vanilla propeller) on the wrapper; this is that threshold read back
        # from the node, not hardcoded a second time.
        blur = self.results["propellerBlur"]

        for case in ("idle", "belowThreshold", "atThreshold"):
            self.assertTrue(blur[case]["static"], case)
            self.assertFalse(blur[case]["blurred"], case)
        for case in ("justAboveThreshold", "fullThrottle"):
            self.assertFalse(blur[case]["static"], case)
            self.assertTrue(blur[case]["blurred"], case)

        # No `extras.propellerBlur` at all (a ground vehicle, or an asset
        # extracted before this field existed) collects no pairs — and so
        # costs nothing per frame, same guarantee `spinsChildren` makes.
        self.assertEqual(0, blur["noExtras"])

    def test_a_cockpit_named_like_a_propeller_is_never_bound_to_the_throttle(
            self) -> None:
        # The bf109's cockpit LodObject wears the propeller's naming
        # convention (`bf109CockpitStatic` / `bf109CockpitBlurred`), so every
        # already-published scene carries a `propellerBlur` stamp on it. Taken
        # at face value the rig fought `CockpitSwap` for the same two nodes
        # and won, every frame: under half throttle the pilot was shown the
        # outside of his own fuselage from 0.7 m — reported as a "low
        # fidelity blurred HUD" — and it snapped to the real cockpit above it.
        blur = self.results["propellerBlur"]
        cockpit = blur["cockpitNamedLikeAPropeller"]

        self.assertEqual(0, cockpit["pairs"])
        # And the rig left both alone rather than flipping them at throttle 0.
        self.assertTrue(cockpit["exterior"])
        self.assertTrue(cockpit["interior"])
        # The kind narrows; it does not disarm the real swap.
        self.assertEqual(1, blur["compareSelectorIsStillAPair"])

    def test_the_inertia_is_the_engines_geometry_inertia(self) -> None:
        # `getGeometryInertia` (lnxded 0x08253930, COL-8): (DY^2+DZ^2)/3 and
        # its two siblings off `Corsair_Hull_M1`'s `.sm` header box, 11.04 x
        # 2.85 x 8.05 m (COL-14), times `inertiaModifier 1.05/0.850/0.94` read
        # as x/y/z, so 1.05 is the PITCH axis (COL-13). Times the mass, which
        # cancels out of the rotation. There is no free number left in it; the
        # solid box (/12) and the yaw/pitch/roll reading it replaces gave
        # 20126 / 56938 / 32481.
        inertia = self.results["inertia"]
        self.assertAlmostEqual(63859, inertia["pitch"], delta=2)
        self.assertAlmostEqual(132333, inertia["yaw"], delta=2)
        self.assertAlmostEqual(101893, inertia["roll"], delta=2)
        self.assertGreater(inertia["yaw"], 2 * inertia["pitch"])

    # --- thrust, read at 0x0057bfb0 ----------------------------------------

    def test_the_thrust_scalar_is_differential_over_the_gear_curve(self) -> None:
        # `getCurrentRatio` = 3.5 * setDifferential / gearRatioCurve[100], and
        # gearRatioCurve[100] is 0.94 (EngineTemplate ctor, 0x005715d0). NOT
        # `setTorque`, whose only consumer in the binary is the engine sound.
        self.assertAlmostEqual(3.5 * 5 / 0.94, self.results["solved"]["ratio"], places=2)

    def test_thrust_rises_as_speed_falls(self) -> None:
        # `K = 0.1*|throttle| + e*|e|` with `e = throttle - rho*v/70`. At rest
        # it is 1.1 and a Corsair has more thrust than weight; it decays to the
        # 0.1 idle term at the fade speed and goes NEGATIVE past it.
        curve = self.results["solved"]["thrustCurve"]
        accel = {row["speed"]: row["accel"] for row in curve}
        for faster, slower in zip([20, 40, 60, 90, 120], [0, 20, 40, 60, 90]):
            self.assertLess(accel[faster], accel[slower])
        self.assertGreater(accel[0], G)
        self.assertLess(accel[120], 0.0)

    def test_a_closed_throttle_propeller_is_an_airbrake(self) -> None:
        # The signed square, at throttle 0: K = -(rho v/70)^2. This is what
        # caps a dive far below the old model's g/drag, and it is worth several
        # g on its own.
        for row in self.results["solved"]["idleCurve"]:
            self.assertLess(row["accel"], 0.0, row["speed"])
        idle = {row["speed"]: row["accel"] for row in self.results["solved"]["idleCurve"]}
        self.assertLess(idle[70], -G)

    def test_thrust_grows_with_altitude_rather_than_fading(self) -> None:
        # The brief this change was written from said thrust fades to nothing
        # at 1000 m. It does not: `rho` multiplies only the SPEED term, so a
        # high propeller does not know how fast it is going and makes MORE
        # thrust. The 1000 m ceiling is a lift ceiling only.
        rows = self.results["solved"]["thrustByAltitude"]
        for higher, lower in zip(rows[1:], rows):
            self.assertGreater(higher["accel"], lower["accel"])

    # --- the 1000 m lift ceiling -------------------------------------------

    def test_lift_fades_linearly_to_nothing_at_a_thousand_metres(self) -> None:
        medium = {row["y"]: row["medium"] for row in self.results["medium"]}
        self.assertAlmostEqual(1.0, medium[0], places=4)
        self.assertAlmostEqual(0.75, medium[250], places=4)
        self.assertAlmostEqual(0.5, medium[500], places=4)
        self.assertAlmostEqual(0.0, medium[CEILING], places=6)
        # Clamped, not continued: above the ceiling it is zero, not negative.
        self.assertAlmostEqual(0.0, medium[1400], places=6)

    def test_a_submerged_surface_makes_ten_times_the_lift(self) -> None:
        # The other branch of the same expression, and the reason a ship's
        # `HullWing` steers at all.
        self.assertAlmostEqual(10.0, self.results["submergedMedium"], places=4)

    def test_the_service_ceiling_is_under_the_air_density_height(self) -> None:
        # Flown, not computed: a full-throttle climb on a 10 degree path stalls
        # out short of 1000 m, where a Refractor wing stops making lift
        # entirely. Under the box drag and the gearbox's revs it gets to 784 m
        # (770 at best on any fixed path angle); the pedal-on-the-thrust-law
        # model on the fitted `-drag v` reached 989.
        ceiling = self.results["serviceCeiling"]
        self.assertLess(ceiling["best"], CEILING)
        self.assertGreater(ceiling["best"], 700.0)

    # --- the Spitfire on its own data (ledger AI-75) -----------------------

    def test_an_aircraft_flies_on_its_own_con_numbers(self) -> None:
        # `aircraftSpec` reads the plane's own table off its tree: the
        # Spitfire's elevators 5.3 m aft (the Corsair's 3.5), `0.5 / 0.7`,
        # `drag 0.09`, the box drag law, and the ride height from its wheel.
        s = self.results["spitfire"]
        self.assertEqual(s["mass"], 2500)
        self.assertEqual(s["drag"], 0.09)
        self.assertEqual(s["dragLaw"], "box")
        self.assertEqual(s["inertiaModifier"], [0.85, 0.833, 0.84])
        self.assertEqual(s["surfaces"], 8)
        self.assertEqual(s["engines"], 1)
        self.assertAlmostEqual(s["elevatorArm"], -5.306, places=3)
        self.assertAlmostEqual(s["elevatorLift"], 1.2, places=6)
        self.assertAlmostEqual(s["groundClearance"], 1.3855, places=3)
        self.assertAlmostEqual(s["throttleRate"], 0.1, places=6)
        self.assertEqual(s["size"], [11.3, 2.28, 9.14])
        self.assertTrue(s["fallback"])

    def test_a_regulator_runs_its_own_servo_from_its_data(self) -> None:
        # `setMinRotation 0/-2/0`, `setMaxRotation 0/2/0`, `setMaxSpeed
        # 0/30/0`, `setAcceleration 0/120/0` and no input: read off the Wing's
        # physics into a velocity servo (GUN-2) that integrates the
        # regulator's command, so in level flight it moves off its rest
        # incidence (a tree with no such data froze it there).
        s = self.results["spitfire"]
        self.assertEqual({"servoLaw": True, "min": -2, "max": 2, "maxSpeed": 30, "acceleration": 120},
                         s["regulator"])
        self.assertGreater(abs(s["regulatorTrim"]), 0.2)
        self.assertLessEqual(abs(s["regulatorTrim"]), 2.0)

    def test_the_spitfire_pitch_rate_per_full_stick(self) -> None:
        # Measured, not fitted: a second after a full stick, from a second of
        # hands-off flight at the speed (28 / 48 deg/s up at 40 / 60 m/s).
        # The Corsair pitches slower at 40: its pitch axis is the heavy one
        # under the engine's x/y/z reading (1.05 against the Spitfire's 0.85,
        # COL-13).
        s = self.results["spitfire"]
        self.assertGreater(s["pitchUp40"], 20.0)
        self.assertLess(s["pitchUp40"], 40.0)
        self.assertLess(s["pitchDown40"], -20.0)
        self.assertGreater(s["pitchUp60"], 30.0)
        self.assertLess(s["pitchUp60"], 60.0)
        self.assertLess(s["pitchDown60"], -20.0)
        self.assertLess(s["corsairUp40"], s["pitchUp40"])

    def test_the_engine_plane_law_closes_on_the_spitfire(self) -> None:
        # `aimAtDirection` -> `towardsDirection` on the Spitfire's own
        # airframe: a step of the wanted direction 10 and 25 deg below the
        # nose settles inside a degree (the 10 deg step within 1 s, the 25 deg
        # one within 2 s) and overshoots by under 2 (0.72 s / 1.57 s, 0.9 /
        # 0.7 deg measured).
        s = self.results["spitfire"]
        for case, limit in ((s["loopDown"], 1.0), (s["loopDeep"], 2.0)):
            self.assertIsNotNone(case["settledAt"])
            self.assertLess(case["settledAt"], limit)
            self.assertLess(case["overshoot"], 2.0)

    def test_the_drag_matches_the_real_games(self) -> None:
        # The real game, recorded: in the lab's bots-only El Alamein rounds
        # (`20261004-180859-parity-elalamein-rec`, both `projpool` runs; about
        # 210,000 airborne Spitfire samples) the drag a Spitfire feels in
        # near-level, unbanked flight is the engine law's thrust on its own
        # RECORDED revs, less its acceleration and the climb's share of g.
        # The medians, at 120-130 m: 2.15 m/s^2 at 45-50 m/s, 2.97 at 55-60,
        # 3.53 at 60-65 (flight-model.md section 10). The same airframe here,
        # held level at the speed by its own throttle, needs 2.23 / 2.85 /
        # 3.28: the box drag on the `.sm` header box plus every Wing's lift.
        # The bots fly with their controls moving, which costs drag the held
        # fixture does not pay, so the bound is 12% either way.
        curve = self.results["spitfire"]["dragCurve"]
        for speed, retail in (("47.5", 2.15), ("57.5", 2.97), ("62.5", 3.53)):
            self.assertLess(curve[speed]["held"], 0.5, speed)
            self.assertAlmostEqual(retail, curve[speed]["drag"], delta=0.12 * retail, msg=speed)

    def test_the_spitfire_outruns_its_ai_maxspeed(self) -> None:
        # Full throttle on the level: 68 m/s at the deck, 73 at 200 m, against
        # the AI's `maxSpeed` 60 (which the real game's fighters and jets both
        # exceed: the recorded Spitfire holds revs 1.2 at 70-75 m/s near
        # level). Under the pedal-on-the-thrust-law throttle and the solid box
        # it was 57.7 / 64.1; the gearbox's revs pass 1.0 (TANK-12).
        s = self.results["spitfire"]
        self.assertAlmostEqual(68.0, s["top40"], delta=2.0)
        self.assertGreater(s["top200"], s["top40"])

    # --- level flight ------------------------------------------------------

    def test_level_top_speed_is_the_gearboxs_not_the_ai_maxspeed(self) -> None:
        # Full throttle, held level: 68.8 m/s at 40 m and 76.1 at 200 m, the
        # engine's thrust on its gearbox's revs (1.2 at the top, TANK-12)
        # against the box drag. The AI's `maxSpeed` 55 is not a top speed: the
        # lab's recorded Corsairs hold revs 1.2 at 70-80 m/s near level (Wake
        # and Midway). The pedal-on-the-thrust-law model topped out at 49.4 /
        # 55.8 on the fitted `-drag v`.
        speeds = {row["altitude"]: row["speed"] for row in self.results["topSpeed"]}
        self.assertAlmostEqual(68.8, speeds[40], delta=2.0)
        self.assertGreater(speeds[200], speeds[40])

    def test_the_hands_off_trim_is_near_level_flight(self) -> None:
        # Hands off at full throttle from 49.4 m/s at 40 m: four minutes on it
        # is at 68 m/s on a 1.6 degree powered descent (-2 m/s), the
        # regulators' servos at 1.7 of their 2 degrees, and the last ninety
        # seconds move the sink by under half a metre a second. Under the
        # pedal-on-the-thrust-law throttle, with the regulators a
        # proportional position servo, it settled into a 6.6 degree descent at
        # 57.7. flight-model.md's sections 4c and 5 expected a Corsair to
        # hold altitude hands-off, and the retail game was filmed doing it.
        trim = self.results["trim"]
        self.assertLess(trim["settled"], 0.5)
        self.assertLess(abs(trim["vy"]), 3.0)
        self.assertLess(abs(trim["path"]), 2.5)
        # The nose stays on the flight path through all of it.
        self.assertLess(abs(trim["alpha"]), 1.0)
        # And the regulator's servo is inside its +-2 degrees.
        self.assertLessEqual(abs(trim["regulator"]), 2.0)

    def test_a_little_back_stick_climbs_where_hands_off_sinks(self) -> None:
        # At 400 m, where the air gives the wings 0.6 of their lift, hands off
        # sinks (166 m in 30 s); a twentieth of the elevator climbs (50 m) and
        # a tenth climbs more (185 m).
        stick = {row["stick"]: row for row in self.results["levelStick"]}
        self.assertGreater(stick[0]["drop"], 50.0)
        self.assertLess(stick[-0.05]["drop"], 0.0)
        self.assertLess(stick[-0.1]["drop"], stick[-0.05]["drop"])

    def test_a_closed_throttle_dive_windmills_the_engine(self) -> None:
        # Held vertical at idle from 900 m, the dive settles at 113 m/s. Past
        # the fade speed `K` goes negative, and its load (`feedbackLoop`,
        # TANK-13) is negative too, so the gearbox's `2*(T1 - L)` drives the
        # revs UP with the throttle shut: the propeller windmills at 0.99 and
        # brakes at -0.28 x ratio, not at the -(v/70)^2 x ratio of a stopped
        # one (the pedal-on-the-thrust-law model's dive settled at 54). The
        # lab's recorded AC-130s show the windmill: with the throttle at 0 in
        # flight at 20-40 m/s their engines read revs 0.055-0.07, the fixed
        # point of this law for their fade-120 engines (0.06). The box drag
        # and the brake together hold it well under `g/drag`.
        dive = {row["throttle"]: row for row in self.results["terminalDive"]}
        self.assertLess(dive[0]["peak"], 150.0)
        self.assertGreater(dive[0]["end"]["speed"], 90.0)
        self.assertLess(dive[0]["end"]["speed"], 130.0)
        self.assertGreater(dive[0]["revs"], 0.5)

    def test_a_hands_off_dive_pulls_itself_out(self) -> None:
        recovery = self.results["diveRecovery"]
        self.assertGreater(recovery["nose"], -45.0)
        self.assertLess(recovery["nose"], 0.0)

    def test_it_takes_off_and_stays_off(self) -> None:
        takeoff = self.results["takeoff"]
        self.assertIsNotNone(takeoff["unstuckAt"])
        self.assertLess(takeoff["unstuckAt"], 25.0)
        # Unstick near the rotation speed, not at a crawl and not at cruise.
        self.assertGreater(takeoff["unstuckSpeed"], 30.0)
        self.assertLess(takeoff["unstuckSpeed"], 55.0)
        # And it does not settle back onto the strip once the climb is set.
        self.assertEqual(0, takeoff["groundedAfterUnstick"])
        self.assertGreater(takeoff["end"]["y"], 100.0)

    # --- the stall ---------------------------------------------------------

    def test_the_lift_ceiling_crosses_gravity_near_seventeen_metres_a_second(self) -> None:
        # The most lift the aircraft can make at a speed, swept over every
        # angle of attack it can reach. Where it crosses g is the speed below
        # which no stick position holds it up — and it falls out of the surface
        # table without anything being fitted to it.
        curve = {row["speed"]: row["maxLift"] for row in self.results["liftCeiling"]}
        self.assertGreater(curve[18], G)
        self.assertLess(curve[17], G)
        for faster, slower in zip([60, 50, 40, 30, 20], [50, 40, 30, 20, 18]):
            self.assertGreater(curve[faster], curve[slower])

    def test_the_best_angle_of_attack_is_the_equations_own_peak(self) -> None:
        # Every speed peaks near 20 degrees, a little short of `calculateLift`'s
        # 22.5 because the surfaces are mounted with dihedral and incidence.
        # Nothing in the model declares a stall angle.
        for row in self.results["liftCeiling"]:
            self.assertGreater(row["atAlpha"], 15.0, row["speed"])
            self.assertLess(row["atAlpha"], 25.0, row["speed"])

    def test_hands_off_the_slower_it_is_the_further_it_falls(self) -> None:
        # The reported bug, as a number. With the flight path welded to the
        # nose this was a 3 m descent in ten seconds from 8 m/s.
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        for throttle in (0, 1):
            for faster, slower in zip((49.4, 45, 35, 25, 20, 16.7, 12.4),
                                      (45, 35, 25, 20, 16.7, 12.4, 8)):
                self.assertLess(sink[(faster, throttle)]["drop"],
                                sink[(slower, throttle)]["drop"],
                                f"{slower} m/s does not fall further than {faster}")

    def test_sinking_drops_the_nose_rather_than_flying_level_downward(self) -> None:
        # The nose has to follow the flight path down. A level nose with a
        # descending flight path is the model pretending to fly.
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        for entry in (35, 25, 20, 16.7, 12.4, 8):
            self.assertLess(sink[(entry, 0)]["nose"], -5.0)

    # --- the loop, which is the filmed ground truth -------------------------

    def test_it_loops_and_keeps_looping(self) -> None:
        # A retail SBD-T closes a 360 degree loop from low level at full
        # throttle in about eleven seconds. A Corsair is a fighter, so eleven
        # has to be comfortable rather than marginal — and the second loop has
        # to be as good as the first, or the aircraft has an energy problem.
        for case in self.results["loop"]:
            self.assertIsNotNone(case["closedAt"], case["entry"])
            self.assertLess(case["closedAt"], 11.0, case["entry"])
            self.assertGreater(case["closedAt"], 4.0, case["entry"])
            self.assertGreater(case["loops"], 2.5, case["entry"])
        # Entering faster closes it faster.
        by_entry = {case["entry"]: case["closedAt"] for case in self.results["loop"]}
        self.assertLess(by_entry[60], by_entry[49.4])

    def test_a_sustained_pull_keeps_the_nose_near_the_flight_path(self) -> None:
        # Full elevator held from cruise. The nose leads the flight path, but
        # by single digits rather than by the tens of degrees a model with no
        # restoring moment allows.
        for sample in self.results["sustainedPull"]:
            self.assertLess(abs(sample["lead"]), 12.0)
        # And the pull is a real one: the flight path comes round at 26 deg/s
        # a second in and 37 by the second second (the engine's pitch inertia
        # takes longer to wind it up than the solid box did).
        self.assertGreater(max(x["pathRate"] for x in self.results["sustainedPull"]), 30.0)

    def test_full_stick_roll_can_do_what_the_real_game_does(self) -> None:
        # 152 deg/s at 49.4 m/s after 1.5 s of full stick, and symmetric.
        # Nothing commands this: it is the ailerons' own lift on their own
        # levers against their own damping, on the engine's `/3` roll inertia,
        # and the mirroring is authored config (`sign(setAcceleration)`), so a
        # broken sign shows up as one direction rolling and the other not. The
        # lab's recorded Corsairs (Wake, Midway: 14,899 airborne samples) roll
        # at 128 deg/s at the most, so full stick must reach that. On the solid
        # box the rate was 212.
        for direction in ("left", "right"):
            rate = self.results["roll"][direction]
            self.assertGreater(rate, 128.0)
            self.assertLess(rate, 200.0)
        self.assertAlmostEqual(self.results["roll"]["left"],
                               self.results["roll"]["right"], delta=2.0)

    # --- the nose follows the flight path ----------------------------------

    def test_the_nose_converges_on_the_flight_path(self) -> None:
        for case in self.results["noseTracking"]:
            label = f"{case['axis']} {case['start']} deg at {case['speed']} m/s"
            self.assertIsNotNone(case["halfLife"], f"{label} never closed")
            # The stall case takes 6.4 s on the engine's inertia (4.3 on the
            # solid box); cruise closes in under half a second.
            self.assertLess(case["halfLife"], 8.0, label)
            self.assertLess(abs(case["settled"]), 2.0, label)

    def test_it_is_the_nose_that_moves_and_not_only_the_flight_path(self) -> None:
        # The distinguishing measurement, and the one the old model failed
        # while passing the test above: the angle closed because the velocity
        # was dragged onto the fuselage, and the nose itself never travelled a
        # degree. Here every case moves the nose.
        for case in self.results["noseTracking"]:
            travel = abs(case["noseEnd"] - case["noseStart"])
            self.assertGreater(travel, 0.1, f"{case['axis']} {case['start']}: nose did not move")

    def test_a_stall_breaks_by_dropping_the_nose(self) -> None:
        # 15 m/s, throttle shut, nose 40 degrees above the flight path. There
        # is no lift to pull the path up to meet it, so the only way the angle
        # can ever close is the nose coming down — and it must end up below the
        # horizon, which is what makes a stall recoverable.
        stall = next(c for c in self.results["noseTracking"] if c["speed"] == 15.0)
        self.assertGreater(stall["noseStart"], 30.0)
        self.assertLess(stall["noseEnd"], -10.0)
        self.assertLess(abs(stall["settled"]), 2.0)

    def test_a_hard_pull_ends_in_a_recovery_and_not_a_prop_hang(self) -> None:
        # Four seconds of full back stick from cruise, then hands off. Before
        # the sink fix this ended with the nose frozen at 89.7 degrees and the
        # aircraft climbing at 1 m/s indefinitely. The idle case is the one the
        # retail game was filmed doing: it departs, tumbles and comes back down
        # flying rather than hanging on the propeller.
        for name in ("hardPull", "hardPullIdle"):
            pull = self.results[name]
            self.assertGreater(pull["peakNose"], 45.0, name)
            self.assertIsNotNone(pull["recoveredAt"], f"{name} never recovered")
            self.assertLess(pull["recoveredAt"], 30.0, name)
            self.assertLess(abs(pull["end"]["nose"]), 45.0, name)
            self.assertGreater(pull["end"]["speed"], 25.0, name)

    # --- backward flight, which must not have a resting state --------------

    def test_a_tail_first_launch_turns_around(self) -> None:
        # Thirty metres a second straight backwards down the fuselage, hands
        # off. The old model stayed there for the whole thirty seconds, bleeding
        # off only what linear drag took, because the same lerp that welded the
        # flight path to the nose preserved the sign of `v . fwd`.
        tail = self.results["tailFirst"]
        self.assertIsNotNone(tail["turnedAt"], "never turned around")
        self.assertLess(tail["turnedAt"], 5.0)
        self.assertGreater(tail["end"]["along"], 0.0)

    def test_a_tail_slide_from_rest_turns_around(self) -> None:
        # Nose vertical, no airspeed at all, dropped. This is the case an
        # `asin` angle of attack reads as zero and therefore cannot restore
        # from; the harness and the model both read it with `atan2`. Under
        # power it comes out flying forward. At idle, on the engine's inertia
        # (four times the solid box's, COL-8), the tail damps a pitch rotation
        # four times more slowly and the Corsair goes over into a pitch tumble
        # (68 deg/s, nose over tail; the Stuka does the same, the Spitfire,
        # BF109, B17 and F-16 come out of it): the tumble is not checked
        # against the real game, but it is no backward glide.
        full = self.results["tailSlideFull"]
        self.assertIsNotNone(full["turnedAt"], "never turned around")
        self.assertLess(full["turnedAt"], 10.0)
        self.assertGreater(full["settledForward"], 0.95)
        self.assertGreater(full["end"]["along"], 0.0)
        idle = self.results["tailSlide"]
        self.assertIsNotNone(idle["turnedAt"], "never turned around")
        self.assertGreater(idle["settledForward"], 0.25)
        self.assertGreater(idle["pitchRate"], 20.0)

    def test_holding_the_stick_back_cannot_produce_backward_flight(self) -> None:
        # Two minutes of full back stick, which is how a player gets there:
        # pull until the speed is gone, keep pulling. A Corsair that can loop
        # can hold this indefinitely and must never end up on its back.
        held = self.results["heldPull"]
        self.assertEqual(0.0, held["backwardSeconds"])
        self.assertGreater(held["worstAlong"], 0.0)
        # And the nose never leaves the flight path far enough to stall a
        # surface: `calculateLift` gives out at 45 degrees.
        self.assertLess(held["worstAlpha"], 20.0)

    # --- the landing gear (LandingGear::handleUpdate, lnxded 0x08241470) ---

    def test_the_gear_follows_height_and_the_engines_revs(self) -> None:
        # Down under `setGearDownHeight` 25 m with the revs at or under
        # `setGearDownEngineInput` 0.4; up over `setGearUpHeight` 23 m with
        # them at or over `setGearUpEngineInput` 0.7 (template +0x1b0 / +0x1b8
        # / +0x1b4 / +0x1bc, named by `makeScript` 0x08241ba0). Height alone,
        # the old 25 / 23 m law, raised a parked Corsair's gear on a carrier
        # deck and dropped it on a low pass.
        g = self.results["gear"]
        self.assertEqual(0, g["strip"])
        # Parked at idle 20 m over the sea (a carrier's deck is no terrain to
        # the gear): down, every tick.
        self.assertEqual([0], g["deck"])
        # The take-off: up as the gear passes 23 m, revs well over 0.7.
        self.assertIsNotNone(g["upAt"])
        self.assertGreater(g["upAt"], 21.5)
        self.assertLess(g["upAt"], 25.0)
        self.assertGreater(g["upRevs"], 0.7)
        # Throttle shut at 200 m: up until it comes under 25 m.
        self.assertEqual(1, g["upHigh"])
        self.assertIsNotNone(g["downAt"])
        self.assertLess(g["downAt"], 26.0)
        self.assertGreater(g["downAt"], 23.0)
        # At full power it stays up below both heights.
        self.assertLess(g["dive"]["lowest"], 23.0)
        self.assertTrue(g["dive"]["stayedUp"])
        # A replay's recorded revs drive it the same way.
        self.assertEqual([1, 0], g["replay"])

    # --- frame rate --------------------------------------------------------

    def test_the_model_runs_whole_engine_ticks_whatever_the_frame(self) -> None:
        # The world steps the drive at its 30 Hz tick, and `integrate` turns
        # any longer `dt` into whole engine ticks (the gearbox, one
        # integration step, the gear), so 1/15 s and 0.1 s are two and three
        # 1/30 s calls, to the float.
        cases = self.results["frameRate"]
        reference = cases[0]
        for case in cases[1:]:
            label = f"dt={case['dt']}"
            self.assertAlmostEqual(reference["trimSpeed"], case["trimSpeed"], places=2, msg=label)
            self.assertAlmostEqual(reference["trimSink"], case["trimSink"], places=2, msg=label)
            self.assertAlmostEqual(reference["trimAlpha"], case["trimAlpha"], places=2, msg=label)
        for case in cases:
            self.assertLess(case["turnedAt"], 5.0, f"dt={case['dt']}")
            self.assertGreater(case["tailFirstEnd"]["along"], 0.0, f"dt={case['dt']}")

    # --- the seam the presentation layer reads -----------------------------

    # --- one interior per node, however many Vehicles drive it -------------

    def test_retaking_a_seat_neither_fetches_nor_grafts_a_second_interior(self) -> None:
        # The enter/exit GPU leak: map.html builds a `Vehicle` per entry, and
        # each one fetched the cockpit glb and grafted another copy beside the
        # last, whose swap had died with its `Vehicle` — hidden for good, its
        # 6 geometries and 4 textures live for good.
        graft = self.results["cockpitGraft"]
        self.assertTrue(graft["firstGrafted"])
        self.assertTrue(graft["secondGrafted"])
        self.assertEqual(1, graft["loadsForOneNode"])
        self.assertEqual(1, graft["interiors"])
        self.assertEqual(1, graft["wheels"])
        # ...and the second `Vehicle` really owns the swap it inherited.
        self.assertEqual({"interior": True, "exterior": False}, graft["inside"])
        self.assertEqual({"interior": False, "exterior": True}, graft["outside"])

    def test_an_inherited_interior_keeps_the_rest_pose_the_glb_gave_it(self) -> None:
        # The price of keeping the interior: the last driver got out with the
        # wheel hard over, and the next `Vehicle` indexes it where it stands.
        # Rest has to come from the swap, or every entry compounds the last.
        graft = self.results["cockpitGraft"]
        self.assertEqual(1, graft["partsSecond"])
        self.assertAlmostEqual(90.0, graft["leftAt"], places=1)
        self.assertAlmostEqual(0.0, graft["restAt"], places=1)

    def test_a_seat_retaken_mid_fetch_waits_on_the_fetch_already_in_the_air(self) -> None:
        graft = self.results["cockpitGraft"]
        self.assertEqual([True, True], graft["raced"])
        self.assertEqual(1, graft["racedLoads"])
        self.assertEqual(1, graft["racedInteriors"])

    def test_a_failed_cockpit_fetch_is_not_remembered(self) -> None:
        graft = self.results["cockpitGraft"]
        self.assertIsNone(graft["failed"])
        self.assertTrue(graft["retried"])
        self.assertEqual(2, graft["flakyLoads"])
        self.assertEqual(1, graft["flakyInteriors"])

    def test_what_the_graft_leaves_behind_is_given_back(self) -> None:
        # Only the flown seat's swaps are taken; the page's warm-up has already
        # uploaded the rest of the file's textures. The grafted interior's own
        # are never in this list, on any of the four loads above.
        self.assertEqual(
            ["1P_Willy_Gun.geometry", "1P_Willy_Gun.map"],
            self.results["cockpitGraft"]["disposed"])

    def test_the_camera_still_reads_nothing_but_vehicle_state(self) -> None:
        camera = self.results["camera"]
        self.assertGreater(camera["cockpitY"], 0.0)
        # The chase rig is 17 m back and 4.2 up, so a little over 17 away.
        self.assertGreater(camera["chaseBehind"], 15.0)
        self.assertLess(camera["chaseBehind"], 20.0)

    def test_the_engine_law_gives_back_the_real_games_revs(self) -> None:
        # Thirty seconds each of a recorded bot Spitfire and F-16 in flight
        # (`fixtures/engine_revs_recorded.json`, from the lab's server
        # recordings): their Engine's own roll axis and gearbox, fed the
        # recorded throttle input, speed and height, return the recorded
        # `PhysicsEngine+0xa0` to a few thousandths a tick. Over every flight
        # recorded (Spitfire, Corsair, F-16, MiG-29, AC-130; 94,000 engine
        # ticks) the median is 0.003-0.007 above 20 m/s. The pedal the
        # fixed-wing model fed the thrust law instead is off by 0.07 to 0.26.
        revs = self.results["recordedRevs"]
        self.assertIsNotNone(revs, "fixtures/engine_revs_recorded.json is missing")
        for name, r in revs.items():
            self.assertGreater(r["ticks"], 800, name)
            self.assertLess(r["median"], 0.01, name)
            self.assertLess(r["p90"], 0.03, name)
            self.assertGreater(r["pedalMedian"], 5 * r["median"], name)

    def test_the_box_is_the_engines_by_its_selector_class(self) -> None:
        # `findLodGeometry` (COL-14) takes the first LodObject depth first
        # whose selector is a `DistCompareSelector`. On a tree the exporter has
        # stamped with each LodObject's `selectorKind`, DC's AH-6 gets its
        # cockpit's exterior (H6_Fus_M1, 2.41 x 3.86 x 8.48 m), not the
        # control stick whose `DistanceSelector` LOD the walk meets first
        # (0.09 x 0.71 x 0.29 m, which an older tree still gives).
        search = self.results["boxSearch"]
        self.assertEqual("H6CockpitExternal", search["stamped"])
        self.assertEqual("H6ControlStick_High", search["unstamped"])

    # --- helicopters: engines off the nose (ledger PHY-12..PHY-14) ----------

    def test_a_fixed_wing_airframe_flies_the_engine_laws(self) -> None:
        # The Spitfire's engine points at its nose, so it is no vectored
        # airframe (it does not hover, its bots fly the plane law), but it
        # flies the engine's own laws like every aircraft: its Engine's roll
        # axis is the throttle (`setAutomaticReset 1`, -3000..5000 at 1000
        # deg/s), its thrust runs through that Engine's gearbox, and it turns
        # on the `/3` geometry inertia read x/y/z (COL-8, COL-13).
        s = self.results["spitfire"]
        self.assertFalse(s["vectored"])
        self.assertTrue(s["engineLaw"])
        self.assertEqual(1, s["lawEngines"])
        self.assertFalse(s["specVectored"])
        self.assertEqual("geometry", s["specInertiaLaw"])
        self.assertEqual("xyz", s["specPairing"])
        self.assertEqual({"min": -3000, "max": 5000, "acceleration": 1000, "automaticReset": True},
                         s["throttleAxis"])
        self.assertAlmostEqual(0.0, s["engineOffNose"], places=2)

    def test_an_ah64_is_read_as_a_vectored_airframe(self) -> None:
        spec = self.results["helicopter"]["spec"]
        self.assertTrue(spec["vectored"])
        # Nothing was ever calibrated on a helicopter: it takes the engine's
        # own /3 geometry inertia (collision-response.md 4.2).
        self.assertEqual("geometry", spec["inertiaLaw"])
        self.assertEqual(5, spec["engines"])
        self.assertAlmostEqual(1.819, spec["groundClearance"], places=3)
        for name in ("AH64HoverEngine1", "AH64HoverEngine2", "AH64HoverEngine3", "AH64DummyEngine"):
            self.assertAlmostEqual(90.0, spec["offNose"][name], places=1)
        self.assertAlmostEqual(0.0, spec["offNose"]["AH64DummyRearEngine"], places=1)
        self.assertEqual([{"id": "AH64EngineRack3", "axes": ["pitch", "roll"], "roll": "c_PIRoll"}], spec["chain"])
        self.assertEqual({"input": "c_PIThrottle", "min": 1500, "max": 5000, "automaticReset": True,
                          "acceleration": 15000}, spec["throttle"])
        self.assertEqual(5000, spec["maxRotationZ"])

    def test_a_hover_engine_pushes_along_its_own_axis_through_its_rack(self) -> None:
        # `fwd` is row 2 of the engine's own absolute transform (0x0824cbb0 via
        # vtable +0x20): straight up at rest, and tilted 20 degrees by a rack
        # at full deflection. Stick forward tips it forward (-Z), stick right
        # to starboard (+X), and the pedals tip the front and rear racks
        # opposite ways: a yaw couple.
        axis = self.results["helicopter"]["axis"]
        self.assertEqual([0, 1, 0], axis["rest"]["dir"])
        self.assertEqual([0, 2, 0], axis["rest"]["arm"])
        self.assertEqual([0, 0.94, -0.342], axis["pitch"]["dir"])
        self.assertEqual([0.342, 0.94, 0], axis["roll"]["dir"])
        self.assertEqual([0.342, 0.94, 0], axis["yawFront"])
        self.assertEqual([-0.342, 0.94, 0], axis["yawRear"])

    def test_a_rack_left_deflected_is_not_read_as_its_rest(self) -> None:
        # The page leaves a rack posed where the last pilot's stick had it;
        # the next Aircraft on the hull reads the rest pose it first saw.
        reentry = self.results["helicopter"]["reentry"]
        self.assertEqual([0, 1, 0], reentry["first"])
        self.assertEqual([0, 1, 0], reentry["second"])
        self.assertAlmostEqual(90.0, reentry["offNose"], places=2)

    def test_the_collective_has_an_idle_floor(self) -> None:
        # `setMinRotation .../1500` over `setMaxRotation .../5000`: the clipped
        # throttle angle never goes below 1500, so T1 is 0.3 with the
        # collective down and still 0.3 with it reversed. It ramps at the
        # engine's own 15000 deg/s: six 30 Hz ticks from the floor is 0.9.
        idle = self.results["helicopter"]["idle"]
        self.assertAlmostEqual(0.3, idle["t1"], places=4)
        self.assertAlmostEqual(0.3, idle["t1Reversed"], places=4)
        self.assertAlmostEqual(0.9, idle["t1After6Ticks"], places=4)
        self.assertAlmostEqual(1.0, idle["t1Full"], places=4)
        # The floor keeps the revs up, and on its own does not lift it.
        self.assertGreater(idle["revs"], 0.25)
        self.assertTrue(idle["grounded"])
        self.assertAlmostEqual(1.819, idle["y"], places=3)

    def test_the_gearbox_settles_on_its_own_fixed_point(self) -> None:
        # revs = 2*(T1 - L) with L the load feedbackLoop accumulated, as the
        # harness re-derives it from engine-revs.js, idle and at full power.
        gearbox = self.results["helicopter"]["gearbox"]
        self.assertAlmostEqual(gearbox["idleExpected"], gearbox["idle"], places=3)
        self.assertAlmostEqual(gearbox["fullExpected"], gearbox["full"], delta=0.01)
        # Full collective does not reach the 1.2 clamp: the load holds it down.
        self.assertLess(gearbox["full"], 0.8)

    def test_full_collective_climbs_and_letting_go_comes_back_down(self) -> None:
        climb = self.results["helicopter"]["climb"]
        self.assertGreater(climb["y"], 50.0)
        self.assertGreater(climb["vy"], 15.0)
        self.assertLess(climb["releasedVy"], -10.0)
        self.assertAlmostEqual(0.3, climb["releasedT1"], places=4)
        self.assertLess(abs(climb["releasedRevs"] - self.results["helicopter"]["gearbox"]["idle"]), 0.02)
        self.assertTrue(climb["landed"])
        self.assertAlmostEqual(1.819, climb["landedY"], places=3)

    def test_it_hovers_between_the_floor_and_full_collective(self) -> None:
        hover = self.results["helicopter"]["hover"]
        self.assertGreater(hover["collective"], 0.5)
        self.assertLess(hover["collective"], 0.8)
        self.assertLess(abs(hover["vy"]), 0.1)
        self.assertLess(abs(hover["nose"]), 2.0)
        self.assertLess(abs(hover["bank"]), 2.0)

    def test_cyclic_forward_noses_it_down_and_flies_it_forward(self) -> None:
        cyclic = self.results["helicopter"]["cyclic"]
        self.assertLess(cyclic["pitchRate"], 0.0)
        self.assertLess(cyclic["nose"], -5.0)
        self.assertGreater(cyclic["forward"], 2.0)

    def test_the_stick_and_pedals_turn_it_the_way_they_turn_a_plane(self) -> None:
        # One input convention for both, because both read the same data: a
        # positive c_PIRoll / c_PIYaw / c_PIPitch turns an AH-64 about the same
        # body axis, the same way, as it turns a Corsair.
        signs = self.results["helicopter"]["signs"]
        for axis in ("roll", "yaw", "pitch"):
            heli, plane = signs[axis]
            self.assertNotEqual(0.0, heli, axis)
            self.assertEqual(heli > 0, plane > 0, axis)

    def test_a_stopped_engine_or_a_drowned_one_makes_nothing(self) -> None:
        h = self.results["helicopter"]
        self.assertEqual(0, h["engineOff"]["revs"])
        self.assertLess(h["engineOff"]["vy"], -10.0)
        self.assertEqual(0, h["underWater"]["revs"])
        self.assertLess(h["underWater"]["vy"], -10.0)
        self.assertTrue(h["reset"])

    def test_a_parked_helicopter_stays_where_it_stands(self) -> None:
        # Pilot aboard, collective released, 6 degrees nose-up and 3 over: the
        # idle floor's thrust leans off the vertical and the wheels' contact
        # friction (`addFriction`'s plain-contact arm, which a bare
        # `c_PGFDummyGrip` takes; physics.md 6) holds it. Before, nothing did.
        parked = self.results["helicopter"]["parked"]
        # A held contact still yields `a*dt^2` a tick: the engine integrates
        # the tick's push into the position before the contact's friction,
        # which reaches the velocity a tick late (collision-response.md §2,
        # §4.2), so the idle thrust leaning off the vertical creeps it a
        # couple of centimetres a second (0.27 m in 20 s; at the old 240 Hz
        # sub-steps an eighth of that).
        self.assertLess(parked["running"]["moved"], 0.5)
        self.assertLess(parked["running"]["speed"], 0.02)
        self.assertGreater(parked["running"]["revs"], 0.25)
        self.assertTrue(parked["running"]["grounded"])
        # Pilot's seat empty: the engine is stopped (TemplateMessage 5, PHY-14).
        self.assertEqual(0, parked["stopped"]["revs"])
        self.assertLess(parked["stopped"]["moved"], 0.1)

    def test_the_wheels_brake_a_landing_and_let_a_lift_off_go(self) -> None:
        h = self.results["helicopter"]
        # 10 m/s against mu * 1.5 * 9.82 = 14.73 m/s^2: 2.6 m/s left at 0.5 s,
        # stopped by 1 s.
        self.assertAlmostEqual(10 - 14.73 * 0.5, h["slide"]["half"], delta=0.3)
        self.assertLess(h["slide"]["speed"], 0.01)
        self.assertGreater(h["liftOff"]["agl"], 20.0)
        self.assertFalse(h["liftOff"]["grounded"])
        # The fixed-wing ground roll is not this law's: a Corsair rolls on.
        self.assertGreater(h["fixedWingRolls"], 8.5)

    def test_the_collective_is_held_and_falls_back_to_its_floor(self) -> None:
        # W is a held axis (`ControlMap::buttonsToAxis` 0x083f2080), and the
        # hover engine's own automaticReset roll axis returns to 1500/5000
        # when it is let go.
        held = self.results["helicopter"]["collectiveHeld"]
        self.assertAlmostEqual(1.0, held["up"], places=4)
        self.assertAlmostEqual(0.3, held["released"], places=4)

    def test_the_note_and_the_rotor_read_the_engines_revs(self) -> None:
        # `Engine::updateSound` 0x0823e930 hands the patch |revs| of the Engine
        # it is loaded on; the rotor turns on the rotor engine's revs.
        rpm = self.results["helicopter"]["rpm"]
        self.assertAlmostEqual(rpm["dummyRevs"], rpm["dummy"], places=4)
        self.assertAlmostEqual(rpm["hoverRevs"], rpm["hover"], places=4)
        self.assertEqual("AH64DummyEngine", rpm["rotor"])
        self.assertAlmostEqual(rpm["dummyRevs"], rpm["throttle"], places=4)
        # A fixed wing's note reads its own engine's revs too, unclamped (the
        # patch's control 0 is `|revs|`, up to the gearbox's 1.2).
        self.assertAlmostEqual(rpm["fixedWingRevs"], rpm["fixedWing"], places=6)

    def test_a_helicopter_hovers_on_its_collective_and_says_how_it_steers(self) -> None:
        h = self.results["helicopter"]
        self.assertTrue(h["hovers"])
        for axis in ("pitch", "roll", "yaw"):
            self.assertGreater(h["authority"][axis], 0.05, axis)

    def test_the_bot_law_flies_a_helicopter_to_its_point_and_lands_it(self) -> None:
        pilot = self.results["helicopter"]["pilot"]
        self.assertIsNotNone(pilot["arrived"])
        self.assertLess(pilot["arrived"], 60)
        self.assertIsNotNone(pilot["landed"])
        self.assertLess(pilot["maxTilt"], 35)
        # It clears the hill on the way and holds over the point.
        self.assertGreater(pilot["minAgl"], 15)
        self.assertLess(pilot["hoverDrift"], 5)
        self.assertTrue(pilot["final"]["grounded"])
        self.assertLess(pilot["final"]["off"], 5)
        self.assertLess(pilot["final"]["speed"], 0.1)

    def test_calculate_and_clip_angle_runs_both_of_its_laws(self) -> None:
        c = self.results["clipAngle"]
        # automaticReset: straight to input*max at |acceleration| deg/s, clipped.
        self.assertEqual(1500, c["floor"])
        self.assertEqual(3000, c["up"])
        self.assertEqual(1500, c["reversed"])
        # The servo law: the Flettner's collective stays where it was left.
        self.assertEqual(40, c["latchFloor"])
        self.assertGreater(c["latchRaised"], 55)
        self.assertGreater(c["latchHeld"], c["latchRaised"])
        self.assertLess(c["latchHeld"], 80)
        self.assertEqual(40, c["latchLowered"])
        # A negative maxSpeed cancels a negative acceleration in the servo law
        # and does not in the automaticReset one.
        self.assertGreater(c["servoSigned"], 0)
        self.assertEqual(-20, c["resetSigned"])
        self.assertEqual(-170, c["wrapped"])
        self.assertEqual(7, c["frozen"])

    def test_a_surface_servo_stops_at_full_deflection(self) -> None:
        # A mouse rate of 3.46 on the stick (MLK-7), held for 3 s: every
        # aileron and elevator servo ends at its bound, +-1, not at 3.46.
        over = self.results["surfaceClip"]
        self.assertTrue(over)
        for key, value in over.items():
            self.assertEqual(1.0, abs(value), key)

    def test_a_flick_past_full_deflection_is_spent_over_the_ticks_after(self) -> None:
        # `rememberExcessInput` on the Corsair's elevators (MLK-16, GUN-2):
        # a mouse rate of 3.46 for one tick is three full ticks and 0.46.
        e = self.results["excessInput"]
        self.assertEqual(["Corsair/c_PIPitch/pitch"], e["remembering"])
        self.assertEqual([-1, -1, -1, -0.46, 0, 0], e["flickSpent"])
        # The servo goes on moving toward full deflection while the backlog
        # lasts (3 a second over the 20 degree half-range, 0.1 a tick).
        self.assertEqual([-0.1, -0.2, -0.3, -0.4, -0.3, -0.2], e["flickSurface"])
        # Without the flag the excess is clipped and gone.
        self.assertEqual([None] * 6, e["plainSpent"])
        self.assertEqual([-0.1, 0.0, 0.0, 0.0, 0.0, 0.0], e["plainSurface"])

    def test_an_input_against_the_backlog_is_taken_whole(self) -> None:
        e = self.results["excessInput"]
        self.assertEqual([-1, 0.5, 0, 0], e["flipSpent"])
        self.assertEqual(0, e["flipBacklog"])

    def test_the_backlog_is_held_to_forty(self) -> None:
        # Three seconds of a 3.47 hand: the backlog stops at -40 a tick before
        # its spend, so 39 ticks of full deflection follow the release.
        e = self.results["excessInput"]
        self.assertEqual(39, e["heldFullAfterRelease"])
        self.assertEqual([0, 0, 0], e["heldThen"])

    def test_an_input_inside_full_deflection_passes_unchanged(self) -> None:
        e = self.results["excessInput"]
        self.assertEqual([-0.6] * 5, e["gentleSpent"])
        self.assertEqual(0, e["gentleBacklog"])
        # The ailerons declare nothing: clipped, nothing carried.
        self.assertEqual([0.133333, 0.0, 0.0, 0.0], e["aileronFlick"])

    def test_a_reset_carries_nothing_over(self) -> None:
        self.assertEqual([-1, 0, 0], self.results["excessInput"]["resetSpent"])

    def test_the_backlog_is_spent_once_a_tick_whatever_the_frame_rate(self) -> None:
        # Two 1/60 s frames a tick, the hand on the first tick only.
        self.assertEqual([-1, -1, -1, -1, -1, -1, -0.46, -0.46],
                         self.results["excessInput"]["halfSteps"])

    def test_a_negative_max_speed_turns_a_servo_part_the_other_way(self) -> None:
        # DC's CIWS barrel (`setMaxSpeed 0/0/-10000` over `setAcceleration
        # 0/0/-10000`, no `setAutomaticReset`): `calculateAndClipAngle`'s
        # servo multiplies by `maxSpeed` signed (lnxded 0x081d7866), so the
        # trigger turns it positive. `advanceSurfaces` used its magnitude only
        # and turned it negative, which is what `automaticReset` would do.
        r = self.results["signedServo"]
        self.assertGreater(r["servo"], 0.0)
        self.assertLess(r["reset"], 0.0)
        self.assertAlmostEqual(r["servo"], -r["reset"], places=2)

    def test_a_ships_ramp_servo_carries_a_keys_step(self) -> None:
        # Lcvp_Ramp: 45 deg/s over 90 degrees is half its travel a second;
        # the step holds it at its bound and the release brings it back at
        # the same rate.
        self.assertEqual([0.5, 1.0, 1.0, 0.5], self.results["rampServo"])

    def test_the_extracted_desert_combat_helicopters_fly(self) -> None:
        real = self.results.get("realGlbs")
        if real is None:
            self.skipTest("no extracted Desert Combat models on this machine")
        for name, heli in real["helicopters"].items():
            self.assertTrue(heli["vectored"], name)
            self.assertAlmostEqual(0.0, heli["idleY"], places=3, msg=name)
            self.assertGreater(heli["climbed"], 30.0, name)
            self.assertLessEqual(heli["releasedVy"], 0.0, name)
        for name, plane in real["planes"].items():
            self.assertFalse(plane["vectored"], name)
            # Every aircraft turns on the engine's rotation: the `/3`
            # geometry inertia read x/y/z (COL-8, COL-13).
            self.assertEqual("geometry", plane["inertiaLaw"], name)
            self.assertEqual("xyz", plane["inertiaPairing"], name)
            self.assertFalse(plane["hovers"], name)
        for name, heli in real["helicopters"].items():
            self.assertTrue(heli["hovers"], name)
            self.assertEqual("xyz", heli["inertiaPairing"], name)
        if "harrier" in real:
            self.assertTrue(real["harrier"]["vectored"])
            self.assertFalse(real["harrier"]["hovers"])
        for name, parked in real["parked"].items():
            # Walking off was 2.6 m/s; the bound leaves room for the origin's
            # swing as a hull staged nose-high rocks onto its gear (the
            # harness's note on the UH-60) and for the creep a held contact
            # keeps at the engine's one step a tick (0.14-0.34 m in 20 s).
            self.assertLess(parked["moved"], 0.5, name)
            self.assertEqual(["c_PGFDummyGrip"], parked["grips"], name)
        for name, pilot in real["pilot"].items():
            self.assertIsNotNone(pilot["arrived"], name)
            self.assertIsNotNone(pilot["landed"], name)
            self.assertLess(pilot["maxTilt"], 40, name)
            self.assertLess(pilot["off"], 10, name)
            self.assertTrue(pilot["grounded"], name)

    def test_a_parked_rollgrip_airframe_neither_slides_nor_turns(self) -> None:
        # The Harrier and DC Final's UH-60, Mi-24 and Mi-8, seat taken. Their
        # `c_PGFRollGripWhenOccupied` wheels are RollGrip while occupied, which
        # asks back only the velocity along the axle (PHY-2); reading that
        # velocity after overwriting it pushed every such wheel along -axle,
        # and they slid tens of metres and spun on the spot.
        real = self.results.get("realGlbs")
        if real is None or not real.get("rollGripParked"):
            self.skipTest("no extracted Desert Combat models on this machine")
        for name, parked in real["rollGripParked"].items():
            self.assertTrue(parked["occupied"], name)
            self.assertIn("c_PGFRollGripWhenOccupied", parked["grips"], name)
            self.assertLess(parked["moved"], 0.05, name)
            self.assertLess(parked["turned"], 0.5, name)

    def test_the_owners_harrier_lifts_transitions_and_pulls_up_level(self) -> None:
        # S 3 s, W 4 s, ArrowDown 1 s, W 2 s, through the page's air-seat
        # tick. The report was "responds almost in the opposite direction to
        # the input; keying down makes it rotate sideways like a chopper".
        real = self.results.get("realGlbs")
        if real is None or "harrierOwner" not in real:
            self.skipTest("no extracted Desert Combat AV-8B on this machine")
        h = real["harrierOwner"]
        self.assertGreater(h["liftedY"], 20.0)
        self.assertLess(h["maxBank"], 2.0)
        self.assertLess(abs(h["heading"]), 2.0)
        # The pull is answered nose up, and the climb comes with it.
        self.assertGreater(h["pitchAtRelease"], h["pitchBeforePull"])
        self.assertGreater(h["pitchAfter"], h["pitchBeforePull"] + 3.0)
        self.assertGreater(h["climbedAfter"], 10.0)

    def test_a_bot_flies_the_harrier_on_the_plane_law(self) -> None:
        # DC's AV-8 AI is a jet's ControlInfo3d, and its positive throttle is
        # the forward engine, so it is no hover airframe: the plane law takes
        # it off the strip on the forward engine and out to its point.
        real = self.results.get("realGlbs")
        if real is None or "harrierBot" not in real:
            self.skipTest("no extracted Desert Combat AV-8B on this machine")
        bot = real["harrierBot"]
        self.assertFalse(bot["hovers"])
        self.assertIsNotNone(bot["liftedAt"])
        self.assertLess(bot["liftedAt"], 15.0)
        self.assertIsNotNone(bot["arrived"])
        self.assertGreater(bot["minY"], 20.0)
        self.assertLess(bot["maxBank"], 30.0)
        self.assertLess(bot["swerve"], 2.0)

    def test_a_critically_damaged_helicopter_loses_its_engines(self) -> None:
        # Armor::status's 0x14 stops every Engine and latches it; full
        # collective cannot bring it back until 0x13 (PHY-14, HP-13).
        real = self.results.get("realGlbs")
        if real is None or "criticalStops" not in real:
            self.skipTest("no extracted Desert Combat models on this machine")
        c = real["criticalStops"]
        self.assertTrue(c["climb"]["running"])
        self.assertGreater(c["climb"]["revs"], 0.25)
        self.assertFalse(c["critical"]["running"])
        self.assertEqual(0, c["critical"]["revs"])
        self.assertLess(c["critical"]["vy"], -10.0)
        # The latch: boarding again while critical (message 4) does not
        # restart it.
        self.assertTrue(c["wasCritical"])
        self.assertFalse(c["reboarded"])
        self.assertTrue(c["recovered"]["running"])
        self.assertGreater(c["recovered"]["revs"], 0.3)
        self.assertGreater(c["recovered"]["vy"], c["critical"]["vy"])

    def test_pedal_alone_turns_a_helicopter_and_nothing_else(self) -> None:
        # Two seconds of D in a hover, measured against the same hover flown
        # without it. No gyroscopic term (COL-8): the yaw stays a yaw.
        real = self.results.get("realGlbs")
        if real is None or not real.get("yawOnly"):
            self.skipTest("no extracted Desert Combat models on this machine")
        for name, yaw in real["yawOnly"].items():
            self.assertGreater(yaw["yawRate"], 5.0, name)
            self.assertLess(yaw["lean"], 1.0, name)
            self.assertLess(yaw["pitchRate"], 1.0, name)
            self.assertLess(yaw["rollRate"], 1.0, name)

    def test_a_free_spin_keeps_its_world_axis_rate(self) -> None:
        # No torque, a skew rate: the engine's omega lives in world axes and
        # takes no gyroscopic term (COL-8, collision-response.md §4.2), so it
        # stays put while the body turns about it.
        real = self.results.get("realGlbs")
        if real is None or "torqueFree" not in real:
            self.skipTest("no extracted Desert Combat models on this machine")
        spin = real["torqueFree"]
        self.assertGreater(spin["turned"], 30.0)
        self.assertLess(spin["drift"], 1e-9)


if __name__ == "__main__":
    unittest.main()
