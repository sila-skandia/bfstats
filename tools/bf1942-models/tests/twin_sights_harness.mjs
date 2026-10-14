// FHSW's bomber gunners (FHSWEurope's B-40): every seat hangs its sight twice
// under its gun, at the Camera and at the Camera plus `OutsideHudOffset`, and
// three seats share one sight's name. Each copy must graft under its own node
// (`vehicle-base.js` `graftCockpitInto`, `namePath`), each view's eye see the
// copy within reach, and the nose cam's hull hide leave it (`seat-view.js`
// `NoseHull`). One JSON report; `tests/test_twin_sights.py` asserts on it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { graftCockpitInto, applyCockpitSwaps }, { NoseHull, NOSE_HIDDEN_LAYER }] = await Promise.all([
  imp('vendor/three.module.js'), imp('vehicle-base.js'), imp('seat-view.js'),
]);

const node = (name, userData = {}, children = [], at = null) => {
  const obj = new THREE.Group();
  obj.name = name;
  obj.userData = userData;
  if (at) obj.position.set(...at);
  for (const child of children) obj.add(child);
  return obj;
};
const mesh = name => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
};
const SIGHT = (seat, sight, at) => [`AirSight_${sight}`, at, seat];
// [seat control, gun node, sight name, eye (Camera), offset view]
const SEATS = [
  ['B40GS_PCO1', 'B40_MG1', 'K-3', [0, 2, -3], [0, 2, -5]],
  ['B40GS_PCO2', 'B40_MG2', 'N-9', [0, -1, 1], [0, -1, -2]],
  ['B40_RPlatz', 'B40_Rechts', 'K-3', [1.5, 0.5, 4], [2.5, 0.5, 4]],
  ['B40_LPlatz', 'B40_Links', 'K-3', [-1.5, 0.5, 4], [-2.5, 0.5, 4]],
];
const twin = (control, sight, at, withInternal) => node(`AirSight_${sight}`, { control }, [
  node(`lod_1p_AirSight_${sight}`, {
    control,
    ...(withInternal ? { lodAlternative: { selected: `1p_AirSight_${sight}_Internal`,
      replaces: ['1p_AirReflexSight_Flex1_External'], selectorKind: 'DistanceSelector', distances: [0.5] } } : {}),
  }, withInternal ? [mesh(`1p_AirSight_${sight}_Internal`)] : [node('1p_AirReflexSight_Flex1_External', { control })]),
], at);
// The level's copy (the scene glb renames repeats) and the cockpit file's.
function plane(withInternal) {
  const seats = SEATS.map(([control, gun, sight, eye, offset], i) => node(control, { control }, [
    node(gun + (withInternal ? '' : `_${i}`), { control }, [
      twin(control, sight, eye, withInternal), twin(control, sight, offset, withInternal),
    ]),
  ]));
  const hull = mesh('B40_hull');
  return node(withInternal ? 'B40SP' : 'B40SP_1', { control: 'B40SP', physics: { vehicleCategory: 'VCAir' } },
    [node('lodB40', {}, [node('B40Complex', {}, [hull, ...seats])])]);
}
const root = plane(false);
const scene = node('scene', {}, [plane(true)]);
root.updateMatrixWorld(true);
const swaps = graftCockpitInto(root, scene);
root.updateMatrixWorld(true);

const report = { swaps: swaps.length, grafts: [], views: {}, nose: {} };
const world = obj => obj.getWorldPosition(new THREE.Vector3()).toArray().map(n => +n.toFixed(2));
for (const swap of swaps) {
  report.grafts.push({ control: swap.control, host: world(swap.host), hostSeat: swap.host.parent?.parent?.parent?.name });
}
// Each seat's two views: which sight meshes draw.
const drawn = () => swaps.filter(s => s.interior.some(n => n.visible)).map(s => `${s.control}@${world(s.host).join(',')}`);
for (const [control, , , eye, offset] of SEATS) {
  applyCockpitSwaps(swaps, true, control, new THREE.Vector3(...eye));
  const cockpit = drawn();
  applyCockpitSwaps(swaps, false, control, new THREE.Vector3(...offset));
  const nose = drawn();
  report.views[control] = { cockpit, nose };
}
// The nose cam hides the airframe and leaves the sights.
const hide = new NoseHull();
hide.hide(root);
let hull = null, sights = 0, sightsHidden = 0;
root.traverse(o => {
  if (o.name === 'B40_hull') hull = o.layers.isEnabled(NOSE_HIDDEN_LAYER);
  if (/_Internal$/.test(o.name)) { sights++; if (o.layers.isEnabled(NOSE_HIDDEN_LAYER)) sightsHidden++; }
});
report.nose = { hullHidden: hull, sights, sightsHidden };
process.stdout.write(JSON.stringify(report));
