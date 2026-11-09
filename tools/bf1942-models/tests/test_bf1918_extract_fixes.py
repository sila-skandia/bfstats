"""Extractor defects BF1918 exposed on its first import (2026-11-10).

* A seat state at speed 0 (`clip_timeline`): the engine advances a state's
  phase by `dt * speed`, so speed 0 holds frame 0. The division by the speed
  aborted the whole seat-pose pass.
* The console font atlas as a 32-bit truecolour TGA (`decode_alpha_tga`):
  BF1918's `Font/BF1942.tga` is type 2 at 32 bpp, white glyphs with a 1-bit
  alpha; vanilla's is 8-bit grey.
"""

from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_pose  # noqa: E402
from bf42.font import decode_alpha_tga  # noqa: E402


class _Clip:
    frames = 3

    def local_pose(self, f):
        return {"root": f}


class SpeedZeroState(unittest.TestCase):
    def test_a_still_state_is_frame_zero_held(self):
        with mock.patch.object(extract_pose.pose_mod, "align_clip_roots", lambda sk, p: p):
            frames, period = extract_pose.clip_timeline(_Clip(), 0.0, None)
        self.assertEqual([{"root": 0}], frames)
        self.assertGreater(period, 0)

    def test_a_moving_state_is_unchanged(self):
        with mock.patch.object(extract_pose.pose_mod, "align_clip_roots", lambda sk, p: p):
            frames, period = extract_pose.clip_timeline(_Clip(), 2.0, None)
        self.assertEqual(3, len(frames))
        self.assertAlmostEqual(0.5, period)


def _tga(image_type, depth, pixels, width, height, top_down=True):
    header = bytes([0, 0, image_type]) + bytes(9) + struct.pack("<HH", width, height) \
        + bytes([depth, 0x28 if top_down else 0x08])
    return header + pixels


class TruecolourFontAtlas(unittest.TestCase):
    # 2x1: a white opaque glyph texel, then black transparent (BGRA).
    BGRA = bytes([255, 255, 255, 255, 0, 0, 0, 0])

    def test_type_2_at_32_bpp(self):
        w, h, rgba = decode_alpha_tga(_tga(2, 32, self.BGRA, 2, 1))
        self.assertEqual((2, 1), (w, h))
        self.assertEqual(bytes([255, 255, 255, 255, 0, 0, 0, 0]), rgba)

    def test_type_10_rle_at_32_bpp(self):
        rle = bytes([0x80]) + self.BGRA[:4] + bytes([0x80]) + self.BGRA[4:]
        self.assertEqual(decode_alpha_tga(_tga(2, 32, self.BGRA, 2, 1))[2],
                         decode_alpha_tga(_tga(10, 32, rle, 2, 1))[2])

    def test_bottom_up_rows_are_flipped(self):
        # 1x2 bottom-up: the first stored row is the bottom one.
        _, _, rgba = decode_alpha_tga(_tga(2, 32, self.BGRA, 1, 2, top_down=False))
        self.assertEqual(bytes([0, 0, 0, 0, 255, 255, 255, 255]), rgba)

    def test_grey_atlases_still_read(self):
        w, h, rgba = decode_alpha_tga(_tga(3, 8, bytes([200]), 1, 1))
        self.assertEqual(bytes([255, 255, 255, 200]), rgba)


if __name__ == "__main__":
    unittest.main()
