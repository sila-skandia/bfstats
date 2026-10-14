"""A RotationalBundle that is not `setAutomaticReset` holds the angle its key
left it at (ledger GUN-2): FH's ammo selectors latch
(`tests/held_axis_harness.mjs`). FHSWEurope Ilomantsi's SU-122 snapped back to
HEAT the moment its key was let go."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "held_axis_harness.mjs"


class HeldAxisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_selector_latches_on_a_land_hull(self) -> None:
        selector = [row[0] for row in self.r["land"]]
        # Down: HE (-180) and it stays; up: HEAT (0) and it stays; a tap moves it all the way.
        self.assertEqual(selector, [-180, -180, 0, 0, -180, -180])

    def test_a_stick_surface_still_centres(self) -> None:
        self.assertEqual(self.r["land"][0][1], 20)
        self.assertEqual(self.r["land"][1][1], 0)

    def test_an_aircraft_keeps_the_surface_servo(self) -> None:
        self.assertEqual([row[0] for row in self.r["air"]][:2], [-180, 0])


if __name__ == "__main__":
    unittest.main()
