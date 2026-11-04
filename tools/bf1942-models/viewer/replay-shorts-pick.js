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

import { controlledAt, isReplicated, nameAt, playerAt, positionAt, rootOf, teamAt } from './replay-recording.js';
import { killFactsOf } from './replay-dossier.js';
import { LONG_SHOT, MULTI_GAP, NOT_AIMED } from './replay-medals.js';

/** Seconds before the kill line that say what each man was in: the dossier's
 *  own look-back, so a hull the kill destroyed still counts as his. */
const BEFORE = 0.2;

/** Whether `pid` was a bot at `t` (the recording's player row says `ai`).
 *  No Short ever shows one, killing or killed (the owner, 2026-11-04: "We
 *  never want to clip bots in any clip"). */
export const isBot = (rec, pid, t) => pid !== null && pid !== undefined && playerAt(rec, pid, t)?.ai === true;
/** A kill with a bot on either side. */
const botKill = (rec, k) => isBot(rec, k.killer, k.t) || isBot(rec, k.victim, k.t);
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

/** The kinds filmed one kill a Short. Own goals and spawn deaths are reels
 *  (`reelOf`): one alone was too quick or too forced (the owner, 2026-11-03). */
export const KINDS = Object.freeze(['air-to-air', 'ground-to-air', 'tank-to-tank', 'long-shot']);
const BASE = { 'air-to-air': 100, 'ground-to-air': 90, 'tank-to-tank': 70, 'long-shot': 50, 'own-goal': 80, 'spawn-death': 80 };

/** A man killed this soon after he spawned (the owner, 2026-11-03: "a
 *  soldier spawns in, and dies within 5 seconds"). One alone is too quick to
 *  follow ("not coherent"), so they are a round's reel, never a Short each:
 *  REEL.min of them at least, the REEL.max best, in time order. */
const SPAWN_DEATH = 5;
export const REEL = Object.freeze({ min: 3, max: 5 });

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
  if (c.kind === 'spawn-death' && c.reel) {
    return `${c.parts.length} men killed within seconds of spawning on ${levelWords(c.level)}`;
  }
  if (c.reel && c.asmr) return `Battlefield ASMR on ${levelWords(c.level)}`;
  if (c.featured && c.kind === 'other') {
    return `${c.killerName}'s longest shot on ${levelWords(c.level)}: ${c.distance} m`;
  }
  if (c.reel && c.burst) {
    return `${c.playerShown ?? c.playerName}: ${c.total} kills in ${Math.max(1, Math.round(c.span))} s on ${levelWords(c.level)}`;
  }
  if (c.reel && c.streak) {
    return `${c.playerShown ?? c.playerName}: a ${c.total}-kill streak on ${levelWords(c.level)}`;
  }
  if (c.reel && c.player !== undefined) {
    return `${c.playerShown ?? c.playerName}: ${c.total} ${c.air ? 'air' : 'vehicle'} kills on ${levelWords(c.level)}`;
  }
  if (c.kind === 'own-goal' && c.reel) {
    const crashes = c.parts.filter(p => p.cause === 'crash').length;
    const what = crashes === c.parts.length ? 'crashes' : crashes === 0 ? 'self-inflicted deaths' : 'crashes, falls and own goals';
    return `${c.parts.length} ${what} on ${levelWords(c.level)}`;
  }
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
    if (botKill(rec, k)) continue;
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
    if (!own || isBot(rec, k.victim, k.t)) continue;
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
    if (!k || botKill(rec, k)) continue;
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

/** A player's vehicle kills a round make his own compilation from this many
 *  (the owner, 2026-11-03: air to air "per player in a round, if they have
 *  >= 5"; "same for ... vehicle to vehicle battles"), his best PLAYER_REEL.max
 *  in time order. */
export const PLAYER_REEL = Object.freeze({ min: 5, max: 6, sameMoment: 1 });

/**
 * Every kill in `rec` with both men in hulls, whole in the recording over
 * what a compilation shows: `{ t, killer, victim, air, killerVehicle,
 * victimVehicle, distance, score, ... }`, `air` when both flew.
 */
export function vehicleKillsOf(rec, { models, kills = rec.kills } = {}) {
  const facts = killFactsOf(rec, kills);
  const out = [];
  for (const [k, f] of facts) {
    if (!f.fresh || k.victim === null || k.victim === undefined || k.killer === k.victim) continue;
    if (botKill(rec, k)) continue;
    const at = k.t - BEFORE;
    if (teamAt(rec, k.killer, at) === teamAt(rec, k.victim, at)) continue;
    const killer = mountOf(rec, k.killer, at, models);
    const victim = mountOf(rec, k.victim, at, models);
    if (!killer?.tmpl || !victim?.tmpl) continue;
    const [w0, w1] = [k.t - 4.5, k.t + 1];
    if (!continuityOf(lifeOf(rec, k.killer, at), w0, w1).ok || !continuityOf(lifeOf(rec, k.victim, at), w0, w1).ok) continue;
    const air = killer.kind === 'air' && victim.kind === 'air';
    // A vehicle kill is filmed as the bullet chase, which needs its round.
    if (!air && !f.round?.f) continue;
    out.push({
      t: k.t, killer: k.killer, victim: k.victim, air, killerVehicle: killer.tmpl, victimVehicle: victim.tmpl,
      killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t), weapon: k.weapon ?? null,
      distance: f.distance ?? 0, score: (air ? 20 : 0) + (f.distance ?? 0) / 10 + (victim.kind === 'armour' || victim.kind === 'air' ? 10 : 0),
      kind: air ? 'air-to-air' : 'tank-to-tank', mode: air ? 'volley' : 'shot', level: rec.level,
    });
  }
  return out;
}

/**
 * Each player's compilation of a round: `[{ key, kind, reel: true, player,
 * playerName, parts, air, ... }]`, one for his air kills and one for his
 * other vehicle kills when he has PLAYER_REEL.min of either. Keyed on the
 * first kill and a victim of -(1000 + pid) for air, -(2000 + pid) else.
 */
export function playerReelsOf(vehicleKills, { slug = '', level = '' } = {}) {
  const groups = new Map();
  for (const k of vehicleKills) {
    const id = `${k.killer}:${k.air}`;
    groups.set(id, [...(groups.get(id) ?? []), k]);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < PLAYER_REEL.min) continue;
    const { killer, air, killerName } = list[0];
    // One shot that kills two men (a shell into a crewed hull) is one moment,
    // filmed once: as two parts it showed the same footage twice (the owner,
    // 2026-11-04, almighty-_- on Rush to Baghdad). `count` is its kills.
    const moments = [];
    for (const k of [...list].sort((a, b) => a.t - b.t)) {
      const last = moments.at(-1);
      if (last && k.t - last.lastT < PLAYER_REEL.sameMoment) {
        last.count++;
        last.names.push(k.victimName);
        last.lastT = k.t;
        last.score += k.score;
        if (k.score > last.best.score) last.best = k;
      } else {
        moments.push({ best: k, count: 1, lastT: k.t, score: k.score, names: [k.victimName] });
      }
    }
    const parts = moments.sort((a, b) => b.score - a.score).slice(0, PLAYER_REEL.max)
      .map(m => ({ ...m.best, count: m.count, victimNames: m.names })).sort((a, b) => a.t - b.t);
    const victim = -((air ? 1000 : 2000) + killer);
    out.push({
      key: shortKey(slug, parts[0].t, victim), kind: air ? 'air-to-air' : 'tank-to-tank', reel: true, player: killer,
      playerName: killerName, total: list.length, air, parts, t: parts[0].t, victim, killer, killerName, victimName: '',
      score: list.length * 10, distance: 0, weapon: null, killerVehicle: list[0].killerVehicle, victimVehicle: null,
      level: level || list[0].level, multi: 0,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The victim a reel is keyed on: none, and one per kind of reel. */
const REEL_VICTIM = { 'spawn-death': -1, 'own-goal': -2 };

/**
 * A round's own goals or spawn deaths (`kind`) as one reel: `{ key, kind,
 * reel: true, parts, t, victim, score, ... }` with `parts` the REEL.max best
 * in time order, or null under REEL.min. Keyed on its first moment and a
 * victim of its own (REEL_VICTIM).
 */
export function reelOf(candidates, kind, { slug = '', level = '', causes = null } = {}) {
  const all = candidates.filter(c => c.kind === kind && (!causes || causes.includes(c.cause)));
  if (all.length < REEL.min) return null;
  const parts = [...all].sort((a, b) => b.score - a.score).slice(0, REEL.max).sort((a, b) => a.t - b.t);
  const total = parts.reduce((s, p) => s + (p.lived ?? 0), 0);
  return {
    key: shortKey(slug, parts[0].t, REEL_VICTIM[kind]), kind, reel: true, parts, t: parts[0].t, victim: REEL_VICTIM[kind],
    killer: parts[0].killer, killerName: '', victimName: '', score: Math.max(...parts.map(p => p.score)),
    distance: 0, weapon: null, killerVehicle: null, victimVehicle: null, level: level || parts[0].level, multi: 0,
    lived: Math.round(total * 10) / 10,
  };
}

/**
 * The Shorts of a recording from its candidates (best first): the best of
 * each kind first, then the best of the rest, at most `max`, none within
 * SAME_MOMENT of another, none whose key is in `taken` (already clipped).
 */
export function pickShorts(candidates, { max = MAX_PER_RECORDING, taken = new Set() } = {}) {
  const fresh = candidates.filter(c => KINDS.includes(c.kind) && !taken.has(c.key));
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

/** A kill the recording holds whole that can be filmed as a compilation's
 *  part (air on air the volley, else the bullet chase on its round), or null. */
function filmablePart(rec, facts, k, models) {
  const f = facts.get(k);
  if (!f?.fresh) return null;
  const at = k.t - BEFORE;
  if (teamAt(rec, k.killer, at) === teamAt(rec, k.victim, at)) return null;
  const [w0, w1] = [k.t - 4.5, k.t + 1];
  if (!continuityOf(lifeOf(rec, k.killer, at), w0, w1).ok || !continuityOf(lifeOf(rec, k.victim, at), w0, w1).ok) return null;
  const killer = mountOf(rec, k.killer, at, models);
  const victim = mountOf(rec, k.victim, at, models);
  const air = killer?.kind === 'air' && victim?.kind === 'air';
  if (!air && !f.round?.f) return null;
  return {
    t: k.t, killer: k.killer, victim: k.victim, air,
    killerVehicle: killer?.tmpl ?? null, victimVehicle: victim?.tmpl ?? null,
    killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t), weapon: k.weapon ?? null,
    distance: f.distance ?? 0,
    score: (air ? 20 : 0) + (f.distance ?? 0) / 10 + (victim?.kind === 'armour' || victim?.kind === 'air' ? 10 : 0),
    kind: air ? 'air-to-air' : victim?.tmpl ? 'tank-to-tank' : 'long-shot', mode: air ? 'volley' : 'shot', level: rec.level,
  };
}

/** A player's kill streak in one life makes a compilation from STREAK.min
 *  kills (a player's idea, 2026-11-04: "find someone who gets on big streaks
 *  ... edit their streak into a compilation"); a round films its `perRound`
 *  longest, one a player, each its best `parts` kills in order. */
export const STREAK = Object.freeze({ min: 10, perRound: 2, parts: 5 });

/**
 * Every life's run of credited kills in `rec`, longest first: `{ pid, kills,
 * endedAt, endedBy }`, `endedBy` the pid that killed him (null for a death of
 * his own, `endedAt` null when he lived to the round's end). A teamkill, a
 * kill of himself and an uncredited death count for nothing but end his own.
 */
export function streaksOf(rec, { kills = rec.kills } = {}) {
  const runs = new Map();
  const out = [];
  const close = (pid, k) => {
    const run = runs.get(pid);
    runs.delete(pid);
    if (!run?.length) return;
    const by = k && k.kind !== 'death' && k.killer !== null && k.killer !== undefined && k.killer !== pid ? k.killer : null;
    out.push({ pid, kills: run, endedAt: k ? k.t : null, endedBy: by, end: k ?? null });
  };
  for (const k of [...kills].sort((a, b) => a.t - b.t)) {
    if (k.victim !== null && k.victim !== undefined) close(k.victim, k);
    const credited = k.kind !== 'death' && k.kind !== 'teamkill' && k.killer !== null && k.killer !== undefined
      && k.killer !== k.victim && k.victim !== null && k.victim !== undefined && !(rec.players && botKill(rec, k));
    if (!credited) continue;
    if (!runs.has(k.killer)) runs.set(k.killer, []);
    runs.get(k.killer).push(k);
  }
  for (const pid of [...runs.keys()]) close(pid, null);
  return out.sort((a, b) => b.kills.length - a.kills.length || a.kills[0].t - b.kills[0].t);
}

/**
 * A round's streak compilations: `[{ key, kind: 'streak', reel: true, streak:
 * true, player, playerName, total, endedByName, parts, ... }]`. A part is a
 * kill the recording holds whole that can be filmed (air on air as the volley,
 * else the bullet chase on its round); kills of one moment are one part, and
 * each carries `streakIndex`, its place in the streak. Keyed on the first part
 * and a victim of -(3000 + pid).
 */
export function streakReelsOf(rec, { models, slug = '', kills = rec.kills } = {}) {
  const facts = killFactsOf(rec, kills);
  const out = [];
  const seen = new Set();
  for (const run of streaksOf(rec, { kills })) {
    if (run.kills.length < STREAK.min || out.length >= STREAK.perRound) break;
    if (seen.has(run.pid)) continue;
    const partOf = k => filmablePart(rec, facts, k, models);
    const film = [];
    for (const [i, k] of run.kills.entries()) {
      const part = partOf(k);
      if (part) film.push({ ...part, streakIndex: i + 1 });
    }
    // Kills of one moment (a shell into a crewed hull) are one part.
    const moments = [];
    for (const k of film) {
      const last = moments.at(-1);
      if (last && k.t - last.lastT < PLAYER_REEL.sameMoment) {
        last.count++;
        last.lastT = k.t;
        last.names.push(k.victimName);
        last.score += k.score;
        if (k.score > last.best.score) last.best = k;
      } else {
        moments.push({ best: k, count: 1, lastT: k.t, score: k.score, names: [k.victimName], first: k.streakIndex });
      }
    }
    if (moments.length < Math.min(3, STREAK.parts)) continue;
    const parts = moments.sort((a, b) => b.score - a.score).slice(0, STREAK.parts)
      .map(m => ({ ...m.best, count: m.count, victimNames: m.names, streakIndex: m.first + m.count - 1 }))
      .sort((a, b) => a.t - b.t);
    seen.add(run.pid);
    const victim = -(3000 + run.pid);
    const playerName = nameAt(rec, run.pid, run.kills[0].t);
    out.push({
      key: shortKey(slug, parts[0].t, victim), kind: 'streak', reel: true, streak: true, player: run.pid,
      playerName, total: run.kills.length, air: false, parts, t: parts[0].t, victim, killer: run.pid,
      killerName: playerName, victimName: '', endedAt: run.endedAt,
      endedByName: run.endedBy !== null ? nameAt(rec, run.endedBy, run.endedAt) : null,
      // The kill that ended it, filmed last when it can be (the owner,
      // 2026-11-04: "finish when they die and put up who ended it").
      ending: run.endedBy !== null && run.end ? partOf(run.end) : null,
      score: run.kills.length * 10, distance: 0, weapon: null, killerVehicle: parts[0].killerVehicle, victimVehicle: null,
      level: rec.level, multi: 0,
    });
  }
  return out;
}

/** The most kills in the shortest time (the owner, 2026-11-04: "rank the most
 *  number of kills in the shortest period ... starting with minimum of 5"):
 *  a player's densest window of `window` seconds holding `min` kills or more,
 *  a round's `perRound` best, filmed continuously and sped up past `cap`
 *  seconds of video. */
export const BURST = Object.freeze({ min: 5, window: 60, perRound: 2, lead: 2.5, tail: 2.5, blastSecs: 1.5, blastShare: 0.6 });

/**
 * A round's kill bursts: `[{ key, kind: 'streak', reel: true, burst: true,
 * player, playerName, total, span, kills: [t...], t0, t1, ... }]`, the most
 * kills first, then the shortest. Each burst's kills are a player's credited
 * kills of one life, all inside BURST.window seconds, and the recording holds
 * him whole from BURST.lead before the first to BURST.tail after the last.
 * `skip` is the pids already given a streak compilation this round. Keyed on
 * its first kill and a victim of -(4000 + pid).
 */
export function burstReelsOf(rec, { slug = '', skip = new Set(), kills = rec.kills, models = new Map() } = {}) {
  const facts = killFactsOf(rec, kills);
  const best = new Map();
  for (const run of streaksOf(rec, { kills })) {
    if (skip.has(run.pid) || run.kills.length < BURST.min) continue;
    const ts = run.kills.map(k => k.t);
    for (let i = 0, j = 0; i < ts.length; i++) {
      while (ts[i] - ts[j] > BURST.window) j++;
      const n = i - j + 1;
      if (n < BURST.min) continue;
      const span = ts[i] - ts[j];
      const have = best.get(run.pid);
      if (!have || n > have.n || (n === have.n && span < have.span)) best.set(run.pid, { n, span, kills: run.kills.slice(j, i + 1) });
    }
  }
  const out = [];
  for (const [pid, b] of [...best].sort((a, z) => z[1].n - a[1].n || a[1].span - z[1].span)) {
    if (out.length >= BURST.perRound) break;
    const t0 = b.kills[0].t - BURST.lead;
    const t1 = b.kills.at(-1).t + BURST.tail;
    if (!continuityOf(lifeOf(rec, pid, b.kills[0].t - BEFORE), t0, Math.min(t1, b.kills.at(-1).t + 0.5)).ok) continue;
    const victim = -(4000 + pid);
    const playerName = nameAt(rec, pid, b.kills[0].t);
    // Most of it one blast (a grenade into a crowd: OopsIDied's 7 in 3 s on
    // Omaha, the chase camera up at the sky as he threw): filmed as the kill
    // shot on its first kill, the camera riding the round and drawing back
    // as it lands (the owner, 2026-11-04).
    let blast = null;
    for (const k of b.kills) {
      const near = b.kills.filter(o => o.t >= k.t && o.t - k.t <= BURST.blastSecs);
      if (near.length >= Math.ceil(b.n * BURST.blastShare) && (!blast || near.length > blast.n)) {
        blast = { t: k.t, victim: k.victim, weapon: k.weapon ?? null, n: near.length };
      }
    }
    out.push({
      blast,
      key: shortKey(slug, b.kills[0].t, victim), kind: 'streak', reel: true, burst: true, player: pid, playerName,
      total: b.n, span: b.span, killTimes: b.kills.map(k => k.t), t0, t1,
      parts: b.kills.map(k => ({ t: k.t, killer: pid, victim: k.victim, victimName: nameAt(rec, k.victim, k.t) })),
      // In a hull the chase camera sits behind it and a hangar hides the kills
      // (KillKillKill's six on Meuse, the owner, 2026-11-04): a burst from a
      // hull, or a take whose kills were not seen, is filmed kill by kill as
      // the bullet chase, from these.
      inHull: Boolean(mountOf(rec, pid, b.kills[0].t - BEFORE, models)?.tmpl),
      shots: b.kills.map((k, i) => {
        const part = filmablePart(rec, facts, k, models);
        return part ? { ...part, streakIndex: i + 1 } : null;
      }).filter(Boolean),
      t: b.kills[0].t, victim, killer: pid, killerName: playerName, victimName: '',
      score: b.n * 10 - b.span / 10, distance: 0, weapon: null, killerVehicle: null, victimVehicle: null,
      level: rec.level, multi: 0,
    });
  }
  return out;
}

/** Battlefield ASMR (the owner, 2026-11-04: "machine gun rattles, I love the
 *  sherman / allied tank firing sounds ... the M1 garand when they ping as
 *  they end the clip"): a round's best-sounding moments of fire, filmed over
 *  the shooter's shoulder at 1x. `perKind` of each kind, `max` in all. */
export const ASMR = Object.freeze({
  max: 6, perKind: 2, gap: 0.7, clip: 8, clipGap: 2.5, mgRounds: 30, mgSecs: 3, cannonGap: 12,
  lead: 1.2, tail: 1.8, longest: 9,
});

/** A shell from a hull's main gun, by the template's words. */
const CANNON = /barrel|cannon|gun_fire|pak|kwk|6pdr|2pdr|75mm|88mm|wz36/i;
/** Allied tanks first (the Sherman's report above all). */
const ALLIED_ARMOUR = /sherman|m4a|m10|m36|cromwell|churchill|crusader|matilda|grant|stuart|cruiser|valentine|t34|is-?2|kv/i;
/** Machine guns and automatic fire. */
const AUTOMATIC = /mg|browning|bren|besa|vickers|breda|bar1918|thompson|mp40|sten|dp|maxim|coaxial|lewis|hotchkiss/i;

/**
 * A round's Battlefield ASMR: `{ key, kind: 'asmr', reel: true, asmr: true,
 * parts: [{ t0, t1, pid, weapon, what, t }], ... }` or null with fewer than 3
 * moments. A moment is one man's fire the recording holds him through: a
 * clip of a weapon that ejects one (`ejects`, the M1 Garand's ping), a long
 * burst of automatic fire, or two or more shots of a tank's gun. Keyed on its
 * first moment and a victim of -5.
 */
export function asmrReelOf(rec, { slug = '', ejects = new Set(['M1Garand']) } = {}) {
  const moments = asmrMomentsOf(rec, { ejects });
  return asmrReelFrom(moments, { slug, level: rec.level });
}

/** A round's ASMR moments, every one: `[{ t, t0, t1, pid, weapon, what,
 *  score, playerName }]`, `what` 'clip', 'automatic' or 'cannon'. */
export function asmrMomentsOf(rec, { ejects = new Set(['M1Garand']) } = {}) {
  const fires = (rec.fires ?? []).filter(f => !f.press && !f.feedOnly && f.pid >= 0 && f.weapon && Number.isFinite(f.t)
    && !isBot(rec, f.pid, f.t));
  const runs = [];
  let cur = null;
  for (const f of [...fires].sort((a, b) => a.pid - b.pid || a.t - b.t)) {
    const clip = ejects.has(f.weapon);
    const gap = clip ? ASMR.clipGap : CANNON.test(f.weapon) && !AUTOMATIC.test(f.weapon) ? ASMR.cannonGap : ASMR.gap;
    if (cur && cur.pid === f.pid && cur.weapon === f.weapon && f.t - cur.t1 < gap) {
      cur.ts.push(f.t);
      cur.t1 = f.t;
    } else {
      cur = { pid: f.pid, weapon: f.weapon, ts: [f.t], t0: f.t, t1: f.t };
      runs.push(cur);
    }
  }
  const moments = [];
  for (const r of runs) {
    let what = null;
    let t0 = r.t0;
    let t1 = r.t1;
    let score = 0;
    if (ejects.has(r.weapon) && r.ts.length >= ASMR.clip) {
      // A whole clip, its last round the ping.
      what = 'clip';
      t0 = r.ts[ASMR.clip - 1 - (ASMR.clip - 1)] ?? r.t0;
      t1 = r.ts[ASMR.clip - 1];
      score = 30;
    } else if (AUTOMATIC.test(r.weapon) && r.ts.length >= ASMR.mgRounds && r.t1 - r.t0 >= ASMR.mgSecs) {
      what = 'automatic';
      t1 = Math.min(r.t1, r.t0 + ASMR.longest - ASMR.lead - ASMR.tail);
      score = 10 + Math.min(20, r.ts.length / 5);
    } else if (CANNON.test(r.weapon) && !AUTOMATIC.test(r.weapon) && r.ts.length >= 2) {
      what = 'cannon';
      t1 = Math.min(r.t1, r.t0 + ASMR.longest - ASMR.lead - ASMR.tail);
      const nid = controlledAt(rec, r.pid, r.t0);
      const tmpl = nid !== null && nid !== undefined ? rootOf(rec, nid, r.t0, r.pid)?.life?.tmpl ?? '' : '';
      score = 15 + r.ts.length * 2 + (ALLIED_ARMOUR.test(`${tmpl} ${r.weapon}`) ? 15 : 0);
    }
    if (!what) continue;
    const a = t0 - ASMR.lead;
    const b = t1 + ASMR.tail;
    if (!continuityOf(lifeOf(rec, r.pid, t0), a, b).ok) continue;
    moments.push({ t: t0, t0: a, t1: b, pid: r.pid, weapon: r.weapon, what, score, playerName: nameAt(rec, r.pid, t0) });
  }
  return moments;
}

/** A round's ASMR reel from its moments (`asmrMomentsOf`), or null. */
function asmrReelFrom(moments, { slug = '', level = '' } = {}) {
  const picked = [];
  const per = new Map();
  for (const m of moments.sort((a, z) => z.score - a.score)) {
    if (picked.length >= ASMR.max) break;
    if ((per.get(m.what) ?? 0) >= ASMR.perKind) continue;
    if (picked.some(p => Math.abs(p.t - m.t) < 10)) continue;
    per.set(m.what, (per.get(m.what) ?? 0) + 1);
    picked.push(m);
  }
  if (picked.length < 3) return null;
  // Round the kinds: a clip, a tank, a gun, and again.
  const order = ['clip', 'cannon', 'automatic'];
  const parts = [];
  for (let i = 0; parts.length < picked.length; i++) {
    for (const w of order) {
      const next = picked.filter(p => p.what === w)[i];
      if (next) parts.push(next);
    }
  }
  const victim = -5;
  return {
    key: shortKey(slug, parts[0].t, victim), kind: 'asmr', reel: true, asmr: true, parts, t: parts[0].t, victim,
    killer: parts[0].pid, killerName: '', victimName: '', score: parts.length * 10, distance: 0, weapon: null,
    killerVehicle: null, victimVehicle: null, level, multi: 0,
  };
}

/** Battlefield ASMR across rounds (the owner, 2026-11-04: "the ASMR can go
 *  across rounds"): a theme's best moments from every round, `max` of them,
 *  at most `perRound` from one, the rounds taken in turn. `rounds` is
 *  `[{ slug, moments }]`. */
export const ASMR_MIX = Object.freeze({ max: 6, perRound: 2, min: 3 });
export function asmrMixOf(rounds, what) {
  const each = rounds.map(r => ({
    slug: r.slug,
    moments: r.moments.filter(m => m.what === what).sort((a, b) => b.score - a.score).slice(0, ASMR_MIX.perRound),
  })).filter(r => r.moments.length);
  const all = each.flatMap(r => r.moments.map(m => ({ ...m, slug: r.slug }))).sort((a, b) => b.score - a.score).slice(0, ASMR_MIX.max);
  if (all.length < ASMR_MIX.min) return null;
  // The rounds in turn, so two of one round never play back to back when
  // another can sit between them.
  const out = [];
  const left = [...all];
  while (left.length) {
    const i = left.findIndex(m => m.slug !== out.at(-1)?.slug);
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return out;
}

/**
 * The recording's own player in its Shorts (the owner, 2026-11-04: "always
 * prioritise the uploader ... there should be something, even if it's just
 * their best highlight / longest shot"): his best candidate among `cands`,
 * else his longest kill the recording holds whole and can film (the bullet
 * chase on its round), as a candidate of kind 'other'; null when he made
 * none. `name` is his in-game name (the recording's `recordedBy`).
 */
export function featuredOf(rec, { name, cands = [], models = new Map(), slug = '', kills = rec.kills } = {}) {
  if (!name) return null;
  const pids = new Set([...(rec.players ?? new Map())].filter(([, p]) => p?.name === name).map(([pid]) => pid));
  if (!pids.size) return null;
  const own = cands.filter(c => pids.has(c.killer) && KINDS.includes(c.kind)).sort((a, b) => b.score - a.score)[0];
  if (own) return { ...own, featured: true };
  const facts = killFactsOf(rec, kills);
  let best = null;
  for (const [k, f] of facts) {
    if (!pids.has(k.killer) || k.killer === k.victim || k.victim === null || k.victim === undefined) continue;
    if (!f?.fresh || !f.round?.f || !(f.distance > 0) || botKill(rec, k)) continue;
    const at = k.t - BEFORE;
    if (teamAt(rec, k.killer, at) === teamAt(rec, k.victim, at)) continue;
    const [w0, w1] = [k.t - WINDOW.before, k.t + WINDOW.after];
    if (!continuityOf(lifeOf(rec, k.killer, at), w0, w1).ok || !continuityOf(lifeOf(rec, k.victim, at), w0, w1).ok) continue;
    if (best && best.f.distance >= f.distance) continue;
    best = { k, f };
  }
  if (!best) return null;
  const { k, f } = best;
  const killer = mountOf(rec, k.killer, k.t - BEFORE, models);
  const victim = mountOf(rec, k.victim, k.t - BEFORE, models);
  return {
    key: shortKey(slug, k.t, k.victim), t: k.t, victim: k.victim, killer: k.killer,
    killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t),
    kind: 'other', featured: true, score: f.distance / 10, distance: Math.round(f.distance), weapon: k.weapon ?? null,
    killerVehicle: killer?.tmpl ?? null, victimVehicle: victim?.tmpl ?? null, level: rec.level, multi: 0,
  };
}
