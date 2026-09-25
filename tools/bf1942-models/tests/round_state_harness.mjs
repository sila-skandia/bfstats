// Drives `viewer/round-state.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_round_state.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { SCORE_DEFAULTS, BLEED_WEIGHT, scoreTable, scoreSettingsFile, holdWeight,
          createRoundState }
  from './round-state.js';

const results = {};

// --- the table ---------------------------------------------------------------

const vanilla = {
  files: {
    'ScoreManagerSettings.con': { kill: 1, death: 0, capture: 10, attack: 2, defence: 5, tk: -2 },
    'ScoreManagerSettingsCTF.con': { kill: 1, death: 0, capture: 10, attack: 0, defence: 3, tk: -2 },
    'ScoreManagerSettingsTDM.con': { kill: 1, death: 0, capture: 0, attack: 0, defence: 0, tk: -2 },
  },
};
results.defaults = SCORE_DEFAULTS;
results.bleedWeight = BLEED_WEIGHT;
results.files = { ctf: scoreSettingsFile('Ctf'), none: scoreSettingsFile(''), lower: scoreSettingsFile('ctf') };
results.table = {
  conquest: scoreTable(vanilla, 'Conquest'),
  ctf: scoreTable(vanilla, 'Ctf'),
  tdm: scoreTable(vanilla, 'TDM'),
  // A mode with no file of its own gets the base file, not the defaults.
  objective: scoreTable(vanilla, 'ObjectiveMode'),
  // No pack at all: the constructor's own numbers.
  none: scoreTable(null, 'Conquest'),
  // A mod's file that declares two keys keeps the defaults for the rest.
  partial: scoreTable({ files: { 'ScoreManagerSettings.con': { capture: 25, tk: -7 } } }, 'Conquest'),
  // A mod that spells a key in the con's own case still resolves.
  shouted: scoreTable({ files: { 'ScoreManagerSettings.con': { Capture: '12' } } }, 'Conquest'),
};

// --- the weight --------------------------------------------------------------

const berlin = [
  { name: 'AxisBase', team: 1, areaValue: 50 },
  { name: 'AlliesBase', team: 2, areaValue: 0 },
  { name: 'open_left', team: 1, areaValue: 30 },
  { name: 'open_right', team: 1, areaValue: 30 },
];
const even = [
  { name: 'a', team: 1, areaValue: 25 },
  { name: 'b', team: 2, areaValue: 25 },
  { name: 'c', team: 0, areaValue: 125 },
  { name: 'd', areaValue: 40 },
];
results.weight = { berlin: holdWeight(berlin), even: holdWeight(even), empty: holdWeight(null) };

const fresh = (extra = {}) => createRoundState({
  settings: vanilla, mode: 'Conquest', tickets: { team1: 80, team2: 100 },
  rates: { team1: 30, team2: 5 }, ...extra,
});
/** `seconds` of 30 Hz frames. */
const run = (round, seconds, points) => {
  for (let i = 0; i < Math.round(seconds * 30); i += 1) round.tick(1 / 30, points);
};

// --- a kill, a team kill and a suicide ---------------------------------------

{
  const round = fresh();
  round.kill({ killer: 1, killerTeam: 2, victim: 5, victimTeam: 1 });
  round.kill({ killer: 1, killerTeam: 2, victim: 6, victimTeam: 1 });
  round.kill({ killer: 5, killerTeam: 1, victim: 6, victimTeam: 1 });   // team kill
  round.kill({ killer: 7, killerTeam: 1, victim: 7, victimTeam: 1 });   // his own gun
  round.suicide({ player: 8, team: 2 });
  round.kill({ killer: null, killerTeam: 0, victim: 9, victimTeam: 2 }); // nobody to blame
  results.kill = {
    twoKills: round.tally(1),
    killedTwice: round.tally(6),
    teamKiller: round.tally(5),
    selfKilled: round.tally(7),
    suicide: round.tally(8),
    blameless: round.tally(9),
    tickets: { ...round.tickets },
    counts: round.counts.size,
    // A second call hands back the same tally, not a fresh one.
    stable: round.tally(1) === round.tally(1),
  };
}

// --- a capture ---------------------------------------------------------------

{
  const round = fresh();
  round.capture({ player: 1 });
  round.capture({ player: 2 });
  round.capture({ player: 2 });
  results.capture = { one: round.tally(1), two: round.tally(2), tickets: { ...round.tickets } };
}

// --- the bleed ---------------------------------------------------------------

{
  // Berlin at round start: the Germans hold 110, so the Russians bleed 5/min,
  // one ticket every 12 seconds.
  const round = fresh();
  run(round, 11, berlin);
  const atEleven = { ...round.tickets };
  run(round, 2, berlin);
  results.bleed = {
    held: { ...round.held },
    bleeding: { ...round.bleeding },
    atEleven,
    atThirteen: { ...round.tickets },
    countdown: round.countdowns[2],
  };

  // The gate is the ENEMY's weight: the Russians taking the two open points
  // drops the German weight to 50 and lifts theirs to 60, both under 99, so
  // nobody bleeds.
  const split = berlin.map(p => (p.team === 1 && p.areaValue === 30 ? { ...p, team: 2 } : p));
  run(round, 60, split);
  results.bleed.gateClosed = { tickets: { ...round.tickets }, held: { ...round.held },
                               bleeding: { ...round.bleeding } };

  // And the other side bleeds at its own 30/min once the Russians hold the
  // whole map: one ticket every two seconds.
  const heavy = fresh();
  const allRed = berlin.map(p => ({ ...p, team: 2, areaValue: 60 }));
  run(heavy, 60, allRed);
  results.bleed.axis = { tickets: { ...heavy.tickets }, bleeding: { ...heavy.bleeding } };
}

// --- a long frame, and the floor ---------------------------------------------

{
  const round = fresh();
  const lost = round.tick(60, berlin);   // one whole minute at 5/min
  results.longFrame = { lost, tickets: { ...round.tickets }, countdown: round.countdowns[2] };
  const empty = fresh({ tickets: { team1: 2, team2: 3 } });
  empty.tick(600, berlin);
  results.floor = { tickets: { ...empty.tickets }, over: empty.over, lost: empty.tick(60, berlin) };
}

// --- a level that declares no bleed -----------------------------------------

{
  const round = createRoundState({ settings: vanilla, mode: 'Conquest',
    tickets: { team1: 10, team2: 10 }, rates: null });
  const lost = round.tick(600, berlin);
  results.noRates = { lost, tickets: { ...round.tickets }, bleeding: { ...round.bleeding } };
}

// --- what a death costs, the engine's default and a level's own --------------

{
  const round = fresh({ ticketLosePerDeath: 1 });
  round.suicide({ player: 1, team: 2 });
  const level = fresh({ ticketLosePerDeath: 3 });
  level.suicide({ player: 1, team: 2 });
  results.lossPerDeath = { one: { ...round.tickets }, three: { ...level.tickets } };
}

console.log(JSON.stringify(results));
