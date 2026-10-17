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
  const alive = new Set();
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

console.log(JSON.stringify(out));
