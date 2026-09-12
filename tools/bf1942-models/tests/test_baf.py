from __future__ import annotations

import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import baf  # noqa: E402


def hold(value: int, frames: int) -> list[int]:
    """One RLE hold segment: the value repeated `frames` times."""
    return [(2 << 8) | 0x80 | frames, value & 0xFFFF]


def literal(values: list[int]) -> list[int]:
    return [((len(values) + 1) << 8) | len(values)] + [v & 0xFFFF for v in values]


def pack_baf(bones: list[tuple[str, list[list[int]]]], frames: int,
             precision: int = 15, version: int = 3) -> bytes:
    """`bones` as (name, seven channels of segment words)."""
    out = bytearray()
    out += struct.pack("<I", version)
    out += struct.pack("<H", len(bones))
    for name, _ in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
    out += struct.pack("<I", frames)
    out.append(precision)
    for _, channels in bones:
        payload = sum(len(words) for words in channels)
        out += struct.pack("<H", payload)
        for words in channels:
            out += struct.pack("<H", len(words))
            out += struct.pack(f"<{len(words)}H", *words)
    return bytes(out)


def quat_channels(x: float, y: float, z: float, w: float, frames: int = 1,
                  ) -> list[list[int]]:
    return [hold(round(c * 32768.0), frames) for c in (x, y, z, w)]


def pos_channels(x: float, y: float, z: float, frames: int = 1,
                 precision: int = 15) -> list[list[int]]:
    scale = 1 << precision
    return [hold(round(c * scale), frames) for c in (x, y, z)]


IDENTITY_BONE = quat_channels(0, 0, 0, 1) + pos_channels(0, 0, 0)


class DecodeConventionTests(unittest.TestCase):
    """The stored quaternion is row-vector convention; its conjugate is the
    mesh-space rotation, and translations are as stored. Measured, not
    assumed: reading the quaternion uninverted poses every bone by the
    opposite rotation, which legs near identity absorb and fingers tear."""

    def test_translations_are_as_stored(self) -> None:
        clip = baf.parse(pack_baf(
            [("Bip01", quat_channels(0, 0, 0, 1) + pos_channels(0.25, 0.5, -0.75))],
            frames=1), "t.baf")

        for got, want in zip(clip.bones[0].translations[0], (0.25, 0.5, -0.75)):
            self.assertAlmostEqual(want, got, places=3)

    def test_rotation_is_the_conjugate_of_the_stored_quaternion(self) -> None:
        # Stored +90 about X (row-vector convention); the column-convention
        # local is -90 about X, which sends +Y to -Z.
        half = math.sin(math.pi / 4)
        clip = baf.parse(pack_baf(
            [("Bip01", quat_channels(half, 0, 0, half) + pos_channels(0, 0, 0))],
            frames=1), "r.baf")

        rotation = clip.local_pose(0)["bip01"][0]
        moved = tuple(sum(rotation[i][k] * (0.0, 1.0, 0.0)[k] for k in range(3))
                      for i in range(3))

        for got, want in zip(moved, (0.0, 0.0, -1.0)):
            self.assertAlmostEqual(want, got, places=3)

    def test_precision_scales_positions_only(self) -> None:
        # The same stored words at precision 14 double the translation and
        # leave the rotation alone: quaternions are always 1.15 fixed point.
        bones = [("Bip01", quat_channels(0, 0, 0, 1) + pos_channels(0.25, 0, 0))]
        at_15 = baf.parse(pack_baf(bones, frames=1, precision=15), "p15.baf")
        at_14 = baf.parse(pack_baf(bones, frames=1, precision=14), "p14.baf")

        self.assertAlmostEqual(0.25, at_15.bones[0].translations[0][0], places=3)
        self.assertAlmostEqual(0.50, at_14.bones[0].translations[0][0], places=3)
        self.assertEqual(at_15.bones[0].rotations[0], at_14.bones[0].rotations[0])

    def test_root_align_is_a_proper_half_turn_about_up(self) -> None:
        """Clip world to mesh world is a 180-degree yaw, not a mirror —
        chirality was pinned by the 48-permutation fit in the docstring."""
        rotation, translation = baf.ROOT_ALIGN

        determinant = (
            rotation[0][0] * (rotation[1][1] * rotation[2][2] - rotation[1][2] * rotation[2][1])
            - rotation[0][1] * (rotation[1][0] * rotation[2][2] - rotation[1][2] * rotation[2][0])
            + rotation[0][2] * (rotation[1][0] * rotation[2][1] - rotation[1][1] * rotation[2][0]))

        self.assertAlmostEqual(1.0, determinant, places=9)
        self.assertEqual((0.0, 0.0, 0.0), translation)
        for axis, want in (((1, 0, 0), (-1, 0, 0)), ((0, 1, 0), (0, 1, 0)),
                           ((0, 0, 1), (0, 0, -1))):
            moved = tuple(sum(rotation[i][k] * axis[k] for k in range(3))
                          for i in range(3))
            self.assertEqual(want, moved)


class RleTests(unittest.TestCase):
    def test_literal_and_hold_segments_cover_the_frames(self) -> None:
        channel = literal([100, 200]) + hold(300, 3)
        bones = [("b", [channel if i == 0 else
                        (hold(32767, 5) if i == 3 else hold(0, 5))
                        for i in range(7)])]

        clip = baf.parse(pack_baf(bones, frames=5), "rle.baf")

        xs = [round(q[0] * 32768.0) for q in clip.bones[0].rotations]
        self.assertEqual([-100, -200, -300, -300, -300], xs)

    def test_a_span_past_127_frames_is_more_segments(self) -> None:
        # A constant channel over 130 frames is two holds: 127 + 3.
        bones = [("b", [hold(32767, 127) + hold(32767, 3) if i == 3 else
                        hold(0, 127) + hold(0, 3) for i in range(7)])]

        clip = baf.parse(pack_baf(bones, frames=130), "long.baf")

        self.assertEqual(130, len(clip.bones[0].rotations))

    def test_values_are_signed_sixteen_bit(self) -> None:
        bones = [("b", [hold(-16384, 1) if i == 4 else
                        (hold(32767, 1) if i == 3 else hold(0, 1))
                        for i in range(7)])]

        clip = baf.parse(pack_baf(bones, frames=1), "signed.baf")

        self.assertAlmostEqual(-0.5, clip.bones[0].translations[0][0], places=4)

    def test_local_pose_clamps_past_the_last_frame(self) -> None:
        clip = baf.parse(pack_baf([("Bip01", IDENTITY_BONE)], frames=1), "c.baf")

        self.assertEqual(clip.local_pose(0), clip.local_pose(99))


class RejectionTests(unittest.TestCase):
    def test_rejects_unknown_version(self) -> None:
        # MedPackFire.baf opens with a stray byte that folds into version 801.
        with self.assertRaises(baf.AnimationError):
            baf.parse(pack_baf([], frames=1, version=801), "MedPackFire.baf")

    def test_rejects_a_declared_word_count_that_disagrees(self) -> None:
        data = bytearray(pack_baf([("b", IDENTITY_BONE)], frames=1))
        # The per-bone dataWords sits right after the frame count + precision:
        # version(4) + boneCount(2) + name len(2) + "b\0"(2) + frames(4) + 1.
        offset = 4 + 2 + 2 + 2 + 4 + 1
        struct.pack_into("<H", data, offset, 99)
        with self.assertRaises(baf.AnimationError):
            baf.parse(bytes(data), "declared.baf")

    def test_rejects_run_lengths_beyond_the_frame_count(self) -> None:
        bones = [("b", [hold(0, 3) if i == 0 else hold(0, 2)
                        for i in range(7)])]
        with self.assertRaises(baf.AnimationError):
            baf.parse(pack_baf(bones, frames=2), "overrun.baf")

    def test_rejects_trailing_bytes(self) -> None:
        data = pack_baf([("b", IDENTITY_BONE)], frames=1) + b"\0\0"
        with self.assertRaises(baf.AnimationError):
            baf.parse(data, "trailing.baf")


if __name__ == "__main__":
    unittest.main()
