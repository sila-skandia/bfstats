from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

from extract_hud_assets import decode_tga  # noqa: E402


def indexed_tga(pixels: list[int], palette_bgr: list[tuple[int, int, int]],
                width: int, height: int) -> bytes:
    header = (
        bytes([0, 1, 1])
        + struct.pack("<HHB", 0, len(palette_bgr), 24)
        + struct.pack("<HHHH", 0, 0, width, height)
        + bytes([8, 0])
    )
    cmap = b"".join(bytes(entry) for entry in palette_bgr)
    return header + cmap + bytes(pixels)


class IndexedTgaTests(unittest.TestCase):
    def test_type_1_palette_becomes_rgba(self) -> None:
        data = indexed_tga([0], [(0, 0, 255)], 1, 1)
        width, height, rgba = decode_tga(data)

        self.assertEqual((1, 1), (width, height))
        self.assertEqual(b"\xff\x00\x00\xff", rgba)
