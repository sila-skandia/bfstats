// The terrain collider: the heightmap lattice rebuilt from the drawn tiles.
//
// Past the edge of the world the ground WRAPS, as the engine's does (ledger
// TERR-6): `HeightMap::getSample` is `data[((z & mask) << log2) + (x & mask)]`
// and `PatchTerrain::getHeight` hands it unmasked ints, on the client
// (`0x0062f9f0`, `0x006807f0`) and the server (`0x0838d660`, `0x083d6f10`). So
// `height(x, z)` is periodic with period `worldSize` in both axes, and the last
// 4 m strip slopes from sample `dim - 1` into sample 0 (the lattice's column and
// row `dim` hold sample 0's height, `wrapSeam`). `heightInWorld` is the same
// without the wrap, NaN outside [0, worldSize], for the callers that must keep
// treating the world as that rectangle (the nav grid). The material does NOT
// wrap: `PatchTerrain::getMaterial` `0x083d6800` returns 0 outside the world.
//
// Split out of `collision.js`; see `world-collider.js`'s header for why the
// heightmap *is* the terrain collider, and for the coordinate note (the
// exporter negates Z) every function here depends on.

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

  /**
   * Height at a world (x, z), bilinear over the four surrounding samples, the
   * lattice repeating with period `worldSize` in both axes (TERR-6). NaN only
   * where a sample is a hole, or for a non-finite input.
   */
  height(x, z) {
    const dim = this.dim;
    const u = x / this.spacing;
    const v = -z / this.spacing;
    if (!(Number.isFinite(u) && Number.isFinite(v))) return NaN;
    let i0 = Math.floor(u);
    let j0 = Math.floor(v);
    const fu = u - i0;
    const fv = v - j0;
    // The lattice holds sample `dim` (a copy of sample 0), so i0 + 1 needs no wrap.
    if (i0 < 0 || i0 >= dim) { i0 %= dim; if (i0 < 0) i0 += dim; }
    if (j0 < 0 || j0 >= dim) { j0 %= dim; if (j0 < 0) j0 += dim; }
    const n = dim + 1;
    const h = this.heights;
    const a = h[j0 * n + i0];
    const b = h[j0 * n + i0 + 1];
    const c = h[(j0 + 1) * n + i0];
    const d = h[(j0 + 1) * n + i0 + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  /**
   * `height` for the world rectangle alone: NaN where (x, z) is outside
   * [0, worldSize] x [-worldSize, 0]. The nav grid and anything else that must
   * not see the repeated ground asks this.
   */
  heightInWorld(x, z) {
    const u = x / this.spacing;
    const v = -z / this.spacing;
    if (!(u >= 0 && v >= 0 && u <= this.dim && v <= this.dim)) return NaN;
    return this.height(x, z);
  }

  /**
   * Terrain material id at a world (x, z); `DEFAULT_TERRAIN_MATERIAL` if none,
   * and outside the world: the engine's `getMaterial` returns 0 there, it does
   * not wrap (TERR-9).
   */
  material(x, z) {
    if (!this.materials) return DEFAULT_TERRAIN_MATERIAL;
    const dim = this.materialDim;
    if (x < 0 || z > 0) return DEFAULT_TERRAIN_MATERIAL;
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
 * The height lattice straight from the level's own `Heightmap.raw`
 * (`scene.json` `heightmap`, `terrain/heightmap.png`), every sample drawn or
 * not.
 *
 * The tiles a bake draws are not the whole terrain: an undrawn patch (the sea
 * floor of 29 levels; Midway leaves 240 of its 256 patches undrawn) gave the
 * tile-snapped lattice NaN there, so a hull driven off a Guadalcanal beach found
 * no bed 40 m out. `PatchTerrain` collides against the whole heightmap
 * (collision-response.md section 7), so this is the collider wherever a level
 * ships it, and `buildHeightfield` is the fall-back for a tree baked before.
 *
 * `rgba` is the decoded image, `channels` bytes a pixel, high byte in red and
 * low byte in green (`bf42/terrain.py` `heightmap_png`). The lattice is
 * `(dim + 1)^2` like the tile-snapped one, but its last row and column are
 * sample 0 again (the wrap), where the drawn tiles hold the last sample
 * (`Heightmap.height_at` clamps; `level-edge.js` `stitch` moves the drawn strip to
 * the wrapped height so what is drawn is what is stood on). Each sample is
 * `raw / 65535 * heightUnits` rounded to float32, the glb's own arithmetic,
 * so where a tile was drawn the two lattices agree to the bit (bar that strip).
 */
export function heightfieldFromSamples(rgba, { dim, spacing, heightUnits, channels = 4 }) {
  if (!(dim > 0) || !(spacing > 0) || !(heightUnits > 0)) return null;
  if (!rgba || rgba.length < dim * dim * channels) return null;
  const n = dim + 1;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    // Row and column `dim` are sample 0 again: the engine wraps (TERR-6).
    const row = (iz % dim) * dim;
    for (let ix = 0; ix < n; ix++) {
      const at = (row + (ix % dim)) * channels;
      const raw = (rgba[at] << 8) | rgba[at + 1];
      heights[iz * n + ix] = raw / 65535 * heightUnits;
    }
  }
  return new Heightfield(dim, spacing, heights, { coverage: 1 });
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
  wrapSeam(heights, dim);
  return new Heightfield(dim, spacing, heights, { coverage: filled / (n * n) });
}

/**
 * Make row and column `dim` of a `(dim + 1)^2` lattice the wrap's: each takes the
 * height of sample 0 on that axis (TERR-6), where the baked tiles hold the last
 * sample. A sample whose partner is a hole keeps the baked height.
 */
export function wrapSeam(heights, dim) {
  const n = dim + 1;
  for (let iz = 0; iz < n; iz++) {
    const wz = iz === dim ? 0 : iz;
    for (let ix = 0; ix < n; ix++) {
      if (ix !== dim && iz !== dim) continue;
      const first = heights[wz * n + (ix === dim ? 0 : ix)];
      if (!Number.isNaN(first)) heights[iz * n + ix] = first;
    }
  }
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
