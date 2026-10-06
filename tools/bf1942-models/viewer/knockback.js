// A soldier blown off his feet: the engine's explosion states.
//
// Everything here is read out of `bf1942_lnxded.static` and out of
// `animations/AnimationStatesExplosionFly.con`; addresses are that binary's.
// Free of `three` and of the DOM, and it imports nothing.
//
// THE FLIGHT. A blast marks every soldier it reaches:
// `GameServer::handleExplosionOnObject` (`0x08156500`) calls
// `BFSoldier::triggerFallingAnimation` (`0x0827e920`, its one caller at
// `0x08156bb3`), which stamps the world time at `+0x584` and does nothing
// else. `BFSoldier::handleUpdate` (`0x08271e30`) then throws him: alive,
// within 0.2 s of that stamp, or dead, at any time -- in either case under no
// canopy (state bit `0x10`), not already flying, and moving at 8 m/s or more
// (`|v|^2` against 64.0). The two halves are set by name: `Lb_/Ub_Explosion
// Forward` (`0x082729bd`) when his forward row dotted with his velocity is not
// negative, else `Lb_/Ub_ExplosionBackward` (`0x08272a5e`); the dead arm is
// `0x08272d5f` / `0x08272e54`. While either flight holds his legs a hit plays
// no hit state (`handleDamage`, `0x08270a7f`).
//
// THE LANDING. `BFSoldier::handleCollision` (`0x0827d3b0`), out of a flight:
//
//   alive (`+0x245` clear), a bot   `...LandFrontSurvive` out of a forward
//                                   flight (`0x0827d93b`), `...LandBackSurvive`
//                                   out of a backward one (`0x0827d8c8`); each
//                                   hands over to its get-up and the get-up to
//                                   `Lb_Stand` / `Ub_StandAim`. On any contact,
//                                   whatever its normal
//   alive, a human                  straight to `Lb_Stand` / `Ub_StandAim`
//                                   (`0x0827d9af`): the survive landing is
//                                   only for a player whose `getIsAIPlayer`
//                                   (`IPlayer` vtable `+0x5c`, `0x0827d891`)
//                                   says so (KNOCK-8)
//   dead, the normal over 0.3 up    `...LandFront` (`0x0827d80b`) /
//                                   `...LandBack` (`0x0827d79c`): no state
//                                   after, the corpse holds it
//   dead, the normal under 0.1 up   a wall: `...BounceFront` into it
//                                   (`0x0827d6ea`, forward row against the
//                                   normal), `...BounceBack` off it
//                                   (`0x0827d647`), a cut that hands over to
//                                   the opposite flight
//
// Every lower state declares `c_AsmHideWeapon` and `c_AsmLockFreeLook`; the
// upper ones declare nothing. The torso is set with the legs on every entry
// above, but a hit or an aim can hold it meanwhile: a recorded flight's torso
// is often `Ub_HitChestStand` or the weapon's aim (replay_20260927-140921),
// with the weapon stowed all the same.
//
// THE PUSH. The same `handleExplosionOnObject` pushes the body before it
// stamps him, through the victim's own physics node (KNOCK-4..KNOCK-7): an
// acceleration of `explosionForceMod * forceOnExplosion / radius * exposure`
// (a tenth in water, scaled by friendly fire's cut of the damage, held under
// `explosionForceMax`), along the separation plus his own nearest axis, with
// the separation's rise replaced by `(1 - d/r) * 5` and no push at all past
// half the radius. It sits in his accumulator for one 1/30 s tick, so the
// speed it leaves is a thirtieth of it: a vanilla soldier (`75`, `600`) caught
// crouching by a grenade (radius 15, the default `150`) leaves at 20 m/s, a
// standing one (exposure at most 0.5) at 12.5, a Desert Combat soldier (`150`)
// at 20 either way. `soldierBlastAcceleration` is that law;
// `Knockback` is the flight and the landing above, run off the body's own
// speed and contacts each tick (`walking-body.js`). The page pushes the human
// and the bots; a replay plays the states its recording names, and both are
// drawn from the same pair (`bot-visuals.js`, `foot-body.js`).

/**
 * The twenty states, keyed by a viewer-side family name and valued by the
 * engine's own state names, exactly as `AnimationStatesExplosionFly.con`
 * creates them: the names the bundle (`gaits/explosion.gait.glb`,
 * `extract_pose.py --explosion`) bakes its clips under, so there is no
 * translation table between the two.
 */
export const EXPLOSION_CLIPS = Object.freeze({
  flyForward: Object.freeze({ lower: 'Lb_ExplosionForward', upper: 'Ub_ExplosionForward' }),
  flyBackward: Object.freeze({ lower: 'Lb_ExplosionBackward', upper: 'Ub_ExplosionBackward' }),
  landFront: Object.freeze({ lower: 'Lb_ExplosionLandFront', upper: 'Ub_ExplosionLandFront' }),
  landFrontSurvive: Object.freeze({
    lower: 'Lb_ExplosionLandFrontSurvive', upper: 'Ub_ExplosionLandFrontSurvive' }),
  getUpFront: Object.freeze({
    lower: 'Lb_ExplosionLandFrontSurviveStandUp', upper: 'Ub_ExplosionLandFrontSurviveStandUp' }),
  landBack: Object.freeze({ lower: 'Lb_ExplosionLandBack', upper: 'Ub_ExplosionLandBack' }),
  landBackSurvive: Object.freeze({
    lower: 'Lb_ExplosionLandBackSurvive', upper: 'Ub_ExplosionLandBackSurvive' }),
  getUpBack: Object.freeze({
    lower: 'Lb_ExplosionLandBackSurviveStandUp', upper: 'Ub_ExplosionLandBackSurviveStandUp' }),
  bounceFront: Object.freeze({ lower: 'Lb_ExplosionBounceFront', upper: 'Ub_ExplosionBounceFront' }),
  bounceBack: Object.freeze({ lower: 'Lb_ExplosionBounceBack', upper: 'Ub_ExplosionBounceBack' }),
});

/**
 * The two a dead man comes to rest in, as corpse families: `handleCollision`
 * sets them and nothing moves him on, so the body holds the landing for the
 * soldier template's `timeToLiveAfterDeath`.
 */
export const EXPLOSION_DEATHS = Object.freeze({
  explosionLandFront: EXPLOSION_CLIPS.landFront,
  explosionLandBack: EXPLOSION_CLIPS.landBack,
});

/** The lower states in which the body is in the air: the two flights, and
 *  the bounces, which hand straight back to one. */
export const EXPLOSION_AIRBORNE = Object.freeze(new Set([
  EXPLOSION_CLIPS.flyForward.lower, EXPLOSION_CLIPS.flyBackward.lower,
  EXPLOSION_CLIPS.bounceFront.lower, EXPLOSION_CLIPS.bounceBack.lower,
]));

const FAMILY_BY_LOWER = new Map(Object.entries(EXPLOSION_CLIPS)
  .map(([family, clips]) => [clips.lower, family]));

/** The family (`EXPLOSION_CLIPS` key) a lower state is, or null. The lower
 *  machine is the one every reader in the engine asks (`this+0x294`). */
export function explosionFamily(lower) {
  return FAMILY_BY_LOWER.get(lower) ?? null;
}

/** The corpse family (`EXPLOSION_DEATHS` key) a dead man's lower state rests
 *  him in, or null. */
export function explosionDeath(lower) {
  if (lower === EXPLOSION_CLIPS.landFront.lower) return 'explosionLandFront';
  if (lower === EXPLOSION_CLIPS.landBack.lower) return 'explosionLandBack';
  return null;
}

/**
 * `c_AsmHideWeapon` on a whole-body lower state beside the gait: all ten
 * explosion states, and of the parachute's the free fall and the opening
 * (`AnimationStatesParachute.con`: `Lb_ParachuteFall`, `Lb_ParachuteOpen`
 * declare it; the glide, the landing and the two deaths do not, which is why
 * a man under a canopy aims and fires). `BFSoldier::enableItem` returns
 * without enabling anything while it is up (`0x082784af`), so the weapon the
 * pose glb welds to the hand is put away.
 */
export const HELD_HIDES_WEAPON = Object.freeze(new Set([
  ...Object.values(EXPLOSION_CLIPS).map(clips => clips.lower),
  'Lb_ParachuteFall', 'Lb_ParachuteOpen',
]));

/** The parachute's lower states in which the body is in the air: the fall,
 *  the opening, the glide, and a man killed under his canopy riding it down
 *  (`AnimationStatesParachute.con`). */
export const PARACHUTE_AIRBORNE = Object.freeze(new Set([
  'Lb_ParachuteFall', 'Lb_ParachuteOpen', 'Lb_ParachuteIdle', 'Lb_ParachuteDie',
]));

/**
 * The canopy's clip (`gaits/parachute.canopy.glb`) for a soldier whose chute
 * is open: `setIsParachuting(true)` (`0x08276f90`) drives the `Parachute`
 * child to `OpenParachute`, which `addTransitionWhenDone`s to
 * `IdleParachute` (PARA-5) -- the opening while his legs play
 * `Lb_ParachuteOpen`, the idle after. Null when the chute is not open (state
 * bit `0x10` clear): no canopy is drawn.
 */
export function canopyClipFor(open, lower) {
  if (!open) return null;
  return lower === 'Lb_ParachuteOpen' ? 'open' : 'idle';
}

// --- the push (KNOCK-4..KNOCK-7) ---------------------------------------------

/** `ProjectileTemplate+0x1b0`, `forceOnExplosion`, as the constructor leaves
 *  it: what a round that never says otherwise pushes with. Vanilla's two
 *  grenades, the bazooka and the panzerschreck write the word on their
 *  HandFireArms, which the console refuses (`getActiveTemplate(0x9495)`,
 *  `0x082e1530`), so their rounds push with this too (KNOCK-7). */
export const FORCE_ON_EXPLOSION_DEFAULT = 150;

/** `SimpleObjectTemplate+0xec`, `explosionForceMod`, as its constructor leaves
 *  it (`mov [ebx+0xec],esi` with `esi = 1.0f`, `0x081dc0ac`), handed to the
 *  object's Armor by `setArmorComponent` (`0x081ddcf7`). */
export const EXPLOSION_FORCE_MOD_DEFAULT = 1;

/** `SimpleObjectTemplate+0xf0`, `explosionForceMax`: `0x43960000` = 300
 *  (`0x081dc0b2`), the ceiling of the push before the soldier data's 600. */
export const EXPLOSION_FORCE_MAX_DEFAULT = 300;

/** The vanilla soldier's own pair (`CommonSoldierData.inc`: `explosionForceMod
 *  75`, `explosionForceMax 600`): the stand-in for a gait manifest published
 *  before `soldierBody` carried them, the same shape `FALLBACK_PRIMARIES` has. */
export const VANILLA_SOLDIER_FORCE = Object.freeze({ mod: 75, max: 600 });

/** `GameServer+0x4e4`, `expRadiusCutOnSoldier`: past this fraction of the
 *  radius a soldier is not pushed at all (`0x08156d5e`). The constructor's
 *  `0x3f000000` (`0x0812f3bd`); its setter is reachable only through the
 *  GameServer vtable, and no console word names it, so no mod moves it. */
export const SOLDIER_RADIUS_CUT = 0.5;

/** `GameServer+0x4e8`, `expUpForeceModifierOnSoldier` (sic): the rise the push
 *  is given in place of the separation's own, times `1 - d/r` (`0x08156d84`).
 *  The constructor's `0x40a00000` (`0x0812f3c7`), fixed the same way. */
export const SOLDIER_UP_FORCE = 5.0;

/** A soldier whose physics node reports any water (`getUnderWater() != 0`,
 *  `PointPhysicsNode` vtable `+0xc4`, `0x08156e2f`) is pushed a tenth as hard
 *  (`0x086b1ca0`, `0x08156e4e`). */
export const UNDERWATER_FORCE_SCALE = 0.1;

/** Below this separation the push stands on the terrain's normal under the
 *  blast instead (`0x086c0b90`, `0x08156a2f`). */
export const BLAST_SEPARATION_MIN = 0.001;

/**
 * The acceleration a blast puts in a soldier's accumulator, page frame, m/s^2.
 * `handleExplosionOnObject` (`0x08156500`) from `0x081569b4`, for a victim with
 * no parent and a physics node, once its priced damage is above zero (KNOCK-4,
 * KNOCK-5):
 *
 *     F = forceMod * force * (1/radius) * exposure       0x081569cb..0x081569e5
 *     F *= 0.1 in water; F *= final / raw                0x08156e23..0x08156e6c
 *     F = min(F, forceMax)                               0x08156a0d..0x08156e18
 *     d >= 0.001:  axis = the victim's row most along s, signed along it
 *                  s^ = normalize(s); soldier: s^.y = (1 - d/r) * 5 when
 *                  d/r <= 0.5, else F = 0          0x08156bcc..0x08156d8d
 *                  dir = normalize(s^ + axis)
 *     d <  0.001:  dir = normalize(terrain normal at the blast)
 *
 * `s` is the victim's origin less the blast's, its Y already times
 * `YModOnExplosion` (`0x08156613`), and `distance` is its length, the same
 * number the falloff measured. `yaw` is the soldier's facing in this page's
 * convention (forward `(sin yaw, 0, cos yaw)`): his rows are that forward, up
 * and their cross, and which way the cross points does not matter, since the
 * chosen row is signed along `s`. `damageRatio` is `calcDamage`'s answer over
 * what it was asked (1 unless friendly fire cut it). Returns `out`, with
 * `force` the clamped magnitude; all zero for nothing to push.
 */
export function soldierBlastAcceleration({
  force = FORCE_ON_EXPLOSION_DEFAULT, radius, distance, offset, yaw = 0,
  exposure = 1, damageRatio = 1, underWater = 0,
  forceMod = EXPLOSION_FORCE_MOD_DEFAULT, forceMax = EXPLOSION_FORCE_MAX_DEFAULT,
  terrainNormal = null,
} = {}, out = { x: 0, y: 0, z: 0, force: 0 }) {
  out.x = out.y = out.z = out.force = 0;
  if (!(radius > 0) || !(distance >= 0) || !(distance < radius)) return out;
  let f = forceMod * force * (1 / radius) * exposure;
  if (underWater > 0) f *= UNDERWATER_FORCE_SCALE;
  f *= Number.isFinite(damageRatio) ? damageRatio : 0;
  if (f > forceMax) f = forceMax;
  if (!(f > 0)) return out;
  let dx, dy, dz;
  if (distance >= BLAST_SEPARATION_MIN) {
    const [sx, sy, sz] = offset;
    // His rows, and the one most along the separation (the engine's own
    // tie-break, `0x08156c64`..`0x08156cae`: up only when strictly above
    // both, then forward only when strictly above right).
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const dRight = fz * sx - fx * sz;
    const dUp = sy;
    const dFwd = fx * sx + fz * sz;
    let ax, ay, az, dot;
    if (Math.abs(dUp) <= Math.abs(dRight) || Math.abs(dUp) <= Math.abs(dFwd)) {
      if (Math.abs(dFwd) <= Math.abs(dRight)) { ax = fz; ay = 0; az = -fx; dot = dRight; }
      else { ax = fx; ay = 0; az = fz; dot = dFwd; }
    } else { ax = 0; ay = 1; az = 0; dot = dUp; }
    if (dot < 0) { ax = -ax; ay = -ay; az = -az; }
    const len = Math.hypot(sx, sy, sz);
    let nx = sx / len, ny = sy / len, nz = sz / len;
    // The soldier's own arm: the rise is replaced, and past the cut there
    // is no push. `d/r` is the same distance the falloff used.
    const t = distance / radius;
    if (t <= SOLDIER_RADIUS_CUT) ny = (1 - t) * SOLDIER_UP_FORCE;
    else return out;
    dx = nx + ax; dy = ny + ay; dz = nz + az;
  } else {
    const n = terrainNormal ?? { x: 0, y: 1, z: 0 };
    dx = n.x; dy = n.y; dz = n.z;
  }
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return out;
  out.x = f * dx / len;
  out.y = f * dy / len;
  out.z = f * dz / len;
  out.force = f;
  return out;
}

// --- the flight and the landing, run by the page (KNOCK-1, KNOCK-2, KNOCK-8) --

/** `|v|^2` against 64.0: the speed the flight needs (KNOCK-1). */
export const FLIGHT_SPEED = 8;

/** An alive soldier is thrown only this long after the stamp (KNOCK-1). */
export const FLIGHT_WINDOW = 0.2;

/** The dead landing's floor and the bounce's wall, by the contact normal's
 *  rise (`0x0827d6ea`.., KNOCK-2). */
export const LAND_NORMAL_Y = 0.3;
export const BOUNCE_NORMAL_Y = 0.1;

/**
 * How long each one-shot state holds before its `addTransitionWhenDone`: a
 * clip's period is `1 / rate` whatever its frames (ANIM-1), and
 * `AnimationStatesExplosionFly.con` plays the landings and bounces at 1.0 and
 * both get-ups at 0.5. Keyed by the `EXPLOSION_CLIPS` family; the two dead
 * landings hold for good and the flights loop, so neither is here.
 */
export const EXPLOSION_PERIODS = Object.freeze({
  landFrontSurvive: 1.0, landBackSurvive: 1.0,
  getUpFront: 2.0, getUpBack: 2.0,
  bounceFront: 1.0, bounceBack: 1.0,
});

/** What each timed state hands over to (`addTransitionWhenDone`), or null for
 *  `Lb_Stand` / `Ub_StandAim`: the body is his own again. */
const NEXT_STATE = Object.freeze({
  landFrontSurvive: 'getUpFront', landBackSurvive: 'getUpBack',
  getUpFront: null, getUpBack: null,
  bounceFront: 'flyBackward', bounceBack: 'flyForward',
});

const FLIGHTS = new Set(['flyForward', 'flyBackward']);

/**
 * One soldier's explosion states on the page: the engine's `handleUpdate` arm
 * that throws him and the `handleCollision` arm that lands him, as a plain
 * object the body steps once a tick after its resolve (`walking-body.js`).
 *
 * `stamp()` is `triggerFallingAnimation`. `update` runs, in order, the clip
 * clocks of the timed states, the landing (when the tick resolved a contact
 * while he flew) and the throw. `family` is the `EXPLOSION_CLIPS` key his legs
 * are in, or null when his body is his own; `clips()` the pair to draw.
 * Every explosion state's lower half declares `setSpeed 0 0 0`, which PHY-8
 * makes the multiplier of both speed tables, so `locked` takes his legs from
 * him; and `c_AsmHideWeapon`, so the weapon is put away for as long.
 */
export class Knockback {
  constructor({ periods = EXPLOSION_PERIODS } = {}) {
    this.periods = periods;
    this.reset();
  }

  /** A new body, or one put somewhere: no stamp, no state. */
  reset() {
    this.family = null;
    /** Seconds in the current timed state. */
    this.timeIn = 0;
    /** Seconds since the last blast reached him (`+0x584`'s age). */
    this.sinceStamp = Infinity;
    /** Whether any blast has reached him since he was put down. The page runs
     *  the dead arm only then: the engine's has no such test, so a corpse
     *  falling 8 m/s off a cliff is thrown too, which the page does not
     *  model (no body carries the machine until a blast hands him one). */
    this.stamped = false;
    /** Whether his player is a bot (`getIsAIPlayer`), as of the last stamp:
     *  only a bot plays the survive landing (KNOCK-8). */
    this.ai = false;
    return this;
  }

  /** `triggerFallingAnimation`: a blast reached him. It stamps and does
   *  nothing else; the throw is the next `update`'s. */
  stamp({ ai = this.ai } = {}) {
    this.sinceStamp = 0;
    this.stamped = true;
    this.ai = !!ai;
  }

  /** His legs are in one of the explosion states. */
  get active() { return this.family !== null; }

  /** In the air: a flight, or a bounce that hands straight back to one. */
  get airborne() {
    return FLIGHTS.has(this.family) || this.family === 'bounceFront'
      || this.family === 'bounceBack';
  }

  /** `setSpeed 0 0 0` on every lower state: no command from his legs. */
  get locked() { return this.family !== null; }

  /** `c_AsmHideWeapon` on every lower state. */
  get hidesWeapon() { return this.family !== null; }

  /** The corpse family a dead landing rests him in (`EXPLOSION_DEATHS`), or
   *  null. */
  get restingDeath() {
    if (this.family === 'landFront') return 'explosionLandFront';
    if (this.family === 'landBack') return 'explosionLandBack';
    return null;
  }

  /** The `{ lower, upper }` pair his legs and torso are set to, or null. */
  clips() {
    return this.family ? EXPLOSION_CLIPS[this.family] : null;
  }

  /**
   * One tick. `dead` is `+0x245`; `vx, vy, vz` his velocity after the tick's
   * integration and resolve; `yaw` his facing (forward `(sin yaw, 0, cos yaw)`);
   * `canopy` state bit `0x10`; `contact` the most upward normal of a contact
   * this tick resolved, or null for none (a soldier's `handleCollision` keeps
   * the most upward normal of the frame, PHY-1, so the floor wins over a wall
   * met in the same tick).
   */
  update({ dt = 0, dead = false, vx = 0, vy = 0, vz = 0, yaw = 0, canopy = false,
           contact = null } = {}) {
    this.sinceStamp += dt;
    // The clip clocks: a timed state's `addTransitionWhenDone`.
    if (Object.hasOwn(NEXT_STATE, this.family ?? '')) {
      this.timeIn += dt;
      const period = this.periods[this.family] ?? 1;
      if (this.timeIn >= period) this.enter(NEXT_STATE[this.family]);
    }
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // `handleCollision` out of a flight (KNOCK-2, KNOCK-8).
    if (contact && FLIGHTS.has(this.family)) {
      const forward = this.family === 'flyForward';
      if (!dead) {
        this.enter(this.ai ? (forward ? 'landFrontSurvive' : 'landBackSurvive') : null);
      } else if (contact.y > LAND_NORMAL_Y) {
        this.enter(forward ? 'landFront' : 'landBack');
      } else if (Math.abs(contact.y) < BOUNCE_NORMAL_Y) {
        // Into the wall face first out of a forward flight, back first out of
        // a backward one (`0x0827d6ea` / `0x0827d647`); anything else flies on.
        const facing = fx * contact.x + fz * contact.z;
        if (forward && facing < 0) this.enter('bounceFront');
        else if (!forward && facing >= 0) this.enter('bounceBack');
      }
    }
    // `handleUpdate`'s throw (KNOCK-1).
    if (!FLIGHTS.has(this.family) && !canopy
        && vx * vx + vy * vy + vz * vz >= FLIGHT_SPEED * FLIGHT_SPEED
        && (dead ? this.stamped : this.sinceStamp < FLIGHT_WINDOW)) {
      this.enter(fx * vx + fz * vz >= 0 ? 'flyForward' : 'flyBackward');
    }
    return this;
  }

  /** Set his legs to `family` (null: his own again), its clock from zero. */
  enter(family) {
    this.family = family;
    this.timeIn = 0;
  }
}
