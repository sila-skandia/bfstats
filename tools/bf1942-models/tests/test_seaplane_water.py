"""A hull is wet when a MOBILE part's lowest col0 vertex is under the sea
(ledger HP-21, read from the server binary; `tests/seaplane_water_harness.mjs`):
a `hasMobilePhysics 0` part's `checkVsTerrain` is empty, so FHSWEurope Biak's
parked Catfish, its static pontoon under, is never billed (the lab's server
recording: 170 HP for 250 s). A driven hull is tested on its root alone."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "seaplane_water_harness.mjs"


class SeaplaneWaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_static_pontoon_in_the_sea_leaves_the_hull_dry(self) -> None:
        self.assertFalse(self.r["floating"])

    def test_a_mobile_part_in_the_sea_wets_a_parked_hull(self) -> None:
        self.assertTrue(self.r["mobilePart"])

    def test_a_driven_hull_is_tested_on_its_root_alone(self) -> None:
        self.assertFalse(self.r["drivenMobilePart"])

    def test_a_hull_with_every_part_clear_is_dry(self) -> None:
        self.assertFalse(self.r["clear"])

    def test_a_root_part_in_the_sea_does(self) -> None:
        self.assertTrue(self.r["sunk"])


if __name__ == "__main__":
    unittest.main()
