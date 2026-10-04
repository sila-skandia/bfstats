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
// hit is a victim's hit points dropping just after a round reached him: the
// round passing through his body where he stood when it got there, flying at
// its weapon's muzzle velocity (`damage.json`'s, which the page's drawn round
// flies at too). The mark goes up when the round arrives, not when it is
// fired.
//
// When rounds from two players reach him, the drop is the one whose round
// passed closest, except the drop that kills him, which is the killer's: the
// kill log names him. Of that player's rounds, the drop is the one whose
// arrival best explains when it came: a remote shooter's hit points drop a
// median 0.06 s after his round arrives, the recording player's own about
// 0.24 s after (the trip to the server and back). One drop is one mark: the
// hit points come at the sample rate, so a burst whose rounds land inside one
// sample shows as one hit, which changes nothing on screen (each new mark
// only restarts the fade).
//
// What it cannot see, and so never marks: a hit on a teammate with friendly
// fire off (the game marks it, but his hit points do not move), a hit the
// recording has no hit points for (a soldier out of the client's reach), and
// a bot's "fake" rounds (no `f` record). Explosions never mark in the game
// either (XHIT-4), so what is thrown or laid is left out, and so is a flak
// shell that reached a moving hull: its proximity fuse burst it beside the
// hull first (PROX-3), and the drop is the burst's.
//
// Imports only replay-recording.js, so `tests/replay_hitmarks_harness.mjs`
// runs it under node.

import { crewOf, positionAt } from './replay-recording.js';

/** Seconds a mark takes to fade from full to nothing (XHIT-3). */
export const HIT_MARK_FADE = 1;

/** Seconds a victim's hit points may drop after the round reached him (the
 *  server's tick, the trip back to the recording client, its 10 Hz samples),
 *  and before it (clock jitter). Over 92 single-round kills with a bolt
 *  rifle or a pistol in five recordings, a remote shooter's drop came -0.05
 *  to 0.23 s after the round's arrival, median 0.06. */
const AFTER = 0.6;
const LEAD = 0.05;
/** The same for a weapon whose speed is not known: its round may be a slow
 *  one, and land well after a stock speed has it. */
const AFTER_UNKNOWN = 1.5;
/** Seconds the drop is expected after the arrival: the recording player's
 *  own rounds go to the server and the hit points come back. */
const LOCAL_LAG = 0.24;
const REMOTE_LAG = 0.06;
/** Seconds the slowest round is let fly (a bazooka's 85 m/s over 300 m). */
const MAX_FLIGHT = 4;
/** Metres a second for a weapon `damage.json` does not list (most guns fly
 *  1000, aircraft guns 400, cannon 300). */
const DEFAULT_SPEED = 700;
/** Seconds either side of the arrival the victim's place is tried at: his
 *  samples come ten times a second, and a remote shooter's view of him runs
 *  behind ours. */
const SPREAD = 0.1;
/** Metres a round may pass from a soldier's body and still be his hit. */
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
/** The furthest a round is followed, metres. */
const MAX_RANGE = 1500;
/** A proximity fuse goes off only for a target moving this fast, m/s
 *  (PROX-3, proximity-fuse.js `FUSE_MIN_SPEED_SQ`). Soldiers never set one
 *  off (PROX-2). */
const FUSE_MIN_SPEED = 2.5;

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

/** Where `round` met `life`: `{ miss, along, arrival }` with the victim
 *  where he was when the round got to him, or null if it never came near
 *  the way it was going. */
function meeting(round, life, from, to) {
  if (!positionAt(life, round.t, _p)) return null;
  const first = passing(round.pos, round.unit, _p, from, to);
  if (!first || first.along > MAX_RANGE) return null;
  // Where he was when it got there, a sample either side.
  const arrival = round.t + first.along / round.speed;
  let best = null;
  for (const dt of [-SPREAD, 0, SPREAD]) {
    if (!positionAt(life, arrival + dt, _p)) continue;
    const at = passing(round.pos, round.unit, _p, from, to);
    if (at && (!best || at.miss < best.miss)) best = at;
  }
  if (!best) return null;
  return { miss: best.miss, along: best.along, arrival: round.t + best.along / round.speed };
}

/** How fast `life` was going at `t`, m/s, from the samples either side. */
function speedAt(life, t) {
  const a = positionAt(life, t - SPREAD, [0, 0, 0]);
  const b = positionAt(life, t + SPREAD, [0, 0, 0]);
  if (!a || !b) return 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * SPREAD);
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

/** How far `arrival` is from explaining something seen at `t`. */
const misfit = (round, arrival, t) => Math.abs(t - (arrival + (round.local ? LOCAL_LAG : REMOTE_LAG)));

/**
 * Every player's hit marks: `Map<pid, number[]>`, the recording times at
 * which his rounds hit, in order. `thrown` is a Set of lower-case weapon
 * templates that throw or lay their round (replay-props.js
 * `networkedRounds`), left out. `speedOf(weapon)` is a lower-case weapon
 * template's muzzle velocity in m/s, and `fuseOf(weapon)` its round's
 * proximity fuse in metres, each null where it is not known or none.
 */
export function inferHitMarks(rec, { thrown = new Set(), speedOf = () => null, fuseOf = () => null } = {}) {
  const rounds = [];
  for (const f of rec.fires ?? []) {
    if (f.press || !(f.pid >= 0) || !Array.isArray(f.pos) || !Array.isArray(f.dir)) continue;
    const weapon = String(f.weapon ?? '').toLowerCase();
    if (thrown.has(weapon)) continue;
    // A rack that lets go at no speed drops its round, not along its axis.
    const known = speedOf(weapon);
    if (known === 0) continue;
    const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
    if (!(n > 0.1) || !f.pos.every(Number.isFinite)) continue;
    rounds.push({
      t: f.t, pid: f.pid, nid: f.nid, weapon, local: Boolean(f.local), pos: f.pos,
      unit: [f.dir[0] / n, f.dir[1] / n, f.dir[2] / n], speed: known > 0 ? known : DEFAULT_SPEED,
      after: known > 0 ? AFTER : AFTER_UNKNOWN, fused: fuseOf(weapon) > 0,
    });
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
      const reached = [];
      for (let j = firstAfter(t - MAX_FLIGHT - AFTER_UNKNOWN); j < rounds.length && rounds[j].t <= t + LEAD; j++) {
        const round = rounds[j];
        if (round.nid === life.nid || used.has(round)) continue;
        if (kill && (round.pid !== kill.killer || round.weapon !== weapon)) continue;
        // Too far back for even the longest flight to land in time.
        if (round.speed * (t - round.after - round.t) > MAX_RANGE) continue;
        const met = meeting(round, life, from, to);
        if (!met || met.miss >= allowed || met.arrival < t - round.after || met.arrival > t + LEAD) continue;
        // A fused round bursts beside a moving hull before it touches it.
        const burst = !soldier && round.fused && speedAt(life, met.arrival) >= FUSE_MIN_SPEED;
        reached.push({ round, ...met, burst });
      }
      if (!reached.length) {
        if (kill) unseen.push({ kill, weapon });
        continue;
      }
      // Whose: the player whose round passed closest. Which: of his, the
      // round whose arrival best explains when the drop came.
      let shooter = reached[0];
      for (const r of reached) if (r.miss < shooter.miss) shooter = r;
      let best = null;
      for (const r of reached) {
        if (r.round.pid !== shooter.round.pid) continue;
        if (!best || misfit(r.round, r.arrival, t) < misfit(best.round, best.arrival, t)) best = r;
      }
      used.add(best.round);
      if (!best.burst) mark(best.round.pid, best.arrival);
    }
  }

  // A kill the hit points do not show: the kill is announced as a drop would
  // be, so his round of that weapon whose arrival best explains it. Where he
  // was is not known well enough (he was out of the client's reach), so the
  // mark goes up as long before the kill as a drop would follow the hit.
  for (const { kill, weapon } of unseen) {
    let best = null;
    for (let j = firstAfter(kill.t - MAX_FLIGHT - AFTER_UNKNOWN); j < rounds.length && rounds[j].t <= kill.t + LEAD; j++) {
      const round = rounds[j];
      if (round.pid !== kill.killer || round.weapon !== weapon || used.has(round)) continue;
      const lag = round.local ? LOCAL_LAG : REMOTE_LAG;
      if (round.t > kill.t - lag + LEAD) continue;
      if (!best || round.t > best.t) best = round;
    }
    if (!best) continue;
    used.add(best);
    mark(kill.killer, Math.max(best.t, kill.t - (best.local ? LOCAL_LAG : REMOTE_LAG)));
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
