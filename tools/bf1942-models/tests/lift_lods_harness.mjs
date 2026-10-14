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

function part(name, userData) {
  const node = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  node.name = name;
  node.userData = { ...userData };
  const rung = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  rung.name = `${name}_lod1`;
  rung.userData = { lod: { geometry: name, level: 1, distance: 50 } };
  node.add(rung);
  return { node, rung };
}
const root = new THREE.Group();
const lit = part('O_Hotel_m1', { lightmap: 'lightmaps/o_hotel_m1.png' });
const plain = part('barn_m1', {});
root.add(lit.node, plain.node);
root.updateMatrixWorld(true);
const inserted = liftLods(root, null);
process.stdout.write(JSON.stringify({
  lifted: inserted.map(l => l.name),
  litRungVisible: lit.rung.visible,
  litRungParent: lit.rung.parent?.name ?? null,
}));
