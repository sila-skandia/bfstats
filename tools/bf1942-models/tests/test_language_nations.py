"""The voice-folder table names every language Forgotten Hope's soldiers speak."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extract_capture_voices import LANGUAGE_NATIONS  # noqa: E402


class LanguageNationTests(unittest.TestCase):
    def test_forgotten_hope_languages_have_folders(self) -> None:
        # FH's sound.rfa ships Australian, Finish (sic) and Polish beside
        # French and Italian; a language missing here extracts nothing.
        self.assertEqual("auss", LANGUAGE_NATIONS["Australian"])
        self.assertEqual("fin", LANGUAGE_NATIONS["Finish"])
        self.assertEqual("pol", LANGUAGE_NATIONS["Polish"])
        self.assertEqual("fre", LANGUAGE_NATIONS["French"])
        self.assertEqual("it", LANGUAGE_NATIONS["Italian"])

    def test_folders_are_unique(self) -> None:
        self.assertEqual(len(LANGUAGE_NATIONS), len(set(LANGUAGE_NATIONS.values())))

    def test_languages_the_chain_declares_have_folders(self) -> None:
        # Every `ObjectTemplate.setRadioLanguage` the FHSWEurope -> FHSW -> FH
        # -> bf1942 chain declares, measured 2026-10-14 against the
        # `sound/<rate>/<Language>/` folders that ship them. A language
        # missing here gives its soldiers no voices/languages.json entry, so
        # the viewer plays `voices/us`: doomed_budapest's Hungarian side did.
        declared = {
            "Albanian", "Amharic", "Arabic", "Australian", "Canadian", "Chinese",
            "Dutch", "English", "Finish", "French", "German", "Greek", "Hungarian",
            "Italian", "Japanese", "Norwegian", "Polish", "Romanian", "Russian",
            "Slovak", "Spanish", "Srbcro", "Thai", "UsEnglish",
        }
        self.assertEqual([], sorted(declared - set(LANGUAGE_NATIONS)))

    def test_hungarian_side_gets_its_own_folder(self) -> None:
        # doomed_budapest: `game.setTeamSkin 1 HungarianSoldier`, whose template
        # sets `setRadioLanguage "Hungarian"` (FHSW's objects.rfa).
        self.assertEqual("hun", LANGUAGE_NATIONS["Hungarian"])


if __name__ == "__main__":
    unittest.main()
