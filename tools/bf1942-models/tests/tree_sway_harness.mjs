// Drives the wind sway of `viewer/tree-foliage.js` outside a browser and
// prints one JSON blob: the constants, the fade law, the angle law, the rolls,
// and a bound scene rocked from its per-render hook.
//
//   node tree_sway_harness.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const THREE = await import('three');
const {
  SWAY, bindTreeFoliage, setTreeSway, swayAngles, swayFade, swayInstance, swayTemplate,
} = await import(pathToFileURL(path.join(viewer, 'tree-foliage.js')).href);

const out = { constants: { ...SWAY } };

out.fade = {
  at0: swayFade(0),
  at28: swayFade(28 * 28),
  at30: swayFade(30 * 30),
  at35: swayFade(35 * 35),
  at40: swayFade(40 * 40),
  at41: swayFade(41 * 41),
  zoomed60: swayFade(60 * 60, 2),
  zoomed81: swayFade(81 * 81, 2),
};

const pine = swayTemplate('EU_pine1_M1', { rangeDegrees: 1.1 });
const bare = swayTemplate('EU_bare_M1', {});
const set = swayTemplate('set', { rangeDegrees: 2, periodSeconds: 0.5, windFactor: 0.5, direction: [3, 4] });
out.templates = {
  pine: { ...pine, unit: Math.hypot(pine.dirX, pine.dirZ) },
  pineAgain: swayTemplate('eu_PINE1_m1', { rangeDegrees: 1.1 }),
  bare,
  set,
};

// The law at a hand-set instance: speed 1.25, phase 0.
const inst = { phase: 0, forcePhase: 0, speed: 1.25 };
const flat = { rangeDegrees: 1.1, frequency: 0.2, windFactor: 0, forceFrequency: 0.05,
  dirX: 1, dirZ: 0, perpX: 0, perpZ: 1 };
out.law = {
  // f = 0.2 * 1.25 = 0.25 Hz: a quarter period is 1 s.
  quarter: swayAngles(1, flat, inst, 1, {}),
  half: swayAngles(2, flat, inst, 1, {}),
  threeQuarter: swayAngles(3, flat, inst, 1, {}),
  faded: swayAngles(1, flat, inst, 0.25, {}),
  // The phase is multiplied by the frequency before it is added (0x083b9255).
  phased: swayAngles(0, flat, { ...inst, phase: Math.PI * 2 }, 1, {}),
  diagonal: swayAngles(1, { ...flat, dirX: 0.6, dirZ: 0.8 }, inst, 1, {}),
  // The second sine, when a script gives it a wind factor: f2 = 0.05 * 1.25,
  // a quarter period at 4 s, along the perpendicular.
  wind: swayAngles(4, { ...flat, windFactor: 0.5 }, inst, 1, {}),
};

let minSpeed = Infinity, maxSpeed = -Infinity, minPhase = Infinity, maxPhase = -Infinity;
for (let i = 0; i < 2000; i++) {
  const r = swayInstance(i * 7.3, 20 + (i % 9), -i * 3.1);
  minSpeed = Math.min(minSpeed, r.speed); maxSpeed = Math.max(maxSpeed, r.speed);
  minPhase = Math.min(minPhase, r.phase); maxPhase = Math.max(maxPhase, r.phase);
}
const a = swayInstance(100, 20, -300), b = swayInstance(100, 20, -300), c = swayInstance(104, 20, -300);
out.rolls = { minSpeed, maxSpeed, minPhase, maxPhase, same: a.phase === b.phase && a.speed === b.speed,
  differs: a.phase !== c.phase };

// A bound scene: two placed trees, one template that sways and one that does
// not, the manifest served from memory.
globalThis.fetch = async () => ({ ok: true, json: async () => ({
  trees: {}, sway: { EU_pine1_M1: { rangeDegrees: 1.1 } },
}) });
const scene = new THREE.Scene();
const root = new THREE.Group();
scene.add(root);
function tree(name, x, z) {
  const g = new THREE.Group();
  g.name = `${name}_1`;
  g.userData.geometry = name;
  g.position.set(x, 10, z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), new THREE.MeshBasicMaterial({ name: 'trunk_0' }));
  m.position.set(0, 4, 0);
  g.add(m);
  root.add(g);
  return m;
}
const pineMesh = tree('EU_pine1_M1', 0, 0);
const oakMesh = tree('EU_oak_M1', 5, 0);
scene.updateMatrixWorld(true);
const pineRest = pineMesh.matrixWorld.clone();
const oakRest = oakMesh.matrixWorld.clone();
const bound = await bindTreeFoliage(root, { scene, mapsBase: 'mem://sway', texLoader: { load: () => new THREE.Texture() } });
const camera = new THREE.PerspectiveCamera(57.3, 1.6, 0.1, 1000);
const render = (x, y, z) => {
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  scene.onBeforeRender(null, scene, camera, null);
};
const dev = (m, rest) => Math.max(...m.matrixWorld.elements.map((v, i) => Math.abs(v - rest.elements[i])));
// Sample a few frames: at some instant the sine is away from zero.
let near = 0, base = 0, tilt = 0;
const realNow = performance.now.bind(performance);
const t0 = realNow();
for (let k = 0; k < 8; k++) {
  performance.now = () => t0 + k * 700;
  render(0, 12, 10);
  near = Math.max(near, dev(pineMesh, pineRest));
  // The trunk base: the mesh's local (0, -4, 0) is the tree's origin.
  const p = new THREE.Vector3(0, -4, 0).applyMatrix4(pineMesh.matrixWorld);
  base = Math.max(base, p.distanceTo(new THREE.Vector3(0, 10, 0)));
  const up = new THREE.Vector3(0, 1, 0).transformDirection(pineMesh.matrixWorld);
  tilt = Math.max(tilt, Math.acos(Math.min(1, up.y)) * 180 / Math.PI);
}
out.scene = { swaying: bound.swaying, near, base, tilt, oakNear: dev(oakMesh, oakRest) };
render(0, 12, 100);
out.scene.far = dev(pineMesh, pineRest);
performance.now = () => t0 + 700;
setTreeSway(false);
render(0, 12, 10);
out.scene.switchedOff = dev(pineMesh, pineRest);
setTreeSway(true);
performance.now = realNow;

console.log(JSON.stringify(out));
