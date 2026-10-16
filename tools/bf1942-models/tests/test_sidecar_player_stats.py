"""A retail server's player stats reach the page's score board.

Real BFPlayer bodies from a lab session on Kursk co-op (2026-10-16), rebuilt
by the sidecar's own `rebuild.mjs` into k:"ps" rows, read back by
`viewer/net-sidecar.js` and laid out by `viewer/scoreboard.js`. Driven by
`sidecar_player_stats_harness.mjs`. The laws:

* a ps row carries the whole stat block by name besides `sc` and `md`
  (`sidecar/ghost/player.mjs`, THE STAT BLOCK: `ScoreManager::scoreEvent`
  0x081617c0 counts a kill into +0xa4, a death into +0xa0, an attack into
  +0xb8, and every event's points into +0xc0; +0x94 is the ping, the GameSpy
  report's `ping`);
* an attack is worth 2 and a kill 1 (vanilla's ScoreManagerSettings.con), and
  a kill moves the killer's kills and the victim's deaths in the same tick;
* the board shows the server's score, kills, deaths and ping for every sidecar
  row, the local player's included, and ignores the page's `killed` tally;
* a roster player no row has named reads zero, a slot off the roster null;
* a row from an older sidecar (`sc` and `md` only) moves the score and keeps
  the counters.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_player_stats_harness.mjs"


class SidecarPlayerStatsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_a_ps_row_carries_the_whole_stat_block(self) -> None:
        self.assertEqual(
            ["attacks", "captures", "deaths", "defences", "k", "kills", "md", "objectiveTeamKills",
             "objectives", "pid", "ping", "sc", "t", "teamKills"],
            self.r["psKeys"])

    def test_an_attack_pays_two_and_a_kill_one(self) -> None:
        rows = self.r["firstRows"]
        # Gerasim Kozin (pid 254) scores two attacks, 2 points each.
        self.assertEqual([(1, 2), (2, 4)], [(x["attacks"], x["sc"]) for x in rows[:2]])
        # 370.145 s: Bernhard Niemann (255) kills him; one tick moves both.
        victim, killer = rows[4], rows[5]
        self.assertEqual((254, 1, 0, 4), (victim["pid"], victim["deaths"], victim["kills"], victim["sc"]))
        self.assertEqual((255, 1, 0, 5), (killer["pid"], killer["kills"], killer["deaths"], killer["sc"]))
        self.assertEqual(victim["t"], killer["t"])

    def test_the_board_shows_the_servers_numbers(self) -> None:
        board = self.r["at560"]["board"]
        self.assertEqual({"score": 10, "kills": 2, "deaths": 1, "ping": 0}, board["Gerasim Kozin"])
        self.assertEqual({"score": 5, "kills": 1, "deaths": 2, "ping": 0}, board["Bernhard Niemann"])
        # Before any kill the feed's one death a slot would read as a death;
        # the server's stats say none.
        self.assertEqual({"score": 4, "kills": 0, "deaths": 0, "ping": 0},
                         self.r["at300"]["board"]["Gerasim Kozin"])

    def test_the_local_player_reads_the_server_too(self) -> None:
        # hprobe is the sidecar's own player: no stats moved but his ping.
        self.assertEqual({"score": 0, "kills": 0, "deaths": 0, "ping": 0}, self.r["at560"]["board"]["hprobe"])
        self.assertEqual(1, self.r["at4246"]["board"]["hprobe"]["ping"])
        self.assertEqual([2, 3, 2, 1], [x["ping"] for x in self.r["pingRows"]])

    def test_an_unnamed_player_reads_zero_and_an_unknown_slot_null(self) -> None:
        hprobe = self.r["at300"]["stats"]["hprobe"]
        self.assertEqual(0, hprobe["score"])
        self.assertEqual([0, 0, 0], hprobe["medals"])
        self.assertIsNone(self.r["unknownSlot"])

    def test_an_older_row_moves_the_score_and_keeps_the_counters(self) -> None:
        legacy = self.r["legacy"]
        self.assertEqual((6, 2, 1, 40), (legacy["score"], legacy["kills"], legacy["deaths"], legacy["ping"]))


if __name__ == "__main__":
    unittest.main()
