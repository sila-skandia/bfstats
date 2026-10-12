// Every LOD of a static is shaded as one mesh (ledger LM-1, DL-10):
// level-shading.js binds the object lightmap and the ground's shade onto the
// part's farther LODs as well as its LOD 0, and binds no lightmap at all onto
// a mesh with no second UV set. One JSON report on stdout;
// `test_level_lod_shading.py` asserts it.
//
// Owner's report (2026-10-12, FHSW Battle of Foy): "objects get 'repainted' as
// you get up close and become very dark". A lightmapped barn drew on the
// fixed-function terms past its first LOD distance and at its lightmap inside
// it; a shaded well lost its shade past 10 m; and a rubble pile whose FHSW
// mesh has no lightmap UVs drew black under the lightmap the level still ships.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createLevelShading }] = await Promise.all([
  imp('vendor/three.module.js'), imp('level-shading.js'),
]);

// The shade image: a 4 x 4 field of 10 m cells, every one in shadow at 40.
const DIM = 4;
globalThis.fetch = async () => ({ ok: true, blob: async () => ({}) });
globalThis.createImageBitmap = async () => ({ width: DIM, height: DIM });
globalThis.document = {
  createElement: () => ({
    getContext: () => ({
      drawImage() {},
      getImageData: () => ({ data: Uint8ClampedArray.from({ length: DIM * DIM * 4 }, (_, i) => (i % 4 === 3 ? 255 : 40)) }),
    }),
  }),
};

const extras = {
  lighting: { ambient: [0.15, 0.15, 0.18], diffuse: [0.3, 0.3, 0.3], globalAmbient: [0.1, 0.1, 0.1] },
  sunDirection: [-0.087, 0.319, 0.944],
  terrainShade: { image: 'terrain/shade.png', dim: DIM, cell: 10, ambient: [80, 90, 100], cullBox: [5, 5, 5], cullY: 15 },
};
const shading = createLevelShading({
  extras, levelEnvCube: null, camera: new THREE.PerspectiveCamera(),
  bust: () => '', MAPS_BASE: '', renderer: null, texLoader: { load: () => new THREE.Texture() },
});

function geometry(withUv1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  if (withUv1 === 'zero') g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  else if (withUv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return g;
}
const std = name => { const m = new THREE.MeshStandardMaterial(); m.name = name; return m; };

/** A part as GLTFLoader hands it over: a Group carrying the template's
 *  extras, its LOD 0 primitives as bare Mesh children, and each farther LOD a
 *  child tagged `lod` (one a single Mesh, one a Group of primitives). */
function part(name, { lightmap = null, uv1 = true, rungUv1 = uv1 } = {}) {
  const node = new THREE.Group();
  node.name = name;
  node.userData = { templateKind: 'SimpleObject', geometry: name, ...(lightmap ? { lightmap } : {}) };
  node.position.set(15, 0, -15);
  node.add(new THREE.Mesh(geometry(uv1), std(`${name}_Material0`)));
  const rung1 = new THREE.Mesh(geometry(rungUv1), std(`${name}_Material0`));
  rung1.userData = { lod: { geometry: name, level: 1, distance: 15 } };
  const rung2 = new THREE.Group();
  rung2.userData = { lod: { geometry: name, level: 2, distance: 60 } };
  rung2.add(new THREE.Mesh(geometry(rungUv1), std(`${name}_Material0`)));
  rung2.add(new THREE.Mesh(geometry(rungUv1), std(`${name}_Material1`)));
  node.add(rung1, rung2);
  return { node, lod0: node.children[0], rung1, rung2 };
}

const root = new THREE.Group();
const barn = part('barn', { lightmap: 'lightmaps/barn.png' });
const rubble = part('rubble', { lightmap: 'lightmaps/rubble.png', uv1: false });
const well = part('well');
// A vanilla city block: LOD 0 with lightmap UVs, every farther LOD's at 0, 0.
const block = part('block', { lightmap: 'lightmaps/block.png', rungUv1: 'zero' });
block.node.scale.setScalar(20);     // too big for the ground's shade (cull box 5 m)
root.add(barn.node, rubble.node, well.node, block.node);

// The page's order: lightmaps, then the fixed-function pass, then the LODs are
// lifted out from under their part, then the ground's shade.
shading.bindLightmaps(root, 'level');
shading.bindDynamicShading(root);
for (const p of [barn, rubble, well, block]) {
  const lod = new THREE.Group();
  lod.add(p.rung1, p.rung2);
  root.add(lod);
}
const shaded = await shading.bindTerrainShade(root, 'level', () => 0);

const state = mesh => [mesh.material].flat().map(m => ({
  type: m.type, lightMap: !!m.lightMap,
  shade: m.bfShade ? m.bfShade.value.toArray().map(v => +v.toFixed(4)) : null,
}));
const report = p => ({
  lod0: state(p.lod0), rung1: state(p.rung1),
  rung2: p.rung2.children.flatMap(state),
});
console.log(JSON.stringify({ shaded, barn: report(barn), rubble: report(rubble), well: report(well), block: report(block) }));
