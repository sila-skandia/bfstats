// A replay watched on a phone: the page's lean profile
// (features/replay-performance, "Phones").
//
// The owner's 2026-11-13 report: on a phone the live replay had become
// unwatchable, and on a phone all a replay has to do is scrub and play the
// round. The page drew it as a desktop draws it: a canvas at twice the
// screen's CSS pixels with 4x MSAA (780x1688 on a 390x844 phone, 1.3 M pixels
// four samples each), every static at the game's HIGH LOD and the level's
// whole view distance, sixty times a second, which a phone's GPU and its
// thermal budget cannot hold. On a phone, unless the visitor has chosen
// otherwise:
//
//   pixel ratio   at most 1.5 (DISPLAY MODE, once chosen, wins)
//   anti-alias    off (OPTIONS > VIDEO's choice, or `?aa`, wins)
//   video         the game's LOW LOD and effects, no reflections, 75 % view
//                 distance; lightmaps stay (the level is unreadable lit
//                 flat) and textures drop one mip, not three. A stored
//                 OPTIONS > VIDEO wins.
//   frame rate    30 a second: steady pacing, and a phone that is not
//                 throttling itself a minute in. `?fps=60` lifts it.
//
// `?phone=1` puts a desktop on the profile (the bench's), `?phone=0` takes a
// phone off it. Play is unchanged: a phone in a match keeps its own settings.

import { normalizeVideo } from './video-settings.js';

/** The canvas's pixel ratio at most, with no DISPLAY MODE chosen. */
export const PHONE_RATIO_CAP = 1.5;

/** Frames a second the replay draws on a phone. */
export const PHONE_FPS = 30;

/** OPTIONS > VIDEO on a phone with nothing stored: VideoLow.con's LOD,
 *  effects and reflections, with the lightmaps kept and one mip dropped. */
export const PHONE_VIDEO = Object.freeze({
  graphicsQuality: 1,
  effectsQuality: 1,
  environmentMapping: false,
  lightmaps: true,
  shadows: false,
  textureQuality: 3,
  viewDistance: 75,
});

/** A phone: a coarse pointer on a screen whose short side is under 600 CSS
 *  pixels (replay-ui.js's own test for a phone; a tablet is not one). */
export function isPhone({
  coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
  screenW = globalThis.screen?.width ?? 0,
  screenH = globalThis.screen?.height ?? 0,
} = {}) {
  const short = Math.min(screenW, screenH);
  return !!coarse && short > 0 && short < 600;
}

/** Whether this page is a replay on the phone profile. */
export function phoneReplay(params, env) {
  if (!params?.has?.('replay')) return false;
  const forced = params.get('phone');
  if (forced === '0') return false;
  if (forced === '1') return true;
  return isPhone(env);
}

/** The video settings a phone replay starts from: what is stored, else
 *  `PHONE_VIDEO`. */
export function phoneVideo(hasStored, stored) {
  return hasStored ? stored : normalizeVideo({ ...PHONE_VIDEO });
}

/**
 * The frame gate: `gate(now)` is true when a frame should be drawn at `now`
 * (rAF's timestamp, ms). With `fps` 0 every frame is. A frame is let through
 * once 1000/fps ms have passed, less a quarter of a 60 Hz frame so a display
 * at 60 lands on every second one and not every third.
 */
export function frameGate(fps) {
  if (!(fps > 0)) return () => true;
  const interval = 1000 / fps - 4;
  let last = -Infinity;
  return now => {
    if (now - last < interval) return false;
    last = now;
    return true;
  };
}

/** The phone's frame rate from the query: `?fps=<n>`, else `PHONE_FPS`. */
export function phoneFps(params) {
  const n = Number(params?.get?.('fps'));
  return n > 0 ? n : PHONE_FPS;
}
