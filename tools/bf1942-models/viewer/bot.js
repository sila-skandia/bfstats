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
import { isWalkable } from './nav-grid.js';
import { BotSenses, playerPosition } from './bot-sense.js';
import { weaponAiOf, FIRE, SOLDIER_BATTLE_STRENGTH } from './bot-fire.js';
import { ScoutState, TakeCoverState, QUADRANTS, MedicState } from './bot-behaviours.js';
import { unitUrgency, orderSplit, changeUrgency, teleportChangeUrgency, TANK, CHANGE, TELEPORT } from './bot-vehicle.js';
import { decleiningSlope } from './bot-behaviours.js';
import { BOAT } from './bot-vehicle-air.js';
import { fireStrength, unitTable, STRENGTH } from './bot-strength.js';
import * as aiming from './bot-aim.js';
import { wrapAngle } from './bot-aim.js';
import * as perception from './bot-perception.js';
import * as routing from './bot-route.js';
import * as piloting from './bot-pilot.js';
import * as deciding from './bot-decision.js';
import { BEHAVIOUR, REGISTERED, ACTIVE_URGENCY_INIT } from './bot-decision.js';
import * as planning from './bot-plans.js';
import { PLAN_ACTION } from './bot-plans.js';
import { BOT_RADIUS, VEHICLE_RADIUS } from './bot-route.js';

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

  _eye() { return aiming.eye(this); }
  _aimOrigin() { return aiming.aimOrigin(this); }

  _registered() { return deciding.registered(this); }

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

  _updateObjectiveReadout(dt) { return deciding.updateObjectiveReadout(this, dt); }

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

  _planSpecial(now) { return planning.planSpecial(this, now); }
  _healPlanDone(plan, now) { return planning.healPlanDone(this, plan, now); }

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

  _urgencyAvoid(mod, now) { return deciding.urgencyAvoid(this, mod, now); }

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

  _execPlaneMoveTo(target, action, clearance) { return piloting.execPlaneMoveTo(this, target, action, clearance); }
  _execPlaneAttack(action, now) { return piloting.execPlaneAttack(this, action, now); }
  _altitudeAlong(position, offset) { return piloting.altitudeAlong(this, position, offset); }
  _groundAt(x, z) { return piloting.groundAt(this, x, z); }
  _worldMapSize() { return piloting.worldMapSize(this); }
  _gunBallistics() { return piloting.gunBallistics(this); }

  _execBoatMoveTo(target, action) { return routing.execBoatMoveTo(this, target, action); }

  _execInfantryMoveToDirection(action, dt, now) { return planning.execInfantryMoveToDirection(this, action, dt, now); }
  _execMouseTurretAimAt(action) { return planning.execMouseTurretAimAt(this, action); }
  _execMouseTurretLookAt(action) { return planning.execMouseTurretLookAt(this, action); }
  _execTrigger(action, now) { return planning.execTrigger(this, action, now); }
  _execInfantryResetControls() { return planning.execInfantryResetControls(this); }
  _execSense(action) { return planning.execSense(this, action); }
  _execSoldierPose(action) { return planning.execSoldierPose(this, action); }

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
