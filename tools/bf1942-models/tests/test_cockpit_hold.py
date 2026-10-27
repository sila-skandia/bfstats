"""The Inside view hides a seat's exterior before its interior lands.

Spot check of the live site (2026-10-27): boarding a Ju 87 on FHSWEurope's
Kharkov and Tobruk showed a black pentagon over 60 % of the pilot's view. The
fuselage `StukaCockpitExternal` carries a front-facing bulkhead behind the
eye, and it was drawn until `Ju87D.cockpit.glb` was grafted, where retail
flips the cockpit LodObject the moment the Inside view is on (ledger LOD-2).

Run under node through `cockpit_hold_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "cockpit_hold_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CockpitHoldTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_exterior_is_the_seats_own_cockpit_alternative(self) -> None:
        exterior = self.results["exterior"]
        # Not the outer DistCompareSelector2 LOD, not the propeller's.
        self.assertEqual(["StukaCockpitExternal"], exterior["pilot"])
        self.assertEqual(["RearGunExternal"], exterior["gunner"])
        self.assertEqual([], exterior["stranger"])

    def test_the_inside_view_hides_the_fuselage_before_the_interior_lands(self) -> None:
        # [fuselage, rear gunner's exterior, propeller]
        pending = self.results["pending"]
        self.assertEqual([False, True, True], pending["entered"])
        self.assertEqual([True, True, True], pending["outside"])
        self.assertEqual([False, True, True], pending["inside"])
        self.assertEqual([True, False, True], pending["gunner"])

    def test_a_vehicle_with_no_interior_gets_its_exterior_back(self) -> None:
        missing = self.results["missing"]
        self.assertFalse(missing["entered"])
        self.assertTrue(missing["landed"])
        self.assertIsNone(missing["got"])
        self.assertFalse(missing["pending"])


if __name__ == "__main__":
    unittest.main()
