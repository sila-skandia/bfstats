// Pins the generated bot layers' pure halves (features/bot-map-generation):
// the area rule and its script (`sim/botgen.mjs`), the lint (`sim/botlint.mjs`),
// the trace detectors (`sim/detect.mjs`), the judge (`sim/judge.mjs`), the
// painter's doorways (`viewer/nav-map.js carveDoors`) and the menu's tag.
// Run by `tests/test_bot_layer.py`. One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const gen = await imp('sim/botgen.mjs');
const lint = await imp('sim/botlint.mjs');
const det = await imp('sim/detect.mjs');
const jud = await imp('sim/judge.mjs');
const nav = await imp('viewer/nav-grid.js');
const menu = await imp('viewer/play/menu-screen.js');
const out = {};

// --- the area rule ---------------------------------------------------------
const flags = [
  { name: 'AxisBase', x: 100, y: 10, z: -200, radius: 5, team: 1, fixed: true },
  { name: 'AlliedBase', x: 300, y: 10, z: -200, radius: 5, team: 2, fixed: true },
  { name: 'Middle', x: 200, y: 10, z: -205, radius: 12, team: 0, fixed: false },
  { name: 'North', x: 200, y: 10, z: -270, radius: 60, team: 1, fixed: false },
  { name: 'Island', x: 150, y: 10, z: -120, radius: 8, team: 2, fixed: false },
];
const hooks = {
  orderPosition: (x, z) => [Math.floor(x) + 0.5, Math.floor(z) + 0.5],
  // The island has no route to anything.
  route: (p, q) => ((p[1] > -130) !== (q[1] > -130) ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1])),
};
const areas = gen.buildAreas(flags, hooks);
out.areas = areas.map(a => ({ name: a.name, flags: a.flags, value: a.value, half: a.half, neighbours: a.neighbours }));
out.con = gen.areasCon(areas);
out.conAgain = gen.areasCon(gen.buildAreas(flags, hooks)) === out.con;
out.aiCon = gen.aiCon({ worldSize: 1024, viewDistance: 200, strategies: ['flank', 'broad'] });

// --- the lint ----------------------------------------------------------------
const W = 64;
const grid = { width: W, height: W, cellSize: 1, blocked: new Uint8Array(W * W) };
for (let z = 0; z < W; z++) grid.blocked[z * W + 32] = 4;          // a wall splits the map
grid.blocked[10 * W + 32] = 0;                                      // with one gap
const walk = (g, x, z) => { const gx = Math.floor(x), gz = Math.floor(-z); return gx >= 0 && gz >= 0 && gx < W && gz < W && !g.blocked[gz * W + gx]; };
const area = (name, x, z, extra = {}) => ({ name, min: [x - 5, z], max: [x, z + 5], radius: 10, neighbours: [], flags: ['ControlPoint'], orderPositions: { Infantry: [x + 0.5, z - 0.5] }, ...extra });
const good = {
  strategicAreas: [area('A', 10, -10, { neighbours: ['B'] }), area('B', 50, -10, { neighbours: ['A'] })],
  strategies: [{ name: 's', prerequisite: 'p', modifiers: [{ flag: 'ControlPoint', factor: 2 }] }],
  prerequisites: [{ name: 'p', conditions: [{ name: 'c', weight: 1 }, { name: 'homogenous', weight: 1 }] }],
  conditions: [{ name: 'c' }], sideStrategies: { 1: ['s'], 2: ['s'] },
};
const lf = [{ name: 'A', x: 10, y: 0, z: -10, radius: 5, team: 1, fixed: false }, { name: 'B', x: 50, y: 0, z: -10, radius: 5, team: 2, fixed: false }];
const run = (ai, f = lf, g = grid, extra = {}) => lint.lintLayer({ ai, flags: f, grid: g, isWalkable: walk, ground: () => 0, spawns: [[10, -12]], defined: ['homogenous'], ...extra });
const checks = r => r.errors.map(e => e.check).sort();
out.lintGood = run(good);
out.lintDangling = checks(run({ ...good, prerequisites: [{ name: 'p', conditions: [{ name: 'nope', weight: 1 }] }] }));
out.lintUndefinedStrategy = checks(run({ ...good, sideStrategies: { 1: ['zzz'], 2: ['s'] } }));
out.lintOutside = checks(run(good, [...lf, { name: 'C', x: 20, y: 0, z: -50, radius: 5, team: 0, fixed: false }]));
out.lintOrderBlocked = checks(run({ ...good, strategicAreas: [area('A', 10, -10, { neighbours: ['B'], orderPositions: { Infantry: [32.5, -5.5] } }), good.strategicAreas[1]] }));
const sealed = { ...grid, blocked: grid.blocked.slice() };
sealed.blocked[10 * W + 32] = 4;
out.lintCutOff = checks(run(good, lf, sealed));
out.lintHigh = checks(run(good, [lf[0], { ...lf[1], y: 17 }]));
out.lintOneWay = run({ ...good, strategicAreas: [area('A', 10, -10, { neighbours: ['B'] }), area('B', 50, -10)] }).warnings.map(w => w.check);
out.defined = lint.definedConditions('aiStrategy.createConstantCondition a Crisp\r\naiStrategy.createHomogenousCondition weakCond Crisp\r\n');

// --- the detectors -------------------------------------------------------------
const header = { level: 't', seed: 1, botsPerSide: 1, duration: 60, tickHz: 30, traceEvery: 30, tickets: { 1: 100, 2: 100 },
                 flags: [{ name: 'F', uncapturable: false, controlPoint: true }, { name: 'G', uncapturable: false, controlPoint: true }, { name: 'Base', uncapturable: true, controlPoint: true }] };
const d = det.newDetector(header);
for (let t = 0; t <= 40; t++) {
  // bot_0 pushes at a wall from t = 5 to t = 30, then walks on; bot_1 idles and its order flips A, B, A.
  const x = t < 5 ? t * 3 : t <= 30 ? 15 : 15 + (t - 30) * 3;
  det.feed(d, { k: 'tick', t, bot: 'bot_0', alive: true, pos: [x, 0, -10], beh: 'MoveTo', ctl: [1, 0, 0, 0, 0], area: 'A', target: null });
  det.feed(d, { k: 'tick', t, bot: 'bot_1', alive: true, pos: [50, 0, -10], beh: 'Idle', ctl: [0, 0, 0, 0, 0], area: t < 10 ? 'A' : t < 20 ? 'B' : 'A', target: null });
}
// bot_5 dies between A and B and again before A: one objective per life, no flip.
for (const [t, alive, area] of [[1, true, 'A'], [2, false, null], [3, true, 'B'], [4, false, null], [5, true, 'A']]) {
  det.feed(d, alive ? { k: 'tick', t, bot: 'bot_5', alive: true, pos: [90, 0, -90], beh: 'Fire', ctl: [0, 0, 0, 0, 0], area, target: 'x' } : { k: 'tick', t, bot: 'bot_5', alive: false });
}
det.feed(d, { k: 'ev', t: 41, type: 'respawn', bot: 'bot_1', pos: [60, 0, -10] });
det.feed(d, { k: 'ev', t: 44, type: 'kill', killer: null, victim: 'bot_1', pos: [61, 0, -10] });
det.feed(d, { k: 'ev', t: 44.5, type: 'kill', killer: 'bot_0', killerSide: 1, victim: 'bot_2', victimSide: 1, pos: [0, 0, 0] });
det.feed(d, { k: 'ev', t: 44.6, type: 'kill', killer: 'bot_0', killerSide: 1, victim: 'bot_3', victimSide: 2, pos: [0, 0, 0] });
det.feed(d, { k: 'ev', t: 45, type: 'capture', flag: 'F', to: 2 });
out.detect = det.finish(d, { result: { winner: 2, reason: 'time', tickets: { 1: 90, 2: 95 } }, metrics: { routeFailures: { total: 3 }, redeploys: 1, botErrors: 0 } }, 45);

// --- the judge -------------------------------------------------------------------
const row = (o = {}) => ({ level: 'dice', botsPerSide: 8, seed: 1, capturable: 2, flagsNeverChanged: [], capturesTotal: 4, captures: { 1: 2, 2: 2 },
  stuckSecondsPerBotMinute: 1, idleShare: 0.1, oscillationsPerBotMinute: 0, selfDeathsPerBotMinute: 0, spawnTrapsPerBotMinute: 0,
  routeFailuresPerBotMinute: 1, redeploysPerBotMinute: 0.1, botErrors: 0, ticketsBled: { 1: 5, 2: 5 }, winner: 1, firstCapture: 30,
  teamKillsPerBotMinute: 0.01, enemyKillsPerBotMinute: 0.5, enemyKills: { 1: 3, 2: 4 }, ...o });
const base = jud.buildBaseline([row(), row({ seed: 2, stuckSecondsPerBotMinute: 3, capturesTotal: 2 }), row({ seed: 3, stuckSecondsPerBotMinute: 2 })], 'test');
out.baselineBand = base.sizes[8].metrics.stuckSecondsPerBotMinute;
out.judgePass = jud.judge([row({ level: 'x' }), row({ level: 'x', seed: 2 })], base);
out.judgeStuck = jud.judge([row({ level: 'x', stuckSecondsPerBotMinute: 9 }), row({ level: 'x', seed: 2, stuckSecondsPerBotMinute: 9 })], base).failed;
out.judgeFlag = jud.judge([row({ level: 'x', flagsNeverChanged: ['F'] }), row({ level: 'x', seed: 2, flagsNeverChanged: ['F'] })], base).failed;
out.judgeOneSide = jud.judge([row({ level: 'x', captures: { 1: 4, 2: 0 } })], base).failed;
out.judgeNoBaseline = jud.judge([row({ botsPerSide: 32 })], base).verdict;
out.judgeTeamKills = jud.judge([row({ level: 'x', teamKillsPerBotMinute: 0.4 })], base).failed;
out.judgeNoFight = jud.judge([row({ level: 'x', enemyKillsPerBotMinute: 0.01, enemyKills: { 1: 2, 2: 0 } })], base).failed;
const high = [row({ level: 'x', flagsNeverChanged: ['F'] }), row({ level: 'x', seed: 2, flagsNeverChanged: ['F'] })];
out.judgeUnreachable = jud.judge(high, base, { unreachable: ['f'] }).checks.find(c => c.metric === 'flagCoverage');
out.judgeBalance = [jud.judge([row({ level: 'x' }), row({ level: 'x', seed: 2 })], base).balance, jud.judge([row({ level: 'x' }), row({ level: 'x', seed: 2, winner: 2 })], base).balance];

// --- the painter's doorways --------------------------------------------------------
function box(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const o = [];
  for (const [a, b, c, e] of q) o.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[e]);
  return o;
}
// A wall across a 64 m world at z = -20, 0.3 m thick, 3 m high, with a
// 1.25 m door from x = 19.6 (it straddles two cells) and a 0.5 m slit at x = 40.
const tris = [...box(0, 19.6, 0, 3, -20.3, -20), ...box(20.85, 40, 0, 3, -20.3, -20), ...box(40.5, 64, 0, 3, -20.3, -20)];
const collider = { waterLevel: -100, heightfield: { height: () => 0 }, statics: { tris: new Float32Array(tris), count: tris.length / 9 } };
const soldier = nav.buildNavMap(collider, 64);
const tank = nav.buildNavMap(collider, 64, { brush: 3.0, lowClip: 0.3, hiClip: 2.5, waterDepth: 0 });
const cell = (g, x, z) => g.blocked[z * g.width + x];
out.door = {
  doorCells: [cell(soldier, 19, 20), cell(soldier, 20, 20)], wallCell: cell(soldier, 10, 20), slitCell: cell(soldier, 40, 20),
  beside: [cell(soldier, 18, 20), cell(soldier, 21, 20)],
  through: !!nav.findLocalPath(soldier, 20.2, -10, 20.2, -30, { radius: 32 }),
  tankDoor: [cell(tank, 19, 20), cell(tank, 20, 20)],
};

const sf = await imp('viewer/spawn-flags.js');
const twoSpawns = { name: 'F', team: 1, spawns: [{ name: 'top', position: [0, 20, 0], group: 1 }, { name: 'foot', position: [2, 0, 0], group: 1 }] };
out.avoid = [sf.pickSpawn(twoSpawns, 0)?.name, sf.pickSpawn(twoSpawns, 0, { avoid: ['top'] })?.name, sf.pickSpawn(twoSpawns, 0, { avoid: ['top', 'foot'] })?.name ?? null];
out.excluded = gen.excludedSpawns([{ name: 'top', position: [0, 20, 0] }, { name: 'floor', position: [1, 0.9, 0] }, { name: 'sealed', position: [50, 0, 0] }],
  { free: (x) => x < 40, ground: () => 0 });
const tall = gen.buildAreas([...flags.slice(0, 3), { name: 'Mill', x: 220, y: 30, z: -230, radius: 5, team: 1, fixed: false }], { ...hooks, ground: () => 10 });
out.mill = tall.find(a => a.name === 'Mill');
out.millCon = gen.areasCon(tall);
out.pathCon = gen.pathFindingCon();
out.tags = [menu.levelTag({ singlePlayer: false }), menu.levelTag({ singlePlayer: false, generatedBots: true }), menu.levelTag({ singlePlayer: true }), menu.levelTag({})];
// --- acceptance (sim/botbatch.mjs) ---------------------------------------------
const batch = await imp('sim/botbatch.mjs');
const short = (o = {}) => ({ level: 'x', verdict: 'fail', outcome: 'better-than-nothing', lintErrors: [],
  sizes: { 8: { verdict: 'pass', failed: [] }, 16: { verdict: 'fail', failed: ['redeploysPerBotMinute'] } }, ...o });
const refusal = (v, reason = 'why') => { try { batch.acceptVerdict(v, reason, '2026-11-10'); return null; } catch (e) { return e.message; } };
const taken = batch.acceptVerdict(short({ acceptanceWithdrawn: { reason: 'old' } }), ' one check short ', '2026-11-10');
out.accept = {
  taken: taken.accepted, cleared: !('acceptanceWithdrawn' in taken),
  refused: [refusal(short(), ' '), refusal(short({ verdict: 'pass', outcome: 'pass' })), refusal(short({ outcome: 'no-better-than-nothing' })), refusal(short({ lintErrors: ['e'] }))].map(m => !!m),
  carried: batch.carryAccepted(short(), taken).accepted?.reason ?? null,
  improved: batch.carryAccepted(short({ sizes: { 8: { failed: [] }, 16: { failed: [] } } }), taken).accepted?.reason ?? null,
  passDrops: 'accepted' in batch.carryAccepted(short({ verdict: 'pass', outcome: 'pass' }), taken),
  worse: batch.carryAccepted(short({ sizes: { 8: { failed: ['stuckSecondsPerBotMinute'] }, 16: { failed: ['redeploysPerBotMinute'] } } }), taken),
  noBetter: batch.carryAccepted(short({ outcome: 'no-better-than-nothing' }), taken).acceptanceWithdrawn?.because ?? null,
  none: batch.carryAccepted(short(), null),
};
// --- the outcome classes (sim/botbatch.mjs verdictOf) ----------------------------
// `row` and `base` are the judge's fixtures above. The no-layer arm is far worse on every movement rate.
const worse = o => row({ level: 'x', stuckSecondsPerBotMinute: 9, routeFailuresPerBotMinute: 9, redeploysPerBotMinute: 9, spawnTrapsPerBotMinute: 9, ...o });
const failing = o => row({ level: 'x', stuckSecondsPerBotMinute: 3, ...o });
out.outcomes = {
  pass: batch.verdictOf('x', [row({ level: 'x' }), row({ level: 'x', seed: 2 })], base, null, [worse({}), worse({ seed: 2 })]).outcome,
  better: batch.verdictOf('x', [failing({}), failing({ seed: 2 })], base, null, [worse({}), worse({ seed: 2 })]).outcome,
  noBetter: batch.verdictOf('x', [failing({}), failing({ seed: 2 })], base, null, [failing({}), failing({ seed: 2 })]).outcome,
  // Nobody fights: fewer stuck seconds than the no-layer arm, and still not better than nothing.
  noFight: batch.verdictOf('x', [failing({ enemyKills: { 1: 0, 2: 0 }, enemyKillsPerBotMinute: 0 }), failing({ seed: 2 })], base, null, [worse({}), worse({ seed: 2 })]),
};
console.log(JSON.stringify(out));
