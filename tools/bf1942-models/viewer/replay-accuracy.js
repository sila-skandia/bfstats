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

import { controlledAt, crewOf, nameAt, playerAt, positionAt, rootOf, teamAt } from './replay-recording.js';

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

/** Who `life` was at `t`: a soldier's player, a hull's first crewman. */
function pidOf(rec, life, t) {
  if (!life) return null;
  if (life.soldier) return Number.isInteger(life.pid) ? life.pid : null;
  return crewOf(rec, life, t)[0]?.pid ?? null;
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
 * `verdicts`, a Map, is given each round's `{ hit, point }`: where a hit met
 * its victim (BF1942's axes), null for a miss (replay-shotlines.js).
 */
export function rebuildTallies(rec, { weapons = null, gunOf = () => null, thrown = new Set(), verdicts = null } = {}) {
  const out = new Map();
  const cell = (pid, name, tmpl) => {
    const key = `${pid}|${name}`;
    if (!out.has(key)) out.set(key, { pid, name, rows: new Map(), shots: [] });
    const entry = out.get(key);
    const k = lower(tmpl);
    if (!entry.rows.has(k)) entry.rows.set(k, { tmpl, fired: 0, hit: 0 });
    return { row: entry.rows.get(k), shots: entry.shots };
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
    const stat = statOf(rec, f);
    const { row: tally, shots } = cell(f.pid, name, stat);
    // A server recording writes one `f` per barrel already, and marks a
    // bot's fake round, which the engine never counts (AI-134).
    if (rec.serverFile && f.fake) continue;
    const barrels = !rec.serverFile && gun && gun.muzzles > 1 && !gun.asynchronyFire ? gun.muzzles : 1;
    tally.fired += barrels;
    // The dashboard's log of his rounds: when, how many, and what came of it.
    const shot = { f, t: f.t, n: barrels, tmpl: stat, hit: false, blast: false, dist: null, victim: null, victimPid: null };
    shots.push(shot);

    const n = Math.hypot(...(f.dir ?? [0, 0, 0]));
    if (!(n > 0.1) || !Array.isArray(f.pos) || !f.pos.every(Number.isFinite)) continue;
    const speed = gun?.velocity > 0 ? gun.velocity : spec?.speed > 0 ? spec.speed : DEFAULT_SPEED;
    const round = { t: f.t, pos: f.pos, unit: f.dir.map(x => x / n), speed };
    const isThrown = thrown.has(w);
    const radius = spec?.radius > 0 ? spec.radius : isThrown ? THROW_RADIUS : 0;
    const side = teamAt(rec, f.pid, f.t);
    let hit = false;
    let point = null;
    let struck = null;
    let at = f.t;
    shot.blast = Boolean(radius);
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
        if (droppedIn(v, f.t + from, f.t + ttl + AFTER)) {
          hit = true;
          struck = v;
          at = met.t;
          const dt = met.t - f.t;
          point = [round.pos[0] + round.unit[0] * speed * dt, round.pos[1] + round.unit[1] * speed * dt - 0.5 * gravity * dt * dt,
            round.pos[2] + round.unit[2] * speed * dt];
          break;
        }
      }
    } else {
      const lag = (f.local ? LOCAL_LAG : REMOTE_LAG) + NEXT_DROP;
      for (const v of victimsBetween(f.t - LEAD, f.t + MAX_FLIGHT + lag)) {
        if (v.nid === f.nid) continue;
        const soldier = Boolean(v.soldier);
        const met = meeting(round, v, soldier ? SOLDIER_FROM : 0, soldier ? SOLDIER_TO : 0);
        if (!met || met.miss > (soldier ? SOLDIER_MISS : HULL_MISS) || met.arrival - f.t > MAX_FLIGHT) continue;
        if (!sideOf(rec, v, met.arrival)) continue;
        if (nextIsDrop(v, met.arrival - LEAD, lag)) {
          hit = true;
          struck = v;
          at = met.arrival;
          const along = speed * (met.arrival - f.t);
          point = round.pos.map((p, k) => p + round.unit[k] * along);
          break;
        }
      }
    }
    if (hit) {
      tally.hit++;
      shot.hit = true;
      shot.dist = point ? Math.hypot(point[0] - f.pos[0], point[1] - f.pos[1], point[2] - f.pos[2]) : null;
      shot.victim = struck;
      shot.victimPid = pidOf(rec, struck, at);
    }
    verdicts?.set(f, { hit, point });
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
  const recorded = recordedHits(rec, weapons);
  for (const [key, p] of rebuilt) {
    if (named.has(key)) continue;
    let fired = 0;
    for (const r of p.rows.values()) fired += r.fired;
    if (!fired) continue;
    const own = recorded.get(key);
    if (own) {
      // The server's own count of his damaging rounds (`hg`), or his own
      // hit marks (`hm`) for his bullets: the rebuilt hits give way.
      for (const r of p.rows.values()) {
        if (own.whole || !own.blast.has(r.tmpl.toLowerCase())) r.hit = 0;
      }
      for (const [k, h] of own.hits) {
        if (!p.rows.has(k)) p.rows.set(k, { tmpl: h.tmpl, fired: 0, hit: 0 });
        p.rows.get(k).hit += h.n;
      }
    }
    players.push({ pid: p.pid, name: p.name, t: null, source: own ? own.source : 'rebuilt', rows: p.rows });
  }
  return players.map(p => {
    const at = p.t ?? end;
    const rows = [...p.rows.values()].map(r => ({ ...r, kind: weaponKind(r.tmpl, weapons) }))
      .sort((a, b) => b.fired - a.fired || a.tmpl.localeCompare(b.tmpl));
    const key = `${p.pid}|${p.name}`;
    const shots = rebuilt.get(key)?.shots ?? [];
    // When each hit landed: the recording's own (the server's `hg`, his hit
    // marks and his rebuilt blasts) where it has them, else the rebuild's.
    const own = recorded.get(key);
    const hitLog = own
      ? [...own.times, ...(own.whole ? [] : shots.filter(s => s.hit && own.blast.has(lower(s.tmpl))).map(s => ({ t: s.t, tmpl: s.tmpl })))]
      : shots.filter(s => s.hit).map(s => ({ t: s.t, tmpl: s.tmpl }));
    hitLog.sort((a, b) => a.t - b.t);
    return {
      key, pid: p.pid, name: p.name, team: teamAt(rec, p.pid, at) || 0, ai: Boolean(playerAt(rec, p.pid, at)?.ai),
      source: p.source, rows,
      fired: rows.reduce((n, r) => n + r.fired, 0), hit: rows.reduce((n, r) => n + r.hit, 0),
      shots, hitLog: hitLog.map(h => ({ t: h.t, kind: weaponKind(h.tmpl, weapons) })),
      kinds: new Map(rows.map(r => [lower(r.tmpl), r.kind])),
    };
  });
}

/**
 * The hits the recording itself holds, `Map<pid|name, { source, whole, blast,
 * hits: Map<lower tmpl, { tmpl, n }> }>`:
 * - a server recording's `hg`, one line per damaging round the server
 *   credited (IMP-11), every player, blasts included (`whole`);
 * - a client recording's `hm`, its own player's crosshair hit marks as the
 *   server raised them (XHIT-6), each given to the weapon he last fired. A
 *   blast never raises a mark (XHIT-4), so his blast weapons keep their
 *   rebuilt hits (`blast`, their lower-case templates).
 */
export function recordedHits(rec, weapons = null) {
  const out = new Map();
  const entry = (pid, t, source, whole) => {
    const key = `${pid}|${nameAt(rec, pid, t)}`;
    if (!out.has(key)) out.set(key, { source, whole, blast: new Set(), hits: new Map(), times: [] });
    return out.get(key);
  };
  const count = (e, tmpl, t) => {
    const k = String(tmpl).toLowerCase();
    if (!e.hits.has(k)) e.hits.set(k, { tmpl: String(tmpl), n: 0 });
    e.hits.get(k).n++;
    e.times.push({ t, tmpl: String(tmpl) });
  };
  for (const h of rec.hitsGiven ?? []) {
    count(entry(h.pid, h.t, 'server', true), h.tmpl || `template ${h.tid}`, h.t);
  }
  for (const [pid, marks] of rec.hitMarks ?? []) {
    const fires = (rec.fires ?? []).filter(f => f.pid === pid && !f.press);
    const blast = new Set();
    for (const f of fires) {
      const w = String(f.weapon ?? '').toLowerCase();
      if (weapons?.get(w)?.radius > 0) blast.add(String(statOf(rec, f)).toLowerCase());
    }
    for (const at of marks) {
      // His last round before the mark that was not a blast's.
      let shot = null;
      for (const f of fires) {
        if (f.t > at + 0.05) break;
        if (weapons?.get(String(f.weapon ?? '').toLowerCase())?.radius > 0) continue;
        shot = f;
      }
      if (!shot) continue;
      const e = entry(pid, at, 'marks', false);
      e.blast = blast;
      count(e, statOf(rec, shot), at);
    }
  }
  return out;
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

// --- the round as it went: running totals ------------------------------------

const tracks = new WeakMap();

/** `entry`'s rounds and hits as running counts for `kind`: `{ ft, fc, ht,
 *  hc }`, times and the counts up to each. */
function trackOf(entry, kind) {
  let all = tracks.get(entry);
  if (!all) tracks.set(entry, all = new Map());
  if (all.has(kind)) return all.get(kind);
  const fires = [];
  for (const s of entry.shots ?? []) {
    if (kind !== 'all' && entry.kinds?.get(lower(s.tmpl)) !== kind) continue;
    fires.push(s);
  }
  const hits = (entry.hitLog ?? []).filter(h => kind === 'all' || h.kind === kind);
  const ft = new Float64Array(fires.length);
  const fc = new Float64Array(fires.length);
  let n = 0;
  fires.forEach((s, i) => { ft[i] = s.t; fc[i] = n += s.n; });
  const ht = new Float64Array(hits.length);
  const hc = new Float64Array(hits.length);
  hits.forEach((h, i) => { ht[i] = h.t; hc[i] = i + 1; });
  const track = { ft, fc, ht, hc, fired: n, hit: hits.length };
  all.set(kind, track);
  return track;
}

/** The count at `t` of a running track. */
function countAt(times, counts, t) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo ? counts[lo - 1] : 0;
}

/**
 * `entry`'s rounds fired, hits and accuracy for `kind` by recording time
 * `t`: `{ fired, hit, accuracy, estimated }`, or null where the recording
 * saw none of his rounds. Where the whole round's numbers come from the
 * server's tally and the recording saw only some of it, the counts the
 * recording saw are scaled to land on the server's at the end, so the curve
 * keeps the recording's shape and finishes on the true accuracy
 * (`estimated`). With no hit seen, hits follow his firing.
 */
export function totalsAt(entry, kind, t) {
  const final = totalsOf(entry, kind);
  const track = trackOf(entry, kind);
  if (!track.fired) return null;
  const sf = final.fired / track.fired;
  const rawF = countAt(track.ft, track.fc, t);
  const fired = rawF * sf;
  let hit;
  let sh = 1;
  if (track.hit) {
    sh = final.hit / track.hit;
    hit = countAt(track.ht, track.hc, t) * sh;
  } else {
    sh = 0;
    hit = final.hit * (rawF / track.fired);
  }
  const estimated = Math.abs(sf - 1) > 1e-9 || Math.abs(sh - 1) > 1e-9;
  return { fired, hit, accuracy: fired > 0 ? hit / fired : null, estimated };
}

/** `entry`'s running accuracy for `kind` at `steps` points across the
 *  recording: `[{ t, fired, hit, accuracy }]`. */
export function accuracySeries(entry, kind, duration, steps = 240) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (duration * i) / steps;
    const at = totalsAt(entry, kind, t);
    if (at) out.push({ t, ...at });
  }
  return out;
}

/** `entry`'s rounds fired and hits in buckets of `width` seconds:
 *  `[{ t, fired, hit }]`, as the recording saw them. */
export function fireBuckets(entry, kind, duration, width) {
  const n = Math.max(1, Math.ceil(duration / width));
  const out = Array.from({ length: n }, (_, i) => ({ t: i * width, fired: 0, hit: 0 }));
  const track = trackOf(entry, kind);
  let prev = 0;
  for (let i = 0; i < track.ft.length; i++) {
    const b = Math.min(n - 1, Math.max(0, Math.floor(track.ft[i] / width)));
    out[b].fired += track.fc[i] - prev;
    prev = track.fc[i];
  }
  for (const t of track.ht) out[Math.min(n - 1, Math.max(0, Math.floor(t / width)))].hit++;
  return out;
}

// --- one player's round in detail --------------------------------------------

/** Metres a round may pass from a soldier, or a hull's origin, and still be
 *  one fired at him. */
const NEAR_SOLDIER = 3;
const NEAR_HULL = 8;
/** Seconds between two rounds of one burst. */
const BURST_GAP = 0.4;
const RANGES = [[0, 25], [25, 50], [50, 100], [100, 200], [200, Infinity]];

/** What a struck life was: a soldier, armour (land, sea, a fixed gun) or an
 *  aircraft. */
function targetKind(life, weapons) {
  if (!life) return null;
  if (life.soldier) return 'soldier';
  return weaponKind(life.tmpl, weapons) === 'air' ? 'air' : 'armour';
}

/**
 * The dashboard's detail for one board entry: kills, bursts, ranges, what he
 * hit and whom, and the rounds others fired at him. `board` is the whole
 * board (every player's rebuilt rounds); `weapons` as `rebuildTallies`.
 * Everything here is as the recording saw it, so a distant player's share is
 * a sample.
 */
export function playerDetail(rec, entry, board, { weapons = null } = {}) {
  const { pid, name } = entry;
  const his = t => nameAt(rec, pid, t) === name;
  const shots = entry.shots ?? [];

  const kills = (rec.kills ?? []).filter(k => k.killer === pid && k.kind === 'kill' && his(k.t));
  const deaths = (rec.kills ?? []).filter(k => k.victim === pid && his(k.t));

  // Bursts: rounds less than BURST_GAP apart.
  let bursts = 0;
  let longest = 0;
  let run = 0;
  let last = -Infinity;
  let streak = 0;
  let bestStreak = 0;
  for (const s of shots) {
    if (s.t - last > BURST_GAP) {
      bursts++;
      run = 0;
    }
    run += s.n;
    longest = Math.max(longest, run);
    last = s.t;
    streak = s.hit ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }

  // His hits: how far, on what, on whom.
  const ranges = RANGES.map(([from, to]) => ({ from, to, n: 0 }));
  const targets = { soldier: 0, armour: 0, air: 0 };
  const victims = new Map();
  let far = null;
  const hitDists = [];
  let distSum = 0;
  let distN = 0;
  for (const s of shots) {
    if (!s.hit) continue;
    const k = targetKind(s.victim, weapons);
    if (k) targets[k]++;
    if (Number.isFinite(s.dist) && !s.blast) {
      ranges.find(r => s.dist >= r.from && s.dist < r.to).n++;
      distSum += s.dist;
      distN++;
      if (!far || s.dist > far.dist) far = { dist: s.dist, t: s.t, tmpl: s.tmpl };
      hitDists.push({ dist: s.dist, t: s.t, tmpl: s.tmpl });
    }
    if (Number.isInteger(s.victimPid)) {
      const who = nameAt(rec, s.victimPid, s.t);
      const v = victims.get(who) ?? { name: who, team: teamAt(rec, s.victimPid, s.t), hits: 0 };
      v.hits++;
      victims.set(who, v);
    }
  }

  // Under fire: every enemy round that passed near him, and those that hit.
  const incoming = [];
  const shooters = new Map();
  const shooter = (spid, t) => {
    const who = nameAt(rec, spid, t);
    if (!shooters.has(who)) shooters.set(who, { name: who, team: teamAt(rec, spid, t), rounds: 0, hits: 0 });
    return shooters.get(who);
  };
  let closest = null;
  const struck = new Set();
  let hitsTaken = 0;
  for (const other of board) {
    for (const s of other.shots ?? []) {
      if (!s.hit || s.victimPid !== pid || !his(s.t)) continue;
      struck.add(s);
      hitsTaken += 1;
      shooter(other.pid, s.t).hits++;
    }
  }
  const byShot = new Map();
  for (const other of board) for (const s of other.shots ?? []) byShot.set(s.f, s);
  for (const f of rec.fires ?? []) {
    if (f.press || !(f.pid >= 0) || f.pid === pid) continue;
    if (rec.serverFile && f.fake) continue;
    const n = Math.hypot(...(f.dir ?? [0, 0, 0]));
    if (!(n > 0.1) || !Array.isArray(f.pos) || !f.pos.every(Number.isFinite)) continue;
    const t = f.t;
    if (!his(t)) continue;
    const mine = teamAt(rec, pid, t);
    const side = teamAt(rec, f.pid, t);
    if (!mine || !side || mine === side) continue;
    const s = byShot.get(f);
    if (s && struck.has(s)) {
      incoming.push({ t, n: s.n, hit: true });
      shooter(f.pid, t).rounds += s.n;
      continue;
    }
    const nid = controlledAt(rec, pid, t);
    if (nid === null || nid === undefined) continue;
    const life = rootOf(rec, nid, t, pid)?.life;
    if (!life || !positionAt(life, t, _p)) continue;
    const spec = weapons?.get(lower(f.weapon)) ?? null;
    const round = { t, pos: f.pos, unit: f.dir.map(x => x / n), speed: spec?.speed > 0 ? spec.speed : DEFAULT_SPEED };
    let miss;
    if (spec?.radius > 0) {
      const met = arcMeeting(round, GRAVITY, 0.02, MAX_FLIGHT, life);
      miss = met ? met.miss - spec.radius : null;
    } else {
      const soldier = Boolean(life.soldier);
      miss = meeting(round, life, soldier ? SOLDIER_FROM : 0, soldier ? SOLDIER_TO : 0)?.miss ?? null;
    }
    if (miss === null || miss > (life.soldier ? NEAR_SOLDIER : NEAR_HULL)) continue;
    const rounds = s?.n ?? 1;
    incoming.push({ t, n: rounds, hit: false });
    shooter(f.pid, t).rounds += rounds;
    if (!closest || miss < closest.miss) closest = { miss: Math.max(0, miss), t, by: nameAt(rec, f.pid, t) };
  }
  incoming.sort((a, b) => a.t - b.t);

  return {
    kills: kills.map(k => k.t), deaths: deaths.map(k => k.t),
    bursts, longestBurst: longest, avgBurst: bursts ? entry.fired / bursts : 0, bestStreak,
    ranges, targets, farthest: far, hitDists, meanDist: distN ? distSum / distN : null,
    victims: [...victims.values()].sort((a, b) => b.hits - a.hits),
    incoming, hitsTaken, closest,
    shooters: [...shooters.values()].filter(s => s.rounds || s.hits).sort((a, b) => b.rounds - a.rounds || b.hits - a.hits),
  };
}

/** How many of `list` (`{ t, n? }` in time order) came by `t`. */
export function countBy(list, t) {
  let n = 0;
  for (const x of list) {
    if (x.t > t) break;
    n += x.n ?? 1;
  }
  return n;
}
