"""A control point's cloth when it changes hands.

Reported against FH Omaha Charlie Sector (2026-10-11): Allies taking a neutral
point raised no flag, and taking a German one left the German cloth. Re-baked
from before `patch_flag_cloth.py` and from HEAD, the point cloths are
identical (the patcher only moves meshes whose node `extras.skin` names
`flag.skn`, which a control point's cloth does not carry), and on HEAD the
page swaps the cloth for the human's capture and for bots'. This pins the
swap's contract so a change to the cloth nodes or to `capture.js` that breaks
it fails here: `tests/flag_cloth_swap_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "flag_cloth_swap_harness.mjs"


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class FlagClothSwapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_neutral_point_raises_the_takers_cloth(self) -> None:
        r = self.r
        self.assertTrue(r["raised"])
        self.assertTrue(r["raisedMeshIsSkinned"])
        self.assertTrue(r["raisedAnchorOnPole"])
        self.assertTrue(r["raisedUsCell"])
        # The joints are the point's own, and the inverse binds the donor's:
        # a rebuilt skeleton draws the sheet at the world origin.
        self.assertEqual(["beach_Bone01", "beach_Bone02"], r["raisedNames"])
        self.assertEqual([-1, -2], r["raisedInverses"])
        self.assertTrue(r["donorUntouchedByRaise"])

    def test_a_held_point_repaints_only_its_own_cloth(self) -> None:
        r = self.r
        self.assertTrue(r["swappedUs"])
        self.assertTrue(r["swappedVisible"])
        self.assertTrue(r["siblingStaysGerman"])
        self.assertTrue(r["raisedUntouchedBySwap"])
        self.assertEqual(2, r["entryTeam"])
        self.assertEqual(1, r["entryFounding"])
        self.assertTrue(r["backToGerman"])

    def test_a_nation_without_an_atlas_cell_raises_nothing(self) -> None:
        self.assertTrue(self.r["noCellRaisesNothing"])
        self.assertTrue(self.r["noCellKeepsUv"])


if __name__ == "__main__":
    unittest.main()
