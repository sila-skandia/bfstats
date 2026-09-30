// Pins how a bot is named (`viewer/bot-names.js`): the lists a level's
// `SinglePlayer/Skirmish.con` loads, composed out of `_shared/bot-names.json`
// in the order its scripts run, and `Game::getRandomNameForTeam` 0x0805fd50
// over them -- the two lists paired by index, twenty draws, the pairs in
// order, the last draw numbered, `Player`/`Player2` for an empty team, and a
// name compared without case against every player's (ledger AI-134, AI-135).
//
// Then through the page's own path: the referee's `spawn` hands `nameFor` to
// `spawnBots` on the runner's synthetic level, and without it the bots keep
// bot.js's stand-in table. Last, the trees' real manifests where they are on
// disk (they are extracted, not tracked).
//
// Run by `tests/test_bot_names.py`. One JSON object on stdout.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
const M = await loadViewerModules(viewer);
const names = await import(pathToFileURL(path.join(viewer, 'bot-names.js')).href);
const { BOT_NAMES } = await import(pathToFileURL(path.join(viewer, 'bot.js')).href);
const { levelNameLists, pickBotName, createBotNamer, NAME_DRAWS, loadBotNames } = names;
seedMathRandom(3);
const log = console.log;
console.log = () => {};
console.warn = () => {};

/** Dice that return `values` in turn, as fractions of the pair count. */
const dice = (values, pairs) => {
  let i = 0;
  const calls = { n: 0 };
  const random = () => { calls.n++; return (values[Math.min(i++, values.length - 1)] + 0.5) / pairs; };
  return { random, calls };
};
const takenOf = list => {
  const set = new Set(list.map(n => n.toLowerCase()));
  return n => set.has(n.toLowerCase());
};

const out = {};

// -- Composition ------------------------------------------------------------
const manifest = {
  mod: 'Synthetic', script: 'SinglePlayer/Skirmish.con',
  scripts: {
    'bf1942/game/common/a.con': { origin: 'x', teams: { 2: { first: ['Ann', 'Bob'], second: ['Ash', 'Birch'] } } },
    'bf1942/game/common/b.con': { origin: 'x', teams: { 1: { first: ['Carl'], second: ['Cole'] },
                                                         2: { first: ['Dan'], second: ['Dune', 'Extra'] } } },
    'bf1942/game/common/c.con': { origin: 'x', teams: { 3: { first: ['Nobody'], second: ['Never'] } } },
  },
  levels: {
    alpha: ['bf1942/game/common/a.con', 'bf1942/game/common/b.con', 'bf1942/game/common/c.con'],
    bare: [],
  },
};
out.composed = levelNameLists(manifest, 'Alpha');
out.bare = levelNameLists(manifest, 'bare');
out.unknown = levelNameLists(manifest, 'nowhere');
out.noManifest = levelNameLists(null, 'alpha');

// -- getRandomNameForTeam ----------------------------------------------------
const L = { first: ['A', 'B', 'C'], second: ['x', 'y'] };
{
  // Index pairing, the shorter list's length: `C` is never drawn.
  const seen = new Set();
  for (let k = 0; k < 400; k++) seen.add(pickBotName(L, () => false, Math.random));
  out.pairs = [...seen].sort();
}
{
  // A taken name (any case) is drawn again.
  const d = dice([0, 0, 1], 2);
  out.redraw = { name: pickBotName(L, takenOf(['a X']), d.random), draws: d.calls.n };
}
{
  // Twenty draws of a taken pair, then the pairs in order.
  const d = dice([0], 2);
  out.sweep = { name: pickBotName(L, takenOf(['A x']), d.random), draws: d.calls.n, NAME_DRAWS };
}
{
  // Every pair taken: the twentieth draw with 1, 2, ... appended.
  const d = dice([1], 2);
  out.numbered = pickBotName(L, takenOf(['A x', 'B y']), d.random);
  out.numbered2 = pickBotName(L, takenOf(['A x', 'B y', 'B y1']), dice([1], 2).random);
}
out.emptyTeam = pickBotName({ first: [], second: ['z'] }, () => false);
out.emptyTaken = pickBotName({ first: ['A'], second: [] }, takenOf(['PLAYER', 'player2']));
{
  // One namer for a level: never a name twice, across teams, and never the
  // human's. Deserters Island loads one list for both teams.
  const same = { first: ['P', 'Q', 'R'], second: ['p', 'q', 'r'] };
  const nameFor = createBotNamer({ lists: { 1: same, 2: same }, taken: ['q Q'], random: Math.random });
  out.namer = [1, 2, 1, 2].map(t => nameFor(t));
  const none = createBotNamer({ lists: { 1: { first: [], second: [] }, 2: { first: [], second: [] } }, taken: ['Player'] });
  out.namerEmpty = [1, 2, 1].map(t => none(t));
}
out.loadMissing = await loadBotNames('x', async () => ({ ok: false }));
out.loadThrows = await loadBotNames('x', async () => { throw new Error('offline'); });
out.loadOk = !!(await loadBotNames('x', async () => ({ ok: true, json: async () => manifest })));

// -- Through the referee -----------------------------------------------------
function spawnOn(nameFor) {
  const level = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: level.collider, extras: level.extras });
  const referee = M.createBotReferee({
    world: () => world, units: null, groundAt: () => 0,
    armorFor: () => new M.Armor(30), roundDamage: () => 30,
  });
  referee.spawn({ count: 6, botSkill: 0.75, teams: [1, 2], kitFor: (t, i) => level.kits.kitFor(t, i), nameFor });
  return referee.bots.map(b => ({ team: b.team, name: b.name }));
}
const lists = {
  1: { first: ['Ahmed', 'Ali', 'Abdul'], second: ['Talib', 'Bashir', 'Al-Ubeidi', 'Hassan'] },
  2: { first: ['Andrew', 'Arthur'], second: ['Rice', 'Fowler'] },
};
out.referee = spawnOn(createBotNamer({ lists, taken: ['Player'] }));
out.refereeTable = spawnOn(null);
out.table = BOT_NAMES;

// -- The trees' manifests -----------------------------------------------------
const trees = {
  bf1942: 'maps/_shared/bot-names.json',
  desertcombat: 'maps/mods/desertcombat/_shared/bot-names.json',
  dc_final: 'maps/mods/dc_final/_shared/bot-names.json',
};
out.trees = {};
for (const [tree, rel] of Object.entries(trees)) {
  const file = path.join(viewer, rel);
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const row = {};
  for (const level of ['el_alamein', 'dc_basrahs_edge', 'dc_oil_fields', 'wake']) {
    const got = levelNameLists(data, level);
    if (!got) continue;
    const nameFor = createBotNamer({ lists: got, taken: ['Player'] });
    row[level] = {
      lists: { 1: { first: got[1].first.length, second: got[1].second.length },
               2: { first: got[2].first.length, second: got[2].second.length } },
      firstNames: { 1: got[1].first, 2: got[2].first },
      team1: Array.from({ length: 12 }, () => nameFor(1)),
      team2: Array.from({ length: 12 }, () => nameFor(2)),
    };
  }
  out.trees[tree] = row;
}

console.log = log;
console.log(JSON.stringify(out));
