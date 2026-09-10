"""Refractor v1 StandardMesh (.sm) reader.

Layout below follows the reference implementation in BfMeshView's `modStdMesh.bas`
(github.com/art567/BfMeshView), which is the only public description of the format.

    u32   version              9 or 10
    u32   unknown              0
    f32   boundsMin[3]
    f32   boundsMax[3]
    u8    qflag                version > 9 only
    u32   colCount
      per collision layer:
        u32 blockSize
        u32 unknown[2]
        u32 vertexCount
          per vertex: f32 position[3], f32 unknown
        u32 faceCount
          per face: i16 vertex[3], u8 defensiveMaterial, u8 flags
        remaining acceleration data up to blockSize
    u32   lodCount             1 for a simple part, 6 for a full LOD chain
      per lod:
        u32 materialCount
          per material:  u32 nameLen, name, 3 x u32 unknown, u32 primitive,
                         u32 flags, u32 vertexStride, u32 vertexCount, u32 indexCount,
                         u32 unknown
          then, in the same order, each material's vertex block followed by its
          index block — the descriptors come first, the payloads after.
    u32   cid
    u32   csize + csize bytes

Vertices at the universal stride of 32 bytes are position(3f) normal(3f) uv(2f).
The engine draws vehicle parts as an indexed triangle list (`primitive == 4`);
soldier parts use the strip form (`primitive == 5`).

Refractor is left-handed with +X right, +Y up, +Z forward. glTF is right-handed,
so exporting negates Z (see `gltf.py`) rather than mangling anything here.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

PRIM_TRIANGLE_LIST = 4
PRIM_TRIANGLE_STRIP = 5


class MeshError(ValueError):
    pass


@dataclass
class Material:
    name: str
    primitive: int
    flags: int
    stride: int
    vertex_count: int
    index_count: int
    unknown: tuple[int, int, int, int]
    vertices: list[float] = field(default_factory=list)
    indices: list[int] = field(default_factory=list)

    @property
    def floats_per_vertex(self) -> int:
        return self.stride // 4

    def positions(self) -> list[tuple[float, float, float]]:
        n = self.floats_per_vertex
        v = self.vertices
        return [tuple(v[i * n: i * n + 3]) for i in range(self.vertex_count)]

    def normals(self) -> list[tuple[float, float, float]] | None:
        if self.stride < 24:
            return None
        n = self.floats_per_vertex
        v = self.vertices
        return [tuple(v[i * n + 3: i * n + 6]) for i in range(self.vertex_count)]

    def uvs(self) -> list[tuple[float, float]] | None:
        if self.stride < 32:
            return None
        n = self.floats_per_vertex
        v = self.vertices
        return [tuple(v[i * n + 6: i * n + 8]) for i in range(self.vertex_count)]

    def triangles(self) -> list[tuple[int, int, int]]:
        idx = self.indices
        if self.primitive == PRIM_TRIANGLE_STRIP:
            tris = []
            for i in range(len(idx) - 2):
                a, b, c = idx[i], idx[i + 1], idx[i + 2]
                if a == b or b == c or a == c:
                    continue
                tris.append((a, c, b) if i % 2 else (a, b, c))
            return tris
        return [tuple(idx[i: i + 3]) for i in range(0, len(idx) - 2, 3)]


@dataclass
class Lod:
    materials: list[Material]

    @property
    def triangle_count(self) -> int:
        return sum(len(m.triangles()) for m in self.materials)


@dataclass(frozen=True)
class CollisionFace:
    vertices: tuple[int, int, int]
    material_id: int
    flags: int


@dataclass
class CollisionLayer:
    unknown: tuple[int, int]
    vertices: list[tuple[float, float, float]]
    vertex_unknown: list[float]
    faces: list[CollisionFace]

    @property
    def triangle_count(self) -> int:
        return len(self.faces)


@dataclass
class StandardMesh:
    name: str
    version: int
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    collision_layers: list[CollisionLayer]
    lods: list[Lod]

    @property
    def collision_blocks(self) -> int:
        return len(self.collision_layers)

    @property
    def lod0(self) -> Lod | None:
        return self.lods[0] if self.lods else None


class _Cursor:
    __slots__ = ("data", "pos")

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def u8(self) -> int:
        (v,) = struct.unpack_from("<B", self.data, self.pos)
        self.pos += 1
        return v

    def u32(self) -> int:
        (v,) = struct.unpack_from("<I", self.data, self.pos)
        self.pos += 4
        return v

    def f32x3(self) -> tuple[float, float, float]:
        v = struct.unpack_from("<3f", self.data, self.pos)
        self.pos += 12
        return v

    def string(self) -> str:
        n = self.u32()
        if n > 4096:
            raise MeshError(f"implausible string length {n} at {self.pos - 4}")
        s = self.data[self.pos: self.pos + n].decode("latin-1")
        self.pos += n
        return s

    def floats(self, count: int) -> list[float]:
        v = list(struct.unpack_from(f"<{count}f", self.data, self.pos))
        self.pos += count * 4
        return v

    def int16s(self, count: int) -> list[int]:
        v = list(struct.unpack_from(f"<{count}h", self.data, self.pos))
        self.pos += count * 2
        return v


def parse(data: bytes, name: str = "<mem>") -> StandardMesh:
    c = _Cursor(data)

    version = c.u32()
    if version not in (9, 10, 11):
        raise MeshError(f"{name}: unexpected version {version}")
    c.u32()  # always zero

    bmin = c.f32x3()
    bmax = c.f32x3()

    if version > 9:
        c.u8()  # qflag

    col_count = c.u32()
    collision_layers: list[CollisionLayer] = []
    for layer_index in range(col_count):
        size = c.u32()
        block_end = c.pos + size
        if size < 16 or block_end > len(data):
            raise MeshError(
                f"{name}: bad collision layer {layer_index} size {size} at {c.pos - 4}")

        unknown = (c.u32(), c.u32())
        vertex_count = c.u32()
        if vertex_count > (block_end - c.pos) // 16:
            raise MeshError(
                f"{name}: collision layer {layer_index} has implausible "
                f"vertex count {vertex_count}")
        vertices: list[tuple[float, float, float]] = []
        vertex_unknown: list[float] = []
        for _ in range(vertex_count):
            x, y, z, w = struct.unpack_from("<4f", data, c.pos)
            c.pos += 16
            vertices.append((x, y, z))
            vertex_unknown.append(w)

        if c.pos + 4 > block_end:
            raise MeshError(f"{name}: truncated collision layer {layer_index}")
        face_count = c.u32()
        if face_count > (block_end - c.pos) // 8:
            raise MeshError(
                f"{name}: collision layer {layer_index} has implausible "
                f"face count {face_count}")
        faces: list[CollisionFace] = []
        for _ in range(face_count):
            a, b, d, material_id, flags = struct.unpack_from("<3hBB", data, c.pos)
            c.pos += 8
            if min(a, b, d) < 0 or max(a, b, d) >= vertex_count:
                raise MeshError(
                    f"{name}: collision layer {layer_index} face references "
                    f"a vertex outside 0..{vertex_count - 1}")
            faces.append(CollisionFace(
                vertices=(a, b, d),
                material_id=material_id,
                flags=flags,
            ))

        collision_layers.append(CollisionLayer(
            unknown=unknown,
            vertices=vertices,
            vertex_unknown=vertex_unknown,
            faces=faces,
        ))
        c.pos = block_end

    lod_count = c.u32()
    if lod_count > 64:
        raise MeshError(f"{name}: implausible lod count {lod_count} at {c.pos - 4}")

    lods: list[Lod] = []
    for _ in range(lod_count):
        mat_count = c.u32()
        materials: list[Material] = []
        for _ in range(mat_count):
            mat_name = c.string()
            u2, u3, u4 = c.u32(), c.u32(), c.u32()
            primitive = c.u32()
            flags = c.u32()
            stride = c.u32()
            vertex_count = c.u32()
            index_count = c.u32()
            u7 = c.u32()
            if stride % 4 or stride > 256:
                raise MeshError(f"{name}: bad vertex stride {stride} in {mat_name}")
            materials.append(Material(
                name=mat_name, primitive=primitive, flags=flags, stride=stride,
                vertex_count=vertex_count, index_count=index_count,
                unknown=(u2, u3, u4, u7),
            ))
        # Payloads follow all descriptors, in descriptor order.
        for m in materials:
            m.vertices = c.floats(m.vertex_count * m.floats_per_vertex)
            m.indices = c.int16s(m.index_count)
        lods.append(Lod(materials))

    return StandardMesh(
        name=name, version=version, bounds_min=bmin, bounds_max=bmax,
        collision_layers=collision_layers, lods=lods,
    )
