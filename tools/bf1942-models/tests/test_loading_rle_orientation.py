"""A loading picture's rows are read as stored when it is an RLE TGA with a bottom-left origin.

FHSWEurope's doomed_budapest `ls.tga` is type 10 (RLE), 24-bit, origin bit 0.
PIL honours the origin and flips it, so the title came out upside down; the
engine reads an RLE TGA's rows in file order (bf42/meshtga.py). The mods author
their pictures to read upright that way. An uncompressed type 2 file keeps
PIL's reading, which the engine honours too.
"""
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from extract_loading_assets import convert_background_to_webp  # noqa: E402

WIDTH = 16
HEIGHT = 16
RED = (255, 0, 0)
BLUE = (0, 0, 255)
# File rows 0..7 are red and 8..15 blue: the top band of the file is red.
FILE_ROWS = [RED] * (HEIGHT // 2) + [BLUE] * (HEIGHT // 2)


def _tga_header(image_type: int, descriptor: int) -> bytes:
    # id length, colour map type, image type, colour map spec, x/y origin,
    # width, height, depth, descriptor: the 18-byte TGA header.
    return struct.pack("<BBB5sHHHHBB", 0, 0, image_type, b"\0" * 5, 0, 0,
                       WIDTH, HEIGHT, 24, descriptor)


def _rle_body() -> bytes:
    """One run packet per row: WIDTH copies of that row's BGR pixel."""
    out = bytearray()
    for r, g, b in FILE_ROWS:
        out.append(0x80 | (WIDTH - 1))
        out += bytes((b, g, r))
    return bytes(out)


def _raw_body() -> bytes:
    out = bytearray()
    for r, g, b in FILE_ROWS:
        out += bytes((b, g, r)) * WIDTH
    return bytes(out)


def _top_band(webp: Path) -> tuple[int, int, int]:
    """The colour a few rows below the top edge, away from the blended border."""
    with Image.open(webp) as im:
        r, g, b = im.convert("RGB").getpixel((WIDTH // 2, 2))
    if r > 150 and b < 100:
        return RED
    if b > 150 and r < 100:
        return BLUE
    return (r, g, b)


class LoadingPictureOrientation(unittest.TestCase):
    def _top_colour(self, raw: bytes) -> tuple[int, int, int]:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "load.webp"
            convert_background_to_webp(raw, out, quality=100)
            return _top_band(out)

    def test_rle_bottom_left_rows_are_read_as_stored(self) -> None:
        # File row 0 (red) is the top of the picture, as the engine reads it.
        raw = _tga_header(10, 0x00) + _rle_body()
        self.assertEqual(RED, self._top_colour(raw))

    def test_rle_top_left_is_not_flipped(self) -> None:
        # The origin bit is set: PIL and the engine agree, file row 0 is the top.
        raw = _tga_header(10, 0x20) + _rle_body()
        self.assertEqual(RED, self._top_colour(raw))

    def test_uncompressed_bottom_left_keeps_pils_reading(self) -> None:
        # Type 2 honours the origin bit, so the bottom file row (blue) is the top.
        raw = _tga_header(2, 0x00) + _raw_body()
        self.assertEqual(BLUE, self._top_colour(raw))


if __name__ == "__main__":
    unittest.main()
