// Pins the no-live-strategy fallback (features/bot-map-generation/no-live-strategy.md;
// INVENTION, viewer/strategic-ai.js `_noLiveStrategyFallback`): on a generated
// layer a side none of whose strategies scores above 0, and whose kept
// strategy finds nothing to attack, holds no order and its bots take the
// no-layer order; a side that still has a target keeps the SAI; a layer
// without the `generated` marker keeps the engine's rule (the strategy it
// has). Also the lint's warning (`sim/botlint.mjs liveStrategiesAtStart`).
// Run by `tests/test_bot_no_live_strategy.py`. One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const env = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
env.installModuleHooks(VIEWER);
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const strategic = await imp('viewer/strategic.js');
const decision = await imp('viewer/bot-decision.js');
const lint = await imp('sim/botlint.mjs');
const { StrategicLayer, StrategicAI, StrategicCommand } = strategic;

// Kursk's `single`: alive only while the enemy holds at most one control
// point. Each side starts on its fixed base and holds one of the two middle
// flags, so the enemy holds two: no strategy qualifies for either side.
function level(generated) {
  return {
    strategicAreas: [
      { name: 'AxisBase', min: [50, -150], max: [150, -50], radius: 50, neighbours: ['West'], flags: ['Base'], orderPositions: { Infantry: [100, -100] }, side: 1, takeable: { 2: false } },
      { name: 'West', min: [350, -550], max: [450, -450], radius: 60, neighbours: ['AxisBase', 'East'], flags: ['ControlPoint'], orderPositions: { Infantry: [400, -500] }, side: 1, takeable: {} },
      { name: 'East', min: [550, -550], max: [650, -450], radius: 60, neighbours: ['West', 'AlliedBase'], flags: ['ControlPoint'], orderPositions: { Infantry: [600, -500] }, side: 2, takeable: {} },
      { name: 'AlliedBase', min: [850, -950], max: [950, -850], radius: 50, neighbours: ['East'], flags: ['Base'], orderPositions: { Infantry: [900, -900] }, side: 2, takeable: { 1: false } },
    ],
    conditions: [{ name: 'maxOneEnemyCP', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualSmaller', subject: 'Enemy', object: 'ControlPoint', value: 1, strength: ['Required'], abort: false }],
    prerequisites: [{ name: 'singlePrereq', conditions: [{ name: 'maxOneEnemyCP', weight: 10 }] }],
    strategies: [{ name: 'single', aggression: 1, attacks: 1, defences: 0, timeLimit: 200, prerequisite: 'singlePrereq', modifiers: [] }],
    sideStrategies: { 1: ['single'], 2: ['single'] },
    ...(generated ? { generated: { generator: 'botgen', template: 'few' } } : {}),
  };
}
// `standIns`: Edson's Ridge's shape. A spawn group no control point claims is
// a standalone, uncapturable flag (spawn-flags.js); listed before the middle
// flags, which own no spawn (`captureOnly`), it takes their area first, so
// each middle area holds only an uncapturable flag and no side can attack it.
const flagsAt = (standIns = false) => [
  { name: 'AxisBase', position: [150, 0, -150], team: 1, uncapturable: true },
  ...(standIns ? [
    { name: 'sbWest', position: [440, 0, -540], team: 1, uncapturable: true, standalone: true },
    { name: 'sbEast', position: [640, 0, -540], team: 2, uncapturable: true, standalone: true },
  ] : []),
  { name: 'West', position: [450, 0, -550], team: 1, uncapturable: false, captureOnly: standIns },
  { name: 'East', position: [650, 0, -550], team: 2, uncapturable: false, captureOnly: standIns },
  { name: 'AlliedBase', position: [950, 0, -950], team: 2, uncapturable: true },
];

function run(generated, standIns) {
  const flags = flagsAt(standIns);
  const layer = new StrategicLayer(level(generated), flags);
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  const sai = new StrategicAI(layer, { random });
  const cmd = new StrategicCommand(sai, { doctrine: 'garrison', random });
  const alive = new Map();
  for (const side of [1, 2]) {
    const p = side === 1 ? [100, -100] : [900, -900];
    for (let i = 0; i < 4; i++) { const id = `b${side}${i}`; cmd.addBot(id, side); alive.set(id, [p[0] + i, 0, p[1]]); }
  }
  const ids = side => [...cmd.roster].filter(([, s]) => s === side).map(([id]) => id);
  const picture = () => Object.fromEntries([1, 2].map(side => [side, {
    fallback: sai.sides[side].fallback,
    live: sai.sides[side].containers.some(c => c.score > 0),
    orders: ids(side).map(id => cmd.waypointsOf(id)?.kind ?? null),
    noLayer: ids(side).map(id => cmd.noLayerOrder(id)),
    guns: ids(side).map(id => cmd.gunsRuleOf(id)),
    active: sai.sides[side].active?.strategy.name ?? null,
    attacks: sai.sides[side].attacks.map(a => a.name),
  }]));
  cmd.update(2.5, alive);
  const before = picture();
  // The Allies lose East: the Axis now face one enemy control point and
  // `single` qualifies for them; the Allies face two and still have none.
  flags.find(f => f.name === 'East').team = 1;
  cmd.update(2.5, alive);
  const after = picture();
  return { before, after };
}

const out = {
  // No strategy scores, and the kept one still attacks: the SAI plays on.
  targets: run(true, false),
  // No strategy scores, and nothing to attack: the fallback.
  standIns: run(true, true),
  // The same with no `generated` marker: the engine's rule.
  shippedStandIns: run(false, true),
};

// The bot's side of it: `fallbackWaypoint` answers on a level with areas only
// while `noLayerOrder` holds, and then with the nearest flag it does not hold.
const world = { extras: { ai: { strategicAreas: [{ name: 'x' }] } }, flags: flagsAt(), collider: null };
const bot = { world, team: 1, position: [400, 0, -560], _fallback: null };
bot._nearestEnemyFlag = () => decision.nearestEnemyFlag(bot);
out.waypointWithLayer = decision.fallbackWaypoint(bot)?.flag?.name ?? null;
bot.noLayerOrder = true;
out.waypointNoLayerOrder = decision.fallbackWaypoint(bot)?.flag?.name ?? null;

// The lint.
const startOf = standIns => lint.liveStrategiesAtStart({ StrategicLayer, StrategicAI, ai: level(true), flags: flagsAt(standIns) });
const warningsOf = start => lint.lintLayer({ ai: level(true), flags: [], startStrategies: start });
out.lintStart = startOf(true);
const res = warningsOf(out.lintStart);
out.lintWarnings = res.warnings.filter(w => w.check === 'strategy').map(w => w.text);
out.lintErrors = res.errors.filter(e => e.check === 'strategy').length;
out.lintTargetWarnings = warningsOf(startOf(false)).warnings.filter(w => w.check === 'strategy').map(w => w.text);
const liveFlags = flagsAt(); liveFlags.find(f => f.name === 'East').team = 1;
out.lintLiveWarnings = warningsOf(lint.liveStrategiesAtStart({ StrategicLayer, StrategicAI, ai: level(true), flags: liveFlags }))
  .warnings.filter(w => w.check === 'strategy').map(w => w.text);

process.stdout.write(JSON.stringify(out) + '\n');
