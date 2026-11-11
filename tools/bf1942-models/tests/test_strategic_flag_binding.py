"""How the strategic layer binds flags to areas, and what `ControlPoint` counts
(features/bot-map-generation/flag-binding.md).

The engine binds an area to a control point only (`AIStrategicArea::update`
0x0863d6d0, `BFEnvironment::findControlPoint` 0x085e53a0) and its
`ControlPoint` state is the side's control points
(`BFEnvironment::getNumberOfControlPoints` 0x085e4f80 through
`SAI::updateStates` 0x086348c0, which counts the area type flag
`ControlPoint`, 0x10, into no slot). The page's stand-ins (a spawn group no
point claims, a ship's decks) are bound after every control point and only
into an area that holds none, and are no control point.
`tests/strategic_binding_harness.mjs` runs the node half on Edson's Ridge's
shape.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "strategic_binding_harness.mjs"


class FlagBindingTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-2000:])
        cls.out = json.loads(proc.stdout)

    def test_a_capture_only_point_keeps_its_area_from_a_stand_in(self) -> None:
        # Bound in the flags' order, sbWest took West's area and the ship
        # East's, and both Allied flags lay in no area.
        self.assertEqual(self.out["bound"]["West"], ["West"])
        self.assertEqual(self.out["bound"]["East"], ["East"])
        self.assertEqual(self.out["bound"]["AxisBase"], ["AxisBase"])

    def test_a_stand_in_still_holds_an_area_with_no_point(self) -> None:
        self.assertEqual(self.out["bound"]["Pass"], ["sbPass"])
        self.assertEqual(self.out["owners"]["Pass"], 2)

    def test_the_axis_have_a_flag_to_attack(self) -> None:
        self.assertEqual(self.out["axisTargets"], ["West"])

    def test_control_point_counts_control_points_alone(self) -> None:
        # The Allies: AlliedBase, West and East. Not the three stand-ins, and
        # not their three owned areas typed `ControlPoint` again.
        self.assertEqual(self.out["states"]["2"], {"controlPoint": 3, "enemyControlPoint": 1})
        self.assertEqual(self.out["states"]["1"], {"controlPoint": 1, "enemyControlPoint": 3})
        self.assertEqual(self.out["standIns"], ["sbWest", "sbPass", "ship"])


if __name__ == "__main__":
    unittest.main()
