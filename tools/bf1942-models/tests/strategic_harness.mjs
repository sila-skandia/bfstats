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
import { captureReach, captureStandRadius } from './control-point-law.js';

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
// A capture-only flag (`spawn-flags.js`: a control point that owns no soldier
// spawn) binds the engine's way: to an area with the `ControlPoint` type flag
// whose centre box holds it (`AIStrategicArea::update` 0x0863d6d0,
// `BFEnvironment::findControlPoint` 0x085e53a0), never to the nearest area.
// Midway Conquest's own areas and points, both sea areas taken by the Axis:
// they lie in no area's box, so NorthSea and SouthSea stay held by presence,
// and the Axis still count them among their control points. Salerno's hill
// is `hillnest`'s; a point inside an area without the flag is nobody's.
const seaArea = (name, min, max, radius, flags, side) => ({ name, min, max, radius, flags, side, neighbours: [],
                                                          orderPositions: {}, takeable: {} });
const midway = new StrategicLayer({ strategicAreas: [
  seaArea('Base', [2044.5, -2142.0], [2076.0, -2099.0], 120, ['Base', 'ControlPoint'], 0),
  seaArea('OutPost', [1824.0, -1958.0], [1842.0, -1938.0], 100, ['Flank', 'ControlPoint'], 0),
  seaArea('NorthSea', [1833.0, -1568.0], [1992.0, -1504.0], 10, ['ControlPoint', 'Route', 'Flank'], 2),
  seaArea('SouthSea', [1800.0, -2506.0], [1980.0, -2415.0], 10, ['ControlPoint', 'Route', 'Flank'], 1),
] }, [
  { name: 'Airfield', controlPointName: 'The_Airfield', position: [2078.63, 24.3187, -2112.66], team: 0 },
  { name: 'Coastal_Defences', controlPointName: 'The_Radar_Bunker', position: [1836.99, 32.9391, -1972.83], team: 0 },
  { name: 'NORTH_SEA_AREA', controlPointName: 'North_Midway', position: [2030.71, 19.9763, -3055.48], team: 1,
    captureOnly: true },
  { name: 'SOUTH_SEA_AREA', controlPointName: 'South_Midway', position: [2033.56, 19.8993, -1032.48], team: 1,
    captureOnly: true },
]);
// A side's `ControlPoint` state: the control points it holds plus its owned
// areas with the type flag (`_updateStates`, the page's sum), with the sea
// areas neutral and then the Axis's.
const controlPointStates = () => {
  const sai = new StrategicAI(midway, { random: () => 0.5 });
  sai.beginPass(new Map());
  return [1, 2].map(side => { sai._updateStates(side); return sai.sides[side].states.friendly.get('ControlPoint') ?? 0; });
};
const seaFlags = midway.flags.filter(f => f.captureOnly);
for (const f of seaFlags) f.team = 0;
const neutralSeas = controlPointStates();
for (const f of seaFlags) f.team = 1;
const axisSeas = controlPointStates();
const salerno = new StrategicLayer({ strategicAreas: [
  seaArea('hillnest', [439.0, -492.5], [449.5, -482.0], 300, ['Centre', 'StrongPoint', 'ControlPoint'], 0),
  seaArea('supply_left', [329.5, -552.0], [345.0, -537.0], 100, ['Flank', 'West', 'SupplyPoint'], 0),
] }, [
  { name: 'HILL_424', controlPointName: 'The_top', position: [447.602, 144.248, -492.623], team: 2, captureOnly: true },
  { name: 'FIELD', controlPointName: 'Field', position: [340, 100, -545], team: 2, captureOnly: true },
]);
// INVENTION under test (strategic-ai.js `_captureRing`): a soldier ordered
// to a flag narrower than the order's own arrival distance ends inside its
// capture ring. `Yard` is a 20 x 20 m box about (100, -100): side radius
// 14.1, R = max(5, 3.5 + 2) = 5.5, R' = round(5.5) + 1 = 7 on foot. The flag
// is 6 m from the middle, and `seq` is the random stream of each order.
const yardOf = (radius, team = 0) => new StrategicLayer({ strategicAreas: [
  { name: 'Yard', min: [90, -100], max: [100, -90], radius: 50, neighbours: [], flags: ['ControlPoint'],
    orderPositions: {}, side: null, takeable: {} },
] }, [{ name: 'Pole', position: [106, 3, -100], team, uncapturable: false, ...(radius ? { radius } : {}) }]);
const seq = () => { let i = 0; return () => [0.9, 0.1, 0.3, 0.7][i++ % 4]; };
const ringOrder = (layer, opt = {}) => {
  const sai = new StrategicAI(layer, { random: seq(), ...opt });
  sai.addBot('s', 1);
  const rec = sai.bots.get('s');
  return { sai, rec, wp: sai._order(rec, layer.areas[0], 1), flag: layer.flags[0] };
};
// Walk the order: 0.25 m a step at the point while the order still asks.
const walkOrder = (wp, from) => {
  const p = [...from];
  for (let i = 0; i < 400 && wp.urgency(p[0], p[1]) > 0; i++) {
    const d = Math.hypot(wp.point[0] - p[0], wp.point[1] - p[1]);
    p[0] += (wp.point[0] - p[0]) / d * 0.25; p[1] += (wp.point[1] - p[1]) / d * 0.25;
  }
  return p;
};
const toFlag = (p, flag) => +Math.hypot(p[0] - flag.position[0], p[1] - flag.position[2]).toFixed(3);
const narrow = ringOrder(yardOf(5));
const narrowEnd = walkOrder(narrow.wp, [60, -100]);
const narrowPins = {
  point: narrow.wp.point, radius: narrow.wp.radius, flag: narrow.wp.captureFlag?.name ?? null,
  endToFlag: toFlag(narrowEnd, narrow.flag), arrived: narrow.wp.arrived,
  // Inside the engine's R' (7 m) and outside the ring: still asked for, at
  // the urgency the engine's order has at R' (0.25 x 2). A flat ring keeps
  // R' in the law: two of its radii out (8 m) is 8^2 / (4 x 7^2) x 2.
  outsideRing: +narrow.wp.urgency(106 - 4.5, -100).toFixed(4), outsideArrived: narrow.wp.arrived,
  twoRadii: +narrow.wp.urgency(106 - 8, -100).toFixed(4),
};
// The flag taken: the engine's rule reads the same point, arrived inside R'.
narrow.flag.team = 1;
narrowPins.heldInsideRr = narrow.wp.urgency(106 - 6.5, -100);
narrowPins.heldArrived = narrow.wp.arrived;
// A wide flag (10 m >= R'), one with the template's default radius, a held
// narrow one and a hull at a narrow one: the engine's order, draw for draw.
const engineDraw = yardOf(10).randomizePos(yardOf(10).areas[0], SAI.randomizeFraction, seq());
const plain = o => ({ point: o.wp.point, radius: +o.wp.radius.toFixed(3), flag: o.wp.captureFlag?.name ?? null });
const wide = ringOrder(yardOf(10));
const wideEnd = walkOrder(wide.wp, [60, -100]);
const hull = ringOrder(yardOf(5), { unitOf: () => ({ type: 'Tank', isWalkable: null, radius: 3.0, mounted: true }) });
const losing = yardOf(5, 1);
losing.flags[0]._cp = { state: 2 };
// The flag's own cell blocked: the nearest valid point of the ring, with what
// is left of the stand radius; nothing valid inside it: the engine's order.
const onlyAt = (x, z) => (px, pz) => Math.abs(px - x) < 1e-6 && Math.abs(pz - z) < 1e-6;
const beside = ringOrder(yardOf(5), { unitOf: () => ({ type: 'Infantery', isWalkable: onlyAt(108, -100), radius: 1.0, mounted: false }) });
const walled = ringOrder(yardOf(5), { unitOf: () => ({ type: 'Infantery', isWalkable: (x, z) => Math.hypot(x - 106, z + 100) > 4.5, radius: 1.0, mounted: false }) });
// A pole the ground does not reach (Stalingrad's upper-floor flags): with
// the flag at y = 3 and a 5 m ring stood in at 4 m, ground within 3 m of it
// keeps the ring and ground 13.5 m under it leaves the engine's order.
const onGround = y => ringOrder(yardOf(5), { unitOf: () => ({ type: 'Infantery', isWalkable: null, radius: 1.0, mounted: false,
                                                             groundAt: () => y }) });
// The ring cut by the ground (control-point-law.js `captureReach`): the pole
// 4.1 m over the ground a soldier stands on (the community map shigaisen_C's
// six flags, on a floor over the street) leaves sqrt(25 - 16.81) = 2.86 m of
// a 5 m radius, a 1.86 m ring; 4.1 m under it (a pole in a pit) the same;
// 4.7 m leaves 1.71 m, no ring a body stands in, and the engine's order. A
// 10 m flag is at least R' wide and keeps the engine's order on its own
// ground, and 8.5 m over it is 5.27 m wide there: a 4.27 m ring.
const lifted = onGround(3 - 4.1);
const liftedEnd = walkOrder(lifted.wp, [60, -100]);
const wideOnGround = (y, radius) => ringOrder(yardOf(radius), { unitOf: () => ({ type: 'Infantery', isWalkable: null, radius: 1.0, mounted: false,
                                                                                 groundAt: () => y }) });
const ground3d = {
  lifted: plain(lifted),
  liftedEndToFlag: toFlag(liftedEnd, lifted.flag),
  // The capture law's own measure of where the walk ended: 3D, to the pole.
  liftedEnd3d: +Math.hypot(toFlag(liftedEnd, lifted.flag), 4.1).toFixed(3),
  liftedArrived: lifted.wp.arrived,
  // Outside the ring and inside what the flat figure allowed (4 m): asked for.
  liftedOutside: +lifted.wp.urgency(106 - 3, -100).toFixed(3), liftedOutsideArrived: lifted.wp.arrived,
  // A ring the ground cut is asked for against its own radius (1.862 m): on
  // its edge the law's own floor (0.25 x 2); from 1.155 radii (2.15 m) more
  // than a look round asks (Scout's 1.0 over MoveTo's 1.5); from two radii
  // the whole of it.
  liftedAtEdge: +lifted.wp.urgency(106 - 1.8619, -100).toFixed(3),
  liftedOverScout: [lifted.wp.urgency(106 - 2.14, -100) * 1.5 < 1, lifted.wp.urgency(106 - 2.16, -100) * 1.5 > 1],
  liftedTwoRadii: lifted.wp.urgency(106 - 3.73, -100),
  pit: plain(onGround(3 + 4.1)),
  thin: plain(onGround(3 - 4.7)),
  wideLevel: plain(wideOnGround(3, 10)).flag,
  wideLifted: plain(wideOnGround(3 - 8.5, 10)),
  law: {
    reach: [captureReach({ radius: 5 }), captureReach({ radius: 5 }, 3), captureReach({ radius: 5 }, -4.1),
            captureReach({ radius: 5 }, 5), captureReach({ radius: 5 }, 13.5), captureReach({}, 0)].map(v => +v.toFixed(3)),
    stand: [captureStandRadius({ radius: 5 }), captureStandRadius({ radius: 5 }, 3), captureStandRadius({ radius: 5 }, 3.2),
            captureStandRadius({ radius: 5 }, -4.1), captureStandRadius({ radius: 5 }, 4.7), captureStandRadius({ radius: 5 }, 13.5),
            captureStandRadius({ radius: 1.5 }), captureStandRadius({ radius: 10 }, 8.5)].map(v => +v.toFixed(3)),
  },
};
// No route: the bot hands the ring back and the next pass orders it the
// engine's way, for that flag only.
const lost = ringOrder(yardOf(5));
lost.wp.noRoute();
const afterNoRoute = lost.sai._order(lost.rec, lost.sai.layer.areas[0], 1);
const captureRing = {
  narrow: narrowPins,
  engineDraw, engineRr: Math.round(wide.wp.radius) + 1,
  wide: { ...plain(wide), endToPoint: +Math.hypot(wideEnd[0] - wide.wp.point[0], wideEnd[1] - wide.wp.point[1]).toFixed(3) },
  unset: plain(ringOrder(yardOf(null))),
  held: plain(ringOrder(yardOf(5, 1))),
  losing: plain(ringOrder(losing)),
  hull: plain(hull),
  beside: plain(beside),
  walled: plain(walled).flag,
  groundNear: plain(onGround(0.5)).flag, groundFar: plain(onGround(-10.5)).flag,
  ground3d,
  afterNoRoute: { point: afterNoRoute.point, flag: afterNoRoute.captureFlag?.name ?? null },
};
const bindings = layer => layer.areas.map(a => [a.name, a.controlPoints.map(f => f.name), layer.ownerOf(a)]);
const captureOnly = {
  midway: bindings(midway),
  controlPoints: { neutralSeas, axisSeas },
  salerno: bindings(salerno),
};
const pins = {
  air, orderInside, prereq, presence, airHold, captureOnly, captureRing,
  corner: ia.corner, centre: ia.centre, min: ia.min, max: ia.max, sideRadius: +ia.sideRadius.toFixed(3),
  cpInside: island.isInside(ia, 838, -722), r0, r1: r1.map(v => +v.toFixed(3)),
  tankRadius: +wpTank.radius.toFixed(3), inR, inRArrived, outU,
  blockedPoint: wpBlocked.point, tankPosPoint: wpTankPos.point, keptAt30, movedAt36,
};

process.stdout.write(JSON.stringify({ fromScene: !!scenePath && fs.existsSync(scenePath), areas, sides, orders, compare, pins }));
