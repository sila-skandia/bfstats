"""The automatic weapon switch and the refused raise (FHX-3).

`BFSoldier::selectBestLoadedWeapon` (lnxded 0x08273a80) walks the kit
template's item list, which `Kit::Kit` (0x08295f60) fills with the kit's
carried items' `itemIndex` in `addTemplate` order, for the first item with
ammunition left (`getTotalAmmo`, -1 for unlimited), and raises it; none, or
index 0, raises the list's first. A spent `ExpPack` in hand raises item 11.
`HandFireArms::enable` (0x08293bd3) refuses a raise when
`cantSelectWhenNoAmmo` (`HandFireArmsTemplate+0x360`) is set and the total is
0. `kit_select_harness.mjs` drives `viewer/kit-select.js` and `kit-ammo.js`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "kit_select_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class KitSelectTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_kit_order_is_its_addtemplate_order(self) -> None:
        order = self.r["order"]
        # Vanilla's medic declares Thompson, Colt, knife, medpack, grenade.
        self.assertEqual(order["vanillaMedic"], [3, 2, 1, 5, 4])
        self.assertEqual(order["fhswGarand"], [3, 6, 4, 1, 2, 7])
        self.assertEqual(order["noItems"], [3, 1])
        self.assertEqual(order["bundle"], [3, 1])

    def test_the_first_loaded_item_in_kit_order_comes_up(self) -> None:
        c = self.r["choice"]
        self.assertEqual(c["grenadesGone"], 3)
        self.assertEqual(c["thompsonAndGrenadesGone"], 2)
        self.assertEqual(c["allGunsGone"], 1)
        self.assertEqual(c["unfilled"], 2)

    def test_nothing_loaded_or_index_zero_raises_the_first(self) -> None:
        c = self.r["choice"]
        self.assertEqual(c["nothingLoaded"], 3)
        self.assertEqual(c["indexZero"], 3)
        self.assertIsNone(c["emptyKit"])

    def test_a_spent_pack_raises_the_detonator(self) -> None:
        c = self.r["choice"]
        self.assertEqual(c["packSpent"], 11)
        self.assertEqual(c["packLeft"], 3)

    def test_cant_select_refuses_only_an_empty_item(self) -> None:
        f = self.r["refusal"]
        self.assertTrue(f["emptyGrenade"])
        self.assertFalse(f["grenadeLeft"])
        self.assertFalse(f["emptyThompson"])

    def test_the_switch_waits_for_the_round_to_be_spent(self) -> None:
        w = self.r["wants"]
        self.assertTrue(w["spent"])
        self.assertTrue(w["bareRig"])
        for case in ("cycling", "hidden", "windingUp", "oneLeft", "spareLeft", "noWord"):
            self.assertFalse(w[case], case)

    def test_the_refusal_word_rides_the_kit_through_a_pickup(self) -> None:
        k = self.r["kitAmmo"]
        self.assertTrue(k["own"])
        self.assertFalse(k["thompson"])
        self.assertTrue(k["adopted"])
        self.assertEqual(k["adoptedTotal"], 0)


if __name__ == "__main__":
    unittest.main()
