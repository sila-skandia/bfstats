// Out of his lock's Dip, Flip and Ninja (features/dogfight-school,
// reviews/dfn-ol.md), flown from the nine nearby starts and scored by the
// shared measure. Runs after the head of `dogfight_school_harness.mjs`.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const L = LESSONS.find(l => l.id === 'out-of-the-lock');
const out = { survival: L.survival, demos: {} };
for (const kind of ['dip', 'flip', 'ninja']) {
  const d = L.demos.find(x => x.id === kind);
  const scores = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    const s = sides[1].start;
    sides[1] = { ...sides[1], start: { ...s, at: [s.at[0] + dx, s.at[1], s.at[2]], speed: s.speed + dv } };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    scores.push({ ...scoreMove(r, kind, 1), hits: r.hits, phases: [...new Set(r.tracks[1].map(k => k.ph))],
                  gaveUpAt: r.tracks[0].find(k => k.ph === 'let-go')?.t ?? null });
  }
  out.demos[kind] = { claimed: d.verdict, ace: d.ace, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(out));
