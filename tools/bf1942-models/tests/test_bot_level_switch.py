"""A level switch resets the bot side (`tests/bot_level_switch_harness.mjs`).

The referee's bots, clock, infantry map, strategic AI and covers, and the
units layer's vehicle and water maps, door list and drive kinds, are the old
level's. Before `reset()` a second level in one page session drove its hulls
on the first level's vehicle and water maps, and read the old level's door
list as fresh until its own clock passed the old one. The page calls both
resets when a level starts to go (`level-load.js` `show()` -> `resetBots`).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "bot_level_switch_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class BotLevelSwitchTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_first_level_builds_its_maps(self) -> None:
        before = self.results["withReset"]["before"]
        self.assertEqual(before, {"infantry": 256, "vehicle": 256, "water": 256, "candidatesAt": 120, "bots": 4})

    def test_reset_empties_the_referee_and_the_units(self) -> None:
        gap = self.results["withReset"]["gap"]
        self.assertEqual(gap["bots"], 0)
        self.assertEqual(gap["clock"], 0)
        self.assertIsNone(gap["infantry"])
        self.assertIsNone(gap["strategy"])
        self.assertEqual(gap["covers"], 0)
        self.assertIsNone(gap["vehicle"])
        self.assertEqual(gap["water"], 0)
        self.assertEqual(gap["candidatesAt"], -1)

    def test_a_tick_before_the_next_spawn_does_nothing(self) -> None:
        # No bots: the tick returns before the clock moves.
        self.assertEqual(self.results["withReset"]["gap"]["tickedClock"], 0)

    def test_the_next_level_builds_every_map_again(self) -> None:
        r = self.results["withReset"]
        self.assertEqual(r["after"]["infantry"], 512)
        self.assertEqual(r["after"]["vehicle"], 512)
        self.assertEqual(r["after"]["water"], 512)
        self.assertTrue(r["vehicleLogAgain"])
        self.assertTrue(r["waterLogAgain"])

    def test_the_next_level_rebuilds_the_door_list_on_its_own_clock(self) -> None:
        after = self.results["withReset"]["after"]
        self.assertEqual(after["candidatesAt"], 0)
        self.assertFalse(after["candidatesStale"])

    def test_no_bot_is_carried_across(self) -> None:
        after = self.results["withReset"]["after"]
        self.assertEqual(after["bots"], 4)
        self.assertEqual(after["carried"], 0)

    def test_without_the_reset_the_old_maps_survive(self) -> None:
        # The control: what the page did before the reset was wired.
        r = self.results["withoutReset"]
        self.assertEqual(r["after"]["vehicle"], 256)
        self.assertEqual(r["after"]["water"], 256)
        self.assertTrue(r["after"]["candidatesStale"])
        self.assertFalse(r["vehicleLogAgain"])

    def test_the_page_resets_the_bot_side_when_the_level_goes(self) -> None:
        page = (VIEWER / "map.html").read_text()
        body = re.search(r"function resetBots\(\) \{(.*?)\n\}", page, re.S)
        self.assertIsNotNone(body, "map.html has no resetBots()")
        for call in ("referee.reset()", "botUnits.reset()", "botBodies.disposeBotVisuals()"):
            self.assertIn(call, body.group(1))
        self.assertIn("get resetBots() { return resetBots; }", page)

        level = (VIEWER / "level-load.js").read_text()
        show = level[level.index("async function show(entry)"):]
        reset_at = show.index("page.resetBots();")
        # Before the hulls' seats go and before the new World is built, and
        # after the scene has loaded (a failed load keeps the old level).
        self.assertLess(reset_at, show.index("page.vehicles.clear();"))
        self.assertLess(reset_at, show.index("new World("))
        self.assertGreater(reset_at, show.index("load.finish('scene');"))

    def test_spawn_starts_from_the_reset(self) -> None:
        referee = (VIEWER / "bot-referee.js").read_text()
        spawn = referee[referee.index("referee.spawn = ("):]
        self.assertIn("referee.reset();", spawn[:spawn.index("buildNavMap(")])


if __name__ == "__main__":
    unittest.main()
