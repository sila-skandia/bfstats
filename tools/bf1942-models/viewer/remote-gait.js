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
 * and that is the walk speed, not the run speed. `physics.js`
 * `rampedDirectionalSpeed` applies `walkSpeedFactor` in every pose, so a
 * crouched man holding `c_PIWalk` travels 2 x 1/3 = 0.67 m/s and a crawling
 * one 1 x 1/3 = 0.33 m/s. A boundary at half the *run* speed (1.0 and 0.5)
 * sits above both of those and would draw a walking crouch as a still one,
 * so each is half the stance's own walk speed instead. A stationary replica's
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

/** `remoteGait` then `resolveRemoteGait`, which is what a renderer wants. */
export function remoteClipFamily(speed, state, bound) {
  return resolveRemoteGait(remoteGait(speed, state), bound);
}
