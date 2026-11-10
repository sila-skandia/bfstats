// The tank school's pure modules (features/battle-schools, "The tank
// school's own page"), run in node for `test_tank_school.py`:
//
// - `viewer/tank-ballistics.js`: drop, elevation, reach and lead for the
//   three vanilla shell families;
// - `viewer/tank-arena.js`: tanks and arenas out of a small catalogue;
// - `viewer/tank-armour.js`: a box hull with a front, side and rear plate of
//   its own, priced by a small damage table, cast from each bearing;
// - `viewer/tank-words.js`: the words for a pairing built from those numbers;
// - `tests/fixtures/tank-school-bf1942.json`: vanilla's tank sheet, pinned;
// - `viewer/tank-launchers.js` and `tank-sight-view.js` (its pure helpers):
//   a side's anti-tank weapons out of a small loadouts table, a launcher's
//   round and spread out of a glb's JSON, and the rig a soldier holds it with.
//
// Prints one JSON object.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewer = join(here, '..', 'viewer');
installModuleHooks(viewer);
const load = rel => import(pathToFileURL(join(viewer, rel)).href);
const THREE = await load('vendor/three.module.js');
const B = await load('tank-ballistics.js');
const A = await load('tank-arena.js');
const R = await load('tank-armour.js');
const W = await load('tank-words.js');
const L = await load('tank-launchers.js');
const V = await load('tank-sight-view.js');
const D = await load('tank-doctrine-1918.js');
const Duel = await load('tank-duel.js');
const Det = await load('tank-fights-detect.js');

const out = {};
const r1 = v => Math.round(v * 10) / 10;

// --- ballistics ---------------------------------------------------------------
const guns = {
  sherman: B.gunOf({ velocity: 100, projectile: {} }),
  panzer: B.gunOf({ velocity: 100, projectile: { gravity: 0.5 } }),
  chiha: B.gunOf({ velocity: 80, projectile: { gravity: 0.5 } }),
};
out.ballistics = Object.fromEntries(Object.entries(guns).map(([k, g]) => [k, {
  gravity: g.gravity,
  drop: [100, 200, 300, 400].map(r => r1(B.dropAt(g, r))),
  elevation: [100, 200, 300, 400].map(r => r1(B.elevationFor(g, r, { maxElevation: 45 }))),
  reach: Math.round(B.reach(g, 20).range),
  per100: B.degreesPer100(g),
  flight200: Math.round(B.timeTo(g, 200) * 100) / 100,
}]));
out.moving = {
  leadAtTopSpeed: r1(B.leadAngle(guns.sherman, 0, 14.7)),
  sideBySide: B.leadAngle(guns.sherman, 10, 10),
  crossingTiger: r1(B.leadAngle(guns.sherman, 13, 0)),
  driftAt200: r1(B.at(guns.sherman, 200, 0, { across: 14.7 }).z),
  dropDrivingAt: r1(B.dropAt(guns.sherman, 200, { along: 14.7 })),
};
out.outOfReach = B.elevationFor(guns.sherman, 600);
// A round with no gravity (a mod's missile) flies straight: no drop, no aim-off.
const straight = B.gunOf({ velocity: 100, projectile: { gravity: 0 } });
out.straight = { flat: B.flatShooter(straight), e200: B.elevationFor(straight, 200), drop200: B.dropAt(straight, 200), reach: B.reach(straight).range };

// --- arenas ---------------------------------------------------------------------
const row = (name, side, levels, hp, weapons) => ({ name, category: 'land', sides: [side], levels, hitpoints: hp, weapons });
const rows = [
  row('Sherman', 'Allied', ['El_Alamein', 'Gazala', 'Iwo_Jima'], 100, ['Browning', 'ShermanGunBarrel']),
  row('Tiger', 'Axis', ['El_Alamein', 'Gazala', 'Kursk'], 125, ['TigerGunBarrel']),
  row('PanzerIV', 'Axis', ['El_Alamein', 'Gazala', 'Kursk'], 100, ['PanzerIVGunBarrel']),
  row('T34', 'Allied', ['Kursk'], 100, ['T34GunBarrel']),
  row('Chi-ha', 'Axis', ['Iwo_Jima'], 100, ['Chi-ha_GunBarrel']),
  row('Willy', 'Allied', ['El_Alamein'], 50, []),
  row('Hanomag', 'Axis', ['El_Alamein'], 100, ['MG42']),
  row('Priest', 'Allied', ['El_Alamein'], 50, ['PriestCannon']),
  row('AA_Allies', 'Allied', ['El_Alamein'], 100, ['AA_Allies_GunBarrel']),
  row('RadarTower', 'Allied', ['Battle_of_Britain'], 600, ['Radar_AA_Allies_GunBarrel']),
  { name: 'Captured', category: 'land', sides: ['Allied', 'Axis'], levels: ['Kursk'], hitpoints: 100, weapons: ['CapturedGunBarrel'] },
  { name: 'Spitfire', category: 'air', sides: ['Allied'], levels: ['El_Alamein'], hitpoints: 100, weapons: ['Spit_Cannon'] },
];
out.tanks = rows.filter(A.isTank).map(r => r.name);
const arenas = A.arenasFrom(rows, ['El_Alamein', 'Gazala', 'Kursk', 'Iwo_Jima']);
out.arenas = arenas.map(a => ({ map: a.map, name: a.name, battles: a.battles, allied: a.allied.map(t => t.template), axis: a.axis.map(t => t.template) }));
const west = arenas.find(a => a.map === 'El_Alamein');
out.picks = {
  yoursDefault: A.tankIn(west, null).template,
  yoursChosen: A.tankIn(west, 'Tiger').template,
  theirsDefault: A.enemyOf(west, A.tankIn(west, null)).template,
  theirsForAxis: A.enemyOf(west, A.tankIn(west, 'PanzerIV')).template,
};
out.names = ['PanzerIV', 'T34-85', 'Chi-ha', 'KingTiger'].map(A.prettyTank);
out.every = (() => { const e = arenas.find(a => a.every); return e && { map: e.map, tanks: e.tanks.map(t => t.template) }; })();
// The game's AI data decides when it is there: equipment 0 with a weapon
// rated against armour. A gun half-track (equipment 0, machine guns only)
// and an artillery battery are out; a mod tank named oddly is in.
const ai = {
  Sherman: { class: 'Land', equipmentType: 0, aiWeapons: { ShermanMainGun: { strength: { HeavyArmour: 2 } } } },
  MGTrack: { class: 'Land', equipmentType: 0, aiWeapons: { MG: { strength: { HeavyArmour: 0 } } } },
  Battery: { class: 'Land', equipmentType: 13, aiWeapons: { Howitzer: { strength: { HeavyArmour: 5 } } } },
  OddTank: { class: 'Land', equipmentType: 0, fireArms: { OddTankBarrelThing: 'OddTankMainGun' },
    seatsAi: { OddTank: { aiWeapons: { OddTankMainGun: { strength: { HeavyArmour: 6 } } } } } },
  // A table that names its rows (EoD's): row 18 is AmphibiousTank, 16
  // AmphibiousCar; the name decides, not the number.
  PT76: { class: 'Land', equipmentType: 18, equipment: 'AmphibiousTank', aiWeapons: { PT76MainGun: { strength: { HeavyArmour: 5 } } } },
  'BMP-1': { class: 'Land', equipmentType: 16, equipment: 'AmphibiousCar', aiWeapons: { BMPMainGun: { strength: { HeavyArmour: 8 } } } },
  T54: { class: 'Land', equipmentType: 0, equipment: 'Tank', aiWeapons: { T54MainGun: { strength: { HeavyArmour: 9 } } } },
};
const aiRows = [row('Sherman', 'Allied', ['El_Alamein'], 100, ['ShermanGunBarrel']), row('MGTrack', 'Axis', ['El_Alamein'], 150, ['MGTrackGunBarrel']),
  row('Battery', 'Axis', ['El_Alamein'], 100, ['BatteryCannon']), row('OddTank', 'Axis', ['El_Alamein'], 250, ['OddTankBarrelThing']),
  // Not in the AI data: the catalogue's rule, less what the name says.
  row('Kingtiger', 'Axis', ['El_Alamein'], 160, ['KTGunBarrel']), row('M36', 'Allied', ['El_Alamein'], 130, ['M36GunBarrelAP', 'M36GunBarrelHE']),
  row('Pak43_41Mobile_towedgun', 'Axis', ['El_Alamein'], 100, ['Pak43_41GunBarrelAP']), row('HowitzerBattery3', 'Allied', ['El_Alamein'], 200, ['HowitzerBatteryCannon']),
  row('SdKfz251/1', 'Axis', ['El_Alamein'], 120, ['SdKfz251/1GunBarrel']),
  row('PT76', 'Axis', ['El_Alamein'], 100, ['PT76GunBarrel']), row('BMP-1', 'Axis', ['El_Alamein'], 100, ['BMP1GunBarrel']),
  // The hull's own name with `Gun` on it is its gun (EoD's T-54); a towed
  // anti-tank gun so named is not a tank (FH's pak38, no AI record).
  row('T54', 'Axis', ['El_Alamein'], 105, ['Coaxial_PK', 'DSHK', 'T54Gun']), row('pak38', 'Axis', ['El_Alamein'], 100, ['pak38Gun'])];
// BF1918 splits its tank row by weight (`HeavyTank` row 0, `LightTank` row
// 1); its armoured carrier is an `UnarmedTank`. A side is the level's own
// (`levelSides`): the A7V is team 1's on one level and both teams' on
// another, the Mark IV team 2's, so the tree-wide `sides` (both) pair
// nothing while each level pairs its own.
const wwiAi = {
  A7V: { class: 'Land', equipmentType: 0, equipment: 'HeavyTank', aiWeapons: { A7VMainGun: { strength: { HeavyArmour: 7 } } } },
  FT17: { class: 'Land', equipmentType: 1, equipment: 'LightTank', aiWeapons: { FT17MainGun: { strength: { HeavyArmour: 4 } } } },
  Mark4: { class: 'Land', equipmentType: 0, equipment: 'HeavyTank', aiWeapons: { Mark4MainGun: { strength: { HeavyArmour: 7 } } } },
  MarkISupply: { class: 'Land', equipmentType: 2, equipment: 'UnarmedTank', aiWeapons: { X: { strength: { HeavyArmour: 3 } } } },
};
const wwi = (name, levelSides, weapons) => ({ name, category: 'land', sides: [...new Set(Object.values(levelSides).flat())].sort(),
  levels: Object.keys(levelSides), levelSides, hitpoints: 150, weapons });
const wwiRows = [
  wwi('A7V', { hindenburg_line: ['Axis'], carriere: ['Allied', 'Axis'], bocage: ['Axis'] }, ['A7VGunBarrel']),
  wwi('Mark4', { hindenburg_line: ['Allied'], carriere: ['Allied'] }, ['Mark4GunBarrel']),
  wwi('FT17', { bocage: ['Allied'] }, ['FT17GunBarrel']),
  wwi('MarkISupply', { hindenburg_line: ['Allied'] }, ['MarkIGunBarrel']),
];
out.wwiTanks = wwiRows.filter(r => A.isTank(r, wwiAi)).map(r => r.name);
out.wwiArenas = A.arenasFrom(wwiRows, null, wwiAi).filter(a => !a.every)
  .map(a => ({ map: a.map, allied: a.allied.map(t => t.template), axis: a.axis.map(t => t.template) }));
out.sidesOn = { own: A.sidesOn(wwiRows[0], 'carriere'), fallback: A.sidesOn(rows[0], 'El_Alamein') };
out.m36Gun = A.mainGunName(aiRows[5], ai);
out.aiTanks = aiRows.filter(r => A.isTank(r, ai)).map(r => r.name);
out.aiGun = A.mainGunName(aiRows[3], ai);
const fa = (name, template, material, velocity) => ({ name, userData: { fireArms: { velocity, projectile: { kind: 'shell', template, material } } } });
out.pick = {
  fakeThenAP: A.pickMainGun([fa('VGunBarrel', 'ChangeAmmo_FakeProjectile', 210, 465), fa('VGunBarrel_Canister', 'Canister', 656, 450), fa('VGunBarrel_AP', '57mmAP', 692, 465)], 'VGunBarrel')?.name,
  named: A.pickMainGun([fa('ShermanGunBarrel', 'ShermanProjectile', 236, 100)], 'ShermanGunBarrel')?.name,
  none: A.pickMainGun([fa('X', 'ChangeAmmo_FakeProjectile', 210, 1)], 'X'),
  autocannon: A.pickMainGun([{ name: 'ShilkaGunBarrel', userData: { fireArms: { velocity: 900, projectile: { kind: 'bullet', template: '23mm', material: 501 } } } }], 'ShilkaGunBarrel')?.name,
};

// --- armour: a box hull, 6 m long, 3 m wide, 2 m tall ---------------------------
// Front plate material 52, sides 51, rear 50, roof 51; and a gun barrel of 46
// standing out of the front. The table: a shell of material 236 does 10 x
// 4 / 5 / 10 to 52 / 51 / 50, nothing to 46 (no cell).
function plate(w, h, material, pos, rotY = 0, rotX = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  g.userData = { collision: true, defenseMaterial: material };
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set(...pos);
  m.rotation.set(rotX, rotY, 0);
  return m;
}
const hull = new THREE.Group();
hull.add(plate(3, 2, 52, [0, 0, -3], Math.PI));        // front (faces -z)
hull.add(plate(3, 2, 50, [0, 0, 3]));                  // rear (faces +z)
hull.add(plate(6, 2, 51, [1.5, 0, 0], Math.PI / 2));   // right
hull.add(plate(6, 2, 51, [-1.5, 0, 0], -Math.PI / 2)); // left
hull.add(plate(3, 6, 51, [0, 1, 0], 0, -Math.PI / 2)); // roof
const tables = {
  materials: { 236: { damage: 10, attGroup: 236, defGroup: 236 }, 50: { defGroup: 50 }, 51: { defGroup: 51 }, 52: { defGroup: 52 }, 46: { defGroup: 46 } },
  modifiers: { 236: { 50: 10, 51: 5, 52: 4 } },
};
const price = R.pricer(tables, 236);
out.prices = { front: price(52), side: price(51), rear: price(50), nothing: price(46) };
out.bands = [1, 2, 3, 4, 5, 6, 13, null].map(s => R.bandOf(s).id);
const rose = R.bearingShots(hull, price, 100, { bearings: [0, 45, 90, 180], step: 0.1 });
out.rose = Object.fromEntries(Object.entries(rose).map(([b, v]) => [b, { mean: v.mean, max: v.max, shots: v.shots, bestShots: v.bestShots }]));
out.roseAbove = R.bearingShots(hull, price, 100, { bearings: [0], elevation: 60, step: 0.1 })[0];
// The aimed reading: hits on a plate the gun gets through, and how much of
// the side those plates cover. With the front plate made proof, nothing gets
// through head-on; from 45 degrees only the side plate does.
const proofFront = def => (def === 52 ? 0 : price(def));
out.aimed = Object.fromEntries(Object.entries(R.bearingShots(hull, proofFront, 100, { bearings: [0, 45, 90], step: 0.1 }))
  .map(([b, v]) => [b, { hurtShots: v.share > 0 ? v.hurtShots : null, share: v.share, shots: v.shots }]));
out.faceTable = R.faceTable(hull, price, 100).map(f => [f.material, f.damage, f.shots]);

// --- words ------------------------------------------------------------------------
const tank = (name, reload, traverse, per100, shots, sheet = null) => ({ name, gun: { reload, traverse, per100 }, shots, sheet });
const S = (f, s, r, best = f) => ({ 0: { shots: f, bestShots: best }, 90: { shots: s, bestShots: s }, 180: { shots: r, bestShots: r } });
const sheet = JSON.parse(readFileSync(join(here, 'fixtures', 'tank-school-bf1942.json'), 'utf8'));
const sherman = tank('Sherman', 2.87, 35, 4, S(3, 2, 1, 1), sheet.tanks.Sherman);
const tiger = tank('Tiger', 4, 20, 4, S(10, 4, 4, 3), sheet.tanks.Tiger);
const panzer = tank('Panzer IV', 2.87, 35, 2, S(3, 3, 2), sheet.tanks.PanzerIV);
const ghost = tank('Ghost', 2.87, 35, 4, { 0: { shots: null }, 90: { shots: null }, 180: { shots: null } });
const scratch = tank('Scratch', 2.87, 35, 4, S(1714, 4, null));
out.words = {
  cannot: W.matchupWords(sherman, ghost),
  cannotEither: W.matchupWords(ghost, ghost),
  noAnswer: W.matchupWords(sherman, scratch),
  thinFront: W.matchupWords(sherman, tank('Thin', 3, 30, 4, { 0: { shots: 3, bestShots: 3, share: 0.26 }, 90: { shots: 3, bestShots: 3, share: 0.24 }, 180: { shots: 3, bestShots: 3, share: 0.5 } })),
  straightVsSherman: W.matchupWords(tank('Missile', 3, 30, 0, S(3, 2, 2)), sherman),
  scratchedBoth: W.matchupWords(tank('A', 3, 30, 4, S(40, 50, 60)), tank('B', 3, 30, 4, S(35, 45, 31))),
  shermanTiger: W.matchupWords(sherman, tiger),
  tigerSherman: W.matchupWords(tiger, sherman),
  shermanPanzer: W.matchupWords(sherman, panzer),
};

// --- the sheet ----------------------------------------------------------------------
out.sheet = Object.fromEntries(Object.entries(sheet.tanks).map(([k, v]) => [k, {
  top: v.drive.top, hardStop: v.steady.hardStop, fireAcross: v.steady.fireAcross, fireingForce: v.fireingForce,
  traces: Object.fromEntries(Object.entries(v.traces).map(([s, t]) => [s, { axis: t.axis, hz: t.hz, n: t.values.length }])),
}]));


// --- on foot: the anti-tank weapons -----------------------------------------------------
// Two levels, each team's kits; the AI table rates the Panzerfaust and the
// PIAT against armour and the grenade not; a random kit's variants count;
// a level's own kit wins over the global one.
const loadouts = {
  kits: {
    GerAT: { class: 'Anti-tank', items: ['K98', 'Panzerfaust30', 'GrenadeAxis'] },
    GerRandom: { class: 'Assault', items: ['Mp40', 'RandomGerPanzerfaust'], random: [{ template: 'RandomGerPanzerfaust', variants: ['RandomGerPanzerfaust7'] }] },
    GbAT: { class: 'Anti-tank', items: ['Piat', 'No2'] },
  },
  levelKits: { other: { GbAT: { class: 'Anti-tank', items: ['Bazooka'] } } },
  levels: {
    'arnhem-1944': { 1: { soldier: 'GermanSoldier', slots: { 0: 'GerAT', 1: 'GerRandom' } }, 2: { soldier: 'BritishSoldier', slots: { 0: 'GbAT' } } },
    other: { 2: { soldier: 'USSoldier', slots: { 0: 'GbAT' } } },
  },
  aiWeapons: {
    Panzerfaust30: { strength: { HeavyArmour: 3 } }, GrenadeAxis: { strength: { HeavyArmour: 0 } }, K98: { strength: { HeavyArmour: 0 } },
    RandomGerPanzerfaust7: { strength: { HeavyArmour: 3 } }, No2: { strength: { HeavyArmour: 0 } }, Piat: { strength: { HeavyArmour: 3 } }, Bazooka: { strength: { HeavyArmour: 2 } },
  },
};
const names = ws => ws.map(w => w.name);
out.foot = {
  axis: names(L.sideWeapons(loadouts, ['Arnhem-1944'], 'Axis')),
  allied: names(L.sideWeapons(loadouts, ['Arnhem-1944'], 'Allied')),
  alliedEvery: names(L.sideWeapons(loadouts, [], 'Allied')),
  // No AI table (EoD's loadouts): the Anti-tank kits' items, all of them.
  noTable: names(L.sideWeapons({ ...loadouts, aiWeapons: undefined }, ['Arnhem-1944'], 'Axis')),
};
// FHSW's Panzerfaust 30, as its glb carries it.
const pf30 = L.launcherOf('Panzerfaust30', {
  extras: { weapon: { deviation: { min: 2.0, mod: [1.4, 0.9, 1.0], speed: [8.0, 0.5, 0.5, 0.5] }, zoom: { fov: 0.8, soldierFov: 0.8 }, crossHair: 'CHTCrossHair' } },
  nodes: [{ name: 'Panzerfaust30', extras: { fireArms: { velocity: 28, reloadTime: 1, projectile: { kind: 'shell', gravity: 1, material: 287, timeToLive: 10 } } } }],
});
// Vanilla's Bazooka: only the words the engine ignores (DEV-8).
const bazooka = L.launcherOf('Bazooka', {
  extras: { weapon: { deviation: { minDeviation: 0, maxDeviation: 0.5 } } },
  nodes: [{ name: 'Bazooka', extras: { fireArms: { velocity: 50, projectile: { kind: 'shell', material: 250, timeToLive: 10 } } } }],
});
// EoD's LAW: next to no gravity; the launch's lift carries it up past its fuse.
const law = L.launcherOf('Law', { nodes: [{ name: 'Law', extras: { fireArms: { velocity: 65, projectile: { kind: 'shell', gravity: 0.01, material: 226, timeToLive: 20 } } } }] });
const placed = L.launcherOf('Haft', { nodes: [{ name: 'Haft', extras: { fireArms: { velocity: 3, projectile: { gravity: 0.85, material: 814 } } } }] });
const aim50 = L.aimFor(pf30, 50), aim30 = L.aimFor(pf30, 30);
out.launcher = {
  pf30: { speed: pf30.gun.speed, spread: pf30.spread, reach: r1(L.reachOf(pf30).range), reachE: L.reachOf(pf30).elevation,
    aim30: r1(aim30.elevation), aim50: r1(aim50.elevation), t50: r1(aim50.t), out70: L.aimFor(pf30, 70).elevation,
    still50: r1(L.strayAt(pf30.spread.still, 50)), zoom: pf30.zoom.fov },
  bazooka: { gravity: bazooka.gun.gravity, spread: bazooka.spread },
  law: { reach: Math.round(L.reachOf(law).range), fuse: L.reachOf(law).fuse, rises: B.dropAt(law.gun, 50) < 0 },
  placed: placed.placed, none: L.launcherOf('Knife', { nodes: [{ name: 'Knife', extras: {} }] }),
  glb: (() => {
    const json = JSON.stringify({ asset: { version: '2.0' } }) + ' ';
    const body = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
    const head = Buffer.alloc(20);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length, 8);
    head.writeUInt32LE(body.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
    return L.glbJson(Buffer.concat([head, body]))?.asset?.version;
  })(),
};
const kv2 = { name: 'KV-2', heightM: 3.4, lengthM: 6.9, top: 7, shots: { 0: { shots: 10, share: 0.9 }, 90: { shots: 10, share: 0.9 }, 180: { shots: 9, share: 0.9 } } };
const wordsFor = (l, R, target = kv2) => { const aim = L.aimFor(l, R); return W.launcherWords({ name: 'Panzerfaust 30', reach: L.reachOf(l), aim, drop: B.dropAt(l.gun, R), spread: l.spread,
  stillM: L.strayAt(l.spread.still, R), movingM: L.strayAt(l.spread.moving, R) }, target, R); };
out.launcherWords = { pf30at30: wordsFor(pf30, 30), pf30at70: wordsFor(pf30, 70), bazooka: wordsFor(bazooka, 50), immune: wordsFor(pf30, 30, { ...kv2, shots: {} }) };
// The rig a soldier holds it with: his own pair's shared rig, his own, or any.
const index = { rigs: ['BritishSoldier__Piat', 'FMGermanSoldier__Panzerfaust30', 'GermanSoldier__K98'], pairs: { VolkssturmSoldier__Panzerfaust30: { rig: 'FMGermanSoldier__Panzerfaust30' } } };
out.rigs = [V.rigStemFor(index, 'VolkssturmSoldier', 'Panzerfaust30'), V.rigStemFor(index, 'BritishSoldier', 'piat'),
  V.rigStemFor(index, 'GermanSoldier', 'Panzerfaust30'), V.rigStemFor(index, 'GermanSoldier', 'Bazooka'), V.rigStemFor(['USSoldier__Bazooka'], 'USSoldier', 'Bazooka')];
out.zoomPose = V.zoomPose({ center1pHands: [-0.06, -1.56, 0.1], soldierZoomPosition: [-0.107, -0.196, 0.1] });

// --- a round's blast on the hull it strikes (HP-9) ---------------------------------
// The same box hull, its origin at its middle, splash material 47: an
// impact round bursts 0.1 m off the plate it strikes, and the burst reaches
// the origin 3.1 m in from the front plate.
hull.userData.armor = { hitpoints: 100, splashMaterial: 47 };
const blastTables = {
  materials: { ...tables.materials, 276: { damage: 10, attGroup: 276, defGroup: 276 }, 70: { damage: 0, attGroup: 70, defGroup: 70 }, 231: { damage: 10, attGroup: 231, defGroup: 231 }, 47: { defGroup: 47 } },
  modifiers: { ...tables.modifiers, 276: { 47: 1.75 }, 231: { 47: 2.5 } },
};
const shell = { material2: 276, radius: 12, damageType: 1, hasCollisionEffect: true };
const blast = R.blastOf(blastTables, shell, hull);
const sh = (r, b) => (r[b].share > 0 ? r[b].hurtShots : null);
const plain = R.bearingShots(hull, price, 100, { bearings: [0, 90, 180], step: 0.1 });
const blasted = R.bearingShots(hull, price, 100, { bearings: [0, 90, 180], step: 0.1, blast });
const charge = { material2: 231, radius: 20, damageType: 1, hasCollisionEffect: false };
const thrown = R.bearingShots(hull, R.pricer(blastTables, 70), 100, { bearings: [0, 90], step: 0.1, blast: R.blastOf(blastTables, charge, hull, { atContact: true }) });
out.blast = {
  front: [sh(plain, 0), sh(blasted, 0)], side: [sh(plain, 90), sh(blasted, 90)], rear: [sh(plain, 180), sh(blasted, 180)],
  atFront: r1(blast(new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, -1))),
  noCell: R.blastOf(tables, shell, hull), noImpact: R.blastOf(blastTables, charge, hull),
  thrown: [sh(thrown, 0), sh(thrown, 90)],
  splashMaterial: R.splashMaterialOf(hull),
};
// --- where the gun points ------------------------------------------------------------
const rigged = (name, yaw) => { const base = new THREE.Group(); base.userData.rig = { axes: { yaw } }; const g = new THREE.Group(); g.name = name; base.add(g); return g; };
const mark4 = [rigged('Mark4Gun', { min: -90, max: 15 }), rigged('Mark4Gun_1', { min: -15, max: 90 }), rigged('Mark4FrontLewis', { min: -30, max: 30 })];
const ft17 = [rigged('FT17Cannon', { free: true, min: null, max: null })];
out.arcs = {
  mark4: A.gunArcs(mark4, 'Mark4Gun'), mark4Cover: A.arcCover(A.gunArcs(mark4, 'Mark4Gun')),
  a7v: A.arcCover(A.gunArcs([rigged('A7VCannon', { min: -10, max: 10 })], 'A7VCannon')),
  ft17: A.arcCover(A.gunArcs(ft17, 'FT17Cannon')), none: A.arcCover([]),
};
out.thrownCharge = L.launcherOf('GeballteLadung', { nodes: [{ name: 'GeballteLadung', extras: { fireArms: { velocity: 10, roundOfFire: 0.5, projectile: { kind: 'shell', material: 70, timeToLive: 5, damage: charge } } } }] });
out.wwiNames = ["Mark4", "Chamond", "FT17_Beute", "Ger77er", "Sherman"].map(A.prettyTank);

// --- the rules of 1917-18 (tank-doctrine-1918.js) -------------------------------------
// A Mark IV against an A7V in BF1918's own numbers (Villers-Bretonneux, as
// the page measured them): each hull's clock from the other's gun.
const clock = (f, sd, r) => ({ 0: { shots: f }, 90: { shots: sd }, 180: { shots: r } });
const mk4 = { name: 'Mark IV', hp: 80, lengthM: 8.2, heightM: 3, exposed: 1.1, shots: clock(4, 3, 3),
  gun: { speed: 100, gravity: 0.35, reload: 4, arcs: [[-90, 15], [-15, 90]] },
  sheet: { drive: { top: 5.39, turnFromRest: 6 }, steady: { hardStop: { peak: 1.59, still: 2.5 } } } };
const a7v = { name: 'A7V', hp: 100, lengthM: 7.3, heightM: 3.5, exposed: 1.3, shots: clock(4, 4, 4),
  gun: { speed: 100, gravity: 0.35, reload: 4, arcs: [[-10, 10]] }, sheet: { drive: { top: 6.13 } } };
const doctrineCtx = {
  you: mk4, them: a7v, mg: { label: "A7V's machine gun", shots: clock(492, 400, 403) },
  fieldGuns: [{ label: '77 mm field gun', speed: 100, gravity: 0.3, reload: 3.33, radius: 12, shots: clock(2, 2, 2) }],
  foot: [{ label: 'Geballte Ladung', charge: true, fuse: 5, shots: clock(4, 4, 4) }, { label: 'stick grenade', charge: true, fuse: 5, shots: clock(10, 10, 10) },
    { label: 'Tankgewehr', charge: false, pickup: true, full: 100, min: 150, floor: 0.3, shots: clock(7, 6, 6) }],
};
const verdicts = D.rulesOn(doctrineCtx);
out.doctrine = {
  ids: verdicts.map(r => r.id),
  status: Object.fromEntries(verdicts.map(r => [r.id, r.verdict.status])),
  words: Object.fromEntries(verdicts.map(r => [r.id, r.verdict.words])),
  sources: verdicts.every(r => r.source?.doc && /^https:\/\//.test(r.source.url)),
  quotes: verdicts.filter(r => r.quote).map(r => r.quote.split(/\s+/).length),
  empty: Object.fromEntries(D.rulesOn({ you: { ...mk4, sheet: null }, them: a7v, mg: null, fieldGuns: [], foot: [] }).map(r => [r.id, r.verdict.status])),
  duel: D.VILLERS_BRETONNEUX.duel({ you: mk4, them: a7v, femaleMg: { shots: clock(501, 501, 501) } }),
  halt: D.haltMeasure(mk4),
  arcsA7V: D.arcWords(a7v).words,
};

// --- the rules of 1991 (tank-doctrine-1991.js) ----------------------------------------
// An M1A1 against a T-72 in Desert Combat's own numbers (73 Easting, as the
// page measured them on the published tree): both guns 250 m/s, 2 s a round,
// three hits all round; the sabot lives 4 s and the T-72's shell 10.
const D91 = await load('tank-doctrine-1991.js');
const rose91 = (f, sd, r, spot = null) => ({ 0: { shots: f, bestShots: f }, 90: { shots: sd, bestShots: spot ?? sd }, 180: { shots: r, bestShots: r } });
const m1a1 = { name: 'M1A1', hp: 100, lengthM: 9.74, shots: rose91(3, 3, 3, 1), shellDamage: { radius: 3 },
  gun: { speed: 250, gravity: 1, reload: 2, round: 'Sabot_Projectile', ttl: 4, mag: 30, magReload: 0.1, up: 20 },
  sheet: { drive: { top: 14.85 }, steady: { hardStop: { peak: 0.61, still: 2.17 } } } };
const t72 = { name: 'T-72', hp: 100, lengthM: 9.19, shots: rose91(3, 3, 3), shellDamage: { radius: 5 },
  gun: { speed: 250, gravity: 1, reload: 2, round: 'T72Projectile', ttl: 10, mag: 30, magReload: 0.1, up: 20 },
  sheet: { drive: { top: 14.86 }, steady: { hardStop: { peak: 1.32, still: 2.7 } } } };
const bradley = { name: 'M2A3 Bradley', hp: 100, lengthM: 5.94, shots: rose91(1, 1, 1),
  gun: { speed: 100, gravity: 0, reload: 1, round: 'TOW_Projectile', ttl: 10, mag: 2, magReload: 6, up: 25 }, sheet: { drive: { top: 14.86 } } };
const ctx91 = {
  you: m1a1, them: t72, mg: { label: "T-72's machine gun", shots: clock(null, 201, null) }, ownMg: null, fieldGuns: [],
  foot: [{ label: 'RPG-7', charge: false, speed: 100, gravity: 0.4, shots: clock(4, 3, 3) }, { label: 'Smoke Grenade', charge: false, speed: 20, gravity: 1, shots: clock(2271, 2000, 2001) }],
  air: [
    { vehicle: 'Mi24D', label: 'Mi-24', weapon: 'AT-2', kind: 'rocket', gun: { speed: 350, gravity: 0 }, ttl: 50, rof: 2, shots: clock(2, 2, 2) },
    { vehicle: 'SU-25', label: 'Su-25', weapon: '30 mm gun', kind: 'bullet', gun: { speed: 900, gravity: 0 }, ttl: 5, rof: 20, shots: clock(8, 7, 7) },
    { vehicle: 'SU-25', label: 'Su-25', weapon: 'bombs', kind: 'shell', gun: { speed: 1, gravity: 1 }, ttl: 20, rof: 3, shots: clock(1, 1, 1) },
    { vehicle: 'A10_C', label: 'A-10', weapon: 'bombs', kind: 'bullet', gun: { speed: 15, gravity: 1 }, ttl: 10, rof: 2, shots: clock(2, 2, 2) },
  ],
  carriers: [{ vehicle: 'BRDM2_Spandrel', label: 'BRDM-2 Spandrel', weapon: 'AT-5', kind: 'shell', gun: { speed: 200, gravity: 0 }, ttl: 5, mag: 5, reload: 10, shots: clock(3, 2, 3) }],
};
const v91 = D91.rulesOn(ctx91);
out.doctrine1991 = {
  ids: v91.map(r => r.id),
  status: Object.fromEntries(v91.map(r => [r.id, r.verdict.status])),
  words: Object.fromEntries(v91.map(r => [r.id, r.verdict.words])),
  sources: v91.every(r => r.source?.doc && /^https:\/\//.test(r.source.url)),
  quotes: v91.map(r => r.quote.split(/\s+/).length),
  empty: Object.fromEntries(D91.rulesOn({ you: { ...m1a1, sheet: null }, them: t72, mg: null, fieldGuns: [], foot: [], air: [], carriers: [] }).map(r => [r.id, r.verdict.status])),
  bradley: Object.fromEntries(D91.rulesOn({ ...ctx91, you: bradley, them: t72, ownMg: { label: 'automatic gun', shots: clock(74, 67, 70) } }).map(r => [r.id, r.verdict])),
  againstBradley: D91.rulesOn({ ...ctx91, you: t72, them: bradley, carriers: [] }).find(r => r.id === 'missile').verdict.words,
  duel: D91.FIGHT.duel({ you: m1a1, them: t72 }),
  fight: [D91.FIGHT.arena, D91.FIGHT.yours, D91.FIGHT.theirs],
  threats: D91.threats(ctx91).map(x => `${x.label} ${x.hits}`),
  names: ['AH64', 'Mi24D', 'A10_B', 'SU-25', 'Humvee_Tow', 'T72'].map(D91.vehicleWords),
  weapons: ['AH64HellfireRack', 'Mi24D_AT2Arms', 'BMP2_AT5', 'BRDM2_Span_Launcher', 'A10Guns', 'T72Projectile', 'Sabot_Projectile'].map(n => D91.weaponWords(n)),
  card: D91.CARD,
};
// A vehicle's every weapon from its glb JSON (`armsOf`): a launcher that
// declares no velocity fires at the engine's 200 m/s (FA-3); a designator
// (no material) is left out.
out.armsOf = L.armsOf({ nodes: [
  { name: 'BRDM2_Span_Launcher', extras: { fireArms: { roundOfFire: 0.5, magSize: 5, reloadTime: 10, projectile: { template: 'Spandrel_Projectile', kind: 'shell', material: 751, gravity: 0, timeToLive: 5 } } } },
  { name: 'CallArtillary', extras: { fireArms: { projectile: { template: 'BinocularsProjectile', kind: 'bullet', timeToLive: 120 } } } },
  { name: 'M2A3_TOW', extras: { fireArms: { velocity: 100, magSize: 2, reloadTime: 6, projectile: { template: 'TOW_Projectile', kind: 'shell', material: 718, gravity: 0, timeToLive: 10 } } } },
] }).map(a => [a.node, a.gun.speed, a.ttl, a.mag]);
// Desert Combat's arenas: its own battle stands for a pair before a vanilla
// map it borrows, the gun tank leads its side over an anti-aircraft hull of
// the same worth, and `DC_` comes off the name.
const dcAi = Object.fromEntries([['M1A1', 12, 7], ['M163', 12, 1], ['M2A3', 12, 6], ['T72', 30, 6], ['Shilka', 12, 2]].map(([n, worth, punch]) =>
  [n, { class: 'land', equipment: 'Tank', basicTemp: worth, fireArms: { [`${n}GunBarrel`]: `${n}MainGun` }, aiWeapons: { [`${n}MainGun`]: { strength: { HeavyArmour: punch } } } }]));
const dcRow = (name, levelSides) => ({ name, category: 'land', hitpoints: 100, weapons: [`${name}GunBarrel`], sides: ['Allied', 'Axis'], levels: Object.keys(levelSides), levelSides });
const dcArenas = A.arenasFrom([
  dcRow('M163', { Kursk: ['Allied'], DC_Battle_of_73_Easting: ['Allied'], DC_DesertShield: ['Allied'] }),
  dcRow('M1A1', { Kursk: ['Allied'], DC_Battle_of_73_Easting: ['Allied'], DC_DesertShield: ['Allied'] }),
  dcRow('M2A3', { Kursk: ['Allied'], DC_Battle_of_73_Easting: ['Allied'], DC_DesertShield: ['Allied'] }),
  dcRow('T72', { Kursk: ['Axis'], DC_Battle_of_73_Easting: ['Axis'], DC_DesertShield: ['Axis'] }),
  dcRow('Shilka', { Kursk: ['Axis'], DC_Battle_of_73_Easting: ['Axis'], DC_DesertShield: ['Axis'] }),
], null, dcAi).filter(a => !a.every);
out.dcArenas = dcArenas.map(a => ({ map: a.map, name: a.name, allied: a.allied.map(t => t.template), axis: a.axis.map(t => t.template) }));
out.dcNames = ['T72', 'BMP2', 'M2A3', 'Shilka', 'RPG7'].map(A.prettyTank);
out.levelWords = ['DC_Battle_of_73_Easting', 'DC_DesertShield', 'El_Alamein', 'villers_bretonneux'].map(A.levelWords);

// --- STUDY: a recorded fight taken apart (tank-duel.js) --------------------------------
// Side 0 stands still at the origin; side 1 drives east at 5 m/s, 200 m to
// the north. 0.2 s samples over 6 s.
{
  const dt = 0.2, n = 31;
  const side = (fn, yaw) => ({ p: Array.from({ length: n }, (_, i) => fn(i * dt)).flat(), yaw: Array(n).fill(yaw), pitch: Array(n).fill(2), roll: Array(n).fill(0),
    turret: Array(n).fill(0), hp: [[0, 100]], lost: [] });
  const fight = { dt, duration: (n - 1) * dt, sides: [side(() => [0, 0, 0], 0), side(t => [5 * t, 0, 200], 90)], shots: [], evidence: [] };
  const mid = Duel.sideAt(fight, 1, 1.1);
  // A shot fired straight at where side 1 is, and one along the aim that would have hit.
  const plain = { side: 0, t: 1, pos: [0, 2, 0], dir: [5 / 200, 0, 1], pv: [0, 0, 0], speed: 100, gravity: 1, aimed: true };
  const first = Duel.studyShot(fight, plain);
  const aimed = Duel.studyShot(fight, { ...plain, dir: first.need });
  const stopped = Duel.studyShot(fight, { ...plain, pv: [3, 0, 0], dir: first.need });
  out.duel = {
    mid: { x: Math.round(mid.pos[0] * 100) / 100, speed: Math.round(mid.speed * 100) / 100, yaw: mid.yaw },
    basisNorth: Duel.viewBasis([0, 0, 1]).r, basisEast: Duel.viewBasis([1, 0, 0]).r,
    plainMiss: { right: r1(first.miss.right), up: r1(first.miss.up) }, tau: Math.round(first.tau * 100) / 100,
    aimedMiss: Math.round(aimed.miss.total * 100) / 100, drop: r1(first.drop),
    ownDrift: r1(stopped.drift.own), theirs: r1(first.drift.theirs),
    aspect: Duel.aspectOf(Duel.sideAt(fight, 1, 1), [0, 2, 0]),
    words: Duel.shotWords(first, ["A's Sherman", "B's Tiger"]),
    unaimed: Duel.shotWords(Duel.studyShot(fight, { ...plain, aimed: false, dir: [1, 0, 0] }), ["A's Sherman", "B's Tiger"]),
    timeline: Duel.timeline(fight).length,
  };
  // The hull's attitude from a rotation: 10 degrees nose-up about x, then 5 right side up about z.
  const qx = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
  const qz = a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  const d2r = Math.PI / 180;
  out.attitude = { nose: Det.attitudeOf(qx(-10 * d2r)), right: Det.attitudeOf(qz(5 * d2r)) };
}

console.log(JSON.stringify(out));
