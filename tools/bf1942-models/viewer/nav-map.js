// The bot navigation map itself: the metre bitmap and its coarse level,
// either the level's own baked search map (`nav-baked.js`, what the retail
// server loads with `ai.loadMaps`) or, for a level that ships none, painted
// from the world collider (terrain, water, slope, the statics' clip band,
// the brush, the spawn-point flood). The engine research it implements,
// with every address, is `nav-grid.js`'s header; that module re-exports this
// one and `nav-search.js`, the searches that run over the map.

import { findSearchMap, strategicFor } from './nav-baked.js';

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
/** The painted coarse level (INVENTION, see the header): only a map with no
 *  strategic map of its own plans on it. */
export const COARSE_CELL = 16;
/** `objectClipAndRender` 0x085fbfa0 skips every collision face whose
 *  material is 99 (`*(short *)(face + 6) != 99` in its face loop): such a
 *  face draws no outline. */
const NO_OUTLINE_MATERIAL = 99;

/** `carveDoors`: a cell in quarters, the clear strip a soldier needs (0.75 m),
 *  and the widest brush whose map keeps doorways (the infantry map's 1.0). */
const DOOR_SUB = 4;
const DOOR_MIN_STRIP = 3;
const DOOR_MAX_BRUSH = 1.5;

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
/** Terrain of the land map's impassable material (AI-27, AI-93). */
export const CELL_MATERIAL = 7;

/**
 * The terrain material a land map blocks. `LocalMap::update` 0x085fe090's
 * terrain pass blocks a land pixel of "one designated material" (AI-27,
 * AI-93; game object 0x1d4c1 +0x2c0), whose id the binary reading left open.
 * MEASURED here: on the three DICE levels whose terrain paints material 7
 * (CA-5's "Reserved (Outside map)", the combat area's damaging ground), the
 * level's own baked Tank0, Infantry1 and Car4 maps block 100 % of it (Kharkov
 * 24,020 samples a map, Berlin 259,537, Stalingrad 60,888, one every 4 m),
 * against 26 to 79 % of the other ground. So the id is 7, the material the
 * combat area burns a soldier or a hull on after 10 s (CA-2, CA-5).
 * Painted maps (a level that ships none: every generated bot layer) left it
 * walkable, and on Aberdeen the British base's road to the East outpost ran
 * across a tongue of it: 95 % of the bots' non-enemy deaths there were
 * hulls burnt out on it (features/bot-map-generation/wide-levels.md).
 */
export const OUTSIDE_MAP_MATERIAL = 7;

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
 * The level's baked map a `buildNavMap` call stands for (`nav-baked.js`):
 * the one whose six `ai.addSearchMap` parameters are the call's, or, for a
 * call that leaves every parameter at the infantry defaults (the referee's
 * soldier map), the level's infantry map whatever its parameters.
 */
function bakedFor(searchMaps, options, params) {
  if (!searchMaps?.maps?.length) return null;
  const exact = findSearchMap(searchMaps, params);
  if (exact) return exact;
  const defaults = ['waterMap', 'waterDepth', 'maxSlopeDeg', 'brush', 'lowClip', 'hiClip']
    .every(k => options[k] === undefined);
  if (!defaults) return null;
  return searchMaps.maps.find(m => !m.params?.waterMap && /^infant/i.test(m.params?.name ?? '')) ?? null;
}

/**
 * Build a navigation map for the world collider: the level's own baked map
 * when it ships one for these parameters, else painted from the terrain and
 * the statics the way the server paints one.
 *
 * `collider` needs `surfaceHeight(x, z)`; it may carry `waterLevel`,
 * `heightfield.height(x, z)` (preferred over `surfaceHeight`, which clamps to
 * the water plane), `statics` (`collision.js`'s `CollisionIndex`: `tris` as 9
 * floats a triangle, `count`, optional `drivable`) and `searchMaps` (the
 * level's baked maps, `nav-baked.js loadSearchMaps`). `baked: false` paints
 * even when a baked map is there; `searchMap` hands one in directly.
 *
 * @returns {NavMap}
 */
export function buildNavMap(collider, worldSize, options = {}) {
  const {
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
    baked = true,
    searchMap = null,
    // The strategic map to plan routes on (`strategic-map.js`): by default
    // the one the level ships for the baked map taken; `false` for none (the
    // painted coarse layer), or one handed in.
    strategic = null,
    // The terrain material a painted land map blocks (`OUTSIDE_MAP_MATERIAL`,
    // the engine's own rule, measured above), or null for none. The bots'
    // maps pass it (bot-referee.js, bot-units.js); a caller that leaves it
    // out paints as before (the generator's walk test, sim/botgen.mjs).
    impassableMaterial = null,
  } = options;
  const bakedMap = baked === false ? null
    : (searchMap ?? bakedFor(collider?.searchMaps, options,
      { waterMap, waterDepth, maxSlopeDeg, brush, lowClip, hiClip }));
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

  // The level's own map, as `ai.loadMaps` loads it: its pixels are the
  // map, statics, brush and flood included (the server painted them before
  // it wrote the file). The terrain passes above stay for the step costs
  // (`heights`, `normalY`) and to name why a blocked cell is blocked.
  if (bakedMap) {
    for (let gz = 0; gz < height; gz++) {
      const pz = Math.floor((gz * cellSize + half) / bakedMap.pixelSize);
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        const px = Math.floor((gx * cellSize + half) / bakedMap.pixelSize);
        if (bakedMap.blocked(px, pz)) {
          if (blocked[idx] === CELL_FREE) blocked[idx] = CELL_OBJECT;
        } else if (blocked[idx] !== CELL_FREE) {
          // A surface over water or slope (a deck, a pier, a pad).
          blocked[idx] = CELL_FREE;
          if (!Number.isFinite(heights[idx])) heights[idx] = water;
          normalY[idx] = 1;
        }
      }
    }
    const coarse = buildCoarse(blocked, width, height, cellSize, coarseSize);
    return {
      blocked, heights, normalY, width, height, cellSize, worldSize, coarse,
      source: 'baked', searchMap: bakedMap.params?.name ?? null, level: bakedMap.level,
      // The map's pyramid top (`LocalMap` +0x28), which bounds a hull's
      // box (`getLandLevel` 0x085f3f90 via `Vehicle` +0xc4a8).
      maxLevel: Number.isFinite(bakedMap.params?.maxLevel) ? bakedMap.params.maxLevel : null,
      // The engine's strategic layer for this map (`loadSearchTypes`
      // 0x0847c6b0); null keeps the painted coarse layer (`nav-search.js`).
      strategic: strategic === false ? null
        : (strategic ?? strategicFor(collider?.searchMaps, bakedMap.mapIndex, bakedMap.level)),
    };
  }

  // --- statics: the clip band per object, the deck pass, then the brush ---
  const statics = collider?.statics;
  const stamp = new Uint8Array(total);   // object hits before dilation
  // A soldier's map keeps its doorways (`carveDoors`); a hull's and a water
  // map's do not.
  const doors = !waterMap && brush / cellSize <= DOOR_MAX_BRUSH && cellSize === 1;
  let door = null;
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
      // Where inside each stamped cell the band's geometry lies (`carveDoors`).
      sub: doors ? new Uint16Array(total) : null,
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
    if (ctx.sub) door = carveDoors(stamp, ctx.sub, blocked, width, height, brushOffsets(brush / cellSize));
  }

  // --- terrain: the impassable material (AI-27). After the deck pass, so a
  // deck over it frees nothing: the combat area reads the terrain's material
  // under a man on a deck as under one on the ground (CA-5). The brush below
  // dilates it as it does every terrain cell. A water map has no such test.
  const hf = collider?.heightfield;
  if (!waterMap && Number.isInteger(impassableMaterial) && hf?.materials && typeof hf.material === 'function') {
    for (let gz = 0; gz < height; gz++) {
      const wz = -(gz * cellSize + half);
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        if (blocked[idx] === CELL_FREE && hf.material(gx * cellSize + half, wz) === impassableMaterial) blocked[idx] = CELL_MATERIAL;
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
        if (door && door[j]) continue;
        if (!dilated[j] || code === CELL_OBJECT) dilated[j] = code;
      }
    }
  }
  for (let i = 0; i < total; i++) if (dilated[i]) blocked[i] = dilated[i];

  // The flood: what the spawn points cannot reach is not walkable.
  if (seeds && seeds.length) floodFromSeeds(blocked, width, height, cellSize, seeds);

  const coarse = buildCoarse(blocked, width, height, cellSize, coarseSize);
  return {
    blocked, heights, normalY, width, height, cellSize, worldSize, coarse,
    source: 'painted', searchMap: null, level: 0, maxLevel: null,
    strategic: strategic || null,
  };
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
  // The world rectangle alone: the terrain wraps past the edge (TERR-6) and the
  // search grid, and so the bots, must never see that repeated ground.
  if (hf && typeof hf.heightInWorld === 'function') return (x, z) => hf.heightInWorld(x, z);
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
      if (!noOutline && hi >= base + lowClip && lo <= base + hiClip) {
        stamp[idx] = 1;
        if (ctx.sub) ctx.sub[idx] |= subMask(poly, n, cx0, cz0, cellSize);
      } else if (upward && lo >= water - waterDepth) deck[idx] = 1;
    }
  }
}

/** The quarter-cells (4 x 4, bit `row * 4 + col`, col along x, row along z)
 *  a clipped polygon's footprint touches inside its cell. */
function subMask(poly, n, cx0, cz0, cellSize) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 3], z = poly[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const q = cellSize / DOOR_SUB;
  const lo = v => Math.min(DOOR_SUB - 1, Math.max(0, Math.floor(v / q)));
  const hi = v => Math.min(DOOR_SUB - 1, Math.max(0, Math.ceil(v / q) - 1));
  const c0 = lo(minX - cx0), c1 = Math.max(c0, hi(maxX - cx0));
  const r0 = lo(minZ - cz0), r1 = Math.max(r0, hi(maxZ - cz0));
  let mask = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) mask |= 1 << (r * DOOR_SUB + c);
  return mask;
}

/**
 * Doorways (INVENTION). A one-metre cell is stamped when any collision face
 * crosses the soldier's band inside it, so a door narrower than two cells is
 * stamped shut by its own jambs, and the brush then closes what is left: on
 * the community map shigaisen_B 13 of 23 soldier spawns and one flag stood
 * in sealed rooms (features/bot-map-generation). The engine keeps such doors
 * open with the buildings' AI meshes and their portals (ledger AI-93), which
 * the painter does not read.
 *
 * A stamped cell is a doorway when the band's geometry leaves a clear strip
 * at least `DOOR_MIN_STRIP` quarter-cells wide across it (alone, or with the
 * stamped cell beside it, for a door that straddles two cells), and the
 * cells before and behind it along the strip are free ground or doorways
 * themselves. A doorway is unstamped and the brush does not close it.
 */
function carveDoors(stamp, sub, blocked, width, height, offsets) {
  const total = width * height;
  const FULL = (1 << DOOR_SUB) - 1;
  // Bit c set: quarter-column (dir 0) or quarter-row (dir 1) c holds no geometry.
  const clear = (i, dir) => {
    if (!stamp[i]) return 0;
    const m = sub[i];
    let f = 0;
    for (let c = 0; c < DOOR_SUB; c++) {
      let hit = 0;
      // A quarter-row's index rises with z and a cell's falls with it, so the
      // rows are read back to front: bit order follows the cells' order.
      for (let r = 0; r < DOOR_SUB; r++) hit |= dir === 0 ? m & (1 << (r * DOOR_SUB + c)) : m & (1 << ((DOOR_SUB - 1 - c) * DOOR_SUB + r));
      if (!hit) f |= 1 << c;
    }
    return f;
  };
  const cand = [new Uint8Array(total), new Uint8Array(total)];
  for (let dir = 0; dir < 2; dir++) {
    const side = dir === 0 ? 1 : width;        // the cell beside this one along the wall
    for (let i = 0; i < total; i++) {
      if (!stamp[i]) continue;
      const here = clear(i, dir);
      if (!here) continue;
      const x = i % width, z = (i - x) / width;
      const before = dir === 0 ? (x > 0 ? clear(i - 1, 0) : 0) : (z > 0 ? clear(i - width, 1) : 0);
      const after = dir === 0 ? (x < width - 1 ? clear(i + 1, 0) : 0) : (z < height - 1 ? clear(i + side, 1) : 0);
      const strip = before | (here << DOOR_SUB) | (after << (2 * DOOR_SUB));
      // The quarters that hold geometry: only a stamped cell has any.
      const solid = (stamp[i - (dir === 0 ? 1 : width)] && (dir === 0 ? x > 0 : z > 0) ? FULL & ~before : 0)
        | ((FULL & ~here) << DOOR_SUB)
        | ((dir === 0 ? x < width - 1 : z < height - 1) && stamp[i + side] ? (FULL & ~after) << (2 * DOOR_SUB) : 0);
      let run = 0, ok = false;
      for (let b = 0; b <= 3 * DOOR_SUB && !ok; b++) {
        if (b < 3 * DOOR_SUB && (strip >> b) & 1) { run++; continue; }
        // A gap in a wall: wide enough, partly in this cell, and a jamb on
        // each side of it. A clear strip beside a wall has one side only.
        const start = b - run;
        if (run >= DOOR_MIN_STRIP && b > DOOR_SUB && start < 2 * DOOR_SUB
            && b < 3 * DOOR_SUB && (solid >> b) & 1 && start > 0 && (solid >> (start - 1)) & 1) ok = true;
        run = 0;
      }
      if (ok) cand[dir][i] = 1;
    }
  }
  // A doorway leads somewhere: free ground or another doorway on both sides.
  for (let dir = 0; dir < 2; dir++) {
    const step = dir === 0 ? width : 1;        // through the wall
    // Free ground counts only if the brush will leave it free: a notch in a
    // solid block opens onto cells its own walls close.
    const closes = j => {
      const x = j % width, z = (j - x) / width;
      for (const [dx, dz] of offsets) {
        const px = x + dx, pz = z + dz;
        if (px < 0 || px >= width || pz < 0 || pz >= height) continue;
        const n = pz * width + px;
        if (blocked[n] !== CELL_FREE || (stamp[n] && !cand[0][n] && !cand[1][n])) return true;
      }
      return false;
    };
    const open = j => j >= 0 && j < total && (cand[dir][j] || (!stamp[j] && blocked[j] === CELL_FREE && !closes(j)));
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < total; i++) {
        if (!cand[dir][i]) continue;
        const x = i % width;
        const inRow = dir === 0 || (x > 0 && x < width - 1);
        if (!inRow || !open(i - step) || !open(i + step)) { cand[dir][i] = 0; changed = true; }
      }
    }
  }
  const door = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (cand[0][i] || cand[1][i]) { door[i] = 1; stamp[i] = 0; }
  }
  return door;
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
 * @property {'baked'|'painted'} source  the level's own map, or painted here
 * @property {string|null} searchMap     the baked map's name (`Tank0`, ...)
 * @property {number} level              the baked level (a pixel is 2^level m)
 * @property {number|null} maxLevel      the map's pyramid top (`ai.addSearchMap`'s maxLevel)
 * @property {import('./strategic-map.js').StrategicMap|null} strategic  the engine's strategic map
 */
