// Drives `viewer/spawn-timer.js` outside a browser.
import { timeToSpawn, spawnWait, deployCountdownLine, respawnPlateLabel,
  DEFAULT_SPAWN_TIME, DEFAULT_SPAWN_DELAY, DEFAULT_SPAWN_WINDOW } from './spawn-timer.js';

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

console.log(JSON.stringify(out, null, 1));
