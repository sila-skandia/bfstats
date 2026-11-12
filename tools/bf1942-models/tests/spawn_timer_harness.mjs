// Drives `viewer/spawn-timer.js` outside a browser.
import { timeToSpawn, spawnWait, deployCountdownLine, respawnPlateLabel, spawnReadyAt, waveSecondsLeft,
  DEFAULT_SPAWN_TIME, DEFAULT_SPAWN_DELAY, DEFAULT_SPAWN_WINDOW } from './spawn-timer.js';
import { teamToAddPlayer } from './team-to-add.js';

// The engine defaults: 20 s between waves, a 5 s window, so windows open at
// k * 25 on the round clock (resetTimers opens one at 0).
const P = {};
const out = {};
out.defaults = { time: DEFAULT_SPAWN_TIME, delay: DEFAULT_SPAWN_DELAY, window: DEFAULT_SPAWN_WINDOW };

// Death as a window opens (phase 0): the window's rest (5) plus 20 -> 125.
out.onBoundary = {
  at100: timeToSpawn(100, 100, P),   // 25
  at103: timeToSpawn(103, 100, P),   // 22
};

// Death inside the open window (phase 4): the next window, at 125.
out.midWave = {
  atDeath: timeToSpawn(104, 104, P),     // 21
  justBefore: timeToSpawn(124, 104, P),  // 1
  atBoundary: timeToSpawn(125, 104, P),  // 0
};

// Death in the countdown with more than a window to go (phase 10, 15 s to
// the window): the wait is the countdown itself.
out.countdown = { wait: spawnWait(110, P), atDeath: timeToSpawn(110, 110, P) };  // 15, 15
// Death with no more than a window's length to go (phase 21, 4 s): the
// window after next, 4 + 25.
out.lateDeath = { wait: spawnWait(121, P), atDeath: timeToSpawn(121, 121, P) };  // 29, 29
// Exactly a window's length to go (phase 20, 5 s): not MORE than it, so the
// window after next (`fucom; testb $0x1` is strict).
out.edge = spawnWait(120, P);   // 30

// No waves (serverSpawnTime 0): the flat delay from death.
out.noWaves = {
  atDeath: timeToSpawn(50, 50, { spawnTime: 0, spawnDelay: 5 }),  // 5
  half: timeToSpawn(53, 50, { spawnTime: 0, spawnDelay: 5 }),     // 2
  defaultDelay: timeToSpawn(50, 50, { spawnTime: 0 }),           // 3
  clamped: timeToSpawn(0, 0, { spawnTime: 0, spawnDelay: 500 }),  // 127
};

// Nothing to count.
out.noDeath = timeToSpawn(100, null, P);
out.noClock = timeToSpawn(null, 100, P);

// The deploy line text.
out.line = {
  waiting: deployCountdownLine(98, 90, P).text,      // phase 15, window at 100 -> 2
  due: deployCountdownLine(100, 90, P).text,         // 0 -> prompt
  beforeDeath: deployCountdownLine(100, null, P).text,
};

// A diedAt in the FUTURE (the server clock reset below the seed -- a round
// restart) makes the wait far beyond one cycle; net-room's spawnCountdown
// re-seeds on that regression so it never reaches the screen ("TIME TO
// SPAWN: 2118", live 2026-10-19). With a seed <= now the wait is bounded by
// one cycle plus one window (30 s).
out.clockReset = {
  staleFuture: timeToSpawn(100, 2213, P),
  reseeded: [0, 3, 19.5, 20, 21, 24.9].every(t => timeToSpawn(t, t, P) <= 30),
};

// The plate's label: TIME_TO_START in the pre-game, TIME_TO_SPAWN after.
const lex = { TIME_TO_SPAWN: 'TIME TO SPAWN:', TIME_TO_START: 'TIME UNTIL GAME STARTS:' };
out.label = { pre: respawnPlateLabel(lex, true), play: respawnPlateLabel(lex, false), bare: respawnPlateLabel(null, true) };

// The gate (`waveSecondsLeft`), for every path that stands a body up off a
// retail server. A death at 110 is spent at 125 and may spawn through the
// window to 130; past its close the wait is re-armed to the next, at 150.
const r = spawnReadyAt(110, P);
out.gate = {
  readyAt: r,
  atDeath: waveSecondsLeft(110, r, P),         // 15
  atOpen: waveSecondsLeft(125, r, P),          // 0
  inWindow: waveSecondsLeft(129.9, r, P),      // 0
  afterClose: waveSecondsLeft(131, r, P),      // 19
  nextWindow: waveSecondsLeft(150.5, r, P),    // 0
  // A wait that ends a hair before the window's start (float sums) is
  // still that window's.
  hair: waveSecondsLeft(126, 124.9999999, P),  // 0
  noDeath: waveSecondsLeft(40, null, P),       // 0
  noWaves: [waveSecondsLeft(50, 53, { spawnTime: 0 }), waveSecondsLeft(60, 53, { spawnTime: 0 })], // 3, 0
};

// `getTeamToAddPlayer` (`team-to-add.js`).
const heads = () => 0, tails = () => 0.9;
out.teamToAdd = {
  empty: [teamToAddPlayer(0, 0, 1, 1, heads), teamToAddPlayer(0, 0, 1, 1, tails)],      // 1, 2
  fewer: [teamToAddPlayer(3, 2, 1, 1, heads), teamToAddPlayer(2, 3, 1, 1, tails)],      // 2, 1
  tie: [teamToAddPlayer(4, 4, 1, 1, heads), teamToAddPlayer(4, 4, 1, 1, tails)],        // 1, 2
  // 3:4 with nobody in: team 2's share is larger, so it takes the first.
  ratioFirst: teamToAddPlayer(0, 0, 3, 4, heads),                                      // 2
  // Fifteen bots topped up one by one onto a human on team 1, at 1:1: 8 v 8.
  topUp: (() => { let a = 1, b = 0; for (let i = 0; i < 15; i++) { if (teamToAddPlayer(a, b, 1, 1, heads) === 1) a++; else b++; } return [a, b]; })(),
  // ... and at 3:4 (team 1 the human's): the split the ratio asks.
  topUp34: (() => { let a = 1, b = 0; for (let i = 0; i < 15; i++) { if (teamToAddPlayer(a, b, 3, 4, heads) === 1) a++; else b++; } return [a, b]; })(),
};

console.log(JSON.stringify(out, null, 1));
