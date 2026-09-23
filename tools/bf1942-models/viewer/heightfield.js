// The terrain collider: the heightmap lattice rebuilt from the drawn tiles.
//
// Split out of `collision.js`, which re-exports it; see that file's header for
// why the heightmap *is* the terrain collider, and for the coordinate note
// (the exporter negates Z) every function here depends on.

import { DEFAULT_TERRAIN_MATERIAL } from './collision-materials.js';

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
