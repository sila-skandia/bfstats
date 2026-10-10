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


if __name__ == "__main__":
    unittest.main()
