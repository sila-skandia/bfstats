// tests/test_page_match.py: the pure parts of sim/pagematch.mjs (no browser).
import { buildPageBar, isVoid, judgePage, matchUrl, onTheLine, rolloutFloor, summarise } from '../sim/pagematch.mjs';

const counts = [
  { id: 'bot_0', team: 1, kills: 3, deaths: 2, teamKills: 0, suicides: 0, captures: 1, score: 5 },
  { id: 'bot_1', team: 1, kills: 1, deaths: 4, teamKills: 2, suicides: 1, captures: 0, score: -3 },
  { id: 'bot_2', team: 2, kills: 2, deaths: 5, teamKills: 1, suicides: 0, captures: 0, score: 0 },
];
const m = (level, tk, kills, share, su = 0) => ({ level, minutes: 10, teamKillsPerBotMinute: tk, enemyKillsPerBotMinute: kills, nonEnemyDeathShareWorseSide: share, suicidesPerBotMinute: su, capturesTotal: 3 });
const pageBar = buildPageBar([m('Berlin', 0.06, 0.40, 0.26, 0.02), m('Stalingrad', 0.01, 0.31, 0.15, 0.04), m('Bocage', 0.03, 0.22, 0.40, 0.04)], 'three matches');
console.log(JSON.stringify({
  pageBar: pageBar.bar,
  pageOk: judgePage([m('x', 0.05, 0.30, 0.2), m('x', 0.02, 0.25, 0.3), m('x', 0.09, 0.5, 0.45)], pageBar),
  pageShoots: judgePage([m('x', 0.15, 0.25, 0.53), m('x', 0.18, 0.33, 0.47), m('x', 0.12, 0.28, 0.30)], pageBar),
  pageQuiet: judgePage([m('x', 0, 0.01, 0), m('x', 0, 0.02, 0), m('x', 0, 0.0, 0)], pageBar),
  pageNoBar: judgePage([m('x', 0.5, 0.01, 0.9)], null),
  summary: summarise(counts, 16, 10),
  empty: summarise([], 16, 10),
  floor: {
    fight: rolloutFloor({ enemyKillsPerBotMinute: 0.2, capturesTotal: 0, suicidesPerBotMinute: 0.02, teamKillsPerBotMinute: 0 }),
    flags: rolloutFloor({ enemyKillsPerBotMinute: 0.04, capturesTotal: 8 }),
    both: rolloutFloor({ enemyKillsPerBotMinute: 0.06, capturesTotal: 1 }),
    flagsOnly: rolloutFloor({ enemyKillsPerBotMinute: 0, capturesTotal: 7 }),
    quiet: rolloutFloor({ enemyKillsPerBotMinute: 0.04, capturesTotal: 2 }),
    ownHand: rolloutFloor({ enemyKillsPerBotMinute: 0.4, capturesTotal: 5, suicidesPerBotMinute: 0.094, teamKillsPerBotMinute: 0.025 }),
    error: rolloutFloor({ enemyKillsPerBotMinute: 0.4, capturesTotal: 5, pageErrors: ['TypeError'] }),
  },
  voids: [isVoid(summarise([], 16, 10)), isVoid(summarise(counts, 16, 10)), isVoid(summarise([{ id: 'bot_9', team: 0, captures: 2, score: 4 }], 16, 10))],
  unsided: summarise([counts[0], { id: 'bot_9', team: 0, captures: 2, score: 4 }], 16, 10),
  ahead: onTheLine([0, 0, 0], [0, 0, 100], [0.3, 0, 12]),
  behind: onTheLine([0, 0, 0], [0, 0, 100], [0, 0, -4]),
  beside: onTheLine([0, 0, 0], [0, 0, 100], [6, 0, 12]),
  vanilla: matchUrl({ map: 'Berlin' }),
  mod: matchUrl({ map: 'The_Maze', mod: 'community', bots: 32 }),
}));
