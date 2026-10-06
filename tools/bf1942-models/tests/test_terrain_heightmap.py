"""The whole heightmap as a bake layer: `bf42/terrain.py` `heightmap_png` and
the viewer's `heightfieldFromSamples`.

The colliders used to snap their lattice off the drawn terrain tiles, so a
patch the bake leaves undrawn (the sea floor of 29 levels; Midway leaves 240
of its 256 patches undrawn) had no ground at all. `PatchTerrain` collides
against the whole heightmap, so the `heightmap` layer ships it whole
(`terrain/heightmap.png`) and every collider builds its lattice from that.

What this pins:

* the PNG is the samples exactly: u16 high byte in red, low byte in green,
  each scan line filtered Up, read back here by a decoder of its own;
* where a tile is drawn, the lattice from the PNG equals the tile snap to the
  bit (the glb's own float32 arithmetic), and where none is, it has ground
  the tile snap has not;
* the layer is registered and writes the file and the key.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from bf42.level import HEIGHT_UNITS, Heightmap  # noqa: E402
from bf42.terrain import heightmap_png, patch_mesh  # noqa: E402

HARNESS = HERE / "tests" / "terrain_heightmap_harness.mjs"


def synthetic(dim: int = 128, spacing: float = 4.0, y_scale: float = 0.6) -> Heightmap:
    """Every byte value in play, high and low, and no two rows alike."""
    samples = [(ix * 577 + iz * 1031 + (ix * iz) % 97 * 211) % 65536
               for iz in range(dim) for ix in range(dim)]
    return Heightmap(dim=dim, spacing=spacing, y_scale=y_scale, samples=samples)


def decode_rgb_up(png: bytes) -> tuple[int, int, list[int]]:
    """The exporter's PNG back to u16 samples: IHDR, the IDAT, Up unfilter."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, depth, colour = struct.unpack(">IIBB", png[16:26])
    assert (depth, colour) == (8, 2)
    at, idat = 8, b""
    while at < len(png):
        length = struct.unpack(">I", png[at:at + 4])[0]
        tag = png[at + 4:at + 8]
        if tag == b"IDAT":
            idat += png[at + 8:at + 8 + length]
        at += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 3
    prev = bytearray(stride)
    out: list[int] = []
    for y in range(height):
        line = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        assert line[0] == 2, "every scan line is filtered Up"
        row = bytearray((line[1 + x] + prev[x]) & 0xFF for x in range(stride))
        out.extend((row[3 * i] << 8) | row[3 * i + 1] for i in range(width))
        prev = row
    return width, height, out


class HeightmapPngTests(unittest.TestCase):
    def test_the_png_is_the_samples_exactly(self) -> None:
        hm = synthetic()
        width, height, samples = decode_rgb_up(heightmap_png(hm))
        self.assertEqual((hm.dim, hm.dim), (width, height))
        self.assertEqual(hm.samples, samples)

    def test_it_is_a_fraction_of_the_raw_file(self) -> None:
        # A smooth field compresses: the Up filter leaves row differences.
        dim = 256
        hm = Heightmap(dim=dim, spacing=4.0, y_scale=0.6,
                       samples=[(ix * 37 + iz * 53) % 65536 for iz in range(dim) for ix in range(dim)])
        self.assertLess(len(heightmap_png(hm)), dim * dim * 2 // 4)

    def test_the_layer_is_registered(self) -> None:
        import scene_layers
        self.assertEqual(scene_layers.LAYERS["heightmap"], (("heightmap",), ()))
        self.assertIn("heightmap", scene_layers.COMPUTE)
        # Last in the report, so a tree patched before a re-bake and the
        # re-bake write the key in the same place.
        self.assertEqual("heightmap", scene_layers.REPORT_ORDER[-1])

    def test_the_writer_writes_the_file_and_the_key(self) -> None:
        import extract_map
        hm = synthetic(64)
        with tempfile.TemporaryDirectory() as tmp:
            report = extract_map.write_terrain_heightmap(hm, Path(tmp))
            png = (Path(tmp) / "terrain" / "heightmap.png").read_bytes()
        self.assertEqual(report, {"image": "terrain/heightmap.png", "dim": 64,
                                  "spacing": 4.0, "heightUnits": HEIGHT_UNITS * 0.6})
        self.assertEqual(png, heightmap_png(hm))


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class ColliderLatticeTests(unittest.TestCase):
    """A 128-sample heightmap, two 256 m patches of its four drawn."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.hm = hm = synthetic()
        drawn = [(0, 0), (1, 1)]
        tiles = []
        for col, row in drawn:
            prim = patch_mesh(hm, col, row, 256.0, 1.0)
            # The glb mirrors z (`bf42/gltf.py`).
            tiles.append([c for x, y, z in prim.positions for c in (x, y, -z)])
        cls.lattice = [(0, 0), (5, 7), (64, 64), (100, 20), (127, 127), (128, 128), (128, 3)]
        spec = {
            "worldSize": hm.dim * hm.spacing, "dim": hm.dim, "tiles": tiles,
            "heightmap": {"dim": hm.dim, "spacing": hm.spacing,
                          "heightUnits": HEIGHT_UNITS * hm.y_scale},
            "lattice": cls.lattice,
            # Inside drawn patch (0, 0), and inside undrawn patch (1, 0).
            "probes": [[101.3, -57.9], [301.3, -57.9]],
        }
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "heightmap.png").write_bytes(heightmap_png(hm))
            (Path(tmp) / "tiles.json").write_text(json.dumps(spec))
            proc = subprocess.run(["node", str(HARNESS), tmp], capture_output=True,
                                  text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_whole_grid_has_ground(self) -> None:
        self.assertEqual((129) ** 2, self.r["samples"])
        self.assertEqual(0, self.r["holes"])
        self.assertEqual(1, self.r["rawCoverage"])
        self.assertLess(self.r["tilesCoverage"], 0.6)

    def test_where_a_tile_is_drawn_the_two_agree_to_the_bit(self) -> None:
        self.assertGreater(self.r["drawn"], 2 * 65 * 65 - 10)
        self.assertEqual(self.r["drawn"], self.r["same"])

    def test_each_sample_is_the_exporters_float32_height(self) -> None:
        dim = self.hm.dim
        for (ix, iz), got in zip(self.lattice, self.r["lattice"]):
            with self.subTest(ix=ix, iz=iz):
                want = self.hm.height_at(min(ix, dim - 1), min(iz, dim - 1))
                self.assertEqual(struct.unpack("<f", struct.pack("<f", want))[0], got)

    def test_an_undrawn_patch_has_the_heightmaps_ground(self) -> None:
        inside, outside = self.r["probes"]
        self.assertAlmostEqual(inside["tiles"], inside["raw"], places=4)
        self.assertIsNone(outside["tiles"])            # NaN: no tile, no ground
        self.assertIsInstance(outside["raw"], float)


if __name__ == "__main__":
    unittest.main()
