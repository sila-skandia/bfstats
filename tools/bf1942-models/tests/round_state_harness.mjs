// Drives `viewer/round-state.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_round_state.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { SCORE_DEFAULTS, BLEED_WEIGHT, scoreTable, scoreSettingsFile, holdWeight,
          createRoundState, TICKET_BASE_PLAYERS, MAX_PLAYERS_LIMIT, clampMaxPlayers,
          roundPlayers, startingTickets, bleedInterval, scaleTickets,
          GAME_PLAY_MODE, gamePlayModeOf, ticketsDecide, VICTORY, victoryTypeOf,
          ticketShare, RESTART_DELAY, clampRestartDelay, SCORE_MSG, ticketsEnd, MEDALS }
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

  // A shut gate refills the countdown (TKT-4). 18 s of Berlin's bleed spends
  // a ticket at 12 s and leaves 6 s owed on the next; the Russians then hold
  // an open point for one frame (the German weight drops to 80) and lose it,
  // and the next ticket comes a whole 12 s after the gate opens again.
  const again = fresh();
  run(again, 18, berlin);
  const owed = again.countdowns[2];
  again.tick(1 / 30, berlin.map(p => (p.name === 'open_left' ? { ...p, team: 2 } : p)));
  const shut = again.countdowns[2];
  run(again, 11, berlin);
  const reopenedEleven = { ...again.tickets };
  run(again, 2, berlin);
  results.bleed.reopened = { owed, shut, atEleven: reopenedEleven, atThirteen: { ...again.tickets } };

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

// --- max players ---------------------------------------------------------------

{
  // Wake co-op as the dedicated server runs it: the root Coop.con's 100 a side,
  // Japan bleeding 15 a minute and the US 10000.
  const wake = { mode: 'CoOp', team1: 100, team2: 100, lossPerMin: { team1: 15, team2: 10000 } };
  const at = (maxPlayers, tickets = wake) => createRoundState({ settings: vanilla, mode: 'CoOp',
    tickets, rates: tickets.lossPerMin, maxPlayers });
  results.maxPlayers = {
    base: TICKET_BASE_PLAYERS,
    limit: MAX_PLAYERS_LIMIT,
    // The parity lab's rounds: 200 / 200 at 32, 50 / 50 at 8.
    lab: { 32: { ...at(32).tickets }, 8: { ...at(8).tickets }, 16: { ...at(16).tickets } },
    // 100 x 11 / 16 = 68.75: the engine's fistp truncates.
    eleven: { ...at(11).tickets },
    // A round that names no server plays the level's numbers as they are.
    unnamed: { ...createRoundState({ tickets: { team1: 100, team2: 140 } }).tickets },
    counts: {
      berlinRoot: startingTickets(60, 32), berlinGameTypes: startingTickets(100, 32),
      tobruk: startingTickets(150, 32), wakeGameTypes: startingTickets(140, 32),
      one: startingTickets(100, 1), none: startingTickets(null, 32), negative: startingTickets(-5, 32),
    },
    clamp: {
      big: clampMaxPlayers(200), zero: clampMaxPlayers(0), junk: clampMaxPlayers('x'),
      fraction: clampMaxPlayers(20.9), text: clampMaxPlayers('32'), fallback: clampMaxPlayers(null, 5),
    },
    // Seconds per ticket: 15/min on a 32-player server is 30/min.
    interval: { 32: bleedInterval(15, 32), 8: bleedInterval(15, 8), none: bleedInterval(0, 32) },
    countdowns: { 32: at(32).countdowns[1], 8: at(8).countdowns[1] },
  };

  // A side bleeds out in the same time on any size of server: the counts and
  // the rate scale together. Berlin's weights make team 2 bleed; give it
  // Wake's 15/min and run 20 minutes.
  const bleedOut = maxPlayers => {
    const round = at(maxPlayers, { team1: 100, team2: 100, lossPerMin: { team1: 0, team2: 15 } });
    let t = 0;
    while (!round.over && t < 3600) { round.tick(1, berlin); t += 1; }
    return { seconds: t, over: round.over, tickets: { ...round.tickets } };
  };
  results.maxPlayers.bleedOut = { 32: bleedOut(32), 16: bleedOut(16), 8: bleedOut(8) };

  // Kasserine Pass co-op: the script's own `game.maxNrofPlayers 18` comes after
  // its bleed lines, so the start uses 18 and the bleed keeps the server's 32.
  const kasserine = { mode: 'CoOp', team1: 100, team2: 100, maxPlayers: 18,
                      lossPerMin: { team1: 15, team2: 15 } };
  const kp = at(32, kasserine);
  results.maxPlayers.kasserine = {
    tickets: { ...kp.tickets }, maxPlayers: kp.maxPlayers, startPlayers: kp.startPlayers,
    countdown: kp.countdowns[1], roundPlayers: roundPlayers(32, kasserine),
    roundPlayersNoScript: roundPlayers(32, wake),
  };

  // What the room server takes: a fresh, scaled copy.
  const room16 = scaleTickets(wake, 16);
  const room32 = scaleTickets(wake, 32);
  results.maxPlayers.room = {
    at16: room16, at32: room32, kasserine16: scaleTickets(kasserine, 16),
    fresh: room16 !== wake && room16.lossPerMin !== wake.lossPerMin,
    untouched: { ...wake, lossPerMin: { ...wake.lossPerMin } },
    none: scaleTickets(null, 32),
  };
}

// --- the end of the round (ledger ROUND-1..ROUND-9) --------------------------

{
  const end = {};
  end.gpm = {
    ctf: gamePlayModeOf('Ctf'), conquest: gamePlayModeOf('Conquest'),
    coop: gamePlayModeOf('CoOp'), singlePlayer: gamePlayModeOf('SinglePlayer'),
    tdm: gamePlayModeOf('TDM'), objective: gamePlayModeOf('ObjectiveMode'),
    unknown: gamePlayModeOf('Search_And_Destroy'), none: gamePlayModeOf(null),
    decides: [1, 2, 3, 4, 5].map(ticketsDecide),
  };
  end.types = {
    total: victoryTypeOf(1, { 1: 0.9, 2: 0 }),
    major: victoryTypeOf(2, { 1: 0, 2: 0.5 }),
    minor: victoryTypeOf(1, { 1: 0.3, 2: 0 }),
    atMinor: victoryTypeOf(1, { 1: 0.4, 2: 0 }),
    atMajor: victoryTypeOf(1, { 1: 0.8, 2: 0 }),
    behind: victoryTypeOf(1, { 1: 0.2, 2: 0.6 }),
    draw: victoryTypeOf(0, { 1: 0.5, 2: 0.5 }),
  };
  end.share = { full: ticketShare(100, 100, 16), odd: ticketShare(68, 100, 11), none: ticketShare(5, 0, 16) };
  end.delay = { base: RESTART_DELAY, low: clampRestartDelay(0), high: clampRestartDelay(99), junk: clampRestartDelay('x') };
  end.msg = SCORE_MSG;

  // Conquest to zero on the bleed: the side still holding tickets wins, the
  // status turns to EndGame, the round counts on its rounds-won line, and the
  // bleed and every score stop.
  const bled = createRoundState({ settings: vanilla, mode: 'Conquest',
    tickets: { team1: 80, team2: 5 }, rates: { team1: 30, team2: 5 } });
  let t = 0;
  while (bled.status === 'playing' && t < 600) { bled.tick(1, berlin); t += 1; }
  const restartAtEnd = bled.restartIn;
  const beforeKill = bled.tally(1).score;
  bled.kill({ killer: 1, killerTeam: 1, victim: 2, victimTeam: 2 });
  const lostAfter = bled.tick(1, berlin);
  end.bled = {
    seconds: t, status: bled.status, over: bled.over, winner: bled.winner,
    victoryType: bled.victoryType, reason: bled.endReason, roundsWon: { ...bled.roundsWon },
    tickets: { ...bled.tickets }, killPaid: bled.tally(1).score - beforeKill,
    deathsAfter: bled.tally(2).deaths, lostAfter, bleeding: { ...bled.bleeding },
    restartIn: restartAtEnd,
  };
  // Ten seconds later a multiplayer server restarts: starting tickets back,
  // tallies wiped, rounds won kept.
  bled.tick(8.5, berlin);
  const dueEarly = bled.restartDue();
  bled.tick(0.5, berlin);
  const due = bled.restartDue();
  bled.restart();
  end.restart = {
    dueEarly, due, status: bled.status, tickets: { ...bled.tickets },
    counts: bled.counts.size, roundsWon: { ...bled.roundsWon }, winner: bled.winner,
    victoryType: bled.victoryType, restarts: bled.restarts, clock: bled.clock,
  };

  // A death that spends the last ticket ends the round at once.
  const death = createRoundState({ mode: 'CoOp', tickets: { team1: 1, team2: 50 } });
  death.suicide({ player: 7, team: 1 });
  const beforeTick = death.status;
  death.tick(1 / 30, berlin);
  end.death = { beforeTick, winner: death.winner, status: death.status, reason: death.endReason,
                type: death.victoryType };

  // Both sides out on one tick is a draw.
  const both = createRoundState({ mode: 'Conquest', tickets: { team1: 1, team2: 1 },
    rates: { team1: 60, team2: 60 } });
  both.tick(1.5, [{ team: 1, areaValue: 150 }, { team: 2, areaValue: 150 }]);
  end.draw = { winner: both.winner, type: both.victoryType, roundsWon: { ...both.roundsWon } };

  // A single-player round waits in EndGame for the debriefing.
  const sp = createRoundState({ mode: 'CoOp', tickets: { team1: 1, team2: 50 }, singlePlayer: true });
  sp.suicide({ player: 3, team: 1 });
  sp.tick(1, berlin);
  sp.tick(600, berlin);
  end.singlePlayer = { restartIn: sp.restartIn, due: sp.restartDue(), status: sp.status };

  // The time limit: the larger ticket share wins in Conquest.
  const timed = createRoundState({ mode: 'Conquest', tickets: { team1: 100, team2: 100 },
    rates: { team1: 30, team2: 5 }, gameTime: 120 });
  timed.spend(1, 60);
  timed.spend(2, 10);
  for (let i = 0; i < 119; i++) timed.tick(1, []);
  const early = timed.status;
  timed.tick(2, []);
  end.time = { early, status: timed.status, winner: timed.winner, reason: timed.endReason,
               type: timed.victoryType };

  // CTF: no bleed, no ticket end; the score limit on flag captures.
  const ctf = createRoundState({ settings: vanilla, mode: 'Ctf', tickets: { team1: 0, team2: 0 },
    rates: { team1: 30, team2: 30 }, scoreLimit: 2 });
  ctf.tick(600, [{ team: 1, areaValue: 150 }]);
  const ctfTicketsOk = ctf.status;
  ctf.flagScore({ player: 4, team: 2, msg: SCORE_MSG.attack });
  ctf.flagScore({ player: 4, team: 2, msg: SCORE_MSG.flagCapture });
  ctf.flagScore({ player: 9, team: 1, msg: SCORE_MSG.defence });
  const afterOne = ctf.status;
  ctf.flagScore({ player: 4, team: 2, msg: SCORE_MSG.flagCapture });
  end.ctf = {
    noTicketEnd: ctfTicketsOk, afterOne, status: ctf.status, winner: ctf.winner,
    type: ctf.victoryType, reason: ctf.endReason,
    teams: { 1: { ...ctf.teams[1] }, 2: { ...ctf.teams[2] } },
    carrier: ctf.tally(4), defender: ctf.tally(9), gpm: ctf.gamePlayMode,
  };
  // CTF with no score limit (the shipped setting) plays on; its time limit
  // weighs the team score.
  const open = createRoundState({ settings: vanilla, mode: 'Ctf', gameTime: 60 });
  for (let i = 0; i < 5; i++) open.flagScore({ player: 1, team: 1, msg: SCORE_MSG.flagCapture });
  const openStatus = open.status;
  open.kill({ killer: 2, killerTeam: 2, victim: 1, victimTeam: 1 });
  open.tick(61, []);
  end.ctfOpen = { openStatus, winner: open.winner, reason: open.endReason, type: open.victoryType };

  // A Conquest point taken pays the table's attack, not its capture.
  const cp = createRoundState({ settings: vanilla, mode: 'Conquest', tickets: { team1: 10, team2: 10 } });
  cp.capture({ player: 1, team: 2 });
  end.cpCapture = { row: cp.tally(1), team: { ...cp.teams[2] } };

  // Tickets end Conquest and Co-op only (ROUND-2): an ObjectiveMode side at
  // zero plays on, and so does CTF, which has no tickets to lose.
  const obj = createRoundState({ mode: 'ObjectiveMode', tickets: { team1: 1, team2: 50 } });
  obj.suicide({ player: 3, team: 1 });
  obj.tick(1 / 30, []);
  end.objective = { tickets: obj.tickets[1], status: obj.status,
                    ends: { ctf: ticketsEnd(1), conquest: ticketsEnd(2), tdm: ticketsEnd(3),
                            coop: ticketsEnd(4), objective: ticketsEnd(5) } };

  // A Wake Conquest round played out to zero by deaths and the bleed: the
  // Allies hold the airfield (weight 100+), the Japanese bleed and die, and
  // the round ends on their last ticket with the medals by score.
  const wakePoints = [{ team: 2, areaValue: 60 }, { team: 2, areaValue: 50 }, { team: 1, areaValue: 30 }];
  const wake = createRoundState({ settings: vanilla, mode: 'Conquest',
    tickets: { team1: 24, team2: 24 }, rates: { team1: 15, team2: 15 } });
  let frames = 0;
  let kills = 0;
  while (wake.status === 'playing' && frames < 30 * 600) {
    if (frames % 90 === 0) {
      // Every three seconds an American kills a Japanese soldier; player 1
      // and 2 take turns, 1 twice as often.
      const killer = (kills % 3 === 2) ? 2 : 1;
      wake.kill({ killer, killerTeam: 2, victim: 100 + kills, victimTeam: 1 });
      kills += 1;
    }
    wake.tick(1 / 30, wakePoints);
    frames += 1;
  }
  end.wake = {
    seconds: Math.round(frames / 30), status: wake.status, winner: wake.winner,
    reason: wake.endReason, victoryType: wake.victoryType, tickets: { ...wake.tickets },
    roundsWon: { ...wake.roundsWon }, restartIn: wake.restartIn, kills,
    medals: wake.medals([{ id: 1, team: 2 }, { id: 2, team: 2 }, { id: 3, team: 2 }]),
    medalOrder: MEDALS,
  };
  results.end = end;
}

// --- the end of a round: a side with no spawn groups (TKT-5, TKT-8) ----------
{
  // DC Weapon Bunkers: Iraq (team 1) holds OppositionCamp (150), the US their
  // base (50); Iraq's only spawn group rides the three bunkers.
  const camp = [{ team: 1, areaValue: 150 }, { team: 2, areaValue: 50 }];
  const bunkers = () => createRoundState({ mode: 'Conquest', tickets: { team1: 100, team2: 150 },
    rates: { team1: 5, team2: 5 } });
  const play = (round, seconds, sides) => {
    let t = 0;
    while (t < seconds && round.status === 'playing') { round.tick(1 / 30, camp, sides); t += 1 / 30; }
    return Math.round(t * 100) / 100;
  };
  const out = {};
  // The bunkers stand: normal play, the US bleed in real time (12 s a ticket).
  {
    const round = bunkers();
    play(round, 60, { 1: { groups: 1, canGet: false, alive: true }, 2: { groups: 1, canGet: false, alive: true } });
    out.standing = { tickets: { ...round.tickets }, flags: round.endOfRound };
  }
  // All three gone: group 99 is empty and group 2 cannot change sides, so Iraq
  // has nowhere to spawn and bleeds out at 1000 a minute, live men or not.
  {
    const round = bunkers();
    const seconds = play(round, 30, { 1: { groups: 0, canGet: false, alive: true }, 2: { groups: 1, canGet: false, alive: true } });
    out.gone = { seconds, status: round.status, winner: round.winner, reason: round.endReason,
                 tickets: { ...round.tickets } };
  }
  // A side with no group but one it could take, and a man alive, is not out:
  // it bleeds only past the enemy's 99 and then at weight / 100. Here the US
  // hold 50, so Iraq loses nothing; the US, with a live man, run at 1.5.
  {
    const round = bunkers();
    play(round, 24, { 1: { groups: 0, canGet: true, alive: true }, 2: { groups: 1, canGet: true, alive: true } });
    out.canTake = { tickets: { ...round.tickets }, bleeding: { ...round.bleeding } };
  }
  // ... until its last man dies: then it bleeds out.
  {
    const round = bunkers();
    const seconds = play(round, 30, { 1: { groups: 0, canGet: true, alive: false }, 2: { groups: 1, canGet: true, alive: true } });
    out.lastMan = { seconds, status: round.status, winner: round.winner, tickets: { ...round.tickets } };
  }
  // Without the census (the runner) the old rule.
  {
    const round = bunkers();
    play(round, 60, null);
    out.noCensus = { tickets: { ...round.tickets } };
  }
  results.endOfRound = out;
}

console.log(JSON.stringify(results));
