// The round's plays worth a cheer (features/round-replay-highlights): kill
// streaks (kills in one life), multi-kills (kills in quick succession), the
// round's first blood, a streak ended, a kill paid back, a long shot, a knife
// kill, a vehicle destroyed and the kill leader; and from them the round's
// top plays, the highlight reel. BF1942 names none of these: the words are
// the arcade shooter's own, the way modern replays and spectator modes call
// out a play. Pure functions of the recording, its kill lines and chapters
// (replay-chapters.js), so `tests/replay_highlights_harness.mjs` runs them.

import { whereIs } from './replay-battles.js';

/** Kills this close together are one multi-kill, seconds. BF1942's pace is
 *  slower than the arcade shooters that set the word's 4.5 s. */
export const MULTI_GAP = 6;
/** Kills in one life that make a streak, and what each is called. */
export const STREAK_TIERS = Object.freeze([
  [3, 'Killing spree'], [5, 'Rampage'], [7, 'Dominating'], [10, 'Unstoppable'], [15, 'Legendary'],
]);
/** A kill from this far on foot is a long shot, metres: with a gun, not a
 *  mine or a charge left behind, nor an explosion nobody named. */
export const LONG_SHOT = 100;
const NOT_AIMED = /mine|grenade|exppack|satchel|dynamite|detonator|tnt|mortar|artillery|knife/i;
/** A streak this long ended is a shutdown. */
const SHUTDOWN = 3;
/** The kill leader holds at least this many kills. */
const LEADER_MIN = 3;
/** A play scoring less than this is not a highlight. */
const MIN_PLAY = 2.5;

const MULTI_WORD = n => (n >= 5 ? 'Multi kill' : ['', '', 'Double kill', 'Triple kill', 'Quad kill'][n]);
const MULTI_SCORE = n => (n >= 5 ? 12 : [0, 0, 3, 6, 9][n]);
const STREAK_SCORE = { 3: 4, 5: 7, 7: 9, 10: 12, 15: 15 };

const isKill = k => k.kind === 'kill' && k.killer !== null && k.killer !== undefined && k.killer !== k.victim;

// --- streaks and the leader ------------------------------------------------------------

/**
 * Each player's kill streak through the round: `Map<pid, [{ t, n }]>`, a step
 * function -- his kills in the current life, back to 0 when he dies. A team
 * kill counts for nothing and a death of any kind ends the life.
 */
export function streaksOf(kills) {
  const out = new Map();
  const now = new Map();
  const push = (pid, t, n) => {
    if (!out.has(pid)) out.set(pid, [{ t: -Infinity, n: 0 }]);
    out.get(pid).push({ t, n });
    now.set(pid, n);
  };
  for (const k of kills) {
    if (isKill(k)) push(k.killer, k.t, (now.get(k.killer) ?? 0) + 1);
    if (k.victim !== null && k.victim !== undefined && (now.get(k.victim) ?? 0) !== 0) push(k.victim, k.t, 0);
  }
  return out;
}

function stepAt(list, t) {
  if (!list?.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo].t <= t ? list[lo] : null;
}

/** `pid`'s streak at `t`: his kills in the life he is living. */
export const streakAt = (streaks, pid, t) => stepAt(streaks.get(pid), t)?.n ?? 0;

/** The longest streak `pid` has had by `t`. */
export function bestStreakAt(streaks, pid, t) {
  let best = 0;
  for (const s of streaks.get(pid) ?? []) {
    if (s.t > t) break;
    best = Math.max(best, s.n);
  }
  return best;
}

/** Who led the round on kills, as it changed: `[{ t, pid, kills }]`. The
 *  first to reach a count keeps the lead on a tie; nobody leads below
 *  three kills. */
export function leadersOf(kills) {
  const count = new Map();
  const out = [];
  let leader = null;
  for (const k of kills) {
    if (!isKill(k)) continue;
    const n = (count.get(k.killer) ?? 0) + 1;
    count.set(k.killer, n);
    if (n < LEADER_MIN) continue;
    const held = leader === null ? 0 : count.get(leader) ?? 0;
    if (k.killer === leader) out.push({ t: k.t, pid: leader, kills: n });
    else if (n > held) {
      leader = k.killer;
      out.push({ t: k.t, pid: leader, kills: n, taken: true });
    }
  }
  return out;
}

/** The kill leader at `t`, `{ pid, kills }`, or null. */
export function leaderAt(leaders, t) {
  const s = stepAt(leaders, t);
  return s ? { pid: s.pid, kills: s.kills } : null;
}

// --- the medals ------------------------------------------------------------------------

/**
 * Every medal of the round, in time order: `{ t, pid, kind, label, score,
 * key, t0, t1, ... }`. `kind` is one of multi (`count`, `span`), streak
 * (`count`), firstblood, shutdown (`ended`, the streak), revenge, longshot
 * (`distance`), knife, vehicle (`tmpl`, `crew`) and leader (`count`); a kill's
 * medals carry its `victim` and `weapon`. `key` names the play a medal
 * belongs to, so a triple kill replaces the double it grew from; `t0`..`t1`
 * is the stretch worth watching. `describeMedal` puts one in words.
 *
 * `opts.chapters` are the round's chapters (replay-chapters.js, for the
 * vehicles destroyed); `opts.roundStarted` is when the round began inside
 * the recording, or null for one that joined mid-round (no first blood then).
 */
export function medalsOf(rec, kills, { chapters = [], roundStarted = rec.roundStarted ?? null } = {}) {
  const out = [];
  const add = m => out.push({ t1: m.t + 2.5, ...m });
  const life = new Map();          // pid -> kills this life
  const lastKiller = new Map();    // pid -> who killed him last
  const chain = new Map();         // pid -> { t0, t, n }
  let firstBlood = roundStarted !== null && roundStarted !== undefined;

  for (const k of kills) {
    const victimStreak = k.victim !== null && k.victim !== undefined ? life.get(k.victim) ?? 0 : 0;
    if (isKill(k)) {
      const pid = k.killer;
      const n = (life.get(pid) ?? 0) + 1;
      life.set(pid, n);
      const base = { t: k.t, pid, victim: k.victim, weapon: k.weapon ?? null };

      // Several kills in quick succession, one play that grows.
      let c = chain.get(pid);
      if (c && k.t - c.t <= MULTI_GAP) {
        c.n++;
        c.t = k.t;
      } else {
        c = { t0: k.t, t: k.t, n: 1 };
        chain.set(pid, c);
      }
      if (c.n >= 2) {
        add({ ...base, kind: 'multi', count: c.n, span: c.t - c.t0, label: MULTI_WORD(c.n),
              score: MULTI_SCORE(c.n), key: `multi:${pid}:${c.t0}`, t0: c.t0 - 4 });
      }
      // A streak reaching a tier.
      const tier = STREAK_TIERS.find(([at]) => at === n);
      if (tier) {
        add({ ...base, kind: 'streak', count: n, label: tier[1], score: STREAK_SCORE[n] ?? 10,
              key: `streak:${pid}:${n}:${k.t}`, t0: k.t - 6 });
      }
      if (firstBlood && k.t >= roundStarted) {
        firstBlood = false;
        add({ ...base, kind: 'firstblood', label: 'First blood', score: 2.5, key: `first:${k.t}`, t0: k.t - 5 });
      }
      if (victimStreak >= SHUTDOWN) {
        add({ ...base, kind: 'shutdown', ended: victimStreak, label: 'Shutdown', score: 3 + victimStreak,
              key: `shut:${pid}:${k.t}`, t0: k.t - 5 });
      }
      if (lastKiller.get(pid) === k.victim) {
        add({ ...base, kind: 'revenge', label: 'Revenge', score: 1.5, key: `rev:${pid}:${k.t}`, t0: k.t - 5 });
      }
      if (/knife/i.test(k.weapon ?? '')) {
        add({ ...base, kind: 'knife', label: 'Cold steel', score: 3.5, key: `knife:${pid}:${k.t}`, t0: k.t - 5 });
      }
      // A long shot: on foot, both men where the recording saw them.
      const from = whereIs(rec, pid, k.t - 0.05, kills);
      const to = whereIs(rec, k.victim, k.t - 0.05, kills);
      if (from.fresh && to.fresh && from.state === 'foot' && k.weapon && !NOT_AIMED.test(k.weapon)) {
        const d = Math.hypot(from.pos[0] - to.pos[0], from.pos[2] - to.pos[2]);
        if (d >= LONG_SHOT) {
          add({ ...base, kind: 'longshot', distance: Math.round(d), label: 'Long shot',
                score: 3 + Math.min(4, (d - LONG_SHOT) / 50), key: `long:${pid}:${k.t}`, t0: k.t - 5 });
        }
      }
    }
    if (k.victim !== null && k.victim !== undefined) {
      life.set(k.victim, 0);
      chain.delete(k.victim);
      if (k.killer !== null && k.killer !== undefined && k.killer !== k.victim) lastKiller.set(k.victim, k.killer);
    }
  }

  // Vehicles destroyed, by whoever the server credits, not his own side's.
  for (const ch of chapters) {
    if (ch.kind !== 'vehicle' || ch.by === null || ch.by === undefined) continue;
    const team = rec.players.get(ch.by)?.team ?? 0;
    const owner = ch.crew?.length ? rec.players.get(ch.crew[0])?.team ?? 0 : 0;
    if (owner && owner === team) continue;
    const aboard = ch.crew?.length ?? 0;
    add({ t: ch.t, pid: ch.by, kind: 'vehicle', tmpl: ch.tmpl, crew: aboard, label: 'Destroyed',
          score: 3 + 1.5 * aboard, key: `veh:${ch.t}:${ch.tmpl}`, t0: ch.t - 5 });
  }

  // The kill leader, each time the lead changes hands.
  for (const l of leadersOf(kills)) {
    if (!l.taken) continue;
    add({ t: l.t, pid: l.pid, kind: 'leader', count: l.kills, label: 'Kill leader', score: 2,
          key: `lead:${l.t}`, t0: l.t - 5 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A medal's line under its name: whom, with what, how far. `display` turns
 *  a template into the words the game shows (the message log's lexicon). */
export function describeMedal(m, rec, display = s => s) {
  const name = pid => rec.players.get(pid)?.name ?? `player ${pid}`;
  const weapon = m.weapon ? display(m.weapon) : null;
  switch (m.kind) {
    case 'multi': return `${m.count} kills in ${m.span.toFixed(1)} s${weapon ? ` [${weapon}]` : ''}`;
    case 'streak': return `${m.count} kills without dying`;
    case 'firstblood': return `${name(m.victim)}${weapon ? ` [${weapon}]` : ''}`;
    case 'shutdown': return `ended ${name(m.victim)}'s streak of ${m.ended}`;
    case 'revenge': return `paid back ${name(m.victim)}`;
    case 'knife': return `knifed ${name(m.victim)}`;
    case 'longshot': return `${m.distance} m${weapon ? ` [${weapon}]` : ''}`;
    case 'vehicle': return `${display(m.tmpl)}${m.crew ? `, ${m.crew} aboard` : ''}`;
    case 'leader': return `${m.count} kills`;
    default: return '';
  }
}

// --- the highlight reel ------------------------------------------------------------------

/**
 * The round's top plays: `[{ t0, t1, t, pid, kind, title, score, medals }]`
 * in time order, at most `max`. A player's medals that overlap are one play
 * (a triple kill that is also a killing spree), scored by its best medal
 * (`best`) and a share of the rest. The round's hottest contested battles
 * join in (`battle`, at `pos`), each watched through whoever fought hardest
 * in it; `battles` and `activity` are replay-battles.js's.
 */
export function topPlays(medals, { battles = [], activity = [], max = 8 } = {}) {
  // Only a play's final form: the triple kill, not the double it grew from.
  const last = new Map();
  for (const m of medals) last.set(m.key, m);
  const plays = [];
  for (const m of last.values()) {
    const play = plays.find(p => p.pid === m.pid && m.t0 <= p.t1 && m.t1 >= p.t0);
    if (play) {
      play.medals.push(m);
      play.t0 = Math.min(play.t0, m.t0);
      play.t1 = Math.max(play.t1, m.t1);
      continue;
    }
    plays.push({ pid: m.pid, t0: m.t0, t1: m.t1, medals: [m] });
  }
  for (const p of plays) {
    p.medals.sort((a, b) => b.score - a.score);
    const [best, ...rest] = p.medals;
    p.score = best.score + 0.4 * rest.reduce((s, m) => s + m.score, 0);
    p.t = best.t;
    p.title = best.label;
    p.best = best;
    p.kind = best.kind;
  }
  // The battles: the hottest contested ones, at their peak, unless a play
  // already shows that moment.
  const fights = battles.filter(b => b.contested).sort((a, b) => b.peak - a.peak).slice(0, 2);
  const medalPlays = [...plays];
  for (const b of fights) {
    const t0 = b.peakT - 8;
    const t1 = b.peakT + 4;
    if (medalPlays.some(p => Math.min(t1, p.t1) - Math.max(t0, p.t0) > (t1 - t0) / 2)) continue;
    const peak = b.samples.find(s => s.t === b.peakT) ?? b.samples[0];
    // Whoever did most in it around the peak.
    const tally = new Map();
    for (const e of activity) {
      if (e.pid === null || e.pid === undefined || Math.abs(e.t - b.peakT) > 8) continue;
      if (Math.hypot(e.pos[0] - peak.pos[0], e.pos[2] - peak.pos[2]) > peak.r + 40) continue;
      tally.set(e.pid, (tally.get(e.pid) ?? 0) + e.w);
    }
    const star = [...tally.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? null;
    if (star === null) continue;
    plays.push({
      pid: star, t0, t1, t: b.peakT, kind: 'battle', title: 'Battle',
      pos: peak.pos, score: b.peak / 5 + b.kills * 1.5, medals: [], battle: b,
    });
  }
  return plays.filter(p => p.score >= MIN_PLAY).sort((a, b) => b.score - a.score).slice(0, max)
    .map(p => ({ ...p, t0: Math.max(0, p.t0) }))
    .sort((a, b) => a.t0 - b.t0);
}
