// The proving ground's pure parts under node (features/proving-ground): the
// battle's vehicle list, where each vehicle parks, the report the level load
// reads, the floor the collider snaps to, the landing point's arithmetic, the
// hit bands, the material names and the front end's catalogue and address.
// Prints one JSON blob for `test_proving_ground.py`.

import * as THREE from 'three';
import {
  PG, battleTemplates, buildProvingGroundScene, catalogueTemplates, drawsMesh, floorTiles, provingGroundLayout, provingGroundReport,
  provingGroundUrl, vehicleClass, vehiclesByLevel,
} from './proving-ground.js';
import { hitBand, hitsToDestroy, materialName, predictImpact } from './proving-ground-page.js';

const out = {};

// --- the battle's vehicles ---------------------------------------------------
const battle = {
  level: 'Aberdeen',
  objectSpawns: [
    { vehicle: 'panzeriv', templates: { 1: 'PanzerIV', 2: 'Sherman' } },
    { vehicle: 'panzeriv', templates: { 1: 'panzeriv', 2: 'sherman' } },
    { vehicle: 'Willy' },
  ],
  modes: { CoOp: { objectSpawns: [{ templates: { 1: 'BF109', 2: 'Spitfire' } }] } },
  sounds: { ambient: { file: 'wind.mp3', volume: 1.4 }, areas: [{ name: 'x' }], vehicles: [{ template: 'panzeriv' }] },
  damage: { path: '../_shared/damage.json' },
  materialDiffuse: { a: 1 },
  heightmap: { image: 'terrain/heightmap.png' },
  sky: { mesh: 'Sky' },
};
out.templates = battleTemplates(battle);

out.fromCatalogue = catalogueTemplates([
  { name: 'Corsair', category: 'air', levels: ['Coral_sea'] },
  { name: 'Enterprise', category: 'sea', levels: ['Coral_sea'] },
  { name: 'AA_Allies', category: 'emplacement', levels: ['coral_sea'] },
  { name: 'USMarineSoldier', category: 'soldier', levels: ['Coral_sea'] },
  { name: 'Sherman', category: 'land', levels: ['El_Alamein'] },
], 'Coral_Sea');

// --- vehicle classes -----------------------------------------------------------
out.classes = {
  air: vehicleClass({ userData: { physics: { vehicleCategory: 'VCAir' } } }),
  sea: vehicleClass({ userData: { physics: { vehicleCategory: 'VCSea' } } }),
  land: vehicleClass({ userData: { physics: { vehicleCategory: 'VCLand' } } }),
  gun: vehicleClass({ userData: { physics: {} } }),
};

// --- what draws ------------------------------------------------------------------
{
  const tank = new THREE.Group();
  tank.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  const logic = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  hull.geometry.userData.collision = true;
  logic.add(hull);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  flash.userData.effect = true;
  logic.add(flash);
  out.draws = { tank: drawsMesh(tank), logic: drawsMesh(logic), empty: drawsMesh(new THREE.Group()) };
}

// --- layout ----------------------------------------------------------------------
const vehicles = [
  { template: 'PanzerIV', cls: 'land', width: 3 },
  { template: 'Sherman', cls: 'land', width: 3 },
  { template: 'Willy', cls: 'land', width: 2 },
  { template: 'BF109', cls: 'air', width: 10 },
  { template: 'Enterprise', cls: 'sea', width: 30 },
];
const placed = provingGroundLayout(vehicles, { team: 2 });
out.layout = placed;

// --- report ------------------------------------------------------------------------
const report = provingGroundReport(battle, placed, { team: 2 });
out.report = {
  level: report.level,
  worldSize: report.worldSize,
  heightmap: report.heightmap,
  sky: report.sky,
  damage: report.damage,
  materialDiffuse: report.materialDiffuse,
  points: report.controlPoints.map(p => ({ name: p.name, team: p.team, locked: p.unableToChangeTeam, z: p.position[2] })),
  soldierTeams: [...new Set(report.soldierSpawns.map(s => s.team))],
  firingLineSpawns: report.soldierSpawns.filter(s => s.team === 2).length,
  farEndSpawns: report.soldierSpawns.filter(s => s.team === 1).length,
  spawns: report.objectSpawns.map(s => ({
    vehicle: s.vehicle, team: s.team, templates: s.templates, ttl: s.timeToLive, distance: s.distance,
    lost: s.damageWhenLost, delay: [s.minSpawnDelay, s.maxSpawnDelay], role: s.spawner.split('_')[1],
  })),
  tickets: report.tickets,
  sounds: report.sounds,
  provingGround: report.provingGround,
};

// --- the floor -----------------------------------------------------------------------
const tiles = floorTiles(new THREE.MeshBasicMaterial());
const ys = new Set();
let onLattice = true;
for (const tile of tiles) {
  const pos = tile.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    ys.add(pos.getY(i));
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (Math.abs(x / PG.SPACING - Math.round(x / PG.SPACING)) > 1e-6
        || Math.abs(z / PG.SPACING - Math.round(z / PG.SPACING)) > 1e-6) onLattice = false;
  }
}
const box = new THREE.Box3();
for (const tile of tiles) box.union(tile.geometry.boundingBox);
out.floor = {
  tiles: tiles.length, heights: [...ys], onLattice,
  kinds: [...new Set(tiles.map(t => t.userData.kind))],
  unlit: tiles.every(t => t.userData.unlitTerrain === true),
  min: box.min.toArray(), max: box.max.toArray(),
};

// --- the scene -------------------------------------------------------------------------
const mould = name => {
  const node = new THREE.Group();
  node.name = name;
  node.userData = { physics: { vehicleCategory: 'VCLand' }, armor: { hitpoints: 100 }, control: name };
  node.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 6), new THREE.MeshBasicMaterial()));
  return node;
};
const models = new Map([['panzeriv', mould('PanzerIV')], ['sherman', mould('Sherman')], ['willy', mould('Willy')]]);
const { scene, animations } = buildProvingGroundScene(placed, models);
const spawners = scene.children.find(c => c.userData.kind === 'spawners');
const garagePanzer = spawners.children.find(c => c.userData.provingGround === 'garage' && c.userData.control === 'PanzerIV');
const targetPanzer = spawners.children.find(c => c.userData.provingGround === 'target' && c.userData.control === 'PanzerIV');
const fwd = node => new THREE.Vector3(0, 0, -1).applyQuaternion(node.quaternion).toArray().map(v => Math.round(v * 1000) / 1000);
out.scene = {
  animations: animations.length,
  roots: scene.children.map(c => c.userData.kind ?? c.name.slice(0, 2)),
  spawners: spawners.children.length,
  names: spawners.children.map(c => c.name),
  garageFacing: fwd(garagePanzer),
  targetFacing: fwd(targetPanzer),
  garageAt: garagePanzer.position.toArray(),
  // Every placement has a node standing where its pad says.
  padsMatched: report.objectSpawns.filter(s => s.vehicle !== 'BF109').every(s => spawners.children.some(c =>
    c.userData.control === s.vehicle && Math.hypot(c.position.x - s.position[0], c.position.z - s.position[2]) < 1e-6)),
};

// --- the landing point ----------------------------------------------------------------
const flat = () => 40;
const g = -9.81;
// A level shot from 1.6 m, 100 m/s: falls 1.6 m in sqrt(2 * 1.6 / 9.81) s.
out.levelShot = predictImpact([0, 41.6, 0], [0, 0, -1], 100, g, 10, flat);
// 45 degrees from the floor at 50 m/s: range v^2 / g.
const d45 = Math.SQRT1_2;
out.lob = predictImpact([0, 40.0001, 0], [0, d45, -d45], 50, g, 30, flat);
// A short fuse ends the flight in the air.
out.fuse = predictImpact([0, 41.6, 0], [0, 0.2, -0.98], 60, g, 0.5, flat);
out.noSpeed = predictImpact([0, 41.6, 0], [0, 0, -1], 0, g, 10, flat);

// --- hits, bands, names --------------------------------------------------------------------
out.hits = {
  rear: hitsToDestroy(100, 100),
  side: hitsToDestroy(100, 35),
  front: hitsToDestroy(100, 26),
  exact: hitsToDestroy(100, 25),
  none: hitsToDestroy(100, 0),
  absent: hitsToDestroy(100, null),
};
out.bands = [1, 2, 3, 4, 5, 9, 10, 40, Infinity].map(n => hitBand(n)?.label ?? null);
out.names = {
  labelled: materialName(226, { 226: { label: 'Bazookas' } }),
  rear: materialName(50), side: materialName(51), front: materialName(52),
  soldier: materialName(41), light: materialName(45), naval: materialName(57), air: materialName(61),
  other: materialName(178),
};

// --- the front end ------------------------------------------------------------------------------
const catalogue = vehiclesByLevel([
  { name: 'Spitfire', category: 'air', levels: ['Battle_of_Britain', 'Coral_sea'] },
  { name: 'Sherman', category: 'land', levels: ['El_Alamein'] },
  { name: 'Colt', category: 'handweapon', levels: ['El_Alamein'] },
  { name: 'USSoldier', category: 'soldier', levels: ['El_Alamein'] },
]);
out.catalogue = Object.fromEntries([...catalogue].map(([k, v]) => [k, v]));
out.url = provingGroundUrl('../', { map: 'Kursk', team: 2, soldiers: 8, mod: 'fhsw', base: 'http://x/play/index.html' });
out.urlVanilla = provingGroundUrl('../', { map: 'Wake', base: 'http://x/play/index.html' });

process.stdout.write(JSON.stringify(out));
