// Dogfights found in a round's recording (features/dogfight-recordings): two
// opposing players, each flying a plane, close together and shooting at each
// other. What it finds is extracted into the dogfight school's own shape
// (`dogfight-recorded.js` turns it back into a fight the theatre plays).
//
// Pure: a recording parsed by the viewer's own reader (`replay-recording.js`
// `parseRecording`) in, a list of fights out. Every position here is in the
// recording's frame (BF1942's); `dogfight-recorded.js` turns it into the
// viewer's.
//
// The rules, in order (each one's number is in `RULES`):
//
// 1. A plane is a life a player flies: someone controls the life itself (the
//    pilot's seat, not a gunner's), the model catalogue calls its template an
//    aircraft (`air`, when given), and it holds `airSpeed` or more for
//    `airSeconds` while the recording keeps it live (a client recording
//    freezes what is out of its player's network range: `isReplicated`), and
//    a template the catalogue does not know is that fast for `airShare` of
//    the time it moves at all. No vanilla tank, jeep or boat reaches 40 m/s,
//    and a modded one that touches it does not hold it; a soldier riding in a
//    plane, and a spectator's camera, fly nothing.
// 2. A pair is two planes in the air at once whose pilots are on opposite
//    sides.
// 3. An aimed shot is a round from a pilot's own plane (bombs and torpedoes
//    left out) that would pass within `aimMiss` metres of the other plane:
//    the round flown at `roundSpeed` plus the shooter's own velocity for up
//    to `roundLife` seconds against where the other really went. A round
//    sprayed into the sky, or at someone else, is not one.
// 4. Evidence is every aimed shot either way, every hit (a server
//    recording's impact on the other's plane, or the other plane's hit points
//    falling within `roundLife` of an aimed shot), and the kill.
// 5. A fight is a run of evidence with no gap longer than `gap` seconds,
//    opened `leadIn` seconds before its first piece and closed `tail` after
//    its last (`killTail` after a kill), trimmed to where both planes are
//    live and flown by those pilots. It counts with `minAimed` aimed shots
//    and the two inside `closest` metres at some moment.
// 6. A dogfight is one where both pilots shot at each other, or which lasted
//    `longFight` seconds with both turning through `turned` degrees. Anything
//    else is a bounce: one pilot attacking, the other not answering.

import { isReplicated, teamAt, nameAt } from './replay-recording.js';

export const RULES = Object.freeze({
  version: 1,
  airSpeed: 40,
  airSeconds: 3,
  airShare: 0.5,
  pilotGap: 2,
  maxGap: 3,
  step: 0.1,
  aimMiss: 25,
  aimCone: 25,
  roundSpeed: 400,
  roundLife: 1.5,
  aimRange: 1000,
  gap: 15,
  leadIn: 8,
  tail: 4,
  killTail: 3,
  minAimed: 3,
  closest: 600,
  longFight: 12,
  turned: 180,
  live: 0.8,
});

const NOT_GUNS = /bomb|torpedo|depthcharge|mine/i;
const NOT_PLANES = /camera/i;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The recorded samples either side of `t`: `{ a, b, k }`, `b` null at the
 * ends. A straight line between them, not the replay's hold-then-move
 * (`sampleAt`): that keeps a parked hull still between "on change" samples,
 * but a plane far from the recording player is updated every second or
 * three, and held then moved it stood still and jumped 126 m in a tenth.
 */
function bracket(life, t) {
  const keys = life.keys;
  const n = keys?.length ?? 0;
  if (!n) return null;
  const time = i => (keys.time ? keys.time(i) : keys[i].t);
  const at = i => (keys.sample ? keys.sample(i) : keys[i]);
  if (t <= time(0)) return { a: at(0), b: null, k: 0, gap: 0 };
  if (t >= time(n - 1)) return { a: at(n - 1), b: null, k: 0, gap: t - time(n - 1) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time(mid) <= t) lo = mid; else hi = mid;
  }
  const ta = time(lo), tb = time(hi);
  return { a: at(lo), b: at(hi), k: tb > ta ? (t - ta) / (tb - ta) : 0, gap: tb - ta };
}

/** The life's position at `t`, or null before it exists. */
function posAt(life, t) {
  if (t < life.created - 1e-6) return null;
  const s = bracket(life, t);
  if (!s) return null;
  const a = s.a.p;
  if (!s.b) return [a[0], a[1], a[2]];
  const b = s.b.p, k = s.k;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Whether the recording has this life live at `t`: replicated, and no
 *  gap in its samples longer than `maxGap` around it. */
function liveAt(life, t, rules = RULES) {
  if (!isReplicated(life, t)) return false;
  const s = bracket(life, t);
  return !!s && s.gap <= rules.maxGap;
}

/** The life's rotation at `t` (recorded frame), normalised. */
export function quatAt(life, t) {
  const s = bracket(life, t);
  if (!s) return [0, 0, 0, 1];
  const a = s.a.q;
  if (!s.b) return [...a];
  let b = s.b.q;
  if (dot4(a, b) < 0) b = b.map(v => -v);
  const k = s.k;
  const q = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
  const n = Math.hypot(...q) || 1;
  return q.map(v => v / n);
}
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** The life's velocity at `t`, from its positions a sample either side. */
export function velAt(life, t, h = 0.1) {
  const a = posAt(life, Math.max(life.created, t - h)), b = posAt(life, Math.min(life.destroyed ?? Infinity, t + h));
  if (!a || !b) return [0, 0, 0];
  const span = Math.min(life.destroyed ?? Infinity, t + h) - Math.max(life.created, t - h);
  return span > 1e-6 ? sub(b, a).map(v => v / span) : [0, 0, 0];
}

/**
 * Who controlled which object when: per object net id, `[{ pid, from, to }]`.
 * A player's control record holds until his next one, his death or the end.
 */
export function controlSpans(rec) {
  const byPid = new Map();
  for (const c of rec.control) {
    if (!byPid.has(c.pid)) byPid.set(c.pid, []);
    byPid.get(c.pid).push(c);
  }
  const deaths = new Map();
  for (const d of rec.deaths ?? []) {
    if (!deaths.has(d.pid)) deaths.set(d.pid, []);
    deaths.get(d.pid).push(d.t);
  }
  const spans = new Map();
  for (const [pid, list] of byPid) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      const from = list[i].t;
      let to = i + 1 < list.length ? list[i + 1].t : rec.duration;
      const died = (deaths.get(pid) ?? []).find(t => t > from && t < to);
      if (died !== undefined) to = died;
      if (to <= from) continue;
      const nid = list[i].nid;
      if (!spans.has(nid)) spans.set(nid, []);
      spans.get(nid).push({ pid, from, to });
    }
  }
  return spans;
}

/**
 * Every plane of the round (rule 1): `{ life, pilots: [{ pid, from, to }] }`,
 * each pilot's span clipped to the life.
 */
export function planesOf(rec, rules = RULES, air = null) {
  const spans = controlSpans(rec);
  const planes = [];
  for (const life of rec.lives) {
    // A soldier riding in a plane, and a spectator's free camera, move as
    // fast as one and fly nothing.
    if (life.soldier || NOT_PLANES.test(life.tmpl ?? '')) continue;
    const flown = spans.get(life.nid);
    if (!flown?.length) continue;
    const keys = life.keys;
    if (!keys?.length) continue;
    let fast = 0, moving = 0;
    for (let i = 1; i < keys.length; i++) {
      const a = keys.sample(i - 1), b = keys.sample(i);
      const dt = b.t - a.t;
      if (dt <= 0 || dt > 1) continue;
      const v = len(sub(b.p, a.p)) / dt;
      if (!isReplicated(life, a.t) || v >= 250) continue;
      if (v > 3) moving += dt;
      if (v >= rules.airSpeed) fast += dt;
    }
    // The game's own word first (`air`: the model catalogue's category, true
    // for an aircraft, false for anything else, null for a template it does
    // not hold). Without it: fast, and fast for most of the time it moves,
    // since a plane moving is a plane flying, while a modded KettenKrad that
    // touches 73 m/s averages 13.
    const known = air ? air(life.tmpl ?? '') : null;
    if (known === false || fast < rules.airSeconds) continue;
    if (known === null && fast < rules.airShare * moving) continue;
    const end = life.destroyed ?? rec.duration;
    // A pilot's control record comes again every few seconds, now and then
    // with a blink to another object between: one flight, many records.
    // Spans of the same pilot `pilotGap` or less apart are one.
    const merged = [];
    for (const s of [...flown].sort((a, b) => a.pid - b.pid || a.from - b.from)) {
      const last = merged.at(-1);
      if (last && last.pid === s.pid && s.from - last.to <= rules.pilotGap) last.to = Math.max(last.to, s.to);
      else merged.push({ ...s });
    }
    const pilots = merged
      .map(s => ({ pid: s.pid, from: Math.max(s.from, life.created), to: Math.min(s.to, end) }))
      .filter(s => s.to - s.from > 1);
    if (pilots.length) planes.push({ life, pilots });
  }
  return planes;
}

/** Each pilot's gun rounds, by pid, in time order (rule 3's candidates). */
function gunRounds(rec) {
  const by = new Map();
  for (const f of rec.fires) {
    if (f.soldier || f.feedOnly || !f.pos || !f.dir || NOT_GUNS.test(f.weapon ?? '')) continue;
    if (f.pid === null || f.pid === undefined) continue;
    if (!by.has(f.pid)) by.set(f.pid, []);
    by.get(f.pid).push(f);
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  return by;
}

/**
 * How close a round fired at `f` from `shooter` passes `target` (rule 3):
 * the least distance over its flight, and when. Null when it never could.
 */
export function roundMiss(f, shooter, target, rules = RULES) {
  const tp = posAt(target, f.t);
  if (!tp || !liveAt(target, f.t, rules)) return null;
  const los = sub(tp, f.pos);
  const range = len(los);
  if (range > rules.aimRange) return null;
  const dl = len(f.dir) || 1;
  const dir = f.dir.map(v => v / dl);
  if (range > 1 && Math.acos(Math.max(-1, Math.min(1, dot(dir, los) / range))) * 180 / Math.PI > rules.aimCone) return null;
  const pv = velAt(shooter, f.t);
  const v = [dir[0] * rules.roundSpeed + pv[0], dir[1] * rules.roundSpeed + pv[1], dir[2] * rules.roundSpeed + pv[2]];
  let best = Infinity, at = 0;
  const end = Math.min(rules.roundLife, (target.destroyed ?? Infinity) - f.t);
  for (let tau = 0; tau <= end; tau += 0.02) {
    const p = posAt(target, f.t + tau);
    if (!p) break;
    const d = Math.hypot(f.pos[0] + v[0] * tau - p[0], f.pos[1] + v[1] * tau - p[1], f.pos[2] + v[2] * tau - p[2]);
    if (d < best) { best = d; at = tau; }
  }
  return { miss: best, tau: at, range };
}

/** Where both planes are live, flown by these pilots, between `a` and `b`. */
function liveSpan(A, B, pa, pb, a, b, step, rules = RULES) {
  let first = null, last = null, live = 0, all = 0;
  for (let t = a; t <= b; t += step) {
    all++;
    const ok = liveAt(A.life, t, rules) && liveAt(B.life, t, rules) && t >= pa.from && t <= pa.to && t >= pb.from && t <= pb.to;
    if (!ok) continue;
    live++;
    if (first === null) first = t;
    last = t;
  }
  return first === null ? null : { from: first, to: last, share: live / Math.max(1, all) };
}

/** Heading in degrees (recorded frame: x east, z north), and total turn. */
function turnedThrough(life, from, to, step) {
  let total = 0, prev = null;
  for (let t = from; t <= to; t += step) {
    const v = velAt(life, t);
    if (Math.hypot(v[0], v[2]) < 5) continue;
    const h = Math.atan2(v[0], v[2]) * 180 / Math.PI;
    if (prev !== null) {
      let d = h - prev;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      total += Math.abs(d);
    }
    prev = h;
  }
  return total;
}

/**
 * The round's dogfights (rules 2 to 6). Each is
 * `{ t0, t1, kind, mutual, sides: [two { pid, name, team, tmpl, nid, aimed,
 *   hits }], kill, evidence }`, side 0 the first to fire an aimed shot.
 */
export function findDogfights(rec, rules = RULES, { air = null } = {}) {
  const planes = planesOf(rec, rules, air);
  const rounds = gunRounds(rec);
  const found = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const A = planes[i], B = planes[j];
      for (const pa of A.pilots) {
        for (const pb of B.pilots) {
          if (pa.pid === pb.pid) continue;
          const from = Math.max(pa.from, pb.from), to = Math.min(pa.to, pb.to);
          if (to - from < 2) continue;
          const mid = (from + to) / 2;
          const ta = teamAt(rec, pa.pid, mid), tb = teamAt(rec, pb.pid, mid);
          if (!(ta === 1 || ta === 2) || !(tb === 1 || tb === 2) || ta === tb) continue;
          found.push(...pairFights(rec, rules, rounds, A, B, pa, pb, from, to));
        }
      }
    }
  }
  return found.sort((a, b) => a.t0 - b.t0);
}

function pairFights(rec, rules, rounds, A, B, pa, pb, from, to) {
  // Evidence, both ways.
  const ev = [];
  const aimed = (shooter, target, pid, side) => {
    for (const f of rounds.get(pid) ?? []) {
      if (f.t < from || f.t > to) continue;
      if (f.nid !== null && f.nid !== undefined && f.nid !== shooter.life.nid) continue;
      const m = roundMiss(f, shooter.life, target.life, rules);
      if (m && m.miss <= rules.aimMiss) ev.push({ t: f.t, side, kind: 'aimed', miss: m.miss, range: m.range });
    }
  };
  aimed(A, B, pa.pid, 0);
  aimed(B, A, pb.pid, 1);
  if (!ev.some(e => e.kind === 'aimed')) return [];
  // Hits: a server recording's impacts, or the target's hit points falling
  // within a round's life of an aimed shot.
  for (const im of rec.impacts ?? []) {
    if (im.t < from || im.t > to + rules.roundLife) continue;
    if (im.pid === pa.pid && im.obj === B.life.nid) ev.push({ t: im.t, side: 0, kind: 'hit', how: 'impact' });
    if (im.pid === pb.pid && im.obj === A.life.nid) ev.push({ t: im.t, side: 1, kind: 'hit', how: 'impact' });
  }
  if (!(rec.impacts?.length)) {
    const hpHits = (target, side) => {
      const shots = ev.filter(e => e.kind === 'aimed' && e.side === side).map(e => e.t);
      const hp = target.life.hp ?? [];
      for (let k = 1; k < hp.length; k++) {
        if (hp[k].t < from || hp[k].t > to + rules.roundLife || !(hp[k].hp < hp[k - 1].hp)) continue;
        if (shots.some(t => hp[k].t >= t && hp[k].t - t <= rules.roundLife)) ev.push({ t: hp[k].t, side, kind: 'hit', how: 'hp', drop: hp[k - 1].hp - hp[k].hp });
      }
    };
    hpHits(B, 0);
    hpHits(A, 1);
  }
  for (const k of rec.kills ?? []) {
    if (k.kind !== 'kill' || k.t < from - 0.5 || k.t > to + rules.killTail) continue;
    if (k.killer === pa.pid && k.victim === pb.pid) ev.push({ t: k.t, side: 0, kind: 'kill', weapon: k.weapon });
    if (k.killer === pb.pid && k.victim === pa.pid) ev.push({ t: k.t, side: 1, kind: 'kill', weapon: k.weapon });
  }
  ev.sort((a, b) => a.t - b.t);
  // Runs of evidence (rule 5).
  const runs = [];
  for (const e of ev) {
    const last = runs.at(-1);
    if (last && e.t - last.at(-1).t <= rules.gap) last.push(e); else runs.push([e]);
  }
  const fights = [];
  for (const run of runs) {
    const nAimed = run.filter(e => e.kind === 'aimed').length;
    if (nAimed < rules.minAimed) continue;
    const kill = run.find(e => e.kind === 'kill') ?? null;
    let t0 = Math.max(from, run[0].t - rules.leadIn);
    let t1 = kill ? kill.t + rules.killTail : run.at(-1).t + rules.tail;
    t1 = Math.min(t1, to + (kill ? rules.killTail : 0), rec.duration);
    const live = liveSpan(A, B, pa, pb, t0, Math.min(t1, to), rules.step, rules);
    if (!live || live.share < rules.live) continue;
    t0 = live.from;
    if (!kill) t1 = Math.min(t1, live.to);
    if (t1 - t0 < 2) continue;
    // Inside `closest` metres at some moment.
    let closest = Infinity;
    for (let t = t0; t <= t1; t += rules.step) {
      const p = posAt(A.life, t), q = posAt(B.life, t);
      if (p && q) closest = Math.min(closest, len(sub(p, q)));
    }
    if (closest > rules.closest) continue;
    const aimedBy = [0, 1].map(s => run.filter(e => e.kind === 'aimed' && e.side === s).length);
    const hitsBy = [0, 1].map(s => run.filter(e => e.kind === 'hit' && e.side === s).length);
    const mutual = aimedBy[0] > 0 && aimedBy[1] > 0;
    const turns = [turnedThrough(A.life, t0, t1, 0.5), turnedThrough(B.life, t0, t1, 0.5)];
    const long = t1 - t0 >= rules.longFight && turns.every(v => v >= rules.turned);
    // Side 0 is the first to fire an aimed shot.
    const firstSide = run.find(e => e.kind === 'aimed').side;
    const order = firstSide === 0 ? [[A, pa, 0], [B, pb, 1]] : [[B, pb, 1], [A, pa, 0]];
    const sides = order.map(([P, pilot, s]) => ({
      pid: pilot.pid, name: nameAt(rec, pilot.pid, t0), team: teamAt(rec, pilot.pid, t0),
      tmpl: P.life.tmpl ?? null, nid: P.life.nid, aimed: aimedBy[s], hits: hitsBy[s], turned: Math.round(turns[s]),
      destroyed: P.life.destroyed ?? null,
    }));
    const flip = s => (firstSide === 0 ? s : 1 - s);
    fights.push({
      t0, t1, closest: Math.round(closest),
      kind: mutual || long ? 'dogfight' : 'bounce', mutual,
      sides, life: order.map(([P]) => P.life), pilots: order.map(([, p]) => p),
      kill: kill ? { t: kill.t, side: flip(kill.side), weapon: kill.weapon ?? null } : null,
      evidence: run.map(e => ({ ...e, side: flip(e.side) })),
    });
  }
  return fights;
}

/**
 * A found fight sampled for the theatre: both planes every `dt` seconds
 * from `t0` (recorded frame, times from 0), the propellers' revs, and every
 * gun round either pilot fired in it. What `dogfight-recorded.js` reads.
 */
export function sampleFight(rec, fight, { dt = 0.1, round = true } = {}) {
  const r1 = v => (round ? Math.round(v * 10) / 10 : v);
  const r4 = v => (round ? Math.round(v * 1e4) / 1e4 : v);
  const n = Math.floor((fight.t1 - fight.t0) / dt) + 1;
  const sides = fight.sides.map((side, s) => {
    const life = fight.life[s];
    const p = [], q = [], rv = [];
    const engines = rec.engines?.get(life.nid);
    const revsList = engines ? [...engines.values()][0] : null;
    for (let i = 0; i < n; i++) {
      const t = Math.min(fight.t0 + i * dt, (life.destroyed ?? Infinity) - 1e-3);
      const at = posAt(life, t) ?? [0, 0, 0];
      p.push(r1(at[0]), r1(at[1]), r1(at[2]));
      q.push(...quatAt(life, t).map(r4));
      let revs = null;
      if (revsList?.length) {
        for (const e of revsList) { if (e.t > t) break; revs = e.revs; }
      }
      rv.push(revs === null ? null : Math.round(revs * 100) / 100);
    }
    return { ...side, p, q, rv };
  });
  const shots = [];
  for (const [s, pilot] of fight.pilots.entries()) {
    for (const f of rec.fires) {
      if (f.pid !== pilot.pid || f.t < fight.t0 || f.t > fight.t1 || f.soldier || f.feedOnly || !f.pos || !f.dir) continue;
      if (NOT_GUNS.test(f.weapon ?? '')) continue;
      if (f.nid !== null && f.nid !== undefined && f.nid !== fight.life[s].nid) continue;
      const v = velAt(fight.life[s], f.t);
      shots.push({ side: s, t: Math.round((f.t - fight.t0) * 1000) / 1000, pos: f.pos.map(r1), dir: f.dir.map(r4), pv: v.map(r1), weapon: f.weapon });
    }
  }
  shots.sort((a, b) => a.t - b.t);
  return {
    dt, t0: Math.round(fight.t0 * 1000) / 1000, duration: Math.round((n - 1) * dt * 1000) / 1000,
    kind: fight.kind, mutual: fight.mutual, closest: fight.closest,
    kill: fight.kill ? { ...fight.kill, t: Math.round((fight.kill.t - fight.t0) * 1000) / 1000 } : null,
    evidence: fight.evidence.map(e => ({ ...e, t: Math.round((e.t - fight.t0) * 1000) / 1000,
      ...(e.miss !== undefined ? { miss: Math.round(e.miss) } : {}), ...(e.range !== undefined ? { range: Math.round(e.range) } : {}) })),
    sides, shots,
  };
}
