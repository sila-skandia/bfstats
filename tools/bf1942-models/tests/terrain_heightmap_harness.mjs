// The collider's lattice two ways, under node: snapped off the drawn tiles
// (`buildHeightfield`) and straight from the whole heightmap
// (`heightfieldFromSamples`, the `heightmap` bake layer's
// `terrain/heightmap.png`). Run by `tests/test_terrain_heightmap.py`, which
// writes the PNG and the drawn tiles' vertices (`<dir>/tiles.json`, the
// exporter's own positions with z already mirrored as the glb has it).
//
//   node tests/terrain_heightmap_harness.mjs <dir>

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { installModuleHooks } = await import(path.join(ROOT, 'sim', 'env.mjs'));
installModuleHooks(path.join(ROOT, 'viewer'));
const { buildHeightfield, heightfieldFromSamples } = await import(path.join(ROOT, 'viewer', 'heightfield.js'));
const { decodePng } = await import(path.join(ROOT, 'server', 'glb-scene.mjs'));

const dir = process.argv[2];
const spec = JSON.parse(readFileSync(path.join(dir, 'tiles.json'), 'utf8'));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// `spec.glb`: a published level's scene, whose terrain tiles the room server
// snaps its lattice from (`server/level-load.mjs`); else the tiles inline.
let meshes;
if (spec.glb) {
  const { readGlb } = await import(path.join(ROOT, 'server', 'glb-tree.mjs'));
  const { buildSceneTree } = await import(path.join(ROOT, 'server', 'glb-scene.mjs'));
  const { json, bin } = readGlb(spec.glb);
  meshes = buildSceneTree(json, bin).terrainTiles;
} else {
  meshes = spec.tiles.map(positions => {
    const array = Float32Array.from(positions);
    return { geometry: { attributes: { position: { array, count: array.length / 3 } } },
             matrixWorld: { elements: identity } };
  });
}
const tiles = buildHeightfield(meshes, { worldSize: spec.worldSize, dim: spec.dim });
const png = decodePng(readFileSync(path.join(dir, 'heightmap.png')), 'heightmap.png');
const raw = heightfieldFromSamples(png.data, { ...spec.heightmap, channels: png.channels });

let drawn = 0, same = 0, holes = 0;
const rn = raw.dim + 1;
for (let i = 0; i < raw.heights.length; i++) {
  if (!Number.isFinite(raw.heights[i])) holes++;
  if (!Number.isFinite(tiles.heights[i])) continue;
  // Row and column `dim` are the wrap's (sample 0) in both, compared below.
  if (i % rn === raw.dim || Math.floor(i / rn) === raw.dim) continue;
  drawn++;
  if (tiles.heights[i] === raw.heights[i]) same++;
}
// Heights asked between samples, over a drawn and an undrawn patch.
const probes = (spec.probes ?? []).map(([x, z]) => ({ x, z, raw: raw.height(x, z), tiles: tiles.height(x, z) }));
// The wrap (TERR-6): the world's period, the sloped last strip, the in-world rule.
const W = raw.dim * raw.spacing;
const wrap = [];
for (const [x, z] of spec.wrapProbes ?? []) {
  wrap.push({ x, z, at: raw.height(x, z),
    east: raw.height(x + W, z), west: raw.height(x - W, z),
    north: raw.height(x, z + W), south: raw.height(x, z - W),
    far: raw.height(x - 3 * W, z + 2 * W),
    inWorld: raw.heightInWorld(x, z), inWorldOut: raw.heightInWorld(x + W, z) });
}
const e = raw.spacing;
const strip = {
  last: raw.heights[3 * rn + raw.dim - 1], first: raw.heights[3 * rn],
  mid: raw.height(W - e / 2, -3 * e), atEdge: raw.height(W, -3 * e),
  seamIsFirstCol: raw.heights[3 * rn + raw.dim] === raw.heights[3 * rn],
  seamIsFirstRow: raw.heights[raw.dim * rn + 5] === raw.heights[5],
  corner: raw.heights[raw.dim * rn + raw.dim] === raw.heights[0],
};
// Tile snap: the seam takes sample 0 wherever sample 0 is drawn (patch (0, 0)).
const tileSeam = { col: tiles.heights[3 * rn + tiles.dim], first: tiles.heights[3 * rn] };
// The material does not wrap: the engine's getMaterial is 0 outside the world.
const matDim = 8;
raw.setMaterials(Uint8Array.from({ length: matDim * matDim }, () => 5), matDim, W / matDim);
const material = { inside: raw.material(W / 2, -W / 2), east: raw.material(W + 10, -W / 2),
  west: raw.material(-1, -W / 2), north: raw.material(W / 2, 10), south: raw.material(W / 2, -W - 10) };
console.log(JSON.stringify({
  wrap, strip, tileSeam, material,
  png: { width: png.width, height: png.height, channels: png.channels },
  dim: raw.dim, spacing: raw.spacing, samples: raw.heights.length,
  drawn, same, holes, tilesCoverage: tiles.coverage, rawCoverage: raw.coverage,
  // A few lattice samples, (ix, iz) -> height, to check against the exporter.
  lattice: spec.lattice.map(([ix, iz]) => raw.heights[iz * (raw.dim + 1) + ix]),
  probes,
}));
