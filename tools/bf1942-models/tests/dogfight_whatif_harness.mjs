// WHAT IF (`viewer/dogfight-whatif.js`, features/dogfight-recordings) on a
// school lesson whose moment is known: in "out of the lock" a pilot flies
// straight with the hunter closing on his tail and is shot down. Run after
// the head of `dogfight_school_harness.mjs`, as `test_dogfight_whatif.py`
// joins them. Prints one JSON blob.
import { whatIf, chasedAt, spliceFight, WAYS_OUT, badness } from './dogfight-whatif.js';

const L = LESSONS.find(l => l.id === 'out-of-the-lock'), d = L.demos.find(x => x.id === 'without');
const r = runDuel({ makePlane, seconds: 20, groundAt: () => 0, sides: demoSides(L, d) });
const fight = { ...r, duration: r.tracks[0].at(-1).t };
const out = { chased: [0, 4, 10].map(t => chasedAt(fight, t)) };
const w = await whatIf(fight, 1, 10, { makePlanes: [makePlane, makePlane] });
out.actual = w.actual;
out.results = w.results.map(x => ({ name: x.way.name, score: x.score ?? null, error: x.error ?? null, bad: x.score ? badness(x.score) : null }));
out.ways = WAYS_OUT.length;
const best = w.results[0];
const sp = spliceFight(fight, w.i0, best.flown, best.way.name);
out.splice = {
  lengths: sp.tracks.map(t => t.length), t0: w.t, duration: sp.duration,
  // Up to the moment it is the recording, sample for sample.
  same: sp.tracks.every((tr, s) => tr.slice(0, w.i0).every((k, i) => k.p === fight.tracks[s][i].p)),
  joined: Math.hypot(...[0, 1, 2].map(k => sp.tracks[1][w.i0].p[k] - fight.tracks[1][w.i0].p[k])),
  monotonic: sp.tracks[0].every((k, i, a) => i === 0 || k.t > a[i - 1].t),
  end: sp.end, label: sp.whatIf,
};
console.log(JSON.stringify(out));
