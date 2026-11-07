// A bot-driven hull wedged on a prop the vehicle map does not show
// (features/browser-play-feedback-2026-11-06 #5), under node, for
// tests/test_bot_hull_wedge.py. Prints one JSON object.
//
// The pieces are `viewer/bot-route.js`'s: the hull touch rule
// (`trackHullContact`), the hull's obstructed flag (`onObstructed`), the
// obstruction counts kept across a re-plan (`ensureRoute`,
// `trackObstruction`), the back-out point (`ensureRoute`, `lookAhead`,
// `popPassed`) and `hullDecision`'s circles. The last case closes the loop:
// the real move executor, `actionStatusDecision` and `tankControl` drive a
// toy hull (a 3 x 6 m box that cannot pass through a 0.4 m barrel, and
// reports its contact the way `drive.hullContacts` does) on an open map
// toward a goal whose straight line puts the hull's corner on the barrel.

import {
  trackHullContact, trackObstruction, onObstructed, ensureRoute, extendRoute, popPassed, lookAhead,
  execInfantryMoveTo, steerToward, hullDecision, BOT_RADIUS,
} from './bot-route.js';
import { CELL_FREE } from './nav-map.js';
import { resolveClearStart } from './nav-grid.js';

const out = {};
const r3 = v => Math.round(v * 1000) / 1000;

function flatNav(size = 200) {
  const n = size * size;
  return { width: size, height: size, cellSize: 1, blocked: new Uint8Array(n).fill(CELL_FREE),
           heights: new Float32Array(n), normalY: new Float32Array(n).fill(1) };
}
const cellCentre = (gx, gz) => [gx + 0.5, -(gz + 0.5)];

/** A driven hull at `(x, z)` heading `yaw` (forward `[sin, cos]`) on `nav`,
 *  every bot method the module's own function. `hull.speed` and
 *  `hull.yawRate` are the toy drive's state. */
function hullBot(nav, x, z, yaw) {
  const state = { velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } };
  const bot = {
    position: [x, 0, z], yaw, obstacles: [], route: null, _pathFailures: 0, _now: 0,
    _stalledTicks: 0, moveForward: 0, moveStrafe: 0,
    vehicle: { kind: 'tank', drives: true, vehicleId: 'hull-1', maxSpeed: 8, turnRadius: 5,
               drive: { state, hullContacts: [] } },
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

// --- The touch rule ----------------------------------------------------------
//
// A hull at (100.5, -100.5) heading -z (yaw pi), throttle on, standing still,
// its front-right corner on something at (101.7, -103.4).
const nav = flatNav();
const contact = (x, z, normalY = 0) => ({ x, y: 0, z, normal: [0, normalY, 1], normalY });
function touched(contacts, { speed = 0, throttle = 1, ticks = 12 } = {}) {
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  b.route = { goal: [x, z - 40], points: [[x, z - 40]], coarse: [], failed: false };
  let plantedAt = null;
  for (let t = 0; t < ticks; t++) {
    b.moveForward = throttle;
    b.vehicle.drive.hullContacts = contacts;
    if (trackHullContact(b, speed, 1 / 30) && plantedAt === null) plantedAt = t;
  }
  return { plantedAt, obstacles: b.obstacles.map(o => [r3(o.x), r3(o.z), r3(o.r)]), failed: !!b.route?.failed,
           backOut: !!b._backOut };
}
const wall = contact(101.7, -103.4);
out.touch = touched([wall]);
// A belly on the ground is no obstacle (the soldier rule's wall test).
out.touchFloor = touched([contact(101.7, -103.4, 0.97)]);
// Behind the way it pushes: the rule waits for a contact it is driving into.
out.touchBehind = touched([wall], { throttle: -1 });
// Moving: the hull is not held.
out.touchMoving = touched([wall], { speed: 3 });
// No throttle: a hull at rest against a prop is not pushing on it.
out.touchIdle = touched([wall], { throttle: 0 });
// Held again on the same contact once the circle is there: no second circle,
// and the route is not failed a second time.
{
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  b.route = { goal: [x, z - 40], points: [[x, z - 40]], coarse: [], failed: false };
  const first = [];
  for (let t = 0; t < 12; t++) { b.moveForward = 1; b.vehicle.drive.hullContacts = [wall]; first.push(trackHullContact(b, 0, 1 / 30)); }
  b.route.failed = false;
  let again = 0;
  for (let t = 0; t < 60; t++) { b.moveForward = 1; b.vehicle.drive.hullContacts = [contact(101.6, -103.3)]; if (trackHullContact(b, 0, 1 / 30)) again++; }
  out.touchAgain = { planted: first.filter(Boolean).length, again, circles: b.obstacles.length, failed: b.route.failed };
}

// --- The obstructed flag for a hull -------------------------------------------
//
// Sized and placed for the hull, along its heading (not the turret's look,
// `bot.yaw`), behind it while it reverses; a hull running fine only
// re-plans.
function obstructed({ throttle = 1, speed = 0, look = 0 } = {}) {
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  b.yaw = look;
  b.moveForward = throttle;
  b.vehicle.drive.state.velocity = { x: 0, y: 0, z: -speed };
  b.route = { goal: [x, z - 40], points: [[x, z - 40]], coarse: [], failed: false };
  onObstructed(b);
  return { obstacles: b.obstacles.map(o => [r3(o.x - x), r3(o.z - z), r3(o.r)]), failed: b.route.failed, backOut: !!b._backOut };
}
out.obstructedAhead = obstructed({ look: 1.0 });
out.obstructedReversing = obstructed({ throttle: -1 });
out.obstructedMoving = obstructed({ speed: 4 });
// A soldier's flag is as it was: 1.5 m, a metre along his look.
{
  const b = { position: [10, 0, 10], yaw: Math.PI / 2, vehicle: null, obstacles: [], route: { failed: false } };
  onObstructed(b);
  out.obstructedSoldier = { obstacles: b.obstacles.map(o => [r3(o.x), r3(o.z), r3(o.r)]), failed: b.route.failed };
}

// --- The counts across a re-plan ----------------------------------------------
//
// `ObstructionDetection::update` 0x08532b00's count: a hull held at full
// throttle re-plans at the obstructed flag (150 ticks, the viewer's own
// re-plan) and still fails the path at 401. A soldier's re-plan resets it,
// as before.
function counts(onFoot) {
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  if (onFoot) b.vehicle = null;
  const goal = [x, 0, z - 30];
  let failedAt = null, replans = 0;
  for (let t = 0; t < 600 && failedAt === null; t++) {
    b._now = t / 30;
    b._noVisiblePoint = false;
    b.moveForward = 1;
    if (!b.route || b.route.failed) { ensureRoute(b, goal); replans++; }
    if (trackObstruction(b, 0, 1 / 30)) failedAt = t;
  }
  return { failedAt, replans };
}
out.countsHull = counts(false);
out.countsSoldier = counts(true);
// A new path for any other reason (the goal moved, the path failed) starts
// the count again, as `initPathfinding` 0x0852a0d0 zeroes it.
{
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  ensureRoute(b, [x, 0, z - 30]);
  for (let t = 0; t < 100; t++) { b._noVisiblePoint = false; b.moveForward = 1; trackObstruction(b, 0, 1 / 30); }
  const before = Math.round(b._stalledTicks);
  ensureRoute(b, [x + 24, 0, z - 12]);
  out.countsGoalMove = { before, after: Math.round(b._stalledTicks) };
}

// --- The back-out point -----------------------------------------------------
//
// The hull wedged as in `touch` (a 4.5 m circle on its front-right corner):
// the next route starts at the nearest free point outside the circle, behind
// the hull, and the hull steers at it until it stands clear.
{
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  b.obstacles.push({ x: 101.7, z: -103.4, r: 4.5, age: 0, unit: 'hull-1' });
  b._backOut = true;
  const route = ensureRoute(b, [x, 0, z - 30]);
  const first = route.points[0];
  const f = b._vehicleForward();
  const rel = [first[0] - x, first[1] - z];
  const steerAt = lookAhead(b);
  popPassed(b);
  const keptInside = b.route.points[0] === first;
  // Once the hull stands outside the circle the point goes.
  b.position = [first[0], 0, first[1]];
  popPassed(b);
  out.backOut = {
    first: first.map(r3), behind: r3(rel[0] * f[0] + rel[1] * f[1]),
    clearOfCircle: r3(Math.hypot(first[0] - 101.7, first[1] + 103.4)),
    steersAtIt: steerAt === first, keptInside, droppedOnceClear: b.route.points[0] !== first,
    resolvedStart: resolveClearStart(nav, x, z, b.obstacles)?.map(r3) ?? null,
    noBackOutAsked: (() => { const c = hullBot(nav, x, z, Math.PI); c.obstacles = b.obstacles.slice(); return ensureRoute(c, [x, 0, z - 30]).backOut; })(),
  };
}

// --- The decision inside a circle -------------------------------------------
//
// A hull whose centre stands inside a circle on its bow, its point behind
// it: whole, the circle failed every run from inside it and the decision
// could only turn in place; trimmed to the part nearer than the hull, the
// run astern is open and the decision backs out (state 8, drive -1).
{
  const [x, z] = cellCentre(100, 100);
  const b = hullBot(nav, x, z, Math.PI);
  b.obstacles.push({ x, z: z - 2.5, r: 4.5, age: 0 });
  b._asd = { state: 8 };
  const d = hullDecision(b, 0, 10, 0);
  out.decisionInside = { state: d.state, drive: d.drive };
}

// --- The loop: a toy hull on a barrel -----------------------------------------
//
// The straight line from (100.5, -100.5) to (100.5, -130.5) puts the hull's
// front-right corner on a 0.4 m barrel at (101.7, -110.5) that the map does
// not show. The toy drive: speed toward `throttle x 8 m/s x (1 - 0.85 |steer|)`
// at 6 m/s^2 (a tank turning on the spot creeps), yaw rate `-steer x 1.2`
// rad/s, and a step that would put the barrel inside the 3 x 6 m box is
// refused (translation and rotation tried apart, so the hull can still turn
// or slide off it), the box's nearest point published as a hull contact.
function toyWedge(seconds = 40) {
  const [sx, sz] = cellCentre(100, 100);
  const [gx, gz] = cellCentre(100, 130);
  const barrel = { x: 101.7, z: -110.5, r: 0.4 };
  const b = hullBot(nav, sx, sz, Math.PI);
  const action = { type: 'InfanteryMoveTo', waypoint: [gx, 0, gz], arrive: 3 };
  const HALF_W = 1.5, HALF_L = 3.0, DT = 1 / 30;
  const nearest = (x, z, yaw) => {
    const f = [Math.sin(yaw), Math.cos(yaw)], l = [f[1], -f[0]];
    const dx = barrel.x - x, dz = barrel.z - z;
    const a = Math.max(-HALF_L, Math.min(HALF_L, dx * f[0] + dz * f[1]));
    const c = Math.max(-HALF_W, Math.min(HALF_W, dx * l[0] + dz * l[1]));
    const px = x + a * f[0] + c * l[0], pz = z + a * f[1] + c * l[1];
    return { px, pz, d: Math.hypot(barrel.x - px, barrel.z - pz) };
  };
  let touchedTicks = 0, pressed = 0, maxPressed = 0, reversed = false, arrivedAt = null, done = false;
  let circles = 0, circleR = null;
  for (let t = 0; t < seconds * 30 && !done; t++) {
    b._now = t * DT;
    done = execInfantryMoveTo(b, action, DT);
    if (done) { arrivedAt = r3(t * DT); break; }
    // The toy drive.
    const throttle = b.moveForward, steer = b.moveStrafe;
    const want = throttle * 8 * (1 - 0.85 * Math.abs(steer));
    const h = b.hull;
    h.speed += Math.max(-6 * DT, Math.min(6 * DT, want - h.speed));
    const yawRate = -steer * 1.2;
    let [x, z] = [b.position[0], b.position[2]];
    let yaw = h.yaw;
    const ny = yaw + yawRate * DT;
    if (nearest(x, z, ny).d >= barrel.r) yaw = ny;
    const f = [Math.sin(yaw), Math.cos(yaw)];
    const nx = x + f[0] * h.speed * DT, nz = z + f[1] * h.speed * DT;
    if (nearest(nx, nz, yaw).d >= barrel.r) { x = nx; z = nz; } else h.speed = 0;
    h.yaw = yaw;
    b.position = [x, 0, z];
    b.yaw = yaw;
    const st = b.vehicle.drive.state;
    st.velocity = { x: f[0] * h.speed, y: 0, z: f[1] * h.speed };
    st.angularVelocity = { x: 0, y: yawRate, z: 0 };
    const n = nearest(x, z, yaw);
    b.vehicle.drive.hullContacts = n.d < barrel.r + 0.05
      ? [{ x: n.px, y: 0, z: n.pz, normal: [0, 0, 0], normalY: 0 }] : [];
    if (b.vehicle.drive.hullContacts.length) touchedTicks++;
    if (Math.abs(throttle) > 0.5 && Math.abs(h.speed) < 0.5) { pressed += DT; maxPressed = Math.max(maxPressed, pressed); } else pressed = 0;
    if (throttle < -0.1) reversed = true;
    const c = b.obstacles.filter(o => o.unit === 'hull-1');
    if (c.length > circles) { circles = c.length; circleR = r3(c[0].r); }
  }
  return { arrivedAt, touchedTicks, maxPressed: r3(maxPressed), reversed, circles, circleR,
           end: [r3(b.position[0]), r3(b.position[2])], goal: [gx, gz], botRadius: BOT_RADIUS };
}
out.toyWedge = toyWedge();

console.log(JSON.stringify(out));
