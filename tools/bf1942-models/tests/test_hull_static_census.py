"""`audit_mod.py` placement, cause `hull-sunk-in-static`: after the load
settle's static rule (`viewer/static-settle.js`) no hull of FHSWEurope's
Operation Da is left sunk into a static, the P-40 in its hangar among them
(`surveys/census_hulls_on_statics.mjs`). Skips where the tree is not
extracted."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
LEVEL = HERE / "viewer" / "maps" / "mods" / "fhsweurope" / "operation_da-1943" / "scene.glb"


class HullStaticCensusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None or not LEVEL.is_file():
            raise unittest.SkipTest("node or the fhsweurope tree is missing")
        proc = subprocess.run(
            ["node", str(HERE / "surveys" / "census_hulls_on_statics.mjs"), "--trees", "fhsweurope",
             "--levels", "operation_da-1943", "--json", "-"],
            capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.rows = json.loads(proc.stdout)["fhsweurope"]["rows"]["operation_da-1943"]

    def test_the_p40_was_placed_into_its_hangar_floor(self) -> None:
        p40 = next(r for r in self.rows if r["hull"] == "P40")
        self.assertGreater(p40["sunk"], 1.5)
        self.assertTrue(p40["letDown"])

    def test_no_hull_is_left_sunk_after_the_settle(self) -> None:
        self.assertEqual([r for r in self.rows if r["residual"] > 0.05], [])


if __name__ == "__main__":
    unittest.main()
