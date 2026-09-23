// `viewer/nav-baked.js` and `buildNavMap`'s baked path under node, for
// tests/test_nav_baked.py. Prints one JSON object.
//
//   node nav_baked_harness.mjs [<maps tree>]
//
// The synthetic part needs nothing; with a maps tree it also loads Bocage's
// own maps as the runner does (`readSearchMaps`) and reports the coarse
// components of each.

import { readFileSync, existsSync } from 'node:fs';
import {
  decodeSearchMap, readSearchMaps, buildNavMap, gridAt, CELL_FREE, CELL_OBJECT, CELL_WATER,
} from './nav-grid.js';

const out = {};

/** A one-bit search-map level of 2 x 2 blocks: `records` are a special-cell
 *  index or a 512-byte block (`CellMap::loadRawFile` 0x085f8930). */
function rawMap(level, records) {
  const parts = [];
  const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  parts.push(i32(1), i32(1), i32(level + 6), i32(level), i32(0), i32(2), u32(0), u32(0xffffffff));
  for (const r of records) {
    if (typeof r === 'number') parts.push(i32(r));
    else parts.push(i32(-1), r);
  }
  return new Uint8Array(Buffer.concat(parts));
}
/** Block with pixel (col, row) set. */
function blockWith(pixels) {
  const b = Buffer.alloc(512);
  for (const [col, row] of pixels) {
    const word = row * 2 + (col >> 5);
    b.writeUInt32LE((b.readUInt32LE(word * 4) | (1 << (col & 31))) >>> 0, word * 4);
  }
  return b;
}

// --- decode: special cells, an inline block, the outside ---
const m0 = decodeSearchMap(rawMap(0, [0, 1, blockWith([[5, 2], [40, 63]]), 0]));
out.decode = {
  size: [m0.width, m0.height, m0.level, m0.pixelSize],
  free: m0.blocked(10, 10), full: m0.blocked(70, 10),
  inlineHit: m0.blocked(5, 66), inlineMiss: m0.blocked(6, 66), inlineFar: m0.blocked(40, 127),
  lastFree: m0.blocked(100, 100), outside: m0.blocked(-1, 0),
};
try { decodeSearchMap(new Uint8Array([...rawMap(0, [0, 0, 0, 0]), 0, 0, 0, 0])); out.trailing = 'accepted'; }
catch (e) { out.trailing = 'refused'; }

// --- buildNavMap on a baked map: the pixels are the map ---
const TANK = { waterMap: false, waterDepth: 0, maxSlope: 30, brush: 3, lowClip: 0.3, hiClip: 2.5, name: 'Tank0' };
const INF = { waterMap: false, waterDepth: 1.5, maxSlope: 30, brush: 1, lowClip: 0.4, hiClip: 2, name: 'Infantry1' };
const tank = decodeSearchMap(rawMap(0, [0, 1, blockWith([[5, 2]]), 0]));
tank.params = TANK;
const inf = decodeSearchMap(rawMap(0, [1, 0, 0, 0]));
inf.params = INF;
// Water everywhere below y = 0 at depth 5: the painted map blocks it all.
const collider = { surfaceHeight: () => -5, waterLevel: 0, searchMaps: { maps: [tank, inf] } };
const tankOpts = { waterDepth: 0, maxSlopeDeg: 30, brush: 3, lowClip: 0.3, hiClip: 2.5 };
const nt = buildNavMap(collider, 128, tankOpts);
// The engine's z is the viewer's -z: pixel (x, zE) is viewer (x + 0.5, -(zE + 0.5)).
const at = (nav, x, zE) => gridAt(nav, x + 0.5, -(zE + 0.5));
out.baked = {
  source: nt.source, searchMap: nt.searchMap,
  freeOverWater: at(nt, 10, 10) === CELL_FREE,
  blockedBlock: at(nt, 70, 10) !== CELL_FREE,
  pixel: at(nt, 5, 66) !== CELL_FREE, besidePixel: at(nt, 6, 66) === CELL_FREE,
  // A blocked pixel keeps the terrain's reason when it has one.
  whyWater: at(nt, 70, 10) === CELL_WATER,
};
const dry = buildNavMap({ ...collider, surfaceHeight: () => 5 }, 128, tankOpts);
out.baked.whyObject = at(dry, 70, 10) === CELL_OBJECT;
// `baked: false` paints: the water is blocked everywhere.
const painted = buildNavMap(collider, 128, { ...tankOpts, baked: false });
out.painted = { source: painted.source, water: at(painted, 10, 10) !== CELL_FREE };
// Parameters no map has: painted.
out.noMatch = buildNavMap(collider, 128, { ...tankOpts, brush: 4 }).source;
// The referee's call (every parameter at the infantry defaults) takes the
// level's infantry map.
const ni = buildNavMap(collider, 128, {});
out.infantryDefaults = { source: ni.source, searchMap: ni.searchMap, block0: at(ni, 10, 10) !== CELL_FREE, block1: at(ni, 70, 10) === CELL_FREE };

// A level-2 map (4 m pixels, the water maps' `... 2 5`): pixel (1, 0) is
// metres 4..7.
const boat = decodeSearchMap(rawMap(2, [blockWith([[1, 0]]), 0, 0, 0]));
boat.params = { waterMap: true, waterDepth: 5, maxSlope: 0, brush: 125, lowClip: 0.3, hiClip: 2.5, name: 'Boat2' };
const nb = buildNavMap({ surfaceHeight: () => -10, waterLevel: 0, searchMaps: { maps: [boat] } }, 512,
  { waterMap: true, waterDepth: 5, maxSlopeDeg: 0, brush: 125, lowClip: 0.3, hiClip: 2.5 });
out.level2 = {
  source: nb.source, level: nb.level,
  cells: [3, 4, 7, 8].map(x => at(nb, x, 2) !== CELL_FREE),
  row: [3, 4].map(z => at(nb, 5, z) !== CELL_FREE),
};

// --- a real level, as the runner loads it ---
const tree = process.argv[2];
if (tree && existsSync(`${tree}/bocage/pathfinding/index.json`)) {
  const sm = readSearchMaps(`${tree}/bocage`, f => (existsSync(f) ? readFileSync(f) : null));
  const flat = { surfaceHeight: () => 50, searchMaps: sm };
  out.bocage = {};
  for (const m of sm.maps) {
    const p = m.params;
    const nav = buildNavMap(flat, 2048, {
      waterMap: p.waterMap, waterDepth: p.waterDepth, maxSlopeDeg: p.maxSlope,
      brush: p.brush, lowClip: p.lowClip, hiClip: p.hiClip,
    });
    out.bocage[p.name] = { source: nav.source, searchMap: nav.searchMap, components: components(nav.coarse) };
  }
  // The small stone bridge at (812, 1414) (engine z): free across the river
  // on the tank map, the water either side blocked (`test_ai_level.py`).
  const tp = sm.maps.find(m => m.params.name === 'Tank0').params;
  const t = buildNavMap(flat, 2048, {
    waterDepth: tp.waterDepth, maxSlopeDeg: tp.maxSlope, brush: tp.brush, lowClip: tp.lowClip, hiClip: tp.hiClip,
  });
  out.bocage.bridge = {
    source: t.source,
    deck: [790, 800, 812, 830, 845].every(x => at(t, x, 1413) === CELL_FREE),
    upstream: at(t, 815, 1395) !== CELL_FREE, downstream: at(t, 815, 1430) !== CELL_FREE,
  };
}

/** Coarse components, 8-connected (the strategic search's own step). */
function components(c) {
  const seen = new Uint8Array(c.width * c.height);
  const sizes = [];
  for (let i = 0; i < seen.length; i++) {
    if (!c.free[i] || seen[i]) continue;
    let n = 0;
    const q = [i];
    seen[i] = 1;
    while (q.length) {
      const j = q.pop();
      n++;
      const x = j % c.width, z = (j - x) / c.width;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Z = z + dz;
          if ((!dx && !dz) || X < 0 || Z < 0 || X >= c.width || Z >= c.height) continue;
          const k = Z * c.width + X;
          if (c.free[k] && !seen[k]) { seen[k] = 1; q.push(k); }
        }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}

process.stdout.write(JSON.stringify(out));
