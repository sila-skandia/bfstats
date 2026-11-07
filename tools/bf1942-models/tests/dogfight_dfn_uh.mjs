// The Dip, the Flip and the Ninja in the lesson "When he has the height"
// (features/dogfight-school/reviews/dfn-uh.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_uh.py` joins them:
// each of the lesson's three move demos flown from the nine nearby starts
// and scored by the shared measure, with the numbers its words quote.
// Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const UH = LESSONS.find(l => l.id === 'under-the-height');
const result = { demos: {}, survival: UH.survival ?? null };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
for (const id of ['dip', 'flip', 'ninja']) {
  const d = UH.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(UH, d);
    const s1 = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s1, at: [s1.at[0] + dx, s1.at[1], s1.at[2]], speed: s1.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? UH.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks;
    const last = Math.min(A.length, B.length) - 1;
    const i0 = Math.round((s.t0 ?? 0) / r.dt);
    // Every round of his that landed, before the move as well; the dives
    // broken before it; the range, speeds and heights where it starts; your
    // slowest in the 8 s after it; how high you climbed; who is higher at
    // the end.
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    s.hisShotAll = +(A.filter(k => k.o).length * r.dt).toFixed(2);
    s.breaks = r.events.filter(e => e.side === 1 && e.phase === 'break' && e.t <= (s.t0 ?? 0) + 1e-6).length;
    s.startRange = Math.round(dist(A[i0].p, B[i0].p));
    s.startSpeeds = [Math.round(A[i0].v), Math.round(B[i0].v)];
    let slowest = Infinity;
    for (let i = i0; i <= Math.min(last, i0 + Math.round(8 / r.dt)); i++) slowest = Math.min(slowest, B[i].v);
    s.slowest = Math.round(slowest);
    s.climbed = Math.round(Math.max(...B.map(k => k.p[1])) - B[0].p[1]);
    s.endAbove = Math.round(B[last].p[1] - A[last].p[1]);
    // When he gave the chase up, if he did.
    s.letGo = r.events.find(e => e.side === 0 && e.phase === 'let-go')?.t ?? null;
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, declared: d.verdict, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
