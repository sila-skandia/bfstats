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
import { CAMERA_MODES, cameraModeFrom, isTank, kitFactions, mergeProbes, pickPosedPair, tabVehicles } from './controls-kits.js';
import { KNOCK, knockState, segmentHit, silhouetteTargets } from './proving-targets.js';
import { arsenalFactions, hitBand, hitsToDestroy, logRow, materialName, predictImpact, prettyName, standStations, weakestPart } from './proving-ground-page.js';

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
  stationGroups: report.controlPoints.filter(p => /^Range/.test(p.name)).map(p => p.spawnGroupId),
  silhouetteX: report.controlPoints.find(p => p.name === 'Silhouettes')?.position[0] ?? null,
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
out.urlVehicle = provingGroundUrl('../', { map: 'Wake', vehicle: 'Spitfire', soldiers: 2, base: 'http://x/play/index.html' });

// --- the arsenal ---------------------------------------------------------------------------------
const loadouts = {
  primaryItemIndex: 3,
  kits: {
    German_Scout: { nation: 'German', class: 'Scout', team: 1, primary: 'K98Sniper',
      items: ['K98Sniper', 'WalterP38', 'KnifeAxis', 'Binoculars'],
      weapons: [{ slot: 1, weapon: 'KnifeAxis' }, { slot: 2, weapon: 'WalterP38' }, { slot: 3, weapon: 'K98Sniper' }, { slot: 5, weapon: 'Binoculars' }],
      kitName: { text: 'SCOUT' }, maxHitpoints: 30 },
    German_AT: { nation: 'German', class: 'Anti-tank', team: 1, primary: 'Panzershreck',
      items: ['Panzershreck', 'WalterP38', 'KnifeAxis', 'GrenadeAxis', 'AmmoBundle'],
      weapons: [{ slot: 1, weapon: 'KnifeAxis' }, { slot: 2, weapon: 'WalterP38' }, { slot: 3, weapon: 'Panzershreck' }, { slot: 4, weapon: 'GrenadeAxis' }],
      kitName: { text: 'ANTI-TANK' }, maxHitpoints: 30 },
    GB_Assault: { class: 'Assault', team: 2, primary: 'RandomRifle',
      items: ['RandomRifle', 'Colt', 'KnifeAllies'],
      weapons: [{ slot: 1, weapon: 'KnifeAllies' }, { slot: 2, weapon: 'Colt' }, { slot: 3, weapon: 'Bar1918' }],
      random: [{ template: 'RandomRifle', variants: ['Bar1918', 'Sten'] }], kitName: { text: 'ASSAULT' } },
    Ghost: { class: 'Medic' },
  },
  levels: {
    aberdeen: {
      1: { soldier: 'GermanDesertSoldier', slots: { 2: 'German_AT', 0: 'German_Scout', 3: 'Missing' } },
      2: { soldier: 'BritishSoldier', slots: { 1: 'GB_Assault' } },
    },
    empty: { 1: { soldier: 'X', slots: {} } },
  },
};
out.factions = arsenalFactions(loadouts, 'aberdeen', team => (team === 2 ? 'brit' : null));
out.factionsUnknownLevel = arsenalFactions(loadouts, 'wake', () => 'us');
out.factionsEmpty = arsenalFactions(loadouts, 'empty', () => 'ger');
out.pretty = ['WalterP38', 'KnifeAxis', '3German_ATPanzerfaust100', 'PanzerIV', 'Panzershreck', 'T34-85', 'Willy'].map(prettyName);

// --- the hit log -----------------------------------------------------------------------------------
out.logRows = {
  hit: logRow({ flew: 54.2, time: 1.004, drop: 1.4, expired: false,
    hit: { what: 'Panzer IV', where: 'front armour', damage: 17.2, left: 82.8, max: 100, angle: 0.66, soldier: false } }, 'Panzershreck'),
  soldier: logRow({ flew: 120, time: 0.3, drop: 0.2, expired: false,
    hit: { what: 'soldier', where: 'head', damage: 30, soldier: true } }, 'K98'),
  dud: logRow({ flew: 120, time: 0.3, drop: 0.1, expired: false,
    hit: { what: 'Sherman', where: 'wheels', damage: 0, left: 100, max: 100, angle: 1, soldier: false } }, 'Colt'),
  floor: logRow({ flew: 54.2, time: 1.0, drop: 1.4, expired: false, hit: null }, '3German_ATPanzerfaust100'),
  fuse: logRow({ flew: 933, time: 1.3, drop: 0.0, expired: true, hit: null }, null),
  silhouette: logRow({ flew: 50, time: 0.06, drop: 0, expired: false,
    hit: { what: 'FUCKFACE', where: '50 m', damage: 1, silhouette: true } }, 'K98'),
  far: logRow({ flew: 1540, time: 12.4, drop: 240, expired: false, hit: null }, null),
};

// --- stations and the weakest part -------------------------------------------------------------------
out.stations = standStations();
out.stationsFarRows = standStations([400, 800]);
out.weakest = {
  rear: weakestPart([{ defense: 52, hits: 4 }, { defense: 50, hits: 1 }, { defense: 51, hits: 3 }]),
  none: weakestPart([{ defense: 52, hits: Infinity }, { defense: 50, hits: null }]),
  tie: weakestPart([{ defense: 51, hits: 2 }, { defense: 50, hits: 2 }]),
};

// --- the controls preview's kit bar ------------------------------------------------------------------
out.kitFactions = kitFactions([
  { template: 'US_Assault', nation: 'American', class: 'Assault', side: 'Allied', primary: 'Bar1918' },
  { template: 'German_AT_Desert', nation: 'German', theatre: 'Desert', class: 'Anti-tank', side: 'Axis', primary: 'Panzershreck' },
  { template: 'German_AT', nation: 'German', class: 'Anti-tank', team: 1, primary: 'Panzershreck' },
  { template: 'GB_Scout', nation: 'British', class: 'Scout', side: 'Allied' },
  { template: 'US_AT', nation: 'American', class: 'Anti-tank', side: 'Allied', primary: 'Bazooka' },
  { template: 'JP_Assault', nation: 'Japanese', class: 'Assault', side: 'Axis', primary: 'Type5' },
]);
const posedSet = new Set(['GermanSoldier|Panzershreck', 'GermanDesertSoldier|WalterP38']);
const posedFn = (s, w) => posedSet.has(`${s}|${w}`);
const atKit = { primary: 'Panzershreck', items: [{ template: 'Panzershreck' }, { template: 'WalterP38' }, { template: 'KnifeAxis' }] };
out.pickPosed = {
  primary: pickPosedPair({ ...atKit, soldiers: ['GermanSoldier', 'GermanDesertSoldier'] }, posedFn),
  fallback: pickPosedPair({ ...atKit, soldiers: ['GermanDesertSoldier'] }, posedFn),
  none: pickPosedPair({ ...atKit, soldiers: ['USSoldier'] }, posedFn),
};

// --- COMMON's probe and the camera keys ---------------------------------------------------------------
const probeOf = (axes, held) => ({ axis: t => axes[t] ?? 0, held: t => held.includes(t) });
const common = probeOf({}, ['c_PICameraMode3']);
const infantry = probeOf({ c_PIThrottle: 1 }, ['c_PICrouch']);
const merged = mergeProbes(common, infantry);
out.merged = { throttle: merged.axis('c_PIThrottle'), crouch: merged.held('c_PICrouch'),
               camera3: merged.held('c_PICameraMode3'), fire: merged.held('c_PIFire') };
out.cameraModes = CAMERA_MODES;
const step = (held, mode, was) => cameraModeFrom(probeOf({}, held), mode, was);
out.camera = {
  key: step(['c_PICameraMode1'], 'chaseRear', false),
  togglePress: step(['c_PIToggleCameraMode'], 'chaseRear', false),
  toggleHeld: step(['c_PIToggleCameraMode'], 'chaseFront', true),
  wraps: step(['c_PIToggleCameraMode'], 'flyBy', false),
  idle: step([], 'nonsense', false),
};

// --- the tanks ---------------------------------------------------------------------------------------
const rows = [
  { name: 'Sherman', category: 'land', parts: 32, weapons: ['Browning', 'Coaxial_browning', 'ShermanGunBarrel'], glb: 'Sherman.glb' },
  { name: 'Priest', category: 'land', parts: 27, weapons: ['PriestCannon'], glb: 'Priest.glb' },
  { name: 'Hanomag', category: 'land', parts: 23, weapons: ['MG42'], glb: 'Hanomag.glb' },
  { name: 'Willy', category: 'land', parts: 6, weapons: [], glb: 'Willy.glb' },
  { name: 'Pak40', category: 'land', parts: 6, weapons: ['Pak40Gun'], glb: 'Pak40.glb' },
  { name: 'Defgun', category: 'land', parts: 4, weapons: ['DefgunGunBarrel'], glb: 'Defgun.glb' },
  { name: 'RadarTower', category: 'land', parts: 7, weapons: ['Radar_AA_Allies_GunBarrel'], glb: 'RadarTower.glb' },
  { name: 'Katyusha', category: 'land', parts: 9, weapons: ['KatyushaFireArmsBundle'], glb: 'Katyusha.glb' },
  { name: 'Big_Radar_Cannon', category: 'land', parts: 40, weapons: ['BigCannon'], glb: 'x.glb' },
  { name: 'PrinceOW', category: 'sea', parts: 80, weapons: ['PrinceOWGunBarrel'], glb: 'PrinceOW.glb' },
  { name: 'AA_Allies', category: 'emplacement', parts: 5, weapons: ['AA_Allies_GunBarrel'], glb: 'AA.glb' },
  { name: 'Spitfire', category: 'air', parts: 20, weapons: ['SpitfireGuns'], glb: 'Spitfire.glb' },
  { name: 'B17', category: 'air', parts: 30, weapons: [], glb: 'B17.glb' },
];
out.tanks = Object.fromEntries(rows.map(r => [r.name, isTank(r)]));
out.tabLand = tabVehicles(rows, 'landSea').map(v => v.name);
out.tabAir = tabVehicles(rows, 'air').map(v => v.name);

// --- the silhouettes -------------------------------------------------------------------------------------
out.silhouettes = silhouetteTargets();
const man = out.silhouettes[3];   // TOTO at 100 m, z -420
out.segment = {
  through: segmentHit([1114, 41.6, -419], [1114, 41.4, -421], man, 40),
  wide: segmentHit([1114.6, 41.5, -419], [1114.6, 41.5, -421], man, 40),
  over: segmentHit([1114, 42.5, -419], [1114, 42.5, -421], man, 40),
  short: segmentHit([1114, 41.5, -418], [1114, 41.5, -419.5], man, 40),
  underPost: segmentHit([1114, 40.2, -419], [1114, 40.2, -421], man, 40),
};
out.knock = {
  falling: knockState(KNOCK.fall / 2), down: knockState(KNOCK.fall + 1),
  rising: knockState(KNOCK.fall + KNOCK.down + KNOCK.rise / 2),
  standing: knockState(KNOCK.fall + KNOCK.down + KNOCK.rise + 0.01), never: knockState(null),
};

process.stdout.write(JSON.stringify(out));
