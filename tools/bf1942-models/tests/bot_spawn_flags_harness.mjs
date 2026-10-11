// `spawnBots` (viewer/bot.js): which flag each bot is handed at the start.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir, routeConsole } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
routeConsole(true);
const { spawnBots } = await import(pathToFileURL(path.join(viewer, 'bot.js')).href);

/** A world that records the flag each bot is added on. */
function fakeWorld() {
  const players = new Map();
  return {
    players,
    addBotPlayer(id, { team, flag, spawnIndex }) {
      const record = { id, team, flag, spawnIndex, soldier: null, spawn: flag?.spawns?.[0] ?? null };
      players.set(id, record);
      return record;
    },
    player: id => players.get(id) ?? null,
  };
}
const flag = (name, team, extra = {}) => ({ name, team, spawns: [{ position: [10, 0, 10] }, { position: [20, 0, 10] }], ...extra });

const results = {};
{
  // Essen's Allies: an airfield group, and a carried group (the paratroop C-47)
  // that is down at the start, listed after it.
  const world = fakeWorld();
  const flags = [
    flag('essen_front', 1),
    flag('alliedspawn1', 2, { standalone: true }),
    flag('soldierspawn01', 2, { inactive: true, vehicle: true }),
  ];
  const bots = spawnBots({ world, count: 8, teams: [1, 2], flags });
  results.carried = bots.map(b => ({ id: b.playerId, team: b.team, flag: world.player(b.playerId).flag?.name ?? null }));
}
{
  // Every flag of a side down: no flag is handed, the world's own rule
  // (`spawnPlayer`: a side whose flags are down waits) decides.
  const world = fakeWorld();
  const flags = [flag('a', 1), flag('b', 2, { inactive: true })];
  const bots = spawnBots({ world, count: 4, teams: [1, 2], flags });
  results.allDown = bots.map(b => ({ team: b.team, flag: world.player(b.playerId).flag?.name ?? null }));
}
{
  // A capture-only flag is still never handed.
  const world = fakeWorld();
  const flags = [flag('zone', 2, { captureOnly: true }), flag('base', 2), flag('axis', 1)];
  const bots = spawnBots({ world, count: 4, teams: [1, 2], flags });
  results.captureOnly = bots.filter(b => b.team === 2).map(b => world.player(b.playerId).flag?.name ?? null);
}
process.stdout.write(JSON.stringify(results));
