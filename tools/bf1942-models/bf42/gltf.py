"""Minimal binary glTF (.glb) writer — enough for static, textured, hierarchical models.

Refractor is left-handed (+X right, +Y up, +Z *forward*); glTF is right-handed with
+Z toward the viewer. The handedness is baked out here rather than pushed onto the
viewer as a negative root scale, which would invert normals and back-face culling:

  * positions and normals get their Z negated
  * triangle winding is reversed to keep faces pointing outward
  * node translations get their Z negated
  * of the Yaw/Pitch/Roll a `.con` specifies, yaw and pitch change sign; roll does not
    (mirroring about Z conjugates rotations about X and Y, and fixes those about Z)

UVs pass through untouched: both formats put (0,0) at the top-left of the image.
"""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field

COMPONENT_FLOAT = 5126
COMPONENT_USHORT = 5123
COMPONENT_UINT = 5125


@dataclass
class Primitive:
    positions: list[tuple[float, float, float]]
    indices: list[int]
    normals: list[tuple[float, float, float]] | None = None
    uvs: list[tuple[float, float]] | None = None
    material: int | None = None


@dataclass
class Node:
    name: str
    translation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)  # xyzw
    mesh: int | None = None
    children: list[int] = field(default_factory=list)
    extras: dict | None = None


def quat_from_ypr(yaw_deg: float, pitch_deg: float, roll_deg: float) -> tuple[float, float, float, float]:
    """A Refractor Yaw/Pitch/Roll triple as a glTF quaternion, handedness converted.

    Refractor composes R = Ry(yaw) * Rx(pitch) * Rz(roll). Mirroring Z flips the
    sense of the rotations about X and Y but leaves the one about Z alone.
    """
    y = math.radians(-yaw_deg) * 0.5
    p = math.radians(-pitch_deg) * 0.5
    r = math.radians(roll_deg) * 0.5
    qy = (0.0, math.sin(y), 0.0, math.cos(y))
    qx = (math.sin(p), 0.0, 0.0, math.cos(p))
    qz = (0.0, 0.0, math.sin(r), math.cos(r))
    return _qmul(_qmul(qy, qx), qz)


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


class GlbBuilder:
    def __init__(self, generator: str = "bfstats bf1942 model extractor") -> None:
        self._blob = bytearray()
        self._views: list[dict] = []
        self._accessors: list[dict] = []
        self._meshes: list[dict] = []
        self._materials: list[dict] = []
        self._images: list[dict] = []
        self._textures: list[dict] = []
        self._nodes: list[Node] = []
        self._generator = generator

    # -- buffer plumbing ---------------------------------------------------- #

    def _align(self, boundary: int = 4) -> None:
        while len(self._blob) % boundary:
            self._blob.append(0)

    def _view(self, data: bytes, target: int | None = None, stride: int | None = None) -> int:
        self._align()
        offset = len(self._blob)
        self._blob += data
        view: dict = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        if stride is not None:
            view["byteStride"] = stride
        self._views.append(view)
        return len(self._views) - 1

    def _accessor(self, view: int, component: int, count: int, kind: str,
                  minimum=None, maximum=None) -> int:
        acc: dict = {"bufferView": view, "componentType": component,
                     "count": count, "type": kind}
        if minimum is not None:
            acc["min"], acc["max"] = minimum, maximum
        self._accessors.append(acc)
        return len(self._accessors) - 1

    def _vec3_accessor(self, values: list[tuple[float, float, float]], bounds: bool) -> int:
        data = b"".join(struct.pack("<3f", *v) for v in values)
        view = self._view(data, target=34962)
        lo = hi = None
        if bounds and values:
            lo = [min(v[i] for v in values) for i in range(3)]
            hi = [max(v[i] for v in values) for i in range(3)]
        return self._accessor(view, COMPONENT_FLOAT, len(values), "VEC3", lo, hi)

    def _vec2_accessor(self, values: list[tuple[float, float]]) -> int:
        data = b"".join(struct.pack("<2f", *v) for v in values)
        view = self._view(data, target=34962)
        return self._accessor(view, COMPONENT_FLOAT, len(values), "VEC2")

    # -- content ------------------------------------------------------------ #

    def add_image_png(self, png: bytes, name: str) -> int:
        view = self._view(png)
        self._images.append({"bufferView": view, "mimeType": "image/png", "name": name})
        self._textures.append({"source": len(self._images) - 1, "sampler": 0})
        return len(self._textures) - 1

    def add_material(self, name: str, texture: int | None = None, *,
                     double_sided: bool = False, alpha_cutoff: float | None = None,
                     blend: bool = False, base_color=(1.0, 1.0, 1.0, 1.0)) -> int:
        pbr: dict = {"baseColorFactor": list(base_color),
                     "metallicFactor": 0.0, "roughnessFactor": 0.85}
        if texture is not None:
            pbr["baseColorTexture"] = {"index": texture}
        mat: dict = {"name": name, "pbrMetallicRoughness": pbr, "doubleSided": double_sided}
        if alpha_cutoff is not None:
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = alpha_cutoff
        elif blend:
            mat["alphaMode"] = "BLEND"
        self._materials.append(mat)
        return len(self._materials) - 1

    def add_mesh(self, name: str, primitives: list[Primitive]) -> int:
        out = []
        for prim in primitives:
            # Left-handed -> right-handed.
            positions = [(x, y, -z) for x, y, z in prim.positions]
            attrs = {"POSITION": self._vec3_accessor(positions, bounds=True)}
            if prim.normals:
                normals = [(x, y, -z) for x, y, z in prim.normals]
                attrs["NORMAL"] = self._vec3_accessor(normals, bounds=False)
            if prim.uvs:
                attrs["TEXCOORD_0"] = self._vec2_accessor(prim.uvs)

            flipped: list[int] = []
            for i in range(0, len(prim.indices) - 2, 3):
                a, b, c = prim.indices[i:i + 3]
                flipped += [a, c, b]
            wide = len(positions) > 65535
            fmt, comp = ("<I", COMPONENT_UINT) if wide else ("<H", COMPONENT_USHORT)
            view = self._view(b"".join(struct.pack(fmt, i) for i in flipped), target=34963)
            index_acc = self._accessor(view, comp, len(flipped), "SCALAR")

            entry: dict = {"attributes": attrs, "indices": index_acc, "mode": 4}
            if prim.material is not None:
                entry["material"] = prim.material
            out.append(entry)

        self._meshes.append({"name": name, "primitives": out})
        return len(self._meshes) - 1

    def add_node(self, node: Node) -> int:
        self._nodes.append(node)
        return len(self._nodes) - 1

    # -- output ------------------------------------------------------------- #

    def build(self, roots: list[int], extras: dict | None = None) -> bytes:
        nodes = []
        for n in self._nodes:
            entry: dict = {"name": n.name}
            if n.translation != (0.0, 0.0, 0.0):
                x, y, z = n.translation
                entry["translation"] = [x, y, -z]
            if n.rotation != (0.0, 0.0, 0.0, 1.0):
                entry["rotation"] = list(n.rotation)
            if n.mesh is not None:
                entry["mesh"] = n.mesh
            if n.children:
                entry["children"] = n.children
            if n.extras:
                entry["extras"] = n.extras
            nodes.append(entry)

        doc: dict = {
            "asset": {"version": "2.0", "generator": self._generator},
            "scene": 0,
            "scenes": [{"nodes": roots}],
            "nodes": nodes,
            "meshes": self._meshes,
            "accessors": self._accessors,
            "bufferViews": self._views,
            "buffers": [{"byteLength": len(self._blob)}],
        }
        if self._materials:
            doc["materials"] = self._materials
        if self._images:
            doc["images"] = self._images
            doc["textures"] = self._textures
            # 10497 == REPEAT: Refractor UVs tile well outside 0..1.
            doc["samplers"] = [{"magFilter": 9729, "minFilter": 9987,
                                "wrapS": 10497, "wrapT": 10497}]
        if extras:
            doc["extras"] = extras

        json_bytes = json.dumps(doc, separators=(",", ":")).encode("utf-8")
        json_bytes += b" " * (-len(json_bytes) % 4)
        blob = bytes(self._blob)
        blob += b"\0" * (-len(blob) % 4)

        total = 12 + 8 + len(json_bytes) + 8 + len(blob)
        out = bytearray()
        out += struct.pack("<III", 0x46546C67, 2, total)
        out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
        out += struct.pack("<II", len(blob), 0x004E4942) + blob
        return bytes(out)
