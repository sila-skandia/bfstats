// The level's own search maps: the bitmaps the level archive ships baked
// (`Pathfinding/<name>Level<L>Map.raw`) and the retail server loads with
// `ai.loadMaps` instead of painting (ledger AI-93, AI-95). The extractor
// copies each loaded map's lowest level to `<level>/pathfinding/` with an
// `index.json` (`bf42/ai_level.py write_level_search_maps`); this module
// fetches and decodes them, and `buildNavMap` (`nav-map.js`) takes a baked
// map's pixels in place of its own paint when the level has one for the
// parameters it is asked to build.
//
// The file (`CellMap::loadRawFile` 0x085f8930, read 2026-09-24):
//  * five int32 the `CellMap` must match: `log2` blocks across (+0x18),
//    `log2` blocks down (+0x20), the block's size exponent `level + 6`
//    (+0x10), the level (+0x2c), the bits-per-pixel exponent (+0x24, 0 for
//    these one-bit maps); any mismatch, or no file, and the load fails;
//  * the special-cell count and the special cells (each a 32-bit word that
//    fills every word of a block: 0 all free, 0xffffffff all blocked);
//  * one int32 per block, row-major: `>= 0` a special-cell index, `< 0`
//    followed inline by the block's own `4 << (p4 - 5 + 2 * (p5 - p3))`
//    bytes (512 for a 64 x 64 one-bit block).
// A pixel (`CellMap::getPixel` 0x085f9a00) of map position `(x, z)`: block
// `(x >> p5) + ((z >> p5) << +0x20)`, and inside it column `(x & 63 << p3)
// >> p3`, row likewise, bit `col & 31` of word `row * 2 + (col >> 5)`, LSB
// first; 1 is blocked. A level-L pixel is `1 << L` metres
// (`LocalMap::getLevelPixelSize` 0x085ff170), so the lowest level of a
// `Boat2 ... 2 5` map is a 4 m pixel. `x` is world x and `z` the engine's z
// (the glTF frame's -z): the nav map's rows.

/**
 * Decode one baked search-map level.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {BakedSearchMap}
 */
export function decodeSearchMap(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 24) throw new Error('search map too short');
  const wb = view.getInt32(0, true), hb = view.getInt32(4, true);
  const p5 = view.getInt32(8, true), level = view.getInt32(12, true), p4 = view.getInt32(16, true);
  if (p4 !== 0) throw new Error(`not a one-bit search map (bits exponent ${p4})`);
  if (p5 - level !== 6) throw new Error(`block size exponent ${p5} at level ${level}`);
  const count = view.getInt32(20, true);
  let off = 24;
  const specials = new Uint32Array(count);
  for (let i = 0; i < count; i++, off += 4) specials[i] = view.getUint32(off, true);
  const blockWords = 128;                        // 4 << 7 bytes
  const blocksX = 1 << wb, blocksZ = 1 << hb;
  const nBlocks = blocksX * blocksZ;
  const blockFill = new Uint32Array(nBlocks);
  const blockAt = new Int32Array(nBlocks).fill(-1);
  const inline = [];
  for (let b = 0; b < nBlocks; b++) {
    if (off + 4 > bytes.byteLength) throw new Error('search map truncated');
    const rec = view.getInt32(off, true);
    off += 4;
    if (rec < 0) {
      if (off + blockWords * 4 > bytes.byteLength) throw new Error('search map block truncated');
      blockAt[b] = inline.length * blockWords;
      inline.push(off);
      off += blockWords * 4;
    } else {
      if (rec >= count) throw new Error(`special cell ${rec} of ${count}`);
      blockFill[b] = specials[rec];
    }
  }
  if (off !== bytes.byteLength) throw new Error(`search map has ${bytes.byteLength - off} trailing bytes`);
  const words = new Uint32Array(inline.length * blockWords);
  inline.forEach((start, k) => {
    for (let w = 0; w < blockWords; w++) words[k * blockWords + w] = view.getUint32(start + w * 4, true);
  });
  return new BakedSearchMap({ level, blocksX, blocksZ, blockFill, blockAt, words });
}

/** One decoded level: `blocked(px, pz)` on its own pixels, `blockedAt` in metres. */
export class BakedSearchMap {
  constructor({ level, blocksX, blocksZ, blockFill, blockAt, words }) {
    this.level = level;
    this.pixelSize = 2 ** level;
    this.blocksX = blocksX;
    this.blocksZ = blocksZ;
    this.width = blocksX * 64;
    this.height = blocksZ * 64;
    this.blockFill = blockFill;
    this.blockAt = blockAt;
    this.words = words;
    /** The index row it came with (name and search-map parameters). */
    this.params = null;
  }

  /** Pixel `(px, pz)` of this level; outside the map is blocked. */
  blocked(px, pz) {
    if (px < 0 || pz < 0 || px >= this.width || pz >= this.height) return true;
    const b = (pz >> 6) * this.blocksX + (px >> 6);
    const col = px & 63, row = pz & 63;
    const at = this.blockAt[b];
    const word = at < 0 ? this.blockFill[b] : this.words[at + row * 2 + (col >> 5)];
    return ((word >>> (col & 31)) & 1) === 1;
  }

  /** The pixel under world `x`, engine `z` (metres). */
  blockedAt(x, zEngine) {
    return this.blocked(Math.floor(x / this.pixelSize), Math.floor(zEngine / this.pixelSize));
  }
}

/** The parameters `buildNavMap` is asked for, against an index row. */
const PARAM_KEYS = [
  ['waterMap', 'waterMap'], ['waterDepth', 'waterDepth'], ['maxSlopeDeg', 'maxSlope'],
  ['brush', 'brush'], ['lowClip', 'lowClip'], ['hiClip', 'hiClip'],
];

/**
 * The baked map a `buildNavMap` call stands for: `searchMaps` (what
 * `loadSearchMaps` returned) against the call's own parameters, all six of
 * them (`ai.addSearchMap`'s `waterHeight / waterDepth / maxSlope / brush /
 * lowClip / hiClip`), or null. The callers build their options from the
 * level's own `searchMaps` rows, so a level's map is found by what it is,
 * whatever the caller calls it.
 */
export function findSearchMap(searchMaps, opts) {
  if (!searchMaps?.maps?.length) return null;
  for (const map of searchMaps.maps) {
    const p = map.params;
    if (!p) continue;
    let ok = true;
    for (const [mine, theirs] of PARAM_KEYS) {
      const a = opts[mine], b = p[theirs];
      if (mine === 'waterMap') { if (!!a !== !!b) { ok = false; break; } continue; }
      if (!(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6)) { ok = false; break; }
    }
    if (ok) return map;
  }
  return null;
}

/**
 * Fetch and decode a level's baked search maps from `<base>/pathfinding/`.
 * Resolves to `{ maps: BakedSearchMap[], index }` (each map's `params` its
 * index row), or null when the level has none (no index, or none loaded).
 * `fetchImpl` defaults to the page's `fetch`; `suffix` is the cache buster.
 */
export async function loadSearchMaps(base, { fetchImpl = globalThis.fetch, suffix = '' } = {}) {
  let index;
  try {
    const r = await fetchImpl(`${base}/pathfinding/index.json${suffix}`);
    if (!r.ok) return null;
    index = await r.json();
  } catch { return null; }
  const rows = (index?.maps ?? []).filter(row => row.loaded && row.file);
  const maps = await Promise.all(rows.map(async row => {
    try {
      const r = await fetchImpl(`${base}/pathfinding/${row.file}${suffix}`);
      if (!r.ok) return null;
      const map = decodeSearchMap(new Uint8Array(await r.arrayBuffer()));
      map.params = row;
      return map;
    } catch { return null; }
  }));
  const loaded = maps.filter(Boolean);
  return loaded.length ? { maps: loaded, index } : null;
}

/** The same from a directory on disk (the headless runner): `readFile(path)`
 *  returns the bytes or null. */
export function readSearchMaps(dir, readFile) {
  const text = readFile(`${dir}/pathfinding/index.json`);
  if (!text) return null;
  const index = JSON.parse(new TextDecoder().decode(text));
  const maps = [];
  for (const row of index?.maps ?? []) {
    if (!row.loaded || !row.file) continue;
    const bytes = readFile(`${dir}/pathfinding/${row.file}`);
    if (!bytes) continue;
    const map = decodeSearchMap(bytes);
    map.params = row;
    maps.push(map);
  }
  return maps.length ? { maps, index } : null;
}
