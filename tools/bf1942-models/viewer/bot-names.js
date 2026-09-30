// A bot's name, the way the server picks one.
//
// The server runs the level's `SinglePlayer/Skirmish.con` once as it starts
// (`GameServer::loadBots(0)` 0x08131ef0, ledger AI-8, AI-134), which `run`s
// name files along the mod chain: `game.addFirstNameOnTeam <team> <name>`
// and `game.addSecondNameOnTeam <team> <name>`, two lists per team.
// `extract_bot_names.py` replays that into `_shared/bot-names.json`: each
// name script's lists once, and each level's scripts in the order they run.
//
// Each bot the server tops up is named for the team it joins by
// `Game::getRandomNameForTeam` 0x0805fd50 (ledger AI-135), before it is
// registered:
//
//   * the two lists are paired BY INDEX: `first[i] + " " + second[i]`, `i`
//     drawn below the shorter list's length (`game.randomNames`, which would
//     draw the two independently, is set by no shipped script);
//   * a name some player already has, compared without case
//     (`PlayerManager::getPlayerFromName` 0x08261070), is drawn again, twenty
//     draws in all; then the pairs are tried in order; then the last draw
//     with `1`, `2`, ... appended (`"%s%d"`);
//   * a team with an empty list is `Player`, `Player2`, `Player3`, ...
//
// The dice are the caller's: the engine's `rand()` stream is not modelled.

/** Draws before the in-order sweep (the loop's `0x13 < tries` exit). */
export const NAME_DRAWS = 20;

/** The two teams `Game` keeps lists for (`team - 1 < 2`). */
const TEAMS = [1, 2];

/**
 * The lists a level leaves, `{ 1: { first, second }, 2: { first, second } }`,
 * composed from `_shared/bot-names.json` in the order its scripts run. Null
 * when there is no file or the file does not know the level; a level whose
 * archives ship no `Skirmish.con` is known and has empty lists.
 */
export function levelNameLists(manifest, level) {
  const keys = manifest?.levels?.[String(level ?? '').toLowerCase()];
  if (!Array.isArray(keys)) return null;
  const lists = {};
  for (const team of TEAMS) lists[team] = { first: [], second: [] };
  for (const key of keys) {
    const teams = manifest.scripts?.[key]?.teams ?? {};
    for (const team of TEAMS) {
      const own = teams[String(team)];
      if (!own) continue;
      lists[team].first.push(...(own.first ?? []));
      lists[team].second.push(...(own.second ?? []));
    }
  }
  return lists;
}

/**
 * `Game::getRandomNameForTeam` over one team's lists. `isTaken(name)` answers
 * whether any player already has the name (without case); `random()` is
 * uniform in [0, 1).
 */
export function pickBotName(lists, isTaken, random = Math.random) {
  const first = lists?.first ?? [];
  const second = lists?.second ?? [];
  if (!first.length || !second.length) {
    for (let n = 1; ; n++) {
      const name = n === 1 ? 'Player' : `Player${n}`;
      if (!isTaken(name)) return name;
    }
  }
  const pairs = Math.min(first.length, second.length);
  const draw = () => Math.min(pairs - 1, Math.floor(random() * pairs));
  let last = null;
  for (let tries = 0; tries < NAME_DRAWS; tries++) {
    const i = draw();
    last = `${first[i]} ${second[i]}`;
    if (!isTaken(last)) return last;
  }
  for (let i = 0; i < pairs; i++) {
    const name = `${first[i]} ${second[i]}`;
    if (!isTaken(name)) return name;
  }
  for (let n = 1; ; n++) {
    const name = `${last}${n}`;
    if (!isTaken(name)) return name;
  }
}

/**
 * A namer for one level's bots: `nameFor(team)` names the next bot of
 * `team`, keeping every name it hands out, and the `taken` names it starts
 * with (the human's), out of the next draw.
 */
export function createBotNamer({ lists, taken = [], random = Math.random } = {}) {
  const used = new Set();
  for (const name of taken) if (name) used.add(String(name).toLowerCase());
  const isTaken = name => used.has(name.toLowerCase());
  return team => {
    const name = pickBotName(lists?.[team] ?? null, isTaken, random);
    used.add(name.toLowerCase());
    return name;
  };
}

/**
 * Fetch a maps tree's `_shared/bot-names.json`. Resolves null when the tree
 * has none (a tree published before the file, or a mod never run through the
 * extractor): the bots then keep the page's own table (`bot.js`). Never
 * rejects.
 */
export function loadBotNames(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(() => fetchImpl(url))
    .then(r => (r?.ok ? r.json() : null))
    .then(data => (data && typeof data === 'object' && data.levels ? data : null))
    .catch(err => { console.warn('bot names unavailable', err); return null; });
}
