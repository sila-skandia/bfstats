from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import ske  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_ske(bones: list[tuple[str, int, tuple, tuple]], version: int = 1) -> bytes:
    """`bones` as (name, parent, 3x3 rotation rows, translation)."""
    out = bytearray()
    out += struct.pack("<II", version, len(bones))
    for name, parent, rotation, translation in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
        out += struct.pack("<h", parent)
        for row in range(3):
            out += struct.pack("<3f", *rotation[row])
            out += struct.pack("<f", translation[row])
    return bytes(out)


def apply(pose, point):
    rotation, translation = pose
    return tuple(
        sum(rotation[i][k] * point[k] for k in range(3)) + translation[i]
        for i in range(3)
    )


class SkeletonParseTests(unittest.TestCase):
    def test_reads_names_parents_and_transforms(self) -> None:
        data = pack_ske([
            ("Bip01 R Hand", -1, IDENTITY, (0.3, 0.0, 0.0)),
            ("BaseK98", 0, IDENTITY, (0.07, 0.02, 0.0)),
        ])

        skeleton = ske.parse(data, "K98.ske")

        self.assertEqual(["Bip01 R Hand", "BaseK98"], [b.name for b in skeleton.bones])
        self.assertEqual([-1, 0], [b.parent for b in skeleton.bones])

    def test_rejects_unknown_version(self) -> None:
        # GrenadeAllies.ske in this install reports version 278 and is unreadable.
        with self.assertRaises(ske.SkeletonError):
            ske.parse(pack_ske([], version=278), "GrenadeAllies.ske")

    def test_rejects_truncated_records(self) -> None:
        data = pack_ske([("base", -1, IDENTITY, (0.0, 0.0, 0.0))])
        with self.assertRaises(ske.SkeletonError):
            ske.parse(data[:-8], "short.ske")


class MirrorTests(unittest.TestCase):
    """A `.ske` is stored mirrored in Z against the `.sm` it poses."""

    def test_translation_z_is_negated(self) -> None:
        data = pack_ske([("base", -1, IDENTITY, (1.0, 2.0, 3.0))])

        skeleton = ske.parse(data, "t.ske")

        self.assertEqual((1.0, 2.0, -3.0), skeleton.bones[0].translation)

    def test_rotation_is_conjugated_not_merely_negated(self) -> None:
        # 90 degrees about X: sends +Y to +Z. Under the mirror it must send +Y to -Z.
        about_x = ((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0))
        data = pack_ske([("base", -1, about_x, (0.0, 0.0, 0.0))])

        skeleton = ske.parse(data, "r.ske")
        moved = apply((skeleton.bones[0].rotation, skeleton.bones[0].translation),
                      (0.0, 1.0, 0.0))

        for got, want in zip(moved, (0.0, 0.0, -1.0)):
            self.assertAlmostEqual(want, got, places=6)

    def test_mirror_preserves_orthonormality(self) -> None:
        about_x = ((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0))
        rotation = ske.parse(pack_ske([("b", -1, about_x, (0,) * 3)]), "r").bones[0].rotation

        for i in range(3):
            self.assertAlmostEqual(1.0, sum(c * c for c in rotation[i]), places=6)
            for j in range(i + 1, 3):
                self.assertAlmostEqual(
                    0.0, sum(rotation[i][k] * rotation[j][k] for k in range(3)), places=6)


class RestPoseTests(unittest.TestCase):
    def test_rest_accumulates_down_the_parent_chain(self) -> None:
        data = pack_ske([
            ("root", -1, IDENTITY, (1.0, 0.0, 0.0)),
            ("child", 0, IDENTITY, (0.5, 0.0, 0.0)),
        ])

        skeleton = ske.parse(data, "chain.ske")

        self.assertAlmostEqual(1.5, skeleton.rest(1)[1][0], places=6)

    def test_relative_to_the_parent_is_the_bones_own_local_transform(self) -> None:
        data = pack_ske([
            ("root", -1, IDENTITY, (1.0, 2.0, 3.0)),
            ("body", 0, IDENTITY, (0.25, 0.0, 0.0)),
            ("trigger", 1, IDENTITY, (0.1, -0.05, 0.0)),
        ])
        skeleton = ske.parse(data, "local.ske")

        rotation, translation = skeleton.relative(2, 1)

        self.assertEqual(IDENTITY, rotation)
        for got, want in zip(translation, (0.1, -0.05, 0.0)):
            self.assertAlmostEqual(want, got, places=6)

    def test_relative_cancels_the_main_bones_own_pose(self) -> None:
        """What makes a weapon's origin its main bone rather than the hand it hangs off."""
        data = pack_ske([
            ("Bip01 R Hand", -1, IDENTITY, (0.305, 0.0, 0.0)),
            ("base", 0, IDENTITY, (0.07, 0.03, 0.0)),
            ("mag", 1, IDENTITY, (0.0, -0.07, 0.055)),
        ])
        skeleton = ske.parse(data, "weapon.ske")

        _, translation = skeleton.relative(skeleton.index("mag"), skeleton.index("base"))

        # The 0.305 hand offset and the 0.07 body offset both drop out.
        for got, want in zip(translation, (0.0, -0.07, -0.055)):
            self.assertAlmostEqual(want, got, places=6)

    def test_a_bone_relative_to_itself_is_identity(self) -> None:
        skeleton = ske.parse(pack_ske([("base", -1, IDENTITY, (1.0, 2.0, 3.0))]), "s.ske")

        rotation, translation = skeleton.relative(0, 0)

        self.assertEqual(IDENTITY, rotation)
        self.assertEqual((0.0, 0.0, 0.0), translation)


class BoneLookupTests(unittest.TestCase):
    def test_underscores_in_con_match_spaces_in_the_skeleton(self) -> None:
        """`bindToSkeletonPart Bip01_Spine3` against a stored `Bip01 Spine3`."""
        skeleton = ske.parse(pack_ske([("Bip01 Spine3", -1, IDENTITY, (0,) * 3)]), "s.ske")

        self.assertEqual(0, skeleton.index("Bip01_Spine3"))

    def test_trailing_space_in_a_stored_name_still_matches(self) -> None:
        # The K98 and No4 skeletons both store the scope bone as "SIKTE     ".
        skeleton = ske.parse(pack_ske([("SIKTE     ", -1, IDENTITY, (0,) * 3)]), "s.ske")

        self.assertEqual(0, skeleton.index("SIKTE"))

    def test_unknown_bone_is_none(self) -> None:
        skeleton = ske.parse(pack_ske([("base", -1, IDENTITY, (0,) * 3)]), "s.ske")

        self.assertIsNone(skeleton.index("nosuchbone"))


class MainBoneTests(unittest.TestCase):
    def _skeleton(self, *names: str) -> ske.Skeleton:
        bones = [(names[0], -1, IDENTITY, (0.0, 0.0, 0.0))]
        bones += [(n, 0, IDENTITY, (0.0, 0.0, 0.0)) for n in names[1:]]
        return ske.parse(pack_ske(bones), "s.ske")

    def test_declared_name_wins_when_it_exists(self) -> None:
        skeleton = self._skeleton("Bip01 R Hand", "Bazooka", "trigger")

        self.assertEqual(1, skeleton.main_index("Bazooka"))

    def test_falls_back_to_the_base_prefixed_form(self) -> None:
        """`useSkeletonPartAsMain K98` against a bone actually called `BaseK98`."""
        skeleton = self._skeleton("Bip01 R Hand", "BaseK98", "Trigger")

        self.assertEqual(1, skeleton.main_index("K98"))

    def test_falls_back_to_the_first_non_root_bone(self) -> None:
        """The RepairPack asks for `base` against an untouched `Object01`."""
        skeleton = self._skeleton("Bip01 R Hand", "Object01")

        self.assertEqual(1, skeleton.main_index("base"))

    def test_later_candidates_are_tried_in_order(self) -> None:
        skeleton = self._skeleton("Bip01 R Hand", "deto_base_m1", "hand")

        self.assertEqual(1, skeleton.main_index(None, "deto_base_m1"))

    def test_a_geometry_path_is_reduced_to_its_basename(self) -> None:
        skeleton = self._skeleton("Bip01 R Hand", "BritBody")

        self.assertEqual(1, skeleton.main_index("Soldier/BritBody"))


if __name__ == "__main__":
    unittest.main()
