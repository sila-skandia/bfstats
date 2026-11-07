// The Dip, the Flip and the Ninja in the boom-and-zoom lesson
// (features/dogfight-school/reviews/dfn-bz.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_bz.py` joins them:
// each of the lesson's three move demos flown from the nine L9 starts
// (`STARTS`: sideways, along, height and speed; STARTS[0] is the theatre's)
// and scored by the shared measure. Prints one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const BZ = LESSONS.find(l => l.id === 'boom-and-zoom');
const result = { demos: {}, survival: BZ.survival ?? null };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = BZ.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(BZ, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? BZ.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    // Every round of his that landed, before the move as well, and every
    // second his guns had a landing shot.
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    const [A, B] = r.tracks;
    s.hisShotAll = +(A.filter(k => k.o).length * r.dt).toFixed(2);
    s.myShotAll = +(B.filter(k => k.o).length * r.dt).toFixed(2);
    s.hitsOnHimAll = r.rounds.filter(x => x.hit && x.side === 1).length;
    // When he gave up the chase, and the closest he came once the run was
    // under way (from 10 s).
    const i = A.findIndex(k => k.ph === 'let-go');
    s.letGo = i < 0 ? null : +(A[i].t).toFixed(1);
    const closest = from => Math.round(Math.min(...A.filter(k => k.t >= from).map(k => {
      const b = B[Math.round(k.t / r.dt)];
      return Math.hypot(k.p[0] - b.p[0], k.p[1] - b.p[1], k.p[2] - b.p[2]);
    })));
    s.runMin = closest(10);
    s.runMin15 = closest(15);
    // The Ninja: when the pass from above began, and whether he was turning
    // to face it (his `meet`) while it lasted.
    const j = B.findIndex(k => k.ph === 'ninja-dive');
    s.dived = j < 0 ? null : +(B[j].t).toFixed(1);
    s.metDive = B.some((k, n) => k.ph === 'ninja-dive' && A[n]?.ph === 'meet');
    const last = Math.min(A.length, B.length) - 1;
    s.endRangeAll = Math.round(Math.hypot(...A[last].p.map((x, m) => x - B[last].p[m])));
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, seconds: d.seconds ?? BZ.seconds, ace: d.ace ?? BZ.ace.plan, declared: d.verdict, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
