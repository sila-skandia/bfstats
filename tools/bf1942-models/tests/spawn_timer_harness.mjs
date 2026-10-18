// Drives `viewer/spawn-timer.js` outside a browser.
import { timeToSpawn, deployCountdownLine } from './spawn-timer.js';

const P = { spawnTime: 15, spawnDelay: 5 };
const out = {};

// Death on a boundary-aligned eligibility: died at 100, +5 = 105 = 7*15.
out.onBoundary = {
  at100: timeToSpawn(100, 100, P),   // eligible 105, next wave 105 -> 5
  at103: timeToSpawn(103, 100, P),   // -> 2
};

// Death between boundaries: died at 104, +5 = 109, next wave 120.
out.midWave = {
  atDeath: timeToSpawn(104, 104, P),     // 120 - 104 = 16
  justBefore: timeToSpawn(119, 104, P),  // 120 - 119 = 1
  atBoundary: timeToSpawn(120, 104, P),  // 0
};

// No waves (serverSpawnTime 0): the flat delay from death.
out.noWaves = {
  atDeath: timeToSpawn(50, 50, { spawnTime: 0, spawnDelay: 5 }),  // 5
  half: timeToSpawn(53, 50, { spawnTime: 0, spawnDelay: 5 }),     // 2
};

// Nothing to count.
out.noDeath = timeToSpawn(100, null, P);
out.noClock = timeToSpawn(null, 100, P);

// The deploy line text.
out.line = {
  waiting: deployCountdownLine(98, 90, P).text,      // eligible 95, wave 105 -> 7
  due: deployCountdownLine(105, 90, P).text,         // 0 -> prompt
  beforeDeath: deployCountdownLine(100, null, P).text,
};

console.log(JSON.stringify(out, null, 1));
