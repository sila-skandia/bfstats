"""A large root meets a two-layer static's col0, a small one its col1 (ledger
COL-22): `ResponsePhysics::checkObjectVsObject` (lnxded 0x08259690) asks the
face side for `lod = (root radius < 4.0 or a soldier) ? 1 : 0` (the 4.0 at
0x086c0304, compared at 0x08259735). The bake keeps col1; `viewer/coarse-layer.js`
adds the tree's col0 (`collision-meshes.json` `staticCoarse`) as a second index,
and `WorldCollider.staticProbe` reads it for a root of radius 4 m or more
(`body-statics.js` `isCoarseRoot`, the radius `vehicle-bodies.js`
`rootRadiusOf`). Driven by `tests/coarse_layer_harness.mjs`."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "coarse_layer_harness.mjs"


class CoarseLayerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_only_the_placed_two_layer_static_is_swapped(self) -> None:
        self.assertEqual(self.r["swapped"], 1)
        self.assertEqual(self.r["fineMarked"], 2)
        self.assertEqual(self.r["coarseTriangles"], 2)

    def test_a_small_root_meets_col1(self) -> None:
        self.assertEqual(self.r["small"], {"x": 15, "material": 70, "owner": 0, "coarse": False})

    def test_a_large_root_meets_col0_under_the_same_owner(self) -> None:
        self.assertEqual(self.r["large"], {"x": 14, "material": 71, "owner": 0, "coarse": True})

    def test_a_one_layer_static_is_the_same_to_both(self) -> None:
        self.assertEqual(self.r["crateSmall"], self.r["crateLarge"])
        self.assertEqual(self.r["crateLarge"]["x"], 32)

    def test_a_faded_owner_is_gone_from_the_coarse_layer_too(self) -> None:
        self.assertEqual(self.r["largeDisabled"]["owner"], 1)

    def test_the_threshold_is_four_metres_and_inclusive(self) -> None:
        self.assertEqual(self.r["threshold"], 4)
        c = self.r["coarseRoot"]
        self.assertTrue(c["Sherman"]["coarse"])
        self.assertTrue(c["Wespe"]["coarse"])        # 4.06
        self.assertFalse(c["Chi-ha"]["coarse"])      # 3.94
        self.assertFalse(c["Willy"]["coarse"])

    def test_a_root_the_table_does_not_name_meets_col1(self) -> None:
        self.assertIsNone(self.r["coarseRoot"]["Hanomag"]["radius"])
        self.assertFalse(self.r["coarseRoot"]["Hanomag"]["coarse"])


if __name__ == "__main__":
    unittest.main()
