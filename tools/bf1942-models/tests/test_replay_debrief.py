"""The replay's retail scoreboard and its round-end debriefing.

The board shows score, kills, deaths and ping in retail's order (ledger
MEME-25, MEME-26): a server recording's `ps` rows are the server's own
counters; otherwise the score is paid from the recorded ScoreMsgs by the
server's `scoreTable`, the pack's or the engine's defaults, nothing after the
round's end (ROUND-7). When playback crosses the round's end the
debriefing plate is shown (ROUND-8, ROUND-12): the result from a server
recording's gameStatus (winner, victory), else the log's winner or the
tickets', the victory type from the tickets' shares (ROUND-6), and the best
three (features/replay-feature-sweep-2026-11-01, entries 4 and 5).

Run under node through `replay_debrief_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_debrief_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def row(score, kills, deaths, ping=None, medals=None, recorded=False):
    return {"score": score, "kills": kills, "deaths": deaths, "ping": ping, "medals": medals, "recorded": recorded}


class ReplayBoardTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_new_records_parse_with_nothing_skipped(self) -> None:
        self.assertEqual(self.results["client"]["skipped"], 0)
        self.assertEqual(self.results["server"]["skipped"], 0)
        self.assertEqual(self.results["client"]["scores"], 12)

    def test_a_client_files_score_is_paid_by_the_packs_points(self) -> None:
        at = self.results["client"]["at200"]
        # Smith: two kills at 1 and an Attack at 2; Hans one kill, four
        # deaths at 0; the kill after the round's end pays nothing.
        self.assertEqual(at["2"], row(4, 2, 0))
        self.assertEqual(at["3"], row(2, 2, 1))
        self.assertEqual(at["1"], row(1, 1, 4))

    def test_the_score_is_as_it_stood_at_the_time(self) -> None:
        self.assertEqual(self.results["client"]["at35"]["2"], row(3, 1, 0))

    def test_without_a_table_the_engines_defaults_pay(self) -> None:
        at = self.results["client"]["defaults"]
        self.assertEqual(at["2"]["score"], 3 * 2 + 5)
        self.assertEqual(at["1"]["score"], 3 - 4)

    def test_the_board_is_in_retail_order(self) -> None:
        self.assertEqual([r[0] for r in self.results["client"]["order"]], [2, 3, 1])

    def test_on_a_client_its_own_player_heads_a_whole_tie(self) -> None:
        self.assertEqual(self.results["clientTie"], [9, 7, 8])

    def test_a_server_files_counters_win_for_their_holder_only(self) -> None:
        server = self.results["server"]
        self.assertEqual(server["alphaAt25"], row(9, 1, 0, 0, [0, 0, 0], True))
        at = server["at60"]
        self.assertEqual(at["6"], row(4, 2, 1, 48, [1, 0, 2], True))
        # Zulu took pid 5 from Alpha: Alpha's counters are not his, and his
        # one kill pays the server's scoreTable's 2.
        self.assertEqual(at["5"], row(2, 1, 0))

    def test_the_servers_table_wins_over_the_pack(self) -> None:
        self.assertEqual(self.results["server"]["table"]["kill"], 2)
        self.assertEqual(self.results["server"]["table"]["objectivetk"], -15)

    def test_on_a_server_the_later_connect_heads_a_tie(self) -> None:
        self.assertEqual(self.results["server"]["order"], [4, 6, 5])


class ReplayDebriefTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_recorded_result_wins(self) -> None:
        server = self.results["server"]
        self.assertEqual(server["result"], {"t": 90, "winner": 2, "victory": 2})
        self.assertEqual(server["resolved"]["winner"], 2)
        self.assertEqual(server["resolved"]["from"], {"winner": "recorded", "victory": "recorded"})
        self.assertEqual(server["model"]["words"]["title"], "MAJOR VICTORY")

    def test_without_one_the_tickets_decide(self) -> None:
        result = self.results["client"]["result"]
        self.assertEqual(result["winner"], 2)
        # 0 against 40 of 50: a margin of 0.8 is a total victory.
        self.assertEqual(result["victory"], 3)
        self.assertEqual(result["from"], {"winner": "tickets", "victory": "tickets"})

    def test_a_server_logs_winner_comes_before_the_tickets(self) -> None:
        logged = self.results["client"]["logged"]
        self.assertEqual(logged["winner"], 1)
        self.assertEqual(logged["from"]["winner"], "log")

    def test_the_title_is_the_followed_sides(self) -> None:
        self.assertEqual(self.results["client"]["title"], "TOTAL VICTORY")
        self.assertEqual(self.results["client"]["axisTitle"], "TOTAL DEFEAT")

    def test_the_best_three_and_an_unrecorded_ping_is_empty(self) -> None:
        players = self.results["client"]["players"]
        self.assertEqual([(p["name"], p["rank"], p["score"]) for p in players],
                         [("Smith", 1, 4), ("Otto", 2, 2), ("Hans", 3, 1)])
        self.assertTrue(all(p["ping"] == "" for p in players))
        server = self.results["server"]["model"]["players"]
        self.assertEqual([(p["name"], p["ping"]) for p in server], [("Charlie", 120), ("Bravo", 48), ("Zulu", "")])

    def test_ticket_shares_and_winners(self) -> None:
        tickets = self.results["tickets"]
        self.assertEqual(tickets["shares"], {"1": 0.3, "2": 0, "tickets": [30, 0]})
        self.assertEqual(tickets["noStart"]["1"], 0.375)
        self.assertEqual(tickets["levelScaled"], {"1": 0.5, "2": 0.25, "tickets": [100, 50]})
        self.assertEqual(tickets["winners"], [1, 2, 0, 2, 0])

    def test_the_plate_shows_at_the_end_until_dismissed_or_sought_back(self) -> None:
        presenter = self.results["presenter"]
        self.assertEqual(presenter["frames"], [
            ["before", False, False], ["played into", True, False], ["held", True, False],
            ["dismissed", False, True], ["sought back", False, False], ["sought past", True, False]])
        self.assertEqual(presenter["title"], "TOTAL VICTORY")
        self.assertEqual(presenter["players"], ["Smith", "Otto", "Hans"])

    def test_the_cue_plays_only_when_playback_runs_into_the_end(self) -> None:
        self.assertEqual(self.results["presenter"]["music"], ["play:win", "stop"])

    def test_the_console_key_and_typing_in_it_leave_the_plate_up(self) -> None:
        self.assertEqual(self.results["dismissKeys"], {
            "space": True, "escape": True, "held": False, "shift": False,
            "console": False, "typedInConsole": False, "pageThrows": True})


if __name__ == "__main__":
    unittest.main()
