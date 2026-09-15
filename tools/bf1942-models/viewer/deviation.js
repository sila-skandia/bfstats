// How wide a shot can wander: BF1942's hand-weapon deviation, approximated.
//
// PROVISIONAL. The extractor now carries every weapon's deviation block out of
// its `.con` verbatim — `setMinDev`, `setFireDev`, `setDevMod`, `setTurnDev`,
// `setSpeedDev`, `setMiscDev` for the rifle/SMG family, `minDeviation` /
// `maxDeviation` for the AT and thrown family — but the *combining rule* is
// the engine's and has not been read out of the binary. What is certain from
// the data alone: `min` is the floor for a standing, still shooter; `mod` is a
// per-stance multiplier ordered stand/crouch/prone and always descending
// (crouching helps, lying helps more); `speed` and `turn` are additive terms
// that exist only while moving or slewing; `fire` grows with every shot and
// decays between them. Everything past that — the exact indexing of the
// four-wide tuples, the decay clock, what aiming does to the cone — is an
// approximation below, each guess marked `[free]` in the style of
// `flight.js`'s CORSAIR table. The Ghidra corpus under
// `features/bf1942-engine-reference/` is where the real rule will eventually
// be read from; swapping it in is contained to this file, because nothing
// outside reads anything but `current()`.
//
// Like `physics.js` and `collision.js` this imports nothing and touches no
// renderer and no DOM, so `tests/test_deviation.py` drives the real module
// under node. The page feeds it the soldier's state once a frame and a shot
// event per round; it hands back one number, the half-angle of the cone in
// degrees, which the crosshair draws and `gunfire.js` samples a direction
// inside.

/** The stance order every three-wide deviation tuple is declared in. */
export const STANCE_INDEX = { stand: 0, crouch: 1, prone: 2 };

/**
 * The soldier's run speed, m/s, used to normalise the speed contribution when
 * the caller does not pass one. 6 is `DIRECTIONAL_SPEED[POSE_STAND]` out of
 * the engine's own table (`physics.js`, 0x009581b4); restated here rather than
 * imported because this module's contract is to import nothing. [data]
 */
export const RUN_SPEED_DEFAULT = 6;

/**
 * The decay clock. `setFireDev`'s third value reads most plausibly as degrees
 * removed per engine frame — at 60 Hz the Thompson's `0.06` empties its full
 * `2.0` bloom in 0.55 s and the BAR's `0.03` its `3.5` in 1.9 s, both inside
 * the band a 2002 shooter feels like — but no header says so, and 30 Hz would
 * read almost as well. The rate is the guess; the per-frame value is shipped
 * data. [free]
 */
export const FIRE_DECAY_HZ = 60;

/**
 * Turn rate, rad/s, at which the turn contribution is fully applied. Every
 * vanilla hand weapon declares `setTurnDev 0 0 0 0`, so nothing shipped can
 * calibrate this; PI rad/s is a half-turn a second, which is a fast mouse
 * flick. Contributions scale linearly up to it and clamp there. [free]
 */
export const TURN_REF = Math.PI;

/**
 * What aiming does to the cone. The engine ties deviation to the zoom state
 * through `AimingSystem` and none of that link is modelled yet — the honest
 * reading of ironsights halving your wander is a placeholder for it, applied
 * to the whole cone, floor included. [free]
 */
export const AIM_FACTOR = 0.5;

/**
 * Airborne with no `misc` block: the floor is multiplied by this instead.
 * Only the AT family lacks `misc`, and a bazooka fired mid-jump deserves
 * everything it gets. [free]
 */
export const AIRBORNE_MULT = 4;

/**
 * The lid when the weapon declares no `maxDeviation` of its own, degrees.
 * The rifle/SMG family declares none; 10 degrees is past anything the
 * additive terms can reach with shipped numbers, so in practice this only
 * catches a mod's exotic data. [free]
 */
export const DEV_CAP_DEG = 10;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * One weapon's cone, fed by the soldier and the trigger.
 *
 * `deviation` is the weapon's own block out of the glb's document extras and
 * may be either family's shape (or absent entirely, in which case the cone is
 * a point and stays one). `zoom` is carried but deliberately unread — see
 * `AIM_FACTOR`. The per-tick state arrives through `update()` rather than
 * being pulled, the same seam `soldier.js` keeps: a replay that writes the
 * state drives the cone identically.
 */
export class DeviationModel {
  constructor({ deviation = null, zoom = null, runSpeed = RUN_SPEED_DEFAULT } = {}) {
    this.data = deviation || {};
    this.zoom = zoom || null;
    this.runSpeed = runSpeed > 0 ? runSpeed : RUN_SPEED_DEFAULT;
    /** Accumulated fire bloom, degrees. Grows on `onShot`, decays in `update`. */
    this.fire = 0;
    this.state = {
      stance: 'stand', speed: 0, turning: 0, aiming: false, airborne: false,
    };
  }

  /**
   * The floor: `min` times the stance multiplier. The AT family's
   * `minDeviation` is the same idea in its own vocabulary (its per-stance
   * floors, `minDevStanding|Crouching|Lying`, are not extracted yet — see the
   * feature doc). A weapon declaring neither has no wander at all, which is
   * the knife.
   */
  baseline(stance = this.state.stance) {
    const d = this.data;
    const min = d.min ?? d.minDeviation ?? 0;
    const index = STANCE_INDEX[stance] ?? 0;
    const mod = d.mod ? (d.mod[index] ?? 1) : 1;
    return min * mod;
  }

  /**
   * One round left the barrel. `setFireDev a b c` is read as
   * `[cap, addPerShot, subPerFrame]`: the Thompson's `2.0 / 0.35 / 0.06`
   * blooms a third of a degree a round and saturates at two degrees over the
   * floor, the Colt's `2.5 / 1.5 / 0.07` jumps most of its cap in one shot —
   * which is a pistol, and is the reading that makes both weapons plausible
   * at once. The indexing is the provisional half; the numbers are shipped.
   */
  onShot() {
    const fire = this.data.fire;
    if (!fire) return this;
    const cap = fire[0] > 0 ? fire[0] : Infinity;
    this.fire = Math.min(this.fire + (fire[1] ?? 0), cap);
    return this;
  }

  /**
   * Advance the decay and take this tick's soldier state. `turning` is the
   * view slew in rad/s, always non-negative in effect (the sign is dropped);
   * `speed` is horizontal ground speed in m/s.
   */
  update(dt, state = {}) {
    if (state.stance !== undefined) this.state.stance = state.stance;
    this.state.speed = state.speed ?? this.state.speed;
    this.state.turning = state.turning ?? this.state.turning;
    this.state.aiming = !!state.aiming;
    this.state.airborne = !!state.airborne;
    if (this.fire > 0 && dt > 0) {
      const perFrame = this.data.fire?.[2] ?? 0;
      this.fire = Math.max(0, this.fire - perFrame * FIRE_DECAY_HZ * dt);
    }
    return this;
  }

  /**
   * The cone's half-angle right now, degrees.
   *
   * Additive over the floor, which is the one combining rule the data itself
   * argues for: `speed`, `turn` and `fire` are all declared in the same unit
   * as `min`, and a multiplicative reading would make the BAR's `2.25` speed
   * term a three-fold penalty while the sniper's identical-format block did
   * nothing. Each tuple contributes only its first element; the trailing
   * elements are carried in the data but unread until the engine's indexing
   * is settled.
   */
  current() {
    const d = this.data;
    const { speed, turning, aiming, airborne } = this.state;
    const floor = this.baseline();
    let dev = floor;
    if (d.speed) dev += (d.speed[0] ?? 0) * clamp01(speed / this.runSpeed);
    if (d.turn) dev += (d.turn[0] ?? 0) * clamp01(Math.abs(turning) / TURN_REF);
    dev += this.fire;
    if (airborne) {
      // `setMiscDev`'s first value read as the airborne penalty — 2.5 on
      // every rifle and SMG, which is the game saying a jumping rifleman
      // hits nothing. The remaining two values are carried unread. [free]
      if (d.misc) dev += d.misc[0] ?? 0;
      else dev = Math.max(dev, floor * AIRBORNE_MULT);
    }
    dev = clamp(dev, floor, d.maxDeviation ?? DEV_CAP_DEG);
    return aiming ? dev * AIM_FACTOR : dev;
  }
}
