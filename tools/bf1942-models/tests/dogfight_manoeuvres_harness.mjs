// The manoeuvre names (`viewer/dogfight-manoeuvres.js`) on the dogfight
// school's own flown lessons, whose manoeuvres are known. Run after the head
// of `dogfight_school_harness.mjs` (its imports, the Spitfire and
// `makePlane`), as `test_dogfight_manoeuvres.py` joins them. Prints, for
// each demo, every manoeuvre each side flew.
import { nameManoeuvres, scoreManoeuvres } from './dogfight-manoeuvres.js';

const DEMOS = ['break-turn/without', 'break-turn/move', 'turnarounds/immelmann', 'turnarounds/split', 'scissors/move',
  'boom-and-zoom/move', 'out-of-the-lock/flat', 'out-of-the-lock/counter', 'on-his-tail/flip', 'break-turn/dip',
  'scissors/dip', 'up-and-over/dip', 'up-and-over/move'];
const demos = {};
for (const key of DEMOS) {
  const [lid, did] = key.split('/');
  const L = LESSONS.find(l => l.id === lid), d = L.demos.find(x => x.id === did);
  const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides: demoSides(L, d) });
  const moves = nameManoeuvres(r);
  const scored = scoreManoeuvres(r, moves);
  demos[key] = {
    moves: moves.map(m => ({ side: m.side, name: m.name, t0: Math.round(m.t0 * 10) / 10, t1: Math.round(m.t1 * 10) / 10 })),
    scored: scored.map(m => ({ side: m.side, name: m.name, before: m.before, after: m.after, myShot: m.myShot, hisShot: m.hisShot, won: m.won, lost: m.lost })),
  };
}
console.log(JSON.stringify(demos));
