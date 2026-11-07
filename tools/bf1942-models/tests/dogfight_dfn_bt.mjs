// The Dip, the Flip and the Ninja in the break-turn lesson
// (features/dogfight-school/reviews/dfn-bt.md). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_dfn_bt.py` joins them:
// each of the lesson's three move demos, flown by the pilot in trouble (the
// other seat) against the school's hunter who gives up a chase he cannot
// win, from the nine nearby starts and scored by the shared measure. Prints
// one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge } from './dogfight_dfn_measure.mjs';

const BT = LESSONS.find(l => l.id === 'break-turn');
const result = { demos: {}, survival: BT.survival ?? null };
for (const id of ['dip', 'flip', 'ninja']) {
  const d = BT.demos.find(x => x.id === id);
  if (!d) { result.demos[id] = null; continue; }
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(BT, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? BT.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [him, me] = r.tracks;
    const rng = i => Math.hypot(me[i].p[0] - him[i].p[0], me[i].p[1] - him[i].p[1], me[i].p[2] - him[i].p[2]);
    // When I broke, and how long his guns had me before it.
    const ib = me.findIndex(k => k.ph === 'break');
    s.breakT = ib < 0 ? null : r1(me[ib].t);
    s.breakRange = ib < 0 ? null : Math.round(rng(ib));
    s.hisShotBeforeBreak = r1(him.slice(0, Math.max(0, ib)).filter(k => k.o).length * r.dt);
    // When I went up out of the circle, and the widest the two got after it.
    const iz = me.findIndex(k => /zoom/.test(k.ph));
    s.zoomT = iz < 0 ? null : r1(me[iz].t);
    let far = 0;
    for (let i = Math.max(0, iz); i < me.length; i++) far = Math.max(far, rng(i));
    s.maxRange = Math.round(far);
    // When he gave up the chase, if he did.
    const lg = him.find(k => k.ph === 'let-go');
    s.letGoT = lg ? r1(lg.t) : null;
    s.hitsAll = r.rounds.filter(x => x.hit && x.side === 0).length;
    // How long the fight was flown.
    s.flown = r1(me[me.length - 1].t);
    s.myHits = r.rounds.filter(x => x.hit && x.side === 1).length;
    scores.push(s);
  }
  result.demos[id] = { kind: d.kind, declared: d.verdict, measured: verdictOf(scores), scores };
}
console.log(JSON.stringify(result));
