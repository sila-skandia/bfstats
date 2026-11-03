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

import { controlledAt, nameAt, rootOf, teamAt } from './replay-recording.js';
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

export const KINDS = Object.freeze(['air-to-air', 'ground-to-air', 'tank-to-tank', 'long-shot']);
const BASE = { 'air-to-air': 100, 'ground-to-air': 90, 'tank-to-tank': 70, 'long-shot': 50 };
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
    const multi = kills.filter(o => o !== k && o.killer === k.killer && Math.abs(o.t - k.t) <= MULTI_GAP).length;
    const score = BASE[kind] + f.distance / (kind === 'long-shot' ? 6 : 10) + (multi ? MULTI_BONUS : 0);
    out.push({
      key: shortKey(slug, k.t, k.victim), t: k.t, victim: k.victim, killer: k.killer,
      killerName: nameAt(rec, k.killer, k.t), victimName: nameAt(rec, k.victim, k.t),
      kind, score: Math.round(score * 10) / 10, distance: f.distance, weapon,
      killerVehicle: killer.tmpl ?? null, victimVehicle: victim.tmpl ?? null, level: rec.level, multi,
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
  for (const kind of KINDS) {
    if (picked.length >= max) break;
    const best = fresh.find(c => c.kind === kind && clear(c));
    if (best) picked.push(best);
  }
  for (const c of fresh) {
    if (picked.length >= max) break;
    if (!picked.includes(c) && clear(c)) picked.push(c);
  }
  return picked.sort((a, b) => b.score - a.score);
}
