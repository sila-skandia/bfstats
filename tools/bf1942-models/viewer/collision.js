// What a round runs into: the heightfield, the sea, and the collision hulls.
//
// Refractor gives a projectile three kinds of thing to hit and collides against
// each differently. The shapes of the shipped data are what decide the three
// tests below, and each one is measured rather than guessed:
//
//   - **Terrain.** `Heightmap.raw` is a `dim x dim` grid of 16-bit samples at
//     `worldSize / dim` metres — 513 x 513 vertices on a 4 m lattice for every
//     vanilla 2048 m level. There is no terrain collision mesh anywhere in the
//     archives: the heightmap *is* the collider. So the honest test is an
//     analytic march over the lattice, not a raycast against the 524,288 drawn
//     triangles. `map.html` already had the raycast version, wired only to the
//     aircraft; this replaces it for everyone (gap C-5).
//   - **Water.** One horizontal plane at `waterLevel` over the whole world
//     (`extract_map.py` builds the quad world-wide, not just under the textured
//     patches). A plane test is exact and costs a divide (gap C-6).
//   - **Statics.** Real collision hulls, carried inside each `.sm` ahead of the
//     LOD chain and split into one glTF primitive per `defenseMaterial`. Bocage
//     exports 21,661 such triangles across 427 placements, 51 distinct
//     materials. That is small enough that a uniform XZ grid beats a BVH: the
//     build is a counting sort and the query is a DDA walk (gap C-1).
//
// The module is deliberately free of any `three` import. It reads three.js
// objects through the three fields it needs (`geometry.attributes.position`,
// `geometry.index`, `matrixWorld.elements`) and hands back plain numbers, which
// is what lets `tests/test_collision.py` run the whole thing under node with no
// renderer and no GL.
//
// Coordinate note, because it bites every reader once: the exporter negates Z
// (`bf42/gltf.py`), so a level occupies x in [0, worldSize] and z in
// [-worldSize, 0], and a heightmap sample index is `(x / spacing, -z / spacing)`.

/** Terrain material id when a map ships no `Materialmap.raw` — "Default". */
export const DEFAULT_TERRAIN_MATERIAL = 0;
/** MaterialManager's water id. `materialFriction 0.1`, `materialDamage 30`. */
export const WATER_MATERIAL = 1;

// --- terrain ---------------------------------------------------------------

/**
 * The level's heights on their own lattice, plus the per-sample material id.
 *
 * `heights` is (dim+1)^2 samples in row-major `iz * (dim + 1) + ix` order, with
 * NaN for a sample no exported tile covered — a level with `missingTiles` has
 * real holes, and a hole must read as "no ground here" rather than as y = 0,
 * which would stop every round dead at sea level.
 */
export class Heightfield {
  constructor(dim, spacing, heights, { coverage = 1 } = {}) {
    this.dim = dim;
    this.spacing = spacing;
    this.heights = heights;
    this.coverage = coverage;
    this.materials = null;     // Uint8Array(matDim * matDim), or null
    this.materialDim = 0;
    this.materialSpacing = spacing;
  }

  /**
   * The per-sample terrain material ids, from `terrain/materials.png`.
   *
   * One byte per heightmap sample, straight out of `Materialmap.raw` — 10 is
   * "Dry sand (El Alamein)", 1 is Water, 12 is Rock. Nearest sample, never
   * filtered: a bilinear read between id 10 and id 12 would invent id 11.
   */
  setMaterials(ids, dim, spacing) {
    this.materials = ids;
    this.materialDim = dim;
    this.materialSpacing = spacing || this.spacing;
  }

  /** Height at a world (x, z), bilinear over the four surrounding samples. */
  height(x, z) {
    const n = this.dim + 1;
    const u = x / this.spacing;
    const v = -z / this.spacing;
    if (!(u >= 0 && v >= 0 && u <= this.dim && v <= this.dim)) return NaN;
    const i0 = Math.min(Math.floor(u), this.dim - 1);
    const j0 = Math.min(Math.floor(v), this.dim - 1);
    const fu = u - i0;
    const fv = v - j0;
    const h = this.heights;
    const a = h[j0 * n + i0];
    const b = h[j0 * n + i0 + 1];
    const c = h[(j0 + 1) * n + i0];
    const d = h[(j0 + 1) * n + i0 + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  /** Terrain material id at a world (x, z); `DEFAULT_TERRAIN_MATERIAL` if none. */
  material(x, z) {
    if (!this.materials) return DEFAULT_TERRAIN_MATERIAL;
    const dim = this.materialDim;
    const ix = Math.round(x / this.materialSpacing);
    const iz = Math.round(-z / this.materialSpacing);
    if (ix < 0 || iz < 0 || ix >= dim || iz >= dim) return DEFAULT_TERRAIN_MATERIAL;
    return this.materials[iz * dim + ix];
  }

  /**
   * Surface normal at a world (x, z), by central difference over one cell.
   *
   * Used to stand an impact effect up off the slope it hit. A one-cell
   * difference is the same resolution the collider itself works at, so it
   * cannot disagree with the height the round stopped at.
   */
  normal(x, z, out) {
    const s = this.spacing;
    const hx = this.height(x + s, z) - this.height(x - s, z);
    const hz = this.height(x, z + s) - this.height(x, z - s);
    // d/dx and d/dz over 2s; the normal is (-dh/dx, 1, -dh/dz) normalised.
    let nx = -hx / (2 * s);
    let nz = -hz / (2 * s);
    if (!Number.isFinite(nx)) nx = 0;
    if (!Number.isFinite(nz)) nz = 0;
    const len = Math.hypot(nx, 1, nz);
    out[0] = nx / len;
    out[1] = 1 / len;
    out[2] = nz / len;
    return out;
  }
}

/**
 * Rebuild the height lattice from the terrain tiles already in the scene.
 *
 * The exporter writes tile vertices at their absolute world positions on exact
 * multiples of the sample spacing (verified on Bocage: 270,400 vertices, 513
 * distinct x and 513 distinct z, all multiples of 4), so the lattice can be
 * recovered by snapping rather than re-fetching `Heightmap.raw`. That keeps the
 * viewer working against every map already extracted, which is the whole reason
 * this reads meshes instead of a new asset.
 *
 * `meshes` are three.js meshes with world matrices already updated.
 */
export function buildHeightfield(meshes, { worldSize, dim = 0 } = {}) {
  if (!meshes.length || !(worldSize > 0)) return null;
  if (!(dim > 0)) dim = inferDim(meshes, worldSize);
  if (!(dim > 0)) return null;
  const spacing = worldSize / dim;
  const n = dim + 1;
  const heights = new Float32Array(n * n).fill(NaN);
  let filled = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    const array = position.array;
    const m = mesh.matrixWorld.elements;
    for (let i = 0; i < position.count; i++) {
      const lx = array[i * 3], ly = array[i * 3 + 1], lz = array[i * 3 + 2];
      // Column-major glTF/three matrix, applied by hand: no THREE import, and
      // no Vector3 allocation per vertex on a quarter of a million of them.
      const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      const ix = Math.round(x / spacing);
      const iz = Math.round(-z / spacing);
      if (ix < 0 || iz < 0 || ix > dim || iz > dim) continue;
      const at = iz * n + ix;
      if (Number.isNaN(heights[at])) filled++;
      // Max, not overwrite: tile edges are shared and a sea-floor default patch
      // can overlap a textured one at the seam. The land sample is the collider.
      heights[at] = Number.isNaN(heights[at]) ? y : Math.max(heights[at], y);
    }
  }
  return new Heightfield(dim, spacing, heights, { coverage: filled / (n * n) });
}

/** Samples per side, from the smallest gap between two neighbouring vertices. */
function inferDim(meshes, worldSize) {
  let spacing = Infinity;
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    const array = position.array;
    let previous = NaN;
    for (let i = 0; i < Math.min(position.count, 2048); i++) {
      const x = array[i * 3];
      const gap = Math.abs(x - previous);
      if (gap > 1e-4 && gap < spacing) spacing = gap;
      previous = x;
    }
  }
  if (!Number.isFinite(spacing) || spacing <= 0) return 0;
  return Math.round(worldSize / spacing);
}

// --- static hulls ----------------------------------------------------------

const CELL_SIZE = 32;   // metres; 64 x 64 cells over a 2048 m level

/**
 * Every collision triangle in the level, in world space, in one XZ grid.
 *
 * Triangles are stored flat — nine floats each, no objects — because the
 * narrowphase runs Moller-Trumbore straight out of the array and a per-triangle
 * object would cost more in cache misses than the test costs in arithmetic.
 *
 * `owners` is which placed object a triangle belongs to. A round is fired from
 * inside its own vehicle's hull, so without it every shot would detonate at the
 * muzzle; `cast` takes the firing object's owner id and skips it.
 */
export class CollisionIndex {
  constructor(tris, materials, owners, ownerNodes, bounds) {
    this.tris = tris;                 // Float32Array, 9 per triangle
    this.materials = materials;       // Uint16Array, 1 per triangle
    this.owners = owners;             // Int32Array, 1 per triangle
    this.ownerNodes = ownerNodes;     // Object3D[] indexed by owner id
    this.count = materials.length;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = bounds.cols;
    this.rows = bounds.rows;
    this.cellSize = bounds.cellSize;
    this.cellStart = null;            // Int32Array(cols * rows + 1)
    this.cellItems = null;            // Int32Array
    this.cellMinY = null;             // Float32Array(cols * rows)
    this.cellMaxY = null;
    this._stamp = new Int32Array(this.count);
    this._query = 0;
    // Measured per-query work, for the budget in the feature doc. Reset by
    // whoever is reading it.
    this.stats = { queries: 0, cells: 0, candidates: 0, tests: 0 };
  }

  /**
   * The owner id of whichever placed object `node` sits under, or -1.
   *
   * Linear in the placement count, so this is a load-time or once-per-gun
   * question, never a per-round one — `GunFire` caches what it gets back.
   */
  ownerOf(node) {
    for (let n = node; n; n = n.parent) {
      const id = this.ownerNodes.indexOf(n);
      if (id >= 0) return id;
    }
    return -1;
  }

  cell(ix, iz) { return iz * this.cols + ix; }

  /**
   * Nearest hit along a segment, or null.
   *
   * `dx, dy, dz` must be unit length and `maxDist` is the segment length, so a
   * returned `t` is metres from the origin. `out` is filled in place and
   * returned — the caller owns one and it never allocates per round per frame.
   */
  cast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner, out) {
    if (!this.cellStart || maxDist <= 0) return null;
    const stats = this.stats;
    stats.queries++;
    const stamp = ++this._query;
    const size = this.cellSize;
    // Cell coordinates of the start, deliberately *not* clamped: a round can
    // begin outside the indexed area and fly into it, and the per-cell bounds
    // check below is what keeps an out-of-range index harmless.
    let ix = Math.floor((ox - this.minX) / size);
    let iz = Math.floor((oz - this.minZ) / size);
    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    // Distance along the ray to the next cell boundary on each axis, and the
    // distance between boundaries (Amanatides & Woo).
    const tDeltaX = stepX ? Math.abs(size / dx) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(size / dz) : Infinity;
    let tMaxX = stepX
      ? ((this.minX + (ix + (stepX > 0 ? 1 : 0)) * size) - ox) / dx
      : Infinity;
    let tMaxZ = stepZ
      ? ((this.minZ + (iz + (stepZ > 0 ? 1 : 0)) * size) - oz) / dz
      : Infinity;
    if (tMaxX < 0) tMaxX = Infinity;
    if (tMaxZ < 0) tMaxZ = Infinity;
    let tEnter = 0;
    let best = maxDist;
    let found = false;
    // A segment 16 m long crosses at most two 32 m cells; the cap is only here
    // so a degenerate direction cannot spin.
    for (let guard = 0; guard < 256; guard++) {
      const tExit = Math.min(tMaxX, tMaxZ, maxDist);
      if (ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows) {
        const cell = this.cell(ix, iz);
        const from = this.cellStart[cell];
        const to = this.cellStart[cell + 1];
        if (to > from) {
          // Cheap reject on Y before touching a single triangle: the cell's own
          // vertical extent against the segment's over just this cell. Near-
          // ground flight over a town spends most of its candidates here.
          const y0 = oy + dy * tEnter;
          const y1 = oy + dy * Math.min(tExit, best);
          const loY = Math.min(y0, y1);
          const hiY = Math.max(y0, y1);
          if (hiY >= this.cellMinY[cell] && loY <= this.cellMaxY[cell]) {
            stats.cells++;
            for (let k = from; k < to; k++) {
              const tri = this.cellItems[k];
              if (this._stamp[tri] === stamp) continue;
              this._stamp[tri] = stamp;
              stats.candidates++;
              if (skipOwner >= 0 && this.owners[tri] === skipOwner) continue;
              stats.tests++;
              const t = this.#intersect(tri, ox, oy, oz, dx, dy, dz, best);
              if (t >= 0 && t < best) {
                best = t;
                found = true;
                out.triangle = tri;
              }
            }
          }
        }
      }
      // Stop as soon as the nearest hit is behind us: anything in a later cell
      // is further along the ray by construction.
      if (found && best <= tExit) break;
      if (tExit >= maxDist) break;
      if (tMaxX < tMaxZ) { ix += stepX; tEnter = tMaxX; tMaxX += tDeltaX; }
      else { iz += stepZ; tEnter = tMaxZ; tMaxZ += tDeltaZ; }
      if (!stepX && !stepZ) break;   // straight up or down: one cell only
    }
    if (!found) return null;
    const tri = out.triangle;
    out.t = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    out.material = this.materials[tri];
    out.owner = this.owners[tri];
    out.kind = 'object';
    this.#normal(tri, out);
    return out;
  }

  /** Moller-Trumbore, two-sided: a hull's winding is not something to trust. */
  #intersect(tri, ox, oy, oz, dx, dy, dz, maxDist) {
    const p = this.tris;
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return (t > 1e-4 && t <= maxDist) ? t : -1;
  }

  #normal(tri, out) {
    const p = this.tris;
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Face the incoming round, so an effect stood up on the normal is never
    // buried inside the wall it hit.
    if (nx * out.dx + ny * out.dy + nz * out.dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    out.nx = nx; out.ny = ny; out.nz = nz;
  }
}

/**
 * Gather every collision triangle under `root` into a queryable index.
 *
 * A collision node is one the assembler tagged `extras.collision` — it arrives
 * as `userData.collision` on the node and the per-material split arrives as
 * `geometry.userData.defenseMaterial` on each primitive, which is the same pair
 * the model browser's armour inspector already reads.
 *
 * `ownerRoots` decides what counts as one object for self-hit purposes: pass
 * the scene's top-level children plus each spawned vehicle, which is exactly
 * what `indexScene` in `map.html` already walks.
 */
export function buildCollisionIndex(root, { ownerRoots = null, cellSize = CELL_SIZE } = {}) {
  const owners = [];
  const ownerOf = new Map();
  if (ownerRoots) {
    for (const node of ownerRoots) {
      const id = owners.length;
      owners.push(node);
      node.traverse(child => ownerOf.set(child, id));
    }
  }
  const meshes = [];
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!isCollisionMesh(obj)) return;
    meshes.push(obj);
  });
  if (!meshes.length) return null;
  let total = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.index;
    const position = mesh.geometry.attributes.position;
    total += Math.floor((index ? index.count : position.count) / 3);
  }
  const tris = new Float32Array(total * 9);
  const materials = new Uint16Array(total);
  const ownerIds = new Int32Array(total).fill(-1);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  let at = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const array = position.array;
    const index = geometry.index ? geometry.index.array : null;
    const m = mesh.matrixWorld.elements;
    const material = geometry.userData?.defenseMaterial ?? 0;
    const owner = ownerOf.get(mesh) ?? -1;
    const faces = Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
    for (let f = 0; f < faces; f++) {
      for (let c = 0; c < 3; c++) {
        const vi = index ? index[f * 3 + c] : f * 3 + c;
        const lx = array[vi * 3], ly = array[vi * 3 + 1], lz = array[vi * 3 + 2];
        const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        const y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        tris[at * 9 + c * 3] = x;
        tris[at * 9 + c * 3 + 1] = y;
        tris[at * 9 + c * 3 + 2] = z;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      materials[at] = material;
      ownerIds[at] = owner;
      at++;
    }
  }
  if (!at) return null;
  return packIndex(tris, materials, ownerIds, owners, at, cellSize,
                   { minX, minZ, maxX, maxZ });
}

/** Whether a loaded node is one of the assembler's collision primitives. */
export function isCollisionMesh(obj) {
  return Boolean(obj.userData?.collision || obj.geometry?.userData?.collision
                 || obj.parent?.userData?.collision);
}

/**
 * Counting-sort the triangles into cells.
 *
 * Two passes and no intermediate arrays-of-arrays: count per cell, prefix-sum
 * into `cellStart`, then write each triangle into its cells. Bocage's 21,661
 * triangles come out at roughly 1.2 cell entries each.
 */
function packIndex(tris, materials, ownerIds, ownerNodes, count, cellSize, box) {
  const minX = Math.floor(box.minX / cellSize) * cellSize;
  const minZ = Math.floor(box.minZ / cellSize) * cellSize;
  const cols = Math.max(1, Math.ceil((box.maxX - minX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((box.maxZ - minZ) / cellSize) + 1);
  const index = new CollisionIndex(
    tris.subarray(0, count * 9), materials.subarray(0, count),
    ownerIds.subarray(0, count), ownerNodes,
    { minX, minZ, cols, rows, cellSize });
  const cells = cols * rows;
  const counts = new Int32Array(cells + 1);
  const spanOf = (tri) => {
    const i = tri * 9;
    const x0 = Math.min(tris[i], tris[i + 3], tris[i + 6]);
    const x1 = Math.max(tris[i], tris[i + 3], tris[i + 6]);
    const z0 = Math.min(tris[i + 2], tris[i + 5], tris[i + 8]);
    const z1 = Math.max(tris[i + 2], tris[i + 5], tris[i + 8]);
    return [
      Math.max(0, Math.floor((x0 - minX) / cellSize)),
      Math.min(cols - 1, Math.floor((x1 - minX) / cellSize)),
      Math.max(0, Math.floor((z0 - minZ) / cellSize)),
      Math.min(rows - 1, Math.floor((z1 - minZ) / cellSize)),
    ];
  };
  for (let tri = 0; tri < count; tri++) {
    const [ix0, ix1, iz0, iz1] = spanOf(tri);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) counts[iz * cols + ix + 1]++;
    }
  }
  for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[cells]);
  const cursor = counts.slice(0, cells);
  const minY = new Float32Array(cells).fill(Infinity);
  const maxY = new Float32Array(cells).fill(-Infinity);
  for (let tri = 0; tri < count; tri++) {
    const i = tri * 9;
    const y0 = Math.min(tris[i + 1], tris[i + 4], tris[i + 7]);
    const y1 = Math.max(tris[i + 1], tris[i + 4], tris[i + 7]);
    const [ix0, ix1, iz0, iz1] = spanOf(tri);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cell = iz * cols + ix;
        items[cursor[cell]++] = tri;
        if (y0 < minY[cell]) minY[cell] = y0;
        if (y1 > maxY[cell]) maxY[cell] = y1;
      }
    }
  }
  index.cellStart = counts;
  index.cellItems = items;
  index.cellMinY = minY;
  index.cellMaxY = maxY;
  return index;
}

// --- the world -------------------------------------------------------------

const _normal = [0, 0, 0];

/**
 * Terrain, sea and hulls behind one `cast`.
 *
 * Order is cheapest-first *and* narrowing: the water plane is a divide, the
 * heightfield is a handful of bilinear samples, and each one shortens the
 * segment handed to the grid. A round over open sea therefore never touches a
 * triangle at all, and a round over a town only tests the triangles in front of
 * the ground it was going to hit anyway.
 */
export class WorldCollider {
  constructor({ heightfield = null, waterLevel = null, statics = null } = {}) {
    this.heightfield = heightfield;
    this.waterLevel = Number.isFinite(waterLevel) ? waterLevel : null;
    this.statics = statics;
    this.hit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 0, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    this.elapsed = 0;    // total microseconds spent in cast(), for the budget
    this.casts = 0;
  }

  /** The height a thing standing at (x, z) rests on: ground, or the sea. */
  surfaceHeight(x, z) {
    const ground = this.heightfield ? this.heightfield.height(x, z) : NaN;
    if (this.waterLevel === null) return ground;
    return Number.isNaN(ground) ? this.waterLevel : Math.max(ground, this.waterLevel);
  }

  /**
   * Nearest surface along a segment, or null.
   *
   * `dx, dy, dz` unit, `maxDist` metres. Returns the shared `hit` record — do
   * not keep it past the next call.
   */
  cast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
    const started = performance.now();
    const out = this.hit;
    out.dx = dx; out.dy = dy; out.dz = dz;
    let best = maxDist;
    let kind = '';
    // Water: one plane, and only from above. A round that starts under the
    // surface (a boat's gun at trough level) is already wet; stopping it at the
    // ceiling it is under would delete it at the muzzle.
    if (this.waterLevel !== null && dy < 0 && oy > this.waterLevel) {
      const t = (oy - this.waterLevel) / -dy;
      if (t >= 0 && t < best) { best = t; kind = 'water'; }
    }
    // Terrain: march the lattice, then bisect the crossing.
    if (this.heightfield) {
      const t = this.#terrain(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; kind = 'terrain'; }
    }
    // Hulls: whatever is left of the segment.
    if (this.statics && best > 0) {
      const object = this.statics.cast(ox, oy, oz, dx, dy, dz, best, skipOwner, out);
      if (object) { best = object.t; kind = 'object'; }
    }
    this.elapsed += (performance.now() - started) * 1000;
    this.casts++;
    if (!kind) return null;
    if (kind === 'object') return out;
    out.t = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    out.owner = -1;
    out.triangle = -1;
    out.kind = kind;
    if (kind === 'water') {
      out.nx = 0; out.ny = 1; out.nz = 0;
      out.material = WATER_MATERIAL;
      // The engine snaps spray to the surface (`moveToWaterSurface 1` on
      // `Em_WaterSprite`); the hit is already exactly on it.
      out.y = this.waterLevel;
    } else {
      this.heightfield.normal(out.x, out.z, _normal);
      out.nx = _normal[0]; out.ny = _normal[1]; out.nz = _normal[2];
      out.material = this.heightfield.material(out.x, out.z);
    }
    return out;
  }

  /**
   * First point along the segment where it is at or below the heightfield.
   *
   * Steps by one lattice cell of horizontal travel — a 1000 m/s round covers
   * 16.7 m in a frame, so four samples on a 4 m lattice — then bisects the
   * bracketing interval eight times, which pins the crossing to under 7 cm of a
   * 16 m step. A round that starts underground (spawned inside a hill, or the
   * lattice has a hole) is left alone rather than deleted at the muzzle.
   */
  #terrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const field = this.heightfield;
    const horizontal = Math.max(Math.abs(dx), Math.abs(dz));
    const step = horizontal > 1e-6
      ? Math.min(maxDist, field.spacing / horizontal)
      : maxDist;
    let tPrev = 0;
    // Height above ground. NaN where the lattice has a hole, and NaN fails the
    // test, which is what leaves a round over a missing tile alone.
    if (!(oy - field.height(ox, oz) > 0)) return -1;
    for (let i = 1; i <= 64; i++) {
      const t = Math.min(step * i, maxDist);
      const f = (oy + dy * t) - field.height(ox + dx * t, oz + dz * t);
      if (f <= 0) {
        let lo = tPrev, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const fm = (oy + dy * mid) - field.height(ox + dx * mid, oz + dz * mid);
          if (fm > 0) lo = mid; else hi = mid;
        }
        return hi;
      }
      if (t >= maxDist) break;
      tPrev = t;
    }
    return -1;
  }

  /** Microseconds per cast since the last reset, and the reset. */
  drainCost() {
    const casts = this.casts;
    const per = casts ? this.elapsed / casts : 0;
    const total = this.elapsed;
    this.elapsed = 0;
    this.casts = 0;
    const s = this.statics?.stats;
    const stats = s ? { ...s } : null;
    if (s) { s.queries = 0; s.cells = 0; s.candidates = 0; s.tests = 0; }
    return { casts, microsPerCast: per, microsTotal: total, statics: stats };
  }
}

// --- impact effect selection ----------------------------------------------

/**
 * The EffectBundle the game plays for this pairing, or null.
 *
 * `effects` is the `attacker -> defender -> template` table out of
 * `_shared/damage.json`, which is `MaterialManager.setEffectTemplate` after
 * last-wins resolution: 4,099 pairs naming 73 bundles. A Sherman round
 * (attacker 236) resolves to `e_waterimpact` in water, `GroundExplDry` in El
 * Alamein's sand, `Exp2CascadesStone` into concrete and `e_ExplArmor` into
 * another tank's hull — all four out of this one lookup.
 */
export function impactEffect(effects, attacker, defender) {
  if (!effects || attacker == null) return null;
  const row = effects[String(attacker)];
  if (!row) return null;
  return row[String(defender)] ?? null;
}

/**
 * A coarse family for a material id, for picking a stand-in impact colour.
 *
 * The families are the `rem` headers in `materialManagerdefine.con`, not
 * invented buckets: 0-15 terrain, 79-98 basic materials, 100-120 and 165-195
 * building materials. Only used where the authored bundle is not available to
 * bake; see `features/bf1942-3d-models/projectile-collision.md`.
 */
export function materialFamily(id) {
  if (id === WATER_MATERIAL) return 'water';
  if (id <= 15) return 'ground';
  if (id >= 39 && id <= 76) return 'armour';
  if ((id >= 84 && id <= 87) || id === 90 || id === 193) return 'metal';
  if ((id >= 79 && id <= 83) || id === 107 || id === 113 || id === 117
      || id === 166) return 'wood';
  return 'stone';
}
