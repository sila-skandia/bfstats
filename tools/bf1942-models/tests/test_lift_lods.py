"""`viewer/level-statics.js` `liftLods`: a lightmapped part keeps LOD 0
(ledger LOD-6), its rungs hidden; others lift as before
(`tests/lift_lods_harness.mjs`)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "lift_lods_harness.mjs"


class LiftLodsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_lightmapped_part_is_not_lifted(self) -> None:
        # FHT Golf Hotel's hotel wings drew streaked rungs from 50 m.
        self.assertEqual(self.r["lifted"], ["barn_m1_LOD"])

    def test_its_baked_rung_is_hidden_where_it_hangs(self) -> None:
        self.assertFalse(self.r["litRungVisible"])
        self.assertEqual(self.r["litRungParent"], "O_Hotel_m1")


if __name__ == "__main__":
    unittest.main()
