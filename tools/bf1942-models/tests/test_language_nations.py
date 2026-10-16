"""The voice languages: the table, and the set each chain's soldiers declare."""
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


class Pool:
    """An archive pool over `{name: text}`, case-blind like `ArchivePool`."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = {k.lower(): v for k, v in files.items()}

    def names(self):
        return list(self.files)

    def try_read(self, name: str):
        text = self.files.get(name.lower())
        return None if text is None else text.encode("latin-1")


class ChainLanguageTests(unittest.TestCase):
    """The language set is what the chain's soldiers declare, so a language
    no table row names still extracts (bf1918 declares eight of them)."""

    SOLDIERS = {
        "Objects/Soldiers/KuK/Objects.con":
            'ObjectTemplate.create Soldier KuKSoldier\n'
            'ObjectTemplate.setRadioLanguage "Austrian"\n',
        "objects/soldiers/Senegal/objects.con":
            'ObjectTemplate.create Soldier SenegalSoldier\n'
            'ObjectTemplate.setRadioLanguage Senegal\n',
        "Objects/Soldiers/Hungary/Objects.con":
            'ObjectTemplate.create Soldier HungarianSoldier\n'
            'ObjectTemplate.setRadioLanguage "Hungarian"\n',
        "Objects/Soldiers/GC/Objects.con":
            'ObjectTemplate.create Soldier GermanSoldier\n'
            'ObjectTemplate.setRadioLanguage "Hothsnowtrooper"\n',
        "Objects/Vehicles/Land/T34/Objects.con":
            'ObjectTemplate.create PlayerControlObject T34\n'
            'ObjectTemplate.setRadioLanguage "NotASoldier"\n',
    }

    def test_a_declared_language_the_table_lacks_gets_its_own_folder(self) -> None:
        from extract_capture_voices import chain_languages
        languages = chain_languages(Pool(self.SOLDIERS))
        self.assertEqual("austrian", languages["Austrian"])
        self.assertEqual("senegal", languages["Senegal"])
        # a table row keeps its code, whatever case the con spells it in
        self.assertEqual("hun", languages["Hungarian"])
        self.assertNotIn("Hothsnowtrooper", languages)
        self.assertEqual("hothsnowtrooper", languages["HothSnowtrooper"])
        # only soldiers declare a radio language
        self.assertNotIn("NotASoldier", languages)
        self.assertEqual(len(languages), len(set(languages.values())))

    def test_a_derived_folder_never_takes_a_folder_already_used(self) -> None:
        from extract_capture_voices import language_folder
        self.assertEqual("ukr", language_folder("Ukr"))
        self.assertEqual("ukr2", language_folder("Ukr", {"ukr"}))
        self.assertEqual("us", language_folder("USEnglish", {"us"}))

    def test_each_soldier_maps_through_the_chain_languages(self) -> None:
        from extract_capture_voices import chain_languages
        from extract_radio import languages_file
        pool = Pool(self.SOLDIERS)
        data = languages_file("bf1918", pool, {"austrian", "hun"}, chain_languages(pool))
        self.assertEqual({"kuksoldier": "austrian", "hungariansoldier": "hun"}, data["soldiers"])
        # Senegal and Hothsnowtrooper wrote nothing: in the game they are silent
        self.assertEqual({"senegalsoldier": "Senegal", "germansoldier": "Hothsnowtrooper"},
                         data["unvoiced"])


class ScriptPathTests(unittest.TestCase):
    """`@Language` is replaced inside the script's own `load` path."""

    # bf1918's `bf1942/game/GamePlay.ssc`, its first patch and a crackle
    BF1918_GAMEPLAY = (
        "newPatch\n"
        "load @ROOT/Sound/@RTD/Battlefield1918/Soldiers/@Language/WeNowHaveControlOver.wav\n"
        "randomPlay 1\npriority 11\n\n"
        "newPatch\nload @ROOT/Sound/@RTD/radiomess.wav\n")

    def test_a_mod_folder_is_read_where_its_script_loads_it(self) -> None:
        from extract_capture_voices import language_loads, language_ref, load_path
        loads = language_loads(self.BF1918_GAMEPLAY, "bf1942/game/GamePlay.ssc")
        self.assertEqual(["wenowhavecontrolover"], list(loads))
        self.assertEqual("@ROOT/Sound/@RTD/Battlefield1918/Soldiers/Austrian/WeNowHaveControlOver.wav",
                         language_ref(load_path(loads, "WeNowHaveControlOver"), "Austrian"))
        # a stem the script does not load keeps vanilla's path
        self.assertEqual("@ROOT/Sound/@RTD/German/WeHaveLostControlOf.wav",
                         language_ref(load_path(loads, "WeHaveLostControlOf"), "German"))


GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


@unittest.skipUnless((GAME_DIR / "Mods" / "bf1918").is_dir(), "bf1918 not installed")
class Bf1918InstallTests(unittest.TestCase):
    """bf1918's scripts load every voice from
    `Sound/@RTD/Battlefield1918/Soldiers/@Language/`; read from vanilla's
    `Sound/@RTD/<Language>/` its tree spoke WW2 lines in six tongues."""

    def test_its_announcer_comes_from_its_own_folder_in_its_own_tongues(self) -> None:
        import extract_capture_voices as cap
        manifest = cap.extract(GAME_DIR, "bf1918", Path("/nonexistent"), transcode=False)
        for nation in ("austrian", "turkish", "senegal", "ger", "brit"):
            self.assertEqual(6, len(manifest["nations"][nation]["samples"]), nation)
        pool = cap.voice_pool(GAME_DIR, "bf1918")
        self.assertIn("Battlefield1918", cap.script_loads(pool, cap.GAMEPLAY_SSC)
                      ["wenowhavecontrolover"])


if __name__ == "__main__":
    unittest.main()
