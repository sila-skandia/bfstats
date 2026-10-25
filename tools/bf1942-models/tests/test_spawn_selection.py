"""The spawn screen's selection, retail's way (ledger SPAWNGRP-12).

Retail's spawn map keeps the selected group in `BfMap+0xd4`: zero until the
first click (`BfMap::BfMap` 0x0046e6be), written by nothing but a click on a
drawn group (0x0046981c), committed by the screen's close (0x004679e0), and
never reset by a death, a change of side or a level change (the map and the
menu are built once, at the game's start). A click away from every ring keeps
it (the pick starts from `BfMap+0xd8`), except after a change of side, which
zeroes that base. The server clears the player's group whenever it stands
him (`GameServer::spawnPlayer` 0x0814c990), so a death asks for the
committed group again. `tests/spawn_selection_harness.mjs` drives the page's
own `spawning.js` against a stand-in page.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "spawn_selection_harness.mjs"
NONE = {"unchosen": True, "choice": None, "committed": None, "index": -1}


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class SpawnSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_nothing_is_chosen_until_a_click(self) -> None:
        solo = self.r["solo"]
        self.assertEqual(NONE, solo["fresh"])
        self.assertEqual(NONE, solo["reopened"])
        self.assertEqual(NONE, solo["missFirst"])

    def test_a_commit_with_nothing_chosen_spawns_nobody(self) -> None:
        self.assertEqual({"spawned": False, "soldier": False, "up": False, "sent": 0},
                         self.r["solo"]["freeRoam"])
        self.assertEqual({"sent": 0, "waiting": False, "up": False}, self.r["sidecar"]["noClick"])

    def test_a_click_selects_and_a_miss_keeps_it(self) -> None:
        solo = self.r["solo"]
        chosen = {"unchosen": False, "choice": {"group": 4, "index": 1}, "committed": None, "index": 1}
        self.assertEqual(chosen, solo["clicked"])
        self.assertEqual(chosen, solo["missKeeps"])

    def test_the_close_commits_and_a_death_keeps_the_choice(self) -> None:
        solo = self.r["solo"]
        self.assertTrue(solo["spawned"])
        self.assertEqual({"group": 4, "index": 1}, solo["afterCommit"]["committed"])
        self.assertEqual({"group": 4, "index": 1}, solo["dead"]["choice"])
        self.assertEqual({"group": 4, "index": 1}, solo["dead"]["committed"])
        self.assertTrue(solo["respawned"])
        self.assertEqual("1", solo["select"])

    def test_a_change_of_side_takes_the_commit_and_the_click_base(self) -> None:
        side = self.r["side"]
        self.assertEqual({"group": 4, "index": 1}, side["sideChanged"]["choice"])
        self.assertIsNone(side["sideChanged"]["committed"])
        self.assertEqual([2, 3], side["sideChanged"]["offered"])
        # after the change, a click on open ground lands on the zeroed base
        self.assertEqual(NONE, side["missAfterSide"])
        self.assertEqual({"group": 65, "index": 3}, side["deck"]["choice"])
        self.assertEqual(65, side["deck"]["group"])

    def test_a_level_change_keeps_the_group_and_drops_the_commit(self) -> None:
        level = self.r["level"]
        self.assertEqual({"group": 65, "index": 3}, level["committedBefore"])
        self.assertEqual({"group": 65, "index": None}, level["level"]["choice"])
        self.assertIsNone(level["level"]["committed"])
        self.assertEqual(3, level["level"]["index"])

    def test_naming_a_flag_picks_its_first_drawn_ring(self) -> None:
        sel = self.r["select"]
        self.assertTrue(sel["ship"])
        self.assertEqual({"group": 64, "index": 3}, sel["choice"])
        self.assertEqual(1, sel["team"])
        self.assertEqual({"group": 3, "index": 0}, sel["land"]["choice"])

    def test_a_sidecar_page_asks_for_the_clicked_group(self) -> None:
        sc = self.r["sidecar"]
        self.assertEqual(NONE | {"offered": [0, 1]}, sc["fresh"])
        self.assertEqual([{"type": "spawn", "group": 3, "flag": 0}], sc["asked"]["sent"])
        self.assertTrue(sc["asked"]["waiting"])
        self.assertFalse(sc["asked"]["up"])
        self.assertEqual({"group": 3, "index": 0}, sc["asked"]["committed"])
        self.assertTrue(sc["stood"])

    def test_a_death_asks_for_the_committed_group_with_no_click(self) -> None:
        sc = self.r["sidecar"]
        self.assertEqual({"sent": [3], "waiting": True, "up": True}, sc["deathAsk"])
        self.assertTrue(sc["restood"])

    def test_the_offer_is_the_servers_table(self) -> None:
        taken = self.r["sidecar"]["taken"]
        self.assertEqual([1], taken["allied"])
        self.assertEqual([1], taken["off"])
        self.assertEqual([0, 1, 2], taken["beachAllied"])

    def test_a_committed_group_that_goes_off_stays_committed_and_undrawn(self) -> None:
        off = self.r["sidecar"]["offState"]
        self.assertEqual({"group": 3, "index": 0}, off["committed"])
        self.assertEqual({"group": 3, "index": 0}, off["choice"])
        self.assertEqual(0, off["spots"])
        self.assertFalse(off["lost"])

    def test_a_committed_group_lost_to_the_enemy_uncommits_and_reopens_once(self) -> None:
        sc = self.r["sidecar"]
        self.assertEqual({"group": 3, "index": 0}, sc["lostState"]["choice"])
        self.assertIsNone(sc["lostState"]["committed"])
        self.assertTrue(sc["lostState"]["lost"])
        self.assertTrue(sc["lostState"]["up"])
        self.assertEqual({"lost": True, "up": False}, sc["lostAgain"])


if __name__ == "__main__":
    unittest.main()
