// The Dip, the Flip and the Ninja in the boom-and-zoom lesson
// (features/dogfight-school/reviews/dfn-bz.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_bz.py` joins them:
// each of the lesson's three move demos flown from the nine nearby starts
// and scored by the shared measure. Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const BZ = LESSONS.find(l => l.id === 'boom-and-zoom');
const result = { demos: {}, survival: BZ.survival ?? null };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = BZ.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(BZ, d);
    const s1 = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s1, at: [s1.at[0] + dx, s1.at[1], s1.at[2]], speed: s1.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? BZ.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    // Every round of his that landed, before the move as well.
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    // When he gave up the chase, and the closest he came once the run was
    // under way (from 10 s).
    const [A, B] = r.tracks;
    const i = A.findIndex(k => k.ph === 'let-go');
    s.letGo = i < 0 ? null : +(A[i].t).toFixed(1);
    s.runMin = Math.round(Math.min(...A.filter(k => k.t >= 10).map(k => {
      const b = B[Math.round(k.t / r.dt)];
      return Math.hypot(k.p[0] - b.p[0], k.p[1] - b.p[1], k.p[2] - b.p[2]);
    })));
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, declared: d.verdict, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
