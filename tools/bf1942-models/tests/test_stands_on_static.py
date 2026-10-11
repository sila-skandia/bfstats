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
