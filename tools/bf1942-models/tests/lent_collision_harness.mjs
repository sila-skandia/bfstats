// `collision-meshes.js` `lentAlternativeOf` / `addLentCollisionCopies` on
// small scene trees shaped as the bake writes them (extras -> userData), run
// by test_lent_collision.py. Prints one JSON blob.
import * as THREE from '../viewer/vendor/three.module.js';
import { lentAlternativeOf, addLentCollisionCopies } from '../viewer/collision-meshes.js';

const node = (name, data = {}, pos = null) => {
  const o = new THREE.Object3D();
  o.name = name;
  o.userData = data;
  if (pos) o.position.set(...pos);
  return o;
};
const collision = (name) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  g.userData = { collision: true, defenseMaterial: 50 };
  const m = new THREE.Mesh(g);
  m.name = name;
  m.userData = { collision: true, collisionLayer: 0, sourceTemplate: 'AA_AllCockpitExternal', sourceGeometry: 'AA_Allies_cannon_m1' };
  return m;
};
const out = {};

// Bocage's AA gun, as baked: the root has no geometry; its lent mesh hangs
// under the cannon, 0.987 m up (a DistCompareSelector LodObject, step b).
{
  const root = node('AA_Allies', { templateKind: 'PlayerControlObject', geometry: null }, [1216.43, 20.61, -614.92]);
  const base = node('AA_Allies_Base', { templateKind: 'Bundle', geometry: null });
  const carriage = node('AA_Allies_Carriage', { templateKind: 'RotationalBundle', geometry: 'AA_Allies_carriage_m1' });
  const cannon = node('AA_Allies_Cannon', { templateKind: 'RotationalBundle', geometry: null }, [0, 0.987, 0.171]);
  const lod = node('lodAA_AllCockpit', { templateKind: 'LodObject', geometry: null, selectorKind: 'DistCompareSelector' });
  const ext = node('AA_AllCockpitExternal', { templateKind: 'SimpleObject', geometry: 'AA_Allies_cannon_m1' });
  const internal = node('AA_AllCockpitInternal', { templateKind: 'SimpleObject', geometry: '1P_Bofors' });
  ext.add(collision('AA_AllCockpitExternal_collision_0'));
  lod.add(ext, internal); cannon.add(lod); carriage.add(cannon); base.add(carriage); root.add(base);
  root.updateMatrixWorld(true);
  out.aaLent = lentAlternativeOf(root)?.name ?? null;
  out.aaAdded = addLentCollisionCopies([root], THREE);
  const copy = root.children.find((c) => c.userData?.lentCopy);
  const w = new THREE.Vector3();
  copy?.getWorldPosition(w);
  out.aaCopyAt = copy ? w.toArray().map((x) => +x.toFixed(3)) : null;
  out.aaCopyCollision = !!copy?.userData?.collision;
  out.aaOriginalKept = ext.children.some((c) => c.userData?.collision);
  // Idempotent per call: a second call adds another (callers run it once a load).
}

// A house: a geometry-less Bundle whose first child is a LodObject; the lent
// alternative stands at the root, so nothing is added (step a).
{
  const root = node('afr_house1_ste_m1', { templateKind: 'Bundle', geometry: null }, [10, 0, 10]);
  const lod = node('lodHouse', { templateKind: 'LodObject', geometry: null, selectorKind: 'DistCompareSelector' });
  const interior = node('afr_house1_steInterior', { templateKind: 'SimpleObject', geometry: 'afr_house1_ste_m1' });
  interior.add(collision('house_collision_1'));
  lod.add(interior); root.add(lod);
  root.updateMatrixWorld(true);
  out.houseLent = lentAlternativeOf(root)?.name ?? null;
  out.houseAdded = addLentCollisionCopies([root], THREE);
}

// A root with a geometry of its own lends nothing; nor does a search that
// meets a PlayerControlObject first.
{
  const own = node('Crate', { templateKind: 'SimpleObject', geometry: 'crate_m1' });
  out.ownLent = lentAlternativeOf(own);
  const root = node('Ship', { templateKind: 'PlayerControlObject', geometry: null });
  const seat = node('ShipPCO', { templateKind: 'PlayerControlObject', geometry: null });
  const lod = node('lodGun', { templateKind: 'LodObject', geometry: null, selectorKind: 'DistCompareSelector' });
  const gun = node('Gun', { templateKind: 'SimpleObject', geometry: 'gun_m1' });
  lod.add(gun); seat.add(lod); root.add(seat);
  out.pcoLent = lentAlternativeOf(root);
}

process.stdout.write(JSON.stringify(out));
