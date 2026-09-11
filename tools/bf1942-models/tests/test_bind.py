"""Placing a `bindToSkeletonPart` child from the skeleton's bind pose."""

from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import ske  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_ske(bones: list[tuple[str, int, tuple]]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(bones))
    for name, parent, translation in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw)) + raw
        out += struct.pack("<h", parent)
        for row in range(3):
            out += struct.pack("<3f", *IDENTITY[row])
            out += struct.pack("<f", translation[row])
    return bytes(out)


WEAPON_SKELETON = ske.parse(pack_ske([
    ("Bip01 R Hand", -1, (0.305, 0.0, 0.0)),
    ("base", 0, (0.07, 0.03, 0.0)),
    ("mag", 1, (0.0, -0.07, 0.055)),
]), "weapon.ske")


def assembler(library: ObjectLibrary) -> Assembler:
    return Assembler(ArchivePool(), ArchivePool(), ArchivePool(), library)


class RigidPartTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/HandWeapons/Test/Objects.con", """
ObjectTemplate.create AnimatedBundle TestComplex
ObjectTemplate.geometry TestBody
ObjectTemplate.createSkeleton animations/Test.ske
ObjectTemplate.addTemplate TestMag
ObjectTemplate.bindToSkeletonPart mag

ObjectTemplate.create SimpleObject TestMag
ObjectTemplate.geometry TestMagGeom
""")
        self.library.add_con("Objects/HandWeapons/Test/Geometries.con", """
GeometryTemplate.create StandardMesh TestMagGeom
GeometryTemplate.file Gunmag_m1
""")

    def test_a_rigid_sub_part_is_placed_at_the_bone(self) -> None:
        report = Report("Test", "complex", 0)
        ref = self.library.object("TestComplex").children[0]

        bind = assembler(self.library)._bind_pose(
            ref, "TestMag", WEAPON_SKELETON, WEAPON_SKELETON.index("base"), report)

        self.assertIsNotNone(bind)
        _, translation, bone = bind
        self.assertEqual("mag", bone)
        # The bone's own local offset, Z mirrored into mesh space; the hand and
        # body offsets above it cancel against the main bone.
        for got, want in zip(translation, (0.0, -0.07, -0.055)):
            self.assertAlmostEqual(want, got, places=6)

    def test_an_unknown_bone_is_recorded_rather_than_guessed(self) -> None:
        report = Report("Test", "complex", 0)
        ref = self.library.object("TestComplex").children[0]
        ref.skeleton_part = "nosuchbone"

        bind = assembler(self.library)._bind_pose(
            ref, "TestMag", WEAPON_SKELETON, 1, report)

        self.assertIsNone(bind)
        self.assertIn("no such bone", report.bound_parts[0])

    def test_a_missing_skeleton_leaves_the_child_where_it_was(self) -> None:
        report = Report("Test", "complex", 0)
        ref = self.library.object("TestComplex").children[0]

        bind = assembler(self.library)._bind_pose(ref, "TestMag", None, None, report)

        self.assertIsNone(bind)
        self.assertIn("no skeleton in scope", report.bound_parts[0])

    def test_an_unbound_child_is_not_touched_at_all(self) -> None:
        report = Report("Test", "complex", 0)
        ref = self.library.object("TestComplex").children[0]
        ref.skeleton_part = None

        bind = assembler(self.library)._bind_pose(ref, "TestMag", WEAPON_SKELETON, 1, report)

        self.assertIsNone(bind)
        self.assertEqual([], report.bound_parts)


class SkinnedPartTests(unittest.TestCase):
    """A mesh with its own `.skn` is already in the skeleton's bind world space.

    Every soldier binds its `ComplexHead` to `Bip01_Spine3` while the head's
    vertices already sit on the neck. Applying the bone as well would throw the
    head up a whole spine's worth of bone chain.
    """

    def setUp(self) -> None:
        self.library = ObjectLibrary()
        self.library.add_con("Objects/Soldiers/Test/Objects.con", """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.createSkeleton animations/TestSoldier.ske
ObjectTemplate.addTemplate TestHead
ObjectTemplate.bindToSkeletonPart Bip01_Spine3

ObjectTemplate.create AnimatedBundle TestHead
ObjectTemplate.geometry Soldier/TestFace
""")
        self.library.add_con("Objects/Soldiers/Test/Geometries.con", """
GeometryTemplate.create AnimatedMesh Soldier/TestFace
GeometryTemplate.setSkin animations/TestFace.skn
GeometryTemplate.file TestFace
""")

    def test_a_skinned_child_is_left_at_the_origin(self) -> None:
        skeleton = ske.parse(pack_ske([
            ("Bip01", -1, (0.0, 0.0, -0.93)),
            ("Bip01 Spine3", 0, (0.0, 0.15, -0.46)),
        ]), "soldier.ske")
        report = Report("TestSoldier", "complex", 0)
        ref = self.library.object("TestSoldier").children[0]

        bind = assembler(self.library)._bind_pose(
            ref, "TestHead", skeleton, 0, report)

        self.assertIsNone(bind)
        self.assertIn("skinned", report.bound_parts[0])

    def test_the_skin_declaration_decides_even_when_the_file_is_absent(self) -> None:
        """The `.skn` is never read here; the declaration is the structural fact."""
        report = Report("TestSoldier", "complex", 0)
        ref = self.library.object("TestSoldier").children[0]

        bind = assembler(self.library)._bind_pose(
            ref, "TestHead", WEAPON_SKELETON, 1, report)

        self.assertIsNone(bind)


if __name__ == "__main__":
    unittest.main()
