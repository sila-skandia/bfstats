"""FHSW's bomber gunners hang each sight twice, and three of the B-40's seats
share one sight's name: every copy grafts under its own node and each inside
view draws its seat's copy within reach, the nose cam's included
(`tests/twin_sights_harness.mjs`). FHSWEurope Bombing the Reich's B-40 drew
no sight in the belly gunner's second view and none for the waist gunners."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "twin_sights_harness.mjs"
SEATS = {
    "B40GS_PCO1": ("0,2,-3", "0,2,-5"),
    "B40GS_PCO2": ("0,-1,1", "0,-1,-2"),
    "B40_RPlatz": ("1.5,0.5,4", "2.5,0.5,4"),
    "B40_LPlatz": ("-1.5,0.5,4", "-2.5,0.5,4"),
}


class TwinSightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_every_copy_grafts_under_its_own_seat_and_place(self) -> None:
        self.assertEqual(8, self.r["swaps"])
        places = {(g["control"], tuple(g["host"])) for g in self.r["grafts"]}
        self.assertEqual(8, len(places), "two copies landed on one host")
        for graft in self.r["grafts"]:
            self.assertEqual(graft["control"], graft["hostSeat"])

    def test_each_view_draws_its_seats_copy_within_reach(self) -> None:
        for control, (cockpit, nose) in SEATS.items():
            views = self.r["views"][control]
            self.assertEqual([f"{control}@{cockpit}"], views["cockpit"], control)
            self.assertEqual([f"{control}@{nose}"], views["nose"], control)

    def test_the_nose_cam_hides_the_airframe_and_leaves_the_sights(self) -> None:
        self.assertTrue(self.r["nose"]["hullHidden"])
        self.assertEqual(8, self.r["nose"]["sights"])
        self.assertEqual(0, self.r["nose"]["sightsHidden"])


if __name__ == "__main__":
    unittest.main()
