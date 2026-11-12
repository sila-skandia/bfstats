// The replay's match-up (features/replay-matchup): two things that fought in a
// recorded round -- two tanks, a plane and the gun that brought it down, a
// soldier and the tank they went for -- and every round that passed between
// them. Pure functions of the parsed recording (replay-recording.js) and the
// Accuracy rebuild's shots (replay-accuracy.js `accuracyBoard`), so
// `tests/replay_matchup_harness.mjs` runs them under node. The page side,
// which freezes the round, rebuilds where each round struck and takes the two
// apart, is replay-matchup-view.js.
//
// A "thing" is a life: a hull (whoever is in it) or a soldier on foot. What a
// round was fired from is the hull its FireArms hangs under, else the man
// (`shooterOf`); what it hit is the life whose hit points dropped as it got
// there (the Accuracy rebuild's `victim`). A kill is the killer's thing
// against the thing the victim was in a moment before they died.
//
// What the recording cannot say is left unsaid: it holds only what the
// recording player's client was sent (nothing past the level's view
// distance), and it never says where on a hull a round struck. The page
// rebuilds that and checks it against the recorded drop of hit points.

import { controlledAt, crewOf, hpAt, nameAt, positionAt, rootOf, teamAt } from './replay-recording.js';

/** Seconds either side of the playhead a fight is looked for in. */
export const WINDOW = 30;
/** A round that missed counts as one fired at the other when it passed
 *  within this many metres of the target: a tank's shell 11 m wide is a
 *  miss at it, its machine gun 16 m off was at the men beside it. */
export const NEAR = 12;
/** A round no verdict credited, that passed this close to a hull (or a
 *  soldier) just before a drop no other round took, is the drop's: the
 *  Accuracy rebuild can miss the kill shot when the victim's crew dies on
 *  the same tick. */
const THROUGH = { hull: 4, soldier: 1.2 };
/** Seconds kept before a fight's first round and after its last. */
export const PAD = 2;
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
 * `raw` (a `fightFrom`) seen from `t`: `{ a, b, hits: { a, b }, kill,
 * first, last, moment, score, events, raw }`. `a` is the followed player's
 * thing where they are in the fight, else the killer's, else whoever landed
 * more. `moment` is where the match-up freezes: the playhead when it is
 * inside the fight, else just before its kill, else its last hit.
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
  const inside = t >= raw.first - PAD && t <= raw.last + PAD;
  const lastHit = raw.events.filter(e => e.kind === 'hit').reduce((m, e) => Math.max(m, e.t), -Infinity);
  const moment = inside ? t : raw.kill ? raw.kill.t - BEFORE_KILL : Number.isFinite(lastHit) ? lastHit : raw.last;
  const both = hx > 0 && hy > 0;
  const mine = theirs(a) || theirs(b);
  const near = Math.min(Math.abs(t - raw.first), Math.abs(t - raw.last), inside ? 0 : Infinity);
  // Hits count by their logarithm: a machine gun's 36 small hits on an
  // open-topped hull are not twelve times the fight two shells make.
  const score = Math.log2(1 + hx) + Math.log2(1 + hy) + (raw.kill ? 3 : 0) + (both ? 2 : 0) + (mine ? 4 : 0)
    + (inside ? 4 : 0) - near / 10;
  return {
    a, b, hits: { a: raw.hitsBy.get(a) ?? 0, b: raw.hitsBy.get(b) ?? 0 }, kill: raw.kill,
    first: raw.first, last: raw.last, moment, score: Math.round(score * 100) / 100,
    events: raw.events, raw,
  };
}

/**
 * The fights near `t`: two things that hit each other, or one of which killed
 * the other, within `window` seconds of it. `shots` are the Accuracy board's
 * (each `{ f, t, hit, victim, dist }`), `kills` the replay's kill lines.
 * Returns `orient`'s fights, best first.
 */
export function fightsNear(rec, shots, kills, t, { window = WINDOW, follow = null } = {}) {
  const out = [];
  for (const { x, y, events } of pairEvents(rec, shots, kills, at => Math.abs(at - t) <= window).values()) {
    out.push(orient(rec, fightFrom(x, y, events.sort((p, q) => p.t - q.t)), t, follow));
  }
  out.sort((p, q) => q.score - p.score || Math.abs(p.moment - t) - Math.abs(q.moment - t));
  return out;
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

/** Seconds before a kill the match-up freezes on it: the round still in the
 *  air, the victim still in their seat. */
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

/** Where `b` was seen from `a` at `t`, in `b`'s own frame (view axes, the
 *  hull's nose along -z): `{ bearing, elevation, range, local }`, `bearing`
 *  in degrees from dead ahead (positive to its right), `elevation` how far
 *  above its horizon `a` was. `poseOf(life, t)` is replay-kinematics.js
 *  `poseAt` (view frame `{ p, q }`). */
export function seenFrom(a, b, t, poseOf) {
  const pa = poseOf(a, t);
  const pb = poseOf(b, t);
  if (!pa || !pb) return null;
  const d = [pa.p[0] - pb.p[0], pa.p[1] - pb.p[1], pa.p[2] - pb.p[2]];
  const range = Math.hypot(...d);
  // Into b's frame: the conjugate of its rotation.
  const [qx, qy, qz, qw] = pb.q;
  const ix = -qx, iy = -qy, iz = -qz;
  const tx = 2 * (iy * d[2] - iz * d[1]);
  const ty = 2 * (iz * d[0] - ix * d[2]);
  const tz = 2 * (ix * d[1] - iy * d[0]);
  _q[0] = d[0] + qw * tx + (iy * tz - iz * ty);
  _q[1] = d[1] + qw * ty + (iz * tx - ix * tz);
  _q[2] = d[2] + qw * tz + (ix * ty - iy * tx);
  const local = [_q[0], _q[1], _q[2]];
  const flat = Math.hypot(local[0], local[2]);
  return {
    bearing: Math.round((Math.atan2(local[0], -local[2]) * 180) / Math.PI * 10) / 10,
    elevation: Math.round((Math.atan2(local[1], flat) * 180) / Math.PI * 10) / 10,
    range: Math.round(range * 10) / 10,
    local,
  };
}

/** Words for where one was seen from, by its bearing from dead ahead:
 *  "they saw Kai head on", "... from the left side". */
export function aspectWords(bearing) {
  const b = Math.abs(bearing);
  const side = bearing >= 0 ? 'right' : 'left';
  if (b < 25) return 'head on';
  if (b < 65) return `from the front ${side} quarter`;
  if (b < 115) return `from the ${side} side`;
  if (b < 155) return `from the rear ${side} quarter`;
  return 'from behind';
}

/** A soldier's three hit capsules (DIE-10, DMG-3): head 40, chest 41, limbs 42. */
export const BODY_PARTS = Object.freeze([
  { id: 'head', material: 40, label: 'head' },
  { id: 'chest', material: 41, label: 'chest' },
  { id: 'limbs', material: 42, label: 'arms or legs' },
]);

/** Which of a soldier's capsules best explains a recorded drop of `amount`,
 *  from `price(material)` (a square hit's damage, falloff applied): the part
 *  and how close, `{ part, expected, off }`, or null when none is within a
 *  fifth of the drop (a blast, two rounds in one sample). A drop that kills
 *  them is only what they had left, so it names a part only when one part alone
 *  costs at least that. */
export function bodyPartFor(amount, price, { killed = false } = {}) {
  const priced = BODY_PARTS.map(part => ({ part, expected: price(part.material) }))
    .filter(p => p.expected > 0)
    .map(p => ({ ...p, expected: Math.round(p.expected * 10) / 10 }));
  if (killed) {
    const enough = priced.filter(p => p.expected >= amount - 0.05);
    return enough.length === 1 ? { ...enough[0], off: 0 } : null;
  }
  let best = null;
  for (const p of priced) {
    const off = Math.abs(p.expected - amount);
    if (!best || off < best.off) best = { ...p, off };
  }
  if (!best || best.off > Math.max(1, amount * 0.2)) return null;
  return best;
}

/** `n` thing`s`. */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A list in words: a, b and c. */
const listed = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * One side's tally against the other, `rounds` that side's from
 * `roundsBetween` (with `struck` set by the page on a near round that met the
 * other's hull: `{ damage }`, 0 for a plate it cannot hurt). Returns `{ fired,
 * hit, glanced, missed, dealt }`: rounds that did damage, rounds that met
 * the hull and did none, the rest.
 */
export function tallyOf(rounds) {
  let hit = 0, glanced = 0, missed = 0, dealt = 0;
  for (const r of rounds) {
    if (r.kind === 'hit') {
      hit++;
      dealt += r.drop?.amount ?? 0;
    } else if (r.struck) glanced++;
    else missed++;
  }
  return { fired: rounds.length, hit, glanced, missed, dealt: Math.round(dealt * 10) / 10 };
}

/**
 * The plain words for one side of the match-up: what its rounds did, what
 * its gun can and cannot get through on the other, and how the other was
 * turned to it. Never a verdict on who should have won: what happened, and
 * what the numbers allowed (features/battle-schools, "Lesson from the model
 * browser: no verdict").
 *
 * `side`: `{ who, gun, tally, armour, seen, kill }`, where `armour` is
 * `{ immune, of, from }` (the other's armour materials this gun does nothing
 * to, of how many, and the thinnest of them where they are plates in mm) and
 * `seen` `{ aspect, share, perHit, hits, range }` (what the other showed
 * this side, the share of it this gun gets through, a hit there, the hits
 * that kill).
 */
export function sideWords(side, other) {
  const lines = [];
  const t = side.tally;
  if (t?.fired) {
    const parts = [`${t.hit} did damage`];
    if (t.glanced) parts.push(`${t.glanced} struck and did none`);
    if (t.missed) parts.push(`${t.missed} missed`);
    lines.push(`${side.who} fired ${count(t.fired, 'round')} at ${other.who}: ${listed(parts)}.`);
    if (t.dealt > 0) lines.push(`Their hits took ${fmt(t.dealt)} of ${other.who}'s hit points.`);
  } else {
    lines.push(`${side.who} fired nothing at ${other.who} that the recording saw.`);
  }
  if (side.armour && side.gun) {
    const { immune, of, from } = side.armour;
    if (immune > 0 && immune === of) {
      lines.push(`Their ${side.gun} does nothing to any armour on the ${other.what}.`);
    } else if (immune > 0) {
      lines.push(`Their ${side.gun} does nothing to ${immune} of the ${of} armour materials on the ${other.what}${from ? `: every plate from ${from} up` : ''}.`);
    } else if (of > 0) {
      lines.push(`Their ${side.gun} can hurt every armour material on the ${other.what}.`);
    }
  }
  if (side.seen) {
    const { aspect, share, perHit, hits, range } = side.seen;
    let line = `${Number.isFinite(range) ? `From ${Math.round(range)} m they` : 'They'} saw ${other.who} ${aspect}`;
    if (Number.isFinite(share)) {
      line += share > 0 ? `, and ${Math.round(share * 100)}% of what they could see was armour their gun gets through` : ', and none of what they could see was armour their gun gets through';
    }
    if (share > 0 && hits) line += `; ${count(hits, 'hit')} there destroy it from full health`;
    else if (perHit > 0 && hits) line += `; ${fmt(perHit)} a hit there, ${count(hits, 'hit')} to destroy it`;
    lines.push(`${line}.`);
  }
  return lines;
}

const fmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));

/** The fight's ending in words. */
export function endingWords(fight, a, b, pretty = w => w) {
  const k = fight.kill;
  if (!k) return 'Neither was killed in this fight.';
  const killer = k.killer === fight.a ? a : b;
  const victim = k.killer === fight.a ? b : a;
  return `${killer.who} killed ${victim.who}${k.weapon ? ` (${pretty(k.weapon)})` : ''}.`;
}

/** The hit points `life` had at `t`, and its most. */
export function healthOf(life, t) {
  const hp = hpAt(life, t);
  const max = Number(life?.maxhp) || (life?.soldier ? 30 : null);
  return { hp: Number.isFinite(hp) ? hp : null, max };
}

/** A plate's thickness in mm where its material is named for it (FHSW's
 *  "150mm"), else null. */
export function plateMm(label) {
  const m = /^(\d+(?:[.,]\d+)?)\s*mm$/i.exec(String(label ?? '').trim());
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * What one gun does to a hull's armour: `materials` the hull's collision
 * faces' defence materials, `price(material)` a square hit's damage there.
 * `{ immune, of, from, immuneList, hurtList }`: how many of its materials the
 * gun does nothing to, of how many, and -- where the mod names its plates by
 * thickness -- the thickness from which every plate is proof against it
 * (null when a thicker plate than the thinnest proof one still gives).
 */
export function armourAgainst(materials, price, labelOf = () => '') {
  const unique = [...new Set(materials.filter(m => Number.isFinite(m)))].sort((x, y) => x - y);
  const immuneList = unique.filter(m => !(price(m) > 0));
  const hurtList = unique.filter(m => price(m) > 0);
  const proof = immuneList.map(m => plateMm(labelOf(m))).filter(v => v !== null);
  const given = hurtList.map(m => plateMm(labelOf(m))).filter(v => v !== null);
  let from = null;
  if (proof.length) {
    const thinnest = Math.min(...proof);
    if (!given.length || thinnest > Math.max(...given)) from = `${thinnest} mm`;
  }
  return { immune: immuneList.length, of: unique.length, from, immuneList, hurtList };
}
