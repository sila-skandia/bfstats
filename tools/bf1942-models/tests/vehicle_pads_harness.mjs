// Drives the map's vehicle pads (`viewer/level-statics.js` `loadPadVariants`,
// `indexScene`'s pad records, `stepVehiclePads`, `vehicleSpawnActive`) on a
// small synthetic level, outside a browser, and prints one JSON blob for
// `tests/test_vehicle_pads.py`. The modules are imported from the viewer tree
// in place through the headless runner's hooks (`sim/env.mjs`).
//
// The level: a flag that changes hands (`village`, held by team 2, its
// spawner id 3), a neutral one (`road`, id 5), a base that cannot (`base`,
// team 1, id 1), and a scene written before `osId` (a second level). The
// wreck side is a stand-in that keeps each hull's state the way
// `vehicle-wrecks.js` does: whole, critical (burning), wrecked (destroyed),
// removed.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, statics, deployables] = await Promise.all([
  import('three'), imp('level-statics.js'), imp('deployables.js'),
]);
const { createLevelStatics, loadPadVariants } = statics;

const tplOf = node => (node?.userData?.control || node?.name || '').replace(/_\d+$/, '');

function hull(name, at) {
  const node = new THREE.Group();
  node.name = name;
  node.userData = { control: name, templateKind: 'PlayerControlObject', armor: { hitpoints: 100 } };
  node.position.set(...at);
  node.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  return node;
}

/** A level: the scene graph and its `scene.json` half. */
function level({ osId = true } = {}) {
  const root = new THREE.Group();
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  spawners.userData.kind = 'spawners';
  root.add(spawners);
  const pads = [
    // The village's tank pad: team 2's M1A1 baked, team 1 gets a T72.
    { spawner: 'heavytankspawner', vehicle: 'M1A1', team: 2, position: [100, 0, 0], osId: 3,
      templates: { 1: 'T72', 2: 'M1A1' }, minSpawnDelay: 20, maxSpawnDelay: 60, controlPointName: 'village' },
    // The neutral road's jeep pad, with no `Object.setTeam` of its own (team
    // 0, as most of Desert Combat's are): nothing until a side holds it.
    { spawner: 'jeepspawner', vehicle: 'Humvee', team: null, position: [300, 0, 0], osId: 5,
      templates: { 1: 'UAZ', 2: 'Humvee' }, minSpawnDelay: 10, maxSpawnDelay: 10, controlPointName: 'road' },
    // The road's gun pad says `Object.setTeam 1` (DC El Alamein's South
    // outpost ZPU-4): a point that opens neutral leaves it on, so its MG42
    // stands from the first frame (SPAWN-19).
    { spawner: 'mgspawner', vehicle: 'MG42', team: 1, position: [320, 0, 0], osId: 5,
      templates: { 1: 'MG42', 2: 'Browning' }, minSpawnDelay: 30, maxSpawnDelay: 30, controlPointName: 'road' },
    // The base's AA pad: one side for good, no other template loaded.
    { spawner: 'aaspawner', vehicle: 'ZPU-4', team: 1, position: [500, 0, 0], osId: 1,
      templates: { 1: 'ZPU-4', 2: 'AA_allies' }, minSpawnDelay: 30, maxSpawnDelay: 30, controlPointName: 'base' },
    // Filed under no point: its own entry all round, whatever the flags do.
    { spawner: 'boatspawner', vehicle: 'Zodiac', team: 2, position: [700, 0, 0],
      minSpawnDelay: 15, maxSpawnDelay: 15, controlPointName: 'village' },
  ].map(p => {
    if (osId) return p;
    const { osId: _, ...rest } = p;
    return rest;
  });
  for (const p of pads) spawners.add(hull(p.vehicle, p.position));
  const extras = {
    objectSpawns: pads,
    controlPoints: [
      { name: 'village', team: 2, objectSpawnerId: 3, position: [100, 0, 0], radius: 10 },
      { name: 'road', team: 0, objectSpawnerId: 5, position: [300, 0, 0], radius: 10 },
      { name: 'base', team: 1, objectSpawnerId: 1, unableToChangeTeam: true, position: [500, 0, 0], radius: 10 },
    ],
  };
  const flags = extras.controlPoints.map(p => ({ controlPointName: p.name, team: p.team }));
  return { root, spawners, extras, flags };
}

/** The models tree: a T72, a UAZ, a Browning; no AA_allies (that pad keeps
 *  its ZPU-4). */
async function load(template) {
  if (!['T72', 'UAZ', 'Browning'].includes(template)) return null;
  const scene = new THREE.Group();
  scene.add(hull(template, [0, 0, 0]));
  return { scene };
}

/** The wreck side, as `vehicle-wrecks.js` keeps it, per node. */
function wrecks() {
  const state = new Map();     // node -> 'whole' | 'critical' | 'wrecked' | 'removed'
  const log = [];
  const at = new THREE.Vector3();
  const world = {
    players: 8, maxPlayers: 16,
    alive: node => state.get(node) !== 'removed',
    destroyed: node => state.get(node) === 'wrecked',
    position: node => { node.getWorldPosition(at); return [at.x, at.y, at.z]; },
    destroy: node => { if (state.get(node) === 'wrecked') { state.set(node, 'removed'); log.push(`destroy ${tplOf(node)}`); } },
    spawn: node => {
      if (state.get(node) === 'wrecked' || state.get(node) === 'critical') return false;
      state.set(node, 'whole');
      log.push(`spawn ${tplOf(node)}`);
      return true;
    },
  };
  return { state, log, world };
}

async function build(opts) {
  const lv = level(opts);
  const added = await loadPadVariants(lv.root, lv.extras, { load });
  const page = {
    camera: new THREE.PerspectiveCamera(), drawDistance: () => 1000, extras: lv.extras,
    levelClips: [], optEntire: { checked: true }, optVehicles: { checked: true },
    templateNameOf: tplOf, world: { flags: lv.flags },
  };
  const st = createLevelStatics(page);
  st.indexScene(lv.root);
  const w = wrecks();
  return { ...lv, st, added, ...w };
}

const live = (st, spawners) => spawners.children.filter(n => st.vehicleSpawnActive(n)).map(tplOf).sort();
const padBy = (st, spawner) => st.pads.find(r => r.spawn.spawner === spawner);
const run = (env, seconds, step = 1 / 30) => {
  for (let t = 0; t < seconds - 1e-9; t += step) env.st.stepVehiclePads(step, env.world);
};

// --- the engine level, with osId ------------------------------------------------
const out = {};
{
  const env = await build({ osId: true });
  const { st, spawners, flags, state, log } = env;
  const flag = name => flags.find(f => f.controlPointName === name);
  out.added = env.added.map(tplOf).sort();
  out.atLoad = live(st, spawners);
  run(env, 1 / 30);
  const tank = padBy(st, 'heavytankspawner');
  // Full of players? 8 of 16: halfway, 20 + 40 x 0.5 = 40 s (SPAWN-10).
  out.firstDelay = Math.round(tank.pad.delay * 100) / 100;

  // The village falls to team 1: the M1A1 parked there stays (SPAWN-12).
  flag('village').team = 0;
  run(env, 1);
  flag('village').team = 1;
  run(env, 1);
  out.afterCapture = { live: live(st, spawners), tankTeam: tank.pad.team, active: tank.pad.active,
                       delay: Math.round(tank.pad.delay * 100) / 100 };

  // The M1A1 burns for 5 s (critical: it still holds its pad), then is
  // destroyed: the delay runs from that moment (`isDestroyed`, SPAWN-11), and
  // the pad gives team 1 its T72 once it is out, the wreck on the pad cleared.
  const m1 = [...tank.live][0];
  state.set(m1, 'critical');
  let respawnAt = null;
  let delayWhileBurning = null;
  for (let t = 0; t < 70 && respawnAt == null; t += 1 / 30) {
    if (t >= 5 - 1e-9 && state.get(m1) === 'critical') {
      delayWhileBurning = Math.round(tank.pad.delay * 100) / 100;
      state.set(m1, 'wrecked');
    }
    st.stepVehiclePads(1 / 30, env.world);
    if (st.vehicleSpawnActive(spawners.children.find(n => tplOf(n) === 'T72'))) respawnAt = Math.round(t * 10) / 10;
  }
  out.respawn = { at: respawnAt, delayWhileBurning, live: live(st, spawners), log: [...log] };

  // The neutral road: nothing stands on its team-0 pad until a side takes
  // it, and then that side's template, at once (a pad that never spawned has
  // no delay). Its own-side gun pad has had its MG42 out since the start.
  out.roadBefore = live(st, spawners).includes('Humvee') || live(st, spawners).includes('UAZ');
  const gun = padBy(st, 'mgspawner');
  out.gunAtStart = { team: gun.pad.team, active: gun.pad.active };
  flag('road').team = 1;
  run(env, 1 / 30);
  out.roadAfter = live(st, spawners).filter(n => n === 'UAZ' || n === 'Humvee');
  // Team 2 takes the road: the MG42 is left where it is, the pad turns to
  // team 2 and waits for it to die (SPAWN-19).
  flag('road').team = 0;
  run(env, 1);
  flag('road').team = 2;
  run(env, 1);
  out.gunAfter = { team: gun.pad.team, active: gun.pad.active, delay: Math.round(gun.pad.delay * 100) / 100,
                   live: live(st, spawners).filter(n => n === 'MG42' || n === 'Browning') };

  // A base that cannot change hands has its own side's vehicle all round, and
  // the boat (filed under no point) ignores the village.
  out.base = live(st, spawners).includes('ZPU-4');
  out.boat = live(st, spawners).includes('Zodiac');
  out.boatPoint = padBy(st, 'boatspawner').point;
}

// --- a wreck away from its pad -----------------------------------------------------
// The boat is driven 200 m off its pad and destroyed there. Its wreck is the
// pad's own node and outside the pad's radius, so the pad does not clear it;
// the next hull still comes at the delay, from the death, and the wreck goes
// to make room (the engine leaves it standing beside the new one, which the
// page's one node per template cannot).
{
  const env = await build({ osId: true });
  const { st, state, log } = env;
  run(env, 1 / 30);
  const boat = padBy(st, 'boatspawner');
  const zodiac = [...boat.live][0];
  zodiac.position.x += 200;
  zodiac.updateMatrixWorld(true);
  state.set(zodiac, 'wrecked');
  log.length = 0;
  let at = null;
  for (let t = 0; t < 40 && at == null; t += 1 / 30) {
    st.stepVehiclePads(1 / 30, env.world);
    if (state.get(zodiac) === 'whole') at = Math.round(t * 10) / 10;
  }
  out.awayWreck = { at, log: [...log] };
}

// --- the same level written before `osId` -----------------------------------------
{
  const env = await build({ osId: false });
  const { st, spawners, flags } = env;
  out.legacy = { added: env.added.map(tplOf).sort(), atLoad: live(st, spawners),
                 boatPoint: padBy(st, 'boatspawner').point };
  flags.find(f => f.controlPointName === 'road').team = 2;
  run(env, 1 / 30);
  out.legacy.roadAfter = live(st, spawners).filter(n => n === 'UAZ' || n === 'Humvee');
}

// --- a point switched off while it keeps its side (SPAWN-22) ------------------
// The village's tank pad: its point running down with `disableWhenLosingControl`
// (`spawnsEnabled` false, `controlPointStep`) stops the pad on team 2; held
// again, it runs.
{
  const env = await build({ osId: true });
  const { st, flags } = env;
  run(env, 1 / 30);
  const tank = padBy(st, 'heavytankspawner');
  const village = flags.find(f => f.controlPointName === 'village');
  const before = { team: tank.pad.team, active: tank.pad.active };
  village.spawnsEnabled = false;
  run(env, 1 / 30);
  const off = { team: tank.pad.team, active: tank.pad.active };
  village.spawnsEnabled = true;
  run(env, 1 / 30);
  out.switched = { before, off, on: { team: tank.pad.team, active: tank.pad.active } };
}

// --- the restart (ROUND-10): the field cleared, every pad reset --------------
// The village goes to team 1 and its M1A1 drives off; the round ends, the end
// game takes every hull, and the restart resets the pads: each stands its own
// fresh hull up on its next frame, the village's for its owner at the start.
{
  const env = await build({ osId: true });
  const { st, spawners, flags, state } = env;
  run(env, 1 / 30);
  const tank = padBy(st, 'heavytankspawner');
  const village = flags.find(f => f.controlPointName === 'village');
  village.team = 0; run(env, 1); village.team = 1; run(env, 1);
  const before = live(st, spawners);
  // `clearWorld`: every hull off the field.
  for (const record of st.pads) for (const node of record.live) state.set(node, 'removed');
  run(env, 1 / 30);
  const cleared = live(st, spawners);
  // `ControlPoint::reset`, then `ObjectSpawner::reset`.
  village.team = 2;
  st.restartVehiclePads({ players: 8, maxPlayers: 16 });
  const reset = { team: tank.pad.team, active: tank.pad.active, delay: tank.pad.delay };
  run(env, 1 / 30);
  out.restart = { before, cleared, reset, after: live(st, spawners), tankTeam: tank.pad.team };
}

// --- spawnDelayAtStart against the pre-game `setTeam` (SPAWN-21) ------------
// DC Final DC_Cornered: pads under owned points with `spawnDelayAtStart 1`
// and their own `Object.setTeam`. The level loads in the pre-game, the
// `setTeam` cancels the delay, and the first round's first frame has them;
// after a restart the delay holds (40 s at 8 of 16). A pad with the word and
// neither a team nor an owning point keeps it from the start.
{
  const lv = level({ osId: true });
  const atStart = [
    { spawner: 'mlrsspawner', vehicle: 'MLRS', team: 2, position: [900, 0, 0], osId: 3,
      templates: { 2: 'MLRS' }, minSpawnDelay: 20, maxSpawnDelay: 60, spawnDelayAtStart: 1 },
    { spawner: 'scudspawner', vehicle: 'Scud', team: null, position: [950, 0, 0],
      templates: { 1: 'Scud' }, minSpawnDelay: 20, maxSpawnDelay: 60, spawnDelayAtStart: 1 },
  ];
  for (const p of atStart) { lv.extras.objectSpawns.push(p); lv.spawners.add(hull(p.vehicle, p.position)); }
  await loadPadVariants(lv.root, lv.extras, { load });
  const page = {
    camera: new THREE.PerspectiveCamera(), drawDistance: () => 1000, extras: lv.extras,
    levelClips: [], optEntire: { checked: true }, optVehicles: { checked: true },
    templateNameOf: tplOf, world: { flags: lv.flags },
  };
  const st = createLevelStatics(page);
  st.indexScene(lv.root);
  const w = wrecks();
  const env = { st, world: w.world };
  const mlrs = padBy(st, 'mlrsspawner');
  const scud = padBy(st, 'scudspawner');
  const first = { mlrs: { delay: mlrs.pad.delay, live: mlrs.live.size },
                  scud: { delay: Math.round(scud.pad.delay * 100) / 100, live: scud.live.size } };
  for (const record of st.pads) for (const node of record.live) w.state.set(node, 'removed');
  run(env, 1 / 30);
  st.restartVehiclePads({ players: 8, maxPlayers: 16 });
  run(env, 1 / 30);
  out.atStart = { first, restart: { mlrs: { delay: Math.round(mlrs.pad.delay * 100) / 100, live: mlrs.live.size } } };
}

out.delayAtStart = [1, 0, 60, 15, true, null].map(v => deployables.delayAtStart(v));
console.log(JSON.stringify(out));
