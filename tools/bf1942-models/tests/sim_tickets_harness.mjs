// The runner's round tickets (`sim/match.mjs` over `viewer/round-state.js`):
// matches set up on the synthetic level, some with another level's tickets in
// place of its own, and a minute of the runner's bleed. Prints one JSON blob
// for `tests/test_sim_tickets.py`.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sim');
const imp = f => import(pathToFileURL(path.join(SIM, f)).href);
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await imp('env.mjs');
const { syntheticLevel } = await imp('level.mjs');
const { Match } = await imp('match.mjs');

const M = await loadViewerModules(viewerDir());
routeConsole(true);

/** A match on the synthetic level (100 a side, 5 a minute), set up and not
 *  stepped. `tickets`, when given, replaces the level's own. */
function start({ tickets, maxPlayers = null, botsPerSide = 2 } = {}) {
  seedMathRandom(1);
  const level = syntheticLevel(M, { vehicles: false });
  if (tickets !== undefined) level.extras.tickets = tickets;
  const match = new Match({ M, level, botsPerSide, duration: 60, seed: 1, maxPlayers });
  match.setup();
  return { match, level };
}

const round = ({ match }) => ({
  maxPlayers: match.maxPlayers, startPlayers: match.startPlayers,
  tickets: { ...match.tickets }, lossPerMin: { ...match.lossPerMin },
});

const results = {};

// Unless named, the server is the bots: 3 a side is a 6-slot server.
results.population = round(start({ botsPerSide: 3 }));
results.named = round(start({ botsPerSide: 3, maxPlayers: 32 }));

// Kasserine Pass co-op's own tickets: its script sets `game.maxNrofPlayers 18`
// after its bleed lines, so the start is 18's and the bleed the server's.
const kasserine = { mode: 'CoOp', team1: 100, team2: 100, maxPlayers: 18, lossPerMin: { team1: 15, team2: 15 } };
const kp = start({ tickets: kasserine, maxPlayers: 32 });
results.kasserine = { ...round(kp), level: kp.level.extras.tickets };

// A layer with no tickets (a Ctf one): 100 a side, no bleed.
results.none = round(start({ tickets: null, maxPlayers: 8 }));

// A minute of the bleed with every control point the Axis's.
results.bleed = {};
for (const maxPlayers of [8, 32]) {
  const { match } = start({ maxPlayers });
  for (const flag of match.controlPoints) flag.team = 1;
  const before = { ...match.tickets };
  for (let i = 0; i < 60 * 30; i++) match.ticketTick(1 / 30);
  results.bleed[maxPlayers] = { before, after: { ...match.tickets } };
}

// `routeConsole(true)` silenced `console.log` along with the viewer's lines.
process.stdout.write(JSON.stringify(results) + '\n');
