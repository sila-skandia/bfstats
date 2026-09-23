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
// The decision loop is described in bot-decision.js.
//
// INVENTION, labelled: `Change` (vehicles) and `Special` (medic) are not
// registered — the viewer's bots are on foot with no healing kit yet; the
// Avoid behaviour against moving bodies is the touching rule of a soldier's
// zero `avoidCollisionLookAhead`; a level with no strategic data sends a bot
// at the nearest enemy flag.

import { DeviationModel } from './deviation.js';
import { BotSenses } from './bot-sense.js';
import { weaponAiOf, FIRE } from './bot-fire.js';
import { ScoutState, TakeCoverState, QUADRANTS, MedicState } from './bot-behaviours.js';
import { REGISTERED, ACTIVE_URGENCY_INIT } from './bot-decision.js';
import { BOT_RADIUS, VEHICLE_RADIUS } from './bot-route.js';
import * as aiming from './bot-aim.js';
import * as perception from './bot-perception.js';
import * as routing from './bot-route.js';
import * as deciding from './bot-decision.js';
import * as planning from './bot-plans.js';
import * as mounting from './bot-mount.js';
import * as piloting from './bot-pilot.js';

export { PI } from './bot-aim.js';
export { BEHAVIOUR, STANDARD_WEIGHTS, URGENCY_CURVE, IDLE_FLOOR } from './bot-decision.js';
export { PLAN_ACTION } from './bot-plans.js';

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

  /** The map and body radius of the unit the bot moves as. */
  _nav() { return this.vehicle ? (this.vehicle.nav ?? null) : this.navGrid; }
  _radius() { return this.vehicle ? (this.vehicle.radius ?? VEHICLE_RADIUS) : BOT_RADIUS; }

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

    // The throttle channel as the engine keeps it for a boat's helm
    // (bot-plans.js `steerBoat`): what this tick wrote.
    this._heldThrottle = this.vehicle?.kind === 'ship' && this.vehicle.drives ? this.moveForward : 0;
    this._writeInput();
    this.timeSinceTargetAcquired = this.firingTarget ? this.timeSinceTargetAcquired + dt : 0;
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

  // -----------------------------------------------------------------------
  // Senses, memory and target choice: bot-perception.js
  // -----------------------------------------------------------------------

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
  _myType() { return perception.myType(this); }
  _chooseVehicleTarget(now) { return perception.chooseVehicleTarget(this, now); }
  _unitInfo(id) { return perception.unitInfo(this, id); }

  // -----------------------------------------------------------------------
  // The decision loop and the urgency generators: bot-decision.js
  // -----------------------------------------------------------------------

  _registered() { return deciding.registered(this); }
  _updateObjectiveReadout(dt) { return deciding.updateObjectiveReadout(this, dt); }
  _currentMod(name) { return deciding.currentMod(this, name); }
  _hasPlan() { return deciding.hasPlan(this); }
  _decisionMaking(now, dt) { return deciding.decisionMaking(this, now, dt); }
  _quotientChanged(name) { return deciding.quotientChanged(this, name); }
  _generate(name, mod, now, dt, planned) { return deciding.generate(this, name, mod, now, dt, planned); }
  _urgencyMoveTo(mod) { return deciding.urgencyMoveTo(this, mod); }
  _pathRadius() { return deciding.pathRadius(this); }
  _fallbackWaypoint() { return deciding.fallbackWaypoint(this); }
  _nearestEnemyFlag() { return deciding.nearestEnemyFlag(this); }
  _distTo(point) { return deciding.distTo(this, point); }
  _urgencyFire(mod, now) { return deciding.urgencyFire(this, mod, now); }
  _urgencyScout(mod, now, dt) { return deciding.urgencyScout(this, mod, now, dt); }
  _urgencyTakeCover(mod, now) { return deciding.urgencyTakeCover(this, mod, now); }
  _coverCandidates() { return deciding.coverCandidates(this); }
  _urgencySpecial(mod, now) { return deciding.urgencySpecial(this, mod, now); }
  _urgencyAvoid(mod, now) { return deciding.urgencyAvoid(this, mod, now); }

  // -----------------------------------------------------------------------
  // Plan generators and the plan interpreter: bot-plans.js
  // -----------------------------------------------------------------------

  _planSpecial(now) { return planning.planSpecial(this, now); }
  _healPlanDone(plan, now) { return planning.healPlanDone(this, plan, now); }
  _generatePlan(behaviour, now) { return planning.generatePlan(this, behaviour, now); }
  _planIdle() { return planning.planIdle(this); }
  _planMoveTo(now) { return planning.planMoveTo(this, now); }
  _planFire(now) { return planning.planFire(this, now); }
  _firePlanDone(plan, now) { return planning.firePlanDone(this, plan, now); }
  _planScout(now) { return planning.planScout(this, now); }
  _planTakeCover(now) { return planning.planTakeCover(this, now); }
  _planAvoid(now) { return planning.planAvoid(this, now); }
  _runPlan(dt, now) { return planning.runPlan(this, dt, now); }
  _executeAction(action, dt, now) { return planning.executeAction(this, action, dt, now); }
  _execInfantryMoveToObject(action, dt) { return planning.execInfantryMoveToObject(this, action, dt); }
  _execInfantryMoveToDirection(action, dt, now) { return planning.execInfantryMoveToDirection(this, action, dt, now); }
  _execMouseTurretAimAt(action) { return planning.execMouseTurretAimAt(this, action); }
  _execMouseTurretLookAt(action) { return planning.execMouseTurretLookAt(this, action); }
  _execTrigger(action, now) { return planning.execTrigger(this, action, now); }
  _execInfantryResetControls() { return planning.execInfantryResetControls(this); }
  _execSense(action) { return planning.execSense(this, action); }
  _execSoldierPose(action) { return planning.execSoldierPose(this, action); }

  // -----------------------------------------------------------------------
  // The path follower, steering and the move executors: bot-route.js
  // -----------------------------------------------------------------------

  _ageObstacles(dt) { return routing.ageObstacles(this, dt); }
  _trackContact(soldier) { return routing.trackContact(this, soldier); }
  _ensureRoute(goal) { return routing.ensureRoute(this, goal); }
  _extendRoute() { return routing.extendRoute(this); }
  _lookAhead() { return routing.lookAhead(this); }
  _popPassed() { return routing.popPassed(this); }
  _trackObstruction(speed, dt) { return routing.trackObstruction(this, speed, dt); }
  _onObstructed() { return routing.onObstructed(this); }
  _steerToward(x, z, speed) {
    if (this.vehicle?.kind === 'ship' && this.vehicle.drives) return planning.steerBoat(this, x, z, speed);
    return routing.steerToward(this, x, z, speed);
  }
  _execInfantryMoveTo(action, dt) { return routing.execInfantryMoveTo(this, action, dt); }
  _execBoatMoveTo(target, action) { return routing.execBoatMoveTo(this, target, action); }

  // -----------------------------------------------------------------------
  // Aim, look and the input writer: bot-aim.js
  // -----------------------------------------------------------------------

  _eye() { return aiming.eye(this); }
  _aimOrigin() { return aiming.aimOrigin(this); }
  _vehicleForward() { return aiming.vehicleForward(this); }
  _unitVelocity() { return aiming.unitVelocity(this); }
  _unitForward3() { return aiming.unitForward3(this); }
  _turretCanPoint(dir) { return aiming.turretCanPoint(this, dir); }
  _resetInput() { return aiming.resetInput(this); }
  _writeInput() { aiming.writeInput(this); planning.writeHeldChannels(this); }
  _cameraBasis(lookYaw) { return aiming.cameraBasis(this, lookYaw); }
  _noseReference() { return aiming.noseReference(this); }
  _aimReference() { return aiming.aimReference(this); }
  _aimLook(desiredYaw, desiredPitch, maxCounts) { return aiming.aimLook(this, desiredYaw, desiredPitch, maxCounts); }
  _turretInputSigns() { return aiming.turretInputSigns(this); }
  aimRay() { return aiming.aimRay(this); }

  // -----------------------------------------------------------------------
  // Seats and the Change behaviour: bot-mount.js
  // -----------------------------------------------------------------------

  mount(m, now) { return mounting.mount(this, m, now); }
  dismount(now) { return mounting.dismount(this, now); }
  _urgencyChange(mod, now) { return mounting.urgencyChange(this, mod, now); }
  _seatStrengths() { return mounting.seatStrengths(this); }
  _fireStrengthOf(o) { return mounting.fireStrengthOf(this, o); }
  _candidateFire(c) { return mounting.candidateFire(this, c); }
  _otherSeats(mine) { return mounting.otherSeats(this, mine); }
  _fixedAimable(c) { return mounting.fixedAimable(this, c); }
  _urgencyChangeTeleport(o) { return mounting.urgencyChangeTeleport(this, o); }
  _planChange(now) { return mounting.planChange(this, now); }
  _execExitVehicle() { return mounting.execExitVehicle(this); }
  _execSwitchSeat(action) { return mounting.execSwitchSeat(this, action); }
  _execEnterVehicle(action) { return mounting.execEnterVehicle(this, action); }

  // -----------------------------------------------------------------------
  // Aircraft executors: bot-pilot.js
  // -----------------------------------------------------------------------

  _execPlaneMoveTo(target, action, clearance) { return piloting.execPlaneMoveTo(this, target, action, clearance); }
  _execPlaneAttack(action, now) { return piloting.execPlaneAttack(this, action, now); }
  _altitudeAlong(position, offset) { return piloting.altitudeAlong(this, position, offset); }
  _groundAt(x, z) { return piloting.groundAt(this, x, z); }
  _worldMapSize() { return piloting.worldMapSize(this); }
  _gunBallistics() { return piloting.gunBallistics(this); }
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
