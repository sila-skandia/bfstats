"""The terrain's shade: what `PatchTerrain::getIntensity` answers at a point.

An object with no lightmap of its own (a grass field, a bush, a fence, a
vehicle) is drawn by the fixed-function path and then multiplied by a colour
the object carries (ledger DL-10): `clamp(Terrain.shadowAmbient +
template.shadowAmbient + intensity, 0, 255) / 255`, where `intensity` is 255
in the open and, where the ground it stands on is in baked shadow, the
luminance of the ground's own colour texture there (DL-11). This module is the
terrain half: the level's `Textures/LightmapShadowBits.lsb` and its `TxCCxRR`
tiles read the way the client reads them, written as the two files the viewer
answers the same question from: the bits themselves, and one small image of
the shadowed ground's luminance.

`LightmapShadowBits.lsb` (client `0x006978a0`, per patch, world rows outer and
columns inner, only the patches inside the tile window):

    u32 width            0 = this patch has no bits, and nothing follows
    u32 height
    u32 extraRuns[height]
    per row: u16 run, then extraRuns[row] more u16 runs

A run's low 13 bits are its length in texels and bit 13 says "in shadow"
(`PatchTerrain::getLightmapBit`, client `0x00680670`, lnxded `0x083d6340`).

Where the bit is set the client reads the 4x4 DXT1 block of the patch's `Tx`
tile under the point, decodes its sixteen texels with its own decoder
(`0x006806f0`: five- and six-bit channels shifted up, not replicated, and the
two middle colours always the thirds, whatever the endpoints' order) and
returns `0.30 R + 0.59 G + 0.11 B` of their mean (`0x00680e50`). A tile that
is not DXT1, a patch without bits and a point off the terrain all answer 255.
"""

from __future__ import annotations

import struct
import zlib

from .level import patch_grid, tile_in_window

# One cell of the luminance image, metres. The bits are 1024 a patch (a quarter
# of a metre on a 256 m patch) and decide shadow or not for the one point
# under an object's origin, so they are shipped whole; a tile's DXT1 blocks
# are 1 m, and a cell carries the mean of its shadowed ones.
CELL_METERS = 2.0

LIT = 255

# What `PatchTerrain`'s constructor leaves in the four words `Init/Terrain.con`
# can set (client `0x00684a00`..`0x00684a7d`).
DEFAULT_SHADOW_AMBIENT = (10.0, 10.0, 10.0)
DEFAULT_CULL_BOX = (5.0, 5.0, 5.0)
DEFAULT_FADE_TIME = 0.5
DEFAULT_CULL_Y = 15.0


def window(tex_offset: int, per_axis: int) -> list[int | None]:
    """For each world patch on one axis, the file tile the client asks for,
    None where it draws the default texture (`tile_in_window`, TERR-2)."""
    out: list[int | None] = []
    for world in range(per_axis):
        index = world - max(tex_offset, 0)
        out.append(index if tile_in_window(tex_offset, index, per_axis) else None)
    return out


def parse_lsb(data: bytes, cols: list[int | None], rows: list[int | None],
              ) -> dict[tuple[int, int], tuple[int, int, list[tuple[int, ...]]]]:
    """`{(world col, world row): (width, height, runs per row)}`.

    A file that ends early (or a level whose window this reader has wrong)
    keeps the patches read so far: the rest answer 255, as a patch without
    bits does.
    """
    out: dict[tuple[int, int], tuple[int, int, list[tuple[int, ...]]]] = {}
    at = 0
    try:
        for row, file_row in enumerate(rows):
            for col, file_col in enumerate(cols):
                if file_row is None or file_col is None:
                    continue
                (width,) = struct.unpack_from("<I", data, at)
                at += 4
                if width == 0:
                    continue
                (height,) = struct.unpack_from("<I", data, at)
                at += 4
                if width > 0x1fff * 64 or height > 0x10000:
                    raise ValueError(f"implausible patch {width}x{height}")
                extra = struct.unpack_from(f"<{height}I", data, at)
                at += 4 * height
                lines = []
                for count in extra:
                    lines.append(struct.unpack_from(f"<{count + 1}H", data, at))
                    at += 2 * (count + 1)
                out[(col, row)] = (width, height, lines)
    except (struct.error, ValueError):
        pass
    return out


def run_bit(runs: tuple[int, ...], x: int) -> int:
    """`getLightmapBit`'s walk: the first run whose running length reaches
    `x`, the last one when none does."""
    total = 0
    word = runs[0]
    for word in runs:
        total += word & 0x1fff
        if total >= x:
            break
    return (word >> 13) & 1


class Dxt1:
    """A `Tx` tile as the client reads it: top mip, one luminance a block."""

    def __init__(self, data: bytes) -> None:
        if data[:4] != b"DDS " or data[84:88] != b"DXT1":
            raise ValueError("not a DXT1 dds")
        self.height, self.width = struct.unpack_from("<II", data, 12)
        self.blocks_x = self.width >> 2
        self.blocks_y = self.height >> 2
        if len(data) < 128 + self.blocks_x * self.blocks_y * 8:
            raise ValueError("short dds")
        self._data = data
        self._cache: dict[int, float] = {}

    def luma(self, bx: int, by: int) -> float:
        index = by * self.blocks_x + bx
        value = self._cache.get(index)
        if value is None:
            value = self._cache[index] = block_luma(self._data, 128 + index * 8)
        return value


def block_luma(data: bytes, at: int) -> float:
    c0, c1, bits = struct.unpack_from("<HHI", data, at)
    r0, g0, b0 = (c0 >> 11) << 3, ((c0 >> 5) & 63) << 2, (c0 & 31) << 3
    r1, g1, b1 = (c1 >> 11) << 3, ((c1 >> 5) & 63) << 2, (c1 & 31) << 3
    palette = (
        (r0, g0, b0), (r1, g1, b1),
        ((r1 + 2 * r0) // 3, (g1 + 2 * g0) // 3, (b1 + 2 * b0) // 3),
        ((r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3, (b0 + 2 * b1) // 3),
    )
    counts = [0, 0, 0, 0]
    for _ in range(16):
        counts[bits & 3] += 1
        bits >>= 2
    red = green = blue = 0
    for count, (r, g, b) in zip(counts, palette):
        red += count * r
        green += count * g
        blue += count * b
    return (0.30 * red + 0.59 * green + 0.11 * blue) / 16.0


def shadowed_blocks(width: int, height: int, lines: list[tuple[int, ...]],
                    blocks_x: int, blocks_y: int) -> bytearray:
    """One byte a DXT1 block of the patch's tile: 1 where any texel of the
    bits under it is in shadow. A run answers for the texels
    `previous total + 1 .. its total` (`run_bit`), the first also for 0."""
    marks = bytearray(blocks_x * blocks_y)
    for y, runs in enumerate(lines):
        if len(runs) == 1 and not (runs[0] >> 13) & 1:
            continue
        base = min(blocks_y - 1, y * blocks_y // height) * blocks_x
        total = 0
        first = 0
        for word in runs:
            total += word & 0x1fff
            if (word >> 13) & 1:
                last = min(width - 1, total)
                if first <= last:
                    b0 = first * blocks_x // width
                    b1 = last * blocks_x // width
                    marks[base + b0:base + b1 + 1] = b"\x01" * (b1 - b0 + 1)
            first = total + 1
    return marks


def shade_layer(world_size: float, heightmap_dim: int,
                tex_offset_x: int, tex_offset_y: int,
                lsb: bytes, read_tile, cell: float = CELL_METERS,
                ) -> tuple[int, bytearray, bytes, dict]:
    """`(side, luma, bits, stats)`.

    `luma` is one byte a `cell` of the world, row 0 at z = 0: the mean
    luminance of the shadowed ground in that cell (the blocks of its tile
    with a set bit under them), 255 where the cell has none.

    `bits` is the level's shadow bits themselves, for the exact question
    "is this point in shadow" (`pack_bits`), kept only for the patches whose
    tile the client can read a luminance from.

    `read_tile(file_col, file_row)` returns the tile's dds bytes or None.
    """
    per_axis, patch = patch_grid(world_size, heightmap_dim)
    cols = window(tex_offset_x, per_axis)
    rows = window(tex_offset_y, per_axis)
    bits = parse_lsb(lsb, cols, rows)
    per_patch = max(1, int(round(world_size / cell)) // per_axis)
    side = per_patch * per_axis
    field = bytearray([LIT]) * (side * side)
    kept: dict[tuple[int, int], tuple[int, int, list[tuple[int, ...]]]] = {}
    shaded = 0
    total = 0.0
    for (col, row), (width, height, lines) in sorted(bits.items()):
        tile = None
        blob = read_tile(cols[col], rows[row])
        if blob is not None:
            try:
                tile = Dxt1(blob)
            except ValueError:
                tile = None
        if tile is None:
            continue
        kept[(col, row)] = (width, height, lines)
        bx, by = tile.blocks_x, tile.blocks_y
        marks = shadowed_blocks(width, height, lines, bx, by)
        if not any(marks):
            continue
        for j in range(per_patch):
            y0, y1 = j * by // per_patch, max(j * by // per_patch + 1, (j + 1) * by // per_patch)
            base = (row * per_patch + j) * side + col * per_patch
            for i in range(per_patch):
                x0, x1 = i * bx // per_patch, max(i * bx // per_patch + 1, (i + 1) * bx // per_patch)
                count = 0
                value = 0.0
                for yy in range(y0, y1):
                    line = yy * bx
                    if 1 not in marks[line + x0:line + x1]:
                        continue
                    for xx in range(x0, x1):
                        if marks[line + xx]:
                            count += 1
                            value += tile.luma(xx, yy)
                if count:
                    value /= count
                    field[base + i] = min(LIT - 1, int(value + 0.5))
                    shaded += 1
                    total += value
    stats = {
        "patches": len(bits),
        "tiles": len(kept),
        "shaded": shaded / float(side * side),
        "meanLuma": (total / shaded) if shaded else None,
    }
    return side, field, pack_bits(per_axis, patch, kept), stats


BITS_MAGIC = b"BFSB"


def pack_bits(per_axis: int, patch: float,
              bits: dict[tuple[int, int], tuple[int, int, list[tuple[int, ...]]]]) -> bytes:
    """The shadow bits, laid out for a reader that seeks:

        "BFSB", u32 version (1), u32 patches per axis, f32 metres a patch
        u32 offset[per axis * per axis]     row-major; 0 = no bits
        per patch: u32 width, u32 height, u32 rowOffset[height + 1],
                   then every row's u16 runs (the file's own words)

    Offsets are bytes from the start. Little endian.
    """
    head = 16 + 4 * per_axis * per_axis
    table = [0] * (per_axis * per_axis)
    body = bytearray()
    for (col, row), (width, height, lines) in sorted(bits.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        start = head + len(body)
        table[row * per_axis + col] = start
        at = start + 8 + 4 * (height + 1)
        offsets = []
        for runs in lines:
            offsets.append(at)
            at += 2 * len(runs)
        offsets.append(at)
        body += struct.pack("<II", width, height)
        body += struct.pack(f"<{height + 1}I", *offsets)
        for runs in lines:
            body += struct.pack(f"<{len(runs)}H", *runs)
    return (BITS_MAGIC + struct.pack("<IIf", 1, per_axis, patch)
            + struct.pack(f"<{len(table)}I", *table) + bytes(body))


def packed_bit(packed: bytes, x: float, z: float) -> int:
    """`getLightmapBit` over `pack_bits`' bytes at a world point: the reader
    `viewer/terrain-shade.js` is the port of."""
    _version, per_axis, patch = struct.unpack_from("<IIf", packed, 4)
    if x < 0 or z < 0:
        return 0
    col, row = int(x / patch), int(z / patch)
    if col >= per_axis or row >= per_axis:
        return 0
    (start,) = struct.unpack_from("<I", packed, 16 + 4 * (row * per_axis + col))
    if not start:
        return 0
    width, height = struct.unpack_from("<II", packed, start)
    px = int(width * ((x - col * patch) / patch))
    py = min(height - 1, int(height * ((z - row * patch) / patch)))
    r0, r1 = struct.unpack_from("<II", packed, start + 8 + 4 * py)
    return run_bit(struct.unpack_from(f"<{(r1 - r0) // 2}H", packed, r0), px)


BYTES_WIDE = 2048


def bytes_png(data: bytes) -> tuple[bytes, int]:
    """Bytes as the grey pixels of a PNG `BYTES_WIDE` across (the last row
    padded with zeros): a browser canvas hands them back exactly, and the
    PNG's own deflate is the transfer encoding."""
    rows = max(1, -(-len(data) // BYTES_WIDE))
    return grey_png(BYTES_WIDE, rows, data + bytes(rows * BYTES_WIDE - len(data))), rows


def grey_png(width: int, height: int, pixels: bytes) -> bytes:
    """An 8-bit greyscale PNG, filter 0, row 0 first."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += pixels[y * width:(y + 1) * width]

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xffffffff))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))
