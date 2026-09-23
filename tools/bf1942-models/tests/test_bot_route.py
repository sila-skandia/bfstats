"""A soldier's collision look-ahead (`viewer/bot-route.js predictObstacles`,
ledger AI-119): `BBAvoid::calculateUrgency` 0x0855c650 predicts collisions
over the Mobile plug-in's `avoidCollisionLookAhead` (+0x2c), which both
`AITemplateMobile` ctors (0x085e0bf0, 0x085e0cb0) set to 5 s and no soldier
template changes, and plants a still object it will meet as a potential
obstacle (`addSlowMovingPathfindingObstacle` 0x0855d550), with the still
objects around it. The viewer had taken the soldier's look-ahead for 0.

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

HARNESS = Path(__file__).resolve().parent / "bot_route_harness.mjs"


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


class SoldierLookAheadTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_look_ahead_is_five_seconds_and_only_still_objects_count(self) -> None:
        self.assertEqual(self.results["lookAhead"], 5.0)
        self.assertEqual(self.results["maxSpeed"], 0)

    def test_a_still_friend_ahead_is_planted_before_contact(self) -> None:
        s = self.results["stillAhead"]
        self.assertEqual(s["planted"], 1)
        # At the friend, radius R_bot + R_object.
        self.assertEqual(s["obstacles"], [[0, 8, 2.0]])
        # The route is rebuilt around it (`addPotentialObstacle` marks it stale).
        self.assertTrue(s["routeCleared"])
        self.assertEqual(self.results["again"], 0)

    def test_the_reach_is_the_look_ahead_times_the_speed(self) -> None:
        self.assertEqual(self.results["beyondReach"], 0)
        self.assertEqual(self.results["insideReach"], 1)
        self.assertEqual(self.results["standing"], 0)

    def test_moving_bodies_are_left_to_the_avoid_behaviour(self) -> None:
        self.assertEqual(self.results["pacing"], 0)
        self.assertEqual(self.results["crossing"], 0)
        # Touching now plants it whatever its speed.
        self.assertEqual(self.results["touching"], 1)

    def test_the_still_objects_around_the_hit_come_with_it(self) -> None:
        c = self.results["cluster"]
        self.assertEqual(c["planted"], 2)
        self.assertEqual(sorted(c["ids"]), ["h:tank", "p:near"])
        self.assertAlmostEqual(c["tankRadius"], 4.5)

    def test_a_mounted_bot_does_not_run_the_soldier_prediction(self) -> None:
        self.assertEqual(self.results["mounted"], 0)

    def test_a_hull_is_planted_as_its_sub_spheres(self) -> None:
        s = self.results["subSpheres"]
        self.assertAlmostEqual(s["tank"]["r"], 7 / 3)
        self.assertEqual(len(s["tank"]["points"]), 2)
        self.assertAlmostEqual(s["tank"]["points"][0][1], -3.5 + 7 / 3)
        self.assertAlmostEqual(s["tank"]["points"][1][1], -3.5 + 14 / 3)
        self.assertEqual(s["tank"]["points"][0][0], 0)
        self.assertAlmostEqual(s["crate"]["r"], 0.5 * (4 + 4 + 4) ** 0.5)
        self.assertEqual(s["crate"]["points"], [[0, 0]])
        self.assertEqual([p[0] for p in s["planted"]], ["h:t#0", "h:t#1"])
        self.assertAlmostEqual(s["planted"][0][3], round(1 + 7 / 3, 3))

    def test_the_hull_the_plan_boards_is_no_obstacle(self) -> None:
        b = self.results["boardTarget"]
        self.assertEqual(sorted(b["before"]), ["h:gun#0", "p:a"])
        self.assertEqual(b["after"], ["p:a"])

    def test_the_soldiers_circles_go_when_he_takes_a_hull(self) -> None:
        m = self.results["mountDrops"]
        self.assertEqual(m["onFoot"], 2)
        self.assertEqual(m["mounted"], 1)
        self.assertEqual(m["kept"], ["contact"])


if __name__ == "__main__":
    unittest.main()
