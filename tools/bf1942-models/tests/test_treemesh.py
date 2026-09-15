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
    data += struct.pack("<I", 0)  # collision slot: CID none
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


def tree_with_collider(collider: bytes) -> bytes:
    """A trunk-only tree whose collision slot holds exactly `collider`."""
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
    data += collider  # collision slot: a class id, not a magic/vertex-count switch
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

    def test_branch_cards_keep_every_angle_block(self) -> None:
        """One angle set alone is a full silhouette only from its own band.

        A free camera sees any single set edge-on from most directions, so the
        tree reads thin - the in-game palm is visibly fuller than a single-set
        export. The union of all sets is the whole canopy.
        """
        data = bytearray()
        data += struct.pack("<III", 3, 0, 2)  # angleCount 2
        data += struct.pack("<6f", 0, 0, 0, 1, 2, 1)
        data += struct.pack("<6f", 0, 0, 0, 1, 2, 1)
        tex = b"texture/leaf"
        data += struct.pack("<I", 1)  # one branch mesh
        data += struct.pack("<II", 0, 1)  # indexStart, numFaces
        data += struct.pack("<I", len(tex)) + tex
        data += struct.pack("<I", 0)  # trunks
        data += struct.pack("<I", 0)  # sprites
        data += struct.pack("<I", 0)  # billboards
        data += struct.pack("<I", 0)  # collision slot: CID none
        data += struct.pack("<I", 3)  # vertices
        for i in range(3):
            data += struct.pack("<3f", float(i), 0.0, 0.0)
            data += struct.pack("<3f", 0, 1, 0)
            data += struct.pack("<I", 0x80808080)
            data += struct.pack("<2f", 0.0, 0.0)
            data += struct.pack("<2f", 0.0, 0.0)
        # Two angle blocks of one face each over the shared vertex pool.
        data += struct.pack("<I", 6)
        data += struct.pack("<6H", 0, 1, 2, 2, 1, 0)

        tree = treemesh.parse(bytes(data), "bush.tm")

        self.assertEqual(1, len(tree.parts))
        # Both blocks, in file order - not just the first silhouette.
        self.assertEqual([0, 1, 2, 2, 1, 0], tree.parts[0].indices)


class CollisionSlotTests(unittest.TestCase):
    """TM-1: the word is a collider class id, not a magic-or-vertex-count
    switch - lnxded `TreeMeshTemplate::load` 0x083bd380 passes it straight to
    `SmartItf<IVectorCollider>::create` (0x083bd85d, entry read at 0x083bd651)
    and never rewinds. 0 is CID none; 0xEB97C2FA is `CID_SimpleCollisionMesh`
    (lnxded 0x086e9e08), the only other id across 401 installed tree meshes.
    """

    def test_zero_word_is_no_collider(self) -> None:
        tree = treemesh.parse(tree_with_collider(struct.pack("<I", 0)), "none.tm")

        self.assertEqual(1, len(tree.parts))
        self.assertEqual((0.0, 2.0, 0.0), tree.parts[0].positions[2])

    def test_simple_collision_mesh_id_reads_its_body(self) -> None:
        # class id, format 5, zero collision vertices, zero collision faces,
        # then an empty BSP (totalFaceListCount, numBspNodes, faceCount - all
        # 0 - followed by the root node's own bounding box and face list).
        collider = struct.pack("<II", treemesh.COL_MAGIC, 5)
        collider += struct.pack("<II", 0, 0)  # collision vertex count, face count
        collider += struct.pack("<III", 0, 0, 0)  # BSP: totalFaceListCount, numBspNodes, faceCount
        collider += struct.pack("<6f", 0, 0, 0, 0, 0, 0)  # root node bounding box
        collider += struct.pack("<I", 0)  # root node's own face count
        collider += struct.pack("<BB", 0, 0)  # root node: no children

        tree = treemesh.parse(tree_with_collider(collider), "collider.tm")

        self.assertEqual(1, len(tree.parts))
        self.assertEqual((0.0, 2.0, 0.0), tree.parts[0].positions[2])

    def test_unrecognised_collider_id_raises(self) -> None:
        # Never observed (0 of 401 installed tree meshes), and the engine has
        # no rewind branch to fall back on - an unknown id is an error, not a
        # reinterpretation as a vertex count.
        with self.assertRaises(treemesh.MeshError):
            treemesh.parse(tree_with_collider(struct.pack("<I", 0x12345678)), "unknown-collider.tm")


if __name__ == "__main__":
    unittest.main()


class UnlitFoliageTests(unittest.TestCase):
    """Leaf cards are full-bright; the trunk is not."""

    def test_unlit_material_declares_the_extension(self) -> None:
        from bf42 import gltf

        builder = gltf.GlbBuilder()
        lit = builder.add_material(name="trunk_0")
        unlit = builder.add_material(name="sprite_0", unlit=True)
        blob = builder.build([builder.add_node(gltf.Node(name="root"))])

        import json, struct
        length, = struct.unpack_from("<I", blob, 12)
        doc = json.loads(blob[20:20 + length])

        self.assertIn("KHR_materials_unlit", doc["extensionsUsed"])
        self.assertNotIn("extensions", doc["materials"][lit])
        self.assertIn("KHR_materials_unlit",
                      doc["materials"][unlit]["extensions"])

    def test_only_leaf_sprites_are_unlit(self) -> None:
        """A palm is branch + trunk and must keep its shading.

        Branch cards sit at real angles and read as fronds when the sun hits
        them; unlit they flatten to a uniform bright green. Only the
        camera-facing sprites -- the bush parts whose normals point sideways --
        are full-bright.
        """
        for name, expected in (("sprite_0", True), ("branch_3", False),
                               ("trunk_0", False), ("trunk_12", False)):
            self.assertEqual(expected, name.startswith("sprite"), name)
