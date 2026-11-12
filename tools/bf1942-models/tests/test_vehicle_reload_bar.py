"""`viewer/vehicle-hud.js` `readyFraction`, the vehicle reload bars, under node.

Retail's feeder (ledger VHUD-10, client `Vehicle::updateAmmoBar` 0x006d6af0,
called from 0x006d71ad): `f = reloadLeft / reloadTime` while more than 0.1 s
of reload is left, else `f = fireLeft / (1 / roundOfFire)` while more than
0.1 s of the shot interval is left, else 0; `Ammo/ReloadTime` (first weapon)
and `Ammo/ReloadTimeSecondary` (second) are `1 - f`. No overheat term.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "vehicle_reload_bar_harness.mjs"


@unittest.skipUnless(shutil.which("node"), "node not installed")
class VehicleReloadBarTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HARNESS)], cwd=ROOT, capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_ready_is_full(self):
        self.assertEqual(self.r["ready"], 1)

    def test_reload_fraction(self):
        self.assertEqual(self.r["reloading"], 0.5)

    def test_reload_takes_priority_not_max(self):
        self.assertEqual(self.r["reloadWinsOverFire"], 0.75)

    def test_shot_interval_fraction(self):
        self.assertAlmostEqual(self.r["fireOnly"], round(1 - 1.43 * 0.35, 4), places=4)

    def test_dead_bands(self):
        self.assertAlmostEqual(self.r["reloadDeadBand"], round(1 - 2 * 0.35, 4), places=4)
        self.assertEqual(self.r["fireDeadBand"], 1)

    def test_no_overheat_term(self):
        self.assertEqual(self.r["overheatIgnored"], 1)

    def test_empty_slot(self):
        self.assertIsNone(self.r["noWeapon"])


if __name__ == "__main__":
    unittest.main()
