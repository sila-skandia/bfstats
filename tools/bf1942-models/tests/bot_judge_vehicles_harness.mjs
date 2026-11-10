// Pins the bot-match verifier's vehicle figures (features/bot-map-generation):
// the detector's hulls driven at a wall, units nobody sat in, tank seats
// that never fired and team kills from a seat (`sim/detect.mjs
// vehicleFigures`), and the judge's vehicle checks, made only against a
// baseline of matches played with vehicles (`sim/judge.mjs VEHICLE_LOWER`).
// Run by `tests/test_bot_judge_vehicles.py`. One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const det = await imp('sim/detect.mjs');
const jud = await imp('sim/judge.mjs');
const out = {};

// --- the detector ------------------------------------------------------------
// Two bots a side for 120 traced seconds on a level of five units: two
// Shermans, a Tiger, a Willy and a Kubelwagen nobody takes.
const BOTS = [{ id: 'bot_0', side: 1 }, { id: 'bot_1', side: 2 }, { id: 'bot_2', side: 1 }, { id: 'bot_3', side: 2 }];
const header = (o = {}) => ({ level: 't', seed: 1, botsPerSide: 2, duration: 120, tickHz: 30, traceEvery: 30, tickets: { 1: 100, 2: 100 },
                              flags: [{ name: 'F', uncapturable: false, controlPoint: true }], bots: BOTS, vehicles: 5, ...o });
const ev = (t, type, o) => ({ k: 'ev', t, type, ...o });
const unit = (id, template, seat = template) => ({ id, template, seat, drives: true });
// Who sits where, second by second.
const seatOf = (bot, t) => {
  if (bot === 'bot_0') return unit('Tiger_1', 'Tiger');                       // the whole match
  if (bot === 'bot_1') return unit('Sherman_1', 'Sherman');                   // the whole match, and never fires
  if (bot === 'bot_3') return t >= 5 && t < 35 ? unit('Sherman_2', 'Sherman') : t >= 40 && t < 110 ? unit('Willy', 'Willy') : null;
  return null;                                                                // bot_2 walks
};

function vehicleMatch() {
  const d = det.newDetector(header());
  const feed = o => det.feed(d, o);
  feed(ev(0.5, 'mount', { bot: 'bot_0', side: 1, vehicle: 'Tiger_1', template: 'Tiger', seat: 'Tiger', driver: true }));
  feed(ev(0.5, 'mount', { bot: 'bot_1', side: 2, vehicle: 'Sherman_1', template: 'Sherman', seat: 'Sherman', driver: true }));
  for (let t = 1; t <= 120; t++) {
    if (t === 5) feed(ev(5, 'mount', { bot: 'bot_3', side: 2, vehicle: 'Sherman_2', template: 'Sherman', seat: 'Sherman', driver: true }));
    // Thirty seconds in the second Sherman, with a round fired: the seat is an armed one.
    if (t === 10) feed(ev(10, 'vehicle_fire', { bot: 'bot_3', side: 2, vehicle: 'Sherman_2', template: 'Sherman', kind: 'tank', seat: 'Sherman', gun: 'Sherman_Gun' }));
    if (t === 35) feed(ev(35, 'dismount', { bot: 'bot_3', side: 2, vehicle: 'Sherman_2', template: 'Sherman', killed: false }));
    // Seventy seconds in a jeep, which has no gun.
    if (t === 40) feed(ev(40, 'mount', { bot: 'bot_3', side: 2, vehicle: 'Willy', template: 'Willy', seat: 'Willy', driver: true }));
    if (t === 80) feed(ev(80, 'vehicle_fire', { bot: 'bot_0', side: 1, vehicle: 'Tiger_1', template: 'Tiger', kind: 'tank', seat: 'Tiger', gun: 'Tiger_Gun' }));
    if (t === 110) feed(ev(110, 'dismount', { bot: 'bot_3', side: 2, vehicle: 'Willy', template: 'Willy', killed: false }));
    for (const [i, b] of BOTS.entries()) {
      const veh = seatOf(b.id, t);
      // The Tiger drives, pushes at a wall from t = 20 to t = 70 with the throttle on, and drives on.
      // The first Sherman stands from t = 50 to t = 80 with the throttle off: parked, not stuck.
      const x = b.id === 'bot_0' ? (t < 20 ? t * 3 : t <= 70 ? 60 : 60 + (t - 70) * 3)
        : b.id === 'bot_1' ? (t < 50 ? t * 3 : t <= 80 ? 150 : 150 + (t - 80) * 3) : t * 3;
      const throttle = b.id === 'bot_1' && t >= 50 && t <= 80 ? 0 : 1;
      feed({ k: 'tick', t, bot: b.id, side: b.side, alive: true, pos: [x, 0, -10 - i * 40], beh: 'MoveTo', ctl: [throttle, 0, 0, 0, 0], area: 'A', target: null, veh });
    }
  }
  // The first Sherman's gunner hits their own side's soldier, from the seat.
  feed(ev(115, 'kill', { killer: 'bot_1', killerSide: 2, victim: 'bot_3', victimSide: 2, weapon: 'Sherman', pos: [500, 0, 0] }));
  // ...and a soldier on foot does the same: a team kill, not one from a seat.
  feed(ev(116, 'kill', { killer: 'bot_2', killerSide: 1, victim: 'bot_0', victimSide: 1, weapon: 'K98', pos: [500, 0, 0] }));
  return d;
}
const slim = ({ heat, stuckPlaces, behaviourShare, ...row }) => row;
out.row = slim(det.finish(vehicleMatch(), null, 120));
out.tankSeatingSeconds = det.TANK_SEATING_SECONDS;

// The same bots on foot, on a level with no unit: no vehicle figure in the row.
const foot = det.newDetector(header({ vehicles: 0 }));
for (let t = 1; t <= 120; t++) for (const [i, b] of BOTS.entries()) {
  det.feed(foot, { k: 'tick', t, bot: b.id, side: b.side, alive: true, pos: [t * 3, 0, -10 - i * 40], beh: 'MoveTo', ctl: [1, 0, 0, 0, 0], area: 'A', target: null, veh: null });
}
const footRow = slim(det.finish(foot, null, 120));
out.footKeys = Object.keys(footRow);
// Units and nobody in a tank's armed seat for a minute: no silent share.
const noTank = det.newDetector(header());
det.feed(noTank, ev(0.5, 'mount', { bot: 'bot_3', side: 2, vehicle: 'Willy', template: 'Willy', seat: 'Willy', driver: true }));
for (let t = 1; t <= 120; t++) for (const [i, b] of BOTS.entries()) {
  det.feed(noTank, { k: 'tick', t, bot: b.id, side: b.side, alive: true, pos: [t * 3, 0, -10 - i * 40], beh: 'MoveTo', ctl: [1, 0, 0, 0, 0], area: 'A', target: null,
                     veh: b.id === 'bot_3' ? unit('Willy', 'Willy') : null });
}
out.noTank = slim(det.finish(noTank, null, 120));

// --- the judge -----------------------------------------------------------------
const VEH = [...jud.VEHICLE_LOWER, ...jud.VEHICLE_CONTEXT];
out.vehicleLower = jud.VEHICLE_LOWER;
out.vehicleContext = jud.VEHICLE_CONTEXT;
// A row of a match on foot, as the detector writes it.
const onFoot = (o = {}) => ({ level: 'dice', botsPerSide: 8, seed: 1, capturable: 2, flagsNeverChanged: [], capturesTotal: 4, captures: { 1: 2, 2: 2 },
  stuckSecondsPerBotMinute: 1, idleShare: 0.1, oscillationsPerBotMinute: 0, selfDeathsPerBotMinute: 0, spawnTrapsPerBotMinute: 0.05,
  routeFailuresPerBotMinute: 1, redeploysPerBotMinute: 0.1, botErrors: 0, ticketsBled: { 1: 5, 2: 5 }, winner: 1, firstCapture: 30,
  teamKillsPerBotMinute: 0.01, enemyKillsPerBotMinute: 0.5, enemyKills: { 1: 3, 2: 4 },
  stuckSecondsPerBotMinuteBySide: { 1: 0.8, 2: 1.2 }, stuckSecondsPerBotMinuteWorseSide: 1.2,
  spawnTrapsPerBotMinuteBySide: { 1: 0.04, 2: 0.06 }, spawnTrapsPerBotMinuteWorseSide: 0.06,
  routeFailuresPerBotMinuteBySide: { 1: 0.9, 2: 1.1 }, routeFailuresPerBotMinuteWorseSide: 1.1,
  redeploysPerBotMinuteBySide: { 1: 0.08, 2: 0.12 }, redeploysPerBotMinuteWorseSide: 0.12,
  nonEnemyDeathShareBySide: { 1: 0.1, 2: 0.2 }, nonEnemyDeathShareWorseSide: 0.2, ...o });
// The same with the level's vehicles in: every vehicle figure the judge knows, at `v` unless given.
const withVehicles = ({ v = 0.2, ...o } = {}) => onFoot({ config: 'with vehicles', ...Object.fromEntries(VEH.map(k => [k, v])),
  hullStuckSecondsPerDrivingMinuteBySide: { 1: v, 2: v / 2 }, ...o });
const vehicleBase = jud.buildBaseline([withVehicles({ v: 0.1 }), withVehicles({ seed: 2, v: 0.2 }), withVehicles({ seed: 3, v: 0.3 })], 'vehicles');
const footBase = jud.buildBaseline([onFoot(), onFoot({ seed: 2 }), onFoot({ seed: 3 })], 'on foot');
out.vehicleBands = Object.fromEntries(VEH.map(k => [k, vehicleBase.sizes[8].metrics[k] ?? null]));
out.vehicleMetricOrder = Object.keys(vehicleBase.sizes[8].metrics);
out.vehicleLevelMedians = Object.keys(vehicleBase.sizes[8].perLevel.dice.medians);
out.footMetricOrder = Object.keys(footBase.sizes[8].metrics);
out.footLevelMedians = Object.keys(footBase.sizes[8].perLevel.dice.medians);

const judged = (rows, base) => { const v = jud.judge(rows, base); return { verdict: v.verdict, failed: v.failed, metrics: v.checks.map(c => c.metric), checks: v.checks.filter(c => VEH.includes(c.metric)) }; };
// Against the vehicles baseline: inside every bar, and each figure over its own.
out.pass = judged([withVehicles({ level: 'x', v: 0.2 }), withVehicles({ level: 'x', seed: 2, v: 0.25 })], vehicleBase);
out.failEach = Object.fromEntries(jud.VEHICLE_LOWER.map(k => [k, judged([withVehicles({ level: 'x', [k]: 0.9 }), withVehicles({ level: 'x', seed: 2, [k]: 0.9 })], vehicleBase).failed]));
// The context figures are in the baseline and fail nothing, wherever they stand.
out.context = Object.fromEntries(jud.VEHICLE_CONTEXT.map(k => [k, [0, 0.9].flatMap(v => judged([withVehicles({ level: 'x', [k]: v })], vehicleBase).failed)]));
// A level with no tank seat held a minute has no silent share: not measured.
out.noFigure = judged([withVehicles({ level: 'x', tankSilentShare: null }), withVehicles({ level: 'x', seed: 2, tankSilentShare: null })], vehicleBase);
// Rows of matches on foot against the vehicles baseline: read, not measured, not failed.
out.footRows = judged([onFoot({ level: 'x' }), onFoot({ level: 'x', seed: 2 })], vehicleBase);
// The on-foot baseline carries no vehicle band, and the on-foot judge makes no vehicle check, whatever the rows hold.
out.footBaseline = judged([withVehicles({ level: 'x', v: 0.9 })], footBase);
out.footBaselineOnFoot = judged([onFoot({ level: 'x' })], footBase);
// A baseline in which one side's every death is by no enemy's hand: the bar is the whole share, and holds nothing.
const ceilingBase = jud.buildBaseline([1, 2, 3].map(seed => withVehicles({ seed, nonEnemyDeathShareBySide: { 1: 1, 2: 0.2 }, nonEnemyDeathShareWorseSide: 1 })), 'ceiling');
const atCeiling = jud.judge([withVehicles({ level: 'x', nonEnemyDeathShareBySide: { 1: 1, 2: 1 }, nonEnemyDeathShareWorseSide: 1 })], ceilingBase);
out.ceiling = { failed: atCeiling.failed, check: atCeiling.checks.find(c => c.metric === 'nonEnemyDeathShareWorseSide'), share: jud.SHARE_CEILING };

console.log(JSON.stringify(out));
