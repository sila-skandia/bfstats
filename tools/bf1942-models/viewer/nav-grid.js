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

/** Engine level-0 pixel: one world metre (`getLevelPixelSize(0)`). */
export const NAV_CELL = 1;
/** `ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1`. */
export const INFANTRY_SEARCH_MAP = {
  waterDepth: 1.5,
  maxSlopeDeg: 30,
  brush: 1.0,
  lowClip: 0.4,
  hiClip: 2.0,
};
/** The coarse strategic level (INVENTION, see the header). */
export const COARSE_CELL = 16;
/** `AStarLocalSearch::initNormal` +0xc: 0x400 nodes before a local search
 *  gives up. The viewer's box is drawn the same way, so the same cap. */
export const LOCAL_SEARCH_MAX_NODES = 0x400 * 8;

/** A blocked-cell code. The bit is what matters; the value says why. */
export const CELL_FREE = 0;
export const CELL_NO_TERRAIN = 1;
export const CELL_WATER = 2;
export const CELL_SLOPE = 3;
export const CELL_OBJECT = 4;
/** Free ground the spawn-point flood never reached (`floodLevelZeroMap`). */
export const CELL_UNREACHABLE = 5;
/** A water map's dry or shallow cell (`ai.addSearchMap <name> 1 ...`). */
export const CELL_LAND = 6;

/** `LocalMapInfo::update` 0x08480f50 builds the brush from its float `b`:
 *  `n = round(|b|) * 2 + 1`, bit set where `(col + 0.5 - c)^2 + (row + 0.5 - c)^2
 *  <= b^2`, `c = n / 2 + 0.5`. For `b = 1.0` that is the centre and its four
 *  orthogonal neighbours: a plus, not a square. `MapBuffer::paintBrush`
 *  0x086011b0 stamps it on every painted pixel, and the terrain pass paints
 *  its blocked cells through `CellMap::setBlob` with the same brush. */
export function brushOffsets(brush) {
  const n = Math.max(1, Math.round(Math.abs(brush)) * 2 + 1);
  if (n < 2) return [[0, 0]];
  const c = Math.floor(n / 2) + 0.5;
  const out = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if ((col + 0.5 - c) ** 2 + (row + 0.5 - c) ** 2 <= brush * brush) {
        out.push([col - (n >> 1), row - (n >> 1)]);
      }
    }
  }
  return out;
}

/**
 * Build the infantry navigation map from the world collider.
 *
 * `collider` needs `surfaceHeight(x, z)`; it may carry `waterLevel`,
 * `heightfield.height(x, z)` (preferred over `surfaceHeight`, which clamps to
 * the water plane) and `statics` (`collision.js`'s `CollisionIndex`: `tris`
 * as 9 floats a triangle, `count`, optional `drivable`).
 *
 * @returns {NavMap}
 */
export function buildNavMap(collider, worldSize, {
  cellSize = NAV_CELL,
  waterLevel,
  waterDepth = INFANTRY_SEARCH_MAP.waterDepth,
  maxSlopeDeg = INFANTRY_SEARCH_MAP.maxSlopeDeg,
  brush = INFANTRY_SEARCH_MAP.brush,
  lowClip = INFANTRY_SEARCH_MAP.lowClip,
  hiClip = INFANTRY_SEARCH_MAP.hiClip,
  coarseSize = COARSE_CELL,
  seeds = null,
  // `ai.addSearchMap <name> 1 <depth> ...`: a water map (the boats' and
  // landing craft's `Boat2` / `LandingCraft3`): a cell is free where the
  // water is at least `waterDepth` deep, the seabed's slope is not tested,
  // and the brush (125 m for `Boat2`) keeps the hulls off the shore.
  waterMap = false,
} = {}) {
  const width = Math.max(1, Math.ceil(worldSize / cellSize));
  const height = width;
  const total = width * height;
  const blocked = new Uint8Array(total);
  const heights = new Float32Array(total);
  const normalY = new Float32Array(total);
  const water = Number.isFinite(waterLevel) ? waterLevel
    : (Number.isFinite(collider?.waterLevel) ? collider.waterLevel : -Infinity);
  const half = cellSize / 2;
  const heightAt = terrainSampler(collider);

  // --- terrain: height, water depth ---
  for (let gz = 0; gz < height; gz++) {
    const wz = -(gz * cellSize + half);
    for (let gx = 0; gx < width; gx++) {
      const idx = gz * width + gx;
      const h = heightAt(gx * cellSize + half, wz);
      heights[idx] = h;
      if (!Number.isFinite(h)) { blocked[idx] = CELL_NO_TERRAIN; continue; }
      // `LocalMap+0x1c`: deeper than the map's water depth is not walkable;
      // on a water map shallower than it is not navigable.
      if (waterMap) { if (!(water - h >= waterDepth)) blocked[idx] = CELL_LAND; }
      else if (water - h > waterDepth) blocked[idx] = CELL_WATER;
    }
  }

  // --- terrain: slope. The engine tests the terrain normal against the
  // map's max slope (`+0x20`, radians); here the normal comes from the cell
  // lattice's own central differences, which is what `Heightfield.normal`
  // does at the heightfield's spacing.
  const cosMax = Math.cos(maxSlopeDeg * Math.PI / 180);
  for (let gz = 0; gz < height; gz++) {
    for (let gx = 0; gx < width; gx++) {
      const idx = gz * width + gx;
      const h = heights[idx];
      if (!Number.isFinite(h)) { normalY[idx] = 0; continue; }
      if (waterMap) { normalY[idx] = 1; continue; }
      const hl = finiteOr(heights[gz * width + Math.max(0, gx - 1)], h);
      const hr = finiteOr(heights[gz * width + Math.min(width - 1, gx + 1)], h);
      const hu = finiteOr(heights[Math.max(0, gz - 1) * width + gx], h);
      const hd = finiteOr(heights[Math.min(height - 1, gz + 1) * width + gx], h);
      const dx = (hr - hl) / (2 * cellSize);
      const dz = (hd - hu) / (2 * cellSize);
      const ny = 1 / Math.hypot(dx, 1, dz);
      normalY[idx] = ny;
      if (blocked[idx] === CELL_FREE && ny < cosMax) blocked[idx] = CELL_SLOPE;
    }
  }

  // --- statics: the clip band per object, the deck pass, then the brush ---
  const statics = collider?.statics;
  const stamp = new Uint8Array(total);   // object hits before dilation
  if (statics?.tris && statics.count > 0) {
    const deck = new Uint8Array(total);    // object tops above the band
    const tris = statics.tris;
    const drivable = statics.drivable ?? null;
    const owners = statics.owners ?? null;
    // `base` per object: the lowest collision vertex (`objectClipAndRender`
    // takes the mesh's bounding-box minimum). A simulated body (a parked
    // vehicle the world drives) is not part of the static map; the engine
    // meets those through the Avoid behaviour, not the bitmap.
    const ownerMin = new Map();
    const skipOwner = new Set();
    for (let t = 0; t < statics.count; t++) {
      const owner = owners ? owners[t] : -1;
      if (skipOwner.has(owner)) continue;
      if (statics.ownerDisabled?.(owner) || statics._body?.[owner]) {
        skipOwner.add(owner);
        continue;
      }
      const o = t * 9;
      const lo = Math.min(tris[o + 1], tris[o + 4], tris[o + 7]);
      const prev = ownerMin.get(owner);
      if (prev === undefined || lo < prev) ownerMin.set(owner, lo);
    }
    const poly = new Float64Array(3 * 16);
    const scratch = new Float64Array(3 * 16);
    for (let t = 0; t < statics.count; t++) {
      const owner = owners ? owners[t] : -1;
      if (skipOwner.has(owner)) continue;
      const base = ownerMin.get(owner) ?? -Infinity;
      const isDeck = drivable ? drivable[t] === 1 : false;
      rasteriseTriangle(tris, t * 9, cellSize, width, height, heights, base,
                        lowClip, hiClip, water, waterDepth, stamp, deck, isDeck,
                        poly, scratch);
    }
    for (let i = 0; i < total; i++) {
      if (deck[i] && !stamp[i]) {
        blocked[i] = CELL_FREE;
        if (!Number.isFinite(heights[i])) heights[i] = water;
        normalY[i] = 1;
      }
    }
  }

  // The brush: every blocked cell, terrain or object, stamps the plus. A
  // water map's brush is a hull's width off the shore (125 m on `Boat2`):
  // the same disc, drawn as a distance transform rather than 50,000
  // offsets a cell.
  if (waterMap && brush / cellSize > 8) {
    for (let i = 0; i < total; i++) if (stamp[i]) blocked[i] = CELL_OBJECT;
    erodeByDistance(blocked, width, height, brush / cellSize);
  }
  const offsets = (waterMap && brush / cellSize > 8) ? [[0, 0]] : brushOffsets(brush / cellSize);
  const dilated = new Uint8Array(total);
  for (let gz = 0; gz < height; gz++) {
    for (let gx = 0; gx < width; gx++) {
      const i = gz * width + gx;
      const code = stamp[i] ? CELL_OBJECT : blocked[i];
      if (code === CELL_FREE) continue;
      for (const [dx, dz] of offsets) {
        const x = gx + dx, z = gz + dz;
        if (x < 0 || x >= width || z < 0 || z >= height) continue;
        const j = z * width + x;
        if (!dilated[j] || code === CELL_OBJECT) dilated[j] = code;
      }
    }
  }
  for (let i = 0; i < total; i++) if (dilated[i]) blocked[i] = dilated[i];

  // The flood: what the spawn points cannot reach is not walkable.
  if (seeds && seeds.length) floodFromSeeds(blocked, width, height, cellSize, seeds);

  const coarse = buildCoarse(blocked, width, height, cellSize, coarseSize);
  return { blocked, heights, normalY, width, height, cellSize, worldSize, coarse };
}

/**
 * Block every free cell within `radius` cells of a blocked one: a two-pass
 * chamfer (3-4) distance transform, the disc `brushOffsets` would stamp.
 */
function erodeByDistance(blocked, width, height, radius) {
  const INF = 1 << 28;
  const d = new Int32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : INF;
  const at = (x, z) => d[z * width + x];
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      let v = d[z * width + x];
      if (x > 0) v = Math.min(v, at(x - 1, z) + 3);
      if (z > 0) {
        v = Math.min(v, at(x, z - 1) + 3);
        if (x > 0) v = Math.min(v, at(x - 1, z - 1) + 4);
        if (x < width - 1) v = Math.min(v, at(x + 1, z - 1) + 4);
      }
      d[z * width + x] = v;
    }
  }
  for (let z = height - 1; z >= 0; z--) {
    for (let x = width - 1; x >= 0; x--) {
      let v = d[z * width + x];
      if (x < width - 1) v = Math.min(v, at(x + 1, z) + 3);
      if (z < height - 1) {
        v = Math.min(v, at(x, z + 1) + 3);
        if (x < width - 1) v = Math.min(v, at(x + 1, z + 1) + 4);
        if (x > 0) v = Math.min(v, at(x - 1, z + 1) + 4);
      }
      d[z * width + x] = v;
    }
  }
  const limit = radius * 3;
  for (let i = 0; i < d.length; i++) if (!blocked[i] && d[i] < limit) blocked[i] = CELL_LAND;
}

/** Prefer the raw heightfield: `surfaceHeight` clamps to the water plane, and
 *  the water test needs the seabed. */
function terrainSampler(collider) {
  const hf = collider?.heightfield;
  if (hf && typeof hf.height === 'function') return (x, z) => hf.height(x, z);
  if (typeof collider?.surfaceHeight === 'function') return (x, z) => collider.surfaceHeight(x, z);
  return () => NaN;
}

function finiteOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Clip one triangle to every cell of its footprint. The clipped piece's
 * height range decides the cell: inside the band `[base + lowClip, base +
 * hiClip]` it is an obstacle (`stamp`); an upward-facing piece above the
 * band, or any drivable deck, is a surface the bot stands on (`deck`).
 * `base` is the object's lowest vertex raised to the cell's terrain. A
 * vertical wall clips to a segment whose ends still carry their heights, so
 * the test is exact for walls too.
 */
function rasteriseTriangle(tris, o, cellSize, width, height, heights, ownerBase,
                           lowClip, hiClip, water, waterDepth, stamp, deck, isDeck,
                           poly, scratch) {
  const x0 = tris[o], y0 = tris[o + 1], z0 = tris[o + 2];
  const x1 = tris[o + 3], y1 = tris[o + 4], z1 = tris[o + 5];
  const x2 = tris[o + 6], y2 = tris[o + 7], z2 = tris[o + 8];
  const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
  const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
  const ny = az * bx - ax * bz;
  const len = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx);
  const upward = len > 0 && ny / len > 0.5;
  const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
  const minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2);
  const gx0 = Math.max(0, Math.floor(minX / cellSize));
  const gx1 = Math.min(width - 1, Math.floor(maxX / cellSize));
  const gz0 = Math.max(0, Math.floor(-maxZ / cellSize));
  const gz1 = Math.min(height - 1, Math.floor(-minZ / cellSize));
  if (gx1 < gx0 || gz1 < gz0) return;
  for (let gz = gz0; gz <= gz1; gz++) {
    const cz1 = -(gz * cellSize);          // this cell's z range is [cz0, cz1]
    const cz0 = cz1 - cellSize;
    for (let gx = gx0; gx <= gx1; gx++) {
      const cx0 = gx * cellSize, cx1 = cx0 + cellSize;
      // Sutherland-Hodgman against the cell's four sides, carrying y.
      poly[0] = x0; poly[1] = y0; poly[2] = z0;
      poly[3] = x1; poly[4] = y1; poly[5] = z1;
      poly[6] = x2; poly[7] = y2; poly[8] = z2;
      let n = 3;
      n = clipPoly(poly, n, scratch, 0, cx0, +1);
      n = clipPoly(scratch, n, poly, 0, cx1, -1);
      n = clipPoly(poly, n, scratch, 2, cz0, +1);
      n = clipPoly(scratch, n, poly, 2, cz1, -1);
      if (n === 0) continue;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const y = poly[i * 3 + 1];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      const idx = gz * width + gx;
      const ground = heights[idx];
      const base = Number.isFinite(ground) ? Math.max(ownerBase, ground) : ownerBase;
      if (!Number.isFinite(base)) continue;
      if (hi >= base + lowClip && lo <= base + hiClip) stamp[idx] = 1;
      // An object top outside the band is a surface the bot stands on
      // (`sampleAndRender` frees every top a ray finds), unless it is under
      // more water than the map allows.
      else if (upward && (isDeck || lo >= water - waterDepth)) deck[idx] = 1;
    }
  }
}

/**
 * One Sutherland-Hodgman pass: keep the side of `axis = bound` where
 * `sign * (v[axis] - bound) >= 0`. `src`/`dst` are xyz triples; returns the
 * output count. Sixteen vertices is more than a triangle can grow to.
 */
function clipPoly(src, n, dst, axis, bound, sign) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = i * 3, aj = j * 3;
    const da = sign * (src[ai + axis] - bound);
    const db = sign * (src[aj + axis] - bound);
    if (da >= 0) {
      dst[m * 3] = src[ai]; dst[m * 3 + 1] = src[ai + 1]; dst[m * 3 + 2] = src[ai + 2];
      m++;
    }
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      dst[m * 3] = src[ai] + (src[aj] - src[ai]) * t;
      dst[m * 3 + 1] = src[ai + 1] + (src[aj + 1] - src[ai + 1]) * t;
      dst[m * 3 + 2] = src[ai + 2] + (src[aj + 2] - src[ai + 2]) * t;
      m++;
    }
    if (m >= 15) break;
  }
  return m;
}

/**
 * `floodLevelZeroMap`: flood the free cells from the seeds (world `[x, z]`
 * pairs) and mark every free cell the flood never reached. A seed in a
 * blocked cell is moved to the nearest free one first.
 */
function floodFromSeeds(blocked, width, height, cellSize, seeds) {
  const total = width * height;
  const reached = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  for (const [sx, sz] of seeds) {
    let gx = Math.floor(sx / cellSize), gz = Math.floor(-sz / cellSize);
    if (gx < 0 || gx >= width || gz < 0 || gz >= height) continue;
    if (blocked[gz * width + gx] !== CELL_FREE) {
      let found = null;
      for (let r = 1; r <= 8 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = gx + dx, z = gz + dz;
            if (x < 0 || x >= width || z < 0 || z >= height) continue;
            if (blocked[z * width + x] === CELL_FREE) { found = [x, z]; break; }
          }
        }
      }
      if (!found) continue;
      [gx, gz] = found;
    }
    const i = gz * width + gx;
    if (reached[i]) continue;
    reached[i] = 1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const gx = i % width, gz = (i - gx) / width;
    if (gx > 0) visit(i - 1);
    if (gx < width - 1) visit(i + 1);
    if (gz > 0) visit(i - width);
    if (gz < height - 1) visit(i + width);
  }
  function visit(j) {
    if (reached[j] || blocked[j] !== CELL_FREE) return;
    reached[j] = 1;
    queue[tail++] = j;
  }
  if (tail === 0) return;
  for (let i = 0; i < total; i++) {
    if (blocked[i] === CELL_FREE && !reached[i]) blocked[i] = CELL_UNREACHABLE;
  }
}

/** The coarse level: a cell is passable if any metre inside it is free. */
function buildCoarse(blocked, width, height, cellSize, coarseSize) {
  const per = Math.max(1, Math.round(coarseSize / cellSize));
  const cw = Math.ceil(width / per);
  const ch = Math.ceil(height / per);
  const free = new Uint8Array(cw * ch);
  const freeCount = new Uint16Array(cw * ch);
  for (let gz = 0; gz < height; gz++) {
    const cz = Math.floor(gz / per);
    for (let gx = 0; gx < width; gx++) {
      if (blocked[gz * width + gx] !== CELL_FREE) continue;
      const c = cz * cw + Math.floor(gx / per);
      free[c] = 1;
      freeCount[c]++;
    }
  }
  return { free, freeCount, width: cw, height: ch, cellsPer: per, cellSize: per * cellSize };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Cell value at a world point: `CELL_FREE` or a blocked code; -1 outside. */
export function gridAt(nav, x, z) {
  const gx = Math.floor(x / nav.cellSize);
  const gz = Math.floor(-z / nav.cellSize);
  if (gx < 0 || gx >= nav.width || gz < 0 || gz >= nav.height) return -1;
  return nav.blocked[gz * nav.width + gx];
}

export function isWalkable(nav, x, z) {
  return gridAt(nav, x, z) === CELL_FREE;
}

/**
 * `AIPathfinding::getLevel` 0x0847ca60 (-> vt+0xb4): the level of the free
 * quadtree block holding a point, i.e. the largest `k` for which the aligned
 * 2^k-cell block around it is free throughout; -1 on a blocked cell. The
 * pyramid is built once per map, on first use.
 */
export function freeLevel(nav, x, z, maxLevel = 8) {
  const gx = Math.floor(x / nav.cellSize);
  const gz = Math.floor(-z / nav.cellSize);
  if (gx < 0 || gx >= nav.width || gz < 0 || gz >= nav.height) return -1;
  if (!nav._levels) {
    const levels = [];
    let w = nav.width, h = nav.height;
    let prev = new Uint8Array(w * h);
    for (let i = 0; i < prev.length; i++) prev[i] = nav.blocked[i] === CELL_FREE ? 1 : 0;
    levels.push({ free: prev, w, h });
    for (let k = 1; k <= 12 && w > 1 && h > 1; k++) {
      const nw = w >> 1, nh = h >> 1;
      const next = new Uint8Array(nw * nh);
      for (let j = 0; j < nh; j++) {
        for (let i = 0; i < nw; i++) {
          const a = (2 * j) * w + 2 * i;
          next[j * nw + i] = prev[a] & prev[a + 1] & prev[a + w] & prev[a + w + 1];
        }
      }
      levels.push({ free: next, w: nw, h: nh });
      prev = next; w = nw; h = nh;
    }
    nav._levels = levels;
  }
  let level = -1;
  for (let k = 0; k < nav._levels.length && k <= maxLevel; k++) {
    const L = nav._levels[k];
    const i = gx >> k, j = gz >> k;
    if (i >= L.w || j >= L.h || !L.free[j * L.w + i]) break;
    level = k;
  }
  return level;
}

/** Terrain height the map sampled at a world point, or NaN. */
export function navHeight(nav, x, z) {
  const gx = Math.floor(x / nav.cellSize);
  const gz = Math.floor(-z / nav.cellSize);
  if (gx < 0 || gx >= nav.width || gz < 0 || gz >= nav.height) return NaN;
  return nav.heights[gz * nav.width + gx];
}

/**
 * Whether a cell is free for a search with `obstacles` (`[{x, z, r}]` in
 * world units, the engine's `(Pos2, radius)` restrictions). `startX/startZ`
 * is the searcher's own position: a circle it is already inside keeps only
 * the part further in than the searcher, which is what
 * `resolveStartPositionAgainstConstraints` 0x085f3270 arranges by moving the
 * start out of the circle.
 */
function cellOpen(nav, gx, gz, obstacles, startX, startZ) {
  if (nav.blocked[gz * nav.width + gx] !== CELL_FREE) return false;
  if (!obstacles || obstacles.length === 0) return true;
  const cx = gx * nav.cellSize + nav.cellSize / 2;
  const cz = -(gz * nav.cellSize + nav.cellSize / 2);
  for (const ob of obstacles) {
    let r = ob.r;
    const ds = Math.hypot(startX - ob.x, startZ - ob.z);
    if (ds < r) r = Math.max(0, ds - nav.cellSize * 0.5);
    if (Math.hypot(cx - ob.x, cz - ob.z) < r) return false;
  }
  return true;
}

/**
 * Bresenham line-of-walk over the bitmap (`Bresenham<MapTracing>::modifiedLine`
 * 0x08480190). True when every cell the segment crosses is free, testing both
 * cells a diagonal step cuts between, as the engine does.
 */
export function traceClear(nav, x0, z0, x1, z1, obstacles = null) {
  const cs = nav.cellSize;
  let gx = Math.floor(x0 / cs), gz = Math.floor(-z0 / cs);
  const ex = Math.floor(x1 / cs), ez = Math.floor(-z1 / cs);
  const sx = ex > gx ? 1 : -1, sz = ez > gz ? 1 : -1;
  let dx = Math.abs(ex - gx), dz = Math.abs(ez - gz);
  const open = (x, z) => x >= 0 && x < nav.width && z >= 0 && z < nav.height
    && cellOpen(nav, x, z, obstacles, x0, z0);
  if (!open(gx, gz)) return false;
  let err = dx - dz;
  let guard = dx + dz + 2;
  while ((gx !== ex || gz !== ez) && guard-- > 0) {
    const e2 = 2 * err;
    let steppedX = false, steppedZ = false;
    if (e2 > -dz) { err -= dz; gx += sx; steppedX = true; }
    if (e2 < dx) { err += dx; gz += sz; steppedZ = true; }
    if (steppedX && steppedZ) {
      // The corner: the two cells the diagonal passes between.
      if (!open(gx - sx, gz) && !open(gx, gz - sz)) return false;
    }
    if (!open(gx, gz)) return false;
  }
  return true;
}

/**
 * `traceValidPoint` (0x0847e3a0, read 2026-09-23): the FIRST valid point
 * along a segment. The start itself when it is free; otherwise the line is
 * walked (`Bresenham<MapTracing>` in its inverted mode: continue while the
 * cell is invalid) and the first free cell's centre is returned; null when
 * every cell to the end is blocked. This is how a standing point behind a
 * cover object or a start inside an obstacle is pushed out to open ground.
 * (The "last free point before the first blocked one" is `trace`, the
 * non-inverted walk `traceClear` answers as a boolean.)
 */
export function traceValidPoint(nav, x0, z0, x1, z1, obstacles = null) {
  const cs = nav.cellSize;
  let gx = Math.floor(x0 / cs), gz = Math.floor(-z0 / cs);
  const ex = Math.floor(x1 / cs), ez = Math.floor(-z1 / cs);
  const open = (x, z) => x >= 0 && x < nav.width && z >= 0 && z < nav.height
    && cellOpen(nav, x, z, obstacles, x0, z0);
  const centre = (x, z) => [x * cs + cs / 2, -(z * cs + cs / 2)];
  if (open(gx, gz)) return [x0, z0];
  const sx = ex > gx ? 1 : -1, sz = ez > gz ? 1 : -1;
  const dx = Math.abs(ex - gx), dz = Math.abs(ez - gz);
  let err = dx - dz;
  let guard = dx + dz + 2;
  while ((gx !== ex || gz !== ez) && guard-- > 0) {
    const e2 = 2 * err;
    let steppedX = false, steppedZ = false;
    if (e2 > -dz) { err -= dz; gx += sx; steppedX = true; }
    if (e2 < dx) { err += dx; gz += sz; steppedZ = true; }
    if (steppedX && steppedZ) {
      // The corner cells the diagonal cuts between are tested first.
      if (open(gx - sx, gz)) return centre(gx - sx, gz);
      if (open(gx, gz - sz)) return centre(gx, gz - sz);
    }
    if (open(gx, gz)) return centre(gx, gz);
  }
  return null;
}

/** Nearest free cell to `(gx, gz)` within `radius` cells, in square rings. */
function nearestFree(nav, gx, gz, radius, obstacles, sx, sz) {
  for (let r = 0; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = gx + dx, z = gz + dz;
        if (x < 0 || x >= nav.width || z < 0 || z >= nav.height) continue;
        if (cellOpen(nav, x, z, obstacles, sx, sz)) return [x, z];
      }
    }
  }
  return null;
}

/** A binary min-heap over node indices keyed by an external f array. */
class Heap {
  constructor(f) { this.f = f; this.a = []; }
  get size() { return this.a.length; }
  push(i) {
    const a = this.a, f = this.f;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[a[p]] <= f[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop() {
    const a = this.a, f = this.f;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < a.length && f[a[l]] < f[a[m]]) m = l;
        if (r < a.length && f[a[r]] < f[a[m]]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

/**
 * The local search: 4-connected A* on the metre bitmap inside a box of
 * `radius` metres around the start (grown to hold the goal when it is
 * within reach), with the engine's step cost. Returns world `[x, z]`
 * waypoints (start and goal exact) or null.
 *
 * @param {NavMap} nav
 * @param {object} [opt]
 * @param {number} [opt.radius]      the box half-size, metres
 * @param {Array<{x:number,z:number,r:number}>} [opt.obstacles]
 * @param {number} [opt.maxNodes]
 */
/** How far a buried start or goal is moved to reach open paint (cells). */
const START_RESOLVE_CELLS = 20;

export function findLocalPath(nav, fromX, fromZ, toX, toZ, {
  radius = 24, obstacles = null, maxNodes = LOCAL_SEARCH_MAX_NODES,
} = {}) {
  const { width, height, cellSize: cs, heights, normalY } = nav;
  let sgx = clampi(Math.floor(fromX / cs), 0, width - 1);
  let sgz = clampi(Math.floor(-fromZ / cs), 0, height - 1);
  let egx = clampi(Math.floor(toX / cs), 0, width - 1);
  let egz = clampi(Math.floor(-toZ / cs), 0, height - 1);
  const rc = Math.max(1, Math.ceil(radius / cs));
  // The box: around the start, stretched to include the goal.
  const bx0 = Math.max(0, Math.min(sgx - rc, egx - 2));
  const bx1 = Math.min(width - 1, Math.max(sgx + rc, egx + 2));
  const bz0 = Math.max(0, Math.min(sgz - rc, egz - 2));
  const bz1 = Math.min(height - 1, Math.max(sgz + rc, egz + 2));

  // A start (or goal) inside the paint is moved to the nearest free cell,
  // up to 20 m out (`resolveStartPositionAgainstConstraints`, bot-movement
  // doc §3): a tank map's 6 m brush can bury a whole base compound.
  if (!cellOpen(nav, sgx, sgz, obstacles, fromX, fromZ)) {
    const s = nearestFree(nav, sgx, sgz, START_RESOLVE_CELLS, obstacles, fromX, fromZ);
    if (!s) return null;
    [sgx, sgz] = s;
  }
  if (!cellOpen(nav, egx, egz, obstacles, fromX, fromZ)) {
    const e = nearestFree(nav, egx, egz, START_RESOLVE_CELLS, obstacles, fromX, fromZ);
    if (!e) return null;
    [egx, egz] = e;
  }
  if (sgx === egx && sgz === egz) return [[fromX, fromZ], [toX, toZ]];

  const bw = bx1 - bx0 + 1, bh = bz1 - bz0 + 1;
  const n = bw * bh;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const local = (gx, gz) => (gz - bz0) * bw + (gx - bx0);
  const start = local(sgx, sgz), goal = local(egx, egz);
  const heur = (gx, gz) => Math.abs(gx - egx) + Math.abs(gz - egz);
  g[start] = 0;
  f[start] = heur(sgx, sgz);
  const heap = new Heap(f);
  heap.push(start);
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // the engine's four
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = bx0 + (cur % bw), cz = bz0 + ((cur - (cur % bw)) / bw);
    const ci = cz * width + cx;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < bx0 || nx > bx1 || nz < bz0 || nz > bz1) continue;
      if (!cellOpen(nav, nx, nz, obstacles, fromX, fromZ)) continue;
      const ni = nz * width + nx;
      const nl = local(nx, nz);
      if (closed[nl]) continue;
      // `__checkThisLevel`: step + |dh| * 3 + (1 - |ny|)^2 * 7.
      const dh = Math.abs(heights[ni] - heights[ci]);
      const ny = normalY[ni];
      const cost = 1 + (Number.isFinite(dh) ? dh * 3 : 0) + (1 - Math.abs(ny)) ** 2 * 7;
      const tentative = g[cur] + cost;
      if (tentative < g[nl]) {
        g[nl] = tentative;
        f[nl] = tentative + heur(nx, nz);
        came[nl] = cur;
        heap.push(nl);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  const path = cells.map(i => {
    const gx = bx0 + (i % bw), gz = bz0 + ((i - (i % bw)) / bw);
    return [gx * cs + cs / 2, -(gz * cs + cs / 2)];
  });
  path[0] = [fromX, fromZ];
  path[path.length - 1] = [toX, toZ];
  return smoothPath(nav, path, obstacles);
}

/**
 * String-pulling over the bitmap: from each kept point, keep the furthest
 * later point the trace can reach in a straight line. The engine does this at
 * run time from the bot's own position (`getNewIntermediatePathPos`); doing
 * it once here leaves the follower the same corners to cut.
 */
export function smoothPath(nav, path, obstacles = null) {
  if (!path || path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !traceClear(nav, path[i][0], path[i][1], path[j][0], path[j][1], obstacles)) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

/**
 * The strategic search (INVENTION, header): 8-connected A* over the coarse
 * level. Returns world `[x, z]` waypoints, one per coarse cell, each snapped
 * to a free metre inside its cell, ending at the exact goal; or null.
 */
export function findStrategicPath(nav, fromX, fromZ, toX, toZ) {
  const c = nav.coarse;
  const cs = c.cellSize;
  const sx = clampi(Math.floor(fromX / cs), 0, c.width - 1);
  const sz = clampi(Math.floor(-fromZ / cs), 0, c.height - 1);
  const ex = clampi(Math.floor(toX / cs), 0, c.width - 1);
  const ez = clampi(Math.floor(-toZ / cs), 0, c.height - 1);
  const n = c.width * c.height;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = sz * c.width + sx, goal = ez * c.width + ex;
  const heur = (x, z) => {
    const dx = Math.abs(x - ex), dz = Math.abs(z - ez);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  g[start] = 0;
  f[start] = heur(sx, sz);
  const heap = new Heap(f);
  heap.push(start);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % c.width, cz = (cur - cx) / c.width;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx >= c.width || nz < 0 || nz >= c.height) continue;
      const ni = nz * c.width + nx;
      if (!c.free[ni] && ni !== goal) continue;
      if (closed[ni]) continue;
      if (dx && dz && !c.free[cz * c.width + nx] && !c.free[nz * c.width + cx]) continue;
      // Prefer roomier cells: a cell with one free metre is a needle's eye.
      const room = c.freeCount[ni] / (c.cellsPer * c.cellsPer);
      const cost = (dx && dz ? Math.SQRT2 : 1) * (1 + (1 - room) * 2);
      const tentative = g[cur] + cost;
      if (tentative < g[ni]) {
        g[ni] = tentative;
        f[ni] = tentative + heur(nx, nz);
        came[ni] = cur;
        heap.push(ni);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  const path = [];
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    const cx = i % c.width, cz = (i - cx) / c.width;
    if (k === 0) { path.push([fromX, fromZ]); continue; }
    if (k === cells.length - 1) { path.push([toX, toZ]); continue; }
    path.push(freePointIn(nav, cx, cz, c.cellsPer));
  }
  return path;
}

/** A free metre inside a coarse cell, nearest its centre. */
function freePointIn(nav, cx, cz, per) {
  const gx0 = cx * per, gz0 = cz * per;
  const mid = per / 2;
  const centre = [(gx0 + mid) * nav.cellSize, -((gz0 + mid) * nav.cellSize)];
  const s = nearestFree(nav, Math.min(nav.width - 1, gx0 + Math.floor(mid)),
                        Math.min(nav.height - 1, gz0 + Math.floor(mid)), per, null, 0, 0);
  if (!s) return centre;
  return [s[0] * nav.cellSize + nav.cellSize / 2, -(s[1] * nav.cellSize + nav.cellSize / 2)];
}

/**
 * Whole-route query, for the page's debug probe and the tests: the strategic
 * path, each leg refined by the local search. Returns world `[x, z]`
 * waypoints or null.
 */
export function findPath(nav, fromX, fromZ, toX, toZ, { obstacles = null } = {}) {
  if (Math.hypot(toX - fromX, toZ - fromZ) <= COARSE_CELL * 2) {
    return findLocalPath(nav, fromX, fromZ, toX, toZ, { radius: COARSE_CELL * 2, obstacles });
  }
  const strategic = findStrategicPath(nav, fromX, fromZ, toX, toZ);
  if (!strategic) return null;
  const out = [[fromX, fromZ]];
  let cx = fromX, cz = fromZ;
  for (let i = 1; i < strategic.length; i++) {
    const [tx, tz] = strategic[i];
    const leg = findLocalPath(nav, cx, cz, tx, tz, { radius: COARSE_CELL * 2, obstacles });
    if (!leg) return null;
    for (let k = 1; k < leg.length; k++) out.push(leg[k]);
    cx = tx; cz = tz;
  }
  return smoothPath(nav, out, obstacles);
}

function clampi(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @typedef {object} NavMap
 * @property {Uint8Array} blocked   one byte a metre, `CELL_FREE` or a code
 * @property {Float32Array} heights terrain height sampled at each cell centre
 * @property {Float32Array} normalY terrain normal's y at each cell
 * @property {number} width
 * @property {number} height
 * @property {number} cellSize
 * @property {number} worldSize
 * @property {{free: Uint8Array, freeCount: Uint16Array, width: number, height: number, cellsPer: number, cellSize: number}} coarse
 */

/**
 * `CommonControls::getBox` / `getIntersection` / `checkLineAgainstObjects`
 * for the drive decision: the free run from `(x, z)` along the unit
 * direction `(fx, fz)` on the map, in metres, up to `maxDist` (the hull's
 * own cell counts as free). Blocked at the start returns 0.
 */
export function freeRun(nav, x, z, fx, fz, maxDist, obstacles = null) {
  if (!nav) return maxDist;
  const cs = nav.cellSize;
  const len = Math.hypot(fx, fz) || 1;
  const ux = fx / len, uz = fz / len;
  const step = cs * 0.5;
  for (let d = step; d <= maxDist; d += step) {
    const px = x + ux * d, pz = z + uz * d;
    const gx = Math.floor(px / cs), gz = Math.floor(-pz / cs);
    if (gx < 0 || gx >= nav.width || gz < 0 || gz >= nav.height) return d;
    if (!cellOpen(nav, gx, gz, obstacles, x, z)) return Math.max(0, d - step);
  }
  return maxDist;
}

/**
 * `IAIPathfinding::getBox`: the largest free axis-aligned box around
 * `(x, z)` grown a cell at a time on every side until that side meets a
 * blocked cell, capped at `maxHalf` cells a side. Returns `{ minX, maxX,
 * minZ, maxZ, short }` in metres, `short` the shorter side.
 */
export function freeBox(nav, x, z, maxHalf = 64) {
  const cs = nav.cellSize;
  const cx = Math.floor(x / cs), cz = Math.floor(-z / cs);
  const open = (gx, gz) => gx >= 0 && gx < nav.width && gz >= 0 && gz < nav.height
    && nav.blocked[gz * nav.width + gx] === CELL_FREE;
  let x0 = cx, x1 = cx, z0 = cz, z1 = cz;
  const grow = { l: true, r: true, u: true, d: true };
  for (let n = 0; n < maxHalf && (grow.l || grow.r || grow.u || grow.d); n++) {
    if (grow.l) { let ok = true; for (let gz = z0; gz <= z1; gz++) if (!open(x0 - 1, gz)) { ok = false; break; } if (ok) x0--; else grow.l = false; }
    if (grow.r) { let ok = true; for (let gz = z0; gz <= z1; gz++) if (!open(x1 + 1, gz)) { ok = false; break; } if (ok) x1++; else grow.r = false; }
    if (grow.u) { let ok = true; for (let gx = x0; gx <= x1; gx++) if (!open(gx, z0 - 1)) { ok = false; break; } if (ok) z0--; else grow.u = false; }
    if (grow.d) { let ok = true; for (let gx = x0; gx <= x1; gx++) if (!open(gx, z1 + 1)) { ok = false; break; } if (ok) z1++; else grow.d = false; }
  }
  const w = (x1 - x0 + 1) * cs, h = (z1 - z0 + 1) * cs;
  return { minX: x0 * cs, maxX: (x1 + 1) * cs, minZ: -(z1 + 1) * cs, maxZ: -z0 * cs, short: Math.min(w, h) };
}
