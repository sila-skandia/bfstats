"""The bot-match verifier's figures by side (features/bot-map-generation).

A rate taken over both sides halves a fault only one side has: on The_Maze
16 of 19 redeploys in a traced match were one side's, and the bar saw half
of what a player watching that side saw. The detector keeps each movement
rate by side with the worse side's as its own field, and the share of a
side's deaths and redeploys that no enemy caused; the judge holds the worse
side to the DICE runs' own worse-side spread.

`tests/bot_judge_sides_harness.mjs` runs `sim/detect.mjs` on a hand-written
trace and `sim/judge.mjs` on hand-written rows; the Python half reads the
baseline kept as source.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "bot_judge_sides_harness.mjs"
BASELINE = ROOT / "sim" / "baselines" / "onfoot-dice.json"

WORSE_SIDE = [
    "stuckSecondsPerBotMinuteWorseSide", "spawnTrapsPerBotMinuteWorseSide", "routeFailuresPerBotMinuteWorseSide",
    "redeploysPerBotMinuteWorseSide", "nonEnemyDeathShareWorseSide",
]
# The checks the judge made before the sides, in its order.
BEFORE = [
    "stuckSecondsPerBotMinute", "idleShare", "oscillationsPerBotMinute", "selfDeathsPerBotMinute", "spawnTrapsPerBotMinute",
    "routeFailuresPerBotMinute", "redeploysPerBotMinute", "teamKillsPerBotMinute", "capturesTotal", "enemyKillsPerBotMinute",
    "flagCoverage", "bothSidesCapture", "bothSidesKill", "ticketsBleed", "botErrors",
]

_OUT: dict | None = None


def run_harness() -> dict:
    global _OUT
    if _OUT is None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-2000:])
        _OUT = json.loads(proc.stdout)
    return _OUT


class DetectorSideTests(unittest.TestCase):
    """Two bots a side for 120 s: four bot-minutes each. The Axis takes all four redeploys."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.row = cls.out["fromTrace"]

    def test_each_side_has_its_own_bot_minutes(self) -> None:
        self.assertEqual(self.row["botMinutesBySide"], {"1": 4, "2": 4})
        self.assertEqual(self.row["botMinutes"], 8)

    def test_one_sides_redeploys_are_twice_the_two_side_rate_on_that_side(self) -> None:
        row = self.out["fromSummary"]
        self.assertEqual(row["redeploysBySide"], {"1": 4, "2": 0})
        self.assertEqual(row["redeploysPerBotMinute"], 0.5)
        self.assertEqual(row["redeploysPerBotMinuteBySide"], {"1": 1, "2": 0})
        self.assertEqual(row["redeploysPerBotMinuteWorseSide"], 1)

    def test_route_failures_stuck_seconds_and_spawn_traps_are_split_the_same_way(self) -> None:
        self.assertEqual(self.row["routeFailuresBySide"], {"1": 3, "2": 1})
        self.assertEqual(self.row["routeFailuresPerBotMinuteWorseSide"], 0.75)
        # bot_0's forty seconds at the wall are the Axis's alone.
        self.assertEqual(self.row["stuckSecondsBySide"]["2"], 0)
        self.assertAlmostEqual(self.row["stuckSecondsBySide"]["1"], 40, delta=2)
        self.assertEqual(self.row["stuckSecondsPerBotMinuteWorseSide"], self.row["stuckSecondsPerBotMinuteBySide"]["1"])
        self.assertAlmostEqual(self.row["stuckSecondsPerBotMinuteWorseSide"], 2 * self.row["stuckSecondsPerBotMinute"], places=2)
        # The Allied soldier killed four seconds and ten metres from the spawn.
        self.assertEqual(self.row["spawnTrapsBySide"], {"1": 0, "2": 1})
        self.assertEqual(self.row["spawnTrapsPerBotMinuteBySide"], {"1": 0, "2": 0.25})
        self.assertEqual(self.row["spawnTrapsPerBotMinuteWorseSide"], 0.25)

    def test_with_a_summary_the_counts_are_its_per_bot_lines_by_side(self) -> None:
        # The trace has three failed routes on the Axis side, the summary's lines five.
        row = self.out["fromSummary"]
        self.assertEqual(row["routeFailuresBySide"], {"1": 5, "2": 1})
        self.assertEqual(row["routeFailuresPerBotMinute"], 0.75)
        self.assertEqual(row["routeFailuresPerBotMinuteWorseSide"], 1.25)

    def test_the_death_share_is_what_no_enemy_caused_over_all_that_is_shown(self) -> None:
        axis, allies = self.row["deathsBySide"]["1"], self.row["deathsBySide"]["2"]
        # Four redeploys and a death by nobody's hand, against one enemy kill.
        self.assertEqual(axis, {"byEnemy": 1, "self": 1, "byTeam": 0, "redeploys": 4, "notEnemy": 5, "shown": 6})
        # A team kill, against three enemy kills.
        self.assertEqual(allies, {"byEnemy": 3, "self": 0, "byTeam": 1, "redeploys": 0, "notEnemy": 1, "shown": 4})
        self.assertEqual(self.row["nonEnemyDeathShareBySide"], {"1": 0.8333, "2": 0.25})
        self.assertEqual(self.row["nonEnemyDeathShareWorseSide"], 0.8333)

    def test_the_two_side_figures_are_untouched(self) -> None:
        self.assertEqual([self.row["deaths"], self.row["selfDeaths"], self.row["teamKills"]], [6, 1, 1])
        self.assertEqual(self.row["enemyKills"], {"1": 3, "2": 1})
        self.assertEqual(self.row["spawnTraps"], 1)

    def test_a_side_with_nothing_to_show_has_no_share(self) -> None:
        one = self.out["oneDeath"]
        self.assertEqual(one["nonEnemyDeathShareBySide"], {"1": None, "2": 0})
        # The worse side is the one that has a share.
        self.assertEqual(one["nonEnemyDeathShareWorseSide"], 0)
        quiet = self.out["quiet"]
        self.assertEqual(quiet["nonEnemyDeathShareBySide"], {"1": None, "2": None})
        self.assertIsNone(quiet["nonEnemyDeathShareWorseSide"])
        # A rate is still a rate there: nothing over four bot-minutes.
        self.assertEqual(quiet["redeploysPerBotMinuteWorseSide"], 0)
        self.assertEqual(self.out["worseSide"], [0.5, 0.1, None, None])

    def test_the_side_is_the_headers_or_the_tick_lines(self) -> None:
        row = self.out["sidesFromTicks"]
        self.assertEqual(row["botMinutesBySide"], {"1": 4, "2": 4})
        self.assertEqual(row["redeploysBySide"], {"1": 0, "2": 1})
        self.assertEqual(row["nonEnemyDeathShareBySide"], {"1": None, "2": 1})

    def test_a_trace_that_names_no_side_still_gives_a_row(self) -> None:
        row = self.out["noSides"]
        self.assertEqual(row["botMinutes"], 8)
        self.assertEqual(row["selfDeaths"], 1)
        self.assertEqual(row["botMinutesBySide"], {"1": 0, "2": 0})
        for key in WORSE_SIDE:
            self.assertIsNone(row[key], key)


class JudgeSideTests(unittest.TestCase):
    """A baseline whose redeploys are 0.10, 0.15, 0.20 over both sides and 0.12, 0.20, 0.30 on the worse one."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_worse_side_has_its_own_band_after_the_others(self) -> None:
        self.assertEqual(self.out["worseSideKeys"], WORSE_SIDE)
        self.assertEqual(self.out["metricOrder"][-len(WORSE_SIDE):], WORSE_SIDE)
        self.assertEqual(self.out["metricOrder"][:-len(WORSE_SIDE)][-1], "firstCapture")
        band = self.out["bands"]["redeploysPerBotMinuteWorseSide"]
        self.assertEqual([band["n"], band["p10"], band["p50"], band["p90"]], [3, 0.136, 0.2, 0.28])
        # The bar is the worse sides' own spread, not the two-side one.
        self.assertEqual(self.out["bandBothSides"]["p90"], 0.19)
        self.assertEqual(self.out["levelMedians"]["redeploysPerBotMinuteWorseSide"], 0.2)
        self.assertEqual(self.out["levelMedians"]["nonEnemyDeathShareWorseSide"], 0.3)

    def test_the_new_checks_follow_the_old_ones_in_their_order(self) -> None:
        self.assertEqual(self.out["checkOrder"], BEFORE + WORSE_SIDE)

    def test_two_even_sides_pass(self) -> None:
        self.assertEqual(self.out["even"]["verdict"], "pass")
        self.assertEqual(self.out["even"]["failed"], [])

    def test_one_side_over_the_bar_fails_though_the_average_passes(self) -> None:
        lop = self.out["lopsided"]
        self.assertTrue(lop["average"]["pass"])
        self.assertEqual([lop["average"]["median"], lop["average"]["bar"]], [0.16, "<= 0.19"])
        self.assertFalse(lop["worse"]["pass"])
        self.assertEqual([lop["worse"]["median"], lop["worse"]["bar"]], [0.32, "<= 0.28"])
        self.assertEqual(lop["failed"], ["redeploysPerBotMinuteWorseSide"])
        self.assertEqual(lop["verdict"], "fail")
        # Which side it was, seed by seed.
        self.assertEqual(lop["worse"]["worseSideSeeds"], {"1": 2, "2": 1})

    def test_the_median_over_the_seeds_is_judged(self) -> None:
        self.assertEqual(self.out["oneBadSeed"], [])

    def test_a_side_dying_by_its_own_hand_fails_on_its_own_line(self) -> None:
        self.assertEqual(self.out["dying"]["failed"], ["nonEnemyDeathShareWorseSide"])
        self.assertEqual([self.out["dying"]["check"]["median"], self.out["dying"]["check"]["bar"]], [0.75, "<= 0.38"])

    def test_a_seed_with_no_share_is_left_out_and_the_bar_says_so(self) -> None:
        some = self.out["someShare"]["check"]
        self.assertTrue(some["pass"])
        self.assertEqual([some["median"], some["seeds"]], [0.25, 2])
        self.assertIn("2 of 3 seeds", some["bar"])
        none = self.out["noShare"]
        self.assertEqual(none["failed"], [])
        self.assertFalse(none["check"]["measured"])
        self.assertIn("not measured", none["check"]["bar"])

    def test_rows_from_before_the_sides_are_read_and_not_measured(self) -> None:
        old = self.out["oldRows"]
        self.assertEqual(old["verdict"], "pass")
        self.assertEqual([c["metric"] for c in old["checks"]], WORSE_SIDE)
        for check in old["checks"]:
            self.assertTrue(check["pass"], check["metric"])
            self.assertFalse(check["measured"], check["metric"])
            self.assertIsNone(check["median"])
            self.assertIn("not measured", check["bar"])
        # They still fail what they failed before.
        self.assertEqual(self.out["oldRowsStillFail"], ["redeploysPerBotMinute"])

    def test_a_baseline_from_before_the_bands_fails_nothing_new(self) -> None:
        self.assertEqual(self.out["oldBaseline"]["failed"], [])
        for bar in self.out["oldBaseline"]["bars"]:
            self.assertIn("not measured: the baseline has no band", bar)


class BaselineFileTests(unittest.TestCase):
    """`sim/baselines/onfoot-dice.json` carries the worse-side bands, from the same eighty matches."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.sizes = json.loads(BASELINE.read_text())["sizes"]

    def test_every_worse_side_band_is_there_at_both_sizes(self) -> None:
        for size in ("8", "16"):
            band = self.sizes[size]
            for key in WORSE_SIDE:
                spread = band["metrics"][key]
                self.assertEqual(spread["n"], band["matches"], f"{size} {key}")
                self.assertLessEqual(spread["p10"], spread["p50"])
                self.assertLessEqual(spread["p50"], spread["p90"])
                for level in band["levels"]:
                    self.assertIn(key, band["perLevel"][level]["medians"], f"{size} {level} {key}")

    def test_a_worse_side_is_never_better_than_the_two_sides_together(self) -> None:
        # The greater of two rates is at least their weighted mean, match by
        # match, so each quantile of the one is at least that of the other.
        for size in ("8", "16"):
            metrics = self.sizes[size]["metrics"]
            for key in WORSE_SIDE[:4]:
                both = metrics[key.removesuffix("WorseSide")]
                for q in ("p10", "p50", "p90"):
                    self.assertGreaterEqual(metrics[key][q] + 0.002, both[q], f"{size} {key} {q}")


if __name__ == "__main__":
    unittest.main()
