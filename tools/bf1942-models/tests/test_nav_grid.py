"""`viewer/nav-grid.js` contract under node (`tests/nav_grid_harness.mjs`).

Two regressions that kept bots from pathing:

* the slope test compared raw height difference, so at the default 64 m cell a
  gentle hillside (1.28 m per cell, a 2% grade) was marked `-4` too steep and
  the whole map came out unwalkable;
* a query whose start or end cell was blocked returned `null`, so a bot whose
  spawn cell was bad had no path at all and walked straight into the geometry.

The harness feeds the real `buildNavGrid` a slope and one blocked cell and
asserts the slope stays walkable while a query from inside the blocked cell
still returns a path.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "nav_grid_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (VIEWER / "nav-grid.js").exists():
        raise unittest.SkipTest("nav-grid.js is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "nav-grid.js", work / "nav-grid.js")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class NavGridTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_slope_is_a_gradient_not_raw_height(self) -> None:
        self.assertTrue(self.results["slopeWalkable"],
                        f"slope cell value {self.results['slopeCellValue']}")

    def test_a_gentle_hill_is_not_marked_too_steep(self) -> None:
        self.assertNotEqual(self.results["slopeCellValue"], -4)

    def test_the_blocked_cell_is_blocked(self) -> None:
        self.assertLess(self.results["blockedCell"], 0)

    def test_a_normal_query_finds_a_path(self) -> None:
        self.assertIsNotNone(self.results["pathAround"])
        self.assertGreater(self.results["pathAround"], 1)

    def test_a_blocked_start_cell_snaps_and_paths(self) -> None:
        self.assertIsNotNone(self.results["snapFromBlocked"])


if __name__ == "__main__":
    unittest.main()