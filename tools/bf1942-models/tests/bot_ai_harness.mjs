// Drives `viewer/world.js` + `viewer/bot.js` headless to pin the Stage 1 bot AI
// input contract: a bot writes the named action word plus a mouse axis pair
// through `World.setInput`, the world applies the look on its own 30 Hz tick,
// and the bot then turns to face what it senses (Fire) or walks to its nearest
// uncaptured flag (MoveTo).
//
// Run by `tests/test_bot_ai.py`, which stages the module set the way
// `test_world.py` does. Output is one JSON object on stdout.

import { World, WORLD_TICK_DT } from './world.mjs';
import { BotController } from './bot.js';

const collider = {
  waterLevel: null,
  surfaceHeight() { return 0; },
  heightfield: null,
};

const EXTRAS = {
  worldSize: 600,
  controlPoints: [
    { name: 'Home', spawnGroupId: 1, team: 2, position: [0, 0, 0] },
    { name: 'Enemy', spawnGroupId: 2, team: 1, position: [0, 0, 120] },
  ],
  soldierSpawns: [
    { name: 'H1', group: 1, team: 2, position: [0, 0, 0], rotation: [0, 0, 0] },
    { name: 'E1', group: 2, team: 1, position: [0, 0, 120], rotation: [0, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function makeWorld() {
  return new World({ collider, extras: EXTRAS });
}

/** Fire: an enemy human stands off-axis but inside the frustum; the bot turns
 *  to it. The human is on the OTHER side — a bot never fires on its own team,
 *  local player included. */
function aimScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  // A human target at +x, +z — 14 degrees off the bot's +z facing.
  const local = world.addPlayer('local', { team: 1, flag: world.flags[1] });
  local.soldier.spawn(5, 0, 20, 0);

  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;
  bot.yaw = 0;

  const want = Math.atan2(5, 20);
  const yaws = [];
  let lookYaw = 0;
  let sawTarget = false;
  for (let i = 0; i < 40; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    const s = world.player('bot_0').soldier;
    yaws.push(s.yaw);
    lookYaw += world.report?.players?.bot_0?.look?.yaw ?? 0;
    if (bot.firingTarget === 'local') sawTarget = true;
  }
  const s = world.player('bot_0').soldier;
  return {
    sawTarget,
    want,
    initialError: Math.abs(wrap(want - 0)),
    finalError: Math.abs(wrap(want - s.yaw)),
    finalYaw: s.yaw,
    lookYaw,
    turned: Math.abs(s.yaw) > 1e-3,
    yaws,
  };
}

/** MoveTo: no target in view; the bot walks to the nearest enemy flag. */
function moveToScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;
  bot.yaw = 0;

  const start = [...bot.getPosition()];
  const forwards = [];
  let behaviour = null;
  for (let i = 0; i < 60; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    forwards.push(bot.moveForward);
    behaviour = bot.currentBehaviour;
  }
  const end = world.player('bot_0').soldier;
  return {
    behaviour,
    startZ: start[2],
    endZ: end.z,
    travelled: end.z - start[2],
    movedForward: forwards.filter(f => f > 0).length,
  };
}

/** A wall straight ahead (z = 1.5, x in [-8, 8]) with a gap off to the right,
 *  the sandbag-line case. Only the forward probe reaches it. */
function obstacleCollider() {
  return {
    waterLevel: null,
    surfaceHeight() { return 0; },
    heightfield: null,
    statics: {
      cast(ox, oy, oz, dx, dy, dz, maxDist, owner, rec) {
        if (!(dz > 1e-6)) return null;
        const t = (1.5 - oz) / dz;
        if (t < 0 || t > maxDist) return null;
        const hitX = ox + dx * t;
        if (hitX > 8) return null;            // the gap
        rec.t = t; rec.x = hitX; rec.y = oy; rec.z = 1.5;
        rec.nx = 0; rec.ny = 0; rec.nz = -1;
        rec.material = 1; rec.kind = 'static'; rec.owner = -1;
        return rec;
      },
    },
  };
}

/** Avoid: a static dead ahead makes the heading fan to a clear side. */
function avoidScenario() {
  const world = new World({ collider: obstacleCollider(), extras: EXTRAS });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;
  bot.yaw = 0;
  const clear = bot._clearAhead(0);
  const side = bot._chooseAvoidSide(0);
  return { clearAhead: clear, side, steered: side !== 0 };
}

/**
 * Friendly fire: the human stands exactly where `aimScenario` puts him, but on
 * the bot's own side. The bot must never sense or fire on him — the regression
 * that killed the player the moment he spawned, because every bot was on his
 * team and `sense()` exempted `'local'` from the friendly test.
 */
function friendlyScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const local = world.addPlayer('local', { team: 2, flag: world.flags[0] });
  local.soldier.spawn(5, 0, 20, 0);

  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;
  bot.yaw = 0;

  let sawTarget = false;
  let fired = false;
  for (let i = 0; i < 40; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    if (bot.firingTarget === 'local') sawTarget = true;
    if (bot.isFiring) fired = true;
  }
  // The same sensing call, asked directly, so the assertion does not rest on
  // the contest alone.
  const sensed = bot.sense(2).targetId;
  return { sawTarget, fired, sensed };
}

/** The bare input contract: a bot's written look reaches the soldier. */
function lookScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  // A known facing for the assertion: spawn yaw is the flag's own.
  const bs = world.player('bot_0').soldier;
  bs.spawn(bs.x, bs.y, bs.z, 0);
  // Aim 90 degrees to the right; one tick can turn 48 degrees.
  bot._aimLook(Math.PI / 2, 0);
  const look = { x: bot.lookX, y: bot.lookY };
  bot._writeInput();
  const applied = world.report?.players?.bot_0?.look ?? null;
  world.step(WORLD_TICK_DT);
  const yaw = world.player('bot_0').soldier.yaw;
  return { lookX: look.x, lookY: look.y, yawAfter: yaw, turned: Math.abs(yaw) > 1e-3 };
}

const results = {
  tickDt: WORLD_TICK_DT,
  aim: aimScenario(),
  friendly: friendlyScenario(),
  moveTo: moveToScenario(),
  avoid: avoidScenario(),
  look: lookScenario(),
};

process.stdout.write(JSON.stringify(results));