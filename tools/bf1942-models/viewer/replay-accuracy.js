// Each player's rounds fired and rounds that hit, by weapon, for the replay's
// Accuracy board (features/replay-accuracy).
//
// The server counts both for every player (ledger IMP-11:
// `BFPlayer::addBulletsFired` once per barrel, `addBulletsGivingDamage` once
// per damaging round and once per explosion that hurt an enemy) and sends the
// whole round's tally at its end (`roundStats`, events 0x30..0x32). A player
// the tally names is shown with the server's numbers. Anyone it does not name
// (he left before the end, or the file stops before it) is rebuilt from what
// the recording saw:
//
// - fired: his rounds (`f`), times the gun's barrels when it fires them all
//   at once (a BF109's two guns are two rounds a pull);
// - a bullet hit: a round of his that passed through a victim whose next
//   change of hit points is a drop just after it got there;
// - a blast hit (a shell, a grenade, a charge): one per round, when an enemy
//   within its blast radius of its arc lost hit points while it flew.
//
// Measured against the server's own tally on eleven public vanilla rounds the
// recorder saw whole: infantry 90% of rounds fired and 92% of hits, ground
// vehicles 92% and 71%, aircraft 79% and 42%. A client is told only of what
// is near it, so a distant player's rounds and a hit inside one 10 Hz sample
// go uncounted; a bot's "fake" rounds (AI-134) are counted, where the server
// does not.
//
// The stat template is the engine's: the vehicle when he is in one, the hand
// weapon on foot (XHIT-4). Imports only replay-recording.js, so
// `tests/replay_accuracy_harness.mjs` runs it under node.

import { nameAt, playerAt, positionAt, rootOf, teamAt, crewOf } from './replay-recording.js';

const SOLDIER_MISS = 1;
const HULL_MISS = 4;
const SOLDIER_FROM = -0.9;
const SOLDIER_TO = 0.7;
const LEAD = 0.05;
const AFTER = 0.6;
const MAX_FLIGHT = 4;
const MAX_RANGE = 1500;
const SPREAD = 0.1;
const DEFAULT_SPEED = 700;
/** A grenade's flight is followed this long at most, seconds (its fuse). */
const THROW_FLIGHT = 4;
/** Seconds after a throw before its round is in the air. */
const THROW_FROM = 0.3;
/** Metres a thrown round's burst reaches when its table gives no radius. */
const THROW_RADIUS = 8;
/** Seconds the victim's next hit points may come after a bullet arrives:
 *  the server's tick and the 10 Hz samples, past the trip back. */
const NEXT_DROP = 0.3;
const LOCAL_LAG = 0.24;
const REMOTE_LAG = 0.06;
const GRAVITY = 14.73;

const lower = s => String(s ?? '').toLowerCase();
const _p = [0, 0, 0];

/** Which board a stat template sits under: `infantry` for a hand weapon,
 *  else `air`, `vehicle` (land, sea, a fixed gun), or `other`. */
export function weaponKind(tmpl, weapons) {
  const k = lower(tmpl);
  if (!weapons) return 'other';
  const own = weapons.get(k);
  if (own?.category === 'handweapon') return 'infantry';
  let kind = null;
  for (const w of weapons.values()) {
    if (lower(w.owner) !== k) continue;
    if (w.category === 'air') return 'air';
    if (w.category === 'land' || w.category === 'sea' || w.category === 'emplacement') kind = 'vehicle';
  }
  return kind ?? (own ? 'vehicle' : 'other');
}

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

/** Where a straight round met `life`: `{ miss, arrival }`, or null. */
function meeting(round, life, from, to) {
  if (!positionAt(life, round.t, _p)) return null;
  const first = passing(round.pos, round.unit, _p, from, to);
  if (!first || first.along > MAX_RANGE) return null;
  const arrival = round.t + first.along / round.speed;
  let best = null;
  for (const dt of [-SPREAD, 0, SPREAD]) {
    if (!positionAt(life, arrival + dt, _p)) continue;
    const at = passing(round.pos, round.unit, _p, from, to);
    if (at && (!best || at.miss < best.miss)) best = at;
  }
  return best && { miss: best.miss, arrival: round.t + best.along / round.speed };
}

/** The closest a falling round's arc came to `life` between `from` and `to`
 *  seconds of its flight: `{ miss, t }`, or null. */
function arcMeeting(round, gravity, from, to, life) {
  let best = null;
  for (let dt = from; dt <= to; dt += 0.05) {
    if (!positionAt(life, round.t + dt, _p)) continue;
    const x = round.pos[0] + round.unit[0] * round.speed * dt;
    const y = round.pos[1] + round.unit[1] * round.speed * dt - 0.5 * gravity * dt * dt;
    const z = round.pos[2] + round.unit[2] * round.speed * dt;
    const miss = Math.hypot(_p[0] - x, _p[1] + 0.9 - y, _p[2] - z);
    if (!best || miss < best.miss) best = { miss, t: round.t + dt };
  }
  return best;
}

/** Is `life`'s first change of hit points at or after `t` a drop, within
 *  `within` seconds? */
function nextIsDrop(life, t, within) {
  const hp = life.hp;
  let lo = 0;
  let hi = hp.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hp[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const h = hp[lo];
  return Boolean(h && lo > 0 && h.t <= t + within && h.hp < hp[lo - 1].hp && hp[lo - 1].hp > 0);
}

/** Did `life`'s hit points drop between `a` and `b`? */
function droppedIn(life, a, b) {
  for (let i = 1; i < life.hp.length; i++) {
    const h = life.hp[i];
    if (h.t < a) continue;
    if (h.t > b) return false;
    if (h.hp < life.hp[i - 1].hp && life.hp[i - 1].hp > 0) return true;
  }
  return false;
}

/** The side `life` was on at `t`: a soldier's player's, a hull's crew's, 0
 *  for an empty hull (which the game never counts a hit on, XHIT-5). */
function sideOf(rec, life, t) {
  if (life.soldier) return Number.isInteger(life.pid) ? teamAt(rec, life.pid, t) : null;
  const crew = crewOf(rec, life, t);
  return crew.length ? teamAt(rec, crew[0].pid, t) : 0;
}

/** The engine's stat template for round `f`: the vehicle he is in, else the
 *  hand weapon. */
function statOf(rec, f) {
  const life = rootOf(rec, f.nid, f.t, f.pid)?.life;
  return life && !life.soldier && life.tmpl ? life.tmpl : f.weapon;
}

/**
 * Rebuild every player's tallies from the recording's rounds and hit points.
 * `weapons` is `Map<lower name, { speed, radius, category, owner }>` (the
 * models tree's `damage.json`), `gunOf(lower name)` a FireArms' `{ muzzles,
 * asynchronyFire, velocity, timeToLive, gravityModifier }` where a loaded
 * model has it, `thrown` the lower-case weapons whose round is thrown or
 * laid. Returns `Map<key, { pid, name, rows: Map<lower tmpl, { tmpl, fired,
 * hit }> }>`, keyed by `pid|name` (a pid is reused when its player leaves).
 */
export function rebuildTallies(rec, { weapons = null, gunOf = () => null, thrown = new Set() } = {}) {
  const out = new Map();
  const cell = (pid, name, tmpl) => {
    const key = `${pid}|${name}`;
    if (!out.has(key)) out.set(key, { pid, name, rows: new Map() });
    const rows = out.get(key).rows;
    const k = lower(tmpl);
    if (!rows.has(k)) rows.set(k, { tmpl, fired: 0, hit: 0 });
    return rows.get(k);
  };

  // Every drop of hit points, in time order: a round can only have hit a
  // victim that lost some soon after it was fired.
  const drops = [];
  for (const life of rec.lives ?? []) {
    if (!(life.hp?.length > 1) || life.projectile || life.camera) continue;
    for (let i = 1; i < life.hp.length; i++) {
      if (life.hp[i].hp < life.hp[i - 1].hp && life.hp[i - 1].hp > 0) drops.push({ t: life.hp[i].t, life });
    }
  }
  drops.sort((a, b) => a.t - b.t);
  const victimsBetween = (a, b) => {
    let lo = 0;
    let hi = drops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (drops[mid].t < a) lo = mid + 1;
      else hi = mid;
    }
    const found = new Set();
    for (let i = lo; i < drops.length && drops[i].t <= b; i++) found.add(drops[i].life);
    return found;
  };

  for (const f of rec.fires ?? []) {
    if (f.press || !(f.pid >= 0)) continue;
    const w = lower(f.weapon);
    const gun = gunOf(w) ?? null;
    const spec = weapons?.get(w) ?? null;
    const name = nameAt(rec, f.pid, f.t);
    const tally = cell(f.pid, name, statOf(rec, f));
    const barrels = gun && gun.muzzles > 1 && !gun.asynchronyFire ? gun.muzzles : 1;
    tally.fired += barrels;

    const n = Math.hypot(...(f.dir ?? [0, 0, 0]));
    if (!(n > 0.1) || !Array.isArray(f.pos) || !f.pos.every(Number.isFinite)) continue;
    const speed = gun?.velocity > 0 ? gun.velocity : spec?.speed > 0 ? spec.speed : DEFAULT_SPEED;
    const round = { t: f.t, pos: f.pos, unit: f.dir.map(x => x / n), speed };
    const isThrown = thrown.has(w);
    const radius = spec?.radius > 0 ? spec.radius : isThrown ? THROW_RADIUS : 0;
    const side = teamAt(rec, f.pid, f.t);
    let hit = false;
    if (radius) {
      // A blast: one hit when an enemy within its radius of the arc lost hit
      // points while it flew.
      const ttl = Math.min(gun?.timeToLive > 0 ? gun.timeToLive : MAX_FLIGHT, isThrown ? THROW_FLIGHT : MAX_FLIGHT);
      const from = isThrown ? THROW_FROM : 0.02;
      const gravity = GRAVITY * (Number.isFinite(gun?.gravityModifier) ? gun.gravityModifier : 1);
      for (const v of victimsBetween(f.t + from, f.t + ttl + AFTER)) {
        if (v.nid === f.nid) continue;
        const met = arcMeeting(round, gravity, from, ttl, v);
        if (!met || met.miss > radius) continue;
        const team = sideOf(rec, v, met.t);
        if (!team || team === side) continue;
        if (droppedIn(v, f.t + from, f.t + ttl + AFTER)) { hit = true; break; }
      }
    } else {
      const lag = (f.local ? LOCAL_LAG : REMOTE_LAG) + NEXT_DROP;
      for (const v of victimsBetween(f.t - LEAD, f.t + MAX_FLIGHT + lag)) {
        if (v.nid === f.nid) continue;
        const soldier = Boolean(v.soldier);
        const met = meeting(round, v, soldier ? SOLDIER_FROM : 0, soldier ? SOLDIER_TO : 0);
        if (!met || met.miss > (soldier ? SOLDIER_MISS : HULL_MISS) || met.arrival - f.t > MAX_FLIGHT) continue;
        if (!sideOf(rec, v, met.arrival)) continue;
        if (nextIsDrop(v, met.arrival - LEAD, lag)) { hit = true; break; }
      }
    }
    if (hit) tally.hit++;
  }
  return out;
}

/**
 * The Accuracy board: one entry a player, `{ pid, name, team, ai, source,
 * fired, hit, rows: [{ tmpl, kind, fired, hit }] }`, `source` 'server' where
 * the round-end tally names him and 'rebuilt' where it does not. Options as
 * `rebuildTallies`; `rebuilt` passes tallies already worked out.
 */
export function accuracyBoard(rec, options = {}) {
  const { weapons = null } = options;
  const end = Number.isFinite(rec.duration) ? rec.duration : null;
  const players = [];
  const named = new Set();
  for (const [pid, entry] of rec.roundStats ?? []) {
    const rows = new Map();
    for (const stat of ['fired', 'hit']) {
      for (const r of entry[stat] ?? []) {
        const tmpl = r.tmpl || `template ${r.tid}`;
        const k = lower(tmpl);
        if (!rows.has(k)) rows.set(k, { tmpl, fired: 0, hit: 0 });
        rows.get(k)[stat] += r.n;
      }
    }
    if (!rows.size) continue;
    const name = nameAt(rec, pid, entry.t);
    named.add(`${pid}|${name}`);
    players.push({ pid, name, t: entry.t, source: 'server', rows });
  }
  const rebuilt = options.rebuilt ?? rebuildTallies(rec, options);
  for (const [key, p] of rebuilt) {
    if (named.has(key)) continue;
    let fired = 0;
    for (const r of p.rows.values()) fired += r.fired;
    if (!fired) continue;
    players.push({ pid: p.pid, name: p.name, t: null, source: 'rebuilt', rows: p.rows });
  }
  return players.map(p => {
    const at = p.t ?? end;
    const rows = [...p.rows.values()].map(r => ({ ...r, kind: weaponKind(r.tmpl, weapons) }))
      .sort((a, b) => b.fired - a.fired || a.tmpl.localeCompare(b.tmpl));
    return {
      pid: p.pid, name: p.name, team: teamAt(rec, p.pid, at) || 0, ai: Boolean(playerAt(rec, p.pid, at)?.ai),
      source: p.source, rows,
      fired: rows.reduce((n, r) => n + r.fired, 0), hit: rows.reduce((n, r) => n + r.hit, 0),
    };
  });
}

/** One board entry's totals over the rows of `kind` ('all' for every row). */
export function totalsOf(entry, kind = 'all') {
  let fired = 0;
  let hit = 0;
  for (const r of entry.rows) {
    if (kind !== 'all' && r.kind !== kind) continue;
    fired += r.fired;
    hit += r.hit;
  }
  return { fired, hit, accuracy: fired > 0 ? hit / fired : null };
}
