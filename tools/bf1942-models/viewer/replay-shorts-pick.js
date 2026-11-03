// Replay Shorts: which kills in a recording are worth a Short
// (features/replay-shorts, "Picking the kills").
//
// Pure, so the render job runs it under node on a parsed recording without a
// browser, and the tests drive it the same way. Every kill the recording saw
// both men for (`fresh`) and can tie a round to is classed by what the two men
// were in at the kill: air to air, ground to air, tank to tank, or a long shot
// on foot. Each gets a score; the best few of a recording are the Shorts, at
// most one of a kind while another kind qualifies, and never two of the same
// moment.

import { controlledAt, isReplicated, nameAt, positionAt, rootOf, teamAt } from './replay-recording.js';
import { killFactsOf } from './replay-dossier.js';
import { LONG_SHOT, MULTI_GAP, NOT_AIMED } from './replay-medals.js';

/** Seconds before the kill line that say what each man was in: the dossier's
 *  own look-back, so a hull the kill destroyed still counts as his. */
const BEFORE = 0.2;
/** Shorts a recording gives at most. */
export const MAX_PER_RECORDING = 3;
/** Two kills closer than this are one moment: one Short. */
const SAME_MOMENT = 8;
/** A land hull with at least this many hit points is armour; a jeep, a lorry
 *  and a motorbike are not. */
const ARMOUR_HP = 100;
/** Land templates that are guns on the ground, not armour, whatever their hit
 *  points. */
const EMPLACEMENT = /mortar|howitzer|atgun|pak\d|flak|nebel|artillery|katyusha|bm31|bunker|aa_|_aa|maxim|mg42|browning|battery/i;

/** The stretch round a kill a Short shows of it, seconds from the kill: the
 *  real-time part starts 5 s before (plus half a second of settling), and the
 *  man is down a second after. Both men must be in the recording for all of
 *  it. */
export const WINDOW = Object.freeze({ before: 5.5, after: 1 });
/** A gap between two of a moving hull's samples longer than GAP, across which
 *  it moved more than JUMP metres, is a hop on screen: the recorder had him
 *  out of range for a moment (2026-11-03, a Mustang 79.5 m in 0.84 s on Battle
 *  of Britain). A man standing still sends nothing for seconds and moves
 *  nothing: that is not one. */
const GAP = 0.3;
const JUMP = 15;

export const KINDS = Object.freeze(['air-to-air', 'ground-to-air', 'tank-to-tank', 'long-shot', 'own-goal', 'spawn-death']);
const BASE = { 'air-to-air': 100, 'ground-to-air': 90, 'tank-to-tank': 70, 'long-shot': 50, 'own-goal': 80, 'spawn-death': 80 };

/** A man killed this soon after he spawned makes a Short (the owner,
 *  2026-11-03: "a soldier spawns in, and dies within 5 seconds"). */
const SPAWN_DEATH = 5;

// --- own goals (the owner, 2026-11-03: "a soldier kills themself by accident,
// e.g. a grenade, falling off something", with a WASTED ending) ---------------

/** A weapon that is thrown, set or dropped: his own can kill him. */
const EXPLOSIVE = /grenade|satchel|tnt|dynamite|exppack|explosive|landmine|atmine|apmine|c4|detonat/i;
/** A destroyed hull leaves a wreck the game removes about this long after:
 *  a hull gone this long after his death was destroyed with him. */
const WRECK_LIFE = [8, 12];
/** How fast a hull must have been going for its loss to be a crash, m/s: a
 *  plane in flight, a car at speed. One standing still that blows up is
 *  something else (a bomb nobody was credited for). */
const CRASH_SPEED = { air: 15, land: 8, sea: 4 };
/** Metres a man must have dropped in the last FALL_SECONDS to have fallen. */
const FALL_DROP = 8;
const FALL_SECONDS = 4;
/** Seconds before his death his own explosive may have gone off. */
const EXPLOSIVE_SECONDS = 8;

const speedAt = (life, t, dt = 1) => {
  const a = positionAt(life, t - dt);
  const b = positionAt(life, t);
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt : 0;
};

/**
 * What killed a man the server credits nobody for (the kill log's "is no
 * more", `kind: 'death'`): `{ cause, life, vehicle, weapon, drop, speed }` with
 * `cause` crash (his hull destroyed with him at speed), fall (he dropped
 * FALL_DROP m or more), explosive (his own thrown or set charge), or null
 * where the recording cannot tell (the console's kill, an uncredited bomb).
 */
export function ownGoalOf(rec, k, models) {
  if (k.kind !== 'death' || k.victim === null || k.victim === undefined) return null;
  const t = k.t - 0.2;
  const life = rootOf(rec, controlledAt(rec, k.victim, t), t, k.victim)?.life;
  if (!life || life.camera) return null;
  if (!life.soldier) {
    const gone = (life.destroyed ?? Infinity) - k.t;
    const wrecked = gone >= WRECK_LIFE[0] && gone <= WRECK_LIFE[1];
    const kind = hullKind(life.tmpl, models);
    const speed = speedAt(life, k.t - 0.05);
    const least = CRASH_SPEED[kind === 'armour' ? 'land' : kind] ?? CRASH_SPEED.land;
    return wrecked && speed >= least ? { cause: 'crash', life, vehicle: life.tmpl, air: kind === 'air', speed: Math.round(speed) } : null;
  }
  const fired = (rec.fires ?? []).filter(f => f.pid === k.victim && f.t <= k.t && f.t > k.t - EXPLOSIVE_SECONDS && EXPLOSIVE.test(f.weapon ?? ''));
  if (fired.length) return { cause: 'explosive', life, weapon: fired.at(-1).weapon };
  const a = positionAt(life, Math.max(life.created ?? 0, k.t - FALL_SECONDS));
  const b = positionAt(life, k.t - 0.05);
  const drop = a && b ? a[1] - b[1] : 0;
  return drop >= FALL_DROP ? { cause: 'fall', life, drop: Math.round(drop) } : null;
}
const MULTI_BONUS = 15;

/** The key a Short of kill `t`, `victim` in recording `slug` is filed under:
 *  the API's own (`api/Shorts`), so the same kill is never clipped twice. */
export const shortKey = (slug, t, victim) => `${slug}:${Number(t).toFixed(2)}:${victim}`;

/** What `pid` was in at `t`: `{ foot: true }`, `{ tmpl, kind }` for a hull
 *  (`kind` air, sea, armour or land from `models`), or null. */
function mountOf(rec, pid, t, models) {
  if (pid === null || pid === undefined) return null;
  const nid = controlledAt(rec, pid, t);
  const root = rootOf(rec, nid, t, pid);
  const life = root?.life;
  if (!life || life.camera) return null;
  if (life.soldier) return { foot: true };
  return { tmpl: life.tmpl, kind: hullKind(life.tmpl, models) };
}

/** A hull template's kind from the tree's models (`Map<lower name, {
 *  category, hitpoints }>`): air, sea, armour, land, or null unknown. */
export function hullKind(tmpl, models) {
  const row = models?.get(String(tmpl ?? '').toLowerCase());
  if (!row) return null;
  if (row.category === 'air') return 'air';
  if (row.category === 'sea') return 'sea';
  if (row.category !== 'land') return null;
  if (EMPLACEMENT.test(tmpl)) return 'land';
  return (row.hitpoints ?? 0) >= ARMOUR_HP ? 'armour' : 'land';
}

/** Whether the recording has `life` whole over [t0, t1]: replicated all the
 *  while it existed in it, and no hop (a move of more than JUMP metres across
 *  a gap of more than GAP seconds between samples). `{ ok, why }`. */
export function continuityOf(life, t0, t1) {
  if (!life) return { ok: false, why: 'no life' };
  const from = Math.max(t0, life.created ?? t0);
  const to = Math.min(t1, life.destroyed ?? t1);
  for (let t = from; t <= to; t += 0.1) {
    if (!isReplicated(life, t)) return { ok: false, why: `out of range at ${t.toFixed(1)}` };
  }
  const keys = life.keys;
  let prev = null;
  for (let i = 0; i < (keys?.length ?? 0); i++) {
    const t = keys.time(i);
    if (t < from - 2) continue;
    if (t > to + 2) break;
    if (prev !== null && t - prev > GAP) {
      const a = positionAt(life, prev);
      const b = positionAt(life, t);
      const d = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0;
      if (d > JUMP && t > from && prev < to) return { ok: false, why: `hops ${Math.round(d)} m at ${prev.toFixed(1)}` };
    }
    prev = t;
  }
  return { ok: true, why: null };
}

/** The life `pid` is in at `t`: his hull's, else his soldier's. */
function lifeOf(rec, pid, t) {
  const root = rootOf(rec, controlledAt(rec, pid, t), t, pid);
  return root?.life ?? null;
}

/** The kind of Short a kill makes, or null for one that makes none. */
export function kindOfKill(killer, victim, distance, weapon) {
  if (!killer || !victim) return null;
  if (victim.kind === 'air') return killer.kind === 'air' ? 'air-to-air' : 'ground-to-air';
  if (killer.kind === 'armour' && victim.kind === 'armour') return 'tank-to-tank';
  if (killer.foot && victim.foot && distance >= LONG_SHOT && !NOT_AIMED.test(String(weapon ?? ''))) return 'long-shot';
  return null;
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'to']);

/** A level's name as words:`meuse_river_line-1944` -> `Meuse River Line`. */
export function levelWords(level) {
  return String(level ?? '').replace(/-\d{4}$/, '').split(/[_\s]+/).filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** A Short's title from its facts: `Tiger_Late kills M36B1 at 279 m`.
 *  `display` turns a template into the game's words. */
export function titleOf(c, display = s => s) {
  const kv = c.killerVehicle ? display(c.killerVehicle) : null;
  const vv = c.victimVehicle ? display(c.victimVehicle) : null;
  const m = `${c.distance} m`;
  if (c.kind === 'spawn-death') {
    return `Spawned and ${c.teamkill ? 'killed by his own side' : 'killed'} in ${c.lived.toFixed(1)} s on ${levelWords(c.level)}`;
  }
  if (c.kind === 'own-goal') {
    const where = levelWords(c.level);
    if (c.cause === 'crash') return `${display(c.victimVehicle)} ${c.air ? 'pilot' : 'driver'} crashes on ${where}`;
    if (c.cause === 'fall') return `Falls ${c.distance} m to his death on ${where}`;
    return `Blown up by his own ${display(c.weapon)} on ${where}`;
  }
  switch (c.kind) {
    case 'air-to-air': return `${kv} downs ${vv} at ${m}`;
    case 'ground-to-air': return `${kv ?? (c.weapon ? display(c.weapon) : c.killerName)} downs ${vv} at ${m}`;
    case 'tank-to-tank': return `${kv} kills ${vv} at ${m}`;
    case 'long-shot': return c.weapon ? `${m} ${display(c.weapon)} shot on ${levelWords(c.level)}` : `${m} shot on ${levelWords(c.level)}`;
    default: return `${c.killerName} kills ${c.victimName}`;
  }
}

/**
 * Every kill in `rec` that would make a Short, best first: `{ key, t, victim,
 * killer, killerName, victimName, kind, score, distance, weapon,
 * killerVehicle, victimVehicle, level, multi }`. `models` is the tree's
 * `Map<lower name, { category, hitpoints }>`; `slug` the recording's.
 */
export function shortCandidates(rec, { models, slug = '', kills = rec.kills } = {}) {
  const facts = killFactsOf(rec, kills);
  const out = [];
  for (const [k, f] of facts) {
    if (!f.fresh || !f.round?.f || f.distance === null) continue;
    if (k.victim === null || k.victim === undefined || k.killer === k.victim) continue;
    const at = k.t - BEFORE;
    if (teamAt(rec, k.killer, at) === teamAt(rec, k.victim, at)) continue;
    const killer = mountOf(rec, k.killer, at, models);
    const victim = mountOf(rec, k.victim, at, models);
    // A kill line can name no weapon; the round that made it does.
    const weapon = k.weapon || f.round.f.weapon || null;
    const kind = kindOfKill(killer, victim, f.distance, weapon);
    if (!kind) continue;
    // The recording must hold both men whole over what the Short shows.
    const [w0, w1] = [k.t - WINDOW.before, k.t + WINDOW.after];
    if (!continuityOf(lifeOf(rec, k.killer, at), w0, w1).ok) continue;
    if (!continuityOf(lifeOf(rec, k.victim, at), w0, w1).ok) continue;
    const multi = kills.filter(o => o !== k && o.killer === k.killer && Math.abs(o.t - k.t) <= MULTI_GAP).length;
    const score = BASE[kind] + f.distance / (kind === 'long-shot' ? 6 : 10) + (multi ? MULTI_BONUS : 0);
    out.push({
      key: shortKey(slug, k.t, k.victim), t: k.t, victim: k.victim, killer: k.killer,
      killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t),
      kind, score: Math.round(score * 10) / 10, distance: f.distance, weapon,
      killerVehicle: killer.tmpl ?? null, victimVehicle: victim.tmpl ?? null, level: rec.level, multi,
    });
  }
  for (const k of kills) {
    const own = ownGoalOf(rec, k, models);
    if (!own) continue;
    if (!continuityOf(own.life, k.t - WINDOW.before, k.t + WINDOW.after).ok) continue;
    const bonus = own.cause === 'crash' ? (own.air ? 25 : 10) + Math.min(20, own.speed / 5) : own.cause === 'fall' ? Math.min(30, own.drop / 2) : 15;
    out.push({
      key: shortKey(slug, k.t, k.victim), t: k.t, victim: k.victim, killer: k.victim,
      killerName: nameAt(rec, k.victim, k.t), victimName: nameAt(rec, k.victim, k.t),
      kind: 'own-goal', cause: own.cause, air: Boolean(own.air), score: Math.round((BASE['own-goal'] + bonus) * 10) / 10,
      distance: own.drop ?? 0, weapon: own.weapon ?? null, killerVehicle: null, victimVehicle: own.vehicle ?? null,
      level: rec.level, multi: 0,
    });
  }
  // Spawned and killed within SPAWN_DEATH seconds: a real spawn (not a man
  // first coming into the recorder's range), a kill line for it (an uncredited
  // end four seconds in is usually him climbing into a hull), and the
  // recording holding him the whole short life.
  for (const life of rec.lives) {
    if (!life.soldier || !life.spawnedLate || life.diedAt === undefined) continue;
    const lived = life.diedAt - life.created;
    if (!(lived > 0) || lived > SPAWN_DEATH) continue;
    const k = kills.find(x => x.victim === life.pid && Math.abs(x.t - life.diedAt) < 0.5 && x.killer !== null && x.killer !== undefined && x.killer !== x.victim);
    if (!k) continue;
    // Replicated a tenth or two after the spawn event; half a second is allowed.
    if (!continuityOf(life, life.created + 0.5, k.t + WINDOW.after).ok) continue;
    if (out.some(c => c.key === shortKey(slug, k.t, k.victim))) continue;
    const killer = mountOf(rec, k.killer, k.t - BEFORE, models);
    out.push({
      key: shortKey(slug, k.t, k.victim), t: k.t, victim: k.victim, killer: k.killer,
      killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t),
      kind: 'spawn-death', spawned: life.created, lived: Math.round(lived * 10) / 10, teamkill: k.kind === 'teamkill',
      score: Math.round((BASE['spawn-death'] + (SPAWN_DEATH - lived) * 6 + (killer?.tmpl ? 8 : 0)) * 10) / 10,
      distance: 0, weapon: k.weapon ?? null, killerVehicle: killer?.tmpl ?? null, victimVehicle: null, level: rec.level, multi: 0,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.t - b.t);
}

/**
 * The Shorts of a recording from its candidates (best first): the best of
 * each kind first, then the best of the rest, at most `max`, none within
 * SAME_MOMENT of another, none whose key is in `taken` (already clipped).
 */
export function pickShorts(candidates, { max = MAX_PER_RECORDING, taken = new Set() } = {}) {
  const fresh = candidates.filter(c => !taken.has(c.key));
  const picked = [];
  const clear = c => picked.every(p => Math.abs(p.t - c.t) >= SAME_MOMENT);
  // The best of each kind, the kinds ranked by their best: a crash beats the
  // third tank kill.
  const bests = KINDS.map(kind => fresh.find(c => c.kind === kind)).filter(Boolean).sort((a, b) => b.score - a.score);
  for (const best of bests) {
    if (picked.length >= max) break;
    if (clear(best)) picked.push(best);
  }
  for (const c of fresh) {
    if (picked.length >= max) break;
    if (!picked.includes(c) && clear(c)) picked.push(c);
  }
  return picked.sort((a, b) => b.score - a.score);
}
