// The round's fights, for the replay's spotlight on a kill (features/
// replay-spotlight): two things that fought in a recorded round -- two tanks,
// a plane and the gun that brought it down, a soldier and the tank they went
// for -- the fight a kill ended, and every round that passed between the two.
// Pure functions of the parsed recording (replay-recording.js) and the
// Accuracy rebuild's shots (replay-accuracy.js `accuracyBoard`), so
// `tests/replay_spotlight_harness.mjs` runs them under node. The page side is
// replay-spotlight.js.
//
// A "thing" is a life: a hull (whoever is in it) or a soldier on foot. What a
// round was fired from is the hull its FireArms hangs under, else the man
// (`shooterOf`); what it hit is the life whose hit points dropped as it got
// there (the Accuracy rebuild's `victim`). A kill is the killer's thing
// against the thing the victim was in a moment before they died.

import { controlledAt, crewOf, hpAt, nameAt, positionAt, rootOf, teamAt } from './replay-recording.js';

/** A round that missed counts as one fired at the other when it passed
 *  within this many metres of the target: a tank's shell 11 m wide is a
 *  miss at it, its machine gun 16 m off was at the men beside it. */
export const NEAR = 12;
/** A round no verdict credited, that passed this close to a hull (or a
 *  soldier) just before a drop no other round took, is the drop's: the
 *  Accuracy rebuild can miss the kill shot when the victim's crew dies on
 *  the same tick. */
const THROUGH = { hull: 4, soldier: 1.2 };
/** Metres a second for a round whose speed nothing names. */
export const DEFAULT_SPEED = 400;
/** Seconds a round can take to arrive: past this it is no round at the target. */
const MAX_FLIGHT = 6;
/** Seconds a recorded drop of hit points may lag the round's arrival. */
const DROP_LAG = 0.6;
/** Seconds before a kill the victim's thing is read: a moment before they
 *  died, they were still in their tank. */
const BEFORE_KILL = 0.15;

const lower = s => String(s ?? '').toLowerCase();
/** A template or weapon name without three's `_1` copy suffix. */
export const bare = s => lower(s).replace(/_\d+$/, '');

/** The thing `pid` was at `t`: the hull they were in, else their soldier. */
export function thingOf(rec, pid, t) {
  if (!Number.isInteger(pid)) return null;
  const nid = controlledAt(rec, pid, t);
  if (nid === null || nid === undefined) return null;
  return rootOf(rec, nid, t, pid)?.life ?? null;
}

/** The thing round `f` was fired from: the hull (or soldier) its FireArms
 *  hangs under, else the shooter's thing. */
export function shooterOf(rec, f) {
  const pid = Number.isInteger(f.pid) && f.pid >= 0 ? f.pid : null;
  return rootOf(rec, f.nid, f.t, pid)?.life ?? (pid === null ? null : thingOf(rec, pid, f.t));
}

/** Who is in `life` at `t`: a soldier's own player, a hull's crew. */
export function peopleOf(rec, life, t) {
  if (!life) return [];
  if (life.soldier) return Number.isInteger(life.pid) ? [life.pid] : [];
  return crewOf(rec, life, t).map(c => c.pid);
}

/** The side `life` was on at `t` (1 Axis, 2 Allies), 0 for an empty hull. */
export function sideOf(rec, life, t) {
  const people = peopleOf(rec, life, t);
  return people.length ? teamAt(rec, people[0], t) || 0 : 0;
}

/** What to call `life` at `t`: its people's names and what they were in.
 *  `{ who, what, soldier }`. */
export function labelOf(rec, life, t, pretty = s => s) {
  const people = peopleOf(rec, life, t);
  const names = people.map(pid => nameAt(rec, pid, t));
  const soldier = Boolean(life?.soldier);
  return {
    who: names.length ? names.join(', ') : soldier ? 'A soldier' : 'Nobody aboard',
    what: soldier ? 'on foot' : pretty(life?.tmpl ?? 'a vehicle'),
    soldier,
  };
}

/** A fight's key: the two lives, whichever way round. */
export const keyOf = (a, b) => (a.nid < b.nid || (a.nid === b.nid && a.created <= b.created)
  ? `${a.nid}@${a.created}|${b.nid}@${b.created}` : `${b.nid}@${b.created}|${a.nid}@${a.created}`);

/** Seconds with no hit and no kill between two that end their fight: the
 *  same two meeting again later is another fight. */
export const FIGHT_GAP = 20;
/** Seconds before a fight's first hit its rounds are looked for from (the
 *  ones that missed first, the turret coming round), and after its last
 *  event the spotlight holds on (the wreck, the body falling). */
export const LEAD = 4;
export const HOLD = 4;

/**
 * Every hit and kill between two things, by pair: `Map(key -> { x, y,
 * events })`, each event `{ t, kind, by, people }` (`people` the pids in
 * `by` and in the other at that moment) and a kill's `kill`. `keep(t)` says
 * which moments count.
 */
function pairEvents(rec, shots, kills, keep = () => true) {
  const pairs = new Map();
  const pair = (x, y) => {
    const key = keyOf(x, y);
    if (!pairs.has(key)) pairs.set(key, { x, y, events: [] });
    return pairs.get(key);
  };
  for (const s of shots ?? []) {
    if (!s?.hit || !s.victim || !s.f || !keep(s.t)) continue;
    const from = shooterOf(rec, s.f);
    if (!from || from === s.victim) continue;
    pair(from, s.victim).events.push({
      t: s.t, kind: 'hit', by: from, people: [[from, peopleOf(rec, from, s.t)], [s.victim, peopleOf(rec, s.victim, s.t)]],
    });
  }
  for (const k of kills ?? []) {
    if (!k || (k.kind !== 'kill' && k.kind !== 'teamkill') || !keep(k.t)) continue;
    const killer = thingOf(rec, k.killer, k.t - BEFORE_KILL) ?? thingOf(rec, k.killer, k.t);
    const victim = thingOf(rec, k.victim, k.t - BEFORE_KILL);
    if (!killer || !victim || killer === victim) continue;
    pair(killer, victim).events.push({
      t: k.t, kind: 'kill', by: killer, people: [[killer, [k.killer]], [victim, [k.victim]]],
      kill: { t: k.t, killer, victim, weapon: k.weapon ?? null, killerPid: k.killer, victimPid: k.victim },
    });
  }
  return pairs;
}

/** One fight from its events (time order): who hit whom how often, its
 *  kill (of two, the later: a tank and the man who bailed out of it is two
 *  fights, two men in one hull one), its span, and everyone who was in it. */
function fightFrom(x, y, events) {
  const hitsBy = new Map([[x, 0], [y, 0]]);
  const people = new Map([[x, new Set()], [y, new Set()]]);
  let kill = null;
  for (const e of events) {
    if (e.kind === 'hit') hitsBy.set(e.by, (hitsBy.get(e.by) ?? 0) + 1);
    if (e.kind === 'kill' && (!kill || e.t > kill.t)) kill = e.kill;
    for (const [life, pids] of e.people) for (const pid of pids) if (Number.isInteger(pid)) people.get(life)?.add(pid);
  }
  return {
    x, y, hitsBy, people, kill, first: events[0].t, last: events[events.length - 1].t,
    events: events.map(({ t, kind, by }) => ({ t, kind, by })),
  };
}

/** Whether `follow` was in `raw` (a `fightFrom`), on either side. */
export function hasPlayer(raw, follow) {
  return Number.isInteger(follow) && Boolean(raw?.people?.get(raw.x)?.has(follow) || raw?.people?.get(raw.y)?.has(follow));
}

/**
 * `raw` (a `fightFrom`) seen from `t`: `{ a, b, hits: { a, b }, kill, first,
 * last, raw }`. `a` is the followed player's thing where they are in the
 * fight, else the killer's, else whoever landed more.
 */
export function orient(rec, raw, t, follow = null) {
  const { x, y } = raw;
  const followed = Number.isInteger(follow) ? thingOf(rec, follow, t) : null;
  const hx = raw.hitsBy.get(x) ?? 0;
  const hy = raw.hitsBy.get(y) ?? 0;
  const theirs = side => side === followed || (Number.isInteger(follow) && raw.people.get(side)?.has(follow));
  let a = x;
  if (theirs(y)) a = y;
  else if (theirs(x)) a = x;
  else if (raw.kill) a = raw.kill.killer;
  else if (hy > hx) a = y;
  const b = a === x ? y : x;
  return {
    a, b, hits: { a: raw.hitsBy.get(a) ?? 0, b: raw.hitsBy.get(b) ?? 0 }, kill: raw.kill,
    first: raw.first, last: raw.last, raw,
  };
}

/**
 * Every fight of the round, in the order they began: each pair's hits and
 * kills, split where `gap` seconds passed with neither. `fightFrom`'s raw
 * fights, for `fightOfKill`.
 */
export function fightEpisodes(rec, shots, kills, { gap = FIGHT_GAP } = {}) {
  const out = [];
  for (const { x, y, events } of pairEvents(rec, shots, kills).values()) {
    events.sort((p, q) => p.t - q.t);
    let run = [];
    for (const e of events) {
      if (run.length && e.t - run[run.length - 1].t > gap) {
        out.push(fightFrom(x, y, run));
        run = [];
      }
      run.push(e);
    }
    if (run.length) out.push(fightFrom(x, y, run));
  }
  return out.sort((p, q) => p.first - q.first || p.last - q.last);
}

/** The fight the kill of `victimPid` at `t` ended, or null. */
export function fightOfKill(episodes, t, victimPid) {
  let best = null;
  for (const raw of episodes ?? []) {
    const k = raw.kill;
    if (!k || k.victimPid !== victimPid || Math.abs(k.t - t) > 0.6) continue;
    if (!best || Math.abs(k.t - t) < Math.abs(best.kill.t - t)) best = raw;
  }
  return best;
}

/** Seconds before a kill the victim's thing is read, and the spotlight
 *  turns to the killer: they were still in their tank. */
export const KILL_FREEZE = BEFORE_KILL;

/** The index of the first of `fires` (time order) at or after `t`. */
function firstAt(fires, t) {
  let lo = 0;
  let hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const _p = [0, 0, 0];
const _q = [0, 0, 0];

/** The closest a straight round from `pos` along `unit` comes to `life`'s
 *  middle (its origin plus `lift` metres), where `life` was when the round
 *  got there: `{ miss, along, arrival }`, or null when it flew away from it. */
export function closestPass(life, t, pos, unit, speed, lift = 1) {
  let arrival = t;
  let best = null;
  for (let pass = 0; pass < 3; pass++) {
    if (!positionAt(life, arrival, _p)) return best;
    const vx = _p[0] - pos[0];
    const vy = _p[1] + lift - pos[1];
    const vz = _p[2] - pos[2];
    const along = vx * unit[0] + vy * unit[1] + vz * unit[2];
    if (along < 0) return best;
    const miss = Math.hypot(vx - along * unit[0], vy - along * unit[1], vz - along * unit[2]);
    best = { miss, along, arrival: t + along / speed };
    arrival = best.arrival;
  }
  return best;
}

/**
 * Every round that passed between `a` and `b` from `from` to `to`: each of
 * their rounds that hit the other (the Accuracy rebuild's verdict, `shotOf(f)`)
 * or passed within NEAR metres of the target. `speedOf(f, shooter)` is the round's
 * muzzle velocity. Returns `[{ f, by, at, kind, arrival, along, miss }]` in
 * time order: `by` 'a' or 'b', `at` the life it went at, `kind` 'hit' (the
 * other's hit points dropped as it got there) or 'near' (it did no damage:
 * a miss, or a round that met a plate it cannot get through -- the page tells
 * which by casting it at the other's hull).
 */
export function roundsBetween(rec, a, b, from, to, { shotOf = () => null, speedOf = () => DEFAULT_SPEED, skip = isDummy } = {}) {
  const fires = rec.fires ?? [];
  const out = [];
  for (let i = firstAt(fires, from); i < fires.length && fires[i].t <= to; i++) {
    const f = fires[i];
    if (f.press || !Array.isArray(f.pos) || !Array.isArray(f.dir) || skip(f)) continue;
    const shooter = shooterOf(rec, f);
    if (shooter !== a && shooter !== b) continue;
    const target = shooter === a ? b : a;
    const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
    if (!(n > 0.1)) continue;
    const unit = [f.dir[0] / n, f.dir[1] / n, f.dir[2] / n];
    const speed = speedOf(f, shooter) || DEFAULT_SPEED;
    const shot = shotOf(f);
    const pass = closestPass(target, f.t, f.pos, unit, speed, target.soldier ? 0.3 : 1);
    if (shot?.hit && shot.victim === target) {
      const along = Number.isFinite(shot.dist) ? shot.dist : pass?.along ?? 0;
      out.push({ f, by: shooter === a ? 'a' : 'b', shooter, at: target, kind: 'hit', arrival: f.t + along / speed, along, miss: pass?.miss ?? 0, unit, speed });
      continue;
    }
    if (!pass || pass.miss > NEAR || pass.arrival - f.t > MAX_FLIGHT) continue;
    out.push({ f, by: shooter === a ? 'a' : 'b', shooter, at: target, kind: 'near', arrival: pass.arrival, along: pass.along, miss: pass.miss, unit, speed });
  }
  return out;
}

/** A round that only draws: FHSW fires a `_Dummy` beside a real round (its
 *  projectile `ChangeAmmo_FakeProjectile`), which would count the gun's
 *  rounds twice. */
export const isDummy = f => /dummy/i.test(String(f?.weapon ?? ''));

/** The first drop of `life`'s hit points at or after `t` (a sample early),
 *  within `within` seconds, and later than `after`: `{ t, before, after,
 *  amount }`, or null. */
export function dropAfter(life, t, within = DROP_LAG, after = -Infinity) {
  const hp = life?.hp ?? [];
  let lo = 0;
  let hi = hp.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hp[mid].t < t - 0.05) lo = mid + 1;
    else hi = mid;
  }
  for (let i = Math.max(1, lo); i < hp.length && hp[i].t <= t + within; i++) {
    if (hp[i].t <= after) continue;
    const before = hp[i - 1].hp;
    if (hp[i].hp < before && before > 0) {
      return { t: hp[i].t, before, after: hp[i].hp, amount: Math.round((before - hp[i].hp) * 1000) / 1000 };
    }
  }
  return null;
}

/** Each round's recorded drop, given once: two rounds that arrive together
 *  cannot both be the one drop. `rounds` from `roundsBetween`. Sets `drop`
 *  on each hit (null where none is left for it). */
export function assignDrops(rounds) {
  const taken = new Set();
  for (const r of rounds) {
    if (r.kind !== 'hit') continue;
    let drop = dropAfter(r.at, r.arrival);
    // The next drop along, when an earlier round took this one.
    while (drop && taken.has(`${r.at.nid}@${drop.t}`)) drop = dropAfter(r.at, r.arrival, DROP_LAG, drop.t);
    r.drop = drop;
    if (drop) taken.add(`${r.at.nid}@${drop.t}`);
  }
  // A round that passed through them just before a drop nobody took.
  for (const r of rounds) {
    if (r.kind !== 'near' || r.miss > (r.at.soldier ? THROUGH.soldier : THROUGH.hull)) continue;
    const drop = dropAfter(r.at, r.arrival);
    if (!drop || taken.has(`${r.at.nid}@${drop.t}`)) continue;
    r.kind = 'hit';
    r.inferred = true;
    r.drop = drop;
    taken.add(`${r.at.nid}@${drop.t}`);
  }
  return rounds;
}

/** `life`'s hit points at `t`, and the most it has. */
export function healthOf(life, t) {
  const hp = hpAt(life, t);
  const max = Number(life?.maxhp) || (life?.soldier ? 30 : null);
  return { hp: Number.isFinite(hp) ? hp : null, max };
}
