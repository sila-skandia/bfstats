// The ascendancy bench (features/dogfight-school/reviews/ascend.md). Run
// after the head of `dogfight_school_harness.mjs` (its imports, the Spitfire
// and `makePlane`), as `test_dogfight_ascend.py` joins them. `ascend` flies
// seat 1 from two starts with the advantage, against every lesson's ace as
// the demos fly it, from the nine nearby starts the shape tests use (its own
// x -30/0/+30 m, speed -3/0/+3 m/s), 50 s, scored as a Ninja by the shared
// measure. Prints one JSON blob.
import { scoreMove, verdictOf } from './dogfight_dfn_measure.mjs';

const SECONDS = 50;
// The ace in seat 0, flying straight and level at 55 m/s, 320 m up.
const ACE_START = { at: [0, 320, 0], headingDeg: 0, speed: 55 };
// Two starts with the advantage: 300 m behind him and 150 m over him, 10 m/s
// faster; and 200 m over him, 300 m out on his beam, as fast.
const STARTS = {
  astern: { at: [0, 470, 300], headingDeg: 0, speed: 65 },
  abeam: { at: [300, 520, 0], headingDeg: 0, speed: 65 },
};
// The lessons' aces, each with its lesson's memory (less any phase, so each
// starts its plan from the top).
const memOf = id => {
  const m = { ...(LESSONS.find(l => l.id === id).ace.memory ?? {}) };
  delete m.phase;
  return m;
};
const ACES = [
  ['otBreaker', {}], ['btHunter', {}], ['scAce', {}], ['taAce', {}], ['uoAce', {}],
  ['bzAce', memOf('boom-and-zoom')], ['uhAce', memOf('under-the-height')], ['olHunter', {}],
  ['breakTurn', {}], ['breaker', {}],
];

const span = xs => [Math.min(...xs), Math.max(...xs)];
const result = { plan: 'ascend', seconds: SECONDS, rows: [] };
for (const [startName, s] of Object.entries(STARTS)) {
  for (const [plan, memory] of ACES) {
    const scores = [];
    for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
      const sides = [
        { plan, start: ACE_START, memory, skill: 1 },
        { plan: 'ascend', start: { ...s, at: [s.at[0] + dx, s.at[1], s.at[2]], speed: s.speed + dv }, skill: 0.85 },
      ];
      const r = runDuel({ makePlane, seconds: SECONDS, groundAt: () => 0, sides });
      const sc = scoreMove(r, 'ninja', 1);
      const first = r.tracks[1].find(k => k.o);
      scores.push({ ...sc, dx, dv, firstShot: first ? +first.t.toFixed(2) : null,
        killed: r.end?.why === 'shot down' && r.end.winner === 1,
        dives: r.events.filter(e => e.side === 1 && e.phase === 'dive').length });
    }
    const col = k => scores.map(x => x[k]);
    const shots = col('firstShot').filter(t => t !== null);
    result.rows.push({
      start: startName, ace: plan, ...verdictOf(scores),
      attacks: span(col('attacks')), myShot: span(col('myShot')), hitsOnHim: span(col('hitsOnHim')),
      sixLost: Math.max(...col('sixLost')), held: Math.min(...col('held')), hisShot: Math.max(...col('hisShot')),
      hitsOnMe: Math.max(...col('hitsOnMe')), minRange: Math.min(...col('minRange')),
      idle: Math.max(...col('idle')), stalemate: scores.filter(x => !x.killed && x.idle > 20).length,
      shotDown: scores.filter(x => x.winner === 0 && x.end === 'shot down').length,
      firstShot: shots.length ? span(shots) : null, landed: shots.length,
      killed: scores.filter(x => x.killed).length,
      killedInOnePass: scores.filter(x => x.killed && x.attacks < 2).length,
      dives: span(col('dives')),
      scores,
    });
  }
}
console.log(JSON.stringify(result));
