"""The fire approach's goal on a blocked target (Brief R item 4, ledger AI-126).

`BAPAMoveToObjectFinding::initObjectFinding` 0x08545df0 takes the target's
point when it is valid on the unit's map, else the first valid pixel on the
line from the target toward the bot (`traceValidPoint` 0x0847e3a0) within the
finding's radius (0.9 maxRange), else it has no goal. The viewer's route used
to take the target's point and fail every retry when the map blocked it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "fire_approach_harness.mjs"


class FireApproachGoalTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_free_target_is_its_own_goal(self) -> None:
        self.assertEqual(self.results["free"], [20.5, 0, -20.5])

    def test_a_blocked_target_gives_the_first_free_pixel_toward_the_bot(self) -> None:
        x, y, z = self.results["blocked"]
        self.assertAlmostEqual(z, -55.5)
        self.assertGreaterEqual(x, 70.0)
        self.assertLess(x, 71.5)

    def test_no_free_pixel_within_the_radius_is_no_goal(self) -> None:
        self.assertIsNone(self.results["tooFar"])

    def test_without_a_map_the_target_is_the_goal(self) -> None:
        self.assertEqual(self.results["noMap"], [55.5, 0, -55.5])


if __name__ == "__main__":
    unittest.main()
