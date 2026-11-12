// A downed bot waits for the reinforcement wave as every player does
// (SPAWN-35: `killPlayer` 0x0814d920 sets the wait with no AI test, and
// `gameStatusPlaying` stands a dead bot once it is spent, 0x08152917..
// 0x08152987). Two flags, two bots, the referee's `respawnTick` driven on a
// round clock the harness owns.
//
// Run by `tests/test_bot_respawn_wave.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, seedMathRandom, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(path.join(viewer, f));
const { createBotReferee } = await imp('bot-referee.js');
const { World } = await imp('world.js');
const { spawnBots } = await imp('bot.js');
const { Armor } = await imp('armor.js');
routeConsole(true);
seedMathRandom(7);

const cp = (name, position, team, group) => ({
  name, displayName: name, position, rotation: [0, 0, 0], team, radius: 25, areaValue: 40,
  spawnGroupId: group, secondSpawnGroupId: null, objectSpawnerId: null, unableToChangeTeam: true,
  timeToGetControl: 10, timeToLoseControl: 10, disableIfEnemyInsideRadius: false,
  disableWhenLosingControl: false, loseControlWhenEnemyClose: true, loseControlWhenNotClose: false,
  minNrToTakeControl: null, onlyTakeableByTeam: null,
});
const spawn = (name, group, team, position) => ({
  name, group, team, spawnId: 0, paratrooper: false, position, rotation: [0, 0, 0],
});
const extras = {
  worldSize: 1024,
  controlPoints: [cp('Axis_Base', [0, 0, -200], 1, 1), cp('Allied_Base', [0, 0, 200], 2, 2)],
  soldierSpawns: [spawn('A1', 1, 1, [0, 0, -200]), spawn('B1', 2, 2, [0, 0, 200])],
};
const collider = { waterLevel: null, surfaceHeight: () => 0, heightfield: null };
const world = new World({ collider, extras, groundHeight: () => 0 });
const bots = spawnBots({ world, count: 2, teams: [1, 2], flags: world.flags });
const round = { clock: 0 };
const referee = createBotReferee({ world: () => world, armorFor: () => new Armor(30), units: null,
                                   roundClock: () => round.clock });
referee.bots = bots;
for (const bot of bots) world.setPlayerArmor(bot.playerId, new Armor(30));

const DT = 1 / 30;
const bot = bots[0];
const r2 = v => Math.round(v * 100) / 100;
/** The round clock runs on to `until` with the bot alive. */
function idleTo(until) { while (round.clock < until - 1e-9) round.clock += DT; }
/** Run the clock to `until`, ticking the dead bot's timer; the clock when it
 *  stood up, or null. */
function runTo(until) {
  while (round.clock < until - 1e-9) {
    round.clock += DT;
    referee.respawnTick(bot, DT);
    if (!world.armorOf(bot.playerId)?.destroyed) return r2(round.clock);
  }
  return null;
}
/** Kill the bot through the referee's hit path, or behind its back. */
function kill(viaReferee = true) {
  const armor = world.armorOf(bot.playerId);
  const before = armor.hitPoints;
  armor.damage(1e6);
  if (viaReferee) referee.damageLanded(bot.playerId, before, null);
  return { at: r2(round.clock), waitAtDeath: viaReferee ? r2(bot._respawnIn) : null };
}

const out = {};
idleTo(10);
out.at10 = { ...kill(), stood: runTo(40) };                 // window at 25
idleTo(46);
out.at46 = { ...kill(), stood: runTo(80) };                 // 4 s to 50: the window at 75
idleTo(80);
out.unseen = { ...kill(false), stood: runTo(110) };          // found down next tick: window at 100
process.stdout.write(JSON.stringify(out));
