"""bf42.template_table.template_sources: where a level load defines a template, for a modder to open."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bf42.rfa import write_rfa  # noqa: E402
from bf42.template_table import template_sources  # noqa: E402


class TemplateSources(unittest.TestCase):
    def test_archive_file_and_line_of_each_create_nearest_mod_first(self):
        with tempfile.TemporaryDirectory() as t:
            g = Path(t)
            mod, base = g / "Mods" / "M", g / "Mods" / "bf1942"
            (mod / "Archives" / "bf1942" / "levels").mkdir(parents=True)
            (base / "Archives").mkdir(parents=True)
            (mod / "init.con").write_text("game.addModPath Mods/M/\ngame.addModPath Mods/bf1942/\n")
            (base / "init.con").write_text("game.addModPath Mods/bf1942/\n")
            write_rfa(mod / "Archives" / "bf1942" / "levels" / "Lvl.rfa",
                      {"bf1942/levels/Lvl/Init.con": b"rem the level\n"})
            write_rfa(mod / "Archives" / "objects.rfa", {
                "objects/tanks/sherman/objects.con": b"rem a tank\n\nObjectTemplate.create PlayerControlObject Sherman\n"})
            write_rfa(base / "Archives" / "objects.rfa", {
                "objects/tanks/sherman/objects.con": b"ObjectTemplate.create PlayerControlObject Sherman\n",
                "objects/guns/objects.con": b"ObjectTemplate.create HandFireArms Colt\n"})
            out = template_sources(g, "m", "lvl", ["Sherman", "Colt", "Nothing"])
        self.assertEqual(out["Sherman"], {"archive": "Mods/M/Archives/objects.rfa",
                                          "file": "objects/tanks/sherman/objects.con", "line": 3,
                                          "class": "PlayerControlObject"})
        self.assertEqual(out["Colt"]["archive"], "Mods/bf1942/Archives/objects.rfa")
        self.assertNotIn("Nothing", out)


if __name__ == "__main__":
    unittest.main()
