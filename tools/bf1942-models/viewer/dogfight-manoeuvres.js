// The manoeuvres in a fight, named in the dogfight school's own words
// (features/dogfight-recordings, "Naming the manoeuvres"). Pure: a fight in
// the theatre's shape (`runDuel`'s, or `dogfight-recorded.js`'s from a
// recording) in, every manoeuvre each pilot flew out, with what it did for
// him: where he stood before it and after, whose guns came on, who won.
//
// Each manoeuvre is a rule over what the path did (turn rate, climb, pitch,
// rolled over, heading turned, height won or lost, the engine's revs) and
// where the other plane was (on my tail, on his, head on, crossing). The
// numbers are in `M_RULES`. The rules were checked against the school's own
// flown lessons, whose manoeuvres are known (tests/test_dogfight_manoeuvres.py).

import { geometry, situation } from './dogfight-pilot.js';
import { basis, pitchOf, bankOf, energyHeight } from './dogfight-flight.js';

export const M_RULES = Object.freeze({
  version: 1,
  // A hard turn: the flight path swinging this fast, about level.
  turnRate: 18, levelVy: 12, turnSeconds: 2,
  // A break: a hard turn begun with him in my rear quarter inside this, toward him.
  breakRange: 700,
  climbPitch: 25, climbVy: 8, climbSeconds: 2, zoomSpeed: 65,
  divePitch: -25, diveVy: -12, diveSeconds: 1.5, spiralTurn: 15,
  boomWithin: 15, attackRange: 700,
  // Over the top: rolled past this (the up vector's height), the entry and
  // exit wings level within `vertWindow` seconds.
  inverted: -0.2, upright: 0.5, levelPitch: 30, vertWindow: 8,
  vertHeight: 40, vertTurn: 135, loopTurn: 60,
  yoyoVy: 6, yoyoTurn: 12, yoyoPitch: 50, yoyoRange: 500, yoyoSeconds: 1.5, yoyoBack: 6,
  scissorsRange: 400, scissorsMean: 250, crossRange: 300, crossGap: 8, crossings: 3,
  headOnRange: 300, headOnClosure: 40,
  overshootRange: 150, overshootWithin: 3,
  flipWithin: 12, held: 1,
  extendTurn: 6, extendSpeed: 50, extendSeconds: 4, gone: 900,
  chopDrop: 0.3, chopRevs: 0.6, deathRevs: 2,
  chaseAta: 45, chaseRange: 600, chaseSeconds: 2,
  jinkBank: 30, jinkWithin: 3,
});

/**
 * The names, in the order a caption prefers them when two overlap (the
 * first is the one said), each with the school's one line for it.
 */
export const MANOEUVRES = [
  ['Reversal', 'From the chased to the chaser: the Flip'],
  ['Overshoot', 'Came past the man he was chasing'],
  ['Forced overshoot', 'Made his chaser fly past'],
  ['Head-on pass', 'Nose to nose, passing'],
  ['Immelmann', 'Half loop up and roll out: reversed, higher'],
  ['Split-S', 'Roll over and pull through: reversed, lower'],
  ['Loop', 'Up, over the top and down, same way'],
  ['Boom and zoom', 'Dive on him, shoot, zoom back up'],
  ['Scissors', 'Side by side, turning across each other'],
  ['High yo-yo', 'Up out of the turn, back down onto him'],
  ['Low yo-yo', 'Down inside his turn, back up at him'],
  ['Break turn', 'Hard turn into the man on his tail'],
  ['Throttle chop', 'Throttle back to slow down'],
  ['Jink', 'Rolling side to side to spoil his aim'],
  ['Spiral dive', 'Diving while turning hard'],
  ['Zoom climb', 'Climbing on the speed of a dive'],
  ['Extension', 'Straight and fast, opening the range: the Dip'],
  ['Hard turn', 'Turning as hard as it goes'],
  ['Tail chase', 'On his tail, following him'],
  ['Dive', 'Nose down, trading height for speed'],
  ['Climb', 'Nose up, trading speed for height'],
];
export const PRIORITY = new Map(MANOEUVRES.map(([name], i) => [name, i]));

const DEG = 180 / Math.PI;
const quat = q => (Array.isArray(q) ? { x: q[0], y: q[1], z: q[2], w: q[3] } : q);

/**
 * What each pilot's path did, tick by tick: speed, climb, pitch, bank,
 * rolled over, turn rate, heading and its rate, the engine, and the
 * geometry to the other plane.
 */
export function features(fight) {
  const dt = fight.dt;
  const h = Math.max(1, Math.round(0.2 / dt));
  const n = Math.min(fight.tracks[0].length, fight.tracks[1].length);
  const vel = fight.tracks.map(tr => Array.from({ length: n }, (_, i) => {
    const a = tr[Math.max(0, i - h)].p, b = tr[Math.min(n - 1, i + h)].p;
    const span = (Math.min(n - 1, i + h) - Math.max(0, i - h)) * dt || dt;
    return [(b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span];
  }));
  return fight.tracks.map((tr, s) => {
    const o = 1 - s;
    return Array.from({ length: n }, (_, i) => {
      const k = tr[i];
      const q = quat(k.q);
      const v = vel[s][i];
      const speed = Math.hypot(...v);
      const va = vel[s][Math.max(0, i - h)], vb = vel[s][Math.min(n - 1, i + h)];
      const span = (Math.min(n - 1, i + h) - Math.max(0, i - h)) * dt || dt;
      const cosT = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / ((Math.hypot(...va) * Math.hypot(...vb)) || 1);
      const turnRate = Math.acos(Math.max(-1, Math.min(1, cosT))) * DEG / span;
      // Heading: 0 down -z, positive to the right (+x).
      const hdg = Math.atan2(v[0], -v[2]) * DEG;
      const ha = Math.atan2(va[0], -va[2]) * DEG, hb = Math.atan2(vb[0], -vb[2]) * DEG;
      let dh = hb - ha;
      while (dh > 180) dh -= 360;
      while (dh < -180) dh += 360;
      const me = { position: k.p, velocity: v, orientation: q };
      const him = { position: fight.tracks[o][i].p, velocity: vel[o][i], orientation: quat(fight.tracks[o][i].q) };
      const g = geometry(me, him);
      return {
        t: k.t, y: k.p[1], speed, vy: v[1], pitch: pitchOf(q), bank: bankOf(q).bank, up: basis(q).U[1],
        turnRate, hdg, hdgRate: Math.hypot(va[0], va[2]) > 5 && Math.hypot(vb[0], vb[2]) > 5 ? dh / span : 0,
        rv: Number.isFinite(k.rv) ? k.rv : null, e: energyHeight(k.p[1], speed),
        range: g.range, ata: g.ata, hisAta: g.hisAta, closure: g.closure, side: g.side, sit: situation(g),
        fire: !!k.f, shot: !!(k.o && k.f),
      };
    });
  });
}

/** Runs of ticks where `pred` holds, gaps under `join` s bridged, `min` s or longer: [i0, i1]. */
function runs(F, pred, min, join = 0.3) {
  const out = [];
  let start = -1, lastTrue = -1;
  for (let i = 0; i < F.length; i++) {
    if (pred(F[i], i)) {
      if (start < 0) start = i;
      else if (F[i].t - F[lastTrue].t > join) { out.push([start, lastTrue]); start = i; }
      lastTrue = i;
    }
  }
  if (start >= 0) out.push([start, lastTrue]);
  return out.filter(([a, b]) => F[b].t - F[a].t >= min - 1e-9);
}
const mean = (F, a, b, key) => { let s = 0; for (let i = a; i <= b; i++) s += F[i][key]; return s / (b - a + 1); };
const angleDiff = (a, b) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
/** The situation he held longest over [t0, t1]. */
function dominant(F, t0, t1) {
  const c = {};
  for (const f of F) if (f.t >= t0 && f.t <= t1) c[f.sit] = (c[f.sit] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const offensive = f => f.ata < 60 && f.hisAta > 100 && f.range < 800;
const defensive = f => f.hisAta < 60 && f.ata > 100 && f.range < 800;

/**
 * Every manoeuvre each pilot flew: `[{ side, name, t0, t1, detail }]`, in
 * time order. Overlaps are kept; `primaryAt` picks the one a caption says.
 */
export function nameManoeuvres(fight, R = M_RULES, feats = features(fight)) {
  const out = [];
  const add = (side, name, F, a, b, detail = {}) => out.push({ side, name, t0: F[a].t, t1: F[b].t, ...detail });
  for (const side of [0, 1]) {
    const F = feats[side];
    const T = i => F[i].t;
    // Hard turns, and the breaks among them.
    for (const [a, b] of runs(F, f => f.turnRate >= R.turnRate && Math.abs(f.vy) <= R.levelVy && f.speed >= 25, R.turnSeconds)) {
      const start = F.slice(Math.max(0, a - Math.round(1 / fight.dt)), a + 1);
      const threatened = start.some(f => defensive(f) && f.range < R.breakRange);
      const toward = Math.sign(mean(F, a, Math.min(b, a + Math.round(1 / fight.dt)), 'hdgRate')) === Math.sign(F[a].side || 1);
      add(side, threatened && toward ? 'Break turn' : 'Hard turn', F, a, b);
    }
    // Climbs, zooms, dives, spirals.
    const climbs = runs(F, f => f.pitch >= R.climbPitch && f.vy >= R.climbVy, R.climbSeconds);
    const dives = runs(F, f => f.pitch <= R.divePitch && f.vy <= R.diveVy, R.diveSeconds);
    for (const [a, b] of dives) add(side, mean(F, a, b, 'turnRate') >= R.spiralTurn ? 'Spiral dive' : 'Dive', F, a, b);
    for (const [a, b] of climbs) {
      const afterDive = dives.some(([, db]) => T(a) - T(db) >= 0 && T(a) - T(db) <= 4);
      add(side, afterDive || F[a].speed >= R.zoomSpeed ? 'Zoom climb' : 'Climb', F, a, b);
    }
    // Boom and zoom: a dive, an attack out of it (his guns on, or the nose
    // on him in range), then up again before the speed is gone.
    for (const [ca, cb] of climbs) {
      const dive = [...dives].reverse().find(([da, db]) => T(db) <= T(ca) + 0.5 && T(ca) - T(da) <= R.boomWithin);
      if (!dive) continue;
      const attacking = F.slice(dive[0], ca + 1).some(f => (f.ata < 30 && f.range < R.attackRange) || f.fire);
      if (attacking && F[ca].speed >= R.zoomSpeed - 10) add(side, 'Boom and zoom', F, dive[0], cb);
    }
    // Over the top: an Immelmann, a split-S, a loop.
    const win = Math.round(R.vertWindow / fight.dt);
    let lastExit = -1;
    for (const [ia, ib] of runs(F, f => f.up <= R.inverted, 0.3)) {
      if (ia <= lastExit) continue;
      let e = -1, x = -1;
      for (let i = ia; i >= Math.max(0, ia - win); i--) if (F[i].up >= R.upright && Math.abs(F[i].pitch) <= R.levelPitch) { e = i; break; }
      for (let i = ib; i <= Math.min(F.length - 1, ib + win); i++) if (F[i].up >= R.upright && Math.abs(F[i].pitch) <= R.levelPitch) { x = i; break; }
      if (e < 0 || x < 0) continue;
      let maxP = -90, minP = 90;
      for (let i = e; i <= x; i++) { maxP = Math.max(maxP, F[i].pitch); minP = Math.min(minP, F[i].pitch); }
      const dHeight = F[x].y - F[e].y;
      const dHdg = Math.abs(angleDiff(F[e].hdg, F[x].hdg));
      const detail = { height: Math.round(dHeight), turned: Math.round(dHdg) };
      if (dHeight >= R.vertHeight && dHdg >= R.vertTurn && maxP >= 50) add(side, 'Immelmann', F, e, x, detail);
      else if (dHeight <= -R.vertHeight && dHdg >= R.vertTurn && minP <= -50) add(side, 'Split-S', F, e, x, detail);
      else if (dHdg < R.loopTurn && maxP >= 60 && minP <= -40) add(side, 'Loop', F, e, x, detail);
      else continue;
      lastExit = x;
    }
    // Yo-yos: on his tail, up (or down) out of the turn and back.
    const yoyo = (name, outVy, backVy) => {
      // Closing on him in a turning fight (he may be breaking back into
      // you, which is what it answers): the nose off the horizon, not a
      // dive or a zoom.
      for (const [a, b] of runs(F, f => outVy(f.vy) && f.turnRate >= R.yoyoTurn && Math.abs(f.pitch) <= R.yoyoPitch
                                       && f.ata < 75 && f.closure > 0 && f.range < R.yoyoRange, R.yoyoSeconds)) {
        const back = runs(F.slice(b, Math.min(F.length, b + Math.round(R.yoyoBack / fight.dt))), f => backVy(f.vy), 1)[0];
        if (back) add(side, name, F, a, b + back[1]);
      }
    };
    yoyo('High yo-yo', vy => vy >= R.yoyoVy, vy => vy <= -5);
    yoyo('Low yo-yo', vy => vy <= -R.yoyoVy, vy => vy >= 5);
    // Throttle chop: the revs fall away while the speed falls.
    if (F.some(f => f.rv !== null)) {
      const w2 = Math.round(2 / fight.dt);
      for (const [a, b] of runs(F, (f, i) => {
        if (f.rv === null) return false;
        let top = f.rv;
        for (let j = Math.max(0, i - w2); j < i; j++) if (F[j].rv !== null) top = Math.max(top, F[j].rv);
        return top - f.rv >= R.chopDrop && f.rv <= R.chopRevs && f.speed < F[Math.max(0, i - w2)].speed - 2;
      }, 0.5)) add(side, 'Throttle chop', F, a, b);
    }
    // Jinks: the bank thrown side to side under his guns.
    {
      const flips = [];
      for (let i = 1; i < F.length; i++) {
        if (Math.abs(F[i].bank) >= R.jinkBank && Math.sign(F[i].bank) !== Math.sign(F[i - 1].bank) && defensive(F[i])) flips.push(i);
      }
      for (let k = 0; k + 1 < flips.length; k++) {
        if (T(flips[k + 1]) - T(flips[k]) <= R.jinkWithin) { add(side, 'Jink', F, flips[k], flips[k + 1]); k++; }
      }
    }
    // Extension: straight and fast with the range opening (the Dip).
    for (const [a, b] of runs(F, f => !offensive(f) && f.turnRate < R.extendTurn && f.speed >= R.extendSpeed && f.closure < -3 && f.range > 300, R.extendSeconds)) {
      add(side, 'Extension', F, a, b, { gone: F[b].range >= R.gone });
    }
    // Tail chase: on his tail, following him.
    for (const [a, b] of runs(F, f => f.ata < R.chaseAta && f.hisAta > 120 && f.range < R.chaseRange, R.chaseSeconds)) add(side, 'Tail chase', F, a, b);
    // Reversal: defensive, then within a few seconds offensive (the Flip).
    const held = Math.round(R.held / fight.dt);
    const defRuns = runs(F, defensive, R.held), offRuns = runs(F, offensive, R.held);
    for (const [, db] of defRuns) {
      const next = offRuns.find(([oa]) => oa > db && T(oa) - T(db) <= R.flipWithin);
      if (next) add(side, 'Reversal', F, db, Math.min(F.length - 1, next[0] + held));
    }
  }
  // Between the two: head-on passes, overshoots, scissors.
  const A = feats[0], B = feats[1];
  for (const [a, b] of runs(A, f => f.sit === 'headOn' && f.range < R.headOnRange && f.closure > R.headOnClosure, 0)) {
    for (const s of [0, 1]) add(s, 'Head-on pass', feats[s], a, b);
  }
  for (const s of [0, 1]) {
    const F = feats[s], G = feats[1 - s];
    // He was on the other's tail and closing, and within a few seconds the
    // other is behind him: he came past.
    for (const [a, b] of runs(F, f => offensive(f) && f.closure > 5, R.held)) {
      const lim = Math.min(F.length - 1, b + Math.round(R.overshootWithin / fight.dt));
      for (let i = b; i <= lim; i++) {
        if (G[i].ata < 75 && F[i].hisAta < 75 && F[i].ata > 90 && F[i].range < R.overshootRange * 2) {
          add(s, 'Overshoot', F, b, i);
          add(1 - s, 'Forced overshoot', G, b, i);
          break;
        }
      }
    }
  }
  // Scissors: crossing each other and reversing, again and again.
  {
    const crossings = [];
    for (let i = 1; i < A.length; i++) if (A[i].range < R.crossRange && A[i].side !== A[i - 1].side && A[i].side && A[i - 1].side) crossings.push(i);
    // A reversal: the turn's sign flips against the last clear turn.
    const reversals = F => {
      const r = [];
      let last = 0;
      for (let i = 0; i < F.length; i++) {
        if (Math.abs(F[i].hdgRate) <= 5) continue;
        const sign = Math.sign(F[i].hdgRate);
        if (last && sign !== last) r.push(i);
        last = sign;
      }
      return r;
    };
    const rA = reversals(A), rB = reversals(B);
    let k = 0;
    while (k < crossings.length) {
      let j = k;
      // Crossings each within `crossGap` of the last are one scissors.
      while (j + 1 < crossings.length && A[crossings[j + 1]].t - A[crossings[j]].t <= R.crossGap) j++;
      const n = j - k + 1;
      if (n >= R.crossings) {
        const a = crossings[k], b = crossings[j];
        // Each crossing a reversal by both, close all the way.
        const pad = Math.round(1 / fight.dt);
        const inA = rA.filter(i => i >= a - pad && i <= b + pad).length, inB = rB.filter(i => i >= a - pad && i <= b + pad).length;
        const close = A.slice(a, b + 1).every(f => f.range < R.scissorsRange) && mean(A, a, b, 'range') < R.scissorsMean;
        if (inA >= n - 1 && inB >= n - 1 && close) for (const s of [0, 1]) add(s, 'Scissors', feats[s], a, b, { crossings: n });
      }
      k = j + 1;
    }
  }
  // Nothing after the kill is flown: the wreck falls (a spiral dive), its
  // engine dies (a throttle chop) and the killer goes past it (an
  // overshoot). Manoeuvres stop at the kill, and the dead man's engine
  // failing in the last seconds is no chop of his.
  const end = fight.end?.why === 'shot down' ? fight.end : null;
  const kept = end
    ? out.filter(m => m.t0 < end.t - 0.3 && !(m.name === 'Throttle chop' && m.side !== end.winner && m.t1 >= end.t - R.deathRevs))
      .map(m => (m.t1 > end.t ? { ...m, t1: end.t } : m))
    : out;
  return kept.sort((x, y) => x.t0 - y.t0 || PRIORITY.get(x.name) - PRIORITY.get(y.name));
}

/** The manoeuvre a caption names for a side at `t`: the highest in `MANOEUVRES`. */
export function primaryAt(moves, side, t) {
  let best = null;
  for (const m of moves) {
    if (m.side !== side || t < m.t0 || t > m.t1) continue;
    if (!best || PRIORITY.get(m.name) < PRIORITY.get(best.name)) best = m;
  }
  return best;
}

const RANK = { defensive: 0, neutral: 1, headOn: 1, offensive: 2 };

/**
 * What each manoeuvre did for the pilot who flew it: where he stood before
 * (the 2 s ahead of it) and after (the 3 s after), whose guns had a shot
 * that would land from its start to 5 s after it, the energy he gained on
 * the other, and how the fight ended.
 */
export function scoreManoeuvres(fight, moves, feats = features(fight)) {
  return moves.map(m => {
    const F = feats[m.side], G = feats[1 - m.side];
    const before = dominant(F, m.t0 - 2, m.t0) ?? dominant(F, m.t0, m.t0 + 0.5);
    const after = dominant(F, m.t1, m.t1 + 3) ?? dominant(F, m.t1 - 0.5, m.t1);
    const inWin = (X, key) => X.some(f => f.t >= m.t0 && f.t <= m.t1 + 5 && f[key]);
    const at = (X, t) => X[Math.max(0, Math.min(X.length - 1, Math.round(t / fight.dt)))];
    const e0 = at(F, m.t0).e - at(G, m.t0).e, e1 = at(F, m.t1 + 2).e - at(G, m.t1 + 2).e;
    const winner = fight.end?.why === 'shot down' ? fight.end.winner : null;
    return {
      ...m, before, after, better: before && after ? RANK[after] - RANK[before] : null,
      myShot: inWin(F, 'shot'), hisShot: inWin(G, 'shot'),
      energy: Math.round(e1 - e0),
      won: winner === m.side, lost: winner === 1 - m.side,
    };
  });
}
