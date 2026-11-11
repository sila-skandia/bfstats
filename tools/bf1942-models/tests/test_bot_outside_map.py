"""The bots' painted maps block the ground outside the map
(features/bot-map-generation/wide-levels.md).

The engine's search-map painter blocks a land pixel of one designated
terrain material (ledger AI-27, AI-93). Every DICE level whose terrain
paints material 7, the combat area's "Reserved (Outside map)" (CA-5), has
it blocked on 100 % of the level's own baked Tank0, Infantry1 and Car4 maps.
The viewer's painter, which every generated bot layer runs on, left it
walkable, and on Aberdeen 95 % of the bots' deaths no enemy caused were
hulls that drove across a tongue of it beside the British base and burnt
out at the combat area's 5 HP a second.

`viewer/nav-map.js buildNavMap` now takes `impassableMaterial`, and the
bots' map builders (`bot-referee.js` for the soldiers, `bot-units.js` for
the hulls) pass `OUTSIDE_MAP_MATERIAL`. `tests/bot_outside_map_harness.mjs`
paints a toy level with a tongue of it and routes across.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "bot_outside_map_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in ("nav-grid.js", "nav-map.js", "nav-search.js", "nav-baked.js", "strategic-map.js"):
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class OutsideMapTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_outside_map_material_is_seven(self) -> None:
        self.assertEqual(self.r["outsideMapMaterial"], 7)

    def test_a_painted_land_map_blocks_it_when_asked(self) -> None:
        self.assertEqual(self.r["tongueWith"], self.r["codes"]["CELL_MATERIAL"])
        self.assertEqual(self.r["plainWith"], self.r["codes"]["CELL_FREE"])

    def test_without_the_option_the_map_paints_as_before(self) -> None:
        # The generator's walk test (sim/botgen.mjs) passes nothing and is unchanged.
        self.assertEqual(self.r["tongueWithout"], self.r["codes"]["CELL_FREE"])

    def test_the_brush_grows_it_one_metre_as_every_terrain_cell(self) -> None:
        self.assertEqual(self.r["edgeWith"], self.r["codes"]["CELL_MATERIAL"])
        self.assertEqual(self.r["pastEdgeWith"], self.r["codes"]["CELL_FREE"])

    def test_a_water_map_has_no_material_test(self) -> None:
        self.assertEqual(self.r["waterTongue"], self.r["codes"]["CELL_FREE"])

    def test_a_deck_over_it_frees_nothing(self) -> None:
        self.assertEqual(self.r["deckWithout"], self.r["codes"]["CELL_FREE"])
        self.assertEqual(self.r["deckWith"], self.r["codes"]["CELL_MATERIAL"])

    def test_a_levels_baked_map_is_taken_as_it_is(self) -> None:
        self.assertEqual(self.r["bakedSource"], "baked")
        self.assertEqual(self.r["bakedTongue"], self.r["codes"]["CELL_FREE"])

    def test_the_route_goes_round_the_tongue(self) -> None:
        self.assertTrue(self.r["routeWithout"]["crosses"])
        self.assertFalse(self.r["routeWith"]["crosses"])
        # Round its tip at z -40, not through it.
        self.assertGreater(self.r["routeWith"]["northmost"], -40)

    def test_the_bots_map_builders_pass_it(self) -> None:
        referee = (VIEWER / "bot-referee.js").read_text()
        units = (VIEWER / "bot-units.js").read_text()
        self.assertRegex(referee, r"referee\.navGrid = buildNavMap\([^;]*impassableMaterial: OUTSIDE_MAP_MATERIAL")
        # The hulls' map by name and by search type; the water map has no such test.
        self.assertEqual(len(re.findall(r"impassableMaterial: OUTSIDE_MAP_MATERIAL", units)), 2)


if __name__ == "__main__":
    unittest.main()
