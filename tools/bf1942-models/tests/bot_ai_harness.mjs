// Drives `viewer/world.js` + `viewer/bot.js` + `viewer/nav-grid.js` headless to
// pin the bot AI contract: a bot writes the named action word plus a mouse
// axis pair through `World.setInput`, the world applies the look on its own
// 30 Hz tick, and the bot then turns to face what it senses (Fire) or walks
// its route to the nearest uncaptured flag (MoveTo) — around a sandbag wall
// the navigation map can see, throttling only inside the engine's 31.5 deg
// steering cone.
//
// Run by `tests/test_bot_ai.py`, which stages the module set the way
// `test_world.py` does. Output is one JSON object on stdout.

import { World, WORLD_TICK_DT } from './world.mjs';
import { BotController } from './bot.js';
import { buildNavMap, gridAt, traceClear, CELL_OBJECT } from './nav-grid.js';

// The level sits in the map's own frame: x in [0, worldSize], z in
// [-worldSize, 0] (the exporter negates z). Home at (100, -100), the enemy
// flag 120 m further along -z.
const WORLD = 256;
const HOME = [100, 0, -100];
const ENEMY = [100, 0, -220];

const collider = {
  waterLevel: null,
  surfaceHeight() { return 0; },
  heightfield: null,
};

const EXTRAS = {
  worldSize: WORLD,
  controlPoints: [
    { name: 'Home', spawnGroupId: 1, team: 2, position: HOME },
    { name: 'Enemy', spawnGroupId: 2, team: 1, position: ENEMY },
  ],
  soldierSpawns: [
    { name: 'H1', group: 1, team: 2, position: HOME, rotation: [0, 0, 0] },
    { name: 'E1', group: 2, team: 1, position: ENEMY, rotation: [0, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function makeWorld(c = collider) {
  return new World({ collider: c, extras: EXTRAS });
}

/** Fire: an enemy human stands off-axis but inside the frustum; the bot turns
 *  to it. The human is on the OTHER side — a bot never fires on its own team,
 *  local player included. */
function aimScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  // A spawn authored at rotation 0 faces -z (`spawnYaw` is `PI - degrees`).
  // A human target at +x, -z: 14 degrees off the bot's facing.
  const local = world.addPlayer('local', { team: 1, flag: world.flags[1] });
  local.soldier.spawn(HOME[0] + 5, 0, HOME[2] - 20, 0);

  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;

  const want = Math.atan2(5, -20);
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
    initialError: Math.abs(wrap(want - Math.PI)),
    finalError: Math.abs(wrap(want - s.yaw)),
    finalYaw: s.yaw,
    lookYaw,
    turned: Math.abs(wrap(s.yaw - Math.PI)) > 1e-3,
    yaws,
  };
}

/** MoveTo: no target in view, no map; the bot walks straight at the nearest
 *  enemy flag. */
function moveToScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;

  const start = [...bot.getPosition()];
  const forwards = [];
  let behaviour = null;
  for (let i = 0; i < 90; i++) {
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
    travelled: start[2] - end.z,          // the enemy flag is at -z
    movedForward: forwards.filter(f => f > 0).length,
  };
}

/** An axis-aligned box as twelve triangles, for the nav map's statics. */
function box(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const out = [];
  for (const [a, b, c, d] of q) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
}

/** A sandbag line 1 m tall across the bot's way (z = -110, x in [80, 120]),
 *  and a 0.3 m kerb the map must ignore (below the 0.4 m clip). The wall is
 *  also solid to the world through `statics.cast`, so the body cannot pass
 *  through it. */
function wallCollider() {
  const tris = new Float32Array([
    ...box(80, 120, 0, 1.0, -110.3, -109.7),
    ...box(90, 92, 0, 0.3, -104, -103),
  ]);
  const owners = new Int32Array(tris.length / 9);
  owners.fill(1, 12);
  return {
    waterLevel: null,
    surfaceHeight() { return 0; },
    heightfield: null,
    statics: {
      tris, count: tris.length / 9, drivable: null, owners,
      cast(ox, oy, oz, dx, dy, dz, maxDist, owner, rec) {
        if (!(dz < -1e-6)) return null;
        const t = (-109.7 - oz) / dz;
        if (t < 0 || t > maxDist) return null;
        const hitX = ox + dx * t;
        if (hitX < 80 || hitX > 120) return null;
        if (oy > 1.0) return null;
        rec.t = t; rec.x = hitX; rec.y = oy; rec.z = -109.7;
        rec.nx = 0; rec.ny = 0; rec.nz = 1;
        rec.material = 1; rec.kind = 'static'; rec.owner = -1;
        return rec;
      },
    },
  };
}

/** Avoid: the map sees the wall; the route goes around its end and the bot
 *  crosses the wall's line outside its span. */
function avoidScenario() {
  const c = wallCollider();
  const nav = buildNavMap(c, WORLD, { seeds: [[HOME[0], HOME[2]]] });
  const world = new World({ collider: c, extras: EXTRAS });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = nav;

  let crossX = null;
  let minDistToGoal = Infinity;
  let routePoints = 0;
  let maxStalled = 0;
  let prevZ = HOME[2];
  for (let i = 0; i < 900; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    const s = world.player('bot_0').soldier;
    if (prevZ > -110 && s.z <= -110 && crossX === null) crossX = s.x;
    prevZ = s.z;
    minDistToGoal = Math.min(minDistToGoal, Math.hypot(s.x - ENEMY[0], s.z - ENEMY[2]));
    routePoints = Math.max(routePoints, bot.route?.points?.length ?? 0);
    maxStalled = Math.max(maxStalled, bot._stalledTicks);
  }
  return {
    wallCell: gridAt(nav, 100, -110),
    kerbCell: gridAt(nav, 91, -103.5),
    wallBlocked: gridAt(nav, 100, -110) === CELL_OBJECT,
    traceThroughWall: traceClear(nav, 100, -100, 100, -120),
    routePoints,
    crossX,
    crossedOutsideWall: crossX !== null && (crossX < 80 || crossX > 120),
    minDistToGoal,
    maxStalled,
  };
}

/** The steering cone: a point behind the bot gets a turn and no throttle; a
 *  point ahead gets full throttle (`infanteryControlTowardsDirection`). */
function steerScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  const s = world.player('bot_0').soldier;
  s.spawn(s.x, s.y, s.z, 0);
  bot.tick(WORLD_TICK_DT, 0);          // sync the live pose
  bot._resetInput();
  bot._steerToward(s.x, s.z - 10);     // behind: facing +z
  const behind = { forward: bot.moveForward, lookX: bot.lookX };
  bot._resetInput();
  bot._steerToward(s.x + 1, s.z + 10); // 5.7 deg off the facing
  const ahead = { forward: bot.moveForward, lookX: bot.lookX };
  bot._resetInput();
  bot._steerToward(s.x + 10, s.z + 10); // 45 deg off: outside the cone
  const side = { forward: bot.moveForward, lookX: bot.lookX };
  return { behind, ahead, side };
}

/**
 * Friendly fire: the human stands exactly where `aimScenario` puts him, but on
 * the bot's own side. The bot must never sense or fire on him.
 */
function friendlyScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const local = world.addPlayer('local', { team: 2, flag: world.flags[0] });
  local.soldier.spawn(HOME[0] + 5, 0, HOME[2] - 20, 0);

  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;

  let sawTarget = false;
  let fired = false;
  for (let i = 0; i < 40; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    if (bot.firingTarget === 'local') sawTarget = true;
    if (bot.isFiring) fired = true;
  }
  const sensed = bot.sense(2).targetId;
  return { sawTarget, fired, sensed };
}

/** The bare input contract: a bot's written look reaches the soldier. */
function lookScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  const bs = world.player('bot_0').soldier;
  bs.spawn(bs.x, bs.y, bs.z, 0);
  bot._aimLook(Math.PI / 2, 0);
  const look = { x: bot.lookX, y: bot.lookY };
  bot._writeInput();
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
  steer: steerScenario(),
  look: lookScenario(),
};

process.stdout.write(JSON.stringify(results));
