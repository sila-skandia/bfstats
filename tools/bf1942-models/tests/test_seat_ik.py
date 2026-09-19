"""`viewer/seat-ik.js`: who is drawn in a seat, and where their hands go.

Everything asserted here is read out of the Linux dedicated server, not
guessed:

  - the five `seatFlags` bits and their values, off the jump table
    `operator<<(ostream&, ISeatObjectTemplate::SeatFlags)` reads at
    `0x086e1e3c` (lnxded `0x083207f0`);
  - which animation states a seat plays, from `BFSoldier::setUseSeat`
    (`0x08271950`) and the three defaults `BFSoldierTemplate::init` resolves by
    name at `0x0827acaf` / `0x0827acff` / `0x0827ad4f`;
  - that the second `addSkeletonIK` triple is Refractor yaw/pitch/roll in
    degrees, because `AnimatedBundleTemplate::addSkeletonIK` (`0x08266cb0`)
    bakes it with `dice::ref2::setRotation` (`0x08060d30`) -- the same helper
    `BundleTemplate::setRotation` (`0x081a9085`) uses for
    `ObjectTemplate.setRotation`, whose conversion `bf42/gltf.py` already owns.
    The JS port of that conversion is checked against the Python here rather
    than eyeballed;
  - that the solve is a two-bone reach, because `Skeleton::transform`
    (`0x083420f0`) sends a bone carrying an IK handle through
    `Skeleton::applyIK2BoneSolver` (`0x083418f0`), itself a wrapper over
    `maya::applyIK2BoneSolver` (`0x08332e10`), before overwriting that bone's
    world rotation rows with the handle's (`0x8342233`).

Like `test_vehicle_damage.py` this copies the module into a temp dir and runs
`node harness.mjs`; `seat-ik.js` imports nothing, so there is nothing else to
copy and no vendored three.js.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "seat-ik.js"
HARNESS = Path(__file__).resolve().parent / "seat_ik_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "seat-ik.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SeatIkHarness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()


class SeatFlagTests(SeatIkHarness):
    def test_the_five_bits_match_the_engine_jump_table(self) -> None:
        self.assertEqual(
            {"c_seatshowhalfbodysoldier": 1, "c_seatshowfullbodysoldier": 2,
             "c_seatshowheadofsoldier": 4, "c_seatisoutside": 8,
             "c_seatshowstandingsoldier": 16},
            self.results["flagBits"])

    def test_a_seat_with_no_SeatObject_draws_nobody(self) -> None:
        # The Sherman's driver, and the whole of the "hide the driver, show the
        # hull gunner" rule: its root PCO declares EntryPoints, a Camera and
        # the turret bundles, and no SeatObject anywhere.
        self.assertFalse(self.results["seatBody"]["shermanDriver"]["draw"])

    def test_the_hull_gunner_is_drawn_from_the_waist_up(self) -> None:
        gunner = self.results["seatBody"]["shermanGunner"]
        self.assertTrue(gunner["draw"])
        self.assertTrue(gunner["halfBody"])

    def test_the_willys_driver_is_drawn_whole(self) -> None:
        driver = self.results["seatBody"]["willyDriver"]
        self.assertTrue(driver["draw"])
        self.assertFalse(driver["halfBody"])

    def test_a_flag_the_engine_does_not_know_contributes_nothing(self) -> None:
        # Two vanilla seats declare `c_SeatHalfBodySoldier`, missing the
        # "Show". It is not in the engine's table, so it is not a bit.
        self.assertEqual(0, self.results["seatBody"]["unknownFlag"])


class SeatStateTests(SeatIkHarness):
    def test_a_seat_that_declares_nothing_sits_in_the_vehicle(self) -> None:
        self.assertEqual({"upperBody": "Ub_SitInVehicle",
                          "lowerBody": "Lb_SitInVehicle"},
                         self.results["seatStates"]["willyDriver"])

    def test_a_declared_pair_still_wins(self) -> None:
        self.assertEqual({"upperBody": "Ub_PassengerInWilly",
                          "lowerBody": "Lb_PassengerInWilly"},
                         self.results["seatStates"]["willyPassenger"])

    def test_only_the_standing_flag_changes_a_default(self) -> None:
        self.assertEqual("Lb_StandInVehicle",
                         self.results["seatStates"]["standing"]["lowerBody"])
        # Half-body hides the legs; it does not pick different legs.
        self.assertEqual("Lb_SitInVehicle",
                         self.results["seatStates"]["shermanGunner"]["lowerBody"])

    def test_pose_names_agree_with_the_exporter(self) -> None:
        from extract_pose import seat_pose_name
        names = self.results["poseNames"]
        self.assertEqual(seat_pose_name("Ub_PassengerInWilly", "Lb_PassengerInWilly"),
                         names["passenger"])
        self.assertEqual(seat_pose_name("Ub_PassengerInWilly", "Lb_Stand"),
                         names["upperOnly"])
        self.assertEqual(seat_pose_name("Ub_SitInVehicle", "Lb_SitInVehicle"),
                         names["sit"])
        self.assertEqual(seat_pose_name("Ub_SitInVehicle", "Lb_StandInVehicle"),
                         names["sitStanding"])
        self.assertEqual(seat_pose_name("Ub_PassengerInWilly", "Lb_PassengerInHanomag"),
                         names["mixed"])


class HandednessTests(SeatIkHarness):
    def test_the_rotation_triple_converts_exactly_as_a_node_placement_does(self) -> None:
        # `addSkeletonIK` and `ObjectTemplate.setRotation` bake their triple
        # with the same `dice::ref2::setRotation`, so the viewer's port has to
        # agree with the exporter's conversion to the last bit, not roughly.
        for row in self.results["ypr"]:
            with self.subTest(ypr=row["ypr"]):
                expected = gltf.quat_from_ypr(*row["ypr"])
                for got, want in zip(row["quat"], expected):
                    self.assertAlmostEqual(want, got, places=12)

    def test_the_position_triple_is_mirrored_about_z(self) -> None:
        self.assertEqual([0.24, -0.1, 0.82], self.results["point"])

    def test_the_offset_rides_the_target_node_rather_than_only_shifting(self) -> None:
        # A node yawed 90 degrees at (1, 2, 3) with a +X offset of 1 m: the
        # hand has to end up on the node's own +X, which after the yaw is -Z...
        # in glTF's right-handed frame, +Z of magnitude 1 from the origin
        # rotated by +90 about Y lands on -Z, so (1, 2, 3) + (0, 0, -1).
        got = self.results["ikTarget"]["position"]
        self.assertAlmostEqual(1.0, got[0], places=9)
        self.assertAlmostEqual(2.0, got[1], places=9)
        self.assertAlmostEqual(2.0, got[2], places=9)


class TwoBoneSolveTests(SeatIkHarness):
    def solve(self, name):
        return self.results["solves"][name]

    def test_a_target_where_the_hand_already_is_moves_nothing(self) -> None:
        s = self.solve("identity")
        self.assertLess(s["error"], 1e-9)
        self.assertAlmostEqual(s["elbowBefore"], s["elbowAfter"], places=9)

    def test_a_reachable_target_is_reached_exactly(self) -> None:
        for name in ("near", "far", "behind", "straight"):
            with self.subTest(name):
                self.assertLess(self.solve(name)["error"], 1e-9)

    def test_neither_bone_changes_length(self) -> None:
        for name, s in self.results["solves"].items():
            with self.subTest(name):
                self.assertLess(s["upperLengthKept"], 1e-9)
                self.assertLess(s["foreLengthKept"], 1e-9)

    def test_the_elbow_opens_for_a_far_target_and_closes_for_a_near_one(self) -> None:
        near, far = self.solve("near"), self.solve("far")
        self.assertLess(near["elbowAfter"], near["elbowBefore"])
        self.assertGreater(far["elbowAfter"], far["elbowBefore"])

    def test_a_target_out_of_reach_leaves_the_arm_straight_and_aimed(self) -> None:
        s = self.solve("unreachable")
        self.assertTrue(s["clamped"])
        # Straight, but not perfectly straight: a collinear arm has no plane
        # for the next frame's bend axis.
        self.assertGreater(s["elbowAfter"], math.radians(170))
        self.assertLess(s["elbowAfter"], math.radians(180))
        # Still pointing at the target, just short of it.
        self.assertGreater(s["error"], 1.0)

    def test_a_target_a_hair_too_far_is_short_by_a_hair(self) -> None:
        s = self.solve("justOutOfReach")
        self.assertTrue(s["clamped"])
        self.assertLess(s["error"], 0.03)

    def test_a_target_at_the_shoulder_is_refused_rather_than_producing_NaN(self) -> None:
        s = self.solve("atShoulder")
        self.assertTrue(s["degenerate"])
        for v in s["finalEnd"]:
            self.assertFalse(math.isnan(v))

    def test_a_straight_arm_still_solves(self) -> None:
        # No limb plane to measure the bend axis in; one has to be invented.
        s = self.solve("straight")
        self.assertLess(s["error"], 1e-9)


class WillysWheelTests(SeatIkHarness):
    def test_both_hands_land_on_the_wheel_half_a_metre_apart(self) -> None:
        # `0.24` and `-0.26` about the column, so 0.5 m of rim between them.
        self.assertAlmostEqual(0.5, self.results["willyHandSpan"], places=9)

    def test_turning_the_wheel_moves_both_hands_rigidly(self) -> None:
        self.assertAlmostEqual(self.results["willyHandSpan"],
                               self.results["willyHandsTurnedSpan"], places=9)
        for travel in self.results["willyHandTravel"]:
            self.assertGreater(travel, 0.05)

    def test_the_two_hands_are_not_the_same_point(self) -> None:
        a, b = (h["position"] for h in self.results["willyHands"])
        self.assertGreater(math.dist(a, b), 0.4)


class BindingTests(SeatIkHarness):
    def test_the_willys_hands_bind_to_the_wheel_not_the_dummy(self) -> None:
        # The whole mechanism: `WillySteeringDummy` declares the IK, but the
        # offsets measure from `WillySteering`, the child that turns.
        self.assertEqual(
            [{"node": "WillySteeringDummy", "target": "WillySteering",
              "bone": "Bip01 R Hand"},
             {"node": "WillySteeringDummy", "target": "WillySteering",
              "bone": "Bip01 L Hand"},
             {"node": "Browning", "target": "Browning", "bone": "Bip01 R Hand"}],
            self.results["bindings"])

    def test_a_negative_index_measures_from_the_declaring_node(self) -> None:
        browning = self.results["bindings"][2]
        self.assertEqual(browning["node"], browning["target"])

    def test_an_unresolvable_child_falls_back_to_the_declaring_node(self) -> None:
        for row in self.results["bindingsNoResolver"]:
            self.assertEqual(row["node"], row["target"])


if __name__ == "__main__":
    unittest.main()
