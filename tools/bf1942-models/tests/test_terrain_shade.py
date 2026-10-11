"""The terrain's shade on an object with no lightmap (ledger DL-10, DL-11).

`bf42/terrainshade.py` reads a level's `LightmapShadowBits.lsb` and its DXT1
tiles the way the client does; `viewer/terrain-shade.js` answers from what it
writes. The node half (`test_terrain_shade.mjs`) is run from here against
bytes this file packs, so the two readers are held to one answer.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from bf42 import terrainshade as ts  # noqa: E402

SCRIPT = HERE / "test_terrain_shade.mjs"

SHADOW = 1 << 13


def lsb_patch(width: int, rows: list[list[int]]) -> bytes:
    """One patch's record: `rows` are lists of run words."""
    out = struct.pack("<II", width, len(rows))
    out += struct.pack(f"<{len(rows)}I", *[len(r) - 1 for r in rows])
    for runs in rows:
        out += struct.pack(f"<{len(runs)}H", *runs)
    return out


def dxt1(width: int, height: int, block) -> bytes:
    """A DXT1 dds whose every block is `block(bx, by)` -> 8 bytes."""
    head = bytearray(128)
    head[:4] = b"DDS "
    struct.pack_into("<II", head, 12, height, width)
    head[84:88] = b"DXT1"
    body = b"".join(block(bx, by) for by in range(height // 4) for bx in range(width // 4))
    return bytes(head) + body


def flat(c565: int) -> bytes:
    return struct.pack("<HHI", c565, c565, 0)


class LsbTests(unittest.TestCase):
    def test_a_patch_with_no_bits_is_one_zero_word(self) -> None:
        # Two patches in the window; the first has none.
        data = struct.pack("<I", 0) + lsb_patch(8, [[8], [3, SHADOW | 5]])
        bits = ts.parse_lsb(data, [0, 1], [0])
        self.assertEqual(list(bits), [(1, 0)])
        width, height, lines = bits[(1, 0)]
        self.assertEqual((width, height), (8, 2))
        self.assertEqual(lines[1], (3, SHADOW | 5))

    def test_patches_outside_the_tile_window_have_no_record(self) -> None:
        # texOffset 1 on a two-patch axis draws nothing (`tile_in_window`).
        self.assertEqual(ts.window(0, 2), [0, 1])
        self.assertEqual(ts.window(1, 2), [None, None])
        self.assertEqual(ts.window(-1, 2), [0, None])
        data = lsb_patch(4, [[SHADOW | 4]])
        self.assertEqual(list(ts.parse_lsb(data, [0, None], [0, None])), [(0, 0)])

    def test_a_truncated_file_keeps_what_it_read(self) -> None:
        data = lsb_patch(4, [[SHADOW | 4]]) + struct.pack("<II", 4, 2)
        self.assertEqual(list(ts.parse_lsb(data, [0, 1], [0])), [(0, 0)])

    def test_the_run_walk_is_the_clients(self) -> None:
        # 0x00680670: the first run whose running length reaches the texel.
        runs = (3, SHADOW | 2, 3)
        self.assertEqual([ts.run_bit(runs, x) for x in range(8)],
                         [0, 0, 0, 0, 1, 1, 0, 0])
        self.assertEqual(ts.run_bit((SHADOW | 8,), 0), 1)
        # Past the last run the last one answers.
        self.assertEqual(ts.run_bit((4, SHADOW | 4), 20), 1)


class LumaTests(unittest.TestCase):
    def test_channels_are_shifted_not_replicated(self) -> None:
        # 0x006806f0: white is 248 / 252 / 248, so its luminance is 250.4.
        self.assertAlmostEqual(ts.block_luma(flat(0xffff), 0), 0.30 * 248 + 0.59 * 252 + 0.11 * 248)
        self.assertEqual(ts.block_luma(flat(0), 0), 0.0)

    def test_the_middle_colours_are_always_the_thirds(self) -> None:
        # c0 < c1 would make index 3 transparent black in a DXT1 decoder; the
        # client's own makes it a third of the way, whatever the order.
        block = struct.pack("<HHI", 0x0000, 0xffff, 0xffffffff)   # all index 3
        r, g, b = (0 + 2 * 248) // 3, (0 + 2 * 252) // 3, (0 + 2 * 248) // 3
        self.assertAlmostEqual(ts.block_luma(block, 0), 0.30 * r + 0.59 * g + 0.11 * b)

    def test_only_dxt1_is_read(self) -> None:
        data = bytearray(dxt1(8, 8, lambda x, y: flat(0xffff)))
        data[84:88] = b"DXT3"
        with self.assertRaises(ValueError):
            ts.Dxt1(bytes(data))


class LayerTests(unittest.TestCase):
    """A 128 m world of four 64 m patches (a 128-sample heightmap), 2 m cells."""

    def setUp(self) -> None:
        # Patch (0, 0): 64 texels a side, the west half of rows 0..31 in shadow.
        rows = [[SHADOW | 32, 32]] * 32 + [[64]] * 32
        lsb = lsb_patch(64, rows) + struct.pack("<I", 0) * 3
        grey = (10 << 11) | (20 << 5) | 10          # 80 / 80 / 80
        self.tile = dxt1(64, 64, lambda x, y: flat(grey))
        self.side, self.luma, self.bits, self.stats = ts.shade_layer(
            128.0, 128, 0, 0, lsb, lambda c, r: self.tile if (c, r) == (0, 0) else None)

    def test_the_image_is_the_shadowed_grounds_luminance(self) -> None:
        self.assertEqual(self.side, 64)
        self.assertEqual(self.luma[0], 80)                    # (1, 1) m: shadow
        self.assertEqual(self.luma[20 * 64 + 20], ts.LIT)     # (41, 41) m: open
        self.assertEqual(self.luma[40], ts.LIT)               # another patch
        # Texel 32 still reaches the shadow run (the client's `>=`), so its
        # block, cells 16 and 17, is shadowed ground too.
        self.assertEqual(self.luma[17], 80)
        self.assertEqual(self.luma[18], ts.LIT)
        self.assertAlmostEqual(self.stats["shaded"], 18 * 16 / (64 * 64), places=4)

    def test_the_bits_answer_a_point(self) -> None:
        self.assertEqual(ts.packed_bit(self.bits, 1.0, 1.0), 1)
        self.assertEqual(ts.packed_bit(self.bits, 31.9, 31.9), 1)
        # Texel 33 is the first of the lit run (32 still reaches the shadow).
        self.assertEqual(ts.packed_bit(self.bits, 33.5, 1.0), 0)
        self.assertEqual(ts.packed_bit(self.bits, 1.0, 40.0), 0)
        self.assertEqual(ts.packed_bit(self.bits, 100.0, 1.0), 0)   # no bits there
        self.assertEqual(ts.packed_bit(self.bits, -1.0, 1.0), 0)
        self.assertEqual(ts.packed_bit(self.bits, 500.0, 1.0), 0)

    def test_a_tile_the_client_cannot_read_drops_its_patch(self) -> None:
        rows = [[SHADOW | 64]] * 64
        lsb = lsb_patch(64, rows) + struct.pack("<I", 0) * 3
        side, luma, bits, stats = ts.shade_layer(128.0, 128, 0, 0, lsb, lambda c, r: None)
        self.assertEqual(stats["shaded"], 0)
        self.assertEqual(ts.packed_bit(bits, 1.0, 1.0), 0)

    def test_the_bytes_ride_a_png(self) -> None:
        png, rows = ts.bytes_png(self.bits)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack_from(">II", png, 16), (ts.BYTES_WIDE, rows))
        self.assertGreaterEqual(rows * ts.BYTES_WIDE, len(self.bits))

    def test_the_viewer_reads_the_same_answers(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        points = [(1.0, 1.0), (31.9, 31.9), (33.5, 1.0), (1.0, 40.0), (100.0, 1.0),
                  (16.2, 8.6), (32.1, 0.2), (63.9, 31.9), (64.1, 1.0)]
        with tempfile.TemporaryDirectory() as tmp:
            case = Path(tmp) / "case.json"
            case.write_text(json.dumps({
                "bits": list(self.bits),
                "luma": list(self.luma),
                "dim": self.side,
                "cell": 128.0 / self.side,
                "points": [[x, z, ts.packed_bit(self.bits, x, z)] for x, z in points],
            }))
            proc = subprocess.run(["node", str(SCRIPT), str(case)],
                                  capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
