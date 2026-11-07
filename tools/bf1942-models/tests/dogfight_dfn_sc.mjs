// The flat scissors' Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-sc.md). Run after the head of `dogfight_school_harness.mjs`
// (its imports, the Spitfire and `makePlane`), as `test_dogfight_dfn_sc.py`
// joins them. Each of the three demos is flown from the nine starts (`STARTS`)
// and scored with the shared measure. Prints one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'scissors');
const result = { survival: L.survival, demos: {} };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === id);
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    // When the ace let the Dip go, and how far back he was.
    const letGo = r.events.find(e => e.side === 0 && e.phase === 'let-go');
    // When my guns first had a landing shot, and my energy over his at the end.
    const first = r.tracks[1].find(k => k.o);
    const [A, B] = [r.tracks[0].at(-1), r.tracks[1].at(-1)];
    scores.push({ ...s, ...st, letGo: letGo ? +(letGo.t - s.t0).toFixed(1) : null,
      aceSlowest: Math.round(Math.min(...r.tracks[0].map(k => k.v))),
      firstShot: first ? +first.t.toFixed(2) : null, edgeEnd: Math.round(B.e - A.e),
      // My height over his at 4 s and at 8 s.
      dy4: Math.round(r.tracks[1][Math.round(4 / r.dt)].p[1] - r.tracks[0][Math.round(4 / r.dt)].p[1]),
      dy8: Math.round(r.tracks[1][Math.round(8 / r.dt)].p[1] - r.tracks[0][Math.round(8 / r.dt)].p[1]) });
  }
  result.demos[id] = { declared: d.verdict, kind: d.kind, seat: d.seat, ace: d.ace, seconds: d.seconds, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
