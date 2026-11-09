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
const [Y, CC, S, RC, M, THREE, CU] = await Promise.all([imp('replay-sync.js'), imp('replay-clipclock.js'), imp('replay-shot.js'), imp('replay-roundcam.js'),
  imp('replay-music.js'), imp('vendor/three.module.js'), imp('replay-cuts.js')]);

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

// The start trimmed to 4.5 s before the hit, the slow motion kicking in 1.5 s
// before it: that stretch cannot fill 41 s even at the slowest, so it is
// grown back to the clip's start and the speed worked out over all of it.
{
  const span = { t0: HIT - 4.5, t1: END };
  const late = { in: HIT - 1.5, out: HIT + S.RAMP_EASE, speed: 0.25, ease: S.RAMP_EASE };
  const lead = (ramp, speed) => hitAt(span, { ...ramp, speed: Math.min(speed, 0.9999) });
  const alone = Y.fitSpeed(speed => lead(late, speed), WANT);
  const fit = Y.fitSpeedOver(lead, [late, { ...late, in: null }], WANT);
  results.trimmed = {
    alone: { ok: alone.ok, short: round(alone.short, 2) },
    ok: fit.ok, grown: fit.grown, in: fit.stretch.in, speed: round(fit.speed, 4),
    landed: round(hitAt(span, { ...fit.stretch, speed: fit.speed }), 4),
  };
  // Too long even at normal speed: a longer stretch does not help, and the
  // stretch as set is the answer.
  const far = { t0: 200, t1: END };
  const over = Y.fitSpeedOver((ramp, speed) => hitAt(far, { ...ramp, speed: Math.min(speed, 0.9999) }), [late, { ...late, in: null }], WANT);
  results.trimmedOver = { ok: over.ok, grown: over.grown, over: round(over.over, 2) };
}

// Held too late: even at a twentieth from the clip's start the hit comes
// before 0:41.
{
  const span = { t0: 272.0, t1: END };
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
results.speedWords = [1, 0.5, 0.25, 0.1, 0.27, 0.333, 0.2412, 0.05].map(S.speedWord);
results.rampOf = {
  fitted: S.rampOf({ in: 1, out: 2, speed: 0.2712, ease: 0.35, fit: true }),
  picked: S.rampOf({ in: 1, out: 2, speed: 0.2712, ease: 0.35 }),
  twentieth: S.rampOf({ in: 1, out: 2, speed: 0.05, ease: 0.35, fit: true }),
  tooSlow: S.rampOf({ in: 1, out: 2, speed: 0.04, ease: 0.35, fit: true }),
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
    // The song where it is (`at`) against where the clip's clock says.
    inStep: M.songAction({ ...base, at: 10 }),
    behind: M.songAction({ ...base, at: 9.97 }),
    ahead: M.songAction({ ...base, at: 10.03 }),
    farBehind: M.songAction({ ...base, at: 9.6 }),
    frozen: M.songAction({ ...base, at: 9.5, frozen: true }),
    rates: [-1, -0.05, 0, 0.02, 0.05, 1].map(M.songRate),
  };
  // The waveform: a quiet second and a loud one, at 1 kHz, 50 peaks a second.
  const n = 2000;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = (i < 1000 ? 0.1 : 0.8) * Math.sin(i / 3);
  const peaks = M.songPeaks([ch, ch.map(v => v / 2)], 1000, 50);
  results.wave = {
    length: peaks.length, quiet: round(peaks[10], 2), loud: round(peaks[60], 2),
    between: [round(M.peakBetween(peaks, 0.5, 0.9), 2), round(M.peakBetween(peaks, 0.9, 1.1), 2), M.peakBetween(peaks, 5, 6)],
    slid: [M.slidOffset(10, 2, 200), M.slidOffset(10, -2, 200), M.slidOffset(1, 5, 200), M.slidOffset(10, -500, 200)],
  };
}

// The camera waiting on a shooter in a hull (replay-roundcam.js `waitingDir`):
// the hull's heading until 2.5 s before the shot, eased onto the line of
// fire as the shot comes. The Mustang flies +X; the bomb leaves along -Z.
{
  const shot = new THREE.Vector3(0, 0, -1);
  const heading = new THREE.Vector3(1, 0, 0);
  const at = t => { const v = RC.waitingDir(shot, heading, t, 100, new THREE.Vector3()); return [round(v.x), round(v.y), round(v.z)]; };
  results.waiting = {
    early: at(80), setup: at(97.5), half: at(98.75), shot: at(100), after: at(101),
    still: (() => { const v = RC.waitingDir(shot, null, 80, 100, new THREE.Vector3()); return [v.x, v.y, v.z]; })(),
  };
}

// A dropped bomb is steered onto its death (replay-roundcam.js `landingOf`):
// released as recorded (no `fireAt`), landing at the kill line.
results.bombLanding = {
  mustang: RC.landingOf({ t: SHOT, weapon: 'MustangBombDummy' }, { t: HIT }, 0),
  tooQuick: RC.landingOf({ t: 10, weapon: 'MustangBombDummy' }, { t: 10.1 }, 0),
  tooLong: RC.landingOf({ t: 10, weapon: 'MustangBombDummy' }, { t: 19 }, 0),
  serverFlown: RC.landingOf({ t: SHOT, weapon: 'MustangBombDummy', flight: { drawn: true } }, { t: HIT }, 0),
};

// More than one stretch of slow motion (replay-shot.js `more`): the pin's
// own to the hit, and the victim's circle slowed on its own after it.
{
  const span = { t0: 263, t1: 285 };
  const ramp = S.rampOf({ in: null, out: HIT + 0.35, speed: 0.25, ease: 0.35, more: [{ in: 276, out: 279, speed: 0.1 }, { in: 1, out: 0, speed: 0.25 }, { in: 280, out: 281, speed: 0.3 }] });
  const plain = S.rampOf({ in: null, out: HIT + 0.35, speed: 0.25, ease: 0.35 });
  const clock = CC.clipClock({ span, ramp });
  const before = CC.clipClock({ span, ramp: plain });
  results.more = {
    kept: ramp.more,
    stretches: S.slowStretches(ramp, span).map(x => [x.t0, x.t1, x.speed, x.k]),
    speeds: [270, 277.5, 279.5].map(t => round(S.rampSpeedAt(ramp, span, t), 3)),
    hitSame: round(clock.toScreen(HIT - 1e-6) - before.toScreen(HIT - 1e-6), 4),
    circle: [round(clock.toScreen(279) - clock.toScreen(276), 2), round(before.toScreen(279) - before.toScreen(276), 2)],
    onlyMore: S.slowsClip({ in: null, out: null, speed: 1, more: [{ in: 276, out: 279, speed: 0.25 }] }, span),
    none: S.slowsClip({ in: null, out: null, speed: 1 }, span),
    // Overlapping: the circle at 1/10 inside a stretch at 1/4.
    overlap: round(S.rampSpeedAt(S.rampOf({ in: 270, out: 280, speed: 0.25, ease: 0.35, more: [{ in: 276, out: 279, speed: 0.1 }] }), span, 277.5), 3),
    slower: [1, 0.5, 0.25, 0.1, 0.3].map(S.slowerThan),
  };
}

// A cut after the victim's circle is kept by his going down too
// (replay-cuts.js `anchorAfter`), so slow motion that moves that moment
// cannot slide the cut in front of the circle.
{
  const ev = { start: 263, end: 285, shot: 272, hit: 273.5, down: 276 };
  const cams = [{ cam: 'shoulder' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'glide' }];
  const added = CU.insertCam(cams, 279, 'gamefront', ev);
  const later = { ...ev, down: 280 };
  const brief = list => CU.resolveCams(list, later).map(c => [c.cam, round(c.t0, 2)]);
  const old = [...cams, { cam: 'gamefront', at: { ev: 'hit', dt: 279 - 273.5 }, into: 'glide' }];
  results.cutAfterCircle = {
    at: added[3].at, keptAfter: brief(added), oldWay: brief(old),
    beforeDown: CU.anchorAfter(275, ev, cams[1]), afterChase: CU.anchorAfter(275, ev, cams[2]),
  };
}

console.log(JSON.stringify(results));
