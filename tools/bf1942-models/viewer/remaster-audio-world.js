// Remaster audio (features/remaster-browser, AUDIO.md): the level's queries
// the spatial chain asks, made out of what the sim already holds.
//
//   castHull   a ray against the level's collision hulls (`static-index.js`
//              through the `WorldCollider`), metres to the first hull or null.
//              The hulls are the extracted `.sm` collision meshes
//              (`_shared/collision-meshes.json` and the level's own), placed
//              per level by `level-terrain.js`. The ray asks with
//              `CG_PROJECTILES`, so it passes what a round passes: barbed
//              wire, fences, nets (FF-2), which stop no sound either. It does
//              not see vehicles or soldiers (`castMoved`, `dynamicCast`): a
//              listener in a tank would otherwise be occluded by his own hull.
//   groundAt   the terrain heightfield, metres, NaN off the lattice.
//   trees      the placed trees and bushes within a radius, from the level
//              scene's SimpleObjects whose geometry reads as one
//              (`isTreeTemplate`), bucketed into a 32 m grid once per level.
//
// The collider's own cost counters (`drainCost`, the bot perf harness's
// number) are not touched: these rays are counted on `env.rays`.

import { CG_PROJECTILES } from './static-index.js';
import { isTreeTemplate } from './remaster-audio-law.js';

const TREE_CELL = 32;
const treeIndexes = new WeakMap();

/** The trees of a level scene, as a grid: { cells: Map, count }. */
export function treeIndex(root) {
  if (!root) return null;
  if (treeIndexes.has(root)) return treeIndexes.get(root);
  const cells = new Map();
  let count = 0;
  root.traverse?.(obj => {
    const data = obj.userData;
    if (!data || data.templateKind !== 'SimpleObject') return;
    if (!isTreeTemplate(data.geometry || obj.name)) return;
    const e = obj.matrixWorld?.elements;
    if (!e) return;
    addTree(cells, e[12], e[14]);
    count += 1;
  });
  const index = { cells, count };
  treeIndexes.set(root, index);
  return index;
}

export function addTree(cells, x, z) {
  const key = `${Math.floor(x / TREE_CELL)},${Math.floor(z / TREE_CELL)}`;
  let list = cells.get(key);
  if (!list) cells.set(key, list = []);
  list.push(x, z);
}

/** How many trees of `index` stand within `r` of (x, z). */
export function treesNear(index, x, z, r) {
  if (!index?.cells?.size) return 0;
  const r2 = r * r;
  let n = 0;
  const i0 = Math.floor((x - r) / TREE_CELL), i1 = Math.floor((x + r) / TREE_CELL);
  const j0 = Math.floor((z - r) / TREE_CELL), j1 = Math.floor((z + r) / TREE_CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = index.cells.get(`${i},${j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const dx = list[k] - x, dz = list[k + 1] - z;
        if (dx * dx + dz * dz <= r2) n += 1;
      }
    }
  }
  return n;
}

/**
 * The queries for one level: `collider` the page's `WorldCollider` (or
 * null), `root` the level scene (or null). Kept per pair, so a frame
 * allocates nothing.
 */
let last = null;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
/** A level scene is read for its trees this long after it first appears:
 *  its world matrices are written by its first frames, not by its load. */
export const TREE_SETTLE = 1.5;
export function remasterWorld(collider, root) {
  if (last && last.collider === collider && last.root === root
      && (last.treesBuilt || clock() - last.since < TREE_SETTLE)) return last.env;
  const since = last && last.root === root ? last.since : clock();
  const settled = !root || clock() - since >= TREE_SETTLE;
  const statics = collider?.statics ?? null;
  const field = collider?.heightfield ?? null;
  const scratch = {};
  const trees = settled ? treeIndex(root) : null;
  const env = {
    rays: 0,
    treeCount: trees?.count ?? 0,
    castHull: statics?.cast ? (ox, oy, oz, dx, dy, dz, max) => {
      env.rays += 1;
      scratch.dx = dx; scratch.dy = dy; scratch.dz = dz;
      const hit = statics.cast(ox, oy, oz, dx, dy, dz, max, -1, scratch, -1, false, false,
                               -Infinity, 2, -1, CG_PROJECTILES, 0);
      return hit ? hit.t : null;
    } : null,
    groundAt: field?.height ? (x, z) => field.height(x, z) : null,
    trees: trees ? (x, z, r) => treesNear(trees, x, z, r) : null,
  };
  last = { collider, root, env, since, treesBuilt: settled };
  return env;
}
