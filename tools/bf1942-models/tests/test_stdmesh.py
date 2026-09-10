from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import stdmesh  # noqa: E402


def material_lod(name: str, scale: float) -> bytes:
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
            0,
            32,
            3,
            3,
            0,
        )
    )
    vertices = [
        0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0,
        scale, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0,
        0.0, scale, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
    ]
    return (
        struct.pack("<I", 1)
        + descriptor
        + struct.pack("<24f", *vertices)
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


def standard_mesh_fixture() -> bytes:
    data = bytearray()
    data += struct.pack("<II", 10, 0)
    data += struct.pack("<3f", -1.0, -1.0, -1.0)
    data += struct.pack("<3f", 1.0, 1.0, 1.0)
    data += struct.pack("<B", 0)
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


if __name__ == "__main__":
    unittest.main()
