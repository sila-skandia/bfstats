// A bot that senses enemies through the engine's actual sensing pipeline
// (vision frustum + LOS + hearing), runs the engine's scalar urgency contest,
// executes the 13-instruction infantry plan set, and writes one PlayerInput per
// tick into the world's own input socket.
//
// Research: features/bf1942-ai-research-2026-09-21/ai-22-sensing-decoded.md
//           features/bf1942-ai-research-2026-09-21/README.md §1.2-1.3, §4.1-4.2
//           features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md
// Plan:     features/bf1942-ai-research-2026-09-21/BOT_AI_IMPLEMENTATION_PLAN.md
//
// A bot is an ordinary player whose `PlayerInput` the engine writes for it
// (AI-1). `World.setInput(id, input, look)` is the exact socket a bot plugs
// into: `input` is the named action word shaped by `shapeInput` (world.js), and
// `look` is the per-tick quantised mouse axis pair (mouse-input.js), NOT
// radians. Writing absolute radians into a `MouseLookX` channel did nothing —
// that was the bug that left every bot standing still.
//
// INVENTION — where the research is open (AI-22):
// - AIInformationGrid: the viewer has no 32x32 spatial hash; we brute-force the
//   candidate scan instead (the labelled stand-in the plan calls for)
// - Raycasting: the viewer's collider has `surfaceHeight` but no rayCast; we
//   use a height-based LOS approximation when the collider is present
// - Hearing: sounds are tracked through an external `hearSound`/`recordNearbyShot`
//   path rather than the engine's AIObjectMobile armament path
// - Navigation: the nav grid is generated client-side from the collider, not
//   the server's `Pathfinding/*.raw` search maps
// - Kit selection: Stage 1 uses one weapon template for every bot until
//   `BotSpawner::findKitDiff` weights are wired (README §2.3)
// - Vision frustum parameters (FOV, aspect, near, far) are faithful to the
//   binary analysis

import { DeviationModel } from './deviation.js';
import { findPath } from './nav-grid.js';

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

/** Bot name pools, from the research document §2.1.
 *  `Bf1942/Game/common/{American,British,German,Japanese,Russian}Names.con`
 *  in `Game.rfa`. These are the shipped defaults; a full extraction would
 *  read the actual .con files. */
export const BOT_NAMES = {
  American: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor'],
  British: ['Arthur', 'Bernard', 'Charles', 'David', 'Edward', 'Frank', 'George', 'Henry', 'James', 'Kenneth'],
  German: ['Fritz', 'Hans', 'Karl', 'Otto', 'Werner', 'Dieter', 'Heinz', 'Klaus', 'Manfred', 'Wolfgang'],
  Japanese: ['Tanaka', 'Suzuki', 'Sato', 'Takahashi', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato'],
  Russian: ['Ivan', 'Boris', 'Dmitri', 'Nikolai', 'Sergei', 'Viktor', 'Alexei', 'Mikhail', 'Pavel', 'Yuri'],
};

/** Default bot names when no team-specific pool is available. */
const FALLBACK_NAMES = [
  'Bot_Alpha', 'Bot_Bravo', 'Bot_Charlie', 'Bot_Delta', 'Bot_Echo',
  'Bot_Foxtrot', 'Bot_Golf', 'Bot_Hotel', 'Bot_India', 'Bot_Juliet',
];

/** The engine's default botSkill (§6.1): 0.75, which is HARD. */
const DEFAULT_BOT_SKILL = 0.75;

/** Default view distance in metres (§6.1): 600.0. */
const DEFAULT_VIEW_DISTANCE = 600;

/**
 * Vision frustum parameters from binary analysis (ai-22-sensing-decoded.md §2.2).
 * Infantry: ~53° vertical FOV, square aspect 1.0, near 0.8m, far = viewDist.
 * Mobile (vehicle): ~113° vertical FOV.
 */
const FRUSTUM = {
  infantry: { fovDeg: 53.1, aspect: 1.0, near: 0.8 },
  mobile:   { fovDeg: 112.6, aspect: 1.0, near: 0.8 },
};

/** Sound sphere radius for soldiers (Objects.con): 15m outer. */
const SOLDIER_SOUND_RADIUS = 15;

/** Hearing decay: awareness fades after this many seconds. */
const HEARING_DECAY = 5;

/** Under-fire detection: enemy shot within this radius and time window. */
const UNDER_FIRE_RADIUS = 20;
const UNDER_FIRE_WINDOW = 1.5;

/** How close to a waypoint before advancing to the next one. */
const WAYPOINT_REACH_RADIUS = 3.0;

/** Where a squad holds a flag: a ring inside the capture radius, not the pole.
 *  `_objectiveStation` places each bot on it; arriving there parks the MoveTo
 *  behaviour so the squad settles instead of pushing at the mast. */
const STATION_HOLD_RADIUS = 2.5;
const STATION_MAX_RADIUS = 4.0;
const CAPTURE_RADIUS_FALLBACK = 8.0;

/** Obstacle avoidance: how far ahead the bot looks, and the fan it tries. */
const AVOID_PROBE_DIST = 2.0;
const AVOID_LOOKAHEAD = 6.0;
/** The two heights a static has to clear: a sandbag is waist-high, a wall full. */
const AVOID_PROBE_HEIGHTS = [0.45, 1.1];
/** Movement under this many metres in a tick counts as no progress. */
const STUCK_EPSILON = 0.03;
/** How long with no progress before the bot forces a way out (s). */
const UNSTICK_AFTER = 0.9;
/** How long with no *net* progress toward the goal before the page redeploys
 *  the bot to another spawn point (s). A bot circling a pocket keeps moving,
 *  so the per-tick stuck test never fires; this measures closing distance. */
const NO_PROGRESS_RESPAWN = 4.0;
/** Back out of the wedge first (reverse is usually the way you came in), then
 *  take a side step; two phases, the reverse one first. */
const UNSTICK_BACK_TIME = 0.7;
const UNSTICK_SIDE_TIME = 1.0;
/** How long a bot commits to one side of an obstacle before re-deciding (s). */
const AVOID_HOLD = 0.7;

/** Crosshair tolerance for firing (radians). */
const CROSSHAIR_TOLERANCE = 0.3;

/** Memory of a target survives this long after it was last seen (s). */
const MEMORY_DURATION = 10;

/** How long with no target before Scout becomes urgent (s). */
const SCOUT_IDLE_DELAY = 2.0;

/** Mouse axis conversion (mouse-input.js `soldierLookDegrees`). */
const YAW_GAIN = 3.0;
const PITCH_GAIN = 1.0;
const AXIS_MAX = 16;
const RAD2DEG = 180 / Math.PI;

/** Head/eye offset above the soldier's feet, for LOS and fire origins. */
const EYE_HEIGHT = 1.0;

/**
 * Behaviour names matching AIbehaviours.con §4.1.
 */
export const BEHAVIOUR = {
  Avoid: 'Avoid',
  MoveTo: 'MoveTo',
  Idle: 'Idle',
  Fire: 'Fire',
  Scout: 'Scout',
  TakeCover: 'TakeCover',
  Change: 'Change',
  Special: 'Special',
};

/**
 * Plan action types for infantry (matching §4.2).
 */
export const PLAN_ACTION = {
  InfantryMoveTo: 'InfanteryMoveTo',
  MouseTurretAimAt: 'MouseTurretAimAt',
  Trigger: 'Trigger',
  TriggerContinously: 'TriggerContinously',
  InfantryResetControls: 'InfanteryResetControls',
  MouseTurretLookAt: 'MouseTurretLookAt',
  Sense: 'Sense',
  SoldierPose: 'SoldierPose',
  InfoWrapper: 'InfoWrapper',
  MoveToMediumSoldier: 'MoveToMediumSoldier',
  MoveToObjectMediumSoldier: 'MoveToObjectMediumSoldier',
  InfantryMoveToDirection: 'InfanteryMoveToDirection',
  InfantryMoveToObject: 'InfanteryMoveToObject',
};

/**
 * The engine's urgency curves (§4.1). A curve is a function of distance that
 * scales the behaviour's weight.
 */
export const URGENCY_CURVE = {
  union: () => 1.0,
  // UCFire: linear, -0.22*d + 1.3
  fire: d => Math.max(0, -0.22 * d + 1.3),
  // UCScout: XInverse with k=2.5, offset=0.9, scale=1.0, base=0.5
  scout: d => {
    const [k, o, s, base] = [2.5, 0.9, 1.0, 0.5];
    return base + k / (o + s * d);
  },
};

/**
 * StandardWeights (§4.1): Fire 7.5, TakeCover 2.0, Change 1.9, MoveTo 1.5,
 * Idle 0.1. Scout/Special/Avoid are not named in the standard set and take 1.0.
 */
export const STANDARD_WEIGHTS = {
  Fire: 7.5, TakeCover: 2.0, Change: 1.9, MoveTo: 1.5, Idle: 0.1,
};
const DEFAULT_WEIGHT = 1.0;

/**
 * The engine's own warning (§4.1): "NEVER ALLOW IDLE's urgency to become 0.
 * The AI will CRASH in that case." We floor every urgency, including Idle.
 */
export const IDLE_FLOOR = 1e-3;

/** Wrap an angle to [-π, π]. */
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Squared distance between two 3D points.
 */
function distSq(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Compute yaw and pitch to face a target from a given position.
 * Returns { yaw, pitch } in radians.
 */
function faceTarget(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const yaw = Math.atan2(dx, dz);
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  const pitch = Math.atan2(dy, horizontalDist);
  return { yaw, pitch };
}

/**
 * Check if a target position is within the bot's vision frustum.
 *
 * The engine uses a square frustum (aspect 1.0) with the bot's yaw as the
 * center direction. This checks the angular offset against the half-FOV.
 */
function isInFrustum(botPos, botYaw, targetPos, viewDist, isMobile = false) {
  const params = isMobile ? FRUSTUM.mobile : FRUSTUM.infantry;
  const halfFovRad = (params.fovDeg / 2) * (Math.PI / 180);

  const dx = targetPos[0] - botPos[0];
  const dy = targetPos[1] - botPos[1];
  const dz = targetPos[2] - botPos[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance > viewDist) return false;
  if (distance < params.near) return false;

  const targetYaw = Math.atan2(dx, dz);
  const yawDiff = wrapAngle(targetYaw - botYaw);

  // Square frustum: same FOV horizontally and vertically.
  return Math.abs(yawDiff) <= halfFovRad;
}

/**
 * Simple line-of-sight approximation using the world's collider.
 *
 * INVENTION: the engine's `dice::bf::ai::World::rayCast` is not available in
 * the viewer. When a collider with `surfaceHeight` exists, we approximate LOS
 * by checking that no intermediate point along the line is significantly below
 * the terrain (which would indicate a wall/hill blocking the view). Without a
 * collider, we fall back to distance-only (always returns true).
 */
function checkLOS(collider, from, to, maxSteps = 10) {
  if (!collider || !collider.surfaceHeight) return true;

  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const steps = Math.min(maxSteps, Math.max(1, Math.ceil(distance / 0.8)));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const midX = from[0] + dx * t;
    const midZ = from[2] + dz * t;
    const midY = from[1] + dy * t;

    const surfaceY = collider.surfaceHeight(midX, midZ);
    if (!Number.isFinite(surfaceY)) continue;

    // If the terrain at this point is above the line of sight, it blocks.
    if (surfaceY > midY + 0.5) return false;
  }

  return true;
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
  } = {}) {
    this.playerId = playerId;
    this.world = world;
    this.botSkill = Math.max(0.25, Math.min(1.0, botSkill));
    this.name = name || 'Bot';
    this.position = spawnPos ? [...spawnPos] : [0, 0, 0];
    this.controlInfo = controlInfo;
    this.weaponAi = weaponAi;

    /** The 55-channel PlayerInput, kept for compatibility with callers. */
    this.input = new Float32Array(55);

    /** Deviation model for this bot's weapon. */
    this.deviation = new DeviationModel({ deviation: this._buildDeviationData() });

    /** Whether the bot is currently firing (Trigger is holding). */
    this.isFiring = false;

    /** Seconds since the bot last acquired a target (deviation correction). */
    this.timeSinceTargetAcquired = 0;

    /** Whether the bot had a target last tick. */
    this.hadTarget = false;

    /** View distance in metres. */
    this.viewDistance = DEFAULT_VIEW_DISTANCE;

    /** The bot's live facing, synced from the world's soldier each tick. */
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';

    // --- Input fields written by the plan and flushed by `_writeInput` ---

    /** Forward throttle, c_PIThrottle, -1..1. */
    this.moveForward = 0;
    /** Strafe, c_PIYaw, -1..1 (D/A strafe, the mouse turns you). */
    this.moveStrafe = 0;
    /** 'stand' | 'walk' | 'crouch' | 'prone' — resolved to channels on write. */
    this.stanceInput = 'stand';
    /** One-shot c_PIAction jump request. */
    this.jumpRequest = false;
    /** Mouse counts, ±AXIS_MAX, converted by the world with soldierLookDegrees. */
    this.lookX = 0;
    this.lookY = 0;

    // --- Sensing state (AI-22) ---

    /** The current firing target's playerId, or null. */
    this.firingTarget = null;

    /** The current firing target's position [x, y, z], or null. */
    this.targetPosition = null;

    /** Last heard sound position [x, y, z], or null. */
    this.lastHeardPosition = null;

    /** Seconds since the last sound was heard. */
    this.timeSinceHeard = Infinity;

    /** Vision memory: Map<playerId, { lastSeenPos, lastSeenTime }>. */
    this.memory = new Map();

    /** Whether this bot is in a vehicle (wider FOV). */
    this.isMobile = false;

    /** Sound sphere radius for hearing (from Objects.con). */
    this.soundSphereRadius = SOLDIER_SOUND_RADIUS;

    // --- Urgency contest and plan execution state ---

    /** Current winning behaviour name. */
    this.currentBehaviour = BEHAVIOUR.Idle;

    /** Current plan: array of plan action objects. */
    this.currentPlan = [];

    /** The target the current plan was generated for, to detect changes. */
    this.planTargetId = null;

    /** Set on the tick a live target replaced the plan's own target. */
    this.hasChangedTarget = false;

    /** Current navigation target [x, y, z] from the active plan. */
    this.waypoint = null;

    /** Navigation path: array of [x, z] waypoints from findPath(). */
    this.navPath = [];

    /** Index into navPath for the next waypoint to navigate toward. */
    this.navPathIndex = 0;

    /** Time since the last enemy shot near this bot (TakeCover urgency). */
    this.timeSinceNearbyShot = Infinity;

    /** Position of the last nearby shot (TakeCover direction). */
    this.lastNearbyShotPosition = null;

    /** Whether the bot is currently under fire. */
    this.isUnderFire = false;

    /** The current objective flag (MoveTo), or null. */
    this.objective = null;

    /** Seconds since the bot last had a target or objective (Scout). */
    this.scoutIdleTime = 0;

    /** The bot's own team, cached for filters. Seeded from the world record at
     *  construction — `tick` refreshes it, but the team filters must be right
     *  from frame zero, before any tick has run. */
    this.team = this._player()?.team ?? null;

    /** Navigation grid reference (set externally when nav grid is built). */
    this.navGrid = null;

    /**
     * The current full deviation cone half-angle in degrees (floor + dynamic
     * channels + the AI term). The page's bot weapon path reads this per shot.
     */
    this.aimDeviation = 0;

    /** Scratch for the behaviour contest: name -> urgency. */
    this._urgencies = {};

    /** Static-probe scratch, one record reused per cast (soldier.js's shape). */
    this._probe = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0,
      dx: 0, dy: 0, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
    };

    /** Last tick's world position, for the no-progress (stuck) test. */
    this._lastX = null;
    this._lastZ = null;
    this._stuckTime = 0;
    /** Forced escape after a stall: phase 0 reverses, phase 1 side-steps. */
    this._unstickTimer = 0;
    this._unstickPhase = 0;
    this._unstickYaw = 0;
    /** Sticky side (+1 right / -1 left) for sliding around an obstacle, and
     *  the seconds left before the choice is reconsidered. */
    this._avoidSide = 0;
    this._avoidTimer = 0;
    this._avoidHeading = null;
    /** Consecutive failed escapes; 4 asks the page to redeploy the bot. */
    this._unstickCount = 0;
    this._needsRespawn = false;
    /** Best (smallest) distance to the goal seen, and seconds since it improved. */
    this._bestGoalDist = null;
    this._noProgress = 0;

    /** The point the squad actually walks to (a flag station), and whether the
     *  bot is holding there, which parks MoveTo so it settles. */
    this.objectiveGoal = null;
    this.goalReached = false;
  }

  /** Build deviation data from AI weapon template. */
  _buildDeviationData() {
    // The viewer's DeviationModel speaks the hand-weapon block vocabulary
    // (`setMinDev` -> `min`), so a bot's weapon data lands there if present.
    if (!this.weaponAi) return {};
    return { min: this.weaponAi.minDeviation ?? this.weaponAi.deviation ?? 0 };
  }

  /** The player record for this bot, or null. */
  _player() {
    return this.world?.player?.(this.playerId) ?? this.world?.players?.get(this.playerId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Sensing (AI-22: BotMain::sense)
  // -----------------------------------------------------------------------

  /**
   * The complete sensing pipeline: scan world.players for enemies, filter by
   * frustum, check LOS, return the closest visible one, else the freshest
   * memory. Updates vision memory.
   *
   * @param {number} now  current time in seconds
   * @returns {{ targetId: string|null, targetPos: number[]|null }}
   */
  sense(now) {
    const botPos = this.position;
    const viewDist = this.viewDistance;
    const collider = this.world?.collider;
    const botPlayer = this._player();

    // Collect enemy candidates from world.players (INVENTION: brute force in
    // place of the 32x32 AIInformationGrid hash).
    const candidates = [];
    for (const [id, player] of this.world.players) {
      if (id === this.playerId) continue;
      if (player.team === null || player.team === undefined) continue;

      // Same team = friendly, skip. No exception for the local human: a bot on
      // the player's own side never shoots him. The engine's own
      // `BotMain::sense` team test has no such hole, and the page now spawns
      // bots onto both sides, so the AI has real enemies without one.
      if (botPlayer && player.team === botPlayer.team) continue;

      let targetPos = null;
      if (player.soldier) {
        targetPos = [player.soldier.x, player.soldier.y, player.soldier.z];
      } else if (player.position) {
        targetPos = [...player.position];
      } else if (player.vehicle) {
        const s = player.vehicle.state.position;
        targetPos = [s.x, s.y, s.z];
      }
      if (!targetPos) continue;

      const dSq = distSq(botPos, targetPos);
      if (dSq > viewDist * viewDist) continue;

      candidates.push({ id, pos: targetPos, distSq: dSq });
    }

    // Sort by distance (closest first) — engine's sort at BotMain+0x104.
    candidates.sort((a, b) => a.distSq - b.distSq);

    for (const candidate of candidates) {
      if (!isInFrustum(botPos, this.yaw, candidate.pos, viewDist, this.isMobile)) {
        continue;
      }
      if (!checkLOS(collider, botPos, candidate.pos)) continue;

      this.memory.set(candidate.id, {
        lastSeenPos: [...candidate.pos],
        lastSeenTime: now,
      });
      return { targetId: candidate.id, targetPos: candidate.pos };
    }

    // No visible target — fall back to the freshest live memory.
    let bestMemory = null;
    let bestMemoryDist = Infinity;
    for (const [id, mem] of this.memory) {
      if (now - mem.lastSeenTime > MEMORY_DURATION) continue;
      const dSq = distSq(botPos, mem.lastSeenPos);
      if (dSq < bestMemoryDist) {
        bestMemoryDist = dSq;
        bestMemory = { targetId: id, targetPos: mem.lastSeenPos };
      }
    }

    return bestMemory ?? { targetId: null, targetPos: null };
  }

  /**
   * Process a sound event (AI-22: BotManager::actionHearing).
   *
   * @param {number[]} soundPos   position of the sound source [x, y, z]
   * @param {number}   now        current time in seconds
   * @param {number}   [sourceTeam]  team of the shooter (for the team filter)
   */
  hearSound(soundPos, now, sourceTeam = null) {
    const botPlayer = this._player();
    if (botPlayer && sourceTeam !== null && botPlayer.team === sourceTeam) return;

    if (soundPos[0] === this.position[0] &&
        soundPos[1] === this.position[1] &&
        soundPos[2] === this.position[2]) return;

    const dSq = distSq(this.position, soundPos);
    if (dSq <= this.soundSphereRadius * this.soundSphereRadius) {
      this.lastHeardPosition = [...soundPos];
      this.timeSinceHeard = 0;
      this._recordUnderFire(soundPos);
    }
  }

  /** Record a shot near this bot (the under-fire test). */
  _recordUnderFire(shotPos) {
    const dSq = distSq(this.position, shotPos);
    if (dSq <= UNDER_FIRE_RADIUS * UNDER_FIRE_RADIUS) {
      this.timeSinceNearbyShot = 0;
      this.lastNearbyShotPosition = [...shotPos];
      this.isUnderFire = true;
    }
  }

  /** Public alias used by the page when the human fires. */
  recordNearbyShot(shotPos, now) {
    this._recordUnderFire(shotPos);
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /**
   * Once per tick. Sync from the world's soldier, sense, run the contest,
   * generate and run the plan, then flush one PlayerInput.
   */
  tick(dt, now) {
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

    // Measure progress and arm a sidestep before the plan writes this tick's
    // movement (the previous tick's input is still in `moveForward`).
    this._trackStuck(dt);

    // Clear the input word each tick (the engine's resetAllControls pattern).
    this._resetInput();

    // --- Sensing phase ---
    const { targetId, targetPos } = this.sense(now);
    const hadTarget = this.firingTarget !== null;
    this.firingTarget = targetId;
    this.targetPosition = targetPos;
    this.hasChangedTarget = hadTarget && targetId !== null
      && targetId !== this.planTargetId;
    if (targetId && targetPos) {
      this.timeSinceHeard = Infinity;
      this.lastHeardPosition = null;
      this.scoutIdleTime = 0;
    } else {
      this.scoutIdleTime += dt;
    }

    // --- Under-fire decay ---
    this.timeSinceNearbyShot += dt;
    this.isUnderFire = this.timeSinceNearbyShot < UNDER_FIRE_WINDOW;

    // --- Objective: nearest flag not held by this bot's team ---
    this.objective = this._nearestObjective();
    // Walk to a station on the flag's ring, not its mast, and consider the
    // goal reached once the bot is holding there — that is what lets the
    // squad settle around a point while it is being taken.
    this.objectiveGoal = this.objective
      ? this._objectiveStation(this.objective)
      : (this.lastHeardPosition ? [...this.lastHeardPosition] : null);
    this.goalReached = !!this.objectiveGoal
      && this._distTo(this.objectiveGoal) < STATION_HOLD_RADIUS;

    // Net-progress watch: a bot that circles a pocket keeps its per-tick speed
    // up but never closes on the goal, so measure the best distance and ask the
    // page for a redeploy when it has not improved for a few seconds.
    if (this.objectiveGoal && !this.goalReached) {
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

    // --- Urgency contest: pick the winning behaviour ---
    const winner = this._runUrgencyContest(now);
    const changed = winner !== this.currentBehaviour;
    this.currentBehaviour = winner;

    // Plan lifetime: regenerate when the winner changes, when the plan is
    // exhausted, or when the target changed (engine `hasChangedTarget`).
    const exhausted = this.currentPlan.length === 0;
    if (changed || exhausted || this.hasChangedTarget) {
      this._generatePlan(winner, now);
      this.planTargetId = targetId;
    }

    // --- Execute the whole plan for this tick ---
    this._runPlan(dt, now);

    // --- Deviation: dynamic channels + the AI term ---
    this.deviation.update(dt, {
      stance: this.stance,
      throttle: this.moveForward,
      strafe: this.moveStrafe,
      lookX: this.lookX,
      lookY: this.lookY,
      jumping: false,
    });
    this.deviation.setAIDeviation({
      botSkill: this.botSkill,
      timeSinceTarget: this.timeSinceTargetAcquired,
      deviation: this.weaponAi?.deviation ?? 5.0,
      correctionTime: this.weaponAi?.deviationCorrectionTime ?? 10.0,
    });
    this.aimDeviation = this.deviation.current();

    // --- Flush the input word ---
    this._writeInput();

    this.timeSinceTargetAcquired = targetId ? this.timeSinceTargetAcquired + dt : 0;
    this.timeSinceHeard += dt;
  }

  _resetInput() {
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.stanceInput = 'stand';
    this.jumpRequest = false;
    this.lookX = 0;
    this.lookY = 0;
    this.isFiring = false;
    // Navigation state is NOT cleared here: a persistent MoveTo plan owns its
    // path across ticks, and `_execInfantryResetControls` is the one place a
    // plan asks for it to be dropped.
  }

  /**
   * The single input writer. Mirrors what the page hands the world for the
   * human: the named action word plus the mouse axis pair.
   */
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
   * Aim at an absolute world yaw/pitch by writing the mouse axis pair.
   *
   * `lookX`/`lookY` are mouse counts, not radians. The world converts with
   * `soldierLookDegrees`: `yawDeg = x * 3.0`, `pitchDeg = y * 1.0`, then
   * applies it as a NEGATED rotation. The axis saturates at ±16.
   */
  _aimLook(desiredYaw, desiredPitch = null) {
    const s = this._player()?.soldier;
    if (!s) return;
    const dYaw = wrapAngle(desiredYaw - s.yaw);
    const livePitch = s.pitch ?? 0;
    const targetPitch = desiredPitch === null ? livePitch : desiredPitch;
    const dPitch = targetPitch - livePitch;
    this.lookX = clamp(-(dYaw * RAD2DEG) / YAW_GAIN, -AXIS_MAX, AXIS_MAX);
    this.lookY = clamp(-(dPitch * RAD2DEG) / PITCH_GAIN, -AXIS_MAX, AXIS_MAX);
  }

  // -----------------------------------------------------------------------
  // Obstacle avoidance and unsticking
  // -----------------------------------------------------------------------
  //
  // The engine's Avoid behaviour (`BBAvoid` / `BBPAvoidCollisionInfantery`,
  // aiSettings `AvoidInhibit`) fires on a forward collision probe and emits a
  // side-step plan. This landing folds the same idea into the MoveTo executor:
  // a short cast ahead of the bot's feet/waist (the `static cast` the soldier
  // body already resolves against) and, when it hits, a fan to both sides for
  // the first clear heading. On top of that, a no-progress test forces a
  // quarter-turn sidestep after ~1 s of pushing against something — the sandbag
  // wedge a spawn point can leave a body in.
  //
  // The plan deferred Avoid to a later stage (§4 "keep out of Stage 1"); it is
  // here early because a spawned squad otherwise wedges in the base's sandbags.
  // Recorded in IMPLEMENTATION_PLAN.md.

  /**
   * Whether a static blocks a step of `dist` from the bot's own feet, along
   * `yaw`, at waist and chest height. True (clear) when the collider carries no
   * static tree (`world_ship_pitch_harness.mjs`'s bare collider).
   */
  _clearAhead(yaw, dist = AVOID_PROBE_DIST) {
    return this._clearDistance(yaw, dist) >= dist * 0.999;
  }

  /**
   * How far the bot can walk along `yaw` before a static stops it, up to
   * `maxDist`. Waist and chest both have to clear, so a leg that slips under a
   * fence rail does not read as open.
   */
  _clearDistance(yaw, maxDist) {
    const statics = this.world?.collider?.statics;
    if (typeof statics?.cast !== 'function') return maxDist;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const rec = this._probe;
    let clear = maxDist;
    for (const h of AVOID_PROBE_HEIGHTS) {
      rec.dx = dx; rec.dy = 0; rec.dz = dz;
      const hit = statics.cast(this.position[0], this.position[1] + h,
                               this.position[2], dx, 0, dz, maxDist, -1, rec);
      if (hit) clear = Math.min(clear, Math.max(0, hit.t));
    }
    return clear;
  }

  /**
   * Which way to slide around an obstacle whose course is `desiredYaw`: the
   * side with more open ground at ±34°, kept sticky unless the other side is
   * clearly better. Returns +1 for right, -1 for left.
   */
  _chooseAvoidSide(desiredYaw) {
    const reach = AVOID_LOOKAHEAD;
    const right = this._clearDistance(wrapAngle(desiredYaw + Math.PI / 2), reach)
      + this._clearDistance(wrapAngle(desiredYaw + Math.PI / 4), reach);
    const left = this._clearDistance(wrapAngle(desiredYaw - Math.PI / 2), reach)
      + this._clearDistance(wrapAngle(desiredYaw - Math.PI / 4), reach);
    if (this._avoidSide === 0) return right >= left ? 1 : -1;
    if (this._avoidSide > 0 && left > right + 3) return -1;
    if (this._avoidSide < 0 && right > left + 3) return 1;
    return this._avoidSide;
  }

  /**
   * Measure the last tick's movement and, when the bot is driving forward into
   * something and going nowhere, arm a forced sidestep. Runs before the plan so
   * the MoveTo executor sees the timer this tick.
   */
  _trackStuck(dt) {
    if (this._lastX === null) {
      this._lastX = this.position[0];
      this._lastZ = this.position[2];
      return;
    }
    const moved = Math.hypot(this.position[0] - this._lastX,
                             this.position[2] - this._lastZ);
    this._lastX = this.position[0];
    this._lastZ = this.position[2];

    if (this._unstickTimer > 0) {
      this._unstickTimer -= dt;
      if (this._unstickTimer <= 0 && this._unstickPhase === 0) {
        // Reverse done: take a side step, preferring a clear probe.
        this._unstickPhase = 1;
        this._unstickTimer = UNSTICK_SIDE_TIME;
        const right = wrapAngle(this.yaw + Math.PI / 2);
        const left = wrapAngle(this.yaw - Math.PI / 2);
        const back = wrapAngle(this.yaw + Math.PI);
        if (this._clearAhead(right)) this._unstickYaw = right;
        else if (this._clearAhead(left)) this._unstickYaw = left;
        else if (this._clearAhead(back)) this._unstickYaw = back;
        else this._unstickYaw = Math.random() < 0.5 ? right : left;
      }
      return;
    }
    if (this.moveForward > 0.1 && moved < STUCK_EPSILON) {
      this._stuckTime += dt;
    } else {
      this._stuckTime = Math.max(0, this._stuckTime - dt * 2);
      this._unstickCount = Math.max(0, (this._unstickCount ?? 0) - 1);
    }
    if (this._stuckTime >= UNSTICK_AFTER) {
      this._stuckTime = 0;
      // Reverse first: the ground behind is the ground the bot just crossed.
      this._unstickPhase = 0;
      this._unstickTimer = UNSTICK_BACK_TIME;
      this._avoidHeading = null;
      this._avoidTimer = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Urgency contest (§4.1)
  // -----------------------------------------------------------------------

  /**
   * The engine's scalar weighted contest:
   *
   *   urgency(behaviour) = generator(bot) * weight[behaviour] * curve(distance)
   *   winner = argmax; every urgency is floored so Idle is never 0.
   */
  _runUrgencyContest(now) {
    const u = this._urgencies;
    u.Fire = 0;
    u.TakeCover = 0;
    u.Scout = 0;
    u.MoveTo = 0;
    u.Idle = IDLE_FLOOR;

    const weight = name => STANDARD_WEIGHTS[name] ?? DEFAULT_WEIGHT;

    // Fire: a visible or remembered target. UCFire's linear curve is a unitless
    // multiplier, so its input is the distance normalised against the bot's
    // view distance (the research does not state the curve's input unit; over
    // raw metres it would fall to zero past 5.9 m, which cannot be what makes
    // an infantry bot engage at rifle range).
    if (this.firingTarget && this.targetPosition) {
      const d = Math.hypot(
        this.targetPosition[0] - this.position[0],
        this.targetPosition[2] - this.position[2]);
      const normalised = this.viewDistance > 0 ? d / this.viewDistance : 0;
      u.Fire = 1 * weight('Fire') * URGENCY_CURVE.fire(normalised);
    }

    // TakeCover: an enemy shot landed nearby.
    if (this.isUnderFire && this.lastNearbyShotPosition) {
      const d = Math.hypot(
        this.lastNearbyShotPosition[0] - this.position[0],
        this.lastNearbyShotPosition[2] - this.position[2]);
      u.TakeCover = 1 * weight('TakeCover') * URGENCY_CURVE.union(d);
    }

    // MoveTo: a goal exists and the bot has not yet reached its station. Once
    // it is holding on the flag's ring the generator goes to 0, so Idle wins
    // and the squad settles around the point instead of pushing at the mast.
    if (this.objectiveGoal && !this.goalReached) {
      u.MoveTo = 1 * weight('MoveTo') * URGENCY_CURVE.union(this._distTo(this.objectiveGoal));
    }

    // Scout: no target and no objective for a while.
    if (!this.firingTarget && !this.objective && this.scoutIdleTime > SCOUT_IDLE_DELAY) {
      u.Scout = 1 * weight('Scout') * URGENCY_CURVE.scout(0);
    }

    let winner = BEHAVIOUR.Idle;
    let best = -Infinity;
    for (const name of ['Fire', 'TakeCover', 'MoveTo', 'Scout', 'Idle']) {
      const value = Math.max(u[name] ?? 0, IDLE_FLOOR);
      if (value > best) {
        best = value;
        winner = name;
      }
    }
    return winner;
  }

  // -----------------------------------------------------------------------
  // Plans
  // -----------------------------------------------------------------------

  /** Generate the plan for `behaviour` into `this.currentPlan`. */
  _generatePlan(behaviour, now) {
    switch (behaviour) {
      case BEHAVIOUR.Fire:
        this.currentPlan = this._planFire();
        break;
      case BEHAVIOUR.TakeCover:
        this.currentPlan = this._planTakeCover(now);
        break;
      case BEHAVIOUR.MoveTo:
        this.currentPlan = this._planMoveTo();
        break;
      case BEHAVIOUR.Scout:
        this.currentPlan = this._planScout();
        break;
      case BEHAVIOUR.Idle:
      default:
        this.currentPlan = this._planIdle();
        break;
    }
  }

  /**
   * Fire plan: aim at the target, then hold the trigger while aligned.
   * Matches BBPFireInfantery → { MouseTurretAimAt, Trigger }.
   */
  _planFire() {
    if (!this.targetPosition) return this._planIdle();
    return [
      { type: PLAN_ACTION.MouseTurretAimAt, targetPos: [...this.targetPosition] },
      { type: PLAN_ACTION.Trigger, targetPos: [...this.targetPosition] },
    ];
  }

  /**
   * MoveTo plan: path to the objective flag, else to the last heard sound.
   * Matches BBPGotoWaypointInfantery → { InfanteryMoveTo }.
   */
  _planMoveTo() {
    const goal = this.objectiveGoal ?? this.lastHeardPosition;
    if (!goal) return this._planIdle();
    return [this._moveToAction(goal)];
  }

  /**
   * TakeCover plan: move away from the threat. Matches BBPTakeCoverInfantry.
   */
  _planTakeCover(now) {
    const threatPos = this.lastNearbyShotPosition;
    if (!threatPos) return this._planIdle();

    const dx = this.position[0] - threatPos[0];
    const dz = this.position[2] - threatPos[2];
    const dist = Math.hypot(dx, dz) || 1;
    const coverDistance = 10;
    const coverX = this.position[0] + (dx / dist) * coverDistance;
    const coverZ = this.position[2] + (dz / dist) * coverDistance;

    const action = this._moveToAction([coverX, this.position[1], coverZ]);
    action.crouch = true;
    return [action];
  }

  /**
   * Scout plan: no objective and no target — sweep the view toward the last
   * heard sound if any, else slowly turn on the spot.
   */
  _planScout() {
    if (this.lastHeardPosition) {
      const aim = faceTarget(this.position, this.lastHeardPosition);
      return [{ type: PLAN_ACTION.MouseTurretLookAt, yaw: aim.yaw, pitch: 0 }];
    }
    return [{ type: PLAN_ACTION.MouseTurretLookAt, yaw: this.yaw + 0.35, pitch: 0 }];
  }

  /**
   * Idle plan: no-op. BBIdle — BBPIdleInfantery. Idle's urgency is floored,
   * never 0 (engine crash warning).
   */
  _planIdle() {
    return [{ type: PLAN_ACTION.InfantryResetControls }];
  }

  /** One MoveTo action, with a nav-grid path when the grid can answer. */
  _moveToAction(goal) {
    if (this.navGrid) {
      const path = findPath(this.navGrid, this.position[0], this.position[2],
                             goal[0], goal[2]);
      this._navLen = path ? path.length : 0;
      if (path && path.length > 1) {
        this.navPath = path;
        this.navPathIndex = 0;
        this.waypoint = [path[0][0], this.position[1], path[0][1]];
        return { type: PLAN_ACTION.InfantryMoveTo, waypoint: this.waypoint };
      }
    }
    this.navPath = [];
    this.navPathIndex = 0;
    this.waypoint = [...goal];
    return { type: PLAN_ACTION.InfantryMoveTo, waypoint: this.waypoint };
  }

  /** The nearest flag this bot's team does not hold, or null. */
  _nearestObjective() {
    const flags = this.world?.flags;
    if (!flags?.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const flag of flags) {
      if (!flag.position) continue;
      if (flag.uncapturable) continue;
      if (flag.team === this.team) continue;
      const d = Math.hypot(flag.position[0] - this.position[0],
                           flag.position[2] - this.position[2]);
      if (d < bestDist) {
        bestDist = d;
        best = flag;
      }
    }
    return best;
  }

  /** Horizontal distance from the bot to a world point. */
  _distTo(point) {
    return Math.hypot(point[0] - this.position[0], point[2] - this.position[2]);
  }

  /**
   * The spot on `flag`'s capture ring this bot walks to and holds. The engine
   * does not send every attacker to the mast — a soldier on the point is
   * enough — and a squad sent to one point stacks and pushes; a deterministic
   * angle per bot spreads the ring. The radius stays inside `captureRadius` so
   * a bot holding its station still contributes to the capture.
   */
  _objectiveStation(flag) {
    const base = flag.position;
    const capture = Number.isFinite(flag.radius) && flag.radius > 0
      ? flag.radius : CAPTURE_RADIUS_FALLBACK;
    const radius = Math.min(STATION_MAX_RADIUS, capture * 0.5);
    let hash = 0;
    for (let i = 0; i < this.playerId.length; i++) {
      hash = (hash * 31 + this.playerId.charCodeAt(i)) | 0;
    }
    const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
    return [base[0] + Math.sin(angle) * radius, base[1],
            base[2] + Math.cos(angle) * radius];
  }

  // -----------------------------------------------------------------------
  // Plan interpreter (§4.2)
  // -----------------------------------------------------------------------

  /**
   * Run every action in the plan for this tick. A plan with any action still
   * incomplete persists; one whose actions all complete regenerates.
   */
  _runPlan(dt, now) {
    let allComplete = true;
    for (const action of this.currentPlan) {
      const complete = this._executeAction(action, dt, now);
      if (!complete) allComplete = false;
    }
    if (allComplete) this.currentPlan = [];
  }

  /** Execute a single plan action. Returns true when it is complete. */
  _executeAction(action, dt, now) {
    switch (action.type) {
      case PLAN_ACTION.InfantryMoveTo:
        return this._execInfantryMoveTo(action, dt);
      case PLAN_ACTION.MouseTurretAimAt:
        return this._execMouseTurretAimAt(action);
      case PLAN_ACTION.Trigger:
        return this._execTrigger(action);
      case PLAN_ACTION.TriggerContinously:
        return this._execTrigger(action);
      case PLAN_ACTION.InfantryResetControls:
        return this._execInfantryResetControls();
      case PLAN_ACTION.MouseTurretLookAt:
        return this._execMouseTurretLookAt(action);
      case PLAN_ACTION.Sense:
        return this._execSense(now);
      case PLAN_ACTION.SoldierPose:
        return this._execSoldierPose(action);
      // The medium / direction / object variants are one-line delegations
      // (the plan's §4 table): a direction or object move is an InfanteryMoveTo
      // against the resolved point.
      case PLAN_ACTION.MoveToMediumSoldier:
      case PLAN_ACTION.MoveToObjectMediumSoldier:
      case PLAN_ACTION.InfantryMoveToDirection:
      case PLAN_ACTION.InfantryMoveToObject:
        return this._execInfantryMoveTo(action, dt);
      case PLAN_ACTION.InfoWrapper:
        return true;
      default:
        return true; // unknown action = complete
    }
  }

  /**
   * InfanteryMoveTo: aim at the waypoint and drive forward. The soldier moves
   * along its current facing, so aim first, then set the throttle.
   */
  _execInfantryMoveTo(action, dt) {
    const target = action.waypoint || this.waypoint;
    if (!target) return true;

    // Advance the nav path when the current waypoint is reached.
    if (this.navPath.length > 0 && this.navPathIndex < this.navPath.length) {
      const wp = this.navPath[this.navPathIndex];
      if (Math.hypot(this.position[0] - wp[0], this.position[2] - wp[1])
          < WAYPOINT_REACH_RADIUS) {
        this.navPathIndex++;
        if (this.navPathIndex >= this.navPath.length) {
          this.waypoint = null;
          return true;
        }
        const next = this.navPath[this.navPathIndex];
        this.waypoint = [next[0], this.position[1], next[1]];
      }
    }

    const wp = this.waypoint || target;

    // A stalled bot backs out of the wedge, then side-steps, then resumes the
    // waypoint. `_trackStuck` advances the phase.
    if (this._unstickTimer > 0) {
      if (this._unstickPhase === 0) {
        this.moveForward = -1;
        this.moveStrafe = 0;
      } else {
        this._aimLook(this._unstickYaw, 0);
        this.moveForward = 1;
        this.moveStrafe = 0;
      }
      return false;
    }

    const aim = faceTarget(this.position, wp);
    this._dbgDesiredYaw = aim.yaw;

    // Body-frame steering. A clear course aims at the waypoint. A blocked one
    // follows the wall: turn to run *along* it (a committed ±90° heading, held
    // for `AVOID_HOLD`) rather than pushing into it, which is how a body finds
    // the end of a sandbag line. The side is sticky so it does not flip.
    const ahead = this._clearDistance(aim.yaw, AVOID_PROBE_DIST);
    this._dbgClear = ahead;
    let walkYaw = aim.yaw;
    if (ahead >= AVOID_PROBE_DIST) {
      this._avoidSide = 0;
      this._avoidHeading = null;
      this._avoidTimer = 0;
    } else {
      if (this._avoidTimer > 0 && this._avoidHeading !== null) {
        this._avoidTimer -= dt;
        walkYaw = this._avoidHeading;
      } else {
        this._avoidSide = this._chooseAvoidSide(aim.yaw);
        this._avoidHeading = wrapAngle(aim.yaw + this._avoidSide * (Math.PI / 2));
        this._avoidTimer = AVOID_HOLD;
        walkYaw = this._avoidHeading;
      }
    }
    this._aimLook(walkYaw, 0);
    const rel = wrapAngle(walkYaw - this.yaw);
    this.moveForward = 1;
    this.moveStrafe = Math.sin(rel) * 0.5;

    if (action.crouch) {
      this.stanceInput = 'crouch';
      this.moveForward *= 0.5;
    }

    const done = Math.hypot(this.position[0] - wp[0], this.position[2] - wp[1])
      < WAYPOINT_REACH_RADIUS;
    return done;
  }

  /** MouseTurretAimAt: aim at the target position. Transient, runs each tick. */
  _execMouseTurretAimAt(action) {
    if (action.targetPos) {
      const aim = faceTarget(this.position, action.targetPos);
      this._aimLook(aim.yaw, aim.pitch);
    }
    return true;
  }

  /**
   * Trigger: hold fire only when the live facing is aligned with the target.
   * The fire edge raises `deviation.onShot()`; holding does not re-bloom.
   */
  _execTrigger(action) {
    const targetPos = action.targetPos;
    if (!targetPos) return true;

    const s = this._player()?.soldier;
    const want = faceTarget(this.position, targetPos);
    const liveYaw = s?.yaw ?? this.yaw;
    const livePitch = s?.pitch ?? this.pitch;
    const dy = wrapAngle(want.yaw - liveYaw);
    const dp = want.pitch - livePitch;
    const aligned = Math.hypot(dy, dp) < CROSSHAIR_TOLERANCE;

    if (aligned) {
      // The fire channel is a latch; the per-round deviation bloom is raised
      // where each round leaves (`map.html` `botFireTick`), matching
      // `FireArms::Fire`, not on every tick the trigger is held.
      this.isFiring = true;
    }
    return false; // the trigger is evaluated continuously
  }

  /** InfanteryResetControls: clear every movement/aim input. */
  _execInfantryResetControls() {
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.stanceInput = 'stand';
    this.isFiring = false;
    this.lookX = 0;
    this.lookY = 0;
    this.waypoint = null;
    this.navPath = [];
    this.navPathIndex = 0;
    return true;
  }

  /** MouseTurretLookAt: look at an absolute direction. */
  _execMouseTurretLookAt(action) {
    if (action.yaw !== undefined) this._aimLook(action.yaw, action.pitch ?? null);
    return true;
  }

  /** Sense: re-run the sensing pipeline immediately. */
  _execSense(now) {
    const { targetId, targetPos } = this.sense(now);
    this.firingTarget = targetId;
    this.targetPosition = targetPos;
    return true;
  }

  /** SoldierPose: map a stance word to the input's stance channels. */
  _execSoldierPose(action) {
    const pose = action.pose ?? action.stance;
    if (pose === 'walk' || pose === 'stand' || pose === 'crouch' || pose === 'prone') {
      this.stanceInput = pose;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Queries used by the page
  // -----------------------------------------------------------------------

  /** Update the bot's position (called by the world/page when it moves). */
  setPosition(x, y, z) {
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
  }

  /** Get the bot's current position. */
  getPosition() {
    return [...this.position];
  }

  /**
   * The bot's eye pose for the page's fire path: origin [x, y, z] at the
   * soldier's own eye height, and the unit forward vector for its live yaw and
   * pitch.
   */
  aimRay() {
    const cosP = Math.cos(this.pitch);
    const origin = [
      this.position[0],
      this.position[1] + EYE_HEIGHT,
      this.position[2],
    ];
    const dir = [
      Math.sin(this.yaw) * cosP,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosP,
    ];
    return { origin, dir };
  }
}

/**
 * Bot spawner: creates N bots on team-capped spawn points.
 *
 * `team` spawns every bot on one side; `teams` (an array) splits them across
 * sides round-robin — the engine tops up both, and flipping to that later is a
 * call-site change, not a rewrite (plan §6).
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
} = {}) {
  const bots = [];
  const teamList = Array.isArray(teams) && teams.length ? teams : null;

  for (let i = 0; i < count; i++) {
    const botTeam = teamList ? teamList[i % teamList.length] : team;
    const teamName = botTeam === 1 ? 'German' : botTeam === 2 ? 'American' : 'American';
    const names = BOT_NAMES[teamName] || FALLBACK_NAMES;

    const teamFlags = flags.filter(f => f.team === botTeam);
    // Degrade gracefully: with no capped flag for this side, the world's own
    // spawnPlayer picks a team flag, else the first flag (plan §6).
    const flag = teamFlags.length ? teamFlags[i % teamFlags.length] : null;
    // Spread the squad over the side's spawn points rather than stacking every
    // bot on `spawns[0]` (the engine hands the AI the same spawn list a human
    // walks, one point each).
    const spawnIndex = teamFlags.length ? Math.floor(i / teamFlags.length) : i;

    const playerId = `bot_${i}`;
    const player = world.addBotPlayer(playerId, { team: botTeam, flag, spawnIndex });
    if (!player) continue;

    const resolvedFlag = world.player(playerId)?.flag ?? flag;
    const bot = new BotController({
      playerId,
      world,
      botSkill,
      name: names[i % names.length],
      spawnPos: spawnPositionOf(player, resolvedFlag),
      controlInfo,
      weaponAi,
    });
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