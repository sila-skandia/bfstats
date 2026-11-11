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

import { trackObstruction, trackHullContact, onObstructed, ensureRoute, extendRoute, popPassed, lookAhead,
         execInfantryMoveTo, steerToward, hullTravelSpeed, HULL_TRAVEL_WINDOW, backOutDecision } from './bot-route.js';
import { CELL_FREE } from './nav-map.js';

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
