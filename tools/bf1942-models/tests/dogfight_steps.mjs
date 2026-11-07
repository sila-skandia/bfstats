// The move cards' steps (features/dogfight-school, "Move cards"). Run after
// the head of `dogfight_school_harness.mjs`, as `test_dogfight_steps.py`
// joins them: every Dip, Flip and Ninja demo flown from the theatre's start,
// and each of its steps resolved on the seat's track (`stepTimes`). Prints
// one JSON blob.
import { STEPS, MOVE_INFO, stepTimes, bestMove } from './dogfight-steps.js';

const out = { demos: {}, orphans: [], best: {}, info: Object.keys(MOVE_INFO) };
const seen = new Set();
for (const L of LESSONS) {
  out.best[L.id] = bestMove(L.demos);
  for (const d of L.demos) {
    if (!MOVE_INFO[d.kind]) continue;
    const key = `${L.id}/${d.id}`;
    seen.add(key);
    const card = STEPS[key];
    if (!card) { out.demos[key] = null; continue; }
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides: demoSides(L, d) });
    const shownTo = Math.min(r.tracks[0].at(-1).t, d.endAt ?? Infinity);
    const steps = stepTimes(r.tracks[1], card.steps, d.startAt ?? 0);
    out.demos[key] = {
      kind: d.kind, works: d.verdict?.works ?? null, why: card.why ?? null,
      from: d.startAt ?? 0, to: +shownTo.toFixed(2),
      steps: steps.map(s => ({ phase: s.phase, say: s.say, t: s.t == null ? null : +s.t.toFixed(2) })),
    };
  }
}
out.orphans = Object.keys(STEPS).filter(k => !seen.has(k));
// `stepTimes` on a made-up track: in order, from `from`, and a phase that
// never comes loses every step after it.
const track = ['a', 'a', 'b', 'a', 'c', 'b'].map((ph, i) => ({ t: i, ph }));
out.unit = {
  plain: stepTimes(track, [{ phase: 'a' }, { phase: 'b' }, { phase: 'a' }]).map(s => s.t),
  from: stepTimes(track, [{ phase: 'a' }, { phase: 'b' }], 2.5).map(s => s.t),
  lost: stepTimes(track, [{ phase: 'c' }, { phase: 'z' }, { phase: 'b' }]).map(s => s.t),
};
console.log(JSON.stringify(out));
