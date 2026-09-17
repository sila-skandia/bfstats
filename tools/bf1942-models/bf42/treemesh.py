"""Refractor TreeMesh (`.tm`) reader.

Layout follows Ahrkylien's Blender importer (`tree_mesh.py`), which is the
public description of the format. A file is one plant: a trunk, view-dependent
branch cards, and camera-facing leaf sprites.

The trunk and *all* angle sets of the branch cards are kept. An earlier pass
kept one set, reasoning that the eight angles are alternatives like a
LodObject's Complex/Wreck children and stacking them is the same class of bug.
The analogy is wrong: LOD alternatives are the same content at different
detail, so drawing all of them stacks a wreck inside a pristine hull, while
angle sets are different card subsets each authored to look full from its own
viewing band. One set alone reads thin and dark from every other direction -
measured against an in-game screenshot, the real palm is visibly fuller than
the single-set export - and the union is simply the whole canopy. The engine
picks per angle to draw the cheapest sufficient set, not because the union is
wrong. Leaf sprites still keep one block: they are camera-facing cards, and
their angle blocks are near-identical quads that would z-fight.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from .stdmesh import CollisionFace, MeshError, _Cursor


COL_MAGIC = struct.unpack("<I", bytes([250, 194, 151, 235]))[0]
# CID_SimpleCollisionMesh — lnxded 0x086e9e08; TM-1 / TM-7.
CID_SIMPLE_COLLISION_MESH = COL_MAGIC


@dataclass
class TreePart:
    name: str
    texture: str
    positions: list[tuple[float, float, float]]
    normals: list[tuple[float, float, float]]
    uvs: list[tuple[float, float]]
    indices: list[int]


@dataclass
class TreeCollision:
    """SimpleCollisionMesh block inside a `.tm` (TM-2 / TM-4 / TM-7).

    Face `material_u16` is the SM-6 material word; `defenseMaterial` for the
    viewer is `material_u16 & 0xFF`, same as StandardMesh collision faces.
    """
    vertices: list[tuple[float, float, float]]
    faces: list[tuple[int, int, int, int]]  # i0, i1, i2, material_u16

    @property
    def triangle_count(self) -> int:
        return len(self.faces)

    def collision_faces(self) -> list[CollisionFace]:
        return [
            CollisionFace(
                vertices=(i0, i1, i2),
                material_id=material_u16 & 0xFF,
                flags=0,
            )
            for i0, i1, i2, material_u16 in self.faces
        ]


@dataclass
class TreeMesh:
    name: str
    angle_count: int
    parts: list[TreePart] = field(default_factory=list)
    collision: TreeCollision | None = None

    @property
    def triangle_count(self) -> int:
        return sum(len(p.indices) // 3 for p in self.parts)


def parse(data: bytes, name: str = "<mem>") -> TreeMesh:
    c = _Cursor(data)
    version = c.u32()
    if version != 3:
        raise MeshError(f"{name}: unexpected TreeMesh version {version}")
    c.u32()  # unknown, 0 in vanilla
    angle_count = c.u32()
    if angle_count < 1 or angle_count > 16:
        raise MeshError(f"{name}: implausible angle count {angle_count}")
    c.pos += 24  # mesh bounding box
    c.pos += 24  # leaf sprite bounding box

    groups: list[list[tuple[int, int, str]]] = []
    for _kind in range(4):
        count = c.u32()
        if count > 64:
            raise MeshError(f"{name}: implausible mesh count {count}")
        meshes: list[tuple[int, int, str]] = []
        for _ in range(count):
            index_start = c.u32()
            num_faces = c.u32()
            texture = c.string()
            meshes.append((index_start, num_faces, texture))
        groups.append(meshes)

    collision = _parse_collision(c, name)

    vertex_count = c.u32()
    if vertex_count > 200_000:
        raise MeshError(f"{name}: implausible vertex count {vertex_count}")
    positions: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    sprite_off: list[tuple[float, float]] = []
    for _ in range(vertex_count):
        px, py, pz = c.f32x3()
        nx, ny, nz = c.f32x3()
        c.u32()  # vertex colour
        u, v = struct.unpack_from("<2f", c.data, c.pos)
        c.pos += 8
        ox, oy = struct.unpack_from("<2f", c.data, c.pos)
        c.pos += 8
        positions.append((px, py, pz))
        normals.append((nx, ny, nz))
        uvs.append((u, v))
        sprite_off.append((ox, oy))

    index_count = c.u32()
    if index_count > 2_000_000:
        raise MeshError(f"{name}: implausible index count {index_count}")
    indices = c.int16s(index_count)

    parts: list[TreePart] = []
    # 0 = branch cards (angleCount copies), 1 = trunk, 2 = leaf sprites.
    for kind, meshes in enumerate(groups[:3]):
        for mesh_i, (_index_start, num_faces, texture) in enumerate(meshes):
            faces_per = num_faces
            # Indices for this mesh were appended as angleCount blocks of
            # num_faces for cards, one block for the trunk. Branch cards keep
            # every angle block: each set is a full silhouette only from its
            # own authored viewing band, so a free camera sees one set edge-on
            # from most directions and the tree reads thin and dark - the
            # in-game palm is visibly fuller than the export was. Drawing all
            # sets together costs overdraw and nothing else; the engine picks
            # per view angle because it must render the cheapest correct set,
            # not because the union is wrong. Leaf sprites keep the first block
            # - they are camera-facing cards, and stacking their angle blocks
            # piles near-identical quads.
            start = _consume_start(groups, kind, mesh_i, angle_count)
            blocks = angle_count if kind == 0 else 1
            count = faces_per * 3 * blocks
            if start + count > len(indices):
                raise MeshError(f"{name}: face indices overrun at {kind}/{mesh_i}")
            face_idx = [i & 0xFFFF for i in indices[start:start + count]]
            if kind == 2:
                part_positions = [
                    (positions[i][0] + sprite_off[i][0],
                     positions[i][1] + sprite_off[i][1],
                     positions[i][2])
                    for i in range(len(positions))
                ]
            else:
                part_positions = positions
            label = ("branch", "trunk", "sprite")[kind]
            parts.append(TreePart(
                name=f"{label}_{mesh_i}",
                texture=texture.replace("\\", "/"),
                positions=part_positions,
                normals=normals,
                uvs=uvs,
                indices=face_idx,
            ))
    return TreeMesh(
        name=name, angle_count=angle_count, parts=parts, collision=collision,
    )


def _consume_start(groups: list[list[tuple[int, int, str]]], kind: int,
                     mesh_i: int, angle_count: int) -> int:
    """Byte-accurate start of this mesh's first-angle indices in the shared pool.

    The on-disk `indexStart` is the engine's own offset into the same pool, but
    3dsmax-exported trees sometimes disagree with it. Walking the header in
    order is what the Blender importer ended up trusting.
    """
    cursor = 0
    for k, meshes in enumerate(groups):
        copies = angle_count if k in (0, 2) else 1
        for i, (_start, num_faces, _tex) in enumerate(meshes):
            if k == kind and i == mesh_i:
                return cursor
            cursor += num_faces * 3 * copies
    return cursor


def _parse_collision(c: _Cursor, name: str) -> TreeCollision | None:
    """Parse the TreeMesh SimpleCollisionMesh block, or None if CID is 0.

    TM-1 / TM-7: the word is a collider class id for
    `SmartItf<IVectorCollider>::create` (lnxded `TreeMeshTemplate::load`
    0x083bd380, id read at 0x083bd651, consumed at 0x083bd85d), not a
    magic-or-vertex-count switch. 0 means no collider — bushes store four
    zero bytes here. `COL_MAGIC` (0xEB97C2FA) is `CID_SimpleCollisionMesh`
    (lnxded 0x086e9e08); every non-zero id across installed tree meshes is
    that one. Any other id is unsupported — the engine never rewinds here.

    Layout (version 5): 16-byte verts (xyz + u32 bake), 8-byte faces
    (3×u16 index + u16 material), then BSP skipped after parse (TM-7).
    Soft AABB-vs-header mismatches are authoring slack; indices are the
    ship criterion.
    """
    if c.pos + 4 > len(c.data):
        return None
    magic = c.u32()
    if magic == 0:
        return None
    if magic != COL_MAGIC:
        raise MeshError(
            f"{name}: unsupported collider class id 0x{magic:08X} at {c.pos - 4}")
    version = c.u32()
    if version != 5:
        raise MeshError(f"{name}: unexpected collision version {version}")
    vert_count = c.u32()
    if vert_count > 200_000:
        raise MeshError(f"{name}: implausible collision vertex count {vert_count}")
    vertices: list[tuple[float, float, float]] = []
    for _ in range(vert_count):
        x, y, z = c.f32x3()
        c.pos += 4  # face-material bake in low 16 (SM-6); not needed for export
        vertices.append((x, y, z))
    face_count = c.u32()
    if face_count > 2_000_000:
        raise MeshError(f"{name}: implausible collision face count {face_count}")
    faces: list[tuple[int, int, int, int]] = []
    for _ in range(face_count):
        i0, i1, i2, material_u16 = struct.unpack_from("<4H", c.data, c.pos)
        c.pos += 8
        if max(i0, i1, i2) >= vert_count:
            raise MeshError(
                f"{name}: collision face references a vertex outside "
                f"0..{vert_count - 1}")
        faces.append((i0, i1, i2, material_u16))
    _skip_bsp(c)
    return TreeCollision(vertices=vertices, faces=faces)


def _skip_bsp(c: _Cursor) -> None:
    c.u32()  # totalFaceListCount
    c.u32()  # numBspNodes
    num_faces = c.u32()
    c.pos += num_faces * 32  # 3f normal + 5 u32
    _skip_bsp_node(c)


def _skip_bsp_node(c: _Cursor, depth: int = 0) -> None:
    if depth > 64:
        raise MeshError("collision BSP too deep")
    c.pos += 24  # bounding box
    facenum = c.u32()
    c.pos += facenum * 4
    for _ in range(2):
        has_child = c.u8()
        if has_child == 1:
            _skip_bsp_node(c, depth + 1)
