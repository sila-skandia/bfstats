// Which death tier a hull gets, by what killed it and where it was (ledger
// ARM-11: the death key is -1 in water, `Armor+0x10`). Vanilla's own tier
// tables: the Elco80's -1 is its raft, a Sherman's and a Spitfire's -1 is
// `WaterWaterExplosion`, a destroyer has no -1 at all. Killed by a round
// (`applyVehicleHit`), by a bomb's splash (the same call, no direct owner),
// and by a crash (the world's own `onBodyDamage` then `damageTick`, as
// `world.js` runs them): all three must agree. Run by
// `test_effect_objects.py`; prints one JSON object.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(pathToFileURL(path.join(viewer, f)).href);
const THREE = await imp('vendor/three.module.js');
const { createVehicleHits } = await imp('vehicle-hits.js');
const { VehicleDamageSet } = await imp('vehicle-damage.js');
const { onBodyDamage, damageTick } = await imp('world-damage.js');
routeConsole(true);

const TIERS = {
  Elco80: [{ hp: 0, effect: 'e_scrapmetal_Willy' }, { hp: -1, effect: 'e_PTBoatWreck' }],
  Sherman: [{ hp: 0, effect: 'e_ExplGas' }, { hp: 0, effect: 'e_scrapmetal' }, { hp: -1, effect: 'WaterWaterExplosion' }],
  Spitfire: [{ hp: 0, effect: 'e_ExplGas' }, { hp: 0, effect: 'e_scrapmetal_Spitfire' }, { hp: -1, effect: 'WaterWaterExplosion' }],
  Hatsuzuki: [{ hp: 0, effect: 'e_ExplGas' }],
};
// Splash: material 99 against material 50, 1000 a hit, full modifier.
const materials = { 99: { damage: 1000 }, 50: {} };
const modifiers = { 99: { 50: 1 } };

/** `where`: [x, y, z]; `seaBed`: whether open water is under it (else land at
 *  y = 5); `body`: a body-world entry whose lowest vertex hangs `reach` m
 *  under its origin (a plane's wheels), or none (positions only). */
function run(template, where, { seaBed = true, body = null, by = 'round' } = {}) {
  const damage = new VehicleDamageSet();
  damage.add(1, { hitpoints: 100, maxHitpoints: 100, splashMaterial: 50,
                  effects: TIERS[template].map(e => ({ ...e, offset: [0, 0, 0] })) }, { name: template });
  const node = new THREE.Group();
  node.position.set(...where);
  node.updateMatrixWorld(true);
  const shown = [];
  const bodyWorld = body ? new Map([[1, {
    parked: { body: { pos: where } }, driven: null,
    parts: [{ shape: { layers: [{ vertices: new Float32Array([0, -body.reach, 0, 1, -body.reach, 0, 0, -body.reach, 1, 1, -body.reach, 1]) }] },
              worldVertex: (_l, i, out) => { out[0] = where[0]; out[1] = where[1] - body.reach; out[2] = where[2]; return out; } }],
  }]]) : null;
  if (bodyWorld) bodyWorld.entries = bodyWorld;
  const world = {
    players: new Map(), player: () => null, armorOf: () => null,
    collider: { waterLevel: 0, surfaceHeight: () => (seaBed ? 0 : 5) },
    positions: new Map([[1, where]]), isWrecked: () => false, bodyWorld,
    vehicleDamage: damage, report: { crashes: [], damage: [], timedDamage: [] },
  };
  const page = {
    LOCAL_PLAYER: 'local',
    vehicles: { firerOf: () => null, instanceOf: () => null },
    damageVisuals: new Map([[1, { node }]]),
    vehicleDamage: damage, world,
    bots: [], soldier: null, soldierArmor: null, soldierDead: false,
    optOnFoot: { checked: false }, optPilot: { checked: false },
    guns: { materials, modifiers },
    camera: { position: { toArray: () => [0, 0, 0] } },
    showDamageTier: (vehicle, tier) => shown.push(tier?.threshold ?? null),
    wreckVehicle: () => {},
  };
  const hits = createVehicleHits(page);
  if (by === 'round') {
    hits.applyVehicleHit({ kind: 'object', owner: 1, damage: 150, firerGroup: {} });
  } else if (by === 'bomb') {
    // A bomb landing beside it: no direct owner, its splash only.
    hits.applyVehicleHit({ kind: 'terrain', owner: -1, damage: 0, firerGroup: {},
                           splashRadius: 10, splashMaterial2: 99,
                           point: [where[0] + 2, where[1], where[2]] });
  } else if (by === 'crash') {
    onBodyDamage(world, 1, { damage: 150, kill: false }, where, null);
    damageTick(world, 1 / 30);
    for (const change of world.report.damage) if (change.changed) shown.push(change.tier?.threshold ?? null);
  }
  return shown;
}

const out = {};
for (const by of ['round', 'bomb', 'crash']) {
  out[by] = {
    elcoAfloat: run('Elco80', [0, -1.87, 0], { by }),
    elcoBeached: run('Elco80', [0, 6, 0], { seaBed: false, by }),
    shermanInRiver: run('Sherman', [0, -0.5, 0], { by }),
    shermanOnLand: run('Sherman', [0, 6, 0], { seaBed: false, by }),
    // A Sherman on a bridge over the sea: origin above the water, wheels 1 m
    // under its origin, the deck 6 m over the water.
    shermanOnBridge: run('Sherman', [0, 6, 0], { body: { reach: 1 }, by }),
    spitfireOverSea: run('Spitfire', [0, 200, 0], { body: { reach: 1.5 }, by }),
    spitfireDitched: run('Spitfire', [0, 0.8, 0], { body: { reach: 1.5 }, by }),
    destroyerAfloat: run('Hatsuzuki', [0, -3, 0], { by }),
  };
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
