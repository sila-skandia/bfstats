"""A floating ship steps its own held key parts (GUN-2), 2026-10-28.

FHSWEurope's Hamakaze and HMS_Laforey roll their front gun's round selector
and HUD needle on the arrows (`c_PIPitch`, not `setAutomaticReset`). Their
seat is the ship's root, whose rig leaves its levers to the drive, and the
drive's tick law (`ship.js` `#integrateLaw`) never ran `advanceSurfaces`: the
selector stayed on its first round (`veh.selector-dead`). Driven headless by
`ship_held_axis_harness.mjs` on the lab Daihatsu's hull.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "ship_law_daihatsu_wake.json.gz"
HARNESS = HERE / "ship_held_axis_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ShipHeldAxisTests(unittest.TestCase):
    result: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS), str(FIXTURE)],
                              capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.result = json.loads(proc.stdout.strip().splitlines()[-1])

    def rows(self) -> dict:
        return {r["label"]: r for r in self.result["withParts"]}

    def test_she_floats_on_the_law_throughout(self) -> None:
        self.assertTrue(all(r["law"] for r in self.result["withParts"]))

    def test_the_arrow_rolls_the_selector_and_needle_and_release_holds(self) -> None:
        rows = self.rows()
        self.assertEqual(rows["rest"]["GunSelector"], 0)
        for label in ("down", "released"):
            self.assertAlmostEqual(abs(rows[label]["GunSelector"]), 180, places=1)
            self.assertAlmostEqual(rows[label]["AmmoNeedle_Rot"], -90, places=1)

    def test_the_other_arrow_brings_the_first_round_back(self) -> None:
        rows = self.rows()
        for label in ("up", "released2"):
            self.assertAlmostEqual(rows[label]["GunSelector"], 0, places=1)
            self.assertAlmostEqual(rows[label]["AmmoNeedle_Rot"], 0, places=1)

    def test_the_parts_do_not_move_the_hull(self) -> None:
        for a, b in zip(self.result["withParts"], self.result["bare"]):
            self.assertEqual(a["position"], b["position"])


if __name__ == "__main__":
    unittest.main()
