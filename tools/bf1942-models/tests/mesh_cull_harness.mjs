// Retail's LOD choice and small-mesh cull (`viewer/mesh-cull.js`,
// `StandardMesh_selectLod` client 0x005adfd0) on its own and through
// `level-statics.js`: a lifted chain's LOD and a one-LOD part of a frozen
// placement. Prints one JSON blob for `tests/test_mesh_cull.py`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, cull, statics] = await Promise.all([
  import('three'), imp('mesh-cull.js'), imp('level-statics.js'),
]);
const { selectLod, cullDistanceSq, fovModifier, sizeFactor } = cull;
const { createLevelStatics, liftLods, meshCullSpec } = statics;

const out = {};
const at = (spec, d, fov = 1) => selectLod(spec, d * d, fov);

// A 0.5 m prop with one LOD: sizeFactor 0.5 / (5 x 0.03) = 3.33, so it is
// culled past sqrt(2500 x 3.33 + 0.25) = 91.29 m.
const prop = { r: 0.5, m: 1, cullFactor: 0.03, dists: [0] };
out.propSize = sizeFactor(0.5, 0.03);
out.propAt = [at(prop, 91.2), at(prop, 91.4)];
out.propCullM = Math.sqrt(cullDistanceSq(prop));
// The Browning's cullFactor 0.15: sizeFactor 0.67, culled past 40.8 m.
out.browningCullM = Math.sqrt(cullDistanceSq({ ...prop, cullFactor: 0.15 }));
// Zoomed to half the 1 rad lens' tangent, the cull reaches twice as far
// in d^2: sqrt(2) further.
out.zoomFov = fovModifier(2 * Math.atan(Math.tan(0.5) / 2) * 180 / Math.PI);
out.lensFov = fovModifier(57.29577951308232);
out.zoomCullM = Math.sqrt(cullDistanceSq(prop, out.zoomFov));
// A 2 m mesh is never culled; its swap waits for r^2: 50^2 < d^2 - 4.
const big = { r: 2, m: 1, dists: [0, 50] };
out.bigAt = [at(big, 50.03), at(big, 50.05), at(big, 5000)];
// A 0.5 m mesh with a rung at 150 m: rung past sqrt(150^2 x 3.33) = 273.9 m,
// culled past sqrt((150^2 + 2500) x 3.33 + 0.25) = 288.7 m.
const chain = { r: 0.5, m: 1, dists: [0, 150] };
out.chainAt = [at(chain, 273.8), at(chain, 274), at(chain, 288.6), at(chain, 288.8)];
// GeometryTemplate.scale 2 divides d^2 by 2.
out.scaledCullM = Math.sqrt(cullDistanceSq({ ...prop, m: 2 }));

// --- through level-statics -------------------------------------------------
function box(size) {
  return new THREE.BoxGeometry(size, size, size);
}
function part(name, size, rungAt = null) {
  const node = new THREE.Mesh(box(size), new THREE.MeshBasicMaterial());
  node.name = name;
  node.userData = { geometry: name, templateKind: 'SimpleObject' };
  if (rungAt !== null) {
    const rung = new THREE.Mesh(box(size), new THREE.MeshBasicMaterial());
    rung.name = `${name}_lod1`;
    rung.userData = { lod: { geometry: name, level: 1, distance: rungAt } };
    node.add(rung);
  }
  return node;
}
const meshCull = { crate_m1: { cullFactor: 0.15 }, bush_m1: { kind: 'treemesh' } };
const root = new THREE.Group();
// A placement of four parts at the origin: a 1 m crate box (r = 0.866, one
// LOD), a 0.5 m bottle with a rung at 150 m, a 4 m shed, a 0.5 m bush that is
// a TreeMesh.
const placement = new THREE.Group();
placement.name = 'yard';
placement.userData = { templateKind: 'Bundle' };
const crate = part('crate_m1', 1);
const bottle = part('bottle_m1', 0.5 * 2 / Math.sqrt(3), 150);   // r = 0.5
const shed = part('shed_m1', 4);
const bush = part('bush_m1', 0.5);
placement.add(crate, bottle, shed, bush);
root.add(placement);
root.updateMatrixWorld(true);
out.crateSpec = meshCullSpec(crate, meshCull);
out.bushSpec = meshCullSpec(bush, meshCull);
out.noKeySpec = meshCullSpec(crate, null);

const camera = new THREE.PerspectiveCamera(57.29577951308232, 16 / 9, 0.1, 5000);
const page = {
  camera, drawDistance: () => 5000, extras: { meshCull },
  levelClips: [], optEntire: { checked: false }, optVehicles: { checked: true },
  templateNameOf: node => node.name, world: null,
};
const st = createLevelStatics(page);
st.indexScene(root);
const lod = placement.children.find(c => c.isLOD);
out.smallMeshes = st.smallMeshes.nodes.map(n => n.name);
const look = d => {
  camera.position.set(d, 0, 0);
  camera.updateMatrixWorld(true);
  st.applyVisibility();
  lod.update(camera);
  return {
    crate: crate.visible, bottle: bottle.visible, bottleRung: lod.levels[0].object.visible,
    shed: shed.visible, bush: bush.visible,
  };
};
// The crate: sizeFactor 0.866 / 0.75 = 1.155, culled past
// sqrt(2500 x 1.155 + 0.75) = 53.7 m.
out.near = look(10);
out.past53 = look(54);
out.past274 = look(280);
out.past289 = look(290);
out.back = look(10);

// A level from before the key keeps the old distance swap and no cull.
const oldRoot = new THREE.Group();
const oldBottle = part('bottle_m1', 0.5, 150);
oldRoot.add(oldBottle);
oldRoot.updateMatrixWorld(true);
const [oldLod] = liftLods(oldRoot, null, null);
camera.position.set(1000, 0, 0);
camera.updateMatrixWorld(true);
oldLod.update(camera);
out.oldFar = { part: oldBottle.visible, rung: oldLod.levels[0].object.visible };

process.stdout.write(JSON.stringify(out));
