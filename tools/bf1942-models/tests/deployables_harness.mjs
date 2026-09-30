// Runs viewer/deployables.js under node and prints what the Python test
// asserts (tests/test_deployables.py copies the modules beside this file).
import {
  AbandonClock, LIFE_STEP, PAD_RADIUS, SPAWN_CLEARANCE, SpawnerPad, calcSpawnDelay,
  launchBomb, needsClearance, spawnClear, spawnPoint, stepBomb,
} from './deployables.mjs';

const round = v => Math.round(v * 1000) / 1000;
const level = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] };
const spawner = { position: [0, 0.2, 0], spawnOffset: [0, 0.17, 0] };

// The thrower stands with his origin at y 1 (feet on y 0), eye 0.65 above.
const origin = [0, 1, 0];
const eye = [0, 1.65, 0];
function firstClear(weapon, frame = level) {
  const bomb = launchBomb({ eye, frame, weapon });
  const ground = () => 0;
  for (let tick = 0; tick <= 40; tick++) {
    if (bomb.dead) return { tick: null, rest: bomb.resting, pos: bomb.pos.map(round) };
    const at = spawnPoint(bomb, spawner.spawnOffset);
    if (spawnClear(at, [origin])) return { tick, at: at.map(round), rest: bomb.resting };
    stepBomb(bomb, 1 / 30, { ground });
  }
  return { tick: null };
}
const dcFinal = { projectilePosition: [0, 1, 0], velocity: 2, spawner,
                  bomb: { timeToLive: 1, mobile: true } };
const dc = { projectilePosition: [0, 0, 0], velocity: 2, spawner,
             bomb: { timeToLive: 1, mobile: true } };
const down45 = { right: [1, 0, 0], up: [0, Math.SQRT1_2, Math.SQRT1_2],
                 forward: [0, -Math.SQRT1_2, Math.SQRT1_2] };

const bombTrail = (() => {
  const bomb = launchBomb({ eye: [0, 5, 0], frame: level, weapon: dc });
  const out = [];
  for (let i = 0; i < 40 && !bomb.dead; i++) {
    stepBomb(bomb, 1 / 30, { ground: () => 1, waterLevel: null });
    out.push(round(bomb.pos[1]));
  }
  return { last: out.at(-1), rest: bomb.resting, dead: bomb.dead, age: round(bomb.age) };
})();
const drowned = (() => {
  const bomb = launchBomb({ eye: [0, 1, 0], frame: level, weapon: dc });
  stepBomb(bomb, 0.2, { ground: () => -20, waterLevel: 0.5 });
  return bomb.dead;
})();

// The abandoned mortar: 40 s of countdown, then 0.5 HP a 0.5 s step (the
// spawner gone), reset by a man in the seat or a soldier at its side.
const life = (() => {
  const clock = new AbandonClock({ timeToLive: 40, distance: 20, damageWhenLost: 2 });
  let t = 0, first = null, hp = 10, deadAt = null;
  const lost = [];
  while (t < 60) {
    t = round(t + 1 / 30);
    const d = clock.step(1 / 30, { spawnerAlive: false });
    if (d > 0 && first == null) first = t;
    if (d > 0) lost.push(round(d));
    hp -= d;
    if (hp <= 0 && deadAt == null) deadAt = t;
  }
  const occupied = new AbandonClock({ timeToLive: 40 });
  for (let i = 0; i < 30 * 30; i++) occupied.step(1 / 30, { spawnerAlive: false });
  const beforeReset = round(occupied.countdown);
  occupied.step(0.5, { spawnerAlive: false, occupied: true });
  const near = new AbandonClock({ timeToLive: 40, distance: 20, damageWhenLost: 2 });
  for (let i = 0; i < 100; i++) near.step(0.5, { spawnerAlive: true, spawnerDistance: 5 });
  const withSpawner = new AbandonClock({ timeToLive: 1, distance: 20, damageWhenLost: 2 });
  const billed = [];
  for (let i = 0; i < 4; i++) billed.push(withSpawner.step(0.5, { spawnerAlive: true, spawnerDistance: 25 }));
  return { first, step: lost[0], deadAt, beforeReset, afterReset: occupied.countdown,
           nearSpawner: near.countdown, billedWithSpawner: billed };
})();

// A kit pad: spawns on its first frame, holds while the kit lives anywhere,
// counts 25 s from the kit's end, and spawns nothing for a team it has no
// entry for.
const pad = (() => {
  const objects = new Map();
  let next = 1;
  const world = {
    alive: id => objects.has(id),
    distance: id => objects.get(id)?.d ?? 0,
    critical: () => false,
    spawn: template => { const id = next++; objects.set(id, { template, d: 0 }); return id; },
  };
  const p = new SpawnerPad({ templates: { 1: 'US_Sniper_hvy', 2: 'US_Sniper_hvy' },
                             team: 2, minSpawnDelay: 25, maxSpawnDelay: 25 });
  p.reset();
  const first = p.tick(1 / 30, world);
  const firstTemplate = objects.get(first)?.template;
  // Carried away 300 m and still alive: nothing new.
  objects.get(first).d = 300;
  let extra = 0;
  for (let i = 0; i < 30 * 60; i++) if (p.tick(1 / 30, world) != null) extra++;
  // The kit's end: destroyed 30 s after it was dropped.
  objects.delete(first);
  let t = 0, respawnAt = null;
  while (t < 40 && respawnAt == null) {
    t += 1 / 30;
    if (p.tick(1 / 30, world) != null) respawnAt = round(t);
  }
  // Off (the flag went neutral), then on again: a running delay is drawn anew.
  const q = new SpawnerPad({ templates: { 2: 'US_AA' }, team: 0, minSpawnDelay: 25, maxSpawnDelay: 25 });
  q.reset();
  const teamless = q.tick(1 / 30, world);
  q.enable(1);
  const wrongTeam = q.tick(1 / 30, world);
  q.enable(2);
  const rightTeam = q.tick(1 / 30, world);
  q.disable(0);
  objects.delete(rightTeam);
  let whileOff = 0;
  for (let i = 0; i < 30 * 60; i++) if (q.tick(1 / 30, world) != null) whileOff++;
  return { first: first != null, firstTemplate, extra, respawnAt, teamless, wrongTeam,
           rightTeam: rightTeam != null, whileOff, delayAfterOff: q.delay };
})();

console.log(JSON.stringify({
  constants: { SPAWN_CLEARANCE, LIFE_STEP, PAD_RADIUS },
  clear: {
    dcFinalLevel: firstClear(dcFinal),
    dcLevel: firstClear(dc),
    dcFinalDown: firstClear(dcFinal, down45),
  },
  bombTrail, drowned,
  needsClearance: [needsClearance('VCLand'), needsClearance('VCSea'),
                   needsClearance('VCAir'), needsClearance(2, 0x24)],
  delays: [calcSpawnDelay(30, 60, 0, 16), calcSpawnDelay(30, 60, 16, 16),
           calcSpawnDelay(30, 60, 8, 16), calcSpawnDelay(25, 25, 3, 16)],
  life, pad,
}));
