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
        self.assertEqual(["Axis One", "Axis Bot"], [r["name"] for r in rows["1"]])
        self.assertEqual(["Local", "Ally Two", "Odd Kit"], [r["name"] for r in rows["2"]])

    def test_a_player_on_no_team_is_on_no_list(self) -> None:
        names = [r["name"] for side in self.results["rows"].values() for r in side]
        self.assertNotIn("Teamless", names)

    def test_rows_sort_by_kills_when_nobody_has_a_score(self) -> None:
        allied = self.results["rows"]["2"]
        self.assertEqual([2, 1, 0], [r["kills"] for r in allied])
        self.assertTrue(allied[0]["local"])
        # Fewest deaths next: the Axis bot's three put it under Axis One's two.
        self.assertEqual([2, 3], [r["deaths"] for r in self.results["rows"]["1"]])

    # ---- the kit glyph -----------------------------------------------------

    def test_a_rows_kit_is_the_loadouts_class_label_as_a_key(self) -> None:
        k = self.results["kitKeys"]
        self.assertEqual("antitank", k["label"])     # loadouts.json's "Anti-tank"
        self.assertEqual("antitank", k["key"])       # the spawn screen's own row key
        self.assertEqual("antitank", k["at"])        # the glyph's stem
        self.assertEqual("medic", k["medic"])
        # Anything outside the five classes is unknown, never a guess.
        self.assertIsNone(k["other"])
        self.assertIsNone(k["none"])
        self.assertIsNone(k["empty"])

    def test_rows_carry_kit_bot_and_dead(self) -> None:
        by_name = {r["name"]: r for side in self.results["rows"].values() for r in side}
        self.assertEqual(("engineer", False, False),
                         tuple(by_name["Local"][k] for k in ("kit", "bot", "dead")))
        self.assertEqual(("antitank", True, False),
                         tuple(by_name["Axis One"][k] for k in ("kit", "bot", "dead")))
        self.assertEqual(("scout", True, True),
                         tuple(by_name["Axis Bot"][k] for k in ("kit", "bot", "dead")))
        # A room player carries no kit; a mod's off-vocabulary kit is unknown.
        self.assertIsNone(by_name["Ally Two"]["kit"])
        self.assertIsNone(by_name["Odd Kit"]["kit"])

    def test_a_known_kit_resolves_to_its_glyph_and_an_unknown_one_to_none(self) -> None:
        i = self.results["icons"]
        self.assertEqual("class_engineer_16x16", i["human"])
        self.assertEqual("class_bot_at_16x16", i["bot"])
        self.assertIsNone(i["unknown"])
        self.assertIsNone(i["noIcons"])
        rows = i["fromRows"]
        self.assertEqual("class_engineer_16x16", rows["Local"])
        self.assertEqual("class_bot_at_16x16", rows["Axis One"])
        self.assertIsNone(rows["Ally Two"])
        self.assertIsNone(rows["Odd Kit"])

    def test_a_dead_player_gets_the_skull_in_his_own_colour(self) -> None:
        i = self.results["icons"]
        self.assertEqual("dead_16x16", i["dead"])
        self.assertEqual("bot_dead_16x16", i["botDead"])
        self.assertEqual("bot_dead_16x16", i["fromRows"]["Axis Bot"])

    def test_ping_is_zero_because_nothing_tracks_it(self) -> None:
        # `score` was the other one of these until the round learned to count
        # (`round-state.js`, and the rows below): a room carries no score, so
        # every row in this feed-driven list is still zero.
        for side in self.results["rows"].values():
            for row in side:
                self.assertEqual(0, row["score"])
                self.assertEqual(0, row["ping"])

    def test_a_row_without_a_room_slot_takes_his_numbers_from_the_tally(self) -> None:
        rows = self.results["tallyRows"]
        local = next(r for r in rows["2"] if r["name"] == "Local")
        self.assertEqual(12, local["score"])
        self.assertEqual(3, local["kills"])
        self.assertEqual(1, local["deaths"])
        bot = next(r for r in rows["1"] if r["name"] == "Axis Bot")
        self.assertEqual(-2, bot["score"])
        self.assertEqual(4, bot["deaths"])

    def test_a_row_a_room_owns_ignores_the_tally(self) -> None:
        # 'Local In A Room' carries the same player id as the tally's 12-point
        # row, and his slot means the server's feed answers instead: the feed's
        # two `killed` rows for slot 2 are his deaths, and a room carries no
        # score.
        rows = self.results["tallyRows"]
        room = next(r for r in rows["2"] if r["name"] == "Local In A Room")
        self.assertEqual(0, room["score"])
        self.assertEqual(0, room["kills"])
        self.assertEqual(2, room["deaths"])

    def test_a_player_nothing_tracked_shows_zeroes(self) -> None:
        rows = self.results["tallyRows"]
        untouched = next(r for r in rows["1"] if r["name"] == "Untouched")
        self.assertEqual(0, untouched["score"])
        self.assertEqual(0, untouched["kills"])
        self.assertEqual(0, untouched["deaths"])

    def test_a_lone_page_lists_the_local_player_and_nobody_else(self) -> None:
        lone = self.results["lone"]
        self.assertEqual(1, len(lone["1"]))
        self.assertEqual([], lone["2"])
        self.assertIsNone(lone["1"][0]["slot"])
        self.assertEqual({"1": [], "2": []}, self.results["nobody"])

    # ---- the variables -----------------------------------------------------

    def test_the_totals_are_sums_of_the_rows_not_the_files_samples(self) -> None:
        v = self.results["varsRoom"]
        self.assertEqual(2, v["Scoreboard/AxisPlayerTotal"])
        self.assertEqual(3, v["Scoreboard/AlliedPlayerTotal"])
        self.assertEqual(0, v["Scoreboard/AxisScoreTotal"])
        self.assertEqual(3, v["Scoreboard/AlliedKillsTotal"])
        self.assertEqual(3, v["Scoreboard/AlliedDeathsTotal"])
        self.assertEqual(5, v["Scoreboard/AxisDeathsTotal"])
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

    def test_a_rows_line_box_is_centred_in_the_row(self) -> None:
        row0 = self.results["geo"]["row0"][0]
        row1 = self.results["geo"]["row1"][0]
        # The face's line height (8) inside the row's own (18): retail's first
        # row puts its ink top at 93.3 virtual against the list's 89.
        self.assertEqual(89 + (18 - 8) // 2, row0["y"])
        self.assertEqual(89 + 18 + (18 - 8) // 2, row1["y"])

    def test_a_player_with_no_slot_has_no_id_cell(self) -> None:
        fields = [c["field"] for c in self.results["geo"]["row1"]]
        self.assertNotIn("id", fields)
        self.assertIn("name", fields)

    def test_unnamed_columns_draw_nothing_and_the_icon_column_is_no_text_cell(self) -> None:
        self.assertEqual(6, len(self.results["geo"]["row0"]))
        self.assertNotIn("icon", [c["field"] for c in self.results["geo"]["row0"]])

    def test_the_kit_glyph_fills_a_row_high_square_at_the_icon_column(self) -> None:
        g = self.results["geo"]
        # Box left + 10 + column 0, the row's own top, the row height a side.
        self.assertEqual({"x": 5 + 10 + 0, "y": 89, "size": 18}, g["icon0"])
        self.assertEqual({"x": 15, "y": 89 + 18, "size": 18}, g["icon1"])
        # Columns that name no icon column give no square at all.
        self.assertIsNone(g["iconNoColumn"])

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
        # fill, flag picture, DONE plate (hovered), the two Axis rows' glyphs
        # (the list box is next in file order), scroll track, lower strip; the
        # faded BAN plate is absent.
        self.assertEqual(["fillRect", "drawImage", "drawImage", "drawImage", "drawImage",
                          "fillRect", "fillRect"], kinds)
        self.assertEqual("flag_ticket_jp", p["calls"][1][1])
        self.assertEqual("knappext_mo", p["calls"][2][1])
        # A button draws at its texture's own size, not its pointer region.
        self.assertEqual([660, 557, 128, 128], p["calls"][2][2:])
        texts = [t[0] for t in p["texts"]]
        self.assertIn("DONE", texts)
        self.assertNotIn("LOCK", texts)
        self.assertNotIn("9999", texts)

    def test_the_row_glyphs_are_drawn_at_their_own_size_centred_in_the_row(self) -> None:
        p = self.results["paint"]
        glyphs = [c for c in p["calls"] if c[0] == "drawImage" and "16x16" in c[1]]
        # Axis One (a live anti-tank bot) in row 0, the dead Axis bot in row 1.
        # A 16x16 glyph one unit into an 18-unit row, not stretched to it.
        self.assertEqual([["drawImage", "class_bot_at_16x16", 16, 90, 16, 16],
                          ["drawImage", "bot_dead_16x16", 16, 108, 16, 16]], glyphs)

    def test_a_dead_rows_text_is_dimmed_and_a_live_ones_takes_its_sides_colour(self) -> None:
        p = self.results["paint"]
        dim = float(p["deadDim"])
        self.assertAlmostEqual(0.55, dim)
        by_name = {t[0]: t for t in p["texts"]}
        axis = [float(v) for v in p["colors"]["axis"]]
        # The dead row's whole line, name and numbers, is the side's colour
        # dimmed; the live one is the side's colour flat. Compared to six
        # places, since the painted values come back through a string and a
        # product of two floats does not always print back to itself.
        dead = [float(v) for v in by_name["Axis Bot"][3].split(",")]
        live = [float(v) for v in by_name["Axis One"][3].split(",")]
        for want, got in zip((v * dim for v in axis), dead):
            self.assertAlmostEqual(want, got, places=6)
        for want, got in zip(axis, live):
            self.assertAlmostEqual(want, got, places=6)
        row_y = by_name["Axis Bot"][2]
        self.assertTrue(all(t[3] == by_name["Axis Bot"][3] for t in p["texts"] if t[2] == row_y))

    def test_the_row_colour_is_the_sides_own_and_the_locals_row_is_green(self) -> None:
        c = self.results["rowColors"]
        self.assertEqual([0.84, 0.33, 0.33], c["axis"])
        self.assertEqual([0.33, 0.67, 0.83], c["allies"])
        self.assertEqual([0, 1, 0], c["local"])
        # A row on neither side is left to the leaf's own colour.
        self.assertIsNone(c["none"])
        self.assertIsNone(c["noRow"])
        # A pack's own table wins, and a null entry in it falls back.
        self.assertEqual([0.1, 0.2, 0.3], c["pack"])
        self.assertEqual([0.4, 0.5, 0.6], c["packAllies"])
        self.assertEqual([0.84, 0.33, 0.33], c["packNullAxis"])

    def test_an_unloaded_glyph_or_no_manifest_leaves_the_column_empty(self) -> None:
        n = self.results["paintNoIcons"]
        self.assertEqual(0, n["unloaded"]["icons"])
        # The text still lands either way: two Axis rows, name + four counters
        # + ID each.
        self.assertEqual(12, n["unloaded"]["texts"])
        self.assertEqual(12, n["noManifest"]["texts"])

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
        self.assertEqual(94, names[0][2])


if __name__ == "__main__":
    unittest.main()
