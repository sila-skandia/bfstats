// A bot-driven wheeled hull nosed into a pocket with its point behind it
// (features/bot-map-generation/hull-steering.md, cause 1), under node, for
// tests/test_bot_hull_shuffle.py. Prints one JSON object.
//
// FH's and FHSW's Pegasus park their RedTractor nose-in to a pocket six
// metres wide. `actionStatusDecision` sends it forward (state 9) while the
// run ahead beats the turn radius and back (state 8) while it does not, so
// it shuffles across that line; each change of pedal is a second or more of
// the wheeled drivetrain braking its revs through zero, the hull barely
// moves either way, and the obstruction count, which counted a forward
// throttle only, was zeroed by every reverse tick. The pieces here are
// `viewer/bot-route.js`'s: the count (`trackObstruction`), the hull's
// obstructed circle (`onObstructed`) and the real move executor driving a
// toy front-steered hull with a pedal reversal that has to spin its revs
// through zero first.

import { trackObstruction, onObstructed, ensureRoute, extendRoute, popPassed, lookAhead, execInfantryMoveTo, steerToward } from './bot-route.js';
import { CELL_FREE, CELL_OBJECT as CELL_BLOCKED } from './nav-map.js';

const out = {};
const r3 = v => Math.round(v * 1000) / 1000;

/** A 200 m map, free everywhere but the block west of x = 104 m, which is
 *  cut by a pocket: free x 97..104, viewer z -100..-96 (the vehicle map's
 *  paint: where the hull's centre may stand). */
function pocketNav() {
  const size = 200, n = size * size;
  const blocked = new Uint8Array(n).fill(CELL_FREE);
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const x = gx + 0.5, z = -(gz + 0.5);
      const inPocket = x >= 97 && z <= -96 && z >= -100;
      if (x < 104 && x > 60 && z < -80 && z > -120 && !inPocket) blocked[gz * size + gx] = CELL_BLOCKED;
    }
  }
  return { width: size, height: size, cellSize: 1, maxLevel: 2, blocked, heights: new Float32Array(n), normalY: new Float32Array(n).fill(1) };
}
/** The walls themselves: the paint grown by its 1.5 m brush (what the
 *  generated Pegasus maps were painted with). */
function physicallyFree(x, z) {
  if (!(x < 104 + 1.5 && x > 60 - 1.5 && z < -80 + 1.5 && z > -120 - 1.5)) return true;
  return x >= 97 - 1.5 && z <= -96 + 1.5 && z >= -100 - 1.5;
}

function hullBot(nav, x, z, yaw) {
  const state = { velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } };
  const bot = {
    position: [x, 0, z], yaw, obstacles: [], route: null, _pathFailures: 0, _now: 0,
    _stalledTicks: 0, moveForward: 0, moveStrafe: 0, playerId: 'p1',
    vehicle: { kind: 'ground', drives: true, vehicleId: 'tractor', maxSpeed: 7, turnRadius: 5, drive: { state, hullContacts: [] } },
    hull: { yaw, speed: 0, revs: 0 },
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

// --- The count, either pedal ---------------------------------------------------
//
// A hull held still while its pedal changes sign every 1.5 s: the flag
// (151 ticks) and the path failure (401) come all the same. A soldier's
// count is as it was.
function shuffleCount({ onFoot = false } = {}) {
  const nav = pocketNav();
  const b = hullBot(nav, 150.5, -150.5, Math.PI);
  if (onFoot) b.vehicle = null;
  b.route = { goal: [150.5, -180.5], points: [[150.5, -180.5]], coarse: [], failed: false };
  let flaggedAt = null, failedAt = null;
  b._onObstructed = () => { if (flaggedAt === null) flaggedAt = Math.round(b._now * 30); };
  for (let t = 0; t < 600 && failedAt === null; t++) {
    b._now = t / 30;
    b._noVisiblePoint = false;
    b.moveForward = Math.floor(t / 45) % 2 ? -1 : 1;
    if (onFoot && b.moveForward < 0) b.moveForward = 0;
    if (trackObstruction(b, 0, 1 / 30)) failedAt = t;
  }
  return { flaggedAt, failedAt };
}
out.countHull = shuffleCount();
out.countSoldier = shuffleCount({ onFoot: true });

// --- The circle goes at the short end ------------------------------------------
//
// The hull in the pocket heading west (into it), its pedal in reverse at the
// flag: the circle is planted ahead, where the map's run is short, not astern
// where the pedal points. On open ground the pedal still decides.
function flagged({ x, z, yaw, throttle }) {
  const nav = pocketNav();
  const b = hullBot(nav, x, z, yaw);
  b.moveForward = throttle;
  b.route = { goal: [x + 20, z], points: [[x + 20, z]], coarse: [], failed: false };
  onObstructed(b);
  return { obstacles: b.obstacles.map(o => [r3(o.x - x), r3(o.z - z), r3(o.r)]), backOut: !!b._backOut };
}
out.flagPocketReversing = flagged({ x: 100.5, z: -98, yaw: -Math.PI / 2, throttle: -1 });
out.flagPocketForward = flagged({ x: 100.5, z: -98, yaw: -Math.PI / 2, throttle: 1 });
out.flagOpenReversing = flagged({ x: 150.5, z: -150.5, yaw: -Math.PI / 2, throttle: -1 });

// --- The loop: the tractor in its pocket ---------------------------------------
//
// The toy drive: the revs follow the pedal at 0.7 a second (the wheeled
// drivetrain's filter, TANK-12: an opposing pedal brakes until they cross
// zero), speed follows `revs x 7 m/s` at 3 m/s^2, the front wheels turn the
// hull at `speed / 5 m` per unit of lock, and a step that would put a corner
// of the 2.2 x 4.4 m body through a wall is refused.
function pocket(seconds = 90) {
  const nav = pocketNav();
  const b = hullBot(nav, 101.5, -98, -Math.PI / 2);
  const goal = [125.5, 0, -98];
  const action = { type: 'InfanteryMoveTo', waypoint: goal, arrive: 3 };
  const HW = 1.1, HL = 2.2, DT = 1 / 30;
  const fits = (x, z, yaw) => {
    const f = [Math.sin(yaw), Math.cos(yaw)], l = [f[1], -f[0]];
    for (const [a, c] of [[HL, HW], [HL, -HW], [-HL, HW], [-HL, -HW], [HL, 0], [-HL, 0]]) {
      if (!physicallyFree(x + a * f[0] + c * l[0], z + a * f[1] + c * l[1])) return false;
    }
    return true;
  };
  let arrivedAt = null, flips = 0, lastSign = 0, leftPocketAt = null;
  for (let t = 0; t < seconds * 30; t++) {
    b._now = t * DT;
    if (execInfantryMoveTo(b, action, DT)) { arrivedAt = r3(t * DT); break; }
    const h = b.hull;
    const cmd = Math.max(-1, Math.min(1, b.moveForward));
    if (Math.sign(cmd) && Math.sign(cmd) !== lastSign) { flips++; lastSign = Math.sign(cmd); }
    h.revs += Math.max(-0.7 * DT, Math.min(0.7 * DT, cmd - h.revs));
    const want = h.revs * 7;
    h.speed += Math.max(-3 * DT, Math.min(3 * DT, want - h.speed));
    const yawRate = -b.moveStrafe * h.speed / 5;
    let [x, z] = [b.position[0], b.position[2]];
    const yaw = h.yaw + yawRate * DT;
    if (fits(x, z, yaw)) h.yaw = yaw;
    const f = [Math.sin(h.yaw), Math.cos(h.yaw)];
    const nx = x + f[0] * h.speed * DT, nz = z + f[1] * h.speed * DT;
    // Blocked, the body slides along the wall on one axis when that is free
    // (`sim/vehicles.mjs SimDrive`'s rule), else stops.
    if (fits(nx, nz, h.yaw)) { x = nx; z = nz; }
    else if (fits(nx, z, h.yaw)) { x = nx; h.speed *= 0.5; }
    else if (fits(x, nz, h.yaw)) { z = nz; h.speed *= 0.5; }
    else h.speed = 0;
    b.position = [x, 0, z];
    b.yaw = h.yaw;
    const fv = [Math.sin(h.yaw), Math.cos(h.yaw)];
    b.vehicle.drive.state.velocity = { x: fv[0] * h.speed, y: 0, z: fv[1] * h.speed };
    b.vehicle.drive.state.angularVelocity = { x: 0, y: yawRate, z: 0 };
    if (leftPocketAt === null && x > 106) leftPocketAt = r3(t * DT);
  }
  return { arrivedAt, leftPocketAt, flips, end: [r3(b.position[0]), r3(b.position[2])], circles: b.obstacles.length };
}
out.pocket = pocket();

console.log(JSON.stringify(out));
