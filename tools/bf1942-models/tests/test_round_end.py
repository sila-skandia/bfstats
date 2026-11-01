"""`viewer/round-end.js` -- the end of a round as the client shows it, driven
headless by `round_end_harness.mjs` with `viewer/round-state.js` behind it.

The law under test (ledger ROUND-8, ROUND-9, ROUND-12;
`features/round-end-winner-screen/README.md`):

  - the debriefing titles the local side's result by the victory type
    (`DEBRIEFING_TOTAL / MAJOR / MINOR_VICTORY` or `_DEFEAT`, `_DRAW`), and
    writes the level's own line for the local side: the Major line for a
    total result, the Minor one for a major or a minor result;
  - the win cue on a victory, the lose cue on a defeat, none on a draw;
  - a game joined or hosted shows `menu/LoadMenu`'s multiplayer plate over
    the world (ROUND-12): the title, each side's ticket flag and count, and
    the client's own list of the top three by score, each row its rank
    digit, side flag, name, score, kills, deaths, ping and a medal by rank
    and side, set at the list's own columns and row height;
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
MODULES = ("round-end.js", "round-state.js", "scoreboard.js", "bitmap-text.js")


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

    def test_objective_mode_has_its_own_titles_and_lines(self) -> None:
        o = self.results["objective"]
        self.assertEqual(("VICTORY", "Britain was saved."), (o["alliedWin"]["title"], o["alliedWin"]["line"]))
        self.assertEqual(("DEFEAT", "Sealion is scrapped."), (o["axisLoss"]["title"], o["axisLoss"]["line"]))
        # The victory type does not change the title; the cues are the same.
        self.assertEqual(("VICTORY", "win"), (o["minorStillBare"]["titleKey"], o["minorStillBare"]["music"]))
        self.assertEqual(("DEBRIEFING_DRAW", None), (o["draw"]["titleKey"], o["draw"]["music"]))
        self.assertEqual(("DEFEAT", ""), (o["english"]["title"], o["english"]["line"]))

    def test_the_medal_is_by_rank_in_the_players_side_art(self) -> None:
        # FUN_006a9f00: gold, silver, bronze for ranks 1..3, the Axis set for
        # team 1 and the Allied for team 2, else the empty 8x8.
        t = self.results["textures"]
        self.assertEqual(["axis_xl_gold_32x32", "axis_xl_silver_32x32", "axis_xl_bronze_32x32",
                          "allied_xl_gold_32x32", "allied_xl_silver_32x32", "allied_xl_bronze_32x32",
                          "empty_8x8", "empty_8x8"], t["medals"])
        self.assertEqual(["1_16x16", "2_16x16", "3_16x16", "empty_8x8"], t["ranks"])

    def test_the_list_is_the_top_three_by_score_across_both_sides(self) -> None:
        lst = self.results["list"]
        self.assertEqual([0, 25, 45, 220, 270, 320, 370, 420, 450], lst["columns"])
        # A tie keeps roster order; a player on no side is never listed.
        self.assertEqual([("Satoshi Minamoto", 1, 1), ("skandia-bot", 2, 2), ("Satoshi Mamuro", 1, 3)],
                         [(p["name"], p["team"], p["rank"]) for p in lst["best"]])
        self.assertEqual((8, 4, 2, 0), tuple(lst["best"][0][k] for k in ("score", "kills", "deaths", "ping")))
        self.assertEqual([], lst["none"])
        # A score tie: kills, then fewest deaths, then the local player.
        self.assertEqual(["d", "c", "b"], lst["tie"])

    def test_the_rows_sit_at_the_lists_own_columns_and_row_height(self) -> None:
        draws = self.results["list"]["draws"]
        first = draws[:8]
        # Row 1's line is the box's top plus twice the row height: 55 + 152.
        rank, flag = first[0], first[1]
        self.assertEqual(("rank", "1_16x16", [155, 196, 16, 16]), (rank["cell"], rank["texture"], rank["rect"]))
        self.assertEqual(("flag", "AxisTicketFlag", [171, 196, 16, 16]), (flag["cell"], flag["var"], flag["rect"]))
        texts = {d["field"]: (d["text"], d["x"], d["baseline"]) for d in first if d["kind"] == "text"}
        self.assertEqual({"name": ("Satoshi Minamoto", 200, 207), "score": ("8", 375, 207),
                          "kills": ("4", 425, 207), "deaths": ("2", 475, 207), "ping": ("0", 525, 207)}, texts)
        medal = first[7]
        self.assertEqual(("medal", "axis_xl_gold_32x32", [575, 196, 32, 32]),
                         (medal["cell"], medal["texture"], medal["rect"]))
        # Each next row one row height (76) lower, its art by its own side.
        second = [d for d in draws if d.get("cell") == "medal"][1]
        self.assertEqual(("allied_xl_silver_32x32", [575, 272, 32, 32]), (second["texture"], second["rect"]))
        third_flag = [d for d in draws if d.get("cell") == "flag"][2]
        self.assertEqual([171, 348, 16, 16], third_flag["rect"])
        self.assertEqual(24, len(draws))

    def test_the_plate_reads_the_title_and_the_huds_tickets(self) -> None:
        v = self.results["list"]["vars"]
        self.assertEqual((3, "TOTAL VICTORY", "0", "48", "flag_ticket_jp", "flag_ticket_us", 1),
                         (v["StartingGame"], v["Debriefing/DebriefingHeading"], v["AxisTicket"],
                          v["AlliedTicket"], v["AxisTicketFlagLoad"], v["AlliedTicketFlagLoad"], v["Other"]))
        self.assertEqual(("flag_ticket_jp", "flag_ticket_us"), (v["AxisTicketFlag"], v["AlliedTicketFlag"]))
        hidden = self.results["list"]["hidden"]
        self.assertEqual(("", "", 2), (hidden["AxisTicket"], hidden["AxisTicketFlagLoad"], hidden["StartingGame"]))

    def test_the_virtual_screen_stretches_like_the_board(self) -> None:
        sc = self.results["list"]["scale"]
        self.assertEqual({"sx": 2, "sy": 1.5, "ox": 0, "oy": 0}, sc["wide"])
        self.assertEqual((0.5, 0.5, 0, 250), (sc["tall"]["sx"], sc["tall"]["sy"], sc["tall"]["ox"], sc["tall"]["oy"]))

    def test_a_desktop_stage_keeps_the_games_mapping(self) -> None:
        for compact, plate in self.results["compact"]["desktop"]:
            self.assertFalse(compact)
            self.assertIsNone(plate)

    def _fits(self, c, w, h) -> None:
        self.assertLessEqual(c["width"] * c["scale"], w - 24 + 1e-6)
        self.assertLessEqual(c["height"] * c["scale"], h - 24 + 1e-6)
        self.assertGreaterEqual(c["ox"], 12 - 1e-6)
        self.assertGreaterEqual(c["oy"], 12 - 1e-6)
        # The art is cut whole: the bands fill the plate's height, the frame's
        # right edge closes its width.
        self.assertEqual(sum(sl["dst"][3] for sl in c["slices"] if sl["dst"][0] == 0), c["height"])
        self.assertTrue(all(sl["dst"][0] + sl["dst"][2] <= c["width"] for sl in c["slices"]))
        self.assertTrue(any(sl["dst"][0] + sl["dst"][2] == c["width"] for sl in c["slices"]))

    def test_a_portrait_phone_gets_two_lines_a_row_at_a_readable_size(self) -> None:
        c = self.results["compact"]["portrait"]
        self.assertEqual(c["mode"], "narrow")
        self._fits(c, 375, 812)
        # The list face's 8-unit line is drawn 13 px high or more (it was 3.8).
        self.assertGreaterEqual(8 * c["scale"], 13)
        texts = [d for d in c["draws"] if d["kind"] == "text"]
        medals = [d for d in c["draws"] if d.get("cell") == "medal"]
        self.assertEqual(len(medals), 3)
        self.assertEqual([d["text"] for d in texts if d["field"] == "name"], ["Satoshi Minamoto", "skandia-bot", "Satoshi Mamuro"])
        for i, medal in enumerate(medals):
            row = [d for d in texts[i * 5:(i + 1) * 5]]
            self.assertEqual([d["field"] for d in row], ["name", "score", "kills", "deaths", "ping"])
            # The numbers sit a line under the name, clear of the medal.
            self.assertTrue(all(d["baseline"] == row[0]["baseline"] + 16 for d in row[1:]))
            self.assertLess(max(d["x"] for d in row[1:]) + 16, medal["rect"][0])
            self.assertLessEqual(medal["rect"][1] + medal["rect"][3], row[0]["baseline"] - 11 + 36)
        # The header's centred pieces move to the narrow plate's middle; the
        # strip's column icons go to the rows.
        heading = next(l for l in c["leaves"] if l["var"] == "Debriefing/DebriefingHeading")
        self.assertEqual(heading["rect"][0] * 2 + heading["rect"][2], c["width"])
        axis = next(l for l in c["leaves"] if l["var"] == "AxisTicketFlagLoad")
        self.assertEqual(axis["rect"][0], c["width"] / 2 - 83)
        self.assertFalse(any((l["texture"] or "").startswith("menu_icon") for l in c["leaves"]))
        self.assertFalse(any(l["texture"] == "mp_debriefing_512x512" for l in c["leaves"]))

    def test_a_landscape_phone_keeps_the_games_columns_on_short_rows(self) -> None:
        c = self.results["compact"]["landscape"]
        self.assertEqual(c["mode"], "wide")
        self._fits(c, 812, 375)
        self.assertGreaterEqual(8 * c["scale"], 12)
        self.assertEqual(c["width"], 512)
        names = [d for d in c["draws"] if d["kind"] == "text" and d["field"] == "name"]
        self.assertEqual([n["baseline"] for n in names], [107, 131, 155])

    def test_the_plate_keeps_clear_of_a_replays_controls(self) -> None:
        # Portrait: room to spare, so clear of the fronts, the card and the bar
        # at the same size.
        c = self.results["compact"]["portraitChrome"]
        self.assertEqual(c["mode"], "narrow")
        self.assertAlmostEqual(c["scale"], self.results["compact"]["portrait"]["scale"])
        self.assertGreaterEqual(c["oy"], 48)
        self.assertLessEqual(c["oy"] + c["height"] * c["scale"], 812 - 243)
        # Landscape: keeping the card clear would cost the plate half its
        # size, so it is kept clear of the bar and the fronts only, still
        # drawn larger than the desktop's 1.2.
        c = self.results["compact"]["landscapeChrome"]
        self.assertEqual(c["mode"], "wide")
        self.assertGreaterEqual(c["oy"], 48)
        self.assertLessEqual(c["oy"] + c["height"] * c["scale"], 375 - 85 + 1e-6)
        self.assertGreater(c["scale"], 1.25)

    def test_a_long_title_widens_the_narrow_plate(self) -> None:
        self.assertEqual(self.results["compact"]["longTitle"], 276)

    def test_the_screen_opens_on_the_end_and_restarts_ten_seconds_later(self) -> None:
        flow = self.results["flow"]
        self.assertEqual([False, True], [f["shown"] for f in flow["frames"]])
        opened = flow["opened"]
        self.assertEqual(("TOTAL VICTORY", "BEST PLAYERS", 3), (opened["title"], opened["heading"],
                                                                opened["startingGame"]))
        # The tickets the round ended on, the HUD's own strings.
        self.assertEqual({"axis": "0", "allied": "3", "axisFlag": "flag_ticket_ger",
                          "alliedFlag": "flag_ticket_us"}, opened["tickets"])
        # Smith's three kills top the list; Otto, who died once, outscores Hans,
        # who died twice.
        self.assertEqual([("Smith", 1, 3), ("Otto", 2, 0), ("Hans", 3, 0)],
                         [(p["name"], p["rank"], p["kills"]) for p in opened["players"]])
        self.assertEqual((True, 1, 0), (flow["nine"]["shown"], flow["nine"]["restartIn"], flow["nine"]["restarts"]))
        after = flow["after"]
        self.assertEqual((False, "playing", 1), (after["shown"], after["status"], after["restarts"]))
        self.assertEqual({"1": 0, "2": 1}, after["roundsWon"])
        self.assertEqual({"1": 3, "2": 3}, after["tickets"])
        # The field is cleared once, on the end game's first tick, after the
        # rows are read (ROUND-10); no score board is held up under the plate.
        self.assertEqual(["clear", "pointer", "music:win", "music:stop", "restart"], flow["calls"])

    def test_a_new_level_closes_the_screen_without_a_restart(self) -> None:
        second = self.results["flow"]["second"]
        self.assertTrue(second["again"])
        self.assertTrue(second["closedByNewLevel"])
        self.assertEqual(1, second["restarts"])
        self.assertEqual(["clear", "pointer", "music:win", "music:stop"], second["calls"])

    def test_a_draw_plays_no_cue_and_a_single_player_round_waits(self) -> None:
        draw = self.results["draw"]
        self.assertEqual("endGame", draw["status"])
        self.assertEqual(("DRAW", True, 0), (draw["state"]["title"], draw["state"]["shown"],
                                             draw["state"]["restarts"]))
        self.assertEqual([], draw["calls"])

    def test_a_rooms_screen_waits_for_the_servers_restart(self) -> None:
        # In a room the restart is the server's row: the timer runs out and
        # the screen stays up (no `restartRound` of its own) until the row
        # turns the round back to Playing. The rows are the server's own
        # stats, and the plate is a joined game's (`StartingGame` 2).
        room = self.results["room"]
        self.assertEqual([["Remote", 1, 12, 63]], room["players"])
        self.assertEqual(2, room["startingGame"])
        self.assertEqual({"shown": True, "restarts": 0}, room["waiting"])
        self.assertEqual({"shown": False, "restarts": 1}, room["after"])
        self.assertNotIn("restart", room["calls"])


if __name__ == "__main__":
    unittest.main()
