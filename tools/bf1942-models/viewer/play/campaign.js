// The single-player campaign's law, its saved state and how a mission starts.
//
// Pure: no DOM beyond the `storage` a caller hands in, so
// `tests/test_campaign.mjs` runs it under node. The campaign screen
// (`campaign-screen.js`) and a campaign round's end (`../campaign-debriefing.js`)
// both go through it, so the two can never disagree about the score.
//
// What retail 1.61 does (features/single-player-campaign, which cites the
// addresses):
//
//  - sixteen missions in `CampaignMapList.con`'s order, one list for both
//    sides; the side is the TEAM pick, kept for the whole campaign;
//  - after a mission's round a win adds its victory type (minor 1, major 2,
//    total 3) to the score and a loss takes twice it off; below the mission's
//    floor the campaign is lost (TOTAL DEFEAT), else the score is capped at
//    the mission's ceiling and CONTINUE goes on to the next mission, won or
//    lost; the status bar is (score - floor) / (cap - floor);
//  - REPLAY plays the mission again from the score it started with (the
//    server keeps the previous score beside the new one, `GameServer+0x304`);
//  - after mission sixteen the final grade is the score's band.
//
// Retail keeps the campaign in `save/<profile>/<campaignId>/campaign.con`
// (`FUN_006d9bf0`), and the menu's TEAM rows call `Campaign/SelectCampaign`:
// read here as one campaign a side, the id being the team (inferred, not
// traced). This site keeps each side's in the browser (`storageKey`), and the
// side last picked beside them (`TEAM_KEY`).

import { VICTORY } from '../round-state.js';

export const STORAGE_KEY = 'bf42-campaign';
export const TEAM_KEY = 'bf42-campaign-team';
export const VERSION = 1;

/** Where a side's campaign is kept. */
export const storageKey = team => `${STORAGE_KEY}-${team === 1 ? 1 : 2}`;

/** The engine's team numbering (`menu-screen.js` `AXIS` / `ALLIED`). */
export const AXIS = 1;
export const ALLIED = 2;

/** `totalDefeat` (client `0x008db9c0`): per mission, below this the campaign
 *  is lost. `campaign.json` carries the same table; this is the fallback. */
export const FLOOR = Object.freeze([-2, -2, -2, -2, -3, -3, -3, -3,
                                    -4, -4, -4, -4, -4, -4, -4, -4]);
/** `totalVictory` (client `0x008dba00`): per mission, the score's ceiling. */
export const CAP = Object.freeze([5, 7, 9, 11, 13, 15, 17, 17, 17, 19, 20, 21, 22, 23, 24, 25]);

/** The final grade's upper bounds, worst first (Mac `DebriefingMenu::debriefing`). */
export const FINAL_GRADES = Object.freeze([
  ['totalDefeat', -3], ['majorDefeat', 4], ['minorDefeat', 10],
  ['minorVictory', 19], ['majorVictory', 24], ['totalVictory', Infinity],
]);

/** The campaign difficulty's three sliders and what each step does. AI SKILL
 *  is ledger AI-20's table, which the campaign arm does reach (AI-21: the
 *  Instant Battle arm is the inert one); ENEMY VS. FRIENDLY UNITS RATIO is
 *  AI-20's ratio pair read as friendly:enemy (AI-20 marks that reading
 *  inferred); PLAYER DEATH TICKET PENALTY is AI-20's NrOfLives table, read by
 *  its label as the tickets the player's own death costs his side. */
export const AI_SKILL = Object.freeze([0.25, 0.5, 0.75, 1.0]);
export const BOT_RATIO = Object.freeze([[1, 1], [3, 4], [1, 2], [1, 3]]);
export const DEATH_PENALTY = Object.freeze([1, 5, 10, 20]);

/** `menu/CampaignMenu`'s difficulty rows: `Campaign/CampaignDifficultyLevel`
 *  1 CUSTOM, 2 EASY, 3 NORMAL, 4 HARD, and what the preset rows set. The
 *  page's own hit nodes carry the same values; these are the fallback. */
export const PRESETS = Object.freeze({
  2: { aiSkill: 1, lives: 1, ratio: 1, overall: 25 },
  3: { aiSkill: 2, lives: 2, ratio: 2, overall: 50 },
  4: { aiSkill: 3, lives: 3, ratio: 3, overall: 75 },
});
export const CUSTOM = 1;

/** The bot count a mission starts with: Instant Battle's default
 *  (`skirmish.js`). Retail fills `game.maxNrofPlayers` (18 on Wake), more
 *  than a browser carries; the screen has a slider for it. */
export const DEFAULT_BOT_COUNT = 4;
export const MAX_BOTS = 32;

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** The difficulty in force: a preset's values, or CUSTOM's own sliders. */
export function difficultyOf({ level = 3, aiSkill = 2, lives = 2, ratio = 2 } = {}) {
  const preset = PRESETS[level];
  const pick = preset ?? { aiSkill, lives, ratio };
  const d = {
    level: PRESETS[level] ? level : CUSTOM,
    aiSkill: clampInt(pick.aiSkill, 1, 4, 2),
    lives: clampInt(pick.lives, 1, 4, 2),
    ratio: clampInt(pick.ratio, 1, 4, 2),
  };
  // OVERALL DIFFICULTY: the presets' 25 / 50 / 75; CUSTOM's is the sliders'
  // mean on the same scale (IMPOSSIBLE everywhere is 100).
  d.overall = preset ? preset.overall : Math.round(((d.aiSkill + d.lives + d.ratio) / 3) * 25);
  return d;
}

/** A fresh campaign: mission 1, score 0. */
export function newCampaign({ team = ALLIED, difficulty = {}, botCount = DEFAULT_BOT_COUNT } = {}) {
  return {
    version: VERSION,
    team: team === AXIS ? AXIS : ALLIED,
    difficulty: difficultyOf(difficulty),
    botCount: clampInt(botCount, 0, MAX_BOTS, DEFAULT_BOT_COUNT),
    mission: 1,
    score: 0,
    over: false,
    finished: false,
    results: [],
    totals: { score: 0, kills: 0, deaths: 0 },
    undo: null,
  };
}

/** A stored campaign, checked; null when there is none or it is unreadable. */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return null;
  const state = newCampaign({ team: raw.team, difficulty: raw.difficulty, botCount: raw.botCount });
  state.mission = clampInt(raw.mission, 1, 17, 1);
  state.score = clampInt(raw.score, -1000, 1000, 0);
  state.over = !!raw.over;
  state.finished = !!raw.finished;
  state.results = Array.isArray(raw.results) ? raw.results.filter(r => r && typeof r === 'object') : [];
  const t = raw.totals || {};
  state.totals = { score: Number(t.score) || 0, kills: Number(t.kills) || 0, deaths: Number(t.deaths) || 0 };
  state.undo = raw.undo && typeof raw.undo === 'object' ? raw.undo : null;
  return state;
}

/** Read a side's saved campaign. Any storage failure reads as none. */
export function loadCampaign(team, storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(storageKey(team));
    const state = text ? normalise(JSON.parse(text)) : null;
    return state && state.team === (team === AXIS ? AXIS : ALLIED) ? state : null;
  } catch (_) {
    return null;
  }
}

/** Save it, under its own side. False when the browser would not keep it. */
export function saveCampaign(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(storageKey(state.team), JSON.stringify(state));
    storage?.setItem(TEAM_KEY, String(state.team));
    return true;
  } catch (_) {
    return false;
  }
}

/** The side last played or picked, Allied when none. */
export function lastTeam(storage = globalThis.localStorage) {
  try { return Number(storage?.getItem(TEAM_KEY)) === AXIS ? AXIS : ALLIED; } catch (_) { return ALLIED; }
}

export function rememberTeam(team, storage = globalThis.localStorage) {
  try { storage?.setItem(TEAM_KEY, String(team === AXIS ? AXIS : ALLIED)); } catch (_) { /* private mode */ }
}

export function clearCampaign(team, storage = globalThis.localStorage) {
  try { storage?.removeItem(storageKey(team)); } catch (_) { /* private mode */ }
}

/** The floor and cap of a mission (1-based), from `campaign.json`'s tables
 *  when the caller has them. */
export function boundsOf(mission, score = null) {
  const i = Math.min(15, Math.max(0, mission - 1));
  const floor = score?.floor?.[i] ?? FLOOR[i];
  const cap = score?.cap?.[i] ?? CAP[i];
  return { floor, cap };
}

/** The status bar's fill, 0..1, and the two numbers the plate's bar node
 *  reads (`CampaignScore` of `MaxCampaignScore`). */
export function statusBar(score, mission, tables = null) {
  const { floor, cap } = boundsOf(mission, tables);
  const value = score - floor;
  const max = cap - floor;
  return { value, max, fraction: max > 0 ? Math.min(1, Math.max(0, value / max)) : 0 };
}

/** The score a mission's round changes it by: the victory type on a win,
 *  minus twice it on a loss, nothing on a draw. */
export function scoreDelta({ won, victoryType }) {
  const type = victoryType === VICTORY.minor || victoryType === VICTORY.major
    || victoryType === VICTORY.total ? victoryType : 0;
  if (!type) return 0;
  return won ? type : -2 * type;
}

/**
 * A mission's round is over: the rule applied (`gameStatusPlaying`). Returns
 * the new state, with the result recorded, the mission already moved on (or
 * the campaign over or finished), and `undo` holding the state the mission
 * started from for REPLAY. `stats` is the player's own row of the round.
 */
export function finishMission(state, { won, victoryType, stats = null, tables = null }) {
  const before = { ...state, undo: null };
  const mission = state.mission;
  const { floor, cap } = boundsOf(mission, tables);
  const delta = scoreDelta({ won, victoryType });
  let score = state.score + delta;
  const over = score < floor;
  if (score > cap) score = cap;
  const row = {
    mission, won: !!won, victoryType: victoryType ?? null, delta, score,
    kills: Number(stats?.kills) || 0, deaths: Number(stats?.deaths) || 0,
    points: Number(stats?.score) || 0,
  };
  const results = [...state.results.filter(r => r.mission !== mission), row]
    .sort((a, b) => a.mission - b.mission);
  const totals = {
    score: state.totals.score + row.points,
    kills: state.totals.kills + row.kills,
    deaths: state.totals.deaths + row.deaths,
  };
  const next = over ? mission : mission + 1;
  return {
    ...state,
    score,
    over,
    finished: over || next > 16,
    mission: Math.min(next, 17),
    results,
    totals,
    undo: before,
  };
}

/** REPLAY: the state the mission started from. */
export function replayMission(state) {
  return state?.undo ? { ...state.undo, undo: null } : state;
}

/** DONE or CONTINUE: the result stands. */
export function acceptMission(state) {
  return state ? { ...state, undo: null } : state;
}

/** The last debriefing's grade for a finished (or lost) campaign. A campaign
 *  that fell below a floor is a total defeat whatever its score. */
export function finalGrade(state) {
  if (state.over) return 'totalDefeat';
  for (const [grade, below] of FINAL_GRADES) if (state.score < below) return grade;
  return 'totalVictory';
}

/** `CampaignVictory` for the last screen's picture and line: 1..3 the Allies
 *  won, 4..6 the Axis won, 7..9 the Allies lost, 10..12 the Axis lost, each
 *  triple total / major / minor. */
export function campaignVictory(team, grade) {
  const won = grade.endsWith('Victory');
  const size = grade.startsWith('total') ? 0 : grade.startsWith('major') ? 1 : 2;
  const base = won ? (team === ALLIED ? 1 : 4) : (team === ALLIED ? 7 : 10);
  return base + size;
}

/** The title key a grade is drawn with (`DEBRIEFING_TOTAL_VICTORY` ..). */
export function gradeTitleKey(grade) {
  return `DEBRIEFING_${grade.replace(/[A-Z]/, c => `_${c}`).toUpperCase()}`;
}

/** The mission a state is on, out of the campaign's order (`campaign.json`
 *  `order`); null once finished. */
export function missionOf(state, order) {
  if (!state || state.finished) return null;
  return order?.[state.mission - 1] ?? null;
}

/** How many bots fight on the enemy side out of `count`, by the ratio step:
 *  the player's side is the player and the rest. 1:1 keeps Instant Battle's
 *  split (the odd body on the player's side). */
export function enemyBots(count, ratio = 1) {
  const n = clampInt(count, 0, MAX_BOTS, 0);
  if (!n) return 0;
  const [friendly, enemy] = BOT_RATIO[clampInt(ratio, 1, 4, 1) - 1];
  const share = enemy / (friendly + enemy);
  // Ties go to the player's side.
  return Math.min(n, Math.max(0, Math.round((n + 1) * share - 1e-9)));
}

/** The `teams` list `bot.js` `spawnBots` deals bots from (one entry a bot,
 *  `teams[i % length]`): `enemy` of them on `enemyTeam`, the rest on
 *  `friendlyTeam`, interleaved so both sides fill their spawn points. */
export function botTeams(count, enemy, friendlyTeam, enemyTeam) {
  const n = Math.max(0, Math.trunc(count) || 0);
  const e = Math.min(n, Math.max(0, Math.trunc(enemy) || 0));
  const out = [];
  let placedEnemy = 0;
  for (let i = 0; i < n; i++) {
    // The enemy's share of the first i+1 bots, rounded: an even interleave.
    const due = Math.round(((i + 1) * e) / n);
    if (due > placedEnemy) { out.push(enemyTeam); placedEnemy++; } else out.push(friendlyTeam);
  }
  return out;
}

/**
 * The address a mission plays at: `map.html` with the level, the side, the
 * single-player layer (`mode=CoOp`, the layer `SinglePlayer<Side>.con` runs),
 * the bots and their skill, the enemy's share of them, the side's own
 * tickets and bleeds, the death penalty, and `campaign=1`.
 *
 * `entry` is the level's `maps.json` row (its `name` is what `?map=` takes);
 * `mission` the `campaign.json` order row; `levels` its `levels` table.
 */
export function launchUrl(state, { root = '../', base = globalThis.location?.href, entry, mission, levels } = {}) {
  if (!state || !entry) return null;
  const url = new URL(`${root}map.html`, base);
  const side = state.team === AXIS ? 'axis' : 'allied';
  const d = state.difficulty;
  url.searchParams.set('map', entry.name);
  url.searchParams.set('team', String(state.team));
  url.searchParams.set('mode', 'CoOp');
  url.searchParams.set('botCount', String(state.botCount));
  url.searchParams.set('botSkill', String(AI_SKILL[d.aiSkill - 1]));
  url.searchParams.set('enemyBots', String(enemyBots(state.botCount, d.ratio)));
  const tickets = levels?.[mission?.dir]?.[side]?.tickets;
  if (tickets && Number.isFinite(tickets.team1) && Number.isFinite(tickets.team2)) {
    url.searchParams.set('tickets', `${tickets.team1},${tickets.team2}`);
    const loss = tickets.lossPerMin || {};
    if (Number.isFinite(loss.team1) && Number.isFinite(loss.team2)) {
      url.searchParams.set('lossPerMin', `${loss.team1},${loss.team2}`);
    }
  }
  url.searchParams.set('deathPenalty', String(DEATH_PENALTY[d.lives - 1]));
  url.searchParams.set('campaign', '1');
  return url.toString();
}

/** `?tickets=a,b` / `?lossPerMin=a,b` back into `{ team1, team2 }`, or null. */
export function parsePair(text) {
  if (!text) return null;
  const [a, b] = String(text).split(',').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 ? { team1: a, team2: b } : null;
}
