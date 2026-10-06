"""A terrain patch is 64 heightmap samples, and the engine draws only the Tx
files inside its window (ledger TERR-1, TERR-2; features/terrain-tile-grid).

DC Medina Ridge ships a 512-sample heightmap over 1024 m and 8x8 Tx tiles. The
bake used to draw every tile at a fixed 256 m, so Tx00..03 of each row and
column covered the whole map (the top-left quadrant stretched four times) and
the other 48 tiles fell off the heightmap into `missingTiles`. The engine cuts
that heightmap into 8 patches of 128 m, one tile each.
"""

from __future__ import annotations

import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import (  # noqa: E402
    LevelInfo,
    PATCH_METERS,
    decode_heightmap,
    load_level_files,
    parse_terrain_con,
    patch_grid,
    tile_in_window,
)
from bf42.rfa import write_rfa  # noqa: E402
from bf42.terrain import default_patches  # noqa: E402

try:
    from PIL import Image
except ImportError:  # pragma: no cover - Pillow ships with the toolchain
    Image = None


class PatchGridTests(unittest.TestCase):
    def test_vanilla_heightmaps_all_make_256_m_patches(self) -> None:
        # 4 m a sample on every vanilla, XPack1 and XPack2 level.
        self.assertEqual((4, 256.0), patch_grid(1024.0, 256))   # Kharkov
        self.assertEqual((8, 256.0), patch_grid(2048.0, 512))   # El Alamein
        self.assertEqual((16, 256.0), patch_grid(4096.0, 1024))  # Tobruk
        self.assertEqual(256.0, PATCH_METERS)

    def test_the_patch_follows_the_heightmap_not_the_world(self) -> None:
        self.assertEqual((8, 128.0), patch_grid(1024.0, 512))   # DC Medina Ridge
        self.assertEqual((4, 512.0), patch_grid(2048.0, 256))   # DC Sea Rigs
        self.assertEqual((8, 1024.0), patch_grid(8192.0, 512))  # FHSW Dover Strait


class TileWindowTests(unittest.TestCase):
    def test_zero_offset_draws_the_whole_grid_and_nothing_past_it(self) -> None:
        self.assertTrue(tile_in_window(0, 7, 8))
        # XPack2 Kbely_Airfield ships a ninth row and column: never drawn.
        self.assertFalse(tile_in_window(0, 8, 8))
        self.assertFalse(tile_in_window(0, -1, 8))

    def test_a_positive_offset_insets_from_both_sides(self) -> None:
        # Wake: texOffset 2 on 8 patches, files 0..3 on world patches 2..5.
        self.assertTrue(tile_in_window(2, 3, 8))
        self.assertFalse(tile_in_window(2, 4, 8))
        # Guadalcanal and Midway on 16 patches.
        self.assertTrue(tile_in_window(4, 7, 16))
        self.assertFalse(tile_in_window(4, 8, 16))
        self.assertTrue(tile_in_window(6, 3, 16))
        self.assertFalse(tile_in_window(6, 4, 16))
        # FHSW Operation_Hailstone: 32 patches, offset 4, rows 24..27 shipped
        # past the window and on the heightmap.
        self.assertTrue(tile_in_window(4, 23, 32))
        self.assertFalse(tile_in_window(4, 24, 32))

    def test_a_negative_offset_trims_the_far_side_only(self) -> None:
        # Tobruk: texOffsetY -10 on 16 patches, rows 0..5.
        self.assertTrue(tile_in_window(-10, 0, 16))
        self.assertTrue(tile_in_window(-10, 5, 16))
        self.assertFalse(tile_in_window(-10, 6, 16))

    def test_a_tile_outside_the_window_leaves_its_patch_to_the_default(self) -> None:
        info = parse_terrain_con(
            "GeometryTemplate.worldSize 8192\nGeometryTemplate.texOffsetX 4\n"
            "GeometryTemplate.texOffsetY 4\n")
        # Hailstone's row 24 would land on world row 28, the first one the
        # engine paints with the default texture.
        missing = default_patches(info, [(0, 23), (0, 24)], patch=256.0)
        self.assertNotIn((4, 27), missing)
        self.assertIn((4, 28), missing)


def _dds(colour: tuple[int, int, int, int]) -> bytes:
    image = Image.new("RGBA", (8, 8), colour)
    out = io.BytesIO()
    image.save(out, format="DDS")
    return out.getvalue()


def _tx_extents(glb: bytes) -> dict[str, tuple[float, float, float, float]]:
    """`name -> (min x, max x, min z, max z)` of each Tx node's mesh, in Refractor
    terms (the glb mirrors z)."""
    length = struct.unpack("<I", glb[12:16])[0]
    doc = json.loads(glb[20:20 + length])
    out: dict[str, tuple[float, float, float, float]] = {}
    for node in doc["nodes"]:
        name = node.get("name", "")
        if not name.startswith("Tx") or "mesh" not in node:
            continue
        accessor = doc["accessors"][doc["meshes"][node["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
        lo, hi = accessor["min"], accessor["max"]
        out[name] = (lo[0], hi[0], -hi[2], -lo[2])
    return out


@unittest.skipIf(Image is None, "Pillow is needed to write the tile fixtures")
class BuildSceneGridTests(unittest.TestCase):
    """`build_scene` end to end on a level archive written here."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _bake(self, world: int, dim: int, offset: int, tiles: list[tuple[int, int]]):
        import extract_map  # heavy: imports the whole exporter

        base = "bf1942/levels/Grid/"
        terrain = (
            "GeometryTemplate.create PatchTerrain terrainGeometry\n"
            f"GeometryTemplate.worldSize {world}\nGeometryTemplate.yScale 0.6\n"
            f"GeometryTemplate.texOffsetX {offset}\nGeometryTemplate.texOffsetY {offset}\n"
            "GeometryTemplate.waterLevel -10\n")
        files = {base + "Init/Terrain.con": terrain.encode(),
                 base + "Heightmap.raw": struct.pack(f"<{dim * dim}H", *([1000] * (dim * dim)))}
        for col, row in tiles:
            files[base + f"Textures/Tx{col:02d}x{row:02d}.dds"] = _dds((col * 60, row * 60, 90, 255))
        archive = self.tmp / "Grid.rfa"
        write_rfa(archive, files)
        level = load_level_files([archive], "Grid")
        info = LevelInfo(name="Grid", terrain=parse_terrain_con(terrain))
        heightmap = decode_heightmap(level.read("Heightmap.raw"), float(world), 0.6)
        return extract_map.build_scene(level, info, heightmap, None, max_texture=0,
                                       include_objects=False)

    def test_a_fine_heightmap_gets_its_tiles_on_its_own_patches(self) -> None:
        # Medina Ridge in miniature: 128 samples over 128 m, 2x2 patches of 64 m.
        glb, report = self._bake(128, 128, 0, [(0, 0), (1, 0), (0, 1), (1, 1)])

        self.assertEqual([], report["terrain"]["missingTiles"])
        extents = _tx_extents(glb)
        self.assertEqual((0.0, 64.0, 0.0, 64.0), extents["Tx00x00"])
        self.assertEqual((64.0, 128.0, 0.0, 64.0), extents["Tx01x00"])
        self.assertEqual((0.0, 64.0, 64.0, 128.0), extents["Tx00x01"])
        self.assertEqual((64.0, 128.0, 64.0, 128.0), extents["Tx01x01"])

    def test_a_4_m_heightmap_keeps_256_m_patches(self) -> None:
        glb, report = self._bake(512, 128, 0, [(0, 0), (1, 1)])

        self.assertEqual([], report["terrain"]["missingTiles"])
        extents = _tx_extents(glb)
        self.assertEqual((0.0, 256.0, 0.0, 256.0), extents["Tx00x00"])
        self.assertEqual((256.0, 512.0, 256.0, 512.0), extents["Tx01x01"])

    def test_a_file_outside_the_window_is_not_drawn(self) -> None:
        # 4 patches of 64 m, offset 1: the engine draws files 0..1 on world
        # patches 1..2; file 2 would land on world patch 3, inside the
        # heightmap, where the engine puts the default texture instead.
        glb, report = self._bake(256, 256, 1, [(0, 0), (1, 1), (2, 2)])

        self.assertEqual(["Tx02x02"], report["terrain"]["missingTiles"])
        extents = _tx_extents(glb)
        self.assertEqual({"Tx00x00", "Tx01x01"}, set(extents))
        self.assertEqual((64.0, 128.0, 64.0, 128.0), extents["Tx00x00"])


if __name__ == "__main__":
    unittest.main()
