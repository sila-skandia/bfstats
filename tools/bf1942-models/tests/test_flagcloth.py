"""`bf42/flagcloth.py` and `patch_flag_cloth.py`: a flag cloth as the engine draws it.

The `.sm` and `.skn` of every flag are an authoring pose, a sheet centred on its
origin with the image's top row at the bottom. The skeleton's root bone is
turned half a turn, so posed, the hoist sits at the bone's origin, the sheet
runs out along +x and hangs below it. 1,374 flags on vehicles and statics were
exported as the authored sheet, upside down, until 2026-10-10.
"""

from __future__ import annotations

import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import flagcloth, glbopt, pose, ske, skin  # noqa: E402
import patch_flag_cloth  # noqa: E402

FLIP_X = ((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, -1.0))
IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def rig():
    """A two-column, two-row cloth in flag.skn's shape: Bone01 is the hoist's
    top, turned half a turn about x; Bone02 chains 0.5 m along its +x; Bone03
    hangs 0.4 m along its own +y (so below, once the root is turned)."""
    skeleton = ske.Skeleton(bones=[
        ske.Bone("Bone01", -1, FLIP_X, (0.0, 0.0, 0.0)),
        ske.Bone("Bone02", 0, IDENTITY, (0.5, 0.0, 0.0)),
        ske.Bone("Bone03", 0, IDENTITY, (0.0, 0.4, 0.0)),
        ske.Bone("Bone04", 2, IDENTITY, (0.5, 0.0, 0.0)),
    ])
    # The authored pose: hoist at +x, image top row at -y (V rises with y).
    rests = [(1.0, -0.2, 0.0), (0.5, -0.2, 0.0), (1.0, 0.2, 0.0), (0.5, 0.2, 0.0)]
    cloth = skin.Skin(
        vertices=[skin.SkinVertex(rest, (skin.Influence(i, 1.0, (0.0, 0.0, 0.0)),))
                  for i, rest in enumerate(rests)],
        bones=["Bone01", "Bone02", "Bone03", "Bone04"])
    return skeleton, cloth, rests


class PoseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.skeleton, self.skn, self.rests = rig()
        self.worlds = pose.worlds_by_name(
            self.skeleton, pose.posed_worlds(self.skeleton, {}))

    def test_the_hoist_is_at_the_origin_and_the_cloth_hangs_below_it(self) -> None:
        points, _ = flagcloth.pose_points(self.rests, None, self.skn, self.worlds)
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        self.assertAlmostEqual(0.0, min(xs), places=6)
        self.assertGreater(max(xs), 0.4)
        # The first bone is the top row; every other row is below it.
        self.assertAlmostEqual(0.0, points[0][1], places=6)
        self.assertLessEqual(max(ys), 1e-9)
        self.assertLess(points[2][1], points[0][1])

    def test_normals_turn_with_their_bones(self) -> None:
        _, normals = flagcloth.pose_points(
            self.rests, [(0.0, 0.0, 1.0)] * 4, self.skn, self.worlds)
        self.assertAlmostEqual(-1.0, normals[0][2], places=6)
        for n in normals:
            self.assertAlmostEqual(1.0, math.sqrt(sum(c * c for c in n)), places=6)

    def test_a_cloth_already_posed_is_not_posed_again(self) -> None:
        posed, _ = flagcloth.pose_points(self.rests, None, self.skn, self.worlds)
        self.assertIsNone(flagcloth.pose_points(
            posed, None, self.skn, self.worlds, exact=0.002))
        self.assertIsNotNone(flagcloth.pose_points(
            self.rests, None, self.skn, self.worlds, exact=0.002))

    def test_only_the_flag_skin_is_a_flag(self) -> None:
        self.assertTrue(flagcloth.is_flag_skin("animations/flag.skn"))
        self.assertTrue(flagcloth.is_flag_skin("Animations\\Flag.skn"))
        self.assertFalse(flagcloth.is_flag_skin("animations/Parachute.skn"))
        self.assertFalse(flagcloth.is_flag_skin(None))


def glb_with_flag(positions, normals) -> bytes:
    """A one-mesh glb the way the exporter writes a flag node: a Z-mirrored
    POSITION and NORMAL accessor, the skin named in the node's extras."""
    blob = bytearray()
    for x, y, z in positions:
        blob += struct.pack("<3f", x, y, -z)
    split = len(blob)
    for x, y, z in normals:
        blob += struct.pack("<3f", x, y, -z)
    doc = {
        "asset": {"version": "2.0"},
        "nodes": [{"name": "AnimatedUsFlag", "mesh": 0,
                   "extras": {"templateKind": "AnimatedBundle",
                              "skin": "animations/flag.skn"}}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(positions),
             "type": "VEC3", "min": [0, 0, 0], "max": [0, 0, 0]},
            {"bufferView": 1, "componentType": 5126, "count": len(normals),
             "type": "VEC3"},
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": split},
                        {"buffer": 0, "byteOffset": split,
                         "byteLength": len(blob) - split}],
        "buffers": [{"byteLength": len(blob)}],
    }
    return glbopt.write_glb(doc, bytes(blob))


class PatchTests(unittest.TestCase):
    def setUp(self) -> None:
        skeleton, self.skn, self.rests = rig()
        self.worlds = pose.worlds_by_name(
            skeleton, pose.posed_worlds(skeleton, {}))
        self.glb = glb_with_flag(self.rests, [(0.0, 0.0, 1.0)] * 4)

    def read_positions(self, data: bytes):
        doc, blob = glbopt.read_glb(data)
        view = doc["bufferViews"][0]
        return [(x, y, -z) for x, y, z in (
            struct.unpack_from("<3f", blob, view["byteOffset"] + 12 * i)
            for i in range(4))], doc

    def test_the_glb_is_posed_in_place_and_its_bounds_follow(self) -> None:
        patched, count = patch_flag_cloth.patch_bytes(self.glb, self.skn, self.worlds)
        self.assertEqual(1, count)
        positions, doc = self.read_positions(patched)
        expect, _ = flagcloth.pose_points(self.rests, None, self.skn, self.worlds)
        for got, want in zip(positions, expect):
            for a, b in zip(got, want):
                self.assertAlmostEqual(b, a, places=5)
        accessor = doc["accessors"][0]
        # glTF is Z-mirrored, so the accessor's own bounds are in that frame.
        self.assertAlmostEqual(min(p[0] for p in expect), accessor["min"][0], places=5)
        self.assertAlmostEqual(min(p[1] for p in expect), accessor["min"][1], places=5)

    def test_a_second_run_changes_nothing(self) -> None:
        patched, _ = patch_flag_cloth.patch_bytes(self.glb, self.skn, self.worlds)
        again, count = patch_flag_cloth.patch_bytes(patched, self.skn, self.worlds)
        self.assertIsNone(again)
        self.assertEqual(0, count)

    def test_a_glb_without_a_flag_is_left_alone(self) -> None:
        doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "Tank"}]}
        plain = glbopt.write_glb(doc, b"")
        self.assertEqual((None, 0),
                         patch_flag_cloth.patch_bytes(plain, self.skn, self.worlds))


if __name__ == "__main__":
    unittest.main()
