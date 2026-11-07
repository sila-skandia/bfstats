// The shape of the two height lessons (features/dogfight-school): boom and
// zoom, and when he has the height. Run after the head of
// `dogfight_school_harness.mjs` (its imports, the Spitfire and `makePlane`),
// as `test_dogfight_shape_height.py` joins them. Every demo is flown from the
// nine nearby starts the school's tests use, and measured as a pilot would
// read it from above and from the side: the dives, the firing passes, the
// zooms, the merges, the breaks, the climbs. Prints one JSON blob.

const D2R = Math.PI / 180;
const nose = q => { const [x, y, z, w] = q; return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))]; };
const pitchDeg = q => Math.asin(Math.max(-1, Math.min(1, nose(q)[1]))) / D2R;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angDeg = (a, b) => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) + 1e-9);
  return Math.acos(Math.max(-1, Math.min(1, d))) / D2R;
};
const round1 = v => Math.round(v * 10) / 10;
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** One demo flown from one start, measured. */
function measure(L, d, dx, dv) {
  const sides = demoSides(L, d);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
  const [A, B] = r.tracks;
  const n = Math.min(A.length, B.length);
  const dt = r.dt;
  const endT = r.end ? r.end.t : L.seconds;
  const endI = Math.min(n - 1, Math.round(endT / dt));
  const range = i => dist(A[i].p, B[i].p);
  const idx = t => Math.min(n - 1, Math.round(t / dt));
  const vel = (T, i) => { const j = Math.min(n - 1, i + 1), k = Math.max(0, j - 1); return T[j].p.map((x, m) => (x - T[k].p[m]) / dt); };

  // The ace's passes: each dive from its start to the zoom that ends it,
  // and the closest the two come in it (or in the three seconds after).
  const aceEv = r.events.filter(e => e.side === 0 && e.phase !== 'kill');
  const passes = [];
  aceEv.forEach((e, k) => {
    if (e.phase !== 'dive' || e.t > endT) return;
    const i0 = idx(e.t);
    const next = aceEv[k + 1];
    const i1 = next ? idx(next.t) : endI;
    let iMin = i0;
    for (let i = i0; i <= Math.min(endI, i1 + 90); i++) if (range(i) < range(iMin)) iMin = i;
    const after = [];
    for (let i = iMin; i <= Math.min(n - 1, iMin + Math.round(10 / dt)); i++) after.push(A[i].p[1] - B[i].p[1]);
    // The firing pass: the longest unbroken burst (trigger down), and the
    // seconds of it that would land.
    let best = 0, cur = 0, shots = 0;
    for (let i = i0; i <= i1; i++) { cur = A[i].f ? cur + 1 : 0; best = Math.max(best, cur); if (A[i].h) shots++; }
    const fi = A.findIndex((k2, i) => i >= i0 && i <= i1 && k2.o);
    let firstShot = null;
    if (fi >= 0) {
      const los = B[fi].p.map((x, m) => x - A[fi].p[m]);
      const rl = Math.hypot(...los);
      const va = vel(A, fi), vb = vel(B, fi);
      firstShot = { t: round1(fi * dt), pitch: Math.round(pitchDeg(A[fi].q)), closure: Math.round(-los.reduce((s, x, m) => s + (vb[m] - va[m]) * x / rl, 0)), range: Math.round(rl) };
    }
    // The zoom: how far back above him the ace gets in the 10 s after the pass.
    let zoomAbove = -Infinity;
    for (let i = i1; i <= Math.min(n - 1, i1 + Math.round(10 / dt)); i++) zoomAbove = Math.max(zoomAbove, A[i].p[1] - B[i].p[1]);
    passes.push({
      t: round1(e.t), end: round1(i1 * dt), gap: Math.round(A[i0].p[1] - B[i0].p[1]), egap: Math.round(A[i0].e - B[i0].e),
      merge: { t: round1(iMin * dt), range: Math.round(range(iMin)), noses: Math.round(angDeg(nose(A[iMin].q), nose(B[iMin].q))) },
      aboveAfter: Math.round(Math.min(...after)), zoomAbove: Math.round(zoomAbove),
      divePitch: Math.round(Math.min(...A.slice(i0, i1 + 1).map(k2 => pitchDeg(k2.q)))),
      fireRun: round1(best * dt), shots: round1(shots * dt), firstShot,
    });
  });
  const phaseTimes = (T, side, ph) => r.events.filter(e => e.side === side && e.phase === ph && e.t <= endT).map(e => round1(e.t));

  // You: the extremes of your own flying.
  let maxPitch = -90, minV = Infinity, maxR = 0, high = 0, low = 0, floor = 0;
  for (let i = 0; i <= endI; i++) {
    maxPitch = Math.max(maxPitch, pitchDeg(B[i].q));
    if (i * dt > 3) minV = Math.min(minV, B[i].v);
    maxR = Math.max(maxR, range(i));
    if (B[i].p[1] > 850) high += dt;
    if (B[i].p[1] < 100) low += dt;
    const vy = vel(B, i)[1];
    if (B[i].p[1] < 70 + Math.max(0, -vy) * 3.2) floor += dt;
  }
  // Your climb between his dives: the nose, the speed, the rate, and
  // whether he stays in view (off your nose by no more than 120 degrees).
  const climbI = [];
  for (let i = 0; i <= endI; i++) if (B[i].ph === 'climb') climbI.push(i);
  const inView = climbI.filter(i => angDeg(nose(B[i].q), A[i].p.map((x, m) => x - B[i].p[m])) <= 120).length;
  let climbRate = null;
  if (climbI.length > 30) climbRate = round1(mean(climbI.map(i => vel(B, i)[1])));
  // Where the rounds that landed were fired from.
  const landed = r.rounds.filter(x => x.hit && x.side === 0).map(x => A[idx(x.t)].ph);
  // The last moment inside 600 m, and the energy lead then.
  let lastNear = -1;
  for (let i = 0; i <= endI; i++) if (range(i) < 600) lastNear = i;
  const breaks = phaseTimes(B, 1, 'break');
  const faces = r.events.filter(e => e.side === 1 && (e.phase === 'face') && e.t <= endT).map(e => round1(e.t));
  // While you face or pass, is he coming down at you: in his dive, or still
  // sinking in the pull-out that ends it?
  const facing = [];
  for (let i = 0; i <= endI; i++) if (B[i].ph === 'face' || B[i].ph === 'pass') facing.push(i);
  const coming = i => A[i].ph === 'dive' || vel(A, i)[1] < 0;
  const faceInDive = facing.length ? facing.filter(coming).length / facing.length : null;
  // Each break: how long before the closest pass of the dive it answers.
  const breakLead = breaks.map(t => {
    const p = passes.find(q => q.merge.t >= t);
    return p ? round1(p.merge.t - t) : null;
  });
  return {
    dx, dv, end: r.end ? { t: round1(r.end.t), winner: r.end.winner, why: r.end.why } : null, hits: r.hits,
    passes, zooms: phaseTimes(A, 0, 'zoom').length, breaks, breakLead, faces,
    faceInDive: faceInDive === null ? null : Math.round(faceInDive * 100),
    vAtEnd: round1(B[endI].v),
    you: { maxPitch: Math.round(maxPitch), minV: round1(minV), dyMax: Math.round(Math.max(...B.slice(0, endI + 1).map(k => Math.abs(k.p[1] - B[0].p[1])))),
           yMin: Math.round(Math.min(...B.slice(0, endI + 1).map(k => k.p[1]))), yMax: Math.round(Math.max(...B.slice(0, endI + 1).map(k => k.p[1]))),
           high: round1(high), low: round1(low), floor: round1(floor),
           climbPitch: climbI.length ? Math.round(mean(climbI.map(i => pitchDeg(B[i].q)))) : null,
           climbLatePitch: (() => { const l = climbI.filter(i => i * dt > 20); return l.length ? Math.round(mean(l.map(i => pitchDeg(B[i].q)))) : null; })(),
           climbMinV: climbI.length ? round1(Math.min(...climbI.filter(i => i * dt > 3).map(i => B[i].v))) : null,
           climbRate, climbInView: climbI.length ? Math.round(inView / climbI.length * 100) : null,
           pitchMean: Math.round(mean(B.slice(Math.round(3 / dt), endI + 1).map(k => pitchDeg(k.q)))),
           vEnd: round1(B[endI].v) },
    maxRange: Math.round(maxR),
    landedIn: [...new Set(landed)], landedInDive: landed.length ? Math.round(landed.filter(p => p === 'dive').length / landed.length * 100) : null,
    leadNear: lastNear >= 0 ? Math.round(B[lastNear].e - A[lastNear].e) : null, leadNearT: round1(lastNear * dt),
    lead: Math.round(B[endI].e - A[endI].e), aceAboveEnd: Math.round(A[endI].p[1] - B[endI].p[1]),
  };
}

const height = {};
for (const id of ['boom-and-zoom', 'under-the-height']) {
  const L = LESSONS.find(l => l.id === id);
  height[id] = {};
  for (const d of [...L.demos, ...(RETIRED_DEMOS[id] ?? [])]) {
    const rows = [];
    for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) rows.push(measure(L, d, dx, dv));
    height[id][d.id] = rows;
  }
}
console.log(JSON.stringify(height));
