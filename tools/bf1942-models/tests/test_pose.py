from __future__ import annotations

import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import pose, ske, skin  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_ske(bones: list[tuple[str, int, tuple, tuple]]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(bones))
    for name, parent, rotation, translation in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
        out += struct.pack("<h", parent)
        for row in range(3):
            out += struct.pack("<3f", *rotation[row])
            out += struct.pack("<f", translation[row])
    return bytes(out)


def pack_skn(vertices: list[tuple], bones: list[str]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(vertices))
    for rest, influences in vertices:
        out += struct.pack("<3f", *rest)
        out.append(len(influences))
        for bone, weight, offset in influences:
            out += struct.pack("<H", bone)
            out += struct.pack("<f", weight)
            out += struct.pack("<3f", *offset)
    out += struct.pack("<H", len(bones))
    for name in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
    return bytes(out)


def exclusive_cluster(bone: int, origin: tuple[float, float, float]) -> list[tuple]:
    """Four exclusively-weighted vertices spanning 3D so the bind recovers
    exactly: rest = origin + offset with an identity bind rotation."""
    verts = []
    for offset in ((0.0, 0.0, 0.0), (0.05, 0.0, 0.0),
                   (0.0, 0.05, 0.0), (0.0, 0.0, 0.05)):
        rest = tuple(o + d for o, d in zip(origin, offset))
        verts.append((rest, [(bone, 1.0, offset)]))
    return verts


class AlignClipRootsTests(unittest.TestCase):
    """Only a skeleton root's local transform is expressed in clip world,
    so only it picks up the clip world's 180-degree yaw."""

    def _skeleton(self) -> ske.Skeleton:
        return ske.parse(pack_ske([
            ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
            ("Bip01 Spine", 0, IDENTITY, (0.1, 0.0, 0.0)),
        ]), "s.ske")

    def test_root_local_is_left_multiplied_by_the_yaw(self) -> None:
        locals_map = {"bip01": (IDENTITY, (1.0, 2.0, 3.0)),
                      "bip01 spine": (IDENTITY, (0.5, 0.0, 0.0))}

        aligned = pose.align_clip_roots(self._skeleton(), locals_map)

        self.assertEqual((-1.0, 2.0, -3.0), aligned["bip01"][1])
        self.assertEqual((0.5, 0.0, 0.0), aligned["bip01 spine"][1])

    def test_a_root_at_ske_rest_is_left_alone(self) -> None:
        # No clip track for the root: its rest local is already mesh space.
        locals_map = {"bip01 spine": (IDENTITY, (0.5, 0.0, 0.0))}

        aligned = pose.align_clip_roots(self._skeleton(), locals_map)

        self.assertNotIn("bip01", aligned)


class RemapCollisionTests(unittest.TestCase):
    """`Bone07..09` name both face bones in the skins and a forearm helper
    chain in `UsSoldier.ske`. A name match must also reproduce its `.ske`
    chain distance before it may drive vertices."""

    def _skeleton(self) -> ske.Skeleton:
        return ske.parse(pack_ske([
            ("Bip01 Spine3", -1, IDENTITY, (0.0, 0.0, 1.38)),
            ("Bip01 Head", 0, IDENTITY, (0.0, 0.0, 0.17)),
            ("Bip01 L Forearm", 0, IDENTITY, (0.0, 0.55, -0.10)),
            ("Bone07", 2, IDENTITY, (0.0, 0.05, 0.0)),
            ("Bone08", 3, IDENTITY, (0.0, 0.10, 0.0)),
        ]), "UsSoldier.ske")

    def _face_skin(self) -> skin.Skin:
        # Head, Spine3 and the "Bone07/08" face bones all cluster around the
        # skull, 1.5 m up - nowhere near the skeleton's forearm chain.
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))       # Bip01 Head
                 + exclusive_cluster(1, (0.0, 0.0, 1.38))     # Bip01 Spine3
                 + exclusive_cluster(2, (0.0, 0.10, 1.62))    # Bone07: face
                 + exclusive_cluster(3, (0.0, 0.12, 1.66)))   # Bone08: face
        return skin.parse(pack_skn(
            verts, ["Bip01 Head", "Bip01 Spine3", "Bone07", "Bone08"]), "face")

    def test_a_true_bone_keeps_driving_itself(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        self.assertEqual("Bip01 Head", anchor)
        # Head to Spine3: 0.17 in the skeleton, 0.17 in the skin - kept.
        self.assertEqual("Bip01 Head", mapped[0])
        self.assertEqual("Bip01 Spine3", mapped[1])

    def test_a_colliding_name_anchors_instead(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        # Skin Bone07 sits 0.24 from Spine3; skeleton Bone07 sits 0.68 away
        # through the forearm. Not the same bone.
        self.assertEqual(anchor, mapped[2])

    def test_the_failure_spreads_down_the_misnamed_chain(self) -> None:
        skn = self._face_skin()
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        # Bone08's nearest tested ancestor is Bone07, which failed.
        self.assertEqual(anchor, mapped[3])

    def test_an_unrecoverable_bind_anchors(self) -> None:
        # Two exclusive vertices cannot pin a bind; both skinning paths need
        # the bind to use the bone, so it must ride the anchor.
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))
                 + [((0.0, 0.12, 1.66), [(1, 1.0, (0.0, 0.0, 0.0))]),
                    ((0.0, 0.13, 1.66), [(1, 1.0, (0.01, 0.0, 0.0))])])
        skn = skin.parse(pack_skn(verts, ["Bip01 Head", "Bone08"]), "sparse")
        binds = pose.refine_binds(skn)

        mapped, anchor = pose.remap_influences(skn, self._skeleton(), binds)

        self.assertEqual("Bip01 Head", anchor)
        self.assertEqual(anchor, mapped[1])

    def test_a_mirrored_skin_still_matches_by_bone_length(self) -> None:
        """The right-hand skins are X-mirrored against the skeleton as files.
        Distances are mirror-invariant, so the check must not flag them."""
        skeleton = ske.parse(pack_ske([
            ("Bip01 R Forearm", -1, IDENTITY, (0.30, 0.21, 1.21)),
            ("Bip01 R Hand", 0, IDENTITY, (0.0, 0.26, 0.06)),
        ]), "UsSoldier.ske")
        verts = (exclusive_cluster(0, (-0.30, 0.21, 1.21))
                 + exclusive_cluster(1, (-0.30, 0.47, 1.27)))
        skn = skin.parse(pack_skn(
            verts, ["Bip01 R Forearm", "Bip01 R Hand"]), "hand")
        binds = pose.refine_binds(skn)

        mapped, _ = pose.remap_influences(skn, skeleton, binds)

        self.assertEqual(["Bip01 R Forearm", "Bip01 R Hand"], mapped)


class RestReconstructionTests(unittest.TestCase):
    def test_posing_at_the_skins_own_binds_reproduces_the_mesh(self) -> None:
        """With no animation applied - joints at the skin's recovered binds -
        linear-blend skinning must return every rest position exactly. This
        is the identity that pins the whole pipeline; posing at the `.ske`
        rest instead re-poses the part into the skeleton's stance, and the
        displacement that produces is the stance delta, not an error."""
        skeleton = ske.parse(pack_ske([
            ("Bip01 Spine3", -1, IDENTITY, (0.0, 0.0, 1.38)),
            ("Bip01 Head", 0, IDENTITY, (0.0, 0.0, 0.17)),
        ]), "s.ske")
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.38))
                 + exclusive_cluster(1, (0.0, 0.0, 1.60))
                 + [((0.0, 0.0, 1.50),
                     [(0, 0.5, (0.0, 0.0, 0.12)), (1, 0.5, (0.0, 0.0, -0.10))])])
        skn = skin.parse(pack_skn(verts, ["Bip01 Spine3", "Bip01 Head"]), "part")
        binds = pose.refine_binds(skn)
        bone_map, _ = pose.remap_influences(skn, skeleton, binds)
        posed = {ske.canonical(name): bind for name, bind in binds.items()}

        baked = pose.skinned_positions(skn, posed, bone_map, binds)

        for vertex, got in zip(skn.vertices, baked):
            self.assertIsNotNone(got)
            self.assertLess(math.dist(got, vertex.rest), 1e-6)

    def test_anchored_vertices_ride_the_anchor_rigidly(self) -> None:
        skeleton = ske.parse(pack_ske([
            ("Bip01 Head", -1, IDENTITY, (0.0, 0.0, 1.55)),
        ]), "s.ske")
        verts = (exclusive_cluster(0, (0.0, 0.0, 1.55))
                 + exclusive_cluster(1, (0.0, 0.10, 1.62)))  # face bone
        skn = skin.parse(pack_skn(verts, ["Bip01 Head", "bon-eye-left"]), "face")
        binds = pose.refine_binds(skn)
        bone_map, anchor = pose.remap_influences(skn, skeleton, binds)
        self.assertEqual([anchor, anchor], [bone_map[0], bone_map[1]])
        # Move the head 0.2 up: every vertex, eye included, moves with it.
        rotation, translation = binds["Bip01 Head"]
        posed = {"bip01 head": (rotation,
                                (translation[0], translation[1],
                                 translation[2] + 0.2))}

        baked = pose.skinned_positions(skn, posed, bone_map, binds)

        for vertex, got in zip(skn.vertices, baked):
            want = (vertex.rest[0], vertex.rest[1], vertex.rest[2] + 0.2)
            self.assertLess(math.dist(got, want), 1e-6)


if __name__ == "__main__":
    unittest.main()
