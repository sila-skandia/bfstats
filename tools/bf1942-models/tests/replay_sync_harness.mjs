// The hit pinned to a time of the video (features/replay-creator-view, "The
// hit on a beat"): the start or the slow motion worked out so a clip's round
// strikes where the music wants it. One node run, one JSON report;
// `test_replay_sync.py` reads it.
//
// The numbers are skandia's Mustang bombing Onzz's Tiger on Bocage
// (`wxprh7ze6n`): the bomb leaves at 271.952 s of the round and the Tiger
// dies at 273.486 s. The creator wants the riff (slow motion) to run to the
// drums at 0:41, the tank blowing up on them.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [Y, CC, S, RC, M] = await Promise.all([imp('replay-sync.js'), imp('replay-clipclock.js'), imp('replay-shot.js'), imp('replay-roundcam.js'),
  imp('replay-music.js')]);

const round = (v, n = 3) => (v === null || v === undefined ? v : Math.round(v * 10 ** n) / 10 ** n);
const results = {};

const SHOT = 271.952;
const HIT = 273.486;
const END = HIT + 4;
const WANT = 41;
const preset = RC.BULLET_TIME.strong;
const bullet = {
  shot: SHOT, hit: HIT, kill: HIT, preset, melee: false, orbitHold: false, hull: true,
  armedSlow: RC.slowFor(150, preset, 60), flightSlow: RC.slowFor(40, preset, 60),
};
// The pin's own stretch: from the clip's start to just past the hit.
const pinStretch = speed => ({ in: null, out: HIT + S.RAMP_EASE, speed, ease: S.RAMP_EASE });
const own = (ramp, span) => (S.ramping(ramp) && S.rampSpanOf(ramp, span) ? ramp : null);
const hitAt = (span, ramp) => {
  const clock = CC.clipClock({ span, ramp: own(ramp, span), bullet });
  return clock.toScreen(HIT - 1e-6) - clock.toScreen(span.t0);
};

// The start moved under 1/4 from the clip's start to the hit.
{
  const ramp = pinStretch(0.25);
  const lead = t0 => hitAt({ t0, t1: END }, ramp);
  const fit = Y.fitStart(lead, HIT, WANT, { latest: SHOT - 0.3 });
  results.wholeRiff = { ok: fit.ok, t0: round(fit.t0, 3), landed: round(hitAt({ t0: fit.t0, t1: END }, ramp), 4) };
}

// The slow motion kicking in 3 s before the hit, the start moved for it: the
// part before runs at normal speed.
{
  const ramp = { in: HIT - 3, out: HIT + S.RAMP_EASE, speed: 0.25, ease: S.RAMP_EASE };
  const lead = t0 => hitAt({ t0, t1: END }, ramp);
  const fit = Y.fitStart(lead, HIT, WANT, { latest: SHOT - 0.3 });
  const slowPart = hitAt({ t0: HIT - 3, t1: END }, ramp);
  results.lateSlow = { ok: fit.ok, t0: round(fit.t0, 3), landed: round(hitAt({ t0: fit.t0, t1: END }, ramp), 4), slowPart: round(slowPart, 3) };
}

// No slow motion of its own: the kill shot's bullet time, the start moved.
{
  const lead = t0 => hitAt({ t0, t1: END }, null);
  const fit = Y.fitStart(lead, HIT, WANT, { latest: SHOT - 0.3 });
  results.bulletTime = { ok: fit.ok, landed: round(hitAt({ t0: fit.t0, t1: END }, null), 4), lead: round(HIT - fit.t0, 2) };
}

// The round does not go back far enough: a recording that starts 5 s before.
{
  const ramp = pinStretch(0.25);
  const fit = Y.fitStart(t0 => hitAt({ t0, t1: END }, ramp), HIT, WANT, { earliest: HIT - 5, latest: SHOT - 0.3 });
  results.tooShort = { ok: fit.ok, short: round(fit.short, 2), t0: round(fit.t0, 3) };
}

// A time too soon: the clip would have to start after the shot.
{
  const ramp = pinStretch(0.25);
  const fit = Y.fitStart(t0 => hitAt({ t0, t1: END }, ramp), HIT, 2, { latest: SHOT - 0.3 });
  results.tooSoon = { ok: fit.ok, over: round(fit.over, 2), t0: round(fit.t0, 3) };
}

// The start held at 263 s; the stretch's speed worked out.
{
  const span = { t0: 263, t1: END };
  const lead = speed => hitAt(span, pinStretch(Math.min(speed, 0.9999)));
  const fit = Y.fitSpeed(lead, WANT);
  results.speed = { ok: fit.ok, speed: round(fit.speed, 4), landed: round(hitAt(span, pinStretch(fit.speed)), 4), word: S.speedWord(fit.speed) };
}

// Held too early: even at normal speed the hit comes after 0:41.
{
  const span = { t0: 200, t1: END };
  const fit = Y.fitSpeed(speed => hitAt(span, pinStretch(Math.min(speed, 0.9999))), WANT);
  results.speedTooLong = { ok: fit.ok, over: round(fit.over, 2), speed: fit.speed };
}

// Held too late: even at a tenth the hit comes before 0:41.
{
  const span = { t0: 271.5, t1: END };
  const fit = Y.fitSpeed(speed => hitAt(span, pinStretch(Math.min(speed, 0.9999))), WANT);
  results.speedTooShort = { ok: fit.ok, short: round(fit.short, 2), speed: fit.speed };
}

results.syncOf = [
  Y.syncOf({ ev: 'hit', at: 41, hold: 'start', auto: true }),
  Y.syncOf({ ev: 'hit', at: 41, hold: 'nonsense' }),
  Y.syncOf({ ev: 'shot', at: 41 }),
  Y.syncOf({ ev: 'hit', at: -1 }),
  Y.syncOf(null),
];
results.parse = ['41', '0:41', '0:41.5', '1:02', ' 41.25 ', '0:75', 'abc', '0', '', '12:00'].map(Y.parseVideoTime);
results.videoTime = [41, 41.04, 9.96, 62.5, 0].map(Y.videoTime);
const pin = { ev: 'hit', at: 41, hold: 'slow', auto: true };
results.words = {
  ok: Y.syncWords(pin, { ok: true }),
  short: Y.syncWords(pin, { ok: false, short: 3.21, over: 0 }),
  soon: Y.syncWords(pin, { ok: false, short: 0, over: 1 }),
  missing: Y.syncWords(pin, { ok: false, missing: true }),
  long: Y.syncWords({ ...pin, hold: 'start' }, { ok: false, over: 32.5, short: 0 }),
  slowest: Y.syncWords({ ...pin, hold: 'start' }, { ok: false, over: 0, short: 12.3 }),
};
results.speedWords = [1, 0.5, 0.25, 0.1, 0.27, 0.333, 0.2412].map(S.speedWord);
results.rampOf = {
  fitted: S.rampOf({ in: 1, out: 2, speed: 0.2712, ease: 0.35, fit: true }),
  picked: S.rampOf({ in: 1, out: 2, speed: 0.2712, ease: 0.35 }),
  tooSlow: S.rampOf({ in: 1, out: 2, speed: 0.05, ease: 0.35, fit: true }),
};

// The song under the clip (replay-music.js): where it is for a time of the
// video, and what it does each frame.
{
  const base = { playing: true, video: 10, prevT: 100, t: 100.016, paused: false, offset: 0, duration: 200 };
  results.song = {
    positions: [[-1, 0], [0, 0], [41, 0], [41, 12.5], [190, 20]].map(([v, o]) => M.songPosition(v, o, 200)),
    keep: M.songAction(base),
    start: M.songAction({ ...base, paused: true }),
    paused: M.songAction({ ...base, playing: false }),
    beforeClip: M.songAction({ ...base, video: -0.5 }),
    looped: M.songAction({ ...base, t: 90, video: 0 }),
    scrubbed: M.songAction({ ...base, t: 103, video: 14 }),
    pastSong: M.songAction({ ...base, video: 250 }),
  };
}

console.log(JSON.stringify(results));
