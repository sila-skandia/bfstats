// Pins the no-live-strategy fallback (features/bot-map-generation/no-live-strategy.md;
// INVENTION, viewer/strategic-ai.js `_holdOnlyFallback`): on a generated
// layer a side none of whose strategies scores above 0, whose kept strategy
// finds nothing to attack, and which has a capturable flag to take, holds no
// order and its bots take the no-layer order; a side that still has a target,
// or holds every capturable flag, keeps the SAI; a layer
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
// point. In the plain layout each side holds its fixed base and one of the
// two middle flags, so the enemy holds two: no strategy qualifies for either
// side, and each still attacks the other's middle flag.
//
// `cut`: the Axis' base touches no other area and the Allies hold both middle
// flags (a level that starts the Axis on a base with no way out on the area
// graph): the Axis have no live strategy and nothing to attack, while two
// flags they could take stand. `outOfPlay`: the generator took the middle
// flags out of play (`setTakeable 1 0`, `setTakeable 2 0`). `live`: the
// strategy has no prerequisite, so it scores 1 for both sides.
function level(generated, { cut = false, outOfPlay = false, live = false } = {}) {
  const mid = outOfPlay ? { 1: false, 2: false } : {};
  return {
    strategicAreas: [
      { name: 'AxisBase', min: [50, -150], max: [150, -50], radius: 50, neighbours: cut ? [] : ['West'], flags: ['Base'], orderPositions: { Infantry: [100, -100] }, side: 1, takeable: { 2: false } },
      { name: 'West', min: [350, -550], max: [450, -450], radius: 60, neighbours: cut ? ['East'] : ['AxisBase', 'East'], flags: ['ControlPoint'], orderPositions: { Infantry: [400, -500] }, side: cut ? 2 : 1, takeable: mid },
      { name: 'East', min: [550, -550], max: [650, -450], radius: 60, neighbours: ['West', 'AlliedBase'], flags: ['ControlPoint'], orderPositions: { Infantry: [600, -500] }, side: 2, takeable: mid },
      { name: 'AlliedBase', min: [850, -950], max: [950, -850], radius: 50, neighbours: ['East'], flags: ['Base'], orderPositions: { Infantry: [900, -900] }, side: 2, takeable: { 1: false } },
    ],
    conditions: [{ name: 'maxOneEnemyCP', kind: 'Constant', fuzzy: 'Crisp', op: 'EqualSmaller', subject: 'Enemy', object: 'ControlPoint', value: 1, strength: ['Required'], abort: false }],
    prerequisites: [{ name: 'singlePrereq', conditions: [{ name: 'maxOneEnemyCP', weight: 10 }] }],
    strategies: [{ name: 'single', aggression: 1, attacks: 1, defences: 0, timeLimit: 200, prerequisite: live ? null : 'singlePrereq', modifiers: [] }],
    sideStrategies: { 1: ['single'], 2: ['single'] },
    ...(generated ? { generated: { generator: 'botgen', template: 'few' } } : {}),
  };
}
const flagsAt = ({ cut = false, allHeld = false } = {}) => [
  { name: 'AxisBase', controlPointName: 'AxisBase', position: [150, 0, -150], team: 1, uncapturable: true },
  { name: 'West', controlPointName: 'West', position: [450, 0, -550], team: allHeld ? 1 : cut ? 2 : 1, uncapturable: false },
  { name: 'East', controlPointName: 'East', position: [650, 0, -550], team: allHeld ? 1 : 2, uncapturable: false },
  { name: 'AlliedBase', controlPointName: 'AlliedBase', position: [950, 0, -950], team: 2, uncapturable: true },
];

function run(generated, opts = {}) {
  const flags = flagsAt(opts);
  const layer = new StrategicLayer(level(generated, opts), flags);
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
  // The plain layout: the Allies lose East, the Axis now face one enemy
  // control point and `single` qualifies for them. Cut: the Axis take West,
  // which touches East: a target.
  flags.find(f => f.name === (opts.cut ? 'West' : 'East')).team = 1;
  cmd.update(2.5, alive);
  const after = picture();
  return { before, after };
}

const out = {
  // No strategy scores, and the kept one still attacks: the SAI plays on.
  targets: run(true),
  // No strategy scores for the Axis and nothing to attack: the fallback.
  cut: run(true, { cut: true }),
  // The Axis' strategy live, and still nothing to attack: the fallback too.
  liveCut: run(true, { cut: true, live: true }),
  // The same with every flag out of play: a flag out of play still counts, as
  // on a level with no layer.
  outOfPlay: run(true, { cut: true, outOfPlay: true }),
  // The Axis hold every capturable flag: nothing to take, the SAI keeps them.
  allHeld: run(true, { cut: true, allHeld: true }),
  // The same with no `generated` marker: the engine's rule.
  shippedCut: run(false, { cut: true }),
};

// The bot's side of it: `fallbackWaypoint` answers on a level with areas only
// while `noLayerOrder` holds, and then with the nearest flag it does not hold.
const world = { extras: { ai: { strategicAreas: [{ name: 'x' }], generated: { unreachable: [] } } }, flags: flagsAt(), collider: null };
const bot = { world, team: 1, position: [400, 0, -560], _fallback: null };
bot._nearestEnemyFlag = () => decision.nearestEnemyFlag(bot);
out.waypointWithLayer = decision.fallbackWaypoint(bot)?.flag?.name ?? null;
bot.noLayerOrder = true;
out.waypointNoLayerOrder = decision.fallbackWaypoint(bot)?.flag?.name ?? null;

// The lint.
const startOf = (opts, flags = flagsAt(opts)) => lint.liveStrategiesAtStart({ StrategicLayer, StrategicAI, ai: level(true, opts), flags });
const warningsOf = (start, opts = {}) => lint.lintLayer({ ai: level(true, opts), flags: [], startStrategies: start })
  .warnings.filter(w => w.check === 'strategy').map(w => w.text);
out.lintStart = startOf({ cut: true });
out.lintWarnings = warningsOf(out.lintStart, { cut: true });
out.lintErrors = lint.lintLayer({ ai: level(true, { cut: true }), flags: [], startStrategies: out.lintStart }).errors.filter(e => e.check === 'strategy').length;
out.lintTargetWarnings = warningsOf(startOf({}));
out.lintLiveCutWarnings = lint.lintLayer({ ai: level(true, { cut: true, live: true }), flags: [], startStrategies: startOf({ cut: true, live: true }) }).warnings
  .filter(w => w.check === 'strategy' || w.check === 'target').map(w => `${w.check}: ${w.text}`);
out.lintAllHeldWarnings = warningsOf(startOf({ cut: true, allHeld: true }), { cut: true });
const liveFlags = flagsAt(); liveFlags.find(f => f.name === 'East').team = 1;
out.lintLiveWarnings = warningsOf(startOf({}, liveFlags));

process.stdout.write(JSON.stringify(out) + '\n');
