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

    def test_a_row_with_the_servers_stats_shows_them(self) -> None:
        # A sidecar row: the retail server's BFPlayer stats, the local
        # player's as much as a remote's, over the feed (two deaths for slot
        # 2) and the round's tally (12 points for id 0).
        rows = self.results["statsRows"]
        by_name = {r["name"]: r for side in rows.values() for r in side}
        self.assertEqual((10, 2, 1, 0), tuple(by_name["Gerasim Kozin"][k] for k in ("score", "kills", "deaths", "ping")))
        self.assertEqual((0, 0, 0, 3), tuple(by_name["hprobe"][k] for k in ("score", "kills", "deaths", "ping")))
        # A row with no stats in the same list keeps the feed's three deaths.
        self.assertEqual(3, by_name["No Stats"]["deaths"])
        # Sorted by the server's score.
        self.assertEqual(["Bernhard Niemann", "hprobe", "No Stats"], [r["name"] for r in rows["1"]])

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

    def test_the_end_of_a_round_drops_the_buttons_and_counts_the_rounds(self) -> None:
        v = self.results["varsEnd"]
        self.assertTrue(v["Scoreboard/GameStatusEndGame"])
        self.assertEqual((2, 1), (v["Scoreboard/AxisRoundWon"], v["Scoreboard/AlliedRoundWon"]))
        self.assertFalse(self.results["varsLone"]["Scoreboard/GameStatusEndGame"])
        self.assertEqual(0, self.results["varsLone"]["Scoreboard/AlliedRoundWon"])

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

    def test_the_first_baseline_is_two_row_heights_below_the_box(self) -> None:
        # MEME-21: the file's own row height (18), not the ctor's 12.0, twice.
        g = self.results["geo"]
        self.assertEqual(2, g["firstRows"])
        self.assertEqual(18, g["pitch"])
        self.assertEqual(65 + 2 * 18, g["first"])
        self.assertEqual(101, g["baseline0"])
        self.assertEqual(101 + 20 * 18, g["baseline20"])

    def test_rows_are_drawn_while_the_baseline_is_a_row_above_the_bottom(self) -> None:
        g = self.results["geo"]
        # Baselines 101, 119, ... 461 all lie within 65 + 420 - 18 = 467; the
        # next, 479, does not. No strip or floor enters into it.
        self.assertEqual(21, g["visibleRows"])
        self.assertEqual(1, g["threeHigh"])
        self.assertEqual(0, g["tooShort"])

    def test_a_cell_starts_at_box_left_plus_ten_plus_the_column(self) -> None:
        cells = {c["field"]: c for c in self.results["geo"]["row0"]}
        self.assertEqual(5 + 10 + 25, cells["name"]["x"])
        self.assertEqual(5 + 10 + 175, cells["score"]["x"])
        self.assertEqual(5 + 10 + 210, cells["kills"]["x"])
        self.assertEqual(5 + 10 + 245, cells["deaths"]["x"])
        self.assertEqual(5 + 10 + 280, cells["ping"]["x"])
        self.assertEqual(5 + 10 + 310, cells["id"]["x"])
        self.assertEqual("<7>", cells["id"]["text"])

    def test_a_rows_text_sits_on_its_baseline(self) -> None:
        row0 = self.results["geo"]["row0"][0]
        row1 = self.results["geo"]["row1"][0]
        # The line's top is the baseline less the face's own (7): the name's
        # cap ink runs 94..101, where retail's measures 93.3.
        self.assertEqual(101, row0["baseline"])
        self.assertEqual(101 - 7, row0["y"])
        self.assertEqual(101 + 18 - 7, row1["y"])

    def test_a_cell_is_clipped_twenty_short_of_the_next_column(self) -> None:
        cells = {c["field"]: c for c in self.results["geo"]["row0"]}
        self.assertEqual(150 - 25 - 20, cells["name"]["clip"])
        self.assertEqual(210 - 175 - 20, cells["score"]["clip"])
        self.assertEqual(355 - 310 - 20, cells["id"]["clip"])

    def test_a_row_with_no_id_text_has_no_id_cell(self) -> None:
        fields = [c["field"] for c in self.results["geo"]["row1"]]
        self.assertNotIn("id", fields)
        self.assertIn("name", fields)

    def test_unnamed_columns_draw_nothing_and_the_icon_column_is_no_text_cell(self) -> None:
        self.assertEqual(6, len(self.results["geo"]["row0"]))
        self.assertNotIn("icon", [c["field"] for c in self.results["geo"]["row0"]])

    def test_the_kit_glyph_is_the_row_fills_16_by_16_cell_11_above_the_baseline(self) -> None:
        g = self.results["geo"]
        self.assertEqual({"w": 16, "h": 16, "x": 0, "y": 11}, g["kitCell"])
        # Box left + 10 + the cell's own x, its top 11 above baseline 101:
        # retail's first square is at (15.0, 90.0) on the Bocage capture.
        self.assertEqual({"x": 15, "y": 90, "w": 16, "h": 16}, g["icon0"])
        self.assertEqual({"x": 15, "y": 108, "w": 16, "h": 16}, g["icon1"])

    def test_a_rows_band_runs_from_ten_in_to_ten_short_and_sixteen_high(self) -> None:
        g = self.results["geo"]
        self.assertEqual({"x": 10, "y": -11, "w": -20, "h": 16}, g["rowBand"])
        # The capture's local row on the Allied list: 414..785 x 252..268.
        self.assertEqual({"x": 15, "y": 90, "w": 371, "h": 16}, g["band0"])

    def test_the_local_row_is_banded_black_at_half_and_a_buddy_blue(self) -> None:
        b = self.results["bands"]
        self.assertEqual([0, 0, 0, 0.5], b["local"])
        self.assertEqual([0.0390625, 0.24609379470348358, 0.34375, 0.5], b["buddy"])
        self.assertIsNone(b["plain"])
        self.assertIsNone(b["noRow"])
        self.assertEqual([0, 0.1875, 0.5389999747276306, 0.800000011920929],
                         b["colors"]["selected"])

    def test_a_cut_keeps_the_glyph_that_crosses(self) -> None:
        c = self.results["clip"]
        self.assertEqual("abc", c["whole"])
        # 6 a glyph: 24 passes 20, and that fourth glyph is drawn.
        self.assertEqual("abcd", c["crossing"])
        self.assertEqual("abcde", c["exact"])
        self.assertEqual("a", c["none"])

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

    def test_the_row_glyphs_are_drawn_in_their_cell(self) -> None:
        p = self.results["paint"]
        glyphs = [c for c in p["calls"] if c[0] == "drawImage" and "16x16" in c[1]]
        # Axis One (a live anti-tank bot) in row 0, the dead Axis bot in row 1.
        self.assertEqual([["drawImage", "class_bot_at_16x16", 15, 90, 16, 16],
                          ["drawImage", "bot_dead_16x16", 15, 108, 16, 16]], glyphs)

    def test_the_local_row_gets_its_band_under_its_glyph_and_text(self) -> None:
        p = self.results["paintLocal"]
        calls = p["calls"]
        self.assertEqual(["fillRect", "rgb(0,0,0)", 0.5, 15, 90, 371, 16], calls[0])
        self.assertEqual(["drawImage", "class_engineer_16x16", 15, 90, 16, 16], calls[1])
        # The other two Allied rows are clear, and carry no known kit.
        self.assertEqual(2, len(calls))
        local = next(t for t in p["texts"] if t[0] == "Local")
        self.assertEqual([40, 94], local[1:3])

    def test_a_long_name_is_cut_where_the_list_draw_cuts_it(self) -> None:
        # 6 a glyph against 150 - 25 - 20 = 105: the eighteenth passes it.
        self.assertEqual("N" * 18, self.results["paintLongName"][0])

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
        # each. Both are bots, so neither has an id in column 7.
        self.assertEqual(10, n["unloaded"]["texts"])
        self.assertEqual(10, n["noManifest"]["texts"])

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
        self.assertEqual({"Scoreboard/AxisScoreboardList": 21}, p["visibleRows"])
        names = [t for t in p["texts"] if t[0] == "Axis One"]
        self.assertEqual(1, len(names))
        self.assertEqual(40, names[0][1])
        self.assertEqual(94, names[0][2])


    def test_a_bound_picture_resolves_through_the_hud_pack_first(self) -> None:
        # The live ticket flag is the mod's own HUD art; the board's copy of
        # the same name is the layout's literal default (audit H2).
        b = self.results["bound"]
        self.assertEqual(["hud:flag_ticket_ger", "board:flag_ticket_ger"], b["drawn"])
        self.assertEqual(["board:flag_ticket_ger"], b["withoutBound"])

    # ---- column 7 and the medal cells (MEME-25) -----------------------------

    def test_column_seven_is_the_id_in_angle_brackets_for_a_human(self) -> None:
        t = self.results["idText"]
        # `<%d>` (0x009250cc) in a game joined (2) or hosted (3).
        self.assertEqual("<4>", t["human"])
        self.assertEqual("<0>", t["hosted"])

    def test_column_seven_is_empty_for_a_bot_in_single_player_or_without_an_id(self) -> None:
        t = self.results["idText"]
        self.assertEqual("", t["bot"])
        # `0x0045d050`: StartingGame 0, 1 or 4.
        self.assertEqual([0, 1, 4], t["games"])
        self.assertEqual(["", "", ""], t["singlePlayer"])
        # No id the page has, nothing printed: a room slot alone is not one.
        self.assertEqual("", t["noId"])
        self.assertEqual("", t["slotOnly"])

    def test_rows_carry_the_id_text_and_the_medal_counters(self) -> None:
        rows = {r["name"]: r for t in ("1", "2") for r in self.results["medalRows"][t]}
        self.assertEqual("<0>", rows["hprobe"]["idText"])
        self.assertEqual("<2>", rows["Human Two"]["idText"])
        self.assertEqual("", rows["Gerasim Kozin"]["idText"])
        self.assertEqual("", rows["Page Bot"]["idText"])
        self.assertEqual("", rows["Room Row"]["idText"])
        # A sidecar row's counters are its stats', the page's own its own.
        self.assertEqual([2, 0, 1], rows["Gerasim Kozin"]["medals"])
        self.assertEqual([0, 0, 1], rows["Page Bot"]["medals"])
        self.assertIsNone(rows["Room Row"]["medals"])
        self.assertEqual(7, rows["Page Bot"]["key"])
        single = [r["idText"] for t in ("1", "2") for r in self.results["medalRowsSingle"][t]]
        self.assertEqual({""}, set(single))

    def test_the_medal_cells_are_the_best_three_medals_gold_first(self) -> None:
        m = self.results["medalKinds"]
        self.assertEqual(["empty"] * 3, m["none"])
        self.assertEqual(["gold", "empty", "empty"], m["oneGold"])
        self.assertEqual(["gold", "silver", "empty"], m["mixed"])
        self.assertEqual(["bronze"] * 3, m["bronzes"])
        self.assertEqual(["gold"] * 3, m["many"])
        self.assertEqual(["silver", "bronze", "empty"], m["silverBronze"])
        self.assertEqual(["gold", "gold", "empty"], m["short"])
        self.assertIsNone(m["unknown"])

    def test_the_medal_cells_sit_at_340_350_360_six_above_the_baseline(self) -> None:
        g = self.results["medalGeo"]
        self.assertEqual([{"w": 8, "h": 8, "x": x, "y": 6} for x in (340, 350, 360)], g["cells"])
        # Box left 5 + 10 + the cell's own x; baseline 101 less 6.
        self.assertEqual([{"x": 5 + 10 + x, "y": 95, "w": 8, "h": 8} for x in (340, 350, 360)], g["row0"])
        self.assertEqual([113] * 3, [c["y"] for c in g["row1"]])

    def test_the_painter_draws_the_medal_textures_and_the_id(self) -> None:
        p = self.results["paintMedals"]
        self.assertEqual([
            ["drawImage", "allied_gold_8x8", 355, 95, 8, 8],
            ["drawImage", "allied_gold_8x8", 365, 95, 8, 8],
            ["drawImage", "allied_bronze_8x8", 375, 95, 8, 8],
            ["drawImage", "allied_silver_8x8", 355, 113, 8, 8],
            ["drawImage", "empty_8x8", 365, 113, 8, 8],
            ["drawImage", "empty_8x8", 375, 113, 8, 8],
        ], p["draws"])
        self.assertIn(["<0>", 5 + 10 + 310, 112], p["texts"])
        self.assertNotIn("<1>", [t[0] for t in p["texts"]])
        # A pack without `rowMedals` draws no medal cells.
        self.assertEqual(0, p["noPack"])


if __name__ == "__main__":
    unittest.main()
