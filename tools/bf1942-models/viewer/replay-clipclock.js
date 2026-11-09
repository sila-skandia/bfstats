// The clip as it plays (features/replay-creator-view, "Shots on the strip"):
// the round's clock run through a clip the way the page runs it, in small
// steps of real time -- a kill shot's bullet time slowing to the trigger, the
// round's flight taking the preset's seconds however far it goes, the hold on
// the hit, or the clip's own slow motion in their place, and the freeze on
// the kill -- so the clip strip can lay the clip out in the seconds of the
// video it makes rather than the seconds of the round. A sniper's round over
// 340 m is 0.17 s of the round and 2.5 s of the video: on a strip of round
// time it is a sliver no cut can be dragged into.
//
// The same numbers as the round cam's own clock (replay-roundcam.js `step`,
// BULLET_CLOCK). The page's round may land a little earlier or later than the
// round laid out here; the creator measures it the first time round and lays
// the clip out again (`ReplayCreator.timing`).
//
// Pure but for the round cam's numbers, so `tests/replay_creator_harness.mjs`
// runs it.

import { BULLET_CLOCK } from './replay-roundcam.js';
import { rampSpeedAt, slowsClip } from './replay-shot.js';

/** Real seconds a step of the model. */
const STEP = 1 / 120;
/** The most steps a clip is run for: five minutes of video at STEP. Past it
 *  the clock is taken as the round's own. */
const MAX_STEPS = 36000;

const smooth = (a, b, x) => {
  if (a === b) return x >= b ? 1 : 0;
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** The first index in sorted `arr` at or after `v`. */
function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The clip `span` (`{ t0, t1 }`, seconds of the round) as it plays.
 *
 * - `ramp`: the clip's own slow motion (replay-shot.js). Where it slows the
 *   clip it runs the clock and bullet time stands aside, as the round cam's
 *   `clockOwned` hook has it.
 * - `bullet`: a kill shot's take, or null: `{ shot, hit, kill, preset,
 *   armedSlow, flightSlow, melee, orbitHold }` -- the trigger, when its round
 *   lands (the trigger for a knife), the kill line, the bullet time preset
 *   (BULLET_TIME, null when off), the clock's speed while the shot is coming
 *   and while the round flies, and whether the hold is a turn round the man.
 * - `freeze`: `{ at, real }`, the clock held `real` seconds at `at`; or a
 *   list of them (the kill's, and any placed by hand).
 *
 * `{ toScreen(t), toRound(s), length, down, knots }`: `toScreen` is seconds
 * of the video from the clip's start (negative before it; outside the clip
 * one for one), `toRound` its inverse, `length` the clip's seconds of video,
 * `down` when the hold ends and the clock is the round's own again (null with
 * no take).
 */
export function clipClock({ span, ramp = null, bullet = null, freeze = null, step = STEP }) {
  const C = BULLET_CLOCK;
  const own = slowsClip(ramp, span);
  const ts = [span.t0];
  const ss = [0];
  let t = span.t0;
  let s = 0;
  let speed = 1;
  let state = bullet ? 'armed' : 'idle';
  let real = 0;
  let down = null;
  const freezes = (Array.isArray(freeze) ? freeze : freeze ? [freeze] : [])
    .filter(f => f?.real > 0 && f.at >= span.t0 && f.at <= span.t1).sort((a, b) => a.at - b.at);
  let fi = 0;
  const eased = Boolean(bullet?.preset) && !own;
  for (let i = 0; i < MAX_STEPS && t < span.t1; i++) {
    while (fi < freezes.length && t >= freezes[fi].at) {
      s += freezes[fi].real;
      ts.push(t);
      ss.push(s);
      fi++;
    }
    let target = null;
    if (state === 'armed') {
      if (t >= bullet.shot) {
        state = bullet.melee || !(bullet.hit > bullet.shot) ? 'impact' : 'flying';
        real = 0;
      } else {
        const slow = bullet.melee ? C.meleeSpeed : bullet.armedSlow;
        target = 1 + (Math.min(1, slow) - 1) * smooth(bullet.shot - C.rampLead, bullet.shot, t);
      }
    }
    if (state === 'flying') {
      if (t >= bullet.hit) {
        state = 'impact';
        real = 0;
      } else target = Math.min(1, bullet.flightSlow);
    }
    if (state === 'impact') {
      const fell = !Number.isFinite(bullet.kill) || t >= bullet.kill + C.holdPastKill;
      const hull = bullet.hull && !bullet.melee;
      const least = hull ? C.hullHoldReal : bullet.orbitHold || bullet.melee ? C.orbitHold : C.holdReal;
      if ((real >= least && fell) || real >= Math.max(least, hull ? C.hullHoldMax : C.holdMaxReal)) {
        state = 'idle';
        down = t;
        if (eased) speed = 1;
      } else target = bullet.melee ? C.meleeSpeed : hull ? C.hullHoldSpeed : C.holdSpeed;
    }
    if (own) speed = rampSpeedAt(ramp, span, t, 1) ?? 1;
    else if (eased && target !== null) speed += (target - speed) * (1 - Math.exp(-step / C.clockEase));
    if (!(speed > 1e-4)) speed = 1e-4;
    t += speed * step;
    s += step;
    if (state === 'impact') real += step;
    ts.push(t);
    ss.push(s);
  }
  // The last step lands past the clip's end: cut it back to the end.
  const n = ts.length;
  if (n >= 2 && ts[n - 1] > span.t1) {
    const a = ts[n - 2];
    const k = (span.t1 - a) / Math.max(1e-9, ts[n - 1] - a);
    ss[n - 1] = ss[n - 2] + (ss[n - 1] - ss[n - 2]) * k;
    ts[n - 1] = span.t1;
  }
  const tArr = Float64Array.from(ts);
  const sArr = Float64Array.from(ss);
  const last = tArr.length - 1;
  const length = sArr[last];
  const endT = tArr[last];

  const toScreen = x => {
    if (!Number.isFinite(x)) return 0;
    if (x <= span.t0) return x - span.t0;
    if (x >= endT) return length + (x - endT);
    // The last knot at or before `x`: a freeze is two knots at one time, and
    // the time is shown at its end.
    let i = lowerBound(tArr, x);
    if (tArr[i] === x) {
      while (i < last && tArr[i + 1] === x) i++;
      return sArr[i];
    }
    const a = i - 1;
    const k = (x - tArr[a]) / Math.max(1e-12, tArr[i] - tArr[a]);
    return sArr[a] + (sArr[i] - sArr[a]) * k;
  };
  const toRound = y => {
    if (!Number.isFinite(y)) return span.t0;
    if (y <= 0) return span.t0 + y;
    if (y >= length) return endT + (y - length);
    const i = lowerBound(sArr, y);
    if (sArr[i] === y) return tArr[i];
    const a = i - 1;
    const k = (y - sArr[a]) / Math.max(1e-12, sArr[i] - sArr[a]);
    return tArr[a] + (tArr[i] - tArr[a]) * k;
  };
  // The clock's speed at `t` as the clip plays it, seconds of the round a
  // second: what a part of the clip played on its own runs at, with no round
  // cam to slow it (`ReplayCreator.loopPart`). A freeze is no speed of its
  // own: the clock either side of it.
  const speedAt = x => {
    if (!Number.isFinite(x) || x < span.t0 || x >= endT) return 1;
    let i = Math.max(1, lowerBound(tArr, x));
    while (i < last && !(tArr[i] > tArr[i - 1])) i++;
    const dt = tArr[i] - tArr[i - 1];
    const ds = sArr[i] - sArr[i - 1];
    return dt > 0 && ds > 0 ? Math.min(1, Math.max(1e-4, dt / ds)) : 1;
  };
  return { span: { ...span }, toScreen, toRound, speedAt, length, down, knots: last + 1 };
}

/** A clip with nothing to slow it: the round's seconds are the video's. */
export function plainClock(span) {
  return clipClock({ span });
}
