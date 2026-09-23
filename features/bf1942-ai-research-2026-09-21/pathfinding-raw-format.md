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

## The strategic maps: `<type>.raw` and `<type>Info.raw`

Read 2026-09-24 (Brief O, ledger AI-117).

### Which files load

`ai.addSearchType <name> [map] [level]` (`ConsoleClass343::executeObjectMethod`
0x084e3c40 passes -1 for a missing map and a missing level) goes through
`AIConsole::addSearchType` 0x0846dcc0 (refuses a map index past the maps
declared so far, -1 excepted) to `AIPathfinding::addSearchType` 0x0847ae80,
which refuses a level below the map's own `minLevel` (the `LocalMapInfo`
+0x144, compared unsigned, so -1 passes) and otherwise appends a
`VehicleInfo` to +0x20. The first type naming a (map, level) pair also
creates a `VehicleMapInfo` (+0x14; ctor 0x0847a690): the pathfinding
`Vehicle` (`Vehicle::Vehicle` 0x0860b2c0: +0xc4a4 the level, +0xc4a8 the
map's `maxLevel`) and a `StrategicMap` named after that type (ctor
0x08607bf0). A map of -1 is a type with no map.

`AIPathfinding::loadMaps` 0x0847c580 is `loadSearchMaps() &&
loadSearchTypes()` (vtable +0x100 / +0x104), so no strategic map loads when a
search map failed. `loadSearchTypes` 0x0847c6b0 calls `StrategicMap::load`
0x08609b60 on each `VehicleMapInfo` in order from the same
`<level>Pathfinding/` folder, and stops at the first failure: the maps after
it keep the constructor's zeroed cells (no region used, so no route).

A unit names its type by number: `aiTemplatePlugIn.vehicleNumber` is the
Mobile plug-in's +4 (`AITemplateMobile` ctors 0x085e0b90 / 0x085e0bf0), an
index into the kept `VehicleInfo` list (`AIObjectMobile::init` 0x085d54b0
passes it to `isVehicleUsed` 0x0847b150 and `isValidPosition`;
`BotMain::initPathfinding` 0x0852a0d0 searches with it). Every vanilla land
vehicle, jeeps included, has 0; the soldier 1; the ships 2; the landing craft
3; XPack2's LVT4 and Schwimmwagen 4; aircraft -1.

### `<type>.raw`: the cells

`StrategicMap::load` 0x08609b60 (and `save` 0x08609950): `<name>` + `.raw`
(0x087042ba).

| offset | value |
|---|---|
| 0x00 | int32 `w`, checked against the map's `1 << (sizeXBits - 6)` (+0x18) |
| 0x04 | int32 `h`, against +0x1c |
| 0x08 | `w x h` cells of 16 bytes, row-major along the engine's z (read into `+0x4 + ((z << +0x10) + x) * 16`) |

A cell is one 64 m square (`getPosition` 0x08480ed0 adds a 0..63 offset to
`x & ~63`), holding up to four regions:

| bytes | meaning |
|---|---|
| 0..3 | uint32 links: bit `4 i + k` joins region i to region k of the cell at +z; bit `16 + 4 i + k` joins it to region k of the cell at +x (`AStarStrategicSearch::newPositionAndCost` 0x085f73b0; the -z and -x steps read the neighbour's bits with i and k swapped, and need the neighbour to use region k) |
| 4 + 2k, 5 + 2k | region k's point inside the cell, `x & 0x3f`, `z & 0x3f` (`StrategicCell::getPositionX/Z` 0x085f7ab0 / 0x085f7ad0) |
| 4, bit 6 | the cell has more regions than four: an Info pixel of 3 may belong to none (below) |
| 12, bits 4..7 | region k is used (`isUsed` 0x08480e30) |
| 13..15 | not read (0 in every shipped cell but one) |

### `<type>Info.raw`: the regions

`CellMap(name + "Info", level + 1, 1, 6, sizeXBits, sizeZBits)` (the
`StrategicMap` ctor; `Info` is 0x086d57f3), loaded by `CellMap::loadRawFile`
0x085f8930 from `<name>Info.raw`: the `CellMap` file above with the bits
exponent 1 (two bits a pixel), a pixel `2^(level + 1)` m, a block 64 m (256
bytes when inline). The pixel is the region number. Bocage's `TankInfo.raw`
header is `5 5 6 1 1`.

`StrategicMap::getStrategicCellInfoNo` 0x08608fa0 for a map position: -1 on
a pixel the unit's own lowest-level map blocks (`Vehicle::getMinLevelMap`
0x0860b820); else the Info pixel; a 3 in a cell with the byte-4 bit 6 set
stands only when a four-connected flood of the free pixels inside the cell
reaches region 3's point (`flooder<FlooderWrapperRT>` 0x0860a610), else -1.

### How a route uses it

`BotMain::initPathfinding` 0x0852a0d0: the goal must be free on the unit's
map (`isValidPosition` vt+0x78) and have a region (`getEncodedMapPos`
vt+0x90 -> `VehicleInfo::getEncodedMapPos` 0x08481430), or there is no path;
the start likewise, from the last valid position (Information vt+0x20) when
it stands on a blocked pixel. `BotMain::updateStrategicPath` 0x08526e60:
start and goal in the same used region of the same cell
(`isInSameStrategicArea` 0x0847cb10) need no strategic path; otherwise
`AIPathfinding::strategicSearch` 0x0847dae0 runs `AStarStrategicSearch`:
nodes are (cell, region) at the region's point (`init` 0x085f6f70), a step
costs the Manhattan distance between points, the heuristic is the Manhattan
distance to the goal's point (`distanceEstimateToGoal` 0x085f72f0), the goal
is the goal's (cell, region) (`isGoal` 0x085f71a0, radius `round(0.01 x 5)`
= 0), with no box. The path's first node is dropped, and the next too when it
is the only one left; `updateLocalPath` 0x08527120 refines toward each
remaining node's point (`getStrategicPositionFromEncMapPos` vt+0x98) and last
toward the goal.

### Shipped

794 strategic maps on the 271 levels with search maps (vanilla 19, XPack1 6,
XPack2 8, EoD 238), 41.0 MB, 15 KB .. 2.0 MB a level (median 108 KB). Every
one loads but Gazala's and Tobruk's `Car` (no `Car.raw`; `Car` is the last
pair, so nothing after it is lost). The search types by level: `Tank,
Infantry` alone on 138 (EoD) and `Tank, Infantery` on Santo Croce, with `Boat, LandingCraft` on 105, and a fifth
type on 27: `Car` on 20, `Amphibius` / `Amphibious` on seven XPack2 levels;
the infantry type is spelled `Infantery` on Bocage, El Alamein, Wake, Santo
Croce and Eagle's Nest (Kursk names its water types `Boat2`,
`LandingCraft3`). `extract_search_maps.py`
copies both files of each loaded map beside the search maps and lists
`searchTypes` and `strategic` in `index.json` (`bf42/ai_level.py
level_strategic_maps`); `viewer/strategic-map.js` reads them.

`<name>LandMap.raw` (Bocage's `Tank0LandMap.raw`, `Infantry1LandMap.raw`)
is not opened by `loadSearchMaps` or `loadSearchTypes`; not read.
