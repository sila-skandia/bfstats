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
import { traceValidPoint, isWalkable } from './nav-grid.js';
import { BotSenses, lineClear, playerPosition, SOLDIER_RADIUS } from './bot-sense.js';
import { firingPose, firePlanFor, weaponAiOf, FIRE, SOLDIER_BATTLE_STRENGTH } from './bot-fire.js';
import { ScoutState, TakeCoverState, QUADRANTS, SCOUT, TAKE_COVER, MedicState, MEDIC } from './bot-behaviours.js';
import { unitUrgency, orderSplit, changeUrgency, teleportChangeUrgency, TANK, CHANGE, TELEPORT } from './bot-vehicle.js';
import { decleiningSlope } from './bot-behaviours.js';
import { aimAtDirection, towardsPoint, attackRunStep, roundMiss, planeFireMode, insideBattleZone, PLANE, BOAT, PLANE_FIRE } from './bot-vehicle-air.js';
import { fireStrength, unitTable, STRENGTH } from './bot-strength.js';
import * as aiming from './bot-aim.js';
import { AIM_COUNTS_MAX, wrapAngle, faceTarget } from './bot-aim.js';
import * as perception from './bot-perception.js';
import * as routing from './bot-route.js';
import { BOT_RADIUS, VEHICLE_RADIUS } from './bot-route.js';

export { PI } from './bot-aim.js';

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
const REGISTERED = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Special', 'Scout', 'TakeCover', 'Change'];
/** The Tank rows: no Special. */
const REGISTERED_VEHICLE = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Scout', 'TakeCover', 'Change'];
/** `ChangeInhibit`: the column applied while Change is the active behaviour. */
const CHANGE_INHIBIT = { Avoid: 1.0, MoveTo: 0.0, Idle: 1.0, Fire: 1.0, Special: 1.0, Scout: 1.0, TakeCover: 1.0, Change: 1.0 };

/** `StandardWeights`, the standard personality of both sides. */
export const STANDARD_WEIGHTS = {
  Avoid: 1.0, MoveTo: 1.5, Idle: 0.1, Fire: 7.5, Special: 1.0, Scout: 1.0, TakeCover: 2.0, Change: 1.9,
};
/** `UnitWeights`: every column 1. */
const UNIT_WEIGHTS = { Avoid: 1, MoveTo: 1, Idle: 1, Fire: 1, Special: 1, Scout: 1, TakeCover: 1, Change: 1 };
/** `AvoidInhibit`: the column applied while Avoid is the active behaviour. */
const AVOID_INHIBIT = { Avoid: 1.0, MoveTo: 0.3, Idle: 1.0, Fire: 1.0, Special: 0.5, Scout: 1.0, TakeCover: 1.0, Change: 1.0 };
/** Each infantry row's modifier set (`setVehicleBehaviour Infantery ...`). */
const INHIBITOR = { Avoid: AVOID_INHIBIT, MoveTo: UNIT_WEIGHTS, Idle: UNIT_WEIGHTS, Fire: UNIT_WEIGHTS, Special: UNIT_WEIGHTS, Scout: UNIT_WEIGHTS, TakeCover: UNIT_WEIGHTS, Change: CHANGE_INHIBIT };

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
  Fire: URGENCY_CURVE.fire, Special: URGENCY_CURVE.union, Scout: URGENCY_CURVE.scout, TakeCover: URGENCY_CURVE.union,
  Change: URGENCY_CURVE.union };
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
  EnterVehicle: 'EnterVehicle',
  ExitVehicle: 'ExitVehicle',
  /** `BBPChangeTeleport`: the seat-select key for another seat of the hull. */
  SwitchSeat: 'SwitchSeat',
  /** `BBPFire3d`: the aircraft's attack loop (approach, aim and fire, break). */
  PlaneAttack: 'PlaneAttack',
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
/** No strategic data: a bot walks to the nearest enemy flag with this
 *  waypoint radius (INVENTION). */
const FALLBACK_WAYPOINT_RADIUS = 5.0;
/** How long with no *net* progress toward the goal before the page redeploys
 *  the bot to another spawn point (s). The engine has no such thing; it is
 *  the viewer's safety net for a body wedged in geometry the map cannot see. */
const NO_PROGRESS_RESPAWN = 12.0;

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
    this.medic = new MedicState();
    /** The land vehicle the bot drives, from the page's `mount` (null on foot). */
    this.vehicle = null;
    /** The page's list of enterable driver seats (`botVehicleCandidates`). */
    this.vehicleCandidates = [];
    /** Set by the Change plan: the page mounts the bot on this vehicle. */
    this.enterRequest = null;
    /** Set by the Change plan while seated: the page unseats the bot. */
    this.exitRequest = false;
    /** Set by the seat-swap plan: the page reseats the bot (`{ seatId }`). */
    this.switchRequest = null;
    /** The side's enemy strength tables (`{ strengths, types }`), from the
     *  page's strategic pass (bot-strength.js `EnemyStrengthTables`). */
    this.enemyTables = null;
    /** The page's description of a target (`scoreVehicleTargets` `infoOf`). */
    this.unitInfoOf = null;
    /** The plane's attack-run state (`attackRunStep`). */
    this._attackState = null;
    this._lastChangeAt = -Infinity;
    this._leftVehicle = null;
    this._footWeapons = null;
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

  _eye() { return aiming.eye(this); }
  _aimOrigin() { return aiming.aimOrigin(this); }

  /** The behaviours the bot's current unit registers (AIbehaviours.con rows). */
  _registered() {
    return this.vehicle ? REGISTERED_VEHICLE : REGISTERED;
  }

  /** The map and body radius of the unit the bot moves as. */
  _nav() { return this.vehicle ? (this.vehicle.nav ?? null) : this.navGrid; }
  _radius() { return this.vehicle ? (this.vehicle.radius ?? VEHICLE_RADIUS) : BOT_RADIUS; }

  _vehicleForward() { return aiming.vehicleForward(this); }

  /**
   * The page seats the bot: `m` is `{ id, node, drive, occupancy, kind, nav,
   * radius, maxSpeed, weapons, template }`. The unit's weapons replace the
   * kit's for the Fire behaviour while mounted.
   */
  mount(m, now = this._now ?? 0) {
    this.vehicle = m;
    // `isAirBorn` (+0x1d5) is cleared only when the controlled object
    // changes (`updateBotVehicle` 0x0852c899) or the bot is built (ctor
    // 0x0851d475); `event_airborn` 0x0852eca0 sets it from the flight law.
    // A landed plane keeps it.
    this._airborne = false;
    this.enterRequest = null;
    this._lastChangeAt = now;
    this._footWeapons = this.weapons;
    this.weapons = (m.weapons?.length ? m.weapons : [{ name: m.template ?? 'vehicle', maxRange: 0, strength: {} }]).map(weaponAiOf);
    this.exitRequest = false;
    this.weaponIndex = 0;
    this._execInfantryResetControls();
    this.currentPlan = []; this.currentBehaviour = null; this.planBehaviour = null;
    this.route = null;
  }

  /** The page unseats the bot (destroyed, or bailed). */
  dismount(now = this._now ?? 0) {
    const left = this.vehicle;
    this.vehicle = null;
    this._airborne = false;
    // Keyed by the hull, as the candidates are (`vehicleId`): the seat's own
    // id (`<uuid>:<seat>`) never matched one, so the 15 s ramp never ran.
    this._leftVehicle = left ? { id: left.vehicleId ?? left.id, at: now } : null;
    this._lastChangeAt = now;
    if (this._footWeapons) this.weapons = this._footWeapons;
    this._footWeapons = null;
    this.weaponIndex = 0;
    this._execInfantryResetControls();
    this.currentPlan = []; this.currentBehaviour = null; this.planBehaviour = null;
    this.route = null;
  }

  _lineClear(from, to) { return perception.lineClearSkippingSelf(this, from, to); }
  _selfOwner() { return perception.selfOwner(this); }

  onShotFired(shooterId, shooterTeam, pos, now, weaponRadius) { return perception.onShotFired(this, shooterId, shooterTeam, pos, now, weaponRadius); }
  onIncomingFire(attackerId, pos, now, hit, strength) { return perception.onIncomingFire(this, attackerId, pos, now, hit, strength); }
  recordNearbyShot(shotPos, now, shooterId, shooterTeam) { return perception.recordNearbyShot(this, shotPos, now, shooterId, shooterTeam); }
  hearSound(soundPos, now, sourceTeam) { return perception.hearSound(this, soundPos, now, sourceTeam); }
  onShot(now) { return perception.onShot(this, now); }
  recordHit(targetId) { return perception.recordHit(this, targetId); }
  _tally(kind, targetId) { return perception.tally(this, kind, targetId); }
  sense(now) { return perception.sense(this, now); }
  _sensePass(now, dt) { return perception.sensePass(this, now, dt); }
  _chooseFiringTarget(now) { return perception.chooseFiringTarget(this, now); }
  _insideOrderedArea() { return perception.insideOrderedArea(this); }

  _unitVelocity() { return aiming.unitVelocity(this); }
  _unitForward3() { return aiming.unitForward3(this); }

  _myType() { return perception.myType(this); }
  _chooseVehicleTarget(now) { return perception.chooseVehicleTarget(this, now); }
  _unitInfo(id) { return perception.unitInfo(this, id); }

  _turretCanPoint(dir) { return aiming.turretCanPoint(this, dir); }

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
    if (this.vehicle) {
      // Mounted: the hull's pose (flight.js `FORWARD` is the node's -z); a
      // rider's is the seat node's world matrix, which the page keeps in
      // the player record's `position`.
      const st = this.vehicle.drive?.state;
      if (st) {
        this.position[0] = st.position.x;
        this.position[1] = st.position.y;
        this.position[2] = st.position.z;
      } else if (player?.position) {
        this.position[0] = player.position[0];
        this.position[1] = player.position[1];
        this.position[2] = player.position[2];
      }
      const f = this._vehicleForward();
      this.yaw = Math.atan2(f[0], f[1]);
      this.pitch = 0;
      this.stance = 'stand';
      this._airInput = null;
    } else if (player?.soldier) {
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

  _resetInput() { return aiming.resetInput(this); }
  _writeInput() { return aiming.writeInput(this); }
  _cameraBasis(lookYaw) { return aiming.cameraBasis(this, lookYaw); }
  _noseReference() { return aiming.noseReference(this); }
  _aimReference() { return aiming.aimReference(this); }
  _aimLook(desiredYaw, desiredPitch, maxCounts) { return aiming.aimLook(this, desiredYaw, desiredPitch, maxCounts); }
  _turretInputSigns() { return aiming.turretInputSigns(this); }

  _ageObstacles(dt) { return routing.ageObstacles(this, dt); }
  _trackContact(soldier) { return routing.trackContact(this, soldier); }
  _ensureRoute(goal) { return routing.ensureRoute(this, goal); }
  _extendRoute() { return routing.extendRoute(this); }
  _lookAhead() { return routing.lookAhead(this); }
  _popPassed() { return routing.popPassed(this); }
  _trackObstruction(speed, dt) { return routing.trackObstruction(this, speed, dt); }
  _onObstructed() { return routing.onObstructed(this); }
  _steerToward(x, z, speed) { return routing.steerToward(this, x, z, speed); }
  _execInfantryMoveTo(action, dt) { return routing.execInfantryMoveTo(this, action, dt); }

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
    for (const name of this._registered()) {
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
      for (const name of this._registered()) {
        if (this._quotientChanged(name) || this.changedTarget[name]) { reselect = true; break; }
      }
    }
    let winner = this.currentBehaviour;
    if (reselect) {
      let best = 0;
      winner = null;
      for (const name of this._registered()) {
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
    for (const name of this._registered()) this.changedTarget[name] = false;
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
      case BEHAVIOUR.Special: return this._urgencySpecial(mod, now);
      case BEHAVIOUR.Change: return this._urgencyChange(mod, now);
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
    // R' adds the unit's `getMaxPathPosRemovalDistance` (BotMain 0x0852b780:
    // 0.99 x max(0.5, bounding radius - the bounding centre's offset)); the
    // page's vehicle radius stands in for a hull's.
    const u = wp.urgency(this.position[0], this.position[2], this._pathRadius(), this.position[1]);
    this.changedTarget.MoveTo = wp !== this._lastWaypointObject;
    this._lastWaypointObject = wp;
    // `BBMoveToFixed::calculateUrgency` 0x08575680 (the Fixed rows: a seat
    // that does not drive) publishes the order's urgency to the bot and
    // returns 0: a gunner or a fixed gun never walks.
    this._orderUrgency = u > 0 ? u * mod : 0;
    if (this.vehicle && !this.vehicle.drives) return 0;
    return u > 0 ? u * mod : 0;
  }

  /** `Bot::getMaxPathPosRemovalDistance` for the unit the bot controls. */
  _pathRadius() {
    return this.vehicle ? 0.99 * Math.max(0.5, this.vehicle.radius ?? SOLDIER_RADIUS) : SOLDIER_RADIUS;
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
    const nav = this._nav();
    const r = this.cover.evaluate({
      now, position: this.position,
      incoming: s.incoming.filter(f => f.pos), heard, spotted,
      covers: this._coverCandidates(),
      lineClear: (a, b) => this._lineClear(a, b),
      traceValidPoint: nav ? (from, to) => {
        const p = traceValidPoint(nav, from[0], from[1], to[0], to[1], this.obstacles);
        return p && isWalkable(nav, p[0], p[1]) ? p : null;
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
   * `BBMedicAssist::calculateUrgency` (bot-behaviours.js `MedicState`): the
   * wounded friends in reach of a healing weapon. The friends are the
   * world's players of the bot's own side: their armour's fraction, whether
   * they sit in a vehicle; a soldier is always upright here.
   */
  _urgencySpecial(mod, now) {
    if (!this.weapons?.some(w => w.healing)) return 0;
    const world = this.world;
    const me = this._player();
    const friends = [];
    for (const [id, p] of world?.players ?? []) {
      if (id === this.playerId || !p || p.team !== me?.team) continue;
      const armor = world.armorOf?.(id);
      if (!armor || armor.destroyed || !(armor.maxHitPoints > 0)) continue;
      const pos = playerPosition(p);
      if (!pos) continue;
      const d = Math.hypot(pos[0] - this.position[0], pos[2] - this.position[2]);
      if (d > MEDIC.searchRadius) continue;
      friends.push({ id, pos, health: armor.hitPoints / armor.maxHitPoints,
                     upright: true, inVehicle: !!p.vehicle, radius: SOLDIER_RADIUS, type: 'Infantry' });
    }
    const collider = world?.collider;
    const water = collider?.waterLevel;
    const waterDepth = Number.isFinite(water) ? Math.max(0, water - this.position[1]) : 0;
    const nav = this._nav();
    const wp = this.waypoints;
    const r = this.medic.evaluate({
      now, position: this.position, waterDepth, weapons: this.weapons, friends,
      isWalkable: nav ? (x, z) => isWalkable(nav, x, z) : null,
      insideMyArea: wp?.area ? (x, z) => wp.inside(x, z) : null,
      mod,
    });
    this.changedTarget.Special = !!r.changed;
    this._medicResult = r;
    return r.urgency;
  }

  /**
   * `BBPMedicAssist::createPlan`: the healing weapon, the walk to `R +
   * 0.9 * range` when farther, then the look within 5 deg and the trigger
   * held while the friend is under 95 % and in reach.
   */
  _planSpecial(now) {
    const r = this._medicResult;
    if (!r?.targetId || !(r.urgency > 0)) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.Special && cur.length && cur.targetId === r.targetId
        && !this._healPlanDone(cur, now)) {
      this.weaponIndex = cur.weaponIndex;
      return cur;
    }
    this.weaponIndex = r.weaponIndex;
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
  _healPlanDone(plan, now) {
    const world = this.world;
    const p = world?.players?.get(plan.targetId);
    const armor = world?.armorOf?.(plan.targetId);
    if (!p || !armor || armor.destroyed) return true;
    if (armor.hitPoints / armor.maxHitPoints >= MEDIC.healthBelow) return true;
    const pos = playerPosition(p);
    if (!pos) return true;
    const d = Math.hypot(pos[0] - this.position[0], pos[2] - this.position[2]);
    if (d > plan.arrive + 2.0) return true;             // walked out of reach: re-plan
    const w = this.weapons[plan.weaponIndex];
    if (w && w.ammo === 0) return true;
    return false;
  }

  /**
   * `BBChange::calculateUrgency` (bot-vehicle.js): on foot, the enterable
   * land vehicles the page lists against staying on foot; mounted, no
   * voluntary bail (INVENTION: `isBailAllowed` is not read; the page
   * unseats a bot whose vehicle is destroyed).
   */
  _urgencyChange(mod, now) {
    const cands = this.vehicleCandidates;
    const world = this.world;
    const split = orderSplit(this.waypoints?.attack ?? 0, this.waypoints?.defence ?? 0);
    const me = world?.armorOf?.(this.playerId);
    const myHealth = me?.maxHitPoints > 0 ? me.hitPoints / me.maxHitPoints : 1;
    // The soldier's own table is `setBattleStrength` (the kit's weapons do
    // not rewrite it: `AITemplateUnit` +0x14 is set by the con).
    const foot = unitUrgency({ health: myHealth, fire: this._fireStrengthOf({ table: SOLDIER_BATTLE_STRENGTH, myType: 'Infantry' }),
                               maxSpeed: TANK.soldierMaxSpeed, value: 1, orderSplit: split });
    const ramp = Math.min(1, Math.max(0, (now - this._lastChangeAt) / CHANGE.rampSeconds));
    const areaFactor = this._insideOrderedArea() ? 1 : CHANGE.outsideAreaFactor;
    if (this.vehicle) {
      // Seated: `staying` is the seat's own urgency x1.25, 0 when the hull
      // is upside down; the alternatives are the foot (a bail, doubled) and
      // the other free seats around. `isBailAllowed` 0x0855fd70: a soldier
      // must be able to stand where the hull is (the infantry map).
      const m = this.vehicle;
      const mine = cands?.find(c => c.id === m.id) ?? null;
      const hull = world?.occupiedDamageable?.(this.playerId);
      const health = hull?.maxHitPoints > 0 ? hull.hitPoints / hull.maxHitPoints : (mine?.health ?? 1);
      // `calculateVehicleMoveUrgency`: a driver moves the hull; a rider moves
      // only while someone drives it (x2.5 of the 4 under a bot driver whose
      // order differs — taken as the same order here).
      const driver = m.drives ? this.playerId : (m.driverOf?.() ?? null);
      const seatSpeed = m.drives ? (m.maxSpeed ?? 0) : (driver ? (m.hullMaxSpeed ?? 0) : 0);
      // A seat has no mobile plug-in of its own: it is a fixed weapon
      // unless its hull is occupied (`calculateFireStrength` takes the
      // parent's), and a fixed weapon needs a known enemy it can point at.
      const rootOccupied = !!(mine?.seats ?? m.seats ?? []).find(s => s.isRoot)?.occupied;
      const seatFire = this._fireStrengthOf({
        table: this._seatStrengths(), others: this._otherSeats(mine), air: m.kind === 'air', isSeat: !m.drives,
        myType: this._myType(), fixed: !m.drives && !rootOccupied, aimable: this._fixedAimable(),
      });
      const selfU = unitUrgency({ health, fire: seatFire,
                                  maxSpeed: seatSpeed, occupiedByBot: !m.drives && !!driver,
                                  value: mine?.value ?? 0, orderSplit: split });
      let staying = selfU * CHANGE.stayFactor;
      if (mine && mine.upright === false) staying = 0;
      const nav = this.navGrid;
      let bailAllowed = !nav || isWalkable(nav, this.position[0], this.position[2]);
      if (m.kind === 'air') {
        // In the air the engine's bail is a parachute jump; the viewer's
        // soldier has none, so a flying bot stays aboard until it is low
        // (INVENTION).
        const gy = world?.collider?.surfaceHeight?.(this.position[0], this.position[2]);
        bailAllowed = bailAllowed && Number.isFinite(gy) && this.position[1] - gy < 6;
      }
      let best = null, bestU = 0, bail = false;
      if (bailAllowed && foot > bestU) { best = { id: 'foot', u: foot, dist: 0, cand: null }; bestU = foot; bail = true; }
      // The whole seated evaluation, the other units included, sits under
      // `isBailAllowed` (0x0855e0c0: `if (unit+6 & 0x40 || isBailAllowed)`):
      // a bot that may not get out may not get out for another hull either.
      // (A Spitfire bot left its plane at 66 m for a Wespe passing below.)
      for (const c of bailAllowed ? (cands ?? []) : []) {
        if (c.occupiedBy || c.upright === false || c.id === m.id) continue;
        const d = Math.hypot(c.pos[0] - this.position[0], c.pos[2] - this.position[2]);
        if (d > CHANGE.searchRadius) continue;
        if (c.vehicleId === m.vehicleId) continue;          // the same hull is the teleport's business
        const u = unitUrgency({ health: c.health ?? 1, fire: this._candidateFire(c),
                                maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split });
        const f = Math.min(0.5, (CHANGE.searchRadius ** 2 - d * d) / CHANGE.searchRadius ** 2);
        const v = u * (f + 0.5);
        if (v > bestU) { best = { id: c.id, u: v, dist: d, cand: c }; bestU = v; bail = false; }
      }
      let r = null;
      if (best && bestU > staying) {
        const x = staying > 0 ? 0.5 * bestU / staying : 0.5 * bestU;
        const urgency = decleiningSlope(x) * mod * CHANGE.urgencyScale * ramp * areaFactor * (bail ? 2 : 1);
        r = { urgency, best, bail, teleport: false };
      }
      // `BBChangeTeleport`: the other seats of this hull.
      const t = this._urgencyChangeTeleport({ mine, selfU, split, driver, health });
      if (t && (!r || t.urgency > r.urgency)) r = t;
      if (!r) { this._changeResult = null; this.changedTarget.Change = false; return 0; }
      this.changedTarget.Change = (r.best?.id ?? null) !== (this._changeResult?.best?.id ?? null);
      this._changeResult = r;
      return r.urgency;
    }
    if (!cands?.length) { this._changeResult = null; return 0; }
    const nav = this.navGrid;
    const list = [];
    for (const c of cands) {
      if (c.occupiedBy) continue;
      if (c.upright === false) continue;
      const d = Math.hypot(c.pos[0] - this.position[0], c.pos[2] - this.position[2]);
      if (d > CHANGE.searchRadius) continue;
      if (nav && c.entry && !isWalkable(nav, c.entry[0], c.entry[1])) continue;
      const leftAge = this._leftVehicle?.id === c.vehicleId ? now - this._leftVehicle.at : Infinity;
      const u = unitUrgency({ health: c.health ?? 1, fire: this._candidateFire(c),
                              maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split,
                              occupiedByBot: !!c.movedByBot,
                              spawnAge: c.spawnAge ?? Infinity, leftAge });
      list.push({ id: c.id, u, dist: d, cand: c });
    }
    const r = changeUrgency({ staying: foot, candidates: list, mod, ramp, areaFactor });
    this.changedTarget.Change = (r.best?.id ?? null) !== (this._changeResult?.best?.id ?? null);
    this._changeResult = r;
    return r.urgency;
  }

  /** The strength table of the seat the bot holds (its guns). */
  _seatStrengths() {
    return unitTable(this.weapons);
  }

  /** `calculateFireStrength` against the side's enemy tables. With no
   *  strategic pass yet the enemy is taken to field infantry only. */
  _fireStrengthOf({ table, others = [], air = false, isSeat = false, myType = 'Infantry', fixed = false, aimable = true }) {
    const t = this.enemyTables;
    const enemyStrengths = t?.strengths ?? {};
    const enemyTypes = t && t.passes > 0 ? t.types : { Infantry: 1 };
    return fireStrength({ table, others, air, isSeat, myType, enemyStrengths, enemyTypes, fixed, aimable });
  }

  /** A candidate seat's fire strength: its table plus the shares of the
   *  hull's other occupied seats. A fixed gun, or a seat of a hull nobody
   *  drives, is a fixed weapon and needs a known enemy it can point at. */
  _candidateFire(c) {
    // Weighing another seat of the hull it sits in, the bot counts its own
    // seat as empty: it would leave it (0x08584580, `unit != param_7 ||
    // !param_6` on the root's and every seat's share and on the root's
    // mobile test). Without this a driver saw the gunner's seat as a seat
    // under a driver, and the gunner saw the root as a hull with a gunner:
    // each side of the swap beat the other and the bot changed seats every
    // tick.
    const m = this.vehicle;
    const vacate = m && c.vehicleId === m.vehicleId && c.seatId !== m.seatId ? m.seatId : null;
    const seats = (c.seats ?? []).map(s => (s.seatId === vacate ? { ...s, occupied: false } : s));
    const rootOccupied = !!seats.find(s => s.isRoot)?.occupied;
    const fixed = c.kind === 'gun' || (!c.isRoot && !rootOccupied);
    return this._fireStrengthOf({
      table: c.strengths ?? {}, others: seats.filter(s => s.seatId !== c.seatId),
      air: c.kind === 'air', isSeat: !c.isRoot, myType: c.strType ?? 'LightArmour',
      fixed, aimable: fixed ? this._fixedAimable(c) : true,
    });
  }

  /** The other seats of the hull the bot sits in, for the share. */
  _otherSeats(mine) {
    return (mine?.seats ?? this.vehicle?.seats ?? []).filter(s => s.seatId !== this.vehicle?.seatId);
  }

  /** A fixed weapon's `validateCameraDirection` (`calculateFireStrength`
   *  0x08584580): with enemies spotted, 'enemy' when the traverse reaches
   *  one of them, else false (the score is 0); with none spotted, 'enemy'
   *  when any enemy object is within the guns' range (`getEnemyObjects`;
   *  that branch tests no direction before the normal score), else
   *  'strategic' when the gun can face the strategic direction (a flat
   *  5.0), else false. The strategic direction is the engine's strategic
   *  object's links flagged for the side; here the nearest enemy flag's
   *  bearing stands in for them (INVENTION). `c` is a candidate seat
   *  (its own traverse limits on its hull's heading); none means the seat
   *  the bot holds. */
  _fixedAimable(c = null) {
    const limits = c ? c.yawLimits : this.vehicle?.occupancy?.turret?.yawLimitsRadians?.();
    const hullYaw = c ? (c.hullYaw ?? 0) : this.yaw;
    const canPoint = (dir) => {
      if (!limits) return true;
      const want = wrapAngle(Math.atan2(dir[0], dir[2]) - hullYaw);
      return want >= limits[0] && want <= limits[1];
    };
    const from = c?.pos ?? this.position;
    const dirTo = (pos) => {
      const dx = pos[0] - from[0], dz = pos[2] - from[2];
      const d = Math.hypot(dx, dz) || 1;
      return [dx / d, 0, dz / d];
    };
    const spotted = this.senses.spottedEnemies();
    if (spotted.length) return spotted.some(m => canPoint(dirTo(m.pos))) ? 'enemy' : false;
    let range = 0;
    for (const w of (c ? c.weapons : this.weapons) ?? []) range = Math.max(range, w.maxRange ?? 0);
    for (const [id, p] of this.world?.players ?? []) {
      if (id === this.playerId || p.team === this.team || this.world.armorOf?.(id)?.destroyed) continue;
      const pos = playerPosition(p);
      if (!pos) continue;
      if (Math.hypot(pos[0] - from[0], pos[2] - from[2]) <= range) return 'enemy';
    }
    const flag = this._nearestEnemyFlag();
    return flag?.position && canPoint(dirTo(flag.position)) ? 'strategic' : false;
  }

  /**
   * `BBChangeTeleport::calculateUrgency`: the root's and the other seats'
   * urgencies by where the bot sits, the winner other than its own seat.
   */
  _urgencyChangeTeleport({ mine, selfU, split, driver, health }) {
    const m = this.vehicle;
    const seats = mine?.seats ?? m.seats ?? [];
    if (!seats.length) return null;
    const cands = this.vehicleCandidates ?? [];
    const rootCand = cands.find(c => c.vehicleId === m.vehicleId && c.isRoot) ?? null;
    const rootOccupied = !!(rootCand?.occupiedBy) && rootCand.occupiedBy !== this.playerId;
    let where = 'root';
    if (!m.drives && !mine?.isRoot) {
      where = rootOccupied ? 'seatUnderDriver' : (m.kind === 'air' ? 'seatAir' : m.kind === 'ship' ? 'seatShip' : 'seatLand');
    }
    const uOf = (c) => unitUrgency({ health, fire: this._candidateFire(c), maxSpeed: c.maxSpeed ?? 0,
                                     occupiedByBot: !c.drives && !!driver, value: c.value ?? 0, orderSplit: split });
    const rootU = rootCand && !rootOccupied && where !== 'root' ? uOf(rootCand) : 0;
    const others = [];
    for (const c of cands) {
      if (c.vehicleId !== m.vehicleId || c.seatId === m.seatId || c.isRoot || c.occupiedBy) continue;
      others.push({ id: c.id, u: uOf(c), cand: c });
    }
    const orderFactor = this.waypoints ? 1 : this.botSkill;
    const r = teleportChangeUrgency({ where, rootU, selfU, seats: others, orderFactor, attackSplit: split[0],
                                      hasPlan: this._hasPlan(), pending: !!this.enterRequest });
    if (!r.best) return null;
    const cand = r.best.id === 'root' ? rootCand : others.find(o => o.id === r.best.id)?.cand;
    if (!cand) return null;
    return { urgency: r.urgency, best: { id: cand.id, u: r.best.u, dist: 0, cand }, bail: false, teleport: true };
  }

  /**
   * `BBPChange::createPlan`: walk to the unit's door (12.5 m -> 6.25 m by
   * the finding move, the door's own radius here), then the Use trigger
   * until the seat is taken (`EnterVehicle` asks the page to seat the bot).
   */
  _planChange(now) {
    const r = this._changeResult;
    if (this.vehicle) {
      if (!r?.best) return this._planIdle();
      if (r.teleport) {
        // `BBPChangeTeleport::createPlan`: the seat-select key.
        const plan = [{ type: PLAN_ACTION.SwitchSeat, vehicleId: r.best.cand.vehicleId, seatId: r.best.cand.seatId }];
        plan.vehicleId = r.best.id;
        plan.startedAt = now;
        return plan;
      }
      // Seated: leave (a bail, or the walk to a better seat starts on foot).
      const plan = [{ type: PLAN_ACTION.ExitVehicle }];
      plan.vehicleId = r.best.id;
      plan.startedAt = now;
      return plan;
    }
    const best = r?.best?.cand;
    if (!best) return this._planIdle();
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.Change && cur.length && cur.vehicleId === best.id && !best.occupiedBy) return cur;
    const entry = best.entry ?? [best.pos[0], best.pos[2]];
    const radius = Math.max(best.entryRadius ?? 4, 2.0);
    const plan = [
      { type: PLAN_ACTION.SoldierPose, pose: 'stand' },
      { type: PLAN_ACTION.InfantryMoveTo, waypoint: [entry[0], this.position[1], entry[1]], arrive: radius },
      { type: PLAN_ACTION.EnterVehicle, vehicleId: best.id, seatId: best.seatId ?? null, entry, radius, afterMove: true },
    ];
    plan.vehicleId = best.id;
    plan.startedAt = now;
    return plan;
  }

  /** `ExitVehicle`: ask the page to unseat the bot (the Use key held). */
  _execExitVehicle() {
    if (!this.vehicle) return true;
    this.exitRequest = true;
    return false;
  }

  /** `SwitchSeat` (`BAPICChangeVehicle` + the select key): the page reseats. */
  _execSwitchSeat(action) {
    if (!this.vehicle) return true;
    if (this.vehicle.seatId === action.seatId) return true;
    this.switchRequest = { vehicleId: action.vehicleId, seatId: action.seatId };
    return false;
  }

  /** `EnterVehicle`: inside the door's radius, ask the page for the seat. */
  _execEnterVehicle(action) {
    if (this.vehicle) return true;
    const d = Math.hypot(action.entry[0] - this.position[0], action.entry[1] - this.position[2]);
    if (d > action.radius + 0.5) return false;
    this.enterRequest = { vehicleId: action.vehicleId, seatId: action.seatId };
    return false;
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
      case BEHAVIOUR.Special: return this._planSpecial(now);
      case BEHAVIOUR.Change: return this._planChange(now);
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
    if (this.vehicle?.kind === 'air' && this.vehicle.drives) {
      // `BBPIdle3d::createPlan`: flying (or rolling faster than 0.1 m/s) the
      // plane holds a `MoveTo3d` to where it is under `ConFalse` — an orbit
      // of that point; on the ground and still it only resets the controls.
      const st = this.vehicle.drive?.state;
      const speed = st ? Math.hypot(st.velocity.x, st.velocity.y, st.velocity.z) : 0;
      if (st && (speed > PLANE_FIRE.idleSpeed || !this.vehicle.drive?.grounded)) {
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
  _planMoveTo(now) {
    const wp = this.waypoints ?? this._fallbackWaypoint();
    if (!wp) return this._planIdle();
    // An air order's point carries its height (`orderAirBot`: ground + 75).
    const goal = [wp.point[0], Number.isFinite(wp.y) ? wp.y : this.position[1], wp.point[1]];
    const cur = this.currentPlan;
    if (this.planBehaviour === BEHAVIOUR.MoveTo && cur.length && cur[0].waypointObject === wp) return cur;
    return [{ type: PLAN_ACTION.InfantryMoveTo, waypoint: goal, arrive: wp.radius, waypointObject: wp,
              stance: 'stand' }];
  }

  /** `BBPFireInfantery::createPlan` through `firePlanFor`. */
  _planFire(now) {
    if (!this.firingTarget || !this.targetPosition) return this._planIdle();
    if (this.vehicle?.kind === 'air' && this.vehicle.drives) {
      // `BBPFire3d::createPlan`: the target's mode and aim radius, then the
      // loop `createPlanInternal` builds (`attackRunStep`).
      const cur = this.currentPlan;
      if (this.planBehaviour === BEHAVIOUR.Fire && cur.length && cur.targetId === this.firingTarget
          && !this._firePlanDone(cur, now)) return cur;
      const info = this._unitInfo(this.firingTarget);
      const fm = planeFireMode({ extents: info.extents ?? [0.6, 1.8, 0.6], vehicle: !!info.seats?.length || !!info.vehicle,
                                 large: info.large === true, mobile: info.mobile !== false });
      const weapon = this.weapons[this.weaponIndex] ?? this.weapons[0];
      this._attackState = { phase: 'approach', breakFrom: null };
      const plan = [{ type: PLAN_ACTION.PlaneAttack, targetId: this.firingTarget, targetPos: [...this.targetPosition],
                      mode: fm.mode, radius: fm.radius, maxRange: weapon?.maxRange ?? 300, persistent: true,
                      heatLimit: fm.mode === 0 ? PLANE_FIRE.weaponHeatSmall : PLANE_FIRE.weaponHeatVehicle }];
      plan.targetId = this.firingTarget; plan.startedAt = now; this._shotsThisPlan = 0;
      return plan;
    }
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
    const attack = plan.find(a => a.type === PLAN_ACTION.PlaneAttack);
    if (attack) {
      // The loop's conditions: the target exists with health, the magazine
      // is not dry, and the plane is within the battle zone.
      if (this.world?.armorOf?.(plan.targetId)?.destroyed) return true;
      if (!this.world?.players?.get(plan.targetId)) return true;
      if (this.magazineEmpty) return true;
      return false;
    }
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
      case PLAN_ACTION.EnterVehicle:
        return this._execEnterVehicle(action);
      case PLAN_ACTION.ExitVehicle:
        return this._execExitVehicle();
      case PLAN_ACTION.SwitchSeat:
        return this._execSwitchSeat(action);
      case PLAN_ACTION.PlaneAttack:
        return this._execPlaneAttack(action, now);
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

  /**
   * `PlaneMoveTo` (`EntryPlaneMoveTo::execute` -> `PlaneControl::towardsPoint`):
   * the point at cruise height, arrival at `4 * radius`.
   */
  _execPlaneMoveTo(target, action, clearance = PLANE.cruiseClearance) {
    const m = this.vehicle;
    const st = m.drive?.state;
    if (!st) return true;
    const collider = this.world?.collider;
    const position = [st.position.x, st.position.y, st.position.z];
    const tgy = collider?.surfaceHeight?.(target[0], target[2]);
    const w = st.angularVelocity;
    const r = towardsPoint({
      orientation: st.orientation, position, velocity: [st.velocity.x, st.velocity.y, st.velocity.z],
      angularVelocity: w ? [w.x, w.y, w.z] : [0, 0, 0],
      target: [target[0], target[1] ?? (Number.isFinite(tgy) ? tgy : st.position.y), target[2]],
      clearance, groundAt: (x, z) => this._groundAt(x, z),
      altitudeAlong: (off) => this._altitudeAlong(position, off), altitude: this._altitudeAlong(position, [0, 0, 0]),
      airborne: !!this._airborne, maxSpeed: m.maxSpeed ?? 100, radius: m.radius ?? 10,
    });
    this._airborne = r.airborne;
    const cur = m.drive?.input?.('c_PIThrottle') ?? 1;
    r.power = r.throttle > cur + 0.01 ? 1 : (r.throttle < cur - 0.01 ? -1 : 0);
    this._airInput = r;
    this._dbgSteer = [target[0], target[2]];
    if (action?.orbit) return false;                        // `ConFalse`: the idle's orbit never ends
    return r.arrived && !r.takeoff;
  }

  /**
   * `PlaneAttack`: `BBPFire3d`'s loop. Approach with `MoveTo3dObject` (the
   * target's live position, 50 m clearance), aim and fire through
   * `aimAtDirection` inside 0.9 / 0.8 of the guns' range, break 200 m along
   * the heading after a pass, and turn back toward the ordered area when
   * more than 200 m outside it.
   */
  _execPlaneAttack(action, now) {
    const m = this.vehicle;
    const st = m.drive?.state;
    if (!st) return true;
    const p = this.world?.players?.get(action.targetId);
    const pos = playerPosition(p) ?? action.targetPos;
    if (!pos) return true;
    const position = [st.position.x, st.position.y, st.position.z];
    const velocity = [st.velocity.x, st.velocity.y, st.velocity.z];
    const collider = this.world?.collider;
    const gy = collider?.surfaceHeight?.(position[0], position[2]);
    const tv = p?.vehicle?.state?.velocity ?? p?.soldier?.body?.body?.velocity;
    const targetVel = tv ? [tv.x, tv.y, tv.z] : [0, 0, 0];
    const eye = this._aimOrigin();
    // `BAPConObjectLineOfFire` 0x08551890: the memory record of the target
    // is not lost (its +0x14 byte), i.e. the senses see it now. No ray here.
    const lineOfFire = this.senses.memory.get(action.targetId)?.seen === true;
    const gun = this._gunBallistics();
    const state = this._attackState ?? (this._attackState = { phase: 'approach', breakFrom: null });
    const forward = this._unitForward3();
    const step = attackRunStep(state, {
      position, forward, velocity, target: [pos[0], pos[1] + 1.0, pos[2]], targetVel,
      maxRange: action.maxRange, turnRadius: m.turnRadius ?? 25, lineOfFire, mode: action.mode,
      precision: action.radius, muzzle: eye, aimDir: this.aimRay().dir, roundSpeed: gun.speed, gravity: gun.gravity,
    });
    this._attackPhase = step.phase;
    this._attackDbg = { phase: step.phase, dist: Math.round(step.dist), cosFront: +(forward[0] * step.dir[0] + forward[1] * step.dir[1] + forward[2] * step.dir[2]).toFixed(3),
                        inFront: step.inFront, los: lineOfFire, miss: +step.miss.toFixed(2), precision: action.radius, fire: step.fire,
                        agl: Number.isFinite(gy) ? Math.round(position[1] - gy) : null };
    // `If(InsideBattleZone(200), ..., MoveTo3d(map centre, 200 m))`: the
    // battle zone is the world map less a margin (0x0854e670), not the
    // ordered area; near an edge the plane heads for the map's centre.
    const mapSize = this._worldMapSize();
    if (!insideBattleZone(position[0], position[2], PLANE_FIRE.battleZoneReturn, mapSize)) {
      this._execPlaneMoveTo([mapSize[0] / 2, PLANE_FIRE.battleZoneHeight, -mapSize[1] / 2], null, PLANE_FIRE.battleZoneHeight);
      this.isFiring = false;
      return false;
    }
    if (step.phase === 'attack') {
      // `EntryPlaneAimAt` 0x0861f610: the Aimer's firing direction (the lead
      // in the relative velocity, the drop taken out), flown through
      // `aimAtDirection` 0x08629cf0 -> `towardsDirection` 0x08629fa0.
      const rel = [pos[0] - eye[0], pos[1] + 1.0 - eye[1], pos[2] - eye[2]];
      const relVel = [targetVel[0] - velocity[0], targetVel[1] - velocity[1], targetVel[2] - velocity[2]];
      const { aim } = roundMiss({ rel, relVel, speed: gun.speed, gravity: gun.gravity });
      const w = st.angularVelocity;
        const r = aimAtDirection({
        orientation: st.orientation, velocity, angularVelocity: w ? [w.x, w.y, w.z] : [0, 0, 0], dir: aim,
        altitudeAlong: (off) => this._altitudeAlong(position, off), altitude: this._altitudeAlong(position, [0, 0, 0]),
        clearance: action.mode === 1 ? PLANE_FIRE.aimClearanceVehicle : PLANE_FIRE.aimClearance,
        airborne: !!this._airborne, throttleFloor: 1, maxSpeed: m.maxSpeed ?? 100,
      });
      this._airborne = r.airborne;
      const cur = m.drive?.input?.('c_PIThrottle') ?? 1;
      r.power = r.throttle > cur + 0.01 ? 1 : (r.throttle < cur - 0.01 ? -1 : 0);
      this._airInput = r;
      this._dbgSteer = [pos[0], pos[2]];
      this.isFiring = step.fire;
      if (step.fire) this.firingTargetTime = Math.min(this.firingTargetTime, now);
      return false;
    }
    this.isFiring = false;
    if (step.phase === 'break') {
      // `MoveTo3dDirection`: 200 m along the heading, level.
      const f = this._unitForward3();
      const ahead = [position[0] + f[0] * PLANE_FIRE.breakDistance, position[1] + Math.max(0, f[1]) * PLANE_FIRE.breakDistance,
                     position[2] + f[2] * PLANE_FIRE.breakDistance];
      this._execPlaneMoveTo(ahead, null, PLANE_FIRE.clearance);   // the MoveTo3dDirection's clearance: INVENTION
      return false;
    }
    // `MoveTo3dObject(target, radius, maxSpeed, 0.5 maxSpeed, 50 m)`: the
    // target's own position with a 50 m clearance (+0x44), which
    // `towardsPoint` turns into the lift near it and the pull-up probe.
    this._execPlaneMoveTo([pos[0], pos[1], pos[2]], null, PLANE_FIRE.clearance);
    return false;
  }

  /** `InformationReal::getAltitude(Vec3)` 0x085e8950: the least height over
   *  the ground (and water) at the position and at 0.2 .. 0.9 of `offset`
   *  along it (the loop's last sample is computed but not returned). */
  _altitudeAlong(position, offset) {
    let best = Infinity;
    for (const t of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const floor = this._groundAt(position[0] + offset[0] * t, position[2] + offset[2] * t);
      if (Number.isFinite(floor)) best = Math.min(best, position[1] + offset[1] * t - floor);
    }
    return best;
  }

  /** The higher of the terrain and the water at (x, z) (`IAIEnvironment`
   *  +0xb4 / +0x9c, the pair `towardsPoint` takes the max of). */
  _groundAt(x, z) {
    const col = this.world?.collider;
    const water = col?.waterLevel ?? this.world?.extras?.waterLevel;
    const g = col?.surfaceHeight?.(x, z);
    return Math.max(Number.isFinite(g) ? g : -Infinity, Number.isFinite(water) ? water : -Infinity);
  }

  /** `AISettings::getWorldMapSizeX / Z` (the level's `worldMapSize`). */
  _worldMapSize() {
    const ex = this.world?.extras;
    const s = ex?.ai?.settings?.worldMapSize;
    return Array.isArray(s) && s.length >= 2 ? s : [ex?.worldSize ?? 2048, ex?.worldSize ?? 2048];
  }

  /** The mounted gun's muzzle speed and gravity (`Aimer` +0xc / +0x8), from
   *  the first gun group's projectile; 600 m/s and none until it loads. */
  _gunBallistics() {
    const g = this.vehicle?.groups?.[0] ?? this.vehicle?.manned?.[0] ?? null;
    const st = g?.stats ?? {};
    const speed = st.velocity ?? st.projectile?.velocity ?? this.weaponData?.[this.weaponAi?.name]?.velocity ?? 600;
    // `gravityModifier` as the extractor names it (`projectile.gravity`); a
    // tracer round's is 0, a shell's defaults to 1 (gunfire.js).
    const gm = Number.isFinite(st.projectile?.gravity) ? st.projectile.gravity : (st.projectile?.kind === 'shell' ? 1 : 0);
    return { speed, gravity: -9.81 * gm };
  }

  _execBoatMoveTo(target, action) { return routing.execBoatMoveTo(this, target, action); }

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
    const aim = faceTarget(this._aimOrigin(), [pos[0], pos[1] + 1.0, pos[2]]);
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
    const s = this.vehicle?.kind === 'air' ? this._noseReference() : this._aimReference();
    const want = faceTarget(this._aimOrigin(), [pos[0], pos[1] + 1.0, pos[2]]);
    const dy = wrapAngle(want.yaw - (s?.yaw ?? this.yaw));
    const dp = s && s.pitch === null ? 0 : want.pitch - (s?.pitch ?? this.pitch);
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
    if (this.vehicle) return true;
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

  aimRay() { return aiming.aimRay(this); }

  /** The page's respawn hook: forget everything the old body knew. */
  onRespawn() {
    this.senses = new BotSenses({ viewDistance: this.viewDistance, random: this.random });
    this.memory = this.senses.memory;
    this.firingTarget = null; this.targetPosition = null; this.targetScore = 0;
    this.currentPlan = []; this.currentBehaviour = null; this.planBehaviour = null;
    this.route = null; this.obstacles = []; this._stalledTicks = 0;
    this.scout = new ScoutState();
    this.cover = new TakeCoverState();
    this.medic = new MedicState();
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
