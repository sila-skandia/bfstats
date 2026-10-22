// Drives `viewer/round-end.js` (with `viewer/round-state.js` behind it)
// outside a browser and prints one JSON blob. `tests/test_round_end.py`
// copies the modules in under their own names, so the files under test are
// the files the page loads. There is no DOM here: `createRoundEnd` skips its
// drawing and the flow (open, cue, restart) is what is measured, with the
// list's geometry (ROUND-12) measured on its own.

import { debriefingOf, debriefingWords, createRoundEnd, DEBRIEFING_ENGLISH, DEBRIEFING_LIST,
         bestPlayers, debriefingRowDraws, debriefingVars, medalTexture, rankTexture,
         plateScale } from './round-end.js';
import { createRoundState, VICTORY } from './round-state.js';

const results = {};

// --- what the debriefing shows (ROUND-8) -------------------------------------

results.of = {
  totalWin: debriefingOf({ winner: 2, victoryType: VICTORY.total, localTeam: 2 }),
  totalLoss: debriefingOf({ winner: 2, victoryType: VICTORY.total, localTeam: 1 }),
  majorWin: debriefingOf({ winner: 1, victoryType: VICTORY.major, localTeam: 1 }),
  minorLoss: debriefingOf({ winner: 1, victoryType: VICTORY.minor, localTeam: 2 }),
  draw: debriefingOf({ winner: 0, victoryType: VICTORY.draw, localTeam: 2 }),
  none: debriefingOf({ winner: null, victoryType: VICTORY.none, localTeam: 2 }),
  spectator: debriefingOf({ winner: 2, victoryType: VICTORY.minor, localTeam: 0 }),
};

// Desert Shield's own lines and titles, as `scene.json.briefing` carries them.
const briefing = { debriefing: {
  allied: { majorVictory: 'Coalition won big.', minorVictory: 'Coalition won.',
            majorDefeat: 'Coalition lost big.', minorDefeat: 'Coalition lost.' },
  axis: { majorVictory: 'Opposition won big.', minorVictory: 'Opposition won.',
          majorDefeat: 'Opposition lost big.', minorDefeat: 'Opposition lost.  ' },
  titles: { DEBRIEFING_TOTAL_VICTORY: 'TOTAL VICTORY', DEBRIEFING_HEADING: 'BEST PLAYERS' },
} };
results.words = {
  totalWin: debriefingWords(results.of.totalWin, briefing),
  totalLoss: debriefingWords(results.of.totalLoss, briefing),
  majorWin: debriefingWords(results.of.majorWin, briefing),
  minorLoss: debriefingWords(results.of.minorLoss, briefing),
  draw: debriefingWords(results.of.draw, briefing),
  // A tree baked before the words were exported: the English titles, no line.
  bare: debriefingWords(results.of.majorWin, null),
};
// ObjectiveMode's branch (ROUND-8): the bare titles and the objective lines,
// whatever the victory type; a draw is the common one.
const objectiveBriefing = { debriefing: {
  ...briefing.debriefing,
  objective: { alliedVictory: 'Britain was saved.', alliedDefeat: 'Harwich burned.',
               axisVictory: 'Sealion follows.', axisDefeat: 'Sealion is scrapped.' },
  titles: { VICTORY: 'VICTORY', DEFEAT: 'DEFEAT' },
} };
results.objective = {
  alliedWin: debriefingWords(debriefingOf({ winner: 2, victoryType: VICTORY.total, localTeam: 2, objective: true }),
                             objectiveBriefing),
  axisLoss: debriefingWords(debriefingOf({ winner: 2, victoryType: VICTORY.total, localTeam: 1, objective: true }),
                            objectiveBriefing),
  minorStillBare: debriefingOf({ winner: 1, victoryType: VICTORY.minor, localTeam: 1, objective: true }),
  draw: debriefingOf({ winner: 0, victoryType: VICTORY.draw, localTeam: 1, objective: true }),
  english: debriefingWords(debriefingOf({ winner: 1, victoryType: VICTORY.total, localTeam: 2, objective: true }), null),
};
results.english = DEBRIEFING_ENGLISH;
results.textures = {
  medals: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [4, 2], [1, 0]].map(([r, t]) => medalTexture(r, t)),
  ranks: [1, 2, 3, 4].map(rankTexture),
};

// --- the client's list (FUN_006aa4f0, ROUND-12) ------------------------------

// Wake's end, as the owner's capture shows it: three Japanese bots and a US
// player, the top three by score across both sides.
const wake = [
  { name: 'skandia-bot', team: 2, score: 6, kills: 3, deaths: 1, ping: 40, order: 0 },
  { name: 'Satoshi Minamoto', team: 1, score: 8, kills: 4, deaths: 2, ping: 0, order: 1 },
  { name: 'Satoshi Mamuro', team: 1, score: 6, kills: 3, deaths: 4, ping: 0, order: 2 },
  { name: 'Hiro Tanaka', team: 1, score: 2, kills: 1, deaths: 5, ping: 0, order: 3 },
  { name: 'nobody', team: 0, score: 99, kills: 0, deaths: 0, ping: 0, order: 4 },
];
const best = bestPlayers(wake);
// The layout's list box leaf (`extract_debriefing_layout.py`): the plate at
// (150,100), the box at (-5,-45) in it, row height 76.
const box = { rect: [145, 55, 500, 500], rowHeight: 76 };
results.list = {
  columns: DEBRIEFING_LIST.columns,
  best,
  draws: debriefingRowDraws(box, best),
  none: bestPlayers([]),
  vars: debriefingVars({ AxisTicket: '321', StartingGame: 2, Other: 1 }, {
    title: 'TOTAL VICTORY',
    tickets: { show: true, axis: '0', allied: '48', axisFlag: 'flag_ticket_jp', alliedFlag: 'flag_ticket_us' },
    startingGame: 3,
  }),
  hidden: debriefingVars({}, { title: 'DRAW', tickets: { show: false } }),
  scale: { wide: plateScale(1600, 900), tall: plateScale(400, 800) },
};

// --- the flow: a Conquest round to zero, the screen, the restart -------------

{
  const calls = [];
  let round = createRoundState({ mode: 'Conquest', tickets: { team1: 3, team2: 3 } });
  const page = {
    get round() { return round; },
    extras: { briefing },
    stage: null,
    spriteUrl: rel => `hud/${rel}`,
    localTeam: () => 2,
    // The board's rows, read with the round's own tallies as the board does.
    players: () => [[1, 'Smith', 2], [7, 'Hans', 1], [8, 'Otto', 1]].map(([id, name, team], order) => {
      const c = round.counts.get(id);
      return { name, team, score: c?.score ?? 0, kills: c?.kills ?? 0, deaths: c?.deaths ?? 0, ping: 0, order };
    }),
    tickets: () => ({ show: true, axis: String(round.tickets[1]), allied: String(round.tickets[2]),
                      axisFlag: 'flag_ticket_ger', alliedFlag: 'flag_ticket_us' }),
    playRoundMusic: kind => calls.push(`music:${kind}`),
    stopRoundMusic: () => calls.push('music:stop'),
    releasePointer: () => calls.push('pointer'),
    clearWorld: () => calls.push('clear'),
    restartRound: () => { calls.push('restart'); round.restart(); },
  };
  const screen = createRoundEnd(page);
  const frames = [];
  // Smith kills three Germans; the third death takes their last ticket and
  // the next tick ends the round.
  for (const victim of [7, 8, 7]) round.kill({ killer: 1, killerTeam: 2, victim, victimTeam: 1 });
  screen.tick();
  frames.push({ at: 'before tick', shown: screen.shown });
  round.tick(1 / 30, []);
  screen.tick();
  const opened = screen.state();
  frames.push({ at: 'ended', shown: screen.shown, status: round.status });
  // Ten seconds of EndGame: still up, nothing replayed.
  for (let i = 0; i < 9; i++) { round.tick(1, []); screen.tick(); }
  const nine = { shown: screen.shown, restartIn: round.restartIn, restarts: screen.restarts };
  round.tick(1, []);
  screen.tick();
  results.flow = {
    frames, opened, nine,
    after: { shown: screen.shown, status: round.status, restarts: screen.restarts,
             roundsWon: { ...round.roundsWon }, tickets: { ...round.tickets } },
    calls: calls.slice(),
  };
  // A second round: the screen opens again for it, and a level change (a new
  // round object) closes it without a restart.
  round.spend(1, 3);
  round.tick(1 / 30, []);
  screen.tick();
  const again = screen.shown;
  round = createRoundState({ mode: 'Conquest', tickets: { team1: 3, team2: 3 } });
  screen.tick();
  results.flow.second = { again, closedByNewLevel: !screen.shown, restarts: screen.restarts,
                          calls: calls.slice(results.flow.calls.length) };
}

{
  // A draw plays no cue; a single-player round (restartIn Infinity) waits.
  const calls = [];
  const round = createRoundState({ mode: 'Conquest', tickets: { team1: 1, team2: 1 }, singlePlayer: true });
  const screen = createRoundEnd({
    get round() { return round; }, extras: {}, localTeam: () => 1, players: () => [],
    playRoundMusic: k => calls.push(`music:${k}`),
    stopRoundMusic: () => calls.push('music:stop'), restartRound: () => calls.push('restart'),
  });
  round.spend(1, 1);
  round.spend(2, 1);
  round.tick(1 / 30, []);
  screen.tick();
  for (let i = 0; i < 60; i++) { round.tick(1, []); screen.tick(); }
  results.draw = { state: screen.state(), calls, status: round.status };
}

{
  // A room: the server's `roundEnd` row ends the page's copy of the round
  // (`map.html` `roomRoundEnd`), its rows are the board's (the server's own
  // stats), the timer runs out without a restart of the page's own, and the
  // server's `restart` row (which turns the round back to Playing) closes
  // the screen.
  const calls = [];
  const round = createRoundState({ mode: 'Conquest', tickets: { team1: 3, team2: 3 } });
  const screen = createRoundEnd({
    get round() { return round; }, extras: { briefing }, localTeam: () => 2,
    roomJoined: true,
    players: () => [{ name: 'Remote', team: 2, score: 12, kills: 5, deaths: 1, ping: 63, order: 0 }],
    playRoundMusic: k => calls.push(`music:${k}`), stopRoundMusic: () => calls.push('music:stop'),
    restartRound: () => calls.push('restart'),
  });
  round.endRound(2, null, 'tickets');
  round.restartIn = 10;
  screen.tick();
  const opened = screen.state();
  for (let i = 0; i < 12; i++) { round.tick(1, null); screen.tick(); }
  const waiting = { shown: screen.shown, restarts: screen.restarts };
  round.restart();
  screen.tick();
  results.room = { players: opened.players.map(p => [p.name, p.rank, p.score, p.ping]),
                   startingGame: opened.startingGame, waiting,
                   after: { shown: screen.shown, restarts: screen.restarts }, calls };
}

console.log(JSON.stringify(results));
