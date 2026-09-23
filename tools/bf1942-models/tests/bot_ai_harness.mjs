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

import { inFrustum, sCurveExact, informationSecurity, SideKnowledge, BotSenses } from './bot-sense.js';
import { World, WORLD_TICK_DT } from './world.mjs';
import { BotController } from './bot.js';
import { buildNavMap, gridAt, traceClear, CELL_OBJECT } from './nav-grid.js';
import { Armor } from './armor.js';
import { tankControl, unitUrgency, changeUrgency, orderSplit, teleportChangeUrgency, driveDecision, TANK, TELEPORT, CHANGE } from './bot-vehicle.js';
import { towardsPoint, boatControl, boatSpeedControl, BOAT, rotate, attackRunStep, roundMiss, planeFireMode, aimAtDirection, towardsDirectionEngine, stickShape, PLANE_FIRE } from './bot-vehicle-air.js';
import { fireStrength, unitTable, EnemyStrengthTables, engineHeatInfluence, STRENGTH } from './bot-strength.js';
import { scoreVehicleTargets, scoreTargets, SOLDIER_BATTLE_STRENGTH } from './bot-fire.js';
import { freeRun, freeBox, freeLevel, CELL_LAND, CELL_FREE } from './nav-grid.js';

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

/** Special: a medic with a MedPack and a wounded friend 12 m away. The
 *  behaviour wins the contest (Fire has nothing, MoveTo has no map and no
 *  strategic order so its fallback walks at the enemy flag), the bot walks
 *  to `R + 0.9 * 2.5` and holds the trigger on the friend within 5 deg. */
function medicScenario() {
  const world = makeWorld();
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  world.addBotPlayer('mate', { team: 2, flag: world.flags[0] });
  const mate = world.player('mate').soldier;
  mate.spawn(HOME[0], 0, HOME[2] - 12, 0);
  const mateArmor = new Armor(30);
  mateArmor.applyDamage(20);
  world.setPlayerArmor('mate', mateArmor);
  world.setPlayerArmor('bot_0', new Armor(30));
  const weapons = [
    { name: 'Colt', burst: 0, minRange: 0, maxRange: 60, strength: { Infantry: 2 }, ammo: -1 },
    { name: 'MedPack', burst: 0, minRange: 0, maxRange: 2.5, strength: { Infantry: 2 }, ammo: -1, healing: true },
  ];
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75, weapons });
  bot.navGrid = null;
  let chosen = false, fired = false, weapon = null, minDist = Infinity, firingDist = null;
  let urgency = 0;
  for (let i = 0; i < 240; i++) {
    bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
    world.step(WORLD_TICK_DT);
    const s = world.player('bot_0').soldier;
    const d = Math.hypot(s.x - mate.x, s.z - mate.z);
    minDist = Math.min(minDist, d);
    urgency = Math.max(urgency, bot.urgency.Special ?? 0);
    if (bot.currentBehaviour === 'Special') chosen = true;
    if (bot.isFiring) { fired = true; weapon = bot.weaponAi?.name ?? null; firingDist = firingDist ?? d; }
  }
  return { chosen, fired, weapon, minDist, firingDist, urgency, arrive: bot._medicResult?.arrive ?? null };
}

/** The tank law: a target dead ahead wants speed up to `maxSpeed`; one
 *  20 deg to the +yaw side steers negative (the viewer's `c_PIYaw` sense);
 *  one behind turns first and keeps its turn direction across the flip. */
function tankLawScenario() {
  const ahead = tankControl({ forward: [0, 1], velocity: [0, 0], toTarget: [0, 50], maxSpeed: 16 });
  const fast = tankControl({ forward: [0, 1], velocity: [0, 16], toTarget: [0, 50], maxSpeed: 16 });
  const right = tankControl({ forward: [0, 1], velocity: [0, 5], toTarget: [Math.sin(0.35) * 50, Math.cos(0.35) * 50], maxSpeed: 16 });
  const behind = tankControl({ forward: [0, 1], velocity: [0, 0], toTarget: [0.01, -50], maxSpeed: 16 });
  const behindKept = tankControl({ forward: [0, 1], velocity: [0, 0], toTarget: [-0.01, -50], maxSpeed: 16, lastTurn: behind.turn });
  return { ahead, fast, right, behind, behindKept };
}

/** The Change scoring: a Sherman near a rifleman outranks staying on foot;
 *  a jeep 95 m away barely does; a unit manned by the enemy is filtered
 *  before scoring (the caller's business) so only the numbers are pinned. */
function changeScenario() {
  const split = orderSplit(0, 0);
  const foot = unitUrgency({ health: 1, strengths: { Infantry: 4 }, presence: { Infantry: 1 }, maxSpeed: TANK.soldierMaxSpeed, value: 1, orderSplit: split });
  const sherman = unitUrgency({ health: 1, strengths: { Infantry: 10, LightArmour: 7, HeavyArmour: 2 }, presence: { Infantry: 1 }, maxSpeed: 16, value: 3, orderSplit: split });
  const willy = unitUrgency({ health: 1, strengths: {}, presence: { Infantry: 1 }, maxSpeed: 25, value: 1, orderSplit: split });
  const near = changeUrgency({ staying: foot, candidates: [{ id: 's', u: sherman, dist: 10 }], mod: 1.9 });
  const far = changeUrgency({ staying: foot, candidates: [{ id: 'w', u: willy, dist: 95 }], mod: 1.9 });
  const none = changeUrgency({ staying: foot, candidates: [], mod: 1.9 });
  return { foot, sherman, willy, near: near.urgency, nearId: near.best?.id ?? null, far: far.urgency, none: none.urgency, split };
}

/** The plane law (`towardsPoint` 0x08629730 -> `towardsDirection`): level
 *  flight toward a point ahead and above wants nose up (a negative stick),
 *  a point to the right rolls and yaws right, a plane on the ground before
 *  its airborne flag makes no turn and, slow, holds its nose down (the
 *  airspeed's climb limit); the boat's helm turns full rudder past 30 deg. */
function airScenario() {
  const level = { x: 0, y: 0, z: 0, w: 1 };            // nose along -z
  const common = { orientation: level, position: [0, 200, 0], velocity: [0, 0, -60], clearance: 120,
                   altitudeAlong: () => 200, altitude: 200, airborne: true, maxSpeed: 60, radius: 10 };
  const ahead = towardsPoint({ ...common, target: [0, 260, -1000] });
  const right = towardsPoint({ ...common, target: [500, 200, -500] });
  const ground = towardsPoint({ ...common, position: [0, 1, 0], velocity: [0, 0, -5], target: [300, 200, -1000],
                                altitudeAlong: () => 1, altitude: 1, airborne: false });
  const boatTurn = boatControl({ forward: [0, 1], velocity: [0, 3], toTarget: [100, 20], radius: 10 });
  const boatAhead = boatControl({ forward: [0, 1], velocity: [0, 3], toTarget: [0, 200], radius: 10 });
  const fwd = rotate(level, [0, 0, -1]);
  return { ahead, right, ground, boatTurn, boatAhead, fwd };
}

/** A side's information security (ledger AI-75): `SCurve::calculate` on its
 *  table; `1 - SCurve(age / D)` for a known enemy; hearing's `setTime(now,
 *  0.5)`; the enemy tables weigh each unit by it, leave out one never seen
 *  and forget one no longer alive; a bot's spot, re-sight and hearing write
 *  its side's store, and a spot refreshes the spotted unit's crewmates. */
function securityScenario() {
  const curve = [0, 0.005, 0.255, 0.5, 0.999, 1, 1.5, -0.1].map(sCurveExact);
  const soldier = [0, 3.75, 7.5, 11.25, 15, 20].map(t => informationSecurity(t));
  const k = new SideKnowledge();
  k.heard('h', 10);                                  // first contact: made now, security 1
  const heardFresh = k.security('h', 10);
  k.heard('h', 12);                                  // 0.99 >= 0.5: unchanged
  const heardKept = k.t0.get('h');
  k.heard('h', 30);                                  // 0 < 0.5: t0 = 30 - 1 / (0.5 x 15)
  const heardBack = { t0: k.t0.get('h'), s: k.security('h', 30) };

  const tables = new EnemyStrengthTables();
  const units = [
    { id: 'a', table: { Infantry: 10 }, type: 'Infantry' },
    { id: 'b', table: { Infantry: 10 }, type: 'Infantry' },
    { id: 'p', table: { Air: 6 }, type: 'Air', template: 'Spitfire' },
  ];
  tables.knowledge.spotted('a', 0);
  tables.knowledge.spotted('p', 0);
  const series = [];
  for (let t = 0; t <= 16; t += 2) {
    tables.update(units, t);
    series.push({ t, inf: tables.strengths.Infantry, air: tables.strengths.Air, infType: tables.types.Infantry,
                  a: tables.lastSecurity.get('a'), b: tables.lastSecurity.get('b') ?? 'absent', p: tables.lastSecurity.get('p') });
  }
  tables.update(units.slice(1), 18);                 // 'a' died
  const forgot = !tables.knowledge.t0.has('a');
  const legacy = new EnemyStrengthTables();
  legacy.update([{ table: { Infantry: 10 }, type: 'Infantry' }]);   // no ids, no clock: weight 1

  const players = new Map([
    ['me', { team: 1, soldier: { x: 0, y: 0, z: 0 } }],
    ['e1', { team: 2, soldier: { x: 0, y: 0, z: 50 }, hull: 7 }],
    ['e2', { team: 2, soldier: { x: 0, y: 0, z: -50 }, hull: 7 }],   // behind: seen only as crew
    ['e3', { team: 2, soldier: { x: 40, y: 0, z: -40 } }],
    ['e4', { team: 2, soldier: { x: 12, y: 0, z: 40 } }],             // in the frustum, behind a wall
  ]);
  // Every ray toward +x (e4) ends on a wall; the rest are clear.
  const collider = { cast: (ox, oy, oz, dx) => (dx > 0.05 ? { t: 5, owner: 99 } : null) };
  const world = { players, collider, armorOf: () => null };
  const senses = new BotSenses({ viewDistance: 600, random: () => 0.5 });
  senses.knowledge = new SideKnowledge();
  senses.unitOwnerOf = p => p?.hull ?? -1;
  const me = { id: 'me', team: 1 };
  senses.sense(5, world, me, [0, 1.6, 0], 0);
  const afterSpot = Object.fromEntries(senses.knowledge.t0);
  const e4InMemory = senses.memory.has('e4');
  senses.updateMemory(9, world, me, [0, 1.6, 0], 0);
  const afterResight = Object.fromEntries(senses.knowledge.t0);
  senses.hear(9, 'e3', 2, [40, 0, -40], [0, 0, 0], 1, { weaponRadius: 100, firedAt: 9 });
  const afterHear = Object.fromEntries(senses.knowledge.t0);
  return { curve, soldier, heardFresh, heardKept, heardBack, series, forgot, legacy: legacy.strengths.Infantry,
           afterSpot, afterResight, afterHear, e4InMemory, securityOfUnknown: senses.securityOf('nobody', 9) };
}

/** The class tables: a Sherman's unit table is the max over its guns; the
 *  enemy tables settle at the per-pass sum; the fire strength is the best
 *  squared strength against a class the enemy fields, less the enemy's
 *  strength against the unit's class, or half the best squared strength
 *  when the enemy fields nothing known; a fixed gun that can point at no
 *  enemy scores 0. */
function strengthScenario() {
  const sherman = unitTable([
    { strength: { Infantry: 10, LightArmour: 7, HeavyArmour: 2, Air: 1 } },
    { strength: { Infantry: 12, LightArmour: 5, HeavyArmour: 0, Air: 1 } },
    { strength: { Infantry: 99 }, healing: true },
  ]);
  const tables = new EnemyStrengthTables();
  for (let i = 0; i < 12; i++) tables.update([{ table: SOLDIER_BATTLE_STRENGTH, type: 'Infantry' }, { table: SOLDIER_BATTLE_STRENGTH, type: 'Infantry' }]);
  const vsInfantry = fireStrength({ table: sherman, myType: 'HeavyArmour', enemyStrengths: tables.strengths, enemyTypes: tables.types });
  const unknown = fireStrength({ table: sherman, myType: 'HeavyArmour', enemyStrengths: {}, enemyTypes: {} });
  const withGunner = fireStrength({ table: sherman, others: [{ table: { Infantry: 8, Air: 3 }, occupied: true }], myType: 'HeavyArmour',
                                    enemyStrengths: tables.strengths, enemyTypes: tables.types });
  const fixedBlind = fireStrength({ table: { Air: 5, Infantry: 10 }, myType: 'LightArmour', fixed: true, aimable: false,
                                   enemyStrengths: tables.strengths, enemyTypes: tables.types });
  // 0x08584580's `return 5.0`: a fixed gun with no enemy known or in range
  // that faces only its strategic direction.
  const fixedStrategic = fireStrength({ table: { Air: 5, Infantry: 10 }, myType: 'LightArmour', fixed: true, aimable: 'strategic',
                                        enemyStrengths: tables.strengths, enemyTypes: tables.types });
  // The bot's own seat is vacated when it weighs another: a driver weighing
  // the gunner's seat sees no occupied root (so the seat is fixed), and the
  // gunner weighing the root sees no occupied gunner.
  const gunnerFromDriver = fireStrength({ table: { Infantry: 15 }, others: [{ table: {}, occupied: false }], isSeat: true,
                                          myType: 'LightArmour', fixed: true, aimable: false,
                                          enemyStrengths: tables.strengths, enemyTypes: tables.types });
  const rootFromGunner = fireStrength({ table: {}, others: [{ table: { Infantry: 15 }, occupied: false }], myType: 'LightArmour',
                                        enemyStrengths: tables.strengths, enemyTypes: tables.types });
  const foot = unitUrgency({ health: 1, fire: fireStrength({ table: SOLDIER_BATTLE_STRENGTH, myType: 'Infantry', enemyStrengths: tables.strengths, enemyTypes: tables.types }),
                             maxSpeed: TANK.soldierMaxSpeed, value: 1, orderSplit: [0.5, 0.5] });
  const tank = unitUrgency({ health: 1, fire: vsInfantry, maxSpeed: 16, value: 3, orderSplit: [0.5, 0.5] });
  return { sherman, types: tables.types, strengths: tables.strengths, vsInfantry, unknown, withGunner, fixedBlind, fixedStrategic, gunnerFromDriver, rootFromGunner, foot, tank,
           heat: [engineHeatInfluence(0.5), engineHeatInfluence(0.975)], radius: CHANGE.searchRadius };
}

/** The seat swap: a gunner under a driver keeps a seat worth as much as the
 *  root's; a passenger of a free jeep takes the wheel; the root never
 *  swaps down to a weaker seat. */
function teleportScenario() {
  const gunnerStays = teleportChangeUrgency({ where: 'seatUnderDriver', rootU: 10, selfU: 8, seats: [{ id: 'mg', u: 6 }] });
  const passengerDrives = teleportChangeUrgency({ where: 'seatLand', rootU: 10, selfU: 2, seats: [] });
  const rootKeeps = teleportChangeUrgency({ where: 'root', rootU: 10, selfU: 10, seats: [{ id: 'mg', u: 6 }] });
  const pending = teleportChangeUrgency({ where: 'root', rootU: 10, selfU: 10, seats: [], pending: true });
  return { gunnerStays, passengerDrives, rootKeeps, pending, factors: TELEPORT.seatAir };
}

/** The box test: a target behind with no room ahead backs toward it; with
 *  room, or a narrow box, the hull turns. */
function driveDecisionScenario() {
  const back = driveDecision({ dot: -0.9, angle: 2.8, freeAhead: 3, boxShort: 6, turnRadius: 5 });
  const room = driveDecision({ dot: -0.9, angle: 2.8, freeAhead: 12, boxShort: 6, turnRadius: 5 });
  const narrow = driveDecision({ dot: -0.9, angle: 2.8, freeAhead: 3, boxShort: 2, turnRadius: 5 });
  const shallow = driveDecision({ dot: -0.2, angle: 1.0, freeAhead: 3, boxShort: 6, turnRadius: 5 });
  const law = tankControl({ forward: [0, 1], velocity: [0, 0], toTarget: [0.01, -50], maxSpeed: 16, freeAhead: 3, boxShort: 6, turnRadius: 5 });
  return { back, room, narrow, shallow, lawReverse: law.reverse, lawThrottle: law.throttle };
}

/** The vehicle targeting: a hull's gun prefers the close infantryman (the
 *  large-bore distance term falls with range), an aircraft the far one
 *  (its rises to a third of the range), and a fixed gun that cannot point
 *  at the target skips it. */
function vehicleFireScenario() {
  const weapons = [{ name: 'gun', strength: { Infantry: 10, LightArmour: 7, HeavyArmour: 2, Air: 1 }, minRange: 2, maxRange: 250, ammo: -1 }];
  const spotted = (d) => [{ id: 'near', pos: [0, 0, -d], seen: true, lost: false }, { id: 'far', pos: [0, 0, -200], seen: true, lost: false }];
  const common = { position: [0, 0, 0], forward: [0, 0, -1], velocity: [0, 0, 0], weapons, now: 100, attackedBy: () => -1000,
                   velocityOf: () => [0, 0, 0], infoOf: () => ({ type: 'Infantry', air: false, table: SOLDIER_BATTLE_STRENGTH, maxSpeed: 5, seats: null, mobile: true }),
                   myType: 'HeavyArmour', myTable: unitTable(weapons) };
  const tank = scoreVehicleTargets({ ...common, spotted: spotted(40), mode: 'largeBore' });
  const plane = scoreVehicleTargets({ ...common, spotted: spotted(40), mode: 'air', air: true, maxSpeed: 60 });
  const blind = scoreVehicleTargets({ ...common, spotted: spotted(40), mode: 'largeBore', aimable: () => false });
  const tooClose = scoreVehicleTargets({ ...common, spotted: [{ id: 'n', pos: [0, 0, -1], seen: true }], mode: 'largeBore' });
  const env = scoreVehicleTargets({ ...common, spotted: [], environment: [{ id: 'e', pos: [0, 0, -60] }], mode: 'largeBore' });
  const vehicleTarget = scoreVehicleTargets({ ...common, spotted: [{ id: 'v', pos: [0, 0, -60], seen: true }], mode: 'largeBore',
    infoOf: () => ({ type: 'LightArmour', air: false, table: {}, maxSpeed: 25, mobile: true, enemyManned: true,
                     seats: [{ type: 'LightArmour', table: { HeavyArmour: 0 }, occupied: true }, { type: 'LightArmour', table: { HeavyArmour: 0 }, occupied: false }] }) });
  return { tank: tank.targetId, tankScore: tank.score, plane: plane.targetId, blind: blind.targetId, tooClose: tooClose.targetId,
           env: env.targetId, envUrgency: env.urgency, vehicle: vehicleTarget.targetId, vehicleScore: vehicleTarget.score };
}

/** The aircraft's fire plan: approach until inside 0.9 of the range with a
 *  line of fire, attack while the target is in front, break for 200 m after
 *  the pass; a seated unit that cannot move gets mode 3; the aim law holds
 *  the climb angle during a takeoff. */
function planeFireScenario() {
  const state = { phase: 'approach', breakFrom: null };
  const args = (dist, ahead = true) => ({ position: [0, 100, 0], forward: [0, 0, -1], velocity: [0, 0, -60],
                                          target: [0, 100, ahead ? -dist : dist], maxRange: 300, turnRadius: 25, lineOfFire: true, mode: 1 });
  const far = attackRunStep(state, args(1000));
  const inRange = attackRunStep(state, args(200));
  const passed = attackRunStep(state, args(20));
  const breaking = attackRunStep(state, { ...args(20), position: [0, 100, -100] });
  const again = attackRunStep(state, { ...args(20), position: [0, 100, -250] });
  const modes = [planeFireMode({ extents: [0.6, 1.8, 0.6] }), planeFireMode({ extents: [3, 3, 6], vehicle: true }),
                 planeFireMode({ extents: [30, 10, 90], vehicle: true, large: true }), planeFireMode({ mobile: false })];
  const level = { x: 0, y: 0, z: 0, w: 1 };
  const aimUp = aimAtDirection({ orientation: level, velocity: [0, 0, -60], dir: [0, 0.5, -0.866], maxSpeed: 60 });
  const aimTakeoff = aimAtDirection({ orientation: level, velocity: [0, 0, -10], dir: [0, 0, -1], maxSpeed: 60, airborne: false, altitude: 1 });
  // A low pass: 30 m over the ground, the probes under the 75 m clearance, so
  // the pull-up demand lifts the nose even with the target below.
  const aimLow = aimAtDirection({ orientation: level, velocity: [0, 0, -60], dir: [0, -0.2, -0.98], maxSpeed: 60, altitudeAlong: () => 30 });
  // `towardsDirection` 0x08629fa0 against its x87 emulation (six random
  // cases, engine frame; lnxded/x87emu.py produced the outputs).
  const engineCases = [{"dir": [-0.993692, -0.074491, 0.083831], "R": [-0.561141, 0.255515, -0.787294], "U": [-0.340014, -0.938361, -0.062199], "F": [-0.754659, 0.232789, 0.613432], "omega": [-0.514232, -0.172274, 0.494024], "climbDemand": 14.315476, "clearance": 50.0, "takeoff": false, "throttleFloor": 0.5, "speed": 52.313803, "diveGuard": true, "out": {"throttle": 0.5, "yaw": 0.7752, "roll": 1.0, "pitch": 0.045827}}, {"dir": [-0.829655, 0.191291, 0.524481], "R": [-0.960014, 0.220102, -0.172995], "U": [0.131449, 0.899994, 0.41561], "F": [0.247171, 0.376251, -0.89294], "omega": [-1.214037, -0.89832, -1.089944], "climbDemand": -6.400518, "clearance": 50.0, "takeoff": false, "throttleFloor": 1.0, "speed": 79.655331, "diveGuard": false, "out": {"throttle": 1.0, "yaw": 1.0, "roll": 1.0, "pitch": -0.803188}}, {"dir": [0.266325, -0.383618, 0.884256], "R": [0.878611, -0.286405, -0.382119], "U": [0.400487, 0.006088, 0.916282], "F": [-0.260101, -0.958089, 0.120051], "omega": [-0.606245, 0.823312, 0.002819], "climbDemand": -4.501909, "clearance": 50.0, "takeoff": false, "throttleFloor": 0.5, "speed": 33.583312, "diveGuard": true, "out": {"throttle": 0.5, "yaw": 0.518796, "roll": -0.723797, "pitch": -0.929168}}, {"dir": [0.43917, 0.897749, 0.034316], "R": [-0.661937, 0.418265, 0.622008], "U": [0.684838, 0.000158, 0.728695], "F": [0.304689, 0.908325, -0.286548], "omega": [0.092303, -1.810458, 0.150234], "climbDemand": -7.886268, "clearance": 50.0, "takeoff": true, "throttleFloor": 1.0, "speed": 61.56176, "diveGuard": true, "out": {"throttle": 1.0, "yaw": -0.98549, "roll": 0.789041, "pitch": 0.218963}}, {"dir": [-0.658301, 0.640282, 0.395827], "R": [0.574338, 0.616582, 0.538482], "U": [0.340258, 0.418474, -0.842083], "F": [-0.744554, 0.666863, 0.030549], "omega": [3.668865, -1.261596, -0.941278], "climbDemand": 73.395255, "clearance": 50.0, "takeoff": false, "throttleFloor": 0.5, "speed": 0.766019, "diveGuard": true, "out": {"throttle": 1.0, "yaw": -0.850631, "roll": 0.80369, "pitch": 0.905995}}, {"dir": [-0.221476, -0.21368, -0.951467], "R": [-0.493111, -0.666941, -0.558598], "U": [0.766724, -0.029776, -0.641286], "F": [0.411066, -0.744516, 0.526043], "omega": [-1.182207, 0.779797, 0.892817], "climbDemand": -28.378307, "clearance": 50.0, "takeoff": false, "throttleFloor": 1.0, "speed": 19.959885, "diveGuard": true, "out": {"throttle": 1.0, "yaw": 0.982714, "roll": -0.617742, "pitch": -0.997419}}];
  const engineMaxErr = Math.max(...engineCases.map(c => {
    const r = towardsDirectionEngine({ ...c, maxClimb: 0.3333, maxRoll: 0.9999 });
    return Math.max(...['throttle', 'yaw', 'roll', 'pitch'].map(k => Math.abs(r[k] - c.out[k])));
  }));
  // Mode 0 (a soldier): no in-front gate, the trigger is the round's miss
  // inside the precision; a nose 2 deg off at 200 m misses by ~7 m.
  const s0 = { phase: 'approach', breakFrom: null };
  const soldier = (aimDir) => attackRunStep(s0, { position: [0, 100, 0], forward: [0, 0, -1], velocity: [0, 0, -60],
    target: [0, 100, -200], maxRange: 300, lineOfFire: true, mode: 0, precision: 1.44, aimDir, roundSpeed: 800, gravity: 0 });
  const onTarget = soldier([0, 0, -1]);
  const offTarget = soldier([Math.sin(2 * Math.PI / 180), 0, -Math.cos(2 * Math.PI / 180)]);
  const unseen = attackRunStep({ phase: 'approach' }, { position: [0, 100, 0], forward: [0, 0, -1], velocity: [0, 0, -60],
    target: [0, 100, -200], maxRange: 300, lineOfFire: false, mode: 0, precision: 1.44, roundSpeed: 800 });
  // A target 8 m ahead is not "in front" (ObjectInFront's 10 m).
  const close = attackRunStep({ phase: 'approach' }, { position: [0, 100, 0], forward: [0, 0, -1], velocity: [0, 0, -60],
    target: [0, 100, -8], maxRange: 300, lineOfFire: true, mode: 1, precision: 5, roundSpeed: 800 });
  // A moving target: the lead solution puts the miss at 0 for the led aim.
  const lead = roundMiss({ rel: [0, 0, -300], relVel: [30, 0, 0], dir: [0.1, 0, -0.995], speed: 300, gravity: 0 });
  return { far: far.phase, inRange: inRange.phase, inRangeFire: inRange.fire, passed: passed.phase, breaking: breaking.phase,
           again: again.phase, modes, aimUpPitch: aimUp.pitch, climb: PLANE_FIRE.maxClimbAngle,
           onTarget: [onTarget.phase, onTarget.fire, onTarget.miss], offTarget: [offTarget.fire, offTarget.miss],
           unseen: unseen.phase, closeInFront: close.inFront, leadMiss: lead.miss, leadT: lead.t,
           aimLowPitch: aimLow.pitch, takeoffAirborne: aimTakeoff.airborne, engineMaxErr, shape: [stickShape(0.05), stickShape(-1), stickShape(1)] };
}

/** The water map: a sea 20 m deep around a 40 m island, the boats' map
 *  free on the deep water and blocked on the island and its 8 m shelf; the
 *  free run and the free box read the same map. */
function waterMapScenario() {
  const size = 128;
  const island = (x, z) => Math.hypot(x - 64, -z - 64) < 20;
  const c = {
    waterLevel: 20,
    heightfield: { height(x, z) { return island(x, z) ? 25 : (Math.hypot(x - 64, -z - 64) < 28 ? 16 : 0); } },
    surfaceHeight() { return 20; },
    statics: null,
  };
  const nav = buildNavMap(c, size, { waterMap: true, waterDepth: 5, maxSlopeDeg: 0, brush: 3, lowClip: 0.3, hiClip: 2.5 });
  const deep = gridAt(nav, 10, -10), centre = gridAt(nav, 64, -64), shelf = gridAt(nav, 64, -64 - 24);
  const run = freeRun(nav, 10, -64, 1, 0, 100);
  const box = freeBox(nav, 10, -10, 40);
  const infantry = buildNavMap(c, size, { waterDepth: 1.5, brush: 1 });
  return { deep, centre, shelf, run, boxShort: box.short, land: CELL_LAND, free: CELL_FREE, islandWalkable: gridAt(infantry, 64, -64) };
}

const results = {
  strength: strengthScenario(),
  teleport: teleportScenario(),
  drive: driveDecisionScenario(),
  vehicleFire: vehicleFireScenario(),
  planeFire: planeFireScenario(),
  frustum: (() => {
    // 0x08521cf0: a square frustum about the camera (aspect 1.0).
    const level = { f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] };
    const h = (deg) => deg * Math.PI / 360;
    const dir = (yawDeg, pitchDeg) => [Math.sin(yawDeg * Math.PI / 180) * Math.cos(pitchDeg * Math.PI / 180),
      Math.sin(pitchDeg * Math.PI / 180), Math.cos(yawDeg * Math.PI / 180) * Math.cos(pitchDeg * Math.PI / 180)];
    const t = (fov, yawDeg, pitchDeg) => inFrustum(level, 0, ...dir(yawDeg, pitchDeg), h(fov));
    return { below40inf: t(100, 0, -40), below40veh: t(75, 0, -40), behind: t(100, 180, 0), side30: t(75, 30, 0),
             yawOnlyBelow: inFrustum(null, 0, ...dir(0, -80), h(75)) };
  })(),
  water: waterMapScenario(),
  boatSpeed: (() => {
    // `BoatControl::speedControl` 0x0860cf40 underway: the factor table by
    // level (base 2) and angle, `simpleReg` on the speed, the damped rudder.
    const f = (level, deg) => boatSpeedControl({ angle: deg * Math.PI / 180, maxSpeed: 10, level }).factor;
    const open = [f(5, 10), f(5, 40), f(5, 60)];
    const oneClear = [f(3, 10), f(3, 30), f(3, 60)];
    const tight = [f(2, 1), f(2, 10), f(2, 20), f(2, 40)];
    const reg = [boatSpeedControl({ angle: 0, maxSpeed: 15.5, prevSpeed: 15 }).throttle,
                 boatSpeedControl({ angle: 0, maxSpeed: 15.5, prevSpeed: 16 }).throttle,
                 boatSpeedControl({ angle: 0, maxSpeed: 15.5, prevSpeed: 5 }).throttle];
    const r = boatSpeedControl({ angle: 0.2, maxSpeed: 10, yawRate: 0.5 });
    const rudder = +r.rudder.toFixed(6);
    const want = +(Math.sign(Math.sin(0.2) - 0.05) * Math.log10(9 * Math.abs(Math.sin(0.2) - 0.05) + 1)).toFixed(6);
    // The turn: above 3 m/s brake against the motion, at or below it push
    // with the motion; full rudder toward the target.
    const turnFast = boatControl({ forward: [0, -1], velocity: [0, -8], toTarget: [50, 0], maxSpeed: 10, prevThrottle: 0 });
    const turnSlow = boatControl({ forward: [0, -1], velocity: [0, -2], toTarget: [50, 0], maxSpeed: 10, prevThrottle: 0 });
    return { open, oneClear, tight, reg, rudder, want, turnFast: [turnFast.throttle, turnFast.steer],
             turnSlow: [turnSlow.throttle, turnSlow.steer] };
  })(),
  leftRamp: (() => {
    // The 15 s ramp keys on the hull the bot left, the candidates' `vehicleId`.
    const b = Object.create(BotController.prototype);
    b.vehicle = { id: 'hull-uuid:ShermanGunner', vehicleId: 'hull-uuid' };
    b.weapons = []; b._footWeapons = null; b._execInfantryResetControls = () => {};
    b.dismount(10);
    return b._leftVehicle;
  })(),
  fireArea: (() => {
    // `BBFire::calculateUrgency` 0x08563570: one factor F, 0.5 in range, the
    // area factor beyond it, applied to the strength and to the score.
    const w = [{ name: 'K98', maxRange: 100, minRange: 0, ammo: 10, strength: { Infantry: 4 } }];
    const score = (x, inside, targetInside = true) => scoreTargets({
      spotted: [{ id: 't', pos: [x, 0, 0], seen: true }], position: [0, 0, 0], weapons: w, now: 0,
      typeOf: () => 'Infantry', insideOrderedArea: inside,
      insideArea: () => targetInside,
    }).score;
    return { inRange: score(50, false) / score(50, true), beyond: score(110, false) / score(110, true),
             beyondBoth: score(110, false, false) / score(110, true) };
  })(),
  freeLevel: (() => {
    // `getLevel`: the largest aligned free block holding the point.
    const size = 64;
    const blocked = new Uint8Array(size * size).fill(CELL_FREE);
    blocked[40 * size + 40] = CELL_LAND;             // one blocked cell at (40, -40)
    const nav = { blocked, width: size, height: size, cellSize: 1 };
    return { onIt: freeLevel(nav, 40.5, -40.5), next: freeLevel(nav, 41.5, -40.5), far: freeLevel(nav, 5.5, -5.5),
             nearish: freeLevel(nav, 44.5, -44.5) };
  })(),
  medic: medicScenario(),
  security: securityScenario(),
  air: airScenario(),
  tankLaw: tankLawScenario(),
  change: changeScenario(),
  tickDt: WORLD_TICK_DT,
  aim: aimScenario(),
  friendly: friendlyScenario(),
  moveTo: moveToScenario(),
  avoid: avoidScenario(),
  steer: steerScenario(),
  look: lookScenario(),
};

process.stdout.write(JSON.stringify(results));
