// The Immelmann and the split-S's Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-ta.md). Run after the head of `dogfight_school_harness.mjs`
// (its imports, the Spitfire and `makePlane`), as `test_dogfight_dfn_ta.py`
// joins them. Each of the three demos is flown from the nine nearby starts
// and scored with the shared measure, with what the ace did. Prints one JSON
// blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'turnarounds');
const range = (r, i) => Math.hypot(...r.tracks[0][i].p.map((v, j) => v - r.tracks[1][i].p[j]));
const result = { survival: L.survival, demos: {} };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === id);
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A] = r.tracks;
    const at = ph => { const i = A.findIndex(k => k.ph === ph); return i < 0 ? null : i; };
    const iImm = at('immelmann'), iSplit = at('split'), iChase = at('chase'), iHome = at('let-go');
    scores.push({ ...s, dx, dv,
      immelmannAt: iImm === null ? null : +A[iImm].t.toFixed(1), splitAt: iSplit === null ? null : +A[iSplit].t.toFixed(1),
      chaseAt: iChase === null ? null : +A[iChase].t.toFixed(1), chaseRange: iChase === null ? null : Math.round(range(r, iChase)),
      homeAt: iHome === null ? null : +A[iHome].t.toFixed(1), homeRange: iHome === null ? null : Math.round(range(r, iHome)),
      aceSlowest: Math.round(Math.min(...A.map(k => k.v))),
      evaded: A.some(k => k.ph === 'evade') });
  }
  result.demos[id] = { declared: d.verdict, kind: d.kind, seat: d.seat, ace: d.ace, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
