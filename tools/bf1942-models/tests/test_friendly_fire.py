"""Friendly fire (`viewer/friendly-fire.js`), driven headless by
`friendly_fire_harness.mjs`.

The rules are the server's (ledger FF-1..FF-5, bf1942_lnxded.static): a round
meets any soldier in its path but its firer and the crew of the hull he fires
from (`PointResponsePhysics::checkObjectVsObject` 0x08257030, no team test on
the way to the damage), and `GameServer::calcDamage` 0x0814b520 scales a hit
on the attacker's own side by the server's percentage over 100, clamped to
[0, 2]: the soldier pair for a soldier, the vehicle pair for a hull or a man
seated in one, the splash pair for a blast. The shipped `ServerSettings.con`
sets all four to 100. The harness wires the page's and the referee's round
paths at 50 / 25 / 10 / 5 so a wrong pair shows.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("friendly_fire_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class FriendlyFireTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the rule -------------------------------------------------------------

    def test_a_percentage_is_a_ratio_clamped_to_two(self) -> None:
        ratio = self.results["ratio"]
        self.assertEqual(1, ratio["shipped"])
        self.assertEqual(0.5, ratio["half"])
        self.assertEqual(0, ratio["zero"])
        self.assertEqual(2, ratio["over"])
        self.assertEqual(0, ratio["under"])
        self.assertEqual(1, ratio["unset"])

    def test_the_shipped_settings_price_a_friend_as_a_foe(self) -> None:
        price = self.results["price"]
        self.assertEqual({"soldier": 100, "vehicle": 100, "soldierSplash": 100, "vehicleSplash": 100},
                         price["shippedSettings"])
        self.assertEqual(40, price["shipped"])

    def test_a_same_side_hit_takes_the_pair_its_victim_picks(self) -> None:
        price = self.results["price"]
        self.assertEqual(20, price["soldier"])
        self.assertEqual(10, price["vehicle"])
        self.assertEqual(4, price["soldierSplash"])
        self.assertEqual(2, price["vehicleSplash"])

    def test_only_teams_one_and_two_on_the_same_side_are_scaled(self) -> None:
        price = self.results["price"]
        self.assertEqual(40, price["enemy"])
        # An empty hull's team is 0 (`clearTeam`), so it is never a friend.
        self.assertEqual(40, price["emptyHull"])
        self.assertEqual(40, price["noSide"])
        self.assertEqual(40, price["unknownRound"])

    def test_a_round_passes_only_its_firer_and_his_own_hulls_crew(self) -> None:
        passes = self.results["passes"]
        self.assertTrue(passes["himself"])
        self.assertTrue(passes["ownCrew"])
        self.assertFalse(passes["otherCrew"])
        self.assertFalse(passes["friendOnFoot"])
        self.assertFalse(passes["enemy"])
        self.assertFalse(passes["fromFootIntoHull"])
        self.assertFalse(passes["unknownFirer"])

    # --- the page's rounds (vehicle-hits.js) ----------------------------------

    def test_a_bots_round_on_a_teammate_is_priced_by_calc_damage(self) -> None:
        rounds = self.results["round"]
        self.assertEqual([["mate", 20]], rounds["botOnMate"])
        self.assertEqual([["foe", 40]], rounds["botOnFoe"])
        self.assertEqual([["local", 20]], rounds["botOnHuman"])
        self.assertEqual([["mate", 20]], rounds["humanOnMate"])

    def test_a_seated_teammate_is_priced_as_his_hull(self) -> None:
        self.assertEqual([["mate", 10]], self.results["round"]["botOnSeatedMate"])

    def test_a_round_nobody_can_name_is_never_scaled(self) -> None:
        self.assertEqual([["mate", 40]], self.results["round"]["orphanOnMate"])

    def test_a_hull_is_a_friend_only_while_its_crew_is(self) -> None:
        hull = self.results["hull"]
        self.assertEqual(10, hull["friendly"])
        self.assertEqual(40, hull["enemy"])
        self.assertEqual(40, hull["empty"])

    def test_a_blast_takes_the_splash_pair(self) -> None:
        splash = self.results["splash"]
        self.assertEqual(1, splash["friendlySoldier"])
        self.assertEqual(10, splash["enemySoldier"])
        self.assertEqual(0.5, splash["friendlyHull"])
        self.assertEqual(10, splash["enemyHull"])
        self.assertEqual(10, splash["emptyHull"])

    # --- the referee's rounds (a bot's hand weapon) ---------------------------

    def test_a_bots_hand_weapon_round_meets_the_first_soldier_in_its_way(self) -> None:
        resolve = self.results["resolve"]
        self.assertEqual({"target": "mate", "damage": 20}, resolve["friendInFront"])
        self.assertEqual({"target": "foe", "damage": 40}, resolve["enemyInFront"])
        self.assertEqual({"target": "foe", "damage": 40}, resolve["deadFriendPassed"])

    def test_a_seated_bots_round_passes_his_own_crew_and_meets_anothers(self) -> None:
        resolve = self.results["resolve"]
        self.assertEqual({"target": "foe", "damage": 40}, resolve["ownCrewPassed"])
        self.assertEqual({"target": "rider", "damage": 10}, resolve["otherCrewMet"])

    def test_the_referee_defaults_to_the_shipped_settings(self) -> None:
        self.assertEqual({"target": "mate", "damage": 40}, self.results["resolve"]["shipped"])


if __name__ == "__main__":
    unittest.main()
