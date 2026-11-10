// tests/test_page_match.py: the pure parts of sim/pagematch.mjs (no browser).
import { matchUrl, onTheLine, summarise } from '../sim/pagematch.mjs';

const counts = [
  { id: 'bot_0', team: 1, kills: 3, deaths: 2, teamKills: 0, suicides: 0, captures: 1, score: 5 },
  { id: 'bot_1', team: 1, kills: 1, deaths: 4, teamKills: 2, suicides: 1, captures: 0, score: -3 },
  { id: 'bot_2', team: 2, kills: 2, deaths: 5, teamKills: 1, suicides: 0, captures: 0, score: 0 },
];
console.log(JSON.stringify({
  summary: summarise(counts, 16, 10),
  empty: summarise([], 16, 10),
  unsided: summarise([counts[0], { id: 'bot_9', team: 0, captures: 2, score: 4 }], 16, 10),
  ahead: onTheLine([0, 0, 0], [0, 0, 100], [0.3, 0, 12]),
  behind: onTheLine([0, 0, 0], [0, 0, 100], [0, 0, -4]),
  beside: onTheLine([0, 0, 0], [0, 0, 100], [6, 0, 12]),
  vanilla: matchUrl({ map: 'Berlin' }),
  mod: matchUrl({ map: 'The_Maze', mod: 'community', bots: 32 }),
}));
