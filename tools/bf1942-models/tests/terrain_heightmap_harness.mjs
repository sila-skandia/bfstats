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
for (let i = 0; i < raw.heights.length; i++) {
  if (!Number.isFinite(raw.heights[i])) holes++;
  if (!Number.isFinite(tiles.heights[i])) continue;
  drawn++;
  if (tiles.heights[i] === raw.heights[i]) same++;
}
// Heights asked between samples, over a drawn and an undrawn patch.
const probes = (spec.probes ?? []).map(([x, z]) => ({ x, z, raw: raw.height(x, z), tiles: tiles.height(x, z) }));
console.log(JSON.stringify({
  png: { width: png.width, height: png.height, channels: png.channels },
  dim: raw.dim, spacing: raw.spacing, samples: raw.heights.length,
  drawn, same, holes, tilesCoverage: tiles.coverage, rawCoverage: raw.coverage,
  // A few lattice samples, (ix, iz) -> height, to check against the exporter.
  lattice: spec.lattice.map(([ix, iz]) => raw.heights[iz * (raw.dim + 1) + ix]),
  probes,
}));
