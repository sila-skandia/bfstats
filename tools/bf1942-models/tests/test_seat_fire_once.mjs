/**
 * A seat gun's `fireOnce` (ledger GUN-22), through `gun-cycle.js`
 * `advanceGroups` on the world's 30 Hz tick: a press is taken on the tick
 * the trigger first reads held, or never. A held trigger fires one round, a
 * press inside the fire cycle is refused and not fired when the cycle runs
 * out, and presses after the cycle each fire. A gun without the word keeps
 * firing at `roundOfFire` while held. Vanilla's horns, Elco80 and Type38
 * torpedoes and its mine launcher carry it. Run by
 * `tests/test_seat_fire_once.py`.
 */
import assert from 'node:assert/strict';
import { advanceGroups } from '../viewer/gun-cycle.js';
import { FIRE_TICK } from '../viewer/fire-timer.js';
import { SEAT_GUN_OPTIONS } from '../viewer/vehicle-instance.js';

function group(name, { roundOfFire = 1, fireOnce = false } = {}) {
  return {
    name,
    node: { name, userData: {}, position: null },
    stats: { roundOfFire, ...(fireOnce ? { fireOnce: true } : {}) },
    fireOnce, onceHeld: false,
    emitters: [], firing: false, cooldown: 0, recoil: null, loadedRounds: false,
    fireDelay: 0, delayPending: false, delayLeft: 0,
  };
}

function run(g, ticks, press) {
  const shots = [];
  let tick = 0;
  const guns = { groups: [g], fireShot() { shots.push(tick); } };
  for (; tick < ticks; tick++) {
    g.firing = press(tick);
    advanceGroups(guns, FIRE_TICK);
  }
  return shots;
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok ${name}`); }

test('the seat options take the word', () => {
  assert.equal(SEAT_GUN_OPTIONS.fireOnce, true);
});

test('a held fireOnce trigger fires once', () => {
  // WillyHorn: roundOfFire 1, held three seconds.
  assert.deepEqual(run(group('WillyHorn', { fireOnce: true }), 90, () => true), [0]);
});

test('a held trigger without the word fires at its rate', () => {
  assert.deepEqual(run(group('Browning', { roundOfFire: 1 }), 90, () => true), [0, 30, 60]);
});

test('a press inside the cycle is refused and not fired later', () => {
  // Pressed at tick 0, let go, pressed again at tick 10 and held: the cycle
  // runs out at tick 30 with the trigger still held, and nothing fires.
  const shots = run(group('Elco80_Torpedos', { roundOfFire: 1, fireOnce: true }), 90,
    t => t < 3 || t >= 10);
  assert.deepEqual(shots, [0]);
});

test('each press after the cycle fires', () => {
  // A one-tick tap every 40 ticks on a one-second cycle.
  const shots = run(group('Type38_Torpedos', { roundOfFire: 1, fireOnce: true }), 130,
    t => t % 40 === 0);
  assert.deepEqual(shots, [0, 40, 80, 120]);
});

test('a hand weapon group is left to hand-fire.js', () => {
  // Its stats say fireOnce, its group does not: the click pulse owns it.
  const g = group('GrenadeAllies', { fireOnce: true });
  g.fireOnce = false;
  assert.deepEqual(run(g, 90, () => true), [0, 30, 60]);
});

console.log(`${passed} passed`);
