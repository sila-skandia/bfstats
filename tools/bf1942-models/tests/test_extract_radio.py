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


if __name__ == "__main__":
    unittest.main()
