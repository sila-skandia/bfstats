// A bot's plans: the winning behaviour's plan generators (Idle, MoveTo,
// Fire, Scout, TakeCover, Avoid and the medic's Special) and the plan
// interpreter that runs a plan's actions each tick through the infantry
// instruction set. Plain functions of the `BotController` (bot.js), which
// delegates its methods here.

import { isWalkable } from './nav-grid.js';
import { playerPosition } from './bot-sense.js';
import { firingPose, firePlanFor, fireApproachStep, FIRE, FIRE_APPROACH } from './bot-fire.js';
import { SCOUT, TAKE_COVER, MEDIC } from './bot-behaviours.js';
import { planeFireMode, PLANE_FIRE, boatControl, BOAT } from './bot-vehicle-air.js';
import { freeLevel } from './nav-grid.js';
import { hullDecision } from './bot-route.js';
import { AIM_COUNTS_MAX, wrapAngle, faceTarget, turretAimAt, turretMiss, precisionFor, precisionHolds, targetShape } from './bot-aim.js';
import { BEHAVIOUR } from './bot-decision.js';
import { planAirAvoid, execPlaneAvoid } from './bot-pilot.js';

/**
 * Plan action types for infantry (§4.2), the interpreter entries the viewer
 * runs. `MouseTurretLookAt` and `Sense` carry a direction, the movers a
 * point or a target id.
 */
export const PLAN_ACTION = {
  InfantryMoveTo: 'InfanteryMoveTo',
  InfantryMoveToObject: 'InfanteryMoveToObject',
  InfantryMoveToDirection: 'InfanteryMoveToDirection',
  /** `BBPFireInfantery`'s move for a tank: hold with a shot, else close by
   *  `BAPAMoveToObjectFinding` (bot-fire.js `fireApproachStep`). */
  FireApproach: 'FireApproach',
  /** `BAPAMoveToDirect` under a boat's helm: a straight run, no route. */
  BoatMoveToDirect: 'BoatMoveToDirect',
  EnterVehicle: 'EnterVehicle',
  ExitVehicle: 'ExitVehicle',
  /** `BBPChangeTeleport`: the seat-select key for another seat of the hull. */
  SwitchSeat: 'SwitchSeat',
  /** `BBPFire3d`: the aircraft's attack loop (approach, aim and fire, break). */
  PlaneAttack: 'PlaneAttack',
  /** `BBPAvoidCollision3d`: the aircraft's turn away from a predicted collision. */
  PlaneAvoid: 'PlaneAvoid',
  MoveToMediumSoldier: 'MoveToMediumSoldier',
  MoveToObjectMediumSoldier: 'MoveToObjectMediumSoldier',
  MouseTurretAimAt: 'MouseTurretAimAt',
  MouseTurretLookAt: 'MouseTurretLookAt',
  Trigger: 'Trigger',
  TriggerContinously: 'TriggerContinously',
  InfantryResetControls: 'InfanteryResetControls',
  Sense: 'Sense',
  SoldierPose: 'SoldierPose',
  InfoWrapper: 'InfoWrapper',
};

/** `BAPALookAtObject` in the fire plan: within 5 deg. */
const LOOK_TOLERANCE = 5 * Math.PI / 180;
/** A remembered target's plan gets `firingTargetTime` from `setFiringTarget`. */
/** The Avoid sidestep (INVENTION, header): a diagonal a second of travel long,
 *  ended after half a second. */
const AVOID_STEP = 5.0;
const AVOID_TIME = 0.5;

// -----------------------------------------------------------------------
// Plan generators
// -----------------------------------------------------------------------

export function generatePlan(bot, behaviour, now) {
  switch (behaviour) {
    case BEHAVIOUR.Fire: return bot._planFire(now);
    case BEHAVIOUR.TakeCover: return bot._planTakeCover(now);
    case BEHAVIOUR.Special: return bot._planSpecial(now);
    case BEHAVIOUR.Change: return bot._planChange(now);
    case BEHAVIOUR.MoveTo: return bot._planMoveTo(now);
    case BEHAVIOUR.Scout: return bot._planScout(now);
    case BEHAVIOUR.Avoid: return bot._planAvoid(now);
    case BEHAVIOUR.Idle:
    default: return bot._planIdle();
  }
}

/** `BBPIdleInfantery`: `while (true) reset controls`. */
export function planIdle(bot) {
  if (bot.planBehaviour === BEHAVIOUR.Idle && bot.currentPlan.length) return bot.currentPlan;
  if (bot.vehicle?.kind === 'air' && bot.vehicle.drives) {
    // `BBPIdle3d::createPlan`: flying (or rolling faster than 0.1 m/s) the
    // plane holds a `MoveTo3d` to where it is under `ConFalse` — an orbit
    // of that point; on the ground and still it only resets the controls.
    const st = bot.vehicle.drive?.state;
    const speed = st ? Math.hypot(st.velocity.x, st.velocity.y, st.velocity.z) : 0;
    if (st && (speed > PLANE_FIRE.idleSpeed || !bot.vehicle.drive?.grounded)) {
      return [{ type: PLAN_ACTION.InfantryMoveTo, waypoint: [st.position.x, st.position.y, st.position.z],
                orbit: true, persistent: true }];
    }
  }
  return [{ type: PLAN_ACTION.InfantryResetControls, persistent: true }];
}

/**
 * `BBPGotoWaypointSoldier::createPlan`: a pose (stand) and a MoveTo to the
 * waypoint's point with its radius; rebuilt only when the goal moved by
 * more than `4 * maxSpeed`.
 */
export function planMoveTo(bot, now) {
  const wp = bot.waypoints ?? bot._fallbackWaypoint();
  if (!wp) return bot._planIdle();
  // An air order's point carries its height (`orderAirBot`: ground + 75).
  const goal = [wp.point[0], Number.isFinite(wp.y) ? wp.y : bot.position[1], wp.point[1]];
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.MoveTo && cur.length && cur[0].waypointObject === wp) return cur;
  if (wp.direct && bot.vehicle?.kind === 'ship' && bot.vehicle.drives) {
    // `BBPGotoWaypointBoat::createPlan` 0x085b8c50, a beach order inside its
    // zone (doctrine-landing.js): `while (true) { BAPAMoveToDirect` to the
    // beach point, no route and no end (its point removal distance is 0.1,
    // `getMaxPointRemovalDistance` 0x08543160, and the point is on the
    // shore), `BAPATriggerContinously(PIPitch) }`: the ramp held.
    return [{ type: PLAN_ACTION.BoatMoveToDirect, waypoint: goal, waypointObject: wp, persistent: true, ramp: true }];
  }
  // `gait`: the garrison's patrol walks (doctrine-garrison.js, INVENTION).
  const plan = [{ type: PLAN_ACTION.InfantryMoveTo, waypoint: goal, arrive: wp.radius, waypointObject: wp,
                  stance: wp.gait === 'walk' && !bot.vehicle ? 'walk' : 'stand' }];
  // `BBPGotoWaypoint2d::createPlan` 0x085b5490 runs a `BAPALookAhead(bot,
  // 5 deg)` beside the move (0x085b5531..) when the unit's ControlInfo looks
  // on other controls than it drives with (the +0x64 / +0x54 words, 0x085b54fb):
  // `getLookDirection` 0x0853fa90 is the unit's own facing
  // (`InformationReal::getFaceing` 0x085e8d60, Information vt+0x2c), so a
  // tank's turret looks down its hull while it drives and its sense sweep
  // covers the road ahead. A driven tank stands for the mask test, as in
  // `approachesByFinding` (Brief R, ledger AI-123). Before, nothing turned
  // the turret in MoveTo and it kept whatever the last look left it at.
  if (bot.vehicle?.drives && bot.vehicle.kind === 'tank') plan.push({ type: PLAN_ACTION.MouseTurretLookAt, ahead: true });
  return plan;
}

/** `BBPFireInfantery::createPlan` through `firePlanFor`. */
export function planFire(bot, now) {
  if (!bot.firingTarget || !bot.targetPosition) return bot._planIdle();
  if (bot.vehicle?.kind === 'air' && bot.vehicle.drives) {
    // `BBPFire3d::createPlan`: the target's mode and aim radius, then the
    // loop `createPlanInternal` builds (`attackRunStep`).
    const cur = bot.currentPlan;
    if (bot.planBehaviour === BEHAVIOUR.Fire && cur.length && cur.targetId === bot.firingTarget
        && !bot._firePlanDone(cur, now)) return cur;
    const info = bot._unitInfo(bot.firingTarget);
    const fm = planeFireMode({ extents: info.extents ?? [0.6, 1.8, 0.6], vehicle: !!info.seats?.length || !!info.vehicle,
                               large: info.large === true, mobile: info.mobile !== false });
    const weapon = bot.weapons[bot.weaponIndex] ?? bot.weapons[0];
    bot._attackState = { phase: 'approach', breakFrom: null };
    const plan = [{ type: PLAN_ACTION.PlaneAttack, targetId: bot.firingTarget, targetPos: [...bot.targetPosition],
                    mode: fm.mode, radius: fm.radius, maxRange: weapon?.maxRange ?? 300, persistent: true,
                    heatLimit: fm.mode === 0 ? PLANE_FIRE.weaponHeatSmall : PLANE_FIRE.weaponHeatVehicle }];
    plan.targetId = bot.firingTarget; plan.startedAt = now; bot._shotsThisPlan = 0;
    return plan;
  }
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.Fire && cur.length && cur.targetId === bot.firingTarget
      && !bot._firePlanDone(cur, now)) {
    return cur;
  }
  const weapon = bot.weapons[bot.weaponIndex] ?? bot.weapons[0];
  if (approachesByFinding(bot)) {
    // `createPlanInternal` 0x085a74e0 from 0x085a7c5e: the approach, the
    // look and the trigger side by side (bot-fire.js `FIRE_APPROACH`).
    const plan = [
      { type: PLAN_ACTION.FireApproach, targetId: bot.firingTarget, targetPos: [...bot.targetPosition], persistent: true },
      { type: PLAN_ACTION.MouseTurretAimAt, targetId: bot.firingTarget, targetPos: [...bot.targetPosition] },
      { type: weapon?.burst ? PLAN_ACTION.TriggerContinously : PLAN_ACTION.Trigger,
        targetId: bot.firingTarget, targetPos: [...bot.targetPosition], startedAt: now, timeout: FIRE.planTimeout,
        shots: weapon?.burst ? 0 : Math.min(FIRE.shotsMax, 1 + Math.floor(Math.random() * FIRE.shotsMax)) },
    ];
    plan.targetId = bot.firingTarget;
    plan.startedAt = now;
    bot._shotsThisPlan = 0;
    return plan;
  }
  const pose = firingPose(bot.position, bot.targetPosition, (a, b) => bot._lineClear(a, b));
  const plan = firePlanFor({
    position: bot.position, targetPos: bot.targetPosition, targetId: bot.firingTarget,
    weapon, pose: pose ?? 'stand', now,
  });
  plan.targetId = bot.firingTarget;
  plan.startedAt = now;
  bot._shotsThisPlan = 0;
  return plan;
}

/**
 * Whether the bot's fire plan takes `BAPAMoveToObjectFinding` (bot-fire.js
 * `FIRE_APPROACH`): its unit moves (the Mobile plug-in) and drives on other
 * controls than it aims with, and its vehicle type runs `BBPFireInfantery`
 * (`AIbehaviours.con`: Tank; a car's Fire is `BBPFireDriveAttack`). The
 * viewer does not extract the ControlInfo's drive and aim channels; every
 * vanilla tank declares `driveTurnControl PIYaw` and `aimHorizontalControl
 * PIMouseLookX` (Objects/Vehicles/Land/<hull>/AI/Objects.con, the Sherman's
 * lines 25..28), so a driven tank stands for the test (INFERRED for the
 * mods' hulls).
 */
export function approachesByFinding(bot) {
  // `_noApproach`: the runner's control (tests/sim_vehicles_harness.mjs).
  return !!(bot.vehicle && bot.vehicle.drives && bot.vehicle.kind === 'tank' && !bot._noApproach);
}

/**
 * `BAPConObjectValidPitchAiming` / `ValidAiming` as the approach's S reads
 * it: the line from the gun to the target inside the seat's camera pitch
 * window (`cameraMinDeg` / `cameraMaxDeg` y, the engine's pitch negative
 * up: the Sherman's -20 .. 5 is 20 deg up to 5 deg down). The engine aims
 * along `internalAiming`'s ballistic lead (0x085527d0); the straight line
 * stands for it here (INFERRED). No window, no limit.
 *
 * The pitch is taken in the hull's frame, not the world's:
 * `validateCameraDirectionPitch` 0x085d4570 (and the pitch half of
 * `validateCameraDirection` 0x085d4170) dots the aim with the second row of
 * `getCameraBaseTransformation` (the base's up axis) and tests -asin of that
 * against +0x6c / +0x78, so a hull nosed down a slope still reaches a target
 * below the horizon (read 2026-09-24, ledger AI-128).
 */
export function approachAimValid(bot, targetPos) {
  const c = bot.vehicle?.controlInfo;
  const lo = c?.cameraMinDeg?.[1], hi = c?.cameraMaxDeg?.[1];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return true;
  const o = bot._aimOrigin?.() ?? bot.position;
  const dx = targetPos[0] - o[0], dy = targetPos[1] + 1.0 - o[1], dz = targetPos[2] - o[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const u = hullUp(bot);
  const s = Math.max(-1, Math.min(1, (dx * u[0] + dy * u[1] + dz * u[2]) / len));
  const up = Math.asin(s) * 180 / Math.PI;
  bot._approachPitch = up;
  return up >= -hi && up <= -lo;
}

/** The hull's up axis in the world: its drive's orientation, else the seat
 *  node's world matrix (the y column), else straight up. */
export function hullUp(bot) {
  const q = bot.vehicle?.drive?.state?.orientation;
  if (q) {
    // q * (0, 1, 0)
    const { x, y, z, w } = q;
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  }
  const e = bot.vehicle?.node?.matrixWorld?.elements;
  if (e) {
    const l = Math.hypot(e[4], e[5], e[6]) || 1;
    return [e[4] / l, e[5] / l, e[6] / l];
  }
  return [0, 1, 0];
}

/**
 * One tick of the approach (bot-fire.js `fireApproachStep`): S is the
 * target within minRange .. 0.9 maxRange (3D), a valid aim and a line of
 * fire (`BAPConObjectLineOfFire` 0x08551890: the memory record of it is
 * seen). Holding resets the drive only (`BAPAResetControls(1, 0, 0)` at
 * 0x085aa111): the look and the trigger go on. Closing is the page's route
 * to the target with the finding's goal radius; the path is searched again
 * when S is lost after holding (`update` 0x08546df0, its +0xb4 latch).
 * The finding's 0.5 maxSpeed arrival speed is not ported.
 *
 * Two departures (INVENTION, 2026-09-24, features/bot-stalemates):
 *  - S also asks for a clear line from the barrel to the target
 *    (`muzzleClear`). The engine's S reads only the memory record, which the
 *    sensing sets from the seat's camera; a hull pressed against a building
 *    with its camera over the roof line held S and shelled the wall (Bocage,
 *    an M10 at the lumber mill).
 *  - Inside `mid` the engine's tank holds wherever S fails, and nothing in
 *    its fire state machine gives a tank another firing point
 *    (`BBPFireInfantery::createPlan` 0x085a3870: state 1 keeps the bot's own
 *    position; the portal states need the soldier flag). A tank looking
 *    down at a target below its 5 deg depression, or at one it cannot see,
 *    sat there for minutes, and so did the target. After `FIRE_UNBLOCK.grace`
 *    seconds without S (kept on the bot: the plan is rebuilt every few
 *    seconds by the urge curve) the tank moves: toward the target when the
 *    target is too low, unseen or behind cover (down a slope the hull noses
 *    over and its gun reaches), away from it when it is above the gun's
 *    elevation, until S holds again.
 */
export const FIRE_UNBLOCK = { grace: 2.0, backOffMargin: 2.0 };

export function execFireApproach(bot, action, dt) {
  const p = bot.world?.players?.get(action.targetId);
  const pos = playerPosition(p) ?? action.targetPos;
  if (!pos) return true;
  const weapon = bot.weapons[bot.weaponIndex] ?? bot.weapons[0];
  const [x, y, z] = bot.position;
  const dist = Math.hypot(pos[0] - x, pos[1] - y, pos[2] - z);
  const min = weapon?.minRange ?? 0, max = weapon?.maxRange ?? 0;
  const seen = !!bot.senses?.memory?.get(action.targetId)?.seen;
  const inRange = dist >= min && dist <= FIRE_APPROACH.inRangeFraction * max;
  const aim = approachAimValid(bot, pos);
  const muzzle = inRange && seen && aim ? muzzleClear(bot, pos) : null;
  const holds = inRange && seen && aim && muzzle !== false;
  const now = bot._now ?? 0;
  if (holds || bot._approachBlock?.targetId !== action.targetId) {
    bot._approachBlock = holds ? null : { targetId: action.targetId, since: now };
  }
  const blockedFor = bot._approachBlock ? now - bot._approachBlock.since : 0;
  // The firing point: here, or `calculateAwayPosition` when the target is
  // inside minRange + 1 (bot-fire.js `firePlanFor`'s back-off radius).
  let point = [x, y, z];
  if (dist < min + FIRE.tooClose) {
    const r = FIRE.awayRadius(min);
    const d2 = Math.hypot(pos[0] - x, pos[2] - z);
    const ux = d2 > 1e-3 ? (pos[0] - x) / d2 : 0, uz = d2 > 1e-3 ? (pos[2] - z) / d2 : 1;
    point = [pos[0] - ux * r, y, pos[2] - uz * r];
  }
  const near = Math.hypot(pos[0] - point[0], pos[1] - point[1], pos[2] - point[2])
    <= FIRE_APPROACH.nearPointScale * min + FIRE_APPROACH.nearPointPad;
  const ext = bot._unitInfo?.(action.targetId)?.extents ?? [0.6, 1.8, 0.6];
  const targetRadius = 0.5 * Math.hypot(ext[0], ext[1], ext[2]);
  let step = fireApproachStep({ dist, holds, weapon, nearFiringPoint: near, targetRadius });
  // The unblocking move (header): inside `mid`, S lost for the grace period.
  let unblock = null;
  if (!holds && step.move !== 'find' && blockedFor >= FIRE_UNBLOCK.grace && dist >= min + FIRE.tooClose) {
    const tooHigh = inRange && seen && !aim && approachTooHigh(bot);
    unblock = tooHigh ? 'back' : 'close';
    step = { move: 'find', arrive: FIRE_APPROACH.arriveTargetScale * targetRadius };
  }
  bot._fireApproachDbg = { move: unblock ? `unblock-${unblock}` : step.move, dist, seen, holds, inRange, aim,
                           muzzle, pitch: bot._approachPitch };
  action.holds = holds;
  if (step.move === 'end') { action.ended = true; return true; }
  if (step.move === 'hold' || (step.move === 'point' && point[0] === x && point[2] === z)) {
    action.held = step.move === 'hold';
    bot.moveForward = 0; bot.moveStrafe = 0; bot._lastThrottle = 0;
    return false;
  }
  if (step.move === 'find' && (action.held || action.unblock !== unblock)) { bot.route = null; action.held = false; }
  action.unblock = unblock;
  let goal = point;
  if (unblock === 'back') {
    goal = backOffGoal(bot, pos, FIRE_APPROACH.inRangeFraction * max);
    if (!goal) { action.ended = true; action.noGoal = true; return true; }
  } else if (step.move === 'find') {
    goal = approachGoal(bot._nav?.(), pos, bot.position, FIRE_APPROACH.inRangeFraction * max);
    if (!goal) { action.ended = true; action.noGoal = true; return true; }
  }
  action.move ??= {};
  action.move.waypoint = goal;
  action.move.arrive = unblock === 'back' ? FIRE_UNBLOCK.backOffMargin : step.move === 'find' ? step.arrive : undefined;
  bot._execInfantryMoveTo(action.move, dt);
  return false;
}

/** Whether the barrel's straight line to the target's aim point is clear
 *  of everything but the bot's own hull and the target's (INVENTION, the
 *  approach's header); null when the bot has no barrel to cast from. */
export function muzzleClear(bot, targetPos) {
  const o = bot._aimOrigin?.();
  if (!o || !bot._lineClear) return null;
  return bot._lineClear(o, [targetPos[0], targetPos[1] + 1.0, targetPos[2]]);
}

/** The last `approachAimValid` failed above the window's top (the target
 *  higher than the gun elevates) rather than below its bottom. */
function approachTooHigh(bot) {
  const hi = bot.vehicle?.controlInfo?.cameraMinDeg?.[1];
  return Number.isFinite(bot._approachPitch) && Number.isFinite(hi) && bot._approachPitch > -hi;
}

/**
 * Where a tank backs off to for a target above its elevation (INVENTION,
 * `FIRE_UNBLOCK`): along the line from the target through the tank, at the
 * horizontal distance where the rise is `backOffMargin` degrees inside the
 * window's top, no further than `radius` (0.9 maxRange); the first walkable
 * point back toward the tank from there, or null.
 */
export function backOffGoal(bot, targetPos, radius) {
  const c = bot.vehicle?.controlInfo;
  const top = -(c?.cameraMinDeg?.[1] ?? -20) - FIRE_UNBLOCK.backOffMargin;
  const o = bot._aimOrigin?.() ?? bot.position;
  const rise = targetPos[1] + 1.0 - o[1];
  const dx = bot.position[0] - targetPos[0], dz = bot.position[2] - targetPos[2];
  const h = Math.hypot(dx, dz);
  if (!(h > 1e-3) || !(top > 1)) return null;
  const want = Math.min(radius, Math.max(h + 5, rise / Math.tan(top * Math.PI / 180)));
  const ux = dx / h, uz = dz / h;
  const nav = bot._nav?.();
  const cell = nav?.cellSize ?? 1;
  for (let d = want; d > h; d -= cell) {
    const gx = targetPos[0] + ux * d, gz = targetPos[2] + uz * d;
    if (!nav || isWalkable(nav, gx, gz)) return [gx, bot.position[1], gz];
  }
  return null;
}

/**
 * The approach's goal (Brief R item 4, ledger AI-126):
 * `BAPAMoveToObjectFinding::initObjectFinding` 0x08545df0 beyond the
 * away radius takes the target's own point when it is valid on the unit's
 * map (`AIPathfinding::isValidPosition` vt+0x78); else the target's last
 * valid position (`IPIMobileReal::getValidPosition` 0x085eab10 ->
 * `AIObjectMobile::getValidPosition` 0x085d5bb0, +0x20 while +0x2c is set)
 * when that is valid here and within the finding's radius (+0x68, 0.9
 * maxRange) of the target; else `traceValidPoint` (vt+0x54 0x0847e500 ->
 * 0x0847e3a0: the target's point if valid, else a Bresenham line of map
 * pixels from the target toward the bot, the first valid one) within that
 * radius; else the same trace toward `getNearStrategicPosition` (vt+0x9c);
 * else the finding has no goal (+0x6c cleared). Here the target's last valid
 * position and the strategic fallback are not ported (the target's
 * controller is not reachable from the plan), and a finding with no goal
 * ends the plan (INFERRED: what `update` 0x08546df0 does with +0x6c clear
 * was not read). Before, the route took the target's point and moved a
 * blocked goal to the nearest free metre within 20 m (INVENTION), failing
 * every retry when there was none (El Alamein seed 10, 634 failures).
 */
export function approachGoal(nav, target, from, radius) {
  if (!nav) return [target[0], target[1], target[2]];
  if (isWalkable(nav, target[0], target[2])) return [target[0], target[1], target[2]];
  const dx = from[0] - target[0], dz = from[2] - target[2];
  const len = Math.hypot(dx, dz);
  const step = nav.cellSize ?? 1;
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = target[0] + dx * t, z = target[2] + dz * t;
    if (Math.hypot(x - target[0], z - target[2]) > radius) break;
    if (isWalkable(nav, x, z)) return [x, target[1], z];
  }
  return null;
}

/** The fire plan's end conditions: target dead, timeout, shots spent. */
export function firePlanDone(bot, plan, now) {
  if (plan.some(a => a.type === PLAN_ACTION.FireApproach && a.ended)) return true;
  const attack = plan.find(a => a.type === PLAN_ACTION.PlaneAttack);
  if (attack) {
    // The loop's conditions: the target exists with health, the magazine
    // is not dry, and the plane is within the battle zone.
    if (bot.world?.armorOf?.(plan.targetId)?.destroyed) return true;
    if (!bot.world?.players?.get(plan.targetId)) return true;
    if (bot.magazineEmpty) return true;
    return false;
  }
  const trigger = plan.find(a => a.type === PLAN_ACTION.Trigger || a.type === PLAN_ACTION.TriggerContinously);
  if (!trigger) return true;
  if (now - plan.startedAt > trigger.timeout) return true;
  if (trigger.shots > 0 && (bot._shotsThisPlan ?? 0) >= trigger.shots) return true;
  if (bot.magazineEmpty) return true;                 // an empty magazine
  if (bot.world?.armorOf?.(plan.targetId)?.destroyed) return true;
  return false;
}

/** `BBPScoutInfantery::createPlan`: look along the direction, sense, pose. */
export function planScout(bot, now) {
  const dir = bot._scoutDir;
  if (!dir) return bot._planIdle();
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.Scout && cur.length && cur.dir) {
    const dot = cur.dir[0] * dir[0] + cur.dir[1] * dir[1] + cur.dir[2] * dir[2];
    if (dot > SCOUT.planReuseCos) return cur;
  }
  const plan = [
    { type: PLAN_ACTION.SoldierPose, pose: bot.isUnderFire ? 'prone' : 'stand' },
    { type: PLAN_ACTION.MouseTurretLookAt, dir, persistent: true },
    { type: PLAN_ACTION.Sense, dir, deviation: SCOUT.senseDeviation },
  ];
  plan.dir = dir;
  return plan;
}

/**
 * `BBPTakeCoverInfantry::createPlan`: walk behind the cover (or to the
 * lowest ground away from the danger), then the pose ladder and a look at
 * the danger.
 */
export function planTakeCover(bot, now) {
  const r = bot._coverResult;
  if (!r?.urgency) return bot._planIdle();
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.TakeCover && cur.length && cur.danger && r.dangerPos) {
    const moved = Math.hypot(cur.danger[0] - r.dangerPos[0], cur.danger[2] - r.dangerPos[2]);
    if (moved < (r.dangerId ? TAKE_COVER.reuseMoveObject : TAKE_COVER.reuseMoveStatic)) return cur;
  }
  let goal = r.goal;
  let arrive = Math.max(TAKE_COVER.arriveMin, 0.5 * 5.0);
  let prone = false;
  if (!goal) {
    const low = bot.cover.lowestGround({
      position: bot.position,
      isWalkable: bot.navGrid ? (x, z) => isWalkable(bot.navGrid, x, z) : null,
      heightAt: (x, z) => bot.world?.collider?.surfaceHeight?.(x, z) ?? 0,
    }, r.dangerPos);
    if (!low) return bot._planIdle();
    goal = low;
    arrive = TAKE_COVER.arriveMin;
    prone = true;
  }
  const plan = [
    { type: PLAN_ACTION.InfantryMoveTo, waypoint: [goal[0], bot.position[1], goal[1]], arrive, stance: prone ? 'prone' : 'stand' },
    { type: PLAN_ACTION.SoldierPose, pose: prone ? 'prone' : 'ladder', danger: r.dangerPos, afterMove: true },
    { type: PLAN_ACTION.MouseTurretLookAt, target: r.dangerPos, afterMove: true, persistent: true },
  ];
  plan.danger = r.dangerPos;
  return plan;
}

/** The Avoid sidestep: a diagonal away from the body (header). */
export function planAvoid(bot, now) {
  if (bot.vehicle?.kind === 'air' && bot.vehicle.drives) {
    // `BBPAvoidCollision3d::createPlan` 0x08587420 (bot-pilot.js).
    const cur = bot.currentPlan;
    if (bot.planBehaviour === BEHAVIOUR.Avoid && cur.length && cur.otherId === bot._airAvoidBest?.id
        && !cur.every(a => a.done)) return cur;
    const r = planAirAvoid(bot, now);
    if (!r) return bot._planIdle();
    const plan = [{ type: PLAN_ACTION.PlaneAvoid, point: r.point, until: r.until }];
    plan.otherId = r.otherId;
    return plan;
  }
  const t = bot._avoidThreatDir;
  if (!t) return bot._planIdle();
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.Avoid && cur.length && now < bot.avoidUntil) return cur;
  const fx = Math.sin(bot.yaw), fz = Math.cos(bot.yaw);
  const rx = fz, rz = -fx;
  const side = (t[0] * rx + t[1] * rz) > 0 ? -1 : 1;
  const dx = (fx + side * rx) * Math.SQRT1_2, dz = (fz + side * rz) * Math.SQRT1_2;
  bot.avoidUntil = now + AVOID_TIME;
  return [{ type: PLAN_ACTION.InfantryMoveToDirection, direction: [dx, dz], distance: AVOID_STEP, until: bot.avoidUntil }];
}

/**
 * `BBPMedicAssist::createPlan`: the healing weapon, the walk to `R +
 * 0.9 * range` when farther, then the look within 5 deg and the trigger
 * held while the friend is under 95 % and in reach.
 */
export function planSpecial(bot, now) {
  const r = bot._medicResult;
  if (!r?.targetId || !(r.urgency > 0)) return bot._planIdle();
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.Special && cur.length && cur.targetId === r.targetId
      && !bot._healPlanDone(cur, now)) {
    bot.weaponIndex = cur.weaponIndex;
    return cur;
  }
  bot.weaponIndex = r.weaponIndex;
  const plan = [
    { type: PLAN_ACTION.SoldierPose, pose: 'stand' },
    { type: PLAN_ACTION.InfantryMoveToObject, targetId: r.targetId, arrive: r.arrive },
    { type: PLAN_ACTION.MouseTurretAimAt, targetId: r.targetId, afterMove: true },
    { type: PLAN_ACTION.TriggerContinously, targetId: r.targetId, tolerance: MEDIC.lookTolerance,
      afterMove: true, timeout: Infinity, shots: 0, heal: true, startedAt: now },
  ];
  plan.targetId = r.targetId;
  plan.weaponIndex = r.weaponIndex;
  plan.arrive = r.arrive;
  plan.startedAt = now;
  return plan;
}

/** The heal plan's end: the friend gone, healed, out of reach, or the pack dry. */
export function healPlanDone(bot, plan, now) {
  const world = bot.world;
  const p = world?.players?.get(plan.targetId);
  const armor = world?.armorOf?.(plan.targetId);
  if (!p || !armor || armor.destroyed) return true;
  if (armor.hitPoints / armor.maxHitPoints >= MEDIC.healthBelow) return true;
  const pos = playerPosition(p);
  if (!pos) return true;
  const d = Math.hypot(pos[0] - bot.position[0], pos[2] - bot.position[2]);
  if (d > plan.arrive + 2.0) return true;             // walked out of reach: re-plan
  const w = bot.weapons[plan.weaponIndex];
  if (w && w.ammo === 0) return true;
  return false;
}

// -----------------------------------------------------------------------
// Plan interpreter (§4.2)
// -----------------------------------------------------------------------

/**
 * `EntryTriggerContinously::execute` 0x08625ff0 for the beach leg's
 * `BAPATriggerContinously(1, BAPConTrue, BAPConFalse, BAPConFalse)`
 * (`BBPGotoWaypointBoat::createPlan` 0x085b8c50): while its start condition
 * (+0x18, true) holds and its end (+0x20, false) does not, it writes 1.0
 * (`0x3f800000`) into channel 1, `PIPitch`, every tick. The Daihatsu's
 * `DaihatsuLanding1/2` and the LCVP's `Lcvp_Ramp` bundles are bound to it.
 */
export const RAMP_INPUT = 1.0;

/**
 * The channels a plan holds that the bot's input word does not carry
 * (bot-aim.js `writeInput` writes the move, the look and the triggers): the
 * ramp's `PIPitch` on a ship, into the word the world consumes this tick
 * (`world-vehicle-tick.js`: a ship reads `c_PIPitch`; `pad` writes it raw,
 * as the engine's channel is, past the page's stick spring).
 */
export function writeHeldChannels(bot) {
  const pitch = bot._heldPitch ?? 0;
  if (!pitch || bot.vehicle?.kind !== 'ship') return;
  const entry = bot.world?.players?.get?.(bot.playerId)?.pending;
  if (!entry?.input) return;
  entry.input = { ...entry.input, pitch, pad: true };
}

/**
 * The boat's helm toward a point, one tick: `BoatControl::towardsDirection`
 * 0x0860df70 -- `actionStatusDecision` on the water map, then
 * `speedControl` 0x0860cf40 (bot-vehicle-air.js `boatControl`) -- as
 * `EntryBoatMoveTo::execute` 0x08613d60 runs it for every boat move. bot.js
 * `_steerToward` sends a driven ship here; bot-route.js `steerToward` keeps
 * the land hulls and the soldier.
 *
 * Two engine facts the helm needs from the bot:
 *  * The throttle channel persists. `BotMain::updatePlayerAction` 0x08526430
 *    clears only channels 8, 23, 24 and 28 of the bot's `PlayerInput` before
 *    handing it on, so `speedControl`'s turn reads last tick's throttle
 *    (`param_7[3]`, the channel it writes): full ahead or astern is kept at
 *    or under 3 m/s, which is how a boat turns in place, backing and filling
 *    between +-3 m/s with the rudder flipping with the motion. The viewer
 *    rebuilds the bot's word every tick; `bot._heldThrottle` (bot.js, the
 *    throttle written last tick) stands for the channel.
 *  * `EntryBoatMoveTo` enables the hull's AI physics when it is off
 *    (`hasPhysicsEnabled` at 0x08613e78, `enablePhysics` at 0x08614023): the craft's
 *    `isTouchingLand` is its terrain contact from then on (bot-units.js
 *    `touchingLand`), until a driver's bail disables it again.
 */
export function steerBoat(bot, x, z, speed = 1) {
  const dx = x - bot.position[0];
  const dz = z - bot.position[2];
  if (dx * dx + dz * dz < 1e-8) { bot.moveForward = 0; return; }
  const m = bot.vehicle;
  if (m.drive) m.drive.aiPhysics = true;
  const st = m.drive?.state;
  const nav = bot._nav();
  const w = st?.angularVelocity;
  const r = boatControl({
    forward: bot._vehicleForward(), velocity: st ? [st.velocity.x, st.velocity.z] : [0, 0],
    toTarget: [dx, dz], radius: 0,
    maxSpeed: m.hullMaxSpeed || m.maxSpeed || null,
    prevSpeed: bot._boatPrevSpeed ?? 0,
    // A THREE yaw rate about +y turns the heading toward a negative angle.
    yawRate: w ? -w.y : 0,
    level: nav ? freeLevel(nav, bot.position[0], bot.position[2]) : Infinity,
    prevThrottle: bot._heldThrottle ?? 0,
    decision: nav ? hullDecision(bot, dx, dz, BOAT.baseLevel) : null,
  });
  bot._boatPrevSpeed = r.speed ?? 0;
  bot.moveForward = r.throttle * (speed > 0 ? 1 : 0);
  bot.moveStrafe = r.steer;
  bot._dbgSteerAngle = r.angle;
}

/** Run every action in the plan for this tick. */
export function runPlan(bot, dt, now) {
  let allComplete = true;
  let moved = false;
  bot._heldPitch = 0;
  for (const action of bot.currentPlan) {
    if (action.afterMove && bot.currentPlan.some(a => (a.type === PLAN_ACTION.InfantryMoveTo
          || a.type === PLAN_ACTION.InfantryMoveToObject) && !a.done)) {
      allComplete = false;
      continue;
    }
    const complete = bot._executeAction(action, dt, now);
    if (complete) action.done = true;
    if (!complete && !action.persistent) allComplete = false;
    if (action.type === PLAN_ACTION.InfantryMoveTo || action.type === PLAN_ACTION.InfantryMoveToObject
        || action.type === PLAN_ACTION.FireApproach) moved = true;
  }
  if (allComplete && !bot.currentPlan.some(a => a.persistent)) bot.currentPlan = [];
  if (!moved) bot._lastThrottle = 0;
}

export function executeAction(bot, action, dt, now) {
  switch (action.type) {
    case PLAN_ACTION.InfantryMoveTo:
    case PLAN_ACTION.MoveToMediumSoldier:
      return bot._execInfantryMoveTo(action, dt);
    case PLAN_ACTION.InfantryMoveToObject:
    case PLAN_ACTION.MoveToObjectMediumSoldier:
      return bot._execInfantryMoveToObject(action, dt);
    case PLAN_ACTION.InfantryMoveToDirection:
      return bot._execInfantryMoveToDirection(action, dt, now);
    case PLAN_ACTION.FireApproach:
      return execFireApproach(bot, action, dt);
    case PLAN_ACTION.BoatMoveToDirect:
      // The boat's own helm (`BoatControl::towardsDirection` with its box
      // state machine, as `_steerToward` runs it on a route leg) straight at
      // the point, with the move's own state; the while loop never
      // completes, so the plan ends only when the order does. In parallel,
      // `BAPATriggerContinously(PIPitch)`: the ramp held down.
      bot._asd = action._asd ?? (action._asd = { state: 0 });
      bot._steerToward(action.waypoint[0], action.waypoint[2], 1);
      bot._dbgSteer = [action.waypoint[0], action.waypoint[2]];
      if (action.ramp) bot._heldPitch = RAMP_INPUT;
      return false;
    case PLAN_ACTION.MouseTurretAimAt:
      return bot._execMouseTurretAimAt(action);
    case PLAN_ACTION.MouseTurretLookAt:
      return bot._execMouseTurretLookAt(action);
    case PLAN_ACTION.Trigger:
    case PLAN_ACTION.TriggerContinously:
      return bot._execTrigger(action, now);
    case PLAN_ACTION.InfantryResetControls:
      return bot._execInfantryResetControls();
    case PLAN_ACTION.EnterVehicle:
      return bot._execEnterVehicle(action);
    case PLAN_ACTION.ExitVehicle:
      return bot._execExitVehicle();
    case PLAN_ACTION.SwitchSeat:
      return bot._execSwitchSeat(action);
    case PLAN_ACTION.PlaneAttack:
      return bot._execPlaneAttack(action, now);
    case PLAN_ACTION.PlaneAvoid:
      return execPlaneAvoid(bot, action, now);
    case PLAN_ACTION.Sense:
      return bot._execSense(action);
    case PLAN_ACTION.SoldierPose:
      return bot._execSoldierPose(action);
    case PLAN_ACTION.InfoWrapper:
    default:
      return true;
  }
}

/** `InfanteryMoveToObject`: the target's live position is the goal. */
export function execInfantryMoveToObject(bot, action, dt) {
  const p = bot.world?.players?.get(action.targetId);
  const pos = playerPosition(p) ?? action.targetPos;
  if (!pos) return true;
  action.waypoint = [pos[0], pos[1], pos[2]];
  return bot._execInfantryMoveTo(action, dt);
}

/** `InfanteryMoveToDirection`: walk a direction for a while. */
export function execInfantryMoveToDirection(bot, action, dt, now) {
  if (now >= action.until) return true;
  const [dx, dz] = action.direction;
  bot._steerToward(bot.position[0] + dx * action.distance, bot.position[2] + dz * action.distance, 1);
  bot._lastThrottle = bot.moveForward;
  return false;
}

/** `MouseTurretAimAt` (`EntryMouseTurretAimAt`): aim at the target's live
 *  position, the engine's 4-count rate. A mounted gunner leads it and turns
 *  through the seat's ControlInfo (bot-aim.js `turretAimAt`). */
export function execMouseTurretAimAt(bot, action) {
  const p = action.targetId ? bot.world?.players?.get(action.targetId) : null;
  const pos = playerPosition(p) ?? action.targetPos;
  if (!pos) return true;
  if (bot.vehicle && bot.vehicle.kind !== 'air') {
    const tv = p?.vehicle?.state?.velocity ?? p?.soldier?.body?.body?.velocity;
    const vel = tv ? [tv.x ?? tv[0] ?? 0, tv.y ?? tv[1] ?? 0, tv.z ?? tv[2] ?? 0] : [0, 0, 0];
    const aim = turretAimAt(bot, [pos[0], pos[1] + 1.0, pos[2]], vel);
    if (aim) { aim.targetId = action.targetId ?? null; return true; }
  }
  const aim = faceTarget(bot._aimOrigin(), [pos[0], pos[1] + 1.0, pos[2]]);
  bot._aimLook(aim.yaw, aim.pitch, AIM_COUNTS_MAX);
  return true;
}

/** `MouseTurretLookAt` (`BAPALookInDir` / `LookAtObject`): a direction or a point. */
export function execMouseTurretLookAt(bot, action) {
  if (action.ahead && bot.firingTarget && bot.senses?.memory?.get(bot.firingTarget)?.seen) {
    // INVENTION (2026-09-24, features/bot-stalemates): a tank that holds a
    // firing target it sees keeps its gun on it while MoveTo drives, where
    // the engine's `BAPALookAhead` turns it down the hull. The urge curve
    // hands a firing tank to MoveTo for a tick every few seconds; the look
    // ahead swung the turret off by a few degrees each time, which a slow
    // turret (the M10's scale 1 count) never won back, and it never fired.
    execMouseTurretAimAt(bot, { targetId: bot.firingTarget, targetPos: bot.targetPosition });
    return true;
  }
  if (action.ahead) {
    const f = bot._unitForward3?.();
    if (f) bot._aimLook(Math.atan2(f[0], f[2]), Math.atan2(f[1], Math.hypot(f[0], f[2])), AIM_COUNTS_MAX);
    return true;
  }
  if (action.target) {
    const aim = faceTarget(bot._eye(), [action.target[0], action.target[1] + 1.0, action.target[2]]);
    bot._aimLook(aim.yaw, aim.pitch, AIM_COUNTS_MAX);
  } else if (action.dir) {
    const yaw = Math.atan2(action.dir[0], action.dir[2]);
    const pitch = Math.atan2(action.dir[1], Math.hypot(action.dir[0], action.dir[2]));
    bot._aimLook(yaw, pitch, AIM_COUNTS_MAX);
  } else if (action.yaw !== undefined) {
    bot._aimLook(action.yaw, action.pitch ?? null, AIM_COUNTS_MAX);
  }
  return true;
}

/**
 * `EntryTrigger` / `EntryTriggerContinously`: the trigger goes down while
 * the aim condition holds — the live facing within the plan's tolerance
 * of the target — and the page fires rounds at the weapon's rate. The
 * statement ends on the plan's end conditions (`_firePlanDone`).
 */
export function execTrigger(bot, action, now) {
  const p = action.targetId ? bot.world?.players?.get(action.targetId) : null;
  const pos = playerPosition(p) ?? action.targetPos;
  if (!pos) return true;
  // A mounted gunner's aim condition is `BAPCConPrecision` 0x0854b570: the
  // lead's miss at the impact time within the plan's precision (bot-aim.js).
  const aim = bot._turretAim;
  if (bot.vehicle && bot.vehicle.kind !== 'air' && aim && aim.targetId === (action.targetId ?? null)) {
    const shape = targetShape(p);
    const weapon = bot.weapons?.[bot.weaponIndex];
    const miss = turretMiss(bot, aim);
    action.precisionState ??= {};
    const holds = precisionHolds(miss, precisionFor(shape.extents, shape.air), !!weapon?.burst, action.precisionState);
    bot._turretMissDbg = miss;
    // A tank's plan (`createPlanInternal` 0x085a74e0, the tank branch from
    // 0x085a9b7b) wraps its fire plan in `If(Not(S), LookAtObject, fire plan)`
    // (`BAPFlowCIf` built at 0x085aa7d3..0x085aa832, the fire plan from
    // `createFirePlan` at 0x085aaae9): the aim and the trigger run only
    // while S holds (in range, a valid aim, the memory record of the target
    // not lost), and `createFirePlan` 0x085ac240 gives the trigger no line
    // test of its own, only `BAPCConPrecision` (0x085aca1c) and the
    // magazine. The line of fire is the sensing's (Brief R item 3, ledger
    // AI-125). Other mounted gunners keep the line test (INVENTION).
    const approach = bot.currentPlan?.find?.(a => a.type === PLAN_ACTION.FireApproach);
    if (approach) {
      if (holds && approach.holds) bot.isFiring = true;
      return false;
    }
    if (holds && bot._lineClear(bot._eye(), [pos[0], pos[1] + 1.0, pos[2]])) bot.isFiring = true;
    return false;
  }
  const s = bot.vehicle?.kind === 'air' ? bot._noseReference() : bot._aimReference();
  const want = faceTarget(bot._aimOrigin(), [pos[0], pos[1] + 1.0, pos[2]]);
  const dy = wrapAngle(want.yaw - (s?.yaw ?? bot.yaw));
  const dp = s && s.pitch === null ? 0 : want.pitch - (s?.pitch ?? bot.pitch);
  const tol = Math.max(action.tolerance ?? LOOK_TOLERANCE, LOOK_TOLERANCE);
  const aligned = Math.hypot(dy, dp) < tol;
  if (aligned && bot._lineClear(bot._eye(), [pos[0], pos[1] + 1.0, pos[2]])) {
    bot.isFiring = true;
  }
  return false;
}

/** `InfanteryResetControls`: clear every movement/aim input. */
export function execInfantryResetControls(bot) {
  bot.moveForward = 0;
  bot.moveStrafe = 0;
  bot.stanceInput = 'stand';
  bot.isFiring = false;
  bot.lookX = 0;
  bot.lookY = 0;
  bot.waypoint = null;
  bot.route = null;
  bot._lastThrottle = 0;
  return true;
}

/** `Sense` (`EntrySense`): complete when the look is within the deviation
 *  of the scout direction; `BAPICScout` marks the tick as scouting. */
export function execSense(bot, action) {
  bot._scoutRan = true;
  const dir = action.dir;
  if (!dir) return true;
  const fx = Math.sin(bot.yaw) * Math.cos(bot.pitch), fy = Math.sin(bot.pitch), fz = Math.cos(bot.yaw) * Math.cos(bot.pitch);
  const dot = fx * dir[0] + fy * dir[1] + fz * dir[2];
  if (dot >= Math.cos(action.deviation ?? SCOUT.senseDeviation)) {
    bot.scout.senseComplete();
    return true;
  }
  return false;
}

/** `SoldierPose`: a stance, or the TakeCover ladder (stand if the danger is
 *  in the line of fire, else crouch, else prone). */
export function execSoldierPose(bot, action) {
  if (bot.vehicle) return true;
  let pose = action.pose;
  if (pose === 'ladder') {
    const danger = action.danger;
    pose = 'prone';
    if (danger) {
      const to = [danger[0], danger[1] + 1.0, danger[2]];
      for (const [name, eye] of [['stand', 1.6], ['crouch', 1.1]]) {
        if (bot._lineClear([bot.position[0], bot.position[1] + eye, bot.position[2]], to)) { pose = name; break; }
      }
    }
  }
  if (pose === 'walk' || pose === 'stand' || pose === 'crouch' || pose === 'prone') bot.stanceInput = pose;
  action.persistent = true;
  return true;
}
