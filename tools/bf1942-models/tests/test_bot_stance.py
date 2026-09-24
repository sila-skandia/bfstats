"""A bot soldier's pose (features/bot-stance-variety, ledger BODY-5 and
BODY-10..BODY-13).

* `BAPAComponentSoldierPose` 0x0853ed10 / `computeCurrentPose` 0x0853efa0:
  the random fire threshold, the decision at most once a duration, the
  control branch, the water rule; the thresholds and durations each builder
  passes (Scout, TakeCover, a move, a direct move, the fixed pose).
* `requestSoldierPose` 0x0852e910 / `pollRequestedSoldierPose` 0x0852e930:
  prone at once, anything else 10 s after the last change pressed, a request
  dropped while a change is in flight.
* `getFiringPose` 0x085a26f0: the pose camera's eyes (1.65 / 1.12 / 0.30 m)
  to the point the bot sensed on its target, kept in the target's frame.
* `BotMain::getAttackerStrength` 0x0852f1c0 and the fire objects that feed
  it: the direct hit, the shot within 50 m, the round flown past within 10 m.
* The plans: Scout's and TakeCover's statements, no pose in Change or the
  resets, and the Fire -> Change -> Fire flip that stood a prone bot up for
  a tick.

The harness runs on the module set `test_bot_ai.py` stages.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_stance_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierPoseComponentTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_fire_threshold_is_spread_up_to_six_times(self) -> None:
        # threshold x (1 + 5 x rand): 4 at rand 0.5 is 14.
        self.assertEqual(self.results["component"]["threshold"], 14)

    def test_the_danger_pose_needs_fire_strictly_above_the_threshold(self) -> None:
        c = self.results["component"]
        self.assertEqual(c["above"], "prone")
        self.assertEqual(c["at"], "stand")
        self.assertEqual(c["below"], "stand")
        self.assertEqual(c["nanFire"], "stand")

    def test_the_control_branch_takes_the_normal_pose_at_the_threshold(self) -> None:
        c = self.results["component"]
        self.assertEqual(c["controlAtThreshold"], "stand")
        self.assertEqual(c["incoming"], "crouch")
        self.assertEqual(c["nanControl"], "stand")
        self.assertEqual(c["clampHigh"], 1)
        self.assertEqual(c["clampLow"], -1)

    def test_it_decides_at_most_once_a_duration(self) -> None:
        self.assertEqual(self.results["component"]["timeline"],
                         [[0, "stand"], [4.9, "stand"], [5, "prone"], [7, "prone"], [9.99, "prone"], [10, "stand"]])

    def test_water_stands_him_up_and_turns_prone_to_crouch(self) -> None:
        c = self.results["component"]
        self.assertEqual(c["deepWater"], "stand")
        self.assertEqual(c["deepWaterFire"], "stand")
        self.assertEqual(c["shallowFire"], "crouch")
        self.assertEqual(c["shallowCalm"], "stand")
        self.assertEqual(c["crouchInShallow"], "crouch")
        self.assertEqual(c["dryEdge"], "prone")
        self.assertEqual(c["fixedCrouchShallow"], "crouch")
        self.assertEqual(c["fixedProneFire"], "prone")

    def test_the_water_depth_is_the_water_over_the_terrain(self) -> None:
        w = self.results["component"]["water"]
        self.assertIsNone(w["none"])                # -Infinity
        self.assertAlmostEqual(w["under"], 0.3, places=6)
        self.assertEqual(w["dry"], -2)

    def test_each_builder_passes_the_engines_threshold_and_duration(self) -> None:
        c = self.results["component"]
        # Scout: trunc(1 + 9 rand), then the spread.
        self.assertEqual(c["scoutHigh"], 9)
        self.assertEqual(c["scoutLow"], 1)
        self.assertEqual(c["scoutMid"], 17.5)
        # TakeCover 5, a move 1 + 14 rand over 10 s, a direct move 1.0 over 5 s.
        self.assertEqual(c["takeCover"], 10)
        self.assertEqual(c["takeCoverDuration"], 5)
        self.assertEqual(c["move"], 28)
        self.assertEqual(c["moveDuration"], 10)
        self.assertEqual(c["direction"], 2)
        self.assertEqual(c["directionDuration"], 5)


class PoseRequestTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_prone_is_at_once_and_the_rest_waits_ten_seconds(self) -> None:
        r = self.results["requests"]
        self.assertEqual(r["gate"], 10)
        held = {round(now, 3): pose for now, _, pose, _ in r["log"]}
        self.assertEqual(held[0], "prone")
        self.assertEqual(held[2], "prone")
        self.assertEqual(held[9.99], "prone")
        self.assertEqual(held[10.0], "stand")
        self.assertEqual(held[12], "prone")          # crouch held back
        self.assertEqual(held[20.07], "crouch")

    def test_a_request_during_a_change_is_dropped(self) -> None:
        log = self.results["requests"]["log"]
        in_flight = {round(now, 3): flying for now, _, _, flying in log}
        held = {round(now, 3): pose for now, _, pose, _ in log}
        self.assertTrue(in_flight[10.0])
        self.assertEqual(held[10.033], "stand")       # the prone ask came in flight
        self.assertEqual(held[10.066], "prone")

    def test_a_pose_the_machine_does_not_know_resets_the_request(self) -> None:
        self.assertEqual(self.results["requests"]["odd"], ["stand", "stand", False])


class FiringPoseTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_eyes_are_the_pose_cameras(self) -> None:
        f = self.results["firing"]
        self.assertEqual(f["eyes"], [["prone", 0.3], ["crouch", 1.12], ["stand", 1.65]])
        self.assertEqual(f["poseEye"], [1.65, 1.12, 0.3])

    def test_the_first_clear_pose_from_prone_up_wins(self) -> None:
        f = self.results["firing"]
        self.assertEqual(f["open"], "prone")
        self.assertEqual(f["lowCover"], "crouch")   # the old 0.40 m eye saw over it
        self.assertEqual(f["chestWall"], "crouch")
        self.assertIsNone(f["highWall"])
        self.assertIsNone(f["blind"])
        self.assertEqual(f["forced"], "prone")

    def test_the_line_runs_to_the_sensed_point_turned_with_the_target(self) -> None:
        s = self.results["sensed"]
        self.assertEqual(s["turned"], [10.1, 3.2, -5.2])
        self.assertEqual(s["firingPoint"], [10.1, 3.2, -5.2])
        self.assertEqual(s["bare"], [10, 3, -5])
        self.assertEqual(s["firingPointNoRecord"], [10, 3, -5])
        self.assertEqual(s["round"], [0.3, -0.2])
        self.assertEqual(s["rayOffset"], [-0.25, 1, 0])


class AttackerStrengthTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_each_attacker_counts_its_newest_round_decayed(self) -> None:
        a = self.results["attacker"]
        self.assertEqual(a["at1"], 6)                # 4 / 2 + 4 / 1
        self.assertAlmostEqual(a["at3"], 2.333, places=3)
        self.assertAlmostEqual(a["at5"], 2.667, places=3)   # the near misses share one entry
        self.assertEqual(a["listed"], 3)
        self.assertEqual(a["at200"], 0)

    def test_the_map_keeps_an_entry_the_longer_of_300_over_n_and_10_s(self) -> None:
        self.assertEqual(self.results["attacker"]["crowded"], [3.67, 0])

    def test_near_shots_within_fifty_metres_or_ten_of_the_line(self) -> None:
        n = self.results["nearShot"]
        self.assertEqual((n["radius"], n["lineRadius"]), (50, 10))
        self.assertEqual(n["close"], {"n": 1, "near": True, "strength": 4})
        self.assertEqual(n["farFacing"]["n"], 1)
        self.assertEqual(n["farOffset5"]["n"], 1)
        self.assertEqual(n["farAway"]["n"], 0)
        self.assertEqual(n["farOffset15"]["n"], 0)
        self.assertEqual(n["mate"]["n"], 0)

    def test_a_round_carries_the_shooters_strength_and_condition(self) -> None:
        n = self.results["nearShot"]
        self.assertEqual(n["full"], 4)
        self.assertEqual(n["hurt"], 3.5)             # 4 x (0.75 + 0.25 x SCurve(0.5))
        self.assertEqual(n["unknown"], 1)


class PlanPoseTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_scout_carries_the_variable_pose(self) -> None:
        p = self.results["plans"]
        self.assertEqual(p["scout"][0][:2], ["SoldierPose", "component"])
        self.assertEqual(p["scoutThreshold"], 17.5)

    def test_take_cover_walks_with_the_variable_pose_then_the_ladder(self) -> None:
        p = self.results["plans"]
        self.assertEqual(p["cover"][0], ["SoldierPose", "component", False, False, True, False])
        self.assertEqual(p["cover"][1][0], "InfanteryMoveTo")
        self.assertEqual(p["cover"][2], ["SoldierPose", "ladder", True, False, False, False])
        self.assertEqual(p["ladder"], ["stand", "crouch", "prone", "prone"])

    def test_without_cover_he_lies_down_before_he_moves(self) -> None:
        p = self.results["plans"]
        self.assertEqual(p["open"][0], ["SoldierPose", "component", False, False, False, True])
        self.assertEqual(p["open"][1], ["InfanteryMoveTo", None, False, True, False, False])

    def test_change_and_the_resets_leave_the_pose_alone(self) -> None:
        p = self.results["plans"]
        self.assertNotIn("SoldierPose", [a[0] for a in p["change"]])
        self.assertEqual(p["resetKeepsPose"], "prone")
        self.assertFalse(p["resetWalk"])

    def test_a_one_tick_change_in_a_fight_stands_nobody_up(self) -> None:
        f = self.results["flip"]
        self.assertEqual(f["stanceBeforeFlips"], "prone")
        self.assertEqual(f["changeTicks"], f["flips"])
        self.assertEqual(f["standDuringChange"], 0)
        self.assertEqual(f["oneTickFlickers"], 0)
        self.assertEqual(f["proneAfter"], f["samplesAfter"])


if __name__ == "__main__":
    unittest.main()
