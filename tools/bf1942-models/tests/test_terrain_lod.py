"""The terrain's detail by distance and the sea bed that is never drawn
(`viewer/terrain-lod.js`), the word the exporter carries for it, and the
water's per-vertex depth colour (`viewer/level-sky.js`).

Retail's rules, read 2026-11-13 off BF1942.exe (ledger TERR-8, WATER-2):

    a 16 x 16-sample cell is drawn at level
    `clamp(int(3 * d^2 * fov / lodDistance^2), 0, 3)` (0x00683190..0x006831e3),
    `lodDistance` the level's `GeometryTemplate.lodDistance` (handler
    0x005d2e40, template +0xf4) or 1050 (0x005b5d22), and not at all when the
    level's water level is not 0 and the cell's top is more than 10 m under
    it (0x006830e6..0x0068310b);

    the sea's colour and alpha are set at the vertices of a 16 m lattice
    (0x006546e0): shallow colour at `waterShallowAlpha` over ground above
    the water, else `shallow + (deep - shallow) * min(depth / waterColorDepth, 1)`
    at alpha `min(depth / waterAlphaDepth, 1)`, the depths 5 and 1.7 where a
    level sets neither (0x00654ffe, 0x00655008).

Runs `node terrain_lod_harness.mjs`.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "terrain_lod_harness.mjs"
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scene_layers  # noqa: E402
from bf42.level import parse_terrain_con  # noqa: E402

TERRAIN_CON = """
GeometryTemplate.create patchTerrain patchGeometry
GeometryTemplate.file bf1942\\levels\\Battle_of_Britain\\Heightmap
GeometryTemplate.worldSize 4096
GeometryTemplate.yScale 0.6
GeometryTemplate.waterLevel 55
GeometryTemplate.targetTriCount 5000
GeometryTemplate.lodDistance 425
"""


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (ROOT / "node_modules" / "three").exists():
        raise unittest.SkipTest("three is not installed under tools/bf1942-models")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LodDistanceWordTests(unittest.TestCase):
    def test_the_terrain_con_word_is_read(self) -> None:
        self.assertEqual(parse_terrain_con(TERRAIN_CON).lod_distance, 425.0)

    def test_a_level_that_omits_it_carries_none(self) -> None:
        text = TERRAIN_CON.replace("GeometryTemplate.lodDistance 425\n", "")
        self.assertIsNone(parse_terrain_con(text).lod_distance)

    def test_the_environment_layer_owns_the_key(self) -> None:
        self.assertIn("terrainLodDistance", scene_layers.LAYERS["environment"][0])
        self.assertIn("terrainLodDistance", scene_layers.REPORT_ORDER)


class TerrainLodTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_constants_are_retails(self) -> None:
        c = self.results["constants"]
        self.assertEqual(c["cellSamples"], 16)             # 0x00681c05
        self.assertEqual(c["levels"], 4)                   # terrain +0x104..+0x110
        self.assertEqual(c["scale"], 3)                    # 0x008eaf04
        self.assertEqual(c["defaultLodDistance"], 1050)    # 0x44834000 at 0x005b5d22
        self.assertEqual(c["seaSkipDepth"], 10)            # 0x008dbe18

    def test_the_level_steps_where_three_d_squared_over_the_range_squared_does(self) -> None:
        lv = self.results["level"]
        # 425 / sqrt(3) = 245.4, 425 * sqrt(2 / 3) = 347.0, 425.
        self.assertEqual([lv["d245"], lv["d246"]], [0, 1])
        self.assertEqual([lv["d347"], lv["d348"]], [1, 2])
        self.assertEqual([lv["d424"], lv["d425"]], [2, 3])
        self.assertEqual(lv["d5000"], 3)

    def test_a_narrow_lens_carries_the_detail_out(self) -> None:
        lv = self.results["level"]
        self.assertEqual([lv["zoom490"], lv["zoom492"]], [0, 1])

    def test_a_level_with_no_word_takes_the_constructors_range(self) -> None:
        lv = self.results["level"]
        # 1050 / sqrt(3) = 606.2.
        self.assertEqual([lv["unset606"], lv["unset607"]], [0, 1])

    def test_a_cell_more_than_ten_metres_under_the_water_is_not_drawn(self) -> None:
        sea = self.results["sea"]
        self.assertFalse(sea["justIn"])
        self.assertTrue(sea["justUnder"])
        self.assertFalse(sea["shore"])
        self.assertTrue(sea["negativeLevel"])

    def test_a_water_level_of_zero_skips_nothing(self) -> None:
        self.assertFalse(self.results["sea"]["noWater"])

    def test_a_patch_is_read_as_a_lattice_whatever_order_its_vertices_are_in(self) -> None:
        g = self.results["grid"]
        self.assertEqual((g["side"], g["n"]), (65, 64))

    def test_a_mesh_that_is_not_whole_cells_is_left_alone(self) -> None:
        self.assertTrue(self.results["grid"]["odd"])
        self.assertTrue(self.results["grid"]["small"])

    def test_every_level_covers_its_cell_once_facing_the_same_way(self) -> None:
        for cell in self.results["cells"]:
            self.assertEqual(cell["area"], 256)
            self.assertEqual(cell["back"], 0)
            self.assertTrue(cell["inside"])

    def test_every_level_keeps_the_whole_border_so_neighbours_always_meet(self) -> None:
        for cell in self.results["cells"]:
            self.assertEqual(cell["borderSegments"], 64)

    def test_the_triangles_a_cell_costs_at_each_level(self) -> None:
        self.assertEqual([c["triangles"] for c in self.results["cells"]], [512, 160, 80, 64])
        self.assertEqual(self.results["cells"][0]["vertices"], 289)   # 0x0091c6f8, block 0

    def test_a_patch_wound_the_other_way_keeps_its_winding(self) -> None:
        self.assertTrue(self.results["flipped"])

    def test_a_patch_under_the_camera_is_drawn_whole_on_its_own_index(self) -> None:
        s = self.results["scene"]
        self.assertEqual(s["near"]["cells"], [16, 0, 0, 0])
        self.assertEqual(s["near"]["triangles"], s["full"])
        self.assertTrue(s["sharesVertices"])
        self.assertTrue(s["ownIndex"])

    def test_a_far_patch_is_an_eighth_of_its_triangles(self) -> None:
        s = self.results["scene"]
        self.assertEqual(s["far"]["cells"], [0, 0, 0, 16])
        self.assertEqual(s["far"]["triangles"], 16 * 64)
        self.assertEqual(s["full"], 16 * 512)

    def test_a_patch_at_the_laws_steps_mixes_levels(self) -> None:
        s = self.results["scene"]["middle"]
        self.assertEqual(sum(s["cells"]), 16)
        self.assertGreater(s["cells"][1] + s["cells"][2], 0)
        self.assertTrue(self.results["scene"]["indexInRange"])

    def test_the_sea_bed_drops_out_of_the_index(self) -> None:
        s = self.results["scene"]["sea"]
        self.assertEqual(s["skipped"], 6)
        self.assertEqual(s["triangles"], 10 * 512)

    def test_switching_it_off_puts_the_bakes_geometry_back(self) -> None:
        self.assertTrue(self.results["scene"]["offRestores"])
        self.assertEqual(self.results["scene"]["onAgain"], 1)


class WaterVertexColourTests(unittest.TestCase):
    """The water shader is GLSL in `level-sky.js`; these hold its law's terms."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / "viewer" / "level-sky.js").read_text()

    def constant(self, name: str) -> float:
        m = re.search(rf"export const {name} = ([0-9.]+);", self.source)
        self.assertIsNotNone(m, name)
        return float(m.group(1))

    def test_the_lattice_is_sixteen_metres(self) -> None:
        self.assertEqual(self.constant("WATER_GRID_M"), 16)          # 0x008eb640
        self.assertIn("WATER_GRID_M: WATER_GRID_M.toFixed(1)", self.source)

    def test_the_unset_depths_are_the_constructors(self) -> None:
        self.assertEqual(self.constant("WATER_ALPHA_DEPTH"), 1.7)    # 0x3fd9999a at 0x00654ffe
        self.assertEqual(self.constant("WATER_COLOR_DEPTH"), 5)      # 0x40a00000 at 0x00655008
        self.assertIn("w.alphaDepth || WATER_ALPHA_DEPTH", self.source)
        self.assertIn("w.colorDepth || WATER_COLOR_DEPTH", self.source)

    def test_a_vertex_over_dry_ground_is_shallow_at_the_shallow_alpha(self) -> None:
        self.assertIn("if ( d <= 0.0 ) return vec4( shallow, uShallowAlpha );", self.source)

    def test_a_wet_vertex_ramps_colour_and_alpha_by_its_depth(self) -> None:
        self.assertIn("mix( shallow, deep, min( d / max( uColorDepth, 0.001 ), 1.0 ) )", self.source)
        self.assertIn("min( d / max( uAlphaDepth, 0.001 ), 1.0 ) );", self.source)

    def test_a_pixel_blends_the_four_vertices_round_it(self) -> None:
        self.assertEqual(self.source.count("bfWaterVertex(cell"), 4)
        self.assertIn("vec2 grid = wuv / WATER_GRID_M;", self.source)
        self.assertNotIn("texture2D(tDepth, wuv / uWorldSize)", self.source)


if __name__ == "__main__":
    unittest.main()
