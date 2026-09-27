// Where a replayed round's fighting is (features/round-replay-highlights):
// every shot, kill and hit the recording has, placed on the level, gathered
// into battles that live and move through the round, and who is where at a
// time -- on foot, in what, alone, behind the enemy's flags or nowhere near
// a fight. Pure functions of the parsed recording (replay-recording.js), so
// `tests/replay_highlights_harness.mjs` runs them under node.
//
// Positions here are in the viewer's frame (BF1942's with z negated,
// replay-actors.js `toViewPosition`), which is the frame the level's map art
// is projected from (`extras.minimap.worldToImage`) and the 3D view draws in.
//
// The recording only knows what the server sent the recording player's
// client: nothing beyond the level's view distance from him (Wake's 500 m,
// Kursk's 400 m, a few per cent more in practice; replay-chapters.js
// `outOfRange`). A shot is recorded only if its shooter was in range, and a
// player out of range has only his last position. Everything below keeps to
// what was live -- `fresh` -- and says when something is only last seen.

import {
  controlledAt, crewOf, isReplicated, lifeAt, positionAt, primaryWeaponFor, rootOf, sampleAt,
} from './replay-recording.js';
import { playerStatusAt, pointsAt } from './replay-chapters.js';

// --- tuning -----------------------------------------------------------------------

/** The battles' clock: one clustering every STEP seconds of the round. */
export const STEP = 0.5;
/** What a battle is made of at a moment: the activity of the last WINDOW
 *  seconds, each event weighed down by exp(-age / DECAY). */
const WINDOW = 12;
const DECAY = 5;
/** Events this close to a battle's centre are part of it, metres. */
const RADIUS = 65;
/** A battle below this heat is not one; one at SHOW heat or more is listed. */
const MIN_HEAT = 2.2;
/** A battle last seen this long ago has ended, seconds. */
const TRACK_GAP = 4;
/** A battle has to have lasted this long, or burned this hot, to be kept. */
const MIN_LIFE = 3;
const MIN_PEAK = 5;

/** What each kind of event weighs. A burst of automatic fire is one shooter
 *  firing: shots are counted per shooter per half-second, so a machine gun
 *  and a bolt-action rifle each put 1 on the fight for every half-second
 *  they are shooting. Heavy weapons (a tank's gun, a bomb, a rocket) count
 *  double. */
const WEIGHT = { shot: 1, heavy: 2, kill: 6, wreck: 7, hullHit: 1.5, hit: 1 };
const SHOT_BIN = 0.5;
const HEAVY = /GunBarrel|Cannon|Bomb|Rocket|Torpedo|Mortar|Howitzer|Artillery|shreck|Bazooka|Flak|_AA|AA_|Grenade|Satchel|ExpPack|Mine|Priest|Wespe|Katyusha|Sexton|Calliope|Nebelwerfer|Destroyer|Hatsuzuki|Fletcher|Carrier|Battleship|Yamato|Missouri/i;

/** A player out of range is placed where he was last seen, for this long;
 *  after it he is somewhere unknown. Seconds. */
const LAST_SEEN_KEEP = 20;

/** Where someone stands among the round's people, metres. */
const LONER = {
  teammate: 150,       // no teammate nearer than this ...
  enemy: 160,          // ... with an enemy this close: a lone wolf
  farFight: 320,       // no battle nearer than this, and no enemy within `farEnemy`
  farEnemy: 220,
  flagNear: 110,       // this close to a flag the enemy holds ...
  flagFriend: 70,      // ... with no teammate this close: behind the lines
  nestStill: 8,        // a scout who has moved less than this ...
  nestFor: 15,         // ... over this many seconds, and fired in the last `nestShot`
  nestShot: 20,
  hold: 5,             // seconds a condition has to hold before it is shown
  spawnGrace: 20,      // a man this fresh from his spawn is on his way, not far away
};

// --- small geometry --------------------------------------------------------------

/** A recorded BF1942 position in the viewer's frame. */
export const toView = p => [p[0], p[1], -p[2]];

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const otherSide = team => (team === 1 ? 2 : team === 2 ? 1 : 0);

/** Whose side a life is on at `t`: a soldier's player's, a hull's own
 *  recorded team, else its crew's. */
function sideOf(rec, life, t) {
  if (life.soldier) return rec.players.get(life.pid)?.team ?? life.team ?? 0;
  if (life.team === 1 || life.team === 2) return life.team;
  const crew = crewOf(rec, life, t);
  return crew.length ? rec.players.get(crew[0].pid)?.team ?? 0 : 0;
}

/** The forward direction on the ground of a recorded life at `t`, in the
 *  viewer's frame, as `[x, z]` (unit), or null: its -Z in the viewer's
 *  frame, a soldier's as a vehicle's. The half turn a soldier's pose glb
 *  carries (replay-actors.js `SOLDIER_YAW_FLIP`) is the model's, not the
 *  recording's. */
export function headingAt(life, t) {
  const s = sampleAt(life, t);
  if (!s) return null;
  const q = s.a.q;
  // The recorded quaternion (x, y, z, w) is (-x, -y, z, w) in the viewer's
  // frame (replay-actors.js `toViewQuaternion`).
  let [x, y, z, w] = [-q[0], -q[1], q[2], q[3]];
  if (s.b) {
    const b = s.b.q;
    const bq = [-b[0], -b[1], b[2], b[3]];
    const dot = x * bq[0] + y * bq[1] + z * bq[2] + w * bq[3];
    const sign = dot < 0 ? -1 : 1;
    x += (sign * bq[0] - x) * s.k; y += (sign * bq[1] - y) * s.k;
    z += (sign * bq[2] - z) * s.k; w += (sign * bq[3] - w) * s.k;
  }
  // q applied to (0, 0, -1): the third column of its rotation matrix, negated.
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  const n = Math.hypot(fx, fz);
  return n > 1e-6 ? [fx / n, fz / n] : null;
}

/** An 8-point compass word for a ground direction in the viewer's frame, with
 *  north up the level's map art (-Z) and east along +X. */
export function compass(dx, dz) {
  const a = Math.atan2(dx, -dz);   // 0 north, clockwise
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i];
}

// --- who is where ------------------------------------------------------------------

/**
 * Where `pid` is at `t` and in what: `{ pid, team, state, life, seat, pos,
 * fresh, seen }` with `state` as `playerStatusAt` has it, `pos` in the
 * viewer's frame (null when nothing of him has been seen), `fresh` whether
 * the recording had him live then, and `seen` the time of that position
 * (his last sighting when he is out of range). Only the living are placed.
 */
export function whereIs(rec, pid, t, kills = rec.kills) {
  const status = playerStatusAt(rec, pid, t, kills);
  const team = rec.players.get(pid)?.team ?? 0;
  const out = { pid, team, state: status.state, life: status.life ?? null, seat: status.seat ?? 0,
                pos: null, fresh: false, seen: null };
  if (status.state !== 'foot' && status.state !== 'vehicle') return out;
  const life = status.life;
  if (isReplicated(life, t)) {
    const p = positionAt(life, t);
    if (p) {
      out.pos = toView(p);
      out.fresh = true;
      out.seen = t;
    }
    return out;
  }
  // Out of range: where the recording last had him, while it is recent.
  let since = null;
  for (const [, to] of life.replicated) if (to <= t && (since === null || to > since)) since = to;
  if (since === null) {
    // Never replicated: the creation event's place, if it is recent.
    if (life.pose && t - life.created <= LAST_SEEN_KEEP) {
      out.pos = toView(life.pose.p);
      out.seen = life.created;
    }
    return out;
  }
  if (t - since <= LAST_SEEN_KEEP) {
    const p = positionAt(life, since);
    if (p) {
      out.pos = toView(p);
      out.seen = since;
    }
  }
  return out;
}

/** Everyone the recording knows of, placed at `t` (`whereIs`). */
export function everyoneAt(rec, t, kills = rec.kills) {
  const pids = new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])]);
  return [...pids].map(pid => whereIs(rec, pid, t, kills));
}

// --- the round's activity ---------------------------------------------------------

/**
 * Every recorded thing that says there is fighting somewhere, in time order:
 * `{ t, pos, w, team, pid, kind }` with `kind` one of shot (a shooter's
 * half-second of fire, heavy weapons weighing double), kill (where the man
 * died), wreck (a hull destroyed), hullHit and hit (hit points lost).
 *
 * `serverRows` (replay-server-log.js `serverRows`, aligned) place a kill the
 * recording only heard about: the server logs every death where it happened,
 * in range of the recording or not.
 */
export function activityOf(rec, kills = rec.kills, serverRows = []) {
  const events = [];
  const teamOf = pid => (pid === null || pid === undefined ? 0 : rec.players.get(pid)?.team ?? 0);

  // Shots, a shooter's half-second at a time. A v4 recording's trigger
  // presses repeat its rounds (`feedOnly`), and v3's oldest carry no place.
  const bins = new Map();
  for (const f of rec.fires) {
    if (f.feedOnly || !Array.isArray(f.pos)) continue;
    if (!f.pos[0] && !f.pos[1] && !f.pos[2]) continue;
    const who = f.pid ?? `n${f.nid}`;
    const key = `${who}|${Math.floor(f.t / SHOT_BIN)}`;
    let bin = bins.get(key);
    if (!bin) {
      bin = { t: f.t, sum: [0, 0, 0], n: 0, heavy: false, pid: f.pid ?? null, team: teamOf(f.pid) };
      if (!bin.team && f.nid !== null && f.nid !== undefined) bin.team = lifeAt(rec, f.nid, f.t)?.team ?? 0;
      bins.set(key, bin);
    }
    const p = toView(f.pos);
    bin.sum[0] += p[0]; bin.sum[1] += p[1]; bin.sum[2] += p[2];
    bin.n++;
    if (HEAVY.test(f.weapon ?? '')) bin.heavy = true;
  }
  for (const bin of bins.values()) {
    events.push({ t: bin.t, pos: bin.sum.map(v => v / bin.n), w: bin.heavy ? WEIGHT.heavy : WEIGHT.shot,
                  team: bin.team, pid: bin.pid, kind: 'shot' });
  }

  // Kills, where the man died.
  for (const k of kills) {
    const pos = killPosition(rec, k, serverRows);
    if (!pos) continue;
    events.push({ t: k.t, pos, w: WEIGHT.kill, team: teamOf(k.killer), pid: k.killer ?? null,
                  victim: k.victim, kind: 'kill' });
  }

  // Hit points lost: a hull's hits and its wreck, a soldier's wounds, where
  // the recording saw them, as the other side's fire. Not a hull's steady
  // loss of the same few points every half-second (a beached landing craft,
  // a tank in deep water) nor a burning hull's drain below its critical
  // damage: those are no fight.
  for (const life of rec.lives) {
    if (life.kit || life.controlPoint || life.camera || life.projectile || !life.tmpl) continue;
    const drops = [];
    for (let i = 1; i < life.hp.length; i++) {
      const before = life.hp[i - 1].hp;
      const after = life.hp[i].hp;
      if (after < before - 0.5) drops.push({ t: life.hp[i].t, before, after, size: before - after });
    }
    drops.forEach((d, i) => {
      const steady = [drops[i - 1], drops[i + 1]].some(o => o && Math.abs(o.size - d.size) < 0.05
        && Math.abs(o.t - d.t) < 1.1);
      const burning = life.crit > 0 && d.before <= life.crit;
      const wreck = d.after <= 0 && d.before > 0 && !life.soldier;
      if ((steady || burning) && !wreck) return;
      if (!isReplicated(life, d.t)) return;
      const p = positionAt(life, d.t);
      if (!p) return;
      events.push({ t: d.t, pos: toView(p), w: wreck ? WEIGHT.wreck : life.soldier ? WEIGHT.hit : WEIGHT.hullHit,
                    team: otherSide(sideOf(rec, life, d.t)), pid: null,
                    kind: wreck ? 'wreck' : life.soldier ? 'hit' : 'hullHit', life });
    });
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** Where a kill happened: the victim where the recording saw him die, else
 *  where the server logged his death, else the killer where the recording
 *  saw him. Null when nothing placed it. */
export function killPosition(rec, k, serverRows = []) {
  const at = pid => {
    const w = whereIs(rec, pid, k.t - 0.05);
    return w.fresh ? w.pos : null;
  };
  if (k.victim !== null && k.victim !== undefined) {
    const p = at(k.victim);
    if (p) return p;
    const row = serverRows.find(r => r.kind === 'scoreEvent' && r.pid === k.victim && Array.isArray(r.at)
      && /death/i.test(r.scoreType ?? '') && Math.abs(r.t - k.t) < 1.5);
    if (row) return toView(row.at);
  }
  if (k.killer !== null && k.killer !== undefined && k.killer !== k.victim) {
    const p = at(k.killer);
    if (p) return p;
    const row = serverRows.find(r => r.kind === 'scoreEvent' && r.pid === k.killer && Array.isArray(r.at)
      && /kill/i.test(r.scoreType ?? '') && Math.abs(r.t - k.t) < 1.5);
    if (row) return toView(row.at);
  }
  return null;
}

/** The round's activity per `bucket` seconds, for the timeline: `{ bucket,
 *  total, team1, team2, max }`, each a Float32Array. */
export function intensityOf(activity, duration, bucket = 1) {
  const n = Math.max(1, Math.ceil(duration / bucket) + 1);
  const total = new Float32Array(n);
  const team1 = new Float32Array(n);
  const team2 = new Float32Array(n);
  for (const e of activity) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(e.t / bucket)));
    total[i] += e.w;
    if (e.team === 1) team1[i] += e.w;
    else if (e.team === 2) team2[i] += e.w;
  }
  let max = 0;
  for (const v of total) max = Math.max(max, v);
  return { bucket, total, team1, team2, max };
}

// --- battles ----------------------------------------------------------------------

/** One moment's clusters of activity: `[{ pos, r, heat, teams, pids, kills,
 *  shots }]`, hottest first. */
function clusterAt(events, t) {
  const live = [];
  for (const e of events) {
    const age = t - e.t;
    if (age < 0 || age > WINDOW) continue;
    live.push({ e, w: e.w * Math.exp(-age / DECAY), taken: false });
  }
  live.sort((a, b) => b.w - a.w);
  const clusters = [];
  for (const seed of live) {
    if (seed.taken) continue;
    let cx = seed.e.pos[0];
    let cz = seed.e.pos[2];
    let members = [];
    // Two passes: gather round the seed, then round the members' centre.
    for (let pass = 0; pass < 2; pass++) {
      members = live.filter(m => !m.taken && Math.hypot(m.e.pos[0] - cx, m.e.pos[2] - cz) <= RADIUS);
      let sw = 0;
      let sx = 0;
      let sz = 0;
      for (const m of members) { sw += m.w; sx += m.e.pos[0] * m.w; sz += m.e.pos[2] * m.w; }
      if (sw > 0) { cx = sx / sw; cz = sz / sw; }
    }
    if (!members.length) members = [seed];
    for (const m of members) m.taken = true;
    let heat = 0;
    let sy = 0;
    let spread = 0;
    const teams = [0, 0, 0];
    const pids = new Set();
    let kills = 0;
    let shots = 0;
    for (const m of members) {
      heat += m.w;
      sy += m.e.pos[1] * m.w;
      spread += m.w * ((m.e.pos[0] - cx) ** 2 + (m.e.pos[2] - cz) ** 2);
      teams[m.e.team === 1 || m.e.team === 2 ? m.e.team : 0] += m.w;
      if (m.e.pid !== null && m.e.pid !== undefined) pids.add(m.e.pid);
      if (m.e.victim !== null && m.e.victim !== undefined) pids.add(m.e.victim);
      if (m.e.kind === 'kill') kills++;
      if (m.e.kind === 'shot') shots++;
    }
    clusters.push({
      pos: [cx, heat > 0 ? sy / heat : seed.e.pos[1], cz],
      r: Math.max(18, Math.sqrt(spread / Math.max(heat, 1e-6)) * 1.6),
      heat, teams, pids: [...pids], kills, shots,
    });
  }
  // Two clusters closer than a battle's reach are one fight.
  for (let i = 0; i < clusters.length; i++) {
    for (let j = clusters.length - 1; j > i; j--) {
      const a = clusters[i];
      const b = clusters[j];
      if (Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > RADIUS) continue;
      const w = a.heat + b.heat;
      a.pos = a.pos.map((v, k) => (v * a.heat + b.pos[k] * b.heat) / w);
      a.r = Math.max(a.r, b.r, Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
      a.heat = w;
      a.teams = a.teams.map((v, k) => v + b.teams[k]);
      a.pids = [...new Set([...a.pids, ...b.pids])];
      a.kills += b.kills;
      a.shots += b.shots;
      clusters.splice(j, 1);
    }
  }
  return clusters.filter(c => c.heat >= MIN_HEAT).sort((a, b) => b.heat - a.heat);
}

/** Whether both sides are fighting in a moment of a battle, not one side
 *  shooting at nothing that shoots back. */
export const contested = s => Math.min(s.teams[1], s.teams[2]) >= 0.2 * s.heat
  || (s.teams[1] > 0 && s.teams[2] > 0 && s.kills > 0);

/**
 * The round's battles: each a track through time, `{ id, start, end, peak,
 * peakT, samples: [{ t, pos, r, heat, teams, pids, kills, shots }], pids,
 * kills }`, sampled every STEP seconds while it burns. A battle is followed
 * from one moment to the next by the nearest cluster within reach, so it can
 * drift along a beach or up a road and stay the same battle.
 */
export function battlesOf(activity, duration) {
  const tracks = [];
  let open = [];
  let nextId = 1;
  const steps = Math.ceil(duration / STEP);
  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    const clusters = clusterAt(activity, t);
    const claimed = new Set();
    const pairs = [];
    for (const track of open) {
      const last = track.samples[track.samples.length - 1];
      clusters.forEach((c, ci) => {
        const d = Math.hypot(c.pos[0] - last.pos[0], c.pos[2] - last.pos[2]);
        if (d <= RADIUS * 1.5) pairs.push({ track, ci, d });
      });
    }
    pairs.sort((a, b) => a.d - b.d);
    const extended = new Set();
    for (const { track, ci } of pairs) {
      if (claimed.has(ci) || extended.has(track)) continue;
      claimed.add(ci);
      extended.add(track);
      track.samples.push({ t, ...clusters[ci] });
      track.end = t;
    }
    clusters.forEach((c, ci) => {
      if (claimed.has(ci)) return;
      const track = { id: nextId++, start: t, end: t, samples: [{ t, ...c }] };
      tracks.push(track);
      open.push(track);
    });
    open = open.filter(track => t - track.end <= TRACK_GAP);
  }
  const kept = [];
  for (const track of tracks) {
    let peak = 0;
    let peakT = track.start;
    const pids = new Set();
    for (const s of track.samples) {
      if (s.heat > peak) { peak = s.heat; peakT = s.t; }
      for (const pid of s.pids) pids.add(pid);
    }
    if (track.end - track.start < MIN_LIFE && peak < MIN_PEAK) continue;
    track.peak = peak;
    track.peakT = peakT;
    track.pids = [...pids];
    // The kills that happened in it: every kill event near its path.
    track.kills = activity.filter(e => e.kind === 'kill' && e.t >= track.start - 1 && e.t <= track.end + 1
      && track.samples.some(s => Math.abs(s.t - e.t) <= STEP * 2 && Math.hypot(s.pos[0] - e.pos[0], s.pos[2] - e.pos[2]) <= s.r + RADIUS / 2)).length;
    track.contested = track.samples.some(contested);
    kept.push(track);
  }
  return kept;
}

/** The battles burning at `t`, each as its track and its sample then:
 *  `[{ track, s }]`, hottest first. */
export function battlesAt(battles, t) {
  const out = [];
  for (const track of battles) {
    if (t < track.start - STEP / 2 || t > track.end + STEP / 2) continue;
    const i = Math.min(track.samples.length - 1, Math.max(0, lowerIndex(track.samples, t)));
    const s = track.samples[i];
    if (Math.abs(s.t - t) > TRACK_GAP) continue;
    out.push({ track, s });
  }
  return out.sort((a, b) => b.s.heat - a.s.heat);
}

/** The index of the last sample at or before `t` (0 before the first). */
function lowerIndex(list, t) {
  let lo = 0;
  let hi = list.length - 1;
  if (t < list[0].t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A place on the level in words: the control point it is at or near, by its
 *  shown name, else open ground. `points` are `{ name, pos }` in the viewer's
 *  frame; `display` turns a point's name into the words the game shows. */
export function placeName(pos, points, display = n => n) {
  let best = null;
  for (const p of points) {
    if (!p.pos) continue;
    const d = Math.hypot(p.pos[0] - pos[0], p.pos[2] - pos[2]);
    if (!best || d < best.d) best = { p, d };
  }
  if (!best) return 'Open ground';
  const name = display(best.p.name);
  if (best.d <= 120) return name;
  if (best.d <= 380) return `${compass(pos[0] - best.p.pos[0], pos[2] - best.p.pos[2])} of ${name}`;
  return 'Open ground';
}

/** The recording's control points in the viewer's frame: `{ id, name, pos }`. */
export function pointsOf(rec) {
  return [...(rec.controlPoints?.values() ?? [])]
    .map(p => ({ id: p.id, name: p.name, tmpl: p.tmpl, pos: Array.isArray(p.pos) ? toView(p.pos) : null }));
}

// --- who stands out ------------------------------------------------------------------

/**
 * Who stands apart from the round at each second: a timeline per player,
 * `Map<pid, [{ kind, start, end, detail }]>`, with `kind` one of
 * - `lone`: no teammate within 150 m, an enemy within 160 m;
 * - `behind`: at a flag the enemy holds, no teammate near;
 * - `far`: no battle within 320 m and no enemy within 220 m;
 * - `nest`: a scout holding still and shooting.
 * Only while the recording had him live, and only once it has held for five
 * seconds. `detail` carries the distance that decided it.
 */
export function standoutsOf(rec, battles, { kills = rec.kills, loadouts = null, kindOf = null } = {}) {
  const out = new Map();
  const points = pointsOf(rec);
  const pids = [...new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])])];
  const runs = new Map(pids.map(pid => [pid, null]));
  const history = new Map(pids.map(pid => [pid, []]));   // fresh positions, a second apart
  const lastShot = new Map();
  const fires = rec.fires.filter(f => !f.feedOnly && f.pid !== null && f.pid !== undefined);
  let fi = 0;
  const end = Math.floor(rec.duration);
  const close = (pid, t) => {
    const run = runs.get(pid);
    if (!run) return;
    if (run.last - run.start >= LONER.hold) {
      if (!out.has(pid)) out.set(pid, []);
      out.get(pid).push({ kind: run.kind, start: run.start + LONER.hold, end: run.last + 1, detail: run.detail });
    }
    runs.set(pid, null);
  };
  for (let t = 0; t <= end; t++) {
    while (fi < fires.length && fires[fi].t <= t) { lastShot.set(fires[fi].pid, fires[fi].t); fi++; }
    const everyone = pids.map(pid => whereIs(rec, pid, t, kills));
    const placed = everyone.filter(w => w.pos && t - w.seen <= 15);
    const burning = battlesAt(battles, t).map(b => b.s);
    const held = pointsAt(rec, t);
    for (const w of everyone) {
      const hist = history.get(w.pid);
      if (!w.fresh) {
        close(w.pid, t);
        hist.length = 0;
        continue;
      }
      hist.push({ t, pos: w.pos });
      while (hist.length && t - hist[0].t > LONER.nestFor) hist.shift();
      // A pilot is always far from everyone: the air is his own story.
      const flying = w.state === 'vehicle' && isAircraft(w.life, kindOf);
      let kind = null;
      let detail = null;
      if (!flying && (w.team === 1 || w.team === 2)) {
        let mate = Infinity;
        let enemy = Infinity;
        for (const o of placed) {
          if (o.pid === w.pid) continue;
          const d = dist2(o.pos, w.pos);
          if (o.team === w.team) mate = Math.min(mate, d);
          else if (o.team === 1 || o.team === 2) enemy = Math.min(enemy, d);
        }
        let fight = Infinity;
        for (const s of burning) fight = Math.min(fight, Math.max(0, dist2(s.pos, w.pos) - s.r));
        let enemyFlag = null;
        for (const p of points) {
          const owner = held.find(h => h.name === p.name)?.team;
          if (!p.pos || !owner || owner === w.team || owner <= 0) continue;
          const d = dist2(p.pos, w.pos);
          if (d <= LONER.flagNear && (!enemyFlag || d < enemyFlag.d)) enemyFlag = { p, d };
        }
        const scout = w.state === 'foot' && /sniper/i.test(primaryWeaponFor(w.life, loadouts) ?? '');
        const still = hist.length >= 2 && t - hist[0].t >= LONER.nestFor - 1
          && hist.every(h => dist2(h.pos, w.pos) <= LONER.nestStill);
        const shooting = t - (lastShot.get(w.pid) ?? -Infinity) <= LONER.nestShot;
        if (enemyFlag && mate > LONER.flagFriend) {
          kind = 'behind';
          detail = { d: Math.round(enemyFlag.d), point: enemyFlag.p.name };
        } else if (scout && still && shooting) {
          kind = 'nest';
          detail = { d: Number.isFinite(enemy) ? Math.round(enemy) : null };
        } else if (mate > LONER.teammate && enemy <= LONER.enemy) {
          kind = 'lone';
          detail = { d: Number.isFinite(mate) ? Math.round(mate) : null };
        } else if (Number.isFinite(fight) && fight > LONER.farFight && enemy > LONER.farEnemy
          && t - spawnedAt(rec, w.pid, t) > LONER.spawnGrace) {
          kind = 'far';
          detail = { d: Number.isFinite(fight) ? Math.round(fight) : null };
        }
      }
      const run = runs.get(w.pid);
      if (run && run.kind === kind) {
        run.last = t;
        run.detail = detail;
      } else {
        close(w.pid, t);
        if (kind) runs.set(w.pid, { kind, start: t, last: t, detail });
      }
    }
  }
  for (const pid of pids) close(pid, end + 1);
  return out;
}

/** When `pid`'s current soldier was made: his last spawn at or before `t`. */
function spawnedAt(rec, pid, t) {
  let at = -Infinity;
  for (const l of rec.lives) if (l.soldier && l.pid === pid && l.created <= t && l.created > at) at = l.created;
  return at;
}

/** The standout `pid` is at `t`, from `standoutsOf`, or null. */
export function standoutAt(standouts, pid, t) {
  for (const run of standouts.get(pid) ?? []) if (t >= run.start && t < run.end) return run;
  return null;
}

/** Whether a hull life flies: `kindOf(life)` is the replay's own reading of
 *  a hull (the drawn hull's seat survey, `air` for a plane), which the page
 *  hands in; without one nothing is taken to fly. */
export function isAircraft(life, kindOf = null) {
  if (!life || life.soldier) return false;
  return kindOf?.(life) === 'air';
}

// --- the vehicles --------------------------------------------------------------------

/**
 * Each hull's kills: `Map<life, kill[]>`, a kill credited to the hull its
 * killer sat in when he made it.
 */
export function hullKillsOf(rec, kills = rec.kills) {
  const out = new Map();
  for (const k of kills) {
    if (k.kind !== 'kill' || k.killer === null || k.killer === undefined) continue;
    const nid = controlledAt(rec, k.killer, k.t - 0.05);
    const root = rootOf(rec, nid, k.t - 0.05, k.killer);
    if (!root || root.life.soldier || root.life.camera) continue;
    if (!out.has(root.life)) out.set(root.life, []);
    out.get(root.life).push(k);
  }
  return out;
}

/**
 * The vehicles in play at `t` with someone aboard: `[{ life, crew: [{ pid,
 * seat }], kills, hp, max, fresh, pos }]`, the ones with kills first. `hp`
 * is the last recorded hit points. Read from the players' side (what each
 * one controls), not every hull's: a round has far more hulls than crews.
 */
export function vehiclesAt(rec, t, hullKills = new Map()) {
  const crews = new Map();
  for (const pid of rec.playerNids?.keys() ?? []) {
    const nid = controlledAt(rec, pid, t);
    if (nid === null) continue;
    const root = rootOf(rec, nid, t, pid);
    const life = root?.life;
    if (!life || life.soldier || life.kit || life.camera || life.projectile || life.controlPoint || !life.tmpl) continue;
    if (life.created > t || t >= life.destroyed || (life.killedAt !== undefined && t >= life.killedAt)) continue;
    if (!crews.has(life)) crews.set(life, []);
    crews.get(life).push({ pid, seat: root.seat });
  }
  const out = [];
  for (const [life, crew] of crews) {
    let hp = null;
    for (const entry of life.hp) {
      if (entry.t > t) break;
      hp = entry.hp;
    }
    const p = positionAt(life, t);
    const kills = (hullKills.get(life) ?? []).filter(k => k.t <= t).length;
    out.push({ life, crew: crew.sort((a, b) => a.seat - b.seat), kills, hp, max: life.maxhp || null,
               fresh: isReplicated(life, t), pos: p ? toView(p) : null });
  }
  return out.sort((a, b) => b.kills - a.kills || b.crew.length - a.crew.length || (a.fresh === b.fresh ? 0 : a.fresh ? -1 : 1));
}
