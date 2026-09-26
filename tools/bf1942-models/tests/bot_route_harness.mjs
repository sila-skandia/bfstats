// `viewer/bot-route.js predictObstacles` (a soldier's 5 s collision
// look-ahead, `BBAvoid::calculateUrgency` 0x0855c650, ledger AI-119) and the
// route's leg widenings (one search a tick, `extendRoute`) under node, for
// tests/test_bot_route.py. Prints one JSON object.

import {
  predictObstacles, ageObstacles, subSpheres2d, SOLDIER_AVOID, BOT_RADIUS,
  ensureRoute, extendRoute, popPassed, lookAhead, execInfantryMoveTo,
} from './bot-route.js';
import { CELL_FREE, CELL_OBJECT } from './nav-map.js';

/** A soldier bot walking at `speed` along +z (yaw 0) from the origin. */
function walker(speed = 5) {
  return {
    vehicle: null, position: [0, 0, 0], yaw: 0, obstacles: [],
    route: { goal: [0, 100], points: [[0, 50]], coarse: [], failed: false },
    _player: () => ({ soldier: { speed, yaw: 0 } }),
    _radius: () => BOT_RADIUS,
  };
}
const body = (id, x, z, vx = 0, vz = 0, r = BOT_RADIUS) => ({ id, x, z, vx, vz, r });

const out = { lookAhead: SOLDIER_AVOID.lookAhead, maxSpeed: SOLDIER_AVOID.potentialObstacleMaxSpeed };

// A friend standing 8 m ahead: contact predicted in (8 - 2) / 5 = 1.2 s.
let b = walker();
out.stillAhead = { planted: predictObstacles(b, [body('p:a', 0, 8)]), obstacles: b.obstacles.map(o => [o.x, o.z, o.r]),
                   routeCleared: b.route === null };
// Planted once: the same body again adds nothing.
out.again = predictObstacles(b, [body('p:a', 0, 8)]);

// 30 m ahead is beyond 5 s x 5 m/s + 1 m.
b = walker();
out.beyondReach = predictObstacles(b, [body('p:a', 0, 30)]);

// 24 m ahead is inside it (contact at 4.4 s).
b = walker();
out.insideReach = predictObstacles(b, [body('p:a', 0, 24)]);

// A body walking the same way at the same speed: never closer.
b = walker();
out.pacing = predictObstacles(b, [body('p:a', 0, 8, 0, 5)]);

// A body crossing the path: predicted, but moving, so no obstacle (the
// potential-obstacle speed is 0 on every level).
b = walker();
out.crossing = predictObstacles(b, [body('p:a', -6, 8, 5, 0)]);

// A moving body already touching: contact now (t = 0) plants it anyway.
b = walker();
out.touching = predictObstacles(b, [body('p:a', 0, 1.5, 3, 0)]);

// A standing bot does not predict anything.
b = walker(0);
out.standing = predictObstacles(b, [body('p:a', 0, 8)]);

// The cluster: a still hull 10 m ahead is hit; a still friend 20 m to its
// side (inside 5 x 5 + r of it) comes with it, one 40 m off does not.
b = walker();
out.cluster = {
  planted: predictObstacles(b, [body('h:tank', 0, 10, 0, 0, 3.5), body('p:near', 20, 10), body('p:far', 40, 10)]),
  ids: b.obstacles.map(o => o.id), tankRadius: b.obstacles.find(o => o.id === 'h:tank')?.r ?? null,
};

// In a hull the prediction is not the soldier's.
b = walker();
b.vehicle = { kind: 'tank' };
out.mounted = predictObstacles(b, [body('p:a', 0, 8)]);

// A hull's sub-spheres (`getSubSpheres2d` 0x085d64b0): a 3.5 x 7 m box is
// two spheres of 7 / 3 along its length; a square box one of its half
// diagonal; a hull with spheres is planted as one circle a sphere.
const tank = subSpheres2d({ min: [-1.75, 0, -3.5], max: [1.75, 2.5, 3.5] });
const crate = subSpheres2d({ min: [-1, 0, -1], max: [1, 2, 1] });
b = walker();
predictObstacles(b, [{ ...body('h:t', 0, 10, 0, 0, 3.9), spheres: [[0, 8.8], [0, 11.2]], sphereR: 7 / 3 }]);
out.subSpheres = {
  tank: { r: tank.r, points: tank.points }, crate: { r: crate.r, points: crate.points },
  planted: b.obstacles.map(o => [o.id, o.x, o.z, +o.r.toFixed(3)]),
};

// The soldier's circles go when he takes a hull; a contact circle stays.
b = walker();
predictObstacles(b, [body('p:a', 0, 8)]);
b.obstacles.push({ x: 0, z: 3, r: 1.5, age: 0 });
ageObstacles(b, 0.1);
const onFoot = b.obstacles.length;
b.vehicle = { kind: 'tank', vehicleId: 'hull-1' };
ageObstacles(b, 0.1);
out.mountDrops = { onFoot, mounted: b.obstacles.length, kept: b.obstacles.map(o => o.id ?? 'contact') };

// A hull planted before the plan chose it goes once the plan is to board it.
b = walker();
predictObstacles(b, [{ ...body('h:gun', 0, 8, 0, 0, 2), spheres: [[0, 8]], sphereR: 2 }, body('p:a', 3, 8)]);
const before = b.obstacles.map(o => o.id);
b.currentPlan = [{ type: 'InfanteryMoveTo' }];
b.currentPlan.vehicleId = 'gun:AA_Allies';
ageObstacles(b, 0.1);
out.boardTarget = { before, after: b.obstacles.map(o => o.id) };

// --- A route's first leg, widened one search a tick -------------------------
//
// A flat 200 m map of 1 m cells. The hull stands at cell (100, 100) and is
// ordered 20 m on, to (100, 120) -- under the two coarse cells, so the route
// is the one leg. A wall across row 110 runs from x = 0 to 157: the way round
// is its end, 58 cells over. The local search box is the start's cell +- the
// radius, `10 + rand * 14 + 1` plus 16 m a widening, so the base box and the
// first two widenings (at most 57 m) cannot reach the end of the wall and the
// third (at least 59 m) always does, whatever the draw.
function flatNav(size = 200) {
  const n = size * size;
  return { width: size, height: size, cellSize: 1, blocked: new Uint8Array(n).fill(CELL_FREE),
           heights: new Float32Array(n), normalY: new Float32Array(n).fill(1) };
}
const wallNav = flatNav();
for (let gx = 0; gx <= 157; gx++) wallNav.blocked[110 * wallNav.width + gx] = CELL_OBJECT;
// The same map with the goal walled in on every side: no widening reaches it.
const shutNav = flatNav();
for (let gz = 117; gz <= 123; gz++) {
  for (let gx = 97; gx <= 103; gx++) {
    if (Math.max(Math.abs(gx - 100), Math.abs(gz - 120)) === 3) shutNav.blocked[gz * shutNav.width + gx] = CELL_OBJECT;
  }
}
const cellCentre = (gx, gz) => [gx + 0.5, -(gz + 0.5)];

/** A driven hull on `nav` whose bot methods are the module's own functions. */
function hullBot(nav) {
  const [x, z] = cellCentre(100, 100);
  const bot = {
    position: [x, 0, z], vehicle: { kind: 'tank', drive: { state: { velocity: { x: 0, y: 0, z: 0 } } } },
    obstacles: [], route: null, _pathFailures: 0, _now: 0, moveForward: 0, moveStrafe: 0, steered: 0,
    _nav: () => nav, _radius: () => 3, _player: () => null, _trackObstruction: () => false,
    _ensureRoute: goal => ensureRoute(bot, goal), _extendRoute: () => extendRoute(bot),
    _popPassed: () => popPassed(bot), _lookAhead: () => lookAhead(bot),
    _steerToward: () => { bot.steered++; bot.moveForward = 1; },
  };
  return bot;
}

/** `execInfantryMoveTo` at 30 Hz for `ticks`: the first tick the hull was
 *  given a point, the first tick its route stood failed, the widest search. */
function driveTicks(nav, ticks = 90) {
  const bot = hullBot(nav);
  const [gx, gz] = cellCentre(100, 120);
  const action = { type: 'InfanteryMoveTo', waypoint: [gx, 0, gz], arrive: 3 };
  let steeredAt = null, failedAt = null, widest = 0;
  for (let t = 0; t < ticks; t++) {
    bot._now = t / 30;
    const before = bot.steered;
    execInfantryMoveTo(bot, action, 1 / 30);
    if (steeredAt === null && bot.steered > before) steeredAt = t;
    if (failedAt === null && bot.route?.failed) failedAt = t;
    widest = Math.max(widest, bot.route?.widen ?? 0);
  }
  return { steeredAt, failedAt, widest, pathFailures: bot._pathFailures,
           points: bot.route?.points?.length ?? 0, throttle: bot.moveForward };
}
out.firstLegWidening = driveTicks(wallNav);
out.goalWalledIn = driveTicks(shutNav);

console.log(JSON.stringify(out));
