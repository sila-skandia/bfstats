// A replayed round's fronts (features/round-replay-fronts): the places its
// fighting happened, each the control point the fighting was nearest, with
// how hard it burned there at every moment of the round, its surges, and
// who is in its fight right now. Pure functions of the round's activity
// (replay-battles.js `activityOf`) and its control points, so
// `tests/replay_highlights_harness.mjs` runs them under node.
//
// A round is two or three fronts that burn for most of it: on Bocage's
// public round (replay_20260928-133433) the battle tracks are 46 at the
// Bridge and 29 at the Sawmill of 84, on Midway's 53 at the Airfield and 28
// at the Coastal Defences of 88. The tracks overlap and drift, so a front
// is read off the activity itself, each event once, never off the tracks.

import { battlesAt, compass, whereIs } from './replay-battles.js';

/** An event further than this from every control point is open ground, and
 *  no front's (replay-battles.js `placeName` says "Open ground" past it). */
export const REACH = 380;
/** A front holds at least this share of the round's activity; a point with
 *  less is quiet: shown, never a lane of its own. */
const SHARE = 0.06;
/** At most this many fronts get a lane. */
const MAX_FRONTS = 3;
/** The lanes' resolution: about this many buckets a round, none shorter
 *  than MIN_BUCKET seconds. */
const BUCKETS = 300;
const MIN_BUCKET = 1;
/** A front's heat at a moment: the activity of the last WINDOW seconds, each
 *  event weighed down by exp(-age / DECAY), as a battle's (replay-battles.js). */
const WINDOW = 12;
const DECAY = 5;
/** A front is burning at a moment at this heat or more. */
export const LIVE_HEAT = 4;
/** A surge: a run of a front's lane, smoothed over SURGE_SMOOTH seconds,
 *  at SURGE_LEVEL of its peak or more, runs closer than SURGE_GAP joined,
 *  none shorter than SURGE_MIN. */
const SURGE_SMOOTH = 10;
const SURGE_LEVEL = 0.45;
const SURGE_GAP = 15;
const SURGE_MIN = 8;
/** The people in a fight: alive, where the recording sees them, this close
 *  to its centre, metres. */
export const NEAR = 90;

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The control point nearest `pos` within REACH, or null. */
export function nearestPoint(points, pos) {
  let best = null;
  for (const p of points) {
    if (!p.pos) continue;
    const d = dist2(p.pos, pos);
    if (d <= REACH && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

/** The index of the first event at or after `t` in a time-ordered list. */
function firstAt(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The round's fronts: `{ bucket, total, fronts, quiet }`. Each front is `{
 * id, name, pos, point, events, heat, share, kills, lane, surges }`: `events`
 * its activity in time order, `lane` a Float32Array of its activity per
 * `bucket` seconds, `surges` `[{ t0, t1, peakT, kills }]` in time order.
 * `fronts` are the busiest, at most MAX_FRONTS, busiest first; `quiet` the
 * rest of the points that saw anything.
 */
export function frontsOf(activity, points, duration, { display = n => n } = {}) {
  const bucket = Math.max(MIN_BUCKET, duration / BUCKETS);
  const n = Math.max(1, Math.ceil(duration / bucket) + 1);
  const byPoint = new Map();
  let total = 0;
  for (const e of activity) {
    total += e.w;
    const p = nearestPoint(points, e.pos);
    if (!p) continue;
    let f = byPoint.get(p.id);
    if (!f) {
      f = { id: p.id, point: p, pos: p.pos, events: [], heat: 0, kills: 0, lane: new Float32Array(n) };
      byPoint.set(p.id, f);
    }
    f.events.push(e);
    f.heat += e.w;
    if (e.kind === 'kill') f.kills++;
    f.lane[Math.min(n - 1, Math.max(0, Math.floor(e.t / bucket)))] += e.w;
  }
  const all = [...byPoint.values()].sort((a, b) => b.heat - a.heat);
  // Two points with one name (Bocage's two bridges) are told apart by where
  // each lies from the other.
  const names = new Map();
  for (const f of all) {
    const name = display(f.point.name);
    names.set(name, [...(names.get(name) ?? []), f]);
  }
  for (const [name, list] of names) {
    for (const f of list) {
      if (list.length === 1) {
        f.name = name;
        continue;
      }
      const others = list.filter(o => o !== f);
      const cx = others.reduce((s, o) => s + o.pos[0], 0) / others.length;
      const cz = others.reduce((s, o) => s + o.pos[2], 0) / others.length;
      f.name = `${name} ${compass(f.pos[0] - cx, f.pos[2] - cz)}`;
    }
  }
  for (const f of all) {
    f.share = total > 0 ? f.heat / total : 0;
    f.surges = surgesOf(f, bucket);
  }
  const fronts = all.filter(f => f.share >= SHARE).slice(0, MAX_FRONTS);
  // A round with fighting but no point holding a share of it still has its
  // busiest place as its front.
  if (!fronts.length && all.length) fronts.push(all[0]);
  const quiet = all.filter(f => !fronts.includes(f));
  return { bucket, total, fronts, quiet };
}

/** A front's surges, read off its lane (`frontsOf`). */
function surgesOf(front, bucket) {
  const lane = front.lane;
  const half = Math.max(1, Math.round(SURGE_SMOOTH / bucket / 2));
  const smooth = new Float32Array(lane.length);
  let peak = 0;
  for (let i = 0; i < lane.length; i++) {
    let sum = 0;
    let w = 0;
    for (let j = -half; j <= half; j++) {
      const v = lane[i + j];
      if (v === undefined) continue;
      sum += v;
      w++;
    }
    smooth[i] = w ? sum / w : 0;
    peak = Math.max(peak, smooth[i]);
  }
  if (peak <= 0) return [];
  const runs = [];
  let open = null;
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] >= peak * SURGE_LEVEL) {
      if (open && i * bucket - open.t1 <= SURGE_GAP) {
        open.t1 = (i + 1) * bucket;
      } else {
        open = { t0: i * bucket, t1: (i + 1) * bucket, peakT: (i + 0.5) * bucket, best: 0 };
        runs.push(open);
      }
      if (smooth[i] > open.best) {
        open.best = smooth[i];
        open.peakT = (i + 0.5) * bucket;
      }
    }
  }
  return runs.filter(r => r.t1 - r.t0 >= SURGE_MIN).map(r => {
    let kills = 0;
    for (let i = firstAt(front.events, r.t0); i < front.events.length; i++) {
      const e = front.events[i];
      if (e.t > r.t1) break;
      if (e.kind === 'kill') kills++;
    }
    return { t0: r.t0, t1: r.t1, peakT: r.peakT, kills };
  });
}

/** How hard `front` burns at `t`: its last WINDOW seconds, decayed. */
export function heatAt(front, t) {
  let heat = 0;
  for (let i = firstAt(front.events, t - WINDOW); i < front.events.length; i++) {
    const e = front.events[i];
    if (e.t > t) break;
    heat += e.w * Math.exp(-(t - e.t) / DECAY);
  }
  return heat;
}

/** A lull this long or longer, seconds, ends a front's fighting. */
const LULL = 6;

/** Since when `front` has burned without a lull at `t`, or null when it is
 *  not burning: back through its lane to the first gap of LULL seconds. */
export function burningSince(front, t, bucket) {
  if (heatAt(front, t) < LIVE_HEAT) return null;
  const gap = Math.max(1, Math.round(LULL / bucket));
  let i = Math.min(front.lane.length - 1, Math.floor(t / bucket));
  let quiet = 0;
  let start = i;
  for (; i >= 0; i--) {
    if (front.lane[i] > 0) {
      quiet = 0;
      start = i;
    } else if (++quiet >= gap) {
      break;
    }
  }
  return start * bucket;
}

/**
 * Where `front`'s fight is at `t`: `{ pos, r, heat }`. The hottest battle
 * burning then whose nearest point is the front's (replay-battles.js
 * `battlesAt`), else the weighted centre of its last WINDOW seconds, else
 * its control point.
 */
export function fightAt(front, battles, points, t) {
  for (const { s } of battlesAt(battles, t)) {
    if (nearestPoint(points, s.pos)?.id === front.id) return { pos: s.pos, r: s.r, heat: s.heat };
  }
  let w = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = firstAt(front.events, t - WINDOW); i < front.events.length; i++) {
    const e = front.events[i];
    if (e.t > t) break;
    const k = e.w * Math.exp(-(t - e.t) / DECAY);
    w += k;
    x += e.pos[0] * k;
    y += e.pos[1] * k;
    z += e.pos[2] * k;
  }
  if (w > 0) return { pos: [x / w, y / w, z / w], r: 30, heat: w };
  return { pos: front.pos, r: 30, heat: 0 };
}

/**
 * Who is in a fight at `t`: everyone alive the recording sees within NEAR of
 * `centre`, `[{ pid, team, d, state, life }]`, Axis first, then by distance.
 * `where(pid, t)` is replay-battles.js `whereIs`, or the model's cached one.
 */
export function peopleAt(rec, centre, t, { where = (pid, at) => whereIs(rec, pid, at), reach = NEAR } = {}) {
  const out = [];
  for (const pid of rec.players.keys()) {
    const w = where(pid, t);
    if (!w.fresh || !w.pos) continue;
    const d = dist2(w.pos, centre);
    if (d > reach) continue;
    out.push({ pid, team: w.team, d, state: w.state, life: w.life });
  }
  return out.sort((a, b) => (a.team - b.team) || (a.d - b.d));
}

/** The front whose fight `pos` is in at `t`, or null: the nearest front
 *  burning then, its fight within NEAR of `pos`. */
export function frontAround(model, pos, t) {
  let best = null;
  for (const front of model.fronts.fronts) {
    if (heatAt(front, t) < LIVE_HEAT) continue;
    const fight = fightAt(front, model.battles, model.points, t);
    const d = dist2(fight.pos, pos);
    if (d <= NEAR + fight.r && (!best || d < best.d)) best = { front, d };
  }
  return best?.front ?? null;
}

/** The surge after (`dir` 1) or before (`dir` -1) `t` on `front`, or on
 *  any front when `front` is null: the one whose start is nearest. A surge
 *  the playhead is inside counts as before it. */
export function stepSurge(fronts, front, t, dir) {
  const list = (front ? [front] : fronts).flatMap(f => f.surges.map(s => ({ front: f, ...s })))
    .sort((a, b) => a.t0 - b.t0);
  const LEAD = 2;
  if (dir > 0) return list.find(s => s.t0 - LEAD > t + 0.5) ?? null;
  return [...list].reverse().find(s => s.t0 - LEAD < t - 1.5) ?? null;
}
