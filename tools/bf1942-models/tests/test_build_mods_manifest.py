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


if __name__ == "__main__":
    unittest.main()
