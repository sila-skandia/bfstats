// The shape of the turnarounds lesson (features/dogfight-school): the
// Immelmann and the split-S. Run after the head of
// `dogfight_school_harness.mjs` (its imports, the Spitfire and `makePlane`),
// as `test_dogfight_shape_loop.py` joins them. Every demo is flown from the
// nine nearby starts the school's tests use and measured the way a pilot
// reads it from the side: when the half loop starts, whether it stays in its
// vertical plane, where the roll comes, the heading it ends on, the height and
// speed it trades, and what the other seat does about it. Prints one JSON blob.

const D2R = Math.PI / 180;
const quat = k => ({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] });
const frame = k => basis(quat(k));
const nosePitch = k => pitchOf(quat(k));
const bankDeg = k => bankOf(quat(k)).bank;
const flatOf = v => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot3(a, b) / (Math.hypot(...a) * Math.hypot(...b) + 1e-9)))) / D2R;
const rd = v => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const firstIndex = (tr, ph, from = 0) => { for (let i = from; i < tr.length; i++) if (tr[i].ph === ph) return i; return -1; };

/** One demo flown from one start (the other seat moved `dx` metres and `dv` m/s). */
function flyDemo(L, d, dx, dv) {
  const sides = demoSides(L, d);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  return runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
}

/** The Immelmann, the ace's side, and what the other seat did about it. */
function immelmann(r) {
  const [A, B] = r.tracks;
  const dt = r.dt;
  const i0 = firstIndex(A, 'immelmann');
  if (i0 < 0) return { flown: false };
  const iRoll = firstIndex(A, 'rollout', i0);
  const iTop = firstIndex(A, 'top', i0);
  const e = A[i0];
  const h0 = flatOf(frame(e).F);
  const right0 = [-h0[2], 0, h0[0]];
  const rel = sub3(B[i0].p, e.p);
  const ata = angDeg(frame(e).F, rel);
  const opening = dot3(rel, sub3(B[i0 + 1].p, A[i0 + 1].p)) > 0 ? Math.hypot(...sub3(B[i0 + 1].p, A[i0 + 1].p)) - Math.hypot(...rel) : 0;
  // Wings level to the vertical, and in the plane all the way over.
  let bankUp = 0, drift = 0, i80 = -1;
  const end = iTop > 0 ? iTop : A.length - 1;
  for (let i = i0; i < end; i++) {
    if (i80 < 0 && nosePitch(A[i]) >= 80) i80 = i;
    if (i80 < 0) bankUp = Math.max(bankUp, Math.abs(bankDeg(A[i])));
    drift = Math.max(drift, Math.abs(dot3(sub3(A[i].p, e.p), right0)));
  }
  let peak = i0;
  for (let i = i0; i < end; i++) if (A[i].p[1] > A[peak].p[1]) peak = i;
  const roll = iRoll > 0 ? { pitch: rd(nosePitch(A[iRoll])), up: rd(frame(A[iRoll]).U[1]) } : null;
  let headingTurned = null, lowAfter = null;
  if (iTop > 0) {
    const h = flatOf(frame(A[iTop]).F);
    headingTurned = angDeg(h0, h);
    lowAfter = Infinity;
    for (let i = iTop; i < Math.min(A.length, iTop + Math.round(4 / dt)); i++) lowAfter = Math.min(lowAfter, A[i].p[1]);
  }
  // The other seat at the top of the loop: how far off, where its nose
  // points against the top, its speed, its shots that would land.
  const top = A[peak].p;
  let aimTop = Infinity;
  for (let i = Math.max(0, peak - Math.round(1.5 / dt)); i <= Math.min(B.length - 1, peak + Math.round(1.5 / dt)); i++) {
    aimTop = Math.min(aimTop, angDeg(frame(B[i]).F, sub3(top, B[i].p)));
  }
  const win = [Math.max(0, i0 - Math.round(1 / dt)), Math.min(B.length, (iTop > 0 ? iTop : peak) + Math.round(4 / dt))];
  let seatSlow = Infinity, seatPitch = -90, seatShots = 0, aceShots = 0;
  for (let i = win[0]; i < win[1]; i++) {
    seatSlow = Math.min(seatSlow, B[i].v);
    seatPitch = Math.max(seatPitch, nosePitch(B[i]));
    if (B[i].o) seatShots += dt;
    if (A[i].o) aceShots += dt;
  }
  return {
    flown: true, t: rd(e.t), ataAtStart: rd(ata), opening: rd(opening), entrySpeed: rd(e.v),
    bankUp: rd(bankUp), drift: rd(drift), roll, headingTurned: rd(headingTurned),
    gain: rd(A[peak].p[1] - e.p[1]), topSpeed: rd(A[peak].v),
    keptAboveEntry: lowAfter === null ? null : rd(lowAfter - e.p[1]),
    rangeAtTop: rd(Math.hypot(...sub3(top, B[peak].p))), seatAimAtTop: rd(aimTop),
    seatSlowest: rd(seatSlow), seatSteepest: rd(seatPitch), seatShots: rd(seatShots), aceShots: rd(aceShots),
    shots: r.tracks.map(tr => rd(tr.filter(k => k.o).length * dt)), winner: r.end ? r.end.winner : null,
  };
}

/** The split-S, the ace's side, and the other seat's height after it. */
function splitS(r) {
  const [A, B] = r.tracks;
  const dt = r.dt;
  const i0 = firstIndex(A, 'split');
  if (i0 < 0) return { flown: false };
  const iPull = firstIndex(A, 'pullthrough', i0);
  const iOut = iPull > 0 ? firstIndex(A, 'run', iPull) : -1;
  const e = A[i0];
  const h0 = flatOf(frame(e).F);
  const right0 = [-h0[2], 0, h0[0]];
  const pull = iPull > 0 ? { bank: rd(Math.abs(bankDeg(A[iPull]))), pitch: rd(nosePitch(A[iPull])) } : null;
  let lowest = 90, low = Infinity, drift = 0;
  const end = iOut > 0 ? iOut : A.length - 1;
  for (let i = i0; i <= end; i++) {
    lowest = Math.min(lowest, nosePitch(A[i]));
    low = Math.min(low, A[i].p[1]);
    drift = Math.max(drift, Math.abs(dot3(sub3(A[i].p, e.p), right0)));
  }
  const out = iOut > 0 ? A[iOut] : null;
  // The other seat over the 8 s after he comes out: how far above him it
  // stays, its own lowest, its shots that would land.
  let above = Infinity, seatLow = Infinity, seatShots = 0, aceShots = 0;
  if (out) {
    for (let i = iOut; i < Math.min(B.length, iOut + Math.round(8 / dt)); i++) {
      above = Math.min(above, B[i].p[1] - A[i].p[1]);
      seatLow = Math.min(seatLow, B[i].p[1]);
    }
    for (let i = i0; i < Math.min(B.length, iOut + Math.round(8 / dt)); i++) {
      if (B[i].o) seatShots += dt;
      if (A[i].o) aceShots += dt;
    }
  }
  return {
    flown: true, t: rd(e.t), entrySpeed: rd(e.v), entryY: rd(e.p[1]), pull, lowestPitch: rd(lowest),
    headingTurned: out ? rd(angDeg(h0, flatOf(frame(out).F))) : null,
    heightLost: rd(e.p[1] - low), exitSpeed: out ? rd(out.v) : null, drift: rd(drift),
    seatAboveAfter: out ? rd(above) : null, seatStart: rd(B[0].p[1]), seatLowAfter: out ? rd(seatLow) : null,
    seatShots: rd(seatShots), aceShots: rd(aceShots),
    shots: r.tracks.map(tr => rd(tr.filter(k => k.o).length * dt)), winner: r.end ? r.end.winner : null,
  };
}

const L = LESSONS.find(l => l.id === 'turnarounds');
const shape = { demos: {} };
for (const d of L.demos) {
  const runs = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const r = flyDemo(L, d, dx, dv);
    runs.push({ dx, dv, immelmann: immelmann(r), split: splitS(r) });
  }
  shape.demos[d.id] = { seat: d.seat, runs };
}
console.log(JSON.stringify(shape));
