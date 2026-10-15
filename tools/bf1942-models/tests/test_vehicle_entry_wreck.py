"""A wreck has no door (ledger SEAT-28): `viewer/vehicle-entry.js` offers none
and seats nobody in one, whether the E key's scan or a caller naming a seat asks
(`tests/vehicle_entry_wreck_harness.mjs`). FHSWEurope 203 Hill's
Stationary_Vickers, destroyed by the 155 mm battery uphill of it, was manned
through a named seat and then neither aimed nor fired, since a wreck takes no
input (HP-15). `features/fhswe-mechanics-audit/README.md`, item 13."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "vehicle_entry_wreck_harness.mjs"


class VehicleEntryWreckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_scan_offers_the_standing_gun_not_the_nearer_wreck(self) -> None:
        self.assertEqual(self.r["offered"], "Stationary_Vickers_1")

    def test_a_named_seat_of_a_wreck_is_refused(self) -> None:
        self.assertIsNone(self.r["wreckSeated"])
        self.assertNotIn("Stationary_Vickers", self.r["setPilotCalls"])

    def test_a_standing_gun_is_still_taken(self) -> None:
        self.assertEqual(self.r["standingSeated"], "Stationary_Vickers_1")

    def test_a_seat_switch_aboard_a_hull_that_burns_is_not_an_entry(self) -> None:
        self.assertEqual(self.r["switchAboardWreck"], "gunner")
        self.assertEqual(self.r["isWreck"], [True, True])


if __name__ == "__main__":
    unittest.main()
