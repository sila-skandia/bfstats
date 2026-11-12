/**
 * The `.ssc` Ramp envelope as BF1942.exe evaluates it (ledger SSC-7): the
 * Ramp ctor 0x00803a10 takes six params, p5 the shape (default 0) and p6 its
 * exponent (default 1.0); `getModulation` 0x00803aa0 picks linear, quick
 * (0x00803a70) or slow (0x00803b33) between p1 and p2 by `ftol(p5)`, returns
 * p3 + p3 for any other shape (0x00803b85), raises p2 to p1 (0x00803aaf),
 * and counts x == p1 == p2 as above the step (0x00803ae2..0x00803af9).
 * Expected values are computed here from those formulas, not from the module.
 */
import assert from 'node:assert/strict';
import { modulatorValue } from '../viewer/ssc-curves.js';

const ramp = (params, x) =>
  modulatorValue({ source: 'default', envelope: 'ramp', params }, { default: x, rpm: x });
const near = (got, want, msg) =>
  assert.ok(Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

// Four params: linear, ends held.
near(ramp([0, 1, 0.2, 0.6], -1), 0.2, 'below p1');
near(ramp([0, 1, 0.2, 0.6], 0.25), 0.2 + 0.6 * 0.25, 'linear inside');
near(ramp([0, 1, 0.2, 0.6], 2), 0.8, 'above p2');
near(ramp([0, 1, 0.2, 0.6, 0, 3], 0.5), 0.5, 'shape 0 ignores p6');

// Shape 1, quick: p3 + p4 * (1 - ((x - p2) / (p1 - p2)) ^ p6).
for (const x of [0.1, 0.4, 0.9]) {
  near(ramp([0, 1, 0.5, 0.5, 1, 2], x), 0.5 + 0.5 * (1 - ((x - 1) / (0 - 1)) ** 2), `quick ${x}`);
}
// Shape 2, slow: p3 + p4 * ((x - p1) / (p2 - p1)) ^ p6.
for (const x of [0.1, 0.4, 0.9]) {
  near(ramp([0, 1, 0.5, 0.5, 2, 2], x), 0.5 + 0.5 * ((x - 0) / 1) ** 2, `slow ${x}`);
}
// p5 is truncated: 2.7 is slow, 1.2 quick.
near(ramp([0, 1, 0, 1, 2.7, 3], 0.5), 0.125, 'ftol 2.7 -> slow');
near(ramp([0, 1, 0, 1, 1.2, 2], 0.5), 0.75, 'ftol 1.2 -> quick');
// Any other shape inside the span is p3 + p3; the ends are still p3 / p3 + p4.
near(ramp([10, 30, 0.3, 1, 3, 4], 20), 0.6, 'shape 3 inside');
near(ramp([10, 30, 0.3, 1, 3, 4], 5), 0.3, 'shape 3 below');
near(ramp([10, 30, 0.3, 1, 3, 4], 40), 1.3, 'shape 3 above');

// A step: p1 == p2 is already up at p1.
near(ramp([0, 0, 0, 1], 0), 1, 'step at its edge');
near(ramp([0, 0, 0, 1], -0.01), 0, 'step below');
near(ramp([2, 2, 1, -1], 2), 0, 'fade-out step at its edge');
// p2 under p1 is raised to p1: a step at p1.
near(ramp([1, 0, 0.5, 0.08, 2, 0.16], 1), 0.58, 'reversed pair at p1');
near(ramp([1, 0, 0.5, 0.08, 2, 0.16], 0.5), 0.5, 'reversed pair below');
near(ramp([1, 0, 0.5, 0.08, 2, 0.16], 1.5), 0.58, 'reversed pair above');

// Real engine curves from the scene data (bf1918, `Pitch <- Default`).
near(ramp([0, 1.1, 0.45, 0.55, 2, 5], 0.55), 0.45 + 0.55 * 0.5 ** 5, 'fao_landing 2/5 at 0.55');
near(ramp([0, 1.1, 0.45, 0.25, 2, 1.9], 0.55), 0.45 + 0.25 * 0.5 ** 1.9, 'fao_landing 2/1.9 at 0.55');
near(ramp([0.55, 1.2, 0.25, 0.75, 2, 0.35], 0.875), 0.25 + 0.75 * 0.5 ** 0.35, 'priesterwald 2/0.35');
// `Pitch <- Speed` quick curve (fht_meuse_argonne_offensive).
near(ramp([0, 40, 0.35, 0.05, 1, 2], 20), 0.35 + 0.05 * (1 - 0.5 ** 2), 'meuse speed 1/2');
// The old linear reading would have given 0.725 for the first: the curve sits far under it.
assert.ok(ramp([0, 1.1, 0.45, 0.55, 2, 5], 0.55) < 0.47);

// Linear is p1 + p2 x.
near(modulatorValue({ source: 'default', envelope: 'linear', params: [0.3, 0.5] }, { default: 2 }), 1.3, 'linear');

console.log('ssc-curves: ok');
