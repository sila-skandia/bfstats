"""`extract_scoreboard_layout.py`: the in-game score board out of `menu/InGame`.

Runs against the installed game, because the point of the extractor is what
the shipped file says. The synthetic half covers the one class the board adds
to the flattener, `VariableEffectNode`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_scoreboard_layout as esb  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402
from extract_spawn_layout import load_lexicon  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
MOD_DIR = GAME_DIR / "Mods/bf1942"
MENU_RFA = MOD_DIR / "Archives/menu.rfa"


def rect(el):
    return [round(v, 2) for v in el["rect"]]


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class ScoreboardLayoutTests(unittest.TestCase):
    """Against the shipped `menu/InGame`."""

    @classmethod
    def setUpClass(cls) -> None:
        lexicon_path = next((c for c in MOD_DIR.iterdir()
                             if c.name.lower() == "lexiconall.dat"), None)
        lexicon = load_lexicon(lexicon_path) if lexicon_path else {}
        with RfaArchive(MENU_RFA) as menu:
            entry = next(e for e in menu.entries if e.lower() == "menu/ingame")
            cls.layout = esb.decode_layout(menu.read(entry), lexicon)
        cls.elements = cls.layout["elements"]

    def find(self, **match):
        for el in self.elements:
            if all(el.get(k) == v for k, v in match.items()):
                return el
        self.fail(f"no element matching {match}")

    def all(self, **match):
        return [el for el in self.elements
                if all(el.get(k) == v for k, v in match.items())]

    def test_the_group_is_the_one_that_culls_on_spawn_score_board(self) -> None:
        self.assertEqual("Scoreboard/SpawnScoreBoard", self.layout["group"]["var"])
        self.assertEqual([0.0, -15.0, 800.0, 800.0], self.layout["group"]["rect"])
        for el in self.elements:
            self.assertIn({"var": "Scoreboard/SpawnScoreBoard", "op": "eq", "value": True},
                          el.get("when", []))

    def test_two_team_panels_on_the_voting_plate(self) -> None:
        plates = self.all(kind="picture", texture="scoreboard_512x470")
        self.assertEqual([[10.0, 45.0, 512.0, 512.0], [409.0, 45.0, 512.0, 512.0]],
                         [rect(p) for p in plates])

    def test_the_team_names_are_lexicon_strings_in_trebuchet_18(self) -> None:
        axis = self.find(kind="text", key="COL_HEADING_AXIS_TEAM")
        allied = self.find(kind="text", key="COL_HEADING_ALLIED_TEAM")
        self.assertEqual("AXIS", axis["text"])
        self.assertEqual("ALLIED", allied["text"])
        self.assertEqual("trebuchet_ms18", axis["font"])
        self.assertEqual([0.0, 0.0, 0.0, 1.0], axis["color"])

    def test_rounds_won_is_a_bound_right_aligned_number(self) -> None:
        won = self.find(kind="text", var="Scoreboard/AxisRoundWon")
        self.assertEqual("right", won["align"])
        self.assertEqual("trebuchet_ms18_latin", won["font"])

    def test_the_heading_strip_is_black_under_olive_with_five_icons(self) -> None:
        self.assertEqual([0.0, 0.0, 0.0, 1.0],
                         self.find(kind="fill", rect=[14.0, 72.0, 371.0, 18.0])["color"])
        self.assertEqual([0.5195, 0.4922, 0.3008, 1.0],
                         self.find(kind="fill", rect=[15.0, 73.0, 370.0, 16.0])["color"])
        xs = {}
        for stem in ("score", "kills", "death", "ping", "id"):
            icons = self.all(kind="picture", texture=f"menu_icon_{stem}_16x16")
            xs[stem] = min(rect(i)[0] for i in icons)
        self.assertEqual({"score": 189.0, "kills": 224.0, "death": 259.0,
                          "ping": 294.0, "id": 324.0}, xs)

    def test_the_icons_sit_one_unit_left_of_the_list_columns(self) -> None:
        # The match the column naming rests on: box left + 10 + column int is
        # one unit right of the heading strip's own icon, for every named
        # column, and of its PLAYERNAME label.
        box = self.find(kind="listbox", data="Scoreboard/AxisScoreboardList")
        cols = {c["field"]: c["x"] for c in self.layout["listColumns"]["columns"] if c["field"]}
        inset = self.layout["listColumns"]["textInset"]
        icon = {"score": "score", "kills": "kills", "deaths": "death", "ping": "ping", "id": "id"}
        for field, stem in icon.items():
            x = min(rect(i)[0] for i in self.all(kind="picture",
                                                 texture=f"menu_icon_{stem}_16x16"))
            self.assertEqual(x + 1, rect(box)[0] + inset + cols[field], field)
        label = self.find(kind="text", key="COL_HEADING_PLAYER_NAME")
        self.assertEqual(rect(label)[0] + 1, rect(box)[0] + inset + cols["name"])

    def test_the_list_boxes_carry_the_files_own_metrics(self) -> None:
        for data, x in (("Scoreboard/AxisScoreboardList", 5.0),
                        ("Scoreboard/AlliedScoreboardList", 404.0)):
            box = self.find(kind="listbox", data=data)
            self.assertEqual([x, 65.0, 391.0, 420.0], rect(box))
            self.assertEqual(18.0, box["rowHeight"])
            self.assertEqual("standard6_latin", box["font"])

    def test_the_client_columns_are_recorded(self) -> None:
        xs = [c["x"] for c in self.layout["listColumns"]["columns"]]
        self.assertEqual([0, 25, 150, 175, 210, 245, 280, 310, 355, 370, 385, 400, 415, 450], xs)
        self.assertEqual(10.0, self.layout["listColumns"]["textInset"])
        unnamed = [c["x"] for c in self.layout["listColumns"]["columns"] if not c["field"]]
        self.assertNotIn(0, unnamed)
        self.assertIn(150, unnamed)

    def test_the_first_column_is_the_kit_glyph(self) -> None:
        first = self.layout["listColumns"]["columns"][0]
        self.assertEqual({"x": 0, "field": "icon"}, first)
        icons = self.layout["rowIcons"]
        self.assertEqual(["antitank", "assault", "engineer", "medic", "scout"],
                         sorted(icons["human"]))
        self.assertEqual(sorted(icons["human"]), sorted(icons["bot"]))
        self.assertEqual("class_at_16x16", icons["human"]["antitank"])
        self.assertEqual("class_bot_scout_16x16", icons["bot"]["scout"])
        self.assertEqual("dead_16x16", icons["dead"])
        self.assertEqual("bot_dead_16x16", icons["botDead"])

    def test_the_row_glyphs_are_in_the_menu_chain(self) -> None:
        # The `Debriefing/classes` set, every one the layout names.
        wanted = {*self.layout["rowIcons"]["human"].values(),
                  *self.layout["rowIcons"]["bot"].values(),
                  self.layout["rowIcons"]["dead"], self.layout["rowIcons"]["botDead"]}
        with RfaArchive(MENU_RFA) as menu:
            stems = {e.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower() for e in menu.entries
                     if "/debriefing/classes/" in e.lower()}
        self.assertEqual(set(), wanted - stems)

    def test_the_totals_row_is_five_bound_numbers_a_side(self) -> None:
        for side in ("Axis", "Allied"):
            for stat in ("Player", "Score", "Kills", "Deaths", "Ping"):
                el = self.find(kind="text", var=f"Scoreboard/{side}{stat}Total")
                self.assertEqual("standard6_latin", el["font"])

    def test_the_ticket_flags_are_bound_pictures(self) -> None:
        self.assertEqual("flag_ticket_ger", self.find(kind="picture", var="AxisTicketFlag")["texture"])
        self.find(kind="picture", var="AlliedTicketFlag")

    def test_the_red_button_reads_done_from_spawn_and_lock_otherwise(self) -> None:
        button = self.find(kind="button", texture="knappext_n")
        self.assertEqual([660.0, 557.0, 109.0, 25.0], rect(button))
        self.assertEqual("knappext_mo", button["hover"])
        done = self.find(kind="text", key="RESPAWN_DONE")
        lock = self.find(kind="text", key="SCOREBOARD_LOCK")
        self.assertIn({"var": "Scoreboard/FromSpawnScoreboard", "op": "eq", "value": True},
                      done["when"])
        self.assertIn({"var": "Scoreboard/FromSpawnScoreboard", "op": "ne", "value": True},
                      lock["when"])

    def test_the_multiplayer_buttons_are_culled_in_single_player(self) -> None:
        sp = {"var": "Scoreboard/GameStatusSinglePlayer", "op": "ne", "value": True}
        for key in ("SCOREBOARD_ADD_BUDDY", "SCOREBOARD_DROP_BUDDY", "SCOREBOARD_VOTE_KICK",
                    "SCOREBOARD_VOTE_KICK_TEAM", "SCOREBOARD_BRINGUP_MAPVOTE"):
            for el in self.all(kind="text", key=key):
                self.assertIn(sp, el["when"], key)
        self.assertNotIn(sp, self.find(kind="button", texture="knappext_n")["when"])

    def test_the_non_admin_kick_and_ban_plates_carry_the_level_zero_fade(self) -> None:
        faded = [el for el in self.elements if "fade" in el]
        self.assertEqual(4, len(faded))   # two plates, two labels
        self.assertTrue(all(el["fade"] == 0.0 for el in faded))
        self.assertEqual({"Kick", "Ban"}, {el["text"] for el in faded if el["kind"] == "text"})
        # The faded BAN plate sits on ADD BUDDY's rect: drawn, it would cover it.
        ban = next(el for el in faded if el["kind"] == "button" and rect(el)[1] == 557.0)
        add = next(el for el in self.all(kind="button", texture="knapp3_n")
                   if "fade" not in el and rect(el) == rect(ban))
        self.assertEqual(rect(ban), rect(add))
        # The fade ends with the list it was declared in.
        self.assertNotIn("fade", self.find(kind="text", key="SCOREBOARD_BRINGUP_MAPVOTE"))

    def test_the_server_plate(self) -> None:
        self.assertEqual([534.0, 511.0, 256.0, 32.0],
                         rect(self.find(kind="picture", texture="ingame_serverip_256x32")))
        for var in ("Scoreboard/ServerName", "Scoreboard/ServerIp", "Scoreboard/MapName"):
            self.find(kind="text", var=var)

    def test_every_font_and_texture_the_page_names_is_listed(self) -> None:
        self.assertEqual(["standard6", "standard6_latin", "trebuchet_ms18",
                          "trebuchet_ms18_latin", "trebuchet_ms8"], self.layout["fonts"])
        names = esb.layout_textures(self.layout)
        for name in ("scoreboard_512x470", "scoreboard_buttonframe_780x64",
                     "kick_mapmessage_long", "knappext_n", "knappext_mo", "knapp3_n",
                     "menu_scrollpilupp_16x8", "ingame_serverip_256x32",
                     "class_scout_16x16", "class_bot_medic_16x16", "dead_16x16",
                     "bot_dead_16x16"):
            self.assertIn(name, names)


class BoardFlattenerTests(unittest.TestCase):
    """`VariableEffectNode` is sibling-scoped and ends with its list."""

    @staticmethod
    def node(cls, **fields):
        return meme.Obj(cls=cls, fields=fields)

    def test_an_alpha_fade_marks_the_siblings_after_it_only(self) -> None:
        N = self.node
        level = N("FloatData", Value=0.0)
        fade = N("VariableEffectNode", Effect=N("AlphaFadeEffect"), **{"Effect level": level})
        before = N("PictureNode", Picture="a.tga")
        after = N("PictureNode", Picture="b.tga")
        inner = N("SplitNode")
        outside = N("PictureNode", Picture="c.tga")
        inner.fields["Split node"] = before
        before.fields["Next node"] = fade
        fade.fields["Next node"] = after
        inner.fields["Next node"] = outside
        flat = esb.BoardFlattener({})
        flat.run(inner.chain())
        got = {el["texture"]: el.get("fade") for el in flat.elements}
        self.assertEqual({"a": None, "b": 0.0, "c": None}, got)


if __name__ == "__main__":
    unittest.main()
