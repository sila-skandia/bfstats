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

import { beginLocalSearch, stepLocalSearch, findStrategicPath, traceClear, COARSE_CELL, freeLevel, isWalkable, resolveClearStart, freeRun } from './nav-grid.js';
import { tankControl, TANK, actionStatusDecision, searchBox, checkLine, boxExit,
         HULL_AVOID, hullAvoidUrgency, hullAvoidTurn } from './bot-vehicle.js';
import { boatControl, boatResetControls, PLANE, BOAT, collisionPredicted } from './bot-vehicle-air.js';
import { SOLDIER_MASS } from './soldier-locomotion.js';
import { friendlyHulls } from './bot-pilot.js';
import { wrapAngle } from './bot-aim.js';
import { movePose } from './bot-pose.js';

/** How close to a plain waypoint before it counts as reached. */
const WAYPOINT_REACH_RADIUS = 3.0;

/** A failed route is retried after this long, its local box wider by this
 *  much per failure (INVENTION: the engine's next search draws a fresh
 *  random radius on the next decision pass). */
const ROUTE_RETRY_AFTER = 1.5;
export const ROUTE_RETRY_WIDEN = 16;
/** A leg that fails its box is retried this many times, each 16 m wider
 *  (to 120 m: the coarse legs are an INVENTION and can cross a compound's
 *  paint, which only a wide box routes around). */
export const ROUTE_LEG_WIDENINGS = 6;
export const ROUTE_LEG_WIDE_NODES = 20000;

/**
 * The pathfinding slice of the AI's budget. Ledger AI-6: `AIMain::action`
 * hands the bots a share of the frame and `BotManager::action` splits it,
 * `0.60 * q_path` of it to pathfinding; the searches are tasks the AI's
 * scheduler runs while the slice lasts (AI-135), and a search the slice
 * does not finish goes on in the next frame's. So more bots means each
 * searches less often, and the budget, not the bot count or the level's
 * size, bounds the cost. Ours counts A* node expansions a tick rather than
 * time, because a seeded match must replay byte for byte (the engine's
 * bots cannot be, AI-135, for exactly this reason). The referee keeps one
 * budget, begins it every tick and hands it to each bot (`bot.pathBudget`);
 * a bot without one (a harness, a test) searches unbudgeted, as before.
 *
 * `PATH_BUDGET_NODES` is one capped local search a tick (INVENTION of the
 * value: on FHSW Operation Varsity, 2048 m, twelve bots each running up to
 * four legs of 8,192 nodes a tick put the frame's p95 at 58 ms and its p99
 * at 108 ms; features/bot-path-budget). Every search pending in a tick gets
 * an equal share of it, sized from how many were pending last tick, so a
 * short leg (a few hundred nodes) still closes in its own tick and a leg
 * its box cannot close takes a few ticks to say so instead of stalling the
 * tick. A route whose search is mid-way stands (`route.deferred`): it is
 * not failed, and the hull holds until the answer comes.
 */
export const PATH_BUDGET_NODES = 8192;
/** How long a leg's search may stand in the budget's queue before it is
 *  served whole, the budget notwithstanding (INVENTION: half a second).
 *  With every bot searching at once each share is a few hundred cells a
 *  tick, and a wide box's search would otherwise crawl for many seconds
 *  while its bot stood or walked blind: on EoD Hamburger Hill ten of twelve
 *  bots ended up standing (2026-11-06). So the budget is a cap on the
 *  common tick, and under a queue that deep the tick falls back to what it
 *  cost before the budget, one search run to its end, rather than to a
 *  stall. */
export const PATH_SEARCH_OVERDUE_TICKS = 15;

export function newPathBudget(nodes = PATH_BUDGET_NODES) {
  return {
    nodes,
    tick: 0,
    expanded: 0,      // this tick's expansions, every bot's searches together
    searches: 0,      // local searches begun this tick
    strategic: 0,     // strategic searches run this tick (counted, not budgeted)
    stepped: 0,       // search steps run this tick
    pending: 0,       // steps that ended with the search still open
    deferred: 0,      // steps that got no share at all this tick
    overdue: 0,       // searches served whole this tick after `PATH_SEARCH_OVERDUE_TICKS`
    pendingLast: 1,   // last tick's `pending`: what this tick's shares divide by
    /** The tick's start: last tick's open searches size this tick's shares. */
    begin() {
      this.tick++;
      this.pendingLast = Math.max(1, this.pending);
      this.expanded = 0; this.searches = 0; this.strategic = 0;
      this.stepped = 0; this.pending = 0; this.deferred = 0; this.overdue = 0;
    },
    /** How many nodes one search may expand now: its share, within what is left. */
    grant() {
      return Math.max(0, Math.min(Math.floor(this.nodes / this.pendingLast), this.nodes - this.expanded));
    },
  };
}

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
export const LOCAL_SEARCH_RADIUS_MIN = 10;
export const LOCAL_SEARCH_RADIUS_RAND = 14;
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
export const VEHICLE_YAW_SIGN = 1;
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
/** The hull's touched-object rule (`trackHullContact`, INVENTION like the
 *  soldier's): a contact counts when its normal is this far off vertical
 *  (the soldier's wall test) and it lies on the side the hull is pushing
 *  toward, and it must hold `CONTACT_TICKS` AI ticks (a third of a second)
 *  with the hull under `MOVING_SPEED`. */
const HULL_WALL_NORMAL_Y = 0.6;

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
  /** `getPotentialObstacleMaxSpeed` (`AIPathfinding+0x2c`, read through
   *  IAIPathfinding vt+0x8c by `BBAvoid::calculateUrgency` 0x0855cecf and
   *  `updatePotentialObstacles` 0x0852dac0): 1.0, written by the
   *  `AIPathfinding` ctor at 0x0847a7f0 and by `reset` 0x0847e5a2. No
   *  console word sets it. Read as 0 until 2026-11-12. */
  potentialObstacleMaxSpeed: 1.0,
  /** `getPotentialObstacleMaxAge` (`+0x30`, vt+0x94, 0x0852daaa): 10 s, the
   *  same two writes (0x0847a7f7, 0x0847e5a9). */
  potentialObstacleMaxAge: 10.0,
  /** `updatePotentialObstacles` drops a planted body moving faster than
   *  `maxSpeed x 1.2` (the float at 0x086c4f64, 0x0852dac6; the compare at
   *  0x0852dbd9). */
  dropSpeedScale: 1.2,
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
  // A driver predicts from the hull (`BBAvoid` on the Tank, Car and Boat
  // rows, AI-95): its velocity, its radius, its Mobile `maxSpeed` for the
  // cluster, its own look-ahead; the hull itself is no obstacle to it.
  const hull = drivesHull(bot) ? bot.vehicle : null;
  if (bot.vehicle && !hull) return 0;
  const me = [bot.position[0], bot.position[2]];
  let vel, speed, lookAhead = SOLDIER_AVOID.lookAhead, maxSpeed = SOLDIER_AVOID.maxSpeed;
  if (hull) {
    const v = hull.drive?.state?.velocity;
    vel = [v?.x ?? 0, v?.z ?? 0];
    speed = Math.hypot(vel[0], vel[1]);
    lookAhead = hullLookAhead(hull);
    maxSpeed = hull.hullMaxSpeed || hull.maxSpeed || 0;
  } else {
    const soldier = bot._player?.()?.soldier;
    speed = soldier?.speed ?? 0;
    const yaw = soldier?.yaw ?? bot.yaw ?? 0;
    vel = [speed * Math.sin(yaw), speed * Math.cos(yaw)];
  }
  const R = bot._radius?.() ?? BOT_RADIUS;
  const reach = lookAhead * speed + R;
  const own = hull ? `h:${hull.vehicleId}` : null;
  const list = (bodies ?? avoidBodies(bot)).filter(o => o.id !== own);
  const unit = hull ? hull.vehicleId : null;
  // `updatePotentialObstacles`' distance rule, `5 x size + R` (25.5 m for a
  // soldier): a hull's size is its Mobile `maxSpeed`.
  const drop = hull ? 5 * maxSpeed + R : undefined;
  const still = o => Math.hypot(o.vx, o.vz) <= SOLDIER_AVOID.potentialObstacleMaxSpeed;
  let planted = 0;
  // One circle a sub-sphere (`addPotentialObstacle` 0x0852ceb0); a soldier
  // is one sphere at his feet.
  // A driver plants no body whose circles it already stands in (INVENTION:
  // the engine's search moves its start out of such a circle,
  // `BotMain::resolveAvoidStartingPoint` 0x08528ca0, which the viewer's
  // hull search does not; a Daihatsu beside its carrier at Wake planted the
  // carrier's and its neighbours' spheres round itself, failed every route
  // and never left, 2026-11-12).
  const encloses = o => (o.spheres?.length
    ? o.spheres.some(([x, z]) => Math.hypot(x - me[0], z - me[1]) < R + o.sphereR)
    : Math.hypot(o.x - me[0], o.z - me[1]) < R + o.r);
  const plant = o => {
    if (bot.obstacles.some(ob => ob.id === o.id || ob.id?.startsWith(`${o.id}#`))) return;
    if (hull && encloses(o)) return;
    if (o.spheres?.length) {
      o.spheres.forEach(([x, z], k) => bot.obstacles.push({ x, z, r: R + o.sphereR, age: 0, id: `${o.id}#${k}`, body: o.id, unit, drop }));
    } else {
      bot.obstacles.push({ x: o.x, z: o.z, r: R + o.r, age: 0, id: o.id, body: o.id, unit, drop });
    }
    planted++;
  };
  for (const o of list) {
    const rel = [o.x - me[0], 0, o.z - me[1]];
    if (Math.hypot(rel[0], rel[2]) > reach + o.r) continue;
    const hit = collisionPredicted(rel, [o.vx - vel[0], 0, o.vz - vel[1]], R + o.r, lookAhead);
    if (!hit || !(hit.t === 0 || still(o))) continue;
    plant(o);
    const around = maxSpeed * 5 + o.r;
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

/** Whether the bot drives a hull that runs the 2d avoid: a ground hull or a
 *  boat (`Avoid BBAvoid BBPAvoidCollision2d` on every driven ground and boat
 *  row; the aircraft's is the 3d one, bot-pilot.js `airAvoid`). */
export function drivesHull(bot) {
  const m = bot.vehicle;
  return !!(m?.drives && m.kind !== 'air' && m.kind !== 'gun');
}

/** The hull's Mobile `avoidCollisionLookAhead` (`HULL_AVOID.lookAhead`, 5 s,
 *  where its template sets none). */
function hullLookAhead(m) {
  const t = m?.avoidCollisionLookAhead;
  return Number.isFinite(t) && t > 0 ? t : HULL_AVOID.lookAhead;
}

/** `getSmallestRadius` 0x085d68f0: half the local box's diagonal. */
function smallestRadius(box) {
  return 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
}

/**
 * `BBAvoid::calculateUrgency` 0x0855c650 for a bot driving a ground hull or
 * a boat (bot-vehicle.js `hullAvoidUrgency`): the hull against the side's
 * soldiers on foot and the side's and empty hulls (the side's and the
 * neutral grid, as `avoidBodies`), each with its physics mass (a soldier's
 * `mass 100`, `CommonSoldierData.inc`). Records the plan's object on the bot
 * (`_hullAvoidBest`) and returns the unscaled urgency. The still bodies are
 * `predictObstacles`' half, run on the drive's move. On x/z at the objects'
 * positions (the engine's sphere centres sit a box offset over them).
 */
export function hullAvoid(bot) {
  const m = bot.vehicle;
  const st = m?.drive?.state;
  if (!st) { bot._hullAvoidBest = null; return 0; }
  const hulls = friendlyHulls(bot);
  const ownBox = hulls.find(h => h.id === m.vehicleId)?.box ?? null;
  const self = { id: `h:${m.vehicleId}`, x: st.position.x, z: st.position.z, vx: st.velocity.x, vz: st.velocity.z,
                 r: ownBox ? smallestRadius(ownBox) : bot._radius() };
  const others = [];
  for (const [id, p] of bot.world?.players ?? []) {
    if (id === bot.playerId || !p?.soldier || p.vehicle || p.team !== bot.team) continue;
    const s = p.soldier;
    if (bot.world?.armorOf?.(id)?.destroyed || !Number.isFinite(s.x)) continue;
    const v = s.speed ?? 0;
    others.push({ id: `p:${id}`, x: s.x, z: s.z, vx: v * Math.sin(s.yaw ?? 0), vz: v * Math.cos(s.yaw ?? 0),
                  r: BOT_RADIUS, mass: SOLDIER_MASS });
  }
  for (const h of hulls) {
    if (h.id === m.vehicleId || !h.box || !h.pos) continue;
    if (h.crew?.some(id => { const t = bot.world?.players?.get(id)?.team; return t !== undefined && t !== bot.team; })) continue;
    const hs = h.drive?.state;
    others.push({ id: `h:${h.id}`, x: hs?.position ? hs.position.x : h.pos[0], z: hs?.position ? hs.position.z : h.pos[2],
                  vx: hs?.velocity?.x ?? 0, vz: hs?.velocity?.z ?? 0, r: smallestRadius(h.box), mass: h.mass ?? 0 });
  }
  const r = hullAvoidUrgency({ self, others, lookAhead: hullLookAhead(m) });
  const prev = bot._hullAvoidBest?.id ?? null;
  bot._hullAvoidBest = r.best ? { id: r.best.id, t: r.best.t, other: r.best.other } : null;
  if (bot._hullAvoidBest && bot._hullAvoidBest.id !== prev) bot.changedTarget.Avoid = true;
  return r.urgency;
}

/**
 * `BBPAvoidCollision2d::createPlan` 0x08586420: the side step's point. The
 * direction is `hullAvoidTurn`'s; the point is where the line along it from
 * the hull leaves the hull's own box on its map (`IAIPathfinding` vt+0x3c,
 * `AIPathfinding::getBox` 0x0847d110 -> 0x0847d140, then `getIntersection`
 * 0x08612210, `boxExit`); no box (a blocked cell) or no exit, no plan.
 * The move is `BAPAMoveToDirect` to that point at the hull's speed, ended
 * by `BAPConTime(1.5 t)` or within 1.0 m of it (`BAPConOr`). Returns
 * `{ point, until, otherId }` in the viewer's frame, or null.
 */
export function planHullAvoid(bot, now) {
  const b = bot._hullAvoidBest;
  const st = bot.vehicle?.drive?.state;
  const nav = bot._nav();
  if (!b || !st || !nav) return null;
  const o = b.other;
  const px = st.position.x, pz = st.position.z;
  const { dir } = hullAvoidTurn({ velocity: [st.velocity.x, st.velocity.z], forward: bot._vehicleForward(),
                                  otherVelocity: [o.vx, o.vz], rel: [o.x - px, o.z - pz] });
  const cs = nav.cellSize;
  const maxLevel = Number.isFinite(nav.maxLevel) ? nav.maxLevel : HULL_BOX_MAX_LEVEL;
  const minLevel = bot.vehicle.kind === 'ship' ? BOAT.baseLevel : 0;
  const levelAt = (gx, gz) => freeLevel(nav, (gx + 0.5) * cs, -(gz + 0.5) * cs, maxLevel);
  const gx = Math.floor(px / cs), gz = Math.floor(-pz / cs);
  if (levelAt(gx, gz) < minLevel) return null;
  const box = searchBox(levelAt, gx, gz, { minLevel, maxLevel });
  if (!box) return null;
  const exit = boxExit([box.min[0] * cs, box.min[1] * cs], [box.max[0] * cs, box.max[1] * cs],
                       [dir[0], -dir[1]], [px, -pz]);
  if (!exit) return null;
  return { point: [exit[0], st.position.y, -exit[1]], until: now + HULL_AVOID.timeFactor * b.t, otherId: b.id };
}

/** The side step's move: the hull's own drive straight at the point (as a
 *  route leg steers it), done within `HULL_AVOID.arrive` of it or when its
 *  time is up; driven on the tick that ends it too, as a plane's move is
 *  (AI-154; INFERRED for the tank's `EntryTankMoveTo`). */
export function execHullAvoid(bot, action, now) {
  bot._asd = action._asd ?? (action._asd = { state: 0 });
  bot._steerToward(action.point[0], action.point[2], 1);
  bot._dbgSteer = [action.point[0], action.point[2]];
  const dx = action.point[0] - bot.position[0], dz = action.point[2] - bot.position[2];
  return Math.hypot(dx, dz) <= HULL_AVOID.arrive || now >= action.until;
}

/** The speed of each body a soldier's prediction planted, by its id
 *  (`avoidBodies`' `p:` / `h:` ids), now; a body no longer there is absent. */
function plantedSpeeds(bodies) {
  const out = new Map();
  for (const o of bodies) out.set(o.id, Math.hypot(o.vx, o.vz));
  return out;
}

/**
 * `updatePotentialObstacles` 0x0852d880 rebuilds the bot's circles from its
 * planted bodies every update (the map at `BotMain+0x188`): a body that is
 * gone (0x0852e0f9) or moving faster than `maxSpeed x 1.2` (0x0852dbd9 ->
 * 0x0852e0e9) is dropped; one older than `maxAge` (10 s, 0x0852dbf0) is
 * dropped once the bot is farther from it than `5 x size + R` (25.5 m,
 * 0x0852df17..0x0852dfbf); a younger one stays wherever the bot is. A
 * friend planted while touching (`collisionPredicted`'s t = 0) who walks on
 * is therefore no obstacle a tick later. The page kept every circle until
 * the bot was 25.5 m off, so a friend who had stood in a doorway closed it
 * for the bots behind him long after he left: after the reinforcement wave
 * (SPAWN-35) a side walks out of its base together and the circles from
 * that crowd failed the routes of whoever followed (2026-11-12, the DICE
 * runner: on-foot route failures per bot-minute about 1.5x). Contact
 * circles and a hull's own circles (no planted body) keep the distance rule.
 * `bodies` defaults to the world's (`avoidBodies`); with no world to ask,
 * only the distance rule runs.
 */
export function ageObstacles(bot, dt, bodies = null) {
  if (!bot.obstacles.length) return;
  for (const ob of bot.obstacles) ob.age += dt;
  if (bot.obstacles.some(ob => ob.body) && (bodies || bot.world)) {
    const speeds = plantedSpeeds(bodies ?? avoidBodies(bot));
    const fast = SOLDIER_AVOID.potentialObstacleMaxSpeed * SOLDIER_AVOID.dropSpeedScale;
    bot.obstacles = bot.obstacles.filter(ob => {
      if (!ob.body) return true;
      const v = speeds.get(ob.body);
      if (v === undefined || v > fast) return false;
      if (ob.age <= SOLDIER_AVOID.potentialObstacleMaxAge) { ob.young = true; return true; }
      ob.young = false;
      return true;
    });
  }
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
    && (ob.young || Math.hypot(ob.x - bot.position[0], ob.z - bot.position[2]) <= (ob.drop ?? OBSTACLE_DROP_DISTANCE)));
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
 * The touched-object rule for a driven hull (INVENTION, the soldier rule's
 * counterpart; nothing in the engine was read for it). The engine keeps a
 * hull off a body its map does not show through `BBAvoid`'s prediction,
 * which plants `R_bot + R_object` circles (AI-32, AI-119) before the hull
 * gets there; the viewer predicts for soldiers only (`predictObstacles`), so
 * a hull finds a parked prop by driving into it (Wake Island's supply depot:
 * a Chi-ha's corner on a steel barrel, held at full throttle for 146 s,
 * features/browser-play-feedback-2026-11-06 #5). The drive's own hull
 * contacts (`drive.hullContacts`, vehicle-bodies.js `noteContact`) say where:
 * once a wall-like contact on the side the hull pushes toward has held
 * `CONTACT_TICKS` with the hull under `MOVING_SPEED`, a circle of the hull's
 * radius plus `OBSTACLE_RADIUS` (the stand-in object radius of the soldier
 * rule) is planted on the contact point, the route is failed, and the next
 * one backs out of the circle first (`ensureRoute`, `bot._backOut`). The
 * hull's centre stands inside that circle; the search and the hull's
 * decision both keep only the part of it nearer than the hull
 * (`cellOpen`, `hullDecision`), so the way back out stays open.
 * Returns true when a circle was planted this tick.
 */
export function trackHullContact(bot, speed, dt = 1 / 30) {
  const contacts = bot.vehicle?.drive?.hullContacts;
  const throttle = bot.moveForward ?? 0;
  if (!Array.isArray(contacts) || !contacts.length || Math.abs(throttle) <= 0.1 || speed >= MOVING_SPEED) {
    bot._hullContactTicks = 0;
    return false;
  }
  const f = bot._vehicleForward();
  const push = Math.sign(throttle);
  const px = bot.position[0], pz = bot.position[2];
  let hit = null, best = 0;
  for (const c of contacts) {
    const ny = c.normalY ?? c.normal?.[1] ?? 0;
    if (Math.abs(ny) >= HULL_WALL_NORMAL_Y) continue;
    const ahead = ((c.x - px) * f[0] + (c.z - pz) * f[1]) * push;
    if (ahead > best) { best = ahead; hit = c; }
  }
  if (!hit) { bot._hullContactTicks = 0; return false; }
  bot._hullContactTicks = (bot._hullContactTicks ?? 0) + dt * AI_TICK_HZ;
  if (bot._hullContactTicks < CONTACT_TICKS) return false;
  bot._hullContactTicks = 0;
  const r = bot._radius() + OBSTACLE_RADIUS;
  const unit = bot.vehicle?.vehicleId ?? null;
  // A contact a circle already covers is the route's to steer away from
  // (it was searched around it, and its first point backs out of it):
  // failing the route again on every hold would only stand the hull still
  // through the retry's pause, again and again. The obstruction counts
  // (`trackObstruction`) still fail a route that cannot get it free.
  if (bot.obstacles.some(ob => ob.r >= r && Math.hypot(ob.x - hit.x, ob.z - hit.z) < OBSTACLE_RADIUS)) return false;
  bot.obstacles.push({ x: hit.x, z: hit.z, r, age: 0, unit });
  bot._backOut = true;
  bot._replanKeepsCount = true;
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
    // A hull whose searches keep failing among the circles it planted on
    // itself forgets them (INVENTION): they are dropped only once the hull
    // is 25.5 m off (`ageObstacles`), and a hull they wall in never gets
    // there. On Berlin (8 a side, seed 7) a T34 held by its own circles at
    // its base sat with its throttle off and every route failing for 410 s,
    // 700 route failures (hull-steering.md, cause 4).
    if (bot.vehicle && (bot._pathFailures ?? 0) >= HULL_FORGET_AFTER_FAILURES) {
      const unit = bot.vehicle.vehicleId ?? null;
      const kept = bot.obstacles.filter(o => o.unit === undefined || o.unit !== unit);
      if (kept.length !== bot.obstacles.length) bot.obstacles = kept;
    }
  }
  const [bx, bz] = [bot.position[0], bot.position[2]];
  let coarse = null;
  // On the level's own strategic map every route asks the engine's test
  // (`updateStrategicPath` 0x08526e60: one region needs no strategic path);
  // on the painted coarse layer only a goal farther than two coarse cells
  // does (INVENTION).
  if (nav.strategic || Math.hypot(goal[0] - bx, goal[2] - bz) > COARSE_CELL * 2) {
    const valid = bot._validPos?.nav === nav ? bot._validPos.pos : null;
    // A driven hull whose goal the painted coarse layer cannot reach from
    // where it stands is sent as near as the map goes (`nearest`, INVENTION):
    // FH's Pegasus tractor, out of its pocket at last, was handed an order
    // point by Cafe Gondree that its map does not join to the bridge, and
    // stood with its throttle off and every route failing for 549 s
    // (hull-steering.md, cause 5). A soldier's route is as it was.
    coarse = findStrategicPath(nav, bx, bz, goal[0], goal[2], { fallbackStart: valid, stats: bot.pathBudget ?? null, nearest: !!bot.vehicle });
    if (!coarse) {
      bot._pathFailures++;
      // A goal the strategic map cannot reach is not asked again every tick:
      // the route stands failed and waits out the same pause a local failure
      // does (above). On FHSW Operation Varsity twelve bots ran 3,210 strategic
      // searches in 1,499 ticks, two a tick, nearly all of them this retry
      // (features/bot-path-budget).
      bot.route = {
        goal: [goal[0], goal[2]], coarse: [], points: [], index: 0, lastPassed: [bx, bz],
        failed: true, searches: 0, widen: 0, search: null, deferred: false,
      };
      bot._routeRetryAt = (bot._now ?? 0) + ROUTE_RETRY_AFTER;
      return null;
    }
    coarse.shift();                 // the first entry is the bot itself
  }
  // A wedged hull's route starts where it backs out to (INVENTION, with
  // `trackHullContact`): the nearest free point outside every circle at its
  // full radius, as `resolveStartPositionAgainstConstraints` 0x085f3270
  // moves a searcher out of a restriction and `checkAndInitAvoidPathfinding`
  // 0x08527bf0 re-plans from a start pushed off the obstacle's side (AI-32).
  // The route's legs are searched from there with the circles whole, so the
  // gap the hull wedged in is shut, and the point stays the route's first
  // until the hull has reached it or stands clear of every circle
  // (`popPassed`). Without it the start was the hull itself, the free cell
  // beside it was popped inside the hull's 3 m radius, the first point the
  // hull steered at lay ahead, through the obstacle, and
  // `actionStatusDecision` drove forward into it for good.
  //
  // A hull's point is first sought straight away from the circle it was
  // just held by, a turn radius off where the map and the circles allow,
  // else nearer (INVENTION): the nearest free point is often half a metre
  // off, the edge of a circle the hull barely stands in, and a hull that
  // backs half a metre has no more room to turn than before. FH's Pegasus
  // RedTractor, wedged on an object's corner at (512, -566.5), backed 0.3 m
  // to such a point, drove ahead on full lock into the same corner, and did
  // that for 508 s (hull-steering.md, cause 3). Only when that line has no
  // free point outside every circle does the nearest one stand.
  let backOut = null;
  if (bot.vehicle && bot._backOut) {
    bot._backOut = false;
    const held = bot.obstacles[bot.obstacles.length - 1];
    const dh = held ? Math.hypot(bx - held.x, bz - held.z) : 0;
    if (held && dh > 1e-3) {
      const ux = (bx - held.x) / dh, uz = (bz - held.z) / dh;
      const want = bot.vehicle.turnRadius ?? TANK.defaultTurnRadius;
      const outside = (x, z) => bot.obstacles.every(o => Math.hypot(x - o.x, z - o.z) >= o.r);
      for (let s = want; s >= 1; s -= 0.5) {
        const x = bx + ux * s, z = bz + uz * s;
        if (outside(x, z) && isWalkable(nav, x, z) && traceClear(nav, bx, bz, x, z, bot.obstacles)) { backOut = [x, z]; break; }
      }
    }
    if (!backOut) {
      const p = resolveClearStart(nav, bx, bz, bot.obstacles);
      if (p && Math.hypot(p[0] - bx, p[1] - bz) > 0.25) backOut = p;
    }
  }
  bot.route = {
    goal: [goal[0], goal[2]],
    coarse: coarse ?? [[goal[0], goal[2]]],
    points: backOut ? [backOut] : [],
    index: 0,
    lastPassed: [bx, bz],
    failed: false,
    searches: 0,
    widen: 0,
    search: null,     // the current leg's search, while a budget slices it
    deferred: false,  // the leg's search is mid-way: the route stands
    backOut,          // a wedged hull's first point (above), or null
  };
  // The count (`ObstructionDetection` +0, BotMain +0x1c0) starts again with
  // a new path: `initPathfinding` 0x0852a0d0 zeroes it (its long twin at +4,
  // `isObstructed`'s, it leaves). The engine builds a new path after the
  // count has failed one (401) or when the plan's goal moves; it does not
  // re-plan at the obstructed flag (150, `getNewIntermediatePathPos`
  // 0x0852ab60 only sets the bit). The viewer's re-plans at the flag and on
  // a touch are its own (INVENTION), and for a hull they keep the count, so
  // a hull that cannot get free still fails its path at 401 and backs out
  // again; each of them used to reset it, and the 401 never came. A
  // soldier's re-plans reset it as they always did (his walking is
  // unchanged by the hull fix).
  if (!(bot.vehicle && bot._replanKeepsCount)) bot._stalledTicks = 0;
  bot._replanKeepsCount = false;
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
  const budget = bot.pathBudget ?? null;
  let guard = 4;
  while (r.points.length - r.index < SMOOTHING && r.coarse.length && guard-- > 0) {
    if (!r.search) {
      const from = r.points.length ? r.points[r.points.length - 1]
        : [bot.position[0], bot.position[2]];
      const [tx, tz] = r.coarse[0];
      let radius = LOCAL_SEARCH_RADIUS_MIN + Math.random() * LOCAL_SEARCH_RADIUS_RAND;
      for (const ob of bot.obstacles) radius = Math.max(radius, ob.r);
      radius += 1 + ROUTE_RETRY_WIDEN * Math.min(3, bot._pathFailures);
      // A predicted circle over the route's own end is left out of the last
      // leg's search: the viewer's plans end at points the engine's would not
      // pick (a vehicle's door between two parked hulls), and the circle
      // would wall the goal itself (INVENTION).
      const last = r.coarse.length === 1;
      const obstacles = last && bot.obstacles.some(o => o.id && Math.hypot(o.x - tx, o.z - tz) < o.r)
        ? bot.obstacles.filter(o => !(o.id && Math.hypot(o.x - tx, o.z - tz) < o.r)) : bot.obstacles;
      // A leg the box cannot close is searched again in a wider box (the
      // engine's next decision pass draws a fresh radius) before the route
      // fails and waits for its retry: ONE search a tick, the widening carried
      // on the route (`r.widen`). All the widenings used to run in the tick the
      // first search failed in -- up to 428,000 node expansions in one 30 Hz
      // tick, a 350 ms stall on Berlin with sixteen bots (INVENTION of the
      // pacing either way; features/bot-fight-performance).
      const w = r.widen ?? 0;
      r.search = (w === 0
        ? beginLocalSearch(nav, from[0], from[1], tx, tz, { radius, obstacles, stats: budget })
        : beginLocalSearch(nav, from[0], from[1], tx, tz,
                           { radius: radius + ROUTE_RETRY_WIDEN * w, obstacles,
                             maxNodes: ROUTE_LEG_WIDE_NODES * w, stats: budget }))
        ?? { done: true, path: null };   // no open paint at either end: a failed leg
      r.searches++;
      r.searchTick = budget ? budget.tick : 0;
    }
    // The leg's search, stepped inside the tick's shared budget
    // (`newPathBudget`): its share of the nodes left, or all of them with
    // no budget. A search the share does not finish stands on the route
    // (`r.search`, `r.deferred`) and goes on next tick; one that has stood
    // `PATH_SEARCH_OVERDUE_TICKS` is run to its end this tick.
    let leg = null;
    if (r.search.done) {
      leg = r.search.path;
    } else {
      const overdue = budget && budget.tick - r.searchTick >= PATH_SEARCH_OVERDUE_TICKS;
      const share = !budget || overdue ? Infinity : budget.grant();
      if (overdue) budget.overdue++;
      if (share <= 0) {
        budget.deferred++; budget.pending++;
        r.deferred = true;
        return;
      }
      const step = stepLocalSearch(r.search, share);
      if (budget) budget.stepped++;
      if (!step.done) {
        if (budget) budget.pending++;
        r.deferred = true;
        return;
      }
      leg = step.path;
    }
    r.search = null;
    r.deferred = false;
    const w = r.widen ?? 0;
    if (!leg) {
      if (w < ROUTE_LEG_WIDENINGS) { r.widen = w + 1; return; }   // next tick, wider
      r.widen = 0;
      r.failed = true;
      bot._pathFailures++;
      return;
    }
    r.widen = 0;
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
  // A wedged hull steers at its back-out point until `popPassed` drops it,
  // whatever traces past it (INVENTION, with `trackHullContact`).
  if (r.backOut && r.points[0] === r.backOut) {
    bot._noVisiblePoint = false;
    r.index = 0;
    return r.points[0];
  }
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
    if (r.backOut && front === r.backOut) {
      // A wedged hull's back-out point goes once the hull is on it or has
      // passed it along the line it backed out on (INVENTION, `ensureRoute`).
      // It used to go as soon as the hull stood clear of every circle, which
      // is often half a metre from where it wedged: too little to turn in.
      const from = r.lastPassed ?? front;
      const passed = (front[0] - from[0]) * dx + (front[1] - from[1]) * dz >= 0;
      if (!passed && dx * dx + dz * dz >= BOT_RADIUS * BOT_RADIUS) break;
      r.backOut = null;
      r.lastPassed = front;
      r.points.shift();
      if (r.index > 0) r.index--;
      continue;
    }
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
  // A hull's throttle counts either way (INVENTION, the same rule's: "the
  // throttle on"). Counting only a forward throttle let a hull that
  // `actionStatusDecision` sends back and forth (state 9 ahead, state 8
  // astern, a pedal reversal every second or two) zero the count on every
  // reverse tick: FH's and FHSW's Pegasus RedTractor held its spawn pocket
  // that way for 578 s of a 600 s match (features/bot-map-generation/
  // hull-steering.md, cause 1). A soldier's throttle is never negative.
  const throttle = bot.vehicle ? Math.abs(bot.moveForward ?? 0) : bot.moveForward;
  const stalled = bot._noVisiblePoint
    || (throttle > 0.1 && speed < MOVING_SPEED);
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
    // A hull still held after the flag's re-plan backs out again from the
    // next route (INVENTION, `ensureRoute`).
    if (bot.vehicle) bot._backOut = true;
    return true;
  }
  return false;
}

/** A hull's failed searches in a row after which it forgets its own circles (`ensureRoute`, INVENTION). */
export const HULL_FORGET_AFTER_FAILURES = 2;

/** The window a driven hull's ground speed is measured over (`hullTravelSpeed`). */
export const HULL_TRAVEL_WINDOW = 1.0;

/**
 * The speed the obstruction rules read for a driven hull: the lower of its
 * body's speed now and the ground it covered over the last
 * `HULL_TRAVEL_WINDOW` seconds (INVENTION, the soldier's `travelSpeed`
 * counterpart: a soldier's speed has long been the ground they covered,
 * since their velocity is re-set to the command every grounded tick). A hull pressed
 * nose-first on a wall the map left open bounces on it: its velocity reads
 * 0.5 to 2 m/s tick to tick while it stays put, so `trackObstruction`'s
 * count was zeroed every second or two and `trackHullContact` never held.
 * FH's Pegasus RedTractor sat so for 342 s at (503.5, -599.9) in state 2,
 * its throttle full and its speed 0.7 m/s on the trace
 * (features/bot-map-generation/hull-steering.md, cause 2). Until the window
 * has filled (a new seat) the body's speed stands.
 */
export function hullTravelSpeed(bot, speed) {
  const now = bot._now ?? 0;
  const id = bot.vehicle?.vehicleId ?? null;
  let tr = bot._hullTravel;
  // A new seat, or a gap in the move's ticks (another plan ran), starts afresh.
  if (!tr || tr.id !== id || !(now >= tr.last) || now - tr.last > 0.25) tr = bot._hullTravel = { id, last: now, samples: [] };
  tr.last = now;
  const s = tr.samples;
  s.push([now, bot.position[0], bot.position[2]]);
  while (s.length > 2 && now - s[1][0] >= HULL_TRAVEL_WINDOW) s.shift();
  const span = now - s[0][0];
  if (span < HULL_TRAVEL_WINDOW * 0.75) return speed;
  const ground = Math.hypot(bot.position[0] - s[0][1], bot.position[2] - s[0][2]) / span;
  tr.speed = Math.min(speed, ground);
  return tr.speed;
}

/** Plant a potential obstacle where the body is stuck and re-plan. */
export function onObstructed(bot) {
  if (bot.vehicle) return onHullObstructed(bot);
  const x = bot.position[0] + Math.sin(bot.yaw) * OBSTACLE_AHEAD;
  const z = bot.position[2] + Math.cos(bot.yaw) * OBSTACLE_AHEAD;
  bot.obstacles.push({ x, z, r: OBSTACLE_RADIUS, age: 0 });
  if (bot.route) bot.route.failed = true;
}

/**
 * The obstructed flag for a driven hull. A soldier's circle (1.5 m, a metre
 * ahead of his look) planted for a 3 m hull lay inside the hull, toward
 * wherever its turret looked, and the re-plan took the same corridor. A hull
 * sized one (INVENTION of the placing, the radius `R_bot + R_object` as
 * `addPotentialObstacle` 0x0852ceb0 sizes the engine's, `OBSTACLE_RADIUS`
 * standing in for the object): `bot._radius() + OBSTACLE_RADIUS` around a
 * point just past the hull's end it is pushing toward (its front, or its
 * back while it reverses), and the re-plan backs out of it (`ensureRoute`).
 * Only a hull that is in fact slow gets one: the flag also rises on a hull
 * running fine across paint no point traces over, and that one only
 * re-plans.
 */
function onHullObstructed(bot) {
  const v = bot.vehicle?.drive?.state?.velocity;
  let speed = v ? Math.hypot(v.x, v.z) : 0;
  // The ground it covered, when the move has measured it (`hullTravelSpeed`):
  // a hull bouncing on what holds it reads a speed it is not making.
  const tr = bot._hullTravel;
  if (tr && Number.isFinite(tr.speed) && tr.last === (bot._now ?? 0)) speed = Math.min(speed, tr.speed);
  if (speed < MOVING_SPEED) {
    const f = bot._vehicleForward();
    const R = bot._radius();
    let push = (bot.moveForward ?? 0) < -0.1 ? -1 : 1;
    // A hull the turn in the box drives back and forth is held at whichever
    // end its map gives the shorter run (INVENTION, with the reverse count in
    // `trackObstruction`): the pedal at the count's 150th tick says only which
    // half of the shuffle it fell in, and a circle astern of a hull nosed into
    // a pocket backs it further in.
    const nav = bot._nav();
    if (nav) {
      const reach = 4 * R;
      const ahead = freeRun(nav, bot.position[0], bot.position[2], f[0], f[1], reach, bot.obstacles);
      const astern = freeRun(nav, bot.position[0], bot.position[2], -f[0], -f[1], reach, bot.obstacles);
      if (ahead !== astern) push = ahead < astern ? 1 : -1;
    }
    const ahead = (R + OBSTACLE_AHEAD) * push;
    bot.obstacles.push({ x: bot.position[0] + f[0] * ahead, z: bot.position[2] + f[1] * ahead,
                         r: R + OBSTACLE_RADIUS, age: 0, unit: bot.vehicle?.vehicleId ?? null });
    bot._backOut = true;
  }
  bot._replanKeepsCount = true;
  if (bot.route) bot.route.failed = true;
}

/**
 * A wedged hull's back-out (INVENTION, with `trackHullContact`,
 * `onHullObstructed` and `ensureRoute`'s back-out point): while the hull
 * steers at its route's back-out point and that point lies behind its beam,
 * it reverses straight to it, its tail steered at it the way state 8 of
 * `actionStatusDecision` steers a reverse (`-asin(n . dir)`), instead of
 * handing the point to the turn in the box. The box machine sees only the
 * map and the circles, and from inside a circle planted on what holds the
 * hull it reads the way ahead as open: it answered a point astern with state
 * 9 (ahead on full lock) or a turn in place, which a wheeled hull makes by
 * driving ahead, into what holds it. FH's Pegasus RedTractor, wedged on the
 * corner of a 3 x 4 m object at (511, -565) with its back-out point 3 m
 * astern, did that for 508 s (features/bot-map-generation/hull-steering.md,
 * cause 3). Returns `{ state, drive, angle, sign }` as the decision does, or
 * null when the point is not a back-out point astern.
 */
export function backOutDecision(bot, dx, dz, f, v) {
  const r = bot.route;
  const bo = r?.backOut;
  if (!bo || r.points[0] !== bo) return null;
  if (Math.abs(bot.position[0] + dx - bo[0]) > 1e-6 || Math.abs(bot.position[2] + dz - bo[1]) > 1e-6) return null;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return null;
  // The engine's frame (z negated), as `hullDecision` hands the machine.
  const fx = f[0], fz = -f[1];
  const ux = dx / len, uz = -dz / len;
  if (fx * ux + fz * uz >= 0) return null;
  const nl = Math.hypot(fz, fx) || 1;
  const side = Math.asin(Math.max(-1, Math.min(1, (fz * ux - fx * uz) / nl)));
  const velSign = v ? v.x * f[0] + v.z * f[1] : 0;
  return { state: 0, drive: -1, angle: -side, sign: velSign > 0 ? 1 : velSign < 0 ? -1 : 0 };
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
  // A circle the hull already stands in keeps only the part nearer its
  // centre than the hull, as the search keeps it (`cellOpen`,
  // `resolveStartPositionAgainstConstraints`): whole, `checkLine` fails every
  // run from inside it, and the decision could only turn in place, never
  // back out of a circle planted on what the hull touched (INVENTION: the
  // engine's circles are planted before the touch, by `BBAvoid`'s prediction).
  const objects = bot.obstacles.map(o => {
    const ds = Math.hypot(px - o.x, pz - o.z);
    return { x: o.x, z: -o.z, r: ds < o.r ? Math.max(0, ds - (nav?.cellSize ?? 1) * 0.5) : o.r };
  });
  const asd = bot._asd ?? (bot._asd = { state: 0 });
  const back = backOutDecision(bot, dx, dz, f, v);
  if (back) {
    asd.state = 0;
    bot._dbgMoveStatus = 'back';
    bot._dbgBox = box;
    return back;
  }
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
 * the full rate (the engine writes the angle as +-pi/2). A driven ship
 * never reaches here: `BotController._steerToward` (bot.js) sends it to
 * bot-plans.js `steerBoat`, the helm that reads the held throttle channel
 * (AI-112); a ship seat that does not drive returns below.
 */
export function steerToward(bot, x, z, speed = 1) {
  const dx = x - bot.position[0];
  const dz = z - bot.position[2];
  if (dx * dx + dz * dz < 1e-8) { bot.moveForward = 0; return; }
  if (bot.vehicle && !bot.vehicle.drives) { bot.moveForward = 0; bot.moveStrafe = 0; return; }
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
  // Still in a landing craft's hold: its walk over the bow comes first
  // (doctrine-landing.js `disembarkPath`, INVENTION).
  const off = disembarkPoint(bot);
  if (off) return steerOnFoot(bot, off[0] - bot.position[0], off[1] - bot.position[2], speed);
  steerOnFoot(bot, dx, dz, speed);
}

/** The next point of the bot's walk off a landing craft, or null once it is
 *  done or has run out of time (`bot._disembark`, bot-referee.js
 *  `leaveVehicle`). */
function disembarkPoint(bot) {
  const d = bot._disembark;
  if (!d) return null;
  if ((bot._now ?? 0) > d.until) { bot._disembark = null; return null; }
  while (d.points.length
         && Math.hypot(d.points[0][0] - bot.position[0], d.points[0][1] - bot.position[2]) < d.arrive) {
    d.points.shift();
  }
  if (!d.points.length) { bot._disembark = null; return null; }
  return d.points[0];
}

/** A soldier's steer: face the heading, and run once it is inside the cone. */
function steerOnFoot(bot, dx, dz, speed) {
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
  const speed = 1;
  // `walk` is the garrison patrol's gait (doctrine-garrison.js, INVENTION),
  // not a pose.
  if (action.stance === 'walk') bot.walkInput = true;
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
  if (!bot.vehicle) {
    // The move's own pose (`BAPAMoveTo`'s component, bot-pose.js `movePose`:
    // stand, prone once the attacker strength passes its own threshold),
    // asked on every tick the move steers (`EntryInfanteryMoveTo::execute`
    // 0x08616270 with `getControl`, vt+0x78; not on the arriving tick). The
    // entries ask only once the move hands them a point
    // (`EntryMoveToObjectMediumSoldier::execute` 0x0861ecc0 returns before
    // the pose while the move's `getSecondPoint` flag is clear), and a
    // finding move's point is the budgeted search's (`getNewIntermediatePathPos`
    // 0x0852ab60 after `BotMain::updatePathfinding`): a move made this tick
    // asks nothing yet (INFERRED; the viewer's route is found at once). So
    // the one tick another behaviour wins in a fight stands nobody up.
    action._pose ??= movePose(bot.random);
    action._poseTicks = (action._poseTicks ?? 0) + 1;
    if (action._poseTicks > 1) bot._requestPose(bot._poseOf(action._pose, bot._now ?? 0, 'control'));
  }

  // `_resetInput` has zeroed this tick's word; the stall test wants the
  // throttle the body was given last tick. A soldier's speed is the ground he
  // covered, not his velocity: that is re-set to the command every grounded
  // tick, so a body wedged under a ramp read a full run and never stalled.
  const soldier = bot._player()?.soldier;
  const hullV = bot.vehicle?.drive?.state?.velocity;
  const bodySpeed = hullV ? hullTravelSpeed(bot, Math.hypot(hullV.x, hullV.z))
    : (soldier?.travelSpeed ?? soldier?.speed ?? 0);
  bot.moveForward = bot._lastThrottle ?? 0;
  if (!bot.vehicle) {
    predictObstacles(bot);
    bot._trackContact(soldier);
  } else if (bot.vehicle.drives) {
    predictObstacles(bot);
    trackHullContact(bot, bodySpeed, dt);
  }
  if (bot._trackObstruction(bodySpeed, dt)) {
    // The path failed (`+0xc = 3`): next tick rebuilds it around the
    // obstacles, or walks straight at the goal after repeated failures. A
    // wedged hull's next route starts behind it (`ensureRoute`'s back-out
    // point), and `actionStatusDecision` turns or reverses it there.
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
    // No point yet because the first leg is still being widened (one search
    // a tick, `extendRoute`): the route stands and the next tick searches
    // wider. Failing it here threw the widening away; the retry started again
    // from the narrow box, so a first leg the third widening would have closed
    // never was, and a hull held its throttle at 0 for good. A leg whose
    // search the tick's budget left mid-way stands the same way.
    if (!route.widen && !route.deferred) route.failed = true;
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
