// Every fire path's cadence against the engine's rule (ledger GUN-13): a
// FireArms timer is set to its full period by each round, counted down a
// fixed 1/30 s tick at a time in float32, and finishes on the first tick that
// leaves it at or below 0, so a held gun fires every `fireTicks` ticks. The
// lab server's FHSW Greasegun (`roundOfFire 9.17`) fired 30 rounds in 3.865 s
// and 3.864 s, every 4th tick.
//
// Paths driven here, the page's own modules unmodified:
//  * a held gun through the world's tick (`world.js` `#tick` ->
//    `gun-cycle.js` `advanceGroups`), at several frame rates: the human's
//    hand automatic and every vehicle gun take this path;
//  * a bot's held trigger (`bot-referee.js` `fireTick`);
//  * a bot's bayonet stab, delay and cycle as two timers;
//  * the hand's stab machine (`hand-alt-fire.js`), its delay and cycle;
//  * a bot gunner's AI hold (`seat-cone.js`, via `fireTicks`), the replay
//    HUD's readiness bar and the sidecar's counter lag.
// Run by `tests/test_fire_cadence.py`; prints one JSON object.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const timer = await imp('fire-timer.js');
const cycleMod = await imp('gun-cycle.js');
const alt = await imp('hand-alt-fire.js');
const children = await import(pathToFileURL(path.join(viewer, '..', 'sidecar', 'ghost', 'children.mjs')).href);
seedMathRandom(7);
const log = console.log;
console.log = () => {};
console.warn = () => {};

// [label, roundOfFire, magSize]
const GUNS = [
  ['fhsw Greasegun', 9.17, 30],
  ['fh Thompson', 11.67, 30],
  ['vanilla Thompson', 10, 30],
  ['vanilla Mp40', 9, 32],
  ['vanilla JohnsonLMG', 7.5, 20],
  ['vanilla MG42 emplacement', 15, 500],
  ['vanilla Sherman coaxial', 12, 400],
  ['dc M230Cannon', 6, 30],
  ['dc SU-25_BombRack', 3, 20],
  ['vanilla No4', 0.37, 5],
];

const out = { rule: {}, world: {}, bots: {}, stab: {}, handAlt: {}, misc: {} };

// --- the rule ---------------------------------------------------------------
for (const [label, rof] of GUNS) {
  out.rule[label] = { rof, ticks: timer.fireTicks(rof), cycle: timer.fireCycle(rof),
                      period: timer.firePeriod(rof) };
}
out.rule.timerTicks = Object.fromEntries([0, 0.12, 0.3, 0.8, 1.0, 2.0].map(s => [s, timer.timerTicks(s)]));
out.rule.reexported = cycleMod.fireTicks === timer.fireTicks && cycleMod.firePeriod === timer.firePeriod;
out.rule.noRate = timer.fireTicks(0);

// --- a held gun on the world's tick, at several frame rates -------------------
function frameSource(kind) {
  if (kind === 'jitter') {
    // 40..200 fps, a new draw each frame.
    return () => 1 / (40 + Math.random() * 160);
  }
  return () => 1 / kind;
}

function holdOnWorld(rof, magSize, fps, seconds = 12) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  const shots = [];
  let rounds = magSize;
  const group = { emitters: [], stats: { roundOfFire: rof }, firing: false, cooldown: 0,
                  node: null, recoil: null, shots: 0 };
  world.guns = {
    groups: [group],
    advance(dt) { cycleMod.advanceGroups(this, dt); },
    fireShot(g) { g.shots += 1; rounds -= 1; shots.push(world.ticks); },
    roundsLeft: () => rounds,
  };
  const next = frameSource(fps);
  // Pressed on a frame that falls between ticks, as a player's does.
  for (let t = 0; t < seconds;) {
    const dt = next();
    group.firing = t > 0.051;   // the page's `setFiring`, before the step
    world.step(dt);
    t += dt;
  }
  const gaps = shots.slice(1).map((s, i) => s - shots[i]);
  return {
    rounds: shots.length,
    gaps: [...new Set(gaps)],
    spanTicks: shots.length ? shots[shots.length - 1] - shots[0] : null,
    spanSeconds: shots.length ? +((shots[shots.length - 1] - shots[0]) / 30).toFixed(4) : null,
  };
}
for (const [label, rof, mag] of GUNS) {
  out.world[label] = {};
  for (const fps of [30, 60, 144, 'jitter']) {
    const seconds = Math.min(60, (mag + 1) * timer.fireCycle(rof) + 1);
    out.world[label][fps] = holdOnWorld(rof, mag, fps, seconds);
  }
}

// --- a bot's held trigger ---------------------------------------------------
const AI = { burst: 1, maxRange: 150, minRange: 0, weaponFire: 'PIFire',
             strength: { Infantry: 5, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } };
function botWorld() {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.setPlayerArmor('bot_0', new M.Armor(30));
  return world;
}
function botHold(name, rof, size, seconds) {
  const world = botWorld();
  const bot = new M.BotController({ playerId: 'bot_0', world, weapons: [{ ...AI, name }] });
  bot.setWeaponData(name, { roundOfFire: rof, velocity: 700, projectile: 'p',
                            magazine: { size, magazines: 3, type: 0, reloadTime: 3 } });
  const ticks = [];
  let tick = 0;
  const referee = M.createBotReferee({
    world: () => world, armorFor: () => new M.Armor(30), roundDamage: () => 1,
    onShot: () => ticks.push(tick),
  });
  referee.bots.push(bot);
  const dt = 1 / 30;
  for (; tick < seconds * 30; tick++) {
    bot.isFiring = true;
    referee.clock += dt;
    referee.fireTick(dt);
  }
  const first = ticks.slice(0, size);
  const gaps = first.slice(1).map((s, i) => s - first[i]);
  return { rounds: ticks.length, gaps: [...new Set(gaps)], spanTicks: first[first.length - 1] - first[0] };
}
out.bots.greasegun = botHold('Greasegun', 9.17, 30, 6);
out.bots.johnson = botHold('JohnsonLMG', 7.5, 20, 6);
out.bots.thompson = botHold('Thompson', 11.67, 30, 6);

// --- a bot's bayonet stab: the delay, the round, then the cycle ---------------
{
  const world = botWorld();
  const name = 'No4Bayonet';
  const bot = new M.BotController({ playerId: 'bot_0', world,
    weapons: [{ ...AI, burst: 0, maxRange: 1.5, name, weaponFire: 'PIAltFire' }] });
  bot.setWeaponData(name, {
    roundOfFire: 0.37, fireOnce: true, velocity: 1000, projectile: 'no4Projectile',
    magazine: { size: 5, magazines: 5, type: 0, reloadTime: 1.6 },
    alt: { name: 'No4BayonetStabFireArm', roundOfFire: 1.3, fireDelay: 0.12, velocity: 50,
           round: { template: 'BayonetProjectile', timeToLive: 0.0665, material: 257 }, reach: 3.325, barrels: [] },
  });
  const presses = [];
  const rounds = [];
  let tick = 0;
  const referee = M.createBotReferee({
    world: () => world, armorFor: () => new M.Armor(30), roundDamage: () => 1,
    onShot: () => rounds.push(tick), onStab: () => presses.push(tick),
  });
  referee.bots.push(bot);
  // The stab's round is billed through `resolveShot` (its `fireRays`).
  const resolve = referee.resolveShot;
  referee.resolveShot = (...args) => { rounds.push(tick); return resolve(...args); };
  for (; tick < 4 * 30; tick++) {
    bot.isFiring = true;
    referee.clock += 1 / 30;
    referee.fireTick(1 / 30);
  }
  out.stab = {
    presses, rounds,
    delayTicks: rounds.map((r, i) => presses[i] != null ? r - presses[i] : null),
    pressGaps: presses.slice(1).map((p, i) => p - presses[i]),
    expectDelay: timer.timerTicks(0.12), expectCycle: timer.fireTicks(1.3),
  };
}

// --- the hand's stab machine ------------------------------------------------
{
  const group = { shots: 0 };
  const machine = alt.createAlt(group, { roundOfFire: 1.3, throw: { fireDelay: 0.12 } }, 'K98BayonetStabFireArm');
  out.handAlt = { delay: machine.delay, cycle: machine.cycle };
}

// --- the readers -------------------------------------------------------------
{
  // A bot gunner's AI hold: his round's ticks and one over (seat-cone.js).
  out.misc.holdAI = Object.fromEntries([5, 6, 7.5, 12, 15].map(r => [r, timer.fireTicks(r) + 1]));
  // The sidecar dates a round a fire cycle before its counter's step: the
  // vanilla Sherman's cannon (0.35) and coaxial (12), from its fallback specs.
  out.misc.lag = { cannon: children.fireLagFor('Sherman', 0, 0), coaxial: children.fireLagFor('Sherman', 0, 1),
                   cannonCycle: timer.fireCycle(0.35), coaxialCycle: timer.fireCycle(12) };
  // The replay HUD's bar: ready on the tick the gun can fire again.
  out.misc.readyAt = timer.fireCycle(9.17);
}

log(JSON.stringify(out));
