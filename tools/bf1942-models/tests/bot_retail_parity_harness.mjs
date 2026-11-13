// Retail-parity checks of 2026-11-12 (the bots-ai cross-check): the
// anti-aircraft term of the AI spread, the two curve tables.
import { aaPenalty, FIRE, unarmedThreat } from './bot-fire.js';
import { DeviationModel } from './deviation.js';
import { decleiningSlope, sCurve, DECLEIN_TABLE } from './bot-behaviours.js';
import { sCurveExact, SCURVE_TABLE } from './bot-sense.js';
import { inclinationSplit, orderSplit } from './bot-vehicle.js';
import { stepInclinations, activeColumn } from './bot-decision.js';
import { inhibitorColumn, setRowsMod } from './bot-rows.js';

const out = {};
const ai = (botSkill, aaPenalty) => new DeviationModel({}).setAIDeviation({
  botSkill, aaPenalty, timeSinceTarget: 100, deviation: 5.0, correctionTime: 10.0,
});
out.penalty = {
  footAtAir: aaPenalty({ shooterKind: null, targetAir: true }),
  tankAtAir: aaPenalty({ shooterKind: 'tank', targetAir: true }),
  shipAtAir: aaPenalty({ shooterKind: 'ship', targetAir: true }),
  airAtAir: aaPenalty({ shooterKind: 'air', targetAir: true }),
  footAtGround: aaPenalty({ shooterKind: null, targetAir: false }),
  heldFootAtAir: aaPenalty({ shooterKind: null, targetAir: true, continuous: true }),
  heldShipAtAir: aaPenalty({ shooterKind: 'ship', targetAir: true, continuous: true }),
};
out.spread = { ground: ai(0.75, 0), air: ai(0.75, out.penalty.footAtAir) };
out.declein = [0, 0.005, 0.0199, 0.02, 0.395, 0.999, 1, 1.5].map(decleiningSlope);
out.decleinTable = { n: DECLEIN_TABLE.length, i1: DECLEIN_TABLE[1], i39: DECLEIN_TABLE[39] };
out.sCurveSame = [0.1, 0.37, 0.5, 0.9].every(x => sCurve(x) === sCurveExact(x));
out.scurve37 = sCurve(0.37);
out.fire = { ground: FIRE.aaPenaltyGround, naval: FIRE.aaPenaltyNaval };
out.split = {
  both: inclinationSplit(3, 1), moveOnly: inclinationSplit(0, 2), fireOnly: inclinationSplit(2, 0), neither: inclinationSplit(0, 0),
  legacy: orderSplit(0, 0),
};
{
  const bot = { inclination: { fire: 0, move: 0, fireAcc: 10, moveAcc: 5 } };
  stepInclinations(bot);
  const first = { ...bot.inclination };
  bot.inclination.fireAcc = 10;
  stepInclinations(bot);
  out.step = { first, second: { ...bot.inclination } };
}
setRowsMod('bf1942');
out.columns = {
  tankChange: inhibitorColumn('Tank', 'Change'),
  footChange: inhibitorColumn('Infantery', 'Change'),
  carChange: inhibitorColumn('Car', 'Change'),
  fixedAvoid: inhibitorColumn('Fixed', 'Avoid'),
  footActive: activeColumn({ vehicle: null }, 'Change'),
  seatActive: activeColumn({ vehicle: { row: { name: 'Passenger' } } }, 'Change'),
  rowlessSeat: activeColumn({ vehicle: { row: null } }, 'Change'),
  fireActive: activeColumn({ vehicle: { row: { name: 'Tank' } } }, 'Fire'),
  bf1918Foot: inhibitorColumn('Infantry', 'Change', 'bf1918'),
};
{
  const tank = { type: 'HeavyArmour', enemyManned: true, seats: [{ table: { LightArmour: 2 }, value: 3 }, { table: { LightArmour: 1 }, value: 0 }] };
  const empty = { type: 'HeavyArmour', enemyManned: false, seats: [{ table: { LightArmour: 2 }, value: 3 }] };
  const soldier = { type: 'Infantry', enemyManned: false, seats: null };
  const harmless = { type: 'LightArmour', enemyManned: true, seats: [{ table: { LightArmour: 0 }, value: 6 }] };
  const infos = { t: tank, e: empty, s: soldier, h: harmless };
  const run = (spotted, extra = {}) => unarmedThreat({ spotted, position: [0, 0, 0], now: 10, infoOf: id => infos[id], myType: 'LightArmour', ...extra });
  out.unarmed = {
    tank100: run([{ id: 't', pos: [100, 0, 0] }]),
    tank1: run([{ id: 't', pos: [0.1, 0, 0] }]),
    far: run([{ id: 't', pos: [300, 0, 0] }]),
    emptyAndSoldier: run([{ id: 'e', pos: [10, 0, 0] }, { id: 's', pos: [5, 0, 0] }]),
    lost: run([{ id: 't', pos: [100, 0, 0], lost: true, lostAt: 0 }]),
    harmless: run([{ id: 'h', pos: [10, 0, 0] }]),
    outside: run([{ id: 't', pos: [100, 0, 0] }], { insideOrderedArea: false }),
  };
}
process.stdout.write(JSON.stringify(out));
