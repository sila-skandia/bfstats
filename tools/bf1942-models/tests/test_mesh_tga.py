"""A mesh material's TGA: RLE files keep their rows as stored (bf42/meshtga.py)."""
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parents[1] / "scripts"))

from bf42.meshtga import mesh_tga_pixels, mesh_tga_rows_as_stored  # noqa: E402
from extract_hud_assets import decode_tga  # noqa: E402


def tga(image_type: int, descriptor: int, rows_in_file: list[list[tuple]]) -> bytes:
    """A 2-wide 32-bit TGA whose file rows are `rows_in_file` (BGRA order)."""
    height = len(rows_in_file)
    head = struct.pack("<BBBHHBHHHHBB", 0, 0, image_type, 0, 0, 0, 0, 0, 2, height, 32, descriptor)
    flat = b"".join(bytes(px) for row in rows_in_file for px in row)
    if image_type == 2:
        return head + flat
    # one raw packet per row, so the file stays a legal RLE stream
    body = b""
    for row in rows_in_file:
        body += bytes([len(row) - 1]) + b"".join(bytes(px) for px in row)
    return head + body


TOP = [(0, 0, 255, 255), (0, 0, 255, 255)]      # red
BOTTOM = [(255, 0, 0, 255), (255, 0, 0, 255)]   # blue


class MeshTgaTests(unittest.TestCase):
    def rows(self, raw):
        w, h, rgba = decode_tga(raw)
        rgba = mesh_tga_pixels(raw, w, h, rgba)
        return [tuple(rgba[y * w * 4:y * w * 4 + 4]) for y in range(h)]

    def test_rle_bottom_left_keeps_file_order(self):
        # file order: blue row first. decode_tga puts it last (flipped); the
        # mesh loader keeps it first.
        raw = tga(10, 0b1000, [BOTTOM, TOP])
        self.assertTrue(mesh_tga_rows_as_stored(raw))
        w, h, rgba = decode_tga(raw)
        self.assertEqual(tuple(rgba[:4]), (255, 0, 0, 255))  # red on top after the flip
        self.assertEqual(self.rows(raw)[0], (0, 0, 255, 255))  # blue first, as stored

    def test_type_2_is_left_to_decode_tga(self):
        raw = tga(2, 0b1000, [BOTTOM, TOP])
        self.assertFalse(mesh_tga_rows_as_stored(raw))
        self.assertEqual(self.rows(raw)[0], (255, 0, 0, 255))

    def test_rle_top_left_is_already_in_file_order(self):
        raw = tga(10, 0b101000, [TOP, BOTTOM])
        self.assertFalse(mesh_tga_rows_as_stored(raw))
        self.assertEqual(self.rows(raw)[0], (255, 0, 0, 255))

    def test_short_input_is_not_stored_rows(self):
        self.assertFalse(mesh_tga_rows_as_stored(b"\x00" * 10))


if __name__ == "__main__":
    unittest.main()
