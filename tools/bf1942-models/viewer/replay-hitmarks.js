// The crosshair's hit marks in a replay's first person (features/round-replay-hud,
// "The hit marks").
//
// The game raises the local player's `CrossHair/HitIndicationTime` to 1.0 when
// one of his rounds hits a soldier, or a hull while someone sits in it, and
// runs it down to 0 over a second (ledger XHIT-3, XHIT-4, XHIT-5). On a
// dedicated server it reaches his client as one bool on his control object's
// state (XHIT-6), which the recorder does not read, so no recording holds it.
//
// It is worked out here instead, from two things every recording has: each
// round fired (`f`, its origin and axis) and each object's hit points (`a`). A
// hit is a victim's hit points dropping with a round passing through him in
// the moments before. When rounds from two players pass him, the drop is the
// round that passed closest, except the drop that kills him, which is the
// killer's: the kill log names him. One drop is one mark: the hit points come
// at the sample rate, so a burst whose rounds land inside one sample shows as
// one hit, which changes nothing on screen (each new mark only restarts the
// fade).
//
// Checked against what the server itself says (features/round-replay-hud):
// over five recordings, 92 to 100% of the kills made with a gun have the
// killer's mark within 0.8 s before the kill (median 0 to 0.07 s before), and
// the marks of a round number about what its round-end tallies of hits say.
//
// What it cannot see, and so never marks: a hit on a teammate with friendly
// fire off (the game marks it, but his hit points do not move), a hit the
// recording has no hit points for (a soldier out of the client's reach), and
// a bot's "fake" rounds (no `f` record). Explosions never mark in the game
// either (XHIT-4), so what is thrown or laid is left out.
//
// Imports only replay-recording.js, so `tests/replay_hitmarks_harness.mjs`
// runs it under node.

import { crewOf, positionAt } from './replay-recording.js';

/** Seconds a mark takes to fade from full to nothing (XHIT-3). */
export const HIT_MARK_FADE = 1;

/** Seconds a soldier's hit points may drop after the round that hit him: the
 *  round's flight, the server's tick and the hit points' trip back to the
 *  recording client. Measured against the server's own round-end tallies in
 *  replay_20261001-144253 (979 hand-weapon hits): 0.8 s holds all but a few. */
const SOLDIER_WINDOW = 0.8;
/** A hull's: a shell or a rocket flies for seconds (a bazooka's 50 m/s). */
const HULL_WINDOW = 2.5;
/** Seconds a drop may come before the round's own record (clock jitter). */
const LEAD = 0.05;
/** Metres a round may pass from a soldier's body and still be his hit: his
 *  position is sampled ten times a second and a remote shooter's view of him
 *  runs behind ours. */
const SOLDIER_MISS = 1;
/** A soldier's body about his recorded origin, metres: his feet to his head. */
const SOLDIER_FROM = -0.9;
const SOLDIER_TO = 0.7;
/** Metres a round may pass from a hull's origin: about a tank's half length. */
const HULL_MISS = 4;
/** Seconds a killing drop may sit from the kill that names it. */
const KILL_SLACK = 0.5;
/** Metres the killer's round may pass from the body he killed: the kill
 *  settles whose round it was, so only a round aimed well off is refused. */
const KILL_MISS = 3;
/** Seconds between the victim's positions tried along a round's flight. */
const STEP = 0.05;
/** Metres a second the mark is placed at along the round's path, capped by
 *  the drop: hand-weapon rounds fly 300 to 2000 m/s. */
const ROUND_SPEED = 700;

const _p = [0, 0, 0];

/** How far the ray from `o` along unit `d` passes from the vertical segment
 *  `p` + [from, to] (BF1942's +Y up), and how far along it; null behind. */
function passing(o, d, p, from, to) {
  let best = null;
  const n = from === to ? 1 : 4;
  for (let k = 0; k < n; k++) {
    const y = p[1] + from + ((to - from) * k) / Math.max(1, n - 1);
    const vx = p[0] - o[0];
    const vy = y - o[1];
    const vz = p[2] - o[2];
    const s = vx * d[0] + vy * d[1] + vz * d[2];
    if (s < 0) continue;
    const miss = Math.hypot(vx - s * d[0], vy - s * d[1], vz - s * d[2]);
    if (!best || miss < best.miss) best = { miss, along: s };
  }
  return best;
}

/** The closest a round passed `life` between its leaving and `until`. */
function closest(round, life, until, from, to) {
  let best = null;
  for (let t = round.t; t <= until + 1e-6; t += STEP) {
    if (!positionAt(life, t, _p)) continue;
    const near = passing(round.pos, round.unit, _p, from, to);
    if (near && (!best || near.miss < best.miss)) best = near;
  }
  return best;
}

/** The soldier life `pid` was at `t` (the body a kill names). */
function soldierOf(rec, pid, t) {
  let body = null;
  for (const life of rec.lives ?? []) {
    if (!life.soldier || life.pid !== pid || life.created > t + LEAD || t >= life.destroyed) continue;
    if (!body || life.created > body.created) body = life;
  }
  return body;
}

/**
 * Every player's hit marks: `Map<pid, number[]>`, the recording times at
 * which his rounds hit, in order. `thrown` is a Set of lower-case weapon
 * templates that throw or lay their round (replay-props.js
 * `networkedRounds`), left out.
 */
export function inferHitMarks(rec, { thrown = new Set() } = {}) {
  const rounds = [];
  for (const f of rec.fires ?? []) {
    if (f.press || !(f.pid >= 0) || !Array.isArray(f.pos) || !Array.isArray(f.dir)) continue;
    const weapon = String(f.weapon ?? '').toLowerCase();
    if (thrown.has(weapon)) continue;
    const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
    if (!(n > 0.1) || !f.pos.every(Number.isFinite)) continue;
    rounds.push({ t: f.t, pid: f.pid, nid: f.nid, weapon, pos: f.pos, unit: [f.dir[0] / n, f.dir[1] / n, f.dir[2] / n] });
  }
  rounds.sort((a, b) => a.t - b.t);
  const firstAfter = t => {
    let lo = 0;
    let hi = rounds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rounds[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const marks = new Map();
  const used = new Set();
  const mark = (pid, t) => {
    if (!marks.has(pid)) marks.set(pid, []);
    marks.get(pid).push(t);
  };

  // A kill names who landed the last hit. With a weapon whose rounds the
  // recording has (a gun, never a blast: the kill log names the weapon), the
  // drop that killed is his, whoever else's rounds passed closer, and so is a
  // mark when the recording has no hit points to see it drop.
  const killing = new Map();       // the killing drop -> the kill
  const unseen = [];               // kills with no drop to hang them on
  for (const kill of rec.kills ?? []) {
    if (kill.kind !== 'kill' || !(kill.killer >= 0) || kill.killer === kill.victim) continue;
    const weapon = String(kill.weapon ?? '').toLowerCase();
    if (!weapon || thrown.has(weapon)) continue;
    const body = soldierOf(rec, kill.victim, kill.t);
    let drop = null;
    for (const h of body?.hp ?? []) {
      if (h.hp <= 0 && Math.abs(h.t - kill.t) <= KILL_SLACK && (!drop || Math.abs(h.t - kill.t) < Math.abs(drop.t - kill.t))) drop = h;
    }
    if (drop) killing.set(drop, kill);
    else unseen.push({ kill, weapon });
  }

  for (const life of rec.lives ?? []) {
    if (!life.hp?.length || life.projectile || life.camera) continue;
    const soldier = Boolean(life.soldier);
    const window = soldier ? SOLDIER_WINDOW : HULL_WINDOW;
    const from = soldier ? SOLDIER_FROM : 0;
    const to = soldier ? SOLDIER_TO : 0;
    for (let i = 1; i < life.hp.length; i++) {
      const { t, hp } = life.hp[i];
      const before = life.hp[i - 1].hp;
      if (!(hp < before) || !(before > 0)) continue;
      // An empty hull has no team and never marks (XHIT-5).
      if (!soldier && !crewOf(rec, life, t).length) continue;
      const kill = killing.get(life.hp[i]) ?? null;
      const weapon = kill ? String(kill.weapon).toLowerCase() : null;
      const allowed = kill ? KILL_MISS : soldier ? SOLDIER_MISS : HULL_MISS;
      let best = null;
      for (let j = firstAfter(t - window); j < rounds.length && rounds[j].t <= t + LEAD; j++) {
        const round = rounds[j];
        if (round.nid === life.nid || used.has(round)) continue;
        if (kill && (round.pid !== kill.killer || round.weapon !== weapon)) continue;
        const near = closest(round, life, Math.max(round.t, t), from, to);
        if (near && near.miss < allowed && (!best || near.miss < best.miss)) best = { round, ...near };
      }
      if (!best) {
        if (kill) unseen.push({ kill, weapon });
        continue;
      }
      used.add(best.round);
      mark(best.round.pid, best.round.t + Math.min(Math.max(0, t - best.round.t), best.along / ROUND_SPEED));
    }
  }

  // A kill the hit points do not show: his last round of the weapon that
  // killed, if he fired one just before.
  for (const { kill, weapon } of unseen) {
    let last = null;
    for (let j = firstAfter(kill.t - SOLDIER_WINDOW); j < rounds.length && rounds[j].t <= kill.t + LEAD; j++) {
      const round = rounds[j];
      if (round.pid === kill.killer && round.weapon === weapon && !used.has(round)) last = round;
    }
    if (!last) continue;
    used.add(last);
    mark(kill.killer, last.t);
  }

  for (const list of marks.values()) list.sort((a, b) => a - b);
  return marks;
}

/** `CrossHair/HitIndicationTime` at `t` from one player's marks: 1 at a
 *  mark, down by the second to 0 (XHIT-3), a new mark starting it again. */
export function hitMarkAt(times, t) {
  if (!times?.length || !(t >= times[0])) return 0;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, 1 - (t - times[lo - 1]) / HIT_MARK_FADE);
}
