// Drives `viewer/vehicle-wrecks.js` through a pad respawn outside a browser
// and prints one JSON blob: what the intact hull's materials look like after
// `respawnVehicle` turns it back on. The modules are imported from the viewer
// tree in place through the headless runner's hooks (`sim/env.mjs`), so the
// file under test is the file the page loads.
//
// The hull carries a muzzle-smoke sprite, as every armed vehicle does: the
// gun's flash and smoke emitters are nodes in its own subtree, translucent by
// design, and their `colorOverTime` leaves opacity below 1 after a shot. The
// respawn used to force every sub-1 material opaque, which drew every later
// puff as a black box.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createVehicleWrecks }] = await Promise.all([
  import('three'), imp('vehicle-wrecks.js'),
]);

function hull() {
  const node = new THREE.Group();
  node.name = 'PanzerIV';
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const smoke = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.35 });
  body.add(new THREE.Mesh(new THREE.PlaneGeometry(), smoke));
  node.add(body);
  return { node, body, smoke };
}

function page() {
  return {
    vehicles: { instanceOf: () => null, lastFlightOf: () => null },
    vehicleDamage: new Map(),
    fireStates: new Map(),
    world: { fireStates: new Map(), falling: new Set() },
    collider: null,
    respawnVehicleBody() {},
  };
}

const state = m => ({ opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });

/**
 * `wreck`: a wreck glb stood in, so the intact mesh was only hidden.
 * Otherwise the no-wreck path, which fades the intact mesh in place first.
 */
function respawn(wreck) {
  const h = hull();
  const wrecks = createVehicleWrecks(page());
  const visual = { node: h.node, hidden: [], handles: [], wrecked: true };
  wrecks.damageVisuals.set('pad', visual);
  let faded = null;
  if (!wreck) {
    Object.assign(visual, { removed: false, respawnIn: null, wreckAge: 1e3 });
    wrecks.stepWrecks(1 / 60);      // past linger and fade: opacity 0
    faded = { body: state(h.body.material), smoke: state(h.smoke) };
    visual.hidden = [h.body];
  } else {
    h.body.visible = false;
    visual.hidden = [h.body];
    visual.removed = true;
  }
  visual.respawnIn = -1;
  wrecks.stepWrecks(1 / 60);
  return { faded, body: state(h.body.material), smoke: state(h.smoke), shown: h.body.visible };
}

/**
 * Which URLs a dying hull's wreck is fetched from (`wreckUrls`), against
 * stub catalogues: DC Final's tree lists its own templates, vanilla's lists
 * the Sherman, and neither lists vanilla's level-declared Ju88A.
 */
async function wreckLookups() {
  const catalogues = {
    'models/mods/dc_final/models.json': [
      { name: 'FlagBox', variants: [
        { glb: 'FlagBox.glb', configuration: 'complex' },
        { glb: 'FlagBox.wreck.glb', configuration: 'wreck', level: null },
        { glb: 'FlagBox.wreck.DC_Medina_Ridge.glb', configuration: 'wreck', level: 'DC_Medina_Ridge' },
      ] },
      { name: 'nx_M-923', variants: [{ glb: 'nx_M-923.glb', configuration: 'complex' }] },
    ],
    'models/models.json': [
      { name: 'Sherman', variants: [
        { glb: 'Sherman.glb', configuration: 'complex' },
        { glb: 'Sherman.wreck.glb', configuration: 'wreck', level: null },
      ] },
    ],
  };
  const asked = [];
  globalThis.fetch = async url => {
    asked.push(url);
    const body = catalogues[url];
    return { ok: !!body, json: async () => body };
  };
  const wrecks = (base, level) => createVehicleWrecks({
    ...page(), MODELS_BASE: base, extras: { level },
  });
  const dc = wrecks('models/mods/dc_final', 'DC_Medina_Ridge');
  const out = {
    levelReskin: await dc.wreckUrls('flagbox'),
    noWreck: await dc.wreckUrls('NX_M-923'),
    inherited: await dc.wreckUrls('Sherman'),
    unlisted: await dc.wreckUrls('Flak18/36'),
    unlistedMeshless: await dc.wreckUrls('ISK', { drawn: false }),
    otherLevel: await wrecks('models/mods/dc_final', 'DC_Oil_Fields').wreckUrls('FlagBox'),
    vanilla: await wrecks('models', 'Battle_of_Britain').wreckUrls('Ju88A'),
  };
  out.catalogueFetches = asked.filter(url => url.startsWith('models/mods/dc_final/')).length;
  return out;
}

process.stdout.write(JSON.stringify({
  wreck: respawn(true), noWreck: respawn(false), lookups: await wreckLookups(),
}));
