// A two-layer static against a large and a small root (ledger COL-22):
// `checkObjectVsObject` (lnxded 0x08259690) asks the static for col0 when the
// probing root's composite radius is 4.0 or more, else col1.
// `viewer/coarse-layer.js` adds the col0 the bake left out to a built index
// (`statics.coarse`) and `WorldCollider.staticProbe` reads it for a large
// root (`body-statics.js` `isCoarseRoot`). One JSON blob; run by
// `tests/test_coarse_layer.py`.
//
// A depot (`Supplyde_m1`, baked layer 1) placed at x = 10: its col1 is a wall
// at local x = 5, its col0 (the table's) a wall at local x = 4. A one-layer
// crate at x = 30 has a wall at local x = 2. Probes run along +x at y = 1.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { buildCollisionIndex }, { WorldCollider }, { attachCoarseLayer },
  { isCoarseRoot, COARSE_LAYER_RADIUS }, { rootRadiusOf }] = await Promise.all([
  imp('vendor/three.module.js'), imp('static-index.js'), imp('world-collider.js'), imp('coarse-layer.js'),
  imp('body-statics.js'), imp('vehicle-bodies.js'),
]);

// A quad at local x = `plane`, y 0..4, z -5..5, as two triangles.
const quad = plane => [plane, 0, -5, plane, 4, -5, plane, 4, 5, plane, 0, -5, plane, 4, 5, plane, 0, 5];

function placed(name, geometry, layer, at, plane) {
  const root = new THREE.Object3D();
  root.name = name;
  root.userData = { templateKind: 'SimpleObject' };
  root.position.set(...at);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(quad(plane), 3));
  g.userData = { collision: true, defenseMaterial: 70 };
  const mesh = new THREE.Mesh(g);
  mesh.name = `${name} collision ${layer}`;
  mesh.userData = { collision: true, collisionLayer: layer, sourceTemplate: name, sourceGeometry: geometry };
  root.add(mesh);
  return root;
}

const scene = new THREE.Object3D();
const depot = placed('SupplydeInterior', 'Supplyde_m1', 1, [10, 0, 0], 5);
const crate = placed('Military_boxW3_M1', 'Military_boxW3_M1', 0, [30, 0, 0], 2);
scene.add(depot, crate);
scene.updateMatrixWorld(true);
const statics = buildCollisionIndex(scene, { ownerRoots: [depot, crate] });
const collider = new WorldCollider({ statics });
// The table's col0 for the depot: a wall at local x = 4, two faces of material 71.
const v = [4, 0, -5, 4, 4, -5, 4, 4, 5, 4, 0, 5];
const table = { supplyde_m1: { v, f: [0, 1, 2, 0, 2, 3], fm: [71, 71] },
  // Named but not placed: nothing happens.
  barack_m1: { v, f: [0, 1, 2], fm: [71] } };
const swapped = attachCoarseLayer(statics, table);

const probe = collider.staticProbe();
function along(fromX, coarse) {
  probe.near(fromX, 1, 0, 1, 0, 0, 40, 0.5, -1, -Infinity, coarse);
  const hit = probe.cast(fromX, 1, 0, 1, 0, 0, 40, -1, -Infinity);
  return hit ? { x: Math.round(hit.x * 1000) / 1000, material: hit.material,
                 owner: hit.owner, coarse: !!hit.coarse } : null;
}
const out = {
  swapped,
  fineMarked: Array.from(statics.fine).reduce((a, b) => a + b, 0),
  coarseTriangles: statics.coarse?.count ?? 0,
  depotOwner: statics.ownerOf(depot),
  small: along(0, false),
  large: along(0, true),
  // Past the depot: the one-layer crate is the same to both.
  crateSmall: along(20, false),
  crateLarge: along(20, true),
};
// A faded depot (`disableOwner`) is gone from both layers.
statics.disableOwner(statics.ownerOf(depot));
out.largeDisabled = along(0, true);
statics.enableOwner?.(statics.ownerOf(depot));

// The threshold and the table (COL-22's radii).
const meshes = { rootRadius: { sherman: 5.5611, wespe: 4.0633, 'chi-ha': 3.9434, willy: 2.8719 } };
const named = name => { const n = new THREE.Object3D(); n.name = `${name}_3`; n.userData = { control: name }; return n; };
out.threshold = COARSE_LAYER_RADIUS;
out.coarseRoot = Object.fromEntries(['Sherman', 'Wespe', 'Chi-ha', 'Willy', 'Hanomag'].map(name => {
  const r = rootRadiusOf(meshes, named(name));
  return [name, { radius: r, coarse: isCoarseRoot({ rootRadius: r }) }];
}));
process.stdout.write(JSON.stringify(out));
