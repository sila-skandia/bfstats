// Drives `viewer/terrain-tile-wrap.js` outside a browser and prints one JSON blob:
// the UV extent of a tile patch and of a default patch, and the wrap plan for a
// mix of meshes that share a texture.
//
//   node terrain_tile_wrap_harness.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const { uvExtent, repeatsTexture, planTileWrap } = await import(pathToFileURL(path.join(viewer, 'terrain-tile-wrap.js')).href);
const THREE = await import('three');

// A patch lattice as `_grid_mesh` writes it: UV = index / cells * repeats.
function patch(cells, repeats) {
  const uv = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) uv.push(x / cells * repeats, z / cells * repeats);
  const g = new THREE.BufferGeometry();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const tileExtent = uvExtent(patch(64, 1));
const fillExtent = uvExtent(patch(8, 4));
const shared = { id: 'shared' }, own = { id: 'own' }, fillOnly = { id: 'fillOnly' };

console.log(JSON.stringify({
  tileExtent,
  fillExtent,
  noUv: uvExtent(new THREE.BufferGeometry()),
  tileRepeats: repeatsTexture(tileExtent),
  fillRepeats: repeatsTexture(fillExtent),
  // 1.0 plus float noise is still a tile
  noisyTile: repeatsTexture(1.0000003),
  plan: planTileWrap([
    { texture: own, repeats: false },        // a tile's own map: clamp in place
    { texture: shared, repeats: false },      // a tile whose map a fill patch also draws: clone
    { texture: shared, repeats: true },       // that fill patch: keep repeating
    { texture: fillOnly, repeats: true },     // a fill patch alone: keep
    { texture: null, repeats: false },        // no map: nothing to wrap
  ]),
}));
