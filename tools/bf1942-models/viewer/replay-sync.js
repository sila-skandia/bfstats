// The hit on a time of the video (features/replay-creator-view, "The hit on
// a beat"): a creator cutting a clip to music knows where the drums come in
// -- 0:41 of the song -- and wants the round to hit there. Working backwards
// from that to where the clip has to start, at the slow motion it has, is
// sums the studio does for them.
//
// The pin is `{ ev: 'hit', at, hold, auto }`: the moment pinned, `at` seconds
// of the video from the clip's start, and which of the two things that set
// when the moment comes is held while the other is worked out:
//
// - `hold: 'slow'`: the slow motion is as the creator set it; the clip's
//   start moves.
// - `hold: 'start'`: the clip's start is where the creator put it; the slow
//   stretch's speed is worked out, any speed between 1/10 and normal.
//
// The thing a creator touches is the thing held: dragging the clip's start
// holds the start, picking a speed holds the slow motion. `auto` marks a slow
// stretch the pin laid itself (from the clip's start to just past the hit),
// which follows the hit when the page measures the round landing later.
//
// Pure: the creator hands in how long the clip takes to reach the moment for
// a given start or speed (replay-clipclock.js), so
// `tests/replay_sync_harness.mjs` runs it.

/** The slowest a fitted stretch plays: the strip's own slowest speed. */
export const FIT_SLOWEST = 0.1;
/** How close the moment must land to its time, seconds of the video: under
 *  a frame at 60 fps. The clip's clock is stepped at 1/120 s
 *  (replay-clipclock.js), so a kill shot's bullet time cannot be read finer. */
export const FIT_TOLERANCE = 0.01;
/** The latest a clip can start before the moment it pins, seconds of the
 *  round: a start on the hit itself leaves nothing to film. */
const LEAST_LEAD = 0.05;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A pin read back from storage or a snapshot, or null. */
export function syncOf(kept) {
  if (!kept || typeof kept !== 'object' || kept.ev !== 'hit') return null;
  if (!(Number.isFinite(kept.at) && kept.at > 0 && kept.at <= 600)) return null;
  return { ev: 'hit', at: kept.at, hold: kept.hold === 'start' ? 'start' : 'slow', auto: kept.auto === true };
}

/**
 * The first `x` in `[lo, hi]` where `f(x)` comes down to `want`, for an `f`
 * that falls as `x` grows. Bisection: the clip's clock is a stepped model,
 * smooth enough for it and not for a derivative.
 */
function solveFalling(f, lo, hi, want, iterations = 40) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    if (f(mid) > want) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/**
 * Where the clip must start for `moment` (seconds of the round) to come
 * `want` seconds into the video. `lead(t0)` is the video's seconds from a
 * start at `t0` to the moment; it falls as `t0` comes later. Nothing in a
 * clip plays faster than the round, so the start is never earlier than
 * `moment - want`.
 *
 * `{ ok, t0, got, short, over }`: `ok` when it lands within FIT_TOLERANCE.
 * Otherwise `t0` is the nearest start there is and `got` what it gives:
 * `short` seconds too few (the round does not go back far enough), or
 * `over` seconds too many (a time too soon even for the latest start,
 * `latest`: a kill shot's clip starts before its shot, or the round is
 * never fired).
 */
export function fitStart(lead, moment, want, { earliest = 0, latest = Infinity } = {}) {
  const lo = Math.max(earliest, moment - want);
  const hi = Math.min(moment - LEAST_LEAD, latest);
  if (!(hi > lo)) {
    const got = lead(Math.min(lo, hi));
    return { ok: Math.abs(got - want) <= FIT_TOLERANCE, t0: Math.min(lo, hi), got, short: Math.max(0, want - got), over: Math.max(0, got - want) };
  }
  const most = lead(lo);
  if (most < want - FIT_TOLERANCE) return { ok: false, t0: lo, got: most, short: want - most, over: 0 };
  const least = lead(hi);
  if (least > want + FIT_TOLERANCE) return { ok: false, t0: hi, got: least, short: 0, over: least - want };
  const t0 = solveFalling(lead, lo, hi, want);
  const got = lead(t0);
  return { ok: Math.abs(got - want) <= FIT_TOLERANCE, t0, got, short: 0, over: 0 };
}

/**
 * The slow stretch's speed for the moment to come `want` seconds into the
 * video, the clip's start held. `lead(speed)` is the video's seconds to the
 * moment at that speed; it falls as the speed rises.
 *
 * `{ ok, speed, got, over, short }`: `over` seconds too many even at normal
 * speed (start later), `short` too few even at FIT_SLOWEST (start earlier,
 * or slow a longer stretch).
 */
export function fitSpeed(lead, want, { slowest = FIT_SLOWEST } = {}) {
  const fastest = lead(1);
  if (fastest > want + FIT_TOLERANCE) return { ok: false, speed: 1, got: fastest, over: fastest - want, short: 0 };
  const slowestGot = lead(slowest);
  if (slowestGot < want - FIT_TOLERANCE) return { ok: false, speed: slowest, got: slowestGot, over: 0, short: want - slowestGot };
  const speed = clamp(solveFalling(lead, slowest, 1, want), slowest, 1);
  const got = lead(speed);
  return { ok: Math.abs(got - want) <= FIT_TOLERANCE, speed, got, over: 0, short: 0 };
}

/** `m:ss.s` for a time of the video. */
export function videoTime(s) {
  const v = Math.round(Math.max(0, s) * 10) / 10;
  const m = Math.floor(v / 60);
  const rest = v - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** Parses what a creator types for a time of the video: `41`, `0:41`,
 *  `0:41.5`, `1:02`. Null for anything else. */
export function parseVideoTime(text) {
  const s = String(text ?? '').trim();
  const m = /^(?:(\d{1,2}):)?(\d{1,3}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const min = m[1] ? Number(m[1]) : 0;
  const sec = Number(m[2]);
  if (m[1] && sec >= 60) return null;
  const v = min * 60 + sec;
  return v > 0 && v <= 600 ? v : null;
}

/**
 * What the pin says, in words, from the last fit (`fit`: fitStart's or
 * fitSpeed's answer with `hold`). One line for the strip and the flash.
 */
export function syncWords(pin, fit) {
  if (!pin) return '';
  const when = videoTime(pin.at);
  if (!fit) return `The hit lands at ${when}`;
  if (fit.ok) return `The hit lands at ${when}`;
  if (fit.missing) return `${when}: the clip has no hit to pin`;
  const by = v => `${v.toFixed(1)} s`;
  if (pin.hold === 'start') {
    if (fit.over > 0) return `Too long by ${by(fit.over)} even at normal speed: start the clip later`;
    return `Short by ${by(fit.short)} even at 1/10: start earlier or slow a longer stretch`;
  }
  if (fit.short > 0) return `Short by ${by(fit.short)}: the round does not go back far enough at this speed. Slow more of it`;
  return `${when} is too soon: the clip has to start before the shot. Pin a later time, or slow less of it`;
}
