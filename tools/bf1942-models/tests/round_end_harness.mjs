// Drives `viewer/round-end.js` (with `viewer/round-state.js` behind it)
// outside a browser and prints one JSON blob. `tests/test_round_end.py`
// copies both modules in under their own names, so the files under test are
// the files the page loads. There is no DOM here: `createRoundEnd` skips its
// drawing and the flow (open, cue, countdown, restart) is what is measured.

import { debriefingOf, debriefingWords, medalSprite, countdownText, createRoundEnd,
         DEBRIEFING_ENGLISH } from './round-end.js';
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
results.sprites = { gold2: medalSprite('gold', 2), bronze1: medalSprite('bronze', 1), silver0: medalSprite('silver', 0) };
results.countdown = { full: countdownText(10), part: countdownText(3.2), done: countdownText(-1),
                      never: countdownText(Infinity) };

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
    nameOf: id => ({ 1: 'Smith', 7: 'Hans', 8: 'Otto' })[id] ?? null,
    roster: () => [{ id: 1, team: 2 }, { id: 7, team: 1 }, { id: 8, team: 1 }],
    holdScoreboard: on => calls.push(`board:${on}`),
    playRoundMusic: kind => calls.push(`music:${kind}`),
    stopRoundMusic: () => calls.push('music:stop'),
    releasePointer: () => calls.push('pointer'),
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
  // Ten seconds of EndGame: still up, counting down, nothing replayed.
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
    get round() { return round; }, extras: {}, localTeam: () => 1, roster: () => [],
    holdScoreboard: on => calls.push(`board:${on}`), playRoundMusic: k => calls.push(`music:${k}`),
    stopRoundMusic: () => calls.push('music:stop'), restartRound: () => calls.push('restart'),
  });
  round.spend(1, 1);
  round.spend(2, 1);
  round.tick(1 / 30, []);
  screen.tick();
  for (let i = 0; i < 60; i++) { round.tick(1, []); screen.tick(); }
  results.draw = { state: screen.state(), calls, status: round.status };
}

console.log(JSON.stringify(results));
