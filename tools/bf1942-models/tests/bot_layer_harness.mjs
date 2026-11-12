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
const batch = await imp('sim/botbatch.mjs');
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

// --- the land vehicles' map of a level the engine wrote none for (`botgen.mjs paintedVehicleMap`) ------
// Two yards joined by a street 4 m wide between two long buildings: DICE's 3 m brush shuts the street
// and leaves one flag on another piece; a narrower one leaves a lane. In open ground 3 m stands.
const town = [...box(0, 62, 0, 4, -70, -50), ...box(66, 128, 0, 4, -70, -50)];
const townWorld = { collider: { waterLevel: -100, heightfield: { height: () => 0 }, statics: { tris: new Float32Array(town), count: town.length / 9 } }, flags: [] };
const townExtras = { objectSpawns: [{ position: [10, 0, -4] }, { position: [50, 0, -4] }] };
const townFlags = [{ name: 'North', x: 20, z: -10 }, { name: 'South', x: 20, z: -118 }];
const lane = gen.paintedVehicleMap(nav, townWorld, townExtras, 128, townFlags);
const openWorld = { collider: { waterLevel: -100, heightfield: { height: () => 0 }, statics: { tris: new Float32Array(0), count: 0 } }, flags: [] };
const open = gen.paintedVehicleMap(nav, openWorld, townExtras, 128, townFlags);
out.vehicleMap = {
  brush: lane.brush, tried: lane.tried.map(t => [t.brush, t.flagsOn, t.spawnersOn]),
  street: [63, 64].some(x => lane.pixels[60 * 128 + x] === 0), wall: lane.pixels[60 * 128 + 10],
  openBrush: open.brush, openFlags: open.tried[0].flagsOn,
  con: [gen.pathFindingCon(true, lane.brush).includes('ai.addSearchMap Tank0 0 0 25 ' + lane.brush.toFixed(1) + ' 0.3 2.5 0'), gen.pathFindingCon().includes('ai.addSearchMap Tank0 0 0 25 3.0 0.3 2.5 0')],
};
// A hull's order position: the free cell of that map nearest the flag, written before the infantry's.
const hull = gen.buildAreas(flags.slice(0, 3), { ...hooks, vehicleOrder: (x, z) => [Math.floor(x) + 2.5, Math.floor(z) + 0.5] });
out.hullCon = gen.areasCon(hull);

const sf = await imp('viewer/spawn-flags.js');
const twoSpawns = { name: 'F', team: 1, spawns: [{ name: 'top', position: [0, 20, 0], group: 1 }, { name: 'foot', position: [2, 0, 0], group: 1 }] };
out.avoid = [sf.pickSpawn(twoSpawns, 0)?.name, sf.pickSpawn(twoSpawns, 0, { avoid: ['top'] })?.name, sf.pickSpawn(twoSpawns, 0, { avoid: ['top', 'foot'] })?.name ?? null];
const tall = gen.buildAreas([...flags.slice(0, 3), { name: 'Mill', x: 220, y: 30, z: -230, radius: 5, team: 1, fixed: false }], { ...hooks, ground: () => 10 });
out.mill = tall.find(a => a.name === 'Mill');
out.millCon = gen.areasCon(tall);
out.pathCon = gen.pathFindingCon();
out.tags = [menu.levelTag({ singlePlayer: false }), menu.levelTag({ singlePlayer: false, generatedBots: true }), menu.levelTag({ singlePlayer: true }), menu.levelTag({})];
// The mark a generated level's row carries in place of a tag, and what it says when pointed at.
{
  const briefing = await imp('viewer/briefing-screen.js');
  const box = { kind: 'listbox', rect: [100, 50, 200, 120], rowHeight: 12 };
  const layout = { pages: { skirmish: { elements: [box] } } };
  const levels = [{ singlePlayer: false, generatedBots: true }, { singlePlayer: false }, { singlePlayer: true }];
  const rect = menu.botCreditRect(box, 100, 50, 200);
  out.botCredit = {
    marked: levels.map(menu.hasBotCredit),
    sameLine: menu.BOT_CREDIT === briefing.GENERATED_BOTS_CREDIT,
    rect,
    // The pointer on the first row's mark, on the same row's title, and on the mark's place in a row with none.
    onMark: menu.botCreditAt(layout, { scroll: 0 }, levels, rect[0] + 2, rect[1] + 2),
    onTitle: menu.botCreditAt(layout, { scroll: 0 }, levels, 110, rect[1] + 2),
    onBotless: menu.botCreditAt(layout, { scroll: 0 }, levels, rect[0] + 2, rect[1] + 2 + 12),
    scrolled: menu.botCreditAt(layout, { scroll: 1 }, [{}, ...levels], rect[0] + 2, rect[1] + 2),
  };
}
// --- acceptance (sim/botbatch.mjs) ---------------------------------------------
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
// The owner's own acceptance: also of a layer called no better than nothing, never of one with no fight.
const noBetterShort = short({ outcome: 'no-better-than-nothing' });
const refuse = f => { try { f(); return null; } catch (e) { return e.message; } };
const owned = batch.acceptVerdict(noBetterShort, 'the owner looked at it', '2026-11-11', { owner: true });
out.ownerAcceptance = {
  refusedWithout: refuse(() => batch.acceptVerdict(noBetterShort, 'why', '2026-11-11')),
  by: owned.accepted.by, outcome: owned.accepted.outcome,
  noFight: batch.acceptVerdict(short({ outcome: 'no-fight' }), 'why', '2026-11-11', { owner: true }).accepted.outcome,
  unsuitable: refuse(() => batch.acceptVerdict(short({ outcome: 'unsuitable' }), 'why', '2026-11-11', { owner: true })),
  // A level run despite a stacked-floors lint error may be accepted by the owner; any other lint error, or anyone else, may not.
  stacked: batch.acceptVerdict({ ...short(), lintErrors: ['the play surface is stacked floors (3 of 5 capturable flags stand a storey over another)'] }, 'why', '2026-11-12', { owner: true }).accepted.by,
  stackedNotOwner: refuse(() => batch.acceptVerdict({ ...short(), lintErrors: ['the play surface is stacked floors (x)'] }, 'why', '2026-11-12')),
  sealed: refuse(() => batch.acceptVerdict({ ...short(), lintErrors: ['side 1 has no spawn with a route to any flag it must take'] }, 'why', '2026-11-12', { owner: true })),
  carried: batch.carryAccepted(noBetterShort, owned).accepted?.by ?? null,
  worse: batch.carryAccepted(short({ outcome: 'no-fight' }), owned).acceptanceWithdrawn?.because ?? null,
  // A level that rises, or fails a check it did not fail then, keeps the owner's acceptance, the new checks noted.
  better: batch.carryAccepted(short({ outcome: 'better-than-nothing' }), owned).accepted?.by ?? null,
  alsoFails: batch.carryAccepted({ ...noBetterShort, sizes: { ...noBetterShort.sizes, 8: { ...(noBetterShort.sizes?.[8] ?? {}), failed: [...(noBetterShort.sizes?.[8]?.failed ?? []), 'madeUpCheck'] } } }, owned).accepted?.alsoFails ?? null,
  ordinaryDoesNotCarry: batch.carryAccepted(noBetterShort, batch.acceptVerdict(short(), 'why', '2026-11-11')).acceptanceWithdrawn?.because ?? null,
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
// The level with no layer has no fight (nobody kills): a few spawn traps with the layer are not "worse"
// than its none. Against a no-layer arm that fights, the same rise is.
const trapped = o => failing({ spawnTrapsPerBotMinute: 0.02, ...o });
const deadNone = o => worse({ spawnTrapsPerBotMinute: 0, enemyKills: { 1: 0, 2: 0 }, ticketsBled: { 1: 0, 2: 0 }, capturesTotal: 0, ...o });
const liveNone = o => worse({ spawnTrapsPerBotMinute: 0.01, ...o });
out.versusDead = {
  dead: batch.betterThanNothing([trapped({}), trapped({ seed: 2 })], [deadNone({}), deadNone({ seed: 2 })]),
  live: batch.betterThanNothing([trapped({}), trapped({ seed: 2 })], [liveNone({}), liveNone({ seed: 2 })]),
};
// The level with no layer has no fight and its bots do not move: no stuck time, no redeploys. A layer
// that brings a fight and captures is better than it, whatever its own movement rates are; one that
// captures less is not, and neither is one whose own matches have no fight.
const still = o => row({ level: 'x', stuckSecondsPerBotMinute: 0.1, routeFailuresPerBotMinute: 0, redeploysPerBotMinute: 0.02, spawnTrapsPerBotMinute: 0,
                         enemyKills: { 1: 0, 2: 0 }, ticketsBled: { 1: 0, 2: 0 }, capturesTotal: 0, ...o });
const moving = o => row({ level: 'x', stuckSecondsPerBotMinute: 1.6, routeFailuresPerBotMinute: 0.4, redeploysPerBotMinute: 0.12, capturesTotal: 6, ...o });
// Both arms have a fight. The level with no layer barely kills and takes no flag, and its bots move little;
// the layer's fight costs it some stuck time. By the movement rates alone it is worse; by the bar's own
// count of failed checks it is better. With no bar given, the old comparison stands.
const quiet = o => row({ level: 'x', stuckSecondsPerBotMinute: 0.1, routeFailuresPerBotMinute: 0, redeploysPerBotMinute: 0.02, spawnTrapsPerBotMinute: 0,
                         enemyKillsPerBotMinute: 0.001, capturesTotal: 0, flagCoverage: 0, ...o });
out.versusQuiet = {
  byTheBar: batch.betterThanNothing([failing({}), failing({ seed: 2 })], [quiet({}), quiet({ seed: 2 })], base),
  noBar: batch.betterThanNothing([failing({}), failing({ seed: 2 })], [quiet({}), quiet({ seed: 2 })]),
  noFewer: batch.betterThanNothing([failing({}), failing({ seed: 2 })], [failing({}), failing({ seed: 2 })], base),
};
out.versusStill = {
  fight: batch.betterThanNothing([moving({}), moving({ seed: 2 })], [still({}), still({ seed: 2 })]),
  fewerCaptures: batch.betterThanNothing([moving({ capturesTotal: 1 }), moving({ seed: 2, capturesTotal: 1 })], [still({ capturesTotal: 3 }), still({ seed: 2, capturesTotal: 3 })]),
  noFightEither: batch.betterThanNothing([moving({ enemyKills: { 1: 0, 2: 3 } }), moving({ seed: 2 })], [still({}), still({ seed: 2 })]),
};
// --- the walk test (sim/walkflood.mjs) on a world of boxes -----------------------
// The flood asks a collider two things: the surface straight down from a
// point, and whether a sphere swept along a line meets anything. Here both
// are answered for axis-aligned boxes `[x0, x1, y0, y1, z0, z1]` over a
// terrain function, the sphere as the box grown by its radius.
const wf = await imp('sim/walkflood.mjs');
function boxWorld(boxes, { terrain = () => 0, normalY = () => 1 } = {}) {
  return {
    waterLevel: null,
    heightfield: { height: terrain },
    cast(x, y, z, dx, dy, dz, max) {
      let best = null;
      const t = terrain(x, z);
      if (t <= y && y - t <= max) best = { y: t, ny: normalY(x, z), kind: 'terrain' };
      for (const b of boxes) {
        if (x >= b[0] && x <= b[1] && z >= b[4] && z <= b[5] && b[3] <= y && y - b[3] <= max && (!best || b[3] > best.y)) best = { y: b[3], ny: 1, kind: 'object' };
      }
      return best;
    },
    sweepSphere(ox, oy, oz, dx, dy, dz, dist, r) {
      let best = null;
      const o = [ox, oy, oz], d = [dx, dy, dz];
      for (const b of boxes) {
        const lo = [b[0] - r, b[2] - r, b[4] - r], hi = [b[1] + r, b[3] + r, b[5] + r];
        let t0 = 0, t1 = dist, axis = -1, sign = 0, miss = false;
        for (let k = 0; k < 3 && !miss; k++) {
          if (Math.abs(d[k]) < 1e-12) { miss = o[k] <= lo[k] || o[k] >= hi[k]; continue; }
          let near = (lo[k] - o[k]) / d[k], far = (hi[k] - o[k]) / d[k];
          const s = near < far ? -1 : 1;
          if (near > far) [near, far] = [far, near];
          if (near > t0) { t0 = near; axis = k; sign = s; }
          t1 = Math.min(t1, far);
        }
        if (miss || axis < 0 || t0 > t1) continue;
        if (!best || t0 < best.t) { const n = [0, 0, 0]; n[axis] = sign; best = { t: t0, nx: n[0], ny: n[1], nz: n[2] }; }
      }
      return best;
    },
  };
}
const body = await wf.soldierBody();
out.body = body;
const wallAt20 = (height, gap = null) => (gap
  ? [[20, 20.3, 0, height, -64, gap[1]], [20, 20.3, 0, height, gap[0], 0]]
  : [[20, 20.3, 0, height, -64, 0]]);
const east = x => x > 25;
const from = [[10, 0, -30]];
const far = { reach: 24 };
// A bank that shelves one in five into a channel 6 m deep, the water half a metre under the bank: the
// flood wades to the depth a swimmer stands up in and no further, whichever side of the surface its ray starts.
const shelf = Object.assign(boxWorld([], { terrain: x => (x < 20 ? 0 : Math.max(-6, -(x - 20) * 0.2)) }), { waterLevel: -0.5 });
const reaches = x => wf.wayOut(shelf, from, body, px => px > x, far).way;
out.channel = { shallows: reaches(25), swim: reaches(31), across: reaches(33) };
out.way = {
  door: wf.wayOut(boxWorld(wallAt20(3, [-29.35, -30.6])), from, body, east, far).way,       // 1.25 m wide
  slit: wf.wayOut(boxWorld(wallAt20(3, [-29.7, -30.3])), from, body, east, far).way,        // 0.6 m wide
  kerb: wf.wayOut(boxWorld(wallAt20(1.0)), from, body, east, far).way,
  step: wf.wayOut(boxWorld(wallAt20(0.4)), from, body, east, far).way,
  // A platform 1.5 m up: a soldier walks off it, and no flood whose moves must be walked back does.
  ledge: wf.wayOut(boxWorld([[0, 20, 0, 1.5, -64, 0]]), [[10, 1.5, -30]], body, east, far).way,
  ledgeBack: wf.wayOut(boxWorld([[0, 20, 0, 1.5, -64, 0]]), [[10, 1.5, -30]], body, east, { ...far, twoWay: true }).way,
  // A fall past the one that costs no health is not a way.
  cliff: wf.wayOut(boxWorld([[0, 20, 0, 3, -64, 0]]), [[10, 3, -30]], body, east, far).way,
};
// The page's terrain rule: ground rising gently whose normal reads steep refuses every step up, and none down.
const rising = boxWorld([], { terrain: x => (x > 15 ? (x - 15) * 0.1 : 0), normalY: x => (x > 15 ? 0.2 : 1) });
out.refused = [wf.wayOut(rising, from, body, east, far).way, wf.wayOut(rising, [[30, 1.5, -30]], body, (x) => x < 12, far).way];

// A 64 m level: an Axis spawn in the west, an Allied one in the east, one in a room with no door and
// one in a hut with a 1.25 m door; flags on the ground, on a pole 4.2 m up, on top of a solid tower,
// and in a patch the map blocks.
const room = [[40, 50, 0, 3, -50.3, -50], [40, 50, 0, 3, -40, -39.7], [40, 40.3, 0, 3, -50, -40], [49.7, 50, 0, 3, -50, -40]];
const hut = [[20, 28, 0, 3, -58.3, -58], [20, 28, 0, 3, -50, -49.7], [27.7, 28, 0, 3, -58, -50], [20, 20.3, 0, 3, -58, -54.6], [20, 20.3, 0, 3, -53.35, -50]];
const tower = [10, 14, 0, 6, -14, -10];
const level = boxWorld([...room, ...hut, tower]);
const wSpawns = [{ name: 'a1', x: 8, y: 0, z: -30, side: 1 }, { name: 'b1', x: 56, y: 0, z: -30, side: 2 }, { name: 'in', x: 45, y: 0, z: -45, side: 2 },
                 { name: 'hut', x: 24, y: 0, z: -54, side: 1 }];
const wFlags = [
  { name: 'Mid', x: 30, y: 0, z: -30, radius: 5, team: 0, fixed: false },
  { name: 'Pole', x: 30, y: 4.2, z: -20, radius: 5, team: 0, fixed: false },
  { name: 'Tower', x: 12, y: 6, z: -12, radius: 3, team: 1, fixed: false },
  { name: 'Patch', x: 52, y: 0, z: -18, radius: 3, team: 2, fixed: false },
];
const SIZE = 64;
const enginePixels = new Uint8Array(SIZE * SIZE);
const block = (x0, x1, z0, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) enginePixels[z * SIZE + x] = 1; };
block(39, 50, 39, 50); block(9, 14, 9, 14); block(46, 58, 12, 24);
for (let z = 41; z <= 48; z++) for (let x = 41; x <= 48; x++) enginePixels[z * SIZE + x] = 0;   // the room's floor: a pocket
block(19, 28, 49, 58);
for (let z = 51; z <= 56; z++) for (let x = 21; x <= 26; x++) enginePixels[z * SIZE + x] = 0;   // and the hut's: its door is one the map shuts
const gridOf = px => ({ width: SIZE, height: SIZE, cellSize: 1, blocked: px });
const facts = wf.walkFacts({ collider: level, grid: gridOf(enginePixels), flags: wFlags, spawns: wSpawns, body });
const brief = f => ({ spawns: Object.fromEntries(f.spawns.map(s => [s.name, s.usable])),
  flags: Object.fromEntries(f.flags.map(g => [g.name, [g.reachable, !!g.inRing, g.poleLift]])), stacked: f.floors.stacked, regions: f.regions.length });
out.walkFacts = brief(facts);
const prep = gen.prepareWalkMap({ collider: level, size: SIZE, flags: wFlags, spawns: wSpawns, body, engine: enginePixels });

// A flood the cap ends before the ground does: the two bases' discs never meet, though it is one open
// ground. The discs it had not finished are joined through the walk map; the room with no door, which it
// had finished, is not, whatever the map says.
{
  const three = wSpawns.slice(0, 3);
  const open = new Uint8Array(SIZE * SIZE);
  const cut = () => wf.walkFlood(level, three.map(s => [s.x, s.y, s.z]), body, { twoWay: true, bounds: wf.floodBounds([...three, ...wFlags], SIZE), maxCells: 9000 });
  const ground = cut();
  const apart = new Set(ground.startRegion).size;
  const f = wf.walkFacts({ collider: level, grid: gridOf(open), flags: [wFlags[0]], spawns: three, body, ground });
  // The same flood against a map that keeps the two bases apart: nothing is joined.
  const split = Uint8Array.from(open);
  for (let z = 0; z < SIZE; z++) split[z * SIZE + 30] = 1;
  const g = wf.walkFacts({ collider: level, grid: gridOf(split), flags: [wFlags[0]], spawns: three, body, ground: cut() });
  // A flood that ran out of ground is left as it is.
  const whole = wf.walkFacts({ collider: level, grid: gridOf(open), flags: [wFlags[0]], spawns: three, body });
  out.cappedFlood = { capped: f.capped, apart, joined: f.joined, sidesMeet: f.sidesMeet, usable: Object.fromEntries(f.spawns.map(s => [s.name, s.usable])),
    splitJoined: g.joined, splitMeet: g.sidesMeet, wholeCapped: whole.capped, wholeJoined: whole.joined, wholeMeet: whole.sidesMeet };
}
const again = gen.prepareWalkMap({ collider: level, size: SIZE, flags: wFlags, spawns: wSpawns, body, engine: prep.pixels, previous: { source: prep.source, opened: prep.opened } });
out.walkMap = {
  source: prep.source, ways: prep.ways, opened: prep.opened.length,
  openedWereBlocked: prep.opened.every(([x, z]) => enginePixels[z * SIZE + x] === 1 && prep.pixels[z * SIZE + x] === 0),
  after: brief(prep.facts), excluded: gen.excludedByWalk(prep.facts),
  reach: Object.fromEntries(prep.facts.flags.map(f => [f.name, gen.flagReach(f).unreachable])),
  sameAgain: Buffer.from(again.pixels).equals(Buffer.from(prep.pixels)) && JSON.stringify(again.opened) === JSON.stringify(prep.opened),
};
// The order position: the flag's own nearest free cell when a soldier there is inside the ring, else the cell
// of the place that is (a pole 4.2 m up with a 5 m radius is a 2.7 m ring on the ground), else none.
const pole = prep.facts.flags.find(f => f.name === 'Pole');
out.order = [gen.flagReach(pole, [30.5, -20.5]).order, gen.flagReach(pole, [34.5, -20.5]).order, gen.flagReach(prep.facts.flags.find(f => f.name === 'Tower'), null).order];
// A flag a hair inside its cell: one decimal would write it into the next cell, so when that one is blocked the
// answer is its own cell's centre. The same hair beside a free cell keeps the point.
{
  const one = { cellSize: 1 }, free = (_, x, z) => !(Math.floor(-z) === 20);
  out.orderOnAnEdge = [gen.nearestFree(one, free, 12.07, -19.99), gen.nearestFree(one, free, 12.07, -18.99), gen.nearestFree(one, free, 12.4, -19.5)];
}
const ladderLint = lint.lintLayer({ ai: good, flags: lf, grid, isWalkable: walk, defined: ['homogenous'],
  walk: { cover: 1, capped: false, ladders: 3, floors: { stacked: false }, spawns: [{ name: 'a', side: 1, landed: true, usable: false, over: 0 }, { name: 'b', side: 2, landed: true, usable: true, over: 0 }],
          flags: [{ name: 'A', team: 1, fixed: false, reachable: true, over: 0 }, { name: 'B', team: 2, fixed: false, reachable: true, over: 0 }] } });
out.ladderText = ladderLint.errors.map(e => e.text).join(' | ');
// A map that holds none of the ground: painted from the walk test, the main ground only.
const blind = gen.prepareWalkMap({ collider: level, size: SIZE, flags: wFlags, spawns: wSpawns, body, engine: new Uint8Array(SIZE * SIZE).fill(1) });
out.painted = { source: blind.source, street: blind.pixels[30 * SIZE + 30], room: blind.pixels[45 * SIZE + 45], wall: blind.pixels[40 * SIZE + 45],
  usable: brief(blind.facts).spawns, cover: blind.facts.cover > 0.9, engineCover: blind.engineCover, keptCover: prep.engineCover > 0.5 };
// `paintGround` on fine places written out by hand, quarter-metre cells in one-metre cells `[gx, gz]`:
// all sixteen; the west half (eight, the centre's four not all among them); twelve with the centre; six.
const fine = (gx, gz, keep) => { const out = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (keep(i, j)) out.push([gx + (i + 0.5) / 4, -(gz + (j + 0.5) / 4)]); return out; };
const handPlaces = [...fine(2, 2, () => true), ...fine(4, 2, i => i < 2), ...fine(6, 2, i => i > 0), ...fine(8, 2, (i, j) => i < 2 && j < 3)];
const hand = wf.paintGround({ cell: 0.25, each(cb) { for (const [x, z] of handPlaces) cb(x, z, 0, 0); } }, 12, 0);
out.paintRule = { whole: hand[2 * 12 + 2], halfNoCentre: hand[2 * 12 + 4], mostWithCentre: hand[2 * 12 + 6], few: hand[2 * 12 + 8], empty: hand[2 * 12 + 10] };
// Two floors: a slab 3.3 m up over a third of the level, reached by stairs.
const stairs = Array.from({ length: 10 }, (_, i) => [14 + 0.6 * i, 20, 0, 0.3 * (i + 1), -34, -30]);
const twoFloors = boxWorld([...stairs, [20, 60, 3, 3.3, -60, -4]]);
const upFlags = [{ name: 'Up', x: 40, y: 3.3, z: -32, radius: 5, team: 0, fixed: false }, { name: 'Down', x: 8, y: 0, z: -50, radius: 5, team: 0, fixed: false }];
const upFacts = wf.walkFacts({ collider: twoFloors, grid: gridOf(new Uint8Array(SIZE * SIZE)), flags: upFlags, spawns: wSpawns.slice(0, 2), body });
out.stacked = { stacked: upFacts.floors.stacked, share: upFacts.floors.twoFloorShare > 0.1, over: upFacts.flags[0].over, unreachable: gen.flagReach(upFacts.flags[0]).unreachable };

// --- the search-map writer (sim/botgen.mjs) ---------------------------------------
const { readFileSync, existsSync } = await import('node:fs');
const baked = await imp('viewer/nav-baked.js');
const rawOf = name => path.join(HERE, '..', 'bot-layers', 'bf1942', 'shigaisen_b', 'Pathfinding', name);
out.codec = { same: [], coarser: [] };
// The lab server's own files for shigaisen_B: Tank0 is never edited by the walk test.
for (const lv of [0, 1, 2]) {
  const bytes = readFileSync(rawOf(`Tank0Level${lv}Map.raw`));
  const map = baked.decodeSearchMap(new Uint8Array(bytes));
  const px = gen.searchMapPixels(map);
  out.codec.same.push(gen.encodeSearchMap(px, map.width, lv).equals(bytes));
  if (lv < 2) {
    const up = gen.searchMapPixels(baked.decodeSearchMap(new Uint8Array(readFileSync(rawOf(`Tank0Level${lv + 1}Map.raw`)))));
    out.codec.coarser.push(Buffer.from(gen.coarserPixels(px, map.width)).equals(Buffer.from(up)));
  }
}
// A 256 m map of its own: one blocked pixel blocks its parent and its grandparent, and nothing else.
const small = new Uint8Array(256 * 256);
small[70 * 256 + 133] = 1;
const pyramid = gen.encodePyramid(small, 256);
const levels = [0, 1, 2].map(lv => baked.decodeSearchMap(new Uint8Array(pyramid[lv])));
out.codec.pyramid = levels.map(m => [m.level, m.width, gen.searchMapPixels(m).reduce((n, v) => n + v, 0)]);
out.codec.reads = Buffer.from(gen.searchMapPixels(levels[0])).equals(Buffer.from(small));
out.codec.parents = [levels[1].blocked(66, 35), levels[2].blocked(33, 17), levels[1].blocked(67, 35)];

// --- the dead-level lint and the census row -----------------------------------------
const sp = (name, side, o = {}) => ({ name, side, landed: true, onMainGround: true, usable: true, refused: false, fall: 0, over: 0, under: 0, ...o });
const fl = (name, team, o = {}) => ({ name, team, fixed: false, radius: 5, reachable: true, walked: true, onMainGround: true, poleLift: 0, over: 0, under: 0, ...o });
const sound = { cover: 0.9, capped: false, floors: { stacked: false, reason: null }, spawns: [sp('a', 1), sp('b', 2)], flags: [fl('A', 1), fl('B', 2)] };
const dead = w => { const r = run(good, lf, grid, { walk: w }); return { dead: lint.predictedDead(r), checks: checks(r), texts: r.errors.map(e => e.text) }; };
out.deadLint = {
  sound: dead(sound),
  sealed: dead({ ...sound, spawns: [sp('a', 1, { usable: false }), sp('b', 2)] }),
  noSpawn: dead({ ...sound, spawns: [sp('b', 2)] }),
  noRoute: dead({ ...sound, flags: [fl('A', 1), fl('B', 2, { reachable: false })] }),
  noFlag: dead({ ...sound, flags: [fl('A', 1, { reachable: false }), fl('B', 2, { reachable: false, walked: false, poleLift: 9 })] }),
  refused: dead({ ...sound, spawns: [sp('a', 1, { refused: true }), sp('b', 2)] }),
  stacked: dead({ ...sound, floors: { stacked: true, reason: '40 % of the main floor has another walked floor over or under it' } }),
  // A flag the generator excluded is a warning, not an error.
  excluded: run({ ...good, generated: { unreachable: ['B'] } }, lf, grid, { walk: { ...sound, flags: [fl('A', 1), fl('B', 2, { reachable: false }), fl('C', 0)] } }).errors.length,
};
const match = o => ({ enemyKills: { 1: 3, 2: 4 }, ticketsBled: { 1: 5, 2: 5 }, botErrors: 0, capturesTotal: 2, idleShare: 0.3, routeFailuresPerBotMinute: 0.4, stuckSecondsPerBotMinute: 1, ...o });
const lintOf = w => ({ ...run(good, lf, grid, { walk: w }), walk: w });
const rows = [
  batch.censusRow('lively', lintOf(sound), match({})),
  batch.censusRow('sealed', lintOf({ ...sound, spawns: [sp('a', 1, { usable: false }), sp('b', 2)] }), match({ enemyKills: { 1: 0, 2: 0 }, ticketsBled: { 1: 0, 2: 0 } })),
  batch.censusRow('missed', lintOf(sound), match({ enemyKills: { 1: 0, 2: 2 } })),
];
out.census = { rows: rows.map(r => [r.level, r.alive, r.dead, r.predictedDead, r.lintAgrees, r.kills, r.spawnsOff, r.flagsOff, r.floors]), table: batch.censusTable(rows).split('\n').length };
// A level the lint refuses is given its verdict with no match run.
const sealedLint = lintOf({ ...sound, spawns: [sp('a', 1, { usable: false }), sp('b', 2)] });
const refusedLevel = batch.unsuitable('sealed', sealedLint);
out.unsuitable = { sound: batch.unsuitable('lively', lintOf(sound)), verdict: refusedLevel.verdict, outcome: refusedLevel.outcome, predictedDead: refusedLevel.predictedDead,
                   errors: refusedLevel.lint.errors.length, sizes: refusedLevel.sizes, acceptable: batch.ACCEPTABLE.includes(refusedLevel.outcome) };
out.alive = jud.aliveChecks([match({}), match({ botErrors: 1 })]).filter(c => !c.pass).map(c => c.metric);

// --- README 22: four ways the lint refused a walkable level ----------------------------
{
  // F4. The page's spawn sides: a neutral point whose group the spawn manager gives a side (Vosges), a group
  // no point claims (Somme's French line), carriers that stand at the start (Desert Combat's weapon bunker:
  // its spawner has a side and no point) and one that does not (Juno's Allied town house: its spawner is
  // filed under a point the Germans hold), and a landing craft that seats whoever spawns on it.
  const pos = (x, z) => [x, 0, z];
  const extras = {
    controlPoints: [
      { name: 'Mountain', position: pos(10, -10), team: 0, spawnGroupId: 1, unableToChangeTeam: true, objectSpawnerId: 7 },
      { name: 'Village', position: pos(30, -30), team: 1, spawnGroupId: 2, objectSpawnerId: 5 },
    ],
    soldierSpawns: [
      { name: 'm1', position: pos(11, -11), group: 1, team: 2 },
      { name: 'v1', position: pos(31, -31), group: 2, team: 1 },
      { name: 'line1', position: pos(50, -50), group: 9, team: 2 },
      { name: 'stray', position: pos(5, -5), group: 4, team: null },
    ],
    objectSpawns: [
      { spawner: 'bunkerspawner', vehicle: 'bunker', team: 1, osId: 1 },
      { spawner: 'townalliedspawner', vehicle: 'townallied', team: null, osId: 5, templates: { 2: 'townallied' } },
      { spawner: 'townaxisspawner', vehicle: 'townaxis', team: null, osId: 5, templates: { 1: 'townaxis' } },
      { spawner: 'lcvpspawner', vehicle: 'lcvp', team: 2 },
    ],
    vehicleSoldierSpawns: [
      { name: 'b', vehicle: 'bunker', spawner: 'bunkerspawner', team: 1, group: 99, position: pos(20, -20) },
      { name: 'b', vehicle: 'bunker', spawner: 'bunkerspawner', team: 1, group: 99, position: pos(21, -20) },
      { name: 't', vehicle: 'townallied', spawner: 'townalliedspawner', team: 2, group: 5, position: pos(30, -32) },
      { name: 'x', vehicle: 'townaxis', spawner: 'townaxisspawner', team: 1, group: 6, position: pos(30, -33) },
      { name: 'd', vehicle: 'lcvp', spawner: 'lcvpspawner', team: 2, group: 72, position: pos(60, -5), aiEnterOnSpawn: true },
    ],
  };
  const sides = Object.fromEntries(gen.spawnsOf(extras).map(s => [s.name, [s.side, !!s.carried, !!s.seats]]));
  out.spawnSides = sides;

  // F4's wording: a side whose spawns all start at sea (a deck, a landing craft) or seat their soldier in a vehicle.
  const atSea = run(good, lf, grid, { walk: { ...sound, spawns: [sp('a', 1), sp('s', 2, { landed: false, usable: false, sea: true }),
    sp('h', 2, { usable: false, carried: 'halftrack', seats: true })] } });
  out.atSea = atSea.errors.map(e => e.text);

  // F3. A platform 1.5 m up beside the main ground: walked off one way and never back; a 3 m one is no way.
  const shelfFlags = [{ name: 'F', x: 40, y: 0, z: -30, radius: 5, team: 0, fixed: false }, { name: 'G', x: 50, y: 0, z: -20, radius: 5, team: 2, fixed: false }];
  const exitOf = height => {
    const world = boxWorld([[0, 20, 0, height, -64, 0]]);
    const spawns = [{ name: 'up', x: 10, y: height, z: -30, side: 1 }, { name: 'low', x: 40, y: 0, z: -40, side: 2 }];
    const f = wf.walkFacts({ collider: world, grid: gridOf(new Uint8Array(SIZE * SIZE)), flags: shelfFlags, spawns, body });
    const up = f.spawns[0];
    return { onMain: up.onMainGround, exit: up.exit, serves: wf.serves(up), excluded: gen.excludedByWalk(f) };
  };
  out.oneWay = { ledge: exitOf(1.5), cliff: exitOf(3) };

  // F1. A capped flood seeds a flag beside its pole: a start inside the pole's collision (a cage 0.6 m
  // across inside) never leaves it, and the flag would read as standing on no walked ground.
  const flag = { name: 'Far', x: 50, y: 0, z: -50, radius: 5, team: 0, fixed: false };
  const cage = [[49.3, 50.7, 0, 8, -50.75, -50.7], [49.3, 50.7, 0, 8, -49.3, -49.25], [49.25, 49.3, 0, 8, -50.7, -49.3], [50.7, 50.75, 0, 8, -50.7, -49.3]];
  const poled = boxWorld(cage);
  const pole = wf.walkFlood(poled, [[flag.x, flag.y, flag.z]], body, { twoWay: true, reach: 20 });
  const seeds = wf.flagSeeds(poled, flag, body);
  const spawnsFar = [{ name: 'a', x: 6, y: 0, z: -6, side: 1 }, { name: 'b', x: 8, y: 0, z: -6, side: 2 }];
  const near = { name: 'Near', x: 7, y: 0, z: -8, radius: 5, team: 0, fixed: false };
  const ground = wf.walkedGround(poled, spawnsFar, [flag, near], body, SIZE, { maxCells: 4000 });
  const capped = wf.walkFacts({ collider: poled, grid: gridOf(new Uint8Array(SIZE * SIZE)), flags: [flag, near], spawns: spawnsFar, body, ground });
  // The same capped flood seeded at the pole alone, as before generator 6.
  const poleOnly = wf.walkFlood(poled, [...spawnsFar.map(q => [q.x, q.y, q.z]), [flag.x, flag.y, flag.z], [near.x, near.y, near.z]], body,
    { twoWay: true, bounds: wf.floodBounds([...spawnsFar, flag, near], SIZE), maxCells: 4000 });
  const before = wf.walkFacts({ collider: poled, grid: gridOf(new Uint8Array(SIZE * SIZE)), flags: [flag, near], spawns: spawnsFar, body, ground: poleOnly });
  out.flagSeeds = { poleCells: pole.cells, seeds: seeds.length, capped: ground.capped, reachable: capped.flags[0].reachable,
    poleOnlyCapped: poleOnly.capped, poleOnlyReachable: before.flags[0].reachable };

  // F2. A capped level's painter map that holds little of the ground is kept, not painted from the flood,
  // and a spawn the map shuts in gets its walked way opened; a spawn 5 m from the map's main component
  // serves as the page resolves its start.
  const painterPx = new Uint8Array(SIZE * SIZE).fill(1);
  for (let z = 22; z <= 38; z++) for (let x = 2; x <= 40; x++) painterPx[z * SIZE + x] = 0;   // a strip from the west base to Mid
  const kept = gen.prepareWalkMap({ collider: level, size: SIZE, flags: wFlags, spawns: wSpawns, body, engine: painterPx, paint: false });
  const painted = gen.prepareWalkMap({ collider: level, size: SIZE, flags: wFlags, spawns: wSpawns, body, engine: painterPx });
  out.painterMap = { keptSource: kept.source, paintedSource: painted.source, keptCover: kept.engineCover < 0.5,
    keptWays: kept.ways.map(w => [w.who, w.way, w.opened > 0]) };
  const ring = new Uint8Array(SIZE * SIZE);
  for (let z = 25; z <= 35; z++) for (let x = 3; x <= 13; x++) ring[z * SIZE + x] = 1;                  // a 10 m square round a1
  const resolveFacts = wf.walkFacts({ collider: level, grid: gridOf(ring), flags: wFlags, spawns: wSpawns.slice(0, 2), body });
  const a1 = resolveFacts.spawns[0];
  out.resolve = { usable: a1.usable, resolved: a1.resolved, serves: wf.serves(a1) };
}
console.log(JSON.stringify(out));
