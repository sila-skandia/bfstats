"""How big the thing actually is, in metres.

The browse view lines models up against a shared scale rule, so it needs a real
bounding box before it loads any geometry. Reading that back out of the exported
`.glb` is cheaper than re-deriving it from the meshes: every POSITION accessor
already carries `min`/`max` (the exporter writes bounds for vertex positions), so
the world box is those corners pushed through each node's transform.

Collision-only nodes are skipped — the hit hull is not the silhouette.
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A


def read_json_chunk(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 12:
        raise ValueError(f"truncated glb: {path.name}")
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"not a glb: {path.name}")
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if chunk_type == CHUNK_JSON:
            return json.loads(data[offset:offset + chunk_length].decode("utf-8"))
        offset += chunk_length + (-chunk_length % 4)
    raise ValueError(f"no JSON chunk: {path.name}")


def _identity() -> list[float]:
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def _multiply(a: list[float], b: list[float]) -> list[float]:
    """Column-major 4x4 product, matching glTF's matrix layout."""
    out = [0.0] * 16
    for column in range(4):
        for row in range(4):
            out[column * 4 + row] = sum(
                a[k * 4 + row] * b[column * 4 + k] for k in range(4))
    return out


def _from_trs(node: dict) -> list[float]:
    if "matrix" in node:
        return list(node["matrix"])
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    xx, yy, zz = qx * qx, qy * qy, qz * qz
    xy, xz, yz = qx * qy, qx * qz, qy * qz
    wx, wy, wz = qw * qx, qw * qy, qw * qz
    return [
        (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0.0,
        (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0.0,
        (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0.0,
        tx, ty, tz, 1.0,
    ]


def _transform(matrix: list[float], point: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = point
    return (
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    )


def _is_collision(name: str | None) -> bool:
    return bool(name) and "collision" in name.lower()


def bounds(path: Path) -> dict | None:
    """World-space AABB of the visible geometry, or None if nothing measurable."""
    try:
        doc = read_json_chunk(path)
    except (OSError, ValueError):
        return None

    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    accessors = doc.get("accessors", [])
    scene = doc.get("scenes", [{}])[doc.get("scene", 0)]

    low = [math.inf] * 3
    high = [-math.inf] * 3

    def visit(index: int, parent: list[float], depth: int = 0) -> None:
        if depth > 64 or index >= len(nodes):
            return
        node = nodes[index]
        world = _multiply(parent, _from_trs(node))
        mesh_index = node.get("mesh")
        if mesh_index is not None and not _is_collision(node.get("name")):
            for primitive in meshes[mesh_index].get("primitives", []):
                accessor = accessors[primitive.get("attributes", {}).get("POSITION", -1)] \
                    if "POSITION" in primitive.get("attributes", {}) else None
                if not accessor or "min" not in accessor or "max" not in accessor:
                    continue
                amin, amax = accessor["min"], accessor["max"]
                # Rotation mixes the axes, so every corner has to be tested.
                for cx in (amin[0], amax[0]):
                    for cy in (amin[1], amax[1]):
                        for cz in (amin[2], amax[2]):
                            point = _transform(world, (cx, cy, cz))
                            for axis in range(3):
                                low[axis] = min(low[axis], point[axis])
                                high[axis] = max(high[axis], point[axis])
        for child in node.get("children", []):
            visit(child, world, depth + 1)

    for root in scene.get("nodes", []):
        visit(root, _identity())

    if any(math.isinf(value) for value in low + high):
        return None

    size = [high[axis] - low[axis] for axis in range(3)]
    return {
        "length": round(max(size[0], size[2]), 3),
        "width": round(min(size[0], size[2]), 3),
        "height": round(size[1], 3),
        "footprint": round(size[0] * size[2], 3),
        "radius": round(math.dist(low, high) / 2, 3),
        # The longest side of the box, which is exactly what the viewer frames a
        # portrait against. Every thumbnail is shot at the same multiple of its
        # own maxExtent, so drawing one at a size proportional to this value puts
        # it on a true common scale with all the others. Any other measure —
        # half-diagonal, length — varies against this one by shape, and the
        # lineup silently stops being to scale.
        "maxExtent": round(max(size), 3),
    }
