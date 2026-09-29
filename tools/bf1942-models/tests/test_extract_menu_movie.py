"""extract_menu_movie.py: each mod's front-end movie, found along its addModPath chain."""

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

import extract_menu_movie as emv


class TestMenuMovieAlongModChain(unittest.TestCase):
    """XPack1 ships its own `Movies/background.bik`; XPack2 here does not, so
    it inherits vanilla's through its mod path. The folder and file case vary
    on disk (`Movies/Background.bik`) and must still be found."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.game = self.tmp / "game"
        self.out = self.tmp / "viewer" / "maps"
        mods = self.game / "Mods"

        def mod(name: str, init: str, movie: tuple[str, bytes] | None) -> None:
            directory = mods / name
            directory.mkdir(parents=True)
            (directory / "init.con").write_text(init)
            if movie:
                (directory / "Movies").mkdir()
                (directory / "Movies" / movie[0]).write_bytes(movie[1])

        mod("bf1942", "game.addModPath Mods/BF1942/\n", ("Background.bik", b"vanilla"))
        mod("XPack1", "game.addModPath Mods/XPack1/\ngame.addModPath Mods/BF1942/\n",
            ("background.bik", b"rtr"))
        mod("XPack2", "game.addModPath Mods/XPack2/\ngame.addModPath Mods/BF1942/\n", None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_each_mod_gets_its_nearest_movie(self):
        sent: dict[Path, bytes] = {}

        def transcode(bik, dest, **_):
            sent[Path(dest)] = Path(bik).read_bytes()
            return True

        argv = ["extract_menu_movie.py", "--bf1942-dir", str(self.game), "--out", str(self.out),
                "--mod", "bf1942", "--mod", "xpack1", "--mod", "xpack2"]
        with patch.object(emv, "transcode_bik_to_webm", side_effect=transcode), \
                patch.object(sys, "argv", argv):
            self.assertEqual(emv.main(), 0)
        movie = Path("_shared/movies/background.webm")
        self.assertEqual(sent, {
            self.out / movie: b"vanilla",
            self.out / "mods" / "xpack1" / movie: b"rtr",
            self.out / "mods" / "xpack2" / movie: b"vanilla",
        })

    def test_where_the_front_end_reads_it(self):
        # `play/skirmish.js` asks for `${MAPS}/_shared/movies/background.webm`.
        self.assertEqual(emv.movie_dest(self.out, "bf1942"),
                         self.out / "_shared" / "movies" / "background.webm")
        self.assertEqual(emv.movie_dest(self.out, "xpack1"),
                         self.out / "mods" / "xpack1" / "_shared" / "movies" / "background.webm")


if __name__ == "__main__":
    unittest.main()
