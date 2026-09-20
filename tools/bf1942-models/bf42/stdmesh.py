"""Refractor v1 StandardMesh (.sm) reader.

Layout below follows the reference implementation in BfMeshView's `modStdMesh.bas`
(github.com/art567/BfMeshView), cross-checked against the engine where the
corpus in `features/bf1942-engine-reference/` has read it.

    u32   version              8, 9 or 10 (client 0x005b61f0 tests 7 < v < 0xb;
                               lnxded loadHeader 0x083a6200 agrees)
    u32   unknown              0
    f32   boundsMin[3]
    f32   boundsMax[3]
    u8    qflag                version > 9 only
    u32   colCount
      per collision layer:
        u32 blockSize
        u32 unknown[2]
        u32 vertexCount
          per vertex: f32 position[3], u16 material, u16 pad
        u32 faceCount
          per face: i16 vertex[3], u8 defensiveMaterial, u8 flags
        remaining acceleration data up to blockSize
    u32   lodCount             1 for a simple part, 6 for a full LOD chain
      per lod:
        u32 materialCount
          per material:  u32 nameLen, name, 12 reserved bytes, u32 primitive,
                         u32 flags, u32 vertexStride, u32 vertexCount, u32 indexCount,
                         u32 unknown
          then, in the same order, each material's vertex block followed by its
          index block — the descriptors come first, the payloads after.
    u32   cid
    u32   csize + csize bytes

The vertex layout is the `flags` word, which is the engine's vertex format
(`dice::ref2::rend`): a component bitfield the renderer turns into a Direct3D
FVF code, so the components sit in Direct3D order — position, normal, colours,
then texture-coordinate sets 0..3. The engine derives the stride from that word
(`rend::getStride`, client 0x00640f20) and never lays anything out from the
file's `vertexStride`; the loader (client 0x005b42d0) uses `vertexStride *
vertexCount` only as the number of bytes to pull from the stream. One mod mesh
(bf1918 `o_WoodenCart_M2.sm`) writes stride 64 against flags 0x411 and is only
readable this way. See `features/bf1942-engine-reference/subsystems/
standardmesh-vertex-format.md` (ledger rows SM-1 / SM-2).

The engine draws vehicle parts as an indexed triangle list (`primitive == 4`);
soldier parts use the strip form (`primitive == 5`).

Refractor is left-handed with +X right, +Y up, +Z forward. glTF is right-handed,
so exporting negates Z (see `gltf.py`) rather than mangling anything here.
"""

from __future__ import annotations

import functools
import struct
from dataclasses import dataclass, field

PRIM_TRIANGLE_LIST = 4
PRIM_TRIANGLE_STRIP = 5

# Vertex format bits, as `rend::getStride` (client 0x00640f20, lnxded 0x084451d0)
# and the D3DFVF builder (client 0x00672a40) read them. Sizes are bytes.
VF_POSITION = 0x00000001          # 3 floats            -> D3DFVF_XYZ
VF_POSITION_RHW = 0x00000004      # 4 floats            -> D3DFVF_XYZRHW   (engine bit, unseen in .sm)
VF_NORMAL = 0x00000010            # 3 floats            -> D3DFVF_NORMAL
VF_DIFFUSE = 0x00000040           # 1 packed colour     -> D3DFVF_DIFFUSE  (unseen in .sm)
VF_SPECULAR = 0x00000100          # 1 packed colour     -> D3DFVF_SPECULAR (unseen in .sm)
VF_BLEND_WEIGHTS = (0x00200000, 0x00400000, 0x00800000, 0x01000000)   # 1..4 floats -> D3DFVF_XYZB1..4
VF_BIT29 = 0x20000000             # 16 bytes in getStride; the FVF builder disagrees. Unnamed, unseen.
# Texture-coordinate sets 0..3; within a set the four bits are 1, 2, 3 or 4 floats,
# tested in that order, first match wins.
VF_TEXCOORD_SETS = (
    (0x00000200, 0x00000400, 0x00000800, 0x02000000),
    (0x00001000, 0x00002000, 0x00004000, 0x04000000),
    (0x00008000, 0x00010000, 0x00020000, 0x08000000),
    (0x00040000, 0x00080000, 0x00100000, 0x10000000),
)

VF_STANDARD = 0x0411       # position + normal + uv0(2f)            = 32 bytes; every vanilla mesh
VF_LIGHTMAPPED = 0x2411    # position + normal + uv0(2f) + uv1(2f)  = 40 bytes; lightmapped statics


class MeshError(ValueError):
    pass


@dataclass(frozen=True)
class VertexComponent:
    name: str
    offset: int   # bytes from the start of the vertex
    size: int     # bytes


@functools.lru_cache(maxsize=None)
def vertex_layout(flags: int) -> tuple[VertexComponent, ...]:
    """Components of a vertex with this format word, in memory order.

    Mirrors `rend::getStride`: the same bits, the same sizes, summed in the same
    order, which is Direct3D's FVF order.
    """
    components: list[VertexComponent] = []
    offset = 0

    def put(name: str, size: int) -> None:
        nonlocal offset
        components.append(VertexComponent(name, offset, size))
        offset += size

    if flags & VF_POSITION:
        put("position", 12)
    if flags & VF_POSITION_RHW:
        put("position_rhw", 16)
    for count, bit in enumerate(VF_BLEND_WEIGHTS, 1):
        if flags & bit:
            put("blend_weights", 4 * count)
    if flags & VF_BIT29:
        put("reserved_bit29", 16)
    if flags & VF_NORMAL:
        put("normal", 12)
    if flags & VF_DIFFUSE:
        put("diffuse", 4)
    if flags & VF_SPECULAR:
        put("specular", 4)
    for set_index, bits in enumerate(VF_TEXCOORD_SETS):
        for count, bit in enumerate(bits, 1):
            if flags & bit:
                put(f"uv{set_index}", 4 * count)
                break
    return tuple(components)


def engine_stride(flags: int) -> int:
    """Bytes per vertex the engine allocates for this format word: `rend::getStride`."""
    return sum(c.size for c in vertex_layout(flags))


@dataclass
class Material:
    name: str
    primitive: int
    flags: int
    stride: int
    vertex_count: int
    index_count: int
    unknown: tuple[int, int, int, int]
    # The vertex payload as the stream holds it: `stride * vertex_count` bytes as
    # floats (zero-padded to the engine's size when the file is short). Read it
    # through the accessors, which use the format word, not `stride`.
    vertices: list[float] = field(default_factory=list)
    indices: list[int] = field(default_factory=list)

    @property
    def floats_per_vertex(self) -> int:
        """Floats per vertex in the *file's* stride - what the stream consumes."""
        return self.stride // 4

    @property
    def layout(self) -> tuple[VertexComponent, ...]:
        return vertex_layout(self.flags)

    @property
    def engine_stride(self) -> int:
        return engine_stride(self.flags)

    @property
    def stride_matches_flags(self) -> bool:
        """False when the file's stride is not what the engine derives from `flags`.

        The engine still draws such a mesh from the first `engine_stride *
        vertex_count` bytes of the payload; this only says the file is odd.
        """
        return self.stride == self.engine_stride

    def component(self, name: str) -> VertexComponent | None:
        for c in self.layout:
            if c.name == name:
                return c
        return None

    def _component_floats(self, comp: VertexComponent) -> list[tuple[float, ...]]:
        step = self.engine_stride // 4
        base = comp.offset // 4
        width = comp.size // 4
        v = self.vertices
        needed = step * self.vertex_count
        if len(v) < needed:
            v = v + [0.0] * (needed - len(v))
        return [tuple(v[i * step + base: i * step + base + width]) for i in range(self.vertex_count)]

    def positions(self) -> list[tuple[float, float, float]]:
        comp = self.component("position")
        return [] if comp is None else self._component_floats(comp)  # type: ignore[return-value]

    def normals(self) -> list[tuple[float, float, float]] | None:
        comp = self.component("normal")
        return None if comp is None else self._component_floats(comp)  # type: ignore[return-value]

    def uv_set(self, index: int) -> list[tuple[float, ...]] | None:
        """Texture-coordinate set 0..3, or None when the format has no such set."""
        comp = self.component(f"uv{index}")
        return None if comp is None else self._component_floats(comp)

    def uvs(self) -> list[tuple[float, float]] | None:
        return self.uv_set(0)  # type: ignore[return-value]

    def uvs2(self) -> list[tuple[float, float]] | None:
        """Second texture-coordinate set; vanilla's object-lightmap channel (flags 0x2411)."""
        return self.uv_set(1)  # type: ignore[return-value]

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


# A collision face is culled when its two edge vectors cross to (numerically)
# nothing: `checkFaceAndEdgeCollision`/`getDistanceToGeometry` cannot hit a face
# with no normal, and `assemble.py`/`extract_collision_meshes.py` drop the same
# faces for the same reason. The bar is on the SQUARED cross product, so 1e-20
# is |cross| = 1e-10 — a triangle about 10 um across.
#
# It used to be 1e-12 (|cross| = 1e-6, an area of 5e-7 m2), which is not
# "numerically zero" but "small", and a wheel's ground probe is exactly that:
# a deliberate ~1 mm triangle whose three vertices are one contact point
# (collision-response.md #5.5, "n = vertex count; if n < 4: n = 1"). Across
# vanilla, 98 of 66,476 collision faces fell under the old bar and no face at
# all has a cross product of zero; the 7 layers it emptied outright were
# Sherman_Whe3L/Le/R/Re (the suspension springs of the Sherman, the Priest and
# the M10, which alias those meshes) and the three Tlight tracer meshes. With
# their probes gone those three tanks had no sprung ground contact left and
# settled onto their hull corners at a 13 degree list. See
# `features/mesh-viewer-fidelity-defects/tilted-tanks.md`.
DEGENERATE_CROSS_SQ = 1e-20


@dataclass(frozen=True)
class CollisionFace:
    vertices: tuple[int, int, int]
    material_id: int
    flags: int


@dataclass
class CollisionLayer:
    unknown: tuple[int, int]
    vertices: list[tuple[float, float, float]]
    # collision-response.md #5.4 / R3 F10: the 16-byte collision vertex record
    # is xyz **+ a u16 material + a u16 pad**, not a 4th float — the "unknown"
    # this field's name remembers reading it as before the fix. `vertex_unknown`
    # now holds that trailing pad word (cast to float only so old callers that
    # iterate it as floats keep working); the material is `vertex_materials`.
    # This is the "vertex side" of a contact (collision-response.md #9.4): the
    # engine reads `checkObjectVsObject` `uVar13 = *(ushort*)(vertexArray +
    # 0xc + i*0x10)` and passes it as `matSelf`, while the struck FACE's own
    # `material_id` below supplies `matOther` — so a hit's two materials come
    # from two different arrays, one per side.
    vertex_unknown: list[float]
    faces: list[CollisionFace]
    vertex_materials: list[int] = field(default_factory=list)

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

    def uint16s(self, count: int) -> list[int]:
        v = list(struct.unpack_from(f"<{count}H", self.data, self.pos))
        self.pos += count * 2
        return v

    int16s = uint16s


def parse(data: bytes, name: str = "<mem>") -> StandardMesh:
    c = _Cursor(data)

    version = c.u32()
    # SM-8: the engine accepts exactly 8, 9 and 10 (client 0x005b61f0 tests
    # 7 < v < 0xb; lnxded loadHeader 0x083a6200 agrees). This reader used to
    # accept 11, which no installed file is, and reject 8, which some are.
    if version not in (8, 9, 10):
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
        vertex_materials: list[int] = []
        for _ in range(vertex_count):
            x, y, z, material_id, pad = struct.unpack_from("<3fHH", data, c.pos)
            c.pos += 16
            vertices.append((x, y, z))
            vertex_materials.append(material_id)
            vertex_unknown.append(float(pad))

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
            vertex_materials=vertex_materials,
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
        # Payloads follow all descriptors, in descriptor order. The stream
        # advances by the file's stride times the count - that is what the
        # engine reads - and the accessors then lay the bytes out by `flags`.
        for m in materials:
            m.vertices = c.floats(m.vertex_count * m.floats_per_vertex)
            engine_floats = m.vertex_count * (m.engine_stride // 4)
            if len(m.vertices) < engine_floats:
                m.vertices.extend([0.0] * (engine_floats - len(m.vertices)))
            m.indices = c.uint16s(m.index_count)
        lods.append(Lod(materials))

    return StandardMesh(
        name=name, version=version, bounds_min=bmin, bounds_max=bmax,
        collision_layers=collision_layers, lods=lods,
    )
