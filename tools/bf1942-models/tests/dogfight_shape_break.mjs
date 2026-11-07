// The shape of the break turn (features/dogfight-school): the break-turn
// lesson's three demos and the first two of "On his tail" (rush in, arrive
// slow), which fly the same breaking defender. Run after the head of
// `dogfight_school_harness.mjs` (its imports, the Spitfire and `makePlane`),
// as `test_dogfight_shape_break.py` joins them. Every demo is flown from the
// nine nearby starts the school's tests use and measured as a pilot reads
// it: when and where he breaks, which way, who comes past whose tail, how
// close, who reverses, who is above, who has a shot. Side 0 is the defender
// (the lesson's ace seat), side 1 the attacker. Prints one JSON blob.

const D2R = Math.PI / 180;
const quat = k => ({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] });
const angle = (a, b) => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) + 1e-9);
  return Math.acos(Math.max(-1, Math.min(1, d))) / D2R;
};

/** Each tick from the defender's seat: the range, where the attacker sits
 *  along and across the defender's level heading, both noses' angles off
 *  the other, banks, heights, speeds, phases and shots. */
function rowsOf(r) {
  const [A, B] = r.tracks;
  const n = Math.min(A.length, B.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = A[i], b = B[i];
    const FA = basis(quat(a)).F, FB = basis(quat(b)).F;
    const rel = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const h = Math.hypot(FA[0], FA[2]) || 1;
    const hx = FA[0] / h, hz = FA[2] / h;
    rows.push({
      t: a.t, range: Math.hypot(...rel),
      along: rel[0] * hx + rel[2] * hz, across: -hz * rel[0] + hx * rel[2],
      // His nose off me (the attacker's aim), and my nose off him.
      hisNose: angle(FB, rel.map(x => -x)), myNose: angle(FA, rel),
      bankA: bankOf(quat(a)).bank, above: b.p[1] - a.p[1], vA: a.v, vB: b.v,
      phA: a.ph, phB: b.ph, inA: a.in, oA: a.o, oB: b.o,
    });
  }
  for (let i = 0; i < rows.length; i++) {
    const j = Math.max(0, i - 3), k = Math.min(rows.length - 1, i + 3);
    rows[i].closure = -(rows[k].range - rows[j].range) / Math.max(1e-6, rows[k].t - rows[j].t);
  }
  return rows;
}

const secs = (rows, dt, f) => r1(rows.filter(f).length * dt);
const share = (rows, f) => (rows.length ? Math.round(rows.filter(f).length / rows.length * 100) : null);

/** One demo flown from one start, measured. */
function measure(L, d, dx, dv) {
  const sides = demoSides(L, d);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
  const dt = r.dt;
  const rows = rowsOf(r);
  const out = { dx, dv, hits: r.hits, winner: r.end ? r.end.winner : null,
    minRange: Math.round(Math.min(...rows.filter(x => x.t > 1).map(x => x.range))),
    phasesA: [...new Set(rows.map(x => x.phA))], phasesB: [...new Set(rows.map(x => x.phB))] };
  const ib = rows.findIndex(x => x.phA === 'break');
  if (ib < 0) return out;
  const b = rows[ib];
  out.breakT = r1(b.t);
  out.breakRange = Math.round(b.range);
  out.breakClosure = r1(b.closure);
  out.breakHisNose = r1(b.hisNose);
  out.breakAcross = Math.round(b.across);
  out.breakDv = r1(b.vB - b.vA);
  // The first second of the break: how far over the wings go, and to which
  // side (+ right), against the side he was on.
  const first = rows.filter(x => x.t > b.t && x.t <= b.t + 1.5);
  const maxBank = first.reduce((m, x) => (Math.abs(x.bankA) > Math.abs(m) ? x.bankA : m), 0);
  out.firstBank = Math.round(maxBank);
  out.intoHim = Math.sign(maxBank) === Math.sign(b.across);
  // The overshoot: within 10 s of the break he comes past my tail, inside
  // 150 m: his side of my flight path flips while he is behind my wingline.
  let io = -1;
  for (let i = ib + 1; i < rows.length && rows[i].t < b.t + 10; i++) {
    const p = rows[i - 1], x = rows[i];
    if (x.range < 150 && x.along < 0 && Math.sign(p.across) !== Math.sign(x.across)) { io = i; break; }
  }
  if (io >= 0) {
    const o = rows[io];
    out.overT = r1(o.t);
    out.overRange = Math.round(o.range);
    // The reversal: the defender's bank goes past 45 degrees the other way
    // within 2 s of it.
    const flip = rows.find(x => x.t > o.t && x.t <= o.t + 3 && Math.abs(x.bankA) > 45 && Math.sign(x.bankA) !== Math.sign(out.firstBank));
    out.reversalT = flip ? r1(flip.t - o.t) : null;
    // After the overshoot (from 3 s on): is he back behind me, close, nose
    // behind me (no lead), and does either have a shot?
    const after = rows.filter(x => x.t > o.t + 3);
    out.afterBehind = share(after, x => x.along < 0 && x.range < 150);
    out.afterMedRange = Math.round(after.map(x => x.range).sort((p, q) => p - q)[Math.floor(after.length / 2)] ?? 0);
    out.afterNoLead = share(after, x => x.hisNose > 10);
    out.afterShotB = secs(after, dt, x => x.oB);
    out.afterShotA = secs(after, dt, x => x.oA);
  }
  // The yo-yo (the attacker's `yoyo` or `above`): when, how far out, how
  // high, how close afterwards.
  const iy = rows.findIndex(x => x.phB === 'yoyo' || x.phB === 'above');
  if (iy >= 0) {
    const y = rows[iy];
    out.yoyoAfterBreak = r1(y.t - b.t);
    out.yoyoRange = Math.round(y.range);
    const after = rows.filter(x => x.t > y.t);
    const later = rows.filter(x => x.t > y.t + 3);
    out.yoyoMaxAbove = Math.round(Math.max(...after.map(x => x.above)));
    out.yoyoAboveShare = share(later, x => x.above > 30);
    out.yoyoMinRange = Math.round(Math.min(...after.map(x => x.range)));
    out.yoyoMinSpeed = Math.round(Math.min(...after.map(x => x.vB)));
  }
  const afterBreak = rows.filter(x => x.t > b.t + 1);
  out.shotA = secs(afterBreak, dt, x => x.oA);
  out.shotB = secs(afterBreak, dt, x => x.oB);
  // Hits landed by rounds fired after the break's first two seconds (while
  // the wings roll over and the nose starts round he can still get a
  // burst in), each side.
  out.hitsAfter = [0, 1].map(s => r.rounds.filter(q => q.hit && q.side === s && q.t > b.t + 2).length);
  out.hitTimes = r.rounds.filter(q => q.hit).map(q => [q.side, r1(q.t - b.t)]);
  // Every tick the defender reads as going for the shot has him in front.
  const attack = rows.filter(x => x.inA === 'attack');
  out.attackNoseShare = attack.length ? share(attack, x => x.myNose < 90) : null;
  // Phase changes of the defender, and what the geometry was at each.
  out.reverses = rows.filter((x, i) => i && x.phA === 'reverse' && rows[i - 1].phA !== 'reverse').length;
  return out;
}

const out = {};
// On his tail's `counter` (arriving slow) was retired for its Flip and
// Ninja, which test_dogfight_dfn_ot holds.
for (const [lessonId, demoIds] of [['break-turn', ['without', 'move', 'counter']], ['on-his-tail', ['move']]]) {
  const L = LESSONS.find(l => l.id === lessonId);
  for (const id of demoIds) {
    const d = demoById(L, id);
    const runs = [];
    for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) runs.push(measure(L, d, dx, dv));
    out[`${lessonId}/${id}`] = runs;
  }
}
console.log(JSON.stringify(out));
