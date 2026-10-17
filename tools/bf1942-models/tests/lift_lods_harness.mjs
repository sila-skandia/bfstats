// `level-statics.js` `liftLods`: a lightmapped part keeps LOD 0 at every
// distance (ledger LOD-6), its baked rungs hidden; an unlit part's chain is
// lifted onto a THREE.LOD as before.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { liftLods } = await import(pathToFileURL(path.join(viewer, 'level-statics.js')).href);

function geometry(uv1) {
  const g = new THREE.BufferGeometry();
  if (uv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return g;
}
function part(name, userData, uv1 = false) {
  const node = new THREE.Mesh(geometry(uv1), new THREE.MeshBasicMaterial());
  node.name = name;
  node.userData = { ...userData };
  const rung = new THREE.Mesh(geometry(uv1), new THREE.MeshBasicMaterial());
  rung.name = `${name}_lod1`;
  rung.userData = { lod: { geometry: name, level: 1, distance: 50 } };
  node.add(rung);
  return { node, rung };
}
const root = new THREE.Group();
const lit = part('O_Hotel_m1', { lightmap: 'lightmaps/o_hotel_m1.png' });
const plain = part('barn_m1', {});
// A lightmapped mesh the level baked no lightmap for (FHSW Ramelle's
// `sidewalkI_m1`): no `lightmap`, but a second UV set.
const unbaked = part('sidewalkI_m1', {}, true);
// The same as a multi-material part: a Group of primitives.
const group = new THREE.Group();
group.name = 'Planks_a1_m1';
group.add(new THREE.Mesh(geometry(true), new THREE.MeshBasicMaterial()));
const groupRung = new THREE.Group();
groupRung.name = 'Planks_a1_m1_lod1';
groupRung.userData = { lod: { geometry: 'Planks_a1_m1', level: 1, distance: 15 } };
groupRung.add(new THREE.Mesh(geometry(true), new THREE.MeshBasicMaterial()));
group.add(groupRung);
root.add(lit.node, plain.node, unbaked.node, group);
root.updateMatrixWorld(true);
const inserted = liftLods(root, null);
process.stdout.write(JSON.stringify({
  lifted: inserted.map(l => l.name),
  litRungVisible: lit.rung.visible,
  litRungParent: lit.rung.parent?.name ?? null,
  unbakedRungVisible: unbaked.rung.visible,
  groupRungVisible: groupRung.visible,
}));
