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

    def test_samples_are_the_vertices_and_the_grid_on_the_faces(self) -> None:
        # 4 vertices, then the 3 x 9 grid columns the quad covers: x = +-2
        # is outside its 3 m width.
        self.assertEqual(self.r["sampleCount"], 4 + 9)
        self.assertEqual(self.r["gridXs"], [0])

    def test_a_grid_column_takes_the_face_height_over_it(self) -> None:
        self.assertEqual(self.r["bow"], -1.5)
        self.assertEqual(self.r["midship"], -1.1)
        self.assertEqual(self.r["stern"], -0.7)

    def test_no_layers_is_no_underside(self) -> None:
        self.assertIsNone(self.r["none"])

    def test_a_shelf_under_the_box_but_not_the_hull_does_not_ground_her(self) -> None:
        self.assertEqual(self.r["box"], 0.9)
        self.assertIsNone(self.r["col0"])

    def test_a_shelf_that_reaches_the_hull_still_grounds_her(self) -> None:
        # The deepest sample over the shelf (z > 0) is the grid column at
        # z = 3.75, where the hull is 1.0 m deep: 9.5 - 9.0.
        self.assertEqual(self.r["shoal"], 0.5)


if __name__ == "__main__":
    unittest.main()
