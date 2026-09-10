"""Refractor TreeMesh (`.tm`) reader.

Layout follows Ahrkylien's Blender importer (`tree_mesh.py`), which is the
public description of the format. A file is one plant: a trunk, view-dependent
branch cards, and camera-facing leaf sprites. We keep the trunk and one angle of
the cards — eight angles exist so the engine can pick a silhouette, and stacking
them is the same class of bug as drawing every LodObject alternative.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from .stdmesh import MeshError, _Cursor


COL_MAGIC = struct.unpack("<I", bytes([250, 194, 151, 235]))[0]


@dataclass
class TreePart:
    name: str
    texture: str
    positions: list[tuple[float, float, float]]
    normals: list[tuple[float, float, float]]
    uvs: list[tuple[float, float]]
    indices: list[int]


@dataclass
class TreeMesh:
    name: str
    angle_count: int
    parts: list[TreePart] = field(default_factory=list)

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

    _skip_collision(c, name)

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
            # num_faces for cards, one block for the trunk. Keep the first
            # silhouette only.
            start = _consume_start(groups, kind, mesh_i, angle_count)
            count = faces_per * 3
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
    return TreeMesh(name=name, angle_count=angle_count, parts=parts)


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


def _skip_collision(c: _Cursor, name: str) -> None:
    if c.pos + 4 > len(c.data):
        return
    magic = c.u32()
    if magic == COL_MAGIC:
        version = c.u32()
        if version != 5:
            raise MeshError(f"{name}: unexpected collision version {version}")
        vert_count = c.u32()
        c.pos += vert_count * 16  # 3f + 2 bytes + 2 pad
        face_count = c.u32()
        c.pos += face_count * 8  # 3u16 indices + u16 material
        _skip_bsp(c)
        return
    # Bushes store four zero bytes here instead of a collision mesh.
    # A non-zero value that is not the collision magic is the visible vertex
    # count and has to be rewound.
    if magic != 0:
        c.pos -= 4


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
