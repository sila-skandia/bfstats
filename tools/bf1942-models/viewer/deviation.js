// How wide a shot can wander: BF1942's hand-weapon deviation, as decompiled.
//
// The combining rule below is no longer an approximation. It is
// `HandFireArms::updateDeviation(bool)` — client `BF1942.exe` @ 0x00551f50,
// lnxded 0x08293e80, read in full in both binaries — as documented in
// `features/bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md`.
// The weapon blocks arrive verbatim from each glb's document extras
// (`setMinDev`, `setFireDev [cap, addPerShot, decayPerTick]`,
// `setDevMod [stand, crouch, prone]`, `setTurnDev` / `setSpeedDev`
// `[cap, termB, termC, decayPerTick]`, `setMiscDev [cap, jumpTerm,
// decayPerTick]`), and the engine's arithmetic over them is:
//
//   With M = devMod[stance] (1.0 when the block is absent — `getDevMod`
//   returns 1.0 for a non-soldier holder), per update tick:
//
//     speedAcc = M·speed.b·[|throttle| > 0.01] + M·speed.c·[|strafe| > 0.01]
//     turnAcc  = M·turn.b·|mouseLookY|         + M·turn.c·|mouseLookX|
//     miscAcc  = M·misc.b·[jumping]
//
//   The speed gates are BINARY on the deadzone (constant increments, not
//   scaled by how fast the soldier actually moves); the turn terms are
//   analog in the look input. Each channel then updates identically
//   (cap = a·M, decay = d/M):
//
//     acc == 0:      state = max(state − decay, 0)
//     state < cap:   state = clamp(state + M·acc − decay, 0, cap)
//     else:          state = max(state − decay, cap)
//
//   Note the M² on the raise — one factor inside the accumulator, one in the
//   apply step. Crouch/prone (M < 1) cut the raise quadratically, the caps
//   linearly, and speed the decay (÷M). The fire channel is linear:
//   +fire.b per shot clamped to fire.a in `FireArms::Fire`, −fire.c/M per
//   tick. And the total is a plain sum — minDev is NOT scaled by devMod:
//
//     total = minDev + fire + speed + turn + misc
//
//   Aiming/zoom appears NOWHERE in the formula. There is no aim multiplier
//   in either binary on any path between the accumulators and the total.
//
// What remains OPEN, each marked at its declaration:
//   - The tick cadence. The engine has no dt anywhere in updateDeviation —
//     decay and raise are per `handlePlayerInput` call, and the client's
//     call rate for the local player was not traced. This module ticks at
//     `TICK_HZ`, the viewer's own soldier sim rate.
//   - The units of MouseLookX/Y. This module takes view slew in rad/s and
//     samples it per tick; every vanilla weapon ships `setTurnDev 0 0 0 0`,
//     so nothing shipped can calibrate (or feel) the scale.
//   - The AT/thrown family (`minDeviation` / `maxDeviation`) speaks a
//     different .con vocabulary registered in a different console block
//     (corpus doc §7); the floor-and-lid reading here is the stand-in.
//
// Like `physics.js` and `collision.js` this imports nothing and touches no
// renderer and no DOM, so `tests/test_deviation.py` drives the real module
// under node. The page feeds it the soldier's inputs once a frame and a shot
// event per round; it hands back one number, the half-angle of the cone in
// degrees, which the crosshair draws and `gunfire.js` samples a direction
// inside.

/** The stance order every three-wide deviation tuple is declared in. */
export const STANCE_INDEX = { stand: 0, crouch: 1, prone: 2 };

/**
 * The deviation clock, ticks per second. OPEN: the engine's rule is per
 * `handlePlayerInput` call with no dt (corpus doc, "Clock"), and the client
 * cadence of that call was not traced. 60 is the viewer's own fixed soldier
 * sim step (`soldier.js`), which is the closest thing this page has to the
 * engine's update loop — the per-tick amounts are shipped data, the rate is
 * the stand-in.
 */
export const TICK_HZ = 60;

/**
 * The input deadzone on the binary speed gates. Engine constant, VERIFIED in
 * both binaries (lnxded `.rodata 0x086c08a4`). [data]
 */
export const INPUT_DEADZONE = 0.01;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One weapon's cone, fed by the soldier's inputs and the trigger.
 *
 * `deviation` is the weapon's own block out of the glb's document extras and
 * may be either family's shape (or absent entirely, in which case the cone is
 * a point and stays one). The per-frame inputs arrive through `update()`
 * rather than being pulled, the same seam `soldier.js` keeps: a replay that
 * writes the inputs drives the cone identically.
 */
export class DeviationModel {
  constructor({ deviation = null } = {}) {
    this.data = deviation || {};
    /** The four dynamic channels, in crosshair units (degrees here). */
    this.fire = 0;
    this.speed = 0;
    this.turn = 0;
    this.misc = 0;
    this._acc = 0;   // fractional ticks carried between updates
    /**
     * The inputs, named for the engine's PlayerInput channels: `throttle` is
     * c_PIThrottle (W/S), `strafe` is c_PIYaw (A/D — strafe, the mouse turns
     * you), `lookX`/`lookY` are MouseLookX/Y as view slew in rad/s (units
     * OPEN, see the header), `jumping` gates miscDev. There is deliberately
     * no `aiming` input: zoom has no effect on deviation.
     */
    this.state = {
      stance: 'stand', throttle: 0, strafe: 0, lookX: 0, lookY: 0,
      jumping: false,
    };
  }

  /** The stance multiplier M. 1.0 when the weapon declares no `setDevMod`. */
  devMod(stance = this.state.stance) {
    const mod = this.data.mod;
    if (!mod) return 1;
    return mod[STANCE_INDEX[stance] ?? 0] ?? 1;
  }

  /**
   * The constant floor: `setMinDev`, or the AT family's `minDeviation`. NOT
   * scaled by the stance multiplier — `updateDeviation` adds the stored
   * float as-is; devMod touches only the dynamic channels.
   */
  floor() {
    return this.data.min ?? this.data.minDeviation ?? 0;
  }

  /**
   * One round left the barrel: `fire = min(fire + fire.b, fire.a)`, raised
   * at trigger time in `FireArms::Fire` (lnxded 0x0828a2aa). Both numbers
   * shipped; the missing-cap fallback only guards malformed mod data.
   */
  onShot() {
    const fire = this.data.fire;
    if (!fire) return this;
    this.fire = Math.min(this.fire + (fire[1] ?? 0), fire[0] ?? Infinity);
    return this;
  }

  /**
   * Take this frame's inputs and run the whole ticks it covers. `dt` only
   * decides how many ticks elapse — the arithmetic inside each is the
   * engine's per-call rule, dt-free.
   */
  update(dt, state = {}) {
    const s = this.state;
    if (state.stance !== undefined) s.stance = state.stance;
    s.throttle = state.throttle ?? s.throttle;
    s.strafe = state.strafe ?? s.strafe;
    s.lookX = state.lookX ?? s.lookX;
    s.lookY = state.lookY ?? s.lookY;
    if (state.jumping !== undefined) s.jumping = !!state.jumping;
    if (dt > 0) {
      this._acc += dt * TICK_HZ;
      while (this._acc >= 1) {
        this._acc -= 1;
        this.#tick();
      }
    }
    return this;
  }

  /** One engine update of `HandFireArms::updateDeviation`. */
  #tick() {
    const d = this.data;
    const s = this.state;
    const M = this.devMod();
    const gate = v => (Math.abs(v) > INPUT_DEADZONE ? 1 : 0);
    // Per-tick look samples out of the rad/s rates (cadence in the header).
    const lookY = Math.abs(s.lookY) / TICK_HZ;
    const lookX = Math.abs(s.lookX) / TICK_HZ;
    if (d.speed) {
      this.speed = this.#channel(this.speed, d.speed[0], d.speed[3], M,
        M * ((d.speed[1] ?? 0) * gate(s.throttle)
           + (d.speed[2] ?? 0) * gate(s.strafe)));
    }
    if (d.turn) {
      this.turn = this.#channel(this.turn, d.turn[0], d.turn[3], M,
        M * ((d.turn[1] ?? 0) * lookY + (d.turn[2] ?? 0) * lookX));
    }
    if (d.misc) {
      this.misc = this.#channel(this.misc, d.misc[0], d.misc[2], M,
        M * (d.misc[1] ?? 0) * (s.jumping ? 1 : 0));
    }
    // Hand weapons decay the fire bloom ÷M: getting down recovers FASTER.
    if (this.fire > 0 && d.fire) {
      this.fire = Math.max(this.fire - (d.fire[2] ?? 0) / M, 0);
    }
  }

  /**
   * The per-channel update, identical for speed / turn / misc. `acc` arrives
   * already carrying one factor of M; the raise multiplies by M again — the
   * M² is the engine's actual arithmetic, read twice (client `fVar4 *
   * fStack_20`, lnxded x87 at 0x0829431e), not a decompiler artifact.
   */
  #channel(state, capA = 0, decayD = 0, M, acc) {
    const cap = capA * M;
    const decay = M > 0 ? decayD / M : Infinity;
    if (acc === 0) return Math.max(state - decay, 0);
    if (state < cap) return clamp(state + M * acc - decay, 0, cap);
    return Math.max(state - decay, cap);   // saturated while input held
  }

  /**
   * The cone's half-angle right now, degrees:
   * `total = minDev + fire + speed + turn + misc`. Plain addition — the
   * engine's, not a reading of the data. `aiPending` (the sixth term) is bot
   * aim error and stays 0 for a player.
   *
   * The AT family's `maxDeviation` lid is the OPEN stand-in from the header:
   * that family's combine rule lives in a console block the corpus has not
   * read yet, and floor-and-lid is what its two extracted numbers can say.
   */
  current() {
    let total = this.floor() + this.fire + this.speed + this.turn + this.misc;
    const lid = this.data.maxDeviation;
    if (lid !== undefined && total > lid) total = lid;
    return total > 0 ? total : 0;
  }
}
