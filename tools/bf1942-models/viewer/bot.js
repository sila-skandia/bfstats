// A bot: an ordinary player whose `PlayerInput` the AI writes for it
// (`BotMain`, research README §1). Each tick it senses (bot-sense.js), runs
// the engine's decision loop over its behaviours, generates the winner's
// plan and executes it through the infantry instruction set, writing one
// named action word plus a mouse axis pair into `World.setInput`.
//
// Research: features/bf1942-ai-research-2026-09-21/README.md §1.2-1.3, §4
//           features/bf1942-ai-research-2026-09-21/bot-movement-and-pathfinding.md
//           features/bf1942-ai-research-2026-09-21/bot-behaviours.md (2026-09-23)
//
// The decision loop (`BotMain::decisionMaking` 0x08520620, read 2026-09-23):
//
//  * `currentMods[i] = moral[i] * personality[i] * basic[i]` (`calculateMods`
//    0x08525b80): `personality` is `StandardWeights` (`setStandardPersonality`
//    for both sides), `basic` `UnitWeights` (all 1), and the moral mode is
//    drawn once at construction and never updated in 1.61 (`moralUpdate` has
//    no caller), so `moral` is 1.
//  * With no plan, behaviour i is evaluated with `mod = currentMods[i]`; with
//    a plan, `mod = curve_active(t) * inhibitor_active[i] * currentMods[i]`,
//    where the curve is the ACTIVE behaviour's `UrgeCurve` over the seconds it
//    has been active (1 for every other behaviour) and the inhibitor is the
//    active behaviour's own modifier column (`AvoidInhibit` while Avoid is
//    active, `UnitWeights` otherwise). A behaviour whose `mod <= 0` is not
//    evaluated and keeps its old urgency.
//  * The winner is the strict maximum urgency. With a plan it is re-chosen
//    only when some behaviour's `urgency / activeUrgency` leaves 0.87 .. 1.15,
//    appears from zero, drops to zero, or reports a changed target
//    (`UrgencyMerger::hasChanged` 0x08534f30, `quotientChanged` 0x08583540);
//    `activeUrgency` is the snapshot taken at selection. The con's
//    `setPlannedDecisionMakingThreshold` values are stored and never read.
//  * The winner's plan is regenerated every tick; a plan that comes back as
//    the same object is kept, a different one resets all controls.
//  * `prio` only orders evaluation under CPU starvation; the parallel mask
//    has no consumer. Neither is modelled.
//
// INVENTION, labelled: `Change` (vehicles) and `Special` (medic) are not
// registered — the viewer's bots are on foot with no healing kit yet; the
// Avoid behaviour against moving bodies is the touching rule of a soldier's
// zero `avoidCollisionLookAhead`; a level with no strategic data sends a bot
// at the nearest enemy flag.

import { DeviationModel } from './deviation.js';
import { findLocalPath, findStrategicPath, traceClear, traceValidPoint, isWalkable, COARSE_CELL } from './nav-grid.js';
import { BotSenses, lineClear, playerPosition, SOLDIER_RADIUS } from './bot-sense.js';
import { scoreTargets, firingPose, firePlanFor, weaponAiOf, FIRE } from './bot-fire.js';
import { ScoutState, TakeCoverState, QUADRANTS, quadrantOf, SCOUT, TAKE_COVER } from './bot-behaviours.js';

/** The 55-channel PlayerInputMap indices, from the research document §1.2. */
export const PI = {
  Yaw: 0, Pitch: 1, Roll: 2, Throttle: 3,
  MouseLookX: 4, MouseLookY: 5,
  CameraX: 6, CameraY: 7,
  Fire: 8, Action: 9, Use: 10,
  MouseLook: 11, Walk: 12, Run: 13,
  MenuSelect1: 14, MenuSelect2: 15, MenuSelect3: 16,
  MenuSelect4: 17, MenuSelect5: 18, MenuSelect6: 19,
  MenuSelect7: 20, MenuSelect8: 21, MenuSelect9: 22,
  AltFire: 23, Reload: 24, Drop: 25,
  ToggleCameraMode: 26, ToggleCamera: 27,
  Lie: 28, Crouch: 29,
  CameraMode1: 30, CameraMode2: 31, CameraMode3: 32, CameraMode4: 33,
  Radio1: 34, Radio2: 35, Radio3: 36, Radio4: 37,
  Radio5: 38, Radio6: 39, Radio7: 40, Radio8: 41,
  ScreenShot: 42, ToolHint: 43,
  SayAll: 44, SayTeam: 45,
  NextItem: 46, PrevItem: 47,
  Communication: 48, ShowScoreBoard: 49,
  Map: 50, ZoomMap: 51,
  ShowMapVote: 52, VoteYes: 53, VoteNo: 54,
};

/** Bot name pools, from the research document §2.1. */
export const BOT_NAMES = {
  American: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor'],
  British: ['Arthur', 'Bernard', 'Charles', 'David', 'Edward', 'Frank', 'George', 'Henry', 'James', 'Kenneth'],
  German: ['Fritz', 'Hans', 'Karl', 'Otto', 'Werner', 'Dieter', 'Heinz', 'Klaus', 'Manfred', 'Wolfgang'],
  Japanese: ['Tanaka', 'Suzuki', 'Sato', 'Takahashi', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato'],
  Russian: ['Ivan', 'Boris', 'Dmitri', 'Nikolai', 'Sergei', 'Viktor', 'Alexei', 'Mikhail', 'Pavel', 'Yuri'],
};
const FALLBACK_NAMES = [
  'Bot_Alpha', 'Bot_Bravo', 'Bot_Charlie', 'Bot_Delta', 'Bot_Echo',
  'Bot_Foxtrot', 'Bot_Golf', 'Bot_Hotel', 'Bot_India', 'Bot_Juliet',
];

/** The engine's default botSkill (§6.1): 0.75. */
const DEFAULT_BOT_SKILL = 0.75;
/** Default view distance in metres (§6.1): 600.0; a level's `AI.con` sets its own. */
const DEFAULT_VIEW_DISTANCE = 600;

/**
 * Behaviour names matching AIbehaviours.con §4.1, in registration order.
 * `Change` and `Special` are not registered (header).
 */
export const BEHAVIOUR = {
  Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire',
  Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change', Special: 'Special',
};
const REGISTERED = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Scout', 'TakeCover'];

/** `StandardWeights`, the standard personality of both sides. */
export const STANDARD_WEIGHTS = {
  Avoid: 1.0, MoveTo: 1.5, Idle: 0.1, Fire: 7.5, Special: 1.0, Scout: 1.0, TakeCover: 2.0, Change: 1.9,
};
/** `UnitWeights`: every column 1. */
const UNIT_WEIGHTS = { Avoid: 1, MoveTo: 1, Idle: 1, Fire: 1, Special: 1, Scout: 1, TakeCover: 1, Change: 1 };
/** `AvoidInhibit`: the column applied while Avoid is the active behaviour. */
const AVOID_INHIBIT = { Avoid: 1.0, MoveTo: 0.3, Idle: 1.0, Fire: 1.0, Special: 0.5, Scout: 1.0, TakeCover: 1.0, Change: 1.0 };
/** Each infantry row's modifier set (`setVehicleBehaviour Infantery ...`). */
const INHIBITOR = { Avoid: AVOID_INHIBIT, MoveTo: UNIT_WEIGHTS, Idle: UNIT_WEIGHTS, Fire: UNIT_WEIGHTS, Scout: UNIT_WEIGHTS, TakeCover: UNIT_WEIGHTS };

/**
 * The engine's urge curves (assembly, `UCLinear::calculate` 0x085838f0 and
 * `UCXInverse::calculate` 0x08583a50): `x` is the seconds the behaviour has
 * been the active one. `UCFire linear -0.22 1.3` reaches 0 after 5.9 s, which
 * is what re-opens the contest for a bot that has been shooting a while;
 * `UCScout XInverse 2.5 0.9 1.0 0.5` is `2.5 / (x + 0.9) + 0.5`.
 */
export const URGENCY_CURVE = {
  union: () => 1.0,
  fire: t => Math.max(0, -0.22 * t + 1.3),
  scout: t => Math.max(0, 2.5 / (1.0 * t + 0.9) + 0.5),
};
const CURVE_OF = { Avoid: URGENCY_CURVE.union, MoveTo: URGENCY_CURVE.union, Idle: URGENCY_CURVE.union,
  Fire: URGENCY_CURVE.fire, Scout: URGENCY_CURVE.scout, TakeCover: URGENCY_CURVE.union };
/** `decisionMaking`'s hysteresis band on `urgency / activeUrgency`. */
const HYSTERESIS_LOW = 0.87;
const HYSTERESIS_HIGH = 1.15;
/** `BotBehaviour` ctor: the initial active urgency, non-zero so the ratio
 *  branch is taken. */
const ACTIVE_URGENCY_INIT = 1e-5;
/** The engine's own warning: never let Idle's urgency reach 0 — with every
 *  urgency at 0 the merger picks nothing and the server crashes. */
export const IDLE_FLOOR = 1e-3;

/**
 * Plan action types for infantry (§4.2), the interpreter entries the viewer
 * runs. `MouseTurretLookAt` and `Sense` carry a direction, the movers a
 * point or a target id.
 */
export const PLAN_ACTION = {
  InfantryMoveTo: 'InfanteryMoveTo',
  InfantryMoveToObject: 'InfanteryMoveToObject',
  InfantryMoveToDirection: 'InfanteryMoveToDirection',
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

/** How close to a plain waypoint before it counts as reached. */
const WAYPOINT_REACH_RADIUS = 3.0;
/** Mouse axis conversion (mouse-input.js `soldierLookDegrees`). */
const YAW_GAIN = 3.0;
const PITCH_GAIN = 1.0;
const AXIS_MAX = 16;
const RAD2DEG = 180 / Math.PI;
/** `mouseControlLookAtDirection` caps a tick's mouse counts at 4.0. */
const AIM_COUNTS_MAX = 4.0;
/** Head/eye offset above the feet, for LOS and fire origins (standing). */
const EYE_HEIGHT = 1.6;
const EYE_BY_STANCE = { stand: 1.6, walk: 1.6, crouch: 1.1, prone: 0.4 };
/** `BAPALookAtObject` in the fire plan: within 5 deg. */
const LOOK_TOLERANCE = 5 * Math.PI / 180;
/** A remembered target's plan gets `firingTargetTime` from `setFiringTarget`. */
/** The Avoid sidestep (INVENTION, header): a diagonal a second of travel long,
 *  ended after half a second. */
const AVOID_STEP = 5.0;
const AVOID_TIME = 0.5;
/** No strategic data: a bot walks to the nearest enemy flag with this
 *  waypoint radius (INVENTION). */
const FALLBACK_WAYPOINT_RADIUS = 5.0;
/** How long with no *net* progress toward the goal before the page redeploys
 *  the bot to another spawn point (s). The engine has no such thing; it is
 *  the viewer's safety net for a body wedged in geometry the map cannot see. */
const NO_PROGRESS_RESPAWN = 12.0;
/** A failed route is retried after this long, its local box wider by this
 *  much per failure (INVENTION: the engine's next search draws a fresh
 *  random radius on the next decision pass). */
const ROUTE_RETRY_AFTER = 1.5;
const ROUTE_RETRY_WIDEN = 16;

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
const BOT_RADIUS = 1.0;
/** `infanteryControlTowardsDirection` 0x08627000: throttle only when the
 *  target direction is within this angle of the facing (0.5497787 rad,
 *  31.5 deg), else stop and turn; a target behind turns at the full rate. */
const STEER_CONE = 0.5497787;
/** `getNewIntermediatePathPos`: stalled-tick counts. Bit 1 (obstructed) at
 *  `> 0x96` ticks, the path fails (state 3) at `>= 0x191`. A tick counts when
 *  no path point traces clear from the bot, or (`ObstructionDetection::update`
 *  0x08532b00) the bot is inside its removal distance of the goal and is
 *  neither moving at 1.0 m/s nor turning at 0.1 rad/s. The viewer runs the AI
 *  every 30 Hz world tick, so these are 5 s and 13.4 s. */
const OBSTRUCTED_TICKS = 150;
const PATH_FAIL_TICKS = 401;
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

/** Wrap an angle to [-π, π]. */
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Yaw and pitch to face `to` from `from`, radians. */
function faceTarget(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * One bot's controller. Owns a PlayerInput and writes it once per tick.
 */
export class BotController {
  constructor({
    playerId,
    world,
    botSkill = DEFAULT_BOT_SKILL,
    name = null,
    spawnPos = null,
    controlInfo = null,
    weaponAi = null,
    weapons = null,
    viewDistance = null,
    random = Math.random,
  } = {}) {
    this.playerId = playerId;
    this.world = world;
    this.botSkill = Math.max(0.25, Math.min(1.0, botSkill));
    this.name = name || 'Bot';
    this.position = spawnPos ? [...spawnPos] : [0, 0, 0];
    this.controlInfo = controlInfo;
    this.random = random;

    /** The AI weapon templates the bot carries (`weaponAiOf` entries); the
     *  first is the primary. `weaponAi` alone is the old single-weapon form. */
    this.weapons = (weapons && weapons.length ? weapons : [weaponAi ?? {}]).map(weaponAiOf);
    this.weaponIndex = 0;
    /** The chosen weapon's AI entry, for the page's deviation and sound. */
    this.weaponAi = this.weapons[0];

    /** The 55-channel PlayerInput, kept for compatibility with callers. */
    this.input = new Float32Array(55);

    /** Deviation model for this bot's weapon. */
    this.deviation = new DeviationModel({ deviation: this._buildDeviationData() });
    /** Per weapon template, its `fireArms` data (deviation channels, rate,
     *  magazine), handed in by the page (`setWeaponData`). */
    this.weaponData = {};
    this._deviationWeapon = null;
    /** Set by the page's magazine bookkeeping: the held weapon is dry. */
    this.magazineEmpty = false;

    /** Whether the bot is currently firing (the trigger channel is down). */
    this.isFiring = false;
    /** `firingTargetTime`: when the current firing target was set. */
    this.firingTargetTime = -Infinity;
    /** Seconds since the bot last acquired a target (deviation correction). */
    this.timeSinceTargetAcquired = 0;

    /** View distance in metres (`aiSettings.setViewDistance`). */
    this.viewDistance = viewDistance ?? world?.extras?.ai?.settings?.viewDistance ?? DEFAULT_VIEW_DISTANCE;

    /** The bot's live pose, synced from the world's soldier each tick. */
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';

    // --- Input fields written by the plan and flushed by `_writeInput` ---
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.stanceInput = 'stand';
    this.jumpRequest = false;
    this.lookX = 0;
    this.lookY = 0;

    // --- Senses (bot-sense.js) ---
    this.senses = new BotSenses({ viewDistance: this.viewDistance, random });
    /** `BotMain+0x1f0`: seconds since each sensing quadrant was last covered. */
    this.quadInertia = new Float32Array(QUADRANTS);
    /** The current firing target's playerId and position, or null. */
    this.firingTarget = null;
    this.targetPosition = null;
    this.targetVisible = false;
    this.targetScore = 0;
    /** `BBPFeedback`: targets a fire plan gave up on, id -> time. */
    this.vetoedTargets = new Map();
    /** Kept for the page: the last heard shot's position and age. */
    this.lastHeardPosition = null;
    this.timeSinceHeard = Infinity;
    /** Whether this bot is in a vehicle (wider sensing). */
    this.isMobile = false;
    /** Kept for the page's redeploy: unused by the AI itself. */
    this.memory = this.senses.memory;
    this.isUnderFire = false;
    this.timeSinceNearbyShot = Infinity;

    // --- The decision loop ---
    /** Per behaviour: the last urgency and the snapshot at selection. */
    this.urgency = {};
    this.activeUrgency = {};
    this.changedTarget = {};
    for (const b of REGISTERED) { this.urgency[b] = 0; this.activeUrgency[b] = ACTIVE_URGENCY_INIT; this.changedTarget[b] = false; }
    /** The active behaviour (null: no plan), and when it was chosen. */
    this.currentBehaviour = null;
    this.behaviourChosenAt = 0;
    /** The current plan and the behaviour it belongs to. */
    this.currentPlan = [];
    this.planBehaviour = null;
    this.planTargetId = null;
    this.hasChangedTarget = false;
    /** The behaviour generators' state. */
    this.scout = new ScoutState();
    this.cover = new TakeCoverState();
    this.avoidUntil = -Infinity;
    this.avoidDir = null;
    /** Cover candidates the page supplies (`{ id, pos, value, width, height, radius }`). */
    this.covers = null;

    // --- Orders and navigation ---
    /** The strategic AI's order (`WPMoveTo`), or null. */
    this.waypoints = null;
    /** The current move goal `[x, y, z]` from the active plan. */
    this.waypoint = null;
    /** The bot's own team, cached for filters. */
    this.team = this._player()?.team ?? null;
    /** Navigation map (nav-grid.js), set by the page. */
    this.navGrid = null;
    /** For the page: the point the bot is walking to and whether it is there. */
    this.objective = null;
    this.objectiveGoal = null;
    this.goalReached = false;
    this.route = null;
    this.obstacles = [];
    this._stalledTicks = 0;
    this._noVisiblePoint = false;
    this._needsRespawn = false;
    this._pathFailures = 0;
    this._bestGoalDist = null;
    this._noProgress = 0;

    /** The current full deviation cone half-angle in degrees. */
    this.aimDeviation = 0;
    this._urgencies = this.urgency;
  }

  /**
   * The page hands over a weapon's `fireArms` block; the deviation model is
   * rebuilt from its channels the next tick the weapon is held.
   */
  setWeaponData(name, data) {
    this.weaponData[name] = data;
    if (this._deviationWeapon === name) this._deviationWeapon = null;
  }

  /** Deviation data for the held weapon: its channels, else no floor. */
  _buildDeviationData(name = null) {
    return this.weaponData?.[name]?.deviation ?? { min: 0 };
  }

  /** The player record for this bot, or null. */
  _player() {
    return this.world?.player?.(this.playerId) ?? this.world?.players?.get(this.playerId) ?? null;
  }

  /** The bot's eye, by stance. */
  _eye() {
    return [this.position[0], this.position[1] + (EYE_BY_STANCE[this.stance] ?? EYE_HEIGHT), this.position[2]];
  }

  /** The world's line-of-sight test between two points. */
  _lineClear(from, to) {
    return lineClear(this.world?.collider, from, to);
  }

  // -----------------------------------------------------------------------
  // Sensing hooks the page calls
  // -----------------------------------------------------------------------

  /**
   * A shot was fired somewhere (the page calls this for the human and for
   * every bot). Hearing per `soundPerceptionCalculation`: enemy shots inside
   * the weapon's sound radius within 3 s of firing, else the 15 m sphere.
   */
  onShotFired(shooterId, shooterTeam, pos, now, weaponRadius = null) {
    if (shooterId === this.playerId) { this.senses.onOwnFire(now); return; }
    const heard = this.senses.hear(now, shooterId, shooterTeam, pos, this.position, this.team,
                                   { weaponRadius, firedAt: now });
    if (heard) {
      this.lastHeardPosition = [...pos];
      this.timeSinceHeard = 0;
    }
  }

  /** A round from `attackerId` at `pos` landed on (or near) this bot. */
  onIncomingFire(attackerId, pos, now, hit = false, strength = 1) {
    this.senses.onIncomingFire(now, attackerId, strength, hit, pos);
    this.isUnderFire = true;
    this.timeSinceNearbyShot = 0;
  }

  /** The page's older hook: the human fired near this bot. Counts as a heard
   *  shot and as incoming fire. */
  recordNearbyShot(shotPos, now, shooterId = 'local', shooterTeam = null) {
    this.onShotFired(shooterId, shooterTeam, shotPos, now ?? 0);
    const d = Math.hypot(shotPos[0] - this.position[0], shotPos[2] - this.position[2]);
    if (d <= 20) this.onIncomingFire(shooterId, shotPos, now ?? 0, false, 1);
  }

  /** Older alias. */
  hearSound(soundPos, now, sourceTeam = null) {
    this.onShotFired('sound', sourceTeam, soundPos, now);
  }

  /** The page reports a round this bot fired (for the fire plan's counter). */
  onShot(now) {
    this.senses.onOwnFire(now);
    this._shotsThisPlan = (this._shotsThisPlan ?? 0) + 1;
    this._tally('shots', this.firingTarget);
  }

  /** The page: one of this bot's rounds landed on `targetId`. */
  recordHit(targetId) {
    this._tally('hits', targetId);
  }

  /** The memory record's per-weapon-slot tally for a target (+0x34 / +0x54). */
  _tally(kind, targetId) {
    const m = targetId ? this.senses.memory.get(targetId) : null;
    if (!m) return;
    const list = m[kind] ?? (m[kind] = []);
    const i = this.weaponIndex ?? 0;
    list[i] = (list[i] ?? 0) + 1;
  }

  /** Compatibility: the current firing target as the old `sense()` gave it. */
  sense(now) {
    this._sensePass(now ?? 0, 0);
    const t = this._chooseFiringTarget(now ?? 0);
    return { targetId: t.targetId, targetPos: t.targetPos };
  }

  /** One sensing pass plus the memory update. */
  _sensePass(now, dt) {
    const me = this._player();
    if (!me || !this.world?.players) return;
    const eye = this._eye();
    this.senses.sense(now, this.world, me, eye, this.yaw);
    this.senses.updateMemory(now, this.world, me, eye, this.yaw);
    // `updateSensingQuads`: every quadrant ages; the one the camera looks
    // into is fresh.
    for (let q = 0; q < QUADRANTS; q++) this.quadInertia[q] += dt;
    const fq = quadrantOf(Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.yaw));
    this.quadInertia[fq] = 0;
  }

  /** `BBFire::calculateUrgency`'s target scoring, shared by Fire and `sense()`. */
  _chooseFiringTarget(now) {
    const collider = this.world?.collider;
    const water = collider?.waterLevel;
    const waterDepth = Number.isFinite(water) ? Math.max(0, water - this.position[1]) : 0;
    const me = this._player();
    const mySpeed = me?.soldier?.speed ?? 0;
    return scoreTargets({
      spotted: this.senses.spottedEnemies(),
      position: this.position,
      weapons: this.weapons,
      now,
      attackedBy: id => this.senses.attackedBy(id),
      velocityOf: id => {
        const p = this.world.players.get(id);
        const s = p?.soldier;
        if (!s) return null;
        const v = s.body?.body?.velocity;
        return v ? [v.x, v.y, v.z] : [Math.sin(s.yaw) * (s.speed ?? 0), 0, Math.cos(s.yaw) * (s.speed ?? 0)];
      },
      typeOf: () => 'Infantry',
      currentTarget: this.firingTarget,
      currentScore: this.targetScore,
      insideOrderedArea: this._insideOrderedArea(),
      vetoed: this.vetoedTargets,
      waterDepth,
      mySpeed,
    });
  }

  _insideOrderedArea() {
    const wp = this.waypoints;
    if (!wp?.inside) return true;
    return wp.inside(this.position[0], this.position[2]);
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /**
   * Once per tick: sync from the world's soldier, sense, run the decision
   * loop, execute the plan, flush one PlayerInput.
   */
  tick(dt, now) {
    this._now = now;
    const player = this._player();
    if (player?.soldier) {
      this.position[0] = player.soldier.x;
      this.position[1] = player.soldier.y;
      this.position[2] = player.soldier.z;
      this.yaw = player.soldier.yaw;
      this.pitch = player.soldier.pitch ?? 0;
      this.stance = player.soldier.stance ?? 'stand';
    }
    this.team = player?.team ?? this.team;

    this._ageObstacles(dt);
    this._resetInput();

    // --- Sensing ---
    this._sensePass(now, dt);
    this.timeSinceHeard += dt;
    this.timeSinceNearbyShot += dt;
    this.isUnderFire = this.timeSinceNearbyShot < 1.5;
    for (const [id, t] of this.vetoedTargets) if (now - t > FIRE.feedbackVeto) this.vetoedTargets.delete(id);

    // --- The page's goal readout and the no-progress safety net ---
    this._updateObjectiveReadout(dt);

    // --- Decision making ---
    this._decisionMaking(now, dt);

    // --- Plan execution ---
    this._runPlan(dt, now);

    // --- Deviation: dynamic channels + the AI term (`setBotSkill`) ---
    this.deviation.update(dt, {
      stance: this.stance,
      throttle: this.moveForward,
      strafe: this.moveStrafe,
      lookX: this.lookX,
      lookY: this.lookY,
      jumping: false,
    });
    const w = this.weapons[this.weaponIndex] ?? this.weapons[0];
    this.weaponAi = w;
    if (w && w.name !== this._deviationWeapon) {
      // A weapon change: the new weapon's own channels (`HandFireArms::
      // updateDeviation` runs per weapon), the AI term re-applied below.
      this._deviationWeapon = w.name;
      this.deviation = new DeviationModel({ deviation: this._buildDeviationData(w.name) });
    }
    this.deviation.setAIDeviation({
      botSkill: this.botSkill,
      timeSinceTarget: this.firingTarget ? Math.max(0, now - this.firingTargetTime) : 0,
      deviation: w?.deviation ?? 5.0,
      correctionTime: w?.deviationCorrectionTime ?? 10.0,
    });
    this.aimDeviation = this.deviation.current();

    this._writeInput();
    this.timeSinceTargetAcquired = this.firingTarget ? this.timeSinceTargetAcquired + dt : 0;
  }

  /** The page reads `objective`, `objectiveGoal`, `goalReached`. */
  _updateObjectiveReadout(dt) {
    const wp = this.waypoints;
    if (wp) {
      this.objective = { name: wp.area?.name ?? 'order' };
      this.objectiveGoal = [wp.point[0], this.position[1], wp.point[1]];
      const d = Math.hypot(wp.point[0] - this.position[0], wp.point[1] - this.position[2]);
      this.goalReached = d < wp.radius;
    } else {
      const flag = this._nearestEnemyFlag();
      this.objective = flag;
      this.objectiveGoal = flag ? [flag.position[0], flag.position[1], flag.position[2]] : null;
      this.goalReached = !!this.objectiveGoal && this._distTo(this.objectiveGoal) < FALLBACK_WAYPOINT_RADIUS;
    }
    if (this.objectiveGoal && !this.goalReached && this.currentBehaviour === BEHAVIOUR.MoveTo) {
      const d = this._distTo(this.objectiveGoal);
      if (this._bestGoalDist === null || d < this._bestGoalDist - 0.5) {
        this._bestGoalDist = d;
        this._noProgress = 0;
      } else {
        this._noProgress += dt;
        if (this._noProgress > NO_PROGRESS_RESPAWN) {
          this._noProgress = 0;
          this._bestGoalDist = null;
          this._needsRespawn = true;
        }
      }
    } else {
      this._bestGoalDist = this.objectiveGoal ? this._distTo(this.objectiveGoal) : null;
      this._noProgress = 0;
    }
  }

  _resetInput() {
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.stanceInput = 'stand';
    this.jumpRequest = false;
    this.lookX = 0;
    this.lookY = 0;
    this.isFiring = false;
  }

  /** The single input writer: the named action word plus the mouse pair. */
  _writeInput() {
    const input = {
      forward: clamp(this.moveForward, -1, 1),
      strafe: clamp(this.moveStrafe, -1, 1),
      walk: this.stanceInput === 'walk',
      crouch: this.stanceInput === 'crouch',
      prone: this.stanceInput === 'prone',
      jump: this.jumpRequest === true,
      fire: this.isFiring,
      altFire: false,
    };
    this.input[PI.Throttle] = input.forward;
    this.input[PI.Yaw] = input.strafe;
    this.input[PI.Walk] = input.walk ? 1 : 0;
    this.input[PI.Crouch] = input.crouch ? 1 : 0;
    this.input[PI.Lie] = input.prone ? 1 : 0;
    this.input[PI.Fire] = input.fire ? 1 : 0;
    this.input[PI.MouseLookX] = this.lookX;
    this.input[PI.MouseLookY] = this.lookY;
    this.world.setInput(this.playerId, input, { x: this.lookX, y: this.lookY });
    this.jumpRequest = false;
  }

  /**
   * Aim at an absolute yaw/pitch by writing the mouse axis pair. `lookX/Y`
   * are mouse counts (`soldierLookDegrees`: 3 deg and 1 deg a count), the
   * world applies them negated, and the axis saturates at 16. A rate cap
   * (`AIM_COUNTS_MAX`, `mouseControlLookAtDirection`'s 4.0) keeps a bot's
   * turn to 12 deg a tick, the engine's own pace.
   */
  _aimLook(desiredYaw, desiredPitch = null, maxCounts = AXIS_MAX) {
    const s = this._player()?.soldier;
    if (!s) return;
    const dYaw = wrapAngle(desiredYaw - s.yaw);
    const livePitch = s.pitch ?? 0;
    const targetPitch = desiredPitch === null ? livePitch : desiredPitch;
    const dPitch = targetPitch - livePitch;
    this.lookX = clamp(-(dYaw * RAD2DEG) / YAW_GAIN, -maxCounts, maxCounts);
    this.lookY = clamp(-(dPitch * RAD2DEG) / PITCH_GAIN, -maxCounts, maxCounts);
  }

  // -----------------------------------------------------------------------
  // Navigation: the engine's path follower
  // -----------------------------------------------------------------------
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

  /** `updatePotentialObstacles`: an obstacle is dropped once the bot is
   *  well away from it (max age 0 in every shipped level). */
  _ageObstacles(dt) {
    if (!this.obstacles.length) return;
    for (const ob of this.obstacles) ob.age += dt;
    this.obstacles = this.obstacles.filter(ob =>
      Math.hypot(ob.x - this.position[0], ob.z - this.position[2]) <= OBSTACLE_DROP_DISTANCE);
  }

  /**
   * The touched-object rule: the body's hull is in contact with something
   * the route did not expect (the map says the next metre is free), so the
   * thing is an obstacle the map cannot see — a parked prop, a moved vehicle.
   * After `CONTACT_TICKS` of that, plant a circle on the contact side and
   * re-plan. Returns true when a circle was planted this tick.
   */
  _trackContact(soldier) {
    const blocked = !!soldier?.blocked && this.moveForward > 0.1;
    const n = soldier?.body?.contactNormal;
    const wall = blocked && n && Math.abs(n.y) < 0.6;
    if (!wall) { this._contactTicks = 0; return false; }
    this._contactTicks = (this._contactTicks ?? 0) + 1;
    if (this._contactTicks < CONTACT_TICKS) return false;
    this._contactTicks = 0;
    // The contact normal points out of the object toward the body: the
    // object is behind the normal.
    const h = Math.hypot(n.x, n.z) || 1;
    const x = this.position[0] - (n.x / h) * OBSTACLE_AHEAD;
    const z = this.position[2] - (n.z / h) * OBSTACLE_AHEAD;
    const near = this.obstacles.some(ob => Math.hypot(ob.x - x, ob.z - z) < 0.5);
    if (!near) this.obstacles.push({ x, z, r: OBSTACLE_RADIUS, age: 0 });
    if (this.route) this.route.failed = true;
    return true;
  }

  /**
   * The route for `goal` (`[x, y, z]`), built when there is none, when the
   * goal moved more than `REPLAN_GOAL_MOVE`, or after a failure. Returns the
   * route or null when the map has no answer.
   */
  _ensureRoute(goal) {
    const nav = this.navGrid;
    const r = this.route;
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
      const now = this._now ?? 0;
      if (now < (this._routeRetryAt ?? -Infinity)) return null;
      this._routeRetryAt = now + ROUTE_RETRY_AFTER;
    }
    const [bx, bz] = [this.position[0], this.position[2]];
    let coarse = null;
    if (Math.hypot(goal[0] - bx, goal[2] - bz) > COARSE_CELL * 2) {
      coarse = findStrategicPath(nav, bx, bz, goal[0], goal[2]);
      if (!coarse) {
        this._pathFailures++;
        return null;
      }
      coarse.shift();                 // the first entry is the bot itself
    }
    this.route = {
      goal: [goal[0], goal[2]],
      coarse: coarse ?? [[goal[0], goal[2]]],
      points: [],
      index: 0,
      lastPassed: [bx, bz],
      failed: false,
      searches: 0,
    };
    this._stalledTicks = 0;
    this._extendRoute();
    return this.route;
  }

  /**
   * `updateLocalPath`: while fewer than `SMOOTHING` followed points remain
   * and coarse legs are left, refine the next leg from the last followed
   * point. A leg the local search cannot answer is skipped (the engine sets
   * state 3 and re-plans; here the next leg is tried first).
   */
  _extendRoute() {
    const r = this.route;
    const nav = this.navGrid;
    if (!r || !nav) return;
    let guard = 4;
    while (r.points.length - r.index < SMOOTHING && r.coarse.length && guard-- > 0) {
      const from = r.points.length ? r.points[r.points.length - 1]
        : [this.position[0], this.position[2]];
      const [tx, tz] = r.coarse[0];
      let radius = LOCAL_SEARCH_RADIUS_MIN + Math.random() * LOCAL_SEARCH_RADIUS_RAND;
      for (const ob of this.obstacles) radius = Math.max(radius, ob.r);
      radius += 1 + ROUTE_RETRY_WIDEN * Math.min(3, this._pathFailures);
      const leg = findLocalPath(nav, from[0], from[1], tx, tz,
                                { radius, obstacles: this.obstacles });
      r.searches++;
      r.coarse.shift();
        if (!leg) {
        if (!r.coarse.length) { r.failed = true; this._pathFailures++; }
        continue;
      }
      this._pathFailures = 0;
      for (let i = r.points.length ? 1 : 0; i < leg.length; i++) r.points.push(leg[i]);
    }
  }

  /**
   * `getNewIntermediatePathPos`: the farthest of the next `SMOOTHING` points
   * the trace can reach from the bot, farthest first. Sets `route.index` and
   * returns the point, or null when the route is empty.
   */
  _lookAhead() {
    const r = this.route;
    if (!r || !r.points.length) return null;
    const nav = this.navGrid;
    const [bx, bz] = [this.position[0], this.position[2]];
    const last = Math.min(r.points.length - 1, SMOOTHING - 1);
    let pick = -1;
    if (nav) {
      for (let i = last; i >= 0; i--) {
        const p = r.points[i];
        if (traceClear(nav, bx, bz, p[0], p[1], this.obstacles)) { pick = i; break; }
      }
    } else {
      pick = 0;
    }
    // No point traces clear: the engine counts the tick as obstructed and
    // steers at the front point regardless.
    this._noVisiblePoint = pick < 0;
    if (pick < 0) pick = 0;
    r.index = pick;
    return r.points[pick];
  }

  /**
   * `checkAgainstPath` + `stepInPath`: drop the front point once the body is
   * inside `BOT_RADIUS` of it, or has crossed the plane through it that faces
   * the look-ahead point. The last point stays.
   */
  _popPassed() {
    const r = this.route;
    if (!r) return;
    let guard = SMOOTHING;
    while (r.points.length > 1 && guard-- > 0) {
      const front = r.points[0];
      const dx = this.position[0] - front[0];
      const dz = this.position[2] - front[1];
      let pop = dx * dx + dz * dz < BOT_RADIUS * BOT_RADIUS;
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
  _trackObstruction(speed) {
    const stalled = this._noVisiblePoint
      || (this.moveForward > 0.1 && speed < MOVING_SPEED);
    if (!stalled) {
      this._stalledTicks = 0;
      return false;
    }
    this._stalledTicks++;
    if (this._stalledTicks === OBSTRUCTED_TICKS + 1) this._onObstructed();
    if (this._stalledTicks >= PATH_FAIL_TICKS) {
      this._stalledTicks = 0;
      if (this.route) this.route.failed = true;
      this._pathFailures++;
      return true;
    }
    return false;
  }

  /** Plant a potential obstacle where the body is stuck and re-plan. */
  _onObstructed() {
    const x = this.position[0] + Math.sin(this.yaw) * OBSTACLE_AHEAD;
    const z = this.position[2] + Math.cos(this.yaw) * OBSTACLE_AHEAD;
    this.obstacles.push({ x, z, r: OBSTACLE_RADIUS, age: 0 });
    if (this.route) this.route.failed = true;
  }

  /**
   * `infanteryControlTowardsDirection`: look toward `[x, z]`; throttle
   * `speed` inside the cone, else hold and turn. A target behind turns at
   * the full rate (the engine writes the angle as +-pi/2).
   */
  _steerToward(x, z, speed = 1) {
    const dx = x - this.position[0];
    const dz = z - this.position[2];
    if (dx * dx + dz * dz < 1e-8) { this.moveForward = 0; return; }
    const want = Math.atan2(dx, dz);
    const rel = wrapAngle(want - this.yaw);
    this._aimLook(want, 0);
    this.moveStrafe = 0;
    this.moveForward = Math.abs(rel) <= STEER_CONE ? speed : 0;
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
  _execInfantryMoveTo(action, dt) {
    const target = action.waypoint || this.waypoint;
    if (!target) return true;
    const speed = action.crouch ? 0.5 : 1;
    if (action.crouch) this.stanceInput = 'crouch';
    else if (action.stance) this.stanceInput = action.stance;

    const arrived = Math.hypot(this.position[0] - target[0], this.position[2] - target[2])
      < (action.arrive ?? WAYPOINT_REACH_RADIUS);
    if (arrived) { this.moveForward = 0; this._lastThrottle = 0; return true; }

    // `_resetInput` has zeroed this tick's word; the stall test wants the
    // throttle the body was given last tick.
    const soldier = this._player()?.soldier;
    const bodySpeed = soldier?.speed ?? 0;
    this.moveForward = this._lastThrottle ?? 0;
    this._trackContact(soldier);
    if (this._trackObstruction(bodySpeed)) {
      // The path failed (`+0xc = 3`): next tick rebuilds it around the
      // obstacles, or walks straight at the goal after repeated failures.
      this.route = null;
    }

    let route = this._ensureRoute(target);
    if (route) {
      this._extendRoute();
      this._popPassed();
      const point = this._lookAhead();
      if (point) {
        this._steerToward(point[0], point[1], speed);
        this._dbgSteer = point;
        this._lastThrottle = this.moveForward;
        return false;
      }
      route.failed = true;
    }
    // No route: the map cannot see a way, or the level has no map. The
    // engine's bot stands still on state 3 until a re-plan; here it walks
    // straight at the goal so a squad without a map still moves.
    this._steerToward(target[0], target[2], speed);
    this._dbgSteer = [target[0], target[2]];
    this._lastThrottle = this.moveForward;
    return false;
  }

  // -----------------------------------------------------------------------
  // The decision loop (`BotMain::decisionMaking`)
  // -----------------------------------------------------------------------

  /** `currentMods[i]`: moral x personality x basic (header). */
  _currentMod(name) {
    return 1.0 * (STANDARD_WEIGHTS[name] ?? 1.0) * (UNIT_WEIGHTS[name] ?? 1.0);
  }

  _hasPlan() {
    return this.currentBehaviour !== null && this.currentPlan.length > 0;
  }

  _decisionMaking(now, dt) {
    const hasPlan = this._hasPlan();
    const active = hasPlan ? this.currentBehaviour : null;
    const activeFor = active ? now - this.behaviourChosenAt : 0;
    // Phase 1: every registered behaviour, with its modifier.
    for (const name of REGISTERED) {
      let mod = this._currentMod(name);
      if (active) {
        const curve = name === active ? (CURVE_OF[active] ?? URGENCY_CURVE.union)(activeFor) : 1.0;
        mod *= curve * ((INHIBITOR[active] ?? UNIT_WEIGHTS)[name] ?? 1.0);
      }
      if (mod > 0) this.urgency[name] = this._generate(name, mod, now, dt, true);
      // else: not evaluated, the old urgency stands.
    }
    // The winner.
    let reselect = !hasPlan;
    if (hasPlan) {
      for (const name of REGISTERED) {
        if (this._quotientChanged(name) || this.changedTarget[name]) { reselect = true; break; }
      }
    }
    let winner = this.currentBehaviour;
    if (reselect) {
      let best = 0;
      winner = null;
      for (const name of REGISTERED) {
        const u = this.urgency[name];
        this.activeUrgency[name] = u;
        if (u > best) { best = u; winner = name; }
      }
      // The engine's crash guard, made safe: nothing wins -> Idle.
      if (!winner) { winner = BEHAVIOUR.Idle; this.urgency.Idle = IDLE_FLOOR; }
      if (winner !== this.currentBehaviour) {
        this.currentBehaviour = winner;
        this.behaviourChosenAt = now;
      }
    }
    // The winner's plan is regenerated every tick; the same plan is kept.
    const plan = this._generatePlan(winner, now);
    if (plan !== this.currentPlan) {
      if (plan.length) this._execInfantryResetControls();
      this.currentPlan = plan;
      this.planBehaviour = winner;
      this.planTargetId = this.firingTarget;
    }
    for (const name of REGISTERED) this.changedTarget[name] = false;
  }

  /** `BotBehaviour::quotientChanged(0.87, 1.15)`. */
  _quotientChanged(name) {
    const active = this.activeUrgency[name];
    const u = this.urgency[name];
    if (active === 0) return u > 0;
    if (u === 0) return true;
    const q = u / active;
    return !(HYSTERESIS_LOW <= q && q <= HYSTERESIS_HIGH);
  }

  // -----------------------------------------------------------------------
  // Urgency generators
  // -----------------------------------------------------------------------

  _generate(name, mod, now, dt, planned) {
    switch (name) {
      case BEHAVIOUR.Idle: return mod;
      case BEHAVIOUR.MoveTo: return this._urgencyMoveTo(mod);
      case BEHAVIOUR.Fire: return this._urgencyFire(mod, now);
      case BEHAVIOUR.Scout: return this._urgencyScout(mod, now, dt);
      case BEHAVIOUR.TakeCover: return this._urgencyTakeCover(mod, now);
      case BEHAVIOUR.Avoid: return this._urgencyAvoid(mod, now);
      default: return 0;
    }
  }

  /**
   * `BBMoveTo::calculateUrgency`: the waypoint list's urgency for the bot's
   * position (`WPMoveTo::getUrgency`), times the modifier. No order and no
   * strategic data: the nearest enemy flag stands in (INVENTION).
   */
  _urgencyMoveTo(mod) {
    const wp = this.waypoints ?? this._fallbackWaypoint();
    if (!wp) return 0;
    const u = wp.urgency(this.position[0], this.position[2], SOLDIER_RADIUS);
    this.changedTarget.MoveTo = wp !== this._lastWaypointObject;
    this._lastWaypointObject = wp;
    return u > 0 ? u * mod : 0;
  }

  _fallbackWaypoint() {
    if (this.world?.extras?.ai?.strategicAreas?.length) return null;
    const flag = this._nearestEnemyFlag();
    if (!flag) return null;
    if (this._fallback?.flag === flag) return this._fallback;
    const point = [flag.position[0], flag.position[2]];
    const R = FALLBACK_WAYPOINT_RADIUS;
    this._fallback = {
      kind: 'WPMoveTo', flag, area: null, point, radius: R, arrived: false,
      urgency(x, z, r = SOLDIER_RADIUS) {
        const Rr = R + r;
        const d2 = (x - point[0]) ** 2 + (z - point[1]) ** 2;
        this.arrived = d2 < 2 * Rr * Rr;
        return Math.min(1, Math.max(0.1, d2 / (4 * Rr * Rr))) * 2.0;
      },
    };
    return this._fallback;
  }

  /** The nearest flag this bot's team does not hold, or null. */
  _nearestEnemyFlag() {
    const flags = this.world?.flags;
    if (!flags?.length) return null;
    let best = null, bestDist = Infinity;
    for (const flag of flags) {
      if (!flag.position || flag.uncapturable || flag.team === this.team) continue;
      const d = Math.hypot(flag.position[0] - this.position[0], flag.position[2] - this.position[2]);
      if (d < bestDist) { bestDist = d; best = flag; }
    }
    return best;
  }

  /** Horizontal distance from the bot to a world point. */
  _distTo(point) {
    return Math.hypot(point[0] - this.position[0], point[2] - this.position[2]);
  }

  /** `BBFire::calculateUrgency`: the scored target, the chosen weapon. */
  _urgencyFire(mod, now) {
    const t = this._chooseFiringTarget(now);
    const changed = t.targetId !== this.firingTarget;
    if (t.targetId) {
      if (changed) this.firingTargetTime = now;
      this.firingTarget = t.targetId;
      this.targetPosition = t.targetPos;
      this.targetVisible = !!t.visible;
      this.targetScore = t.score;
      this.weaponIndex = t.weaponIndex >= 0 ? t.weaponIndex : 0;
      this.timeSinceHeard = Infinity;
    } else {
      this.firingTarget = null;
      this.targetPosition = null;
      this.targetVisible = false;
      this.targetScore = 0;
    }
    this.changedTarget.Fire = changed && !!t.targetId;
    return t.urgency * mod;
  }

  /** `BBScout::calculateUrgency` through `ScoutState`. */
  _urgencyScout(mod, now, dt) {
    const s = this.senses;
    const attackers = [];
    for (const [id, f] of s.attackers) {
      const p = f.pos ?? playerPosition(this.world.players.get(id));
      if (p) attackers.push({ id, pos: p, strength: f.strength, time: f.time, rate: f.rate });
    }
    const heard = [...s.heard.values()].map(h => ({ ...h, threat: 4, direct: true }));
    const incoming = s.incoming.filter(f => f.pos);
    const r = this.scout.evaluate({
      now, dt,
      position: this.position, yaw: this.yaw, pitch: this.pitch,
      quadInertia: this.quadInertia,
      incoming, heard, spotted: s.spottedEnemies(), attackers,
      isScouting: this._scoutRan === true,
      coverActive: this.currentBehaviour === BEHAVIOUR.TakeCover,
    });
    this._scoutRan = false;
    this.changedTarget.Scout = !!r.changed;
    this._scoutDir = r.dir;
    // The urge curve is applied by the decision loop (the active behaviour's
    // seconds), so the generator hands back its own value times the modifier.
    return r.urgency * mod;
  }

  /** `BBTakeCoverInfantry::calculateUrgency` through `TakeCoverState`. */
  _urgencyTakeCover(mod, now) {
    const s = this.senses;
    const heard = [...s.heard.values()].map(h => ({ ...h, threat: 4, security: 1 }));
    const spotted = s.spottedEnemies().map(m => ({ ...m, threat: 4 }));
    const nav = this.navGrid;
    const r = this.cover.evaluate({
      now, position: this.position,
      incoming: s.incoming.filter(f => f.pos), heard, spotted,
      covers: this._coverCandidates(),
      lineClear: (a, b) => this._lineClear(a, b),
      traceValidPoint: nav ? (from, to) => {
        const p = traceValidPoint(nav, from[0], from[1], to[0], to[1], this.obstacles);
        return isWalkable(nav, p[0], p[1]) ? p : null;
      } : null,
      mod,
      myWidth: 0.6, myHeight: 1.8,
    });
    this.changedTarget.TakeCover = !!r.changed;
    this._coverResult = r;
    return r.urgency ?? 0;
  }

  /** The cover objects within the soldier's `coverSearchRadius 20`. */
  _coverCandidates() {
    const all = this.covers;
    if (!all?.length) return [];
    const out = [];
    for (const c of all) {
      const d = Math.hypot(c.pos[0] - this.position[0], c.pos[2] - this.position[2]);
      if (d <= TAKE_COVER.coverSearchRadius) out.push(c);
    }
    return out;
  }

  /**
   * `BBAvoid::calculateUrgency` for a soldier (zero look-ahead): a moving
   * body already overlapping the bot's own radius. Urgency `|relVel| /
   * |relPos|`; a stationary one is the map's business (`_trackContact`).
   */
  _urgencyAvoid(mod, now) {
    let best = 0, bestDir = null;
    const me = this._player();
    for (const [id, p] of this.world?.players ?? []) {
      if (id === this.playerId || !p?.soldier) continue;
      const s = p.soldier;
      const dx = s.x - this.position[0], dz = s.z - this.position[2];
      const d = Math.hypot(dx, dz);
      if (d > 2 * SOLDIER_RADIUS * 0.6 || d < 1e-3) continue;
      const v = s.speed ?? 0;
      const mv = me?.soldier?.speed ?? 0;
      const rel = Math.hypot(v * Math.sin(s.yaw) - mv * Math.sin(this.yaw), v * Math.cos(s.yaw) - mv * Math.cos(this.yaw));
      if (rel < 0.2) continue;
      const u = rel / d;
      if (u > best) { best = u; bestDir = [dx / d, dz / d]; }
    }
    if (best > 0 && bestDir) {
      this._avoidThreatDir = bestDir;
      this.changedTarget.Avoid = true;
    }
    return best * mod;
  }

  // -----------------------------------------------------------------------
  // Plan generators
  // -----------------------------------------------------------------------

  _generatePlan(behaviour, now) {
    switch (behaviour) {
      case BEHAVIOUR.Fire: return this._planFire(now);
      case BEHAVIOUR.TakeCover: return this._planTakeCover(now);
      case BEHAVIOUR.MoveTo: return this._planMoveTo(now);
      case BEHAVIOUR.Scout: return this._planScout(now);
      case BEHAVIOUR.Avoid: return this._planAvoid(now);
      case BEHAVIOUR.Idle:
      default: return this._planIdle();
    }
  }

  /** `BBPIdleInfantery`: `while (true) reset controls`. */
  _planIdle() {
    if (this.planBehaviour === BEHAVIOUR.Idle && this.currentPlan.length) return this.currentPlan;
    return [{ type: PLAN_ACTION.InfantryResetControls, persistent: true }];
  }

  /**
   * `BBPGotoWaypointSoldier::createPlan`: a pose (stand) and a MoveTo to the
   * waypoint's point with its radius; rebuilt only when the goal moved by
   * more than `4 * maxSpeed`.
   */
  _planMoveTo(now) {
    const wp = this.waypoints ?? this._fallbackWaypoint();
    if (!wp) return this._planIdle();
    const goal = [wp.point[0], this.position[1], wp.point[1]];
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.MoveTo && cur.length && cur[0].waypointObject === wp) return cur;
    return [{ type: PLAN_ACTION.InfantryMoveTo, waypoint: goal, arrive: wp.radius, waypointObject: wp,
              stance: 'stand' }];
  }

  /** `BBPFireInfantery::createPlan` through `firePlanFor`. */
  _planFire(now) {
    if (!this.firingTarget || !this.targetPosition) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.Fire && cur.length && cur.targetId === this.firingTarget
        && !this._firePlanDone(cur, now)) {
      return cur;
    }
    const weapon = this.weapons[this.weaponIndex] ?? this.weapons[0];
    const pose = firingPose(this.position, this.targetPosition, (a, b) => this._lineClear(a, b));
    const plan = firePlanFor({
      position: this.position, targetPos: this.targetPosition, targetId: this.firingTarget,
      weapon, pose: pose ?? 'stand', now,
    });
    plan.targetId = this.firingTarget;
    plan.startedAt = now;
    this._shotsThisPlan = 0;
    return plan;
  }

  /** The fire plan's end conditions: target dead, timeout, shots spent. */
  _firePlanDone(plan, now) {
    const trigger = plan.find(a => a.type === PLAN_ACTION.Trigger || a.type === PLAN_ACTION.TriggerContinously);
    if (!trigger) return true;
    if (now - plan.startedAt > trigger.timeout) return true;
    if (trigger.shots > 0 && (this._shotsThisPlan ?? 0) >= trigger.shots) return true;
    if (this.magazineEmpty) return true;                 // an empty magazine
    if (this.world?.armorOf?.(plan.targetId)?.destroyed) return true;
    return false;
  }

  /** `BBPScoutInfantery::createPlan`: look along the direction, sense, pose. */
  _planScout(now) {
    const dir = this._scoutDir;
    if (!dir) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.Scout && cur.length && cur.dir) {
      const dot = cur.dir[0] * dir[0] + cur.dir[1] * dir[1] + cur.dir[2] * dir[2];
      if (dot > SCOUT.planReuseCos) return cur;
    }
    const plan = [
      { type: PLAN_ACTION.SoldierPose, pose: this.isUnderFire ? 'prone' : 'stand' },
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
  _planTakeCover(now) {
    const r = this._coverResult;
    if (!r?.urgency) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.TakeCover && cur.length && cur.danger && r.dangerPos) {
      const moved = Math.hypot(cur.danger[0] - r.dangerPos[0], cur.danger[2] - r.dangerPos[2]);
      if (moved < (r.dangerId ? TAKE_COVER.reuseMoveObject : TAKE_COVER.reuseMoveStatic)) return cur;
    }
    let goal = r.goal;
    let arrive = Math.max(TAKE_COVER.arriveMin, 0.5 * 5.0);
    let prone = false;
    if (!goal) {
      const low = this.cover.lowestGround({
        position: this.position,
        isWalkable: this.navGrid ? (x, z) => isWalkable(this.navGrid, x, z) : null,
        heightAt: (x, z) => this.world?.collider?.surfaceHeight?.(x, z) ?? 0,
      }, r.dangerPos);
      if (!low) return this._planIdle();
      goal = low;
      arrive = TAKE_COVER.arriveMin;
      prone = true;
    }
    const plan = [
      { type: PLAN_ACTION.InfantryMoveTo, waypoint: [goal[0], this.position[1], goal[1]], arrive, stance: prone ? 'prone' : 'stand' },
      { type: PLAN_ACTION.SoldierPose, pose: prone ? 'prone' : 'ladder', danger: r.dangerPos, afterMove: true },
      { type: PLAN_ACTION.MouseTurretLookAt, target: r.dangerPos, afterMove: true, persistent: true },
    ];
    plan.danger = r.dangerPos;
    return plan;
  }

  /** The Avoid sidestep: a diagonal away from the body (header). */
  _planAvoid(now) {
    const t = this._avoidThreatDir;
    if (!t) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.Avoid && cur.length && now < this.avoidUntil) return cur;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx;
    const side = (t[0] * rx + t[1] * rz) > 0 ? -1 : 1;
    const dx = (fx + side * rx) * Math.SQRT1_2, dz = (fz + side * rz) * Math.SQRT1_2;
    this.avoidUntil = now + AVOID_TIME;
    return [{ type: PLAN_ACTION.InfantryMoveToDirection, direction: [dx, dz], distance: AVOID_STEP, until: this.avoidUntil }];
  }

  // -----------------------------------------------------------------------
  // Plan interpreter (§4.2)
  // -----------------------------------------------------------------------

  /** Run every action in the plan for this tick. */
  _runPlan(dt, now) {
    let allComplete = true;
    let moved = false;
    for (const action of this.currentPlan) {
      if (action.afterMove && this.currentPlan.some(a => (a.type === PLAN_ACTION.InfantryMoveTo
            || a.type === PLAN_ACTION.InfantryMoveToObject) && !a.done)) {
        allComplete = false;
        continue;
      }
      const complete = this._executeAction(action, dt, now);
      if (complete) action.done = true;
      if (!complete && !action.persistent) allComplete = false;
      if (action.type === PLAN_ACTION.InfantryMoveTo || action.type === PLAN_ACTION.InfantryMoveToObject) moved = true;
    }
    if (allComplete && !this.currentPlan.some(a => a.persistent)) this.currentPlan = [];
    if (!moved) this._lastThrottle = 0;
  }

  _executeAction(action, dt, now) {
    switch (action.type) {
      case PLAN_ACTION.InfantryMoveTo:
      case PLAN_ACTION.MoveToMediumSoldier:
        return this._execInfantryMoveTo(action, dt);
      case PLAN_ACTION.InfantryMoveToObject:
      case PLAN_ACTION.MoveToObjectMediumSoldier:
        return this._execInfantryMoveToObject(action, dt);
      case PLAN_ACTION.InfantryMoveToDirection:
        return this._execInfantryMoveToDirection(action, dt, now);
      case PLAN_ACTION.MouseTurretAimAt:
        return this._execMouseTurretAimAt(action);
      case PLAN_ACTION.MouseTurretLookAt:
        return this._execMouseTurretLookAt(action);
      case PLAN_ACTION.Trigger:
      case PLAN_ACTION.TriggerContinously:
        return this._execTrigger(action, now);
      case PLAN_ACTION.InfantryResetControls:
        return this._execInfantryResetControls();
      case PLAN_ACTION.Sense:
        return this._execSense(action);
      case PLAN_ACTION.SoldierPose:
        return this._execSoldierPose(action);
      case PLAN_ACTION.InfoWrapper:
      default:
        return true;
    }
  }

  /** `InfanteryMoveToObject`: the target's live position is the goal. */
  _execInfantryMoveToObject(action, dt) {
    const p = this.world?.players?.get(action.targetId);
    const pos = playerPosition(p) ?? action.targetPos;
    if (!pos) return true;
    action.waypoint = [pos[0], pos[1], pos[2]];
    return this._execInfantryMoveTo(action, dt);
  }

  /** `InfanteryMoveToDirection`: walk a direction for a while. */
  _execInfantryMoveToDirection(action, dt, now) {
    if (now >= action.until) return true;
    const [dx, dz] = action.direction;
    this._steerToward(this.position[0] + dx * action.distance, this.position[2] + dz * action.distance, 1);
    this._lastThrottle = this.moveForward;
    return false;
  }

  /** `MouseTurretAimAt` (`EntryMouseTurretAimAt`): aim at the target's live
   *  position, the engine's 4-count rate. */
  _execMouseTurretAimAt(action) {
    const p = action.targetId ? this.world?.players?.get(action.targetId) : null;
    const pos = playerPosition(p) ?? action.targetPos;
    if (!pos) return true;
    const aim = faceTarget(this._eye(), [pos[0], pos[1] + 1.0, pos[2]]);
    this._aimLook(aim.yaw, aim.pitch, AIM_COUNTS_MAX);
    return true;
  }

  /** `MouseTurretLookAt` (`BAPALookInDir` / `LookAtObject`): a direction or a point. */
  _execMouseTurretLookAt(action) {
    if (action.target) {
      const aim = faceTarget(this._eye(), [action.target[0], action.target[1] + 1.0, action.target[2]]);
      this._aimLook(aim.yaw, aim.pitch, AIM_COUNTS_MAX);
    } else if (action.dir) {
      const yaw = Math.atan2(action.dir[0], action.dir[2]);
      const pitch = Math.atan2(action.dir[1], Math.hypot(action.dir[0], action.dir[2]));
      this._aimLook(yaw, pitch, AIM_COUNTS_MAX);
    } else if (action.yaw !== undefined) {
      this._aimLook(action.yaw, action.pitch ?? null, AIM_COUNTS_MAX);
    }
    return true;
  }

  /**
   * `EntryTrigger` / `EntryTriggerContinously`: the trigger goes down while
   * the aim condition holds — the live facing within the plan's tolerance
   * of the target — and the page fires rounds at the weapon's rate. The
   * statement ends on the plan's end conditions (`_firePlanDone`).
   */
  _execTrigger(action, now) {
    const p = action.targetId ? this.world?.players?.get(action.targetId) : null;
    const pos = playerPosition(p) ?? action.targetPos;
    if (!pos) return true;
    const s = this._player()?.soldier;
    const want = faceTarget(this._eye(), [pos[0], pos[1] + 1.0, pos[2]]);
    const dy = wrapAngle(want.yaw - (s?.yaw ?? this.yaw));
    const dp = want.pitch - (s?.pitch ?? this.pitch);
    const tol = Math.max(action.tolerance ?? LOOK_TOLERANCE, LOOK_TOLERANCE);
    const aligned = Math.hypot(dy, dp) < tol;
    if (aligned && this._lineClear(this._eye(), [pos[0], pos[1] + 1.0, pos[2]])) {
      this.isFiring = true;
    }
    return false;
  }

  /** `InfanteryResetControls`: clear every movement/aim input. */
  _execInfantryResetControls() {
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.stanceInput = 'stand';
    this.isFiring = false;
    this.lookX = 0;
    this.lookY = 0;
    this.waypoint = null;
    this.route = null;
    this._lastThrottle = 0;
    return true;
  }

  /** `Sense` (`EntrySense`): complete when the look is within the deviation
   *  of the scout direction; `BAPICScout` marks the tick as scouting. */
  _execSense(action) {
    this._scoutRan = true;
    const dir = action.dir;
    if (!dir) return true;
    const fx = Math.sin(this.yaw) * Math.cos(this.pitch), fy = Math.sin(this.pitch), fz = Math.cos(this.yaw) * Math.cos(this.pitch);
    const dot = fx * dir[0] + fy * dir[1] + fz * dir[2];
    if (dot >= Math.cos(action.deviation ?? SCOUT.senseDeviation)) {
      this.scout.senseComplete();
      return true;
    }
    return false;
  }

  /** `SoldierPose`: a stance, or the TakeCover ladder (stand if the danger is
   *  in the line of fire, else crouch, else prone). */
  _execSoldierPose(action) {
    let pose = action.pose;
    if (pose === 'ladder') {
      const danger = action.danger;
      pose = 'prone';
      if (danger) {
        const to = [danger[0], danger[1] + 1.0, danger[2]];
        for (const [name, eye] of [['stand', 1.6], ['crouch', 1.1]]) {
          if (this._lineClear([this.position[0], this.position[1] + eye, this.position[2]], to)) { pose = name; break; }
        }
      }
    }
    if (pose === 'walk' || pose === 'stand' || pose === 'crouch' || pose === 'prone') this.stanceInput = pose;
    action.persistent = true;
    return true;
  }

  // -----------------------------------------------------------------------
  // Queries used by the page
  // -----------------------------------------------------------------------

  setPosition(x, y, z) {
    this.position[0] = x; this.position[1] = y; this.position[2] = z;
  }

  getPosition() {
    return [...this.position];
  }

  /** The bot's eye pose for the page's fire path. */
  aimRay() {
    const cosP = Math.cos(this.pitch);
    return {
      origin: this._eye(),
      dir: [Math.sin(this.yaw) * cosP, Math.sin(this.pitch), Math.cos(this.yaw) * cosP],
    };
  }

  /** The page's respawn hook: forget everything the old body knew. */
  onRespawn() {
    this.senses = new BotSenses({ viewDistance: this.viewDistance, random: this.random });
    this.memory = this.senses.memory;
    this.firingTarget = null; this.targetPosition = null; this.targetScore = 0;
    this.currentPlan = []; this.currentBehaviour = null; this.planBehaviour = null;
    this.route = null; this.obstacles = []; this._stalledTicks = 0;
    this.scout = new ScoutState();
    this.cover = new TakeCoverState();
    this.isUnderFire = false; this.timeSinceNearbyShot = Infinity;
    this._bestGoalDist = null; this._noProgress = 0;
  }
}

/**
 * Bot spawner: creates N bots on team-capped spawn points.
 *
 * `teams` splits them across sides round-robin (the engine tops up both
 * sides on the game's team balance); `kitFor(team, index)` may return
 * `{ name, weapons }` (AI weapon entries) for the bot's kit — the engine's
 * choice is uniform among the side's allowed kits (`BotSpawner::
 * findKitDiff` is 1 for every kit in practice).
 */
export function spawnBots({
  world,
  count = 4,
  botSkill = DEFAULT_BOT_SKILL,
  team = null,
  teams = null,
  flags = [],
  controlInfo = null,
  weaponAi = null,
  kitFor = null,
  viewDistance = null,
} = {}) {
  const bots = [];
  const teamList = Array.isArray(teams) && teams.length ? teams : null;

  for (let i = 0; i < count; i++) {
    const botTeam = teamList ? teamList[i % teamList.length] : team;
    const teamName = botTeam === 1 ? 'German' : 'American';
    const names = BOT_NAMES[teamName] || FALLBACK_NAMES;

    const teamFlags = flags.filter(f => f.team === botTeam);
    const flag = teamFlags.length ? teamFlags[i % teamFlags.length] : null;
    const spawnIndex = teamFlags.length ? Math.floor(i / teamFlags.length) : i;

    const playerId = `bot_${i}`;
    const player = world.addBotPlayer(playerId, { team: botTeam, flag, spawnIndex });
    if (!player) continue;

    const kit = kitFor ? kitFor(botTeam, i) : null;
    const resolvedFlag = world.player(playerId)?.flag ?? flag;
    const bot = new BotController({
      playerId,
      world,
      botSkill,
      name: names[i % names.length],
      spawnPos: spawnPositionOf(player, resolvedFlag),
      controlInfo,
      weaponAi,
      weapons: kit?.weapons ?? null,
      viewDistance,
    });
    bot.kit = kit?.name ?? null;
    bot.kitPrimary = kit?.primary ?? null;
    bots.push(bot);
  }
  return bots;
}

/** A spawn position for a freshly-spawned bot: its soldier, else the flag. */
function spawnPositionOf(player, flag) {
  if (player?.soldier) return [player.soldier.x, player.soldier.y, player.soldier.z];
  const spawn = flag?.spawns?.[player?.spawnIndex ?? 0] ?? flag?.spawns?.[0];
  return spawn?.position ? [...spawn.position] : null;
}
