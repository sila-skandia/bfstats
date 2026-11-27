// The rocket pack's fuel bar in a replay (viewer/replay-pack-fuel.js): the
// pack's heat law over the burns a flier's heights show. Run by
// test_replay_pack_fuel.py.
import assert from 'node:assert/strict';
import { PackFuel, burningAt } from '../viewer/replay-pack-fuel.js';
import { packSpec } from '../viewer/rocket-pack.js';

// XPack2's GermanElite_RocketPack row (loadouts.json).
const spec = packSpec({
  template: 'GermanElite_RocketPack', negativeMask: ['Climbing', 'Crouching', 'Swiming', 'Lying'], positiveMask: [],
  activeAcceleration: [0, 72, 0], passiveAcceleration: [0, 7.7, 0], burstFrequency: 30,
  activeHeatIncrement: 2.25, passiveHeatIncrement: 0, coolingFactor: 0.07, effectPersistance: 0, damping: 0,
});

// 10 Hz samples: standing 0..2 s, a burn climbing at +40 m/s^2 net 2..2.5 s,
// then an idle fall (gravity less the idle lift, 7.03 m/s^2) to the ground.
const keys = [];
let y = 0, v = 0;
for (let i = 0; i <= 300; i++) {
  const t = i / 10;
  keys.push({ t, p: [0, y, 0], q: [0, 0, 0, 1] });
  const a = t >= 2 && t < 2.5 ? 40 : y > 0 ? -7.03 : 0;
  v += a * 0.1; y += v * 0.1;
  if (y < 0) { y = 0; v = 0; }
}
const life = { keys };

// Read alone, the heights call standing still a burn (no fall): the burn is
// read only while his legs are in a rocketeering state (`onPack`).
assert.equal(burningAt(life, 2.25), true, 'the climb is a burn');
assert.equal(burningAt(life, 3.5), false, 'the idle fall is no burn');

const airborne = t => (t >= 2 && t < 2.6) || (t >= 2 && keys[Math.round(t * 10)]?.p[1] > 0);
const fuel = new PackFuel();
assert.equal(fuel.at(life, spec, 1.5, airborne), 1, 'a fresh pack is full');
const after = fuel.at(life, spec, 2.7, airborne);
assert.ok(after < 0.6, `half a second of burn takes half the pack (${after})`);
const later = fuel.at(life, spec, 10, airborne);
assert.ok(later > after + 0.15, `it refills at the kit's cooling (${later})`);
assert.ok(fuel.at(life, spec, 30, airborne) === 1, 'and is full again in time');
// A seek back runs it again from the life's start.
assert.equal(fuel.at(life, spec, 2.7, airborne), after, 'the same fuel at the same time, after a seek back');
// Off the pack (onPack false) nothing burns.
assert.equal(new PackFuel().at(life, spec, 2.7, () => false), 1, 'no burn read off the pack');
console.log('ok');
