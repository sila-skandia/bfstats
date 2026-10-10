"""`viewer/level-edge.js`: the terrain copies past the heightmap's edge
(ledger TERR-5, TERR-6) and the border stitch.

Runs `node level_edge_harness.mjs`, which loads the module in place (three
resolves from `tools/bf1942-models/node_modules`) and prints one JSON blob.
Every expectation is worked out from the module's own rule: a copy (i, k)
covers x in [iW, (i+1)W] and z in [(k-1)W, kW], the original being x in [0, W],
z in [-W, 0], and is visited when its square is within the far plane of the
camera.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "level_edge_harness.mjs"
ROOT = Path(__file__).resolve().parents[1]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (ROOT / "node_modules" / "three").exists():
        raise unittest.SkipTest("three is not installed under tools/bf1942-models")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LevelEdgeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_middle_of_the_world_sees_no_copy(self) -> None:
        self.assertEqual(self.results["centre"], [])

    def test_a_camera_near_the_west_edge_sees_the_western_copy(self) -> None:
        self.assertEqual(self.results["westEdge"], ["-1,0"])

    def test_a_corner_sees_three_copies(self) -> None:
        self.assertEqual(sorted(self.results["corner"]), ["-1,-1", "-1,0", "0,-1"])

    def test_a_camera_outside_the_world_stands_in_a_copy(self) -> None:
        self.assertEqual(self.results["eastOutside"], ["1,0"])

    def test_no_far_plane_reaches_nothing(self) -> None:
        self.assertEqual(self.results["noFar"], [])

    def test_the_ring_caps_the_copies(self) -> None:
        got = self.results["ringCap"]
        self.assertEqual(len(got), 24)
        self.assertNotIn("0,0", got)
        for pair in got:
            i, k = map(int, pair.split(","))
            self.assertLessEqual(max(abs(i), abs(k)), self.results["ring"])

    def test_the_stitch_gives_the_far_edge_the_wrapped_height(self) -> None:
        moved = self.results["mirrored"]
        self.assertEqual(moved["moved"], 5)
        y = moved["y"]
        # Sample (xi, zi) was 10 xi + zi. The edge at xi = 2 takes xi = 0, the
        # edge at zi = 2 takes zi = 0, the corner takes (0, 0).
        self.assertEqual(y["2,0"], 0)
        self.assertEqual(y["2,1"], 1)
        self.assertEqual(y["0,2"], 0)
        self.assertEqual(y["1,2"], 10)
        self.assertEqual(y["2,2"], 0)
        # The interior and the first column and row are untouched.
        self.assertEqual(y["1,1"], 11)
        self.assertEqual(y["1,0"], 10)

    def test_a_border_that_already_wraps_is_left_alone(self) -> None:
        self.assertEqual(self.results["sea"]["moved"], 0)


if __name__ == "__main__":
    unittest.main()
