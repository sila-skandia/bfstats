// Drives `viewer/strategic.js` on a level's real `extras.ai` (El Alamein's
// scene.json when the extracted tree is present, else an inline fixture):
// the areas bind to the control points, each side chooses a strategy through
// its prerequisites, attack targets are areas with an owned neighbour that
// the side does not hold, and every bot gets a WPMoveTo order whose urgency
// follows `WPMoveTo::getUrgency`. Also pins `compareCondition`.
//
// Run by `tests/test_strategic.py`. One JSON object on stdout.

import fs from 'node:fs';
import { StrategicLayer, StrategicAI, compareCondition, SAI } from './strategic.js';

const scenePath = process.argv[2];
let scene = null;
if (scenePath && fs.existsSync(scenePath)) scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

if (!scene) {
  scene = {
    controlPoints: [
      { name: 'AxisBase', team: 1, position: [100, 0, -100] },
      { name: 'Mid', team: 0, position: [500, 0, -500] },
      { name: 'AlliedBase', team: 2, position: [900, 0, -900] },
    ],
    ai: {
      strategicAreas: [
        { name: 'AxisBase', min: [50, -150], max: [150, -50], radius: 50, neighbours: ['Mid'], flags: ['Base'], orderPositions: { Infantery: [100, -100] }, side: 1, takeable: { 2: false } },
        { name: 'Mid', min: [450, -550], max: [550, -450], radius: 100, neighbours: ['AxisBase', 'AlliedBase'], flags: ['ControlPoint', 'Centre'], orderPositions: { Infantery: [500, -500] }, side: null, takeable: {} },
        { name: 'AlliedBase', min: [850, -950], max: [950, -850], radius: 50, neighbours: ['Mid'], flags: ['Base'], orderPositions: { Infantery: [900, -900] }, side: 2, takeable: { 1: false } },
      ],
      conditions: [
        { name: 'broadCond', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Enemy', object: 'Front', value: 0, strength: ['Required'], abort: false },
      ],
      prerequisites: [{ name: 'broadPrereq', conditions: [{ name: 'broadCond', weight: 5.0 }] }],
      strategies: [{ name: 'broad', aggression: 1.0, attacks: 3, defences: 0, timeLimit: 400, prerequisite: 'broadPrereq',
        modifiers: [{ flag: 'ControlPoint', factor: 2.0, owner: null }] }],
      sideStrategies: { 1: ['broad'], 2: ['broad'] },
    },
  };
}

const flags = scene.controlPoints.map(cp => ({ name: cp.name, position: cp.position, team: cp.team, uncapturable: false }));
const layer = new StrategicLayer(scene.ai, flags);
let seed = 12345;
const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
const sai = new StrategicAI(layer, { random });

// Four bots a side, standing at their base's order position.
const alive = new Map();
for (const side of [1, 2]) {
  const base = layer.areas.find(a => a.flags.has('Base') && layer.ownerOf(a) === side) ?? layer.areas[0];
  const p = layer.orderPosition(base);
  for (let i = 0; i < 4; i++) {
    const id = `bot_${side}_${i}`;
    sai.addBot(id, side);
    alive.set(id, [p[0] + i, 0, p[1] + i]);
  }
}
sai.update(10, alive);

const orders = {};
for (const [id, p] of alive) {
  const wp = sai.waypointsOf(id);
  orders[id] = wp ? { area: wp.area.name, radius: +wp.radius.toFixed(2), urgency: +wp.urgency(p[0], p[2]).toFixed(3), owned: wp.owned() } : null;
}
const areas = layer.areas.map(a => ({ name: a.name, owner: layer.ownerOf(a), cps: a.controlPoints.map(f => f.name), flags: [...a.flags] }));
const sides = {};
for (const side of [1, 2]) {
  const S = sai.sides[side];
  sides[side] = {
    strategy: S.active?.strategy.name ?? null,
    scores: S.containers.map(c => [c.strategy.name, +c.score.toFixed(2)]),
    attacks: S.attacks.map(a => a.name),
    defences: S.defences.map(a => a.name),
    friendlyAreas: S.states.friendly.get('NumberOfFriendlyAreas') ?? 0,
    front: S.states.friendly.get('Front') ?? 0,
  };
}

const compare = {
  crispGreaterTrue: compareCondition({ fuzzy: 'Crisp', op: 'EqualGreater', value: 2 }, 3),
  crispGreaterFalse: compareCondition({ fuzzy: 'Crisp', op: 'EqualGreater', value: 2 }, 1),
  fuzzySmaller: compareCondition({ fuzzy: 'Fuzzy', op: 'EqualSmaller', value: 200 }, 50),
  fuzzyEqual: compareCondition({ fuzzy: 'Fuzzy', op: 'Equal', value: 2 }, 5),
  quotientZero: compareCondition({ fuzzy: 'Crisp', op: 'QuotientGreater', value: 1 }, 3, 0),
};

// Bocage's Island as the exporter writes it (`create Island 833/701 846/717
// 200`): p1 the corner, p2 the centre, a centre box twice the rectangle.
const island = new StrategicLayer({
  strategicAreas: [{ name: 'Island', min: [833, -717], max: [846, -701], radius: 200, neighbours: [], flags: ['ControlPoint'],
                     orderPositions: { Tank: [836, -731], Infantery: [853, -720] }, side: null, takeable: {} }],
}, [{ name: 'Lumbermill', position: [838, 33.1, -722], team: 2 }]);
const ia = island.areas[0];
const r0 = island.randomizePos(ia, 0.8, () => 0);
const r1 = island.randomizePos(ia, 0.8, () => 1);
const unit = { type: 'Tank', isWalkable: null, radius: 3.0, mounted: true };
const tankSai = new StrategicAI(island, { random: () => 0.5, unitOf: () => unit, spottedOf: () => 0 });
tankSai.addBot('tank', 1);
const wpTank = tankSai._order(tankSai.bots.get('tank'), ia, 1);
const pr = 0.99 * 3.0;
const Rr = Math.round(wpTank.radius) + pr;
const inR = wpTank.urgency(wpTank.point[0] + Rr - 0.1, wpTank.point[1], pr);
const inRArrived = wpTank.arrived;
const outU = wpTank.urgency(wpTank.point[0] + 100, wpTank.point[1], pr);
// Nothing valid on the unit's map: the Tank order position, else p2.
const blocked = new StrategicAI(island, { random: () => 0.5, unitOf: () => ({ ...unit, isWalkable: () => false }) });
blocked.addBot('b', 1);
const wpBlocked = blocked._order(blocked.bots.get('b'), ia, 1);
const onlyTankPos = new StrategicAI(island, { random: () => 0.5,
  unitOf: () => ({ ...unit, isWalkable: (x, z) => x === 836 && z === -731 }) });
onlyTankPos.addBot('c', 1);
const wpTankPos = onlyTankPos._order(onlyTankPos.bots.get('c'), ia, 1);
// The re-order: arrived, assigned, present, 35 s mounted.
const re = new StrategicAI(island, { random: () => 0.25, unitOf: () => unit, spottedOf: () => 0 });
re.addBot('r', 2);
const rb = re.bots.get('r');
re._order(rb, ia, 2);
rb.free = false; rb.assignedTo = ia; rb.area = ia; rb.waypoints.arrived = true;
const firstPoint = rb.waypoints.point;
re.time = 30; re._reorderArrived([rb], 2);
const keptAt30 = rb.waypoints.point === firstPoint;
re.time = 36; re._reorderArrived([rb], 2);
const movedAt36 = rb.waypoints.point !== firstPoint;
// An aircraft: `orderAirBot`, the area's own position at ground + 75.
const airSai = new StrategicAI(island, { random: () => 0.5,
  unitOf: () => ({ type: 'Plane', air: true, radius: 10, mounted: true, groundAt: () => 10 }) });
airSai.addBot('air', 1);
const wpAir = airSai._order(airSai.bots.get('air'), ia, 1);
const air = { point: wpAir.point, y: wpAir.y, radius: +wpAir.radius.toFixed(3), clearance: wpAir.clearance,
  far: wpAir.urgency(846 + 100, -717, 0, 85), at: wpAir.urgency(846, -717, 0, 85),
  ten: +wpAir.urgency(856, -717, 0, 85).toFixed(6), high: wpAir.urgency(846, -717, 0, 85 + 130), arrived: wpAir.arrived };
// Every order carries the area test its callers make (bot.js Fire, Change
// and the medic's `insideMyArea`): `isInside`, the centre box.
const orderInside = [wpTank, wpBlocked, wpTankPos, wpAir].map(wp => typeof wp.inside === 'function'
  ? [wp.inside(846, -717), wp.inside(838, -722), wp.inside(900, -717), wp.inside(846, -760)] : null);
// `StrategyPrerequisite::evaluate` 0x0863aa50: a passing Required condition
// adds its value; a failing one zeroes the sum.
const pq = new StrategicLayer({
  strategicAreas: [],
  conditions: [
    { name: 'req', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Friendly', object: 'X', value: 0, strength: ['Required'] },
    { name: 'adv', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Friendly', object: 'X', value: 0, strength: ['Advisory'] },
    { name: 'reqFail', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Friendly', object: 'X', value: 5, strength: ['Required'] },
  ],
  prerequisites: [{ name: 'p1', conditions: [{ name: 'req', weight: 3 }, { name: 'adv', weight: 2 }] },
                  { name: 'p2', conditions: [{ name: 'req', weight: 3 }, { name: 'reqFail', weight: 1 }] }],
  strategies: [{ name: 's1', prerequisite: 'p1' }, { name: 's2', prerequisite: 'p2' }],
  sideStrategies: { 1: ['s1', 's2'], 2: [] },
}, []);
const pqSai = new StrategicAI(pq, { random: () => 0.5 });
pqSai.sides[1].states = { friendly: new Map([['X', 1]]), enemy: new Map() };
const prereq = { passing: pqSai._evaluatePrerequisite(1, pq.strategies.get('s1'), true),
                 failing: pqSai._evaluatePrerequisite(1, pq.strategies.get('s2'), true) };
// `AIStrategicArea::update` 0x0863d6d0: an area with no control point is held
// by presence, within its takeable flags.
const pass = new StrategicLayer({ strategicAreas: [
  { name: 'Pass', min: [0, -10], max: [10, 0], radius: 20, side: 1, takeable: {} },
  { name: 'Base', min: [50, -10], max: [60, 0], radius: 20, side: 1, takeable: { 2: false } },
] }, []);
const [pa, ba] = pass.areas;
const presence = [pass.ownerOf(pa)];
pass.updatePresenceOwner(pa, 0, 2); presence.push(pass.ownerOf(pa));
pass.updatePresenceOwner(pa, 0, 0); presence.push(pass.ownerOf(pa));
pass.updatePresenceOwner(pa, 1, 1); presence.push(pass.ownerOf(pa));
pass.updatePresenceOwner(ba, 0, 3); presence.push(pass.ownerOf(ba));
// Brief R item 5 (ledger AI-127): `AIStrategicArea::update` counts an
// object in an area's hold only when its Information lacks the air bit
// (0x0863e182 / 0x0863e1e5); a plane's secondary seats count without it. An
// Allied bot orbiting the Axis pass in a Spitfire's pilot seat takes nothing;
// one in a gunner seat of an aircraft, or on foot, takes it.
function passHeldBy(unit) {
  const lay = new StrategicLayer({ strategicAreas: [
    { name: 'Pass', min: [0, -10], max: [10, 0], radius: 20, side: 1, takeable: {} },
  ] }, []);
  const sai = new StrategicAI(lay, { random: () => 0.5, unitOf: () => unit });
  sai.addBot('b', 2, () => [5, 60, -5]);
  sai._updateAreas(new Map([['b', [5, 60, -5]]]));
  return { owner: lay.ownerOf(lay.areas[0]), present: sai.areaState.get(lay.areas[0])[2].present.length };
}
const airHold = {
  pilot: passHeldBy({ air: true, root: true, mounted: true }),
  gunner: passHeldBy({ air: true, root: false, mounted: true }),
  foot: passHeldBy({ mounted: false }),
};
const pins = {
  air, orderInside, prereq, presence, airHold,
  corner: ia.corner, centre: ia.centre, min: ia.min, max: ia.max, sideRadius: +ia.sideRadius.toFixed(3),
  cpInside: island.isInside(ia, 838, -722), r0, r1: r1.map(v => +v.toFixed(3)),
  tankRadius: +wpTank.radius.toFixed(3), inR, inRArrived, outU,
  blockedPoint: wpBlocked.point, tankPosPoint: wpTankPos.point, keptAt30, movedAt36,
};

process.stdout.write(JSON.stringify({ fromScene: !!scenePath && fs.existsSync(scenePath), areas, sides, orders, compare, pins }));
