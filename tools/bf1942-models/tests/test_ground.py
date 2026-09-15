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


if __name__ == "__main__":
    unittest.main()
