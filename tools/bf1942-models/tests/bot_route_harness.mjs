// `viewer/bot-route.js predictObstacles` (a soldier's 5 s collision
// look-ahead, `BBAvoid::calculateUrgency` 0x0855c650, ledger AI-119) under
// node, for tests/test_bot_route.py. Prints one JSON object.

import { predictObstacles, ageObstacles, subSpheres2d, SOLDIER_AVOID, BOT_RADIUS } from './bot-route.js';

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

console.log(JSON.stringify(out));
