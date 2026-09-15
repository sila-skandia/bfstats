from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.font import decode_alpha_tga, parse_dif  # noqa: E402

# The head of the shipped `Font/Trebuchet MS8.dif`, verbatim.
DIF = """header
2
Trebuchet MS
256
90
11
glyphs
5
32\t0\t1\t2\t0\t0\t0\t1\t1
33\t1\t2\t1\t8\t2\t0\t4\t8
36\t0\t5\t1\t9\t15\t0\t20\t10
44\t1\t2\t1\t2\t59\t0\t61\t4
65\t0\t7\t1\t8\t169\t0\t176\t8
"""


class DifTests(unittest.TestCase):
    def test_header(self) -> None:
        font = parse_dif(DIF)
        self.assertEqual("Trebuchet MS", font.face)
        self.assertEqual((256, 90), (font.atlas_width, font.atlas_height))
        self.assertEqual(11, font.line_height)
        self.assertEqual(5, len(font.glyphs))

    def test_glyph_columns(self) -> None:
        bang = parse_dif(DIF).glyphs[33]
        self.assertEqual((1, 2, 1), (bang.left, bang.width, bang.right))
        self.assertEqual(4, bang.advance)
        self.assertEqual((2, 0, 4, 8), (bang.x0, bang.y0, bang.x1, bang.y1))
        self.assertEqual(bang.width, bang.x1 - bang.x0)

    def test_ascent_places_the_comma_and_the_dollar(self) -> None:
        font = parse_dif(DIF)
        # Baseline is the cap height; A sits on it, the comma hangs below
        # it and the dollar sign overshoots it by one row.
        self.assertEqual(8, font.baseline)
        self.assertEqual(0, font.baseline - font.glyphs[65].ascent)
        self.assertEqual(6, font.baseline - font.glyphs[44].ascent)
        self.assertEqual(-1, font.baseline - font.glyphs[36].ascent)

    def test_measure(self) -> None:
        self.assertEqual(8 + 3, parse_dif(DIF).measure("A "))

    def test_rejects_the_hud_font(self) -> None:
        with self.assertRaises(ValueError):
            parse_dif("Texture = font/BF1942.tga\nTextureWidth = 256\n")


class AlphaTgaTests(unittest.TestCase):
    def test_greyscale_becomes_white_with_alpha(self) -> None:
        header = bytes([0, 0, 3]) + b"\0" * 5 + struct.pack("<HHHH", 0, 0, 2, 2) + bytes([8, 0])
        # Bottom-up storage: the file's first row is the image's last.
        w, h, rgba = decode_alpha_tga(header + bytes([10, 20, 30, 40]))
        self.assertEqual((2, 2), (w, h))
        self.assertEqual(bytes([255, 255, 255, 30, 255, 255, 255, 40,
                                255, 255, 255, 10, 255, 255, 255, 20]), rgba)

    def test_top_down_flag(self) -> None:
        header = bytes([0, 0, 3]) + b"\0" * 5 + struct.pack("<HHHH", 0, 0, 2, 1) + bytes([8, 0x20])
        _, _, rgba = decode_alpha_tga(header + bytes([1, 2]))
        self.assertEqual((1, 2), (rgba[3], rgba[7]))


if __name__ == "__main__":
    unittest.main()
