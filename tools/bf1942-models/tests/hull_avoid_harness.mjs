// A bot driver's collision prediction and side step (`BBAvoid` with
// `BBPAvoidCollision2d` on the driven ground and boat rows, ledger AI-95,
// AI-119): bot-vehicle.js `hullAvoidUrgency` / `hullAvoidTurn`, bot-route.js
// `planHullAvoid` and `predictObstacles` for a driven hull, under node, for
// tests/test_hull_avoid.py. Prints one JSON object.

import { HULL_AVOID, hullAvoidUrgency, hullAvoidTurn, teleportChangeUrgency, LANDING_TELEPORT } from './bot-vehicle.js';
import { planHullAvoid, predictObstacles, ageObstacles, drivesHull, BOT_RADIUS } from './bot-route.js';
import { CELL_FREE, CELL_OBJECT } from './nav-map.js';

const out = { constants: { ...HULL_AVOID } };

// A hull at the origin driving +z at 10 m/s, its radius 2.5.
const self = { id: 'h:me', x: 0, z: 0, vx: 0, vz: 10, r: 2.5 };
const soldier = (id, x, z, vx = 0, vz = 0) => ({ id, x, z, vx, vz, r: 1, mass: 100 });

// A friend crossing 20 m ahead from the left at 3 m/s: met inside 5 s.
let r = hullAvoidUrgency({ self, others: [soldier('p:cross', -6, 20, 3, 0)] });
out.crossing = { urgency: r.urgency, best: r.best?.id ?? null, t: r.best?.t ?? null, still: r.still.map(o => o.id) };
// A friend standing 20 m ahead: no urgency (under 1.0 m/s), listed still.
r = hullAvoidUrgency({ self, others: [soldier('p:stand', 0, 20)] });
out.standing = { urgency: r.urgency, best: r.best?.id ?? null, still: r.still.map(o => o.id) };
// Walking at 0.9 m/s: still slower than `getPotentialObstacleMaxSpeed`.
r = hullAvoidUrgency({ self, others: [soldier('p:slow', 0, 20, 0.9, 0)] });
out.slow = { urgency: r.urgency, still: r.still.map(o => o.id) };
// 60 m ahead is beyond 5 s x 10 m/s + 2.5 + 1.
r = hullAvoidUrgency({ self, others: [soldier('p:far', 0, 60, 3, 0)] });
out.far = { urgency: r.urgency, still: r.still.length };
// A heavier hull crossing beats a soldier crossing: the larger term names it.
r = hullAvoidUrgency({ self, others: [soldier('p:cross', -6, 20, 3, 0),
                                       { id: 'h:jeep', x: -12, z: 25, vx: 6, vz: 0, r: 2, mass: 1200 }] });
out.pair = { best: r.best?.id ?? null, urgency: r.urgency };
// Itself is never a neighbour.
out.self = hullAvoidUrgency({ self, others: [{ ...self, mass: 5000 }] }).urgency;

// The turn (`BBPAvoidCollision2d::createPlan` 0x08586420), viewer frame.
// Driving +z (the engine's -z); the other crossing toward +x.
out.turnCrossPlusX = hullAvoidTurn({ velocity: [0, 10], forward: [0, 1], otherVelocity: [3, 0], rel: [-6, 20] });
out.turnCrossMinusX = hullAvoidTurn({ velocity: [0, 10], forward: [0, 1], otherVelocity: [-3, 0], rel: [6, 20] });
// Head-on: the other coming down -z, cos = -1 < -0.2588.
out.turnHeadOn = hullAvoidTurn({ velocity: [0, 10], forward: [0, 1], otherVelocity: [0, -5], rel: [0, 30] });
// A still other: `u` is zero, so no turn.
out.turnStill = hullAvoidTurn({ velocity: [0, 10], forward: [0, 1], otherVelocity: [0, 0], rel: [0, 30] });
// A standing hull steps off along its heading.
out.turnFromRest = hullAvoidTurn({ velocity: [0, 0], forward: [1, 0], otherVelocity: [0, -3], rel: [10, 0] });

// The plan's point: the line along the turn leaves the hull's box on its map.
function flatNav(size = 64) {
  const n = size * size;
  return { width: size, height: size, cellSize: 1, blocked: new Uint8Array(n).fill(CELL_FREE),
           heights: new Float32Array(n), normalY: new Float32Array(n).fill(1), maxLevel: 3 };
}
function driver(nav, { x = 32.5, z = -32.5, vx = 0, vz = 10, best = null } = {}) {
  return {
    playerId: 'me', team: 1, position: [x, 0, z], obstacles: [], route: { points: [] },
    vehicle: { kind: 'tank', drives: true, vehicleId: 'me', hullMaxSpeed: 12,
               drive: { state: { position: { x, y: 0, z }, velocity: { x: vx, y: 0, z: vz } } } },
    _nav: () => nav, _radius: () => 3, _vehicleForward: () => [0, 1],
    _hullAvoidBest: best,
  };
}
const nav = flatNav();
const best = { id: 'p:cross', t: 1.6, other: soldier('p:cross', 26.5, -12.5, 3, 0) };
let b = driver(nav, { best });
out.plan = planHullAvoid(b, 10);
// A wall two cells east of the hull bounds its box there.
const walled = flatNav();
for (let gz = 0; gz < 64; gz++) walled.blocked[gz * 64 + 36] = CELL_OBJECT;
b = driver(walled, { best: { ...best, other: soldier('p:cross', 38.5, -12.5, -3, 0) } });
out.planWalled = planHullAvoid(b, 0);
// On a blocked cell there is no box and no plan.
const blockedHere = flatNav();
blockedHere.blocked[32 * 64 + 32] = CELL_OBJECT;
out.planBlocked = planHullAvoid(driver(blockedHere, { best }), 0);
out.planNoBest = planHullAvoid(driver(nav), 0);

// The obstacle half for a driven hull: a friend standing 20 m ahead of a
// hull doing 10 m/s is planted at R_hull + R_object, under the hull's unit;
// the hull's own body is not.
b = driver(nav, { x: 0, z: 0 });
const planted = predictObstacles(b, [
  { id: 'p:stand', x: 0, z: 20, vx: 0, vz: 0, r: BOT_RADIUS },
  { id: 'h:me', x: 0, z: 0, vx: 0, vz: 10, r: 3 },
]);
out.hullPlant = { planted, obstacles: b.obstacles.map(o => ({ id: o.id, x: o.x, z: o.z, r: o.r, unit: o.unit, drop: o.drop })),
                  drives: drivesHull(b) };
// A still body whose circle the hull already stands in is not planted
// (INVENTION, the viewer's search cannot start inside one): a carrier's
// sphere 8 m off; the friend 20 m ahead still is.
b = driver(nav, { x: 0, z: 0 });
out.enclosed = predictObstacles(b, [
  { id: 'h:carrier', x: 0, z: 8, vx: 0, vz: 0, r: 139, spheres: [[0, 8], [0, 60]], sphereR: 26 },
  { id: 'p:stand', x: 0, z: 20, vx: 0, vz: 0, r: BOT_RADIUS },
]);
out.enclosedIds = b.obstacles.map(o => o.id);
// Its distance rule is `5 x maxSpeed + R`: kept at 60 m, dropped at 70 m once old.
const keep = driver(nav, { x: 0, z: 0 });
keep.obstacles = [{ x: 0, z: 60, r: 4, age: 20, unit: 'me', drop: 63 }, { x: 0, z: 70, r: 4, age: 20, unit: 'me', drop: 63 }];
ageObstacles(keep, 0, []);
out.hullDrop = keep.obstacles.map(o => o.z);
// A gunner's seat in a hull does not predict.
const gunner = driver(nav, { x: 0, z: 0 });
gunner.vehicle.drives = false;
out.gunner = predictObstacles(gunner, [{ id: 'p:stand', x: 0, z: 20, vx: 0, vz: 0, r: BOT_RADIUS }]);
// An aircraft's pilot runs the 3d avoid, not this one.
const pilot = driver(nav);
pilot.vehicle.kind = 'air';
out.pilot = drivesHull(pilot);

// A lone bot in a Daihatsu (Midway seed 3, t 307.13): at the helm its own
// unit 21.94 and the gunner's seat 67.28; in the gunner's seat its own 53.22
// and the free helm 35.56. `BBChangeLandingCraft` 0x085602b0 keeps the helm.
out.landing = {
  table: LANDING_TELEPORT,
  helm: teleportChangeUrgency({ where: 'root', selfU: 21.94, seats: [{ id: 'gunner', u: 67.28 }], landing: true }),
  helmTeleport: teleportChangeUrgency({ where: 'root', selfU: 21.94, seats: [{ id: 'gunner', u: 67.28 }] }),
  gunner: teleportChangeUrgency({ where: 'seatShip', rootU: 35.56, selfU: 53.22, seats: [], landing: true }),
  // No order factor and no no-order urgency on a landing craft.
  gunnerNoOrder: teleportChangeUrgency({ where: 'seatShip', rootU: 35.56, selfU: 53.22, seats: [], landing: true,
                                         orderFactor: 0.75 }),
  stayNoPlan: teleportChangeUrgency({ where: 'root', selfU: 30, seats: [{ id: 'gunner', u: 40 }], landing: true,
                                      attackSplit: 0, hasPlan: false, pending: true }),
};

process.stdout.write(JSON.stringify(out));
