"""`viewer/strategic.js` under node (`tests/strategic_harness.mjs`).

The strategic AI as the engine runs it (bot-behaviours.md §7): areas bound
to the level's control points, a strategy chosen per side through its
prerequisites, attack targets among the areas the side does not hold that
touch one it does, and a WPMoveTo order for every bot. Runs on El Alamein's
extracted `scene.json` when it is present, else on an inline fixture.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "strategic_harness.mjs"
SCENE = VIEWER / "maps" / "el_alamein" / "scene.json"


def run_harness(scene: Path | None) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "strategic.js", work / "strategic.js")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        cmd = ["node", str(work / "harness.mjs")] + ([str(scene)] if scene else [])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StrategicFixtureTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(None)

    def test_conditions_compare_as_the_engine_does(self) -> None:
        c = self.results["compare"]
        self.assertEqual(c["crispGreaterTrue"], 1)
        self.assertEqual(c["crispGreaterFalse"], -1)
        self.assertEqual(c["fuzzySmaller"], 150)
        self.assertEqual(c["fuzzyEqual"], -3)
        self.assertEqual(c["quotientZero"], 1)

    def test_areas_take_their_control_points_owner(self) -> None:
        owners = {a["name"]: a["owner"] for a in self.results["areas"]}
        self.assertEqual(owners, {"AxisBase": 1, "Mid": 0, "AlliedBase": 2})

    def test_each_side_picks_a_strategy_and_attacks_the_middle(self) -> None:
        for side in ("1", "2"):
            s = self.results["sides"][side]
            self.assertEqual(s["strategy"], "broad")
            self.assertEqual(s["attacks"], ["Mid"], s)

    def test_the_attack_collects_its_wanted_strength_and_the_rest_hold(self) -> None:
        # A neutral area wants `round(2 * 1 * 1.25)` = 3 units; the fourth bot
        # of each side is retained at its base (`retainBot`) with no urgency
        # to move, being inside an owned area.
        for side in ("1", "2"):
            orders = [o for b, o in self.results["orders"].items() if b.startswith(f"bot_{side}_")]
            self.assertTrue(all(o is not None for o in orders))
            attacking = [o for o in orders if o["area"] == "Mid"]
            holding = [o for o in orders if o["area"] != "Mid"]
            self.assertEqual(len(attacking), 3, orders)
            self.assertEqual(len(holding), 1, orders)
            for o in attacking:
                self.assertGreaterEqual(o["radius"], 5.0)
                self.assertGreater(o["urgency"], 0)
            self.assertEqual(holding[0]["urgency"], 0)


class StrategicElAlameinTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if not SCENE.exists():
            raise unittest.SkipTest("el_alamein is not extracted")
        cls.results = run_harness(SCENE)

    def test_the_bases_are_owned_and_the_open_bases_neutral(self) -> None:
        owners = {a["name"]: a["owner"] for a in self.results["areas"]}
        self.assertEqual(owners["AxisBase"], 1)
        self.assertEqual(owners["AlliedBase"], 2)
        self.assertEqual(owners["easternbase"], 0)

    def test_both_sides_choose_a_shipped_strategy(self) -> None:
        for side in ("1", "2"):
            s = self.results["sides"][side]
            self.assertIn(s["strategy"], ["flank", "broad", "breakOut", "cleanUp"])
            self.assertTrue(s["attacks"], s)

    def test_bots_are_ordered_out_of_their_bases(self) -> None:
        for bot, order in self.results["orders"].items():
            self.assertIsNotNone(order, bot)
            self.assertNotIn(order["area"], ("AxisBase", "AlliedBase"), bot)


if __name__ == "__main__":
    unittest.main()
