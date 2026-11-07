// The flat scissors' Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-sc.md). Run after the head of `dogfight_school_harness.mjs`
// (its imports, the Spitfire and `makePlane`), as `test_dogfight_dfn_sc.py`
// joins them. Each of the three demos is flown from the nine nearby starts
// and scored with the shared measure. Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'scissors');
const result = { survival: L.survival, demos: {} };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === id);
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    // When the ace let the Dip go, and how far back he was.
    const letGo = r.events.find(e => e.side === 0 && e.phase === 'let-go');
    scores.push({ ...s, dx, dv, letGo: letGo ? +(letGo.t - s.t0).toFixed(1) : null,
      aceSlowest: Math.round(Math.min(...r.tracks[0].map(k => k.v))) });
  }
  result.demos[id] = { declared: d.verdict, kind: d.kind, seat: d.seat, ace: d.ace, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
