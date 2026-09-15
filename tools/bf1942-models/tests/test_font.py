from __future__ import annotations

import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.font import decode_alpha_tga, parse_dif, parse_hud_font  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
FONT_RFA = GAME_DIR / "Mods/bf1942/Archives/Font.rfa"
FONT_ORIGINAL_ZIP = GAME_DIR / "Mods/bf1942/Archives/Font-Original.zip"

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


def hud_font_text(keys: tuple[str, ...] = (
        "Texture", "TextureWidth", "TextureHeight", "BetweenWidth",
        "SpaceWidth", "Height", "AlphaTest", "AlphaBlend"),
        divider: str = "-------") -> str:
    """A small `Font/BF1942.font`, shaped like the real file: eight `key =
    value` header lines (by default the real keys, but any text works - the
    reader never checks them), a discarded divider line, then glyph rows."""
    values = ("font/BF1942.tga", "256", "256", "2", "5", "20", "0", "1")
    header = "\r\n".join(f"{k} = {v}" for k, v in zip(keys, values))
    rows = "\r\n".join([" 0 0 0", "! 0 0 3", "A 4 0 15", "\xfe 200 168 209"])
    return f"{header}\r\n{divider}\r\n{rows}\r\n"


class HudFontTests(unittest.TestCase):
    def test_header_is_read_by_position_not_by_key(self) -> None:
        font = parse_hud_font(hud_font_text())
        self.assertEqual("font/BF1942.tga", font.texture)
        self.assertEqual((256, 256), (font.texture_width, font.texture_height))
        self.assertEqual((2, 5, 20), (font.between_width, font.space_width, font.height))
        self.assertEqual((0, 1), (font.alpha_test, font.alpha_blend))

        # Same eight values, unrelated key text: identical result, because
        # `Font::loadFontFile` never inspects the key half of the line.
        relabelled = parse_hud_font(hud_font_text(keys=tuple(f"Field{i}" for i in range(8))))
        self.assertEqual(font, relabelled)

    def test_discarded_line_content_does_not_matter(self) -> None:
        dashes = parse_hud_font(hud_font_text())
        hashes = parse_hud_font(hud_font_text(divider="### not even key=value ###"))
        self.assertEqual(dashes, hashes)

    def test_glyph_width_is_x1_minus_x0_plus_1(self) -> None:
        font = parse_hud_font(hud_font_text())
        self.assertEqual(4, font.glyphs[ord("!")].width)
        self.assertEqual(12, font.glyphs[ord("A")].width)

    def test_glyph_code_is_the_raw_byte_past_ascii(self) -> None:
        # The file stays undecoded past this point on purpose: 0xFE is 'th'
        # (thorn) in latin-1, the alphabet `Font/BF1942.font` is indexed by.
        font = parse_hud_font(hud_font_text())
        self.assertIn(0xFE, font.glyphs)
        self.assertEqual((200.0, 168.0, 209.0),
                         (font.glyphs[0xFE].x0, font.glyphs[0xFE].y, font.glyphs[0xFE].x1))

    def test_uv_starts_half_a_texel_in_and_spans_the_shared_height(self) -> None:
        font = parse_hud_font(hud_font_text())  # 256x256, Height 20
        u0, v0, u1, v1 = font.uv(ord("!"))  # x0=0, y=0, x1=3 -> width 4
        self.assertAlmostEqual(0.5 / 256, u0)
        self.assertAlmostEqual(0.5 / 256, v0)
        self.assertAlmostEqual(0.5 / 256 + 4 / 256, u1)
        self.assertAlmostEqual(0.5 / 256 + 20 / 256, v1)

    def test_advance_uses_between_width_except_for_a_space(self) -> None:
        font = parse_hud_font(hud_font_text())  # BetweenWidth 2, SpaceWidth 5
        self.assertEqual(4 + 2, font.advance(ord("!")))
        self.assertEqual(5, font.advance(0x20))
        self.assertEqual((4 + 2) * 2.0, font.advance(ord("!"), scale=2.0))
        self.assertEqual(5 * 2.0, font.advance(0x20, scale=2.0))

    def test_measure_sums_advances(self) -> None:
        font = parse_hud_font(hud_font_text())
        self.assertEqual(font.advance(ord("!")) + font.advance(0x20) + font.advance(ord("A")),
                         font.measure("! A"))

    def test_rejects_too_few_header_lines(self) -> None:
        with self.assertRaises(ValueError):
            parse_hud_font("Texture = x\n-------\n")


@unittest.skipUnless(FONT_RFA.exists(), "needs the BF1942 install")
class LiveHudFontTests(unittest.TestCase):
    """`Font/BF1942.font` out of the live `Font.rfa` - the "2012" copy."""

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(FONT_RFA) as arch:
            entry = next(e for e in arch.entries if e.lower() == "font/bf1942.font")
            cls.font = parse_hud_font(arch.read(entry).decode("latin-1"))

    def test_header(self) -> None:
        self.assertEqual((256, 256), (self.font.texture_width, self.font.texture_height))
        self.assertEqual((0, 5, 20), (self.font.between_width, self.font.space_width, self.font.height))

    def test_glyph_count_and_a_known_row(self) -> None:
        self.assertEqual(190, len(self.font.glyphs))
        bang = self.font.glyphs[ord("!")]
        self.assertEqual((0.0, 0.0, 3.0), (bang.x0, bang.y, bang.x1))
        self.assertEqual(4, bang.width)

    def test_space_is_a_dummy_rect_advanced_by_space_width(self) -> None:
        self.assertEqual((0.0, 0.0, 0.0), tuple(
            getattr(self.font.glyphs[0x20], f) for f in ("x0", "y", "x1")))
        self.assertEqual(5, self.font.advance(0x20))


@unittest.skipUnless(FONT_ORIGINAL_ZIP.exists(), "needs Font-Original.zip")
class OriginalHudFontTests(unittest.TestCase):
    """The 2004 copy: `Font-Original.zip` holds a whole `Font.rfa`, not a
    loose `.font` file, so this unzips it to a temp path RfaArchive can open.
    """

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        cls._tmpdir = tempfile.TemporaryDirectory()
        rfa_path = Path(cls._tmpdir.name) / "Font-Original.rfa"
        with zipfile.ZipFile(FONT_ORIGINAL_ZIP) as z:
            rfa_path.write_bytes(z.read("Font.rfa"))
        with RfaArchive(rfa_path) as arch:
            entry = next(e for e in arch.entries if e.lower() == "font/bf1942.font")
            cls.font = parse_hud_font(arch.read(entry).decode("latin-1"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmpdir.cleanup()

    def test_header_matches_the_2004_original(self) -> None:
        # Ledger FONT-1: 128x128, Height 11, BetweenWidth 1, SpaceWidth 1 -
        # a smaller face in a smaller atlas, not the live copy resized.
        self.assertEqual((128, 128), (self.font.texture_width, self.font.texture_height))
        self.assertEqual((1, 1, 11), (self.font.between_width, self.font.space_width, self.font.height))

    def test_glyph_width_formula_still_holds(self) -> None:
        last = self.font.glyphs[0xFE]  # 'th' (thorn), the file's last row
        self.assertEqual((100.0, 84.0, 104.0), (last.x0, last.y, last.x1))
        self.assertEqual(5, last.width)


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
