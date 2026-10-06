// The blast's push where it meets the soldier's other movers (`viewer/
// knockback.js`, `walking-body.js` `SoldierBody.blast`, ledger KNOCK-4..
// KNOCK-6): the ladder, which takes a tick whole without stepping the body,
// and a second blast in the same tick. Written by the adversarial review of
// the soldier-blast package; run by `tests/test_knockback_seams.py`.
//
// The ladder is `ladder_harness.mjs`'s: a 20 m ladder whose plane is world
// x = 2, its deck side world -x, the climber facing it from x = 2.8.

import { Soldier } from '../viewer/soldier.js';
import * as Ladder from '../viewer/ladder-climb.js';
import { Knockback, soldierBlastAcceleration } from '../viewer/knockback.js';

const TICK = 1 / 60;
const SPEC = {
  axis: [0, 1, 0], length: 20, bottom: [0, -10, 0], top: [0, 10, 0],
  width: 0.6, face: [0, 0, -1],
};
const ELEMENTS = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 10, 0, 1];
const LADDER = Ladder.ladderRecord(SPEC, ELEMENTS, 'Ladder_20m');
const ladderWorld = () => ({ waterLevel: null, casts: 0, surfaceHeight: () => 0, ladders: [LADDER] });
const flatWorld = () => ({
  waterLevel: null,
  surfaceHeight: () => 0,
  heightfield: {
    normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; },
    material: () => 4,
    height: () => 0,
  },
});
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const speed = v => round(Math.hypot(v.x, v.y, v.z));

const out = {};

// 1. A blast reaches a man on a ladder. The climb takes every tick whole
//    (`soldier.js` `#stepLadder`), and the engine's climb stores its own
//    velocity into his node each tick (LADDER-4) while the integrate spends
//    and zeroes the accumulator (KNOCK-6): the push cannot outlive the tick it
//    lands in. Three seconds on, he jumps off: he must leave at the climb's
//    let-go speed, not at the blast's 20 m/s, and not into the flight.
{
  const s = new Soldier({ collider: ladderWorld(), worldSize: 2048 });
  s.spawn(2.8, 0, 0, -Math.PI / 2);
  s.step(TICK, { forward: 1 });
  for (let i = 0; i < 60; i++) s.step(TICK, { forward: 1 });
  const climbing = s.climb.active;
  s.body.knockback = new Knockback();
  s.body.blast(0, 600, 0, { ai: false });
  for (let i = 0; i < 180; i++) s.step(TICK, { forward: 1 });
  const stillClimbing = s.climb.active;
  s.step(TICK, { forward: 0, jump: true });
  const offLadder = !s.climb.active;
  let fastest = 0;
  let family = null;
  for (let i = 0; i < 6; i++) {
    s.step(TICK, {});
    fastest = Math.max(fastest, speed(s.body.velocity));
    family ??= s.body.knockback.family;
  }
  out.ladder = { climbing, stillClimbing, offLadder, fastest, family };
}

// 2. Two blasts priced in one tick: the engine adds both to the one
//    accumulator (`addAccelerationAtAbsolutePosition` `0x08256620` is a plain
//    add), each held under the ceiling on its own (KNOCK-4), so he leaves at
//    the sum.
{
  const s = new Soldier({ collider: flatWorld() });
  s.spawn(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) s.step(TICK, {});
  s.body.knockback = new Knockback();
  const a = soldierBlastAcceleration({
    force: 150, radius: 15, distance: 5, offset: [0, 0, 5], exposure: 1,
    forceMod: 150, forceMax: 600,
  });
  const one = { x: a.x, y: a.y, z: a.z };
  s.body.blast(one.x, one.y, one.z);
  s.body.blast(one.x, one.y, one.z);
  const v0 = { ...s.body.velocity };
  s.step(TICK, {});
  const v = s.body.velocity;
  out.twoBlasts = {
    each: round(Math.hypot(one.x, one.y, one.z) / 30),
    // One body tick of gravity rides in with it; the horizontal part is clean.
    horizontal: round(Math.hypot(v.x - v0.x, v.z - v0.z)),
    expectedHorizontal: round(2 * Math.hypot(one.x, one.z) / 30),
  };
}

process.stdout.write(JSON.stringify(out));
