from __future__ import annotations

import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, skin  # noqa: E402


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


def apply_bind(rotation, translation, offset):
    return (
        rotation[0][0] * offset[0] + rotation[0][1] * offset[1] + rotation[0][2] * offset[2] + translation[0],
        rotation[1][0] * offset[0] + rotation[1][1] * offset[1] + rotation[1][2] * offset[2] + translation[1],
        rotation[2][0] * offset[0] + rotation[2][1] * offset[1] + rotation[2][2] * offset[2] + translation[2],
    )


def rotate_quat(quat, point):
    x, y, z, w = quat
    ux, uy, uz = (
        y * point[2] - z * point[1],
        z * point[0] - x * point[2],
        x * point[1] - y * point[0],
    )
    vx, vy, vz = (
        y * uz - z * uy,
        z * ux - x * uz,
        x * uy - y * ux,
    )
    return (
        point[0] + 2.0 * (w * ux + vx),
        point[1] + 2.0 * (w * uy + vy),
        point[2] + 2.0 * (w * uz + vz),
    )


class SkinParseTests(unittest.TestCase):
    def test_roundtrip_unique_verts_and_bone_names(self) -> None:
        payload = pack_skn(
            [
                ((1.0, 2.0, 3.0), [(0, 1.0, (0.1, 0.0, 0.0))]),
                ((4.0, 5.0, 6.0), [(0, 0.5, (0.2, 0.0, 0.0)), (1, 0.5, (0.0, 0.3, 0.0))]),
            ],
            ["Bip01 L Forearm", "Bip01 L Hand"],
        )
        parsed = skin.parse(payload, "test.skn")
        self.assertEqual(["Bip01 L Forearm", "Bip01 L Hand"], parsed.bones)
        self.assertEqual((1.0, 2.0, 3.0), parsed.vertices[0].rest)
        self.assertEqual(0, parsed.vertices[0].influences[0].bone)
        self.assertEqual(0.5, parsed.vertices[1].influences[1].weight)


class BindPoseTests(unittest.TestCase):
    def test_recovers_known_rigid_bind(self) -> None:
        rotation = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        translation = (0.2, -0.4, 1.1)
        offsets = [(0.0, 0.0, 0.0), (0.1, 0.0, 0.0), (0.0, 0.08, 0.0), (0.0, 0.0, 0.05)]
        verts = []
        for offset in offsets:
            verts.append((apply_bind(rotation, translation, offset), [(0, 1.0, offset)]))
        parsed = skin.parse(pack_skn(verts, ["Bip01 L Forearm"]), "arm.skn")
        recovered = skin.recover_bind(skin.exclusive_pairs(parsed, "Bip01 L Forearm"))
        self.assertIsNotNone(recovered)
        got_r, got_t = recovered
        for i in range(3):
            self.assertAlmostEqual(translation[i], got_t[i], places=5)
            for j in range(3):
                self.assertAlmostEqual(rotation[i][j], got_r[i][j], places=5)

    def test_alignment_maps_source_space_onto_target_bone(self) -> None:
        source_r = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        source_t = (0.1, 0.2, 0.8)
        target_r = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        target_t = (0.16, 0.23, 1.22)
        offsets = [(0.0, 0.0, 0.0), (0.04, 0.0, 0.0), (0.0, 0.03, 0.0), (0.0, 0.0, 0.02)]

        def make(rotation, translation, bones):
            verts = [
                (apply_bind(rotation, translation, offset), [(0, 1.0, offset)])
                for offset in offsets
            ]
            return skin.parse(pack_skn(verts, bones), "x.skn")

        source = make(source_r, source_t, ["Bip01 L Forearm"])
        target = make(target_r, target_t, ["Bip01 L Forearm"])
        aligned = skin.alignment(source, target)
        self.assertIsNotNone(aligned)
        r_rel, t_rel, bone = aligned
        self.assertEqual("Bip01 L Forearm", bone)
        sample = apply_bind(source_r, source_t, (0.04, 0.03, 0.02))
        mapped = apply_bind(r_rel, t_rel, sample)
        expected = apply_bind(target_r, target_t, (0.04, 0.03, 0.02))
        for a, b in zip(mapped, expected):
            self.assertAlmostEqual(a, b, places=5)

    def test_alignment_prefers_forearm_over_hand(self) -> None:
        identity = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        offsets = [(0.0, 0.0, 0.0), (0.1, 0.0, 0.0), (0.0, 0.1, 0.0), (0.0, 0.0, 0.1)]

        def mesh(t_hand, t_arm, names, r_hand=identity):
            verts = []
            for offset in offsets:
                verts.append((apply_bind(identity, t_arm, offset), [(1, 1.0, offset)]))
            for offset in offsets:
                verts.append((apply_bind(r_hand, t_hand, offset), [(0, 1.0, offset)]))
            return skin.parse(pack_skn(verts, names), "x.skn")

        source = mesh((0.0, 0.0, 0.0), (0.0, 0.0, 0.5), ["Bip01 L Hand", "Bip01 L Forearm"])
        target = mesh((1.0, 0.0, 0.0), (1.0, 0.0, 0.5), ["Bip01 L Hand", "Bip01 L Forearm"])
        aligned = skin.alignment(source, target)
        self.assertEqual("Bip01 L Forearm", aligned[2])

    def test_cocked_wrist_swings_onto_the_sleeve_axis(self) -> None:
        identity = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        # 140 deg about Z: the left supporting-hand bind.
        rad = math.radians(140.0)
        cocked = (
            (math.cos(rad), -math.sin(rad), 0.0),
            (math.sin(rad), math.cos(rad), 0.0),
            (0.0, 0.0, 1.0),
        )
        offsets = [(0.0, 0.0, 0.0), (0.05, 0.0, 0.0), (0.0, 0.04, 0.0), (0.0, 0.0, 0.03)]

        def make(rotation, translation, names):
            verts = [
                (apply_bind(rotation, translation, offset), [(0, 1.0, offset)])
                for offset in offsets
            ]
            return verts

        verts = make(identity, (0.0, 0.0, 0.0), None)
        verts += [
            (apply_bind(cocked, (0.3, 0.0, 0.0), offset), [(1, 1.0, offset)])
            for offset in offsets
        ]
        source = skin.parse(pack_skn(verts, ["Bip01 L Forearm", "Bip01 L Hand"]), "hand.skn")
        target = skin.parse(
            pack_skn(make(identity, (1.0, 2.0, 3.0), None), ["Bip01 L Forearm"]),
            "body.skn",
        )
        aligned = skin.alignment(source, target)
        r_rel, t_rel, bone = aligned
        self.assertEqual("Bip01 L Forearm", bone)
        source_poses = skin.bind_poses(source)
        mapped_hand_r = tuple(
            tuple(sum(r_rel[i][k] * source_poses["Bip01 L Hand"][0][k][j] for k in range(3))
                  for j in range(3))
            for i in range(3)
        )
        # Hand +X should now match the target forearm +X (the sleeve).
        self.assertAlmostEqual(1.0, mapped_hand_r[0][0], places=5)
        self.assertAlmostEqual(0.0, mapped_hand_r[1][0], places=5)
        # Wrist stays at forearm origin + length along +X.
        hx, hy, hz = source_poses["Bip01 L Hand"][1]
        wrist = apply_bind(r_rel, t_rel, (hx, hy, hz))
        self.assertAlmostEqual(1.3, wrist[0], places=4)
        self.assertAlmostEqual(2.0, wrist[1], places=4)
        self.assertAlmostEqual(3.0, wrist[2], places=4)


class QuatMatrixTests(unittest.TestCase):
    def test_rotation_between_sends_one_axis_onto_another(self) -> None:
        r = skin.rotation_between((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
        mapped = apply_bind(r, (0.0, 0.0, 0.0), (1.0, 0.0, 0.0))
        self.assertAlmostEqual(0.0, mapped[0], places=5)
        self.assertAlmostEqual(1.0, mapped[1], places=5)
        self.assertAlmostEqual(0.0, mapped[2], places=5)

    def test_identity_matrix_is_identity_quat(self) -> None:
        q = gltf.quat_from_matrix(((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))
        self.assertAlmostEqual(0.0, q[0])
        self.assertAlmostEqual(0.0, q[1])
        self.assertAlmostEqual(0.0, q[2])
        self.assertAlmostEqual(1.0, q[3])

    def test_z_mirror_conjugates_a_pitch(self) -> None:
        # 90 deg about X: (0,0,1) -> (0,-1,0) in Refractor. After the exporter
        # mirrors Z, rotating the mirrored point with the glTF quat must match.
        rotation = ((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0))
        point = (0.0, 0.0, 1.0)
        rotated = apply_bind(rotation, (0.0, 0.0, 0.0), point)
        mirrored_out = (rotated[0], rotated[1], -rotated[2])
        quat = gltf.quat_from_matrix(rotation)
        mirrored_in = (point[0], point[1], -point[2])
        via_gltf = rotate_quat(quat, mirrored_in)
        for a, b in zip(mirrored_out, via_gltf):
            self.assertAlmostEqual(a, b, places=5)
        self.assertTrue(math.isfinite(sum(quat)))


if __name__ == "__main__":
    unittest.main()
