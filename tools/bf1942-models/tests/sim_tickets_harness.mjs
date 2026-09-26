// The runner's round tickets (`sim/match.mjs` over `viewer/round-state.js`):
// matches set up on the synthetic level, some with another level's tickets or
// control points in place of its own, and the round's bleed over the match's
// points. Prints one JSON blob for `tests/test_sim_tickets.py`.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sim');
const imp = f => import(pathToFileURL(path.join(SIM, f)).href);
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await imp('env.mjs');
const { syntheticLevel } = await imp('level.mjs');
const { Match } = await imp('match.mjs');

const M = await loadViewerModules(viewerDir());
routeConsole(true);

/** A match on the synthetic level (100 a side, 5 a minute; its open points
 *  weigh 50 and its bases nothing), set up and not stepped. `tickets`, when
 *  given, replaces the level's own; `points` rewrites its control points. */
function start({ tickets, points = null, maxPlayers = null, botsPerSide = 2, duration = 60 } = {}) {
  seedMathRandom(1);
  const level = syntheticLevel(M, { vehicles: false });
  if (tickets !== undefined) level.extras.tickets = tickets;
  if (points) level.extras.controlPoints = points(level.extras.controlPoints);
  const match = new Match({ M, level, botsPerSide, duration, seed: 1, maxPlayers });
  match.setup();
  return { match, level };
}

const round = ({ match }) => ({
  maxPlayers: match.maxPlayers, startPlayers: match.startPlayers,
  tickets: { ...match.tickets }, lossPerMin: { ...match.lossPerMin },
});

/** The round's bleed over the match's own points, `ticks` 30 Hz frames: the
 *  runner's per-tick call with nothing else stepped. */
const bleed = (match, ticks) => {
  for (let i = 0; i < ticks; i++) match.round.tick(1 / 30, match.roundPoints);
};
const held = match => {
  const out = { 0: 0, 1: 0, 2: 0 };
  for (const p of match.roundPoints) out[p.team === 1 || p.team === 2 ? p.team : 0]++;
  return out;
};

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

// Every control point the Axis's, 150 of weight: the Allies bleed a whole
// ticket every 60 / (5 x maxPlayers / 16) s. Read 61 s in (clear of the 60 s
// boundary), then run until they are out.
results.bleed = {};
for (const maxPlayers of [8, 32]) {
  const { match } = start({ maxPlayers });
  for (const flag of match.controlPoints) flag.team = 1;
  const before = { ...match.tickets };
  bleed(match, 61 * 30);
  const minute = { ...match.tickets };
  let ticks = 61 * 30;
  while (!match.round.over && ticks < 3600 * 30) { bleed(match, 1); ticks++; }
  results.bleed[maxPlayers] = { before, minute, out: ticks / 30, over: match.round.over,
                                after: { ...match.tickets }, weight: { ...match.round.held } };
}

// Battle of Britain: the Allies' `Allied_Base` owns no spawns, so the world
// makes no flag of it (`spawn-flags.js`), and weighs 150. On the synthetic
// level with Battle of Britain's tickets (4 and 1000 a minute) the Allies hold
// three of the six points, half and no more, and 200 of weight, so the Axis
// bleeds from the first frame: a ticket every 15 s on the 16 slots its
// numbers are written for. A stepped match with no bots: nothing but the
// bleed spends.
const britain = { mode: 'Conquest', team1: 100, team2: 100, lossPerMin: { team1: 4, team2: 1000 } };
const alliedBase = {
  name: 'Allied_Base', displayName: 'Allied_Base', position: [100, 0, -10], rotation: [0, 0, 0], team: 2,
  radius: 10, areaValue: 150, spawnGroupId: 30, secondSpawnGroupId: null, unableToChangeTeam: true,
  timeToGetControl: 9999,
};
{
  const { match } = start({ tickets: britain, points: cps => [...cps, alliedBase], botsPerSide: 0,
                            maxPlayers: 16, duration: 120 });
  const before = { ...match.tickets };
  match.step();
  const firstTick = { weight: { ...match.round.held }, bleeding: { ...match.round.bleeding } };
  while (match.clock + 1e-9 < 61 && match.step()) { /* the runner's own tick, to 61 s */ }
  results.britain = {
    before, firstTick, after: { ...match.tickets }, clock: Math.round(match.clock),
    points: match.roundPoints.length, flags: match.controlPoints.length, held: held(match),
    // The trace's samples either side of the first ticket, at 15 s.
    samples: match.samples.filter(s => s.t === 14 || s.t === 16).map(s => [s.t, s.tickets[1], s.tickets[2]]),
  };
}

// Wake: five points of 20, all the US's, 100 of weight, so Japan bleeds its
// co-op 15 a minute: a ticket every 2 s on 32 slots, the lab's measurement
// (ledger TKT-4). Japan taking one point leaves the US four of the five, more
// than half, and 80 of weight: the bleed stops.
{
  const wake = { mode: 'CoOp', team1: 100, team2: 100, lossPerMin: { team1: 15, team2: 10000 } };
  const { match } = start({ tickets: wake, maxPlayers: 32, points: cps => cps.map(p => ({ ...p, areaValue: 20 })) });
  for (const flag of match.controlPoints) flag.team = 2;
  bleed(match, 11 * 30);
  const allUs = { tickets: { ...match.tickets }, weight: { ...match.round.held }, held: held(match) };
  match.controlPoints.find(f => f.controlPointName === 'Home').team = 1;
  bleed(match, 30 * 30);
  results.wake = { allUs, oneTaken: { tickets: { ...match.tickets }, weight: { ...match.round.held },
                                      held: held(match), bleeding: { ...match.round.bleeding } } };
}

// `routeConsole(true)` silenced `console.log` along with the viewer's lines.
process.stdout.write(JSON.stringify(results) + '\n');
