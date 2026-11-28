// The jet pack's heat in a replay without `kh` (viewer/replay-pack-heat.js):
// the pack's heat law over the burns a flier's heights show. Run by
// test_replay_pack_heat.py.
import assert from 'node:assert/strict';
import { PackHeat, burningAt } from '../viewer/replay-pack-heat.js';
import { packSpec } from '../viewer/rocket-pack.js';
import { kitHeatAt, parseRecording } from '../viewer/replay-recording.js';

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
const heat = new PackHeat();
assert.equal(heat.at(life, spec, 1.5, airborne), 0, 'a fresh pack is cool');
const after = heat.at(life, spec, 2.7, airborne);
assert.ok(after > 0.4, `half a second of burn heats it half way (${after})`);
const later = heat.at(life, spec, 10, airborne);
assert.ok(later < after - 0.15, `it cools at the kit's rate (${later})`);
assert.ok(heat.at(life, spec, 30, airborne) === 0, 'and is cool again in time');
// A seek back runs it again from the life's start.
assert.equal(heat.at(life, spec, 2.7, airborne), after, 'the same fuel at the same time, after a seek back');
// Off the pack (onPack false) nothing burns.
assert.equal(new PackHeat().at(life, spec, 2.7, () => false), 0, 'no burn read off the pack');

// The recorder's own heat (bf42plus `kh`), read back by soldier.
const rec = parseRecording([
  '{"k":"h","v":5,"plus":"2.0","start":"2026-11-28T10:00:00","hz":10}',
  '{"k":"kh","t":1.000,"o":[[7641,0.000,1]]}',
  '{"k":"kh","t":1.100,"o":[[7641,0.150,0],[7700,0.300,3]]}',
  '{"k":"kh","t":1.200,"o":[[7641,0.225,1],["bad",1,1],[7641]]}',
].join('\n'));
assert.equal(kitHeatAt(rec, 7641, 0.5), null, 'nothing before his first');
assert.deepEqual(kitHeatAt(rec, 7641, 1.15), { heat: 0.15, state: 0 }, 'the last at or before t');
assert.deepEqual(kitHeatAt(rec, 7641, 9), { heat: 0.225, state: 1 }, 'his last stands');
assert.deepEqual(kitHeatAt(rec, 7700, 1.1), { heat: 0.3, state: 3 });
assert.equal(kitHeatAt(rec, 1, 1.1), null, 'a soldier with no pack has none');
console.log('ok');
