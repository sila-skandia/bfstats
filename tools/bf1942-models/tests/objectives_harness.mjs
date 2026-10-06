// Drives `viewer/objectives.js` and its round in `viewer/round-state.js`
// outside a browser and prints one JSON blob (`tests/test_objectives.py`
// copies both modules in under their own names). The objectives are vanilla
// Battle of Britain's, as `scene.json.modes.ObjectiveMode.objectives`
// carries them, and XPack2 Eagle's Nest's, where the sides are swapped.

import { createObjectives, ATTACKER_TICKETS_MOD, matchTargets } from './objectives.js';
import { createRoundState, VICTORY, GAME_PLAY_MODE } from './round-state.js';

const results = { mod: ATTACKER_TICKETS_MOD };

const BOB = {
  defender: 2, defenderLoseTicketsOnDeath: false, attackerLoseTicketsOnDeath: true,
  roots: { 1: 'AXIS', 2: 'ALLIED' },
  objectives: [
    { spawner: 'ObjectiveSpawner01', kind: 'DestroyTarget', team: 1, delay: 1.0, target: 'Factory01' },
    { spawner: 'ObjectiveSpawner02', kind: 'DestroyTarget', team: 1, delay: 1.0, target: 'RadarTower01' },
    { spawner: 'ObjectiveSpawner03', kind: 'DestroyTarget', team: 1, delay: 1.0, target: 'RadarTower02' },
    { spawner: 'ObjectiveSpawner04', kind: 'DestroyTarget', team: 1, delay: 1.0, target: 'RadarTower03' },
    { spawner: 'ObjectiveSpawner05', kind: 'DestroyTarget', team: 1, delay: 1.0, target: 'RadarTower04' },
    { spawner: 'AXIS', kind: 'ANDComposite', team: 1, delay: 3.0,
      members: ['ObjectiveSpawner01', 'ObjectiveSpawner02', 'ObjectiveSpawner03',
                'ObjectiveSpawner04', 'ObjectiveSpawner05'] },
    { spawner: 'ALLIED', kind: 'Timer', team: 2, delay: 3.0, timeLimit: 900 },
  ],
  targets: [],
};

/** Five standing targets, 1000 HP the factory and 400 each tower. */
function targets() {
  const t = {
    Factory01: { hp: 1000, maxHp: 1000 },
    RadarTower01: { hp: 400, maxHp: 400 }, RadarTower02: { hp: 400, maxHp: 400 },
    RadarTower03: { hp: 400, maxHp: 400 }, RadarTower04: { hp: 400, maxHp: 400 },
  };
  for (const v of Object.values(t)) Object.assign(v, { destroyed: false, attacker: null, attackerTeam: 0 });
  return t;
}

/** A BoB round wired the way the page wires it. */
function bobRound(extra = {}) {
  const world = targets();
  const awards = [];
  let round = null;
  const objectives = createObjectives(BOB, {
    target: name => world[name] ?? null,
    onAward: a => { awards.push(a); round?.objectiveScore(a); },
    onWin: team => round?.objectiveWin(team),
  }, extra);
  round = createRoundState({
    mode: 'ObjectiveMode', tickets: { team1: 100 }, rates: { team1: 0, team2: 0 },
    maxPlayers: 32, objectives, restartDelay: 10,
  });
  const step = seconds => {
    for (let i = 0; i < Math.round(seconds * 30); i += 1) round.tick(1 / 30, []);
  };
  return { world, awards, objectives, round, step };
}

// --- the start: the defender's flat 100, the attacker's scaled count ---------
{
  const { round } = bobRound();
  results.start = { tickets: { ...round.tickets }, real: { ...round.real },
                    gpm: round.gamePlayMode, objective: GAME_PLAY_MODE.objective };
}

// --- the timer: the Allies win 3 s after 900 s, a total victory --------------
{
  const { round, objectives, step } = bobRound();
  step(450);
  const half = { tickets: { ...round.tickets }, status: round.status,
                 completion: objectives.rootCompletion(2) };
  step(450.5);
  const atLimit = { status: round.status, timerDone: objectives.objectiveOf('ALLIED').done,
                    tickets: { ...round.tickets } };
  step(3.1);
  results.timer = { half, atLimit,
                    end: { status: round.status, winner: round.winner, type: round.victoryType,
                           reason: round.endReason, total: VICTORY.total, clock: round.clock,
                           tickets: { ...round.tickets }, roundsWon: { ...round.roundsWon } } };
}

// --- the targets: the Axis win 3 s after the last of the five ---------------
{
  const { world, awards, round, objectives, step } = bobRound();
  step(10);
  world.Factory01.hp = 500;
  step(0.1);
  const damaged = { completion: objectives.rootCompletion(1), tickets: { ...round.tickets } };
  // The factory goes down to an Axis bomber, a tower to an Allied soldier.
  Object.assign(world.Factory01, { hp: 0, destroyed: true, attacker: 7, attackerTeam: 1 });
  Object.assign(world.RadarTower01, { hp: 0, destroyed: true, attacker: 9, attackerTeam: 2 });
  step(0.5);
  const pending = { factoryDone: objectives.objectiveOf('ObjectiveSpawner01').done };
  step(0.6);
  const met = { factoryDone: objectives.objectiveOf('ObjectiveSpawner01').done,
                score7: round.tally(7).score, objectives7: round.tally(7).objectives,
                score9: round.tally(9).score, objectiveTks9: round.tally(9).objectiveTks };
  for (const name of ['RadarTower02', 'RadarTower03', 'RadarTower04']) {
    Object.assign(world[name], { hp: 0, destroyed: true, attacker: 7, attackerTeam: 1 });
  }
  step(1.2);
  const allMet = { status: round.status, composite: objectives.objectiveOf('AXIS').done,
                   alliedTickets: round.tickets[2] };
  step(3.1);
  results.targets = { damaged, pending, met, allMet, awards,
                      end: { status: round.status, winner: round.winner, type: round.victoryType,
                             reason: round.endReason } };
}

// --- deaths: an attacker's cost a ticket, a defender's nothing ---------------
{
  const { round, step } = bobRound();
  round.kill({ killer: 3, killerTeam: 2, victim: 4, victimTeam: 1 });
  round.kill({ killer: 4, killerTeam: 1, victim: 3, victimTeam: 2 });
  step(0.1);
  results.deaths = { tickets: { ...round.tickets }, real: { ...round.real } };
}

// --- a restart: the defender's 100 again, the objectives fresh --------------
{
  const { round, objectives, step } = bobRound();
  step(904);
  const ended = round.status;
  while (!round.restartDue()) round.tick(1 / 30, []);
  round.restart();
  results.restart = { ended, status: round.status, tickets: { ...round.tickets },
                      timer: objectives.objectiveOf('ALLIED').elapsed,
                      done: objectives.list.some(o => o.done), roundsWon: { ...round.roundsWon } };
}

// --- the server's objectiveAttackerTicketsMod stretches the timer -----------
{
  const { round, step } = bobRound({ attackerTicketsMod: 50 });
  step(453.2);
  results.mod50 = { status: round.status, winner: round.winner };
}

// --- a target with no object reads as met on the tickets, never as won ------
{
  const world = {};
  let round = null;
  const objectives = createObjectives(BOB, {
    target: name => world[name] ?? null, onWin: team => round?.objectiveWin(team),
  });
  round = createRoundState({ mode: 'ObjectiveMode', tickets: { team1: 100 }, maxPlayers: 16, objectives });
  for (let i = 0; i < 300; i += 1) round.tick(1 / 30, []);
  results.absent = { tickets: { ...round.tickets }, status: round.status,
                     composite: objectives.objectiveOf('AXIS').done };
}

// --- Conquest on the same level keeps its old rules -------------------------
{
  const objectives = createObjectives(BOB, {});
  const round = createRoundState({ mode: 'Conquest', tickets: { team1: 100, team2: 100 }, objectives });
  round.kill({ killer: 3, killerTeam: 2, victim: 4, victimTeam: 2 });
  results.conquest = { tickets: { ...round.tickets }, real: round.real };
}

// --- Eagle's Nest: the Axis defend on the timer, the Allies blow two doors --
{
  const NEST = {
    defender: 1, roots: { 1: 'AXIS', 2: 'ALLIED' },
    objectives: [
      { spawner: 'ObjectiveSpawner01', kind: 'DestroyTarget', team: 2, delay: 1.0, target: 'Turbine01' },
      { spawner: 'ObjectiveSpawner02', kind: 'DestroyTarget', team: 2, delay: 1.0, target: 'Turbine02' },
      { spawner: 'ALLIED', kind: 'ANDComposite', team: 2, delay: 3.0,
        members: ['ObjectiveSpawner01', 'ObjectiveSpawner02'] },
      { spawner: 'AXIS', kind: 'Timer', team: 1, delay: 3.0, timeLimit: 900 },
    ],
  };
  const world = { Turbine01: { hp: 300, maxHp: 300 }, Turbine02: { hp: 300, maxHp: 300 } };
  let round = null;
  const objectives = createObjectives(NEST, {
    target: name => world[name] ?? null, onWin: team => round?.objectiveWin(team),
  });
  round = createRoundState({ mode: 'ObjectiveMode', tickets: { team2: 100 }, maxPlayers: 16, objectives });
  const start = { ...round.tickets };
  world.Turbine01.hp = 0; world.Turbine01.destroyed = true;
  world.Turbine02.hp = 150;
  for (let i = 0; i < 60; i += 1) round.tick(1 / 30, []);
  const mid = { ...round.tickets };
  world.Turbine02.hp = 0; world.Turbine02.destroyed = true;
  for (let i = 0; i < 180; i += 1) round.tick(1 / 30, []);
  results.nest = { start, mid, status: round.status, winner: round.winner };
}

// --- each target finds the pad the exporter placed for it -------------------
results.match = Object.fromEntries([...matchTargets(
  [{ name: 'Factory01', spawner: 'britain_FactorySpawner', position: [1227.99, 104.742, -1727.94] },
   { name: 'RadarTower01', spawner: 'East_Harwick_RadarTower_Spawner', position: [1427.34, 103.008, -1258.13] },
   { name: 'Lost', spawner: 'Nowhere', position: [0, 0, 0] }],
  [{ id: 'a', spawn: { spawner: 'Britain_FactorySpawner', position: [1227.99, 104.742, -1727.94] } },
   { id: 'b', spawn: { spawner: 'East_Harwick_RadarTower_Spawner', position: [1427.34, 103.008, -1258.13] } },
   { id: 'c', spawn: { spawner: 'East_Harwick_RadarTower_Spawner', position: [1076.47, 103.015, -1278.75] } }],
)].map(([name, record]) => [name, record.id]));

console.log(JSON.stringify(results));
