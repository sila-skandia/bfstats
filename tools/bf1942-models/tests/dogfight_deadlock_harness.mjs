// Deadlocks and the scene extended from one (`viewer/dogfight-deadlock.js`,
// features/dogfight-school "Extend the scene"). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_deadlock.py` joins them.
// Prints one JSON blob.
import { deadlockSpans, deadlockIn, deadlockAt, createDeadlockWatch, momentOf, extendFrom, scoreBreak, rankOf, resultWords, WAYS, DEADLOCK } from './dogfight-deadlock.js';
import { spliceFight } from './dogfight-whatif.js';

const out = { ways: WAYS.map(w => w.id), rules: DEADLOCK };
const flyDemo = (lessonId, demoId, seconds = null) => {
  const L = LESSONS.find(l => l.id === lessonId), d = demoById(L, demoId);
  const r = runDuel({ makePlane, seconds: seconds ?? d.seconds ?? L.seconds, groundAt: () => 0, sides: demoSides(L, d) });
  return { L, d, fight: { ...r, duration: r.tracks[0].at(-1).t } };
};

// The deadlock itself: the circle lesson's first tab, 30 s of the circle.
{
  const { fight } = flyDemo('the-circle', 'circle');
  out.circle = { spans: deadlockSpans(fight), at12: deadlockAt(fight.tracks, Math.round(12 / fight.dt)), duration: fight.duration };
  // The live watch, fed the same fight a sample at a time, every other tick.
  const watch = createDeadlockWatch();
  let state = null, firstAt = null;
  for (let i = 0; i < fight.tracks[0].length; i += 2) {
    const [a, y] = fight.tracks.map(tr => tr[i]);
    state = watch.push({ t: a.t, ace: { p: a.p, q: a.q, o: a.o }, you: { p: y.p, q: y.q, o: y.o } });
    if (state && firstAt === null) firstAt = a.t;
  }
  out.circle.watch = { state, firstAt };
}
// No deadlock where one pilot holds the shot: the hunter on a pilot flying
// straight (shot down at about 13 s).
{
  const { fight } = flyDemo('out-of-the-lock', 'without', 20);
  out.straight = { spans: deadlockSpans(fight), end: fight.end };
}
// The circle lesson's own extension (eight seconds of the circle, then out)
// also reads as a deadlock before the move, and not once they are apart.
{
  const { fight } = flyDemo('the-circle', 'dip');
  out.leave = { spans: deadlockSpans(fight), in10: !!deadlockIn(deadlockSpans(fight), 10), in35: !!deadlockIn(deadlockSpans(fight), 35) };
}
// The scene extended from the circle at 12 s: every way out flown from the
// exact moment against the hunter as he stands.
{
  const { L, d, fight } = flyDemo('the-circle', 'circle');
  const t = 12;
  const sides = demoSides(L, d);
  const m = momentOf(sides, t, { makePlane, groundAt: () => 0 });
  const k = fight.tracks[1][m.i0];
  const joined = Math.hypot(...[0, 1, 2].map(j => m.states[1].position[j] - k.p[j]));
  const w = await extendFrom(fight, 1, m.i0, {
    states: m.states, mems: m.mems, throttles: m.throttles, makePlanes: [makePlane, makePlane],
    opponent: { plan: sides[0].plan, memory: m.mems[0], skill: sides[0].skill }, groundAt: () => 0,
  });
  const ranks = w.results.map(r => rankOf(r.score));
  out.extend = {
    t: w.t, i0: w.i0, turn: w.turn, joined, actual: { ...w.actual, words: resultWords(w.actual) },
    results: w.results.map(r => ({ id: r.way.id, kind: r.way.kind, error: r.error ?? null, score: r.score ?? null, words: r.score ? resultWords(r.score) : null,
      phases: r.flown ? [...new Set(r.flown.tracks[1].map(x => x.ph))] : null, acePhases: r.flown ? [...new Set(r.flown.tracks[0].map(x => x.ph))] : null })),
    sorted: ranks.every((v, i) => i === 0 || v >= ranks[i - 1]),
  };
  const best = w.results.find(r => r.flown);
  const sp = spliceFight(fight, w.i0, best.flown, best.way.name);
  out.extend.splice = {
    same: sp.tracks.every((tr, s) => tr.slice(0, w.i0).every((x, i) => x.p === fight.tracks[s][i].p)),
    joined: Math.hypot(...[0, 1, 2].map(j => sp.tracks[1][w.i0].p[j] - fight.tracks[1][w.i0].p[j])),
    duration: sp.duration, t0: w.t, monotonic: sp.tracks[0].every((x, i, a) => i === 0 || x.t > a[i - 1].t),
  };
  // Words for every result kind the scorer can say.
  out.words = Object.fromEntries(['six', 'shot', 'clear', 'neutral', 'locked', 'hit', 'down', 'ground'].map(result =>
    [result, resultWords({ result, at: 3.4, killed: false, theyCrashed: false, myShot: 1.2, hisShot: 0.7, hits: 2, hitsOn: 0, endRange: 1240, near: 60, far: 180, seconds: 30 })]));
  out.scoreOfActual = scoreBreak(fight, 1, m.i0);
}
console.log(JSON.stringify(out));
