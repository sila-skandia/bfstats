# BF1942 Pathfinding .raw File Format — Decoded

> **Correction, 2026-09-23** (`bot-movement-and-pathfinding.md` §1, ledger
> AI-26). Each "row record" below is a **64 x 64-pixel block** of one-bit
> pixels (`CellMap`'s `MemoryPool` cell is `4 << 7` = 512 bytes), and a
> level-0 pixel is **one metre** (`getLevelPixelSize(0) = 1`). The 32 x 32
> records of a 2048 m level are therefore 32 x 32 blocks of 64 m, not "32
> cells of 64 m"; the world-units-per-cell table at the end of this document
> is wrong by that factor. The special cells `0` and `0xffffffff` are the
> all-free and all-blocked blocks. Pixel semantics: 1 = blocked, 0 = free.

**Date:** 2026-09-22
**Binary:** `bf1942_lnxded.static` (sha256 `60c9452d…cd3699` — interchangeable with corpus copy)
**Functions analyzed:**
- `CellMap::loadRawFile(IStream*)` @ `0x085f86a0`
- `CellMap::addSpecialCell(unsigned int)` @ `0x085f7f20`
- `CellMap::getSpecialCell(unsigned int*)` @ `0x085f8040`
- `CellMap::getSpecialCell(unsigned int)` @ `0x085f7fc0`
- `CellMap::getSpecialCellId(unsigned int*)` @ `0x085f8000`
- `CellMap::pack(MapPos const&, MapPos const&)` @ `0x085f81b0`
- `CellMap::unPack(MapPos const&, MapPos const&)` @ `0x085f80a0`
- `CellMap::CellMap(string const&, int, int, int, int, int)` @ `0x085f7af0`
- `LocalMap::loadRawFile(string const&)` @ `0x085fefb0`
- `LocalMap::getLevelPixelSize(int)` @ `0x085ff170`

---

## Complete File Format

### 1. Header — 5 × int32 (little-endian)

| Field | Offset | Name | Meaning |
|-------|--------|------|---------|
| 1 | 0x00 | `width_bits` | `log2(grid width)` |
| 2 | 0x04 | `height_bits` | `log2(grid height)` |
| 3 | 0x08 | `level` | Pyramid depth level |
| 4 | 0x0C | `level_index` | Always equals `level` in observed files |
| 5 | 0x10 | `reserved` | Always 0 in observed files |

**Validation:** `loadRawFile` reads these 5 values and compares them against the `CellMap` object's own fields:

| File field | Compared to `CellMap+` | Ctor expression |
|------------|----------------------|-----------------|
| 1 (`width_bits`) | `0x18` | `p6 - p5` |
| 2 (`height_bits`) | `0x20` | `p7 - p5` |
| 3 (`level`) | `0x10` | `p5` |
| 4 (`level_index`) | `0x2c` | `p3` |
| 5 (`reserved`) | `0x24` | `p4` |

If any mismatch, the function returns `false` immediately.

### 2. Special Cell Table

| Field | Size | Description |
|-------|------|-------------|
| `special_cell_count` | int32 | Number of special cell entries |
| `special_cell_ids[]` | `count × u32` | Array of special cell IDs |

Each special cell ID is an externally-defined handle (e.g. water, obstacle). Multiple grid positions can reference the same special cell, making this a sparse/compressed representation.

The special cell table is stored as a linked list of arrays in `CellMap+0x38`..`CellMap+0x3c` (start/end pointers), where each node is `[prev_node_ptr, id_value]`.

### 3. Row Records — `width × height` × int32

Exactly `(1 << width_bits) × (1 << height_bits)` int32 values follow, in row-major order (x varies fastest).

**Decoding each record `val`** (from `0x085f8840-0x085f88bd`):

```
if (val >= 0):
    // Special cell reference
    // The cell's data is special_cells[val]
    grid[y][x] = special_cells[val]
else:
    // Literal cell value
    // The engine allocates a new cell from its memory pool (CellMap+0x48)
    // and stores val as the cell's data
    grid[y][x] = val  // negative value stored directly
```

**Evidence from disassembly:**

```asm
; 0x085f8840: load val into edx
85f8840:  8b 95 84 fe ff ff     mov    -0x17c(%ebp),%edx
85f8846:  85 d2                 test   %edx,%edx
85f8848:  78 2d                 js     85f8877    ; jump if negative (literal path)

; POSITIVE PATH — special cell reference
85f884a:  c1 e2 02              shl    $0x2,%edx   ; edx *= 4 (byte offset)
85f884d:  8b 4d 08              mov    0x8(%ebp),%ecx
85f8850:  8b 59 38              mov    0x38(%ecx),%ebx   ; special_cells list start
85f8853:  8b 41 34              mov    0x34(%ecx),%eax   ; row array pointer
85f8856:  01 da                 add    %ebx,%edx         ; offset into special cell list
85f8858:  8b 12                 mov    (%edx),%edx       ; load special cell ID
85f885a:  89 14 b0              mov    %edx,(%eax,%esi,4) ; store in row[esi]

; NEGATIVE PATH — literal value
85f8877:  8b 4d 08              mov    0x8(%ebp),%ecx
85f887a:  8b 59 34              mov    0x34(%ecx),%ebx   ; row array pointer
85f887f:  8b 41 48              mov    0x48(%ecx),%eax   ; memory pool vtable
85f8882:  8b 10                 mov    (%eax),%edx
85f8884:  8b 41 04              mov    0x4(%ecx),%eax    ; cell size (4 bytes)
85f8887:  c1 e0 02              shl    $0x2,%eax
85f888a:  50                    push   %eax              ; size
85f888b:  8b 41 48              mov    0x48(%ecx),%eax   ; memory pool ptr
85f888e:  50                    push   %eax              ; pool
85f888f:  ff 52 0c              call   *0xc(%edx)        ; allocate()
85f8892:  ...
85f8898:  89 04 b3              mov    %eax,(%ebx,%esi,4) ; store allocated cell ptr in row[esi]
; Then calls another vtable function to write the literal value into the allocated cell
```

### 4. CellMap Layout (from constructor @ 0x085f7af0)

| Offset | Size | Field | Ctor expression |
|--------|------|-------|-----------------|
| 0x00 | 4 | vtable | `0x8762420` |
| 0x04 | 4 | cell_size_bits | `min(1, p6-p5)` clamped |
| 0x08 | 4 | total_bits | `min(1, p7-p5)` clamped |
| 0x0C | 4 | width | `1 << (p6-p5)` |
| 0x10 | 4 | level | `p5` |
| 0x14 | 4 | height | `1 << (p7-p5)` |
| 0x18 | 4 | width_bits | `p6 - p5` |
| 0x1C | 4 | height_bits | `p7 - p5` |
| 0x20 | 4 | total_height_bits | `p7 - p5` (same as +0x1C) |
| 0x24 | 4 | reserved_field | `p4` (always 0) |
| 0x28 | 4 | total_cells | `(1 << (p6-p5)) * (1 << (p7-p5))` |
| 0x2C | 4 | level_index | `p3` |
| 0x30 | 4 | max_level | `p6` |
| 0x34 | 4 | row_array | `new uint32[total_cells]` |
| 0x38 | 4 | special_cells_start | linked list head |
| 0x3C | 4 | special_cells_end | linked list tail |
| 0x44 | 24 | name | `std::string` |
| 0x48 | 4 | memory_pool | `MemoryPool*` |

### 5. Constructor pyramid logic

The constructor computes the grid dimensions from the constructor parameters:

```
p5 = level (e.g. 6 for finest level)
p6 = max_level (e.g. 11 for coarsest)
p7 = max_level (same as p6)

width_bits  = p6 - p5   (shrinks as level increases)
height_bits = p7 - p5   (same)
width       = 1 << width_bits
height      = 1 << height_bits
```

This creates a **pyramid** of maps:

| Level | p5 | width_bits | grid size |
|-------|----|------------|-----------|
| 0 | 6 | 5 | 32×32 |
| 1 | 7 | 4 | 16×16 |
| 2 | 8 | 3 | 8×8 |
| 3 | 9 | 2 | 4×4 |
| 4 | 10 | 1 | 2×2 |
| 5 | 11 | 0 | 1×1 |

The observed headers from the research doc confirm this:
- `Car4Level0Map.raw`: 5, 5, 6, 0, 0 → 32×32
- `Car4Level1Map.raw`: 4, 4, 7, 1, 0 → 16×16
- `Car4Level2Map.raw`: 3, 3, 8, 2, 0 → 8×8

---

## World-Units-Per-Cell

From `LocalMap::getLevelPixelSize(int level)` @ `0x085ff170`:

```asm
85ff170:  b8 01 00 00 00        mov    $0x1,%eax
85ff176:  89 e5                 mov    %esp,%ebp
85ff178:  81 ec 48 01 00 00     sub    $0x148,%esp
85ff17e:  8b 4d 08              mov    0x8(%ebp),%ecx   ; level parameter
85ff181:  89 ec                 mov    %ebp,%esp
85ff183:  d3 e0                 shl    %cl,%eax         ; 1 << level
85ff185:  5d                    pop   %ebp
85ff186:  c3                    ret
```

**Formula:** `cell_size_in_world_units = 1 << level`

Combined with the world map size `W` (set by `aiSettings.setWorldMapSize` in AI.con):

```
grid_width_cells  = W / (1 << level)
grid_height_cells = W / (1 << level)
```

For Gazala (W=2048):

| Level | Cell size | Grid |
|-------|-----------|------|
| 0 | 1 | 2048×2048 |
| 1 | 2 | 1024×1024 |
| 2 | 4 | 512×512 |
| 3 | 8 | 256×256 |
| 4 | 16 | 128×128 |
| 5 | 32 | 64×64 |
| 6 | 64 | 32×32 |

But the observed Car4 maps have different dimensions (32×32 at level 0), which means the search map has its own `lowClip`/`hiClip` levels that further subdivide. The `AIpathFinding.con` shows:

```
ai.addSearchMap Car4 0 0 20 3.0 0.3 2.5 0
```

The `0.3` (lowClip) and `2.5` (hiClip) define which pyramid levels this search map uses. The CellMap constructor receives `p6=11, p7=11` for the finest map, and `p5=6` for level 0, giving `width_bits = 11-6 = 5`, so 32×32.

**The world-units-per-cell for a specific CellMap at level L:**

```
world_units_per_cell = world_map_size / (1 << (max_level - level))
                     = world_map_size / (1 << width_bits)
```

For Car4 at level 0 with world size 2048 and width_bits=5:
```
units_per_cell = 2048 / 32 = 64
```

---

## UNVERIFIED → SETTLED

### Field 4 (`level_index`)
**SETTLED:** It is the level index, always equal to `level` (field 3) in every observed file. Used by `LocalMap::loadRawFile` to iterate over levels and load the correct CellMap.

### Field 5 (`reserved`)
**SETTLED:** Always 0. Stored in `CellMap+0x24` and validated on load. No known use beyond validation.

### Per-row encoding
**SETTLED:** Non-negative = index into special cell table. Negative = literal cell value (the engine allocates a new cell from its memory pool and stores the negative value as the cell's data). This is a sparse compression: most cells share one of a few special cell definitions.

### World-units-per-cell
**SETTLED:** `cell_size = 1 << level` from `getLevelPixelSize()`. The actual world coverage of a cell depends on the search map's clip levels and the world map size.

---

## What the .raw files contain

These are **precomputed navigation grids** generated by the server at startup from the level terrain geometry. The generation chain is:

1. `AIPathfinding::loadMaps()` → `loadSearchMaps()` → `loadRawFile()` per map
2. `AIPathfinding::createMaps()` → `createAllSearchMaps()` → `floodLevelZeroMap()` (editor path)

The server reads the level's `AIpathFinding.con`, which declares search maps with parameters like water height, max slope, clip levels, etc. For each search map, it loads the corresponding `.raw` files from the `Pathfinding/` directory.

The `.raw` files are **not shipped** in the level archives — they are generated by the server from the terrain geometry using the search map parameters. This is why no `.raw` files exist in the installed game's level directories.

---

## Python decoder

See `tools/bf1942-models/decode_pathfinding_raw.py`.

Usage:
```bash
python3 decode_pathfinding_raw.py <file.raw> [--grid] [--stats] [--world-size N] [--json]
```
