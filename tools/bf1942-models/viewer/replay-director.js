// The replay's director (features/round-replay-highlights): the Auto camera,
// which picks whom to follow the way a spectator mode's auto-director does
// (Dota 2's directed camera, CS2's auto-director) -- except that a replay
// knows the future, so it cuts to a man a few seconds before his kill, not
// after it. Pure: it reads the round's model (replay-highlights.js) and
// answers whom to watch; the page's orbit camera does the watching.

import { battlesAt } from './replay-battles.js';
import { streakAt, leaderAt } from './replay-medals.js';

/** How far ahead the director looks, seconds: a kill this soon is worth
 *  cutting to now. */
const LOOKAHEAD = 7;
/** Seconds a pick is kept at least, unless he can no longer be watched, and
 *  at most before anyone better is taken. */
const MIN_DWELL = 6;
const MAX_DWELL = 24;
/** A dead pick's body is watched this long before the director moves on,
 *  to his killer when it can. A player followed by hand gets the same beat
 *  (replay.js `followKiller`). */
export const DEATH_HOLD = 2.8;
/** How often the director thinks, seconds of the recording. */
const THINK = 0.25;
/** Below this, nobody is doing anything worth a cut. */
const LULL = 1;

/** Binary search: the first index whose `t` is at or after `t`. */
function firstAtOrAfter(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const countIn = (list, from, to) => (list ? firstAtOrAfter(list, to) - firstAtOrAfter(list, from) : 0);

/**
 * `model` is the round as replay-highlights.js reads it: `{ rec, kills,
 * activity, battles, streaks, leaders, where(pid, t), placeOf(pos),
 * kindOf(life) }`. `fallback` is whom to watch while nothing is happening:
 * the recording player, whose view the round was recorded from.
 */
export class ReplayDirector {
  constructor(model, { fallback = null } = {}) {
    this.model = model;
    this.fallback = fallback;
    // Per player, sorted times: the kills he makes, his deaths, his fire.
    this.killsBy = new Map();
    this.deathsOf = new Map();
    this.fireOf = new Map();
    const push = (map, pid, t) => {
      if (pid === null || pid === undefined) return;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(t);
    };
    for (const k of model.kills) {
      if (k.kind === 'kill' && k.killer !== k.victim) push(this.killsBy, k.killer, k.t);
      push(this.deathsOf, k.victim, k.t);
    }
    for (const e of model.activity) if (e.kind === 'shot') push(this.fireOf, e.pid, e.t);
    for (const map of [this.killsBy, this.deathsOf, this.fireOf]) for (const list of map.values()) list.sort((a, b) => a - b);
    this.pids = [...new Set([...model.rec.players.keys(), ...(model.rec.playerNids?.keys() ?? [])])];
    this.reset();
  }

  /** Forget the last pick: after a seek, the next thought picks afresh. */
  reset() {
    this.pick = null;
    this.since = -Infinity;
    this.thought = -Infinity;
    this.reason = '';
    this.focus = null;
    this.lastT = null;
  }

  /**
   * How much there is to watch in `pid` at `t`, and why: `{ score, reason,
   * battle, next }`, score -Infinity when he cannot be watched (not alive,
   * not in the recording's range). `next` is the man he kills next inside
   * the look-ahead, for framing the shot.
   */
  interest(pid, t, where = this.model.where(pid, t)) {
    if ((where.state !== 'foot' && where.state !== 'vehicle') || !where.fresh) {
      return { score: -Infinity, reason: '', battle: null, next: null };
    }
    const { model } = this;
    let score = 0;
    const terms = [];
    // What he is about to do and what is about to happen to him: the
    // director's look-ahead. Never a reason shown: that would spoil it.
    const kills = this.killsBy.get(pid);
    let next = null;
    if (kills) {
      for (let i = firstAtOrAfter(kills, t); i < kills.length && kills[i] <= t + LOOKAHEAD; i++) {
        score += 12 * (1 - 0.5 * (kills[i] - t) / LOOKAHEAD);
        if (next === null) next = model.kills.find(k => k.t === kills[i] && k.killer === pid) ?? null;
      }
    }
    if (countIn(this.deathsOf.get(pid), t, t + 5)) score += 6;
    // What he has just done.
    const recent = countIn(kills, t - 4, t);
    if (recent) {
      score += 5 * recent;
      terms.push([5 * recent, recent > 1 ? `${recent} kills just now` : 'just made a kill']);
    }
    const fire = Math.min(8, countIn(this.fireOf.get(pid), t - 3, t + 2));
    if (fire) {
      score += fire;
      terms.push([fire, 'shooting']);
    }
    // The fight he is in.
    let battle = null;
    for (const b of battlesAt(model.battles, t)) {
      const d = Math.hypot(b.s.pos[0] - where.pos[0], b.s.pos[2] - where.pos[2]);
      if (d <= b.s.r + 25) {
        battle = b;
        break;
      }
    }
    if (battle) {
      const heat = Math.min(12, battle.s.heat * 0.35) + (battle.s.teams[1] && battle.s.teams[2] ? 2 : 0);
      score += heat;
      terms.push([heat, `in the fight at ${model.placeOf(battle.s.pos)}`]);
    }
    const streak = streakAt(model.streaks, pid, t);
    if (streak >= 2) {
      score += 2.5 * streak;
      terms.push([2.5 * streak + 1, `on a streak of ${streak}`]);
    }
    if (leaderAt(model.leaders, t)?.pid === pid) {
      score += 3;
      terms.push([3, 'the kill leader']);
    }
    if (where.state === 'vehicle' && model.kindOf?.(where.life) === 'air') {
      score += 1;
      terms.push([1, 'in the air']);
    }
    terms.sort((a, b) => b[0] - a[0]);
    return { score, reason: terms[0]?.[1] ?? '', battle, next };
  }

  /**
   * Whom to watch at `t`, following `current` now: `{ pid, reason, battle,
   * next, cut }`, `cut` true when that is a change. Thinks every THINK
   * seconds of the recording; a jump of the clock (a seek) starts afresh.
   */
  update(t, current) {
    if (this.lastT !== null && Math.abs(t - this.lastT) > 1.5) this.reset();
    this.lastT = t;
    if (this.pick !== null && current !== this.pick) {
      // Somebody else chose (the page followed a player): start from there.
      this.pick = current;
      this.since = t;
    }
    if (t - this.thought < THINK && this.pick !== null) return this.decision(false);
    this.thought = t;

    let best = null;
    const scores = new Map();
    for (const pid of this.pids) {
      const i = this.interest(pid, t);
      scores.set(pid, i);
      if (i.score > -Infinity && (!best || i.score > best.i.score)) best = { pid, i };
    }
    const cur = this.pick !== null ? scores.get(this.pick) : null;
    // A lull: the recording player, if he can be watched.
    const quiet = this.fallback !== null && (!best || best.i.score < LULL)
      && (scores.get(this.fallback)?.score ?? -Infinity) > -Infinity;
    if (quiet) best = { pid: this.fallback, i: scores.get(this.fallback) };
    const choose = (pid, i) => {
      const cut = pid !== this.pick;
      this.pick = pid;
      if (cut) this.since = t;
      this.reason = i?.reason ?? '';
      this.focus = i;
      return this.decision(cut);
    };

    if (cur && cur.score === -Infinity) {
      // He can no longer be watched. Just dead: stay on his body a moment,
      // then go to the man who killed him if he can be watched.
      const deaths = this.deathsOf.get(this.pick);
      const died = deaths ? deaths[firstAtOrAfter(deaths, t + 0.001) - 1] : undefined;
      if (died !== undefined && t - died < DEATH_HOLD) {
        this.reason = 'killed';
        return this.decision(false);
      }
      const k = died !== undefined ? this.model.kills.find(x => x.t === died && x.victim === this.pick) : null;
      const killer = k?.killer;
      if (killer !== null && killer !== undefined && killer !== this.pick) {
        const ki = scores.get(killer);
        if (ki && ki.score > -Infinity) return choose(killer, { ...ki, reason: 'the man who killed him' });
      }
      return best ? choose(best.pid, best.i) : this.decision(false);
    }
    if (!best) return this.decision(false);
    if (this.pick === null || !cur) return choose(best.pid, best.i);
    if (best.pid === this.pick) return choose(best.pid, best.i);
    const dwell = t - this.since;
    if (dwell < MIN_DWELL) return choose(this.pick, cur);
    if (best.i.score > cur.score * 1.35 + 4) return choose(best.pid, best.i);
    if (dwell > MAX_DWELL && best.i.score > cur.score + 1) return choose(best.pid, best.i);
    return choose(this.pick, cur);
  }

  decision(cut) {
    return { pid: this.pick, reason: this.reason, battle: this.focus?.battle ?? null, next: this.focus?.next ?? null, cut };
  }
}
