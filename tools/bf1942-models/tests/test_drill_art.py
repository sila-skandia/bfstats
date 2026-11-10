"""THE RANGE's drill cards show the selected mod's own pictures
(features/proving-ground, "The front end's tab").

LIVE-FIRE RANGE and DOGFIGHT SCHOOL each sit on a loading screen: one with a
tank on it, one with aircraft. They were vanilla's whatever mod CUSTOM GAME
had picked (2026-11-10, the owner: a different tank and plane behind the tiles
for the mod you have selected, from that mod's assets). `play/drill-art.js`
names the two pictures per tree and the part of each the card shows. Pinned
here:

  * a mod with a row is offered its own picture, in its own tree, first, and
    vanilla's after it, which is what the card falls back to when the file is
    not in the tree;
  * a mod with no row, a view over vanilla's tree (Community Maps) and vanilla
    itself are offered vanilla's alone;
  * every row has both drills, two different pictures, and a crop that is a
    real box inside the picture;
  * where a tree is on disk, each of its pictures is one its `maps.json` names
    as a level's loading screen, so a mistyped path fails here instead of
    quietly showing vanilla's. Skipped for a tree that is not checked out
    (they are untracked, and CI has none).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
MODULE = VIEWER / "play" / "drill-art.js"

SCRIPT = """
import { DRILL_ART, DRILLS, drillArt } from './drill-art.js';
const paths = id => ({ id, maps: id === 'bf1942' ? 'maps' : `maps/mods/${id}` });
const out = { drills: DRILLS, table: DRILL_ART, chains: {} };
for (const id of Object.keys(DRILL_ART)) out.chains[id] = drillArt(paths(id));
out.chains['nosuchmod'] = drillArt(paths('nosuchmod'));
out.chains['community'] = drillArt({ id: 'community', maps: 'maps' });
out.chains['upper'] = drillArt({ id: 'DesertCombat', maps: 'maps/mods/desertcombat/' });
out.chains['none'] = drillArt(null);
console.log(JSON.stringify(out));
"""

VANILLA = {
    "range": "maps/_shared/load/desert.webp",
    "school": "maps/battle_of_britain/load.webp",
}


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "drill-art.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "run.mjs").write_text(SCRIPT)
        proc = subprocess.run(["node", str(work / "run.mjs")], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"drill art harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DrillArtTests(unittest.TestCase):
    art: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.art = run()

    def test_a_mod_is_offered_its_own_picture_then_vanillas(self) -> None:
        for mod, row in self.art["table"].items():
            if mod == "bf1942":
                continue
            for drill in self.art["drills"]:
                chain = self.art["chains"][mod][drill]
                with self.subTest(mod=mod, drill=drill):
                    self.assertEqual([c["path"] for c in chain],
                                     [f"maps/mods/{mod}/{row[drill]['art']}", VANILLA[drill]])
                    self.assertEqual(chain[0]["crop"], row[drill].get("crop", [0, 0, 1, 1]))
                    self.assertEqual(chain[1]["crop"], [0, 0, 1, 1])

    def test_vanilla_and_a_mod_without_a_row_are_offered_vanillas_alone(self) -> None:
        for mod in ("bf1942", "nosuchmod", "community", "none"):
            for drill in self.art["drills"]:
                with self.subTest(mod=mod, drill=drill):
                    self.assertEqual([c["path"] for c in self.art["chains"][mod][drill]], [VANILLA[drill]])

    def test_the_mod_is_matched_whatever_its_case_and_trailing_slash(self) -> None:
        self.assertEqual(self.art["chains"]["upper"], self.art["chains"]["desertcombat"])

    def test_every_row_has_two_pictures_and_real_crops(self) -> None:
        self.assertEqual(self.art["drills"], ["range", "school"])
        for mod, row in self.art["table"].items():
            with self.subTest(mod=mod):
                self.assertEqual(sorted(row), ["range", "school"])
                self.assertNotEqual(row["range"]["art"], row["school"]["art"])
                for drill, pick in row.items():
                    self.assertRegex(pick["art"], r"^[^/].*\.webp$")
                    x0, y0, x1, y1 = pick.get("crop", [0, 0, 1, 1])
                    self.assertTrue(0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1, f"{mod} {drill}: {pick.get('crop')}")

    def test_a_tree_on_disk_names_each_picture_as_a_loading_screen(self) -> None:
        checked = 0
        for mod, row in self.art["table"].items():
            maps = VIEWER / "maps" / ("maps.json" if mod == "bf1942" else f"mods/{mod}/maps.json")
            if not maps.is_file():
                continue
            named = {(level.get("loading") or {}).get("background") for level in json.loads(maps.read_text())}
            for drill, pick in row.items():
                with self.subTest(mod=mod, drill=drill):
                    self.assertIn(pick["art"], named)
            checked += 1
        if not checked:
            self.skipTest("no asset tree is checked out")


if __name__ == "__main__":
    unittest.main()
