// Match recaps (features/match-recap): which moments of a round make its
// recap, and which chat lines make its "salt" at the end.
//
// Pure, so the recap tool runs it under node on a parsed recording and the
// tests drive it the same way. A moment is a run of kills by one man worth
// showing (a streak, a multi-kill, a tank downing a plane, a long shot, a
// bomb, a revenge), kept only when the recording player saw every man in it
// up close: replicated, no hop, its samples dense (no stutter) and within
// RECAP.reach of the recorder. The owner, 2026-11-15: "it all needs to be well
// within the recording player's FOV to get nice play back". Measured on Kursk
// and Liberation of Caen (MoonGamers, 2026-11-14): the gap between a man's
// samples is 0.104 s out to 250 m from the recorder and doubles past 300.

import { nameAt, playerAt, positionAt, teamAt } from './replay-recording.js';
import { whereIs } from './replay-battles.js';
import { continuityOf, hullKind, isBot, shortCandidates, streaksOf } from './replay-shorts-pick.js';
import { recorderName } from './replay-chapters.js';

/** The tuning. `reach` m from the recorder for every filmed man; `gap` s the
 *  longest gap between his samples (0.104 is the full rate, 0.2 a stutter);
 *  `before`/`after` s round each kill that are checked; `spacing` s between
 *  two moments; `budget` s of moments (a beat is about `beat` s); `min`
 *  moments for a recap at all; `duels` split screens at most. */
export const RECAP = Object.freeze({
  reach: 200, gap: 0.16, step: 0.25, before: 3.6, after: 2.5,
  spacing: 6, perPlayer: 3, budget: 96, beat: 6.4, min: 4, max: 12,
  multiGap: 5, duels: 2, streakMin: 5, streakParts: 3, streakWindow: 30, revenge: 45,
});

/** A moment's weight before the recorder's bonus. */
const WEIGHT = {
  'tank-to-air': 95, 'air-to-air': 70, 'ground-to-air': 68, 'tank-to-tank': 52, 'tank-buster': 58, 'long-shot': 40,
  bomb: 50, duel: 56, multi: 34, streak: 44, revenge: 38, kill: 14,
};
/** What a moment's caption calls it. */
const LABEL = {
  'tank-to-air': 'Tank downs a plane', 'air-to-air': 'Air to air', 'ground-to-air': 'Ground to air',
  'tank-to-tank': 'Tank duel', 'tank-buster': 'Tank buster', 'long-shot': 'Long shot', bomb: 'Bombs away',
  revenge: 'Revenge', kill: 'Kill',
};
const MULTI_WORD = ['', '', 'Double kill', 'Triple kill', 'Quad kill'];
/** The recording player's own moments weigh this much more ("always
 *  prioritise the uploader", features/replay-shorts). */
const RECORDER_BONUS = 14;

/** The recording player's pid: the session the recorder marked local, else
 *  the man who pressed its triggers, else by the name the chat gives him. */
export function recorderPidOf(rec) {
  for (const list of rec.sessions?.values() ?? []) {
    const own = list.find(s => s.local);
    if (own) return own.pid;
  }
  for (const p of rec.players?.values() ?? []) if (p.local) return p.pid;
  const shot = (rec.fires ?? []).find(f => (f.local || f.press) && f.pid !== null && f.pid !== undefined);
  if (shot) return shot.pid;
  const name = recorderName(rec);
  for (const p of rec.players?.values() ?? []) if (name && p.name === name) return p.pid;
  return null;
}

/** The gap between `life`'s samples round `t` that shows as a stutter: the
 *  interval its key times hold `t` in, when he moved more than `still` m
 *  across it; 0 for a gap he stood still through (the recorder writes no key
 *  for a man who has not moved, and nothing jumps on screen) or a time
 *  outside his keys. */
export function sampleGapAt(life, t, { still = 0.6 } = {}) {
  const keys = life?.keys;
  const n = keys?.length ?? 0;
  if (n < 2) return 0;
  let lo = 0, hi = n - 1;
  if (t < keys.time(0) || t > keys.time(n - 1)) return 0;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (keys.time(m) <= t) lo = m; else hi = m;
  }
  const a = positionAt(life, keys.time(lo), [0, 0, 0]);
  const b = positionAt(life, keys.time(hi), [0, 0, 0]);
  if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= still) return 0;
  return keys.time(hi) - keys.time(lo);
}

/**
 * Where the recording player was at each moment, for the reach test: a
 * function of `t` giving his view-space position (whereIs's frame), his last
 * one alive within `hold` s while he lies dead or waits to spawn, else null
 * (no test then: the density test still holds).
 */
export function recorderTrack(rec, pid, { kills = rec.kills, hold = 12, step = 0.5 } = {}) {
  if (pid === null || pid === undefined) return () => null;
  const cache = new Map();
  const at = t => {
    const k = Math.round(t / step);
    if (cache.has(k)) return cache.get(k);
    let out = null;
    for (let back = 0; back <= hold; back += step) {
      const w = whereIs(rec, pid, k * step - back, kills);
      if ((w.state === 'foot' || w.state === 'vehicle') && w.pos && w.fresh) { out = w.pos; break; }
    }
    cache.set(k, out);
    return out;
  };
  return at;
}

/**
 * Whether the recording holds `pid` well over [t0, t1]: at every `step` s
 * replicated (`fresh`), each life he is in hop-free (`continuityOf`), his
 * samples no further apart than `gap`, and within `reach` m of the recorder.
 * `{ ok, why }`. A man who dies inside the window is checked up to his death.
 */
export function wellSeen(rec, pid, t0, t1, { kills = rec.kills, track = () => null, reach = RECAP.reach, gap = RECAP.gap, step = RECAP.step } = {}) {
  if (pid === null || pid === undefined) return { ok: true, why: null };
  const spans = new Map();
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    const w = whereIs(rec, pid, t, kills);
    if (w.state === 'dead') break;
    if (!w.life || !w.fresh || !w.pos) return { ok: false, why: `out of view at ${t.toFixed(1)}` };
    const g = sampleGapAt(w.life, t);
    if (g > gap) return { ok: false, why: `stutters (${g.toFixed(2)} s) at ${t.toFixed(1)}` };
    const me = track(t);
    if (me && pid !== track.pid) {
      const d = Math.hypot(w.pos[0] - me[0], w.pos[2] - me[2]);
      if (d > reach) return { ok: false, why: `${Math.round(d)} m from the recorder at ${t.toFixed(1)}` };
    }
    const sp = spans.get(w.life);
    if (sp) sp[1] = t; else spans.set(w.life, [t, t]);
  }
  if (!spans.size) return { ok: false, why: 'never seen' };
  for (const [life, [a, b]] of spans) {
    const c = continuityOf(life, a, b);
    if (!c.ok) return c;
  }
  return { ok: true, why: null };
}

/** A credited kill of one man by another, neither a bot nor the same side. */
const credited = (rec, k) => k.kind === 'kill' && k.killer !== null && k.killer !== undefined && k.victim !== null && k.victim !== undefined
  && k.killer !== k.victim && !isBot(rec, k.killer, k.t) && !isBot(rec, k.victim, k.t)
  && teamAt(rec, k.killer, k.t - 0.3) !== teamAt(rec, k.victim, k.t - 0.3);

/** A kill as a moment carries it. */
const partOf = (rec, k, extra = {}) => ({
  t: k.t, killer: k.killer, victim: k.victim, victimName: nameAt(rec, k.victim, k.t) ?? '', weapon: k.weapon ?? null, ...extra,
});

/**
 * Every moment of `rec` a recap could show, best first: `{ kind, label, pid,
 * name, t0, t1, kills: [{ t, killer, victim, victimName, weapon, index?,
 * of? }], score, recorder, est }`, `est` the seconds of video it takes.
 * Unchecked: `recapMomentsOf` keeps the ones the recorder saw well.
 */
export function momentCandidates(rec, { models = new Map(), kills = rec.kills, recorder = recorderPidOf(rec) } = {}) {
  const out = [];
  const good = kills.filter(k => credited(rec, k)).sort((a, b) => a.t - b.t);
  const nameOf = (pid, t) => nameAt(rec, pid, t) ?? playerAt(rec, pid, t)?.name ?? '';
  const push = (m) => {
    const ks = m.kills;
    m.t0 = ks[0].t - RECAP.before;
    m.t1 = ks.at(-1).t + RECAP.after;
    m.name = nameOf(m.pid, ks[0].t);
    m.recorder = m.pid === recorder;
    if (m.recorder) m.score += RECORDER_BONUS;
    m.score = Math.round(m.score * 10) / 10;
    let est = RECAP.beat;
    for (let i = 1; i < ks.length; i++) est += Math.min(RECAP.beat, Math.max(1.5, ks[i].t - ks[i - 1].t));
    m.est = Math.round(est * 10) / 10;
    out.push(m);
  };
  // Streaks: a life of RECAP.streakMin kills or more, shown by its best
  // window of up to streakParts kills (the closest together, the later on a
  // tie, so the count on screen is high).
  for (const run of streaksOf(rec, { kills: good })) {
    const n = run.kills.length;
    if (n < RECAP.streakMin) continue;
    let best = null;
    for (let i = 0; i < n; i++) {
      const part = [];
      for (let j = i; j < n && part.length < RECAP.streakParts && run.kills[j].t - run.kills[i].t <= RECAP.streakWindow; j++) part.push(j);
      const span = run.kills[part.at(-1)].t - run.kills[i].t;
      const s = part.length * 10 - span * 0.2 + i * 0.01;
      if (!best || s > best.s) best = { s, part };
    }
    push({ kind: 'streak', label: `${n} kill streak`, pid: run.pid, score: WEIGHT.streak + 4 * Math.min(12, n),
      kills: best.part.map(j => partOf(rec, run.kills[j], { index: j + 1, of: n })), streak: n });
  }
  // Two kills or more by one man within multiGap s of each other.
  for (let i = 0; i < good.length; i++) {
    const k = good[i];
    if (good.some((o, j) => j < i && o.killer === k.killer && k.t - o.t <= RECAP.multiGap)) continue;
    const run = [k];
    for (let j = i + 1; j < good.length; j++) {
      const o = good[j];
      if (o.killer !== k.killer) continue;
      if (o.t - run.at(-1).t > RECAP.multiGap) break;
      run.push(o);
    }
    // One shell that kills two in a hull is one moment, not a double kill.
    const distinct = run.filter((o, j) => j === 0 || o.t - run[j - 1].t > 0.3);
    if (distinct.length < 2) continue;
    push({ kind: 'multi', label: MULTI_WORD[Math.min(4, run.length)] || `${run.length} kills`, pid: k.killer,
      score: WEIGHT.multi + 18 * (Math.min(5, run.length) - 1), kills: distinct.map(o => partOf(rec, o)), count: run.length });
  }
  // The Shorts picker's kinds: what the two men were in.
  const byKill = new Map(good.map(k => [`${k.t.toFixed(2)}:${k.victim}`, k]));
  for (const c of shortCandidates(rec, { models, kills })) {
    const k = byKill.get(`${c.t.toFixed(2)}:${c.victim}`);
    if (!k || !WEIGHT[c.kind]) continue;
    const label = c.kind === 'long-shot' ? `Long shot, ${Math.round(c.distance)} m` : LABEL[c.kind];
    push({ kind: c.kind, label, pid: c.killer, score: WEIGHT[c.kind] + (c.distance ?? 0) / 12, kills: [partOf(rec, k, { distance: c.distance })] });
  }
  // A 1 v 1 (the owner, 2026-11-15: "a 1 v1 could split the screen looking
  // from each player"): the man killed was firing back at his killer in the
  // seconds before, both on foot or both in armour. Filmed split, each half
  // over one man's shoulder at the other.
  for (const k of good) {
    const d = duelOf(rec, k, { kills, models });
    if (!d) continue;
    push({ kind: 'duel', label: '1 v 1', pid: k.killer, score: WEIGHT.duel + Math.min(12, d.exchanged * 2), kills: [partOf(rec, k, { distance: d.distance })],
      split: true, rival: k.victim, rivalName: nameOf(k.victim, k.t), exchanged: d.exchanged, distance: d.distance });
  }
  // A bomb that kills: watched falling.
  for (const k of good) {
    if (!/bomb/i.test(String(k.weapon ?? ''))) continue;
    push({ kind: 'bomb', label: LABEL.bomb, pid: k.killer, score: WEIGHT.bomb, kills: [partOf(rec, k)] });
  }
  // Revenge: the man killed comes back and kills his killer.
  for (const k of good) {
    const back = good.find(o => o.killer === k.victim && o.victim === k.killer && o.t > k.t + 3 && o.t - k.t <= RECAP.revenge);
    if (!back) continue;
    push({ kind: 'revenge', label: LABEL.revenge, pid: back.killer, score: WEIGHT.revenge, kills: [partOf(rec, back)], avenges: k.t });
  }
  // The recorder's own kills, so he is in his own recap whatever he did.
  for (const k of good) {
    if (k.killer !== recorder) continue;
    push({ kind: 'kill', label: LABEL.kill, pid: k.killer, score: WEIGHT.kill, kills: [partOf(rec, k)] });
  }
  return out.sort((a, b) => b.score - a.score || a.t0 - b.t0);
}

/** What makes a 1 v 1: the man killed fired at his killer at least
 *  `returned` times in the `window` s before, each round within `aim`
 *  degrees of him, from `near`-`far` m; neither in a plane. */
export const DUEL = Object.freeze({ window: 5, returned: 2, aim: 7, near: 6, far: 150 });

/** The game's frame to the view's (whereIs's): z negated. */
const view = p => [p[0], p[1], -p[2]];

/**
 * Whether kill `k` was a 1 v 1: `{ distance, exchanged }` (his rounds and the
 * victim's aimed at each other in the window), else null.
 */
export function duelOf(rec, k, { kills = rec.kills, models = new Map() } = {}) {
  const t = k.t - 0.2;
  const a = whereIs(rec, k.killer, t, kills);
  const b = whereIs(rec, k.victim, t, kills);
  if (!a.pos || !b.pos || !a.fresh || !b.fresh || a.state !== b.state) return null;
  const distance = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  if (distance < DUEL.near || distance > DUEL.far) return null;
  const aimedAt = (f, target) => {
    if (!f.pos || !f.dir) return false;
    const o = view(f.pos);
    const dir = view(f.dir);
    const w = whereIs(rec, target, f.t, kills);
    if (!w.pos) return false;
    const v = [w.pos[0] - o[0], w.pos[1] + 1 - o[1], w.pos[2] - o[2]];
    const nv = Math.hypot(...v), nd = Math.hypot(...dir);
    if (!nv || !nd) return false;
    const cos = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / (nv * nd);
    return cos >= Math.cos((DUEL.aim * Math.PI) / 180);
  };
  let back = 0, at = 0;
  let last = -Infinity;
  for (const f of rec.fires ?? []) {
    if (f.t < k.t - DUEL.window) continue;
    if (f.t > k.t) break;
    if (f.pid === k.victim && f.t - last > 0.08 && aimedAt(f, k.killer)) { back++; last = f.t; }
    else if (f.pid === k.killer && aimedAt(f, k.victim)) at++;
  }
  if (back < DUEL.returned || !at) return null;
  // Neither in a plane: a dogfight is the volley, not a split.
  for (const w of [a, b]) {
    if (w.state !== 'vehicle') continue;
    const g = String(w.life?.tmpl ?? '');
    if (hullKind(g, models) === 'air' || /plane|aircraft|bf109|spitfire|mustang|stuka|ju87|sbd|corsair/i.test(g)) return null;
  }
  return { distance: Math.round(distance), exchanged: back + Math.min(at, 6) };
}

/**
 * The recap's moments, in round order: the best candidates the recorder saw
 * well (every killer and victim `wellSeen` round each kill), none within
 * RECAP.spacing s of another, at most perPlayer of one man, until `budget` s
 * of video. The recorder has one of his own when he has any to show.
 * `{ moments, dropped: [{ kind, name, t, why }] }`.
 */
export function recapMomentsOf(rec, { models = new Map(), kills = rec.kills, budget = RECAP.budget, max = RECAP.max } = {}) {
  const recorder = recorderPidOf(rec);
  const track = recorderTrack(rec, recorder, { kills });
  track.pid = recorder;
  const cands = momentCandidates(rec, { models, kills, recorder });
  const checked = new Map();
  const seenWell = (pid, t0, t1) => {
    const key = `${pid}:${t0.toFixed(2)}:${t1.toFixed(2)}`;
    if (!checked.has(key)) checked.set(key, wellSeen(rec, pid, t0, t1, { kills, track }));
    return checked.get(key);
  };
  const dropped = [];
  const ok = m => {
    for (const k of m.kills) {
      const a = seenWell(k.killer, k.t - RECAP.before, k.t + RECAP.after);
      if (!a.ok) return `${m.name}: ${a.why}`;
      const b = seenWell(k.victim, k.t - RECAP.before + 1.5, k.t - 0.05);
      if (!b.ok) return `${k.victimName}: ${b.why}`;
    }
    return null;
  };
  const chosen = [];
  let video = 0;
  const per = new Map();
  const clash = m => chosen.some(c => m.t0 < c.t1 + RECAP.spacing && c.t0 < m.t1 + RECAP.spacing);
  const take = m => { chosen.push(m); video += m.est; per.set(m.pid, (per.get(m.pid) ?? 0) + 1); };
  for (const m of cands) {
    if (chosen.length >= max || video >= budget) break;
    if (video + m.est > budget + RECAP.beat) continue;
    if ((per.get(m.pid) ?? 0) >= RECAP.perPlayer || clash(m)) continue;
    // A split screen is for a couple of moments, not the whole recap.
    if (m.split && chosen.filter(c => c.split).length >= RECAP.duels) continue;
    const why = ok(m);
    if (why) { dropped.push({ kind: m.kind, name: m.name, t: Math.round(m.kills[0].t * 10) / 10, why }); continue; }
    take(m);
  }
  // His own, in place of the weakest when the budget is spent.
  if (recorder !== null && !chosen.some(m => m.recorder)) {
    const own = cands.find(m => m.recorder && !chosen.includes(m) && !ok(m)
      && !chosen.some(c => c !== chosen.at(-1) && m.t0 < c.t1 + RECAP.spacing && c.t0 < m.t1 + RECAP.spacing));
    if (own) {
      const weakest = [...chosen].sort((a, b) => a.score - b.score)[0];
      if (weakest && (video >= budget || chosen.length >= max) && !(own.t0 < weakest.t1 + RECAP.spacing && weakest.t0 < own.t1 + RECAP.spacing && chosen.length > 1)) {
        chosen.splice(chosen.indexOf(weakest), 1);
        video -= weakest.est;
      }
      if (!clash(own)) take(own);
    }
  }
  chosen.sort((a, b) => a.t0 - b.t0);
  return { moments: chosen, dropped, recorder, video: Math.round(video) };
}

// --- The salt ---------------------------------------------------------------------
//
// The owner, 2026-11-15: "text that shows someone losing their temper ... full
// of swear words, accusations and general being a bitch ... add it at the end
// of the clip in a slide show of whining. It's optional if there is none."
// Gamers call it salt. A line scores for its swearing, its accusations (hacks,
// camping, team kills, lag, a call for the admin), its insults, shouting in
// capitals and stacked punctuation; an apology or a laugh takes it down. A line
// with a slur is never shown, however salty: the recap is a joke at the
// round's expense, not a platform for that.

/** Word lists, matched case-blind on word boundaries. */
const SWEAR = /\b(f+u+c+k\w*|fck\w*|fuq\w*|fuk\w*|motherf\w*|mf|shit\w*|bull?shit\w*|bs|crap\w*|damn\w*|dick\w*|ass(hole|holes)?|arse\w*|bastard\w*|bitch\w*|cunt\w*|wank\w*|piss\w*|prick\w*|twat\w*|stfu|gtfo|wtf|ffs|omfg|scheiss\w*|scheiße\w*|kurwa\w*|merde|putain|blyat\w*|blya|cyka|suka|puta\w*|mierda|joder|cazzo|vittu\w*|helvete|jävla\w*|kurva\w*)\b/gi;
const ACCUSE = /\b(hack\w*|hax\w*|cheat\w*|aimbot\w*|wall ?hack\w*|camp(er|ers|ing|s)?|spawn ?(kill\w*|camp\w*|rap\w*)|base ?rap\w*|tk(er|ers|ing|s)?|tk'?(er|ing)|team ?kill\w*|lag\w*|laggy|rigged|unbalanced|stacked|admin\w*|kick\w*|ban|bans|banned|banning|report\w*|unfair|op|overpowered)\b/gi;
const INSULT = /\b(noob\w*|n00b\w*|idiot\w*|stupid\w*|moron\w*|loser\w*|pathetic|useless|useles|worthless|trash|garbage|clown\w*|dumb\w*|joke|lame|sucks?|suck\w*|cry\w*|baby|babies|ez|ezz+|l2p|learn to play|go home|uninstall|retreat|cowards?|scrub\w*|bot)\b/gi;
const SLUR = /\b(nigg\w*|n1gg\w*|negro\w*|fag\w*|f4g\w*|retard\w*|tranny\w*|kike\w*|spic|spics|chink\w*|gook\w*|wetback\w*|raghead\w*|towelhead\w*|untermensch\w*|sieg ?heil|heil hitler|1488|88)\b/i;
const SORRY = /\b(sorry|sry|soz|my bad|mb|oops|apologi\w*|np|no problem|thanks?|thx|ty|gg|wp|nice|well done)\b/i;
const LAUGH = /\b(lol+|lmao+|haha\w*|hehe\w*|xd+|rofl)\b|:\)|:d|:p|;\)/i;

/** The tuning: a slide needs `min` points; `max` slides at most, `perSpeaker`
 *  of one man; his lines within `join` s are one slide of up to `lines`. */
export const SALT = Object.freeze({ min: 3, max: 5, perSpeaker: 2, join: 18, lines: 3, maxChars: 120, minChars: 2 });

/** A chat line's body and speaker: `Name: text` or `Name [allies]: text`. */
export function chatParts(text) {
  const s = String(text ?? '');
  const at = s.indexOf(': ');
  if (at <= 0) return { name: '', body: s.trim(), teamChat: false };
  const head = s.slice(0, at);
  return { name: head.replace(/ ?\[(allies|axis)\]$/i, '').trim(), body: s.slice(at + 2).trim(), teamChat: /\[(allies|axis)\]$/i.test(head) };
}

/**
 * How salty one chat body is: `{ score, hot: [[from, to]...], slur }`, `hot`
 * the character spans the recap paints in the salt colour (each swear,
 * accusation and insult).
 */
export function saltScore(body) {
  const s = String(body ?? '');
  if (SLUR.test(s)) return { score: 0, hot: [], slur: true };
  const hot = [];
  let score = 0;
  const count = (re, each, cap) => {
    let n = 0;
    for (const m of s.matchAll(re)) { hot.push([m.index, m.index + m[0].length]); n++; }
    score += Math.min(cap, n * each);
    return n;
  };
  const angry = count(SWEAR, 2, 6) + count(ACCUSE, 2, 4) + count(INSULT, 1.5, 3);
  // Capitals and stacked marks raise an angry line; alone they are hype
  // ("LETS SINK THESE JERMANS" on Corfu is a man enjoying himself).
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (angry && letters.length >= 5 && letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.7) score += 2;
  if (angry && /[!?]{2,}/.test(s)) score += 1;
  if (SORRY.test(s)) score -= 3;
  if (LAUGH.test(s)) score -= 1;
  hot.sort((a, b) => a[0] - b[0]);
  // Overlapping matches (a swear inside an accusation) are one span.
  const spans = [];
  for (const h of hot) {
    const last = spans.at(-1);
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]); else spans.push([...h]);
  }
  return { score: Math.round(score * 10) / 10, hot: spans, slur: false };
}

/**
 * The round's salt: `[{ t, pid, name, team, teamChat, score, lines: [{ t, text, hot }]
 * }]` in round order, the saltiest slides (none under SALT.min), at most
 * perSpeaker of one man. Only men's lines: no bots, no server, no commands.
 * Empty when nobody lost their temper; the recap then has no salt.
 */
export function saltOf(rec, { max = SALT.max } = {}) {
  const lines = [];
  const seenText = new Set();
  for (const c of rec.chat ?? []) {
    if (!(c.pid >= 0)) continue;
    const p = playerAt(rec, c.pid, c.t);
    if (!p || p.ai) continue;
    const { name, body, teamChat } = chatParts(c.text);
    // The card names him: a name that carries a slur is not shown either.
    if (SLUR.test(name || p.name || '')) continue;
    if (body.length < SALT.minChars || /^[!/.#@]|^admin\./i.test(body)) continue;
    const text = body.length > SALT.maxChars ? `${body.slice(0, SALT.maxChars - 1).trimEnd()}...` : body;
    const dup = `${c.pid}:${text.toLowerCase()}`;
    if (seenText.has(dup)) continue;
    seenText.add(dup);
    const s = saltScore(text);
    if (s.slur) continue;
    lines.push({ t: c.t, pid: c.pid, teamChat, name: name || p.name || '', team: c.team ?? teamAt(rec, c.pid, c.t) ?? 0, text, score: s.score, hot: s.hot });
  }
  // A man's lines close together are one slide: his rant.
  const slides = [];
  const open = new Map();
  for (const l of lines.sort((a, b) => a.t - b.t)) {
    const cur = open.get(l.pid);
    if (cur && l.t - cur.lines.at(-1).t <= SALT.join && cur.lines.length < SALT.lines) {
      if (l.score > 0) { cur.lines.push(l); cur.score += l.score; }
      continue;
    }
    if (l.score <= 0) continue;
    const s = { t: l.t, pid: l.pid, name: l.name, team: l.team, teamChat: l.teamChat, score: l.score, lines: [l] };
    slides.push(s);
    open.set(l.pid, s);
  }
  const ranked = slides.filter(s => s.score >= SALT.min).sort((a, b) => b.score - a.score || a.t - b.t);
  const out = [];
  const per = new Map();
  for (const s of ranked) {
    if (out.length >= max) break;
    if ((per.get(s.pid) ?? 0) >= SALT.perSpeaker) continue;
    per.set(s.pid, (per.get(s.pid) ?? 0) + 1);
    out.push({ ...s, score: Math.round(s.score * 10) / 10, lines: s.lines.map(l => ({ t: l.t, text: l.text, hot: l.hot })) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Seconds a salt slide stays up: long enough to read it twice. */
export const slideSeconds = slide => {
  const chars = slide.lines.reduce((n, l) => n + l.text.length, 0);
  return Math.max(2.6, Math.min(5, 1.8 + chars * 0.045));
};

/** The view-space distance between two whereIs positions, flat. */
export const flatDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export { positionAt };
