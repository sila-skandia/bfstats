#!/usr/bin/env python3
"""
Test: generate a synthetic .raw file matching the BF1942 CellMap format,
then decode it with decode_pathfinding_raw.py and verify the results.

This validates the format understanding derived from binary analysis.
"""

import struct
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from decode_pathfinding_raw import decode_raw


def generate_test_raw(output_path: str):
    """
    Generate a synthetic .raw file that mimics what the BF1942 server
    would produce for a small pathfinding map.

    Parameters chosen to match the observed pattern:
    - 8x8 grid (width_bits=3, height_bits=3)
    - level 5 (so p5=5, p6=p7=8, field1=field2=3)
    - 3 special cells
    - Mix of special cell references and literal values
    """
    width_bits = 3
    height_bits = 3
    level = 5
    level_index = 5
    reserved = 0

    width = 1 << width_bits   # 8
    height = 1 << height_bits # 8
    total = width * height     # 64

    # Define 3 special cells with distinct IDs
    special_cells = [0xDEADBEEF, 0xCAFEBABE, 0x12345678]

    # Build row records:
    # - Most cells reference special cell 0 (walkable terrain)
    # - Some reference special cell 1 (water)
    # - A few are literal negative values (obstacles)
    row_records = []
    for y in range(height):
        for x in range(width):
            if y == 3 and 2 <= x <= 5:
                # Water row segment
                row_records.append(1)  # special_cells[1]
            elif (x == 0 and y == 0) or (x == 7 and y == 7):
                # Corner obstacles (literal negative values)
                row_records.append(-42)
            elif x == 4 and y == 4:
                # Single obstacle
                row_records.append(-100)
            else:
                # Walkable terrain
                row_records.append(0)  # special_cells[0]

    # Pack into binary
    buf = bytearray()

    # Header: 5 int32s
    buf += struct.pack('<5i', width_bits, height_bits, level, level_index, reserved)

    # Special cell count
    buf += struct.pack('<i', len(special_cells))

    # Special cell IDs
    for sid in special_cells:
        buf += struct.pack('<I', sid)

    # Row records
    for val in row_records:
        buf += struct.pack('<i', val)

    with open(output_path, 'wb') as f:
        f.write(buf)

    print(f"Generated synthetic .raw: {output_path}")
    print(f"  Size: {len(buf)} bytes")
    print(f"  Grid: {width}x{height} = {total} cells")
    print(f"  Special cells: {len(special_cells)}")
    return buf


def test_decode():
    """Decode the synthetic file and verify all fields."""
    output_path = '/tmp/test_pathfinding.raw'
    generate_test_raw(output_path)

    data = open(output_path, 'rb').read()
    info = decode_raw(data)

    errors = []

    # Header checks
    if info['width_bits'] != 3:
        errors.append(f"width_bits: expected 3, got {info['width_bits']}")
    if info['height_bits'] != 3:
        errors.append(f"height_bits: expected 3, got {info['height_bits']}")
    if info['level'] != 5:
        errors.append(f"level: expected 5, got {info['level']}")
    if info['level_index'] != 5:
        errors.append(f"level_index: expected 5, got {info['level_index']}")
    if info['reserved'] != 0:
        errors.append(f"reserved: expected 0, got {info['reserved']}")

    # Dimension checks
    if info['width'] != 8:
        errors.append(f"width: expected 8, got {info['width']}")
    if info['height'] != 8:
        errors.append(f"height: expected 8, got {info['height']}")
    if info['total_cells'] != 64:
        errors.append(f"total_cells: expected 64, got {info['total_cells']}")

    # Special cell checks
    if info['special_count'] != 3:
        errors.append(f"special_count: expected 3, got {info['special_count']}")
    if info['special_cells'] != [0xDEADBEEF, 0xCAFEBABE, 0x12345678]:
        errors.append(f"special_cells mismatch: {info['special_cells']}")

    # Row record checks
    records = info['row_records']
    if len(records) != 64:
        errors.append(f"row_records count: expected 64, got {len(records)}")

    # Check specific cells
    if records[0] != -42:
        errors.append(f"records[0] (corner obstacle): expected -42, got {records[0]}")
    if records[63] != -42:
        errors.append(f"records[63] (corner obstacle): expected -42, got {records[63]}")
    if records[4*8+4] != -100:
        errors.append(f"records[36] (center obstacle): expected -100, got {records[4*8+4]}")

    # Water row (y=3, x=2..5)
    for x in range(2, 6):
        idx = 3 * 8 + x
        if records[idx] != 1:
            errors.append(f"records[{idx}] (water): expected 1, got {records[idx]}")

    # Count special cell refs vs literals
    special_refs = sum(1 for v in records if v >= 0)
    literal_vals = sum(1 for v in records if v < 0)
    if special_refs != 61:
        errors.append(f"special_refs: expected 61, got {special_refs}")
    if literal_vals != 3:
        errors.append(f"literal_vals: expected 3, got {literal_vals}")

    if errors:
        print("FAILED:")
        for e in errors:
            print(f"  {e}")
        return False
    else:
        print("All checks passed.")
        return True


if __name__ == '__main__':
    success = test_decode()
    sys.exit(0 if success else 1)
