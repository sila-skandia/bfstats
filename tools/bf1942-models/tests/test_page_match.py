"""`sim/pagematch.mjs`: a match on the page itself, read through its hooks
(features/bot-map-generation, section 20).

The match needs a browser and the network and is not run here. These are
its pure parts: the tally by side, where a team-kill victim stood against
the shooter's line, and the URL it opens.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "page_match_harness.mjs"

_OUT: dict | None = None


def run_harness() -> dict:
    global _OUT
    if _OUT is None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"page_match_harness.mjs failed:\n{proc.stderr[-3000:]}")
        _OUT = json.loads(proc.stdout.strip().splitlines()[-1])
    return _OUT


class Tally(unittest.TestCase):
    def test_a_sides_deaths_no_enemy_caused_are_its_deaths_less_the_other_sides_kills(self):
        s = run_harness()["summary"]
        one, two = s["sides"]["1"], s["sides"]["2"]
        self.assertEqual((one["kills"], one["deaths"], one["teamKills"], one["suicides"]), (4, 6, 2, 1))
        # Side 1 died 6 times and side 2 killed 2 of them: 4 were its own doing.
        self.assertEqual(one["deathsNoEnemyCaused"], 4)
        self.assertEqual(one["nonEnemyDeathShare"], 0.667)
        self.assertEqual(two["deathsNoEnemyCaused"], 1)
        self.assertEqual(s["nonEnemyDeathShareWorseSide"], 0.667)

    def test_rates_are_over_the_bots_listed_not_the_rows_counted(self):
        s = run_harness()["summary"]
        # 3 team kills, 16 bots, 10 minutes: a bot nothing happened to has no row.
        self.assertAlmostEqual(s["teamKillsPerBotMinute"], 3 / 160, places=3)
        self.assertEqual(s["enemyKillsPerBotMinute"], 0.0375)
        self.assertEqual(s["capturesTotal"], 1)

    def test_a_row_with_no_side_is_in_the_totals_and_in_neither_side(self):
        s = run_harness()["unsided"]
        self.assertEqual(set(s["sides"]), {"1"})
        self.assertEqual(s["unassigned"]["captures"], 2)
        self.assertEqual(s["capturesTotal"], 3)
        self.assertNotIn("unassigned", run_harness()["summary"])

    def test_a_match_nothing_happened_in(self):
        s = run_harness()["empty"]
        self.assertEqual(s["sides"], {})
        self.assertEqual(s["teamKillsPerBotMinute"], 0)
        self.assertEqual(s["nonEnemyDeathShareWorseSide"], 0)


class LineOfFire(unittest.TestCase):
    def test_a_victim_between_shooter_and_target_is_on_the_line(self):
        self.assertEqual(run_harness()["ahead"], {"along": 12, "off": 0.3, "target": 100})

    def test_one_behind_or_beside_is_not(self):
        out = run_harness()
        self.assertLess(out["behind"]["along"], 0)
        self.assertEqual(out["beside"]["off"], 6)


class PageBar(unittest.TestCase):
    def test_the_bar_is_the_worst_any_dice_match_showed(self):
        bar = run_harness()["pageBar"]
        self.assertEqual(bar["teamKillsPerBotMinute"]["limit"], 0.06)
        self.assertEqual(bar["nonEnemyDeathShareWorseSide"]["limit"], 0.4)
        # Enemy kills are the one figure where less is worse.
        self.assertEqual(bar["enemyKillsPerBotMinute"]["limit"], 0.22)
        self.assertEqual(bar["enemyKillsPerBotMinute"]["worst"], "min")

    def test_a_levels_median_is_held_to_it(self):
        out = run_harness()
        # One match over the bar in three does not fail a level: the median does.
        self.assertEqual(out["pageOk"]["verdict"], "pass")
        shoots = out["pageShoots"]
        self.assertEqual(shoots["verdict"], "fail")
        self.assertEqual(shoots["failed"], ["teamKillsPerBotMinute", "nonEnemyDeathShareWorseSide"])
        self.assertEqual(out["pageQuiet"]["failed"], ["enemyKillsPerBotMinute"])

    def test_with_no_bar_nothing_is_judged(self):
        none = run_harness()["pageNoBar"]
        self.assertEqual(none["verdict"], "pass")
        self.assertTrue(all(c["pass"] is None and c["bar"] == "not measured" for c in none["checks"]))


class Url(unittest.TestCase):
    def test_the_hooks_need_shots_and_a_vanilla_level_names_no_mod(self):
        out = run_harness()
        self.assertEqual(out["vanilla"],
                         "https://play.bfstats.io/map.html?map=Berlin&team=2&mode=Conquest&botCount=16&botSkill=0.75&mute&shots")
        self.assertIn("mod=community", out["mod"])
        self.assertIn("botCount=32", out["mod"])


    def test_a_match_that_counted_nothing_is_void(self) -> None:
        # No row at all, a match with kills, a match with captures only: captures do not make a match.
        self.assertEqual(run_harness()["voids"], [True, False, True])

if __name__ == "__main__":
    unittest.main()
