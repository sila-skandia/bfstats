// Out of his lock's Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-ol.md), flown from the nine starts (`STARTS`: sideways, along,
// height and speed; STARTS[0] is the theatre's) and scored by the shared
// measure. Runs after the head of `dogfight_school_harness.mjs`.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'out-of-the-lock');
const out = { survival: L.survival, demos: {} };
const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
for (const kind of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === kind);
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const [A, Y] = r.tracks;
    // His landing shot (held or fired), and my first burst: when, how far,
    // how fast he was.
    const his = A.map((k, i) => ({ k, i })).filter(x => x.k.o);
    const mine = Y.findIndex(k => k.o);
    const last = Y.length - 1;
    scores.push({ ...scoreMove(r, kind, 1), hits: r.hits, phases: [...new Set(Y.map(k => k.ph))],
                  gaveUpAt: A.find(k => k.ph === 'let-go')?.t ?? null,
                  hisShotFrom: his.length ? +his[0].k.t.toFixed(1) : null, hisShotTo: his.length ? +his[his.length - 1].k.t.toFixed(1) : null,
                  hisShotRange: his.length ? [Math.round(Math.min(...his.map(x => dist(x.k, Y[x.i])))), Math.round(Math.max(...his.map(x => dist(x.k, Y[x.i]))))] : null,
                  hisFired: A.some(k => k.f),
                  burstHisSpeed: mine < 0 ? null : Math.round(A[mine].v), burstAt: mine < 0 ? null : +Y[mine].t.toFixed(1),
                  endHigh: Math.round(Y[last].p[1] - A[last].p[1]) });
  }
  out.demos[kind] = { claimed: d.verdict, ace: d.ace, seconds: d.seconds ?? L.seconds, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(out));
