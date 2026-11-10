// Pins the bot-match verifier's figures by side (features/bot-map-generation):
// the detector's split of the movement rates and of the deaths no enemy
// caused (`sim/detect.mjs sideFigures`), and the judge's worse-side checks
// (`sim/judge.mjs WORSE_SIDE`). Run by `tests/test_bot_judge_sides.py`.
// One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const det = await imp('sim/detect.mjs');
const jud = await imp('sim/judge.mjs');
const out = {};

// --- the detector ------------------------------------------------------------
// Two bots a side for 120 traced seconds: four bot-minutes each side.
const BOTS = [{ id: 'bot_0', side: 1 }, { id: 'bot_1', side: 2 }, { id: 'bot_2', side: 1 }, { id: 'bot_3', side: 2 }];
const header = (o = {}) => ({ level: 't', seed: 1, botsPerSide: 2, duration: 120, tickHz: 30, traceEvery: 30, tickets: { 1: 100, 2: 100 },
                              flags: [{ name: 'F', uncapturable: false, controlPoint: true }], bots: BOTS, ...o });
const ev = (t, type, o) => ({ k: 'ev', t, type, ...o });

function ticks(d, { sideOnTick = false, wall = true } = {}) {
  for (let t = 1; t <= 120; t++) {
    for (const [i, b] of BOTS.entries()) {
      // bot_0 walks, pushes at a wall from t = 20 to t = 60, and walks on; the rest keep moving.
      const x = b.id === 'bot_0' && wall ? (t < 20 ? t * 3 : t <= 60 ? 60 : 60 + (t - 60) * 3) : t * 3;
      det.feed(d, { k: 'tick', t, bot: b.id, ...(sideOnTick ? { side: b.side } : {}), alive: true, pos: [x, 0, -10 - i * 40],
                    beh: 'MoveTo', ctl: [1, 0, 0, 0, 0], area: 'A', target: null });
    }
  }
}

/** One side takes every redeploy, most of the failed routes, the wall and the self death. */
function lopsided() {
  const d = det.newDetector(header());
  ticks(d);
  for (const [t, bot] of [[30, 'bot_0'], [50, 'bot_0'], [70, 'bot_2'], [90, 'bot_0']]) det.feed(d, ev(t, 'redeploy', { bot, side: 1, flag: 'Base', pos: [0, 0, 0] }));
  for (const [t, bot, side] of [[29, 'bot_0', 1], [49, 'bot_0', 1], [69, 'bot_2', 1], [80, 'bot_1', 2]]) det.feed(d, ev(t, 'route_failed', { bot, side, count: 1, pos: [0, 0, 0] }));
  // The Axis: one soldier killed by the enemy, one dead by nobody's hand.
  det.feed(d, ev(40, 'kill', { killer: 'bot_1', killerSide: 2, victim: 'bot_0', victimSide: 1, pos: [500, 0, 0] }));
  det.feed(d, ev(41, 'kill', { killer: null, killerSide: null, victim: 'bot_2', victimSide: 1, pos: [500, 0, 0] }));
  // The Allies: three killed by the enemy, one of them ten metres and four seconds from the spawn, and one by their own side.
  det.feed(d, ev(100, 'respawn', { bot: 'bot_3', side: 2, flag: 'Base', pos: [900, 0, -900] }));
  det.feed(d, ev(104, 'kill', { killer: 'bot_0', killerSide: 1, victim: 'bot_3', victimSide: 2, pos: [910, 0, -900] }));
  det.feed(d, ev(110, 'kill', { killer: 'bot_0', killerSide: 1, victim: 'bot_1', victimSide: 2, pos: [500, 0, 0] }));
  det.feed(d, ev(111, 'kill', { killer: 'bot_2', killerSide: 1, victim: 'bot_1', victimSide: 2, pos: [500, 0, 0] }));
  det.feed(d, ev(112, 'kill', { killer: 'bot_1', killerSide: 2, victim: 'bot_3', victimSide: 2, pos: [500, 0, 0] }));
  return d;
}
const slim = ({ heat, stuckPlaces, behaviourShare, ...row }) => row;
// With no summary the counts are the trace's events.
out.fromTrace = slim(det.finish(lopsided(), null, 120));
// With one, they are the sums of its `perBot` lines by side: the source of the two-side totals.
const summary = {
  result: { winner: 1, reason: 'time', tickets: { 1: 96, 2: 94 } },
  metrics: { routeFailures: { total: 6 }, redeploys: 4, botErrors: 0 },
  perBot: { bot_0: { side: 1, redeploys: 3, routeFailures: 3 }, bot_1: { side: 2, redeploys: 0, routeFailures: 1 },
            bot_2: { side: 1, redeploys: 1, routeFailures: 2 }, bot_3: { side: 2, redeploys: 0, routeFailures: 0 } },
};
out.fromSummary = slim(det.finish(lopsided(), summary, 120));

// A side with nothing to show has no share, and the worse side is the other's.
const oneDeath = det.newDetector(header());
ticks(oneDeath, { wall: false });
det.feed(oneDeath, ev(40, 'kill', { killer: 'bot_0', killerSide: 1, victim: 'bot_1', victimSide: 2, pos: [500, 0, 0] }));
out.oneDeath = slim(det.finish(oneDeath, null, 120));
// Nobody dies and nobody redeploys: neither side has a share.
const quiet = det.newDetector(header());
ticks(quiet, { wall: false });
out.quiet = slim(det.finish(quiet, null, 120));
// A header with no list of bots: the sides come from the tick lines.
const fromTicks = det.newDetector(header({ bots: undefined }));
ticks(fromTicks, { sideOnTick: true });
det.feed(fromTicks, ev(30, 'redeploy', { bot: 'bot_1', flag: 'Base', pos: [0, 0, 0] }));
out.sidesFromTicks = slim(det.finish(fromTicks, null, 120));
// A trace that never says a side: the row is written, with no figure by side.
const noSides = det.newDetector(header({ bots: undefined }));
ticks(noSides);
det.feed(noSides, ev(41, 'kill', { killer: null, victim: 'bot_2', pos: [500, 0, 0] }));
out.noSides = slim(det.finish(noSides, null, 120));
out.worseSide = [det.worseSide({ 1: 0.2, 2: 0.5 }), det.worseSide({ 1: null, 2: 0.1 }), det.worseSide({ 1: null, 2: null }), det.worseSide(undefined)];

// --- the judge -----------------------------------------------------------------
// A row as the detector wrote it before it kept sides.
const old = (o = {}) => ({ level: 'dice', botsPerSide: 8, seed: 1, capturable: 2, flagsNeverChanged: [], capturesTotal: 4, captures: { 1: 2, 2: 2 },
  stuckSecondsPerBotMinute: 1, idleShare: 0.1, oscillationsPerBotMinute: 0, selfDeathsPerBotMinute: 0, spawnTrapsPerBotMinute: 0.05,
  routeFailuresPerBotMinute: 1, redeploysPerBotMinute: 0.1, botErrors: 0, ticketsBled: { 1: 5, 2: 5 }, winner: 1, firstCapture: 30,
  teamKillsPerBotMinute: 0.01, enemyKillsPerBotMinute: 0.5, enemyKills: { 1: 3, 2: 4 }, ...o });
// The same with the sides: `r` the two sides' redeploy rates, `share` their death shares.
const row = ({ r = [0.08, 0.12], share = [0.1, 0.2], ...o } = {}) => old({
  stuckSecondsPerBotMinuteBySide: { 1: 0.8, 2: 1.2 }, stuckSecondsPerBotMinuteWorseSide: 1.2,
  spawnTrapsPerBotMinuteBySide: { 1: 0.04, 2: 0.06 }, spawnTrapsPerBotMinuteWorseSide: 0.06,
  routeFailuresPerBotMinuteBySide: { 1: 0.9, 2: 1.1 }, routeFailuresPerBotMinuteWorseSide: 1.1,
  redeploysPerBotMinute: +((r[0] + r[1]) / 2).toFixed(4),
  redeploysPerBotMinuteBySide: { 1: r[0], 2: r[1] }, redeploysPerBotMinuteWorseSide: Math.max(...r),
  nonEnemyDeathShareBySide: { 1: share[0], 2: share[1] }, nonEnemyDeathShareWorseSide: det.worseSide({ 1: share[0], 2: share[1] }),
  ...o });
// The baseline's redeploys: 0.10, 0.15 and 0.20 over both sides, 0.12, 0.20 and 0.30 on the worse one.
const dice = [row(), row({ seed: 2, r: [0.1, 0.2], share: [0.2, 0.3] }), row({ seed: 3, r: [0.3, 0.1], share: [0.4, 0.1] })];
const base = jud.buildBaseline(dice, 'test');
const band = base.sizes[8];
out.worseSideKeys = jud.WORSE_SIDE;
out.bands = Object.fromEntries(jud.WORSE_SIDE.map(k => [k, band.metrics[k]]));
out.bandBothSides = band.metrics.redeploysPerBotMinute;
out.metricOrder = Object.keys(band.metrics);
out.levelMedians = band.perLevel.dice.medians;

const judged = rows => { const v = jud.judge(rows, base); return { verdict: v.verdict, failed: v.failed, checks: v.checks }; };
const check = (v, metric) => v.checks.find(c => c.metric === metric);
out.checkOrder = judged([row({ level: 'x' })]).checks.map(c => c.metric);
// Both sides alike: the average and the worse side pass.
out.even = judged([row({ level: 'x', r: [0.15, 0.17] }), row({ level: 'x', seed: 2, r: [0.17, 0.15] })]);
// One side takes the redeploys: 0.16 over both, inside the bar; 0.32 on the Axis, over it.
const lop = judged([row({ level: 'x', r: [0.32, 0] }), row({ level: 'x', seed: 2, r: [0.32, 0] }), row({ level: 'x', seed: 3, r: [0, 0.32] })]);
out.lopsided = { verdict: lop.verdict, failed: lop.failed, average: check(lop, 'redeploysPerBotMinute'), worse: check(lop, 'redeploysPerBotMinuteWorseSide') };
// The median over the seeds is what is judged: one bad seed in three passes.
out.oneBadSeed = judged([row({ level: 'x' }), row({ level: 'x', seed: 2 }), row({ level: 'x', seed: 3, r: [0.9, 0] })]).failed;
// A side most of whose deaths no enemy caused.
const dying = judged([row({ level: 'x', share: [0.8, 0.1] }), row({ level: 'x', seed: 2, share: [0.7, 0.2] })]);
out.dying = { failed: dying.failed, check: check(dying, 'nonEnemyDeathShareWorseSide') };
// A seed where nobody dies has no share: the check is taken over the seeds that have one.
const someShare = judged([row({ level: 'x', share: [null, null] }), row({ level: 'x', seed: 2, share: [null, 0.2] }), row({ level: 'x', seed: 3, share: [0.3, 0.1] })]);
out.someShare = { failed: someShare.failed, check: check(someShare, 'nonEnemyDeathShareWorseSide') };
const noShare = judged([row({ level: 'x', share: [null, null] })]);
out.noShare = { failed: noShare.failed, check: check(noShare, 'nonEnemyDeathShareWorseSide') };

// Rows from before the detector kept sides: read, not measured, not failed.
const oldRows = judged([old({ level: 'x' }), old({ level: 'x', seed: 2 })]);
out.oldRows = { verdict: oldRows.verdict, failed: oldRows.failed, checks: oldRows.checks.filter(c => jud.WORSE_SIDE.includes(c.metric)) };
// ...and they still fail what they failed before.
out.oldRowsStillFail = judged([old({ level: 'x', redeploysPerBotMinute: 0.9 })]).failed;
// A baseline from before the bands: the same.
const oldBase = jud.buildBaseline([old(), old({ seed: 2 })], 'old');
for (const k of jud.WORSE_SIDE) delete oldBase.sizes[8].metrics[k];
const onOldBase = jud.judge([row({ level: 'x', r: [0.9, 0] })], oldBase);
out.oldBaseline = { failed: onOldBase.failed.filter(f => jud.WORSE_SIDE.includes(f)), bars: onOldBase.checks.filter(c => jud.WORSE_SIDE.includes(c.metric)).map(c => c.bar) };

console.log(JSON.stringify(out));
