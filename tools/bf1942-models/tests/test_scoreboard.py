"""`viewer/scoreboard.js` -- what the in-game score board is fed and where its
rows go, driven headless by `scoreboard_harness.mjs`.

The board itself is data (`extract_scoreboard_layout.py`, tested in
`test_scoreboard_layout.py`); this module is what the engine adds at runtime.
The rule under test throughout: a row is a real player -- the local one, or
one the room server put in the roster -- and a counter nothing tracks is zero.
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
HARNESS = Path(__file__).with_name("scoreboard_harness.mjs")
MODULES = {"scoreboard.js": VIEWER / "scoreboard.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ScoreboardTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- the tally ---------------------------------------------------------

    def test_kills_and_deaths_come_from_the_rooms_killed_events(self) -> None:
        t = self.results["tally"]
        self.assertEqual({"kills": 2, "deaths": 2}, t["1"])
        self.assertEqual({"kills": 0, "deaths": 2}, t["2"])
        self.assertEqual({"kills": 1, "deaths": 1}, t["3"])
        self.assertEqual(0, self.results["tallyEmpty"])

    def test_a_suicide_is_a_death_and_not_a_kill(self) -> None:
        # Slot 1's five rows: two kills of 2, killed by 3, and one suicide.
        self.assertEqual(2, self.results["tally"]["1"]["kills"])

    # ---- the rows ----------------------------------------------------------

    def test_players_land_on_their_own_teams_list(self) -> None:
        rows = self.results["rows"]
        self.assertEqual(["Axis One"], [r["name"] for r in rows["1"]])
        self.assertEqual(["Local", "Ally Two"], [r["name"] for r in rows["2"]])

    def test_a_player_on_no_team_is_on_no_list(self) -> None:
        names = [r["name"] for side in self.results["rows"].values() for r in side]
        self.assertNotIn("Teamless", names)

    def test_rows_sort_by_kills_when_nobody_has_a_score(self) -> None:
        allied = self.results["rows"]["2"]
        self.assertEqual([2, 1], [r["kills"] for r in allied])
        self.assertTrue(allied[0]["local"])

    def test_score_and_ping_are_zero_because_nothing_tracks_them(self) -> None:
        for side in self.results["rows"].values():
            for row in side:
                self.assertEqual(0, row["score"])
                self.assertEqual(0, row["ping"])

    def test_a_lone_page_lists_the_local_player_and_nobody_else(self) -> None:
        lone = self.results["lone"]
        self.assertEqual(1, len(lone["1"]))
        self.assertEqual([], lone["2"])
        self.assertIsNone(lone["1"][0]["slot"])
        self.assertEqual({"1": [], "2": []}, self.results["nobody"])

    # ---- the variables -----------------------------------------------------

    def test_the_totals_are_sums_of_the_rows_not_the_files_samples(self) -> None:
        v = self.results["varsRoom"]
        self.assertEqual(1, v["Scoreboard/AxisPlayerTotal"])
        self.assertEqual(2, v["Scoreboard/AlliedPlayerTotal"])
        self.assertEqual(0, v["Scoreboard/AxisScoreTotal"])
        self.assertEqual(3, v["Scoreboard/AlliedKillsTotal"])
        self.assertEqual(3, v["Scoreboard/AlliedDeathsTotal"])
        self.assertEqual(2, v["Scoreboard/AxisDeathsTotal"])
        self.assertEqual(0, v["Scoreboard/AxisRoundWon"])
        # The layout's own table is not written through.
        self.assertEqual(100, self.results["layoutVarsUntouched"])

    def test_a_room_is_multiplayer_and_a_lone_page_is_single_player(self) -> None:
        self.assertFalse(self.results["varsRoom"]["Scoreboard/GameStatusSinglePlayer"])
        self.assertTrue(self.results["varsLone"]["Scoreboard/GameStatusSinglePlayer"])

    def test_nothing_the_page_cannot_do_is_enabled(self) -> None:
        v = self.results["varsRoom"]
        for name in ("RemoteAdmin", "EnableAddBuddy", "EnableRemBuddy",
                     "EnableVoteKick", "EnableVoteKickTeam", "GameStatusEndGame"):
            self.assertFalse(v[f"Scoreboard/{name}"], name)

    def test_the_server_plate_and_flags_are_the_pages_own(self) -> None:
        v = self.results["varsRoom"]
        self.assertEqual("ABCD", v["Scoreboard/ServerName"])
        self.assertEqual("host:1", v["Scoreboard/ServerIp"])
        self.assertEqual("Wake", v["Scoreboard/MapName"])
        self.assertEqual("flag_ticket_jp.tga", v["AxisTicketFlag"])
        self.assertEqual("flag_ticket_us.tga", v["AlliedTicketFlag"])
        lone = self.results["varsLone"]
        self.assertEqual("", lone["Scoreboard/ServerName"])
        # No flag given: the layout's own default stays.
        self.assertEqual("flag_ticket_ger.tga", lone["AxisTicketFlag"])

    def test_the_scroll_bar_shows_only_past_the_visible_rows(self) -> None:
        self.assertFalse(self.results["varsRoom"]["Scoreboard/ShowScrollBarAxis"])
        self.assertTrue(self.results["varsLone"]["Scoreboard/ShowScrollBarAxis"])
        self.assertFalse(self.results["varsLone"]["Scoreboard/ShowScrollBarAllied"])

    def test_from_spawn_is_what_swaps_done_for_lock(self) -> None:
        self.assertTrue(self.results["varsRoom"]["Scoreboard/FromSpawnScoreboard"])
        self.assertFalse(self.results["varsLone"]["Scoreboard/FromSpawnScoreboard"])

    # ---- the list geometry -------------------------------------------------

    def test_the_first_row_starts_two_twelves_below_the_box(self) -> None:
        g = self.results["geo"]
        self.assertEqual(24, g["inset"])
        self.assertEqual(65 + 24, g["top"])
        self.assertEqual(18, g["pitch"])

    def test_rows_stop_above_the_lower_strip(self) -> None:
        g = self.results["geo"]
        # (465 - 89) / 18 = 20.9
        self.assertEqual(20, g["visibleRows"])
        # With no floor the box's own height is the limit: (485 - 89) / 18.
        self.assertEqual(22, g["noFloor"])

    def test_a_cell_starts_at_box_left_plus_ten_plus_the_column(self) -> None:
        cells = {c["field"]: c for c in self.results["geo"]["row0"]}
        self.assertEqual(5 + 10 + 25, cells["name"]["x"])
        self.assertEqual(5 + 10 + 175, cells["score"]["x"])
        self.assertEqual(5 + 10 + 210, cells["kills"]["x"])
        self.assertEqual(5 + 10 + 245, cells["deaths"]["x"])
        self.assertEqual(5 + 10 + 280, cells["ping"]["x"])
        self.assertEqual(5 + 10 + 310, cells["id"]["x"])
        self.assertEqual("7", cells["id"]["text"])

    def test_text_is_set_up_from_the_rows_bottom_edge(self) -> None:
        row0 = self.results["geo"]["row0"][0]
        row1 = self.results["geo"]["row1"][0]
        self.assertEqual(89 + 18 - 8, row0["y"])
        self.assertEqual(89 + 36 - 8, row1["y"])

    def test_a_player_with_no_slot_has_no_id_cell(self) -> None:
        fields = [c["field"] for c in self.results["geo"]["row1"]]
        self.assertNotIn("id", fields)
        self.assertIn("name", fields)

    def test_unnamed_columns_draw_nothing(self) -> None:
        self.assertEqual(6, len(self.results["geo"]["row0"]))

    def test_a_long_name_is_cut_glyph_by_glyph(self) -> None:
        f = self.results["fit"]
        self.assertEqual("abc", f["whole"])
        self.assertEqual("abc", f["cut"])
        self.assertEqual("", f["none"])

    # ---- conditions and names ----------------------------------------------

    def test_the_condition_evaluator(self) -> None:
        for name, value in self.results["cond"].items():
            self.assertTrue(value, name)

    def test_a_level_zero_alpha_fade_is_not_drawn(self) -> None:
        v = self.results["visible"]
        self.assertTrue(v["plain"])
        self.assertFalse(v["fadedOut"])
        self.assertFalse(v["culled"])
        self.assertTrue(v["shown"])

    def test_texture_keys_are_lower_cased_stems(self) -> None:
        self.assertEqual(["flag_ticket_us", "scoreboard_512x470", "plain"],
                         self.results["key"])

    def test_bound_text_shows_the_live_value(self) -> None:
        self.assertEqual(["0", "AXIS", "sample"], self.results["text"])

    # ---- the painter -------------------------------------------------------

    def test_the_list_floor_is_the_lower_strip_not_the_scroll_track(self) -> None:
        self.assertEqual(465, self.results["floor"])

    def test_the_painter_draws_the_file_order_and_skips_what_is_culled(self) -> None:
        p = self.results["paint"]
        kinds = [c[0] for c in p["calls"]]
        # fill, flag picture, DONE plate (hovered), scroll track, lower strip;
        # the faded BAN plate is absent.
        self.assertEqual(["fillRect", "drawImage", "drawImage", "fillRect", "fillRect"], kinds)
        self.assertEqual("flag_ticket_jp", p["calls"][1][1])
        self.assertEqual("knappext_mo", p["calls"][2][1])
        # A button draws at its texture's own size, not its pointer region.
        self.assertEqual([660, 557, 128, 128], p["calls"][2][2:])
        texts = [t[0] for t in p["texts"]]
        self.assertIn("DONE", texts)
        self.assertNotIn("LOCK", texts)
        self.assertNotIn("9999", texts)

    def test_right_and_centre_alignment_use_the_faces_advance(self) -> None:
        texts = {t[0]: t for t in self.results["paint"]["texts"]}
        # The rounds-won "0" is the black one (the row cells are white):
        # right-aligned in (230, 150 wide), 230 + 150 - 6.
        won = [t for t in self.results["paint"]["texts"] if t[0] == "0" and t[3] == "0,0,0"]
        self.assertEqual(1, len(won))
        self.assertEqual(374, won[0][1])
        # "DONE" centred in (660, 114 wide): 660 + (114 - 24) / 2.
        self.assertEqual(705, texts["DONE"][1])

    def test_the_list_rows_are_painted_from_the_rows_given(self) -> None:
        p = self.results["paint"]
        self.assertEqual({"Scoreboard/AxisScoreboardList": 20}, p["visibleRows"])
        names = [t for t in p["texts"] if t[0] == "Axis One"]
        self.assertEqual(1, len(names))
        self.assertEqual(40, names[0][1])
        self.assertEqual(99, names[0][2])


if __name__ == "__main__":
    unittest.main()
