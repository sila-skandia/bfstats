"""A ship grounds on its own col0 underside (`viewer/ship.js`
`undersideSamples`), not its collision box's bottom face. FHSW's PT boats in
Biak's dock sat over a shelf the box's 1.5 m keel reached and their 0.7 m
stern did not, and could not be driven off it
(`features/fhswe-mechanics-audit`, item 8)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ship import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).with_name("ship_underside_harness.mjs")


class ShipUndersideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for name, source in MODULES.items():
                target = work / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
            (work / "package.json").write_text('{"type":"module"}\n')
            shutil.copyfile(HARNESS, work / "harness.mjs")
            proc = subprocess.run(["node", str(work / "harness.mjs")],
                                  capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_samples_are_the_col0_vertices(self) -> None:
        self.assertEqual(4, self.r["sampleCount"])
        self.assertEqual(-0.7, round(self.r["sternY"], 3))

    def test_three_vertices_or_fewer_are_tested_at_the_first(self) -> None:
        self.assertEqual(1, self.r["few"])

    def test_no_layers_is_no_underside(self) -> None:
        self.assertIsNone(self.r["none"])

    def test_a_shelf_under_the_box_but_not_the_hull_does_not_ground_her(self) -> None:
        self.assertEqual(self.r["box"], 0.9)
        self.assertIsNone(self.r["col0"])

    def test_a_shelf_that_reaches_the_hull_still_grounds_her(self) -> None:
        # The stern vertices, 0.7 m deep at y 9.3: 9.5 - 9.3.
        self.assertEqual(self.r["shoal"], 0.2)

    def test_a_long_hull_skips_the_bed_when_bow_and_stern_are_clear(self) -> None:
        """`checkVsTerrain`'s pre-test for more than ten vertices: a rise under
        the middle alone is not tested while both ends stand R over the bed."""
        self.assertTrue(self.r["midRiseSkipped"])
        self.assertEqual(0.5, self.r["midRiseNearBed"])


if __name__ == "__main__":
    unittest.main()
