from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_mods_manifest as bmm


class TestBuildModsManifest(unittest.TestCase):
    def test_describe_with_static_icon(self):
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp)
            icons_dir = viewer / "icons" / "mods"
            icons_dir.mkdir(parents=True)
            (icons_dir / "eod.png").write_bytes(b"PNG")

            res = bmm.describe("eod", Path("models/mods/eod"), Path("maps/mods/eod"), viewer)
            self.assertEqual(res["id"], "eod")
            self.assertEqual(res["name"], "Eve of Destruction")
            self.assertEqual(res["icon"], "icons/mods/eod.png")

    def test_describe_with_custom_mod_icon(self):
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp)
            mod_dir = viewer / "models" / "mods" / "custom"
            mod_dir.mkdir(parents=True)
            (mod_dir / "icon.png").write_bytes(b"CUSTOM_PNG")

            icons_dir = viewer / "icons" / "mods"
            icons_dir.mkdir(parents=True)
            (icons_dir / "custom.png").write_bytes(b"STATIC_PNG")

            res = bmm.describe("custom", Path("models/mods/custom"), Path("maps/mods/custom"), viewer)
            self.assertEqual(res["icon"], "models/mods/custom/icon.png")

    def test_describe_without_icon(self):
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp)
            res = bmm.describe("unknownmod", Path("models/mods/unknownmod"), Path("maps/mods/unknownmod"), viewer)
            self.assertNotIn("icon", res)

    def test_scan_discovers_icons(self):
        with tempfile.TemporaryDirectory() as tmp:
            viewer = Path(tmp)
            icons_dir = viewer / "icons" / "mods"
            icons_dir.mkdir(parents=True)
            (icons_dir / "bf1942.png").write_bytes(b"PNG")
            (icons_dir / "eod.png").write_bytes(b"PNG")

            # Create mock models and maps directories
            (viewer / "models" / "mods" / "eod").mkdir(parents=True)
            (viewer / "maps" / "mods" / "eod").mkdir(parents=True)

            mods = bmm.scan(viewer)
            self.assertEqual(len(mods), 2)
            self.assertEqual(mods[0]["id"], "bf1942")
            self.assertEqual(mods[0].get("icon"), "icons/mods/bf1942.png")
            self.assertEqual(mods[1]["id"], "eod")
            self.assertEqual(mods[1].get("icon"), "icons/mods/eod.png")

    def test_installed_version_reads_init_con(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            (game / "Mods" / "FHSW").mkdir(parents=True)
            (game / "Mods" / "FHSW" / "init.con").write_text(
                "game.SetCustomGameName FHSW\r\ngame.setCustomGameVersion 0.81\r\n")
            (game / "Mods" / "XPack2").mkdir(parents=True)
            (game / "Mods" / "XPack2" / "Init.con").write_text(
                'game.customGameVersion "1.6"\n')
            (game / "Mods" / "Silent").mkdir(parents=True)
            (game / "Mods" / "Silent" / "init.con").write_text("game.addModPath Mods/bf1942/\n")
            self.assertEqual(bmm.installed_version(game, "fhsw"), "0.81")
            self.assertEqual(bmm.installed_version(game, "xpack2"), "1.6")
            self.assertIsNone(bmm.installed_version(game, "silent"))
            self.assertIsNone(bmm.installed_version(game, "absent"))


GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


@unittest.skipUnless((GAME_DIR / "Mods" / "bf1942").is_dir(), "the game is not installed")
class TestModInfoAgainstInstall(unittest.TestCase):
    def test_versions_are_the_installed_mods(self):
        """The Custom Game dialog's version is the one the installed mod's
        `init.con` declares: FHSW read 0.73 over a 0.81 install."""
        for mod_id, (version, _url, _info) in bmm.MOD_INFO.items():
            installed = bmm.installed_version(GAME_DIR, mod_id)
            if installed is None:
                continue
            with self.subTest(mod=mod_id):
                self.assertEqual(version, installed)


if __name__ == "__main__":
    unittest.main()
