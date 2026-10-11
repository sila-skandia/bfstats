"""`extract_level_variants.py`: a level's re-declared template as a model of its
own, and how its row lands in a mod tree's catalogue."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_level_variants as elv  # noqa: E402


def row(glb: str, configuration: str = "complex", first_person: bool = False) -> dict:
    return {"glb": glb, "report": glb.replace(".glb", ".report.json"), "level": "Raid_on_Agheila",
            "configuration": configuration, "lod": 0, "firstPerson": first_person,
            "parts": 8, "triangles": 2543, "texturesResolved": 10, "texturesMissing": []}


class InstallTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.scratch = self.dir / "scratch"
        self.tree = self.dir / "mods" / "xpack2"
        self.vanilla = self.dir / "models"
        for d in (self.scratch, self.tree, self.vanilla):
            d.mkdir(parents=True)
        for name in ("Willy.Raid_on_Agheila", "Willy.wreck.Raid_on_Agheila", "Willy.cockpit.Raid_on_Agheila"):
            (self.scratch / f"{name}.glb").write_bytes(b"glb:" + name.encode())
            (self.scratch / f"{name}.report.json").write_text(json.dumps({"armor": {"hitpoints": 50.0}}))
        (self.vanilla / "models.json").write_text(json.dumps([
            {"name": "Willy", "category": "land", "factions": ["Allies"], "sides": ["Allied"],
             "levels": ["Truk"], "glb": "Willy.glb", "thumb": "thumbs/Willy.png", "variants": []},
        ]))
        self.fragment = {"mod": "XPack2", "level": "Raid_on_Agheila", "templates": {"Willy": [
            row("Willy.Raid_on_Agheila.glb"), row("Willy.wreck.Raid_on_Agheila.glb", "wreck"),
            row("Willy.cockpit.Raid_on_Agheila.glb", first_person=True)]}}

    def test_a_template_the_tree_lacks_is_made_from_vanillas_entry(self) -> None:
        (self.tree / "models.json").write_text(json.dumps([{"name": "Flettner", "variants": []}]))
        written = elv.install(self.fragment, self.scratch, self.tree, self.vanilla)
        catalogue = json.loads((self.tree / "models.json").read_text())
        willy = next(e for e in catalogue if e["name"] == "Willy")
        self.assertEqual(willy["mod"], "XPack2")
        self.assertEqual(willy["glb"], "Willy.Raid_on_Agheila.glb")
        self.assertEqual(willy["levels"], ["Raid_on_Agheila"])
        self.assertEqual(willy["category"], "land")
        self.assertNotIn("thumb", willy)
        self.assertEqual([v["glb"] for v in willy["variants"]],
                         ["Willy.Raid_on_Agheila.glb", "Willy.wreck.Raid_on_Agheila.glb"])
        self.assertIn("Willy.wreck.Raid_on_Agheila.glb", written)
        self.assertEqual((self.tree / "Willy.Raid_on_Agheila.glb").read_bytes(), b"glb:Willy.Raid_on_Agheila")

    def test_an_entry_the_tree_has_gains_the_variants_once(self) -> None:
        (self.tree / "models.json").write_text(json.dumps([
            {"name": "Willy", "glb": "Willy.glb", "variants": [{"glb": "Willy.glb", "level": None}]}]))
        elv.install(self.fragment, self.scratch, self.tree, self.vanilla)
        elv.install(self.fragment, self.scratch, self.tree, self.vanilla)
        willy = json.loads((self.tree / "models.json").read_text())[0]
        self.assertEqual([v["glb"] for v in willy["variants"]],
                         ["Willy.glb", "Willy.Raid_on_Agheila.glb", "Willy.wreck.Raid_on_Agheila.glb"])
        self.assertEqual(willy["glb"], "Willy.glb")


if __name__ == "__main__":
    unittest.main()
