// Drives `viewer/strategic.js` on a level's real `extras.ai` (El Alamein's
// scene.json when the extracted tree is present, else an inline fixture):
// the areas bind to the control points, each side chooses a strategy through
// its prerequisites, attack targets are areas with an owned neighbour that
// the side does not hold, and every bot gets a WPMoveTo order whose urgency
// follows `WPMoveTo::getUrgency`. Also pins `compareCondition`.
//
// Run by `tests/test_strategic.py`. One JSON object on stdout.

import fs from 'node:fs';
import { StrategicLayer, StrategicAI, compareCondition } from './strategic.js';

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

process.stdout.write(JSON.stringify({ fromScene: !!scenePath && fs.existsSync(scenePath), areas, sides, orders, compare }));
