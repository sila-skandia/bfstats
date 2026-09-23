"""`viewer/nav-grid.js` contract under node (`tests/nav_grid_harness.mjs`).

The navigation map is the engine's own: one bit a metre (`LocalMap`, level-0
pixel = 1 m), statics clipped to the infantry map's 0.4..2.0 m band above
the object's base, the plus-shaped brush, water deeper than 1.5 m and slopes
over 30 deg blocked, and a flood from the spawn points that closes what they
cannot reach. The old 64 m grid could not see a sandbag, which is why bots
walked into them.
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
        # `nav-grid.js` re-exports the map and the searches from their modules.
        for name in ("nav-map.js", "nav-search.js"):
            shutil.copyfile(VIEWER / name, work / name)
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

    def test_the_map_is_one_metre_a_cell(self) -> None:
        r = self.results
        self.assertEqual(r["cellSize"], 1)
        self.assertEqual(r["width"], 128)

    def test_the_brush_is_the_engines_plus(self) -> None:
        self.assertEqual(self.results["brushCells"], 5)
        self.assertFalse(self.results["brushHasCorner"])

    def test_a_gentle_hill_is_walkable_and_a_steep_one_is_not(self) -> None:
        r = self.results
        self.assertEqual(r["gentleHill"], r["codes"]["CELL_FREE"])
        self.assertEqual(r["steepHill"], r["codes"]["CELL_SLOPE"])

    def test_deep_water_is_blocked(self) -> None:
        self.assertEqual(self.results["lake"], self.results["codes"]["CELL_WATER"])

    def test_a_sandbag_wall_is_blocked_and_a_kerb_is_not(self) -> None:
        r = self.results
        self.assertEqual(r["wall"], r["codes"]["CELL_OBJECT"])
        self.assertEqual(r["kerb"], r["codes"]["CELL_FREE"])

    def test_the_brush_grows_the_wall_by_one_metre(self) -> None:
        r = self.results
        self.assertEqual(r["wallBrush"], r["codes"]["CELL_OBJECT"])
        self.assertEqual(r["besideWall"], r["codes"]["CELL_FREE"])

    def test_a_walled_yard_with_no_door_is_unreachable(self) -> None:
        r = self.results
        self.assertEqual(r["yardInside"], r["codes"]["CELL_UNREACHABLE"])

    def test_a_pier_deck_over_deep_water_is_walkable(self) -> None:
        self.assertEqual(self.results["pierDeck"], self.results["codes"]["CELL_FREE"])

    def test_the_trace_refuses_the_wall(self) -> None:
        self.assertFalse(self.results["traceThroughWall"])
        self.assertTrue(self.results["traceClear"])


    def test_trace_valid_point_is_the_first_free_cell_along_the_line(self) -> None:
        r = self.results
        self.assertEqual(r["validFromFree"], [85, -50])
        p = r["validFromWall"]
        self.assertIsNotNone(p)
        # Past the wall (z = -60) and its one-metre brush, on the far side.
        self.assertLess(p[1], -61.5)
        self.assertGreater(p[1], -66)
        self.assertIsNone(r["validAllBlocked"])

    def test_the_local_search_routes_around_the_wall(self) -> None:
        r = self.results
        self.assertIsNotNone(r["pathAround"])
        self.assertGreater(r["pathAround"], 2)
        self.assertTrue(r["pathAroundClearsWall"])
        self.assertTrue(r["pathAroundEndsAtGoal"])

    def test_the_whole_route_query_answers(self) -> None:
        self.assertIsNotNone(self.results["wholePath"])


if __name__ == "__main__":
    unittest.main()
