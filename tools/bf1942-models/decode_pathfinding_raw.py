#!/usr/bin/env python3
"""Decode a baked BF1942 search map, `Pathfinding/<name>Level<L>Map.raw`.

The format is in
`features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md`, read
from `bf1942_lnxded.static` (`CellMap::loadRawFile` 0x085f8930 /
0x085f86a0, `CellMap::getPixel` 0x085f9a00, `CellMap::CellMap`
0x085f7af0). In short:

* five int32: `log2` blocks across, `log2` blocks down, `level + 6` (the
  block's size exponent in map units), the level, the bits-per-pixel
  exponent (0: one bit a pixel);
* the special-cell count and the special cells, each a 32-bit word that
  fills every word of a block (0 all free, 0xffffffff all blocked);
* one int32 per block, row-major: `>= 0` an index into the special cells,
  `< 0` followed INLINE by the block's own 512 bytes (a 64 x 64 one-bit
  block: bit `col & 31` of word `row * 2 + (col >> 5)`, LSB first, 1
  blocked).

A level-L pixel is `1 << L` metres, x along world x and rows along the
engine's z. The `<name>Info.raw`, `<name>.raw` and `<name>LandMap.raw` files
beside the level maps have other layouts and are not decoded here.

Usage:

    python3 decode_pathfinding_raw.py Tank0Level0Map.raw
    python3 decode_pathfinding_raw.py Tank0Level0Map.raw --stats
    python3 decode_pathfinding_raw.py Tank0Level0Map.raw --grid 64     # ASCII, 64 columns
    python3 decode_pathfinding_raw.py Tank0Level0Map.raw --pgm out.pgm # one byte a pixel
    python3 decode_pathfinding_raw.py Tank0Level0Map.raw --json
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.ai_level import read_search_map_raw, search_map_header  # noqa: E402


def block_records(data: bytes) -> list[int]:
    """Each block's record as the file has it (special index, or -1 inline)."""
    wb, hb = struct.unpack_from("<2i", data, 0)
    (count,) = struct.unpack_from("<i", data, 20)
    off = 24 + 4 * count
    out = []
    for _ in range((1 << wb) * (1 << hb)):
        (rec,) = struct.unpack_from("<i", data, off)
        off += 4
        if rec < 0:
            off += 512
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--stats", action="store_true", help="block and pixel counts")
    ap.add_argument("--grid", type=int, metavar="COLS", default=0,
                    help="ASCII picture COLS characters wide ('#' any blocked pixel in the cell)")
    ap.add_argument("--pgm", type=Path, help="write the map as a binary PGM (0 blocked, 255 free)")
    ap.add_argument("--json", action="store_true", help="header, specials and block records as JSON")
    args = ap.parse_args()

    data = args.file.read_bytes()
    wb, hb, p5, level, bits = search_map_header(data)
    m = read_search_map_raw(data)
    (count,) = struct.unpack_from("<i", data, 20)
    specials = list(struct.unpack_from(f"<{count}I", data, 24))
    records = block_records(data)

    if args.json:
        print(json.dumps({
            "header": {"blocksXBits": wb, "blocksZBits": hb, "blockBits": p5, "level": level, "bitsExp": bits},
            "pixels": [m.width, m.height], "pixelMetres": 1 << level,
            "specialCells": specials, "blocks": records,
        }))
        return 0

    print(f"{args.file.name}: level {level}, {1 << wb} x {1 << hb} blocks of 64 x 64, "
          f"{m.width} x {m.height} pixels of {1 << level} m ({m.width << level} m square)")
    print(f"special cells: {', '.join(f'0x{v:08x}' for v in specials)}")

    if args.stats:
        inline = sum(1 for r in records if r < 0)
        by_special = {i: sum(1 for r in records if r == i) for i in range(count)}
        blocked = sum(1 for z in range(m.height) for x in range(m.width) if m.blocked(x, z))
        print(f"blocks: {len(records)}, inline {inline}, "
              + ", ".join(f"special {i} (0x{specials[i]:08x}) {n}" for i, n in by_special.items()))
        print(f"pixels blocked: {blocked} of {m.width * m.height} ({100 * blocked / (m.width * m.height):.1f} %)")

    if args.grid:
        step = max(1, m.width // args.grid)
        for z0 in range(0, m.height, step):
            row = []
            for x0 in range(0, m.width, step):
                hit = any(m.blocked(x, z) for z in range(z0, min(z0 + step, m.height))
                          for x in range(x0, min(x0 + step, m.width)))
                row.append("#" if hit else ".")
            print("".join(row))

    if args.pgm:
        pix = bytearray(m.width * m.height)
        for z in range(m.height):
            for x in range(m.width):
                pix[z * m.width + x] = 0 if m.blocked(x, z) else 255
        args.pgm.write_bytes(f"P5 {m.width} {m.height} 255\n".encode() + bytes(pix))
        print(f"wrote {args.pgm}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
