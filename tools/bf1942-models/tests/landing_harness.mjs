// Drives `viewer/doctrine-landing.js` through the SAI and the strategic
// command on an inline copy of Wake's southern areas and zones (exporter
// frame, z negated): the zone geometry, the beach and approach points, the
// order the SAI gives a landing craft, the leg flip and the bail at the
// beach.
//
// Run by `tests/test_landing.py`. One JSON object on stdout.

import {
  StrategicLayer, StrategicAI, StrategicCommand, LANDING, landingZonesOf, zoneDistanceSqr, approachPosition,
  beachPosition, beachTarget, craftArea, areaPath, ORDER_KINDS,
} from './strategic.js';
import { craftBailReason, craftTipped, levelZones } from './doctrine-landing.js';

// Wake's `AI/StrategicAreas.con` (Wake_003.rfa), three land areas and two of
// the sea, and two of its four zones, as bf42/ai_level.py exports them.
const AI = {
  strategicAreas: [
    { name: 'CrossRoads', min: [1140, -757], max: [1153, -747], radius: 150, neighbours: ['SouthernBase', 'WesternMainBaseExit', 'SeaArea1'],
      flags: ['Close', 'ControlPoint', 'Route'], orderPositions: { Infantery: [1160, -770] }, side: 2, takeable: {},
      landingZones: ['SouthLanding'], landingZoneUnits: ['LandingCraft'], expelledUnits: [] },
    { name: 'SouthernBase', min: [968.5, -843], max: [994, -817.5], radius: 150, neighbours: ['DefGun1', 'CrossRoads'],
      flags: ['Flank', 'South', 'ControlPoint'], orderPositions: {}, side: 2, takeable: {},
      landingZones: ['SouthBayLanding'], landingZoneUnits: ['LandingCraft'], expelledUnits: [] },
    { name: 'WesternMainBaseExit', min: [1325, -738], max: [1340, -698], radius: 200, neighbours: ['MainBase', 'SeaArea3', 'CrossRoads'],
      flags: ['Centre', 'Base', 'ChokePoint'], orderPositions: {}, side: 2, takeable: {},
      landingZones: [], landingZoneUnits: [], expelledUnits: [] },
    { name: 'MainBase', min: [1368.5, -782], max: [1391, -759.5], radius: 400, neighbours: ['WesternMainBaseExit'],
      flags: ['Centre', 'Base', 'ControlPoint'], orderPositions: {}, side: 2, takeable: {},
      landingZones: [], landingZoneUnits: [], expelledUnits: ['LandingCraft'] },
    { name: 'DefGun1', min: [614.5, -1074], max: [640, -1048.5], radius: 50, neighbours: ['SouthernBase'],
      flags: ['Remote'], orderPositions: {}, side: 2, takeable: {},
      landingZones: [], landingZoneUnits: [], expelledUnits: ['LandingCraft'] },
    { name: 'SeaArea1', min: [975, -452], max: [1240, -305], radius: 10, neighbours: ['SeaArea3'],
      flags: [], orderPositions: {}, side: 1, takeable: { 2: false }, landingZones: [], landingZoneUnits: [], expelledUnits: [] },
    { name: 'SeaArea3', min: [99.5, -1296], max: [320, -1045.5], radius: 20, neighbours: ['SeaArea1'],
      flags: [], orderPositions: {}, side: 1, takeable: { 2: false }, landingZones: [], landingZoneUnits: [], expelledUnits: [] },
  ],
  landingZones: [
    { name: 'SouthLanding', min: [1110, -713], max: [1196, -593], direction: 'LZZMax', beach: 'zMin' },
    { name: 'SouthBayLanding', min: [1040, -935], max: [1115, -830], direction: 'LZZMin', beach: 'zMax' },
  ],
  conditions: [
    { name: 'c', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Enemy', object: 'Front', value: 0, strength: ['Required'], abort: false },
  ],
  prerequisites: [{ name: 'p', conditions: [{ name: 'c', weight: 1 }] }],
  strategies: [{ name: 'landing', aggression: 1.0, attacks: 2, defences: 0, timeLimit: 400, prerequisite: 'p', modifiers: [] }],
  sideStrategies: { 1: ['landing'], 2: ['landing'] },
};
const FLAGS = () => [
  { name: 'CrossRoads', position: [1146, 0, -752], team: 2 },
  { name: 'SouthernBase', position: [981, 0, -830], team: 2 },
  { name: 'MainBase', position: [1380, 0, -770], team: 2 },
];
const rng = (s) => () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const out = {};

// --- 1. the zone's geometry ------------------------------------------------

const zones = landingZonesOf(AI);
const south = zones.get('southlanding');
{
  // Inside (edges inclusive) is 0; straight south of the box, the line from
  // the centre (1153, -653) leaves through the z = -593 edge; off a corner
  // it leaves through the edge the ray meets, not the nearest one.
  out.geometry = {
    inside: zoneDistanceSqr(south, 1150, -650),
    onEdge: zoneDistanceSqr(south, 1110, -600),
    south: zoneDistanceSqr(south, 1153, -500),
    corner: r3(zoneDistanceSqr(south, 1300, -500)),
    cornerExit: (() => {
      // centre (1153, -653) towards (1300, -500): d = (147, 153)/|..|; the
      // z = -593 edge is reached at t = 60/153 of the way in z, x = 1153 +
      // 147 * 60/153 = 1210.6 > 1196, so the x edge first: x = 1196 at z =
      // -653 + 153 * 43/147 = -608.245.
      const zx = -653 + 153 * (43 / 147);
      return r3((1300 - 1196) ** 2 + (-500 - zx) ** 2);
    })(),
  };
}

// --- 2. the beach and approach points --------------------------------------

{
  const r = rng(3);
  const beaches = Array.from({ length: 50 }, () => beachPosition(south, r));
  const approaches = Array.from({ length: 50 }, () => approachPosition(south, null, r).point);
  // A map that refuses the first 19 tries takes the 20th; one that refuses
  // every try keeps the last with valid false.
  let n = 0;
  const twentieth = approachPosition(south, () => ++n >= 20, rng(5));
  const none = approachPosition(south, () => false, rng(5));
  out.points = {
    beachZ: [...new Set(beaches.map(p => p[1]))],
    beachX: [r3(Math.min(...beaches.map(p => p[0]))), r3(Math.max(...beaches.map(p => p[0])))],
    approachZ: [...new Set(approaches.map(p => p[1]))],
    approachX: [r3(Math.min(...approaches.map(p => p[0]))), r3(Math.max(...approaches.map(p => p[0])))],
    twentieth: { valid: twentieth.valid, tries: n },
    none: { valid: none.valid, point: !!none.point },
    bayBeachZ: beachPosition(zones.get('southbaylanding'), r)[1],
    bayApproachZ: approachPosition(zones.get('southbaylanding'), null, r).point[1],
  };
}

// --- 3. what the SAI orders a landing craft --------------------------------

{
  const layer = new StrategicLayer(AI, FLAGS());
  const byName = n => layer.byName.get(n.toLowerCase());
  const craft = { type: 'LandingCraft', radius: 10, isWalkable: null, mounted: true };
  const at = [1100, -380];                       // in SeaArea1, south of the island
  const t = (area, unit = craft) => {
    const x = beachTarget({ layer, zones, area: byName(area), side: 1, unit, x: at[0], z: at[1] });
    return x ? { kind: x.kind, zone: x.zone.name, via: x.via.name, radius: r3(x.radius) } : null;
  };
  out.targets = {
    crossRoads: t('CrossRoads'),
    southernBase: t('SouthernBase'),
    // MainBase expels landing craft; the way from the sea runs SeaArea1 ->
    // CrossRoads, which uses SouthLanding. No intermediate area: radius 5.
    mainBase: t('MainBase'),
    // DefGun1 by SouthernBase: SeaArea1 -> CrossRoads first.
    defGun1: t('DefGun1'),
    seaArea3: t('SeaArea3'),
    infantry: t('CrossRoads', { type: 'Infantery', radius: 1 }),
    craftArea: craftArea(layer, at[0], at[1]).name,
    craftAreaOnBeach: craftArea(layer, 1146, -752).name,
    path: areaPath(layer, byName('SeaArea3'), byName('MainBase'))?.map(a => a.name) ?? null,
  };
  // With an area between: SeaArea3 -> WesternMainBaseExit (no zone here) ->
  // CrossRoads -> SouthernBase -> DefGun1. The engine's radius would be
  // 0.25 x WesternMainBaseExit's side radius + 2 x 10; the viewer drives no
  // route point and keeps the no-route 5.
  const via3 = beachTarget({ layer, zones, area: byName('DefGun1'), side: 1, unit: craft, x: 200, z: -1150 });
  out.targets.fromSeaArea3 = via3 ? { kind: via3.kind, via: via3.via.name, radius: r3(via3.radius) } : null;
  out.targets.mainBaseFromSeaArea3 = beachTarget({ layer, zones, area: byName('MainBase'), side: 1, unit: craft, x: 200, z: -1150 });
}

// --- 4. the command: the SAI's order, the leg flip, the bail ---------------

{
  const layer = new StrategicLayer(AI, FLAGS());
  const exits = [];
  // One craft (bot c) with two riders (p1, p2) and an infantry bot (i) on the
  // island; the craft's hull is `hull`.
  let craftPos = [1150, 0, -420];
  let upright = true;
  // The hull touches land beyond z = -645 (bot-units.js `touchingLand`).
  const touching = () => craftPos[2] <= -645;
  const seats = () => [
    { id: 'hull:Daihatsu', vehicleId: 'hull', seatId: 'Daihatsu', occupiedBy: 'c', upright, pos: craftPos, touchingLand: touching() },
    { id: 'hull:P3', vehicleId: 'hull', seatId: 'P3', occupiedBy: 'p1', upright, pos: craftPos, touchingLand: touching() },
    { id: 'hull:P4', vehicleId: 'hull', seatId: 'P4', occupiedBy: 'p2', upright, pos: craftPos, touchingLand: touching() },
    { id: 'hull:P5', vehicleId: 'hull', seatId: 'P5', occupiedBy: null, upright, pos: craftPos, touchingLand: touching() },
  ];
  // Water south of z = -600 (the craft's map), land north of it (the
  // infantry map).
  const water = (x, z) => z > -600;
  const land = (x, z) => z <= -600;
  const units = {
    c: { type: 'LandingCraft', radius: 10, isWalkable: water, mounted: true },
    p1: { type: 'Boat', radius: 10, isWalkable: null, mounted: true },
    p2: { type: 'Boat', radius: 10, isWalkable: null, mounted: true },
    i: { type: 'Infantery', radius: 1, isWalkable: land, mounted: false },
  };
  const sai = new StrategicAI(layer, { random: rng(11), isWalkable: land, unitOf: id => units[id] });
  const cmd = new StrategicCommand(sai, {
    random: rng(12), isWalkable: land, unitOf: id => units[id], candidatesOf: seats,
    actuators: { enter() {}, exit: id => exits.push(id) },
  });
  for (const id of ['c', 'p1', 'p2']) cmd.addBot(id, 1);
  cmd.addBot('i', 2);
  const alive = () => new Map([['c', craftPos], ['p1', craftPos], ['p2', craftPos], ['i', [1146, 0, -752]]]);
  const dt = 1 / 30;
  const step = (n) => { for (let k = 0; k < n; k++) cmd.update(dt, alive()); };
  step(61);                                       // the first pass at 2 s
  const first = cmd.waypointsOf('c');
  const firstInfo = first ? { kind: first.kind, area: first.area?.name, zone: first.zone?.name, radius: first.radius,
                              direct: first.direct, point: first.point.map(r3), urgency: first.urgency(craftPos[0], craftPos[2]) } : null;
  // Drive into the zone (z <= -593) at 12 m/s: the order flips to the beach
  // leg, and the SAI's record follows it through the next passes.
  const legs = [];
  for (let k = 0; k < 30 * 20; k++) {
    craftPos = [1150, 0, craftPos[2] - 12 * dt];
    step(1);
    const o = cmd.waypointsOf('c');
    if (!legs.length || legs[legs.length - 1].obj !== o) legs.push({ obj: o, z: r3(craftPos[2]), direct: o?.direct ?? null });
    if (craftPos[2] < -640) break;
  }
  const beachOrder = cmd.waypointsOf('c');
  const saiFollows = sai.waypointsOf('c') === beachOrder;
  const exitsMoving = exits.length;
  // Stopped in the zone on walkable ground but afloat (not touching land):
  // nobody gets out (`isTouchingLand`, 0x085606bd).
  for (let k = 0; k < 10; k++) step(1);
  const exitsAfloat = exits.length;
  // Aground on the beach, stopped: everyone aboard bails.
  craftPos = [1150, 0, -650];
  for (let k = 0; k < 10; k++) step(1);
  const exitsStopped = [...new Set(exits)].sort();
  out.command = {
    first: firstInfo,
    legs: legs.map(l => ({ z: l.z, direct: l.direct, kind: l.obj?.kind ?? null })),
    beachPointZ: r3(beachOrder.point[1]),
    saiFollows,
    exitsMoving,
    exitsAfloat,
    exitsStopped,
    kindsRegistered: ['WPBeachLanding', 'WPMoveToBeachLanding'].map(k => !!ORDER_KINDS.get(k)?.tick),
    infantry: cmd.waypointsOf('i')?.kind ?? null,
  };

  // Tipped at sea, moving: the tip test alone bails them.
  exits.length = 0;
  craftPos = [1150, 0, -420];
  upright = false;
  const cmd2 = new StrategicCommand(new StrategicAI(new StrategicLayer(AI, FLAGS()), { random: rng(11), isWalkable: land, unitOf: id => units[id] }), {
    random: rng(12), isWalkable: land, unitOf: id => units[id], candidatesOf: seats,
    actuators: { enter() {}, exit: id => exits.push(id) },
  });
  cmd2.addBot('c', 1); cmd2.addBot('p1', 1); cmd2.addBot('p2', 1);
  for (let k = 0; k < 62; k++) { craftPos = [1150, 0, craftPos[2] - 12 * dt]; cmd2.update(dt, alive()); }
  out.tipped = [...new Set(exits)].sort();
}

// --- 5. the crew's own bail test (BBChangeLandingCraft), zone by zone -------

{
  const zs = levelZones(AI);
  const at = (x, z, speed, walkable = true, upright = true, touchingLand = true) =>
    craftBailReason({ zones: zs, x, z, speed, walkable, upright, touchingLand });
  out.bailReason = {
    beached: at(1150, -690, 0.5),
    afloat: at(1150, -690, 0.5, true, true, false),
    fast: at(1150, -690, 2.5),
    atTwo: at(1150, -690, 2.0),
    wet: at(1150, -690, 0.5, false),
    offZone: at(900, -900, 0),
    bay: at(1080, -840, 0),
    tippedAtSea: at(1150, -400, 10, false, false),
    sameZones: levelZones(AI) === zs,
    tippedFlag: craftBailReason({ zones: zs, x: 900, z: -900, speed: 10, tipped: true }),
    tippedWins: craftBailReason({ zones: zs, x: 1150, z: -690, speed: 10, tipped: true, touchingLand: false }),
  };
  // `craftTipped` (0x8560b84..0x8560c4b): water more than 2 m over the
  // terrain reads the up axis's y; shallower, the up axis against the
  // terrain normal; the limit 0.7071, strict.
  const c45 = Math.SQRT1_2, tilt = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180), 0];
  const slope = [Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180), 0];
  out.tip = {
    deepUpright: craftTipped({ up: tilt(40), waterLevel: 95, terrainHeight: 80, terrainNormal: slope }),
    deepOver: craftTipped({ up: tilt(50), waterLevel: 95, terrainHeight: 80, terrainNormal: slope }),
    // 50 deg over, but on a 30 deg slope leaning the same way: 20 deg off the normal.
    shallowOnSlope: craftTipped({ up: tilt(50), waterLevel: 95, terrainHeight: 94, terrainNormal: slope }),
    // Upright on that slope: 30 deg off its normal, not tipped; 80 deg over: tipped.
    shallowOver: craftTipped({ up: tilt(80), waterLevel: 95, terrainHeight: 94, terrainNormal: slope }),
    atTwo: craftTipped({ up: tilt(50), waterLevel: 95, terrainHeight: 93, terrainNormal: [0, 1, 0] }),
    noSea: craftTipped({ up: tilt(50), waterLevel: null, terrainHeight: 94, terrainNormal: slope }),
    limit: [craftTipped({ up: [Math.sqrt(1 - 0.7071 ** 2), 0.7071, 0] }), craftTipped({ up: [0.71, 0.7, 0] })],
  };
}

out.constants = { ...LANDING };
process.stdout.write(JSON.stringify(out));
