#!/usr/bin/env python3
"""
BF1942 Pathfinding .raw file decoder

Decodes the precomputed navigation maps found in
Mods/<mod>/levels/<level>/Pathfinding/<VehicleType><N>Level<M>Map.raw

Binary analysis of bf1942_lnxded.static (CellMap::loadRawFile @ 0x085f86a0,
CellMap::addSpecialCell @ 0x085f7f20, CellMap::getSpecialCell @ 0x085f7fc0,
CellMap::getSpecialCellId @ 0x085f8000).

## File format

### Header (5 × int32, little-endian)

| Field | Offset | Meaning |
|-------|--------|---------|
| 1 | 0x00 | width_bits  = log2(grid width) |
| 2 | 0x04 | height_bits = log2(grid height) |
| 3 | 0x08 | level       = pyramid depth level (6 + level for vanilla) |
| 4 | 0x0C | level_index (same as field 3 in every observed file) |
| 5 | 0x10 | always 0 in every observed file |

Grid dimensions: width = 1 << field1, height = 1 << field2.
Total rows = (1 << field1) * (1 << field2) = 1 << (field1 + field2).

### Special cell table

| Field | Size |
|-------|------|
| special_cell_count | int32 |
| special_cell_ids   | special_cell_count × u32 |

Each u32 is a "special cell ID" — an externally defined cell handle
(e.g. a water cell, obstacle, etc.) that multiple grid positions can
reference.

### Row records

Exactly `width × height` int32 values follow, one per grid cell in
row-major order (x varies fastest).

For each row record `val`:

| Condition | Meaning |
|-----------|---------|
| `val >= 0` | Index into the special cell table. The cell data is `special_cells[val]`. |
| `val < 0`  | A literal cell value stored directly. The engine allocates a new cell from its memory pool and stores `val` as the cell's data. |

In other words, the grid is a sparse representation: most cells share
one of a few special cell definitions, and only the cells that differ
carry their own value (encoded as a negative int32).

## World-units-per-cell

From `LocalMap::getLevelPixelSize(int level)` @ 0x085ff170:

    pixel_size = 1 << level

The world size is set by `aiSettings.setWorldMapSize` in AI.con
(e.g. 2048 × 2048 for Gazala). At the finest level (level 0), each
cell covers `1 << 0 = 1` world unit. At level N, each cell covers
`1 << N` world units.

So for a search map at level L:
    cell_size_in_world_units = 1 << L

Combined with the world map size W:
    grid_width_cells  = W / (1 << L)
    grid_height_cells = W / (1 << L)

which matches the header: field1 = field2 = log2(W) - L.

## Usage

    python3 decode_pathfinding_raw.py <file.raw> [--grid] [--stats] [--world-size N]

Examples:
    python3 decode_pathfinding_raw.py Car4Level0Map.raw
    python3 decode_pathfinding_raw.py Car4Level0Map.raw --grid --world-size 2048
    python3 decode_pathfinding_raw.py Car4Level0Map.raw --stats
"""

import struct
import sys
import argparse
from pathlib import Path


def decode_raw(data: bytes):
    """Parse a .raw file and return structured data."""
    if len(data) < 20:
        raise ValueError(f"File too short: {len(data)} bytes (need >= 20)")

    # Header: 5 int32s
    f1, f2, f3, f4, f5 = struct.unpack_from('<5i', data, 0)

    width_bits = f1
    height_bits = f2
    level = f3
    level_index = f4
    reserved = f5

    width = 1 << width_bits
    height = 1 << height_bits
    total_cells = width * height

    offset = 20

    # Special cell count
    special_count = struct.unpack_from('<i', data, offset)[0]
    offset += 4

    # Special cell IDs
    special_cells = list(struct.unpack_from(f'<{special_count}I', data, offset))
    offset += special_count * 4

    # Row records
    remaining = len(data) - offset
    expected_bytes = total_cells * 4
    if remaining != expected_bytes:
        raise ValueError(
            f"Expected {expected_bytes} bytes for {total_cells} row records, "
            f"got {remaining}"
        )

    row_records = list(struct.unpack_from(f'<{total_cells}i', data, offset))

    return {
        'width_bits': width_bits,
        'height_bits': height_bits,
        'level': level,
        'level_index': level_index,
        'reserved': reserved,
        'width': width,
        'height': height,
        'total_cells': total_cells,
        'special_count': special_count,
        'special_cells': special_cells,
        'row_records': row_records,
    }


def print_header(info: dict, world_size: int | None = None):
    """Print human-readable header summary."""
    print(f"=== Pathfinding .raw file ===")
    print(f"Width bits:  {info['width_bits']}  -> width  = {info['width']} cells")
    print(f"Height bits: {info['height_bits']}  -> height = {info['height']} cells")
    print(f"Level:       {info['level']}")
    print(f"Level index: {info['level_index']}")
    print(f"Reserved:    {info['reserved']}")
    print(f"Total cells: {info['total_cells']}")
    print(f"Special cells: {info['special_count']}")

    if world_size is not None:
        cell_size = 1 << info['level']
        print(f"\nWorld size: {world_size}")
        print(f"Cell size: {cell_size} world units")
        print(f"Grid covers: {info['width'] * cell_size} x {info['height'] * cell_size} world units")

    if info['special_cells']:
        print(f"\nSpecial cell IDs:")
        for i, sid in enumerate(info['special_cells']):
            print(f"  [{i}] = 0x{sid:08X} ({sid})")


def print_stats(info: dict):
    """Print statistics about the grid."""
    records = info['row_records']
    total = len(records)

    # Count special cell references vs literal values
    special_refs = sum(1 for v in records if v >= 0)
    literal_vals = sum(1 for v in records if v < 0)

    print(f"\n=== Grid Statistics ===")
    print(f"Total cells: {total}")
    print(f"Special cell references (>=0): {special_refs} ({100*special_refs/total:.1f}%)")
    print(f"Literal values (<0): {literal_vals} ({100*literal_vals/total:.1f}%)")

    if special_refs > 0:
        # Distribution of special cell indices
        from collections import Counter
        spec_vals = [v for v in records if v >= 0]
        counter = Counter(spec_vals)
        print(f"\nSpecial cell usage:")
        for idx, count in counter.most_common():
            sid = info['special_cells'][idx] if idx < len(info['special_cells']) else 'OUT OF RANGE'
            print(f"  [{idx}] (ID=0x{sid:08X}): {count} cells ({100*count/total:.1f}%)")

    if literal_vals > 0:
        lit_vals = [v for v in records if v < 0]
        print(f"\nLiteral value range: {min(lit_vals)} to {max(lit_vals)}")
        # Show most common literal values
        from collections import Counter
        lit_counter = Counter(lit_vals)
        print(f"Most common literal values:")
        for val, count in lit_counter.most_common(10):
            print(f"  {val}: {count} cells")


def print_grid(info: dict, max_width: int = 80):
    """Print an ASCII representation of the grid."""
    width = info['width']
    height = info['height']
    records = info['row_records']
    special_cells = info['special_cells']

    # Build a mapping from cell value to a character
    # Collect all unique values
    unique_vals = set()
    for v in records:
        if v >= 0 and v < len(special_cells):
            unique_vals.add(('S', special_cells[v]))
        else:
            unique_vals.add(('L', v))

    # Assign characters
    chars = {}
    char_set = ' .:-=+*#%@'
    for i, key in enumerate(sorted(unique_vals)):
        chars[key] = char_set[i % len(char_set)]

    # Print grid
    print(f"\n=== Grid ({width}x{height}) ===")
    print("Legend:")
    for key, ch in sorted(chars.items(), key=lambda x: x[1]):
        if key[0] == 'S':
            print(f"  '{ch}' = special cell 0x{key[1]:08X}")
        else:
            print(f"  '{ch}' = literal {key[1]}")

    print()
    for y in range(height):
        row_chars = []
        for x in range(width):
            idx = y * width + x
            v = records[idx]
            if v >= 0 and v < len(special_cells):
                key = ('S', special_cells[v])
            else:
                key = ('L', v)
            row_chars.append(chars.get(key, '?'))
        print(''.join(row_chars))


def main():
    parser = argparse.ArgumentParser(description='Decode BF1942 pathfinding .raw files')
    parser.add_argument('file', help='Path to .raw file')
    parser.add_argument('--grid', action='store_true', help='Print ASCII grid')
    parser.add_argument('--stats', action='store_true', help='Print grid statistics')
    parser.add_argument('--world-size', type=int, default=None,
                        help='World map size in units (e.g. 2048)')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    args = parser.parse_args()

    data = Path(args.file).read_bytes()
    info = decode_raw(data)

    if args.json:
        import json
        # Convert to JSON-safe format
        output = {
            'header': {
                'width_bits': info['width_bits'],
                'height_bits': info['height_bits'],
                'level': info['level'],
                'level_index': info['level_index'],
                'reserved': info['reserved'],
            },
            'dimensions': {
                'width': info['width'],
                'height': info['height'],
                'total_cells': info['total_cells'],
            },
            'special_cells': info['special_cells'],
            'row_records': info['row_records'],
        }
        print(json.dumps(output, indent=2))
        return

    print_header(info, world_size=args.world_size)

    if args.stats:
        print_stats(info)

    if args.grid:
        print_grid(info)


if __name__ == '__main__':
    main()
