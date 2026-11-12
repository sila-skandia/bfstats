// A soldier bot's bursts: the trigger on the decision clock (`bot-plans.js
// soldierTriggerOpen`, `bot-fire.js triggerWindow`) over the referee's own
// fire timer and magazine (`bot-referee.js fireTick`). Each row holds the
// trigger statement for 60 s with the aim always on, and logs the tick of
// every round. Run by `tests/test_bot_burst.py`; one JSON object.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { soldierTriggerOpen } = await imp('bot-plans.js');
const { fireRoundBudget, FIRE } = await imp('bot-fire.js');
seedMathRandom(7);
const log = console.log;
console.log = () => {};

const STRENGTH = { Infantry: 5, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 };
// [name, burst, roundOfFire, magSize, magazines, reloadTime]: vanilla's
// `extras.weapon` and `aiWeapons` (Thompson 10, Type99 and Bar1918 at 4
// ticks a round, K98 0.37).
const WEAPONS = [
  ['Thompson', 1, 10.0, 30, 5, 4.8],
  ['Type99', 1, 8.0, 20, 6, 4.0],
  ['K98', 0, 0.37, 5, 5, 1.6],
];

function run([name, burst, roundOfFire, size, magazines, reloadTime], seconds = 60) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.setPlayerArmor('bot_0', new M.Armor(30));
  const ai = { burst, maxRange: 150, minRange: 0, weaponFire: 'PIFire', strength: STRENGTH, name };
  const bot = new M.BotController({ playerId: 'bot_0', world, weapons: [ai] });
  bot.setWeaponData(name, { roundOfFire, velocity: 700, projectile: 'p',
                            magazine: { size, magazines, type: 0, reloadTime } });
  const shots = [];
  let tick = 0;
  const referee = M.createBotReferee({
    world: () => world, armorFor: () => new M.Armor(30), roundDamage: () => 1,
    onShot: () => shots.push({ tick, reload: (bot._mags.get(name)?.rounds ?? 0) <= 0 }),
  });
  referee.bots.push(bot);
  bot._shotsThisPlan = 0;
  const action = { type: burst ? 'TriggerContinously' : 'Trigger' };
  const dt = 1 / 30;
  for (tick = 0; tick < seconds * 30; tick++) {
    bot._aiTicks = tick;   // bot.js `tick` counts it
    bot.isFiring = soldierTriggerOpen(bot, action);
    referee.clock += dt;
    referee.fireTick(dt);
  }
  // A burst is the rounds of one decision period.
  const phase = bot._decisionPhase;
  const periodOf = t => Math.floor((t + phase) / FIRE.decisionTicks);
  const bursts = [];
  for (const s of shots) {
    const p = periodOf(s.tick);
    if (bursts.length && bursts.at(-1).period === p) bursts.at(-1).ticks.push(s.tick);
    else bursts.push({ period: p, ticks: [s.tick] });
  }
  const inside = [], between = [], starts = [];
  bursts.forEach((b, i) => {
    for (let k = 1; k < b.ticks.length; k++) inside.push(b.ticks[k] - b.ticks[k - 1]);
    if (i > 0) {
      between.push(b.ticks[0] - bursts[i - 1].ticks.at(-1));
      starts.push(b.ticks[0] - bursts[i - 1].ticks[0]);
    }
  });
  const hist = {};
  for (const b of bursts) hist[b.ticks.length] = (hist[b.ticks.length] ?? 0) + 1;
  // The first tick of each period the trigger was down on, relative to the period.
  const offsets = [...new Set(bursts.map(b => (b.ticks[0] + phase) % FIRE.decisionTicks))].sort((a, b) => a - b);
  return { name, burst, roundOfFire, rounds: shots.length, bursts: bursts.length, hist, offsets,
           inside: [...new Set(inside)].sort((a, b) => a - b),
           between: Object.fromEntries([...new Set(between)].sort((a, b) => a - b)
             .map(g => [g, between.filter(x => x === g).length])),
           starts: Object.fromEntries([...new Set(starts)].sort((a, b) => a - b)
             .map(g => [g, starts.filter(x => x === g).length])) };
}

// The budget law over a grid of draws, and its ends.
const grid = n => Array.from({ length: n }, (_, i) => i / n);
const budgets = {
  burst10: [...new Set(grid(900).map(u => fireRoundBudget(true, 150, u)))],
  burstUnlimited: [...new Set(grid(900).map(u => fireRoundBudget(true, -1, u)))],
  burst3: [...new Set(grid(900).map(u => fireRoundBudget(true, 3, u)))],
  single: [...new Set(grid(900).map(u => fireRoundBudget(false, 5, u)))],
  burstTop: fireRoundBudget(true, 150, 1), singleTop: fireRoundBudget(false, 5, 1),
  burstOneShare: grid(900).filter(u => fireRoundBudget(true, 150, u) === 1).length / 900,
};

log(JSON.stringify({ rows: WEAPONS.map(w => run(w)), budgets,
                     clock: { decisionTicks: FIRE.decisionTicks, triggerDelayTicks: FIRE.triggerDelayTicks } }));
