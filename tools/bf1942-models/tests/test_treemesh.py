from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import treemesh  # noqa: E402


def empty_tree_mesh() -> bytes:
    data = bytearray()
    data += struct.pack("<III", 3, 0, 8)
    data += struct.pack("<6f", -1, -1, -1, 1, 1, 1)
    data += struct.pack("<6f", -1, -1, -1, 1, 1, 1)
    for _ in range(4):
        data += struct.pack("<I", 0)
    data += struct.pack("<III", 0, 0, 0)
    return bytes(data)


def one_trunk_tree() -> bytes:
    data = bytearray()
    data += struct.pack("<III", 3, 0, 8)
    data += struct.pack("<6f", 0, 0, 0, 1, 2, 1)
    data += struct.pack("<6f", 0, 0, 0, 1, 2, 1)
    data += struct.pack("<I", 0)  # branches
    tex = b"texture/trunk"
    data += struct.pack("<I", 1)  # one trunk mesh
    data += struct.pack("<II", 0, 1)  # indexStart, numFaces
    data += struct.pack("<I", len(tex)) + tex
    data += struct.pack("<I", 0)  # sprites
    data += struct.pack("<I", 0)  # billboards
    data += struct.pack("<I", 3)  # vertices
    for i, pos in enumerate(((0, 0, 0), (1, 0, 0), (0, 2, 0))):
        data += struct.pack("<3f", *pos)
        data += struct.pack("<3f", 0, 1, 0)
        data += struct.pack("<I", 0x80808080)
        data += struct.pack("<2f", float(i), 0.0)
        data += struct.pack("<2f", 0.0, 0.0)
    data += struct.pack("<I", 3)
    data += struct.pack("<3H", 0, 1, 2)
    return bytes(data)


class TreeMeshTests(unittest.TestCase):
    def test_empty_file_has_no_parts(self) -> None:
        tree = treemesh.parse(empty_tree_mesh(), "empty.tm")

        self.assertEqual(8, tree.angle_count)
        self.assertEqual([], tree.parts)

    def test_trunk_triangle_keeps_file_y_up(self) -> None:
        tree = treemesh.parse(one_trunk_tree(), "trunk.tm")

        self.assertEqual(1, len(tree.parts))
        part = tree.parts[0]
        self.assertEqual("texture/trunk", part.texture)
        self.assertEqual((0.0, 2.0, 0.0), part.positions[2])
        self.assertEqual([0, 1, 2], part.indices)


if __name__ == "__main__":
    unittest.main()
