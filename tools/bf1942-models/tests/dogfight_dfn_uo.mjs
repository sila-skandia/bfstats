// The Dip, the Flip and the Ninja in the up-and-over lesson
// (features/dogfight-school/reviews/dfn-uo.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_uo.py` joins them:
// each of the lesson's three move demos flown from the nine starts (`STARTS`)
// and scored by the shared measure, with what the words quote beside it.
// Prints one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const UO = LESSONS.find(l => l.id === 'up-and-over');
const result = { demos: {}, survival: UO.survival ?? null };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = UO.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const [i, st] of STARTS.entries()) {
    const sides = demoSides(UO, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? UO.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    s.start = i; Object.assign(s, st);
    // Every round of his that landed, before the move as well; mine; and
    // when he started his pull, and the phases each side flew.
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    s.myHits = r.hits[1];
    s.pullAt = r.events.find(e => e.side === 0 && e.phase === 'pull')?.t ?? null;
    s.acePhases = [...new Set(r.events.filter(e => e.side === 0).map(e => e.phase))];
    s.myPhases = [...new Set(r.events.filter(e => e.side === 1).map(e => e.phase))];
    // His first pounce; when he went down, if he did; and my attacks, each
    // the start of a landing shot a second or more after the last.
    s.pounceAt = r.events.find(e => e.side === 0 && e.phase === 'pounce')?.t ?? null;
    s.killT = r.end?.why === 'shot down' && r.end.winner === 1 ? r.end.t : null;
    s.attackAt = [];
    let last = -Infinity;
    for (const k of r.tracks[1]) if (k.o) { if (k.t - last > 1) s.attackAt.push(+k.t.toFixed(2)); last = k.t; }
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, declared: d.verdict, measured: verdictOf(scores), seconds: d.seconds ?? UO.seconds, scores };
}
console.log(JSON.stringify(result));
