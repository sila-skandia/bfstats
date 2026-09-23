// Navigation: the engine's path follower (plain functions of the
// `BotController` in bot.js, which delegates its methods here), with the
// steering toward a path point for a soldier, a hull or a boat and the
// InfanteryMoveTo executor that drives it.
//
// `BotMain::Path` (+0x144) and its readers, from the 2026-09-23 binary read:
//
//  * `updateLocalPath` 0x08527120 refines the route a leg at a time: when
//    fewer than `getSmoothing()` followed points remain, the next coarse
//    point is popped and a boxed local A* (`IAIPathfinding::localSearch`
//    vtable +0x64, radius `10 + rand * 14`, the potential obstacles as
//    restrictions) appends its points.
//  * `getNewIntermediatePathPos` 0x0852ab60 steers at the farthest of the
//    next `getSmoothing()` points that `trace` (+0x50) can reach in a
//    straight line over the bitmap, and counts stalled ticks.
//  * `updatePath` 0x0852b8f0 / `checkAgainstPath` 0x0852bc40 / `stepInPath`
//    0x0852bee0 pop the front point once the body is inside its radius, or
//    has crossed the plane through it perpendicular to the look-ahead; the
//    last point is never popped. `reachedEndOfPath` 0x0852c000 is one point
//    left and the obstructed bit clear.
//  * `infanteryControlTowardsDirection` 0x08627000 turns the mouse toward
//    the point and throttles only inside a 31.5 deg cone.
//
// The coarse legs come from nav-grid.js's `findStrategicPath`: the level's
// own strategic map where it ships one (`strategic-map.js`, AI-117; the
// engine's `updateStrategicPath` 0x08526e60), else the painted coarse layer
// (INVENTION). A failed route is retried a few times with the obstacle
// circles and then walked straight at (INVENTION).

import { findLocalPath, findStrategicPath, traceClear, COARSE_CELL, freeLevel, isWalkable } from './nav-grid.js';
import { tankControl, TANK, actionStatusDecision, searchBox, checkLine } from './bot-vehicle.js';
import { boatControl, boatResetControls, PLANE, BOAT, collisionPredicted } from './bot-vehicle-air.js';
import { friendlyHulls } from './bot-pilot.js';
import { wrapAngle } from './bot-aim.js';

/** How close to a plain waypoint before it counts as reached. */
const WAYPOINT_REACH_RADIUS = 3.0;

/** A failed route is retried after this long, its local box wider by this
 *  much per failure (INVENTION: the engine's next search draws a fresh
 *  random radius on the next decision pass). */
const ROUTE_RETRY_AFTER = 1.5;
const ROUTE_RETRY_WIDEN = 16;
/** A leg that fails its box is retried this many times, each 16 m wider
 *  (to 120 m: the coarse legs are an INVENTION and can cross a compound's
 *  paint, which only a wide box routes around). */
const ROUTE_LEG_WIDENINGS = 6;
const ROUTE_LEG_WIDE_NODES = 20000;

/**
 * Path following, from the binary read
 * (features/bf1942-ai-research-2026-09-21/bot-movement-and-pathfinding.md).
 */
/** `ai.setSmoothing 1 10` (Gazala AIPathFinding.con; `AIPathfinding::getSmoothing`
 *  vtable +0x2c): the look-ahead cap in `BotMain::getNewIntermediatePathPos`
 *  0x0852ab60 — the bot steers at the farthest of the next N path points a
 *  map trace can reach — and the local-search trigger in `updateLocalPath`
 *  0x08527120: a new leg is refined once fewer than N points remain. */
const SMOOTHING = 10;
/** `updateLocalPath`: the local search box is `10 + rand * 14` metres, raised
 *  to the largest potential-obstacle radius, plus 1. */
const LOCAL_SEARCH_RADIUS_MIN = 10;
const LOCAL_SEARCH_RADIUS_RAND = 14;
/** The body radius a path point is popped inside (`checkAgainstPath`
 *  0x0852bc40 tests `(vehicle+0x24)->v(0x30)`, the AI object's radius).
 *  INVENTION: the soldier's value was not read; the engine floors the
 *  removal distance at 0.5 (`getMaxPathPosRemovalDistance` 0x0852b780). */
export const BOT_RADIUS = 1.0;
/** A land vehicle's body radius on its map when the page gives none (INVENTION). */
export const VEHICLE_RADIUS = 3.0;
/** The sign that maps the driving law's steer onto the viewer's `c_PIYaw`:
 *  the law's angle is `-(bearing - yaw)` and a positive `c_PIYaw` turns the
 *  hull toward -yaw (`ground.js`), so the steer passes straight through.
 *  Calibrated on El Alamein's Kubelwagen (2026-09-23). */
const VEHICLE_YAW_SIGN = 1;
/** The largest pyramid level a hull's box is taken at. `getLandLevel`
 *  0x085f3f90 walks from the vehicle's `+0xc4a8` down to its `+0xc4a4`,
 *  and `Vehicle::Vehicle` 0x0860b2c0 copies `+0xc4a8` from its `LocalMap`'s
 *  +0x28 (0x0860b41c), the map's `maxLevel` (`LocalMap::LocalMap`
 *  0x085fb590; `ai.addSearchMap`'s last argument, 2 unless given: `Tank0`
 *  2, `Boat2` 5). A map that carries it (every level's baked map, AI-102, AI-103)
 *  is boxed at its own; this cap stands in only for a painted map of a
 *  level with no search maps (INVENTION). A tank map's minimum level is 0
 *  (INFERRED from `ai.addSearchType Tank 0 0`); a water map's is its base
 *  level (AI-66). */
const HULL_BOX_MAX_LEVEL = 8;
/** Each hull's last valid position (`AIObjectMobile` +0x20..+0x2c, AI-94),
 *  kept on the hull (its scene node), not on the bot that drives it. */
const hullValid = new WeakMap();
/** `infanteryControlTowardsDirection` 0x08627000: throttle only when the
 *  target direction is within this angle of the facing (0.5497787 rad,
 *  31.5 deg), else stop and turn; a target behind turns at the full rate. */
const STEER_CONE = 0.5497787;
/** `getNewIntermediatePathPos`: stalled-tick counts. Bit 1 (obstructed) at
 *  `> 0x96` ticks, the path fails (state 3) at `>= 0x191`. A tick counts when
 *  no path point traces clear from the bot, or (`ObstructionDetection::update`
 *  0x08532b00) the bot is inside its removal distance of the goal and is
 *  neither moving at 1.0 m/s nor turning at 0.1 rad/s. The engine counts its
 *  30 Hz AI ticks; the page ticks bots once per display frame, so the count
 *  advances by `dt x 30` (5 s and 13.4 s whatever the frame rate). */
const OBSTRUCTED_TICKS = 150;
const PATH_FAIL_TICKS = 401;
/** The engine's AI tick rate, the unit of the counts above. */
const AI_TICK_HZ = 30;
/** `ObstructionDetection::update`: the speed that counts as moving. The viewer
 *  also counts a tick where the throttle is on and the body is under this
 *  speed anywhere on the route (INVENTION: the engine's collision prediction,
 *  `BBAvoid::calculateUrgency` 0x0855c650, is what keeps its bots off a body
 *  the map does not show; the viewer has no such layer yet). */
const MOVING_SPEED = 1.0;
/** A re-plan when the goal has moved more than four times the run speed
 *  (`BBPGotoWaypointSoldier::createPlan` 0x085bb660: `(4 * R)^2 < d^2`, R
 *  the template's `+8` max speed). `aiTemplatePlugIn.maxSpeed 5.0` in
 *  `Objects/Soldiers/Common/AI/Objects.con`. */
const REPLAN_GOAL_MOVE = 4 * 5.0;
/** A potential obstacle (`BotMain +0x170` entries `{x, z, r}`). The engine
 *  plants one on the object `BBAvoid::calculateUrgency` 0x0855c650 predicts a
 *  collision with inside the Mobile plug-in's `avoidCollisionLookAhead`
 *  (`predictObstacles` below: 5 s for soldiers too). Its radius is `R_bot +
 *  R_object` per sub-sphere (`addPotentialObstacle` 0x0852ceb0);
 *  `AIPathfinding`'s ctor 0x0847a780 zeroes `getPotentialObstacleMaxSpeed/
 *  MaxAge` and no level sets them, so only a stationary object qualifies and
 *  it is dropped once the bot is `5 * maxSpeed + R` = 25.5 m away. The
 *  viewer also plants one on the body's own hull contact (`Soldier.blocked`,
 *  `SoldierBody.contactNormal`) held for `CONTACT_TICKS` while the map says
 *  the way is clear, for what no AI object stands for (a static the map
 *  missed); that object's radius is not known, so a sandbag's stands in
 *  (INVENTION). */
const OBSTACLE_RADIUS = 1.5;
const OBSTACLE_AHEAD = 1.0;
const OBSTACLE_DROP_DISTANCE = 5 * 5.0 + 0.5;
const CONTACT_TICKS = 10;

/**
 * The soldier's collision prediction (`BBAvoid::calculateUrgency` 0x0855c650,
 * read 2026-09-24). The look-ahead is the Mobile plug-in's +0x2c
 * (`avoidCollisionLookAhead`, the console setter writes +0x2c at
 * 0x085039e9), 5.0 from both `AITemplateMobile` ctors (0x085e0bf0,
 * 0x085e0cb0) and set by no soldier template, so a soldier looks 5 s ahead
 * as a vehicle does (the viewer took it for 0 until AI-119). Each tick the
 * bot's own side's and the neutral objects within `lookAhead x speed + R` of
 * it (IAIEnvironment vt+0xdc for the side, then for 0) are tested with
 * `collisionPredicted` 0x0855d2f0 (relative position and velocity, the two
 * radii summed); one predicted to collide that stands still (its speed at
 * most `getPotentialObstacleMaxSpeed`, 0 on every level), or that touches
 * now, becomes a potential obstacle through
 * `addSlowMovingPathfindingObstacle` 0x0855d550, which also adds every
 * other such still object within `5 x maxSpeed + R_object` of it (the bot's
 * Mobile `maxSpeed`, 5 for a soldier).
 */
export const SOLDIER_AVOID = {
  lookAhead: 5.0,
  /** `getPotentialObstacleMaxSpeed`, 0 (`AIPathfinding` ctor 0x0847a780). */
  potentialObstacleMaxSpeed: 0,
  /** A body slower than this reads as still: the viewer's bodies drift a
   *  few mm/s at rest (INVENTION: the engine compares the exact speed). */
  stillSpeed: 0.05,
  /** The soldier template's `aiTemplatePlugIn.maxSpeed 5.0`. */
  maxSpeed: 5.0,
};

/** The bodies a soldier's prediction tests: own-side soldiers on foot and
 *  own-side or empty hulls (the bot's side's grid and the neutral one,
 *  IAIEnvironment vt+0xdc), `{ id, x, z, vx, vz, r }`. */
function avoidBodies(bot) {
  const out = [];
  for (const [id, p] of bot.world?.players ?? []) {
    if (id === bot.playerId || !p?.soldier || p.vehicle || p.team !== bot.team) continue;
    const s = p.soldier;
    if (bot.world?.armorOf?.(id)?.destroyed || !Number.isFinite(s.x)) continue;
    const v = s.speed ?? 0;
    out.push({ id: `p:${id}`, x: s.x, z: s.z, vx: v * Math.sin(s.yaw ?? 0), vz: v * Math.cos(s.yaw ?? 0), r: BOT_RADIUS });
  }
  // The hull the bot is walking to board is its plan's own target, not an
  // obstacle (INVENTION: how `BBPChange::createPlan`'s finding move treats
  // its object was not read).
  const target = bot.currentPlan?.vehicleId ?? null;
  for (const h of friendlyHulls(bot)) {
    if (!h.pos || !h.box) continue;
    if (target && (target === h.id || String(target).startsWith(`${h.id}:`))) continue;
    // The side's own grid and the neutral one: a hull with an enemy aboard
    // is on the enemy's (`friendlyHulls` keeps the known ones for the
    // pilot's avoid, which reads the same two grids at the plane's side).
    if (h.crew?.some(id => { const t = bot.world?.players?.get(id)?.team; return t !== undefined && t !== bot.team; })) continue;
    const st = h.drive?.state;
    const x = st?.position ? st.position.x : h.pos[0], z = st?.position ? st.position.z : h.pos[2];
    const b = h.box;
    // The hull's own heading from its node's quaternion, not its world
    // matrix: the matrix is refreshed by whatever last asked for it, which
    // is not always the sim tick, and seeded runs must replay.
    const q = h.node?.quaternion;
    const sub = subSpheres2d(b);
    const spheres = sub.points.map(([lx, lz]) => {
      if (!q) return [x + lx, z + lz];
      const [rx, , rz] = rotateByQuaternion(q, lx, 0, lz);
      return [x + rx, z + rz];
    });
    out.push({ id: `h:${h.id}`, x, z, vx: st?.velocity?.x ?? 0, vz: st?.velocity?.z ?? 0,
               r: 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]),
               spheres, sphereR: sub.r });
  }
  return out;
}

/** `v` rotated by the unit quaternion `q` (`{x, y, z, w}`). */
function rotateByQuaternion(q, vx, vy, vz) {
  const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
  return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

/**
 * `AIObjectPhysical::getSubSpheres2d` 0x085d64b0 on a local box: the spheres
 * a potential obstacle is planted as (`addPotentialObstacle` 0x0852ceb0 adds
 * one circle a sphere, `R_bot` + the sphere radius). A box whose long side
 * is `n = round(long / short) > 1` short sides is `n` spheres along it,
 * `long / (n + 1)` apart and of that radius, on the short side's middle;
 * any other box one sphere at its centre (`getSphereLocalOffset`
 * 0x085d6860) of `getSmallestRadius` 0x085d68f0 (half the box's diagonal).
 * `{ points: [[x, z]], r }` in the box's frame.
 */
export function subSpheres2d(box) {
  const dx = box.max[0] - box.min[0], dz = box.max[2] - box.min[2];
  if (dz > 0 && dz < dx) {
    const n = Math.round(dx / dz);
    if (n > 1) {
      const step = dx / (n + 1);
      return { r: step, points: Array.from({ length: n }, (_, k) => [box.min[0] + (k + 1) * step, box.min[2] + dz / 2]) };
    }
  } else if (dx > 0 && dx < dz) {
    const n = Math.round(dz / dx);
    if (n > 1) {
      const step = dz / (n + 1);
      return { r: step, points: Array.from({ length: n }, (_, k) => [box.min[0] + dx / 2, box.min[2] + (k + 1) * step]) };
    }
  }
  return {
    r: 0.5 * Math.hypot(dx, box.max[1] - box.min[1], dz),
    points: [[(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2]],
  };
}

/**
 * `BBAvoid::calculateUrgency`'s obstacle half for a soldier on foot: plant
 * a potential obstacle on each still body a collision is predicted with
 * inside `SOLDIER_AVOID.lookAhead`, and on the still bodies around it, and
 * re-plan the route around them. `bodies` defaults to the world's. Returns
 * the number of obstacles planted.
 */
export function predictObstacles(bot, bodies = null) {
  if (bot.vehicle) return 0;
  const soldier = bot._player?.()?.soldier;
  const speed = soldier?.speed ?? 0;
  const yaw = soldier?.yaw ?? bot.yaw ?? 0;
  const me = [bot.position[0], bot.position[2]];
  const vel = [speed * Math.sin(yaw), speed * Math.cos(yaw)];
  const R = bot._radius?.() ?? BOT_RADIUS;
  const reach = SOLDIER_AVOID.lookAhead * speed + R;
  const list = bodies ?? avoidBodies(bot);
  const still = o => Math.hypot(o.vx, o.vz) <= SOLDIER_AVOID.potentialObstacleMaxSpeed + SOLDIER_AVOID.stillSpeed;
  let planted = 0;
  // One circle a sub-sphere (`addPotentialObstacle` 0x0852ceb0); a soldier
  // is one sphere at his feet.
  const plant = o => {
    if (bot.obstacles.some(ob => ob.id === o.id || ob.id?.startsWith(`${o.id}#`))) return;
    if (o.spheres?.length) {
      o.spheres.forEach(([x, z], k) => bot.obstacles.push({ x, z, r: R + o.sphereR, age: 0, id: `${o.id}#${k}`, unit: null }));
    } else {
      bot.obstacles.push({ x: o.x, z: o.z, r: R + o.r, age: 0, id: o.id, unit: null });
    }
    planted++;
  };
  for (const o of list) {
    const rel = [o.x - me[0], 0, o.z - me[1]];
    if (Math.hypot(rel[0], rel[2]) > reach + o.r) continue;
    const hit = collisionPredicted(rel, [o.vx - vel[0], 0, o.vz - vel[1]], R + o.r, SOLDIER_AVOID.lookAhead);
    if (!hit || !(hit.t === 0 || still(o))) continue;
    plant(o);
    const around = SOLDIER_AVOID.maxSpeed * 5 + o.r;
    for (const q of list) {
      if (q !== o && still(q) && Math.hypot(q.x - o.x, q.z - o.z) <= around) plant(q);
    }
  }
  // `addPotentialObstacle` 0x0852ceb0 marks the bot's paths stale (+0xc0
  // |= 4, so `initPathfinding` builds afresh): the route is rebuilt now,
  // around the new circles.
  if (planted && bot.route) bot.route = null;
  return planted;
}

/** `updatePotentialObstacles`: an obstacle is dropped once the bot is
 *  well away from it (max age 0 in every shipped level). */
export function ageObstacles(bot, dt) {
  if (!bot.obstacles.length) return;
  for (const ob of bot.obstacles) ob.age += dt;
  // A predicted obstacle is sized for the body that predicted it (`R_bot +
  // R_object`): one a soldier planted goes when he takes a hull, and one a
  // hull's crewman planted when he leaves it (INVENTION: what the engine's
  // `BotMain` +0x188 map does on a change of controlled object was not read).
  const unit = bot.vehicle?.vehicleId ?? null;
  // Nor does a hull stay an obstacle once the bot's plan is to board it
  // (the same INVENTION as `avoidBodies`' exclusion): its circles cover the
  // door the plan walks to.
  const target = bot.currentPlan?.vehicleId != null ? `h:${String(bot.currentPlan.vehicleId).split(':')[0]}` : null;
  bot.obstacles = bot.obstacles.filter(ob => (ob.unit === undefined || ob.unit === unit)
    && !(target && (ob.id === target || ob.id?.startsWith(`${target}#`)))
    && Math.hypot(ob.x - bot.position[0], ob.z - bot.position[2]) <= OBSTACLE_DROP_DISTANCE);
}

/**
 * The touched-object rule: the body's hull is in contact with something
 * the route did not expect (the map says the next metre is free), so the
 * thing is an obstacle the map cannot see — a parked prop, a moved vehicle.
 * After `CONTACT_TICKS` of that, plant a circle on the contact side and
 * re-plan. Returns true when a circle was planted this tick.
 */
export function trackContact(bot, soldier) {
  const blocked = !!soldier?.blocked && bot.moveForward > 0.1;
  const n = soldier?.body?.contactNormal;
  const wall = blocked && n && Math.abs(n.y) < 0.6;
  if (!wall) { bot._contactTicks = 0; return false; }
  bot._contactTicks = (bot._contactTicks ?? 0) + 1;
  if (bot._contactTicks < CONTACT_TICKS) return false;
  bot._contactTicks = 0;
  // The contact normal points out of the object toward the body: the
  // object is behind the normal.
  const h = Math.hypot(n.x, n.z) || 1;
  const x = bot.position[0] - (n.x / h) * OBSTACLE_AHEAD;
  const z = bot.position[2] - (n.z / h) * OBSTACLE_AHEAD;
  const near = bot.obstacles.some(ob => Math.hypot(ob.x - x, ob.z - z) < 0.5);
  if (!near) bot.obstacles.push({ x, z, r: OBSTACLE_RADIUS, age: 0 });
  if (bot.route) bot.route.failed = true;
  return true;
}

/**
 * The route for `goal` (`[x, y, z]`), built when there is none, when the
 * goal moved more than `REPLAN_GOAL_MOVE`, or after a failure. Returns the
 * route or null when the map has no answer.
 */
export function ensureRoute(bot, goal) {
  const nav = bot._nav();
  const r = bot.route;
  if (r && !r.failed
      && Math.hypot(r.goal[0] - goal[0], r.goal[1] - goal[2]) <= REPLAN_GOAL_MOVE) {
    return r;
  }
  if (!nav) return null;
  // A failed route is retried after a pause, with a wider local box each
  // time (the engine's state 3 waits for the next decision pass and the
  // next search draws a fresh random radius); meanwhile the bot walks
  // straight at the goal.
  if (r?.failed) {
    const now = bot._now ?? 0;
    if (now < (bot._routeRetryAt ?? -Infinity)) return null;
    bot._routeRetryAt = now + ROUTE_RETRY_AFTER;
  }
  const [bx, bz] = [bot.position[0], bot.position[2]];
  let coarse = null;
  // On the level's own strategic map every route asks the engine's test
  // (`updateStrategicPath` 0x08526e60: one region needs no strategic path);
  // on the painted coarse layer only a goal farther than two coarse cells
  // does (INVENTION).
  if (nav.strategic || Math.hypot(goal[0] - bx, goal[2] - bz) > COARSE_CELL * 2) {
    const valid = bot._validPos?.nav === nav ? bot._validPos.pos : null;
    coarse = findStrategicPath(nav, bx, bz, goal[0], goal[2], { fallbackStart: valid });
    if (!coarse) {
      bot._pathFailures++;
      return null;
    }
    coarse.shift();                 // the first entry is the bot itself
  }
  bot.route = {
    goal: [goal[0], goal[2]],
    coarse: coarse ?? [[goal[0], goal[2]]],
    points: [],
    index: 0,
    lastPassed: [bx, bz],
    failed: false,
    searches: 0,
  };
  bot._stalledTicks = 0;
  bot._extendRoute();
  return bot.route;
}

/**
 * `updateLocalPath`: while fewer than `SMOOTHING` followed points remain
 * and coarse legs are left, refine the next leg from the last followed
 * point. A leg the local search cannot answer is skipped (the engine sets
 * state 3 and re-plans; here the next leg is tried first).
 */
export function extendRoute(bot) {
  const r = bot.route;
  const nav = bot._nav();
  if (!r || !nav) return;
  let guard = 4;
  while (r.points.length - r.index < SMOOTHING && r.coarse.length && guard-- > 0) {
    const from = r.points.length ? r.points[r.points.length - 1]
      : [bot.position[0], bot.position[2]];
    const [tx, tz] = r.coarse[0];
    let radius = LOCAL_SEARCH_RADIUS_MIN + Math.random() * LOCAL_SEARCH_RADIUS_RAND;
    for (const ob of bot.obstacles) radius = Math.max(radius, ob.r);
    radius += 1 + ROUTE_RETRY_WIDEN * Math.min(3, bot._pathFailures);
    let leg = findLocalPath(nav, from[0], from[1], tx, tz,
                            { radius, obstacles: bot.obstacles });
    r.searches++;
    // A leg the box cannot close is searched again in a wider box (the
    // engine's next decision pass draws a fresh radius; INVENTION: three
    // widenings at once) before the route fails and waits for its retry.
    for (let w = 1; !leg && w <= ROUTE_LEG_WIDENINGS; w++) {
      leg = findLocalPath(nav, from[0], from[1], tx, tz,
                          { radius: radius + ROUTE_RETRY_WIDEN * w, obstacles: bot.obstacles,
                            maxNodes: ROUTE_LEG_WIDE_NODES * w });
      r.searches++;
    }
    if (!leg) {
      r.failed = true;
      bot._pathFailures++;
      return;
    }
    r.coarse.shift();
    bot._pathFailures = 0;
    for (let i = r.points.length ? 1 : 0; i < leg.length; i++) r.points.push(leg[i]);
  }
}

/**
 * `getNewIntermediatePathPos`: the farthest of the next `SMOOTHING` points
 * the trace can reach from the bot, farthest first. Sets `route.index` and
 * returns the point, or null when the route is empty.
 */
export function lookAhead(bot) {
  const r = bot.route;
  if (!r || !r.points.length) return null;
  const nav = bot._nav();
  const [bx, bz] = [bot.position[0], bot.position[2]];
  const last = Math.min(r.points.length - 1, SMOOTHING - 1);
  let pick = -1;
  if (nav) {
    for (let i = last; i >= 0; i--) {
      const p = r.points[i];
      if (traceClear(nav, bx, bz, p[0], p[1], bot.obstacles)) { pick = i; break; }
    }
  } else {
    pick = 0;
  }
  // No point traces clear: the engine counts the tick as obstructed and
  // steers at the front point regardless.
  bot._noVisiblePoint = pick < 0;
  if (pick < 0) pick = 0;
  r.index = pick;
  return r.points[pick];
}

/**
 * `checkAgainstPath` + `stepInPath`: drop the front point once the body is
 * inside `BOT_RADIUS` of it, or has crossed the plane through it that faces
 * the look-ahead point. The last point stays.
 */
export function popPassed(bot) {
  const r = bot.route;
  if (!r) return;
  let guard = SMOOTHING;
  while (r.points.length > 1 && guard-- > 0) {
    const front = r.points[0];
    const dx = bot.position[0] - front[0];
    const dz = bot.position[2] - front[1];
    const R = bot._radius();
    let pop = dx * dx + dz * dz < R * R;
    if (!pop && r.index > 0) {
      const next = r.points[r.index];
      pop = (next[0] - front[0]) * dx + (next[1] - front[1]) * dz >= 0;
    }
    if (!pop) break;
    r.lastPassed = front;
    r.points.shift();
    if (r.index > 0) r.index--;
  }
}

/**
 * `ObstructionDetection::update`: count ticks the bot asks to move but the
 * body does not. At `OBSTRUCTED_TICKS` a potential obstacle is planted a
 * metre ahead and the route rebuilt around it; at `PATH_FAIL_TICKS` the
 * route is failed.
 */
export function trackObstruction(bot, speed, dt = 1 / 30) {
  const stalled = bot._noVisiblePoint
    || (bot.moveForward > 0.1 && speed < MOVING_SPEED);
  if (!stalled) {
    bot._stalledTicks = 0;
    return false;
  }
  const before = bot._stalledTicks;
  bot._stalledTicks += dt * AI_TICK_HZ;
  if (before <= OBSTRUCTED_TICKS && bot._stalledTicks > OBSTRUCTED_TICKS) bot._onObstructed();
  if (bot._stalledTicks >= PATH_FAIL_TICKS) {
    bot._stalledTicks = 0;
    if (bot.route) bot.route.failed = true;
    bot._pathFailures++;
    return true;
  }
  return false;
}

/** Plant a potential obstacle where the body is stuck and re-plan. */
export function onObstructed(bot) {
  const x = bot.position[0] + Math.sin(bot.yaw) * OBSTACLE_AHEAD;
  const z = bot.position[2] + Math.cos(bot.yaw) * OBSTACLE_AHEAD;
  bot.obstacles.push({ x, z, r: OBSTACLE_RADIUS, age: 0 });
  if (bot.route) bot.route.failed = true;
}

/**
 * `CommonControls::actionStatusDecision` 0x0860fbe0 for the hull the bot
 * drives, toward `(dx, dz)` from it, on its own map. The state lives on the
 * move (`BAPAMoveTo` +0x60, zero for a new one): `bot._asd`, which the move
 * executor hands over per action. The engine's frame is the viewer's with z
 * negated; the map's cell rows already run along the engine's z. The box is
 * `getBox` 0x08612060's: taken at the hull's cell, or at the last cell it
 * stood on a valid cell when it stands on a blocked one now
 * (`AIObjectMobile::getValidPosition` 0x085d5bb0, kept by `positionChanged`
 * 0x085d5b30); a hull that never has gets no box, and the decision runs
 * its no-box branches (below). The object check's list is the bot's potential
 * obstacles (`BotMain::getPotentialObstacles` 0x0852d790, bot vtable +0x124,
 * each object's Physical radius): here the circles the follower plants.
 * `minLevel` is the map's search level floor.
 */
export function hullDecision(bot, dx, dz, minLevel = 0) {
  const nav = bot._nav();
  const st = bot.vehicle?.drive?.state;
  const v = st?.velocity;
  const f = bot._vehicleForward();
  const px = bot.position[0], pz = bot.position[2];
  const len = Math.hypot(dx, dz) || 1;
  const pos = [px, -pz];
  let box = null;
  if (nav) {
    const cs = nav.cellSize;
    const maxLevel = Number.isFinite(nav.maxLevel) ? nav.maxLevel : HULL_BOX_MAX_LEVEL;
    const levelAt = (gx, gz) => freeLevel(nav, (gx + 0.5) * cs, -(gz + 0.5) * cs, maxLevel);
    let gx = Math.floor(px / cs), gz = Math.floor(-pz / cs);
    let from = null;
    const hull = bot.vehicle?.node ?? bot.vehicle;
    if (levelAt(gx, gz) >= minLevel) {
      if (hull) hullValid.set(hull, [px, pz]);
    } else {
      // The last valid position (`CommonControls::getBox` 0x08612060: when
      // `isValidPosition`, `IAIPathfinding` vt+0x78, fails at the hull, it
      // asks the hull's `IPIMobileReal::getValidPosition` 0x085eab10 ->
      // `AIObjectMobile::getValidPosition` 0x085d5bb0 and takes the box
      // there). A hull that has never stood on a valid cell has none:
      // `AIObjectMobile::init` 0x085d54b0 sets the flag (+0x2c) from the
      // spawn cell, only `positionChanged` 0x085d5b30 / `setValidPosition`
      // 0x085d5be0 set it after, nothing clears it; `getBox` then returns
      // false, and `actionStatusDecision` 0x0860fbe0 takes its no-box
      // branches (state 0 facing away -> 8, every other state -> 0: drive
      // on when the point is ahead, turn in place when it is not). The
      // level's own maps paint such spawns (El Alamein's Tank0: the
      // Shermans at (1731, -804) and (888, -1822), three Willys), and the
      // engine's hull starts there with no box, as this one now does.
      const v = hull ? hullValid.get(hull) : null;
      if (v) {
        from = [v[0], -v[1]];
        gx = Math.floor(from[0] / cs);
        gz = Math.floor(from[1] / cs);
      }
    }
    const b = levelAt(gx, gz) >= minLevel ? searchBox(levelAt, gx, gz, { minLevel, maxLevel }) : null;
    if (b) box = { min: [b.min[0] * cs, b.min[1] * cs], max: [b.max[0] * cs, b.max[1] * cs], from };
  }
  const radius = bot._radius();
  const objects = bot.obstacles.map(o => ({ x: o.x, z: -o.z, r: o.r }));
  const asd = bot._asd ?? (bot._asd = { state: 0 });
  const d = actionStatusDecision({
    state: asd.state, dir: [dx / len, -dz / len], pos, forward: [f[0], -f[1]],
    velSign: v ? v.x * f[0] + v.z * f[1] : 0,
    speed: v ? Math.hypot(v.x, v.y, v.z) : 0,
    radius, turnRadius: bot.vehicle.turnRadius ?? TANK.defaultTurnRadius, box,
    line: run => checkLine(pos, run, radius, objects),
  });
  asd.state = d.state;
  bot._dbgMoveStatus = d.state;
  bot._dbgBox = box;
  return d;
}

/**
 * `infanteryControlTowardsDirection`: look toward `[x, z]`; throttle
 * `speed` inside the cone, else hold and turn. A target behind turns at
 * the full rate (the engine writes the angle as +-pi/2).
 */
export function steerToward(bot, x, z, speed = 1) {
  const dx = x - bot.position[0];
  const dz = z - bot.position[2];
  if (dx * dx + dz * dz < 1e-8) { bot.moveForward = 0; return; }
  if (bot.vehicle && !bot.vehicle.drives) { bot.moveForward = 0; bot.moveStrafe = 0; return; }
  if (bot.vehicle?.kind === 'ship') {
    // `BoatControl::towardsDirection` on the water map's route leg. The
    // helm steers at the follower's look-ahead point; the move's end
    // condition (`ConPosition(point, 4 x radius)`) belongs to the move's
    // own point, which the executor tests, so no arrival here: with it a
    // look-ahead point 10..40 m off the bow read as arrived and the helm
    // cut the throttle, leaving a landing craft turning in place.
    const st = bot.vehicle.drive?.state;
    const nav = bot._nav();
    const w = st?.angularVelocity;
    const r = boatControl({
      forward: bot._vehicleForward(), velocity: st ? [st.velocity.x, st.velocity.z] : [0, 0],
      toTarget: [dx, dz], radius: 0,
      maxSpeed: bot.vehicle.hullMaxSpeed || bot.vehicle.maxSpeed || null,
      prevSpeed: bot._boatPrevSpeed ?? 0,
      // A THREE yaw rate about +y turns the heading toward a negative angle.
      yawRate: w ? -w.y : 0,
      level: nav ? freeLevel(nav, bot.position[0], bot.position[2]) : Infinity,
      // The channel as `speedControl` reads it: this tick's word, which
      // `_resetInput` has zeroed (the bot's input is rebuilt every tick).
      prevThrottle: 0,
      // `BoatControl::towardsDirection` 0x0860df70 runs the box state
      // machine first, on the water map.
      decision: nav ? hullDecision(bot, dx, dz, BOAT.baseLevel) : null,
    });
    bot._boatPrevSpeed = r.speed ?? 0;
    bot.moveForward = r.throttle * (speed > 0 ? 1 : 0);
    bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
    bot._dbgSteerAngle = r.angle;
    return;
  }
  if (bot.vehicle) {
    // `EntryTankMoveTo::execute` 0x08622e80: `actionStatusDecision` on the
    // vehicle map, then `TankControl::controlTowardsDirection` for the hull;
    // the look stays free for the turret.
    const st = bot.vehicle.drive?.state;
    const v = st?.velocity;
    const w = st?.angularVelocity;
    const q = st?.orientation;
    const f = bot._vehicleForward();
    // The rotational speed about the hull's heading (q * (0, 0, -1)): the
    // law's wanted-speed damping (0x0862d232).
    let rollRate = 0;
    if (w && q) {
      const f3 = [-(2 * (q.x * q.z + q.w * q.y)), -(2 * (q.y * q.z - q.w * q.x)), -(1 - 2 * (q.x * q.x + q.y * q.y))];
      rollRate = w.x * f3[0] + w.y * f3[1] + w.z * f3[2];
    }
    const r = tankControl({
      forward: f,
      velocity: v ? [v.x, v.z] : [0, 0],
      toTarget: [dx, dz],
      maxSpeed: bot.vehicle.maxSpeed ?? 0,
      // A THREE yaw rate about +y turns the heading toward a negative angle.
      yawRate: w ? -w.y : 0,
      rollRate,
      decision: bot._nav() ? hullDecision(bot, dx, dz, 0) : null,
    });
    bot.moveForward = r.throttle * (speed > 0 ? 1 : 0);
    bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
    bot._dbgSteerAngle = r.angle;
    bot._dbgDrive = r.drive;
    return;
  }
  const want = Math.atan2(dx, dz);
  const rel = wrapAngle(want - bot.yaw);
  bot._aimLook(want, 0);
  bot.moveStrafe = 0;
  bot.moveForward = Math.abs(rel) <= STEER_CONE ? speed : 0;
}

// -----------------------------------------------------------------------
// Movement executors
// -----------------------------------------------------------------------

/**
 * InfanteryMoveTo: walk the route to the action's waypoint. The route is
 * refined a leg at a time, the steering point is the farthest visible of
 * the next ten, passed points are popped, and a stalled body plants an
 * obstacle and re-plans. Returns true once the last point is inside the
 * body radius.
 */
export function execInfantryMoveTo(bot, action, dt) {
  const target = action.waypoint || bot.waypoint;
  if (!target) return true;
  // `BBPGotoWaypoint3d::createPlan` 0x085b81e0: the move's clearance is
  // the waypoint's +0x14 (50 m from `orderAirBot`).
  if (bot.vehicle?.kind === 'air') {
    return bot._execPlaneMoveTo(target, action, action.waypointObject?.clearance ?? PLANE.cruiseClearance);
  }
  // A ship without a water map holds a straight line; with one it routes
  // like a hull, the helm in `_steerToward`.
  if (bot.vehicle?.kind === 'ship' && !bot._nav()) return bot._execBoatMoveTo(target, action);
  const speed = action.crouch ? 0.5 : 1;
  if (action.crouch) bot.stanceInput = 'crouch';
  else if (action.stance) bot.stanceInput = action.stance;
  // The move's own `actionStatusDecision` state (`BAPAMoveTo` +0x60): each
  // move starts at 0 (the ctor 0x08540350).
  if (bot.vehicle) bot._asd = action._asd ?? (action._asd = { state: 0 });

  const arrived = Math.hypot(bot.position[0] - target[0], bot.position[2] - target[2])
    < (action.arrive ?? WAYPOINT_REACH_RADIUS);
  if (arrived && bot.vehicle?.kind === 'ship' && bot.vehicle.drive?.state) {
    // `EntryBoatMoveTo::execute` 0x08613d60 inside the move's radius:
    // `BoatControl::resetControls` brakes, and the move is done only once
    // the hull is at or under 1 m/s along its heading.
    const v = bot.vehicle.drive.state.velocity;
    const f = bot._vehicleForward();
    const r = boatResetControls(v.x * f[0] + v.z * f[1]);
    bot.moveForward = r.throttle; bot.moveStrafe = 0; bot._lastThrottle = 0;
    return r.done;
  }
  if (arrived) { bot.moveForward = 0; bot._lastThrottle = 0; return true; }

  // `_resetInput` has zeroed this tick's word; the stall test wants the
  // throttle the body was given last tick.
  const soldier = bot._player()?.soldier;
  const hullV = bot.vehicle?.drive?.state?.velocity;
  const bodySpeed = hullV ? Math.hypot(hullV.x, hullV.z) : (soldier?.speed ?? 0);
  bot.moveForward = bot._lastThrottle ?? 0;
  if (!bot.vehicle) {
    predictObstacles(bot);
    bot._trackContact(soldier);
  }
  if (bot._trackObstruction(bodySpeed, dt)) {
    // The path failed (`+0xc = 3`): next tick rebuilds it around the
    // obstacles, or walks straight at the goal after repeated failures. A
    // wedged hull's backing out is `actionStatusDecision`'s, in its move.
    bot.route = null;
  }

  // The searcher's last free position on its own map (`AIObjectMobile`
  // +0x20, kept by `positionChanged` 0x085d5b30 whenever the position is
  // valid), where `initPathfinding` 0x0852a0d0 starts a route from a
  // blocked cell (`getValidPosition`, Information vt+0x20).
  const navNow = bot._nav();
  if (navNow && isWalkable(navNow, bot.position[0], bot.position[2])) {
    bot._validPos = { nav: navNow, pos: [bot.position[0], bot.position[2]] };
  }
  let route = bot._ensureRoute(target);
  if (route) {
    bot._extendRoute();
    bot._popPassed();
    const point = bot._lookAhead();
    if (point) {
      bot._steerToward(point[0], point[1], speed);
      bot._dbgSteer = point;
      bot._lastThrottle = bot.moveForward;
      return false;
    }
    route.failed = true;
  }
  // No route: the map cannot see a way, or the level has no map. The
  // engine's bot stands still on state 3 until a re-plan; here a soldier
  // walks straight at the goal so a squad without a map still moves. A
  // hull does not: driven blind it wedges itself against the paint's walls.
  if (bot.vehicle && bot._nav()) {
    bot.moveForward = 0; bot.moveStrafe = 0; bot._lastThrottle = 0;
    return false;
  }
  bot._steerToward(target[0], target[2], speed);
  bot._dbgSteer = [target[0], target[2]];
  bot._lastThrottle = bot.moveForward;
  return false;
}

/** `BoatMoveTo`: the helm on a straight line to the point. */
export function execBoatMoveTo(bot, target, action) {
  const m = bot.vehicle;
  const st = m.drive?.state;
  if (!st) return true;
  const r = boatControl({
    forward: bot._vehicleForward(), velocity: [st.velocity.x, st.velocity.z],
    toTarget: [target[0] - st.position.x, target[2] - st.position.z], radius: m.radius ?? 10,
  });
  bot.moveForward = r.throttle;
  bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
  bot._dbgSteerAngle = r.angle;
  bot._dbgSteer = [target[0], target[2]];
  bot._lastThrottle = bot.moveForward;
  return r.arrived;
}
