"""`viewer/round-end.js` -- the end of a round as the client shows it, driven
headless by `round_end_harness.mjs` with `viewer/round-state.js` behind it.

The law under test (ledger ROUND-8, ROUND-9;
`features/round-end-winner-screen/README.md`):

  - the debriefing titles the local side's result by the victory type
    (`DEBRIEFING_TOTAL / MAJOR / MINOR_VICTORY` or `_DEFEAT`, `_DRAW`), and
    under it the level's own line for the local side: the Major line for a
    total result, the Minor one for a major or a minor result;
  - the win cue on a victory, the lose cue on a defeat, none on a draw;
  - the medals by score, each in its winner's side's art;
  - a multiplayer round restarts ten seconds after its end, keeping the
    rounds won; a single-player one waits.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("round_end_harness.mjs")
MODULES = ("round-end.js", "round-state.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type": "module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RoundEndTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_title_is_the_local_sides_result_by_victory_type(self) -> None:
        of = self.results["of"]
        self.assertEqual(("victory", "DEBRIEFING_TOTAL_VICTORY", "win"),
                         (of["totalWin"]["result"], of["totalWin"]["titleKey"], of["totalWin"]["music"]))
        self.assertEqual(("defeat", "DEBRIEFING_TOTAL_DEFEAT", "lose"),
                         (of["totalLoss"]["result"], of["totalLoss"]["titleKey"], of["totalLoss"]["music"]))
        self.assertEqual("DEBRIEFING_MAJOR_VICTORY", of["majorWin"]["titleKey"])
        self.assertEqual("DEBRIEFING_MINOR_DEFEAT", of["minorLoss"]["titleKey"])
        self.assertEqual(("draw", "DEBRIEFING_DRAW", None, None),
                         (of["draw"]["result"], of["draw"]["titleKey"], of["draw"]["lineKey"],
                          of["draw"]["music"]))
        self.assertIsNone(of["none"])

    def test_the_level_line_is_major_for_total_and_minor_otherwise(self) -> None:
        of = self.results["of"]
        self.assertEqual(("allied", "majorVictory"), (of["totalWin"]["side"], of["totalWin"]["lineKey"]))
        self.assertEqual(("axis", "majorDefeat"), (of["totalLoss"]["side"], of["totalLoss"]["lineKey"]))
        self.assertEqual(("axis", "minorVictory"), (of["majorWin"]["side"], of["majorWin"]["lineKey"]))
        self.assertEqual(("allied", "minorDefeat"), (of["minorLoss"]["side"], of["minorLoss"]["lineKey"]))
        # A reader on no side reads the Axis strings and a defeat, as the
        # client's own `== 2` test and team compare do.
        self.assertEqual(("axis", "defeat"), (of["spectator"]["side"], of["spectator"]["result"]))

    def test_the_words_are_the_levels_with_english_titles_behind_them(self) -> None:
        w = self.results["words"]
        self.assertEqual(("TOTAL VICTORY", "Coalition won big.", "BEST PLAYERS"),
                         (w["totalWin"]["title"], w["totalWin"]["line"], w["totalWin"]["heading"]))
        self.assertEqual("Opposition lost big.", w["totalLoss"]["line"])
        self.assertEqual(("MAJOR VICTORY", "Opposition won."), (w["majorWin"]["title"], w["majorWin"]["line"]))
        self.assertEqual("Coalition lost.", w["minorLoss"]["line"])
        self.assertEqual(("DRAW", ""), (w["draw"]["title"], w["draw"]["line"]))
        self.assertEqual(("MAJOR VICTORY", ""), (w["bare"]["title"], w["bare"]["line"]))

    def test_medal_art_is_the_winners_side(self) -> None:
        s = self.results["sprites"]
        self.assertEqual("allied_xl_gold_32x32.png", s["gold2"])
        self.assertEqual("axis_xl_bronze_32x32.png", s["bronze1"])
        self.assertEqual("axis_xl_silver_32x32.png", s["silver0"])

    def test_the_countdown_is_whole_seconds(self) -> None:
        c = self.results["countdown"]
        self.assertEqual(("10", "4", "0", ""), (c["full"], c["part"], c["done"], c["never"]))

    def test_the_screen_opens_on_the_end_and_restarts_ten_seconds_later(self) -> None:
        flow = self.results["flow"]
        self.assertEqual([False, True], [f["shown"] for f in flow["frames"]])
        opened = flow["opened"]
        self.assertEqual(("TOTAL VICTORY", "Coalition won big.", "BEST PLAYERS", "10"),
                         (opened["title"], opened["line"], opened["heading"], opened["countdown"]))
        self.assertEqual([(1, "gold", "Smith"), (8, "silver", "Otto"), (7, "bronze", "Hans")],
                         [(m["playerId"], m["medal"], m["name"]) for m in opened["medals"]])
        self.assertEqual("allied_xl_gold_32x32.png", opened["medals"][0]["sprite"])
        self.assertEqual((True, 1, 0), (flow["nine"]["shown"], flow["nine"]["restartIn"], flow["nine"]["restarts"]))
        after = flow["after"]
        self.assertEqual((False, "playing", 1), (after["shown"], after["status"], after["restarts"]))
        self.assertEqual({"1": 0, "2": 1}, after["roundsWon"])
        self.assertEqual({"1": 3, "2": 3}, after["tickets"])
        self.assertEqual(["pointer", "board:true", "music:win", "board:false", "music:stop", "restart"],
                         flow["calls"])

    def test_a_new_level_closes_the_screen_without_a_restart(self) -> None:
        second = self.results["flow"]["second"]
        self.assertTrue(second["again"])
        self.assertTrue(second["closedByNewLevel"])
        self.assertEqual(1, second["restarts"])
        self.assertEqual(["pointer", "board:true", "music:win", "board:false", "music:stop"],
                         second["calls"])

    def test_a_draw_plays_no_cue_and_a_single_player_round_waits(self) -> None:
        draw = self.results["draw"]
        self.assertEqual("endGame", draw["status"])
        self.assertEqual(("DRAW", True, 0), (draw["state"]["title"], draw["state"]["shown"],
                                             draw["state"]["restarts"]))
        self.assertEqual(["board:true"], draw["calls"])

    def test_a_rooms_screen_waits_for_the_servers_restart(self) -> None:
        # In a room the restart is the server's row: the page's countdown runs
        # out and the screen stays up (no `restartRound` of its own) until the
        # row turns the round back to Playing. The medals are the server's.
        room = self.results["room"]
        self.assertEqual([[3, "gold", "Remote"]], room["medals"])
        self.assertEqual({"shown": True, "countdown": "0", "restarts": 0}, room["waiting"])
        self.assertEqual({"shown": False, "restarts": 1}, room["after"])
        self.assertNotIn("restart", room["calls"])


if __name__ == "__main__":
    unittest.main()
