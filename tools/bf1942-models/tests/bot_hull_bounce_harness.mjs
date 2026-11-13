// A bot-driven hull pressed nose-first on a wall it bounces on
// (features/bot-map-generation/hull-steering.md, cause 2), under node, for
// tests/test_bot_hull_shuffle.py. Prints one JSON object.
//
// The page's hull pressed on a wall the vehicle map leaves open does not
// stand still on the trace: the contact response bounces it, and its
// velocity reads 0.5 to 2 m/s tick to tick while it stays where it is. The
// obstruction count and the touch rule both wanted the hull under 1 m/s, so
// a bounce zeroed them every second or two. `hullTravelSpeed` gives them
// the lower of the velocity and the ground covered over the last second.

import { trackObstruction, trackHullContact, onObstructed, ensureRoute, extendRoute, popPassed, lookAhead, predictObstacles,
         execInfantryMoveTo, steerToward, hullTravelSpeed, HULL_TRAVEL_WINDOW, backOutDecision } from './bot-route.js';
import { CELL_FREE, CELL_OBJECT, COARSE_CELL } from './nav-map.js';
import { findStrategicPath } from './nav-search.js';

const out = {};
const r3 = v => Math.round(v * 1000) / 1000;

function flatNav(size = 200) {
  const n = size * size;
  return { width: size, height: size, cellSize: 1, blocked: new Uint8Array(n).fill(CELL_FREE),
           heights: new Float32Array(n), normalY: new Float32Array(n).fill(1) };
}

function hullBot(nav, x, z, yaw, vehicleId = 'hull-1') {
  const state = { velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } };
  const bot = {
    position: [x, 0, z], yaw, obstacles: [], route: null, _pathFailures: 0, _now: 0,
    _stalledTicks: 0, moveForward: 0, moveStrafe: 0,
    vehicle: { kind: 'tank', drives: true, vehicleId, maxSpeed: 8, turnRadius: 5, drive: { state, hullContacts: [] } },
    hull: { yaw, speed: 0 },
    _nav: () => nav, _radius: () => 3, _player: () => null,
    _vehicleForward: () => [Math.sin(bot.hull.yaw), Math.cos(bot.hull.yaw)],
    _ensureRoute: goal => ensureRoute(bot, goal), _extendRoute: () => extendRoute(bot),
    _popPassed: () => popPassed(bot), _lookAhead: () => lookAhead(bot),
    _trackObstruction: (speed, dt) => trackObstruction(bot, speed, dt),
    _onObstructed: () => onObstructed(bot),
    _steerToward: (px, pz, speed) => steerToward(bot, px, pz, speed),
  };
  return bot;
}
/** The velocity a pressed hull reports: 0.7 and 1.8 m/s by turns of 8 ticks. */
const bounce = t => (Math.floor(t / 8) % 2 ? 1.8 : 0.7);

// --- The speed itself -----------------------------------------------------------
{
  const nav = flatNav();
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  const seen = [];
  for (let t = 0; t < 60; t++) { b._now = t / 30; seen.push(hullTravelSpeed(b, bounce(t))); }
  // Moving at 3 m/s along its heading, it reads its speed.
  const m = hullBot(nav, 100.5, -100.5, Math.PI);
  let moving = null;
  for (let t = 0; t < 60; t++) { m._now = t / 30; m.position = [100.5, 0, -100.5 - 3 * t / 30]; moving = hullTravelSpeed(m, 3); }
  // A new seat starts afresh: the body's speed stands until the window fills.
  b.vehicle.vehicleId = 'hull-2';
  b._now = 61 / 30;
  const fresh = hullTravelSpeed(b, 1.8);
  out.speed = { first: r3(seen[0]), atWindow: r3(seen[Math.round(HULL_TRAVEL_WINDOW * 30)]), last: r3(seen[59]), moving: r3(moving), fresh: r3(fresh) };
}

// --- The count and the touch rule, bounced -----------------------------------------
//
// Held at full throttle, its velocity bouncing, a wall contact ahead of it:
// fed the velocity the count never reaches the flag and the touch rule never
// holds; fed the travel speed both do.
function pressed(useTravel) {
  const nav = flatNav();
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  b.route = { goal: [100.5, -140.5], points: [[100.5, -140.5]], coarse: [], failed: false };
  let flaggedAt = null, touchedAt = null;
  b._onObstructed = () => { if (flaggedAt === null) flaggedAt = Math.round(b._now * 30); };
  for (let t = 0; t < 300; t++) {
    b._now = t / 30;
    b._noVisiblePoint = false;
    b.moveForward = 1;
    b.vehicle.drive.hullContacts = [{ x: 100.5, y: 0, z: -103.6, normal: [0, 0, 1], normalY: 0 }];
    const v = bounce(t);
    const speed = useTravel ? hullTravelSpeed(b, v) : v;
    if (trackHullContact(b, speed, 1 / 30) && touchedAt === null) touchedAt = t;
    trackObstruction(b, speed, 1 / 30);
  }
  return { flaggedAt, touchedAt };
}
out.pressedVelocity = pressed(false);
out.pressedTravel = pressed(true);

// --- The back-out, astern (cause 3) ------------------------------------------------
//
// A hull heading -z with its back-out point 5 m astern and a little to its
// right reverses to it; with the point ahead, or a plain route point astern,
// the turn in the box decides as before (null).
{
  const nav = flatNav();
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  const astern = [101.5, -95.6];
  b.route = { goal: [100.5, -140.5], points: [astern, [100.5, -140.5]], backOut: astern, coarse: [], failed: false };
  const f = b._vehicleForward();
  const v = { x: 0, y: 0, z: 0 };
  const back = backOutDecision(b, astern[0] - 100.5, astern[1] + 100.5, f, v);
  const ahead = [100.5, -105.5];
  b.route = { goal: [100.5, -140.5], points: [ahead, [100.5, -140.5]], backOut: ahead, coarse: [], failed: false };
  const fwd = backOutDecision(b, 0, -5, f, v);
  b.route = { goal: [100.5, -140.5], points: [astern, [100.5, -140.5]], backOut: null, coarse: [], failed: false };
  const plain = backOutDecision(b, astern[0] - 100.5, astern[1] + 100.5, f, v);
  out.backOut = { drive: back?.drive ?? null, angle: back ? r3(back.angle) : null, ahead: fwd, plain };
}

// --- A hull walled in by its own circles forgets them (cause 4) ------------------------
//
// Four of its circles round it and a failed route: at the second failure in
// a row its own circles go when the route is retried; a soldier's and a
// predicted circle stay. One failure is not enough.
function walled(failures) {
  const nav = flatNav();
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) b.obstacles.push({ x: 100.5 + dx, z: -100.5 + dz, r: 4.5, age: 0, unit: 'hull-1' });
  b.obstacles.push({ x: 120, z: -120, r: 2.5, age: 0, id: 'p:x', unit: null });
  b.obstacles.push({ x: 130, z: -130, r: 1.5, age: 0 });
  b.route = { goal: [100.5, -125.5], points: [], coarse: [], failed: true };
  b._pathFailures = failures;
  b._now = 10;
  b._routeRetryAt = 0;
  const route = ensureRoute(b, [100.5, 0, -125.5]);
  return { left: b.obstacles.length, route: !!route && !route.failed && route.points.length > 0 };
}
out.walledOnce = walled(1);
out.walledTwice = walled(2);

// --- ... and does not plant them again at once -------------------------------------
//
// A still hull 6 m ahead, planted as a predicted circle that walls the hull
// in with the map's own paint: the second failure forgets it, and the
// prediction leaves that body alone for the life of a potential obstacle
// (10 s), then may plant it again. Another body is planted as ever.
{
  const nav = flatNav();
  for (let gz = 90; gz <= 112; gz++) for (const gx of [96, 104]) nav.blocked[gz * nav.width + gx] = CELL_OBJECT;
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  b.world = null;
  b.vehicle.drive.state.velocity.z = -2;
  const parked = { id: 'h:parked', x: 100.5, z: -106.5, vx: 0, vz: 0, r: 3, mass: 1 };
  const other = { id: 'h:other', x: 100.5, z: -108.5, vx: 0, vz: 0, r: 3, mass: 1 };
  const first = predictObstacles(b, [parked]);
  b.route = { goal: [100.5, -125.5], points: [], coarse: [], failed: true };
  b._pathFailures = 2;
  b._now = 10;
  b._routeRetryAt = 0;
  ensureRoute(b, [100.5, 0, -125.5]);
  const left = b.obstacles.length;
  b._now = 12;
  const soon = predictObstacles(b, [parked]);
  const otherBody = predictObstacles(b, [parked, other]);
  b.obstacles = [];
  b._now = 20.5;
  const later = predictObstacles(b, [parked]);
  out.forgotten = { first, left, soon, otherBody, later };
}

// --- A path whose search failed waits for a new move (AI-189) ----------------------
//
// A soldier walled off from its goal by the map's paint: the leg search
// fails once. The same move does not search again however long it waits; a
// new move searches at once; so does the same move for a goal that moved.
{
  const nav = flatNav();
  for (let gx = 0; gx < nav.width; gx++) nav.blocked[105 * nav.width + gx] = CELL_OBJECT;
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  b.vehicle = null;
  b._radius = () => 1;
  const move = { waypoint: [100.5, 0, -110.5] }, next = { waypoint: [100.5, 0, -110.5] };
  const settle = () => { for (let i = 0; i < 12 && b.route && !b.route.failed; i++) extendRoute(b); };
  b._routeOwner = move;
  ensureRoute(b, move.waypoint); settle();
  const first = { failed: !!b.route?.failed, searchFailed: !!b.route?.searchFailed, failures: b._pathFailures };
  b._now = 60;
  const sameMove = ensureRoute(b, move.waypoint);
  const afterWait = b._pathFailures;
  b._routeOwner = next;
  ensureRoute(b, next.waypoint); settle();
  const newMove = b._pathFailures;
  ensureRoute(b, [100.5, 0, -131.5]); settle();   // more than `REPLAN_GOAL_MOVE` (20 m) on
  const movedGoal = b._pathFailures;
  out.failedPath = { first, sameMove, afterWait, newMove, movedGoal };
}

// --- A goal the map cannot reach, approached as far as it goes (cause 5) ---------------
//
// A 128 m painted map cut in two by a wall at x 60..68: from (20.5, -60.5)
// the goal (100.5, -60.5) is on the other side. Asked plainly the coarse
// layer has no path; with `nearest` it ends in the region nearest the goal
// on the start's side; and a hull's route takes it, a soldier's does not.
{
  const size = 128, n = size * size;
  const blocked = new Uint8Array(n).fill(CELL_FREE);
  for (let gz = 0; gz < size; gz++) for (let gx = 60; gx <= 68; gx++) blocked[gz * size + gx] = CELL_OBJECT;
  const per = COARSE_CELL, cw = Math.ceil(size / per), ch = Math.ceil(size / per);
  const free = new Uint8Array(cw * ch), freeCount = new Uint16Array(cw * ch);
  for (let gz = 0; gz < size; gz++) for (let gx = 0; gx < size; gx++) {
    if (blocked[gz * size + gx] !== CELL_FREE) continue;
    const c = Math.floor(gz / per) * cw + Math.floor(gx / per);
    free[c] = 1; freeCount[c]++;
  }
  const nav = { width: size, height: size, cellSize: 1, blocked, heights: new Float32Array(n), normalY: new Float32Array(n).fill(1),
                coarse: { free, freeCount, width: cw, height: ch, cellsPer: per, cellSize: per }, strategic: null };
  const plain = findStrategicPath(nav, 20.5, -60.5, 100.5, -60.5);
  const near = findStrategicPath(nav, 20.5, -60.5, 100.5, -60.5, { nearest: true });
  const hull = hullBot(nav, 20.5, -60.5, Math.PI / 2);
  const route = ensureRoute(hull, [100.5, 0, -60.5]);
  const soldier = hullBot(nav, 20.5, -60.5, Math.PI / 2);
  soldier.vehicle = null;
  const walk = ensureRoute(soldier, [100.5, 0, -60.5]);
  const last = near ? near[near.length - 1] : null;
  out.nearest = { plain, end: last ? last.map(r3) : null, short: !!near?.short, hullRoute: !!route && !route.failed, soldierRoute: !!walk && !walk.failed };
}

// --- The loop: a toy hull on a wall the map does not show ---------------------------
//
// The straight line from (100.5, -100.5) to (100.5, -130.5) runs into a 6 m
// wall across it at z -108 that the map leaves open. The toy drive is the
// wedge harness's (`bot_hull_wedge_harness.mjs`), but a hull held on the wall
// reports the bounce's velocity, not zero, and a contact on its bow.
function toyWall(seconds = 60) {
  const nav = flatNav();
  const b = hullBot(nav, 100.5, -100.5, Math.PI);
  const goal = [100.5, 0, -130.5];
  const action = { type: 'InfanteryMoveTo', waypoint: goal, arrive: 3 };
  const HW = 1.5, HL = 3.0, DT = 1 / 30;
  // `lead` 1 or -1 tests only the end the hull moves toward: a body is not
  // held by a wall it backs away from.
  const wallHit = (x, z, yaw, lead = 0) => {
    const f = [Math.sin(yaw), Math.cos(yaw)], l = [f[1], -f[0]];
    for (const [a, c] of [[HL, HW], [HL, -HW], [-HL, HW], [-HL, -HW], [HL, 0], [-HL, 0], [0, HW], [0, -HW]]) {
      if (lead && !(a * lead > 0)) continue;
      const px = x + a * f[0] + c * l[0], pz = z + a * f[1] + c * l[1];
      if (pz < -107.5 && pz > -108.5 && px > 97.5 && px < 103.5) return [px, pz];
    }
    return null;
  };
  let arrivedAt = null, heldMax = 0, held = 0, ticksOnWall = 0;
  for (let t = 0; t < seconds * 30; t++) {
    b._now = t * DT;
    if (execInfantryMoveTo(b, action, DT)) { arrivedAt = r3(t * DT); break; }
    const h = b.hull;
    const want = b.moveForward * 8 * (1 - 0.85 * Math.abs(b.moveStrafe));
    h.speed += Math.max(-6 * DT, Math.min(6 * DT, want - h.speed));
    const yawRate = -b.moveStrafe * 1.2;
    let [x, z] = [b.position[0], b.position[2]];
    const ny = h.yaw + yawRate * DT;
    if (!wallHit(x, z, ny)) h.yaw = ny;
    const f = [Math.sin(h.yaw), Math.cos(h.yaw)];
    const nx = x + f[0] * h.speed * DT, nz = z + f[1] * h.speed * DT;
    const hit = wallHit(nx, nz, h.yaw, Math.sign(h.speed));
    let reported = h.speed;
    if (!hit) { x = nx; z = nz; } else { reported = Math.sign(h.speed || 1) * bounce(t); ticksOnWall++; }
    b.position = [x, 0, z];
    b.yaw = h.yaw;
    b.vehicle.drive.state.velocity = { x: f[0] * reported, y: 0, z: f[1] * reported };
    b.vehicle.drive.state.angularVelocity = { x: 0, y: yawRate, z: 0 };
    b.vehicle.drive.hullContacts = hit ? [{ x: hit[0], y: 0, z: hit[1], normal: [0, 0, 1], normalY: 0 }] : [];
    if (hit && Math.abs(b.moveForward) > 0.5) { held += DT; heldMax = Math.max(heldMax, held); } else held = 0;
  }
  return { arrivedAt, heldMax: r3(heldMax), ticksOnWall, circles: b.obstacles.length, end: [r3(b.position[0]), r3(b.position[2])] };
}
out.toyWall = toyWall();

console.log(JSON.stringify(out));
