// Drives `viewer/engine-revs.js` outside a browser and prints one JSON blob.
//
// The module imports nothing at all, so `test_engine_revs.py` copies it in as
// `engine-revs.mjs` and runs this beside it. Every number asserted against it
// comes from `subsystems/tank-driving.md` §3/§4 and ledger TANK-12/TANK-13.
import {
  RATIO_CURVE, TORQUE_CURVE, distribution, sampleCurve,
  currentRatio, currentTorque, revStep, revAdvance, loadSample,
  REV_GAIN, REV_DAMP, REV_MAX, REV_MIN, LOAD_DECAY,
} from './engine-revs.mjs';

const r3 = n => +n.toFixed(3);
const out = {};

out.constants = { REV_GAIN, REV_DAMP, REV_MAX, REV_MIN, LOAD_DECAY };

// --- the two curves ---------------------------------------------------------
out.ratioByTen = [];
out.torqueByTen = [];
for (let i = 0; i <= 100; i += 10) {
  out.ratioByTen.push(r3(RATIO_CURVE[i]));
  out.torqueByTen.push(r3(TORQUE_CURVE[i]));
}
out.ratioSpot = { 25: r3(RATIO_CURVE[25]), 50: r3(RATIO_CURVE[50]), 75: r3(RATIO_CURVE[75]) };
out.curveLengths = [RATIO_CURVE.length, TORQUE_CURVE.length];
// `generateDistribution` holds the last authored value flat to the end, and
// leaves nothing at the constructor's fill once index 0 is an anchor.
out.flatTail = distribution({ 10: 4 }, 1).slice(10).every(v => v === 4);
out.rampFromFill = r3(distribution({ 20: 3.5 }, 1)[10]);
// The sampler truncates toward zero and lerps with the next slot.
out.sampled = { at20: r3(sampleCurve(RATIO_CURVE, 20)),
                at205: r3(sampleCurve(RATIO_CURVE, 20.5)),
                at100: r3(sampleCurve(RATIO_CURVE, 100)),
                past: r3(sampleCurve(RATIO_CURVE, 140)) };

// --- getCurrentRatio --------------------------------------------------------
out.ratios = {
  // Every vanilla ship: `numberOfGears` unauthored, so index 100 forever.
  fletcher: +currentRatio(2).toFixed(4),
  enterprise: +currentRatio(1.5).toFixed(4),
  princeow: +currentRatio(2.2).toFixed(4),
  // The published ground ladders, as a cross-check on the curve itself.
  sherman: [1, 2, 3, 4, 5].map(g => +currentRatio(4, g, 5).toFixed(3)),
  m3a1: [1, 2, 3, 4].map(g => +currentRatio(5, g, 4).toFixed(3)),
};

// --- getCurrentTorque -------------------------------------------------------
out.torque = {
  atRest: r3(currentTorque(2, 0)),
  atPeak: r3(currentTorque(2, 0.6)),
  atRedline: r3(currentTorque(2, 1)),
  // `min(|revs|, 1)`: saturated revs read the same slot as full revs, and the
  // index is the magnitude, so astern reads the same curve.
  saturated: r3(currentTorque(2, 1.2)),
  astern: r3(currentTorque(2, -0.6)),
};

// --- the filter -------------------------------------------------------------
out.filter = {
  // One tick from rest at full pedal: 0.05*((1-0)-0) = 0.05.
  firstTick: +revStep(0, 1, 0).toFixed(6),
  // The fixed point with no load is 2*T1, so the clamp is what a pedal at the
  // floor actually reaches.
  clampsHigh: +revStep(1.2, 1, 0).toFixed(6),
  clampsLow: +revStep(-1, -0.8, 0).toFixed(6),
  // A load bigger than the pedal drives the revs negative.
  loadWins: +revStep(0.5, 1, 3).toFixed(6),
};
// 400 ticks at T1 = 1 with a load of 0.3: the fixed point is 2*(1-0.3) = 1.4,
// clamped to 1.2.
let revs = 0;
for (let i = 0; i < 400; i++) revs = revStep(revs, 1, 0.3);
out.filter.settledWithLoad = +revs.toFixed(6);
// ... and with a load that keeps it inside the arms.
revs = 0;
for (let i = 0; i < 2000; i++) revs = revStep(revs, 1, 0.7);
out.filter.settledInside = +revs.toFixed(6);
// The closed form must agree with the iteration tick for tick.
revs = 0;
for (let i = 0; i < 37; i++) revs = revStep(revs, 1, 0.7);
out.filter.closedForm = {
  iterated: +revs.toFixed(9),
  advanced: +revAdvance(0, 1, 0.7, 37).toFixed(9),
  zeroTicks: +revAdvance(0.4, 1, 0, 0).toFixed(9),
};
// 40 ticks is the documented time constant: 1 - (1-0.025)^40 = 0.632 of the way
// there. Measured with a load, so the fixed point (0.6) is inside the arms and
// the 1.2 clamp is not what is being read.
out.filter.timeConstant = +(revAdvance(0, 1, 0.7, 40) / 0.6).toFixed(4);
// ... and with no load the same 40 ticks run past the clamp, which is the
// engine's own answer to a pedal at the floor.
out.filter.unloadedAtForty = +revAdvance(0, 1, 0, 40).toFixed(4);

// --- the load mean ----------------------------------------------------------
out.load = {
  // One sample a tick, which is what one engine does: 0.99*L0.
  one: r3(loadSample(0, 0, 2)),
  // Four sub-steps of the same K land on the same place.
  four: r3([1, 2, 3].reduce((l, n) => loadSample(l, n, 2), loadSample(0, 0, 2))),
  // Two different samples average.
  mixed: r3(loadSample(loadSample(0, 0, 2), 1, 4)),
};

console.log(JSON.stringify(out));
