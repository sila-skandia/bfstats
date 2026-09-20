"""`extract_menu_layout.py`: the Instant Battle screen out of `menu.rfa`.

Two halves. The first runs against the installed game, because the point of
the extractor is what the shipped files say and a synthetic fixture would
only assert that the code agrees with itself. The second is synthetic, for
the parts that have to hold whatever the archives contain.

Also runs `test_menu_screen.mjs`, the node suite over `viewer/play/
menu-screen.js`, so `unittest discover` reaches it.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_menu_layout as eml  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.level import ControlPointTemplate, GameplayObjects, StaticInstance  # noqa: E402
from bf42.modmenu import LayeredArchive, MenuSources  # noqa: E402
from bf42.rfa import RfaArchive, find_archives_dir  # noqa: E402
from extract_models import mod_chain  # noqa: E402
from extract_spawn_layout import load_lexicon  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
MOD_DIR = GAME_DIR / "Mods/bf1942"
MENU_RFA = MOD_DIR / "Archives/menu.rfa"
EOD_DIR = GAME_DIR / "Mods/EoD"


def _eod_menu_rfa() -> Path | None:
    # EoD's own `Archives` directory is lower-case on this machine --
    # `find_archives_dir` is what every extractor already resolves it
    # through, so the skip gate below does too rather than hardcoding a case
    # that only happens to be right for vanilla.
    archives = find_archives_dir(EOD_DIR)
    return (archives / "menu.rfa") if archives else None


EOD_MENU_RFA = _eod_menu_rfa()
LEXICON = MOD_DIR / "lexiconAll.dat"

NODE_SUITE = Path(__file__).with_name("test_menu_screen.mjs")


def rect(el):
    return [round(v, 2) for v in el["rect"]]


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class SkirmishLayoutTests(unittest.TestCase):
    """Against the shipped `menu/SkirmishMenu`."""

    @classmethod
    def setUpClass(cls) -> None:
        lexicon_path = next((c for c in MOD_DIR.iterdir()
                             if c.name.lower() == "lexiconall.dat"), None)
        cls.lexicon = eml.load_lexicon(lexicon_path) if lexicon_path else {}
        with LayeredArchive([MENU_RFA], ["bf1942"]) as menu:
            cls.layout = eml.decode_layout(menu, cls.lexicon)
        cls.elements = cls.layout["pages"]["skirmish"]["elements"]

    def find(self, **match):
        for el in self.elements:
            if all(el.get(k) == v for k, v in match.items()):
                return el
        self.fail(f"no element matching {match}")

    def test_virtual_resolution(self) -> None:
        self.assertEqual([800, 600], self.layout["virtual"])

    def test_the_screen_names_itself(self) -> None:
        # The tab over the difficulty panel is the screen's own title, and it
        # is what the player picked in Singleplayer.
        self.assertEqual("INSTANT BATTLE", self.layout["strings"]["SINGLEPLAYER_SKIRMISH"])

    def test_the_three_panels(self) -> None:
        # Preview top, LEVELS under it, TEAM to the right - the arrangement
        # the reference capture shows, in the file's own coordinates.
        preview = self.find(kind="picture", texture="menu_creategame_karta_256x128")
        levels = self.find(kind="picture", texture="menu_singlepl_levellist_256x256")
        team = self.find(kind="picture", texture="menu_campaign_team_256x128")
        self.assertEqual([385, 125, 256, 128], rect(preview))
        self.assertEqual([385, 237, 256, 256], rect(levels))
        self.assertEqual([585, 237, 256, 128], rect(team))
        self.assertEqual(rect(preview)[0], rect(levels)[0], "LEVELS sits under the preview")
        self.assertGreater(rect(team)[0], rect(levels)[0], "TEAM is to the right of both")

    def test_panel_headings_are_lexicon_strings_in_the_heading_face(self) -> None:
        for key, text in (("CREATE_GAME_LEVELS", "LEVELS"), ("SINGLEPLAYER_TEAM", "TEAM")):
            el = self.find(kind="text", key=key)
            self.assertEqual(text, el["text"])
            self.assertEqual("trebuchet_ms8", el["font"])
            # Black, from the ColorEffect above it.
            self.assertEqual([0.0, 0.0, 0.0, 1.0], el["color"])

    def test_the_preview_is_a_runtime_slot(self) -> None:
        el = self.find(kind="picture", var="Skirmish/SkirmishMap")
        self.assertEqual([390, 130, 172, 128], rect(el))
        # Its shipped default is Wake's thumbnail; the engine swaps in the
        # selected level's. It must not be mistaken for a plate to extract.
        self.assertNotIn("thumbnail", eml.layout_textures(self.layout))

    def test_the_level_list_box(self) -> None:
        box = self.find(kind="listbox")
        self.assertEqual("Skirmish/SkirmishLevelsList", box["data"])
        self.assertEqual("standard6", box["font"])
        self.assertEqual(14.0, box["rowHeight"])
        self.assertTrue(box["selectable"])
        self.assertEqual(["Skirmish/StartSkirmish"], box["onSelect"])
        self.assertEqual(["Skirmish/SelectSkirmishLevel"], box["onFocus"])
        # The fields MEME-11's 57 missing bytes turned out to be. Seven of
        # them round-trip `BfNewListBoxNode`'s constructor defaults
        # (0x007d1200): frame colour 1/1/1/0 at +0x8c..+0x98 and select
        # colour 0/0.1875/0.5390 at +0x9c..+0xa4. Reading the schema one
        # field short or long would not reproduce those.
        self.assertEqual([1.0, 1.0, 1.0, 0.0], box["frame"])
        self.assertAlmostEqual(0.1875, box["select"][1], places=6)
        self.assertAlmostEqual(0.5389, box["select"][2], places=4)
        self.assertEqual(6.0, box["scrollbarWidth"])
        self.assertEqual(4.0, box["scrollbarOffset"])
        self.assertFalse(box["showTooltip"])

    def test_the_scroll_controls_flank_the_list(self) -> None:
        up = self.find(kind="button", texture="menu_scrollpilupp_16x8")
        down = self.find(kind="button", texture="menu_scrollpilner_16x8")
        self.assertEqual([555, 263, 16, 8], rect(up))
        self.assertEqual([555, 409, 16, 8], rect(down))
        # The track between them is an unnamed fill; find it by its shape.
        dark = [el for el in self.elements
                if el["kind"] == "fill" and rect(el)[2] < 20 and rect(el)[3] > 100]
        self.assertEqual(1, len(dark), "one scroll track")
        self.assertEqual([555, 272, 10, 145], rect(dark[0]))
        self.assertEqual(0.8, round(dark[0]["color"][3], 2))
        self.assertEqual(rect(up)[0], rect(dark[0])[0], "arrows and track share a column")

    def test_the_team_rows_set_campaign_team(self) -> None:
        axis = self.find(kind="text", key="SINGLEPLAYER_TEAM_AXIS")
        allied = self.find(kind="text", key="SINGLEPLAYER_TEAM_ALLIES")
        self.assertEqual("AXIS", axis["text"])
        self.assertEqual("ALLIED", allied["text"])
        self.assertLess(rect(axis)[1], rect(allied)[1], "AXIS is the upper row")

        hits = [el for el in self.elements if el["kind"] == "hit"
                and any(s["var"] == "Campaign/Team" for s in el.get("sets", []))]
        self.assertEqual(2, len(hits))
        values = sorted(s["value"] for el in hits for s in el["sets"]
                        if s["var"] == "Campaign/Team")
        self.assertEqual([eml.AXIS, eml.ALLIED], values)

    def test_the_selected_team_row_is_filled_olive_across_its_width(self) -> None:
        fills = [el for el in self.elements if el["kind"] == "fill"
                 and el.get("when") and el["when"][0].get("var") == "Campaign/Team"]
        self.assertEqual(2, len(fills))
        for el in fills:
            self.assertEqual(169.0, rect(el)[2], "the full row width")
            r, g, b, a = el["color"]
            self.assertAlmostEqual(0.4922, r, places=3)
            self.assertAlmostEqual(0.5352, g, places=3)
            self.assertAlmostEqual(0.2891, b, places=3)
            self.assertEqual(1.0, a)
        # One gated on 1 and one on 2, so exactly one is lit at a time.
        self.assertEqual([1, 2], sorted(el["when"][0]["value"] for el in fills))

    def test_start_button_is_the_green_plate_and_calls_start_skirmish(self) -> None:
        nav = self.layout["pages"]["navigation"]["elements"]
        buttons = [el for el in nav if el["kind"] == "button"]
        self.assertTrue(buttons)
        for el in buttons:
            self.assertEqual("knapp3_n", el["texture"])
            self.assertEqual("knapp3_mo", el["hover"])
            self.assertIn("Skirmish/StartSkirmish", el["calls"])
            self.assertEqual([670, 535, 109, 25], rect(el))
        label = next(el for el in nav if el["kind"] == "text")
        self.assertEqual("START", label["text"])
        self.assertEqual("center", label["align"])

    def test_the_start_button_is_not_left_at_its_pre_transition_alpha(self) -> None:
        # `VariableColorEffect` binds the button's alpha to
        # `Navigation/Level3/Fade/AlphaFade12`, whose stored value is 0 - the
        # state before the page fades in. Resolving it through the page's own
        # tweener end values is what keeps the button visible.
        for el in self.layout["pages"]["navigation"]["elements"]:
            self.assertNotEqual(0.0, (el.get("color") or [1, 1, 1, 1])[3],
                                f"{el['kind']} is fully transparent")

    def test_the_background_is_the_camouflaged_plate_on_black(self) -> None:
        els = self.layout["pages"]["background"]["elements"]
        self.assertEqual([[0.0, 0.0, 800.0, 600.0], [0.0, 85.0, 800.0, 450.0]],
                         [rect(el) for el in els])
        self.assertEqual("fill", els[0]["kind"])
        self.assertEqual([0.0, 0.0, 0.0, 1.0], els[0]["color"])
        self.assertEqual("background", els[1]["texture"])

    def test_every_page_is_read(self) -> None:
        self.assertEqual({"background", "skirmish", "navigation"},
                         set(self.layout["pages"]))

    def test_fonts_are_the_faces_the_text_nodes_name(self) -> None:
        self.assertIn("standard6", self.layout["fonts"])
        self.assertIn("trebuchet_ms8", self.layout["fonts"])


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class LevelRecordTests(unittest.TestCase):
    """The rows the file does not hold: the engine fills the list box from
    the level archives, so they are read from there."""

    @classmethod
    def setUpClass(cls) -> None:
        archives = find_archives_dir(MOD_DIR)
        cls.by_name = eml.level_archives(archives)
        cls.titles = eml.title_index(load_lexicon(LEXICON, keep="first"))
        cls.records = {}
        for name in ("midway", "berlin", "el_alamein", "wake", "market_garden",
                     "omaha_beach", "aberdeen", "coral_sea"):
            paths = cls.by_name.get(name)
            if paths:
                cls.records[name] = eml.level_record(name, paths, None, False,
                                                     cls.titles)

    def test_every_vanilla_level_is_found(self) -> None:
        # 23 levels ship with 1.61; the patch archives fold into their base.
        self.assertGreaterEqual(len(self.by_name), 20)
        self.assertIn("midway", self.by_name)
        self.assertIn("wake", self.by_name)

    def test_patch_archives_do_not_become_levels_of_their_own(self) -> None:
        for name in self.by_name:
            self.assertNotRegex(name, r"_\d{3}$")
        self.assertGreater(len(self.by_name["midway"]), 1, "Midway has patches")

    def test_midway_is_japan_against_the_us(self) -> None:
        # The design's reference capture shows Midway with the US flag left
        # and the Japanese rising sun right; `game.setTeamSkin` is where that
        # comes from, and team 1 is Axis.
        m = self.records["midway"]
        self.assertEqual("BATTLE OF MIDWAY", m["title"])
        self.assertEqual("JapaneseSoldier", m["axis"]["skin"])
        self.assertEqual("jp", m["axis"]["nation"])
        self.assertEqual("us", m["allied"]["nation"])
        self.assertEqual("icon_flag_jp", m["axis"]["flag"])
        self.assertEqual("icon_flag_us", m["allied"]["flag"])

    def test_the_other_theatres(self) -> None:
        self.assertEqual(("ger", "rus"), (self.records["berlin"]["axis"]["nation"],
                                          self.records["berlin"]["allied"]["nation"]))
        self.assertEqual(("ger", "brit"), (self.records["el_alamein"]["axis"]["nation"],
                                           self.records["el_alamein"]["allied"]["nation"]))

    def test_titles_come_from_the_level_s_own_lexicon_record(self) -> None:
        # `lexiconAll.dat` keys a record on the level's directory name and
        # its first translation column is English, which is what the game's
        # own list shows. The loading screen's table is a different string
        # for four of the 23, and it is kept beside the title rather than
        # used as it.
        self.assertEqual("BATTLE OF MIDWAY", self.records["midway"]["title"])
        self.assertEqual("MIDWAY", self.records["midway"]["loadingTitle"])
        self.assertEqual("lexiconAll.dat:Midway",
                         self.records["midway"]["titleSource"])
        self.assertEqual("OPERATION MARKET GARDEN",
                         self.records["market_garden"]["title"])
        self.assertEqual("WAKE ISLAND", self.records["wake"]["title"])
        # The key's casing is not the directory's: `aberdeen` is `ABERDEEN`.
        self.assertEqual("OPERATION ABERDEEN", self.records["aberdeen"]["title"])

    def test_a_level_title_beats_a_control_point_of_the_same_name(self) -> None:
        # `Omaha_Beach` is in the lexicon twice: record 976, inside the
        # level-title block, is "OMAHA BEACH"; record 1332, inside a block
        # of control-point labels, is "Omaha Beach". The first wins.
        self.assertEqual("OMAHA BEACH", self.records["omaha_beach"]["title"])

    def test_levels_the_lexicon_has_never_heard_of_fall_back(self) -> None:
        # `Kasserine_Pass.rfa` and `Truk.rfa` were dropped into this install
        # on 2026-09-07; they are not retail 1.61 levels and have no lexicon
        # record. The loading screen's table answers for them.
        for name in ("kasserine_pass", "truk"):
            if name not in self.by_name:
                continue
            record = eml.level_record(name, self.by_name[name], None, False,
                                      self.titles)
            self.assertEqual("extract_loading_assets.format_map_title",
                             record["titleSource"])
            self.assertEqual(record["loadingTitle"], record["title"])

    def test_bot_support_is_what_the_real_list_holds(self) -> None:
        # The game's Instant Battle list offers the levels with bots, and
        # bot support is a `SinglePlayer` mode directory in the level
        # archive. Aberdeen, Coral Sea, Invasion of the Philippines and
        # Liberation of Caen ship Conquest only, and the reference capture
        # has none of them.
        self.assertTrue(self.records["midway"]["singlePlayer"])
        self.assertTrue(self.records["wake"]["singlePlayer"])
        self.assertFalse(self.records["aberdeen"]["singlePlayer"])
        self.assertFalse(self.records["coral_sea"]["singlePlayer"])

    def test_every_level_resolves_both_nations(self) -> None:
        missing = []
        for name, paths in self.by_name.items():
            record = eml.level_record(name, paths, None, False)
            if record is None:
                continue
            for side in ("axis", "allied"):
                if record.get(side) and record[side]["nation"] is None:
                    missing.append((name, side, record[side]["skin"]))
        self.assertEqual([], missing, "a team skin with no nation in SKIN_NATION")


class TeamNationFromLevelTests(unittest.TestCase):
    """`team_nation_from_level`: a team's nation is the flag its own control
    points fly, not the skin painted on the men who hold it. Synthetic --
    the shape a level's `GameplayObjects` takes is exercised for real by
    `LevelNationFromArchivesTests` and `EodLevelNationTests` below."""

    NATIONS = {"us": "us", "ge": "ger", "uk": "brit", "jp": "jp",
              "so": "so", "can": "can"}

    @staticmethod
    def gameplay(cps: list[tuple[int, str | None, bool]]) -> GameplayObjects:
        """`(team, flagMesh, unableToChangeTeam)` triples, one template per
        control point -- the shape `extract_map.py`'s own control-point
        report reads, team-less `flag_mesh()` and all."""
        templates: dict[str, ControlPointTemplate] = {}
        instances: list[StaticInstance] = []
        for i, (team, mesh, uctt) in enumerate(cps):
            name = f"cp{i}"
            tpl = ControlPointTemplate(name=name, team=team,
                                       unable_to_change_team=uctt)
            if mesh:
                tpl.team_geometry[team] = mesh
            templates[name] = tpl
            instances.append(StaticInstance(name, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
        return GameplayObjects(mode="Conquest", control_points=instances,
                               control_point_templates=templates)

    def test_a_single_main_base_answers_outright(self) -> None:
        gp = self.gameplay([(1, "flagjp_m1", True), (2, "flagus_m1", True)])
        self.assertEqual("jp", eml.team_nation_from_level(gp, 1, self.NATIONS))
        self.assertEqual("us", eml.team_nation_from_level(gp, 2, self.NATIONS))

    def test_the_main_base_wins_over_a_majority_elsewhere(self) -> None:
        # xa_loi_pagoda's shape: were this level's allied side to carry more
        # than one flag, a non-main majority must still lose to the
        # uncapturable base.
        gp = self.gameplay([
            (2, "flagus_m1", True),
            (2, "flaguk_m1", False), (2, "flaguk_m1", False), (2, "flaguk_m1", False),
        ])
        self.assertEqual("us", eml.team_nation_from_level(gp, 2, self.NATIONS))

    def test_majority_decides_when_no_point_is_a_main_base(self) -> None:
        gp = self.gameplay([
            (1, "flagge_m1", False), (1, "flagge_m1", False),
            (1, "flagge_m1", False), (1, "flaguk_m1", False),
        ])
        self.assertEqual("ger", eml.team_nation_from_level(gp, 1, self.NATIONS))

    def test_a_tie_keeps_the_first_encountered_nation(self) -> None:
        # no_where_to_run's shape: two uncapturable main bases of different
        # nations. Sorting the tie alphabetically (a bug caught while
        # cross-checking this against the EoD corpus) picked `ger` over
        # `jp` and disagreed with `viewer/map.html`'s plain-majority
        # `teamNation`, which the encounter-order tie-break matches.
        gp = self.gameplay([
            (1, "flagjp_m1", True),
            (0, None, False), (0, None, False),
            (1, "flagge_m1", True),
        ])
        self.assertEqual("jp", eml.team_nation_from_level(gp, 1, self.NATIONS))

    def test_an_unmapped_flag_mesh_answers_none_not_a_guess(self) -> None:
        # Pathet Lao's flagpl_m1: no installed menu.rfa maps it.
        gp = self.gameplay([(1, "flagpl_m1", True), (1, "flagpl_m1", False)])
        self.assertIsNone(eml.team_nation_from_level(gp, 1, self.NATIONS))

    def test_flagless_control_points_contribute_nothing(self) -> None:
        # Kasserine's shape: every point this team holds has no flag mesh at
        # all. Unlike `viewer/nation.js`'s `cpNation`, this function makes
        # no ger/us guess of its own -- `level_record` falls to SKIN_NATION
        # instead, which is where that guess belongs for a WWII map.
        gp = self.gameplay([(1, None, False), (1, None, False)])
        self.assertIsNone(eml.team_nation_from_level(gp, 1, self.NATIONS))

    def test_a_team_that_holds_nothing_answers_none(self) -> None:
        gp = self.gameplay([(2, "flagus_m1", True)])
        self.assertIsNone(eml.team_nation_from_level(gp, 1, self.NATIONS))

    def test_no_gameplay_data_answers_none(self) -> None:
        self.assertIsNone(eml.team_nation_from_level(GameplayObjects(), 1, self.NATIONS))

    def test_a_placement_team_override_is_read_the_way_scene_json_has_it(self) -> None:
        # `_control_point_report`'s own "team" is the placement's override
        # where the level makes one, but its "flagMesh" is always the
        # template's own team-less `flag_mesh()` -- this function reads the
        # same two fields the same way so a level's `scene.json` and this
        # extractor never derive a different nation from one record.
        tpl = ControlPointTemplate(name="cp0", team=1, unable_to_change_team=True)
        tpl.team_geometry[1] = "flagge_m1"
        inst = StaticInstance("cp0", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), team=2)
        gp = GameplayObjects(control_points=[inst], control_point_templates={"cp0": tpl})
        # The instance overrides the point to team 2, so it votes for team 2.
        self.assertEqual("ger", eml.team_nation_from_level(gp, 2, self.NATIONS))
        self.assertIsNone(eml.team_nation_from_level(gp, 1, self.NATIONS))


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class LoadFlagMeshNationsTests(unittest.TestCase):
    """The one file both `viewer/nation.js` and this extractor read."""

    def test_vanilla_reproduces_flag_mesh_nation_exactly(self) -> None:
        # No installed vanilla menu.rfa ships an extra conp_<code> beyond
        # NATIONS, so `flag_mesh_nations` fires neither of its two passes --
        # pinned here against the real, already-extracted pack.
        from extract_hud_pack import FLAG_MESH_NATION, hud_dir_for
        hud_json = hud_dir_for("bf1942") / "hud.json"
        if not hud_json.exists():
            self.skipTest("extract_hud_pack.py has not been run for vanilla")
        self.assertEqual(FLAG_MESH_NATION, eml.load_flag_mesh_nations("bf1942"))

    def test_a_pack_that_has_not_been_built_degrades_to_empty(self) -> None:
        self.assertEqual({}, eml.load_flag_mesh_nations("no-such-mod-at-all"))


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class LevelNationFromArchivesTests(unittest.TestCase):
    """The level's own flag now leads; `SKIN_NATION` is the fallback only.
    Liberation of Caen's Allied side is the one vanilla level this moves --
    the exact claim `features/authentic-spawn-map/README.md` section 11
    makes, reproduced here against the real archives rather than trusted."""

    @classmethod
    def setUpClass(cls) -> None:
        archives = find_archives_dir(MOD_DIR)
        cls.by_name = eml.level_archives(archives)
        cls.nations = eml.load_flag_mesh_nations("bf1942")
        if not cls.nations:
            raise unittest.SkipTest(
                "extract_hud_pack.py has not been run for vanilla")

    def record(self, name: str, nations=None):
        return eml.level_record(name, self.by_name[name], None, False,
                                nations=nations)

    def test_liberation_of_caen_allied_becomes_canada(self) -> None:
        before = self.record("liberation_of_caen")
        after = self.record("liberation_of_caen", self.nations)
        self.assertEqual("brit", before["allied"]["nation"])
        self.assertEqual("skin", before["allied"]["nationSource"])
        self.assertEqual("can", after["allied"]["nation"])
        self.assertEqual("icon_flag_can", after["allied"]["flag"])
        self.assertEqual("level", after["allied"]["nationSource"])
        # Axis is unaffected -- the level's own flag agrees with the skin,
        # so this side simply resolves the same way through the new path.
        self.assertEqual("ger", after["axis"]["nation"])
        self.assertEqual("level", after["axis"]["nationSource"])

    def test_kasserine_is_unchanged_via_the_skin_fallback(self) -> None:
        # Its five capture zones are all flagless, so the level gives no
        # answer of its own and this must land exactly where it always did.
        before = self.record("kasserine_pass")
        after = self.record("kasserine_pass", self.nations)
        for side in ("axis", "allied"):
            self.assertEqual(before[side]["nation"], after[side]["nation"], side)
            self.assertEqual("skin", after[side]["nationSource"], side)

    def test_no_other_vanilla_level_moves(self) -> None:
        moved = []
        for name, paths in self.by_name.items():
            before = eml.level_record(name, paths, None, False)
            after = eml.level_record(name, paths, None, False, nations=self.nations)
            if before is None or after is None:
                continue
            for side in ("axis", "allied"):
                b = (before.get(side) or {}).get("nation")
                a = (after.get(side) or {}).get("nation")
                if b != a:
                    moved.append((name, side, b, a))
        self.assertEqual([("liberation_of_caen", "allied", "brit", "can")], moved)


@unittest.skipUnless(EOD_MENU_RFA is not None and EOD_MENU_RFA.exists(),
                    "needs the EoD install")
class EodLevelNationTests(unittest.TestCase):
    """The EoD team/level rows section 10 found: `SKIN_NATION` alone
    disagreed with the level's own flag. Reproduced against the real,
    already-extracted archives -- see the round's final report for the
    full before/after table."""

    @classmethod
    def setUpClass(cls) -> None:
        sources = MenuSources(mod_chain(GAME_DIR, "EoD"))
        cls.by_name = eml.chain_level_archives(sources.chain)
        cls.nations = eml.load_flag_mesh_nations(sources.mod_id)
        if not cls.nations:
            raise unittest.SkipTest("extract_hud_pack.py has not been run for EoD")

    def record(self, name: str):
        return eml.level_record(name, self.by_name[name], None, False,
                                nations=self.nations)

    def test_xa_loi_pagoda_allied_is_the_main_base_s_own_nation(self) -> None:
        # ARVN_Base is the uncapturable main base and flies flagus_m1 -- the
        # level's own answer, not the brit SKIN_NATION would guess for
        # ARVNForces from its majority elsewhere.
        r = self.record("xa_loi_pagoda")
        self.assertEqual("brit", eml.SKIN_NATION["arvnforces"])
        self.assertEqual("us", r["allied"]["nation"])
        self.assertEqual("level", r["allied"]["nationSource"])

    def test_nva_soldiers_that_actually_fly_the_viet_cong_flag(self) -> None:
        for name in ("hidden_airfield", "hill916", "pushing_charly"):
            r = self.record(name)
            self.assertEqual("jp", r["axis"]["nation"], name)
            self.assertEqual("level", r["axis"]["nationSource"], name)

    def test_viet_cong_soldiers_that_actually_fly_the_nva_flag(self) -> None:
        for name in ("the_bay", "battle_of_can_tho", "dak_pek", "ghost_town",
                     "last_man_standing", "mono_lake",
                     "nui_pek", "riverrun", "snipers"):
            r = self.record(name)
            self.assertEqual("ger", r["axis"]["nation"], name)

    def test_no_where_to_run_ties_between_two_main_bases_but_does_not_move(self) -> None:
        # Axis has TWO uncapturable main bases of different nations here
        # (`Vietcong_Base` flagjp_m1, `Vietcong_Platoon` flagge_m1) -- the
        # one level in either corpus where the tie-break in
        # `team_nation_from_level`'s docstring actually fires. Encounter
        # order keeps it agreeing with SKIN_NATION's own 'jp' and with
        # `viewer/map.html`'s plain-majority `teamNation`.
        r = self.record("no_where_to_run")
        self.assertEqual("jp", r["axis"]["nation"])
        self.assertEqual("level", r["axis"]["nationSource"])

    def test_pathet_lao_has_no_nation_anywhere(self) -> None:
        # flagpl_m1 is in no installed menu.rfa's flagMeshNation table, and
        # PathetLaosSoldier is not in SKIN_NATION either -- the level truly
        # gives no answer, and this must say so rather than guess.
        for name in ("h_mong", "ho_chi_minh_trail", "laos_boundary_dispute"):
            r = self.record(name)
            self.assertIsNone(r["axis"]["nation"], name)
            self.assertIsNone(r["axis"]["flag"], name)
            self.assertIsNone(r["axis"]["nationSource"], name)

    def test_exactly_thirteen_eod_rows_move(self) -> None:
        # The full before/after table this pins: one allied row
        # (xa_loi_pagoda) and twelve axis rows split between the two
        # directions the SKIN_NATION/level-flag mismatch runs.
        moved = []
        for name, paths in self.by_name.items():
            before = eml.level_record(name, paths, None, False)
            after = eml.level_record(name, paths, None, False, nations=self.nations)
            if before is None or after is None:
                continue
            for side in ("axis", "allied"):
                b = (before.get(side) or {}).get("nation")
                a = (after.get(side) or {}).get("nation")
                if b != a:
                    moved.append((name, side, b, a))
        self.assertEqual(13, len(moved))
        self.assertEqual(
            [("xa_loi_pagoda", "allied", "brit", "us")],
            [row for row in moved if row[1] == "allied"])


class FlagSlotTests(unittest.TestCase):
    """`previewFlags` is the one rectangle on this screen that is not in the
    data, and it must say so."""

    LAYOUT = {
        "pages": {"skirmish": {"elements": [
            {"kind": "picture", "rect": [390.0, 130.0, 172.0, 128.0],
             "texture": "thumbnail", "var": "Skirmish/SkirmishMap"},
        ]}},
    }

    def test_allied_left_axis_right_in_the_preview_corners(self) -> None:
        slots = eml.flag_slots(self.LAYOUT)
        self.assertTrue(slots["fromCapture"], "marked as not decoded")
        self.assertLess(slots["allied"][0], slots["axis"][0])
        self.assertEqual(130.0, slots["allied"][1])
        self.assertEqual(130.0, slots["axis"][1])
        # Both inside the preview slot.
        self.assertEqual(390.0, slots["allied"][0])
        self.assertEqual(390.0 + 172.0 - slots["size"], slots["axis"][0])

    def test_no_preview_slot_means_no_flags(self) -> None:
        self.assertIsNone(eml.flag_slots({"pages": {"skirmish": {"elements": []}}}))


class ActionReadingTests(unittest.TestCase):
    """`action_sets` / `action_calls` unwrap the list the front-end pages
    wrap their actions in; the spawn screen's are bare."""

    def test_unwraps_an_action_list(self) -> None:
        team = meme.Obj(cls="IntData", name="Campaign/Team", fields={"Value": 1})
        value = meme.Obj(cls="IntData", fields={"Value": 2})
        setter = meme.Obj(cls="SetVariableAction",
                          fields={"Variable": team, "Value": value})
        fn = meme.Obj(cls="Function", name="Sound/PlayMenuCheck")
        call = meme.Obj(cls="CallFunctionAction", fields={"Function": fn, "Result data": None})
        listed = meme.Obj(cls="ActionListAction", fields={"Actions": [setter, call]})

        self.assertEqual([{"var": "Campaign/Team", "value": 2}], eml.action_sets(listed))
        self.assertEqual(["Sound/PlayMenuCheck"], eml.action_calls(listed))

    def test_a_bare_action_still_reads(self) -> None:
        fn = meme.Obj(cls="Function", name="Skirmish/StartSkirmish")
        call = meme.Obj(cls="CallFunctionAction", fields={"Function": fn})
        self.assertEqual(["Skirmish/StartSkirmish"], eml.action_calls(call))
        self.assertEqual([], eml.action_sets(call))

    def test_nothing_is_not_an_error(self) -> None:
        self.assertEqual([], eml.action_sets(None))
        self.assertEqual([], eml.action_calls(None))
        self.assertEqual([], eml.action_sets(meme.Ref("somewhere")))

    def test_an_anonymous_variable_is_skipped(self) -> None:
        # A SetVariableAction on an unnamed data object writes nowhere this
        # layout can name, so it must not produce a `{"var": null}` row.
        setter = meme.Obj(cls="SetVariableAction", fields={
            "Variable": meme.Obj(cls="IntData", fields={"Value": 0}),
            "Value": meme.Obj(cls="IntData", fields={"Value": 1})})
        self.assertEqual([], eml.action_sets(setter))


class SettledValueTests(unittest.TestCase):
    """A colour channel bound to a tweened variable is resolved to where the
    page's own tweener leaves it."""

    @staticmethod
    def tweener(var_name, end, cls="BfAddSubNextEffectNode"):
        return meme.Obj(cls=cls, fields={
            "Next node": None,
            "Value": meme.Obj(cls="FloatData", name=var_name, fields={"Value": 0.0}),
            "End value": meme.Obj(cls="FloatData", fields={"Value": end}),
        })

    def test_the_fade_in_target_wins_over_the_fade_out(self) -> None:
        root = meme.Obj(cls="NameNode", fields={"Next node": None})
        fade_in = self.tweener("Fade/Alpha", 1.0)
        fade_out = self.tweener("Fade/Alpha", 0.0)
        fade_in.fields["Next node"] = fade_out
        root.fields["Next node"] = fade_in
        self.assertEqual({"Fade/Alpha": 1.0}, eml.settled_values(root))

    def test_both_tweener_classes_count(self) -> None:
        root = meme.Obj(cls="NameNode", fields={
            "Next node": self.tweener("A", 0.5, cls="BfAddSubEffectNode")})
        self.assertEqual({"A": 0.5}, eml.settled_values(root))

    def test_a_bound_channel_reads_its_settled_value(self) -> None:
        flat = eml.MenuFlattener({}, {"Fade/Alpha": 1.0})
        effect = meme.Obj(cls="VariableColorEffect", fields={
            "Red": meme.Obj(cls="FloatData", fields={"Value": 1.0}),
            "Green": meme.Obj(cls="FloatData", fields={"Value": 1.0}),
            "Blue": meme.Obj(cls="FloatData", fields={"Value": 1.0}),
            "Alpha": meme.Obj(cls="FloatData", name="Fade/Alpha", fields={"Value": 0.0}),
        })
        self.assertEqual([1.0, 1.0, 1.0, 1.0], flat.effect_color(effect))
        self.assertIn("Fade/Alpha", flat.color_bindings)

    def test_a_variable_no_tweener_drives_keeps_its_own_default(self) -> None:
        # `FocusEffect/AlphaLeft` and friends are named but not tweened on
        # this page: the value the file stores for them is the answer, and
        # overriding it would invent a state the data does not describe.
        flat = eml.MenuFlattener({}, {})
        effect = meme.Obj(cls="BfMultiplyColorEffect2", fields={
            "Alpha": meme.Obj(cls="FloatData", name="FocusEffect/AlphaLeft",
                              fields={"Value": 1.0})})
        self.assertEqual([1.0, 1.0, 1.0, 1.0], flat.effect_color(effect))
        effect["Alpha"].fields["Value"] = 0.25
        self.assertEqual([1.0, 1.0, 1.0, 0.25], flat.effect_color(effect))

    def test_an_anonymous_channel_keeps_the_file_value(self) -> None:
        flat = eml.MenuFlattener({}, {})
        effect = meme.Obj(cls="BfMultiplyColorEffect2", fields={
            "Alpha": meme.Obj(cls="FloatData", fields={"Value": 0.25})})
        self.assertEqual([1.0, 1.0, 1.0, 0.25], flat.effect_color(effect))


class TranslateNodeTests(unittest.TestCase):
    """`TranslateNode` shifts the siblings after it, the way `CullNode` gates
    them - not its (nonexistent) children."""

    def test_the_offset_reaches_the_next_sibling_only(self) -> None:
        picture = meme.Obj(cls="PictureNode", fields={"Next node": None, "Picture": "a.tga"})
        inner = meme.Obj(cls="TransformNode", fields={
            "Next node": None, "X": 0.0, "Y": 0.0, "Width": 10.0, "Height": 10.0,
            "Transformed node": picture})
        translate = meme.Obj(cls="TranslateNode", fields={
            "Next node": inner,
            "X": meme.Obj(cls="IntData", fields={"Value": 25.0}),
            "Y": meme.Obj(cls="IntData", fields={"Value": 7.0})})
        before = meme.Obj(cls="TransformNode", fields={
            "Next node": translate, "X": 0.0, "Y": 0.0, "Width": 10.0, "Height": 10.0,
            "Transformed node": meme.Obj(cls="PictureNode",
                                         fields={"Next node": None, "Picture": "b.tga"})})

        flat = eml.MenuFlattener({})
        flat.run(before.chain())
        by_texture = {el.get("texture"): el["rect"] for el in flat.elements}
        self.assertEqual([0, 0, 10, 10], by_texture["b"], "before the translate")
        self.assertEqual([25, 7, 10, 10], by_texture["a"], "after it")


class ExtendHookTests(unittest.TestCase):
    """The base `Flattener.extend` must still do what the inline `else` did,
    so `menu/InGame` decodes exactly as before."""

    def test_the_base_walks_into_children(self) -> None:
        from extract_spawn_layout import Flattener

        picture = meme.Obj(cls="PictureNode", fields={"Next node": None, "Picture": "x.tga"})
        odd = meme.Obj(cls="SomethingNode", fields={
            "Next node": None, "Transformed node": picture})
        flat = Flattener({})
        flat.run([odd])
        self.assertEqual(["x"], [el["texture"] for el in flat.elements])

    def test_it_returns_the_state_unchanged(self) -> None:
        from extract_spawn_layout import Flattener

        flat = Flattener({})
        node = meme.Obj(cls="SomethingNode", fields={"Next node": None})
        state = flat.extend(node, [node], 3.0, 4.0, [0, 0, 8, 8], [1, 1, 1, 1], [])
        self.assertEqual((3.0, 4.0, [1, 1, 1, 1], []), state)


class LexiconDuplicateTests(unittest.TestCase):
    """`lexiconAll.dat` is not a map: 31 of the vanilla file's keys occur
    twice and seven of those pairs differ. Which one wins is a choice, and
    the two callers make it differently on purpose."""

    @staticmethod
    def write(path: Path, records: list[tuple[str, list[str]]]) -> Path:
        import struct

        cols = len(records[0][1]) + 1
        blob = struct.pack("<II", len(records), cols)
        for key, values in records:
            for s in (key, *values):
                blob += s.encode("utf-16-le") + b"\0\0"
        path.write_bytes(blob)
        return path

    def setUp(self) -> None:
        import tempfile

        self.dir = Path(tempfile.mkdtemp())
        self.path = self.write(self.dir / "lexiconAll.dat", [
            ("Midway", ["BATTLE OF MIDWAY", "MIDWAY"]),
            ("Omaha_Beach", ["OMAHA BEACH", "OMAHA BEACH"]),
            ("Omaha_Beach", ["Omaha Beach", "Omaha Beach"]),
        ])

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_the_default_is_unchanged(self) -> None:
        # The spawn screen's pack has been built with last-wins since the
        # reader was written; none of the seven differing pairs is a key it
        # names, but the default must not move under it regardless.
        self.assertEqual("Omaha Beach", load_lexicon(self.path)["Omaha_Beach"])

    def test_first_wins_is_opt_in(self) -> None:
        self.assertEqual("OMAHA BEACH",
                         load_lexicon(self.path, keep="first")["Omaha_Beach"])

    def test_english_is_the_first_translation_column(self) -> None:
        self.assertEqual("BATTLE OF MIDWAY", load_lexicon(self.path)["Midway"])

    def test_the_title_index_is_case_insensitive_and_keeps_the_key(self) -> None:
        index = eml.title_index({"ABERDEEN": "OPERATION ABERDEEN"})
        self.assertEqual(("OPERATION ABERDEEN", "lexiconAll.dat:ABERDEEN"),
                         eml.level_title("aberdeen", index))

    def test_a_level_with_no_record_falls_back(self) -> None:
        title, source = eml.level_title("Kasserine_Pass", {})
        self.assertEqual("KASSERINE PASS", title)
        self.assertEqual("extract_loading_assets.format_map_title", source)


class NodeSuiteTests(unittest.TestCase):
    def test_menu_screen_passes_under_node(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(NODE_SUITE)],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{NODE_SUITE.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
