// A round against its own hull's bullet catcher (ledger COL-24): the page's
// collision index skips the firer's hull, whose muzzles start inside it, but
// still meets the parts in `CG_OWN_CATCHERS` (`c_CGLandscape`): FH's and
// FHSW's `BulletCatcher_new` cubes, hung under a ship or a tank to stop the
// round of the selector gun not chosen. Prints one JSON blob.
//
// A ship: a hull box (y 0..6) and, 40 m under it, a 3 m catcher whose
// template the level puts in groups 1 | 2 (scene.json `collisionGroups`).
// A second ship stands 100 m off. Each case casts a round's segment through
// `WorldCollider.cast` as `projectile-flight.js` does.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { buildCollisionIndex, CG_PROJECTILES, CG_OWN_CATCHERS }, { WorldCollider }] = await Promise.all([
  imp('vendor/three.module.js'), imp('static-index.js'), imp('world-collider.js'),
]);

function box(name, size, at, template) {
  const part = new THREE.Object3D();
  part.name = template;
  part.userData = { templateKind: template === 'BulletCatcher_new' ? 'Obstacle' : 'SimpleObject', sourceTemplate: template };
  part.position.set(...at);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.userData = { collision: true };
  part.add(mesh);
  return part;
}
function ship(name, x) {
  const root = new THREE.Object3D();
  root.name = name;
  root.userData = { templateKind: 'PlayerControlObject' };
  root.position.set(x, 0, 0);
  root.add(box('hull', [10, 6, 40], [0, 3, 0], 'Hull'));
  root.add(box('catcher', [3, 3, 3], [0, -40, 0], 'BulletCatcher_new'));
  return root;
}
const scene = new THREE.Object3D();
const own = ship('Hamakaze', 0);
const other = ship('Laforey', 100);
scene.add(own, other);
scene.updateMatrixWorld(true);
const statics = buildCollisionIndex(scene, { ownerRoots: [own, other],
  collisionGroups: { bulletcatcher_new: 3, hull: 0 } });
const collider = new WorldCollider({ statics });
const ownId = statics.ownerOf(own);
const otherId = statics.ownerOf(other);

const hit = (from, dir, dist, skip, ownHits = CG_OWN_CATCHERS) => {
  const h = collider.cast(...from, ...dir, dist, skip, CG_PROJECTILES, ownHits);
  return h ? { y: +h.y.toFixed(3), owner: h.owner === ownId ? 'own' : h.owner === otherId ? 'other' : h.owner } : null;
};
const out = {};
// The unchosen round, 26 m under the gun's 25 m FireArms, heading down.
out.unchosenDown = hit([0, -30, 0], [0, -1, 0], 30, ownId);
out.unchosenDownNoCatch = hit([0, -30, 0], [0, -1, 0], 30, ownId, 0);
// The chosen round, from inside the hull, out through its deck and up.
out.chosenUp = hit([0, 2, 0], [0, 1, 0], 50, ownId);
// Out through the hull's side, level.
out.chosenSide = hit([0, 3, 0], [1, 0, 0], 50, ownId);
// Another ship's round meets this ship's hull, and its catcher.
out.otherOnHull = hit([0, 20, 0], [0, -1, 0], 30, otherId);
out.otherOnCatcher = hit([0, -30, 0], [0, -1, 0], 30, otherId);
// The ship has steamed 500 m: its catcher goes with it.
own.position.x = 500;
own.updateMatrixWorld(true);
const fwd = new THREE.Matrix4().makeTranslation(500, 0, 0);
collider.setMovedOwner(ownId, fwd.elements, new THREE.Matrix4().copy(fwd).invert().elements, 500, 0, 0, 60);
out.movedUnchosen = hit([500, -30, 0], [0, -1, 0], 30, ownId);
out.movedChosenUp = hit([500, 2, 0], [0, 1, 0], 50, ownId);
out.movedOtherOnHull = hit([500, 20, 0], [0, -1, 0], 30, otherId);
console.log(JSON.stringify(out));
