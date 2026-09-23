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
// INVENTION: the coarse legs come from nav-grid.js's `findStrategicPath`
// (the engine's `StrategicMap` was not read); a failed route is retried a
// few times with the obstacle circles and then walked straight at.

import { findLocalPath, findStrategicPath, traceClear, COARSE_CELL, freeRun, freeBox, freeLevel } from './nav-grid.js';
import { tankControl, TANK } from './bot-vehicle.js';
import { boatControl, PLANE } from './bot-vehicle-air.js';
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
/** How long a wedged hull reverses before trying again (INVENTION). */
const VEHICLE_REVERSE_SECONDS = 2.0;
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
 *  collision with; the soldier template sets no `avoidCollisionLookAhead`
 *  (`AITemplateMobile` ctor 0x085e0b90 zeroes it), so for infantry that is an
 *  object the body is already touching. Its radius is `R_bot + R_object` per
 *  sub-sphere (`updatePotentialObstacles` 0x0852d880); `AIPathfinding`'s ctor
 *  0x0847a780 zeroes `getPotentialObstacleMaxSpeed/MaxAge` and no level sets
 *  them, so only a stationary object qualifies and it is dropped once the bot
 *  is `5 * maxSpeed + R` = 25.5 m away. The viewer's trigger is the body's
 *  own hull contact (`Soldier.blocked`, `SoldierBody.contactNormal`) held
 *  for `CONTACT_TICKS` while the map says the way is clear; the object's
 *  radius is not known, so a sandbag's stands in (INVENTION). */
const OBSTACLE_RADIUS = 1.5;
const OBSTACLE_AHEAD = 1.0;
const OBSTACLE_DROP_DISTANCE = 5 * 5.0 + 0.5;
const CONTACT_TICKS = 10;

/** `updatePotentialObstacles`: an obstacle is dropped once the bot is
 *  well away from it (max age 0 in every shipped level). */
export function ageObstacles(bot, dt) {
  if (!bot.obstacles.length) return;
  for (const ob of bot.obstacles) ob.age += dt;
  bot.obstacles = bot.obstacles.filter(ob =>
    Math.hypot(ob.x - bot.position[0], ob.z - bot.position[2]) <= OBSTACLE_DROP_DISTANCE);
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
  if (Math.hypot(goal[0] - bx, goal[2] - bz) > COARSE_CELL * 2) {
    coarse = findStrategicPath(nav, bx, bz, goal[0], goal[2]);
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
    });
    bot._boatPrevSpeed = r.speed ?? 0;
    bot.moveForward = r.throttle * (speed > 0 ? 1 : 0);
    bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
    bot._dbgSteerAngle = r.angle;
    return;
  }
  if (bot.vehicle) {
    // `TankControl::controlTowardsDirection`: throttle and steer for the
    // hull; the look stays free for the turret. `actionStatusDecision`'s
    // box test reads the vehicle map: the free run along the heading and
    // the free box around the hull, against the turn radius.
    const v = bot.vehicle.drive?.state?.velocity;
    const f = bot._vehicleForward();
    const turnRadius = bot.vehicle.turnRadius ?? TANK.defaultTurnRadius;
    const nav = bot._nav();
    let freeAhead = Infinity, boxShort = Infinity;
    if (nav && dx * f[0] + dz * f[1] < 0) {
      freeAhead = freeRun(nav, bot.position[0], bot.position[2], f[0], f[1], turnRadius * 2 + 1, bot.obstacles);
      boxShort = freeBox(nav, bot.position[0], bot.position[2], Math.ceil(turnRadius * 2 / nav.cellSize)).short;
    }
    const r = tankControl({
      forward: f,
      velocity: v ? [v.x, v.z] : [0, 0],
      toTarget: [dx, dz],
      maxSpeed: bot.vehicle.maxSpeed ?? 0,
      yawRate: bot._hullYawRate ?? 0,
      lastTurn: bot._lastTurn ?? 0,
      freeAhead, boxShort, turnRadius,
    });
    bot._lastTurn = r.turn;
    if (r.reverse) {
      bot.moveForward = r.throttle;
      bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
      bot._dbgSteerAngle = r.angle;
      return;
    }
    if ((bot._now ?? 0) < (bot._reverseUntil ?? -Infinity)) {
      // Backing out of the obstruction, the lock away from the target.
      bot.moveForward = -1;
      bot.moveStrafe = -VEHICLE_YAW_SIGN * (Math.sign(r.angle) || 1);
      bot._dbgSteerAngle = r.angle;
      return;
    }
    bot.moveForward = r.throttle * (speed > 0 ? 1 : 0);
    bot.moveStrafe = VEHICLE_YAW_SIGN * r.steer;
    bot._dbgSteerAngle = r.angle;
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

  const arrived = Math.hypot(bot.position[0] - target[0], bot.position[2] - target[2])
    < (action.arrive ?? WAYPOINT_REACH_RADIUS);
  if (arrived) { bot.moveForward = 0; bot._lastThrottle = 0; return true; }

  // `_resetInput` has zeroed this tick's word; the stall test wants the
  // throttle the body was given last tick.
  const soldier = bot._player()?.soldier;
  const hullV = bot.vehicle?.drive?.state?.velocity;
  const bodySpeed = hullV ? Math.hypot(hullV.x, hullV.z) : (soldier?.speed ?? 0);
  bot.moveForward = bot._lastThrottle ?? 0;
  if (!bot.vehicle) bot._trackContact(soldier);
  if (bot._trackObstruction(bodySpeed, dt)) {
    // The path failed (`+0xc = 3`): next tick rebuilds it around the
    // obstacles, or walks straight at the goal after repeated failures.
    bot.route = null;
    // A wedged hull backs out first (INVENTION: `CommonControls::
    // actionStatusDecision`, which picks forward or reverse, is not read).
    if (bot.vehicle) bot._reverseUntil = (bot._now ?? 0) + VEHICLE_REVERSE_SECONDS;
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
