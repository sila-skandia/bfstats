// The Immelmann and the split-S's Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-ta.md). Run after the head of `dogfight_school_harness.mjs`
// (its imports, the Spitfire and `makePlane`), as `test_dogfight_dfn_ta.py`
// joins them. Each of the three demos is flown from the shared nine starts
// (`STARTS`, an L9 over sideways, along, height and speed) and scored with
// the shared measure, with what the ace did. A demo may be scored longer than
// it is shown: it flies and is scored over `seconds`, and the theatre stops at
// `endAt`. Prints one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'turnarounds');
const range = (r, i) => Math.hypot(...r.tracks[0][i].p.map((v, j) => v - r.tracks[1][i].p[j]));
const result = { survival: L.survival, demos: {} };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === id);
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks;
    const at = ph => { const i = A.findIndex(k => k.ph === ph); return i < 0 ? null : i; };
    const iImm = at('immelmann'), iSplit = at('split'), iChase = at('chase'), iHome = at('let-go');
    scores.push({ ...s, ...st,
      immelmannAt: iImm === null ? null : +A[iImm].t.toFixed(1), splitAt: iSplit === null ? null : +A[iSplit].t.toFixed(1),
      chaseAt: iChase === null ? null : +A[iChase].t.toFixed(1), chaseRange: iChase === null ? null : Math.round(range(r, iChase)),
      homeAt: iHome === null ? null : +A[iHome].t.toFixed(1), homeRange: iHome === null ? null : Math.round(range(r, iHome)),
      topRange: at('rollout') === null ? null : Math.round(range(r, at('rollout'))),
      aceSlowest: Math.round(Math.min(...A.map(k => k.v))),
      evaded: A.some(k => k.ph === 'evade'),
      // The Ninja: when he went down, and how far over him you stayed
      // until then (metres, negative is below him).
      killAt: r.end?.why === 'shot down' && r.end.winner === 1 ? +r.end.t.toFixed(1) : null,
      minAboveBeforeKill: Math.round(Math.min(...B.filter(k => !r.end || k.t <= r.end.t).map((k, i) => k.p[1] - A[i].p[1]))),
      // The Flip: whether you sat under his tail unseen, and how fast you
      // were when you got there.
      unseenOnTail: B.some((k, i) => String(k.ph).startsWith('flip-climb') && A[i].sees === 0),
      speedAtFlip: s.flipAt === null ? null : Math.round(B[Math.round(s.flipAt / r.dt)].v) });
  }
  result.demos[id] = { declared: d.verdict, kind: d.kind, seat: d.seat, ace: d.ace, seconds: d.seconds ?? L.seconds, endAt: d.endAt ?? null, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
