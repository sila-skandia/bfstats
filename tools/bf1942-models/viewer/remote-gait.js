// What a third-person soldier the page did not simulate should be playing:
// which baked clip family, from his stance and his measured ground speed.
//
// This is the 3P half of `stance-clips.js`. A remote player in a room arrives
// as a position stream plus two stance bits (`netcode.js` snapshot flags 4 and
// 8), and the renderer has to turn that into a clip. Three things were wrong
// with the way `netcode-render.js` did it, and all three were name-level, so
// nothing ever threw:
//
//  1. The gait halves are baked as `run.lower` / `run.upper` and bound as
//     `runLower` / `runUpper`, but selection asked for `actions.run` and
//     `actions.walk` — names that have never existed. Both lookups came back
//     undefined, the fallback took them to `stand`, and **a remote soldier
//     never played a walk or a run at all**: he slid across the ground in the
//     standing pose with the gait bundle loaded and unused.
//  2. The prone pose clip is baked as **`lie`** (the engine's own word:
//     `Lb_Lie`, `c_BfSoldierLying`), and selection asked for `prone`. So a
//     prone remote stood up.
//  3. `crouchwalk` and `crawl` are in the published bundles — `lower.gait.glb`
//     carries `run.lower`, `walk.lower`, `crouchwalk.lower`, `crawl.lower` and
//     every grip bundle the matching `.upper` — and nothing referenced them.
//
// The speed bands are the engine's own tables, not new numbers:
// `BFSoldierTemplate::directionalSpeed` (`physics.js` `DIRECTIONAL_SPEED`,
// `0x009581b4`) gives 6 m/s standing forward, 2 crouched, 1 prone, and
// `walkSpeedFactor` 1/3 puts a standing walk at 2. A band boundary sits at the
// midpoint of the two speeds it separates, which is `gait-select.js`'s own rule
// for a recording and is used here for the same reason: BF1942 infantry have no
// acceleration ramp worth speaking of at this timescale, so a clean sample sits
// on one of the table's speeds.
//
// Free of `three` and of the DOM, so `tests/remote_gait_harness.mjs` runs the
// real thing under node.

/** `DIRECTIONAL_SPEED[pose * 2]`, forward: stand 6, crouch 2, prone 1. */
export const TOP_SPEED = Object.freeze({ stand: 6, crouch: 2, prone: 1 });

/** `walkSpeedFactor`: the standing walk is a third of the standing run. */
export const WALK_FACTOR = 1 / 3;

/**
 * Standing: walk from 1 m/s (half of the 2 m/s walk), run from 4 m/s (the
 * midpoint of 2 and 6).
 *
 * Crouched and prone have one movement family each, so their only boundary
 * separates standing still from the **slowest** speed that family covers --
 * and that is the walk speed, not the run speed. The engine applies
 * `walkSpeedFactor` standing only (`rampedDirectionalSpeed`, `0x0827484c`),
 * so a crouched or crawling man holding `c_PIWalk` moves at his stance's full
 * 2 or 1 m/s; each boundary is half the stance's speed times the walk factor
 * all the same, which sits under every speed the stance can move at. A stationary replica's
 * smoothed estimate reads exactly 0, so there is no jitter to leave room for.
 */
export const BANDS = Object.freeze({
  walk: (TOP_SPEED.stand * WALK_FACTOR) / 2,                  // 1.0
  run: (TOP_SPEED.stand * WALK_FACTOR + TOP_SPEED.stand) / 2, // 4.0
  crouch: (TOP_SPEED.crouch * WALK_FACTOR) / 2,               // 0.333
  prone: (TOP_SPEED.prone * WALK_FACTOR) / 2,                 // 0.167
});

/**
 * The clip family for a stance and a ground speed.
 *
 * Returns one of `stand`, `walk`, `run`, `crouch`, `crouchwalk`, `prone`,
 * `crawl`. Prone wins over crouch when a snapshot somehow carries both, which
 * is `soldier.js`'s own order.
 */
export function remoteGait(speed, { crouch = false, prone = false } = {}) {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  if (prone) return v > BANDS.prone ? 'crawl' : 'prone';
  if (crouch) return v > BANDS.crouch ? 'crouchwalk' : 'crouch';
  if (v > BANDS.run) return 'run';
  if (v > BANDS.walk) return 'walk';
  return 'stand';
}

/**
 * What each family is baked as: a static pose clip from the `.pose.glb`, or a
 * lower/upper pair from the gait bundles.
 *
 * The names are the files', read out of the published tree:
 * `USMarineSoldier__Colt.pose.glb` holds `stand`, `crouch`, `lie`;
 * `gaits/lower.gait.glb` holds `run.lower`, `walk.lower`, `crouchwalk.lower`,
 * `crawl.lower`, and each grip bundle the four `.upper`.
 */
export const FAMILY_CLIPS = Object.freeze({
  stand: Object.freeze({ pose: 'stand' }),
  crouch: Object.freeze({ pose: 'crouch' }),
  prone: Object.freeze({ pose: 'lie' }),
  walk: Object.freeze({ lower: 'walk.lower', upper: 'walk.upper' }),
  run: Object.freeze({ lower: 'run.lower', upper: 'run.upper' }),
  crouchwalk: Object.freeze({ lower: 'crouchwalk.lower', upper: 'crouchwalk.upper' }),
  crawl: Object.freeze({ lower: 'crawl.lower', upper: 'crawl.upper' }),
});

/**
 * What to play when the family a stance owes is not bound.
 *
 * Every chain falls back toward the stance before it falls back toward
 * standing: a crawling man for whom `crawl` did not resolve is better drawn
 * lying still than walking upright.
 */
export const FALLBACKS = Object.freeze({
  stand: Object.freeze(['stand']),
  walk: Object.freeze(['walk', 'stand']),
  run: Object.freeze(['run', 'walk', 'stand']),
  crouch: Object.freeze(['crouch', 'stand']),
  crouchwalk: Object.freeze(['crouchwalk', 'crouch', 'walk', 'stand']),
  prone: Object.freeze(['prone', 'stand']),
  crawl: Object.freeze(['crawl', 'prone', 'walk', 'stand']),
});

/**
 * The family to play, given what the rig actually bound.
 *
 * `bound` is `(family) => boolean`. Falls all the way back to `stand`, which
 * every pose pair carries; with no `bound` at all the family itself is
 * returned.
 */
export function resolveRemoteGait(want, bound) {
  const chain = FALLBACKS[want] || FALLBACKS.stand;
  if (typeof bound !== 'function') return chain[0];
  for (const name of chain) if (bound(name)) return name;
  return 'stand';
}

/**
 * The swim families, `swim.js` `SWIM_CLIPS`' keys, and what each falls back
 * to when it did not bind: the tread (`swimFloat`, the posture every swim
 * state returns to), and past that nothing -- the gait decides, so a tree
 * published before `swim.gait.glb` draws him as it always did.
 */
export const SWIM_FALLBACKS = Object.freeze({
  swimStart: Object.freeze(['swimStart', 'swimFloat']),
  swimFloat: Object.freeze(['swimFloat']),
  swimForward: Object.freeze(['swimForward', 'swimFloat']),
  swimBackward: Object.freeze(['swimBackward', 'swimFloat']),
  swimEnd: Object.freeze(['swimEnd', 'swimFloat']),
});

/** The swim family to draw for `swim`, or null when there is none to draw. */
export function resolveRemoteSwim(swim, bound) {
  const chain = swim ? SWIM_FALLBACKS[swim] : null;
  if (!chain) return null;
  if (typeof bound !== 'function') return chain[0];
  for (const name of chain) if (bound(name)) return name;
  return null;
}

/**
 * `remoteGait` then `resolveRemoteGait`, which is what a renderer wants.
 *
 * `swim` is the swim state the snapshot carried (`netcode.js` `SWIM_WIRE`),
 * and it outranks the gait for the engine's reason: `BFSoldier::updateSwimming`
 * sets the swim states on both machines by name (`0x082823f7`, `0x08282426`),
 * so a man in the water is not also walking, whatever his speed reads.
 */
export function remoteClipFamily(speed, state, bound, swim = null) {
  return resolveRemoteSwim(swim, bound)
    ?? resolveRemoteGait(remoteGait(speed, state), bound);
}

/**
 * The clip family a REPLAYED soldier should draw: the measured ground speed
 * plus the stance his recording carries.
 *
 * The replay used to read `gait-select.js` alone, which returns idle/walk/run
 * and says in its own header why: it was written when the recorder captured no
 * stance. A crouch-walk travels `2 x walkSpeedFactor` = 0.67 m/s and a crawl
 * `1 x walkSpeedFactor` = 0.33, both under the standing walk band of 1.0, so
 * every crouching and prone sample read as standing still while the body
 * translated -- the soldier slid. Measured on replay_20261018-233939 against
 * the engine's own recorded lower state: 73 of 73 crouching samples drew idle.
 *
 * It lives here, beside the bands, so the live netcode path and the replay
 * cannot drift apart. `body` is `replay-recording.js` `bodyAt`'s shape, or
 * null for a recording with no state table, which reads as it always did.
 * Returns `FAMILY_HALVES`'s own names, except that the standing-still family
 * is `idle` rather than `stand`, which is what the replay rig calls it.
 */
export function replayGait(speed, body) {
  const recorded = recordedGait(body?.lower);
  if (recorded) return recorded.family === 'stand' ? 'idle' : recorded.family;
  const gait = remoteGait(speed, {
    crouch: body?.stance === 'crouch',
    prone: body?.stance === 'prone',
  });
  return gait === 'stand' ? 'idle' : gait;
}

/**
 * The gait family a REPLAYED soldier's own recorded lower state plays, and
 * whether it plays it backwards: `{ family, reverse }`, or null for a state
 * this does not name (a mod's own, or none recorded), which leaves the speed
 * bands above to guess.
 *
 * The bands are a guess at a state the recording already holds. Since the
 * state table (`anim`, round-replay-capture), every `st` row names the engine's
 * lower state, and reading the speed instead got three things wrong on
 * 8t224pppqe (berlin, pid 1 "BF6", net id 899), all in the 3P follow camera:
 *
 *  * **the legs a beat behind the body.** The drawn speed is a one-pole over
 *    the drawn position (`bot-visuals.js`, rate 6 a second), so from a stand
 *    it crosses the walk band (1.0) and then the run band (4.0) a good 0.15 s
 *    after the man is already running, and each crossing starts its own
 *    morph. At 39.30 he stands (`Lb_Stand`), at 39.33 the recording has
 *    `Lb_StrafeLeft` and at 39.39 `Lb_RunForward`; the page drew `stand`,
 *    then `walk`, and only then `run`.
 *  * **a run that drops to a walk and back.** `Lb_RunBackward` moves at the
 *    backward table's speed, which sits on the run band: over his 185 s,
 *    727 frames of a recorded `Lb_RunBackward` drew the walk and 857 the run,
 *    and the family went run -> walk -> run 74 times.
 *  * **the legs running forward while he backs off.** No band says backward.
 *
 * The names are vanilla's (`animations/AnimationStates*.con`, read through
 * `bf42/animstates.py`), which the mods keep: the strafes are the forward run
 * clip at 1.3 (`Lb_StrafeLeft 3PRunLower.baf 1.3`, so `run`, forward), every
 * `*Backward` lower state is its forward clip at a negative rate
 * (`Lb_WalkBackward 3PWalkLower.baf -1.0`, `Lb_CrouchBackward -0.8`,
 * `Lb_LieBackward -0.8`), save `Lb_RunBackward`, which has a clip of its own
 * (`3PRunBackLower.baf -1.6`). The jumps return to the gait they left
 * (`Lb_RunJump addTransitionWhenDone Lb_RunForward`, `Lb_StandJump ->
 * Lb_Stand`). The family is the gait those states stand on; where the rig
 * carries the state's own clip (`recordedClip`, bundles baked since
 * 2026-10-29) the half plays that by name over it, and on an older tree the
 * family draws them: the forward run reversed for the backward run, the run
 * or the stand for a jump. A transition's family is the stance it lands in: the
 * transition itself is entered by name (`SoldierActions.stanceChanged`, fed
 * the recorded entry by `recordedStanceEntry`), and the family is only the
 * base the chain ends on.
 */
export function recordedGait(lower) {
  if (typeof lower !== 'string' || !lower) return null;
  const key = lower.toLowerCase();
  const reverse = /backward$/.test(key);
  for (const [pattern, family] of RECORDED_LOWER) {
    if (pattern.test(key)) return { family, reverse };
  }
  return null;
}

const RECORDED_LOWER = Object.freeze([
  [/^lb_lie(forward|backward)$/, 'crawl'],
  // `Lb_LieStrafeLeft` plays `3PLieTurnLeftLower.baf`, which no bundle
  // carries; the crawl is the prone gait that moves.
  [/^lb_lie(strafeleft|straferight)$/, 'crawl'],
  [/^lb_lie$/, 'prone'],
  [/^lb_crouch(forward|backward|strafeleft|straferight)$/, 'crouchwalk'],
  [/^lb_crouch$/, 'crouch'],
  [/^lb_walk(forward|backward)$/, 'walk'],
  [/^lb_(run(forward|backward)|strafe(left|right)|runjump(backward)?)$/, 'run'],
  [/^lb_stand(relax|jump)?$/, 'stand'],
  [/^lb_(standtocrouch|lietocrouch)$/, 'crouch'],
  [/^lb_(crouchtostand|lietostand)$/, 'stand'],
  [/^lb_(standtolie|crouchtolie|runstandtolie)$/, 'prone'],
]);

/**
 * The stance change a recorded lower state STARTS, as
 * `SoldierActions.stanceChanged` takes it (`{ from, to, backward }`), or null
 * for a state that starts none.
 *
 * `handlePlayerInput` enters the first state of each chain by name
 * (`soldier-actions.js` `STANCE_ENTRY`), and the recording writes that state
 * on the tick it was entered, so the chain can start there instead of where
 * the stance FLAG changes -- which is later, and for one chain much later:
 * `Lb_LieToStand` still carries `c_AsmIsLying`, so the flags read prone until
 * `Lb_CrouchToStand`. On 8t224pppqe the recorded `Lb_LieToStand` is at 36.46
 * and the flag stands at 36.84: the page started the get-up 0.38 s late,
 * while the body was already running off at 6 m/s. And the flag cannot tell
 * the dive from lying down backwards (PHY-8); the state it records can:
 * `Lb_RunStandToLie` is the dive, `Lb_StandToLie` the other.
 *
 * `previous` is the lower state recorded before this one: a state that is the
 * one the previous hands to (`Lb_StandToLie -> Lb_CrouchToLie`, `Lb_LieToStand
 * -> Lb_CrouchToStand`) continues a chain rather than starting one.
 */
export function recordedStanceEntry(lower, previous = null) {
  if (typeof lower !== 'string') return null;
  const key = lower.toLowerCase();
  const entry = RECORDED_ENTRY[key];
  if (!entry) return null;
  const prev = typeof previous === 'string' ? previous.toLowerCase() : null;
  if (prev && CHAIN_NEXT[prev] === key) return null;
  return entry;
}

const RECORDED_ENTRY = Object.freeze({
  lb_standtocrouch: Object.freeze({ from: 'stand', to: 'crouch', backward: false }),
  lb_crouchtostand: Object.freeze({ from: 'crouch', to: 'stand', backward: false }),
  lb_runstandtolie: Object.freeze({ from: 'stand', to: 'prone', backward: false }),
  lb_standtolie: Object.freeze({ from: 'stand', to: 'prone', backward: true }),
  lb_crouchtolie: Object.freeze({ from: 'crouch', to: 'prone', backward: false }),
  lb_lietocrouch: Object.freeze({ from: 'prone', to: 'crouch', backward: false }),
  lb_lietostand: Object.freeze({ from: 'prone', to: 'stand', backward: false }),
});

/** Each chain state's `addTransitionWhenDone`, where that is another chain
 *  state (`soldier-actions.js` `VANILLA_STATES`). */
const CHAIN_NEXT = Object.freeze({
  lb_standtolie: 'lb_crouchtolie',
  lb_lietostand: 'lb_crouchtostand',
});

/**
 * The clip a half plays for a REPLAYED soldier's recorded state, by the name
 * the gait bundles file it under, or null for a state no gait stands in for
 * badly enough to need one (everything the gaits, the stance chain, the fire
 * and the reload already draw).
 *
 * These are the states the bundles gained on 2026-10-29 (`extract_pose.py`
 * `LOWER_ACTIONS`, `UPPER_ACTIONS`): the jumps, the backward run's own clip
 * and the draw. Before them a jump drew the run it returns to, a backward run
 * drew the forward run reversed, and a weapon change morphed the torso from
 * the old grip's pose instead of cutting to `Ub_StandRaiseWeapon<W>`
 * (8t224pppqe, pid 1, 26.86-27.73 and the 28 s of `Lb_RunBackward`).
 *
 * The lower states are weapon-free and keep their names. An upper state
 * carries the item it belongs to (`Ub_StandRaiseWeaponKnifeAxis`), and the
 * bundle files it without (`Ub_StandRaiseWeapon`): `weapon` is the item the
 * drawn body holds, and a state of another item -- the knife's draw, recorded
 * while the old body still holds the MP40 because the knife's has not loaded
 * -- is not this body's to play. The names are `soldier-actions.js`
 * `RECORDED_STATES`.
 */
export function recordedClip(state, half, weapon = null) {
  if (typeof state !== 'string' || !state) return null;
  if (half === 'lower') return RECORDED_LOWER_CLIPS.get(state.toLowerCase()) ?? null;
  if (half !== 'upper') return null;
  const m = RECORDED_UPPER_CLIP.exec(state);
  if (!m) return null;
  const item = m[2];
  if (weapon && item.toLowerCase() !== String(weapon).toLowerCase()) return null;
  return RECORDED_UPPER_CLIPS.get(m[1].toLowerCase());
}

const RECORDED_LOWER_CLIPS = new Map(
  ['Lb_RunJump', 'Lb_StandJump', 'Lb_RunJumpBackward', 'Lb_RunBackward']
    .map(name => [name.toLowerCase(), name]));
const RECORDED_UPPER_CLIPS = new Map(
  ['Ub_RunJump', 'Ub_StandJump', 'Ub_RunBackward', 'Ub_StandRaiseWeapon']
    .map(name => [name.toLowerCase(), name]));
const RECORDED_UPPER_CLIP = /^(Ub_(?:RunJump|StandJump|RunBackward|StandRaiseWeapon))(\w+)$/i;
