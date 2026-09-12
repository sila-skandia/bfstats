"""Turn a BF1942 heightmap into textured terrain tiles.

Each Tx tile covers a 256 m patch. Vertices sit on the 4 m heightmap grid
(worldSize / dim), which is how Battlecraft and the Blender importer place them.
Height is `sample / 65535 * 256 * yScale` — 16-bit samples with yScale 0.6 top
out at 153.6 m, matching object `absolutePosition` Y on Tobruk to a few centimetres.

Patches without a shipped Tx tile are not holes: the engine paints them with the
level's `Textures/terrainDefault.dds` (Wake ships 16 island tiles on an 8x8 patch
world; the other 48 patches are sea floor). `default_patches` lists them and
`patch_mesh` builds the same grid with a wrapping UV so the small default texture
repeats instead of stretching.
"""

from __future__ import annotations

import math

from . import gltf, stdmesh
from .level import PATCH_METERS, Heightmap, TerrainInfo, tile_world_origin

# One 256 m patch repeats the detail map this many times. Mid-grey (128) is identity.
DETAIL_REPEATS = 16.0
# terrainDefault.dds is 64px; repeating it 4x per patch keeps its texel density
# (1 m/texel) in the same family as a 1024px Tx tile (0.25 m/texel).
DEFAULT_TILE_REPEATS = 4.0


def _grid_mesh(heightmap: Heightmap, x0: float, z0: float,
               patch: float, uv_repeats: float = 1.0) -> gltf.Primitive | None:
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
            # DDS row 0 is the tile's *south* edge (z = z0), so world +z walks
            # down the stored image and glTF V (0 = image top) runs with iz.
            # Getting this backwards mirrors every tile north-south: featureless
            # sand hides it, but baked road and shadow art lands mirrored inside
            # its own 256 m tile - a base's ground shadow appears as the inverse
            # of a base elsewhere - and every tile row boundary becomes a hard
            # seam. Proven by stitching the raw tiles into a mosaic both ways
            # against Tobruk's own InGameMap.dds: only this orientation is
            # continuous across rows.
            uvs.append((ix / cells * uv_repeats, iz / cells * uv_repeats))

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


def tile_mesh(heightmap: Heightmap, info: TerrainInfo, col: int, row: int,
              patch: float = PATCH_METERS) -> gltf.Primitive | None:
    x0, z0 = tile_world_origin(info.tex_offset_x, info.tex_offset_y, col, row, patch)
    return _grid_mesh(heightmap, x0, z0, patch)


def default_patches(info: TerrainInfo, tiles: list[tuple[int, int]],
                    patch: float = PATCH_METERS) -> list[tuple[int, int]]:
    """World patch indices with no shipped Tx tile, in world (col, row) terms."""
    per_axis = max(1, int(round(info.world_size / patch)))
    covered: set[tuple[int, int]] = set()
    for col, row in tiles:
        x0, z0 = tile_world_origin(info.tex_offset_x, info.tex_offset_y, col, row, patch)
        covered.add((int(round(x0 / patch)), int(round(z0 / patch))))
    return [
        (col, row)
        for row in range(per_axis)
        for col in range(per_axis)
        if (col, row) not in covered
    ]


def patch_mesh(heightmap: Heightmap, world_col: int, world_row: int,
               patch: float = PATCH_METERS,
               uv_repeats: float = DEFAULT_TILE_REPEATS) -> gltf.Primitive | None:
    """A terrain patch addressed by world grid index, UVs wrapping `uv_repeats` times."""
    return _grid_mesh(heightmap, world_col * patch, world_row * patch, patch, uv_repeats)


def water_mesh(info: TerrainInfo, tiles: list[tuple[int, int]],
               patch: float = PATCH_METERS,
               bounds: tuple[float, float, float, float] | None = None,
               ) -> gltf.Primitive | None:
    """A flat quad at `waterLevel`. `bounds` overrides the shipped-tile extent —
    the engine's water covers the whole world grid, not just textured patches."""
    if bounds is not None:
        x0, z0, x1, z1 = bounds
    else:
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


def depth_map(heightmap: Heightmap, water_level: float,
              ) -> tuple[int, bytes, float] | None:
    """Water depth under every heightmap sample as an RGBA image.

    Returns `(dim, rgba, max_depth)`; a texel is `depth / max_depth * 255` in
    R=G=B with opaque alpha, so the viewer recovers metres as
    `sample * max_depth`. The image covers world 0..worldSize on both axes, row
    0 at z=0 — the same orientation the tile UVs use after the glTF Z mirror.
    None when the water plane sits at or below every sample (a dry level).
    """
    dim = heightmap.dim
    scale = 256.0 * heightmap.y_scale / 65535.0
    depths = [max(0.0, water_level - s * scale) for s in heightmap.samples]
    max_depth = max(depths)
    if max_depth <= 0.0:
        return None
    rgba = bytearray(dim * dim * 4)
    for i, d in enumerate(depths):
        v = int(d / max_depth * 255.0 + 0.5)
        j = i * 4
        rgba[j] = rgba[j + 1] = rgba[j + 2] = v
        rgba[j + 3] = 255
    return dim, bytes(rgba), max_depth


def sky_primitives(mesh: "stdmesh.StandardMesh", rot_angle: float = 0.0,
                   ) -> list[tuple[str, gltf.Primitive]]:
    """The sky box's lod0 quads as primitives, `(material_name, primitive)` each.

    `Sky.setRotAngle` (180 on every vanilla level) is baked into the positions:
    a rotation about +Y survives the exporter's Z mirror with only its sense
    flipped, and baking sidesteps carrying a convention in scene extras. The sky
    is unlit (`lighting false` in every Sky_*.rs), so no normals are emitted.
    """
    lod = mesh.lod0
    if lod is None:
        return []
    a = math.radians(rot_angle)
    cos_a, sin_a = math.cos(a), math.sin(a)
    out: list[tuple[str, gltf.Primitive]] = []
    for material in lod.materials:
        positions = [
            (x * cos_a + z * sin_a, y, z * cos_a - x * sin_a)
            for x, y, z in material.positions()
        ]
        triangles = material.triangles()
        indices = [i for tri in triangles for i in tri]
        out.append((material.name, gltf.Primitive(
            positions=positions, indices=indices, uvs=material.uvs(),
        )))
    return out


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
