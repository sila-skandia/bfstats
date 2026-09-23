// `viewer/strategic-map.js` (the engine's strategic map) and its use in
// `nav-search.js findStrategicPath`, under node, for
// tests/test_strategic_map.py. Prints one JSON object.
//
//   node strategic_map_harness.mjs [<maps tree>]
//
// The synthetic part needs nothing; with a maps tree it also loads Bocage's
// and El Alamein's strategic maps as the runner does (`readSearchMaps`).

import { readFileSync, existsSync } from 'node:fs';
import { decodeCellMap, decodeStrategicCells, StrategicMap, strategicMapFromBytes } from './strategic-map.js';
import {
  readSearchMaps, buildNavMap, findStrategicPath, findLocalPath, searchTypeMaps, strategicFor,
} from './nav-grid.js';

const out = {};
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

/** A 2 x 2-block Info map (`CellMap(name + "Info", level 1, 2 bits, 64 m
 *  blocks)`): each block a special cell or a 256-byte block filled by
 *  `pix(px, pz)` for its 32 x 32 two-metre pixels. */
function infoMap(blocks) {
  const parts = [i32(1), i32(1), i32(6), i32(1), i32(1), i32(1), u32(0)];
  for (const b of blocks) {
    if (b === 0) { parts.push(i32(0)); continue; }
    const buf = Buffer.alloc(256);
    for (let pz = 0; pz < 32; pz++) {
      for (let px = 0; px < 32; px++) {
        const v = b(px, pz) & 3;
        const bit = (pz * 32 + px) << 1;
        const w = bit >>> 5;
        buf.writeUInt32LE((buf.readUInt32LE(w * 4) | (v << (bit & 31))) >>> 0, w * 4);
      }
    }
    parts.push(i32(-1), buf);
  }
  return new Uint8Array(Buffer.concat(parts));
}

/** A 2 x 2 strategic cell file: `cells[cz][cx] = { links, points: [[x,z]..],
 *  used: [k..], overflow }`. */
function cellsFile(cells) {
  const parts = [i32(2), i32(2)];
  for (let cz = 0; cz < 2; cz++) {
    for (let cx = 0; cx < 2; cx++) {
      const c = cells[cz][cx];
      const b = Buffer.alloc(16);
      b.writeUInt32LE(c.links >>> 0, 0);
      (c.points ?? []).forEach(([x, z], k) => { b[4 + 2 * k] = x; b[5 + 2 * k] = z; });
      if (c.overflow) b[4] |= 0x40;
      for (const k of c.used ?? []) b[12] |= 1 << (4 + k);
      parts.push(b);
    }
  }
  return new Uint8Array(Buffer.concat(parts));
}

// --- the Info map: two bits a pixel, a pixel 2 m, LSB first ---
const info = decodeCellMap(infoMap([px => (px < 16 ? 0 : 1), 0, 0, (px, pz) => (pz >= 16 ? 3 : 2)]));
out.info = {
  level: info.level, bits: info.bitsExp, pixel: info.pixelSize,
  a: info.valueAt(10, 10), b: info.valueAt(40, 10), c: info.valueAt(64 + 5, 5),
  d: info.valueAt(64 + 10, 64 + 10), e: info.valueAt(64 + 10, 64 + 40), outside: info.valueAt(500, 5),
};

// --- a 2 x 2 strategic map ---
// Cell (0,0): regions 0 (west half) and 1 (east half); only region 1 joins
// the cell at +x (1,0) region 0 (bit 16 + 4*1 + 0), region 0 joins the cell
// at +z (0,1) region 0 (bit 4*0 + 0). Cell (1,0) region 0 joins +z (1,1)
// region 0 (bit 0). Cell (0,1) region 0 joins +x (1,1) region 0 (bit 16).
const sm = new StrategicMap(decodeStrategicCells(cellsFile([
  [{ links: (1 << (16 + 4)) | 1, points: [[8, 32], [48, 32]], used: [0, 1] },
   { links: 1, points: [[32, 32]], used: [0] }],
  [{ links: 1 << 16, points: [[32, 32]], used: [0] },
   { links: 0, points: [[32, 32], [60, 60]], used: [0, 1], overflow: true }],
])), decodeCellMap(infoMap([px => (px < 16 ? 0 : 1), 0, 0, (px, pz) => (pz >= 16 ? 3 : 0)])));
const free = () => false;
const n = (cx, cz, k) => sm.neighbours(cx, cz, k).map(a => a.join(','));
out.links = {
  r00_0: n(0, 0, 0), r00_1: n(0, 0, 1), r10_0: n(1, 0, 0), r01_0: n(0, 1, 0), r11_0: n(1, 1, 0),
};
out.regions = {
  west: sm.regionAt(10, 20, free), east: sm.regionAt(50, 20, free),
  blocked: sm.regionAt(10, 20, () => true),
};
// Cell (1,1) is flagged as holding more regions than four: its Info 3 (the
// south half) is region 3 only when the free pixels join the point to
// region 3's point, here the cell's corner (64, 64). Open ground joins them;
// a wall across the cell at z = 84 does not.
const wall = (x, z) => z === 64 + 20;
out.overflow = { open: sm.regionAt(64 + 10, 64 + 40, free), sealed: sm.regionAt(64 + 10, 64 + 40, wall) };
// Routes: the west half of (0,0) to (1,0) must go round by +z.
const west = { cx: 0, cz: 0, k: 0 }, east = { cx: 0, cz: 0, k: 1 }, far = { cx: 1, cz: 0, k: 0 };
out.search = {
  eastToFar: sm.search(east, far),
  westToFar: sm.search(west, far),
  same: sm.sameArea(west, { cx: 0, cz: 0, k: 0 }),
  notUsed: sm.sameArea({ cx: 1, cz: 0, k: 2 }, { cx: 1, cz: 0, k: 2 }),
  routeSame: sm.route(10, 20, 12, 30, free),
  routeWest: sm.route(10, 20, 100, 20, free),
  routeGoalBlocked: sm.route(10, 20, 100, 20, (x, z) => x === 100 && z === 20),
};

// --- findStrategicPath on a nav map that carries one (viewer frame: z negated) ---
const nav = {
  width: 128, height: 128, cellSize: 1, blocked: new Uint8Array(128 * 128),
  heights: new Float32Array(128 * 128), normalY: new Float32Array(128 * 128).fill(1), strategic: sm,
};
const p = findStrategicPath(nav, 10, -20, 100, -20);
out.navPath = p?.map(([x, z]) => [x, z]);

// --- a search type names its map ---
const index = {
  maps: [{ name: 'Tank0' }, { name: 'Infantry1' }, { name: 'Car4' }],
  searchTypes: [{ name: 'Tank', map: 0, level: 0 }, { name: 'Infantry', map: 1, level: 0 },
                { name: 'Boat', map: -1, level: -1 }, { name: 'Car', map: 2, level: 0 }],
};
const maps = index.maps.map((row, i) => ({ params: row, mapIndex: i }));
const strat = [0, 1, 2].map(i => ({ params: { map: i, level: 0, name: index.searchTypes.find(t => t.map === i).name } }));
const bundle = { index, maps, strategic: strat };
const pick = v => { const t = searchTypeMaps(bundle, v); return t && { type: t.type.name, map: t.row?.name ?? null, strategic: t.strategic?.params?.name ?? null }; };
out.types = { jeep0: pick(0), soldier1: pick(1), boat2: pick(2), car3: pick(3), plane: pick(-1), past: pick(9),
              strategicForCar: strategicFor(bundle, 2, 0)?.params?.name ?? null };

// --- the real levels ---
const tree = process.argv[2];
function level(name) {
  const dir = `${tree}/${name}`;
  if (!tree || !existsSync(`${dir}/pathfinding/index.json`)) return null;
  const sm = readSearchMaps(dir, f => (existsSync(f) ? new Uint8Array(readFileSync(f)) : null));
  if (!sm?.strategic?.length) return null;
  const res = { strategic: sm.strategic.map(s => s.name), types: sm.index.searchTypes.map(t => t.name) };
  res.components = {};
  for (const s of sm.strategic) {
    const seen = new Set();
    let comps = 0, regions = 0;
    for (let cz = 0; cz < s.cellsZ; cz++) for (let cx = 0; cx < s.cellsX; cx++) for (let k = 0; k < 4; k++) {
      if (!s.used(cx, cz, k)) continue;
      regions++;
      const key = `${cx},${cz},${k}`;
      if (seen.has(key)) continue;
      comps++;
      const q = [[cx, cz, k]];
      seen.add(key);
      while (q.length) {
        const [a, b, c] = q.pop();
        for (const [x, z, j] of s.neighbours(a, b, c)) {
          const kk = `${x},${z},${j}`;
          if (!seen.has(kk)) { seen.add(kk); q.push([x, z, j]); }
        }
      }
    }
    res.components[s.name] = { regions, components: comps };
  }
  const tankRow = sm.index.maps.find(m => /^Tank/i.test(m.name));
  const nav = buildNavMap({ searchMaps: sm, surfaceHeight: () => 0 }, sm.index.worldMapSize?.[0] ?? 2048,
    { waterDepth: tankRow.waterDepth, maxSlopeDeg: tankRow.maxSlope, brush: tankRow.brush,
      lowClip: tankRow.lowClip, hiClip: tankRow.hiClip });
  res.tankNav = { source: nav.source, strategic: nav.strategic?.name ?? null };
  return { res, nav };
}
const boc = level('bocage');
if (boc) {
  // The Axis base to the Allied base on the tank map, across both river
  // branches: the strategic legs, and every leg the bot's own local search
  // closes (the box `10 + rand x 14`, widened as `extendRoute` widens it).
  const path = findStrategicPath(boc.nav, 773.5, -954.3, 1371.7, -664.1);
  let fails = 0;
  for (let i = 1; path && i < path.length; i++) {
    const [fx, fz] = path[i - 1], [tx, tz] = path[i];
    let leg = findLocalPath(boc.nav, fx, fz, tx, tz, { radius: 18 });
    for (let w = 1; !leg && w <= 6; w++) leg = findLocalPath(boc.nav, fx, fz, tx, tz, { radius: 18 + 16 * w, maxNodes: 20000 * w });
    if (!leg) fails++;
  }
  boc.res.acrossRiver = { legs: path ? path.length - 2 : null, localFails: fails };
  out.bocage = boc.res;
}
const ea = level('el_alamein');
if (ea) out.el_alamein = ea.res;

console.log(JSON.stringify(out));
