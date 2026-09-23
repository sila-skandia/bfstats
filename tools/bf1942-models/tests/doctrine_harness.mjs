// Drives `viewer/doctrine.js` and `viewer/doctrine-squad.js` on an inline
// three-area level: the 'sai' doctrine behind the command gives the orders
// the bare SAI gives, the `WPCloseTo` law, the order contract, the doctrine
// spec, and the squad play's leaders, followers, holds and boarding.
//
// Run by `tests/test_doctrine.py`. One JSON object on stdout.

import {
  StrategicLayer, StrategicAI, StrategicCommand, closeToOrder, checkOrder, parseDoctrineSpec, ORDER_KINDS, SQUAD,
} from './strategic.js';

const AI = {
  strategicAreas: [
    { name: 'AxisBase', min: [50, -150], max: [150, -50], radius: 50, neighbours: ['Mid'], flags: ['Base'], orderPositions: { Infantery: [100, -100] }, side: 1, takeable: { 2: false } },
    { name: 'Mid', min: [450, -550], max: [550, -450], radius: 100, neighbours: ['AxisBase', 'AlliedBase'], flags: ['ControlPoint', 'Centre'], orderPositions: { Infantery: [500, -500] }, side: null, takeable: {} },
    { name: 'AlliedBase', min: [850, -950], max: [950, -850], radius: 50, neighbours: ['Mid'], flags: ['Base'], orderPositions: { Infantery: [900, -900] }, side: 2, takeable: { 1: false } },
  ],
  conditions: [
    { name: 'broadCond', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualGreater', subject: 'Enemy', object: 'Front', value: 0, strength: ['Required'], abort: false },
  ],
  prerequisites: [{ name: 'broadPrereq', conditions: [{ name: 'broadCond', weight: 5.0 }] }],
  strategies: [
    { name: 'broad', aggression: 1.0, attacks: 3, defences: 0, timeLimit: 400, prerequisite: 'broadPrereq', modifiers: [{ flag: 'ControlPoint', factor: 2.0, owner: null }] },
    { name: 'hold', aggression: 0.2, attacks: 1, defences: 1, timeLimit: 60, prerequisite: 'broadPrereq', modifiers: [] },
  ],
  sideStrategies: { 1: ['broad', 'hold'], 2: ['broad', 'hold'] },
};
const FLAGS = () => [
  { name: 'AxisBase', position: [100, 0, -100], team: 1 },
  { name: 'Mid', position: [500, 0, -500], team: 0 },
  { name: 'AlliedBase', position: [900, 0, -900], team: 2 },
];
const rng = (s) => () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
const round = (v) => Math.round(v * 1000) / 1000;
const orderKey = (o) => (o ? { kind: o.kind, area: o.area?.name ?? null, point: o.point.map(round), radius: round(o.radius) } : null);

// --- 1. 'sai' behind the command == the bare SAI ------------------------------

function positionsAt(t) {
  const alive = new Map();
  for (const side of [1, 2]) {
    const [bx, bz] = side === 1 ? [100, -100] : [900, -900];
    for (let i = 0; i < 6; i++) {
      // Walking toward the middle, a bot a side down between 20 and 30 s.
      if (i === 2 && t >= 20 && t < 30) continue;
      const f = Math.min(1, t / 120);
      alive.set(`b${side}_${i}`, [bx + (500 - bx) * f + i, 0, bz + (-500 - bz) * f - i]);
    }
  }
  return alive;
}

function runBare() {
  const sai = new StrategicAI(new StrategicLayer(AI, FLAGS()), { random: rng(7) });
  for (const side of [1, 2]) for (let i = 0; i < 6; i++) sai.addBot(`b${side}_${i}`, side);
  const log = [];
  for (let n = 1; n <= 60 * 30; n++) {
    const t = n / 30;
    if (n === 20 * 30) { sai.botDied('b1_2'); sai.botDied('b2_2'); }
    if (n === 45 * 30) sai.botChangedUnit('b1_4');
    sai.update(1 / 30, positionsAt(t));
    if (n % 15 === 0) log.push([...sai.bots.keys()].map(id => orderKey(sai.waypointsOf(id))));
  }
  return { log, strategies: [1, 2].map(s => sai.sides[s].active?.strategy.name) };
}

function runCommand() {
  const sai = new StrategicAI(new StrategicLayer(AI, FLAGS()), { random: rng(7) });
  const cmd = new StrategicCommand(sai, { doctrine: 'sai' });
  for (const side of [1, 2]) for (let i = 0; i < 6; i++) cmd.addBot(`b${side}_${i}`, side);
  const log = [];
  for (let n = 1; n <= 60 * 30; n++) {
    const t = n / 30;
    if (n === 20 * 30) { cmd.botDied('b1_2'); cmd.botDied('b2_2'); }
    if (n === 45 * 30) cmd.botChangedUnit('b1_4');
    cmd.update(1 / 30, positionsAt(t));
    if (n % 15 === 0) log.push([...cmd.roster.keys()].map(id => orderKey(cmd.waypointsOf(id))));
  }
  return { log, strategies: [1, 2].map(s => cmd.sides[s].active?.strategy.name), passes: cmd.passes };
}

const bare = runBare();
const viaCommand = runCommand();
const saiEquivalent = {
  identical: JSON.stringify(bare) === JSON.stringify({ log: viaCommand.log, strategies: viaCommand.strategies }),
  samples: bare.log.length,
  ordered: bare.log.at(-1).filter(Boolean).length,
  passes: viaCommand.passes,
};

// --- 2. the WPCloseTo law ---------------------------------------------------

let goal = [0, 0, 0];
const f = closeToOrder({ kind: 'WPFollow', goalOf: () => goal, radius: 2, targetRadius: 1 });
const g = closeToOrder({ kind: 'WPFollow', goalOf: () => goal, radius: 2, targetRadius: 3.5 });
const closeTo = {
  radiusFloor: f.radius,                 // max(5, 2, 2 x 1) = 5
  radiusBounding: g.radius,              // max(5, 2, 2 x 3.5) = 7
  inside: f.urgency(3, 0, 1, 0), insideArrived: f.arrived,
  atR: f.urgency(5, 0, 1, 0),            // d^2 = R^2 is outside: 25 / 100
  sevenFive: round(f.urgency(7.5, 0, 1, 0)),
  far: f.urgency(40, 0, 1, 0),           // min(1, ...)
  threeD: round(f.urgency(0, 0, 1, 6)),  // height counts: 36 / 100
  noFloor: f.urgency(5.1, 0, 1, 0) < 0.3,
};
const tick = ORDER_KINDS.get('WPFollow').tick;
goal = [4, 0, 0];
closeTo.movedLessThanR = tick(f, { position: [50, 0, 0] }) === null;
goal = [6, 0, 0];
const regoal = tick(f, { position: [50, 0, 0] });
closeTo.movedPastR = !!regoal && regoal !== f && regoal.point[0] === 6;
closeTo.insideNoRegoal = tick(f, { position: [6, 0, 1] }) === null;
goal = null;
closeTo.lost = f.urgency(10, 0, 1, 0) === 0 && f.lost;

// --- 3. the contract and the spec --------------------------------------------

const refuses = (o) => { try { checkOrder(o); return false; } catch { return true; } };
const contract = {
  unknownKind: refuses({ kind: 'WPTeleport', point: [0, 0], radius: 5, urgency: () => 0 }),
  noUrgency: refuses({ kind: 'WPMoveTo', point: [0, 0], radius: 5 }),
  areaWithoutInside: refuses({ kind: 'WPMoveTo', point: [0, 0], radius: 5, urgency: () => 0, area: {} }),
  nullIsNoOrder: checkOrder(null) === null,
  kinds: [...ORDER_KINDS.keys()].sort(),
};
const spec = {
  none: parseDoctrineSpec(null),
  both: parseDoctrineSpec('squad'),
  axis: parseDoctrineSpec('axis=squad'),
  sides: parseDoctrineSpec('1=sai,2=squad'),
  unknown: (() => { try { parseDoctrineSpec('rush'); return false; } catch { return true; } })(),
};

// --- 4. the squad play ---------------------------------------------------------

function squadWorld({ seats = [], walkable = null } = {}) {
  const units = new Map();
  const unitOf = id => units.get(id) ?? { type: 'Infantery', radius: 1.0, mounted: false };
  // The referee hands both the SAI and the command its `strategicUnit`.
  const sai = new StrategicAI(new StrategicLayer(AI, FLAGS()), { random: rng(3), unitOf });
  const entered = [];
  const cands = seats;
  const cmd = new StrategicCommand(sai, {
    doctrine: 'axis=squad', isWalkable: walkable, unitOf,
    candidatesOf: () => cands,
    actuators: { enter: (id, candId) => entered.push([id, candId]), exit: () => {} },
  });
  for (const side of [1, 2]) for (let i = 0; i < 8; i++) cmd.addBot(`s${side}_${i}`, side);
  return { sai, cmd, entered, cands, units };
}

// Axis at its base in a column along +x; a pass is due at once (dt 2).
const base = (overrides = {}) => {
  const alive = new Map();
  for (const side of [1, 2]) {
    const [bx, bz] = side === 1 ? [100, -100] : [900, -900];
    for (let i = 0; i < 8; i++) alive.set(`s${side}_${i}`, [bx + i, 0, bz]);
  }
  for (const [id, p] of Object.entries(overrides)) alive.set(id, p);
  return alive;
};

const w1 = squadWorld();
w1.cmd.update(2, base());
const o = (id) => w1.cmd.waypointsOf(id);
const lead0 = o('s1_0'), fol1 = o('s1_1'), fol2 = o('s1_2'), fol3 = o('s1_3');
const heading = (() => { const d = [lead0.point[0] - 100, lead0.point[1] + 100]; const n = Math.hypot(...d); return d.map(v => v / n); })();
const expectSlot = ([side, back]) => [100 + side * heading[1] - back * heading[0], -100 - side * heading[0] - back * heading[1]];
const squad = {
  squads: w1.cmd.doctrines[1].squads.map(s => s.members),
  leaders: w1.cmd.doctrines[1].squads.map(s => s.leader),
  leaderKinds: [o('s1_0')?.kind, o('s1_4')?.kind],
  followerKinds: [fol1?.kind, fol2?.kind, fol3?.kind, o('s1_5')?.kind],
  followerLeader: [fol1?.leaderId, o('s1_5')?.leaderId],
  followerArea: fol1?.area?.name ?? null, leaderArea: lead0?.area?.name ?? null,
  slot1: fol1.point.map(round), slot1Expected: expectSlot(SQUAD.slots[0]).map(round),
  slot3: fol3.point.map(round), slot3Expected: expectSlot(SQUAD.slots[2]).map(round),
  alliesAllSai: [0, 1, 2, 3, 4, 5, 6, 7].map(i => w1.cmd.waypointsOf(`s2_${i}`)?.kind ?? null),
};

// A follower 30 m out: the leader holds; 150 m out (a fresh respawn): he does not.
const w2 = squadWorld();
w2.cmd.update(2, base({ s1_1: [100, 0, -130] }));
const w3 = squadWorld();
w3.cmd.update(2, base({ s1_1: [100, 0, -250] }));
// The hold lasts `holdMax`, then the cooldown.
const holdTimeline = [];
for (let t = 2; t <= 40; t += 2) {
  if (t > 2) w2.cmd.update(2, base({ s1_1: [100, 0, -130] }));
  holdTimeline.push(w2.cmd.waypointsOf('s1_0')?.kind);
}
const hold = {
  heldAt30: w2.cmd.doctrines[1].counts.holds >= 1,
  notAt150: w3.cmd.waypointsOf('s1_0')?.kind,
  timeline: holdTimeline,
};

// Boarding: the leader drives a hull with two free seats; one follower is
// at the door, one 40 m off, one 90 m off (past `boardRange`).
const hullSeats = [
  { id: 'H:driver', vehicleId: 'H', seatId: 'driver', isRoot: true, drives: true, kind: 'tank', pos: [100, 0, -100], entry: [102, -100], entryRadius: 2.5, occupiedBy: 's1_0' },
  { id: 'H:gunner', vehicleId: 'H', seatId: 'gunner', isRoot: false, drives: false, kind: 'tank', pos: [100, 0, -100], entry: [98, -100], entryRadius: 2.5, occupiedBy: null },
  { id: 'H:mg', vehicleId: 'H', seatId: 'mg', isRoot: false, drives: false, kind: 'tank', pos: [100, 0, -100], entry: [98, -100], entryRadius: 2.5, occupiedBy: null },
];
const w4 = squadWorld({ seats: hullSeats });
w4.units.set('s1_0', { type: 'Tank', radius: 3.0, mounted: true });
w4.cmd.update(2, base({ s1_0: [100, 0, -100], s1_1: [98.5, 0, -100], s1_2: [100, 0, -140], s1_3: [100, 0, -190] }));
const b1 = w4.cmd.waypointsOf('s1_1'), b2 = w4.cmd.waypointsOf('s1_2'), b3 = w4.cmd.waypointsOf('s1_3');
const board = {
  kinds: [b1?.kind, b2?.kind, b3?.kind],
  seats: [b1?.candId, b2?.candId],
  leader: w4.cmd.waypointsOf('s1_0')?.kind,
  entered: w4.entered.slice(),
};
// A tick later nothing new: the gunner at the door pressed Use once a tick.
w4.cmd.update(1 / 30, base({ s1_0: [100, 0, -100], s1_1: [98.5, 0, -100], s1_2: [100, 0, -140], s1_3: [100, 0, -190] }));
board.enteredAfterTick = w4.entered.length;

// A follower at the wheel of another hull leads.
const w5 = squadWorld({ seats: [
  { id: 'J:driver', vehicleId: 'J', seatId: 'driver', isRoot: true, drives: true, kind: 'ground', pos: [110, 0, -100], entry: [112, -100], entryRadius: 2.5, occupiedBy: 's1_2' },
] });
w5.cmd.update(2, base());
const driverLeads = { leader: w5.cmd.doctrines[1].squads[0].leader, kind: w5.cmd.waypointsOf('s1_2')?.kind,
                      follows: w5.cmd.waypointsOf('s1_0')?.leaderId ?? w5.cmd.waypointsOf('s1_0')?.kind };

// An aircraft leader: the followers on foot go to the SAI.
const w6 = squadWorld({ seats: [
  { id: 'P:pilot', vehicleId: 'P', seatId: 'pilot', isRoot: true, drives: true, kind: 'air', pos: [100, 80, -100], entry: [100, -100], entryRadius: 2.5, occupiedBy: 's1_0' },
] });
w6.units.set('s1_0', { type: 'Plane', air: true, radius: 10, mounted: true, groundAt: () => 0 });
w6.cmd.update(2, base({ s1_0: [100, 80, -100] }));
const air = { leader: w6.cmd.waypointsOf('s1_0')?.kind, followers: ['s1_1', 's1_2', 's1_3'].map(id => w6.cmd.waypointsOf(id)?.kind) };

// A follower riding another hull 40 m off gets out; one at the wheel of his
// own hull 300 m behind makes the leader hold.
const exited = [];
const w7 = squadWorld({ seats: [
  { id: 'K:driver', vehicleId: 'K', seatId: 'driver', isRoot: true, drives: true, kind: 'tank', pos: [100, 0, -140], entry: [102, -140], entryRadius: 2.5, occupiedBy: null },
  { id: 'K:gunner', vehicleId: 'K', seatId: 'gunner', isRoot: false, drives: false, kind: 'tank', pos: [100, 0, -140], entry: [98, -140], entryRadius: 2.5, occupiedBy: 's1_1' },
  { id: 'L:driver', vehicleId: 'L', seatId: 'driver', isRoot: true, drives: true, kind: 'ground', pos: [100, 0, -400], entry: [102, -400], entryRadius: 2.5, occupiedBy: 's1_4' },
  { id: 'M:driver', vehicleId: 'M', seatId: 'driver', isRoot: true, drives: true, kind: 'ground', pos: [100, 0, -100], entry: [102, -100], entryRadius: 2.5, occupiedBy: 's1_5' },
] });
w7.cmd.actuators.exit = id => exited.push(id);
w7.cmd.update(2, base({ s1_1: [100, 0, -140], s1_4: [100, 0, -400], s1_5: [100, 0, -100] }));
const leave = { kind: w7.cmd.waypointsOf('s1_1')?.kind, exited: exited.slice(),
                // Squad 2: s1_4 and s1_5 both drive; s1_4 leads (first), s1_5
                // at the wheel 300 m off makes him hold.
                leader2: w7.cmd.doctrines[1].squads[1].leader, leader2Kind: w7.cmd.waypointsOf('s1_4')?.kind,
                leaves: w7.cmd.doctrines[1].counts.leaveOrders };

process.stdout.write(JSON.stringify({ saiEquivalent, closeTo, contract, spec, squad, hold, board, driverLeads, air, leave }));
