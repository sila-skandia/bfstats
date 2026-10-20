"""`standsOnAStatic`: a placed hull resting on a structure is left where the
level put it (XPack2's Natter on its ramp), a hull with nothing under it still
drops (`tests/stands_on_static_harness.mjs`)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "stands_on_static_harness.mjs"


class StandsOnAStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_hull_on_a_ramp_stays_where_it_was_put(self) -> None:
        self.assertTrue(self.r["onARamp"])

    def test_a_hull_hovering_over_the_ramp_still_drops(self) -> None:
        self.assertFalse(self.r["hoveringOverIt"])

    def test_a_hull_over_bare_ground_still_drops(self) -> None:
        self.assertFalse(self.r["overBareGround"])

    def test_a_slab_under_a_wheel_is_the_ground(self) -> None:
        self.assertFalse(self.r["onASlab"])

    def test_a_prop_under_one_corner_does_not_hold_the_hull(self) -> None:
        self.assertFalse(self.r["aPropUnderOneCorner"])

    def test_a_hull_sunk_into_a_floor_is_lifted_by_the_wheels_depth(self) -> None:
        # Operation Da's P-40: wheels 2.27 m under an origin 0.56 m over the floor.
        self.assertAlmostEqual(self.r["sunkDepth"], 1.71, places=2)
        self.assertTrue(self.r["sunkLevel"])

    def test_wheels_sunk_into_a_ramp_are_lifted_but_not_let_down(self) -> None:
        # XPack2's Natter rolled off its 9-degree ramp when let down (SWB-7).
        self.assertFalse(self.r["sunkOnARamp"])

    def test_wheels_on_the_floor_are_not_sunk(self) -> None:
        self.assertEqual(self.r["notSunk"], 0)

    def test_a_ride_surface_is_a_deck_at_its_floor_and_not_its_roof(self) -> None:
        self.assertAlmostEqual(self.r["rideFloorY"], 3.0, places=3)
        self.assertAlmostEqual(self.r["rideMaskTop"], 3.0, places=3)

    def test_an_unmarked_static_is_no_deck(self) -> None:
        self.assertIsNone(self.r["unmarkedDeck"])

    def test_a_mesh_out_of_any_world_is_left_out_of_the_index(self) -> None:
        # tigerpass-1943's house at 1e22 m threw building the cell table.
        self.assertAlmostEqual(self.r["outOfWorldDropY"], 3.0, places=3)

    def test_a_static_hundreds_of_km_out_is_left_out_of_the_index(self) -> None:
        # sand_dunes' barbed wire at 858 km: 6.2e9 cells, 70 GB (2026-10-20).
        self.assertAlmostEqual(self.r["farWireDropY"], 3.0, places=3)
        self.assertLess(self.r["farWireCells"], 100)

    def test_a_grid_wider_than_its_cell_budget_takes_coarser_cells(self) -> None:
        self.assertLessEqual(self.r["wideCells"], 2 ** 25)
        self.assertGreater(self.r["wideCellSize"], 8)
        self.assertAlmostEqual(self.r["wideDropY"], 3.0, places=3)
        self.assertLessEqual(self.r["wideMaskCells"], 2 ** 25)

    def test_a_pit_far_below_is_not_a_support(self) -> None:
        self.assertFalse(self.r["aPitBelow"])

    def test_a_hull_off_the_map_is_not_supported(self) -> None:
        self.assertFalse(self.r["offMap"])

    def test_skip_roots_leaves_the_hulls_collision_out_of_the_index(self) -> None:
        self.assertAlmostEqual(self.r["everything"], 6.0, places=3)
        self.assertAlmostEqual(self.r["withoutTheHull"], 3.0, places=3)

    def test_an_index_of_nothing_but_skipped_roots_is_null(self) -> None:
        self.assertIsNone(self.r["onlyTheHull"])


if __name__ == "__main__":
    unittest.main()
