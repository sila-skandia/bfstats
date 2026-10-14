"""A seaplane rides the sea on its pontoon and is not drowned by it: a hull is
wet by its root part (ledger PHY-16; `tests/seaplane_water_harness.mjs`).
FHSWEurope Biak's Catfish lost 10 HP a second parked on the water and died."""

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

    def test_a_pontoon_in_the_sea_does_not_wet_the_hull(self) -> None:
        self.assertFalse(self.r["floating"])

    def test_a_root_part_in_the_sea_does(self) -> None:
        self.assertTrue(self.r["sunk"])


if __name__ == "__main__":
    unittest.main()
