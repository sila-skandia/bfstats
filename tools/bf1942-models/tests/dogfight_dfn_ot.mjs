// On his tail's Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-ot.md). Run after the head of `dogfight_school_harness.mjs`
// (its imports, the Spitfire and `makePlane`), as `test_dogfight_dfn_ot.py`
// joins them. Each of the three demos is flown from the nine nearby starts
// and scored with the shared measure, with what the Dip's chase did and
// whether the yo-yo really dived. Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'on-his-tail');
const range = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
const result = { survival: L.survival, ace: L.ace.plan, demos: {} };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === id);
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks;
    const brk = A.find(k => k.ph === 'break');
    // The Dip: when he turned after you, how close he came while he chased,
    // and when he let you go.
    const i0 = s.t0 === null ? 0 : Math.round(s.t0 / r.dt);
    const iChase = A.findIndex((k, i) => i >= i0 && (k.ph === 'reverse' || k.ph === 'chase'));
    const iLet = A.findIndex((k, i) => i >= i0 && k.ph === 'letgo');
    let chaseMin = null;
    if (iChase >= 0) { chaseMin = Infinity; for (let i = iChase; i < (iLet >= 0 ? iLet : A.length); i++) chaseMin = Math.min(chaseMin, range(A[i], B[i])); chaseMin = Math.round(chaseMin); }
    scores.push({ ...s, dx, dv, breakAt: brk ? +brk.t.toFixed(1) : null,
      chaseAt: iChase >= 0 ? +A[iChase].t.toFixed(1) : null, chaseMin,
      letGoAt: iLet >= 0 ? +A[iLet].t.toFixed(1) : null,
      dives: r.events.filter(e => e.side === 1 && e.phase === 'flip-dive').length });
  }
  result.demos[id] = { declared: d.verdict, kind: d.kind, seat: d.seat, ace: d.ace, seconds: d.seconds, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
