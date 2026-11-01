"""A round replay's Accuracy board: each player's rounds fired and hits.

The owner's ask (2026-11-01): accuracy stats for a recorded round, ordered by
most hits or most fired, "use the server table, falling back to the recorded
values being rebuilt". The server counts both per player and weapon and sends
the whole round's tally at its end (ledger IMP-11, `roundStats`). A player it
names keeps the server's numbers. Anyone else is rebuilt from the recording:
a pull times the gun's barrels, a bullet that passed through a victim whose
next hit points are a drop, and one hit per blast that hurt an enemy.

Run under node through `replay_accuracy_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_accuracy_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayAccuracyTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_bullet_hits_only_when_the_victims_next_hit_points_drop(self) -> None:
        # Through him with a drop, through him without one, and wide of him as
        # he loses hit points to something else.
        self.assertEqual(self.results["rebuilt"]["3|Shooter"]["mp40"], [3, 1])

    def test_a_blast_counts_once_and_on_the_enemy_only(self) -> None:
        self.assertEqual(self.results["rebuilt"]["3|Shooter"]["grenadeallies"], [2, 1])

    def test_a_gun_that_fires_its_barrels_together_counts_each(self) -> None:
        self.assertEqual(self.results["rebuilt"]["6|Pilot"], {"bf109": [6, 0]})

    def test_a_reused_pid_is_two_players(self) -> None:
        self.assertEqual(self.results["rebuilt"]["8|Leaver"], {"mp40": [2, 1]})
        self.assertEqual(self.results["rebuilt"]["8|Joiner"], {"mp40": [1, 0]})

    def test_the_servers_tally_wins_where_it_names_the_player(self) -> None:
        shooter = self.results["board"]["Shooter"]
        self.assertEqual(shooter["source"], "server")
        self.assertEqual((shooter["fired"], shooter["hit"]), (42, 13))
        self.assertEqual(shooter["rows"][0], ["Mp40", "infantry", 40, 12])
        for name in ("Leaver", "Joiner", "Pilot"):
            self.assertEqual(self.results["board"][name]["source"], "marks" if name == "Pilot" else "rebuilt")

    def test_without_a_tally_everyone_is_rebuilt(self) -> None:
        self.assertEqual(sorted(self.results["allRebuilt"]), ["marks"] + ["rebuilt"] * 3)

    def test_the_rebuild_hands_back_each_rounds_verdict(self) -> None:
        # Every round has one; each hit carries where it met its victim.
        v = self.results["verdicts"]
        self.assertEqual(v["rounds"], 11)
        self.assertEqual(v["hits"], 3)
        self.assertEqual(v["pointed"], 3)

    def test_the_servers_own_hit_mark_is_the_pilots_hit(self) -> None:
        pilot = self.results["board"]["Pilot"]
        self.assertEqual(pilot["source"], "marks")
        self.assertEqual(pilot["rows"], [["BF109", "air", 6, 1]])

    def test_a_server_recordings_credits_are_its_hits(self) -> None:
        # One `f` per barrel already (no doubling), the fake round left out.
        self.assertEqual(self.results["server"], {"serverFile": True, "impacts": 1, "source": "server", "fired": 4, "hit": 1})

    def test_the_boards_by_kind(self) -> None:
        self.assertEqual(self.results["kinds"], {"Mp40": "infantry", "BF109": "air", "Tiger": "vehicle", "Sherman": "other"})
        self.assertEqual(self.results["noWeapons"], "other")
        self.assertEqual(self.results["totals"]["infantry"]["fired"], 42)
        self.assertIsNone(self.results["totals"]["air"]["accuracy"])


if __name__ == "__main__":
    unittest.main()
