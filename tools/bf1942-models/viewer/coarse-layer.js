// The static collision layer a LARGE root meets (ledger COL-22).
//
// `ResponsePhysics::checkObjectVsObject` (lnxded 0x08259690) asks the face
// side for its collision at `lod = (root radius < 4.0 or a soldier) ? 1 : 0`
// (0x08259735: `getBoundingRadius` vt+0x48 on the vertex side's root,
// `flds 0x086c0304` = 4.0, `je 0x825a495` sets lod 1; `getFaceCollision`
// vt+0x58 at 0x0825976b). A one-layer mesh answers col0 either way (COL-19).
// So a two-layer static is col1 to a soldier, a jeep or a Chi-ha, and col0 to
// a Sherman, a Tiger or a Wespe.
//
// The level bake keeps one layer per static mesh, the last with a face
// (`bf42/assemble.py` `_collision_mesh_indices`): col1 for a two-layer mesh.
// The tree's `collision-meshes.json` carries the rest (`extract_collision_meshes.py`):
// `staticCoarse`, each two-layer static geometry's col0, and `rootRadius`, each
// vehicle root's composite radius by `BCompositeObject::getBoundingRadius`
// 0x08165630. This module adds col0 to a built index as a second, small index
// (`statics.coarse`) and marks the col1 triangles it stands for
// (`statics.fine`); `WorldCollider.staticProbe` asked for a large root reads
// the two together (`body-statics.js` `isCoarseRoot`; the radius is
// `vehicle-bodies.js` `rootRadiusOf`).

import { buildCollisionIndex } from './static-index.js';

/** The collision node a mesh of the index belongs to: itself, or the group
 *  over a multi-primitive node's meshes. */
function collisionNodeOf(mesh) {
  if (mesh.userData?.sourceGeometry) return mesh;
  const parent = mesh.parent;
  return parent?.userData?.collision && parent.userData.sourceGeometry ? parent : null;
}

/** A mesh the index reads (the fields `buildCollisionIndex` touches), one
 *  material of a col0 layer, standing in under `node`'s parent. */
function stand(node, matrix, positions, faces, material) {
  const mesh = {
    isMesh: true,
    name: `${node.name ?? ''} col0`,
    parent: node.parent ?? null,
    children: [],
    userData: { collision: true, sourceTemplate: node.userData?.sourceTemplate },
    matrixWorld: { elements: matrix },
    geometry: {
      attributes: { position: { array: positions, count: positions.length / 3 } },
      index: { array: Uint32Array.from(faces), count: faces.length },
      userData: { defenseMaterial: material, collision: true },
    },
    traverse(fn) { fn(mesh); },
  };
  return mesh;
}

/**
 * Give `statics` its coarse layer from `table` (`staticCoarse`): every
 * collision node of the index whose geometry the table names and whose baked
 * layer is past col0 has its triangles marked `statics.fine[tri] = 1`, and its
 * col0 joins `statics.coarse`, an index under the same owner ids. A no-op
 * without a table or a match. Returns the number of nodes swapped.
 */
export function attachCoarseLayer(statics, table, { collisionGroups = null } = {}) {
  if (!statics || !table || !statics.meshRanges) return 0;
  const fine = new Uint8Array(statics.count ?? statics.owners?.length ?? 0);
  const owners = statics.ownerNodes ?? [];
  const groups = owners.map(() => {
    const g = { children: [], userData: {}, parent: null,
      traverse(fn) { fn(g); for (const c of g.children) c.traverse(fn); } };
    return g;
  });
  const done = new Set();
  let swapped = 0;
  for (const [mesh, start, end] of statics.meshRanges) {
    const node = collisionNodeOf(mesh);
    if (!node || !((node.userData.collisionLayer ?? 1) >= 1)) continue;
    const layer = table[String(node.userData.sourceGeometry).toLowerCase()];
    if (!layer) continue;
    fine.fill(1, start, end);
    if (done.has(node)) continue;
    done.add(node);
    const owner = start < end ? statics.owners[start] : -1;
    if (!(owner >= 0) || !groups[owner]) continue;
    const positions = Float32Array.from(layer.v);
    const byMaterial = new Map();
    for (let f = 0; f < layer.fm.length; f++) {
      const list = byMaterial.get(layer.fm[f]) ?? [];
      list.push(layer.f[f * 3], layer.f[f * 3 + 1], layer.f[f * 3 + 2]);
      byMaterial.set(layer.fm[f], list);
    }
    const matrix = Float64Array.from(mesh.matrixWorld.elements);
    for (const [material, faces] of byMaterial) {
      groups[owner].children.push(stand(node, matrix, positions, faces, material));
    }
    swapped++;
  }
  if (!swapped) return 0;
  const root = { children: groups, userData: {},
    traverse(fn) { fn(root); for (const c of groups) c.traverse(fn); } };
  statics.fine = fine;
  // A two-layer static whose col0 has no face: a large root passes it.
  statics.coarse = buildCollisionIndex(root, { ownerRoots: groups, collisionGroups });
  return swapped;
}
