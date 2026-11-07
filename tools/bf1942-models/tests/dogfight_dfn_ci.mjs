// Breaking the circle's tries (features/dogfight-school, "Breaking the
// circle"). Run after the head of `dogfight_school_harness.mjs` (its imports,
// the Spitfire and `makePlane`), as `test_dogfight_dfn_ci.py` joins them.
// The baseline and every try are flown from the nine starts (`STARTS`); each
// try is scored with the shared measure, and each start carries the numbers
// its words quote. Prints one JSON blob.
import { scoreMove, verdictOf, STARTS, nudge, noseOf } from './dogfight_dfn_measure.mjs';
import { CI } from './dogfight-pilot.js';

{
const L = LESSONS.find(l => l.id === 'the-circle');
const MOVE_KINDS = ['dip', 'flip', 'ninja'];
const DEG = 180 / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1)))) * DEG;
/** Where `k`'s nose points off the line to `o`, degrees. */
const offNose = (k, o) => angle(noseOf(k), o.p.map((x, j) => x - k.p[j]));
/** Where `to` lies off `k`'s heading seen from above, degrees (0 ahead). */
const planOff = (k, to) => {
  const n = noseOf(k), b = [to[0] - k.p[0], to[2] - k.p[2]];
  return Math.abs(Math.atan2(n[0] * b[1] - n[2] * b[0], n[0] * b[0] + n[2] * b[1]) * DEG);
};
const r1 = v => Math.round(v * 10) / 10;
const result = { survival: L.survival, after: CI.after, demos: {} };
for (const d of L.demos) {
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const [A, Y] = r.tracks;
    const n = Math.min(A.length, Y.length);
    const at = t => Math.min(n - 1, Math.round(t / r.dt));
    const range = i => dist(A[i].p, Y[i].p);
    const s = MOVE_KINDS.includes(d.kind) ? scoreMove(r, d.kind, 1) : { t0: null };
    const t0 = s.t0 ?? 0;
    const i0 = at(t0);
    // The circle before the move: how far apart, and nobody's shot.
    const pre = [...Array(at(CI.after)).keys()];
    const circleRange = pre.length ? [Math.round(Math.min(...pre.map(range))), Math.round(Math.max(...pre.map(range)))] : null;
    const shotIn = (tr, a, b) => r1(tr.slice(a, b).filter(k => k.o).length * r.dt);
    const phaseAt = (tr, ph) => tr.find(k => k.ph === ph)?.t ?? null;
    const acePhases = [...new Set(r.events.filter(e => e.side === 0 && e.phase !== 'kill').map(e => e.phase))];
    const myPhases = [...new Set(r.events.filter(e => e.side === 1 && e.phase !== 'kill').map(e => e.phase))];
    // Head-on passes: both noses within 30 degrees of the other inside 300 m,
    // counted once per meeting.
    let passes = 0, meeting = false;
    for (let i = i0; i < n; i++) {
      const now = range(i) < 300 && offNose(A[i], Y[i]) < 30 && offNose(Y[i], A[i]) < 30;
      if (now && !meeting) passes++;
      meeting = now;
    }
    // My height and speed after the move, against his.
    const after = [...Array(n - i0).keys()].map(k => k + i0);
    const dy = i => Y[i].p[1] - A[i].p[1];
    const last = n - 1;
    const row = {
      ...st, ...s, circleRange, circleShots: [shotIn(A, 0, at(CI.after)), shotIn(Y, 0, at(CI.after))],
      shots: [shotIn(A, 0, n), shotIn(Y, 0, n)],
      hits: [r.rounds.filter(x => x.hit && x.side === 0).length, r.rounds.filter(x => x.hit && x.side === 1).length],
      range: [Math.round(Math.min(...[...Array(n).keys()].map(range))), Math.round(Math.max(...[...Array(n).keys()].map(range)))],
      endRange: Math.round(range(last)), endDy: Math.round(dy(last)), endEdge: Math.round(Y[last].e - A[last].e),
      slowest: Math.round(Math.min(...after.map(i => Y[i].v))), fastest: Math.round(Math.max(...after.map(i => Y[i].v))),
      highest: Math.round(Math.max(...after.map(dy))), lowest: Math.round(Math.min(...after.map(dy))),
      aceSlowest: Math.round(Math.min(...after.map(i => A[i].v))),
      passes, acePhases, myPhases,
      letGo: (() => { const e = r.events.find(x => x.side === 0 && x.phase === 'let-go'); return e ? r1(e.t) : null; })(),
      meet: (() => { const e = r.events.find(x => x.side === 0 && x.phase === 'meet'); return e ? r1(e.t) : null; })(),
      // Once the move is flown, the closest he came, the slowest I was.
      closeAfter: Math.round(Math.min(...after.slice(Math.round(5 / r.dt)).map(range).concat([Infinity]))),
      // When he lost sight of me after the move, and my height under him then.
      lostMe: (() => { const k = after.find(i => !A[i].sees); return k === undefined ? null : { t: r1(A[k].t), dy: Math.round(dy(k)) }; })(),
      // Phases as they came, with their times (the try's own seat).
      at: Object.fromEntries(myPhases.map(ph => [ph, r1(phaseAt(Y, ph))])),
      // Going up: my height over him and his, as I start to come down.
      overTop: (() => { const t = phaseAt(Y, 'over'); return t === null ? null : { dy: Math.round(dy(at(t))), v: Math.round(Y[at(t)].v), aceV: Math.round(A[at(t)].v) }; })(),
      // Nose low: when I start up, how far round behind him I am and how far under.
      up: (() => { const t = phaseAt(Y, 'flip-up'); return t === null ? null : { t: r1(t), dy: Math.round(dy(at(t))), v: Math.round(Y[at(t)].v), behind: Math.round(planOff(A[at(t)], Y[at(t)].p)) }; })(),
      // Where he sits off my nose in the chop at the end, seen from above
      // (0: he is on my tail), and his nose off me.
      endOff: [Math.round(planOff(A[last], Y[last].p)), Math.round(offNose(A[last], Y[last]))],
    };
    scores.push(row);
  }
  result.demos[d.id] = { declared: d.verdict ?? null, kind: d.kind ?? null, tab: d.tab ?? null, seat: d.seat, ace: d.ace ?? L.ace.plan,
                         seconds: d.seconds ?? L.seconds, endAt: d.endAt ?? null,
                         measured: MOVE_KINDS.includes(d.kind) ? verdictOf(scores) : null, scores };
}
console.log(JSON.stringify(result));
}
