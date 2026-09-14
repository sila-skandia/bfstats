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
fly the model without a browser. The cases here are the ones that would have
caught it: sink onset, no stable backward flight, and the nose converging on
the flight path after a hard pull.

The numbers are either solved (level cruise, terminal velocity, the climb
steady state — all in flight-model.md section 9) or they are behavioural
bounds. Where a bound is loose it is loose on purpose: this is a shim over the
per-surface model in section 8, and the tests should survive it being replaced
by the real thing.
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
            capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class FlightModelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the constants and what they solve to ------------------------------

    def test_gravity_is_the_engines(self) -> None:
        # BasicPhysicsSystem ctor, 0x00578f00. Same value physics.js carries.
        self.assertAlmostEqual(14.7295, self.results["constants"]["gravity"], places=4)

    def test_cruise_is_thrust_fade_against_drag(self) -> None:
        # 15 x (1 - v/70) = 0.0652 v. No gravity appears in it, which is why
        # the gravity correction left level top speed untouched.
        self.assertAlmostEqual(53.67, self.results["solved"]["cruise"], places=2)

    def test_the_lift_calibration_still_closes_on_gravity_at_cruise(self) -> None:
        # The whole of flight-model.md section 9a: the regulator pair at 9.82
        # plus the passive incidence term must come to exactly g at the speed
        # thrust and drag settle at. If `liftSlope` or `incidence` moves without
        # the other, this is what notices.
        self.assertAlmostEqual(14.7295, self.results["solved"]["liftAtCruise"], places=2)

    def test_the_restoring_moment_is_calibrated_to_the_aoa_clamp(self) -> None:
        # Section 9d's closure: full elevator at cruise trims the angle of
        # attack to exactly where per-surface lift saturates, which is the
        # angle section 9a sized `aoaClamp` for.
        self.assertAlmostEqual(self.results["constants"]["aoaClamp"],
                               self.results["solved"]["fullStickTrim"], places=2)

    # --- the rig -----------------------------------------------------------

    def test_the_rig_drives_and_the_servo_rate_limits(self) -> None:
        rig = self.results["rig"]
        self.assertEqual(5, rig["parts"])
        self.assertTrue(rig["hasCamera"])
        self.assertEqual("Corsair", rig["found"])
        # Part-way through the travel the surfaces are part-way deflected: a
        # slammed stick is not an instant control moment.
        for value in rig["partial"].values():
            self.assertLess(abs(value), 1.0)
            self.assertGreater(abs(value), 0.0)
        # And a second later they are at the stop.
        for value in rig["surfaces"].values():
            self.assertAlmostEqual(1.0, abs(value), places=6)

    # --- level flight, which the fix must not have cost --------------------

    def test_level_flight_holds_altitude_hands_off(self) -> None:
        # dfe5bb9's headline: 148 m held for 40 s at 53.7 m/s.
        level = self.results["levelFlight"]
        self.assertAlmostEqual(53.67, level["speed"], places=1)
        self.assertLess(abs(level["drift"]), 1.0)
        self.assertLess(level["band"], 1.0)

    def test_level_flight_does_not_drift_over_two_minutes(self) -> None:
        # The trim is a real equilibrium now rather than a kinematic
        # constraint, so it is worth asking whether it stays one.
        long = self.results["levelFlightLong"]
        self.assertGreater(long["low"], 995.0)
        self.assertAlmostEqual(53.67, long["speed"], places=1)

    def test_a_kick_off_trim_decays_instead_of_growing(self) -> None:
        sink = self.results["phugoid"]["sink"]
        self.assertLess(abs(sink[0]), 3.0)
        # Monotone decay, sampled every 20 s for three minutes.
        for earlier, later in zip(sink, sink[1:]):
            self.assertLessEqual(abs(later), abs(earlier) + 1e-6)
        self.assertLess(abs(sink[-1]), 0.1)

    def test_the_fifteen_degree_climb_matches_its_steady_state(self) -> None:
        # Excess thrust along an inclined path. dfe5bb9 measured 40.3 and 10.1.
        climb = self.results["climb"]
        self.assertAlmostEqual(climb["solvedSpeed"], climb["speed"], delta=1.0)
        self.assertAlmostEqual(10.36, climb["vy"], delta=0.6)

    def test_terminal_velocity_is_gravity_over_drag(self) -> None:
        # Held vertical, because an aircraft whose regulator makes 9.82 along
        # body-up cannot stay in a dive hands-off — it pulls out, which the
        # harness records separately.
        dive = self.results["terminalDive"]
        self.assertAlmostEqual(225.9, dive["peak"], delta=3.0)

    def test_a_hands_off_dive_pulls_itself_out(self) -> None:
        recovery = self.results["diveRecovery"]
        self.assertGreater(recovery["nose"], -45.0)
        self.assertLess(recovery["nose"], 0.0)

    def test_level_top_speed_is_still_cruise(self) -> None:
        self.assertAlmostEqual(53.67, self.results["topSpeed"]["speed"], places=1)

    def test_full_stick_roll_is_in_the_surveyed_band(self) -> None:
        # 180-220 deg/s at cruise, and symmetric: the aileron mirroring is
        # authored config (`sign(setAcceleration)`), so a broken sign shows up
        # as one direction rolling and the other not.
        for direction in ("left", "right"):
            rate = self.results["roll"][direction]["rate"]
            self.assertGreater(rate, 180.0)
            self.assertLess(rate, 220.0)
        self.assertAlmostEqual(self.results["roll"]["left"]["rate"],
                               self.results["roll"]["right"]["rate"], places=1)

    def test_it_takes_off_and_stays_off(self) -> None:
        takeoff = self.results["takeoff"]
        self.assertIsNotNone(takeoff["unstuckAt"])
        self.assertLess(takeoff["unstuckAt"], 20.0)
        # Unstick near the rotation speed, not at a crawl and not at cruise.
        self.assertGreater(takeoff["unstuckSpeed"], 30.0)
        self.assertLess(takeoff["unstuckSpeed"], 55.0)
        # And it does not settle back onto the strip once the climb is set.
        self.assertEqual(0, takeoff["groundedAfterUnstick"])
        self.assertGreater(takeoff["end"]["y"], 100.0)

    # --- sink, which is the reported bug -----------------------------------

    def test_the_trimmed_lift_curve_crosses_gravity_exactly_at_cruise(self) -> None:
        curve = {row["speed"]: row for row in self.results["liftCurve"]}
        self.assertAlmostEqual(14.7295, curve[53.67]["trimmed"], places=2)
        # Above cruise there is surplus, below it a deficit, and the deficit
        # is what has to turn into a descent.
        self.assertGreater(curve[60]["trimmed"], 14.7295)
        for speed in (40, 30, 20, 12.4, 10, 5, 2):
            self.assertLess(curve[speed]["trimmed"], 14.7295)

    def test_the_regulator_falls_off_linearly_below_its_saturation_speed(self) -> None:
        # Above 12.4 m/s the servo finds its 4.91 per surface and the pair
        # holds 9.82; below it the +-2 degrees run out and lift goes linear in
        # v, which is why 10 m/s makes less than 12.4 m/s does by more than the
        # incidence term alone accounts for.
        curve = {row["speed"]: row for row in self.results["liftCurve"]}
        drop_below = curve[12.4]["trimmed"] - curve[10]["trimmed"]
        drop_above = curve[30]["trimmed"] - curve[20]["trimmed"]
        self.assertGreater(drop_below / 2.4, drop_above / 10.0)

    def test_hands_off_below_cruise_the_aircraft_descends(self) -> None:
        # The reported bug, as a number. With the flight path welded to the
        # nose this was a 3 m descent in ten seconds from 8 m/s; an aircraft
        # with no lift left falls.
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        for entry in (45, 35, 25, 20, 16.7, 12.4, 8):
            row = sink[(entry, 0)]
            self.assertLess(row["vy"], -2.0, f"{entry} m/s hands off does not sink")
            self.assertGreater(row["drop"], 10.0, f"{entry} m/s hands off barely drops")

    def test_the_slower_it_is_the_harder_it_sinks(self) -> None:
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        for faster, slower in zip((45, 35, 25, 20), (35, 25, 20, 16.7)):
            self.assertLess(sink[(slower, 0)]["vy"], sink[(faster, 0)]["vy"])

    def test_sinking_drops_the_nose_rather_than_flying_level_downward(self) -> None:
        # The nose has to follow the flight path down. A level nose with a
        # descending flight path is the model pretending to fly.
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        for entry in (25, 20, 16.7, 12.4, 8):
            self.assertLess(sink[(entry, 0)]["nose"], -5.0)

    def test_cruise_with_the_throttle_open_still_holds_altitude(self) -> None:
        sink = {(row["entry"], row["throttle"]): row for row in self.results["sink"]}
        self.assertLess(abs(sink[(53.67, 1)]["drop"]), 0.5)

    # --- the nose follows the flight path ----------------------------------

    def test_the_nose_converges_on_the_flight_path(self) -> None:
        for case in self.results["noseTracking"]:
            label = f"{case['axis']} {case['start']} deg at {case['speed']} m/s"
            self.assertIsNotNone(case["halfLife"], f"{label} never closed")
            self.assertLess(case["halfLife"], 1.5, label)
            self.assertLess(abs(case["settled"]), 1.0, label)

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
        self.assertLess(abs(stall["settled"]), 1.0)

    def test_a_hard_pull_ends_in_a_recovery_and_not_an_endless_climb(self) -> None:
        # Four seconds of full back stick from cruise, then hands off. Before
        # the fix this ended with the nose frozen at 89.7 degrees and the
        # aircraft climbing at 1 m/s indefinitely, having gained 270 m in the
        # eighty seconds after the stick was released.
        for name in ("hardPull", "hardPullIdle"):
            pull = self.results[name]
            self.assertIsNotNone(pull["recoveredAt"], f"{name} never recovered")
            self.assertLess(pull["recoveredAt"], 40.0, name)
            self.assertLess(abs(pull["end"]["nose"]), 45.0, name)
            self.assertGreater(pull["end"]["speed"], 30.0, name)

    def test_a_sustained_pull_keeps_the_nose_near_the_flight_path(self) -> None:
        # Full elevator held from cruise. The nose leads the flight path, but
        # by single degrees rather than by the tens of degrees a model with no
        # restoring moment allows.
        for sample in self.results["sustainedPull"]:
            self.assertLess(abs(sample["lead"]), 9.0)
        # And the pull is a real one: the flight path comes round.
        self.assertGreater(self.results["sustainedPull"][0]["pathRate"], 15.0)

    # --- backward flight, which must not have a resting state --------------

    def test_a_tail_first_launch_turns_around(self) -> None:
        # Thirty metres a second straight backwards down the fuselage, hands
        # off. The old model stayed there for the whole thirty seconds, bleeding
        # off only what linear drag took, because the same lerp that welded the
        # flight path to the nose preserved the sign of `v . fwd`.
        tail = self.results["tailFirst"]
        self.assertIsNotNone(tail["turnedAt"], "never turned around")
        self.assertLess(tail["turnedAt"], 5.0)
        self.assertLess(tail["backwardSeconds"], 5.0)
        self.assertGreater(tail["end"]["along"], 0.0)

    def test_a_tail_slide_from_rest_turns_around(self) -> None:
        # Nose vertical, no airspeed at all, dropped. This is the case an
        # `asin` angle of attack reads as zero and therefore cannot restore
        # from; the harness and the model both read it with `atan2`.
        slide = self.results["tailSlide"]
        self.assertIsNotNone(slide["turnedAt"], "never turned around")
        self.assertLess(slide["backwardSeconds"], 8.0)
        self.assertGreater(slide["end"]["along"], 0.0)

    def test_holding_the_stick_back_cannot_produce_backward_flight(self) -> None:
        # A minute of full back stick, which is how a player gets there: pull
        # until the speed is gone, keep pulling.
        held = self.results["heldPull"]
        self.assertEqual(0.0, held["backwardSeconds"])
        self.assertGreater(held["worstAlong"], 0.0)
        # And the nose never leaves the flight path by more than the angle the
        # elevator is calibrated to trim to.
        self.assertLess(held["worstAlpha"], 15.0)

    # --- frame rate --------------------------------------------------------

    def test_the_model_is_stable_at_every_step_the_page_can_hand_it(self) -> None:
        # `map.html` drives this from `THREE.Clock` clamped at 0.1 s. The
        # restoring moment is a rate applied per step, which is the shape of
        # thing that goes unstable on a long frame.
        for case in self.results["frameRate"]:
            self.assertLess(abs(case["levelDrift"]), 1.0, f"dt={case['dt']}")
            self.assertAlmostEqual(53.67, case["levelSpeed"], places=1)
            self.assertLess(case["backwardSeconds"], 5.0, f"dt={case['dt']}")
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
