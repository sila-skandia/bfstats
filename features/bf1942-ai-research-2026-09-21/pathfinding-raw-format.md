# BF1942 pathfinding `.raw` search maps

**Rewritten 2026-09-24** (Brief M, ledger AI-102). The first version of this
page (2026-09-22) read the block records as "a literal negative cell value"
with nothing after it, sized a pixel at 64 m, and said the files are not
shipped. All three were wrong: a negative record is followed inline by the
block's 512 bytes, a level-0 pixel is one metre, and every level archive
with an `AI.con` ships its maps baked, which the retail server loads. The
2026-09-23 correction note (ledger AI-26) fixed the pixel size; AI-93 found
the inline blocks and the shipped maps; this page is the whole format as
read from the binary.

**Binary:** `bf1942_lnxded.static` (the Linux dedicated server; the corpus in
`features/bf1942-engine-reference/lnxded/`). Every claim below is read from
the decompile or the disassembly at the address given.

## Where the files come from

`AIpathFinding.con` declares each map:

```
ai.addSearchMap <name> <waterMap> <waterDepth> <maxSlope> <brush> <lowClip> <hiClip> <considerAITypes> [<minLevel> [<maxLevel>]]
```

* The console handler (`ConsoleClass344::executeObjectMethod` 0x084e4880)
  takes 8, 9 or 10 arguments; with 8 it passes `minLevel 0, maxLevel 2`
  (`push $0x2; push $0x0` at 0x084e4a02 / 0x084e4a09), with 9 `maxLevel 2`
  (0x084e499f). `AIConsole::addSearchMap` 0x0846d790 hands them on;
  `AIPathfinding::addSearchMap` 0x0847b0a0 builds a `LocalMapInfo`
  (0x0847a550), whose `LocalMap` (0x085fb590) keeps the two levels at +0x24 /
  +0x28 and builds one `CellMap` per level between them (inclusive), named
  `<name>Level<L>Map` (the strings `Level` 0x086f5ffa and `Map` 0x086b2e42),
  as `CellMap(name, L, 0, L + 6, sizeXBits, sizeZBits)`.
* `ai.loadMaps` (`AIConsole::loadMaps` 0x0846e2d0 -> `AIPathfinding::loadMaps`
  0x0847c580 -> `loadSearchMaps` 0x0847c5c0) loads every declared map, in
  order, from `<level dir>Pathfinding/` (0x086f3198): `LocalMap::loadRawFile`
  0x085fefb0 loads levels `minLevel .. maxLevel`, each through
  `CellMap::loadRawFile(string)` 0x085f8930, which appends `.raw`
  (0x087042ba) to the map's name.
* **Both loops stop at the first failure.** A missing file or a header that
  does not match the `CellMap` fails that level; the rest of that map and
  every map declared after it are not loaded and keep what the constructor
  gave them: every block the special cell 0, **all free** (`CellMap::CellMap`
  0x085f7af0 registers the special cells 0 and 0xffffffff and fills the block
  table with the first). `AIConsole::loadMaps` ignores the return value.

So `Tank0 ... 0 2` is `Tank0Level0Map.raw`, `Tank0Level1Map.raw`,
`Tank0Level2Map.raw`; `Boat2 1 5 0 125.0 0.3 2.5 0 2 5` is `Boat2Level2Map.raw`
.. `Boat2Level5Map.raw`, and the level archives that also carry
`Boat2Level0Map.raw` / `Level1` (Wake, Omaha) carry files the engine never
opens.

## The file

All little-endian.

### Header: five int32

| offset | value | checked against (`CellMap::loadRawFile` 0x085f8930) |
|---|---|---|
| 0x00 | `log2` blocks across | `CellMap+0x18` (`p6 - p5`) |
| 0x04 | `log2` blocks down | `CellMap+0x20` (`p7 - p5`) |
| 0x08 | the block's size exponent, `level + 6` | `CellMap+0x10` (`p5`) |
| 0x0c | the level | `CellMap+0x2c` (`p3`) |
| 0x10 | the bits-per-pixel exponent (0: one bit) | `CellMap+0x24` (`p4`) |

Any mismatch returns false before anything else is read. A block is `1 <<
(level + 6)` map units across and 64 pixels of `1 << level` units
(`LocalMap::getLevelPixelSize` 0x085ff170: `1 << level`). A map unit is a
metre when `aiSettings.setWorldMapSize` is the terrain size: in every
shipped file the blocks cover exactly `worldMapSize` (Bocage `5 5 6 0 0`,
2048 m; Kharkov `4 4 6 0 0`, 1024 m; Guadalcanal `6 6 6 0 0`, 4096 m; Wake's
`Boat2Level2Map` `3 3 8 2 0`, 8 blocks of 256 m).

### Special cells

An int32 count, then that many uint32 (`CellMap::addSpecialCell` 0x085f7f20
each). A special cell is one 32-bit word that stands for a whole block whose
every word is that value. The shipped files have two: 0 (all free) and
0xffffffff (all blocked), the two the constructor registers.

### Blocks

`(1 << across) * (1 << down)` records, row-major (x fastest):

* an int32 `>= 0`: the block is special cell `[value]`;
* an int32 `< 0`: the block has its own storage, allocated from the map's
  pool, and its bytes follow **inline**, `CellMap+0x4 << 2` of them
  (0x085f8930: `File::read(ptr, param_1[1] << 2)`), where `+0x4 = 1 << max(1,
  p4 - 5 + 2 * (p5 - p3))` (the constructor): `1 << 7` words, **512 bytes**,
  for a 64 x 64 one-bit block.

The file ends after the last record; there is nothing else.

### A pixel

`CellMap::getPixel` 0x085f9a00 for map position `(x, z)` (integer map units):

```
block = (x >> p5) + ((z >> p5) << (+0x20))           // row-major, square maps
col   = (x & ((1 << p5) - 1)) >> p3                   // 0..63
row   = (z & ((1 << p5) - 1)) >> p3
word  = ((row << (p5 - p3)) + col) >> (5 - p4)         // row * 2 + (col >> 5)
bit   = (col & 31)                                     // (+0x30 = p5 - p3 + p4 >= 5: no row term)
pixel = (block_word[word] >> bit) & 1                  // 1 blocked, 0 free
```

`x` is world x and `z` the engine's z (the viewer's glTF frame negates z).

## What the viewer does with them

* `tools/bf1942-models/extract_search_maps.py` (and every `extract_map.py`
  run) writes each level's loaded maps to `viewer/maps/<level>/pathfinding/`:
  the lowest level of each map exactly as the archive has it, and
  `index.json`, one row per declared map with its parameters, `loaded`, and
  `level` / `file` / `bytes` or the `reason` it would not load
  (`bf42/ai_level.py level_search_maps`, which applies the stop-at-first-failure
  rule above).
* `viewer/nav-baked.js` decodes them; `buildNavMap` (`nav-map.js`) takes the
  map whose six parameters are the call's (the referee's infantry call takes
  the level's infantry map) and paints only for a level with none.
* `bf42/ai_level.py read_search_map_raw` and `decode_pathfinding_raw.py` read
  the same layout in Python.

What was shipped on 2026-09-24: 271 of 277 published levels (vanilla 19 of
23, XPack1 6, XPack2 8 of 9, EoD 238 of 239), 796 maps, 66.8 MB; the six
without are the levels with no `AI.con` (Aberdeen, Coral Sea, Invasion of the
Philippines, Liberation of Caen, Raid on Agheila, EoD's Operation Linebacker).
Every declared map loads.

## The other files in `Pathfinding/`

`<type>.raw` (16,392 or 65,544 bytes), `<type>Info.raw` and, on Bocage,
`<name>LandMap.raw` sit beside the level maps. `ai.loadMaps`'s second half,
`AIPathfinding::loadSearchTypes` 0x0847c6b0, calls `StrategicMap::load` for
each `ai.addSearchType` from the same folder (with the same
stop-at-first-failure loop), so the `<type>` pair is INFERRED to be the
search type's strategic map; not read or decoded here.
