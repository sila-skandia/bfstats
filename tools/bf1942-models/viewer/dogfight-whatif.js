// What else a chased pilot could have done (features/dogfight-recordings,
// "What if"): from one moment of a recorded fight, both planes are put
// exactly where the recording has them (place, speed, attitude) and flown on
// BF1942's own flight law for a few seconds, the chased pilot through each
// way out the school knows, the chaser after him at full throttle with his
// nose on the lead, firing from 400 m as players do (`PLANS.wiChaser`). Each is scored the same way as what the pilot really did: how
// long the chaser's guns had a shot that would land, the hits, how soon he
// was out of the chaser's sights, and whether he came out with a shot of
// his own. Any of them plays on from the recording in the theatre
// (`spliceFight`).
//
// The chaser is a pursuer of the school's, not the player who was there: his
// answer to each way out is what a determined gunner would fly. And the planes
// are the recording's own types where the page can build them
// (`makePlaneFor`), else the Range battle's fighter.

import { runDuel } from './dogfight-duel.js';
import { PLANS, INTENTS, geometry, situation, go } from './dogfight-pilot.js';
import { hardTurn, pullLift, bankAndPull, pointNose, pitchOf, bankOf, basis, gunSolution, leadPoint } from './dogfight-flight.js';
import { GUN_RANGE } from './dogfight-recorded.js';

/** Seconds each way out is flown. */
export const SECONDS = 8;
/** In his sights (what starts a WHAT IF): his nose within `OUT_ANGLE` of
 *  me inside `OUT_RANGE`. In his line of fire (what a way out is scored
 *  on): his nose within `OFF_LEAD` of the lead his rounds need, inside his
 *  guns' reach; a shot that would land is the narrow middle of it. */
export const OUT_ANGLE = 30;
export const OUT_RANGE = 600;
export const OFF_LEAD = 10;
/** The guns, for the chaser and for every score: players fire from 400 m
 *  (`dogfight-recorded.js` `GUN_RANGE`), not the school's 268. */
export const GUN = { range: GUN_RANGE };

const flat = v => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };

// --- the ways out the school flies from any moment --------------------------------
// Each holds its decision from the moment it starts (`mem.side`, `mem.h0`),
// as a pilot commits to a move.

const once = (c, key, value) => { if (c.mem[key] === undefined) c.mem[key] = value(); return c.mem[key]; };

PLANS.wiInto = {
  title: 'Break turn into them', first: 'break',
  says: { break: 'Hard into him: his sight cannot follow' },
  step(c) {
    const side = once(c, 'side', () => c.g.side || 1);
    return { ...hardTurn(c.me, side), throttle: 1 };
  },
};
PLANS.wiAway = {
  title: 'Hard turn away from them', first: 'turn',
  says: { turn: 'Hard away from him' },
  step(c) {
    const side = once(c, 'side', () => -(c.g.side || 1));
    return { ...hardTurn(c.me, side), throttle: 1 };
  },
};
PLANS.wiUp = {
  title: 'Pull straight up', first: 'pull',
  says: { pull: 'Wings level, pulling up as hard as it goes' },
  step(c) {
    return { ...pullLift(c.me, basis(c.me.orientation).U, 1), throttle: 1 };
  },
};
PLANS.wiDive = {
  title: 'Dive away at 45 degrees', first: 'dive',
  says: { dive: 'Nose down 45 degrees, full throttle' },
  step(c) {
    const h = once(c, 'h0', () => flat(basis(c.me.orientation).F));
    const d = [h[0] * Math.SQRT1_2, -Math.SQRT1_2, h[2] * Math.SQRT1_2];
    return { ...pointNose(c.me, d), throttle: 1 };
  },
};
PLANS.wiRun = {
  title: 'Run flat out, away from them', first: 'run',
  says: { run: 'Level, full throttle, straight away from him' },
  step(c) {
    const away = once(c, 'away', () => flat([c.me.position[0] - c.him.position[0], 0, c.me.position[2] - c.him.position[2]]));
    return { ...pointNose(c.me, [away[0], -0.05, away[2]]), throttle: 1 };
  },
};
PLANS.wiSplitS = {
  title: 'Split-S', first: 'roll',
  says: { roll: 'Rolling over onto my back', pull: 'Pulling through, down and round', out: 'Out of it, the other way' },
  step(c) {
    const h0 = once(c, 'h0', () => flat(basis(c.me.orientation).F));
    if (c.mem.phase === 'roll') {
      if (Math.abs(bankOf(c.me.orientation).bank) > 150) go(c, 'pull');
      return { ...bankAndPull(c.me, 180, 0.1), throttle: 0 };
    }
    if (c.mem.phase === 'pull') {
      const p = pitchOf(c.me.orientation);
      if (c.mem.since > 1 && p > -20 && basis(c.me.orientation).U[1] > 0.3) go(c, 'out');
      return { ...pullLift(c.me, basis(c.me.orientation).U, 1), throttle: 0.5 };
    }
    return { ...pointNose(c.me, [-h0[0], 0, -h0[2]]), throttle: 1 };
  },
};
PLANS.wiImmelmann = {
  title: 'Immelmann', first: 'up',
  says: { up: 'Half loop up', roll: 'Rolling upright on top', out: 'Out of it, higher, the other way' },
  step(c) {
    const h0 = once(c, 'h0', () => flat(basis(c.me.orientation).F));
    const B = basis(c.me.orientation);
    if (c.mem.phase === 'up') {
      if (c.mem.since > 1 && B.U[1] < -0.5 && Math.abs(pitchOf(c.me.orientation)) < 20) go(c, 'roll');
      return { ...pullLift(c.me, B.U, 1), throttle: 1 };
    }
    if (c.mem.phase === 'roll') {
      if (B.U[1] > 0.8) go(c, 'out');
      return { ...bankAndPull(c.me, 0, 0.1), throttle: 1 };
    }
    return { ...pointNose(c.me, [-h0[0], 0, -h0[2]]), throttle: 1 };
  },
};
// The chaser: a player hunting him, not the lessons' cautious ace. Full
// throttle, the nose on where his rounds would meet the other, and his guns
// on whenever that shot would land inside 400 m (`GUN`).
PLANS.wiChaser = {
  title: 'After them, guns on', first: 'chase',
  says: { chase: 'After him, nose on the lead' },
  step(c) {
    const lead = leadPoint(c.me, c.him, c.gun);
    const d = [lead[0] - c.me.position[0], lead[1] - c.me.position[1], lead[2] - c.me.position[2]];
    const l = Math.hypot(...d) || 1;
    return { ...pointNose(c.me, [d[0] / l, d[1] / l, d[2] / l]), throttle: 1 };
  },
};
for (const id of ['wiInto', 'wiAway', 'wiUp', 'wiDive', 'wiRun', 'wiSplitS', 'wiImmelmann']) {
  INTENTS[id] ??= Object.fromEntries(Object.keys(PLANS[id].says).map(phase => [phase, 'defend']));
}
INTENTS.wiChaser ??= { chase: 'attack' };

/**
 * The ways out, in the order they are listed: the school's own plans that
 * start from any moment, then the plain manoeuvres above.
 */
export const WAYS_OUT = [
  { id: 'into', name: 'Break turn into them', plan: 'wiInto' },
  { id: 'away', name: 'Hard turn away', plan: 'wiAway' },
  { id: 'turnin', name: 'Turn in, then run', plan: 'olDip' },
  { id: 'chop', name: 'Turn, chop and pull up', plan: 'olFlip' },
  { id: 'up', name: 'Pull straight up', plan: 'wiUp' },
  { id: 'immelmann', name: 'Immelmann', plan: 'wiImmelmann' },
  { id: 'splits', name: 'Split-S', plan: 'wiSplitS' },
  { id: 'dive', name: 'Dive away', plan: 'wiDive' },
  { id: 'run', name: 'Run flat out', plan: 'wiRun' },
].filter(w => PLANS[w.plan]);

/** The chaser's plan: after him at full throttle, nose on the lead. */
export const CHASER = 'wiChaser';

/** A track sample as a flight state (`stateOf`'s shape), the velocity from
 *  the samples either side. */
export function stateAt(track, i, dt) {
  const a = track[Math.max(0, i - 1)], b = track[Math.min(track.length - 1, i + 1)];
  const span = (Math.min(track.length - 1, i + 1) - Math.max(0, i - 1)) * dt || dt;
  const k = track[i];
  const q = Array.isArray(k.q) ? k.q : [k.q.x, k.q.y, k.q.z, k.q.w];
  return {
    position: [...k.p],
    velocity: [(b.p[0] - a.p[0]) / span, (b.p[1] - a.p[1]) / span, (b.p[2] - a.p[2]) / span],
    orientation: { x: q[0], y: q[1], z: q[2], w: q[3] },
    angularVelocity: [0, 0, 0],
  };
}

/** The side in the other's sights at `t` (chased, the other's nose within
 *  `OUT_ANGLE` of him inside `OUT_RANGE`), or null when neither is. */
export function chasedAt(fight, t) {
  const i = Math.max(0, Math.min(fight.tracks[0].length - 1, Math.round(t / fight.dt)));
  for (const s of [0, 1]) {
    const g = geometry(stateAt(fight.tracks[s], i, fight.dt), stateAt(fight.tracks[1 - s], i, fight.dt));
    if (situation(g) === 'defensive' && g.hisAta < OUT_ANGLE && g.range < OUT_RANGE) return s;
  }
  return null;
}

/**
 * Score `side`'s next seconds in a fight (flown or recorded) from index
 * `i0`: the seconds he was in the other's line of fire, the seconds the
 * other had a shot that would land, the hits on him, his own shot on the
 * other, and whether he was shot down or flew into the ground.
 */
export function scoreSpan(fight, side, i0, seconds = SECONDS) {
  const dt = fight.dt;
  const me = fight.tracks[side], him = fight.tracks[1 - side];
  const i1 = Math.min(me.length - 1, i0 + Math.round(seconds / dt));
  let hisShot = 0, myShot = 0, exposed = 0;
  for (let i = i0; i <= i1; i++) {
    // A shot that would land, one rule for a recording and a flight alike.
    const a = stateAt(me, i, dt), b = stateAt(him, i, dt);
    const his = gunSolution(b, a, { range: GUN.range, width: 6 });
    if (his.fire) hisShot += dt;
    if (his.off < OFF_LEAD && his.dist <= GUN.range) exposed += dt;
    if (gunSolution(a, b, { range: GUN.range, width: 6 }).fire) myShot += dt;
  }
  const t0 = me[i0].t, t1 = me[i1].t;
  const hits = (fight.rounds ?? []).filter(r => r.side === 1 - side && r.hit && r.hitT >= t0 && r.hitT <= t1).length;
  const end = fight.end;
  const crashed = !!(end && end.why !== 'shot down' && end.winner !== side && end.t <= t1);
  const shotDown = !!(end && end.why === 'shot down' && end.winner === 1 - side && end.t <= t1);
  return {
    exposed: Math.round(exposed * 10) / 10, hisShot: Math.round(hisShot * 10) / 10, myShot: Math.round(myShot * 10) / 10, hits,
    crashed, shotDown,
  };
}

/** Lower is better: his shot on you, the hits, the time in his line of
 *  fire, less your own shot; the ground or his guns ending it outweigh all. */
export const badness = s => s.hisShot * 3 + s.hits * 0.5 + s.exposed - s.myShot + (s.crashed || s.shotDown ? 100 : 0);

/**
 * Fly every way out for `side` from time `t` of `fight`. `makePlanes` is
 * `[make for side 0, make for side 1]`, each building a fresh airframe.
 * Returns the recording's own next seconds scored, and each way out with its
 * flown fight (`runDuel`'s) and score, best first. `yieldEvery` lets a page
 * breathe between flights.
 */
export async function whatIf(fight, side, t, { makePlanes, seconds = SECONDS, groundAt = () => 0, yieldTo = null } = {}) {
  const i0 = Math.max(0, Math.min(fight.tracks[0].length - 2, Math.round(t / fight.dt)));
  const actual = scoreSpan(fight, side, i0, seconds);
  const states = [0, 1].map(s => stateAt(fight.tracks[s], i0, fight.dt));
  const results = [];
  for (const way of WAYS_OUT) {
    const sides = [];
    sides[side] = { plan: way.plan, state: states[side], throttle: 1, skill: 1 };
    sides[1 - side] = { plan: CHASER, state: states[1 - side], throttle: 1, skill: 1 };
    let flown;
    try {
      flown = runDuel({ makePlane: (_, i) => makePlanes[i](), sides, seconds, groundAt, gun: GUN });
    } catch (e) {
      results.push({ way, error: String(e?.message ?? e) });
      continue;
    }
    results.push({ way, flown, score: scoreSpan(flown, side, 0, seconds) });
    if (yieldTo) await yieldTo();
  }
  results.sort((a, b) => (a.score ? badness(a.score) : 1e9) - (b.score ? badness(b.score) : 1e9));
  return { side, t: fight.tracks[side][i0].t, i0, actual, results };
}

/**
 * The recorded fight up to `t`, then `flown` (a way out's flight from that
 * moment): one fight the theatre plays, sampled at the recording's `dt`.
 */
export function spliceFight(fight, i0, flown, label) {
  const dt = fight.dt, t0 = fight.tracks[0][i0].t;
  const n = Math.floor((flown.tracks[0].at(-1).t) / dt);
  const tracks = fight.tracks.map((tr, s) => {
    const head = tr.slice(0, i0);
    const tail = [];
    for (let k = 0; k <= n; k++) {
      const j = Math.min(flown.tracks[s].length - 1, Math.round(k * dt / flown.dt));
      const f = flown.tracks[s][j];
      tail.push({ ...f, t: Math.round((t0 + k * dt) * 1000) / 1000, p: [...f.p], q: [...f.q] });
    }
    return head.concat(tail);
  });
  const shift = e => ({ ...e, t: e.t + t0 });
  return {
    ...fight,
    tracks,
    duration: tracks[0].at(-1).t,
    events: fight.events.filter(e => e.t < t0 && e.phase !== 'kill').concat(flown.events.map(shift)),
    rounds: fight.rounds.filter(r => r.t < t0).map(r => ({ ...r, hit: r.hit && r.hitT < t0 }))
      .concat(flown.rounds.map(r => ({ ...r, t: r.t + t0, ...(r.hit ? { hitT: r.hitT + t0 } : {}) }))),
    hits: [0, 1].map(s => fight.rounds.filter(r => r.side === s && r.hit && r.hitT < t0).length + flown.rounds.filter(r => r.side === s && r.hit).length),
    end: flown.end ? { ...flown.end, t: flown.end.t + t0 } : null,
    whatIf: { label, t: t0 },
  };
}
