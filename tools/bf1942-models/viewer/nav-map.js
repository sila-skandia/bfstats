// The bot navigation map itself: the metre bitmap built from the world
// collider (terrain, water, slope, the statics' clip band, the brush, the
// spawn-point flood) and its coarse level. The engine research it implements,
// with every address, is `nav-grid.js`'s header; that module re-exports this
// one and `nav-search.js`, the searches that run over the map.

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
/** `objectClipAndRender` 0x085fbfa0 skips every collision face whose
 *  material is 99 (`*(short *)(face + 6) != 99` in its face loop): such a
 *  face draws no outline. */
const NO_OUTLINE_MATERIAL = 99;

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
    const materials = statics.materials ?? null;
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
    const ctx = {
      cellSize, width, height, heights, blocked, lowClip, hiClip, water, waterDepth, stamp, deck,
      poly: new Float64Array(3 * 16), scratch: new Float64Array(3 * 16),
    };
    for (let t = 0; t < statics.count; t++) {
      const owner = owners ? owners[t] : -1;
      if (skipOwner.has(owner)) continue;
      const base = ownerMin.get(owner) ?? -Infinity;
      const isDeck = drivable ? drivable[t] === 1 : false;
      const noOutline = materials ? materials[t] === NO_OUTLINE_MATERIAL : false;
      rasteriseTriangle(tris, t * 9, base, isDeck, noOutline, ctx);
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
 * band is a surface the bot stands on (`deck`), unless it is under more
 * water than the map allows. `base` is the object's lowest vertex raised to
 * the cell's terrain. A vertical wall clips to a segment whose ends still
 * carry their heights, so the test is exact for walls too.
 *
 * The engine (`LocalMap::update` 0x085fe090) paints in this order: the
 * terrain pass `setBlob`s every water / slope pixel with the brush into the
 * level-0 map; `objectClipAndRender` 0x085fbfa0 draws each object's outline
 * into a separate `MapBuffer` (with the brush, `paintBrush` 0x086011b0) and
 * queues the object for sampling; `SamplingObjectBuffer::sampleAndRender`
 * 0x08601390 then FREES every level-0 pixel whose four sub-samples
 * (x + 0.25 / 0.75, z + 0.25 / 0.75) a downward ray from the top of the
 * object's bounding sphere finds one of its collision faces under; only then
 * is the `MapBuffer` ORed in. So an object's surface clears the terrain's
 * water and slope (and their brush) under it, and nothing its outline drew.
 * The outline is where a collision face crosses one of two horizontal planes
 * at `minY + lowClip` and `minY + hiClip` (`clipFaceToPlane`, `minY` the
 * mesh's lowest vertex) -- or, for an object with an AI mesh in
 * `aiMeshes.rfa` (`IAIMeshLoader` +0x8), where it crosses that mesh's
 * triangles (`clipFaceToFace`). Faces of material 99 draw nothing (the
 * face loop's `*(short *)(face + 6) != 99`).
 *
 * Every bridge ships an AI mesh, and so do the repair pads, railways and
 * many houses. A bridge's is a sheet over its deck (`stonebridge_sml_a1`:
 * eight faces following the deck's arch 0.7 m above it and wider than it),
 * so what it outlines is the parapets, and neither the deck, nor its ramps
 * where they meet the bank, nor the abutments and piers under it draw
 * anything. The viewer ships no AI meshes; the drivable mask
 * (`collision-meshes.js DRIVABLE_TOP_RE`: bridges, repair pads, ramps,
 * docks) stands in for the objects that have one (INVENTION):
 *
 * - a flat piece of a drivable object (`|n.y| > 0.5`, either winding: the
 *   collision export's winding is mixed, Bocage has 2,333 flat faces up and
 *   5,934 down) is always a surface and never an outline;
 * - a steep piece of a drivable object over ground the terrain pass blocked
 *   (the river, the bank under a bridge's end) draws nothing: the cell is
 *   free only where the object's surface covers it, and the brush of the
 *   blocked ground either side keeps a hull off the deck's edges (Bocage's
 *   small stone bridge: a free strip 5 to 6 m wide, the engine's 6).
 *
 * Every other object keeps the filled band (INVENTION, see the header) and
 * the old upward-facing surface test.
 */
function rasteriseTriangle(tris, o, ownerBase, isDeck, noOutline, ctx) {
  const { cellSize, width, height, heights, blocked, lowClip, hiClip, water, waterDepth,
          stamp, deck, poly, scratch } = ctx;
  const x0 = tris[o], y0 = tris[o + 1], z0 = tris[o + 2];
  const x1 = tris[o + 3], y1 = tris[o + 4], z1 = tris[o + 5];
  const x2 = tris[o + 6], y2 = tris[o + 7], z2 = tris[o + 8];
  const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
  const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
  const ny = az * bx - ax * bz;
  const len = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx);
  const flat = len > 0 && Math.abs(ny) / len > 0.5;
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
      if (isDeck) {
        if (flat) { deck[idx] = 1; continue; }
        if (blocked[idx] !== CELL_FREE) continue;
      }
      const base = Number.isFinite(ground) ? Math.max(ownerBase, ground) : ownerBase;
      if (!Number.isFinite(base)) continue;
      if (!noOutline && hi >= base + lowClip && lo <= base + hiClip) stamp[idx] = 1;
      else if (upward && lo >= water - waterDepth) deck[idx] = 1;
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
