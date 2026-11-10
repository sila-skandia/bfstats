"""The bot-match verifier's vehicle figures (features/bot-map-generation).

A level that places tanks, cars and aircraft is judged on matches played
with them, against a second baseline of DICE levels run the same way. The
detector adds what a player would notice about the vehicles: a hull driven
at a wall, units nobody sat in, a tank seat held for a minute that never
fired, a team kill from a seat, and the mounted share. The judge makes the
vehicle checks only against a baseline that carries their bands.

`tests/bot_judge_vehicles_harness.mjs` runs `sim/detect.mjs` on a
hand-written trace and `sim/judge.mjs` on hand-written rows; the Python half
reads the two baselines kept as source.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "bot_judge_vehicles_harness.mjs"
VEHICLES = ROOT / "sim" / "baselines" / "vehicles-dice.json"
ON_FOOT = ROOT / "sim" / "baselines" / "onfoot-dice.json"

# The checks the judge makes on any match, in its order.
ALWAYS = [
    "stuckSecondsPerBotMinute", "idleShare", "oscillationsPerBotMinute", "selfDeathsPerBotMinute", "spawnTrapsPerBotMinute",
    "routeFailuresPerBotMinute", "redeploysPerBotMinute", "teamKillsPerBotMinute", "capturesTotal", "enemyKillsPerBotMinute",
    "flagCoverage", "bothSidesCapture", "bothSidesKill", "ticketsBleed", "botErrors",
    "stuckSecondsPerBotMinuteWorseSide", "spawnTrapsPerBotMinuteWorseSide", "routeFailuresPerBotMinuteWorseSide",
    "redeploysPerBotMinuteWorseSide", "nonEnemyDeathShareWorseSide",
]
# Every figure the detector writes for a match with vehicles.
ROW_FIELDS = [
    "units", "unitsUsed", "unitsDriven", "unitsNeverUsedShare", "mountedShare", "drivingMinutes", "drivingMinutesBySide",
    "hullStuckEpisodes", "hullStuckSecondsPerDrivingMinute", "hullStuckSecondsBySide", "hullStuckSecondsPerDrivingMinuteBySide",
    "hullStuckSecondsPerDrivingMinuteWorseSide", "hullStuckPlaces", "seatings", "tankSeatings", "tankSeatingsSilent",
    "tankSilentShare", "mountedTeamKills", "mountedTeamKillsPerBotMinute",
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


class VehicleDetectorTests(unittest.TestCase):
    """Two bots a side for 120 s on a level of five units; a Tiger at a wall for fifty of them."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.row = cls.out["row"]

    def test_a_driver_holding_the_throttle_at_a_wall_is_a_stuck_hull(self) -> None:
        self.assertEqual(self.row["hullStuckEpisodes"], 1)
        self.assertAlmostEqual(self.row["hullStuckSecondsBySide"]["1"], 50, delta=2)
        self.assertEqual(self.row["hullStuckSecondsBySide"]["2"], 0)
        place = self.row["hullStuckPlaces"][0]
        self.assertEqual([place["at"], place["templates"]], ["60,-8", ["Tiger"]])

    def test_the_rate_is_per_driving_minute_and_the_worse_side_is_kept(self) -> None:
        # The Axis drive for two minutes, the Allies for 220 seconds.
        self.assertEqual(self.row["drivingMinutesBySide"], {"1": 2, "2": 3.67})
        self.assertEqual(self.row["hullStuckSecondsPerDrivingMinuteBySide"], {"1": 25.5, "2": 0})
        self.assertEqual(self.row["hullStuckSecondsPerDrivingMinuteWorseSide"], 25.5)
        self.assertEqual(self.row["hullStuckSecondsPerDrivingMinute"], 9)

    def test_a_parked_hull_and_a_mounted_bot_are_not_stuck(self) -> None:
        # The Sherman standing with the throttle off is not an episode, and the
        # soldier's detector does not read a seated bot: the Tiger is the only one.
        self.assertEqual(self.row["hullStuckEpisodes"], 1)
        self.assertEqual(self.row["stuckEpisodes"], 0)
        self.assertEqual(self.row["stuckSecondsPerBotMinute"], 0)

    def test_a_unit_nobody_sat_in_counts_against_the_levels_units(self) -> None:
        self.assertEqual([self.row["units"], self.row["unitsUsed"], self.row["unitsDriven"]], [5, 4, 4])
        self.assertEqual(self.row["unitsNeverUsedShare"], 0.2)

    def test_a_tank_seat_held_a_minute_with_no_round_is_silent(self) -> None:
        self.assertEqual(self.out["tankSeatingSeconds"], 60)
        # Four seatings. The Tiger's fired; the first Sherman's did not; the second
        # Sherman's was thirty seconds; the Willy's seat is not a tank's armed one.
        self.assertEqual(self.row["seatings"], 4)
        self.assertEqual([self.row["tankSeatings"], self.row["tankSeatingsSilent"]], [2, 1])
        self.assertEqual(self.row["tankSilentShare"], 0.5)

    def test_with_no_tank_seat_held_there_is_no_silent_share(self) -> None:
        self.assertIsNone(self.out["noTank"]["tankSilentShare"])
        self.assertEqual(self.out["noTank"]["tankSeatings"], 0)
        self.assertEqual(self.out["noTank"]["unitsNeverUsedShare"], 0.8)

    def test_a_team_kill_from_a_seat_is_counted_apart(self) -> None:
        self.assertEqual(self.row["teamKills"], 2)
        self.assertEqual(self.row["mountedTeamKills"], 1)
        self.assertEqual(self.row["mountedTeamKillsPerBotMinute"], 0.125)

    def test_the_mounted_share_is_mounted_seconds_over_alive_seconds(self) -> None:
        self.assertEqual(self.row["mountedShare"], round(340 / 480, 4))

    def test_a_match_with_vehicles_has_every_vehicle_figure_and_one_on_foot_has_none(self) -> None:
        for key in ROW_FIELDS:
            self.assertIn(key, self.row, key)
            self.assertNotIn(key, self.out["footKeys"], key)


class VehicleJudgeTests(unittest.TestCase):
    """A vehicles baseline whose every vehicle figure is 0.1, 0.2 and 0.3: the bar is 0.28."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.lower = cls.out["vehicleLower"]
        cls.context = cls.out["vehicleContext"]

    def test_a_vehicles_baseline_carries_the_bands_after_the_others(self) -> None:
        every = self.lower + self.context
        self.assertEqual(self.out["vehicleMetricOrder"][-len(every):], every)
        for key in every:
            band = self.out["vehicleBands"][key]
            self.assertEqual([band["n"], band["p10"], band["p50"], band["p90"]], [3, 0.12, 0.2, 0.28], key)
            self.assertIn(key, self.out["vehicleLevelMedians"])

    def test_an_on_foot_baseline_carries_none(self) -> None:
        for key in self.lower + self.context:
            self.assertNotIn(key, self.out["footMetricOrder"], key)
            self.assertNotIn(key, self.out["footLevelMedians"], key)

    def test_the_vehicle_checks_follow_the_others_against_a_vehicles_baseline(self) -> None:
        self.assertEqual(self.out["pass"]["metrics"], ALWAYS + self.lower)
        self.assertEqual(self.out["pass"]["verdict"], "pass")

    def test_each_figure_over_its_bar_fails_on_its_own_line(self) -> None:
        for key in self.lower:
            self.assertEqual(self.out["failEach"][key], [key])

    def test_the_context_is_never_judged(self) -> None:
        # The mounted share, and team kills from a seat: the DICE runs give those no bar.
        self.assertEqual(self.context, ["mountedTeamKillsPerBotMinute", "mountedShare"])
        for key in self.context:
            self.assertEqual(self.out["context"][key], [], key)
            self.assertNotIn(key, self.out["pass"]["metrics"])

    def test_a_share_whose_bar_is_the_whole_of_it_is_not_measured(self) -> None:
        ceiling = self.out["ceiling"]
        self.assertEqual(ceiling["share"], 1)
        self.assertEqual(ceiling["failed"], [])
        self.assertFalse(ceiling["check"]["measured"])
        self.assertIn("not measured: the baseline's bar is the measure's ceiling", ceiling["check"]["bar"])

    def test_a_figure_no_seed_has_is_not_measured(self) -> None:
        none = self.out["noFigure"]
        self.assertEqual(none["verdict"], "pass")
        check = next(c for c in none["checks"] if c["metric"] == "tankSilentShare")
        self.assertFalse(check["measured"])
        self.assertIn("not measured: neither side has a figure in any seed", check["bar"])

    def test_rows_of_matches_on_foot_are_read_and_not_measured(self) -> None:
        foot = self.out["footRows"]
        self.assertEqual(foot["verdict"], "pass")
        self.assertEqual([c["metric"] for c in foot["checks"]], self.lower)
        for check in foot["checks"]:
            self.assertTrue(check["pass"], check["metric"])
            self.assertFalse(check["measured"], check["metric"])
            self.assertIn("a match without vehicles", check["bar"])

    def test_the_on_foot_judge_is_unchanged(self) -> None:
        # No vehicle check against the on-foot baseline, whatever the rows hold.
        self.assertEqual(self.out["footBaseline"]["metrics"], ALWAYS)
        self.assertEqual(self.out["footBaseline"]["verdict"], "pass")
        self.assertEqual(self.out["footBaselineOnFoot"]["metrics"], ALWAYS)


class BaselineFileTests(unittest.TestCase):
    """`sim/baselines/vehicles-dice.json` carries the vehicle bands; `onfoot-dice.json` none."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.vehicles = json.loads(VEHICLES.read_text())
        cls.foot = json.loads(ON_FOOT.read_text())

    def test_the_vehicles_baseline_is_of_matches_with_vehicles(self) -> None:
        self.assertIn("with vehicles", self.vehicles["note"])
        self.assertNotIn("--no-vehicles", self.vehicles["note"])
        self.assertEqual(sorted(self.vehicles["sizes"]), ["16", "8"])

    def test_every_vehicle_band_is_there_at_both_sizes(self) -> None:
        for size in ("8", "16"):
            band = self.vehicles["sizes"][size]
            for key in self.out["vehicleLower"] + self.out["vehicleContext"]:
                spread = band["metrics"][key]
                self.assertGreater(spread["n"], 0, f"{size} {key}")
                self.assertLessEqual(spread["p10"], spread["p90"], f"{size} {key}")
                for level in band["levels"]:
                    self.assertIn(key, band["perLevel"][level]["medians"], f"{size} {level} {key}")

    def test_a_judged_bar_is_neither_nothing_with_no_spread_nor_the_ceiling(self) -> None:
        # A bar the DICE runs give no meaning to is reported and left out of the judge.
        shares = {k for k in self.out["vehicleLower"] if k.endswith("Share")}
        for size in ("8", "16"):
            metrics = self.vehicles["sizes"][size]["metrics"]
            for key in self.out["vehicleLower"]:
                self.assertFalse(metrics[key]["max"] == 0, f"{size} {key}: nothing in any match")
                if key in shares:
                    self.assertLess(metrics[key]["p90"], 1, f"{size} {key}: the bar is the ceiling")

    def test_the_on_foot_baseline_has_no_vehicle_band(self) -> None:
        for size in ("8", "16"):
            for key in self.out["vehicleLower"] + self.out["vehicleContext"]:
                self.assertNotIn(key, self.foot["sizes"][size]["metrics"], f"{size} {key}")


if __name__ == "__main__":
    unittest.main()
