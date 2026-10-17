// Drives `viewer/round-spawners.js` and `level-statics.js`
// `loadRoundSpawnPool` under node against a made-up page, and prints one JSON
// blob for `test_round_spawners.py`. The spawner record is FHSW's
// `Flak18/36mobile_TransformObjSpawner` as `patch_round_spawners.py` writes it
// into `Flak18_36mobile.glb` (2026-10-17): `spawnDelayAtStart 1`, 4 s, one
// object ever, at -0.305/-0.2/-0.746 in the round's frame.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await imp('vendor/three.module.js');
const { createRoundSpawners, standMatrix, spawnerLocal } = await imp('round-spawners.js');
const { loadRoundSpawnPool, roundSpawnTemplates } = await imp('level-statics.js');

const SPAWNER = {
  template: 'Flak18/36mobile_TransformObjSpawner',
  translation: [-0.305, -0.2, 0.746],
  templates: { 1: 'Flak18/36mobilestatic', 2: 'Flak18/36mobilestatic' },
  team: 1, minSpawnDelay: 4, maxSpawnDelay: 4, spawnDelayAtStart: true,
  maxNrOfObjectSpawned: 1, nrOfObjectToSpawn: 1, radius: 5, holdObject: false,
  teamOnVehicle: false, spawnOffset: [0, 0, 0], timeToLive: 600, distance: 500, damageWhenLost: 0,
  objects: { 'Flak18/36mobilestatic': { kind: 'PlayerControlObject', vehicleCategory: 'VCLand' } },
};
const out = {};

/** A page with one parked node per template and a wreck side that answers
 *  for it; `human` is where the human's feet are, or null. */
function makePage({ human = null, nodes = 1 } = {}) {
  const records = [];
  for (let i = 0; i < nodes; i++) {
    const node = new THREE.Object3D();
    node.name = `static${i}`;
    node.userData.cullRadius = 3;
    records.push({ round: true, template: 'Flak18/36mobilestatic', baked: node, live: new Set() });
  }
  // The wreck side registers every parked node at load: alive, not destroyed.
  const alive = new Set(records.map(r => r.baked));
  const destroyed = new Set();
  const damage = new Map(records.map(r => [r.baked, { destroyed: false, hp: 99, damage(n) { this.hp -= n; } }]));
  const stood = [];
  const page = {
    roomJoined: false, maxPlayers: 32, LOCAL_PLAYER: 0,
    optOnFoot: { checked: true }, optPilot: { checked: false },
    soldier: human ? { x: human[0], y: human[1], z: human[2] } : null, soldierDead: !human,
    world: { players: new Map(), armorOf: () => null },
    vehicles: { instanceOf: () => null, seatOf: () => null },
    collider: { statics: { ownerOf: node => records.findIndex(r => r.baked === node) } },
    vehicleDamage: { get: owner => damage.get(records[owner]?.baked) },
    vehiclePads: {
      roundRecords: records,
      takeRoundNode: (t, busy) => records.find(r => r.template.toLowerCase() === t.toLowerCase()
                                              && !r.live.size && !busy?.(r.baked)) ?? null,
      setRoundLive: (r, on) => { if (on) r.live.add(r.baked); else r.live.delete(r.baked); },
      retagCull: () => {},
    },
    wrecks: { padWorld: {
      alive: node => alive.has(node), destroyed: node => destroyed.has(node),
      destroy: node => alive.delete(node),
      spawn: node => { alive.add(node); return true; },
    } },
    hullBodies: {
      syncVehicleSpawnOwnership() {},
      standSpawnedObject(node, matrix) {
        node.matrix.copy(matrix);
        matrix.decompose(node.position, node.quaternion, node.scale);
        node.updateMatrixWorld(true);
        stood.push(node.name);
      },
      holdSpawned() {}, releaseSpawned() {},
    },
  };
  return { page, records, alive, destroyed, damage, stood };
}

/** A round lying at `at`, turned `yaw` degrees about up. */
function makeShot(at = [100, 20, 200], yaw = 30) {
  const mesh = new THREE.Object3D();
  mesh.position.set(...at);
  mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * Math.PI / 180);
  mesh.updateMatrixWorld(true);
  return { mesh };
}

const step = (s, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) s.tick(1 / 30); };

// --- the deploy: nothing for 4 s, then one static, once -----------------------
{
  const { page, stood, records } = makePage();
  const s = createRoundSpawners(page);
  const shot = makeShot();
  const handle = s.onRound({}, [SPAWNER], shot);
  step(s, 3.9);
  const before = stood.length;
  step(s, 0.2);
  const node = records[0].baked;
  const expect = standMatrix(new THREE.Matrix4().multiplyMatrices(shot.mesh.matrixWorld, spawnerLocal(SPAWNER)),
                             SPAWNER);
  const e = expect.elements;
  step(s, 0.7);
  out.deploy = {
    before, after: stood.length, live: records[0].live.size,
    at: [node.position.x, node.position.y, node.position.z].map(v => +v.toFixed(4)),
    expect: [e[12], e[13], e[14]].map(v => +v.toFixed(4)),
    yawDeg: +(2 * Math.atan2(node.quaternion.y, node.quaternion.w) * 180 / Math.PI).toFixed(3),
    nrToSpawn: s.state().rounds[0].entries[0].nrToSpawn,
  };
  handle.end();
  step(s, 1);
  out.deploy.roundsAfterEnd = s.state().rounds.length;
  out.deploy.stillStanding = s.state().standing.length;
}

// --- the 2 m clearance: the human standing on the point holds it back ----------
{
  const shot = makeShot([50, 10, 50], 0);
  const p = new THREE.Vector3(-0.305, -0.2, 0.746).applyMatrix4(shot.mesh.matrixWorld);
  const { page, stood } = makePage({ human: [p.x, p.y - 1, p.z] });
  const s = createRoundSpawners(page);
  s.onRound({}, [SPAWNER], shot);
  step(s, 4.5);
  const held = stood.length;
  page.soldier.x += 5;
  step(s, 0.1);
  out.clearance = { held, afterStepAway: stood.length };
}

// --- no free node: nothing stands, the round carries on -----------------------
{
  const { page, stood } = makePage({ nodes: 1 });
  const s = createRoundSpawners(page);
  s.onRound({}, [SPAWNER], makeShot([0, 0, 0]));
  s.onRound({}, [SPAWNER], makeShot([30, 0, 0]));
  step(s, 4.5);
  out.exhausted = { stood: stood.length };
}

// --- the abandon clock with the spawner gone: 600 s, then 1 hp a second -------
{
  const { page, damage, records } = makePage();
  const s = createRoundSpawners(page);
  const handle = s.onRound({}, [SPAWNER], makeShot());
  step(s, 4.5);
  handle.end();
  step(s, 599);
  const hpAt600 = damage.get(records[0].baked).hp;
  step(s, 10);
  out.abandon = { hpAt600, hpAt610: +damage.get(records[0].baked).hp.toFixed(3) };
}

// --- a destroyed object frees its node ----------------------------------------
{
  const { page, alive, records } = makePage();
  const s = createRoundSpawners(page);
  s.onRound({}, [SPAWNER], makeShot());
  step(s, 4.5);
  alive.delete(records[0].baked);
  step(s, 0.1);
  out.freed = { live: records[0].live.size, standing: s.state().standing.length };
}

// --- the pool: sized by the level's guns, followed through the spawned model ---
{
  const gun = spawners => {
    const n = new THREE.Object3D();
    n.userData.fireArms = { projectile: { spawners } };
    return n;
  };
  const vehicle = (name, spawners) => {
    const v = new THREE.Object3D();
    v.name = name;
    v.userData.templateKind = 'PlayerControlObject';
    v.add(gun(spawners));
    return v;
  };
  const back = { ...SPAWNER, templates: { 1: 'Flak18/36mobile', 2: 'Flak18/36mobile' } };
  const root = new THREE.Object3D();
  const group = new THREE.Object3D();
  group.name = 'spawners';
  root.add(group);
  for (let i = 0; i < 3; i++) group.add(vehicle('Flak18/36mobile', [SPAWNER]));
  const loads = [];
  const models = { 'Flak18/36mobilestatic': [back], 'Flak18/36mobile': [SPAWNER] };
  const added = await loadRoundSpawnPool(root, {
    load: async name => {
      loads.push(name);
      const scene = new THREE.Object3D();
      scene.add(vehicle(name, models[name]));
      return { scene };
    },
  });
  const byTemplate = {};
  for (const n of added) byTemplate[n.userData.roundSpawned] = (byTemplate[n.userData.roundSpawned] ?? 0) + 1;
  out.pool = {
    loads, byTemplate, hidden: added.every(n => n.visible === false),
    templates: Object.fromEntries(roundSpawnTemplates(group.children[0])),
  };
}

// --- the pool grows when every node is out, as many as the rounds stand -------
{
  const { page, stood, records, alive } = makePage({ nodes: 1 });
  const grownNodes = [];
  const owners = [];
  page.vehiclePads.growRoundNode = template => {
    if (grownNodes.length >= 2) return null;
    const node = new THREE.Object3D();
    node.name = `grown${grownNodes.length}`;
    const record = { round: true, template, baked: node, live: new Set() };
    records.push(record);
    alive.add(node);
    grownNodes.push(node);
    return record;
  };
  page.collider.addOwner = (node, opts) => { owners.push(opts?.empty === true); return 100 + owners.length; };
  page.wrecks.registerDamageable = () => {};
  const adopted = [];
  page.hullBodies.adoptSpawnedBody = owner => adopted.push(owner);
  const s = createRoundSpawners(page);
  for (let i = 0; i < 4; i++) s.onRound({}, [SPAWNER], makeShot([i * 30, 0, 0]));
  step(s, 4.5);
  out.grow = { stood: stood.length, grown: s.state().grown, emptyOwners: owners, adopted: adopted.length };
}

// --- a kit entry is laid as a pad's kit, never as a node ----------------------
{
  const { page, stood } = makePage();
  const laid = [];
  const taken = new Set();
  page.loadouts = { kits: { German_FortificationMg34NoMine: {} } };
  page.kitDrops = {
    placeKit: (kit, place, { objectId }) => { laid.push({ kit, place, objectId }); return {}; },
    objectAlive: id => !taken.has(id),
    objectPosition: () => [0, 0, 0],
  };
  const KIT = {
    ...SPAWNER, template: 'HanomagMGDeploySpawner', spawnDelayAtStart: false, nrOfObjectToSpawn: -1,
    minSpawnDelay: 0, maxSpawnDelay: 0, translation: [0, 0, 0], spawnOffset: [0, 0.2, 0],
    templates: { 1: 'german_fortificationmg34nomine', 2: 'German_FortificationMg34NoMine' },
    objects: { German_FortificationMg34NoMine: { kind: 'Kit' } },
  };
  const s = createRoundSpawners(page);
  s.onRound({}, [KIT], makeShot([10, 5, 10], 90));
  step(s, 0.1);
  const first = laid.length;
  step(s, 1);
  const whileLying = laid.length;
  taken.add(laid[0].objectId);
  step(s, 0.1);
  out.kit = {
    first, whileLying, afterTaken: laid.length, nodes: stood.length,
    kit: laid[0].kit, at: [laid[0].place.x, laid[0].place.y, laid[0].place.z].map(v => +v.toFixed(3)),
    yawDeg: +(laid[0].place.yaw * 180 / Math.PI).toFixed(3),
  };
  // A kit no loadouts row lists lays nothing.
  page.loadouts = { kits: {} };
  const s2 = createRoundSpawners(page);
  laid.length = 0;
  s2.onRound({}, [KIT], makeShot());
  step(s2, 0.2);
  out.kit.unknownLaid = laid.length;
}

// --- an object that draws nothing: its logic node, its depot, its own spawner ---
{
  const REPAIR = {
    template: 'Flak18/36_dummyRepairObjRepair_Spawner', translation: [0, 0, 0],
    templates: { 1: 'Flak18/36mobile_dummyRepairObjRepairObj', 2: 'Flak18/36mobile_dummyRepairObjRepairObj' },
    team: 1, minSpawnDelay: 9999, maxSpawnDelay: 9999, spawnDelayAtStart: false,
    maxNrOfObjectSpawned: 1, nrOfObjectToSpawn: -1, radius: 5, holdObject: true, teamOnVehicle: true,
    spawnOffset: [0, 0, 1], timeToLive: 30, distance: 200, damageWhenLost: 1000000,
    objects: { 'Flak18/36mobile_dummyRepairObjRepairObj': {
      kind: 'PlayerControlObject', vehicleCategory: 'VCLand', drawn: false,
      logic: {
        armor: { hitpoints: 800, maxHitpoints: 800, hasArmor: true },
        depots: [{ template: 'Flak18/36mobile_dummySpawnObjRepairSupplyDepot2', radius: 10,
                   vehicleTypes: [['Flak18/36mobile_towed_dummySpawnObj', -1, 10000, 0]],
                   workOnVehicles: true, translation: [0, 0.5, 0] }],
        spawners: [{ ...SPAWNER, template: 'IconSpawner', spawnDelayAtStart: false,
                     templates: { 1: 'IconPCO', 2: 'IconPCO' }, objects: {} }],
      },
    } },
  };
  // The pool: no glb is asked for, the node is the logic group with the Armor.
  const root = new THREE.Object3D();
  const group = new THREE.Object3D();
  group.name = 'spawners';
  root.add(group);
  const tractor = new THREE.Object3D();
  tractor.userData.templateKind = 'PlayerControlObject';
  const gun = new THREE.Object3D();
  gun.userData.fireArms = { projectile: { spawners: [REPAIR] } };
  tractor.add(gun);
  group.add(tractor);
  const loads = [];
  const added = await loadRoundSpawnPool(root, { load: async name => { loads.push(name); return null; } });
  const logicNodes = added.filter(n => n.userData.roundSpawned === 'Flak18/36mobile_dummyRepairObjRepairObj');
  out.logicPool = {
    loads, count: logicNodes.length, moulds: logicNodes.filter(n => n.userData.roundMould).length,
    kind: logicNodes[0]?.userData.templateKind, hp: logicNodes[0]?.userData.armor?.hitpoints,
    meshes: logicNodes[0]?.children.length, iconLoaded: loads.includes('IconPCO'),
  };
  // Standing it: the depot works where it is, its spawner runs on it, the
  // hold carries the offset, the spawner's team is stamped.
  const { page, records } = makePage();
  records[0].template = 'Flak18/36mobile_dummyRepairObjRepairObj';
  records[0].baked.userData.logicObject = REPAIR.objects['Flak18/36mobile_dummyRepairObjRepairObj'].logic;
  const depots = [];
  page.world.supplyField = { add: d => { depots.push(d); return d; } };
  const held = [];
  page.hullBodies.holdSpawned = (node, host, local, offset) => held.push(offset);
  const stamps = [];
  page.vehicles.stampTeam = (node, team) => stamps.push(team);
  page.vehicles.clearStamp = () => stamps.push('clear');
  const s = createRoundSpawners(page);
  const handle = s.onRound({}, [REPAIR], makeShot([40, 2, 40], 0));
  step(s, 0.1);
  const roundsWhileStanding = s.state().rounds.length;
  const depot = depots[0];
  const at = depot ? [depot.x ?? depot.position?.x, depot.y ?? depot.position?.y, depot.z ?? depot.position?.z] : null;
  handle.end();
  step(s, 0.1);
  out.logicStand = {
    depots: depots.length, depotGoneWhileStanding: depot?.gone?.() ?? null,
    held, stamps, roundsWhileStanding,
    depotAt: at?.map(v => (v == null ? null : +v.toFixed(3))),
  };
}

// --- a round born and gone inside one tick still had its spawner's frame ------
{
  const { page, stood } = makePage();
  const s = createRoundSpawners(page);
  const quick = { ...SPAWNER, spawnDelayAtStart: false };
  s.onRound({}, [quick], makeShot()).end();
  step(s, 1 / 30);
  const once = stood.length;
  step(s, 1);
  out.shortLived = { stood: once, after: stood.length, rounds: s.state().rounds.length };
}

console.log(JSON.stringify(out));
