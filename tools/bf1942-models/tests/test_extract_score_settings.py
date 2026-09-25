"""`extract_score_settings.py` -- the mod's `ScoreManagerSettings*.con`, parsed
into the pack's `score-settings.json`.

Two halves: the parser, which is pure text, and the archive walk, which is
driven against a scratch install built out of `write_rfa` so the chain
behaviour (a mod that ships its own `Game.rfa` wins, one that does not inherits
vanilla's) is exercised rather than assumed.

What the values MEAN is `test_round_state.py`'s business; this file only
guarantees they arrive intact.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from bf42.rfa import write_rfa
from extract_models import mod_chain
from extract_score_settings import (main, parse_score_settings,
                                    read_score_settings)

VANILLA = """\
rem Score settings for a round.

ScoreManager.kill 1
ScoreManager.death 0
ScoreManager.capture 10
ScoreManager.attack 2
ScoreManager.defence 5
ScoreManager.TK -2
"""


class ParserTests(unittest.TestCase):
    def test_the_shipped_shape(self) -> None:
        self.assertEqual({"kill": 1, "death": 0, "capture": 10, "attack": 2,
                          "defence": 5, "tk": -2}, parse_score_settings(VANILLA))

    def test_a_rem_line_is_a_comment(self) -> None:
        # Even one that names a command: the engine's con parser drops it.
        text = "rem ScoreManager.kill 99\nScoreManager.kill 1\n"
        self.assertEqual({"kill": 1}, parse_score_settings(text))

    def test_a_missing_file_parses_to_nothing(self) -> None:
        self.assertEqual({}, parse_score_settings(""))

    def test_the_last_declaration_wins(self) -> None:
        self.assertEqual({"kill": 4}, parse_score_settings(
            "ScoreManager.kill 1\nScoreManager.kill 4\n"))

    def test_a_value_that_is_not_a_number_is_skipped(self) -> None:
        text = "ScoreManager.kill one\nScoreManager.death 0\n"
        self.assertEqual({"death": 0}, parse_score_settings(text))

    def test_the_keys_are_lowercased(self) -> None:
        # `TK` and `objectiveTK` are the two the con spells with capitals.
        text = "ScoreManager.TK -2\nScoreManager.objectiveTK -15\n"
        self.assertEqual({"tk": -2, "objectivetk": -15}, parse_score_settings(text))


class ChainTests(unittest.TestCase):
    """A scratch install: vanilla's `Game.rfa` and one mod that may replace it."""

    def scratch(self, tmp: str, mod_files: dict[str, str] | None) -> Path:
        game_dir = Path(tmp)
        vanilla = game_dir / "Mods" / "bf1942"
        (vanilla / "Archives" / "bf1942").mkdir(parents=True)
        (vanilla / "init.con").write_text("")
        write_rfa(vanilla / "Archives" / "bf1942" / "Game.rfa", {
            "bf1942/Game/ScoreManagerSettings.con": VANILLA.encode(),
            "bf1942/Game/ScoreManagerSettingsCTF.con":
                "ScoreManager.capture 10\nScoreManager.defence 3\n".encode(),
        })
        if mod_files is not None:
            mod = game_dir / "Mods" / "TestMod"
            (mod / "Archives" / "bf1942").mkdir(parents=True)
            (mod / "init.con").write_text("game.addModPath Mods/TestMod/\n"
                                          "game.addModPath Mods/bf1942/\n")
            write_rfa(mod / "Archives" / "bf1942" / "Game.rfa", {
                "BF1942/Game/ScoreManagerSettings.con": mod_files["con"].encode(),
            })
        return game_dir

    def test_vanillas_two_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game_dir = self.scratch(tmp, None)
            files = read_score_settings(mod_chain(game_dir, "bf1942"))
        self.assertEqual(["ScoreManagerSettings.con", "ScoreManagerSettingsCTF.con"],
                         sorted(files))
        self.assertEqual(10, files["ScoreManagerSettings.con"]["capture"])
        self.assertEqual(3, files["ScoreManagerSettingsCTF.con"]["defence"])

    def test_a_mods_own_file_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game_dir = self.scratch(tmp, {"con": "ScoreManager.kill 5\n"})
            files = read_score_settings(mod_chain(game_dir, "TestMod"))
        # The mod replaces the base file outright, and vanilla's CTF file, which
        # it does not carry, still comes through behind it.
        self.assertEqual(5, files["ScoreManagerSettings.con"]["kill"])
        self.assertEqual(10, files["ScoreManagerSettingsCTF.con"]["capture"])

    def test_a_mod_with_no_game_archive_inherits_vanillas(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game_dir = Path(tmp)
            vanilla = game_dir / "Mods" / "bf1942"
            (vanilla / "Archives" / "bf1942").mkdir(parents=True)
            (vanilla / "init.con").write_text("")
            write_rfa(vanilla / "Archives" / "bf1942" / "Game.rfa",
                      {"bf1942/Game/ScoreManagerSettings.con": VANILLA.encode()})
            mod = game_dir / "Mods" / "Bare"
            mod.mkdir()
            (mod / "init.con").write_text("game.addModPath Mods/bf1942/\n")
            files = read_score_settings(mod_chain(game_dir, "Bare"))
        self.assertEqual({"ScoreManagerSettings.con"}, set(files))

    def test_the_command_writes_the_pack_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            game_dir = self.scratch(tmp, None)
            out = Path(tmp) / "pack"
            import sys
            argv = sys.argv
            try:
                sys.argv = ["extract_score_settings.py", "--game-dir", str(game_dir),
                            "--mod", "bf1942", "--out", str(out)]
                main()
            finally:
                sys.argv = argv
            written = json.loads((out / "score-settings.json").read_text())
        self.assertEqual({"kill", "death", "capture", "attack", "defence", "tk"},
                         set(written["files"]["ScoreManagerSettings.con"]))
        self.assertIn("ScoreManagerSettings", written["source"])


if __name__ == "__main__":
    unittest.main()
