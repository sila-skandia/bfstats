// A walk test on a level's real collision: a fine flood of the places the
// page's soldier can stand, grown one short step at a time with the body the
// page really moves (features/bot-map-generation, section 16). It answers the
// questions a one-bit search map cannot: whether a pocket of the map has a
// way out on foot, how high above its ground a point stands, and whether the
// play surface is one floor or several stacked.
//
// The body is read from the viewer's own soldier code (`soldierBody`): the
// capsule's reach and height, the step the page lifts a grounded body by,
// the slope it refuses, and the apex of a jump at the engine's tick. A
// bot on the page never jumps (`bot.jumpRequest` is only ever cleared), so a
// way out that needs a jump is reported apart and is not a way out for bots.
//
// One standing height is kept per fine cell (the first the flood reaches):
// this is a test of one floor. Stacked floors are classed out, not walked.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerDir } from './env.mjs';

/** The flood's cell, metres: fine enough that a 1.25 m door holds a row of standing points. */
export const FINE_CELL = 0.25;
/** How far a body may drop in one step and walk on, metres: the fall that costs no health (`fall-damage.js
 *  FALL_HEIGHT_FREE`; `soldierBody` reads the viewer's own). A way out that takes a longer fall is not one. */
export const MAX_DROP = 2;
/** Gap kept between the swept body and what it passes, as the page's resolve keeps (`soldier-resolve.js` SKIN). */
const SKIN = 0.01;

/** The page's soldier, from the viewer's modules: `{ radius, height, step, jump, slopeCos, wade }`. */
export async function soldierBody(viewer = null) {
  const imp = f => import(pathToFileURL(path.join(viewerDir(viewer), f)).href);
  const [loco, pose, resolve, body, nav, fall, swim] = await Promise.all(
    ['soldier-locomotion.js', 'soldier-pose.js', 'soldier-resolve.js', 'point-body.js', 'nav-map.js', 'fall-damage.js', 'swim.js'].map(imp));
  // The apex of a jump at the engine's tick: the impulse and gravity's share of the same tick, then free fall.
  const dt = 1 / loco.ENGINE_TICK_RATE;
  let v = loco.JUMP_IMPULSE + body.GRAVITY * dt, jump = 0;
  while (v > 0) { jump += v * dt; v += body.GRAVITY * dt; }
  return {
    radius: resolve.HULL_REACH - SKIN, height: pose.BODY_HEIGHT[0], step: loco.STEP_HEIGHT,
    jump: +jump.toFixed(3), slopeCos: loco.MAX_GROUND_SLOPE,
    // Water a soldier crosses on their feet: no deeper than the infantry map's own limit, and no deeper than
    // the depth a swimmer stands up at (`swim.js SWIM_LEAVE_WATER`, 1.35 m). Deeper and they swim, and a
    // swimmer's Armor takes the water-damage tick: on Forgotten Hope's Pegasus the canal is 1.4 m deep, the
    // map's 1.5 m called it ground, and the bots sent across it died in it with no kill to show for it.
    wade: Math.min(nav.INFANTRY_SEARCH_MAP.waterDepth, swim.SWIM_LEAVE_WATER),
    drop: fall.FALL_HEIGHT_FREE ?? MAX_DROP,
  };
}

/**
 * The surface a body stands on at `(x, z)` at or below `fromY`: `{ y, ny }`
 * or null (nothing within `reach`, or water deeper than a soldier wades).
 * `collider` is the page's `WorldCollider`.
 */
/** Whether terrain at height `bed` lies under more water than a soldier wades. */
function drowned(collider, bed, wade) {
  const water = collider?.waterLevel;
  return Number.isFinite(water) && Number.isFinite(bed) && water - bed > wade;
}

export function floorBelow(collider, x, z, fromY, reach = 1e4, wade = 1.5) {
  const hit = collider.cast(x, fromY, z, 0, -1, 0, reach);
  if (!hit) return null;
  if (hit.kind === 'water') {
    const bed = collider.heightfield ? collider.heightfield.height(x, z) : NaN;
    if (!Number.isFinite(bed) || hit.y - bed > wade) return null;
    return { y: bed, ny: 1, kind: 'terrain' };
  }
  // The collider's ray finds the terrain by bisection, good to centimetres; the height itself is exact.
  if (hit.kind === 'terrain' && collider.heightfield) {
    const bed = collider.heightfield.height(x, z);
    // A ray begun under the surface (the place it steps from is already in the water) meets the bed and
    // never the water plane: the depth is asked here too, or a bank that shelves gently lets the flood
    // walk on down a channel of any depth. Forgotten Hope's Pegasus canal is 5 to 7 m deep.
    if (drowned(collider, bed, wade)) return null;
    return { y: bed, ny: hit.ny, kind: 'terrain' };
  }
  return { y: hit.y, ny: hit.ny, kind: hit.kind };
}

/** Every surface under `(x, z)` from `fromY` down to `toY`, highest first: `[{ y, ny, kind }]`. */
export function floorsBelow(collider, x, z, fromY, toY, wade = 1.5) {
  const out = [];
  let y = fromY;
  for (let i = 0; i < 32 && y > toY; i++) {
    const hit = collider.cast(x, y, z, 0, -1, 0, y - toY);
    if (!hit) break;
    if (hit.kind === 'water') {
      const bed = collider.heightfield ? collider.heightfield.height(x, z) : NaN;
      if (Number.isFinite(bed) && hit.y - bed <= wade && bed >= toY) out.push({ y: bed, ny: 1, kind: 'terrain' });
      break;
    }
    if (hit.kind === 'terrain' && drowned(collider, hit.y, wade)) break;
    out.push({ y: hit.y, ny: hit.ny, kind: hit.kind });
    if (hit.kind !== 'object') break;
    y = hit.y - 0.05;
  }
  return out;
}

/** Two standing places over one fine cell are two floors when this far apart in height, metres. */
export const FLOOR_GAP = 1.5;
/** Two floods meet on the same surface when their heights over a cell agree within this, metres. */
const SAME_FLOOR = 0.3;
/** Floors kept per fine cell. */
const LAYERS = 3;

/**
 * Flood the standing places from `starts` (`[[x, y, z], ...]`, a soldier's
 * feet). `goal(x, z, y)` stops it on the first place it is true for.
 * `jump: true` lets a step rise by the jump's apex instead of the step;
 * `drop` is the furthest a step may fall. `twoWay: true` keeps only the
 * moves that can be walked back: no fall past the step, and none off
 * terrain the page would refuse to climb back onto.
 *
 * A fine cell holds up to three standing heights `FLOOR_GAP` apart, so a
 * floor under another is walked as its own floor.
 *
 * Returns `{ reached, cells, path, capped, at, each, regionOf, startRegion }`:
 * `cells` the number of standing places found, `path` the places `[x, z, y]`
 * from a start to the goal, `at(x, z)` the heights found over a point
 * (highest first), `each(fn)` every place as `fn(x, z, y, region)`, `capped`
 * true when `maxCells` ended it before the ground ran out, `open()` the
 * regions it had not finished then, and `join(p, q)` makes two regions one.
 *
 * A place carries the start it was reached from, and two starts whose
 * floods touch are one region: with `drop` no more than the step every move
 * can be walked back, so a region is ground whose every place reaches every
 * other. `regionOf(x, z, y)` and `startRegion[i]` name it (-1 for none).
 */
export function walkFlood(collider, starts, body, { goal = null, jump = false, twoWay = false, drop = twoWay ? body.step : body.drop ?? MAX_DROP, cell = FINE_CELL, reach = 80, maxCells = 8000000, bounds = null } = {}) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of starts) { minX = Math.min(minX, s[0]); maxX = Math.max(maxX, s[0]); minZ = Math.min(minZ, s[2]); maxZ = Math.max(maxZ, s[2]); }
  const box = bounds ?? { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach };
  const ox = Math.floor(box.minX / cell), oz = Math.floor(box.minZ / cell);
  const w = Math.max(1, Math.ceil(box.maxX / cell) - ox + 1), h = Math.max(1, Math.ceil(box.maxZ / cell) - oz + 1);
  const ys = new Float32Array(w * h * LAYERS).fill(NaN);
  const parent = new Int32Array(w * h * LAYERS).fill(-1);
  const label = new Int32Array(w * h * LAYERS).fill(-1);
  // Terrain whose normal the page reads as too steep to climb (`refuseSteepGround`): stepping up onto it is refused.
  const steep = new Uint8Array(w * h * LAYERS);
  const isSteep = f => (f.kind === 'terrain' && f.ny < body.slopeCos ? 1 : 0);
  const group = starts.map((_, i) => i);
  const find = i => { while (group[i] !== i) { group[i] = group[group[i]]; i = group[i]; } return i; };
  const queue = new Int32Array(Math.min(w * h * LAYERS, maxCells + starts.length + 8));
  let head = 0, tail = 0, cells = 0, goalAt = -1, capped = false, full = false;
  const r = body.radius, climb = jump ? body.jump : body.step;
  const top = body.height - r;
  const xOf = c => ((c % w) + ox + 0.5) * cell, zOf = c => (Math.floor(c / w) + oz + 0.5) * cell;
  /** The place at height `y` over cell `c`: its slot, or -1. */
  const found = (c, y) => {
    for (let k = 0; k < LAYERS; k++) {
      const v = ys[c * LAYERS + k];
      if (Number.isNaN(v)) return -1;
      if (Math.abs(v - y) < FLOOR_GAP) return c * LAYERS + k;
    }
    return -1;
  };
  const push = (c, f, from, mark) => {
    let s = -1;
    for (let k = 0; k < LAYERS && s < 0; k++) if (Number.isNaN(ys[c * LAYERS + k])) s = c * LAYERS + k;
    if (s < 0) return;
    if (tail >= queue.length) { capped = true; full = true; return; }
    ys[s] = f.y; steep[s] = isSteep(f); parent[s] = from; label[s] = mark; queue[tail++] = s; cells++;
  };
  const startRegion = starts.map(() => -1);
  starts.forEach((s, n) => {
    const ix = Math.floor(s[0] / cell) - ox, iz = Math.floor(s[2] / cell) - oz;
    if (ix < 0 || iz < 0 || ix >= w || iz >= h) return;
    const c = iz * w + ix;
    // A spawn point is where the feet are put; the floor under it is where they land.
    const f = floorBelow(collider, xOf(c), zOf(c), s[1] + body.step, (body.drop ?? MAX_DROP) + body.step, body.wade);
    if (!f) return;
    const had = found(c, f.y);
    if (had >= 0) group[find(n)] = find(label[had]);
    else push(c, f, -1, n);
    startRegion[n] = n;
  });
  const clear = (ax, ay, az, dx, dz, floor) => {
    // The page's capsule (`soldier-resolve.js capsule`): three spheres, the lowest lifted by the step.
    // A jump crosses at its apex, so what it clears there it clears; airborne, nothing lifts the lowest sphere.
    const base = jump ? ay + body.jump : floor;
    const low = (jump ? 0.05 : body.step) + r, mid = (low + top) / 2;
    for (const off of [low, mid, top]) {
      const hit = collider.sweepSphere(ax, base + off, az, dx, 0, dz, cell, r, -1, true);
      // A contact the move travels away from cannot stop it (the same rule as the page's sweep).
      if (hit && hit.t < cell - 1e-4 && dx * hit.nx + dz * hit.nz < -1e-6) return false;
    }
    // Rising more than a step: the head needs the room above where it stands.
    if (base - ay > body.step) {
      const hit = collider.sweepSphere(ax, ay + top, az, 0, 1, 0, base - ay, r, -1, true);
      if (hit && hit.t < base - ay - 1e-4) return false;
    }
    return true;
  };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < tail && goalAt < 0) {
    const s = queue[head++];
    const c = Math.floor(s / LAYERS);
    const ax = xOf(c), az = zOf(c), ay = ys[s];
    if (goal && goal(ax, az, ay)) { goalAt = s; break; }
    if (cells >= maxCells) { capped = true; break; }
    const ix = c % w, iz = (c - ix) / w;
    for (const [dx, dz] of DIRS) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      const f = floorBelow(collider, xOf(j), zOf(j), ay + climb + 0.02, climb + drop + 0.02, body.wade);
      if (!f) continue;
      // The page's two slope rules: a hull's floor steeper than the limit is not stood on, and the terrain
      // refuses a move uphill onto ground whose normal is past it (`soldier-resolve.js refuseSteepGround`).
      if (f.ny < body.slopeCos && (f.kind !== 'terrain' || f.y > ay + SKIN)) continue;
      if (twoWay && steep[s] && ay > f.y + SKIN) continue;
      const had = found(j, f.y);
      // A place another start's flood holds: the two are one region when the step between them is real.
      if (had >= 0 && (find(label[had]) === find(label[s]) || Math.abs(ys[had] - f.y) > SAME_FLOOR)) continue;
      if (!clear(ax, ay, az, dx, dz, Math.max(ay, f.y))) continue;
      if (had >= 0) group[find(label[had])] = find(label[s]);
      else push(j, f, s, label[s]);
    }
  }
  let route = null;
  if (goalAt >= 0) {
    route = [];
    for (let s = goalAt; s >= 0; s = parent[s]) { const c = Math.floor(s / LAYERS); route.push([xOf(c), zOf(c), ys[s]]); }
    route.reverse();
  }
  const at = (x, z) => {
    const ix = Math.floor(x / cell) - ox, iz = Math.floor(z / cell) - oz;
    if (ix < 0 || iz < 0 || ix >= w || iz >= h) return [];
    const c = iz * w + ix, out = [];
    for (let k = 0; k < LAYERS; k++) if (!Number.isNaN(ys[c * LAYERS + k])) out.push(ys[c * LAYERS + k]);
    return out.sort((p, q) => q - p);
  };
  const each = fn => {
    for (let q = 0; q < tail; q++) { const s = queue[q], c = Math.floor(s / LAYERS); fn(xOf(c), zOf(c), ys[s], find(label[s])); }
  };
  const regionOf = (x, z, y) => {
    const ix = Math.floor(x / cell) - ox, iz = Math.floor(z / cell) - oz;
    if (ix < 0 || iz < 0 || ix >= w || iz >= h) return -1;
    const s = found(iz * w + ix, y);
    return s < 0 ? -1 : find(label[s]);
  };
  // What the cap left unfinished: the regions of the places still waiting to be grown from (the one the cap
  // stopped on with them). A region not among them ran out of ground, and its edge is the ground's own.
  const waiting = [];
  if (capped) for (let q = Math.max(0, head - 1); q < tail; q++) waiting.push(label[queue[q]]);
  const open = () => (full ? [...new Set(group.map((_, i) => find(i)))] : [...new Set(waiting.map(find))]);
  /** Make two regions one (`walkFacts` does, for unfinished regions a walk map joins). */
  const join = (p, q) => { if (p >= 0 && q >= 0) group[find(p)] = find(q); };
  return { reached: goalAt >= 0, cells, path: route, capped, at, each, regionOf, cell, jump, open, join,
           get startRegion() { return startRegion.map(n => (n < 0 ? -1 : find(n))); } };
}

/**
 * Whether a soldier at `starts` can walk to a place `goal` accepts: first
 * with the step alone, then with jumps. `{ way: 'walk' | 'jump' | 'none',
 * path, cells, capped }`.
 */
export function wayOut(collider, starts, body, goal, options = {}) {
  const walk = walkFlood(collider, starts, body, { ...options, goal });
  if (walk.reached) return { way: 'walk', path: walk.path, cells: walk.cells, capped: false };
  const hop = walkFlood(collider, starts, body, { ...options, goal, jump: true });
  if (hop.reached) return { way: 'jump', path: hop.path, cells: walk.cells, capped: false };
  return { way: 'none', path: null, cells: walk.cells, capped: walk.capped || hop.capped };
}

/** 4-connected components of a walk map's free cells: `Int32Array` of ids (0 blocked) and each id's size. */
export function components(grid) {
  const { width, height, blocked } = grid;
  const id = new Int32Array(width * height);
  const sizes = [0];
  const stack = [];
  for (let start = 0; start < id.length; start++) {
    if (blocked[start] || id[start]) continue;
    const n = sizes.length;
    let size = 0;
    id[start] = n; stack.push(start);
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % width, z = (i - x) / width;
      if (x > 0 && !blocked[i - 1] && !id[i - 1]) { id[i - 1] = n; stack.push(i - 1); }
      if (x < width - 1 && !blocked[i + 1] && !id[i + 1]) { id[i + 1] = n; stack.push(i + 1); }
      if (z > 0 && !blocked[i - width] && !id[i - width]) { id[i - width] = n; stack.push(i - width); }
      if (z < height - 1 && !blocked[i + width] && !id[i + width]) { id[i + width] = n; stack.push(i + width); }
    }
    sizes.push(size);
  }
  return { id, sizes };
}

// INVENTION, all of the measures below: the engine has no walk test, no notion of a storey and no class of
// level it will not map. They are this tool's own, fixed here before any level was classed.

/** A soldier spawn's own free cell is looked for this far from it, metres. */
export const SPAWN_CELL_REACH = 3;
/** Two walked floors this far apart over the same spot are two storeys, metres. */
export const STOREY = 2.5;
/** "The same spot": how far from a point another floor is looked for under or over it, metres. */
export const OVER_REACH = 1;
/** The margin the flood keeps around the level's spawns and flags, metres. Two grounds that join only
 *  further out than this read as apart (measured: 24 m split _o_Jka__BIG's two bases, which join to the north). */
export const FLOOD_MARGIN = 96;
/** The play surface is stacked when this share of the main floor has another walked floor over or under it,
 *  or this share of the capturable flags stand a storey over or under another walked floor. */
export const STACKED_SHARE = 0.1, STACKED_FLAGS = 0.5;
/** A walk map that holds less than this share of the main ground free is not a map of that ground. */
export const MAP_COVER = 0.5;

const cellIndex = (grid, x, z) => {
  const gx = Math.floor(x / grid.cellSize), gz = Math.floor(-z / grid.cellSize);
  return gx < 0 || gz < 0 || gx >= grid.width || gz >= grid.height ? -1 : gz * grid.width + gx;
};

/** The box a level's walk test floods: its spawns and flags and `FLOOD_MARGIN` around them, inside the world's square. */
export function floodBounds(points, worldSize = Infinity) {
  const eps = FINE_CELL / 2;
  return {
    minX: Math.max(eps, Math.min(...points.map(p => p.x)) - FLOOD_MARGIN), maxX: Math.min(worldSize - eps, Math.max(...points.map(p => p.x)) + FLOOD_MARGIN),
    minZ: Math.max(-worldSize + eps, Math.min(...points.map(p => p.z)) - FLOOD_MARGIN), maxZ: Math.min(-eps, Math.max(...points.map(p => p.z)) + FLOOD_MARGIN),
  };
}

/**
 * The ground every soldier spawn of a level can walk, as a flood whose
 * every move can be walked back (`drop` is the step): its regions are
 * ground whose places all reach each other. `spawns` `[{ x, y, z }]`.
 */
export function walkedGround(collider, spawns, flags, body, worldSize = Infinity) {
  const starts = spawns.map(s => [s.x, s.y, s.z]);
  const options = { twoWay: true, bounds: floodBounds([...spawns, ...flags], worldSize) };
  const flood = walkFlood(collider, starts, body, options);
  if (!flood.capped || !flags.length) return flood;
  // The cap ended it with ground left (a level wider than `maxCells` fine cells): each start has walked a
  // disc of its own, and a flag far from every spawn stands in none. Flood again with the flags as starts
  // after the spawns, so every flag's ground is looked at; `walkFacts` joins the discs through the walk map.
  return walkFlood(collider, [...starts, ...flags.map(f => [f.x, f.y, f.z])], body, options);
}

/** An unfinished region is on a walk map's component when this share of its places, and this many, stand on
 *  the component's free cells. */
export const JOIN_SHARE = 0.1, JOIN_PLACES = 64;

/**
 * Join the regions a capped flood had not finished through the walk map
 * `grid` (`id` its components): two unfinished regions standing on one
 * component of the map are one ground. Returns how many regions it joined.
 *
 * The flood grows every start at once, so the cap leaves each spawn with a
 * disc about 50 m across on a level a kilometre wide, and two bases that
 * are one open desert read as two grounds, each "sealed in" (Aberdeen:
 * both sides, 7 of 7 spawns; 51 of the 96 levels censused on 2026-11-10
 * were capped). The map is the one the bots route on, so "the map joins
 * them" is the question a route asks; the route probe then plans the
 * routes themselves. A region the flood finished is not joined: its edge
 * is where the ground stops, whatever a one-bit map says.
 *
 * INVENTION: a verifier's rule, with no counterpart in the engine.
 */
export function joinThroughMap(flood, grid, id) {
  if (!flood.capped) return 0;
  const open = new Set(flood.open());
  if (open.size < 2) return 0;
  const on = new Map();
  flood.each((x, z, y, r) => {
    if (!open.has(r)) return;
    let o = on.get(r);
    if (!o) { o = { places: 0, free: new Map() }; on.set(r, o); }
    o.places++;
    const c = cellIndex(grid, x, z);
    if (c >= 0 && id[c]) o.free.set(id[c], (o.free.get(id[c]) ?? 0) + 1);
  });
  const first = new Map();
  let joined = 0;
  for (const [r, o] of on) {
    for (const [component, n] of o.free) {
      if (n < JOIN_PLACES || n < JOIN_SHARE * o.places) continue;
      if (first.has(component)) { flood.join(r, first.get(component)); joined++; } else first.set(component, r);
    }
  }
  return joined;
}

/**
 * What the walk test finds on a level, against the walk map `grid` the
 * bots route on. `ground` is `walkedGround`'s flood, `flags`
 * `botgen.mjs flagsOf`'s, `spawns` `[{ name, x, y, z, side }]`.
 *
 * - the main ground is the region inside the rings of most control points
 *   (then the one most spawns land on, then the widest), and the map's main
 *   component the one most of it stands on;
 * - a spawn is `usable` when it lands on the main ground and that ground
 *   holds a free cell of the main component within `SPAWN_CELL_REACH`;
 * - a flag is `reachable` (in 3D) when a place of the main ground inside
 *   its 3D radius stands on a free cell of the main component: a soldier
 *   on walkable ground is inside the ring. `inRing` is the nearest place of
 *   any walked ground inside the ring, whatever the map says of its cell;
 * - `over` / `under`: how far the floor a point stands on is above the
 *   lowest walked floor at the same spot, and below the highest;
 * - `refused`: the spawn lands on terrain whose normal the page reads as
 *   too steep to climb, so a soldier there walks downhill or not at all;
 * - `floors` says whether the play surface is one floor or stacked, `cover`
 *   the share of the main ground the map holds free, `objectFloor` the
 *   share of the landed spawns standing on an object a storey or more over
 *   the terrain.
 */
export function walkFacts({ collider, grid, flags, spawns, body, ground = null }) {
  const flood = ground ?? walkedGround(collider, spawns, flags, body, grid.width * grid.cellSize);
  const { id, sizes } = components(grid);
  const joined = joinThroughMap(flood, grid, id);
  // The starts after the spawns are a capped flood's flags (`walkedGround`): they are not spawns.
  const startRegion = flood.startRegion.slice(0, spawns.length);
  const fine = flood.cell;
  /** Places within `reach` (horizontal) of a point, as `{ x, z, y, d, region, component }`. */
  const near = (px, pz, reach) => {
    const out = [];
    const n = Math.ceil(reach / fine);
    const cx = (Math.floor(px / fine) + 0.5) * fine, cz = (Math.floor(pz / fine) + 0.5) * fine;
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const x = cx + dx * fine, z = cz + dz * fine;
      const d = Math.hypot(x - px, z - pz);
      if (d > reach) continue;
      const c = cellIndex(grid, x, z);
      for (const y of flood.at(x, z)) out.push({ x, z, y, d, region: flood.regionOf(x, z, y), component: c >= 0 ? id[c] : 0 });
    }
    return out;
  };
  const rings = flags.map(f => near(f.x, f.z, f.radius).map(p => ({ ...p, d3: Math.hypot(p.d, p.y - f.y) })).filter(p => p.d3 <= f.radius)
    .sort((p, q) => p.d3 - q.d3));
  const regions = new Map();
  const region = r => { let o = regions.get(r); if (!o) { o = { id: r, places: 0, spawns: 0, flags: 0, onFree: new Map() }; regions.set(r, o); } return o; };
  startRegion.forEach(r => { if (r >= 0) region(r).spawns++; });
  flood.each((x, z, y, r) => {
    const o = region(r);
    o.places++;
    const c = cellIndex(grid, x, z);
    if (c >= 0 && id[c]) o.onFree.set(id[c], (o.onFree.get(id[c]) ?? 0) + 1);
  });
  rings.forEach(ring => { for (const r of new Set(ring.map(p => p.region))) region(r).flags++; });
  const main = [...regions.values()].sort((p, q) => q.flags - p.flags || q.spawns - p.spawns || q.places - p.places || p.id - q.id)[0] ?? null;
  const onMain = main ? [...main.onFree.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0] : null;
  const mainComponent = onMain ? onMain[0] : 0;
  const cover = main && onMain ? onMain[1] / main.places : 0;
  const storeys = (px, pz, y) => {
    let over = 0, under = 0;
    for (const p of near(px, pz, OVER_REACH)) { over = Math.max(over, y - p.y); under = Math.max(under, p.y - y); }
    return { over: +over.toFixed(1), under: +under.toFixed(1) };
  };
  const terrainAt = (x, z) => (collider.heightfield ? collider.heightfield.height(x, z) : NaN);
  const spawnFacts = spawns.map((s, n) => {
    const r = startRegion[n];
    const onMainGround = !!main && r === main.id;
    let stand = null;
    if (onMainGround && mainComponent) {
      for (const p of near(s.x, s.z, SPAWN_CELL_REACH)) if (p.region === r && p.component === mainComponent && (!stand || p.d < stand.d)) stand = p;
    }
    const floor = floorBelow(collider, s.x, s.z, s.y + body.step, 1e4, body.wade);
    const terrain = terrainAt(s.x, s.z);
    return { name: s.name, side: s.side ?? 0, x: s.x, y: s.y, z: s.z, region: r, landed: r >= 0, onMainGround,
             usable: !!stand, cell: stand ? [stand.x, stand.z] : null,
             floorY: floor ? +floor.y.toFixed(2) : null, fall: floor ? +(s.y - floor.y).toFixed(1) : null,
             objectFloor: !!floor && floor.kind === 'object' && !(floor.y - terrain < STOREY),
             refused: !!floor && floor.kind === 'terrain' && floor.ny < body.slopeCos,
             ...storeys(s.x, s.z, floor ? floor.y : s.y) };
  });
  const flagFacts = flags.map((f, n) => {
    const ring = rings[n];
    const inRing = ring[0] ?? null;
    const stand = ring.find(p => main && p.region === main.id && mainComponent && p.component === mainComponent) ?? null;
    const onGround = ring.find(p => main && p.region === main.id) ?? null;
    const pole = floorBelow(collider, f.x, f.z, f.y + 0.5, 1e4, body.wade);
    const at = stand ?? onGround ?? inRing;
    return { name: f.name, fixed: !!f.fixed, team: f.team, radius: f.radius, x: f.x, y: f.y, z: f.z, reachable: !!stand,
             stand: stand ? [stand.x, stand.z, +stand.y.toFixed(2)] : null,
             onMainGround: onGround ? [onGround.x, onGround.z, +onGround.y.toFixed(2)] : null,
             inRing: inRing ? [inRing.x, inRing.z, +inRing.y.toFixed(2)] : null,
             poleLift: pole ? +(f.y - pole.y).toFixed(1) : null,
             ...storeys(f.x, f.z, at ? at.y : f.y) };
  });
  // One floor or stacked.
  let mainCells = 0, twoFloor = 0;
  if (main) {
    const seen = new Map();
    flood.each((x, z, y, r) => {
      const key = Math.floor(x / fine) * 65536 + Math.floor(-z / fine);
      const had = seen.get(key);
      if (had === undefined) { seen.set(key, r === main.id ? 1 : 0); if (r === main.id) mainCells++; }
      else if ((r === main.id || had === 1) && had !== 2) { twoFloor++; if (had === 0) mainCells++; seen.set(key, 2); }
    });
  }
  const counted = flagFacts.filter(f => !f.fixed);
  const raised = counted.filter(p => p.over >= STOREY || p.under >= STOREY).map(p => p.name);
  const share = mainCells ? twoFloor / mainCells : 0;
  const pointShare = counted.length ? raised.length / counted.length : 0;
  const stacked = share >= STACKED_SHARE || pointShare >= STACKED_FLAGS;
  const landed = spawnFacts.filter(s => s.landed);
  return {
    flood, capped: flood.capped, joined, components: { id, sizes }, mainComponent, cover: +cover.toFixed(3),
    mainRegion: main ? main.id : -1, mainPlaces: main ? main.places : 0,
    regions: [...regions.values()].map(o => ({ id: o.id, places: o.places, spawns: o.spawns, flags: o.flags })).sort((p, q) => q.places - p.places),
    objectFloor: landed.length ? +(landed.filter(s => s.objectFloor).length / landed.length).toFixed(2) : 0,
    spawns: spawnFacts, flags: flagFacts,
    // Ladders the level places (`ladder-climb.js`): the walk test climbs none, and neither do the page's bots.
    ladders: collider.ladders?.length ?? 0,
    // Whether the two sides land on a common ground: soldiers who share one meet, whatever the flags do.
    sidesMeet: spawnFacts.some(a => a.side === 1 && a.landed && spawnFacts.some(b => b.side === 2 && b.landed && b.region === a.region)),
    floors: {
      stacked, twoFloorShare: +share.toFixed(3), raised,
      reason: stacked ? (share >= STACKED_SHARE
        ? `${Math.round(share * 100)} % of the main floor has another walked floor over or under it`
        : `${raised.length} of ${counted.length} capturable flags stand a storey over or under another walked floor`) : null,
    },
  };
}

/**
 * A one-metre walk map painted from walked ground: a cell is free when at
 * least half of its fine cells hold a standing place of `region` (the main
 * ground; every region when omitted) and the four about its centre all do.
 * `Uint8Array` of `size * size`, 1 blocked, rows the engine's z.
 *
 * The centre is asked for because a route is drawn through cell centres: a
 * cell half inside a wall's reach is half standing places, and a bot sent
 * through its centre walks into the wall's end and stays there. On the
 * community map The_Maze (walls a quarter of a metre thick, corridors three
 * metres wide), 8 a side, three seeds of 600 s: with half the cell alone
 * 7.1, 7.3 and 7.3 stuck seconds a bot-minute and no capture; with the
 * centre 2.2, 1.4 and 1.4, and 3, 9 and 3 captures.
 *
 * INVENTION: the engine paints its map from the terrain and its objects'
 * outlines, with a brush for the clearance, and has no map of a floor
 * built from objects high over the terrain.
 */
export function paintGround(flood, size, region = null) {
  const per = Math.round(1 / flood.cell);
  const count = new Uint8Array(size * size);
  const seen = new Set();
  flood.each((x, z, y, r) => {
    if (region !== null && r !== region) return;
    const fx = Math.floor(x / flood.cell), fz = Math.floor(-z / flood.cell);
    const key = fx * 65536 + fz;
    if (seen.has(key)) return;
    seen.add(key);
    const gx = Math.floor(x), gz = Math.floor(-z);
    if (gx >= 0 && gz >= 0 && gx < size && gz < size) count[gz * size + gx]++;
  });
  const pixels = new Uint8Array(size * size);
  // The four fine cells about the centre, all standing places.
  const half = per >> 1;
  const centre = (gx, gz) => {
    for (const dx of [half - 1, half]) for (const dz of [half - 1, half]) if (!seen.has((gx * per + dx) * 65536 + gz * per + dz)) return false;
    return true;
  };
  for (let i = 0; i < pixels.length; i++) pixels[i] = count[i] * 2 >= per * per && centre(i % size, Math.floor(i / size)) ? 0 : 1;
  return pixels;
}
