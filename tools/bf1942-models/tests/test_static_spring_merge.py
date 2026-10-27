"""A wheel spring that a static face pushes while it also stands on the ground
keeps the ground's push (ledger COL-21; collision-response.md 6.3, 6.4).

The engine posts the terrain contact and the static contact on the same
wheel response; `setAdjust` 0x0825cec0 merges the two pushes per axis and
`solveImpulse` 0x08258d30 moves the wheel along the contacts' mean normal.
The page took the deeper of the two whole pushes instead, so a horse's side
spring brushing FHSW's `greencammo_m1` skirt lost its footing and the horse
rolled 14 deg where the lab's server's horse, on the same track at the same
speed, rolled under 1 deg (2026-10-28, features/fhsweurope-extraction/README.md,
"Three reports from Operation Spring Awakening").
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "static_spring_merge_harness.mjs"


class StaticSpringMergeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_wall_beside_a_grounded_wheel_keeps_the_ground_under_it(self) -> None:
        r = self.r["wallAndGround"]
        n = r["normal"]
        self.assertAlmostEqual(1.0, math.hypot(*n), places=3)
        # Along the mean of the wall's and the ground's normals: half up.
        self.assertGreater(n[1], 0.6)
        # The vertical share of the push is the ground's 0.3, not the wall's 0.04.
        self.assertGreater(r["compression"] * n[1], 0.25)

    def test_without_the_ground_the_wall_stands_alone(self) -> None:
        self.assertEqual(self.r["wallAlone"], self.r["wallOffGround"])
        self.assertLess(self.r["wallOffGround"]["normal"][1], 0.1)

    def test_a_deck_over_shallower_ground_is_the_deck(self) -> None:
        self.assertEqual({"compression": 0.4, "normal": [0.0, 1.0, 0.0]}, self.r["deckOverGround"])


if __name__ == "__main__":
    unittest.main()
