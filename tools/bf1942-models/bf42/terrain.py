"""Turn a BF1942 heightmap into textured terrain tiles.

Each Tx tile covers a 256 m patch. Vertices sit on the 4 m heightmap grid
(worldSize / dim), which is how Battlecraft and the Blender importer place them.
Height is `sample / 65535 * 256 * yScale` — 16-bit samples with yScale 0.6 top
out at 153.6 m, matching object `absolutePosition` Y on Tobruk to a few centimetres.
"""

from __future__ import annotations

from . import gltf
from .level import PATCH_METERS, Heightmap, TerrainInfo, tile_world_origin

# One 256 m patch repeats the detail map this many times. Mid-grey (128) is identity.
DETAIL_REPEATS = 16.0


def tile_mesh(heightmap: Heightmap, info: TerrainInfo, col: int, row: int,
              patch: float = PATCH_METERS) -> gltf.Primitive | None:
    x0, z0 = tile_world_origin(info.tex_offset_x, info.tex_offset_y, col, row, patch)
    ix0 = int(round(x0 / heightmap.spacing))
    iz0 = int(round(z0 / heightmap.spacing))
    cells = max(1, int(round(patch / heightmap.spacing)))
    verts_n = cells + 1
    if ix0 >= heightmap.dim - 1 or iz0 >= heightmap.dim - 1:
        return None
    if ix0 + cells < 0 or iz0 + cells < 0:
        return None

    positions: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    for iz in range(verts_n):
        for ix in range(verts_n):
            wx = (ix0 + ix) * heightmap.spacing
            wz = (iz0 + iz) * heightmap.spacing
            positions.append((wx, heightmap.height_at(ix0 + ix, iz0 + iz), wz))
            uvs.append((ix / cells, 1.0 - iz / cells))

    indices: list[int] = []
    for iz in range(cells):
        for ix in range(cells):
            i = iz * verts_n + ix
            # CCW from above (+Y) in Refractor. glTF conversion keeps that facing.
            indices.extend((i, i + verts_n + 1, i + 1, i, i + verts_n, i + verts_n + 1))

    normals = _normals(positions, indices, verts_n)
    return gltf.Primitive(
        positions=positions, indices=indices, normals=normals, uvs=uvs,
    )


def water_mesh(info: TerrainInfo, tiles: list[tuple[int, int]],
               patch: float = PATCH_METERS) -> gltf.Primitive | None:
    if not tiles:
        return None
    xs = [tile_world_origin(info.tex_offset_x, info.tex_offset_y, c, r, patch)[0]
          for c, r in tiles]
    zs = [tile_world_origin(info.tex_offset_x, info.tex_offset_y, c, r, patch)[1]
          for c, r in tiles]
    x0, z0 = min(xs), min(zs)
    x1, z1 = max(xs) + patch, max(zs) + patch
    y = info.water_level
    positions = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    indices = [0, 2, 1, 0, 3, 2]
    normals = [(0.0, 1.0, 0.0)] * 4
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    return gltf.Primitive(positions=positions, indices=indices, normals=normals, uvs=uvs)


def apply_detail(base: bytes, width: int, height: int,
                 detail: bytes, dwidth: int, dheight: int,
                 repeats: float = DETAIL_REPEATS) -> bytes:
    """Multiply a colour map by a wrapping detail texture.

    Refractor's detail pass is `base * detail * 2`, so 128 stays itself and
    the sand grain reads as a high-frequency overlay rather than a darkening.
    """
    if not base or not detail or width <= 0 or height <= 0 or dwidth <= 0 or dheight <= 0:
        return base
    xs = [int((x / width) * repeats * dwidth) % dwidth for x in range(width)]
    ys = [int((y / height) * repeats * dheight) % dheight for y in range(height)]
    out = bytearray(len(base))
    for y, dy in enumerate(ys):
        drow = dy * dwidth
        brow = y * width
        for x, dx in enumerate(xs):
            bi = (brow + x) * 4
            di = (drow + dx) * 4
            out[bi] = min(255, (base[bi] * detail[di] * 2) // 255)
            out[bi + 1] = min(255, (base[bi + 1] * detail[di + 1] * 2) // 255)
            out[bi + 2] = min(255, (base[bi + 2] * detail[di + 2] * 2) // 255)
            out[bi + 3] = base[bi + 3]
    return bytes(out)


def _normals(positions: list[tuple[float, float, float]], indices: list[int],
             _width: int) -> list[tuple[float, float, float]]:
    acc = [(0.0, 0.0, 0.0)] * len(positions)
    for i in range(0, len(indices) - 2, 3):
        a, b, c = indices[i], indices[i + 1], indices[i + 2]
        ax, ay, az = positions[a]
        bx, by, bz = positions[b]
        cx, cy, cz = positions[c]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        for vi in (a, b, c):
            x, y, z = acc[vi]
            acc[vi] = (x + nx, y + ny, z + nz)
    out: list[tuple[float, float, float]] = []
    for x, y, z in acc:
        length = (x * x + y * y + z * z) ** 0.5
        out.append((0.0, 1.0, 0.0) if length < 1e-8 else (x / length, y / length, z / length))
    return out
