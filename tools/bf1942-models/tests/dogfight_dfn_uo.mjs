// The Dip, the Flip and the Ninja in the up-and-over lesson
// (features/dogfight-school/reviews/dfn-uo.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_uo.py` joins them:
// each of the lesson's three move demos flown from the nine nearby starts
// and scored by the shared measure, with what the words quote beside it.
// Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const UO = LESSONS.find(l => l.id === 'up-and-over');
const result = { demos: {}, survival: UO.survival ?? null };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = UO.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(UO, d);
    const s1 = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s1, at: [s1.at[0] + dx, s1.at[1], s1.at[2]], speed: s1.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? UO.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    s.dx = dx; s.dv = dv;
    // Every round of his that landed, before the move as well; mine; and
    // when he started his pull, and the phases each side flew.
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    s.myHits = r.hits[1];
    s.pullAt = r.events.find(e => e.side === 0 && e.phase === 'pull')?.t ?? null;
    s.acePhases = [...new Set(r.events.filter(e => e.side === 0).map(e => e.phase))];
    s.myPhases = [...new Set(r.events.filter(e => e.side === 1).map(e => e.phase))];
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, declared: d.verdict, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
