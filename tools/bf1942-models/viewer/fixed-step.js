// The outer clock: our fixed 60 Hz tick, the catch-up cap, and the
// accumulator that turns a frame's dt into whole ticks plus an alpha.
//
// Split out of `physics.js`, which re-exports all of it; its header explains
// why this is the one deliberate divergence from the engine's loop.

/**
 * Our fixed tick, and why it is 60 and not the 30 the jump figures imply.
 *
 * PHY-1's **1.12 m apex and 0.80 s of air** are what the engine's four
 * sub-steps produce at `dt = 1/30`, and the ledger reaches that `dt` from
 * `g_simulationFps = 30.0`. But `g_simulationFps` is not the frame period: it
 * is a fixed scale constant (lnxded `.data` `0x08716b5c`, raw `0000f041`, and
 * **nothing in the binary writes it** — `objdump -d -M intel` over the whole
 * file has no `fstp`/`mov` to that address, and it is not a console word:
 * the only `simulationFps` string in the file is the symbol's own name). What
 * the loop rate is built from is that constant **doubled**:
 *
 *     Setup::initEngine   0x080bc632  fld [0x08716b5c]   ; 30.0
 *                         0x080bc63f  fadd st,st(0)      ; 60.0
 *                         0x080bc641  fstp [ecx+0xc4]    ; the loop's rate
 *
 *     Setup::mainLoop     0x080bc0b0  fld1
 *                         0x080bc0b2  fdiv [ebx+0xc4]    ; period = 1/60 s
 *                         0x080bc0e3  je  0x080bc3b0     ; deadline not reached
 *                         0x080bc3b2  (spin on System::getExactTime, 0x08418160)
 *                         0x080bc0f6  fsubrp             ; dt = now - last
 *                         0x080bc0f8  fstp [ebx+0xc8]    ; the frame dt, measured
 *
 * So the dedicated server targets **60 Hz** and integrates with the *measured*
 * elapsed time, and `Game::updateWorld` (`0x0805d9b0`) hands that dt straight
 * down — `BasicPhysicsSystem::update` (`0x08251ef0`) is an empty stub, so
 * there is no accumulator anywhere below it either.
 *
 * Two things follow. The engine's own jump apex **moves with the frame rate**,
 * so 1.12 m is the figure for a machine running at exactly 30 fps and not a
 * universal constant; and 60 Hz, not 30, is the period the shipped loop aims
 * at. Dropping this viewer to a 30 Hz tick to chase 1.12 m would therefore
 * chase a frame-rate artefact, and it would halve the resolver's sampling —
 * 0.2 m of travel per tick at a run instead of 0.1 — in the one part of this
 * module with no engine provenance. `tests/test_soldier.py` pins the apex, the
 * ramp and the fall a landing is billed as identical at 23.7, 30, 60 and
 * 144 **frames** per second, which is the property that actually matters.
 *
 * Recorded as a finding rather than a ledger edit: PHY-1 and PHY-6 both state
 * wall-clock figures that rest on `dt = 1/30`.
 */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/**
 * Ticks one frame may run before the clock gives up and drops the rest.
 *
 * A tab that was backgrounded for a minute must not come back and run 3,600
 * ticks in one frame. Twelve is 200 ms of catch-up, which covers a GC pause and
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
 * Retail has none of this (`World::update`, `0x004b6cb0`, passes the frame dt
 * down unmodified and unclamped). This is the divergence the file header
 * explains: determinism for replay beats bug-for-bug fidelity here.
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
