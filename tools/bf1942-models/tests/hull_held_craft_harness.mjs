// `viewer/spawned-craft.js` `hullHeldCraftUnder`: what a land or air hull's
// own spawner holds is an object of its own, held on the hull (AI-121,
// SPAWN-30), with its own seats. BF1918's Kolossal carries its MG platform
// and commander that way, the Zeppelin its two gondola gunners. A synthetic
// level first, then the real glbs when the asset tree is there.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const here = path.dirname(new URL(import.meta.url).pathname);
const imp = rel => import(pathToFileURL(path.join(here, '..', rel)).href);
const [THREE, craftMod, { surveyVehicle }, { readGlb }, { buildSceneTree }] = await Promise.all([
  imp('viewer/vendor/three.module.js'), imp('viewer/spawned-craft.js'), imp('viewer/seat-survey.js'),
  imp('server/glb-tree.mjs'), imp('server/glb-scene.mjs'),
]);
const { detachSpawnedCraft, spawnHoldOf, hullHeldActive, hullHeldCraftUnder } = craftMod;

const node = (name, userData = {}, children = [], at = [0, 0, 0]) => {
  const obj = new THREE.Group();
  obj.name = name; obj.userData = userData; obj.position.set(...at);
  for (const child of children) obj.add(child);
  return obj;
};
const pco = (control, extra = {}) => ({ templateKind: 'PlayerControlObject', control, ...extra });
const door = owner => node(`${owner}Entry`, { templateKind: 'EntryPoint', control: owner });
const held = (mass, category = 'VCLand') => ({
  physics: { mass, vehicleCategory: category },
  heldSpawner: { holdObject: true, spawnOffset: [0, 0, 0], team: 1 },
});

function level() {
  // A land hull with a driver's door and a held platform of two seats.
  const platform = node('Platform', pco('Platform', held(60000)), [
    node('PlatformComplex', { control: 'Platform' }, [
      node('PlatformMg1', pco('PlatformMg1'), [door('PlatformMg1')], [-2, 1, 2]),
      node('PlatformMg2', pco('PlatformMg2'), [door('PlatformMg2')], [2, 1, 2]),
    ]),
  ], [0, 0.5, 3]);
  // A held object with no door (FHSW's attitude indicator, mass 1).
  const ball = node('Indicator', pco('Indicator', held(1)), [], [0, 100, 0]);
  // A car its spawner stands without a hold (the armoured train's), and the
  // coupler a spawner holds on the hull, which has no door.
  const car = node('Car', pco('Car', { physics: { mass: 50000, vehicleCategory: 'VCLand' },
    heldSpawner: { spawner: 'CarSpawner', team: 1, maxNrOfObjectSpawned: 1 } }), [door('Car')], [0, 0, -13.2]);
  const coupler = node('Coupler', pco('Coupler', held(200000, undefined)), [], [0, 0, 3.66]);
  const tank = node('Tank', pco('Tank', { physics: { mass: 60000, vehicleCategory: 'VCLand' } }), [
    node('TankComplex', { control: 'Tank' }, [door('Tank'), platform, ball]), car, coupler,
  ], [100, 50, -200]);
  tank.rotation.y = Math.PI / 2;
  // A ship's held jeep: left baked (no land drive stands on a moving deck).
  const jeep = node('Jeep', pco('Jeep', held(2500)), [door('Jeep')], [0, 3, 10]);
  const boat = node('Boat', pco('Boat', held(30000, 'VCSea')), [door('Boat')], [5, 3, 0]);
  const ship = node('Ship', pco('Ship', { physics: { mass: 1e6, vehicleCategory: 'VCSea' } }), [jeep, boat],
    [500, 0, 500]);
  // An air hull's held gunner (the Zeppelin's `ZeppelinL30GunnerZusatz`).
  const gunner = node('Gunner', pco('Gunner', held(5000)), [
    node('GunnerSeat', pco('GunnerSeat'), [door('GunnerSeat')]),
  ], [1.3, -1.6, -67]);
  const airship = node('Airship', pco('Airship', { physics: { mass: 16000, vehicleCategory: 'VCAir' } }),
    [door('Airship'), gunner], [-300, 150, 0]);
  const spawners = node('spawners', { kind: 'spawners' }, [tank, ship, airship]);
  const root = node('level', {}, [spawners]);
  root.updateMatrixWorld(true);
  return { root, spawners, tank, platform, ball, car, coupler, ship, jeep, boat, airship, gunner };
}

const L = level();
const before = L.platform.getWorldPosition(new THREE.Vector3()).toArray().map(n => +n.toFixed(3));
const moved = detachSpawnedCraft(L.root);
const after = L.platform.getWorldPosition(new THREE.Vector3()).toArray().map(n => +n.toFixed(3));
const hold = spawnHoldOf(L.platform);
// The hold's pose, the hull turned and moved: the platform rides it.
L.tank.position.set(140, 52, -180);
L.tank.rotation.y = 0;
L.tank.updateMatrixWorld(true);
const rides = new THREE.Vector3().setFromMatrixPosition(
  new THREE.Matrix4().multiplyMatrices(L.tank.matrixWorld, hold.local)).toArray().map(n => +n.toFixed(3));
const activeWith = up => hullHeldActive(L.platform, host => (host === L.tank ? up : true));
const synthetic = {
  moved: moved.map(o => o.name).sort(),
  parent: { platform: L.platform.parent.name, gunner: L.gunner.parent.name, ball: L.ball.parent.parent.name,
            jeep: L.jeep.parent.name, car: L.car.parent.name, coupler: L.coupler.parent.name },
  stood: { platform: !!hold.stood, car: !!spawnHoldOf(L.car)?.stood, carHost: spawnHoldOf(L.car)?.host.name },
  hostOf: { platform: hold.host.name, gunner: spawnHoldOf(L.gunner)?.host.name },
  onHull: !!hold.onHull, released: hold.released,
  before, after, rides,
  hullSeats: surveyVehicle(L.tank).order,
  platformSeats: surveyVehicle(L.platform).order,
  platformDoors: surveyVehicle(L.platform).order.map(id => surveyVehicle(L.platform).seats.get(id).entryPoints.length),
  active: { up: activeWith(true), down: activeWith(false) },
  activeLetGo: (() => { hold.released = true; const v = activeWith(false); hold.released = false; return v; })(),
  notHeld: hullHeldActive(L.tank, () => true),
};

// The real glbs, read as the level's spawners children.
const assets = process.argv[2] ?? viewer;
function realHull(file) {
  const p = path.join(assets, 'models', 'mods', file);
  if (!fs.existsSync(p)) return null;
  const { json, bin } = readGlb(p);
  const { root: scene } = buildSceneTree(json, bin);
  const hull = scene.children.length === 1 ? scene.children[0] : scene;
  const spawners = node('spawners', { kind: 'spawners' }, [hull]);
  const root = node('level', {}, [spawners]);
  root.updateMatrixWorld(true);
  const rowBefore = surveyVehicle(hull).order.length;
  const craft = hullHeldCraftUnder(hull).map(o => o.name);
  const split = detachSpawnedCraft(root);
  return {
    craft, rowBefore,
    hullSeats: surveyVehicle(hull).order.length,
    split: split.map(o => ({
      name: o.name, host: spawnHoldOf(o)?.host === hull,
      seats: surveyVehicle(o).order.filter(id => surveyVehicle(o).seats.get(id).entryPoints.length),
    })),
  };
}
const real = {
  kolossal: realHull('bf1918/Kolossal.glb'),
  zeppelin: realHull('bf1918/ZeppelinL30.glb'),
  b29: realHull('fhsw/B29.glb'),
  train: realHull('bf1918/ArmouredTrain_GILI.glb'),
};

process.stdout.write(JSON.stringify({ synthetic, real }));
