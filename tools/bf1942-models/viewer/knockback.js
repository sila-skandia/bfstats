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
//   alive (`+0x245` clear)          `...LandFrontSurvive` out of a forward
//                                   flight (`0x0827d93b`), `...LandBackSurvive`
//                                   out of a backward one (`0x0827d8c8`); each
//                                   hands over to its get-up and the get-up to
//                                   `Lb_Stand` / `Ub_StandAim`
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
// The page throws nobody: none of its blasts pushes a soldier (nothing in it
// reads a projectile's `forceOnExplosion`), so only a replay, which has the
// states recorded, plays these. A soldier the page one day throws needs only
// an `explosionClips()` of his own; the renderer (`bot-visuals.js`) reads the
// pair the same way for both.

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
