// The engine's strategic map: the coarse layer a bot's route is first
// planned on, shipped per search type beside the level's search maps
// (`Pathfinding/<type>.raw` and `<type>Info.raw`) and loaded by `ai.loadMaps`
// (ledger AI-117; features/bf1942-ai-spec/movement.md). The extractor copies
// both files to `<level>/pathfinding/` (`bf42/ai_level.py
// level_strategic_maps`); `nav-baked.js` fetches them and `nav-search.js
// findStrategicPath` searches them when the unit's map has one.
//
// Read 2026-09-24 from bf1942_lnxded.static:
//
//  * `AIPathfinding::loadMaps` 0x0847c580 is `loadSearchMaps() &&
//    loadSearchTypes()` (vtable +0x100 / +0x104). `loadSearchTypes`
//    0x0847c6b0 calls `StrategicMap::load` 0x08609b60 on each
//    `VehicleMapInfo` (one per distinct (map, level) of `ai.addSearchType`,
//    `AIPathfinding::addSearchType` 0x0847ae80) until one fails. The map is
//    named after the first search type naming the pair
//    (`VehicleMapInfo::VehicleMapInfo` 0x0847a690).
//  * `<name>.raw`: `int32 w, h` (the map's `1 << (sizeBits - 6)`), then
//    `w x h` cells of 16 bytes, one per 64 m square, rows along the engine's
//    z. A cell holds up to four regions: bytes `4 + 2k` / `5 + 2k` are region
//    k's point inside the cell (`& 0x3f`, `StrategicCell::getPositionX/Z`
//    0x085f7ab0 / 0x085f7ad0, `StrategicMap::getPosition` 0x08480ed0), byte
//    12 bits 4..7 say which regions are used (`isUsed` 0x08480e30), and word
//    0 links them to the next cell: bit `4 i + k` joins region i to region k
//    of the cell at +z, bit `16 + 4 i + k` to region k of the cell at +x.
//  * `<name>Info.raw`: a `CellMap(name + "Info", level + 1, 1, 6, sizeX,
//    sizeZ)` (`StrategicMap::StrategicMap` 0x08607bf0): two bits a pixel,
//    the pixel `2^(level + 1)` m, 64 m blocks; the pixel is the region.
//  * `getStrategicCellInfoNo` 0x08608fa0: -1 on a pixel the unit's own
//    lowest-level map blocks; else the Info pixel; a 3 in a cell whose byte 4
//    has bit 6 set (more regions than four) stands only when a flood of the
//    free pixels inside the cell from the point reaches region 3's point
//    (`flooder<FlooderWrapperRT>` 0x0860a610, four-connected), else -1.
//  * `BotMain::initPathfinding` 0x0852a0d0: the goal must be free on the
//    unit's map (`isValidPosition` vt+0x78) and have a region (vt+0x90,
//    `VehicleInfo::getEncodedMapPos` 0x08481430), or there is no path; the
//    start likewise, from the last valid position when it stands on a
//    blocked cell. `updateStrategicPath` 0x08526e60: start and goal in the
//    same region of the same cell (`isInSameStrategicArea` 0x0847cb10, the
//    region used) need no strategic path; otherwise `strategicSearch`
//    0x0847dae0 runs `AStarStrategicSearch` over (cell, region) nodes, each
//    at its region's point (`init` 0x085f6f70), a step to one of the 16
//    neighbours the links allow (`newPositionAndCost` 0x085f73b0) costing
//    the Manhattan distance between the points, the heuristic the Manhattan
//    distance to the goal's point (`distanceEstimateToGoal` 0x085f72f0), the
//    goal its (cell, region) (`isGoal` 0x085f71a0, radius `round(0.01 x 5)`
//    = 0). The path's first node is dropped, and the second too when it is
//    the only one left; `updateLocalPath` 0x08527120 then refines toward
//    each remaining node's point in turn (`getStrategicPositionFromEncMapPos`
//    vt+0x98) and last toward the goal itself.

/** A strategic cell's side, metres. */
export const STRATEGIC_CELL = 64;
const CELL_BYTES = 16;

/**
 * Decode any `CellMap` file (`CellMap::loadRawFile` 0x085f86a0), whatever
 * its bits per pixel. `pixel(px, pz)` reads a pixel of its own level
 * (`CellMap::getPixel` 0x085f9a00: the pixel's bits start at bit
 * `(row * 2^(p5 - p3) + col) << p4` of its block, LSB first); outside is 0.
 */
export function decodeCellMap(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 24) throw new Error('cell map too short');
  const wb = view.getInt32(0, true), hb = view.getInt32(4, true);
  const p5 = view.getInt32(8, true), p3 = view.getInt32(12, true), p4 = view.getInt32(16, true);
  const count = view.getInt32(20, true);
  let off = 24;
  const specials = [];
  for (let i = 0; i < count; i++, off += 4) specials.push(view.getUint32(off, true));
  const blockWords = (4 << Math.max(1, p4 - 5 + 2 * (p5 - p3))) >> 2;
  const blocksX = 1 << wb, blocksZ = 1 << hb, n = blocksX * blocksZ;
  const blockAt = new Int32Array(n).fill(-1);
  const fill = new Uint32Array(n);
  const starts = [];
  for (let b = 0; b < n; b++) {
    if (off + 4 > bytes.byteLength) throw new Error('cell map truncated');
    const rec = view.getInt32(off, true);
    off += 4;
    if (rec < 0) {
      blockAt[b] = starts.length * blockWords;
      starts.push(off);
      off += blockWords * 4;
    } else {
      if (rec >= count) throw new Error(`special cell ${rec} of ${count}`);
      fill[b] = specials[rec];
    }
  }
  if (off !== bytes.byteLength) throw new Error(`cell map has ${bytes.byteLength - off} trailing bytes`);
  const words = new Uint32Array(starts.length * blockWords);
  starts.forEach((s, k) => {
    for (let w = 0; w < blockWords; w++) words[k * blockWords + w] = view.getUint32(s + w * 4, true);
  });
  const per = 1 << (p5 - p3), mask = (1 << (1 << p4)) - 1;
  return {
    level: p3, bitsExp: p4, blockExp: p5, blocksX, blocksZ, pixelSize: 2 ** p3,
    pixel(px, pz) {
      if (px < 0 || pz < 0 || px >= blocksX * per || pz >= blocksZ * per) return 0;
      const b = Math.floor(pz / per) * blocksX + Math.floor(px / per);
      const bit = ((pz % per) * per + (px % per)) << p4;
      const at = blockAt[b];
      const word = at < 0 ? fill[b] : words[at + (bit >>> 5)];
      return (word >>> (bit & 31)) & mask;
    },
    /** The pixel under map position `(x, z)`: metres, the engine's z. */
    valueAt(x, zEngine) {
      return this.pixel(Math.floor(x / this.pixelSize), Math.floor(zEngine / this.pixelSize));
    },
  };
}

/** Decode `<type>.raw`: `{ cellsX, cellsZ, cells }` (16 bytes a cell). */
export function decodeStrategicCells(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8) throw new Error('strategic map too short');
  const w = view.getInt32(0, true), h = view.getInt32(4, true);
  if (!(w > 0 && h > 0) || bytes.byteLength !== 8 + w * h * CELL_BYTES) {
    throw new Error(`strategic map ${w} x ${h} in ${bytes.byteLength} bytes`);
  }
  return { cellsX: w, cellsZ: h, cells: bytes.slice(8) };
}

/** A binary min-heap over node ids keyed by an external f table. */
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
 * One search type's strategic map. Positions are the engine's: `x` world x,
 * `z` the engine's z (the viewer's -z, the nav map's rows).
 */
export class StrategicMap {
  /**
   * @param {{cellsX:number, cellsZ:number, cells:Uint8Array}} cells
   * @param {ReturnType<typeof decodeCellMap>} info
   * @param {object} [params] the index row (`name`, `map`, `level`)
   */
  constructor(cells, info, params = null) {
    this.cellsX = cells.cellsX;
    this.cellsZ = cells.cellsZ;
    this.cells = cells.cells;
    this.info = info;
    this.params = params;
    this.name = params?.name ?? null;
  }

  _byte(cx, cz, i) { return this.cells[(cz * this.cellsX + cx) * CELL_BYTES + i]; }

  _links(cx, cz) {
    const o = (cz * this.cellsX + cx) * CELL_BYTES;
    const c = this.cells;
    return (c[o] | (c[o + 1] << 8) | (c[o + 2] << 16) | (c[o + 3] << 24)) >>> 0;
  }

  inside(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.cellsX && cz < this.cellsZ; }

  /** `StrategicCell::isUsed` 0x08480e30. */
  used(cx, cz, k) { return this.inside(cx, cz) && ((this._byte(cx, cz, 12) >> (4 + k)) & 1) === 1; }

  /** Region k's point, `[x, z]` metres (`StrategicMap::getPosition` 0x08480ed0). */
  point(cx, cz, k) {
    return [cx * STRATEGIC_CELL + (this._byte(cx, cz, 4 + 2 * k) & 0x3f),
            cz * STRATEGIC_CELL + (this._byte(cx, cz, 5 + 2 * k) & 0x3f)];
  }

  /**
   * `StrategicMap::getStrategicCellInfoNo` 0x08608fa0: the region of the
   * pixel under `(x, z)`, or -1. `blocked(ix, iz)` is the unit's own
   * lowest-level map at a whole map position.
   */
  regionAt(x, z, blocked) {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (blocked(ix, iz)) return -1;
    const cx = ix >> 6, cz = iz >> 6;
    if (!this.inside(cx, cz)) return -1;
    const v = this.info.valueAt(ix, iz);
    if (v !== 3 || ((this._byte(cx, cz, 4) >> 6) & 1) === 0) return v;
    // More than four regions in this cell: a 3 is region 3 only when the
    // free pixels inside the cell join it to region 3's point.
    const [tx, tz] = this.point(cx, cz, 3);
    const x0 = cx * STRATEGIC_CELL, z0 = cz * STRATEGIC_CELL;
    const seen = new Uint8Array(STRATEGIC_CELL * STRATEGIC_CELL);
    const stack = [(iz - z0) * STRATEGIC_CELL + (ix - x0)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      const lx = i & 63, lz = i >> 6;
      if (x0 + lx === tx && z0 + lz === tz) return 3;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = lx + dx, nz = lz + dz;
        if (nx < 0 || nz < 0 || nx >= STRATEGIC_CELL || nz >= STRATEGIC_CELL) continue;
        const j = nz * STRATEGIC_CELL + nx;
        if (seen[j] || blocked(x0 + nx, z0 + nz)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return -1;
  }

  /** The encoded position `{ cx, cz, k }` of `(x, z)`, or null. */
  encode(x, z, blocked) {
    const k = this.regionAt(x, z, blocked);
    if (k < 0) return null;
    return { cx: Math.floor(x) >> 6, cz: Math.floor(z) >> 6, k };
  }

  /** `AIPathfinding::isInSameStrategicArea` 0x0847cb10. */
  sameArea(a, b) {
    return a.cx === b.cx && a.cz === b.cz && a.k === b.k && this.used(a.cx, a.cz, a.k);
  }

  /**
   * The (cell, region) nodes a step from `(cx, cz, i)` may reach
   * (`AStarStrategicSearch::newPositionAndCost` 0x085f73b0): direction
   * `d = n >> 2`, region `k = n & 3`; +z and +x from this cell's own links,
   * -z and -x from the neighbour's, which must use region k.
   */
  neighbours(cx, cz, i, out = []) {
    out.length = 0;
    const own = this._links(cx, cz);
    for (let k = 0; k < 4; k++) {
      if (((own >>> (4 * i + k)) & 1) && this.inside(cx, cz + 1)) out.push([cx, cz + 1, k]);
      if (((own >>> (16 + 4 * i + k)) & 1) && this.inside(cx + 1, cz)) out.push([cx + 1, cz, k]);
      if (this.used(cx, cz - 1, k) && ((this._links(cx, cz - 1) >>> (4 * k + i)) & 1)) out.push([cx, cz - 1, k]);
      if (this.used(cx - 1, cz, k) && ((this._links(cx - 1, cz) >>> (16 + 4 * k + i)) & 1)) out.push([cx - 1, cz, k]);
    }
    return out;
  }

  /**
   * `AStarStrategicSearch` from the encoded `start` to `goal`: the nodes'
   * points `[x, z, k]` from the start's to the goal's, or null.
   */
  search(start, goal) {
    const W = this.cellsX;
    const id = (cx, cz, k) => ((cz * W + cx) << 2) | k;
    const n = this.cellsX * this.cellsZ * 4;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const [gx, gz] = this.point(goal.cx, goal.cz, goal.k);
    const s = id(start.cx, start.cz, start.k), e = id(goal.cx, goal.cz, goal.k);
    const goalUsed = this.used(goal.cx, goal.cz, goal.k);
    const pt = i => this.point((i >> 2) % W, Math.floor((i >> 2) / W), i & 3);
    g[s] = 0;
    const [sx, sz] = pt(s);
    f[s] = Math.abs(sx - gx) + Math.abs(sz - gz);
    const heap = new Heap(f);
    heap.push(s);
    const nb = [];
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === e && goalUsed) { found = true; break; }
      closed[cur] = 1;
      const ccx = (cur >> 2) % W, ccz = Math.floor((cur >> 2) / W), ck = cur & 3;
      const [px, pz] = this.point(ccx, ccz, ck);
      for (const [ncx, ncz, nk] of this.neighbours(ccx, ccz, ck, nb)) {
        const ni = id(ncx, ncz, nk);
        if (closed[ni]) continue;
        const [qx, qz] = this.point(ncx, ncz, nk);
        const t = g[cur] + Math.abs(qx - px) + Math.abs(qz - pz);
        if (t < g[ni]) {
          g[ni] = t;
          f[ni] = t + Math.abs(qx - gx) + Math.abs(qz - gz);
          came[ni] = cur;
          heap.push(ni);
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let i = e; i !== -1; i = came[i]) {
      const [x, z] = pt(i);
      out.push([x, z, i & 3]);
      if (i === s) break;
    }
    return out.reverse();
  }

  /**
   * `BotMain::initPathfinding` 0x0852a0d0 + `updateStrategicPath`
   * 0x08526e60 for a route from `(x0, z0)` to `(x1, z1)` (engine frame):
   * `{ legs }`, the region points to refine toward before the goal (empty
   * when both ends share a region, or the path is only its two ends), or
   * `{ legs: null, reason }` when the engine has no path.
   */
  route(x0, z0, x1, z1, blocked) {
    const goal = this.encode(x1, z1, blocked);
    if (!goal) return { legs: null, reason: blocked(Math.floor(x1), Math.floor(z1)) ? 'goal blocked' : 'goal has no region' };
    const start = this.encode(x0, z0, blocked);
    if (!start) return { legs: null, reason: 'start has no region' };
    if (this.sameArea(start, goal)) return { legs: [] };
    const path = this.search(start, goal);
    if (!path) return { legs: null, reason: 'no strategic path' };
    path.shift();
    if (path.length === 1) path.shift();
    return { legs: path };
  }
}

/** Build a `StrategicMap` from the two files' bytes. */
export function strategicMapFromBytes(cellsBytes, infoBytes, params = null) {
  return new StrategicMap(decodeStrategicCells(cellsBytes), decodeCellMap(infoBytes), params);
}
