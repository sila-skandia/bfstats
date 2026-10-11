// XPack2's rocket pack: an `ActiveKitPart` that accelerates the soldier who
// wears it.
//
// `GermanElite_JetPack` (`setType RocketPack`) carries `GermanElite_RocketPack`
// on his `backpack` bone, and the part is not scenery: it holds the engine's
// only kit accelerator,
//
//     setActiveAcceleration  0/72/0     while the trigger burns
//     setPassiveAcceleration 0/7.7/0    the lift of a pack that is on
//     setTrigger             PIAction   the jump key
//     addToNegativeMask      Climbing, Crouching, Swiming, Lying
//     burstFrequency 30   ActiveHeatIncrement 2.25   CoolingFactor 0.07
//     setInAirAnims Lb_RocketeeringIdle Empty   OverrideAirMovementInhibitations 1
//     Damping 0.0
//
// and `BFSoldier::handlePlayerInput` (lnxded 0x08273c70) runs
// `ActiveKitPart::update` (0x082628e0) on every part he wears each tick and
// then adds each part's `getAcceleration` (0x082632f0) to his body, turned by
// his orientation, when it is longer than 1 m/s^2 (0x08274b0d..). Nothing in
// the viewer read any of it until 2026-10-11: a jetpack trooper walked.
//
// This module is `ActiveKitPart::update` and `getAcceleration` and nothing
// else (no soldier, no page), so a node harness can run it. Every number is
// the part's own word, converted the way the template setters convert it:
//
//     heat increments and the cooling factor are stored / 30
//         (setActiveHeatIncrement 0x08263820, setPassiveHeatIncrement
//          0x08263840, setCoolingFactor 0x08263860): per second in the .con,
//          per tick in the engine, which is why a part's heat is a bar that
//          fills in 0.44 s and empties in 14 s;
//     burstFrequency is stored as its reciprocal (0x08263c50);
//     ActiveEffectPersistancePerFrame is stored * 30 (0x08263880).
//
// The tick is the engine's 30 Hz one, and the burst timer runs down by the
// literal `0.0333` (0x082629d0: `param_1[0x46] - 0.0333`), not by 1/30. A
// burst sets the timer to `1 / burstFrequency` = 0.033333, one tick later it
// stands at +0.0000333, and a burst needs it at or under zero: the pack
// bursts on every other tick, 15 times a second whatever the frequency says.
// That is the engine's arithmetic, and it halves what the .con appears to ask.

/** One engine tick, seconds. */
export const PACK_TICK = 1 / 30;

/** What the update takes off the burst timer each tick (a float literal). */
export const BURST_TIMER_STEP = Math.fround(0.0333);

/** `ActiveKitPartState` (`setCurrentState` 0x082632d0): the part is
 *  thrusting, idling on, overheated or blocked (the engine's effect state 2
 *  is the overheat's, 3 the blocked and off, 4 the activater's). */
export const PACK_STATE = Object.freeze({ ACTIVE: 0, PASSIVE: 1, OFF: 3, ACTIVATED: 4 });

/** What a part's mask words name, lower case, to the flag a soldier raises. */
export const MASK_FLAGS = Object.freeze({
  climbing: 'climbing', crouching: 'crouching', swiming: 'swimming', swimming: 'swimming',
  lying: 'lying', jumping: 'jumping', running: 'running',
});

const vec3 = (value, fallback = [0, 0, 0]) => {
  const v = Array.isArray(value) ? value : fallback;
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
};

/** The names a mask holds, normalised. */
const maskOf = names => new Set((names ?? []).map(n => MASK_FLAGS[String(n).toLowerCase()] ?? String(n).toLowerCase()));

/**
 * A part's numbers from its `loadouts.json` row (`bf42/kit.py` `active_parts`,
 * the .con's words as written). Null for a row that accelerates nothing.
 */
export function packSpec(row) {
  if (!row || (!row.activeAcceleration && !row.passiveAcceleration)) return null;
  const frequency = Number(row.burstFrequency);
  return Object.freeze({
    template: row.template ?? null,
    bone: row.bone ?? 'backpack',
    activeAcceleration: vec3(row.activeAcceleration),
    passiveAcceleration: vec3(row.passiveAcceleration),
    // `PIAction` in the .con, `c_PIAction` in the controls: one input.
    trigger: String(row.trigger ?? '').replace(/^c_/i, '') || null,
    activater: String(row.activater ?? '').replace(/^c_/i, '') || null,
    negativeMask: maskOf(row.negativeMask),
    positiveMask: maskOf(row.positiveMask),
    burstPeriod: frequency > 0 ? Math.fround(1 / frequency) : 0,
    activeHeat: (Number(row.activeHeatIncrement) || 0) / 30,
    passiveHeat: (Number(row.passiveHeatIncrement) || 0) / 30,
    cooling: (Number(row.coolingFactor) || 0) / 30,
    persistence: (Number(row.effectPersistance) || 0) * 30,
    // The template's own default is 1.0 (0x08263570 sets +0x1a0 to 1.0f).
    damping: row.damping == null ? 1 : Number(row.damping),
    overridesAirMovement: !!row.overrideAirMovementInhibitations,
    inAirLower: row.inAirAnims?.[0] && !/^empty$/i.test(row.inAirAnims[0]) ? row.inAirAnims[0] : null,
    inAirUpper: row.inAirAnims?.[1] && !/^empty$/i.test(row.inAirAnims[1]) ? row.inAirAnims[1] : null,
    effects: [...(row.effects ?? [])],
    defaultEffect: row.defaultEffect ?? null,
    soundScript: row.soundScript ?? null,
  });
}

/** The least `Damping` among a kit's active parts, 1 for a kit with none
 *  (`BFSoldier::getDamageDampingFromActiveKitParts` 0x0827ec00): what a fall's
 *  height term is multiplied by (HP-14: `Q = max(1, X * damping)`). */
export function kitDamping(rows) {
  let least = null;
  for (const row of rows ?? []) {
    const d = row?.damping == null ? 1 : Number(row.damping);
    if (least === null || d < least) least = d;
  }
  return least ?? 1;
}

/**
 * One part. `update` is `ActiveKitPart::update`, once per engine tick;
 * `acceleration` is `getAcceleration`.
 *
 * `input`: `trigger` and `activater` (whether the mapped input is past 0.5),
 * `flags` (a Set of what the soldier is: `climbing`, `crouching`,
 * `swimming`, `lying`...) and `room` (a function, `hasRoomForJump`: nothing
 * overhead within 5 m; asked only when a burst would start).
 */
export class RocketPack {
  constructor(spec) {
    this.spec = spec;
    this.reset();
  }

  reset() {
    // The constructor (0x08262780): state 3 with no activater, heat 0, the
    // burst timer at -1 and `hasRoom` true, so a fresh pack lifts at once.
    this.state = this.spec.activater ? 4 : PACK_STATE.OFF;
    this.lastState = this.state;
    this.heat = 0;
    this.burst = -1;
    this.frames = 0;
    this.hasRoom = true;
    this.active = false;
    /** The state the effects were last put in (`setCurrentState` on the
     *  part's effect holder): 0 burning, 1 idling, 2 overheated, 3 off. */
    this.effectState = this.state;
    /** Ticks this tick's `update` started a burst in (one per call). */
    this.started = false;
  }

  /** Whether `flags` blocks the part: a flag of the negative mask is up, or a
   *  flag of the positive mask is not (`0x082628e0`, the first `if`). */
  blocked(flags) {
    const { negativeMask, positiveMask } = this.spec;
    for (const name of negativeMask) if (flags.has(name)) return true;
    for (const name of positiveMask) if (!flags.has(name)) return true;
    return false;
  }

  update({ trigger = false, activater = false, flags = new Set(), room = () => true } = {}) {
    const spec = this.spec;
    this.started = false;
    if (this.state === PACK_STATE.ACTIVATED) {
      // Waiting for the activater (a part that declares one): pressed, it
      // goes to state 3 and then runs as an ordinary part.
      if (activater) this.state = PACK_STATE.OFF;
      return this.#cool();
    }
    if (this.blocked(flags) || this.heat >= 1) {
      this.state = PACK_STATE.OFF;
      if (this.lastState !== PACK_STATE.OFF) {
        // Overheated (2) when it is the heat that stopped it, off (3) when a
        // flag did; the part is dark either way.
        this.effectState = this.heat < 1 ? 3 : 2;
        this.lastState = this.heat < 1 ? 3 : 2;
        this.active = false;
      }
    } else {
      let burning = false;
      if (trigger && this.burst <= 0) {
        this.hasRoom = !!room();
        if (this.hasRoom) {
          burning = true;
          this.active = true;
          this.state = PACK_STATE.ACTIVE;
          this.heat += spec.activeHeat;
          this.burst = spec.burstPeriod;
          this.lastState = 0;
          this.effectState = 0;
          this.frames = 0;
          this.started = true;
        }
      }
      if (!burning) {
        this.state = PACK_STATE.PASSIVE;
        this.heat += spec.passiveHeat;
        if (spec.persistence < this.frames) {
          this.active = false;
          if (this.state !== this.lastState) {
            this.lastState = 1;
            this.effectState = 1;
          }
        } else {
          this.frames += 1;
        }
      }
    }
    // The activater, when the part has one and it is down, ends the tick in
    // state 4 (0x08262944..).
    if (spec.activater && activater) {
      this.state = PACK_STATE.ACTIVATED;
      this.lastState = 4;
      this.effectState = 4;
    }
    return this.#cool();
  }

  #cool() {
    this.burst = Math.fround(this.burst - BURST_TIMER_STEP);
    this.heat -= this.spec.cooling;
    if (this.heat < 0) this.heat = 0;
    return this;
  }

  /** `getAcceleration`: the active vector while burning, the passive one
   *  while idling with room (the last `hasRoomForJump` answer), else none.
   *  The soldier's frame; the caller turns it by his orientation. */
  get acceleration() {
    if (this.state === PACK_STATE.ACTIVE) return this.spec.activeAcceleration;
    if (this.state === PACK_STATE.PASSIVE && this.hasRoom) return this.spec.passiveAcceleration;
    return ZERO;
  }

  /** Whether the part is burning this tick (for the flame and the sound). */
  get burning() { return this.state === PACK_STATE.ACTIVE; }

  /** The fuel bar's fill: 1 cool, 0 at the overheat (`Recover/Recover`). */
  get fuel() { return Math.max(0, Math.min(1, 1 - this.heat)); }
}

const ZERO = Object.freeze([0, 0, 0]);

// --- the body states the part puts a soldier in -------------------------------

/**
 * `AnimationStatesRocketeering.con` (XPack2's `Animations.rfa`): the three
 * states `setInAirAnims Lb_RocketeeringIdle Empty` and the landing name, each
 * the parachute's own animation file under another name --
 *
 *     Lb_RocketeeringIdle       3PParachuteGlideLower.baf   looping, speed 1.0 0.5 0
 *     Lb_RocketeeringHitGround  3PParachuteGroundLower.baf  once, then Lb_Stand
 *     Ub_RocketeeringHitGround  3PParachuteGroundUpper.baf  once, then Ub_StandAim
 *
 * -- so the bodies play the parachute's already baked clips under the
 * parachute's names, and `Lb_ParachuteIdle`'s speed `0 1 0` (no steering) is
 * the one thing the two do not share: the pack's is `1.0 0.5 0`, a soldier who
 * flies on his own legs' pace.
 */
export const ROCKETEERING_ALIAS = Object.freeze({
  Lb_RocketeeringIdle: 'Lb_ParachuteIdle',
  Lb_RocketeeringHitGround: 'Lb_ParachuteHitGround',
  Ub_RocketeeringHitGround: 'Ub_ParachuteHitGround',
});

/** The recorded lower states of a man flying on the pack. */
export const ROCKETEERING_LOWER = Object.freeze(new Set([
  'Lb_RocketeeringIdle', 'Lb_RocketeeringHitGround',
]));

/** The lower state in which he is in the air. */
export const ROCKETEERING_AIRBORNE = Object.freeze(new Set(['Lb_RocketeeringIdle']));

/** The clip a recorded rocketeering state is drawn with, or the name itself. */
export function rocketeeringClip(name) {
  return ROCKETEERING_ALIAS[name] ?? name;
}

/**
 * Whether a recorded soldier is burning, from his own samples: the vertical
 * acceleration across three samples `dt` apart (`yBefore`, `yNow`, `yAfter`,
 * his origin's height) against what an idling pack leaves of gravity.
 * Gravity is 14.73 m/s^2 (IMP-7) and the idle lift 7.7, so an idling pack
 * decelerates his climb at 7.03 m/s^2; a burst adds 72 m/s^2 over the ticks
 * it burns, which over a 10 Hz sample is more than 4 m/s^2 on the second
 * difference for a single tick of it.
 */
export function replayBurning(yBefore, yNow, yAfter, dt, gravity = 14.73, lift = 7.7) {
  if (!(dt > 0)) return false;
  const a = (yAfter - 2 * yNow + yBefore) / (dt * dt);
  return a > -(gravity - lift) + 4;
}
