"""A hull is wet when any collidable part's lowest col0 vertex is under the sea
(ledger HP-21, read from the server binary; `tests/seaplane_water_harness.mjs`):
FHSWEurope Biak's parked Catfish, its pontoon 0.89 m under, is billed 10 HP a
second, as retail bills it. 6aef47c1 had wet a hull by its root part alone, a
rule nothing in the binary supports."""

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

    def test_a_pontoon_in_the_sea_wets_the_hull(self) -> None:
        self.assertTrue(self.r["floating"])

    def test_a_hull_with_every_part_clear_is_dry(self) -> None:
        self.assertFalse(self.r["clear"])

    def test_a_root_part_in_the_sea_does(self) -> None:
        self.assertTrue(self.r["sunk"])


if __name__ == "__main__":
    unittest.main()
