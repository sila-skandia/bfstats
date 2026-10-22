// The outer clock: a fixed tick (the engine's 30 Hz on the page), the catch-up cap, and the
// accumulator that turns a frame's dt into whole ticks plus an alpha.
//
// Split out of `physics.js`, which re-exports all of it.

/**
 * `FixedStep`'s default rate, and the fine step `tests/physics_harness.mjs`
 * drives bodies at. **Not the page's clock**: the world (`world.js`
 * `WORLD_TICK_RATE`) and the soldier (`soldier.js`) both tick at the engine's
 * `ENGINE_TICK_RATE`, 30 Hz, and say so explicitly.
 *
 * The engine's tick is 1/30 s (LOOP-1). The dedicated server paces its wall
 * clock at 60 Hz (`Setup::initEngine` `0x080bc632` doubles `g_simulationFps`
 * = 30.0 into the loop's rate, `Setup::mainLoop` `0x080bc0b2` spins on
 * 1/60 s), but the measured frame dt it stores at `0x080bc0f8` never reaches
 * the simulation: `Setup::updateInputs` (`0x080bc540`) re-quantises the wall
 * clock into whole 1/30 s ticks and `GameServer::update` (`0x08132940`) runs
 * `simulateFrame` once per tick with `dt = 1/30`. Every per-call figure the
 * corpus reads -- PHY-1's 1.12 m apex, PHY-6's +20/-12 ramp, PHY-34's
 * `0.75 * vCmd` and friction latch -- is per 1/30 s tick.
 *
 * This constant was the soldier's clock until 2026-10-22, read off the pacing
 * loop before LOOP-1 found the accumulator under it. A soldier body on it ran
 * the engine's per-tick law twice per server tick and drifted from the
 * server's by about 4 mm a tick (measured live through the sidecar);
 * `tests/test_move_law.py` now drives `Soldier.step(1/30)` against the lab
 * server's own record. What still steps at 60 is a harness asking how a body
 * behaves at a finer dt, never a law that counts calls.
 */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/**
 * Ticks one frame may run before the clock gives up and drops the rest.
 *
 * A tab that was backgrounded for a minute must not come back and run 3,600
 * ticks in one frame. Twelve is 400 ms of catch-up at the engine's 30 Hz (200 at 60), which covers a GC pause and
 * a texture upload and nothing longer.
 */
export const MAX_CATCH_UP_TICKS = 12;

// --- the outer clock -------------------------------------------------------

/**
 * A fixed-step accumulator with a render interpolation factor.
 *
 * `advance(frameDt)` returns how many whole ticks to run and leaves `alpha` in
 * 0..1 for the leftover, so a renderer draws between the last two tick states
 * instead of at the last one. `dropped` counts ticks the catch-up cap threw
 * away, which is the only honest way to notice that the sim is not keeping up.
 *
 * Retail's own is `Setup::updateInputs` (`0x080bc540`): whole 1/30 s ticks
 * out of the wall clock, more than nine in one frame clamped to one
 * (`GameServer::update` `0x08132955`). The alpha is the renderer's, which
 * retail does not interpolate; the cap here is twelve, not nine.
 */
export class FixedStep {
  constructor({ rate = TICK_RATE, maxTicks = MAX_CATCH_UP_TICKS } = {}) {
    this.dt = 1 / rate;
    this.maxTicks = maxTicks;
    this.accumulator = 0;
    this.alpha = 0;
    this.dropped = 0;
    this.ticks = 0;
  }

  advance(frameDt) {
    if (!(frameDt > 0)) frameDt = 0;
    this.accumulator += frameDt;
    let n = Math.floor(this.accumulator / this.dt);
    if (n > this.maxTicks) {
      this.dropped += n - this.maxTicks;
      // Drop the excess rather than carry it: carrying it means the next frame
      // owes the same debt plus its own, and the sim never catches up.
      this.accumulator -= (n - this.maxTicks) * this.dt;
      n = this.maxTicks;
    }
    // Clamped, because subtracting n whole ticks off a float accumulator lands
    // a few times 1e-16 below zero often enough to matter to an alpha.
    this.accumulator = Math.max(0, this.accumulator - n * this.dt);
    this.alpha = this.accumulator / this.dt;
    this.ticks += n;
    return n;
  }

  reset() {
    this.accumulator = 0;
    this.alpha = 0;
  }
}

/** Straight-line blend, for drawing between two tick states. */
export function lerp(a, b, t) { return a + (b - a) * t; }
