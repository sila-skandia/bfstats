/**
 * A seat gun's `fireDelay` (ledger FA-13), through `gun-cycle.js`
 * `advanceGroups` on the world's 30 Hz tick.
 *
 * The FireArms ctor loads the delay timer from the template's `fireDelay`;
 * `Fire` with it running flags the shot pending, and `handleUpdate` fires the
 * barrel once it has counted the timer out, the press's own tick counting as
 * the first. So a battery whose five FireArms carry 0.3/0/0.7/0.8/0.2
 * (BF1918's Ger150er_Batterie) ripples out of one press, a trench mortar's
 * `fireDelay 1` round leaves a second after it, a pending shot fires whether
 * the trigger is still held or not, and a delay-free gun (every vanilla
 * vehicle gun) fires on the press's tick as before. A hand weapon's group
 * (collected without `fireDelay: true`) is untouched: `hand-fire.js` owns its
 * wind-up. Run by `tests/test_seat_fire_delay.py`.
 */
import assert from 'node:assert/strict';
import { advanceGroups } from '../viewer/gun-cycle.js';
import { delayTicks, delayedFireCycle, FIRE_TICK, fireTicks } from '../viewer/fire-timer.js';
import { SEAT_GUN_OPTIONS } from '../viewer/vehicle-instance.js';

function group(name, fireDelay, { roundOfFire = 1, honour = true } = {}) {
  return {
    name,
    node: { name, userData: {}, position: null },
    stats: { roundOfFire, throw: { fireDelay } },
    emitters: [],
    firing: false,
    cooldown: 0,
    recoil: null,
    loadedRounds: false,
    fireDelay: honour ? fireDelay : 0,
    delayPending: false,
    delayLeft: 0,
  };
}

function run(groups, ticks, press) {
  const shots = new Map(groups.map(g => [g.name, []]));
  let tick = 0;
  const guns = {
    groups,
    fireShot(g) { shots.get(g.name).push(tick); },
  };
  for (; tick < ticks; tick++) {
    for (const g of groups) g.firing = press(tick, g);
    advanceGroups(guns, FIRE_TICK);
  }
  return shots;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${name}`);
}

test('the seat options take the delay', () => {
  assert.equal(SEAT_GUN_OPTIONS.fireDelay, true);
});

test('a battery ripples out of one press', () => {
  const delays = [0.3, 0, 0.7, 0.8, 0.2];
  const groups = delays.map((d, i) => group(`Cannon${i}`, d, { roundOfFire: 0.07 }));
  // One tick of trigger: a tap.
  const shots = run(groups, 60, tick => tick === 0);
  delays.forEach((d, i) => {
    assert.deepEqual(shots.get(`Cannon${i}`), [delayTicks(d)], `Cannon${i} (${d} s)`);
  });
  // The 0.3 s barrel 9 ticks after the press (float32 counts 10), the
  // delay-free one on it.
  assert.deepEqual(shots.get('Cannon0'), [9]);
  assert.deepEqual(shots.get('Cannon1'), [0]);
});

test('a trench mortar round slides a second down the tube', () => {
  const g = group('StokesCannon', 1, { roundOfFire: 0.5 });
  const shots = run([g], 60, tick => tick === 0);
  assert.deepEqual(shots.get('StokesCannon'), [delayTicks(1)]);
  assert.ok(delayTicks(1) >= 29);
});

test('a held trigger winds up again once the cycle is out', () => {
  const g = group('Mortar', 0.5, { roundOfFire: 2 });
  const shots = run([g], 120, () => true);
  const first = delayTicks(0.5);
  // The delay's `Fire` sets the fire timer after the tick's countdown, so it
  // first runs a tick later (`delayedFireCycle`); the next press then winds
  // up the delay again, its own tick the first off the timer.
  const cycle = Math.round(delayedFireCycle(2) * 30);
  assert.equal(cycle, fireTicks(2) + 1);
  const gap = cycle + first;
  assert.deepEqual(shots.get('Mortar').slice(0, 3), [first, first + gap, first + 2 * gap]);
});

test('a pending shot fires with the trigger let go, once', () => {
  const g = group('Mortar', 1, { roundOfFire: 0.5 });
  // Pressed 5 ticks, then nothing.
  const shots = run([g], 90, tick => tick < 5);
  assert.deepEqual(shots.get('Mortar'), [delayTicks(1)]);
});

test('no delay fires on the press, as before', () => {
  const g = group('Vanilla', 0, { roundOfFire: 10 });
  const shots = run([g], 10, () => true);
  assert.deepEqual(shots.get('Vanilla'), [0, 3, 6, 9]);
});

test('a group collected without the option ignores the word', () => {
  const g = group('HandGrenade', 1, { honour: false });
  const shots = run([g], 10, tick => tick === 0);
  assert.deepEqual(shots.get('HandGrenade'), [0]);
});

test('an empty magazine at the end of the delay fires nothing', () => {
  const g = group('Mortar', 0.2, { roundOfFire: 0.5 });
  let left = 1;
  const shots = [];
  let tick = 0;
  const guns = {
    groups: [g],
    roundsLeft: () => left,
    fireShot() { shots.push(tick); },
  };
  for (; tick < 20; tick++) {
    g.firing = tick === 0;
    if (tick === 2) left = 0;
    advanceGroups(guns, FIRE_TICK);
  }
  assert.deepEqual(shots, []);
  assert.equal(g.delayPending, false);
});

console.log(`${passed} passed`);
