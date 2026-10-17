// A FireArms' timers on the engine's tick, apart from everything else a gun
// does, so a module with no other imports (`hand-alt-fire.js`, a harness) can
// count them the way `FireArms::handleUpdate` does. `gun-cycle.js` re-exports
// all of it.

/**
 * `timeToFireFinished` as a round sets it: the FireArms ctor's `1 /
 * roundOfFire` (`0x08286870` into `+0x234`), a float. A template that
 * declares no rate keeps the template ctor's 10 (`0x0828d4e0`, AI-133).
 */
export const DEFAULT_ROUND_OF_FIRE = 10;
export function firePeriod(roundOfFire) {
  const rate = roundOfFire > 0 ? roundOfFire : DEFAULT_ROUND_OF_FIRE;
  return Math.fround(1 / Math.fround(rate));
}

/**
 * The clock every FireArms timer runs on. `handleUpdate` takes the tick's dt
 * off a running timer and stores it back as a float (`flds dt; fsubrs; fstps`,
 * lnxded `0x08289388`, client `0x0053e295`), and that dt is the fixed
 * `1 / g_simulationFps` = `1/30f` of both binaries (LOOP-1). Nothing carries
 * the part of a tick a timer overshoots: `fireFinished` runs on the first
 * tick that leaves it at or below 0 (lnxded `0x082893b1`, client
 * `0x0053e2c5`), and the next round SETS it to the full period, it does not
 * add (`Fire`, lnxded `0x0828a24e`, client `0x0053dcb7`). The `fireDelay`
 * timer counts down the same way (client `0x0053e526`, FA-13). So a timer of
 * `s` seconds lasts a whole number of ticks, counted in float32.
 */
export const FIRE_TICK_HZ = 30;
export const FIRE_TICK = Math.fround(1 / FIRE_TICK_HZ);
const _timerTicks = new Map();

/** Ticks a FireArms timer set to `seconds` runs: 0 for none, else the first
 *  tick whose float32 countdown reaches 0. */
export function timerTicks(seconds) {
  const start = Math.fround(seconds);
  if (!(start > 0)) return 0;
  let n = _timerTicks.get(start);
  if (n !== undefined) return n;
  // A day of ticks bounds the loop for a pathological `roundOfFire 1e-9`.
  const cap = 86400 * FIRE_TICK_HZ;
  if (start > 86400) return Math.ceil(start * FIRE_TICK_HZ);
  n = 0;
  for (let t = start; t > 0 && n < cap; n++) t = Math.fround(t - FIRE_TICK);
  if (_timerTicks.size > 4096) _timerTicks.clear();
  _timerTicks.set(start, n);
  return n;
}

/** The same in seconds, whole ticks of 1/30 s. */
export function timerSpan(seconds) {
  return timerTicks(seconds) / FIRE_TICK_HZ;
}

/**
 * Ticks from the tick that takes a `fireDelay` weapon's press to the tick its
 * round leaves. The press's `Fire` (the soldier's message 6, run before the
 * objects' update in `GameServer::simulateFrame`, IMP-8) flags the shot
 * pending, and the same tick's `handleUpdate` already takes the first tick
 * off the delay timer (FA-13). So the round leaves on the `timerTicks`-th
 * tick counting the press's own as the first: `timerTicks - 1` ticks after
 * it. Recorded in the lab (2026-10-17, vanilla Berlin, the server's own
 * recorder, `lab/scenarios/bf1942-berlin-cq-firedelay-rec.json`): ExpPack and
 * Landmine (`fireDelay 0.4`, 13 ticks in float32 against 12 in real numbers)
 * left 12 ticks after the press, all eight; GrenadeAxis (`0.8`, 24 either
 * way) 23. A delay of one tick or less fires on the press's tick.
 */
export function delayTicks(seconds) {
  return Math.max(0, timerTicks(seconds) - 1);
}

/** `delayTicks` in seconds: how long after the press a `fireDelay` round
 *  leaves. */
export function delaySpan(seconds) {
  return delayTicks(seconds) / FIRE_TICK_HZ;
}

/**
 * Ticks after the round's own tick that `hideDuringFireTime` keeps the
 * weapon's visual out of the hand. `Fire` loads the timer (FireArms `+0x1f8`)
 * and hides the visual; `handleUpdate` counts it down that same tick (lnxded
 * `0x08288ad4`..`0x08288af6`, after the press's `Fire` from message 6 and
 * right after the delay's own `Fire`, which jumps back to `0x08288ad4` at
 * `0x082891e7`), and the tick that leaves it at or below 0 shows the visual
 * again (vt `+0x2c` with 2, `0x08288b2c`) and zeroes it (`0x08288b31`). So
 * the visual is back on the `timerTicks`-th tick counting the round's as the
 * first: 0.4 s is 12 ticks after the round, 0.35 s is 10.
 */
export function hideTicks(seconds) {
  return Math.max(0, timerTicks(seconds) - 1);
}

/** `hideTicks` in seconds. */
export function hideSpan(seconds) {
  return hideTicks(seconds) / FIRE_TICK_HZ;
}

/**
 * `fireCycle` for a round a `fireDelay` fired. `handleUpdate` counts the fire
 * timer down (lnxded `0x08288a0e`, its decrement at `0x08289388`) before the
 * delay (`0x08288a9c`..`0x08288ac5`), and the delay's `Fire` sets the timer
 * after the tick's countdown has run, so it first counts down on the next
 * tick: the next press is taken a tick later than after a round fired on the
 * press (`fireTicks + 1` ticks after the round). Recorded in the lab: ExpPack
 * (`roundOfFire 1`, 30 ticks) pressed on every other tick fired 44 ticks
 * apart, 12 of delay and the first even tick at or after 31.
 */
export function delayedFireCycle(roundOfFire) {
  return (fireTicks(roundOfFire) + 1) / FIRE_TICK_HZ;
}

/**
 * Ticks from one round to the next pull that can fire, for a trigger held
 * every tick (GUN-13, GUN-18): the round's timer at `firePeriod`. A held
 * FHSW Greasegun (`roundOfFire 9.17`) fires every 4th tick, 30 rounds in
 * 3.87 s, as the lab server recorded; a `roundOfFire 7.5` gun every 5th, not
 * every 4th, a `roundOfFire 6` one every 6th and a `roundOfFire 3` rack every
 * 11th, which the lab server's bots show too (ledger GUN-13).
 */
export function fireTicks(roundOfFire) {
  return timerTicks(firePeriod(roundOfFire));
}

/** `fireTicks` in seconds: the real interval between a held gun's rounds,
 *  and how long its fire cycle holds a reload or an item change off. */
export function fireCycle(roundOfFire) {
  return fireTicks(roundOfFire) / FIRE_TICK_HZ;
}
