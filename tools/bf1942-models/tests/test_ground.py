"""`viewer/ground.js` under node: a Willys driven, not a Willys read.

Same pattern as `test_flight.py` — one node run, many assertions, the vendored
three.js stood up as a package so the viewer's modules import byte-for-byte.
The chassis the harness builds is the Willy glb's node tree transcribed
(positions and `extras.physics` both), so `collectChassis` is exercised on the
same shapes the real extract carries.

What the numbers mean. Almost the whole chassis is shipped data — spring
strength and damping, the steering lock, the gear count and shift points,
engine torque and final drive, the wheel radius off the collision mesh — and
the assertions against solved values (static loads summing to gravity, the
per-axle split from the wheelbase, the rev-limited top speed) are checks that
the model spends that data rather than shadowing it with tuning. The fitted
constants (`gearRatios`, `revLimit`, `mu`, cornering stiffness) get
behavioural bounds instead, loose on purpose: they are the part a recorded
reference drive in the real game would revise, and the tests should survive
that revision.
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
HARNESS = Path(__file__).resolve().parent / "ground_harness.mjs"

# The modules under their own names — `ground.js` imports `./flight.js` and
# `./physics.js`, so unlike `test_flight.py` nothing is renamed to `.mjs`;
# the work directory's `{"type":"module"}` makes plain `.js` importable.
MODULES = {
    "ground.js": VIEWER / "ground.js",
    "flight.js": VIEWER / "flight.js",
    "physics.js": VIEWER / "physics.js",
    "vendor/loaders/GLTFLoader.js": VIEWER / "vendor" / "loaders" / "GLTFLoader.js",
    "vendor/utils/BufferGeometryUtils.js": VIEWER / "vendor" / "utils" / "BufferGeometryUtils.js",
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


class GroundModelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the constants and what they solve to ------------------------------

    def test_gravity_is_the_engines(self) -> None:
        # Imported from physics.js rather than declared again.
        self.assertAlmostEqual(-14.73, self.results["constants"]["gravity"], places=2)

    def test_the_declared_chassis_numbers_are_the_shipped_ones(self) -> None:
        # Physics.con, Objects/Vehicles/Land/Willy: any drift here means the
        # spec table stopped being a transcription.
        constants = self.results["constants"]
        self.assertEqual(2500, constants["mass"])
        self.assertEqual(10.5, constants["torque"])
        self.assertEqual(7, constants["differential"])
        self.assertEqual(5, constants["numberOfGears"])
        self.assertEqual(0.95, constants["gearUp"])
        self.assertEqual(0.4, constants["gearDown"])
        self.assertEqual(25, constants["springStrength"])
        self.assertEqual(5, constants["springDamping"])
        self.assertEqual(30, constants["maxSteer"])

    def test_the_shipped_dampers_are_exactly_critical(self) -> None:
        # The units case for setStrength/setDamping: four wheels give the
        # heave mode 2*sqrt(4*25) = 20 of critical damping and 4*5 = 20 is
        # what the data supplies. If either constant moves, this coincidence
        # — and the argument built on it — is gone.
        self.assertAlmostEqual(1.0, self.results["solved"]["heaveDampingRatio"], places=3)

    def test_the_top_speed_arithmetic(self) -> None:
        # revLimit * wheelRadius / (differential * topGear): the one equation
        # the fitted revLimit exists to close, at 18.5 m/s before resistance.
        self.assertAlmostEqual(18.51, self.results["solved"]["revCapSpeed"], places=1)
        # And the ladder is monotone, so the automatic always has somewhere
        # to go.
        speeds = self.results["solved"]["gearSpeeds"]
        self.assertEqual(speeds, sorted(speeds))

    # --- the chassis reads off the tree ------------------------------------

    def test_the_chassis_is_discovered_not_declared(self) -> None:
        chassis = self.results["chassis"]
        self.assertEqual(4, chassis["wheels"])
        # c_PGFEngineGrip marks the rear axle driven; the fronts steer.
        self.assertEqual(2, chassis["driven"])
        self.assertEqual(2, chassis["steered"])
        self.assertTrue(chassis["hasCamera"])
        # Engine numbers came off the Engine node's extras, not the fallback.
        self.assertEqual(10.5, chassis["engine"]["torque"])
        # Wheel rest positions, root frame: fronts at z=-0.75, rears at 1.46.
        zs = sorted(rest[2] for rest in chassis["rests"])
        self.assertAlmostEqual(-0.75, zs[0], places=2)
        self.assertAlmostEqual(1.46, zs[-1], places=2)

    # --- settling -----------------------------------------------------------

    def test_it_settles_level_on_all_four_wheels(self) -> None:
        settle = self.results["settle"]
        self.assertLess(abs(settle["vy"]), 0.05)
        self.assertLess(abs(settle["speed"]), 0.05)
        # Level within the static rake: the asymmetric wheelbase (0.75 m
        # front, 1.46 m rear of the origin) loads the nose at two thirds of
        # the weight, which is about two degrees of nose-down sit.
        self.assertLess(abs(settle["pitch"]), 4.0)
        self.assertLess(abs(settle["roll"]), 1.0)
        self.assertTrue(settle["grounded"])
        for load in settle["loads"]:
            self.assertGreater(load, 1.0, "a wheel is hanging in the air")

    def test_the_standing_loads_sum_to_gravity(self) -> None:
        # Four springs carrying exactly g between them is the definition of
        # standing still; anything else and the body is still moving.
        self.assertAlmostEqual(14.73, self.results["settle"]["totalLoad"], delta=0.05)

    def test_the_axle_split_follows_the_wheelbase(self) -> None:
        # Front pair b/(a+b) = 1.46/2.21 of the weight: 4.87 per wheel
        # against 2.49 at the rear. This is the lever arithmetic made
        # observable, no constant of the model's own in it.
        loads = self.results["settle"]["loads"]
        front = [load for load in loads if load > 3.5]
        rear = [load for load in loads if load <= 3.5]
        self.assertEqual(2, len(front))
        self.assertEqual(2, len(rear))
        for load in front:
            self.assertAlmostEqual(4.87, load, delta=0.3)
        for load in rear:
            self.assertAlmostEqual(2.49, load, delta=0.3)

    def test_it_does_not_sink_through_the_floor(self) -> None:
        # Dropped from 0.8 m, the belly must never reach the ground plane:
        # the springs catch it above the failsafe.
        self.assertGreater(self.results["settle"]["minY"], 0.1)
        self.assertGreater(self.results["settle"]["y"], 0.25)
        self.assertLess(self.results["settle"]["y"], 0.45)

    def test_a_long_frame_settles_where_a_short_one_does(self) -> None:
        # map.html clamps THREE.Clock at 0.1 s; the internal substepper must
        # make that frame land where sixty of 1/60 do.
        settle = self.results["settle"]
        coarse = self.results["settleCoarse"]
        self.assertAlmostEqual(settle["y"], coarse["y"], delta=0.02)
        self.assertAlmostEqual(settle["pitch"], coarse["pitch"], delta=0.5)
        self.assertTrue(coarse["grounded"])

    # --- full throttle -------------------------------------------------------

    def test_full_throttle_reaches_the_games_top_speed_band(self) -> None:
        # The 60-70 km/h the game's Willys is remembered to do; the model
        # solves to 65.8. A reference drive on a recorded round is the
        # measurement that would tighten this band.
        run = self.results["fullThrottle"]
        self.assertGreater(run["kmh"], 60.0)
        self.assertLess(run["kmh"], 70.0)
        self.assertEqual(5, run["gear"])
        self.assertTrue(run["grounded"])

    def test_the_launch_is_brisk_and_the_approach_asymptotic(self) -> None:
        run = self.results["fullThrottle"]
        # Most of top speed inside five seconds (traction-limited launch,
        # then the gear ladder)...
        self.assertGreater(run["at5s"], 12.0)
        # ...and no further gain from ten seconds on: an equilibrium, not a
        # wall being bounced off.
        self.assertAlmostEqual(run["at10s"], run["at20s"], delta=0.2)

    def test_it_drives_straight_with_the_wheel_centred(self) -> None:
        run = self.results["fullThrottle"]
        self.assertLess(abs(run["heading"] + 1.0), 0.01)  # still nose down -Z
        self.assertLess(run["drift"], 1.0)                # metres off axis, 40 s

    # --- steering ------------------------------------------------------------

    def test_positive_yaw_input_turns_right(self) -> None:
        # The aircraft sign convention, kept: positive c_PIYaw is a negative
        # yaw rate. If this flips, A and D swap in every vehicle at once.
        steering = self.results["steering"]
        self.assertLess(steering["meanYawRate"], 0.0)
        self.assertLess(steering["turnedDeg"], -90.0)

    def test_the_turn_rate_is_a_vehicles_not_a_turrets(self) -> None:
        # Half lock from top speed. The friction circle caps lateral grip at
        # mu*g, which at the entry speed is some tens of degrees a second —
        # not the hundreds an unconstrained steer angle would command.
        rate = abs(self.results["steering"]["meanYawRate"])
        self.assertGreater(rate, 15.0)
        self.assertLess(rate, 100.0)

    def test_it_leans_out_of_the_turn_and_does_not_flip(self) -> None:
        steering = self.results["steering"]
        # Visible body roll on soft springs...
        self.assertGreater(steering["worstRoll"], 2.0)
        # ...but bounded, and the body never leaves upright.
        self.assertLess(steering["worstRoll"], 30.0)
        self.assertGreater(steering["minUp"], 0.8)
        self.assertTrue(steering["end"]["grounded"])

    def test_releasing_the_wheel_straightens_the_path(self) -> None:
        # setAutomaticReset 1 on the steering bundles: hands off means
        # straight ahead, not a held arc.
        straighten = self.results["straighten"]
        self.assertLess(abs(straighten["yawRate"]), 2.0)
        self.assertLess(abs(straighten["roll"]), 2.0)

    # --- the step ------------------------------------------------------------

    def test_driving_off_a_step_is_a_fall_and_then_a_landing(self) -> None:
        drop = self.results["stepDrop"]
        # Genuinely airborne: all four wheels unloaded for a fraction of a
        # second on the way down 2 m.
        self.assertGreater(drop["airborneSeconds"], 0.2)
        self.assertLess(drop["airborneSeconds"], 2.0)
        # The fall is gravity's: from wheel height, sqrt(2h/g) is about half
        # a second to first contact.
        self.assertIsNotNone(drop["fellFor"])
        self.assertLess(drop["fellFor"], 1.0)

    def test_the_landing_does_not_explode(self) -> None:
        drop = self.results["stepDrop"]
        self.assertTrue(drop["finite"])
        # Nothing faster than top speed plus the fall itself.
        self.assertLess(drop["worstSpeed"], 25.0)
        self.assertGreater(drop["worstVy"], -12.0)
        # And afterwards it is simply driving again on the lower ground.
        self.assertTrue(drop["end"]["grounded"])
        self.assertGreater(drop["end"]["along"], 10.0)
        self.assertLess(drop["end"]["y"], 1.0)

    # --- brake and reverse ----------------------------------------------------

    def test_opposed_throttle_brakes_to_a_stop(self) -> None:
        brake = self.results["brake"]
        self.assertGreater(brake["entry"], 17.0)
        self.assertIsNotNone(brake["stoppedAt"])
        # 18 m/s into a stop: mu-limited braking makes it in about two and a
        # half seconds; six is the give for the friction circle sharing.
        self.assertLess(brake["stoppedAt"], 6.0)

    def test_held_past_the_stop_it_backs_up_at_first_gears_pace(self) -> None:
        # The BF1942 behaviour: S brakes, then reverses. Reverse borrows
        # first gear, which rev-caps near 4.9 m/s.
        brake = self.results["brake"]
        self.assertGreater(brake["reverseSpeed"], 3.0)
        self.assertLess(brake["reverseSpeed"], 6.0)

    def test_forward_throttle_out_of_reverse_brakes_first(self) -> None:
        face = self.results["aboutFace"]
        self.assertLess(face["backward"], -3.0)   # it really was reversing
        self.assertGreater(face["forward"], 10.0)  # and now it really is not

    def test_a_closed_throttle_coasts_down_rather_than_cruising(self) -> None:
        coast = self.results["coast"]
        self.assertGreater(coast["entry"], 17.0)
        self.assertLess(coast["after15s"], coast["entry"] * 0.5)
        self.assertGreater(coast["after15s"], 0.0)  # a coast, not a wall

    # --- presentation ---------------------------------------------------------

    def test_the_wheels_roll_and_ride_on_their_springs(self) -> None:
        spin = self.results["wheelSpin"]
        # Five seconds of driving turns every wheel by tens of radians...
        for turned in spin["turned"]:
            self.assertGreater(turned, 20.0)
        # ...and all four the same amount on a straight road.
        self.assertAlmostEqual(min(spin["turned"]), max(spin["turned"]), delta=1.0)
        # Compression lifts each wheel node up its travel toward the body —
        # about the static compression, and never past the declared travel.
        for lift in spin["lift"]:
            self.assertGreater(lift, 0.05)
            self.assertLess(lift, 0.31)

    def test_the_camera_rides_at_the_drivers_eye(self) -> None:
        camera = self.results["camera"]
        self.assertTrue(camera["hasNode"])
        # WillyCamera sits 0.95 above the origin, and the origin settles a
        # third of a metre up: an eye a little over a metre off the road.
        self.assertGreater(camera["y"], 1.0)
        self.assertLess(camera["y"], 1.7)


class TrackedVehicleTests(unittest.TestCase):
    """`TrackedVehicle`: a Sherman and an M3A1 driven, not read.

    Same harness process as `GroundModelTests` above (`run_harness()` builds
    both fixtures in one node run), and the same split in what a failure
    means: the gear-ratio curve and the differential-steering formula are
    verify-r7.md's byte-exact claims (TANK-3/6/7/8, TANK-10) and these
    assertions are exact; everything downstream of them — top speed, turn
    rate, how stiff a track resists sliding — is this file's own [free]
    tuning (`TANK` in `ground.js`), asserted only as a loose, survivable
    band, the same convention `GroundModelTests` already uses for Willy's.
    """

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the corrected gear-ratio curve, in isolation -----------------------

    def test_the_gear_ratio_curve_is_corrected_not_a_smooth_spline(self) -> None:
        # The whole reason this track exists. Sherman and Willy (5 gears)
        # land on an authored control point; the M3A1 (4 gears) does not,
        # and a smooth interpolation between the five *named* points would
        # have said ~5.51 where the real array says 17.5.
        ratios = self.results["tankRatios"]
        self.assertAlmostEqual(4.0, ratios["sherman"], places=4)
        self.assertAlmostEqual(7.0, ratios["willy"], places=4)
        self.assertAlmostEqual(17.5, ratios["m3a1"], places=4)
        self.assertNotAlmostEqual(5.51, ratios["m3a1"], places=1)

    def test_every_other_gear_count_reduces_to_differential_times_3_5(self) -> None:
        # Only numberOfGears of 1 or 5 ever touch the curve's authored shape;
        # sampled here at 3.5*differential = 12.25 across every count a mod
        # could plausibly declare that is neither.
        for ratio in self.results["tankRatios"]["offCurve"]:
            self.assertAlmostEqual(12.25, ratio, places=4)

    def test_differential_rpm_matches_tank_10_byte_exact(self) -> None:
        d = self.results["diffRPM"]
        self.assertAlmostEqual(1.0, d["straightFull"], places=4)
        self.assertAlmostEqual(0.25, d["halfLockOuter"], places=4)
        # 1*(1+1.5*0.5) = 1.75, clamped to the formula's own +-1.
        self.assertAlmostEqual(1.0, d["halfLockInner"], places=4)
        self.assertAlmostEqual(1.0, d["centreline"], places=4)

    def test_tank_17_zero_throttle_is_zero_on_both_sides(self) -> None:
        d = self.results["diffRPM"]
        self.assertAlmostEqual(0.0, d["noThrottleRight"], places=6)
        self.assertAlmostEqual(0.0, d["noThrottleLeft"], places=6)

    # --- the chassis reads off the tree, for two very different tanks ------

    def test_sherman_chassis_is_discovered_not_declared(self) -> None:
        # Objects/Vehicles/Land/Sherman: two driven bogies a side (TANK-14's
        # own "x2 per side"), no steered axle, differential 4 over 5 gears.
        chassis = self.results["shermanChassis"]
        self.assertEqual(12, chassis["wheels"])
        self.assertEqual(4, chassis["driven"])
        self.assertEqual(8, chassis["dummy"])
        self.assertEqual(0, chassis["steered"])
        self.assertEqual(4, chassis["engine"]["differential"])
        self.assertEqual(5, chassis["engine"]["numberOfGears"])
        self.assertAlmostEqual(4.0, chassis["ratio"], places=4)
        # Two wheels a side, none dead on the centreline.
        sides = chassis["drivenSides"]
        self.assertEqual(2, sides.count(-1))
        self.assertEqual(2, sides.count(1))

    def test_m3a1_chassis_is_discovered_not_declared(self) -> None:
        # Objects/Vehicles/Land/m3a1: the same two-bogies-a-side pattern plus
        # a genuinely steered +-40 degree front axle (TANK-15), differential
        # 5 over only 4 gears — the one combination the round's correction
        # actually changes the answer for.
        chassis = self.results["m3a1Chassis"]
        self.assertEqual(16, chassis["wheels"])
        self.assertEqual(4, chassis["driven"])
        self.assertEqual(10, chassis["dummy"])
        self.assertEqual(2, chassis["steered"])
        self.assertEqual(5, chassis["engine"]["differential"])
        self.assertEqual(4, chassis["engine"]["numberOfGears"])
        self.assertAlmostEqual(17.5, chassis["ratio"], places=4)
        for lock in chassis["steerMax"]:
            self.assertAlmostEqual(40.0, lock, places=3)

    # --- settling -------------------------------------------------------------

    def test_both_tanks_settle_grounded_and_level(self) -> None:
        for key in ("shermanSettle", "m3a1Settle"):
            settle = self.results[key]
            self.assertTrue(settle["grounded"], key)
            self.assertLess(abs(settle["speed"]), 0.1, key)
            # A hull this long carries a visible nose-down or nose-up rake
            # once its own weight is on only 4 (Sherman) or 4+2 (M3A1)
            # springs rather than every wheel — loose, since the exact
            # angle is a function of the free suspensionTravel/strength
            # split, not itself a claim.
            self.assertLess(abs(settle["pitch"]), 10.0, key)
            self.assertLess(abs(settle["roll"]), 2.0, key)

    def test_a_shermans_whole_weight_rests_on_its_four_driven_wheels(self) -> None:
        # No front axle to share it with, unlike the M3A1 — every one of the
        # eight dummy rollers is legitimately zero (TANK-14), so the four
        # real springs must carry exactly g between them, the same
        # standing-still identity `GroundModelTests` checks for Willy.
        settle = self.results["shermanSettle"]
        self.assertAlmostEqual(14.73, settle["totalDrivenLoad"], delta=0.1)
        for load in settle["drivenLoads"]:
            self.assertGreater(load, 1.0)

    def test_an_m3a1s_front_axle_shares_the_load_with_its_tracks(self) -> None:
        # Its own front axle is a genuine spring (`c_PGFRollGrip`, real
        # strength/damping) rather than furniture, so the rear driven wheels
        # alone must fall short of the full 14.73 — some of it is on the
        # front axle instead — but still carry the majority of a nose-heavy
        # half-track's weight.
        settle = self.results["m3a1Settle"]
        self.assertLess(settle["totalDrivenLoad"], 14.73)
        self.assertGreater(settle["totalDrivenLoad"], 7.0)

    def test_dummy_wheels_carry_no_load_on_either_tank(self) -> None:
        # TANK-14/6: the shipped data gives every one `setStrength 0`, so the
        # existing spring formula already prices them at zero.
        for key in ("shermanSettle", "m3a1Settle"):
            for load in self.results[key]["dummyLoads"]:
                self.assertAlmostEqual(0.0, load, places=6, msg=key)

    # --- straight-line driving -------------------------------------------------

    def test_both_tanks_reach_a_tank_scale_not_an_aircraft_scale_top_speed(self) -> None:
        # The whole reason `TANK.trackResistance` exists rather than trusting
        # the confirmed thrust law alone (see its own comment in ground.js):
        # applied unconstrained, the M3A1's corrected ratio asymptotes toward
        # ~68 m/s, well past anything a viewer should show driving. Loose
        # bands, since neither figure is a measurement.
        sherman = self.results["shermanStraight"]
        m3a1 = self.results["m3a1Straight"]
        self.assertGreater(sherman["kmh"], 10.0)
        self.assertLess(sherman["kmh"], 60.0)
        self.assertGreater(m3a1["kmh"], 20.0)
        self.assertLess(m3a1["kmh"], 160.0)

    def test_the_corrected_ratio_makes_the_m3a1_visibly_livelier(self) -> None:
        # 17.5 against the Sherman's 4.0 has to show up as something a
        # player can feel, not just a number nobody drives through — this is
        # the one behavioural assertion tying the ratio correction to an
        # observable outcome beyond the pure-function check above.
        sherman = self.results["shermanStraight"]
        m3a1 = self.results["m3a1Straight"]
        self.assertGreater(m3a1["kmh"], sherman["kmh"] * 1.5)

    def test_it_reaches_an_equilibrium_not_a_wall(self) -> None:
        for key in ("shermanStraight", "m3a1Straight"):
            run = self.results[key]
            self.assertAlmostEqual(run["at10s"], run["along"], delta=max(0.5, abs(run["along"]) * 0.05))

    def test_it_drives_straight_with_the_wheel_centred(self) -> None:
        for key in ("shermanStraight", "m3a1Straight"):
            run = self.results[key]
            self.assertLess(abs(run["heading"] + 1.0), 0.02, key)   # nose down -Z

    # --- turning ----------------------------------------------------------------

    def test_positive_yaw_turns_right_on_both_tanks(self) -> None:
        # The same convention `GroundModelTests` checks for Willy: positive
        # c_PIYaw is a negative yaw rate. If this flips it flips for every
        # differential-steered vehicle at once, not just one tank.
        for key in ("shermanTurnRight", "m3a1TurnRight"):
            self.assertLess(self.results[key]["yawRateDeg"], 0.0, key)
        for key in ("shermanTurnLeft", "m3a1TurnLeft"):
            self.assertGreater(self.results[key]["yawRateDeg"], 0.0, key)

    def test_both_hulls_turn_at_a_vehicles_radius_at_a_matched_speed(self) -> None:
        # Replaces an earlier "the M3A1's front axle turns it tighter than
        # the Sherman" assertion, which compared the two hulls' yaw rate at
        # full throttle — i.e. a 34 km/h vehicle against a 114 km/h one,
        # since the corrected ratio (TANK-3) really is 4.4x. At those
        # speeds the faster hull is grip-limited and the comparison answers
        # a question about top speed, not about the front axle. Held at a
        # common ~8 m/s and read as turn radius instead, the two come out
        # within a couple of metres of each other and neither is tighter by
        # any margin worth asserting, so what is asserted is the thing that
        # actually regressed: both can steer at all. Before the
        # differential got its own gain the Sherman's radius here was in
        # the hundreds of metres.
        by_name = {case["name"]: case for case in self.results["tankMatchedTurn"]}
        for name, case in by_name.items():
            self.assertAlmostEqual(8.0, case["speed"], delta=0.5, msg=name)
            self.assertIsNotNone(case["radius"], name)
            self.assertLess(case["radius"], 40.0, name)
            self.assertGreater(case["radius"], 4.0, name)

    def test_a_held_turn_does_not_settle_into_a_per_frame_limit_cycle(self) -> None:
        # The judder this class shipped with: at one sub-step per rendered
        # frame the explicit integration of a tank's stiff roll suspension
        # against its cornering stiffness sat on its stability limit, and a
        # full-lock turn settled into a period-2 oscillation — the body roll
        # rate flipping -15.08/+14.91 deg/s and the four wheel loads swapping
        # sides every single frame. Both numbers below are one-sided by two
        # orders of magnitude between the broken and fixed models, so the
        # thresholds are deliberately loose.
        steady = self.results["tankSteadyTurn"]
        self.assertLessEqual(steady["rollSignFlipsPerSecond"], 2)
        self.assertLess(steady["worstLoadStep"], 0.05)

    def test_turning_never_flips_either_tank(self) -> None:
        # The regression this track's own work found: a sustained turn from
        # a stand-still once rolled the M3A1 onto its roof (`worstUp` goes
        # negative) before `TANK.angularDamping` was raised to fix it. 0.8,
        # loose, well short of the roughly-zero a genuine tip-over crosses.
        for key in ("shermanTurnRight", "shermanTurnLeft", "m3a1TurnRight", "m3a1TurnLeft"):
            self.assertGreater(self.results[key]["worstUp"], 0.8, key)
            self.assertTrue(self.results[key]["grounded"], key)
        for case in self.results["tankStability"]:
            self.assertGreater(case["worstUp"], 0.8, case)

    def test_turning_never_flips_from_the_vehicles_own_top_speed_either(self) -> None:
        # The harder of the two rollover cases this track's own work found:
        # surviving a turn held from a stand-still (the test above) was not
        # enough to survive the same turn entered from the vehicle's own
        # straight-line top speed — the M3A1's extra ~10 m/s very nearly
        # doubles the centripetal load through the identical suspension
        # formula, and this is the case that actually pinned
        # `TANK.angularDamping` at 12.0 being not quite enough and 15.0
        # being comfortably enough.
        for key in ("shermanHardTurn", "m3a1HardTurn"):
            case = self.results[key]
            self.assertGreater(case["worstUp"], 0.8, key)
            self.assertTrue(case["grounded"], key)

    # --- TANK-17: no pivoting on the spot ---------------------------------------

    def test_it_cannot_pivot_from_a_stand_still_on_yaw_alone(self) -> None:
        pivot = self.results["tankPivot"]
        self.assertAlmostEqual(0.0, pivot["yawRate"], places=3)
        self.assertLess(pivot["speed"], 0.05)

    # --- reverse ------------------------------------------------------------

    def test_negative_throttle_reverses_it(self) -> None:
        # No separate brake/reverse state machine the way `GroundVehicle`
        # needs one — TANK-10's own formula is signed throughout, so this is
        # simply throttle's sign carried straight through.
        self.assertLess(self.results["tankReverse"]["along"], -1.0)

    # --- reset ----------------------------------------------------------------

    def test_reset_clears_motion_and_the_wheels(self) -> None:
        reset = self.results["tankReset"]
        self.assertTrue(reset["everSpun"])   # the test drove it first
        self.assertEqual([0, 0, 0], reset["velocity"])
        self.assertEqual([0, 0, 0], reset["angularVelocity"])
        for angle in reset["anglesAfter"]:
            self.assertEqual(0, angle)

    # --- the two tracks spin at different rates mid-turn ------------------------

    def test_differential_steering_spins_the_two_sides_at_different_rates(self) -> None:
        # The entire visible point of this track: the wheel a player watches
        # spin is driven by TANK-10's own per-side value, not a shared body
        # speed, so the two sides must visibly disagree during a turn.
        spin = self.results["tankWheelSpin"]
        self.assertGreater(max(spin["left"]), max(spin["right"]))
        # Same side, same rate — one differential per vehicle, not one per
        # bogie.
        self.assertAlmostEqual(0.0, spin["leftConsistent"], places=2)
        self.assertAlmostEqual(0.0, spin["rightConsistent"], places=2)

    # --- hull collision against static objects ---------------------------------

    def test_hull_collision_stops_the_vehicle_at_the_wall(self) -> None:
        # With a collider, the jeep must not drive through the wall at z=-10.
        col = self.results["hullCollision"]
        self.assertTrue(col["stoppedShortOfWall"])
        self.assertLess(col["vz"], 0.1)

    def test_no_collider_drives_through_walls(self) -> None:
        # Without a collider, the jeep retains the old behaviour: it drives
        # straight through the static hull.
        col = self.results["hullCollisionNoCollider"]
        self.assertTrue(col["throughWall"])


if __name__ == "__main__":
    unittest.main()
