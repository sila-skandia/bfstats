// One player's round, sliced for his dossier (features/replay-creator-view):
// his kill streaks and what ended each, his longest shots, his multi-kills,
// the vehicles he destroyed, his deaths and his weapons, each row a moment
// the replay can jump to. Pure functions of the parsed recording
// (replay-recording.js), its kill lines, its chapters (replay-chapters.js)
// and its medals (replay-medals.js), so `tests/replay_dossier_harness.mjs`
// runs them under node.
//
// A kill line names the killer and his weapon, not where he shot from. How
// far a kill was is read off the round that made it: a v4 recording or later
// holds every round fired by anyone in range of the recording player (`f`,
// each with its shooter), and the killing one is found by when it left and
// where it pointed. Measured on replay_20260928-133433 (159 kills):
// - a soldier's kill names the weapon his rounds name (`Thompson`, `Sg44`,
//   `K98Sniper`, `Bazooka`); a vehicle's kill names the vehicle (`Mustang`,
//   `PanzerIV`, `BF109`) and its rounds the gun (`MustangGuns`,
//   `MustangBombDummy`, `PanzerIVGunBarrel`), so a round whose weapon starts
//   with the kill's is his weapon's. A tank's coaxial gun (`Coaxial_MG42`)
//   and a stationary gun (`Stationary_mg42` firing `MG42_unlimited`) name
//   something else, and are found among whatever else he fired;
// - direct fire (rifles, sub-machine guns, machine guns, a tank's gun) left
//   0 to 0.4 s before the kill and points within a few degrees of the victim
//   as he stood at the kill: a sniper's 0.1 to 0.4 degrees at 150 to 340 m;
// - a grenade kills 2.7 to 3.5 s after its throw, the fuse, and was thrown
//   6 to 46 degrees off him (an arc). A man who throws two has the second in
//   the air when the first kills: the killing throw is the one nearest the
//   fuse, not the latest (7 of the round's 15 grenade kills with a throw, 30
//   of 77 in the 45-minute replay_20260928-161948);
// - a bomb kills 0.6 to 3 s after its release; a landmine or an explosive
//   pack long after it was laid, with no round to chase.

import { MULTI_GAP, MULTI_WORD, NOT_AIMED } from './replay-medals.js';
import { whereIs } from './replay-battles.js';
import { nameAt, playerAt, teamAt } from './replay-recording.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';

// --- tuning -------------------------------------------------------------------------

/** How far before a kill its round is looked for, seconds: the longest a
 *  bomb falls. A round stamped up to LATE after its kill line is the same
 *  moment's (the recorder stamps both as they arrive). */
const LOOKBACK = 8;
const LATE = 0.15;
/** Direct fire: rounds of the killing weapon at most DIRECT_AGE old, or any
 *  of his at most ANY_AGE old when none of that weapon's is; the one scoring
 *  least on degrees off the victim plus AGE_COST a second of age, and none
 *  pointing more than MAX_ANGLE off him. A tank's shell took 1.9 s to 176 m,
 *  a bazooka's rocket 0.9 s to 46 m. */
const DIRECT_AGE = 3;
const ANY_AGE = 2;
const AGE_COST = 2;
const MAX_ANGLE = 12;
/** With the victim nowhere the recording saw, the latest round of the
 *  killing weapon at most this old, seconds: no angle to check it by. */
const BLIND_AGE = 1;
/** A throw kills within THROW_AGE, and FUSE after it; a bomb within BOMB_AGE
 *  of its release and no sooner than BOMB_FALL. A fighter drops one bomb,
 *  a B17 a stick of them 0.27 s apart, and the latest of a stick had often
 *  just left the rack when one before it killed (0.10 s, 20 m from the man,
 *  at 765.6 s of replay_20260928-161948). A fighter's lowest drop killed
 *  0.49 s after its release in that round, 0.57 s in _20260928-133433. */
const THROW_AGE = 6;
const FUSE = 3;
const BOMB_AGE = 8;
const BOMB_FALL = 0.4;
/** Where on a man the rounds point: this far over his sample's origin,
 *  metres. A soldier's origin is CHARACTER_HEIGHT over his feet, where the
 *  replay stands him (replay-recording.js `standOnFeet`); a hull's is its
 *  own. Aiming here found the killing round of 115 of the 159 kills of
 *  replay_20260928-133433 and 66 of the 77 of _20260927-203459, the direct
 *  ones 1.2 and 1.5 degrees off at the median; 0.3 m over his feet found 111
 *  and 62, 1.8 and 2.2 degrees off. Within 15 m, where the height tells most,
 *  38 of 46 men on foot had a round from the last 0.5 s pointing under
 *  MAX_ANGLE at this point, and 30 at that one. */
const AIM_LIFT = 0.3;
/** The men are placed this long before the kill line: at the line the
 *  victim is dead, and nowhere. */
const BEFORE = 0.05;
/** How long after the recording takes a soldier back into range his place
 *  is not yet his, seconds. A man getting out of a vehicle comes back with
 *  the transform his soldier had when he got in, and only the next sample,
 *  0.10 to 0.22 s on, has him at the door: 42 of the 105 times a soldier came
 *  back into replay_20260928-133433 began 26 to 740 m from the next sample.
 *  RuppoPeaGame, shot 0.07 s after leaving his Kubelwagen at 52.1 s, stood
 *  459 m from the Sg44 that killed him. */
const REJOIN = 0.25;

/** What kind of round a weapon's name says it fires: laid (left to go off
 *  later), thrown, bomb, or direct for anything else. */
const LAID = /mine|exppack|satchel|dynamite|tnt|detonator/i;
const THROWN = /grenade/i;
const BOMB = /bomb/i;
const classOf = weapon => (LAID.test(weapon) ? 'laid' : THROWN.test(weapon) ? 'thrown' : BOMB.test(weapon) ? 'bomb' : 'direct');

/** A kill line with a killer who is not its victim. */
const credited = k => k.killer !== null && k.killer !== undefined && k.killer !== k.victim;
/** A kill the scoreboard counts: the server's kill, not a team kill. */
const isKill = k => k.kind === 'kill' && credited(k);

// --- the rounds ---------------------------------------------------------------------

const fireIndexes = new WeakMap();

/** `pid`'s rounds in time order, each one that left a weapon (not a v3 press
 *  record, nor a v4 file's presses kept only for its feed). Indexed by
 *  player once per recording: a 45-minute round fires 200,000 of them. */
function roundsOf(rec, pid) {
  const fires = rec.fires ?? [];
  let index = fireIndexes.get(fires);
  if (!index || index.count !== fires.length) {
    const byPid = new Map();
    for (const f of fires) {
      if (f.press || f.feedOnly || f.pid === null || f.pid === undefined) continue;
      const list = byPid.get(f.pid);
      if (list) list.push(f);
      else byPid.set(f.pid, [f]);
    }
    // In time order as parsed; a list that is not is put in order here, not
    // searched wrongly by halves.
    for (const list of byPid.values()) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].t < list[i - 1].t) {
          list.sort((a, b) => a.t - b.t);
          break;
        }
      }
    }
    index = { count: fires.length, byPid };
    fireIndexes.set(fires, index);
  }
  return index.byPid.get(pid) ?? [];
}

/** The index of the first of `list` (in time order) at or after `t`. */
function firstFrom(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Where `pid` was at `t` (replay-battles.js `whereIs`), except that a
 *  soldier the recording has only just taken back into range is not placed
 *  yet (REJOIN). */
function placedAt(rec, pid, t, kills) {
  const w = whereIs(rec, pid, t, kills);
  if (!w.fresh || w.state !== 'foot' || !w.life) return w;
  for (const [from, to] of w.life.replicated) {
    if (t >= from && t < to && t - from < REJOIN) return { ...w, pos: null, fresh: false, seen: null };
  }
  return w;
}

/** The point a man's killer aimed at, in the viewer's frame, from where the
 *  recording had him (`placedAt`); null unless it had him live. */
function aimPointOf(w) {
  if (!w?.fresh || !w.pos) return null;
  const origin = w.state === 'foot' ? CHARACTER_HEIGHT : 0;
  return [w.pos[0], w.pos[1] + origin + AIM_LIFT, w.pos[2]];
}

/** How far off `aim` (the viewer's frame) round `f` left, degrees, and how
 *  far it had to go, metres. A round's muzzle and direction are BF1942's
 *  frame: z is negated into the viewer's. Null for a round with no place or
 *  no direction. */
function sight(f, aim) {
  const p = f.pos;
  const d = f.dir;
  if (!aim || !p || !d) return null;
  const vx = aim[0] - p[0];
  const vy = aim[1] - p[1];
  const vz = aim[2] + p[2];
  const dx = d[0];
  const dy = d[1];
  const dz = -d[2];
  const dl = Math.hypot(dx, dy, dz);
  const vl = Math.hypot(vx, vy, vz);
  if (!(dl > 1e-9)) return null;
  if (vl < 1e-6) return { angle: 0, distance: 0 };
  const cos = (dx * vx + dy * vy + dz * vz) / (dl * vl);
  return { angle: (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI, distance: vl };
}

/** The round `kill` was made with, given where its victim was aimed at
 *  (`aim`, null when the recording did not have him): `killingRound`'s. */
function roundFor(rec, kill, aim) {
  if (!credited(kill)) return null;
  const named = kill.weapon ? String(kill.weapon) : '';
  const prefix = named.toLowerCase();
  // The kill's weapon decides when its name says how it kills (a grenade, a
  // mine); a gun's or a vehicle's leaves it to the rounds.
  const by = named && classOf(named) !== 'direct' ? classOf(named) : null;
  if (by === 'laid') return null;
  // His rounds around the kill: the killing weapon's, and the rest.
  const rounds = roundsOf(rec, kill.killer);
  const matching = [];
  const others = [];
  for (let i = firstFrom(rounds, kill.t - LOOKBACK); i < rounds.length && rounds[i].t <= kill.t + LATE; i++) {
    const f = rounds[i];
    if (named && String(f.weapon ?? '').toLowerCase().startsWith(prefix)) matching.push(f);
    else others.push(f);
  }
  const found = (f, kind) => {
    const s = sight(f, aim);
    return { f, angle: s?.angle ?? null, age: kill.t - f.t, distance: s?.distance ?? null, kind };
  };
  // What killed him: the kill's own weapon says, else the last thing of
  // that weapon's he fired (a fighter's guns, or the bomb he let go after
  // them), else direct fire.
  const last = matching[matching.length - 1];
  const kind = by ?? (last ? classOf(String(last.weapon ?? '')) : 'direct');
  if (kind === 'laid') return null;
  if (kind === 'thrown') {
    let best = null;
    for (const f of matching) {
      const age = kill.t - f.t;
      if (age < 0 || age > THROW_AGE) continue;
      if (!best || Math.abs(age - FUSE) < Math.abs(kill.t - best.t - FUSE)) best = f;
    }
    return best ? found(best, 'thrown') : null;
  }
  if (kind === 'bomb') {
    for (let i = matching.length - 1; i >= 0; i--) {
      const age = kill.t - matching[i].t;
      if (age >= BOMB_FALL && age <= BOMB_AGE) return found(matching[i], 'bomb');
    }
    return null;
  }
  // Direct fire, of the killing weapon, else of anything he fired that
  // shoots straight.
  const direct = f => classOf(String(f.weapon ?? '')) === 'direct';
  let pool = matching.filter(f => direct(f) && kill.t - f.t <= DIRECT_AGE);
  if (!aim) {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (kill.t - pool[i].t <= BLIND_AGE) return found(pool[i], 'direct');
    }
    return null;
  }
  if (!pool.length) pool = others.filter(f => direct(f) && kill.t - f.t <= ANY_AGE);
  let best = null;
  for (const f of pool) {
    const s = sight(f, aim);
    if (!s || s.angle > MAX_ANGLE) continue;
    // A round stamped just after the line is the same moment's: no credit
    // for being late.
    const score = s.angle + AGE_COST * Math.max(0, kill.t - f.t);
    if (!best || score < best.score) best = { f, s, score };
  }
  return best ? { f: best.f, angle: best.s.angle, age: kill.t - best.f.t, distance: best.s.distance, kind: 'direct' } : null;
}

/**
 * The recorded round that most plausibly made `kill`: `{ f, angle, age,
 * distance, kind }` with `f` the fire record, `angle` degrees between its
 * direction and the victim, `age` seconds from it to the kill line,
 * `distance` metres from its muzzle to the victim (both null where the
 * recording did not have him live) and `kind` one of direct, thrown or
 * bomb. Null for a kill with nothing to chase: a mine's or a charge's, one
 * whose killer fired nothing the recording saw (he was out of its range), or
 * one no round of his pointed at.
 */
export function killingRound(rec, kill, { kills = rec.kills } = {}) {
  if (!kill || !credited(kill)) return null;
  const victim = kill.victim === null || kill.victim === undefined
    ? null : placedAt(rec, kill.victim, kill.t - BEFORE, kills);
  return roundFor(rec, kill, aimPointOf(victim));
}

/**
 * What the recording says of each kill: `Map<kill, { round, distance, from,
 * fresh }>` for every kill line with a killer who is not its victim. `round`
 * is `killingRound`'s; `distance` its distance, else the distance on the
 * ground between the two men where the recording had both live, else null,
 * in whole metres; `from` what the killer was in just before it ('foot',
 * 'vehicle' or null); `fresh` whether the recording had both men live then.
 */
export function killFactsOf(rec, kills = rec.kills) {
  const out = new Map();
  for (const k of kills) {
    if (!credited(k)) continue;
    const at = k.t - BEFORE;
    const killer = placedAt(rec, k.killer, at, kills);
    const victim = k.victim === null || k.victim === undefined ? null : placedAt(rec, k.victim, at, kills);
    const round = roundFor(rec, k, aimPointOf(victim));
    const fresh = Boolean(killer.fresh && victim?.fresh);
    let distance = round?.distance ?? null;
    if (distance === null && fresh) distance = Math.hypot(killer.pos[0] - victim.pos[0], killer.pos[2] - victim.pos[2]);
    out.set(k, {
      round,
      distance: distance === null ? null : Math.round(distance),
      from: killer.state === 'foot' || killer.state === 'vehicle' ? killer.state : null,
      fresh,
    });
  }
  return out;
}

// --- the dossier ----------------------------------------------------------------------

/** A dossier's longest shots, at most. */
const LONGEST = 12;

/** Whoever `whoOf(k)` names most often over the kill lines `list`, in time
 *  order: `{ pid, name, kills }`, the first to reach the top count on a tie,
 *  null below two. Each is counted as the player who held his id at the
 *  line, not the id: a public server gives a leaver's id to the next man to
 *  join (replay-recording.js `playerAt`). */
function mostNamed(rec, list, whoOf) {
  const tally = new Map();
  let best = null;
  for (const k of list) {
    const pid = whoOf(k);
    if (pid === null || pid === undefined) continue;
    const who = playerAt(rec, pid, k.t) ?? pid;
    let entry = tally.get(who);
    if (!entry) tally.set(who, (entry = { pid, name: nameAt(rec, pid, k.t), kills: 0 }));
    entry.kills += 1;
    if (!best || entry.kills > best.kills) best = entry;
  }
  return best && best.kills >= 2 ? { ...best } : null;
}

/**
 * One player's round, for his dossier: `{ pid, name, team, summary, streaks,
 * longest, multis, vehicles, kills, deaths, weapons, medals }`.
 *
 * - `kills`: his kill lines in time order, each a row `{ t, victim,
 *   victimName, weapon, weaponName, distance, from, round, teamkill }`
 *   (`killFactsOf`'s facts, names as they were at the kill). A team kill is
 *   a row flagged `teamkill` and counts in `summary.teamkills`, nowhere else.
 * - `streaks`: his lives with two kills or more, `{ n, t0, t1, end, kills }`,
 *   most kills first, then earliest. A death of any kind ends a life
 *   (replay-medals.js `streaksOf`); `end` is that death, `{ t, kind, by,
 *   byName, weapon, weaponName }`, or null for a life the round ended.
 * - `longest`: his kills with a distance by an aimed weapon (not a mine,
 *   grenade, knife or charge: replay-medals.js `NOT_AIMED`), shot rather than
 *   dropped or thrown, farthest first, at most LONGEST.
 * - `multis`: his runs of kills each at most MULTI_GAP after the last, two or
 *   more, `{ n, t0, t1, label, kills }`, most first, then earliest. His
 *   death ends a run, as it ends the medal reel's.
 * - `vehicles`: the hulls the server credits him with destroying, not his
 *   own side's (`chapters`, replay-chapters.js), `{ t, tmpl, name, crew }`,
 *   `crew` how many were aboard.
 * - `deaths`: every death of his, suicides and falls too, `{ t, kind,
 *   killer, killerName, weapon, weaponName, distance }`, in time order.
 * - `weapons`: `{ weapon, name, kills, longest }` per weapon he killed with,
 *   most kills first.
 * - `medals`: his medals (replay-medals.js `medalsOf`), each play in its
 *   final form (the triple kill, not the double it grew from), in time order.
 * - `summary`: `{ kills, deaths, teamkills, suicides, ratio, bestStreak,
 *   longest, vehicles, rounds, favourite, nemesis, prey }`: `suicides` his
 *   deaths at nobody's hand but his own (the kill log's "is no more": a fall,
 *   a crash, his own grenade), `ratio` kills a death, `bestStreak` his most
 *   kills in one life (replay-medals.js `bestStreakAt`), `longest` his
 *   longest shot's metres, `rounds` the rounds he fired, `favourite` `{
 *   weapon, name, kills }` his most killing weapon, `nemesis` and `prey` `{
 *   pid, name, kills }` the man who killed him most and the one he killed
 *   most, each null below two.
 *
 * The player is whoever held `pid` at `t` (replay-recording.js `playerAt`),
 * the id's last holder without it, and only his time under the id is his.
 * `kills` are the round's kill lines in time order and `facts` their
 * `killFactsOf`, `medals` and `chapters` the round's; `display` turns a
 * template (a weapon, a vehicle) into the words the game shows.
 */
export function dossierOf(rec, pid, {
  t = null, kills = rec.kills, facts = killFactsOf(rec, kills), medals = [], chapters = [], display = s => s,
} = {}) {
  const player = playerAt(rec, pid, t);
  const his = at => playerAt(rec, pid, at) === player;
  const shown = w => (w ? display(w) : null);
  const named = (who, at) => (who === null || who === undefined ? null : nameAt(rec, who, at));

  // One row per kill line, shared by every list it is in.
  const rows = new Map();
  const rowOf = k => {
    let row = rows.get(k);
    if (!row) {
      const fact = facts.get(k);
      row = {
        t: k.t, victim: k.victim, victimName: named(k.victim, k.t), weapon: k.weapon ?? null, weaponName: shown(k.weapon),
        distance: fact?.distance ?? null, from: fact?.from ?? null, round: fact?.round ?? null, teamkill: k.kind === 'teamkill',
      };
      rows.set(k, row);
    }
    return row;
  };

  // His lives and his runs of kills, the way the medal reel counts them.
  const own = [];
  const killLines = [];
  const deathLines = [];
  const streaks = [];
  const multis = [];
  let life = [];
  let bestStreak = 0;
  let chain = null;
  const endLife = death => {
    if (life.length >= 2) {
      const end = death ? {
        t: death.t, kind: death.kind, by: death.killer ?? null, byName: named(death.killer, death.t),
        weapon: death.weapon ?? null, weaponName: shown(death.weapon),
      } : null;
      streaks.push({ n: life.length, t0: life[0].t, t1: life[life.length - 1].t, end, kills: life });
    }
    life = [];
  };
  const endChain = () => {
    if (chain && chain.kills.length >= 2) {
      const n = chain.kills.length;
      multis.push({ n, t0: chain.t0, t1: chain.t1, label: MULTI_WORD(n), kills: chain.kills });
    }
    chain = null;
  };
  for (const k of kills) {
    if (k.killer !== pid && k.victim !== pid) continue;
    if (!his(k.t)) continue;
    if (k.killer === pid && k.victim !== pid && (k.kind === 'kill' || k.kind === 'teamkill')) {
      const row = rowOf(k);
      own.push(row);
      if (isKill(k)) {
        killLines.push(k);
        life.push(row);
        bestStreak = Math.max(bestStreak, life.length);
        if (chain && k.t - chain.t1 <= MULTI_GAP) {
          chain.kills.push(row);
          chain.t1 = k.t;
        } else {
          endChain();
          chain = { t0: k.t, t1: k.t, kills: [row] };
        }
      }
    }
    if (k.victim === pid) {
      deathLines.push(k);
      endLife(k);
      endChain();
    }
  }
  endLife(null);
  endChain();
  const byCount = (a, b) => b.n - a.n || a.t0 - b.t0;
  streaks.sort(byCount);
  multis.sort(byCount);

  // A shot, not a drop: the fighters' bombs of replay_20260928-133433 killed
  // 37 to 110 m from where they left the rack, none of it a marksman's reach.
  const scored = own.filter(r => !r.teamkill);
  const longest = scored
    .filter(r => r.distance !== null && r.weapon && !NOT_AIMED.test(r.weapon) && (!r.round || r.round.kind === 'direct'))
    .sort((a, b) => b.distance - a.distance || a.t - b.t)
    .slice(0, LONGEST);

  const byWeapon = new Map();
  for (const r of scored) {
    if (!r.weapon) continue;
    let w = byWeapon.get(r.weapon);
    if (!w) byWeapon.set(r.weapon, (w = { weapon: r.weapon, name: r.weaponName, kills: 0, longest: null, first: r.t }));
    w.kills += 1;
    if (r.distance !== null && (w.longest === null || r.distance > w.longest)) w.longest = r.distance;
  }
  const weapons = [...byWeapon.values()]
    .sort((a, b) => b.kills - a.kills || a.first - b.first)
    .map(({ weapon, name, kills: n, longest: far }) => ({ weapon, name, kills: n, longest: far }));

  // Vehicles destroyed, by the medal reel's rule: not his own side's.
  const vehicles = [];
  for (const ch of chapters) {
    if (ch.kind !== 'vehicle' || ch.by !== pid || !his(ch.t)) continue;
    const owner = ch.crew?.length ? teamAt(rec, ch.crew[0], ch.t) : 0;
    if (owner && owner === teamAt(rec, pid, ch.t)) continue;
    vehicles.push({ t: ch.t, tmpl: ch.tmpl, name: shown(ch.tmpl), crew: ch.crew?.length ?? 0 });
  }
  vehicles.sort((a, b) => a.t - b.t);

  const deaths = deathLines.map(k => ({
    t: k.t, kind: k.kind, killer: k.killer ?? null, killerName: named(k.killer, k.t),
    weapon: k.weapon ?? null, weaponName: shown(k.weapon), distance: facts.get(k)?.distance ?? null,
  }));

  // Each play's final form: the last medal of each key.
  const finals = new Map();
  for (const m of medals) if (m.pid === pid && his(m.t)) finals.set(m.key, m);

  let rounds = 0;
  for (const f of roundsOf(rec, pid)) if (his(f.t)) rounds += 1;
  const deathCount = deaths.length;
  return {
    pid,
    name: player?.name ?? `player ${pid}`,
    team: teamAt(rec, pid, t),
    summary: {
      kills: scored.length,
      deaths: deathCount,
      teamkills: own.length - scored.length,
      suicides: deathLines.filter(k => k.killer === null || k.killer === undefined || k.killer === pid).length,
      ratio: Math.round((scored.length / Math.max(1, deathCount)) * 100) / 100,
      bestStreak,
      longest: longest[0]?.distance ?? null,
      vehicles: vehicles.length,
      rounds,
      favourite: weapons[0] ? { weapon: weapons[0].weapon, name: weapons[0].name, kills: weapons[0].kills } : null,
      nemesis: mostNamed(rec, deathLines.filter(k => k.kind === 'kill' && credited(k)), k => k.killer),
      prey: mostNamed(rec, killLines, k => k.victim),
    },
    streaks,
    longest,
    multis,
    vehicles,
    kills: own,
    deaths,
    weapons,
    medals: [...finals.values()].sort((a, b) => a.t - b.t),
  };
}
