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
        env = {**os.environ, "BF42_VIEWER_MODELS": str(VIEWER / "models")}
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
        # Three player axes, plus one apiece for the two regulators and the
        # body fin — the five rig parts collapse onto three keys, because a
        # mirrored pair is commanded together and shares an entry.
        self.assertEqual(6, rig["servos"])
        self.assertTrue(rig["hasCamera"])
        self.assertEqual("Corsair", rig["found"])

    def test_a_mirrored_pair_travels_at_its_declared_max_speed(self) -> None:
        # The `advanceSurfaces` defect, as a number. It keyed a deflection on
        # control/input/axis and then stepped it once per *part*, so the two
        # elevators — which share all three — drove the one shared entry twice
        # a frame and it travelled at 120 deg/s against `setMaxSpeed 60`.
        #
        # Elevator: 60 deg/s over a 20 degree half-range is 3 of normalised
        # travel a second, so 1/12 s is 0.25. Reading 0.5 is the defect back.
        rig = self.results["rig"]
        self.assertAlmostEqual(-0.25, rig["elevator"], places=3)
        # The ailerons are a mirrored pair too, but they are keyed together and
        # were always right: 120 deg/s over 30 is 4, so 1/12 s is a third.
        self.assertAlmostEqual(1 / 3, rig["aileron"], places=3)
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

    def test_the_inertia_is_the_box_estimate_times_the_authored_modifier(self) -> None:
        # `inertiaModifier 1.05/0.850/0.94` is yaw/pitch/roll [data]; the
        # solid-box base it multiplies is the last free number in the model.
        inertia = self.results["inertia"]
        self.assertAlmostEqual(20126, inertia["pitch"], delta=2)
        self.assertAlmostEqual(56938, inertia["yaw"], delta=2)
        self.assertAlmostEqual(32481, inertia["roll"], delta=2)
        # A Corsair is nearly three times as stiff in yaw as in pitch, which is
        # why one weathervane gain for both axes was always wrong.
        self.assertGreater(inertia["yaw"], 2.5 * inertia["pitch"])

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

    def test_the_service_ceiling_is_the_air_density_height(self) -> None:
        # Flown, not computed: a best-effort full-throttle climb has to stall
        # out just short of 1000 m, because that is where a Refractor wing
        # stops making lift entirely.
        ceiling = self.results["serviceCeiling"]
        self.assertLess(ceiling["best"], CEILING)
        self.assertGreater(ceiling["best"], 900.0)

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

    def test_the_spitfire_pitch_rate_per_full_stick(self) -> None:
        # Measured, not fitted: a second after a full stick, from a second of
        # hands-off flight at the speed. The Spitfire pitches slower than the
        # Corsair table it used to borrow (its tail is longer, so it damps more).
        s = self.results["spitfire"]
        self.assertGreater(s["pitchUp40"], 20.0)
        self.assertLess(s["pitchUp40"], 40.0)
        self.assertLess(s["pitchDown40"], -20.0)
        self.assertGreater(s["pitchUp60"], 30.0)
        self.assertLess(s["pitchUp60"], 60.0)
        self.assertLess(s["pitchDown60"], -20.0)
        self.assertLess(s["pitchUp40"], s["corsairUp40"])

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

    def test_the_box_drag_law_brackets_the_ai_maxspeed(self) -> None:
        # Under `PhysicsNode`'s box law (physics.md s3) the Spitfire's level
        # top speed brackets its AI `maxSpeed` of 60, as the Corsair's does its
        # 55 under the fitted `-drag v`; under `-drag v` it topped out near 47.
        s = self.results["spitfire"]
        self.assertLess(s["top40"], 62.0)
        self.assertGreater(s["top40"], 54.0)
        self.assertGreater(s["top200"], s["top40"])
        self.assertGreater(s["top200"], 60.0)

    # --- level flight ------------------------------------------------------

    def test_level_top_speed_brackets_the_ai_maxspeed(self) -> None:
        # `aiTemplatePlugIn.maxSpeed` for the Corsair is 55.0 (Ai/Objects.con).
        # Nothing here was tuned to it: top speed is thrust against linear drag
        # and the fade is scaled by an air density that thins with height, so
        # the aircraft is slower at the deck and faster upstairs, and 55.0 is
        # between them.
        speeds = {row["altitude"]: row["speed"] for row in self.results["topSpeed"]}
        self.assertLess(speeds[40], 55.0)
        self.assertGreater(speeds[200], 55.0)
        self.assertAlmostEqual(49.4, speeds[40], delta=2.0)
        self.assertAlmostEqual(57.0, speeds[200], delta=3.0)

    def test_the_hands_off_trim_is_a_real_equilibrium(self) -> None:
        # It converges and then holds: ninety more seconds move the sink rate
        # by less than a centimetre a second. What it converges *to* is a
        # shallow powered descent rather than level flight, because thrust is
        # applied at the propeller hub 0.446 m above the centre of mass and
        # that nose-down moment costs about a quarter degree of trimmed alpha.
        trim = self.results["trim"]
        self.assertLess(trim["settled"], 0.05)
        self.assertLess(trim["vy"], 0.0)
        self.assertGreater(trim["vy"], -12.0)
        # The nose stays on the flight path through all of it.
        self.assertLess(abs(trim["alpha"]), 1.0)
        # And the regulator is servoing rather than parked on a stop.
        self.assertLess(abs(trim["regulator"]), 2.0)

    def test_a_little_back_stick_holds_height(self) -> None:
        # The descent is shallow enough to fly out of with a fraction of the
        # elevator: hands off it sinks, a twentieth of the stick is level, a
        # tenth climbs.
        stick = {row["stick"]: row for row in self.results["levelStick"]}
        self.assertGreater(stick[0]["drop"], 50.0)
        self.assertLess(abs(stick[-0.05]["vy"]), 2.0)
        self.assertGreater(stick[-0.1]["vy"], 2.0)

    def test_terminal_dive_is_capped_by_the_propeller_not_by_drag(self) -> None:
        # g/drag is 226 m/s and the old model reached it. It is not reachable
        # now: past the fade speed the signed square turns the propeller into
        # a brake worth several g, and a held vertical dive settles near 54.
        dive = {row["throttle"]: row for row in self.results["terminalDive"]}
        self.assertLess(dive[0]["peak"], 150.0)
        self.assertLess(dive[0]["end"]["speed"], G / 0.0652 / 2)
        self.assertGreater(dive[0]["end"]["speed"], 30.0)

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
        # And the pull is a real one: the flight path comes round.
        self.assertGreater(self.results["sustainedPull"][0]["pathRate"], 15.0)

    def test_full_stick_roll_is_in_the_surveyed_band(self) -> None:
        # 180-220 deg/s at cruise, and symmetric. Nothing commands this — it is
        # the ailerons' own lift on their own levers against their own damping,
        # and the mirroring is authored config (`sign(setAcceleration)`), so a
        # broken sign shows up as one direction rolling and the other not.
        for direction in ("left", "right"):
            rate = self.results["roll"][direction]
            self.assertGreater(rate, 180.0)
            self.assertLess(rate, 220.0)
        self.assertAlmostEqual(self.results["roll"]["left"],
                               self.results["roll"]["right"], delta=2.0)

    # --- the nose follows the flight path ----------------------------------

    def test_the_nose_converges_on_the_flight_path(self) -> None:
        for case in self.results["noseTracking"]:
            label = f"{case['axis']} {case['start']} deg at {case['speed']} m/s"
            self.assertIsNotNone(case["halfLife"], f"{label} never closed")
            self.assertLess(case["halfLife"], 6.0, label)
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

    def test_a_tail_slide_from_rest_turns_around_and_stays_round(self) -> None:
        # Nose vertical, no airspeed at all, dropped. This is the case an
        # `asin` angle of attack reads as zero and therefore cannot restore
        # from; the harness and the model both read it with `atan2`. A tumble
        # on the way is allowed; ending up in one is not.
        slide = self.results["tailSlide"]
        self.assertIsNotNone(slide["turnedAt"], "never turned around")
        self.assertLess(slide["turnedAt"], 10.0)
        self.assertGreater(slide["settledForward"], 0.95)
        self.assertGreater(slide["end"]["along"], 0.0)

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

    # --- frame rate --------------------------------------------------------

    def test_the_model_is_identical_at_every_step_the_page_can_hand_it(self) -> None:
        # `map.html` drives this from `THREE.Clock` clamped at 0.1 s. The
        # sub-step count scales with the frame and the servos run inside it,
        # which is the only reason the trim is the same number at all three:
        # the lift regulator is a proportional loop closed through a
        # rate-limited servo, and a whole 0.1 s frame lets that servo cross its
        # entire +-2 degree range in one step and go bang-bang.
        cases = self.results["frameRate"]
        reference = cases[0]
        for case in cases[1:]:
            label = f"dt={case['dt']}"
            self.assertAlmostEqual(reference["trimSpeed"], case["trimSpeed"], places=1, msg=label)
            self.assertAlmostEqual(reference["trimSink"], case["trimSink"], places=1, msg=label)
            self.assertAlmostEqual(reference["trimAlpha"], case["trimAlpha"], places=1, msg=label)
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

    # --- helicopters: engines off the nose (ledger PHY-12..PHY-14) ----------

    def test_a_fixed_wing_airframe_stays_on_the_nose_thrust_path(self) -> None:
        # Every engine of a fixed-wing aircraft points at its nose, so the
        # engine law in `vectored-engines.js` never runs for one and the
        # numbers every test above pins cannot move.
        s = self.results["spitfire"]
        self.assertFalse(s["vectored"])
        self.assertEqual(0, s["vectoredEngines"])
        self.assertFalse(s["specVectored"])
        self.assertIsNone(s["specInertiaLaw"])
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
        # engine's own 15000 deg/s: six ticks from the floor is 0.6.
        idle = self.results["helicopter"]["idle"]
        self.assertAlmostEqual(0.3, idle["t1"], places=4)
        self.assertAlmostEqual(0.3, idle["t1Reversed"], places=4)
        self.assertAlmostEqual(0.6, idle["t1After6Ticks"], places=4)
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
        self.assertLess(parked["running"]["moved"], 0.1)
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
        self.assertIsNone(rpm["fixedWing"])

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
            self.assertIsNone(plane["inertiaLaw"], name)
            # The fixed-wing aircraft keep the yaw/pitch/roll reading they
            # are calibrated on (AI-80); the engine's is x/y/z (COL-13).
            self.assertIsNone(plane["inertiaPairing"], name)
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
            # harness's note on the UH-60).
            self.assertLess(parked["moved"], 0.2, name)
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


if __name__ == "__main__":
    unittest.main()
