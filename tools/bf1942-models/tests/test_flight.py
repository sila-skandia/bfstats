"""`viewer/flight.js` under node: a Corsair flown, not a Corsair read.

Same pattern as `test_physics.py` and `test_collision.py` — one node run,
many assertions, because starting the runtime is the slow part. The one thing
those two did not have to solve is that `flight.js` imports three.js, so
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

# `flight.js` copied as `.mjs` next to the harness, plus the two vendored files
# it reaches for at their own relative paths.
MODULES = {
    "flight.mjs": VIEWER / "flight.js",
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
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
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

    def test_the_camera_still_reads_nothing_but_vehicle_state(self) -> None:
        camera = self.results["camera"]
        self.assertGreater(camera["cockpitY"], 0.0)
        # The chase rig is 17 m back and 4.2 up, so a little over 17 away.
        self.assertGreater(camera["chaseBehind"], 15.0)
        self.assertLess(camera["chaseBehind"], 20.0)


if __name__ == "__main__":
    unittest.main()
