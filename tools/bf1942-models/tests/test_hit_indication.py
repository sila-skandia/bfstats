"""The crosshair's hit marks: which landings raise them (`vehicle-hits.js`),
driven headless by `hit_indication_harness.mjs`.

The rule is `GameServer::giveDamage`'s (lnxded 0x0814b2e0, ledger XHIT-4 and
XHIT-5): the local player's own round, landing directly on a soldier or on a
hull somebody sits in, before any damage is priced and whatever the teams.
The painting half -- the four turned quads at the timer's alpha -- is
`test_hud.py`'s; the layout half is `test_hud_layout.py`'s.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("hit_indication_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HitIndicationTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_humans_round_on_a_soldier_marks_without_a_damage_floor(self) -> None:
        marks = self.results["marks"]
        self.assertTrue(marks["handOnSoldierNoDamage"])
        self.assertTrue(marks["localSeatOnSoldier"])

    def test_only_the_humans_own_rounds_mark(self) -> None:
        marks = self.results["marks"]
        self.assertFalse(marks["botSeatOnSoldier"])
        self.assertFalse(marks["botOnMannedHull"])
        # A replayed round, or one still flying from a seat since vacated:
        # nobody the page can name.
        self.assertFalse(marks["untaggedOnSoldier"])

    def test_a_hull_marks_only_while_someone_sits_in_it(self) -> None:
        marks = self.results["marks"]
        self.assertTrue(marks["handOnMannedHull"])
        self.assertFalse(marks["handOnEmptyHull"])
        self.assertFalse(marks["handOnWreck"])
        self.assertFalse(marks["handOnScenery"])

    def test_splash_never_marks(self) -> None:
        self.assertFalse(self.results["marks"]["handSplashOnly"])
        self.assertEqual("no throw", self.results["marks"]["nothing"])

    def test_the_humans_rounds_meet_his_teammates(self) -> None:
        cast = self.results["cast"]
        self.assertEqual("friend", cast["handRound"])
        self.assertEqual("friend", cast["localSeatRound"])

    def test_every_round_meets_the_first_soldier_in_its_way(self) -> None:
        # Ledger FF-1: nothing in the engine's contact test compares teams, so
        # a bot's round meets his teammate as the human's does.
        cast = self.results["cast"]
        self.assertEqual("friend", cast["botSeatRound"])
        self.assertEqual("friend", cast["untaggedRound"])

    def test_a_round_passes_the_crew_of_the_hull_it_is_fired_from(self) -> None:
        cast = self.results["cast"]
        self.assertEqual("rider", cast["seatRoundPastOwnCrew"])
        self.assertEqual("mate", cast["handRoundOnACrew"])


if __name__ == "__main__":
    unittest.main()
