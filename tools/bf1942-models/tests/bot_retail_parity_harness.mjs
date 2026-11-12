// Retail-parity checks of 2026-11-12 (the bots-ai cross-check): the
// anti-aircraft term of the AI spread, the two curve tables.
import { aaPenalty, FIRE } from './bot-fire.js';
import { DeviationModel } from './deviation.js';
import { decleiningSlope, sCurve, DECLEIN_TABLE } from './bot-behaviours.js';
import { sCurveExact, SCURVE_TABLE } from './bot-sense.js';

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
process.stdout.write(JSON.stringify(out));
