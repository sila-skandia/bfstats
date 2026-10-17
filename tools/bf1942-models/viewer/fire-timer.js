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
