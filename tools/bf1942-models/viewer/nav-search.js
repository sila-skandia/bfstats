// The searches over the bot navigation map: cell queries, the Bresenham
// line-of-walk, the local 4-connected A* with the engine's step cost, the
// strategic search over the coarse level, and the free-run / free-box probes
// the drive decision asks. The engine research, with every address, is
// `nav-grid.js`'s header; the map these run over is `nav-map.js`.

import { COARSE_CELL, CELL_FREE } from './nav-map.js';

/** `AStarLocalSearch::initNormal` +0xc: 0x400 nodes before a local search
 *  gives up. The viewer's box is drawn the same way, so the same cap. */
export const LOCAL_SEARCH_MAX_NODES = 0x400 * 8;

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
