// The drivable-deck broadphase: per cell, the Y band of every drivable
// static triangle over it, so `WorldCollider.deckHeight` can skip its ray
// over open ground.
//
// Split out of `collision.js`; see `world-collider.js`'s header.

import { isCollisionMesh, isDrivableCollisionMesh } from './collision-meshes.js';

// The drivable-deck BROADPHASE cell size. This raster is not a height any more
// (see `buildDrivableMask`): it only answers "is there a deck triangle over this
// patch of ground, and between which two heights", so the exact deck query can
// skip the ray entirely over open terrain and clamp it to the deck's own Y band
// otherwise. Four metres is fine for a gate — it costs two floats a cell
// (262 k cells, 2.1 MB, over a level whose decks span the whole 2048 m) and a
// cell it over-marks only costs one short ray that finds nothing.
const DRIVABLE_CELL = 4;

/**
 * A BROADPHASE gate over the drivable statics under `root`, or null when the
 * level ships none. Per `DRIVABLE_CELL` cell it holds the min and max world Y of
 * every drivable triangle whose XZ box touches that cell — nothing else.
 *
 * It is deliberately not a height any more. A raster of deck heights cannot be
 * a ride surface: a cell can only hold one number, so a sloped triangle becomes
 * a plateau (the repair bay's little incline turns into a step and the tank
 * either submerges in it or pops onto it), a cell shared by a deck and its
 * underside has to guess which one a vehicle is on, and neighbouring cells step
 * against each other so the wheel springs read cliffs where the road is smooth.
 * The exact query (`WorldCollider.deckHeight`) rays the real triangles instead,
 * and all this raster does is make that ray free to skip and short to run:
 *
 * - no drivable triangle over this cell (`minY > maxY`) -> no ray at all, which
 *   is the whole of open terrain, every level with no bridge, and every metre of
 *   a level more than a cell away from one;
 * - the querier is below every deck triangle here -> no ray, which is how a
 *   tank *under* a bridge stays under it for free;
 * - otherwise the ray is clamped to `[minY, maxY]`, so it is a couple of metres
 *   long over one 32 m index cell rather than a sweep of the level's height.
 *
 * Two floats a cell, built once per level (features/mesh-viewer-performance
 * rule 5: nothing allocated per frame, and no query at all over open ground).
 */
export function buildDrivableMask(root, { cellSize = DRIVABLE_CELL } = {}) {
  const meshes = [];
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!isCollisionMesh(obj)) return;
    if (isDrivableCollisionMesh(obj)) meshes.push(obj);
  });
  if (!meshes.length) return null;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index ? geometry.index.array : null;
    const array = position.array;
    const m = mesh.matrixWorld.elements;
    const faces = Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
    for (let f = 0; f < faces; f++) {
      for (let c = 0; c < 3; c++) {
        const vi = index ? index[f * 3 + c] : f * 3 + c;
        const lx = array[vi * 3], ly = array[vi * 3 + 1], lz = array[vi * 3 + 2];
        const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;

  const minX0 = Math.floor(minX / cellSize) * cellSize;
  const minZ0 = Math.floor(minZ / cellSize) * cellSize;
  const cols = Math.max(1, Math.ceil((maxX - minX0) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ0) / cellSize) + 1);
  const cells = cols * rows;
  // An empty cell is `minY > maxY`, which is the one test every reader makes
  // first and needs no separate presence byte.
  const loY = new Float32Array(cells).fill(Infinity);
  const hiY = new Float32Array(cells).fill(-Infinity);

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index ? geometry.index.array : null;
    const array = position.array;
    const m = mesh.matrixWorld.elements;
    const faces = Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
    for (let f = 0; f < faces; f++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      let z0 = Infinity, z1 = -Infinity;
      for (let c = 0; c < 3; c++) {
        const vi = index ? index[f * 3 + c] : f * 3 + c;
        const lx = array[vi * 3], ly = array[vi * 3 + 1], lz = array[vi * 3 + 2];
        const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        const y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      // Every cell the triangle's XZ box touches, conservatively: over-marking
      // costs one short ray that finds nothing, under-marking would drop the
      // deck out from under a wheel.
      const ix0 = Math.max(0, Math.floor((x0 - minX0) / cellSize));
      const ix1 = Math.min(cols - 1, Math.floor((x1 - minX0) / cellSize));
      const iz0 = Math.max(0, Math.floor((z0 - minZ0) / cellSize));
      const iz1 = Math.min(rows - 1, Math.floor((z1 - minZ0) / cellSize));
      for (let iz = iz0; iz <= iz1; iz++) {
        const row = iz * cols;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cell = row + ix;
          if (y0 < loY[cell]) loY[cell] = y0;
          if (y1 > hiY[cell]) hiY[cell] = y1;
        }
      }
    }
  }
  return { minX: minX0, minZ: minZ0, cellSize, cols, rows, minY: loY, maxY: hiY };
}
