"""FHSW's bombers carry an attitude indicator, objects of their own held by
the bomber's spawners (ledger AI-121): each is a mark on the map at its
declared `setMinimapIconSize`, shown to its own side, and none is a seat of
the bomber (`tests/held_map_marks_harness.mjs`). FHSWEurope Bombing the Reich
drew the plain silhouette, and the B-29's seat keys walked into them."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "held_map_marks_harness.mjs"


class HeldMapMarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_held_indicator_is_a_mark_of_its_own(self) -> None:
        self.assertEqual([["Mosquito_B_MkIV", "empty"], ["Attitude_indicator_A_ALLIED", "empty"],
                          ["Attitude_indicator_B", "empty"]], self.r["allied"])

    def test_the_other_side_does_not_see_it(self) -> None:
        self.assertEqual([["Mosquito_B_MkIV", "empty"]], self.r["axis"])

    def test_a_declared_size_is_the_width_drawn(self) -> None:
        self.assertEqual([128, 128], self.r["drawn"][0])
        self.assertEqual([256, 256], self.r["drawn"][1])

    def test_a_held_object_is_no_seat(self) -> None:
        self.assertEqual(["Mosquito_B_MkIV", "Mosquito_Gunner_PCO"], self.r["seats"])


if __name__ == "__main__":
    unittest.main()
