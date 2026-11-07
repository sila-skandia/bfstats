// FLY IT practising a Dip, Flip or Ninja (features/dogfight-school, "Fly a
// move yourself"). Run after the head of `dogfight_school_harness.mjs`, as
// `test_dogfight_fly_moves.py` joins them (the head brings coach). Prints one JSON blob.
import { flightOf, MOVES } from './dogfight-lessons.js';

// In a block: the head's own names (`st`, `out`) stay out of the way.
{
const out = { lessons: {}, coach: {} };
for (const L of LESSONS) {
  if (!L.demos.length) continue;
  const f = flightOf(L);
  const row = { default: { ace: f.ace.plan, guide: f.guide, known: !!PLANS[f.ace.plan] && !!PLANS[f.guide] }, moves: {} };
  for (const d of L.demos.filter(x => MOVES.includes(x.kind))) {
    const m = flightOf(L, d.id);
    const [ace, you] = demoSides(L, d);
    row.moves[d.id] = {
      move: m.move, kind: d.kind, guide: m.guide, seat: d.seat, ace: m.ace.plan, measuredAce: ace.plan,
      sameStarts: JSON.stringify(m.ace.start) === JSON.stringify(ace.start) && JSON.stringify(m.you.start) === JSON.stringify(you.start),
      sameMemory: JSON.stringify(m.ace.memory ?? null) === JSON.stringify(ace.memory ?? null),
    };
  }
  // A tab that is not a move flies the lesson.
  const other = L.demos.find(x => !MOVES.includes(x.kind));
  row.otherTab = other ? flightOf(L, other.id).move : null;
  out.lessons[L.id] = row;
}

// The coach, practising the Dip with him on your tail, high and fast: the
// move first; at 30 m over the ground, the ground first.
const L = LESSONS.find(l => l.id === 'break-turn');
const st = (p, v, q = { x: 0, y: 0, z: 0, w: 1 }) => ({ position: p, velocity: v, orientation: q, angularVelocity: [0, 0, 0] });
const you = st([0, 600, 0], [0, 0, -70]), him = st([0, 600, 150], [0, 0, -75]);
const move = { name: 'THE DIP', say: 'He is in front, going the other way: running for it', phase: 'dip-run' };
const high = coach(L, { phase: 'chase' }, you, him, { ground: 0, move });
const low = coach(L, { phase: 'chase' }, st([0, 30, 0], [0, -5, -70]), st([0, 30, 150], [0, -5, -75]), { ground: 0, move });
const none = coach(L, { phase: 'chase' }, you, him, { ground: 0 });
out.coach = { high: { line: high.line, tip: high.tip, tone: high.tone }, low: low.line, none: none.line };
console.log(JSON.stringify(out));
}
