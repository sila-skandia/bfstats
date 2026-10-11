// A replay's first-person cockpit: the interior a followed pilot looks out of
// is grafted from `<Template>.cockpit.glb` and has to be drawn unlit, as the
// page's own flown vehicles' is (level-shading.js `unlitCockpit`). One JSON
// report on stdout; same pattern as `replay_hud_harness.mjs`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { ReplayCamera }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-camera.js'),
]);

const results = {};
const calls = [];

const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
const ctx = {
  camera: cam,
  unlitCockpit: root => calls.push(['unlit', root.name]),
  warmSubtree: root => { calls.push(['warm', root.name]); return Promise.resolve(); },
};
const watcher = { rec: { lives: [] }, followPid: 3, time: 0, hulls: new Map(), ctx };
const camera = new ReplayCamera(watcher);

let received = null;
const drive = {
  firstPerson: false,
  setFirstPerson(on) { this.firstPerson = on; },
  loadCockpit(modelsBase, prepare) {
    received = { modelsBase: modelsBase ?? null, prepare: typeof prepare };
    // What vehicle-base.js `fetchCockpit` does with the detached interior.
    const root = new THREE.Group();
    root.name = 'cockpit-root';
    return Promise.resolve(prepare ? prepare(root) : null).then(() => []);
  },
};
camera.setFirstPersonHull({ drive });
await new Promise(r => setTimeout(r, 0));
results.received = received;
results.calls = calls;
results.firstPerson = drive.firstPerson;

// A page whose context has no `unlitCockpit` (an older map.html) still loads
// the interior: the prepare callback tolerates the missing hook.
const calls2 = [];
const bareCtx = { camera: cam, warmSubtree: root => { calls2.push(root.name); return null; } };
const bare = new ReplayCamera({ rec: { lives: [] }, followPid: 3, time: 0, hulls: new Map(), ctx: bareCtx });
let threw = null;
try {
  bare.setFirstPersonHull({ drive: { setFirstPerson() {}, loadCockpit: (b, prepare) => Promise.resolve(prepare(new THREE.Group())) } });
  await new Promise(r => setTimeout(r, 0));
} catch (error) { threw = String(error); }
results.bare = { threw, warmed: calls2.length };

process.stdout.write(JSON.stringify(results));
