// The bot navigation map, built the way the server builds its `Pathfinding/`
// search maps, and the two searches that run over it.
//
// Research: features/bf1942-ai-research-2026-09-21/bot-movement-and-pathfinding.md
//           (the 2026-09-23 binary read; every address below is that document's)
//
// What the engine does (bf1942_lnxded.static, `dice::bf::ai`):
//
//  * `LocalMap::LocalMap` 0x085fb120 builds one `CellMap` per pyramid level
//    `minLevel..maxLevel`, `CellMap(name, level, 0, level + 6, sizeXBits,
//    sizeZBits)`, and `LocalMap::getLevelPixelSize(level)` 0x085ff170 is
//    `1 << level`: a level-0 pixel is ONE map unit, one world metre when
//    `aiSettings.setWorldMapSize` is the terrain size. Each `.raw` row record
//    is a 64 x 64-pixel block (the `MemoryPool` cell is `4 << 7` = 512 bytes),
//    which is why a 2048 m level's level-0 file is 32 x 32 records. The old
//    reading of that header as "32 cells of 64 m" was wrong, and the 64 m grid
//    built from it could not see a sandbag.
//  * A pixel is ONE BIT (`CellMap::getPixel` 0x085f9a00 masks
//    `(1 << +0x28) - 1` with `+0x28 = 1 << 0`): 1 = blocked, 0 = free. The two
//    special cells the constructor registers are the all-free and all-blocked
//    blocks.
//  * The infantry map is `ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1`
//    (`name / waterHeight / waterDepth / maxSlope / brush / lowClip / hiClip /
//    considerAITypes`), landing in `LocalMap+0x1c` (1.5, water depth),
//    `+0x20` (30 deg, stored in radians: `* 0.017453292`), and
//    `LocalMapInfo+0x0 / +0x114 / +0x118` (brush 1.0, clip 0.4 .. 2.0).
//  * The local A* (`AStarLocalSearch::newPositionsAndCosts` 0x085f4c00) is
//    FOUR-connected: `checkDirection(0,1) (1,0) (0,-1) (-1,0)`. A step's cost
//    (`__checkThisLevel` 0x085f5d20) is
//    `((1 << level) + levelCost[level]) * 16 + round((|dh| * 3 + (1 - |ny|)^2 * 7) * 16)`
//    with `dh` the height difference to the neighbour and `ny` the terrain
//    normal's y there. The search is boxed (`initNormal` 0x085f28b0 takes the
//    radius; `BotMain::updateLocalPath` 0x08527120 draws it as `10 + rand * 14`
//    metres plus the largest potential-obstacle radius plus 1) and restricted
//    by a list of `(Pos2, radius)` obstacle circles (`initRestrictedNormal`).
//  * Line-of-walk is a Bresenham over the bitmap (`Bresenham<MapTracing>::
//    modifiedLine` 0x08480190, behind `IAIPathfinding::trace` vtable +0x50 and
//    `traceValidPoint` +0x58, the inverted walk to the first free cell): a
//    diagonal step also tests the two cells it
//    cuts between.
//
// INVENTION, labelled:
//  * The engine's strategic layer is a separate `StrategicMap` of hand-placed
//    cells; the coarse level here is a 16 m downsample of the bitmap where a
//    cell is passable if ANY metre inside it is free, searched 8-connected. It
//    exists only to hand the local search a target inside its box.
//  * The static-object pass clips the viewer's baked collision triangles to the
//    clip band per cell and marks the footprint. The engine
//    (`LocalMap::objectClipAndRender` 0x085fbfa0) intersects the hull with two
//    horizontal planes at `base + lowClip` and `base + hiClip`, `base` the
//    object's lowest collision vertex, and draws the OUTLINE segments; the
//    interior is closed off by the spawn-point flood instead. Filling the band
//    per cell reaches the same cells for a wall or a sandbag without the flood
//    having to find the ring. The base is raised to the cell's own terrain
//    height so a building on a slope keeps its uphill wall.
//  * `LocalMap::SamplingObjectBuffer::sampleAndRender` 0x08601390 frees every
//    cell a downward ray finds an object top under (a pier, a bridge deck, a
//    ramp). Here a surface above the band, or a drivable deck, frees the cell.
//  * `floodLevelZeroMap` 0x085fbae0 (`flags & 2`) floods the free cells from
//    the map's spawn points and blocks everything it did not reach, which is
//    what closes a sandbag's top and a walled yard with no door.

// The map and the searches live in their own modules and this one re-exports
// them, so every importer keeps reading `./nav-grid.js`:
//
//   `nav-map.js`     the cell codes, the brush and `buildNavMap`
//   `nav-search.js`  the queries, the traces and the searches

export {
  NAV_CELL, INFANTRY_SEARCH_MAP, COARSE_CELL,
  CELL_FREE, CELL_NO_TERRAIN, CELL_WATER, CELL_SLOPE, CELL_OBJECT,
  CELL_UNREACHABLE, CELL_LAND,
  brushOffsets, buildNavMap,
} from './nav-map.js';
export {
  LOCAL_SEARCH_MAX_NODES,
  gridAt, isWalkable, freeLevel, navHeight, traceClear, traceValidPoint,
  findLocalPath, smoothPath, findStrategicPath, findPath, freeRun, freeBox,
} from './nav-search.js';
