from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import stdmesh  # noqa: E402


def material_lod(name: str, scale: float, *, flags: int = stdmesh.VF_STANDARD,
                 stride: int = 32, vertices: list[float] | None = None) -> bytes:
    encoded_name = name.encode("latin-1")
    descriptor = (
        struct.pack("<I", len(encoded_name))
        + encoded_name
        + struct.pack(
            "<9I",
            0,
            0,
            0,
            stdmesh.PRIM_TRIANGLE_LIST,
            flags,
            stride,
            3,
            3,
            0,
        )
    )
    if vertices is None:
        vertices = [
            0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0,
            scale, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0,
            0.0, scale, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
        ]
    assert len(vertices) * 4 == 3 * stride, "payload must be stride * 3 bytes"
    return (
        struct.pack("<I", 1)
        + descriptor
        + struct.pack(f"<{len(vertices)}f", *vertices)
        + struct.pack("<3h", 0, 1, 2)
    )


def collision_layer() -> bytes:
    payload = bytearray(struct.pack("<3I", 0xEB97C3BA, 5, 4))
    payload += struct.pack(
        "<16f",
        -1.0, 0.0, -1.0, 1.0,
        1.0, 0.0, -1.0, 1.0,
        1.0, 0.0, 1.0, 1.0,
        -1.0, 0.0, 1.0, 1.0,
    )
    payload += struct.pack("<I", 2)
    payload += struct.pack("<3hBB", 0, 1, 2, 50, 0)
    payload += struct.pack("<3hBB", 0, 2, 3, 52, 4)
    payload += b"acceleration-data"
    return struct.pack("<I", len(payload)) + payload


def standard_mesh_fixture(version: int = 10) -> bytes:
    data = bytearray()
    data += struct.pack("<II", version, 0)
    data += struct.pack("<3f", -1.0, -1.0, -1.0)
    data += struct.pack("<3f", 1.0, 1.0, 1.0)
    if version > 9:
        data += struct.pack("<B", 0)  # qflag: version 10 only
    data += struct.pack("<I", 1)
    data += collision_layer()
    data += struct.pack("<I", 2)
    data += material_lod("Test_Material0", 1.0)
    data += material_lod("Test_Material0", 0.5)
    return bytes(data)


class StandardMeshTests(unittest.TestCase):
    def test_parses_collision_count_and_all_lods(self) -> None:
        mesh = stdmesh.parse(standard_mesh_fixture(), "test.sm")

        self.assertEqual(10, mesh.version)
        self.assertEqual(1, mesh.collision_blocks)
        self.assertEqual(2, len(mesh.lods))
        self.assertEqual(1, mesh.lods[0].triangle_count)
        self.assertEqual(1, mesh.lods[1].triangle_count)

    def test_reads_collision_vertices_faces_materials_and_flags(self) -> None:
        layer = stdmesh.parse(standard_mesh_fixture()).collision_layers[0]

        self.assertEqual(4, len(layer.vertices))
        self.assertEqual(2, layer.triangle_count)
        self.assertEqual((-1.0, 0.0, -1.0), layer.vertices[0])
        self.assertEqual((0, 2, 3), layer.faces[1].vertices)
        self.assertEqual(52, layer.faces[1].material_id)
        self.assertEqual(4, layer.faces[1].flags)

    def test_reads_positions_normals_uvs_and_indices(self) -> None:
        material = stdmesh.parse(standard_mesh_fixture()).lods[1].materials[0]

        self.assertEqual((0, 1, 2), material.triangles()[0])
        self.assertEqual((0.5, 0.0, 0.0), material.positions()[1])
        self.assertEqual((0.0, 1.0, 0.0), material.normals()[1])
        self.assertEqual((1.0, 0.0), material.uvs()[1])

    def test_triangle_strip_alternates_winding_and_drops_degenerates(self) -> None:
        strip = stdmesh.Material(
            name="strip",
            primitive=stdmesh.PRIM_TRIANGLE_STRIP,
            flags=0,
            stride=32,
            vertex_count=4,
            index_count=4,
            unknown=(0, 0, 0, 0),
            indices=[0, 1, 2, 3],
        )
        degenerate = stdmesh.Material(
            name="degen",
            primitive=stdmesh.PRIM_TRIANGLE_STRIP,
            flags=0,
            stride=32,
            vertex_count=3,
            index_count=4,
            unknown=(0, 0, 0, 0),
            indices=[0, 1, 1, 2],
        )

        self.assertEqual([(0, 1, 2), (1, 3, 2)], strip.triangles())
        self.assertEqual([], degenerate.triangles())

    def test_lightmapped_format_exposes_second_uv_set(self) -> None:
        material = stdmesh.Material(
            name="lm",
            primitive=stdmesh.PRIM_TRIANGLE_LIST,
            flags=stdmesh.VF_LIGHTMAPPED,
            stride=40,
            vertex_count=1,
            index_count=0,
            unknown=(0, 0, 0, 0),
            vertices=[0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.25, 0.5, 0.1, 0.9],
        )

        self.assertTrue(material.stride_matches_flags)
        self.assertEqual((0.25, 0.5), material.uvs()[0])
        self.assertEqual((0.1, 0.9), material.uvs2()[0])
        self.assertIsNone(stdmesh.parse(standard_mesh_fixture()).lod0.materials[0].uvs2())

    def test_engine_stride_matches_rend_getStride(self) -> None:
        # Values read out of rend::getStride (client 0x00640f20, lnxded 0x084451d0).
        self.assertEqual(32, stdmesh.engine_stride(stdmesh.VF_STANDARD))
        self.assertEqual(40, stdmesh.engine_stride(stdmesh.VF_LIGHTMAPPED))
        self.assertEqual(0, stdmesh.engine_stride(0))
        # position + normal + diffuse + specular + uv0 with one float
        self.assertEqual(36, stdmesh.engine_stride(0x1 | 0x10 | 0x40 | 0x100 | 0x200))
        # position + 2 blend weights + normal + uv0(3f) + uv1(4f) + uv2(1f) + uv3(4f)
        self.assertEqual(
            80, stdmesh.engine_stride(0x1 | 0x400000 | 0x10 | 0x800 | 0x4000000 | 0x8000 | 0x10000000))

    def test_layout_is_direct3d_fvf_order(self) -> None:
        names = [(c.name, c.offset, c.size) for c in stdmesh.vertex_layout(stdmesh.VF_LIGHTMAPPED)]
        self.assertEqual(
            [("position", 0, 12), ("normal", 12, 12), ("uv0", 24, 8), ("uv1", 32, 8)], names)
        names = [c.name for c in stdmesh.vertex_layout(
            0x1 | 0x400000 | 0x10 | 0x40 | 0x100 | 0x800 | 0x4000000 | 0x8000 | 0x10000000)]
        self.assertEqual(
            ["position", "blend_weights", "normal", "diffuse", "specular", "uv0", "uv1", "uv2", "uv3"],
            names)

    def test_flags_decide_the_layout_and_stride_only_sizes_the_read(self) -> None:
        # bf1918 o_WoodenCart_M2.sm: flags 0x411 with stride 64. The engine
        # allocates getStride(0x411) * count bytes, reads stride * count from the
        # stream, and draws the first count 32-byte vertices.
        real = [
            0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0,
            1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0,
            0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
        ]
        junk = [9.0] * 24
        data = bytearray()
        data += struct.pack("<II", 10, 0)
        data += struct.pack("<3f", 0.0, 0.0, 0.0)
        data += struct.pack("<3f", 1.0, 1.0, 0.0)
        data += struct.pack("<B", 0)
        data += struct.pack("<I", 0)
        data += struct.pack("<I", 2)
        data += material_lod("Cart_Material0", 1.0, stride=64, vertices=real + junk)
        data += material_lod("After_Material0", 0.5)

        mesh = stdmesh.parse(bytes(data), "cart.sm")
        cart, after = mesh.lods[0].materials[0], mesh.lods[1].materials[0]

        self.assertFalse(cart.stride_matches_flags)
        self.assertEqual(32, cart.engine_stride)
        self.assertEqual([(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)], cart.positions())
        self.assertEqual((1.0, 0.0), cart.uvs()[1])
        self.assertIsNone(cart.uvs2())
        # The stream still advanced by stride * count, so the next LOD is intact.
        self.assertTrue(after.stride_matches_flags)
        self.assertEqual((0.5, 0.0, 0.0), after.positions()[1])

    def test_short_payload_is_zero_padded_to_the_engine_size(self) -> None:
        material = stdmesh.Material(
            name="short", primitive=stdmesh.PRIM_TRIANGLE_LIST,
            flags=stdmesh.VF_LIGHTMAPPED, stride=32, vertex_count=1, index_count=0,
            unknown=(0, 0, 0, 0),
            vertices=[1.0, 2.0, 3.0, 0.0, 1.0, 0.0, 0.25, 0.5],
        )

        self.assertFalse(material.stride_matches_flags)
        self.assertEqual((0.25, 0.5), material.uvs()[0])
        self.assertEqual((0.0, 0.0), material.uvs2()[0])

    def test_accepts_versions_8_9_and_10_only(self) -> None:
        # SM-8: client 0x005b61f0 tests 7 < v < 0xb (i.e. 8, 9, 10); lnxded
        # loadHeader 0x083a6200 agrees. No installed file is 8 or 11, but the
        # reader must still draw the line exactly where the engine does.
        for version in (8, 9, 10):
            mesh = stdmesh.parse(standard_mesh_fixture(version), f"v{version}.sm")
            self.assertEqual(version, mesh.version)

        for version in (7, 11):
            with self.assertRaises(stdmesh.MeshError):
                stdmesh.parse(standard_mesh_fixture(version), f"v{version}.sm")

    def test_version_8_has_no_qflag_byte(self) -> None:
        # qflag is version > 9 only; an 8 and a 9 file are byte-identical
        # apart from the version word itself.
        v8 = bytearray(standard_mesh_fixture(8))
        v9 = bytearray(standard_mesh_fixture(9))
        struct.pack_into("<I", v8, 0, 9)
        self.assertEqual(bytes(v9), bytes(v8))

    def test_format_without_components_has_none(self) -> None:
        material = stdmesh.Material(
            name="none", primitive=stdmesh.PRIM_TRIANGLE_LIST, flags=0, stride=32,
            vertex_count=1, index_count=0, unknown=(0, 0, 0, 0), vertices=[0.0] * 8,
        )

        self.assertEqual([], material.positions())
        self.assertIsNone(material.normals())
        self.assertIsNone(material.uvs())


if __name__ == "__main__":
    unittest.main()
