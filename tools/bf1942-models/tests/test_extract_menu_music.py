"""extract_menu_music.py: each mod's menu loop, found along its addModPath chain."""

from __future__ import annotations

from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch
import unittest

MODELS_DIR = Path(__file__).resolve().parent.parent
if str(MODELS_DIR) not in sys.path:
    sys.path.insert(0, str(MODELS_DIR))

import extract_menu_music as emm


class TestMenuMusicAlongModChain(unittest.TestCase):
    """DC_Final -> DesertCombat -> bf1942. DC_Final here ships neither the
    directive nor the recording, so both must come from DesertCombat, not
    vanilla. A mod with no levels under --out is not a default target."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.game = self.tmp / "game"
        self.out = self.tmp / "viewer" / "maps"
        mods = self.game / "Mods"

        def mod(name: str, init: str, music: dict[str, bytes]) -> None:
            directory = mods / name
            (directory / "Music").mkdir(parents=True)
            (directory / "init.con").write_text(init)
            for leaf, data in music.items():
                (directory / "Music" / leaf).write_bytes(data)

        mod("bf1942", 'game.addModPath Mods/BF1942/\n'
            'Game.setMenuMusicFilename "music/slaughter4.bik"\n',
            {"Slaughter4.bik": b"vanilla"})
        mod("DesertCombat", 'game.addModPath Mods/DesertCombat/\ngame.addModPath Mods/BF1942/\n'
            'Game.setMenuMusicFilename "music/slaughter4.bik" rem menu loop\n',
            {"slaughter4.bik": b"dc"})
        mod("DC_Final", "game.addModPath Mods/DC_Final/\ngame.addModPath Mods/DesertCombat/\n"
            "game.addModPath Mods/BF1942/\n", {})
        mod("FH", "game.addModPath Mods/FH/\ngame.addModPath Mods/BF1942/\n",
            {"Slaughter4.bik": b"fh"})

        for tree in ("dc_final", "desertcombat"):
            (self.out / "mods" / tree).mkdir(parents=True)
            (self.out / "mods" / tree / "maps.json").write_text("[]")
        (self.out / "mods" / "fh" / "_shared").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_main(self, *extra: str) -> dict[Path, bytes]:
        sent: dict[Path, bytes] = {}

        def transcode(bik, dest, **_):
            sent[Path(dest)] = Path(bik).read_bytes()
            return True

        argv = ["extract_menu_music.py", "--bf1942-dir", str(self.game), "--out", str(self.out), *extra]
        with patch.object(emm, "transcode_bik_to_mp3", side_effect=transcode), \
                patch.object(sys, "argv", argv):
            self.assertEqual(emm.main(), 0)
        return sent

    def test_defaults_to_vanilla_and_mods_with_levels(self):
        self.assertEqual(emm.default_mods(self.out), ["bf1942", "dc_final", "desertcombat"])

    def test_each_mod_gets_its_nearest_recording(self):
        sent = self.run_main()
        music = Path("_shared/music/menu.mp3")
        self.assertEqual(sent, {
            self.out / music: b"vanilla",
            self.out / "mods" / "desertcombat" / music: b"dc",
            self.out / "mods" / "dc_final" / music: b"dc",
        })


if __name__ == "__main__":
    unittest.main()
