"""`extract_radio.py` against the installed game: the radio menu, the chat
layout and the voice manifests. Skipped where the game is not installed."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402

ARCHIVES = DEFAULT_GAME_DIR / "Mods" / "bf1942" / "Archives"


@unittest.skipUnless((ARCHIVES / "menu.rfa").is_file(), "BF1942 is not installed")
class ExtractRadioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import extract_radio as er
        from bf42.rfa import ArchivePool, RfaArchive
        from extract_spawn_layout import load_chain_lexicon
        cls.er = er
        lexicon = load_chain_lexicon([DEFAULT_GAME_DIR / "Mods" / "bf1942" / "lexiconAll.dat"])
        menu = RfaArchive(ARCHIVES / "menu.rfa")
        cls.layout = er.decode_radio_menu(menu.read("menu/RadioMenu"), lexicon)
        game = ArchivePool()
        game.add_dir(ARCHIVES / "bf1942", ("game",))
        options = DEFAULT_GAME_DIR / "Mods" / "bf1942" / er.PROFILE_OPTIONS
        cls.chat = er.decode_chat_layout(menu.read("menu/InGame"), er._ssc_text(game, er.MENU_CON),
                                         options.read_text("latin-1"), lexicon)
        cls.voices = er.extract_voices(DEFAULT_GAME_DIR, "bf1942", Path("/nonexistent"), transcode=False)

    def leaves(self, category: int) -> list[dict]:
        return [e for e in self.layout["elements"]
                if any(c.get("var") == "Radio/RadioCategory" and c.get("value") == category
                       for c in e.get("when", []))]

    def test_the_idle_strip_is_eight_buttons_with_their_headings(self) -> None:
        strip = self.leaves(0)
        icons = [e["texture"] for e in strip if e["kind"] == "picture"]
        self.assertEqual([f"icon_f{i}" for i in range(1, 9)], icons)
        headings = [e["text"] for e in strip if e.get("outline")]
        self.assertEqual(["CONFIRM", "REQUEST", "SPOTTED", "GAME", "CONFIRM", "ALARMS",
                          "TACTICS", "ON/OFF"], headings)
        # The whole menu sits 30,3 into the screen; F5 starts a gap after F4.
        rects = [e["rect"][:2] for e in strip if e["kind"] == "picture"]
        self.assertEqual([30.0, 3.0], rects[0])
        self.assertEqual([330.0, 3.0], rects[4])

    def test_every_page_has_its_header_and_a_cancel(self) -> None:
        for cat in range(1, 8):
            pics = [e["texture"] for e in self.leaves(cat) if e["kind"] == "picture"]
            self.assertIn(f"icon_f{cat}", pics, cat)
            self.assertIn("icon_cancel", pics, cat)

    def test_page_items_carry_the_live_alpha_not_its_default(self) -> None:
        roger = next(e for e in self.leaves(1) if e.get("texture") == "icon_roger")
        self.assertEqual(["Radio/RadioAlpha"], roger["alphaVars"])
        self.assertNotIn("color", roger)

    def test_the_game_page_is_gated_on_the_mode_and_point_count(self) -> None:
        cp1 = next(e for e in self.leaves(4) if e.get("texture") == "icon_controlpoint_1")
        flat = str(cp1["when"])
        self.assertIn("Radio/RadioGameMode", flat)
        self.assertIn("Radio/NumberOfControlPoints", flat)

    def test_the_timeout_and_the_mode_alpha(self) -> None:
        self.assertEqual(7, len(self.layout["timeouts"]))
        self.assertEqual(60.0, self.layout["timeouts"][0]["seconds"])
        self.assertEqual(["Radio/TimeOutCommandInterface"], self.layout["timeouts"][0]["calls"])
        self.assertEqual([0.5, 1.0], [a["value"] for a in self.layout["variableActions"]])

    def test_the_chat_box(self) -> None:
        c = self.chat
        self.assertEqual([0.0, 85.0, 620.0, 240.0], c["box"])
        self.assertEqual(("standard6", 14.0, 5.0), (c["font"], c["rowHeight"], c["dividerX"]))
        self.assertEqual({"kill": 3, "info": 2, "chat": 6}, c["sections"])
        self.assertEqual(5.0, c["timeUntilMessageRemoved"])
        self.assertEqual([1.0, 0.35, 0.35], c["colors"]["axis"])
        self.assertEqual([0.4, 0.6, 1.0], c["colors"]["allies"])
        self.assertEqual([110.0, 220.0, 610.0, 20.0], c["killMessage"]["rect"])
        self.assertEqual("is no more", c["strings"]["DEATH"])

    def test_the_voice_scripts_in_patch_order(self) -> None:
        radio, local = self.voices["radio"], self.voices["local"]
        self.assertEqual(23, len(radio))
        self.assertEqual(["Attack", "AttackALT"], radio[21]["stems"])
        self.assertEqual(["Defend", "DefendALT"], radio[22]["stems"])
        self.assertEqual(22, len(local))
        self.assertEqual(["Medic"], local[20]["stems"])
        self.assertEqual([10.0, 55.0, 1.0, -1.0], local[20]["ramp"])
        self.assertEqual("radiomess", self.voices["crackle"])

    def test_the_announcer_script_in_patch_order(self) -> None:
        # GamePlay.ssc, the patch index the client triggers: 0 a point won,
        # 1 lost, 2 heavy casualties, 3 tickets low, 4 leaving the combat
        # area, 5 the chat beep.
        g = self.voices["gameplay"]
        self.assertEqual(6, len(g))
        self.assertEqual(["WeNowHaveControlOver", "WeNowHaveControlOver2", "WeNowHaveControlOver3"],
                         g[0]["stems"])
        self.assertTrue(g[1]["random"])
        self.assertEqual(["WeAreTakingHeavyCasualities"], g[2]["stems"])
        self.assertEqual(["WeAreRunningLowOnReinforce"], g[3]["stems"])
        self.assertEqual(["WarningDesertersShot", "WarningDesertersShotALT"], g[4]["stems"])
        self.assertTrue(g[4]["random"])
        self.assertEqual(["radiomess"], g[5]["stems"])
        self.assertEqual(64, self.voices["nations"]["us"]["stems"])

    def test_only_language_loads_are_written_per_nation(self) -> None:
        stems = self.er._language_stems(
            "newPatch\nload @ROOT/Sound/@RTD/@Language/WeNowHaveControlOver.wav\n"
            "newPatch\nload @ROOT/Sound/@RTD/radiomess.wav\n", "GamePlay.ssc")
        self.assertEqual({"WeNowHaveControlOver"}, stems)


DC = DEFAULT_GAME_DIR / "Mods" / "DesertCombat" / "Archives"


@unittest.skipUnless(DC.is_dir(), "Desert Combat is not installed")
class DesertCombatRadioTests(unittest.TestCase):
    """Desert Combat keeps the exe's message -> patch table and rewrites what
    stands behind it: its lexicon's strings and its scripts' patches, paired."""

    @classmethod
    def setUpClass(cls) -> None:
        import extract_radio as er
        from bf42.modmenu import MenuSources
        from extract_models import mod_chain
        from extract_spawn_layout import load_chain_lexicon
        cls.voices = er.extract_voices(DEFAULT_GAME_DIR, "DesertCombat", Path("/nonexistent"),
                                       transcode=False)
        cls.lexicon = load_chain_lexicon(
            MenuSources(mod_chain(DEFAULT_GAME_DIR, "DesertCombat")).lexicon_paths)

    def test_the_rewritten_lines_match_the_rewritten_strings(self) -> None:
        local, radio, lex = self.voices["local"], self.voices["radio"], self.lexicon
        # 39 Fire in the hole -> patch 9; 41 Take cover -> patch 10; 45 -> 16.
        self.assertEqual("Take Cover!", lex["RADIO_LOCAL_FIRE_IN_HOLE"])
        self.assertEqual(["TakeCover1", "TakeCover2", "TakeCover3"], local[9]["stems"])
        self.assertEqual("Cover me while I reload!", lex["RADIO_LOCAL_TAKE_COVER"])
        self.assertEqual(["Reloading1", "Reloading2", "Reloading3"], local[10]["stems"])
        self.assertEqual("Area secured!", lex["RADIO_LOCAL_GO_FOR_ENEMY_FLAG"])
        self.assertEqual(["AreaSecure1", "AreaSecure2", "AreaSecure3"], local[16]["stems"])
        # 11 Naval support -> patch 9; 14 APC support -> 13; 17 Unit -> 16; 21 Scout -> 20.
        self.assertEqual("Requesting air defense support", lex["RADIO_NAVAL_SUPPORT"])
        self.assertEqual(["AirDefense"], radio[9]["stems"])
        self.assertEqual("Engineer on duty!", lex["RADIO_APC_SUPPORT"])
        self.assertEqual(["engineer1", "engineer2"], radio[13]["stems"])
        self.assertEqual("Enemy helo spotted", lex["RADIO_UNIT_SPOTTED"])
        self.assertEqual(["Helos"], radio[16]["stems"])
        self.assertEqual("Mines! Watch it!", lex["RADIO_SCOUT_SPOTTED"])
        self.assertEqual(["Mines1", "Mines2"], radio[20]["stems"])

    def test_both_sides_speak_every_line_and_the_rest_are_listed_absent(self) -> None:
        stems = {s for script in ("radio", "local", "gameplay") for p in self.voices[script]
                 for s in p["stems"] if s != "radiomess"}
        nations = self.voices["nations"]
        self.assertEqual(len(stems), nations["us"]["stems"])
        self.assertEqual(len(stems), nations["iraq"]["stems"])
        self.assertEqual("Iraqi", nations["iraq"]["language"])
        brit = next(m for m in self.voices["missing"] if m["nation"] == "brit")
        self.assertIn("RogerThat1", brit["stems"])
        self.assertEqual(len(stems) - nations["brit"]["stems"], len(brit["stems"]))



class SoldierLanguageTests(unittest.TestCase):
    """A side's voice folder is its soldier's `setRadioLanguage`."""

    class Pool:
        def __init__(self, files: dict[str, str]) -> None:
            self.files = files

        def names(self):
            return list(self.files)

        def try_read(self, name: str):
            return self.files[name].encode("latin-1")

    def test_each_soldier_maps_to_the_folder_its_language_wrote(self) -> None:
        from extract_radio import soldier_languages
        pool = self.Pool({
            "Objects/Soldiers/Iraq/Objects.con":
                'ObjectTemplate.create Soldier IraqSoldier\n'
                'ObjectTemplate.setRadioLanguage "Iraqi"\n'
                'ObjectTemplate.create Kit NotASoldier\n',
            "objects/soldiers/US/Objects.con":
                "ObjectTemplate.create Soldier USSoldier\n"
                "ObjectTemplate.setRadioLanguage UsEnglish\n",
            "Objects/Soldiers/Viet/Objects.con":
                'ObjectTemplate.create Soldier VCSoldier\n'
                'ObjectTemplate.setRadioLanguage "Vietnamese"\n',
            "Objects/Vehicles/Land/M1/Objects.con":
                'ObjectTemplate.create PlayerControlObject M1\n',
        })
        self.assertEqual({"iraqsoldier": "iraq", "ussoldier": "us"},
                         soldier_languages(pool, {"iraq", "us"}))


if __name__ == "__main__":
    unittest.main()
