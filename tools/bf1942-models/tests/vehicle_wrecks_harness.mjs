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
const [THREE, { createVehicleWrecks }, { DamageableVehicle }] = await Promise.all([
  import('three'), imp('vehicle-wrecks.js'), imp('vehicle-damage.js'),
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

/**
 * A pad's abandoned hull (`stepAbandoned`, ledger SPAWN-13): an M1A1 with
 * Desert Combat's words (`TimeToLive 45`, `Distance 40`, `damageWhenLost
 * 10`) left `at` metres from its pad. Returns its hit points each whole
 * second for `seconds`. `soldier` puts a live man on foot beside it,
 * `occupied` a man in its seat, `words: false` a scene from before the
 * exporter wrote the words.
 */
function abandoned({ at = 60, seconds = 60, soldier = false, occupied = false, words = true } = {}) {
  const h = hull();
  h.node.position.set(at, 0, 0);
  h.node.userData.armor = { hitpoints: 100, maxHitpoints: 100 };
  h.node.userData.cullRadius = 6;
  const vehicleDamage = new Map();
  const inst = { empty: !occupied };
  const record = {
    spawn: words ? { timeToLive: 45, distance: 40, damageWhenLost: 10 } : {},
    live: new Set([h.node]),
    at: [0, 0, 0],
  };
  const players = new Map();
  if (soldier) players.set('bot_1', { soldier: { x: at + 2, y: -1, z: 0 } });
  const p = {
    ...page(),
    vehicleDamage,
    vehicles: { instanceOf: node => (node === h.node && occupied ? inst : null), lastFlightOf: () => null,
                seatOf: () => null },
    world: {
      fireStates: new Map(), falling: new Set(), players, armorOf: () => null,
      addDamageable: (owner, node, extras) => {
        const v = new DamageableVehicle(extras, { owner });
        vehicleDamage.set(owner, v);
        return v;
      },
    },
    vehiclePads: { pads: [record], padOf: () => record, stepVehiclePads() {} },
  };
  const wrecks = createVehicleWrecks(p);
  wrecks.registerDamageables([h.node]);
  const v = vehicleDamage.get(0);
  const hp = [];
  for (let frame = 1; frame <= seconds * 30; frame++) {
    wrecks.stepWrecks(1 / 30);
    if (frame % 30 === 0) hp.push(Math.round(v.hitPoints * 10) / 10);
  }
  return hp;
}

/**
 * The end of a round and the restart (ledger ROUND-10): `clearWorld` takes an
 * intact hull, a burning one and a wreck off the field at once, with no wreck
 * left; the pads see them gone (`padWorld.alive`); `respawnVehicle` brings
 * each back fresh, and a node no pad names comes back through `restartHulls`.
 */
function clearAndRestart() {
  const nodes = [hull(), hull(), hull()];
  const vehicleDamage = new Map();
  const disabled = new Set();
  const retired = [];
  const p = {
    ...page(),
    vehicleDamage,
    collider: { statics: { disableOwner: o => disabled.add(o), enableOwner: o => disabled.delete(o) },
                clearMovedOwner() {} },
    retireVehicleBody: o => retired.push(o),
    world: {
      fireStates: new Map(), falling: new Set(), players: new Map(), armorOf: () => null,
      addDamageable: (owner, node, extras) => {
        const v = new DamageableVehicle(extras, { owner });
        vehicleDamage.set(owner, v);
        return v;
      },
    },
    // Owner 2 is on no pad.
    vehiclePads: { pads: null, padOf: node => (node === nodes[2].node ? null : {}), stepVehiclePads() {} },
  };
  for (const h of nodes) h.node.userData.armor = { hitpoints: 100, maxHitpoints: 100 };
  const wrecks = createVehicleWrecks(p);
  wrecks.registerDamageables(nodes.map(h => h.node));
  vehicleDamage.get(1).damage(80);          // burning, not destroyed
  wrecks.damageVisuals.get(2).wrecked = true;
  wrecks.damageVisuals.get(2).hidden = [];
  // What stays: an armoured object that is not a PlayerControlObject, and one
  // a spawn effect stood up (its own module removes it, HP-20).
  const keep = [hull(), hull()];
  keep[0].node.userData = { armor: { hitpoints: 100, maxHitpoints: 100 }, templateKind: 'SimpleObject' };
  keep[1].node.userData = { armor: { hitpoints: 100, maxHitpoints: 100 }, templateKind: 'PlayerControlObject' };
  wrecks.registerDamageable?.(3, keep[0].node);
  wrecks.registerDamageable?.(4, keep[1].node, { spawned: true });
  if (!wrecks.registerDamageable) {
    // This branch predates `registerDamageable`; the visuals are what count.
    for (const [o, h] of [[3, keep[0]], [4, keep[1]]]) {
      wrecks.damageVisuals.set(o, { node: h.node, anchors: new Map(), handles: [], spawnDelay: null });
    }
  }
  wrecks.damageVisuals.get(4).spawned = true;
  wrecks.clearWorld();
  const kept = keep.map(h => ({ visible: h.node.visible, cleared: !!h.node.userData.cleared }));
  const after = [0, 1, 2].map(o => ({
    removed: !!wrecks.damageVisuals.get(o).removed, alive: wrecks.padWorld.alive(nodes[o].node),
    cleared: !!nodes[o].node.userData.cleared, collision: !disabled.has(o) }));
  const spawned = [0, 1].map(o => wrecks.padWorld.spawn(nodes[o].node));
  wrecks.restartHulls();
  return {
    after, retired, spawned, kept,
    back: [0, 1, 2].map(o => ({ removed: !!wrecks.damageVisuals.get(o).removed,
                                cleared: !!nodes[o].node.userData.cleared, hp: vehicleDamage.get(o).hitPoints,
                                collision: !disabled.has(o) })),
  };
}

process.stdout.write(JSON.stringify({
  restart: clearAndRestart(),
  wreck: respawn(true), noWreck: respawn(false), lookups: await wreckLookups(),
  abandoned: {
    far: abandoned(),
    near: abandoned({ at: 30 }),
    soldier: abandoned({ soldier: true }),
    occupied: abandoned({ occupied: true }),
    oldScene: abandoned({ words: false }),
  },
}));
