// What the LOCAL player's third-person body should be playing: which baked
// clips, from the stance, the gait and the parachute the page already
// simulates.
//
// This is the third of the three clip-selection modules and it is the one for a
// soldier the page owns:
//
//   `stance-clips.js`  the first-person arms rig, whose families are the 1P
//                      clips (`idle`, `fire`, `reload`, ...)
//   `remote-gait.js`   a soldier the page did NOT simulate, whose stance and
//                      gait have to be recovered from a position stream and two
//                      snapshot bits
//   this file          the local soldier, where `soldier.gait`,
//                      `soldier.stance` and `soldier.parachuteState` are known
//                      exactly and no speed estimate is needed
//
// The families are the engine's own states, and every one is a lower/upper
// pair, because the engine runs two independent state machines with
// independent phases over disjoint bone sets (11 lower: root, pelvis, legs,
// `Spine Root`; 44 upper: `Bip01 Spine` out to the fingertips). Two three.js
// actions at full weight over disjoint channels compose rather than fight,
// which is why a pair and not a resampled composite.
//
// WHERE THE CLIP NAMES COME FROM. They are the published files', read out of
// the tree rather than agreed by convention:
//
//   gaits/lower.gait.glb      run.lower walk.lower crouchwalk.lower
//                             crawl.lower stand.lower crouch.lower lie.lower
//   gaits/<Grip>.gait.glb     the same seven as `.upper`
//   gaits/parachute.gait.glb  Lb_ParachuteFall Ub_ParachuteFall
//                             Lb_ParachuteOpen Ub_ParachuteOpen
//                             Lb_ParachuteIdle
//                             Lb_ParachuteHitGround Ub_ParachuteHitGround
//                             Lb_ParachuteDie Ub_ParachuteDie
//                             Lb_ParachuteDeadHitGround
//                             Ub_ParachuteDeadHitGround
//
// The parachute clips keep the engine's own state names, so `parachute.js`'s
// `PARA_CLIPS` -- which is read straight out of
// `animations/AnimationStatesParachute.con` -- is the table, and there is no
// second one here to drift from it.
//
// THE GLIDE'S TORSO IS NOT A CHOICE. `Ub_ParachuteOpen` declares
// `addTransitionWhenDone Ub_StandAim`, so as the canopy finishes opening the
// engine hands the upper body back to the weapon's ordinary aim state -- which
// is why a man under a chute can aim and fire, and why there is no
// `Ub_ParachuteIdle` state at all even though `3PParachuteGlideUpper.baf` is in
// the archives. `PARA_CLIPS.glide.upper` is already the string `Ub_StandAim`;
// `UPPER_STAND_AIM` below is the baked clip that state's timeline was written
// as.
//
// Free of `three` and of the DOM, so `tests/soldier_body_harness.mjs` runs the
// real thing under node.

/** The baked clip the `Ub_StandAim<W>` state's timeline ships as. */
export const UPPER_STAND_AIM = 'stand.upper';
/** The baked clip the `Lb_Stand` state's timeline ships as. */
export const LOWER_STAND = 'stand.lower';

/**
 * Family -> the two baked clips it plays.
 *
 * The seven locomotion families first, then the parachute's. A family's entry
 * is always `{lower, upper}`; a family whose engine state pair has no upper
 * half (the glide) names the standing aim, because that is the state the engine
 * itself is in.
 */
export const BODY_CLIPS = Object.freeze({
  stand: Object.freeze({ lower: 'stand.lower', upper: 'stand.upper' }),
  walk: Object.freeze({ lower: 'walk.lower', upper: 'walk.upper' }),
  run: Object.freeze({ lower: 'run.lower', upper: 'run.upper' }),
  crouch: Object.freeze({ lower: 'crouch.lower', upper: 'crouch.upper' }),
  crouchwalk: Object.freeze({ lower: 'crouchwalk.lower', upper: 'crouchwalk.upper' }),
  prone: Object.freeze({ lower: 'lie.lower', upper: 'lie.upper' }),
  crawl: Object.freeze({ lower: 'crawl.lower', upper: 'crawl.upper' }),
  parachuteFall: Object.freeze({
    lower: 'Lb_ParachuteFall', upper: 'Ub_ParachuteFall' }),
  parachuteOpen: Object.freeze({
    lower: 'Lb_ParachuteOpen', upper: 'Ub_ParachuteOpen' }),
  parachuteGlide: Object.freeze({
    lower: 'Lb_ParachuteIdle', upper: UPPER_STAND_AIM }),
  parachuteLanded: Object.freeze({
    lower: 'Lb_ParachuteHitGround', upper: 'Ub_ParachuteHitGround' }),
  parachuteDie: Object.freeze({
    lower: 'Lb_ParachuteDie', upper: 'Ub_ParachuteDie' }),
  parachuteDeadLanded: Object.freeze({
    lower: 'Lb_ParachuteDeadHitGround', upper: 'Ub_ParachuteDeadHitGround' }),
  // The swim states. Unlike the parachute's, every one of these has a real
  // upper half -- `AnimationStatesSwim.con` creates five `Ub_*Swim*` states of
  // its own -- so none of them borrows `Ub_StandAim`. They are also the only
  // families whose lower halves declare `c_AsmHideWeapon`, which is why the
  // clips live under `animations/3P_NoWeapon/`.
  swimStart: Object.freeze({ lower: 'Lb_StartSwim', upper: 'Ub_StartSwim' }),
  swimFloat: Object.freeze({ lower: 'Lb_Floating', upper: 'Ub_Floating' }),
  swimForward: Object.freeze({ lower: 'Lb_SwimForward', upper: 'Ub_SwimForward' }),
  swimBackward: Object.freeze({ lower: 'Lb_SwimBackward', upper: 'Ub_SwimBackward' }),
  swimEnd: Object.freeze({ lower: 'Lb_EndSwim', upper: 'Ub_EndSwim' }),
  swimDie: Object.freeze({ lower: 'Lb_DieSwim', upper: 'Ub_DieSwim' }),
});

/**
 * Which families a one-shot: the four `c_AsmPlayOnce` parachute states.
 *
 * A renderer plays these `LoopOnce` and clamps, and the state machine's own
 * `addTransitionWhenDone` decides what follows -- which for the opening is the
 * glide, and `parachute.js` already runs that timer (`OPEN_CLIP_SECONDS`), so
 * nothing here needs to.
 */
export const BODY_ONCE = Object.freeze(new Set([
  'parachuteOpen', 'parachuteLanded', 'parachuteDie', 'parachuteDeadLanded',
  // The swim entry, exit and death: `c_AsmPlayOnce` all three, with
  // `addTransitionWhenDone Lb_SwimForward` / `Lb_Stand` / nothing. `swim.js`
  // runs the two transition timers, so nothing here has to.
  'swimStart', 'swimEnd', 'swimDie',
]));

/**
 * What to play when the family a state owes is not bound.
 *
 * Every chain falls back toward the posture before it falls back toward
 * standing, which is `remote-gait.js`'s rule for the same reason: a crawling
 * man whose `crawl` did not resolve is better drawn lying still than walking
 * upright. The parachute chains fall back to the free-fall clip and then to
 * standing, so a tree published before `parachute.gait.glb` existed draws a
 * falling man upright rather than drawing nothing.
 */
export const BODY_FALLBACKS = Object.freeze({
  stand: Object.freeze(['stand']),
  walk: Object.freeze(['walk', 'stand']),
  run: Object.freeze(['run', 'walk', 'stand']),
  crouch: Object.freeze(['crouch', 'stand']),
  crouchwalk: Object.freeze(['crouchwalk', 'crouch', 'walk', 'stand']),
  prone: Object.freeze(['prone', 'stand']),
  crawl: Object.freeze(['crawl', 'prone', 'walk', 'stand']),
  parachuteFall: Object.freeze(['parachuteFall', 'stand']),
  parachuteOpen: Object.freeze(['parachuteOpen', 'parachuteGlide',
    'parachuteFall', 'stand']),
  parachuteGlide: Object.freeze(['parachuteGlide', 'parachuteFall', 'stand']),
  parachuteLanded: Object.freeze(['parachuteLanded', 'stand']),
  parachuteDie: Object.freeze(['parachuteDie', 'parachuteFall', 'stand']),
  parachuteDeadLanded: Object.freeze(['parachuteDeadLanded',
    'parachuteLanded', 'stand']),
  // Every swim chain falls back through `swimFloat` -- treading water is the
  // posture, the way `prone` is for a crawl -- and only then to standing, so a
  // tree published before `swim.gait.glb` existed draws a man upright in the
  // water rather than drawing nothing.
  swimStart: Object.freeze(['swimStart', 'swimFloat', 'stand']),
  swimFloat: Object.freeze(['swimFloat', 'stand']),
  swimForward: Object.freeze(['swimForward', 'swimFloat', 'stand']),
  swimBackward: Object.freeze(['swimBackward', 'swimFloat', 'stand']),
  swimEnd: Object.freeze(['swimEnd', 'swimFloat', 'stand']),
  swimDie: Object.freeze(['swimDie', 'swimFloat', 'stand']),
});

/**
 * `parachute.js`'s lower-body state name -> the family that plays it.
 *
 * Keyed on the LOWER half deliberately. The lower body is the half every
 * parachute state actually declares -- the glide's upper is `Ub_StandAim`,
 * which is not a parachute state at all -- so the lower name is the one that
 * identifies the state uniquely.
 */
const FAMILY_BY_LOWER_STATE = Object.freeze({
  lb_parachutefall: 'parachuteFall',
  lb_parachuteopen: 'parachuteOpen',
  lb_parachuteidle: 'parachuteGlide',
  lb_parachutehitground: 'parachuteLanded',
  lb_parachutedie: 'parachuteDie',
  lb_parachutedeadhitground: 'parachuteDeadLanded',
});

/**
 * The family for a parachute clip pair, or null for a pair this does not know.
 *
 * `pair` is whatever `Parachute.clips(dead)` answered -- a `{lower, upper}` of
 * engine state names, or null when the soldier is neither falling nor under a
 * canopy.
 */
export function parachuteFamily(pair) {
  const lower = pair && pair.lower;
  if (typeof lower !== 'string') return null;
  return FAMILY_BY_LOWER_STATE[lower.toLowerCase()] ?? null;
}

/**
 * The family a locomotion gait and stance owe.
 *
 * `soldier.js`'s `#gaitFor` answers `'stand'` for ANY stationary soldier,
 * crouched and prone included -- it exists to pick a row of the view-bob
 * table, which is only consulted while moving -- and answers `'crouch'` /
 * `'prone'` for the MOVING gaits of those stances. So neither value alone is
 * the posture, which is the same trap `stance-clips.js` documents, and the
 * stance has to be consulted for a stationary man.
 */
export function locoFamily(gait, stance) {
  if (gait === 'crouch') return 'crouchwalk';
  if (gait === 'prone') return 'crawl';
  if (gait === 'run') return 'run';
  if (gait === 'walk') return 'walk';
  // Stationary: the stance is the whole answer.
  if (stance === 'crouch') return 'crouch';
  if (stance === 'prone') return 'prone';
  return 'stand';
}

/**
 * `swim.js`'s own family name, or `null` when the pair is not a swim one.
 *
 * Keyed on the LOWER half for the same reason the parachute's is: the lower body
 * is the half every swim state declares, and it is the machine
 * `BFSoldier::isSwimming` and `handleDamage` both read (`this+0x294`).
 */
const FAMILY_BY_SWIM_STATE = Object.freeze({
  lb_startswim: 'swimStart',
  lb_floating: 'swimFloat',
  lb_swimforward: 'swimForward',
  lb_swimbackward: 'swimBackward',
  lb_endswim: 'swimEnd',
  lb_dieswim: 'swimDie',
});

/**
 * The family for a swim clip pair, or null for a pair this does not know.
 *
 * `pair` is whatever `SwimState.clips(dead)` answered -- a `{lower, upper}` of
 * engine state names, or null when the soldier is not in the water.
 */
export function swimFamily(pair) {
  const lower = pair && pair.lower;
  if (typeof lower !== 'string') return null;
  return FAMILY_BY_SWIM_STATE[lower.toLowerCase()] ?? null;
}

/**
 * The family the local soldier owes this frame, before any fallback.
 *
 * Two whole-body state machines outrank the gait, and both for the engine's own
 * reason -- they replace the locomotion pair rather than layering over it:
 *
 *  * **The parachute**, because `setIsParachuting` sets both halves (PARA-5). A
 *    man under a canopy is not also running.
 *  * **Swimming**, because `BFSoldier::updateSwimming` enters the swim states by
 *    name on both machines (`setAnimationState(0, "Lb_StartSwim")`,
 *    `setAnimationState(1, "Ub_StartSwim")`, `0x082823f7` / `0x08282426`) and
 *    every one of them carries `c_AsmIsSwimming`. A swimming man is not also
 *    crouching: the swim states declare neither `c_AsmIsCrouching` nor
 *    `c_AsmIsLying`, so `getPose()` answers standing throughout.
 *
 * The parachute is tested first because the two cannot both be true in the
 * engine -- `updateSwimming` runs on a man whose chute has already collapsed --
 * and because a canopy over water is the parachute's landing, not a swim.
 */
export function bodyFamily({ gait = 'stand', stance = 'stand',
                             parachute = null, swim = null } = {}) {
  return parachuteFamily(parachute) ?? swimFamily(swim)
    ?? locoFamily(gait, stance);
}

/**
 * The family to play, given what the rig actually bound.
 *
 * `bound` is `(family) => boolean`. Falls all the way back to `stand`; with no
 * `bound` at all the wanted family is returned, because a caller that does not
 * know what is baked is asking what the engine owes.
 */
export function resolveBodyFamily(want, bound) {
  const chain = BODY_FALLBACKS[want] || BODY_FALLBACKS.stand;
  if (typeof bound !== 'function') return chain[0];
  for (const name of chain) if (bound(name)) return name;
  return 'stand';
}

/** `bodyFamily` then `resolveBodyFamily`, which is what a renderer wants. */
export function bodyClipFamily(state, bound) {
  return resolveBodyFamily(bodyFamily(state), bound);
}

/**
 * Is the canopy drawn, and which of its two clips plays?
 *
 * The canopy is the `Parachute` child the soldier has always carried;
 * `setIsParachuting` drives it to `"OpenParachute"`, which
 * `addTransitionWhenDone`s to `"IdleParachute"` (PARA-5). It is therefore shown
 * for exactly the states in which the chute is carrying the man -- open,
 * gliding, and touching down -- and hidden in free fall, where the pack is
 * still on his back.
 *
 * Returns `null` when no canopy is drawn, else the clip name (`open` / `idle`)
 * the bundle baked.
 */
export function canopyClip(family) {
  if (family === 'parachuteOpen') return 'open';
  if (family === 'parachuteGlide' || family === 'parachuteLanded'
    || family === 'parachuteDie' || family === 'parachuteDeadLanded') {
    return 'idle';
  }
  return null;
}
