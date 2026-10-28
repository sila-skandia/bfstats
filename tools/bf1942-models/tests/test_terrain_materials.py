"""The terrain material ids as the server reads them (ledger TERR-18), and the
`terrainMaterials` bake layer that ships them.

`PatchTerrain::init` keeps four bits a sample: each row of `Materialmap.raw`
is packed pair by pair into `(row[2k] << 4) | (row[2k+1] & 0xf)`, and
`getMaterial` answers the high nibble for an even column, the low for an odd
one. So a byte above 15 reads as its low nibble. Three FHSW levels (and one
more of FHSWEurope's) carry such bytes: crete-1941's 1881 samples of 119 are
material 7, the combat area's "outside".
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from bf42.level import decode_material_map  # noqa: E402


def engine_material(raw: bytes, dim: int, ix: int, iz: int) -> int:
    """`PatchTerrain::init`'s packing and `getMaterial`'s read, transcribed
    (lnxded 0x083d5e07..0x083d5e2c, 0x083d68b1..0x083d68ec)."""
    table = bytearray()
    for row in range(dim):
        line = raw[row * dim:(row + 1) * dim]
        for k in range(0, dim, 2):
            table.append(((line[k] << 4) & 0xFF) | (line[k + 1] & 0x0F))
    index = (ix >> 1) + iz * (dim >> 1)
    index = max(0, min(len(table) - 1, index))
    byte = table[index]
    return byte & 0x0F if ix & 1 else byte >> 4


class NibbleTests(unittest.TestCase):
    def test_every_sample_reads_as_the_engine_reads_it(self) -> None:
        dim = 16
        raw = bytes((i * 37 + 11) % 256 for i in range(dim * dim))
        materials = decode_material_map(raw, dim * 4.0)
        for iz in range(dim):
            for ix in range(dim):
                self.assertEqual(materials.material_at(ix, iz),
                                 engine_material(raw, dim, ix, iz), (ix, iz))

    def test_a_stray_119_is_material_7(self) -> None:
        raw = bytes([3, 119, 119, 3])
        self.assertEqual(list(decode_material_map(raw, 8.0).ids), [3, 7, 7, 3])

    def test_an_id_below_16_is_its_byte(self) -> None:
        raw = bytes(range(16))
        self.assertEqual(decode_material_map(raw, 16.0).ids, raw)


class LayerTests(unittest.TestCase):
    def test_the_layer_owns_only_the_terrain_blocks_materials(self) -> None:
        import scene_layers
        self.assertEqual(scene_layers.LAYERS["terrainMaterials"], (("terrain.materials",), ()))
        self.assertIn("terrainMaterials", scene_layers.COMPUTE)
        report = {"level": "T", "terrain": {"tiles": 4, "materials": {"histogram": {"119": 1}}, "z": 1},
                  "heightmap": {"dim": 2}}
        fresh = {"histogram": {"7": 1}}
        out = scene_layers.merge(report, ["terrainMaterials"], {"terrain.materials": fresh}, {})
        self.assertEqual(out, {"level": "T", "terrain": {"tiles": 4, "materials": fresh, "z": 1},
                               "heightmap": {"dim": 2}})
        self.assertEqual(list(out["terrain"]), ["tiles", "materials", "z"])
        # A level with no material map drops the block, never the terrain.
        gone = scene_layers.merge(report, ["terrainMaterials"], {}, {})
        self.assertEqual(gone["terrain"], {"tiles": 4, "z": 1})
        # The full bake composes it into the glb's terrain block.
        composed = scene_layers.compose({"level": "T", "terrain": {"tiles": 4}},
                                        {"terrain.materials": fresh}, {})
        self.assertEqual(composed["terrain"], {"tiles": 4, "materials": fresh})
        self.assertNotIn("terrain.materials", composed)


if __name__ == "__main__":
    unittest.main()
