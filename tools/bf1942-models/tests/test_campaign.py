"""The single-player campaign (features/single-player-campaign).

  - `bf42/campaign.py`: `CampaignMapList.con`'s lines, the score tables of
    `GameServer::gameStatusPlaying` and the final grades;
  - `bf42/level.py` `parse_briefing`: the single-player verbs of a level's
    `Menu/Init.con` (`set<Side>Campaign / Objectives / Hints / Skirmish`),
    resolved through the lexicon, a self-keyed hint dropped;
  - against the install, when one is here: the sixteen missions in order,
    Wake's per-side tickets, the campaign pages in the main menu pack and the
    single-player plates in the debriefing pack;
  - `test_campaign.mjs` under node: the score rule, progression, saving, the
    launch address, the campaign screen's page, SINGLEPLAY's row and the
    end-of-mission plate (`viewer/play/campaign.js`,
    `viewer/play/campaign-screen.js`, `viewer/campaign-debriefing.js`,
    `viewer/play/nav-strip.js`, `viewer/play/menu-screen.js`).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.campaign import (  # noqa: E402
    CAMPAIGN_CAP, CAMPAIGN_FLOOR, final_grade, parse_campaign_map_list, score_rule,
)
from bf42.level import parse_briefing, resolve_briefing  # noqa: E402

NODE_SUITE = Path(__file__).with_name("test_campaign.mjs")


def find_game_dir() -> Path | None:
    """The retail install: `BF1942_GAME_DIR`, wine's, or a Mac's CrossOver
    bottle."""
    candidates = [os.environ.get("BF1942_GAME_DIR"),
                  Path.home() / ".wine/drive_c/EA Games/Battlefield 1942",
                  Path.home() / "Library/Application Support/CrossOver/Bottles/BF1942"
                                "/drive_c/EA Games/Battlefield 1942"]
    for c in candidates:
        if c and (Path(c) / "Mods/bf1942/Archives/menu.rfa").exists():
            return Path(c)
    return None


GAME_DIR = find_game_dir()

VANILLA_ORDER = ["battleaxe", "gazala", "wake", "kursk", "tobruk", "midway", "stalingrad",
                 "el_alamein", "guadalcanal", "kharkov", "omaha_beach", "bocage",
                 "market_garden", "battle_of_the_bulge", "berlin", "iwo_jima"]


class CampaignLawTests(unittest.TestCase):
    def test_the_map_list_reads_in_file_order(self) -> None:
        text = "Game.addLevel BattleAxe\r\nrem Game.addLevel Aberdeen\r\n" \
               "Game.addLevel Gazala GPM_CQ bf1942\r\n\r\ngame.addlevel Wake\r\n"
        rows = parse_campaign_map_list(text)
        self.assertEqual(["battleaxe", "gazala", "wake"], [r["dir"] for r in rows])
        self.assertEqual("BattleAxe", rows[0]["level"])
        self.assertEqual({"GPM_CQ"}, {r["mode"] for r in rows})
        self.assertEqual({"bf1942"}, {r["mod"] for r in rows})

    def test_the_tables_are_the_clients(self) -> None:
        self.assertEqual(16, len(CAMPAIGN_FLOOR))
        self.assertEqual((-2, -2, -2, -2, -3, -3, -3, -3) + (-4,) * 8, CAMPAIGN_FLOOR)
        self.assertEqual((5, 7, 9, 11, 13, 15, 17, 17, 17, 19, 20, 21, 22, 23, 24, 25),
                         CAMPAIGN_CAP)
        rule = score_rule()
        self.assertEqual(list(CAMPAIGN_FLOOR), rule["floor"])
        self.assertIn("0x008db9c0", rule["source"])

    def test_the_final_grades(self) -> None:
        self.assertEqual(["totalDefeat", "majorDefeat", "minorDefeat", "minorVictory",
                          "majorVictory", "totalVictory"],
                         [final_grade(s) for s in (-4, -3, 4, 10, 19, 24)])
        self.assertEqual("minorVictory", final_grade(18))


class MenuLevelsTests(unittest.TestCase):
    def test_the_level_list_carries_the_order(self) -> None:
        try:
            from extract_menu_layout import mark_campaign
        except ImportError as exc:  # Pillow, through extract_loading_assets
            raise unittest.SkipTest(f"extractor imports: {exc}")
        levels = {"levels": [{"dir": "aberdeen"}, {"dir": "wake"}, {"dir": "battleaxe"}]}
        mark_campaign(levels, parse_campaign_map_list("Game.addLevel BattleAxe\nGame.addLevel Wake\n"))
        self.assertEqual(["battleaxe", "wake"], levels["campaign"]["levels"])
        self.assertEqual([None, 2, 1], [r.get("campaignMission") for r in levels["levels"]])
        untouched = {"levels": [{"dir": "wake"}]}
        mark_campaign(untouched, [])
        self.assertNotIn("campaign", untouched)


class CampaignBriefingTests(unittest.TestCase):
    TEXT = """Game.setLocalized 1
game.setAlliedCampaign BRIEFING_ALLIED_CAMPAIGN_WAKE
game.setAlliedHints BRIEFING_ALLIED_HINTS_WAKE
game.setAlliedObjectives BRIEFING_ALLIED_OBJECTIVES_WAKE
game.setAxisSkirmish "Take the island."
game.setAlliedDebriefingMajorVictory DEBRIEFING_ALLIED_MAJOR_VICTORY_WAKE
game.setMultiplayerBriefingObjectives MULTIPLAYER_BRIEFING_WAKE
"""

    def test_the_single_player_verbs_are_read_beside_the_multiplayer_trio(self) -> None:
        info = parse_briefing(self.TEXT)
        self.assertEqual("MULTIPLAYER_BRIEFING_WAKE", info.objectives)
        self.assertEqual({"campaign", "hints", "objectives"}, set(info.campaign["allied"]))
        self.assertEqual('"Take the island."', info.campaign["axis"]["skirmish"])
        self.assertIn("majorVictory", info.debriefing["allied"])

    def test_resolved_through_the_lexicon_and_a_self_keyed_hint_dropped(self) -> None:
        lexicon = {
            "BRIEFING_ALLIED_CAMPAIGN_WAKE": "With its attack on Pearl Harbor ...\n",
            "BRIEFING_ALLIED_OBJECTIVES_WAKE": "Hold the outposts.",
            # Vanilla's own record for every hint key is the key itself.
            "BRIEFING_ALLIED_HINTS_WAKE": "BRIEFING_ALLIED_HINTS_WAKE",
        }
        info = resolve_briefing(parse_briefing(self.TEXT), lexicon)
        self.assertEqual({"campaign": "With its attack on Pearl Harbor ...",
                          "objectives": "Hold the outposts."}, info.campaign["allied"])
        self.assertEqual({"skirmish": "Take the island."}, info.campaign["axis"])

    def test_the_scene_report_carries_them(self) -> None:
        import scene_layers
        info = resolve_briefing(parse_briefing(self.TEXT),
                                {"BRIEFING_ALLIED_OBJECTIVES_WAKE": "Hold the outposts."})
        report = scene_layers._briefing_report(info, {})
        self.assertEqual({"objectives": "Hold the outposts."}, report["campaign"]["allied"])


@unittest.skipUnless(GAME_DIR, "needs the BF1942 install")
class CampaignInstallTests(unittest.TestCase):
    """Against the shipped files."""

    @classmethod
    def setUpClass(cls) -> None:
        try:
            import extract_campaign
        except ImportError as exc:  # Pillow, through extract_menu_layout
            raise unittest.SkipTest(f"extractor imports: {exc}")
        cls.data = extract_campaign.build_campaign(GAME_DIR)

    def test_the_menu_levels_order_reads_the_same_file(self) -> None:
        from extract_menu_layout import campaign_order
        from extract_models import mod_chain
        self.assertEqual(VANILLA_ORDER, [m["dir"] for m in campaign_order(mod_chain(GAME_DIR, "bf1942"))])

    def test_sixteen_missions_in_the_files_order(self) -> None:
        self.assertEqual(VANILLA_ORDER, [m["dir"] for m in self.data["order"]])
        self.assertEqual(set(VANILLA_ORDER), set(self.data["levels"]))
        self.assertEqual("WAKE ISLAND", self.data["order"][2]["title"])

    def test_each_side_plays_its_own_tickets(self) -> None:
        wake = self.data["levels"]["wake"]
        self.assertEqual((140, 100), (wake["allied"]["tickets"]["team1"], wake["allied"]["tickets"]["team2"]))
        self.assertEqual(120, wake["axis"]["tickets"]["team1"])
        self.assertEqual({"team1": 15, "team2": 30}, wake["allied"]["tickets"]["lossPerMin"])
        self.assertEqual(18, wake["allied"]["tickets"]["maxPlayers"])

    def test_each_side_has_its_words(self) -> None:
        words = self.data["levels"]["wake"]["allied"]["briefing"]
        self.assertTrue(words["campaign"].startswith("With its attack on Pearl Harbor"))
        self.assertIn("Wake Island", words["objectives"])
        self.assertEqual("YOUR ONGOING CAMPAIGN WILL BE OVERWRITTEN",
                         self.data["strings"]["CONFIRMATION_NEW_CAMPAIGN"])

    def test_the_menu_pack_carries_the_campaign_pages(self) -> None:
        import extract_main_menu_layout as emml
        from bf42.modmenu import MenuSources
        from extract_models import mod_chain
        from extract_spawn_layout import load_chain_lexicon
        sources = MenuSources(mod_chain(GAME_DIR, "bf1942"))
        with sources.open_menu() as menu:
            layout = emml.decode_layout(menu, load_chain_lexicon(sources.lexicon_paths))
        pages = layout["pages"]
        row = {el["key"]: el["rect"] for el in pages["singleplayerNav"]["elements"]
               if el["kind"] == "text"}
        # CAMPAIGN in the first slot of the row, INSTANT BATTLE in the second,
        # where MULTIPLAY's row has INTERNET and LOCAL.
        self.assertEqual([29.0, 68.0], row["MENU_CAMPAIGN"][:2])
        self.assertEqual([137.0, 68.0], row["MENU_SKIRMISH"][:2])
        lists = {el["data"] for el in pages["campaign"]["elements"] if el["kind"] == "listbox"}
        self.assertEqual({"Campaign/CampaignLevelsList", "Campaign/CampaignStatisticsList"}, lists)
        presets = [el["sets"] for el in pages["campaign"]["elements"]
                   if el["kind"] == "hit" and any(s["var"] == "Campaign/CampaignDifficultyLevel"
                                                  for s in el.get("sets", []))]
        self.assertEqual([1, 2, 3, 4], [s[0]["value"] for s in presets])
        start = [el for el in pages["campaignNav"]["elements"]
                 if el["kind"] == "button" and "Campaign/StartCampaign" in el.get("calls", [])]
        self.assertTrue(start)

    def test_the_debriefing_pack_carries_the_single_player_plates(self) -> None:
        import extract_debriefing_layout as edl
        from bf42.modmenu import MenuSources
        from extract_models import mod_chain
        from extract_spawn_layout import load_chain_lexicon
        sources = MenuSources(mod_chain(GAME_DIR, "bf1942"))
        with sources.open_menu() as menu:
            index = {e.lower(): e for e in menu.entries}
            layout = edl.decode_layout(menu.read(index["menu/loadmenu"]),
                                       load_chain_lexicon(sources.lexicon_paths))
        campaign = layout["campaign"]["elements"]
        bars = [el for el in campaign if el["kind"] == "fillbar"]
        self.assertEqual([392.0, 198.0, 128.0, 16.0], bars[0]["rect"])
        self.assertEqual(("statusbar", "statusbar_full", "CampaignScore", "MaxCampaignScore"),
                         (bars[0]["texture"], bars[0]["fill"], bars[0]["var"], bars[0]["max"]))
        ids = {el.get("id") for el in campaign if el["kind"] == "button"}
        self.assertLessEqual({"DEBRIEFING_DONE", "DEBRIEFING_REPLAY", "DEBRIEFING_CONTINUE"}, ids)
        pictures = {el.get("texture") for el in campaign if el["kind"] == "picture"}
        self.assertLessEqual({"sp_debriefing_512x512", "allied_win_camp", "axis_win_camp",
                              "allied_lose_camp", "axis_lose_camp"}, pictures)
        # The multiplayer plate is unchanged by the addition.
        self.assertEqual("mp_debriefing_512x512", layout["elements"][0]["texture"])


class CampaignNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(NODE_SUITE)], capture_output=True, text=True,
                              timeout=120)
        self.assertEqual(0, proc.returncode, f"{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
