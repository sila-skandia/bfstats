// The bots' referee: everything around the bot AI that a server would do and
// the AI does not (features/bf1942-ai-spec, the PAGE layer). One copy, used
// by the page (`map.html`) and by the headless match runner (`sim/match.mjs`).
//
//   spawn       the navigation map, the bots, the strategic AI, the covers,
//               a body and an Armor per bot
//   tick        per frame (page) or per 30 Hz tick (runner): the strategic
//               pass, the enemy tables, the seat requests, each bot's respawn
//               timer, order, tick and no-progress redeploy, then the rounds
//   fireTick    rate of fire, magazine and reload, the deviation cone, the
//               hit test against the soldier capsules (or the round handed
//               to the caller to fly, `env.launchRound`), heals, damage
//   damage      HP, incoming fire, death, the order freed, the respawn timer
//   capture     the control point's own law (`ControlPoint::handleFrameUpdate`
//               0x08283b00), per flag over every living player on it
//   seating     enter, leave and the seat swap, through the units layer the
//               caller hands in (the page's vehicle instances, the runner's
//               kinematic hulls)
//   tables      `SAI::updateStrengths`' input: every occupied unit
//
// What differs between the two callers is handed in as `env` (below): the
// vehicles the bots can see and take (`env.units`), where a body stands up
// after a hull, an Armor for a fresh body, what a round does, and hooks for
// what each caller does with an event (the page plays a sound or hoists a
// flag; the runner writes a trace line). The referee itself never touches a
// scene, a sound or a DOM node.
//
// PARITY DEPARTURE (BOT_AI_IMPLEMENTATION_PLAN §5): a bot's round is resolved
// here, not flown: the bot's live facing, the engine's deviation cone (the
// same polar law `gunfire.js` rolls: theta = spread * sqrt(u), azimuth free)
// and the engine's direct-hit damage, against a stand-in soldier body -- a
// vertical capsule at the world's object origin, `setCharacterHeight -1.00`
// above the feet (INVENTION). The viewer's collider carries no soldier body.
// The exception is a round the caller can fly: the page launches a rocket
// launcher's round through `gunfire.js` (`env.launchRound`, bot-rounds.js),
// and it meets, explodes and splashes as the human's does.

import { buildNavMap, isWalkable } from './nav-grid.js';
import { spawnBots } from './bot.js';
import { EnemyStrengthTables } from './bot-strength.js';
import { disembarkPath, DISEMBARK, LANDING_CRAFT_RE } from './doctrine-landing.js';
import { playerPosition } from './bot-sense.js';
import { SAI, StrategicLayer, StrategicAI, StrategicCommand } from './strategic.js';
import { roundHit } from './soldier-death.js';
import { meetSoldier } from './skeleton-hit.js';
import { FRIENDLY_FIRE_SHIPPED, friendlyDamage, roundPasses } from './friendly-fire.js';

/** Seconds a downed bot stays out before its side puts it back on a flag. */
export const BOT_RESPAWN_DELAY = 8;
/** Rounds/second when no hand weapon's stats are loaded yet. */
export const BOT_FALLBACK_ROF = 8;
/** A soldier body's stand-in radius and origin height (INVENTION). The height
 *  is physics.js `CHARACTER_HEIGHT`. */
export const BOT_BODY_RADIUS = 0.6;
export const BOT_BODY_HEIGHT = 1.0;
/** The material a round is priced against when it meets the stand-in body,
 *  which has no capsules: the torso's (`Bip01_Spine2`, 41), the largest of the
 *  eight and the one most rounds meet (INVENTION: the engine always has the
 *  capsules, ledger DIE-10). Not the soldier object's own material 40, which is
 *  the head capsule's: pricing every stand-in hit as a head shot made a Colt
 *  round 17.5 where the torso's is 10 (DMG-3). */
export const BOT_BODY_MATERIAL = 41;
/** A bot's rounds stop after this far, matching the hand weapon's own range. */
export const BOT_FIRE_RANGE = 600;
/** The MedPack's heal per trigger tick (bot-behaviours.js `MEDIC`): the
 *  soldier template's +0x2e0 default 0.1 per `useRepairPack` at 30 Hz. */
export const BOT_HEAL_PER_ROUND = 0.3;
/** A flag with no `timeToGetControl` of its own: the `ControlPointTemplate`
 *  ctor's 5.0 (+0x1f4, 0x08284774). */
export const CAPTURE_FALLBACK_SECONDS = 5;
/** The soldier's `setBattleStrength` table (`Objects/Soldiers/Common/AI/Objects.con`). */
export const BOT_SOLDIER_TABLE = { Infantry: 4.0, LightArmour: 2.0, HeavyArmour: 1.0, NavalArmour: 0.0, Submarine: 0.0, Air: 1.0 };
/** How far to the side of a hull a bot's body stands up (`botLeaveVehicle`). */
export const BOT_EXIT_OFFSET = 3.5;

const DEG_TO_RAD = Math.PI / 180;

// --- the capture law ---------------------------------------------------------

/** A flag's capture radius: its template's, else 8 m. */
export function captureRadius(flag) {
  return Number.isFinite(flag?.radius) && flag.radius > 0 ? flag.radius : 8;
}

/** Seconds on a flag to take it: its `timeToGetControl`, else the fallback. */
export function captureDuration(flag) {
  return Number.isFinite(flag?.timeToGetControl) && flag.timeToGetControl > 0
    ? flag.timeToGetControl : CAPTURE_FALLBACK_SECONDS;
}

/**
 * A flag's control-point settings: the level's where the scene carries them,
 * else the `ControlPointTemplate` ctor's (0x082846d0): `timeToGetControl`
 * +0x1f4 5.0, `timeToLoseControl` +0x1f8 5.0, `disableIfEnemyInsideRadius`
 * +0x1fc 0, `disableWhenLosingControl` +0x1fd 0, `loseControlWhenEnemyClose`
 * +0x1fe 1, `loseControlWhenNotClose` +0x1ff 0, `minNrToTakeControl` +0x204
 * 1, `onlyTakeableByTeam` +0x214 0. The four bytes are written by
 * ConsoleClass637..640 (0x083064e0, 0x083068f0, 0x08306d00, 0x08307110) in
 * the order the setters are registered from 0x082a1f62; `onlyTakeableByTeam`
 * +0x214 and `minNrToTakeControl` +0x204 are ConsoleClass649 / 650
 * (`executeObjectMethod` 0x083093d0, 0x083097e0), `unableToChangeTeam`
 * +0x200 ConsoleClass648 (0x08308fc0). The level exporter (`bf42/level.py`
 * `ControlPointTemplate`) carries every one of them, null where the level
 * keeps the ctor's value: vanilla sets `timeToLoseControl 10` on most flags
 * and `loseControlWhenEnemyClose 0` on 26 of 367.
 */
export function controlPointSettings(flag) {
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const flagOf = (v, d) => (v === undefined || v === null ? d : !!v);
  return {
    timeToGet: captureDuration(flag),
    timeToLose: num(flag?.timeToLoseControl, 5),
    disableIfEnemyInside: flagOf(flag?.disableIfEnemyInsideRadius, false),
    loseWhenEnemyClose: flagOf(flag?.loseControlWhenEnemyClose, true),
    loseWhenNotClose: flagOf(flag?.loseControlWhenNotClose, false),
    minNr: num(flag?.minNrToTakeControl, 1),
    onlyTeam: num(flag?.onlyTakeableByTeam, 0),
  };
}

/**
 * One frame of `ControlPoint::handleFrameUpdate` 0x08283b00 for one flag.
 * `teams` lists the team of every living player inside its radius (the 3D
 * distance to the player's controlled object). The point keeps `flag.team`
 * (+0x174, 0 neutral), a lose timer (+0x168), a get timer (+0x16c), the
 * team getting it (+0x170) and a state (+0x17c: 1 lost, 2 losing, 3
 * getting, 4 held) in `flag._cp`. Returns `{ lost: team }` when the owner
 * loses it (`lostControl` 0x08284090: team 0), `{ got: team }` when a team
 * takes it (`gotControl` 0x08283f70), else null.
 *
 *  - A player of the owning team inside: with an attacker too and
 *    `loseControlWhenEnemyClose`, the lose timer runs (`losingControl`
 *    0x08284030) and at 0 the point is lost; else it is held
 *    (`control` 0x08283fe0 resets both timers).
 *  - Attackers of two teams and no owner's player: nothing changes.
 *  - Attackers of one team alone: an owned point runs its lose timer and is
 *    lost at 0; a neutral one, when no other team is getting it and at
 *    least `minNrToTakeControl` attackers are in, runs the get timer
 *    (`gettingControl` 0x08283f20) and is taken at 0; otherwise the timers
 *    reset (`faildGettingControl` 0x08283ef0).
 *  - Nobody: a neutral point resets; an owned one is lost over time only
 *    with `loseControlWhenNotClose`, else held.
 *  `onlyTakeableByTeam` (+0x214) stops losing, getting and taking by any
 *  other team. `disableIfEnemyInsideRadius` / `disableWhenLosingControl`
 *  only disable the point's spawns (`CPDisabled`), not ported.
 */
export function controlPointStep(flag, teams, dt) {
  const cfg = controlPointSettings(flag);
  const cp = flag._cp ?? (flag._cp = { lose: cfg.timeToLose, get: cfg.timeToGet, getting: 0, state: 4 });
  const owner = flag.team ?? 0;
  let defended = false, attacker = 0, count = 0;
  for (const team of teams) {
    if (team === owner) { defended = true; continue; }
    if (attacker && team !== attacker) return null;       // two attacking teams: 0x08283b9d
    attacker = team;
    count++;
  }
  const allowed = team => !cfg.onlyTeam || cfg.onlyTeam === team;
  const hold = () => { cp.state = 4; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose; };
  const losing = team => {
    if (!allowed(team)) return null;
    if (cp.lose > 0) { cp.state = 2; cp.lose -= dt; return null; }
    if (cp.state !== 2) return null;
    cp.state = 1;
    flag.team = 0;
    return { lost: owner, by: team };
  };
  if (defended && owner) {
    if (attacker && cfg.loseWhenEnemyClose) return losing(attacker);
    hold();
    return null;
  }
  if (attacker) {
    if (owner) return losing(attacker);
    if ((cp.getting === 0 || cp.getting === attacker) && count >= cfg.minNr) {
      if (!allowed(attacker)) return null;
      if (cp.get > 0) { cp.state = 3; cp.getting = attacker; cp.get -= dt; return null; }
      flag.team = attacker;
      cp.getting = 0;
      hold();
      return { got: attacker };
    }
    cp.getting = 0; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose;
    return null;
  }
  if (!owner) { cp.getting = 0; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose; return null; }
  if (cfg.loseWhenNotClose) {
    if (cp.lose > 0) { cp.state = 2; cp.lose -= dt; return null; }
    if (cp.state !== 2) return null;
    cp.state = 1;
    flag.team = 0;
    return { lost: owner, by: null };
  }
  hold();
  return null;
}

/**
 * The closest flag `team` does not hold whose radius reaches `position`
 * (`[x, y, z]`), or null. `ControlPoint::handleFrameUpdate` 0x08283b00: the
 * 3D distance from the point to the player's controlled object (the hull,
 * when mounted) against the template radius (+0x1dc).
 */
export function nearestEnemyFlag(flags, team, position) {
  if (!position) return null;
  let nearest = null;
  let distance = Infinity;
  for (const flag of flags ?? []) {
    if (flag.uncapturable || !flag.position || flag.team === team) continue;
    const dx = position[0] - flag.position[0];
    const dz = position[2] - flag.position[2];
    const dy = Number.isFinite(position[1]) ? position[1] - flag.position[1] : 0;
    const d = Math.hypot(dx, dy, dz);
    if (d <= captureRadius(flag) && d < distance) {
      nearest = flag;
      distance = d;
    }
  }
  return nearest;
}

/**
 * The cover objects the TakeCover behaviour chooses among: every collider
 * owner whose template carries `aiTemplatePlugIn.coverValue` (`extras.ai.
 * coverValues`), with its footprint from its baked triangles.
 */
export function buildBotCovers(world) {
  const values = world?.extras?.ai?.coverValues;
  const statics = world?.collider?.statics;
  if (!values || !statics?.tris || !statics.ownerNodes) return [];
  const byOwner = new Map();
  const tris = statics.tris, owners = statics.owners;
  for (let t = 0; t < statics.count; t++) {
    const owner = owners[t];
    if (owner < 0) continue;
    let e = byOwner.get(owner);
    if (e === undefined) {
      const name = (statics.ownerNodes[owner]?.name ?? '').toLowerCase();
      const value = values[name] ?? values[name.replace(/_\d+$/, '')] ?? null;
      if (value == null) { byOwner.set(owner, null); continue; }
      e = { id: owner, value, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
      byOwner.set(owner, e);
    }
    if (!e) continue;
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const x = tris[o + k * 3], y = tris[o + k * 3 + 1], z = tris[o + k * 3 + 2];
      if (x < e.minX) e.minX = x; if (x > e.maxX) e.maxX = x;
      if (y < e.minY) e.minY = y; if (y > e.maxY) e.maxY = y;
      if (z < e.minZ) e.minZ = z; if (z > e.maxZ) e.maxZ = z;
    }
  }
  const out = [];
  for (const e of byOwner.values()) {
    if (!e) continue;
    const width = Math.max(e.maxX - e.minX, e.maxZ - e.minZ);
    out.push({
      id: e.id, value: e.value,
      pos: [(e.minX + e.maxX) / 2, e.minY, (e.minZ + e.maxZ) / 2],
      width, height: e.maxY - e.minY, radius: width / 2,
    });
  }
  return out;
}

/** Terrain-blocked line of sight (the same stand-in as bot.js `checkLOS`). */
export function lineOfSight(collider, from, to) {
  if (!collider?.surfaceHeight) return true;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.min(10, Math.max(1, Math.ceil(distance / 0.8)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const surface = collider.surfaceHeight(from[0] + dx * t, from[2] + dz * t);
    if (!Number.isFinite(surface)) continue;
    if (surface > from[1] + dy * t + 0.5) return false;
  }
  return true;
}

/**
 * Roll a direction into a deviation cone of half-angle `spreadRad`, exactly as
 * `round-launch.js` `wander` does: theta = spread * sqrt(u), azimuth free, about
 * the frame u = normalize(ref x r), v = r x u. `r` must be unit length.
 */
export function rollCone(r, spreadRad) {
  const [rx, ry, rz] = r;
  if (!(spreadRad > 0)) return [rx, ry, rz];
  const theta = spreadRad * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  let ux, uy, uz;
  if (Math.abs(ry) > 0.99) { ux = 0; uy = -rz; uz = ry; } else { ux = rz; uy = 0; uz = -rx; }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ry * uz - rz * uy, vy = rz * ux - rx * uz, vz = rx * uy - ry * ux;
  const c = Math.cos(theta), s = Math.sin(theta);
  return [
    rx * c + ux * s * Math.cos(phi) + vx * s * Math.sin(phi),
    ry * c + uy * s * Math.cos(phi) + vy * s * Math.sin(phi),
    rz * c + uz * s * Math.cos(phi) + vz * s * Math.sin(phi),
  ];
}

/**
 * Build the referee.
 *
 * `env`:
 *  - `world()`: the World the bots live in;
 *  - `units`: the vehicles the bots can see and take -- `candidates()`,
 *    `enter(bot, cand)` (seat him; returns the controller's mount record or
 *    null), `leave(bot)` (give the seat back; returns the `{x, y, z}` his body
 *    stands up beside), `switchSeat(bot, cand)` (returns the new mount record
 *    or null), `destroyed(bot)`, `attackerOf(bot)`, `seatOf(playerId)` (`{
 *    vehicleId, seatId }` or null), `unitInfo(playerId)`, `vehicleNav()`,
 *    `invalidate()`, `tick()`; absent: no vehicles;
 *  - `groundAt(x, z, fromY)`: the floor a body stands up on;
 *  - `armorFor(bot, flag)`: a fresh Armor for a (re)spawned body;
 *  - `roundDamage(stats, material, distance)`: one round's direct-hit HP from a
 *    weapon's fire data, on the capsule material it met, at the distance it
 *    flew (the falloff);
 *  - `debug`: log hits, heals and seats to the console (the page's `?botDebug`);
 *  - `friendlyFire`: the server's friendly-fire percentages
 *    (`friendly-fire.js`); absent, the shipped `ServerSettings.con`'s;
 *  - hooks, all optional: `beforeBots()`, `tickBot(bot, dt, now)` (replaces
 *    `bot.tick`), `afterBotTick(bot, dt)`, `onRedeploy(bot, flag)`,
 *    `onRespawned(bot, flag)`, `onShot(bot, at)` (once per round, a flown
 *    one included), `launchRound(bot, stats)` (true: the caller put this
 *    round in flight and bills its landing, so it is not resolved here; the
 *    page's rocket launchers, the runner has none), `onHit(bot, hit)`,
 *    `damageTarget(hit, bot, at)` (true: the caller billed a non-bot target),
 *    `damageHull(bot, damage, opts)` (true: a mounted bot's hull took it),
 *    `defaultAttackerPos()`, `onHurt(bot, lost)`, `onDeath(bot, attackerId,
 *    opts)` (`opts.seated`: he died in his seat), `seatedBodyAt(playerId)`
 *    (a seated player's stand-in body, see `referee.bodyAt`),
 *    `capsulesOf(playerId)` (the drawn body's hit capsules, `rig-capsules.js`,
 *    or null where nobody draws him), `onHealed(playerId, armor, before)`, `mountedFire(bot, dt)`,
 *    `captureEnabled()`, `onCapture(bot, flag, prevTeam)`, `onMounted(bot,
 *    cand, mount)`, `onDismounted(bot, mount, opts)`, `onSeatSwitched(bot,
 *    cand)`, `onStrategyChange(side, from, to)`, `onBotCreated(bot)`.
 */
export function createBotReferee(env) {
  const referee = {
    /** Every bot's controller. */
    bots: [],
    /** Seconds since the bots were spawned (the controllers' `now`). */
    clock: 0,
    /** The infantry map (nav-grid.js). */
    navGrid: null,
    /** The strategic AI, or null on a level with no AI data. */
    strategy: null,
    covers: [],
    /** Each side's view of the enemy's strengths (`SAI` +0x174 / +0x18c). */
    enemyTables: { 1: new EnemyStrengthTables(), 2: new EnemyStrengthTables() },
    tablesAt: -Infinity,
  };
  const world = () => env.world();
  const units = () => env.units ?? null;
  const botOf = id => referee.bots.find(b => b.playerId === id) ?? null;

  /**
   * A level change: the bots, their clock, the infantry map, the strategic AI,
   * the covers and the enemy tables are the old level's. The page calls this
   * when a level starts to go (`level-load.js` `show()`, through its
   * `resetBots`), not when the next one spawns: the frames in between keep
   * ticking the referee, and from the moment the new World is built an old
   * bot would be ticked against a world that has no record of him, on the old
   * level's map. `spawn` starts from here too. The units layer's own maps and
   * doors are its `reset()`'s.
   */
  referee.reset = () => {
    referee.clock = 0;
    referee.bots = [];
    referee.navGrid = null;
    referee.strategy = null;
    referee.covers = [];
    referee.enemyTables = { 1: new EnemyStrengthTables(), 2: new EnemyStrengthTables() };
    referee.tablesAt = -Infinity;
  };

  /**
   * Spawn bots on both sides, the way the engine's bot manager tops up each
   * team: the navigation map from the level's collider (the engine's own
   * metre bitmap, flood-seeded from every soldier spawn point), `spawnBots`
   * (which owns flag filtering; the world's `spawnPlayer` owns placement),
   * the strategic AI on the level's `AI/*.con` data (without it a bot walks
   * to the nearest enemy flag), the covers, and a body per bot. Returns the
   * nav map's build time in ms.
   */
  referee.spawn = ({ count, botSkill, teams, kitFor, viewDistance = null }) => {
    const w = world();
    referee.reset();
    const worldSize = w.extras?.worldSize || 2048;
    const seeds = [];
    for (const flag of w.flags ?? []) {
      for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    }
    const navStarted = performance.now();
    referee.navGrid = buildNavMap(w.collider, worldSize, { waterLevel: w.collider?.waterLevel, seeds });
    const navMs = performance.now() - navStarted;
    referee.bots = spawnBots({ world: w, count, botSkill, teams, flags: w.flags, kitFor, viewDistance });
    // The strategic interface (doctrine.js) is the one order source: it runs
    // the engine's SAI and asks each side's doctrine (`env.doctrine`, default
    // the SAI itself) for the orders.
    referee.strategy = w.extras?.ai?.strategicAreas?.length
      ? new StrategicCommand(new StrategicAI(new StrategicLayer(w.extras.ai, w.flags), {
        isWalkable: (x, z) => isWalkable(referee.navGrid, x, z),
        unitOf: id => referee.strategicUnit(id),
        spottedOf: id => botOf(id)?.senses?.memory?.size ?? 0,
      }), {
        doctrine: env.doctrine ?? null,
        isWalkable: (x, z) => isWalkable(referee.navGrid, x, z),
        unitOf: id => referee.strategicUnit(id),
        healthOf: id => {
          const a = w.armorOf(id);
          return a?.maxHitPoints > 0 ? a.hitPoints / a.maxHitPoints : 1;
        },
        enemyTablesOf: side => referee.enemyTables?.[side] ?? null,
        candidatesOf: () => units()?.candidates() ?? [],
        // The Use key, as a plan's EnterVehicle / ExitVehicle press it.
        actuators: {
          enter: (id, candId) => { const b = botOf(id); if (b && !b.vehicle) b.enterRequest = { vehicleId: candId }; },
          exit: id => { const b = botOf(id); if (b?.vehicle) b.exitRequest = true; },
        },
      })
      : null;
    referee.covers = buildBotCovers(w);
    for (const bot of referee.bots) {
      bot.navGrid = referee.navGrid;
      bot.covers = referee.covers;
      bot.unitInfoOf = id => referee.unitInfo(id);
      bot.vehicleCandidates = [];
      referee.strategy?.addBot(bot.playerId, bot.team);
      // The world steps bots, so each needs the Armor the soldier tick and
      // the combat area read (`#soldierTick`, `#combatTick`).
      const flag = w.player(bot.playerId)?.flag ?? null;
      w.setPlayerArmor(bot.playerId, env.armorFor(bot, flag));
      env.onBotCreated?.(bot);
    }
    return navMs;
  };

  /** Per frame (the page) or per tick (the runner), after the world step. */
  referee.tick = (dt) => {
    if (!referee.bots.length) return;
    const w = world();
    referee.clock += dt;
    // The strategic pass (once per `SAI.updateFrequency`), then each bot's
    // order for this tick.
    const strategy = referee.strategy;
    if (strategy) {
      const alive = new Map();
      for (const bot of referee.bots) {
        if (w.armorOf(bot.playerId)?.destroyed) continue;
        alive.set(bot.playerId, bot.getPosition());
      }
      const before = env.onStrategyChange ? [1, 2].map(s => strategy.sides[s]?.active?.strategy?.name) : null;
      strategy.update(dt, alive);
      if (before) {
        [1, 2].forEach((side, i) => {
          const now = strategy.sides[side]?.active?.strategy?.name;
          if (now !== before[i]) env.onStrategyChange(side, before[i] ?? null, now ?? null);
        });
      }
    }
    // `SAI::updateStrengths`: each side's enemy tables, once per strategic pass.
    if (referee.clock - referee.tablesAt >= SAI.updateFrequency) {
      referee.tablesAt = referee.clock;
      const occupied = referee.occupiedUnits();
      for (const side of [1, 2]) referee.enemyTables[side].update(occupied.filter(u => u.side !== side), referee.clock);
    }
    for (const bot of referee.bots) {
      bot.enemyTables = referee.enemyTables[bot.team] ?? null;
      // The side's knowledge of the enemy the bot's sightings refresh.
      if (bot.senses) bot.senses.knowledge = bot.enemyTables?.knowledge ?? null;
    }
    env.beforeBots?.();
    referee.vehicleTick();
    for (const bot of referee.bots) {
      if (referee.respawnTick(bot, dt)) continue;   // dead and waiting out its timer
      bot.waypoints = strategy?.waypointsOf(bot.playerId) ?? null;
      if (env.tickBot) env.tickBot(bot, dt, referee.clock);
      else bot.tick(dt, referee.clock);
      env.afterBotTick?.(bot, dt);
      // A bot that could not walk out of its spawn after four escapes is
      // redeployed to the flag's next spawn point -- the deploy screen's own
      // `advance`, not a teleport out of the world. See `bot.js` `_trackStuck`.
      // Never a seated one: his body is the hull's, and the page used to put
      // his soldier back on the flag while he stayed in the seat (the
      // runner's copy had already stopped it; this is that copy's rule).
      if (bot._needsRespawn) {
        bot._needsRespawn = false;
        bot._stalledTicks = 0;
        bot._pathFailures = 0;
        bot.route = null;
        const record = w.player(bot.playerId);
        if (record?.flag && !bot.vehicle) {
          w.spawnPlayer(bot.playerId, { flag: record.flag, advance: true });
          bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
          bot._lastX = null;
          bot._lastZ = null;
          env.onRedeploy?.(bot, record.flag);
        }
      }
    }
    referee.fireTick(dt);
  };

  /**
   * Run a dead bot's respawn timer. Returns true while it is still down, so
   * the caller skips its tick. On expiry the side puts it back on one of its
   * own flags with a fresh body -- the same `spawnPlayer` + `setPosition`
   * pair the stuck-bot redeploy uses, not a teleport out of the world.
   */
  referee.respawnTick = (bot, dt) => {
    const w = world();
    const armor = w.armorOf(bot.playerId);
    if (!armor?.destroyed) return false;
    bot._respawnIn = (bot._respawnIn ?? BOT_RESPAWN_DELAY) - dt;
    if (bot._respawnIn > 0) return true;
    const teamFlags = w.flags.filter(f => f.team === bot.team);
    const flag = teamFlags.length
      ? teamFlags[Math.floor(Math.random() * teamFlags.length)]
      : (w.player(bot.playerId)?.flag ?? null);
    w.spawnPlayer(bot.playerId, { flag, advance: true, group: bot.team });
    const record = w.player(bot.playerId);
    w.setPlayerArmor(bot.playerId, env.armorFor(bot, record?.flag ?? flag));
    if (record?.soldier) bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
    // A new soldier is a new kit, full (the human's own rule, `kit-ammo.js`):
    // the magazines are made again from the data on the next frame.
    bot._mags?.clear();
    bot._respawnIn = 0;
    bot.onRespawn();
    env.onRespawned?.(bot, record?.flag ?? flag);
    return false;
  };

  // --- fire -----------------------------------------------------------------

  /** The fire data of the weapon a bot holds right now, or null while loading. */
  referee.weaponDataOf = bot => {
    const name = bot.weaponAi?.name ?? bot.kitPrimary ?? null;
    return name ? bot.weaponData?.[name] ?? null : null;
  };

  /**
   * `name`'s magazine on this bot, `{ rounds, spare, size, reloadTime,
   * reloadLeft, autoReload }` (`fireArms.magazine`: the loaded magazine, the
   * spares, the reload in progress), or null while the weapon's fire data has
   * not arrived. An entry is only ever made FROM the data: the page hands it
   * over asynchronously (map.html `loadBotWeapons` fetches each weapon's glb),
   * and an entry made on the bot's first tick, before it landed, read the
   * missing size as unlimited and was kept for good -- no bot on the page ever
   * reloaded, and a Bazooka (`magSize 1`, `reloadTime 5.6`) fired once a
   * second, at its `roundOfFire 1.0`, for as long as it was held. A size of 0
   * or below is the engine's unlimited magazine (the knife's -1).
   */
  referee.magazineOf = (bot, name) => {
    if (!name) return null;
    if (!bot._mags) bot._mags = new Map();
    let mag = bot._mags.get(name);
    if (mag) return mag;
    const m = bot.weaponData?.[name]?.magazine;
    if (!m) return null;
    const size = m.size > 0 ? m.size : 0;
    mag = size
      ? { rounds: size, spare: Math.max(0, (m.magazines ?? 1) - 1), size, reloadTime: m.reloadTime ?? 0,
          reloadLeft: 0, autoReload: !!m.autoReload }
      : { rounds: Infinity, spare: 0, size: 0, reloadTime: 0, reloadLeft: 0, autoReload: false };
    bot._mags.set(name, mag);
    return mag;
  };

  /**
   * The bot's magazines, once a frame: every carried weapon's rounds left
   * (`w.rounds`, the sum over its magazines, `FireArms::getTotalAmmo`
   * 0x0828cb60), and the held one's reload. Its magazine answers whether a
   * round can leave, and the two words the fire plan reads:
   * `bot.magazineEmpty`, and `bot.magazineEndsPlan`, whether an empty
   * magazine ends the plan -- `createFirePlan` 0x085ac240 adds that break
   * (the shared `BAPConWeaponMagAmmo(weapon, 0, false)`) only for a weapon
   * without `autoReload` (`hasAutoReload` 0x085ee890) whose `getNMags`
   * (0x085ef650, the magazines it carries) is not 1. A Bazooka's plan
   * therefore rides its round's fire cycle and 5.6 s reload out aiming, as
   * the engine's does (ledger AI-130).
   *
   * PARITY DEPARTURE, measured (features/bot-weapons, ledger AI-132): `BBFire::
   * calculateUrgency` 0x08563570 divides a weapon's strength by `(20 (shots
   * - hits) + 10) / getAmmo` (`WeaponFireArmReal::getAmmo`, the same total).
   * Handed the kit's real counts, the page's bots -- who land about 5 % of
   * their rounds at 40 m -- ran a few seconds of misses on one target up
   * against an SMG's 150 rounds (about 22 misses) or a pistol's 32 (two) and
   * took their knives, unlimited at 1.0: in a 30 s squad fight seven of the
   * eight drew them, the two AT soldiers for 98 % and 93 % of it. The
   * AI entry's `ammo` keeps the reading the page always had, unlimited
   * (-1) while the weapon has a round, and 0 when it is dry, so `BBFire`
   * drops a dry weapon; open until the bots' accuracy is held against the
   * engine's.
   */
  referee.magazineTick = (bot, dt) => {
    for (const w of bot.weapons ?? []) {
      const m = referee.magazineOf(bot, w?.name);
      if (!m || !Number.isFinite(m.rounds)) continue;
      w.rounds = m.rounds + m.spare * m.size;
      w.ammo = w.rounds > 0 ? -1 : 0;
    }
    const mag = referee.magazineOf(bot, bot.weaponAi?.name ?? null);
    if (!mag) {
      bot.magazineEmpty = false;
      bot.magazineEndsPlan = false;
      return { canFire: true };
    }
    if (mag.reloadLeft > 0) {
      mag.reloadLeft = Math.max(0, mag.reloadLeft - dt);
      if (mag.reloadLeft === 0) { mag.rounds = mag.size; mag.spare -= 1; }
    } else if (mag.rounds <= 0 && mag.spare > 0 && !(bot._fireCooldown > 0)) {
      // Not before the last round's fire cycle has run out: the engine's
      // reload message (`FireArms::handleMessage` 9, 0x082895c0), whoever
      // sends it, starts `Reload` only once `timeToFireFinished` is spent,
      // and `Fire` 0x0828a090 sets that to 1 / roundOfFire (ledger AI-133).
      // A Bazooka's reload starts a second after its round, so it fires one
      // every 6.6 s, and the round's fire clip plays out before the reload's.
      mag.reloadLeft = mag.reloadTime > 0 ? mag.reloadTime : 1e-6;
    }
    const canFire = mag.reloadLeft === 0 && mag.rounds > 0;
    bot.magazineEmpty = mag.rounds <= 0;
    bot.magazineEndsPlan = !mag.autoReload && mag.spare > 0;
    mag.canFire = canFire;
    return mag;
  };

  referee.magazineShot = (bot, mag) => {
    if (!mag || !Number.isFinite(mag.rounds)) return;
    mag.rounds = Math.max(0, mag.rounds - 1);
  };

  /**
   * Resolve one bot round against the world's players: down the aim, rolled
   * into the deviation cone, against the first soldier in its way, with a
   * terrain line of sight. `aimAt` lays the round on a point's height (the
   * runner's stand-in turret). Returns `{ targetId, damage, dist }` or null.
   * Friend or foe: the engine's round meets anyone but its shooter and the
   * crew of the hull he fires from (ledger FF-1, `roundPasses`), and a
   * friend's hit is priced by `calcDamage` (FF-3, `friendlyDamage`). Only the
   * bot's choice of target is his own side's business (`SideFilter`).
   */
  /**
   * Where `playerId`'s stand-in body is: `{ x, y, z }` at the feet, or null
   * when a round cannot meet him. On foot that is his soldier. In a seat it is
   * whatever `env.seatedBodyAt` says -- the page draws a seated man only where
   * the seat declares a SeatObject, and only a man who is drawn can be hit --
   * and a caller that does not answer for this player (`undefined`) leaves him
   * on his soldier, which is what every seated target was before.
   */
  referee.bodyAt = playerId => {
    const player = world()?.player(playerId);
    if (!player) return null;
    if (player.occupancy?.root) {
      const seated = env.seatedBodyAt?.(playerId);
      // Tagged, so the round that meets him is his and not his hull's.
      if (seated !== undefined) return seated && { ...seated, seated: true };
    }
    return player.soldier ?? null;
  };

  /** `playerId`'s hit capsules this frame, where a body is drawn. */
  referee.capsulesOf = playerId => env.capsulesOf?.(playerId) ?? null;

  /**
   * Resolve a round against the world's players. A drawn body is met through
   * the engine's own capsules (`skeleton-hit.js`), first capsule in
   * declaration order; one nobody draws through the stand-in sphere.
   * `damageFor(material, distance)`, when given, prices the round for the
   * capsule's material -- head 40, chest 41, limbs 42, each its own defence
   * group; the stand-in's is `BOT_BODY_MATERIAL` -- at the distance it flew,
   * which `Projectile::getDamage` falls off over (ledger DMG-3, IMP-6).
   */
  referee.resolveShot = (bot, damage, aimAt = null, damageFor = null) => {
    const w = world();
    const { origin, dir } = bot.aimRay();
    let d = dir;
    if (aimAt) {
      const dx = aimAt[0] - origin[0], dy = aimAt[1] + BOT_BODY_HEIGHT - origin[1], dz = aimAt[2] - origin[2];
      const h = Math.hypot(dx, dz) || 1;
      const pitch = Math.atan2(dy, h);
      const yaw = Math.atan2(dir[0], dir[2]);
      d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    }
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const [cx, cy, cz] = rollCone([d[0] / len, d[1] / len, d[2] / len], (bot.aimDeviation ?? 0) * DEG_TO_RAD);
    const me = w.player(bot.playerId);
    let best = null, bestT = Infinity;
    for (const [id, player] of w.players) {
      if (roundPasses(w, bot.playerId, id)) continue;
      if (w.armorOf(id)?.destroyed) continue;
      const s = referee.bodyAt(id);
      if (!s) continue;
      const met = meetSoldier(origin, [cx, cy, cz], BOT_FIRE_RANGE, {
        capsules: referee.capsulesOf(id),
        center: [s.x, s.y + BOT_BODY_HEIGHT, s.z], radius: BOT_BODY_RADIUS,
      });
      if (!met || met.t >= bestT) continue;
      if (!lineOfSight(w.collider, origin, met.at)) continue;
      bestT = met.t;
      const priced = damageFor ? damageFor(met.material ?? BOT_BODY_MATERIAL, met.t) : damage;
      best = {
        targetId: id, dist: met.t, material: met.material,
        // A man seated in a hull is priced as the hull (his root) is.
        damage: friendlyDamage(priced, {
          attackerTeam: me?.team ?? null, victimTeam: player.team ?? null, soldier: !s.seated,
          settings: env.friendlyFire ?? FRIENDLY_FIRE_SHIPPED,
        }),
        hit: roundHit(origin, met.at, s.y, s.seated, met.bone),
      };
    }
    return best;
  };

  referee.lineOfSight = (from, to) => lineOfSight(world()?.collider, from, to);

  /**
   * The friend a healing bot's round reaches: the closest player of its own
   * side inside the weapon's `maxRange` of its eye and within 20 deg of its
   * aim (`BAPALookAtObject`'s 5 deg has already lined the bot up).
   */
  referee.resolveHeal = bot => {
    const w = world();
    const { origin, dir } = bot.aimRay();
    const range = bot.weaponAi?.maxRange ?? 2.5;
    const me = w?.player(bot.playerId);
    let best = null, bestD = Infinity;
    for (const [id, player] of w.players) {
      if (id === bot.playerId || !me || player.team !== me.team) continue;
      const armor = w.armorOf(id);
      if (!armor || armor.destroyed || armor.hitPoints >= armor.maxHitPoints) continue;
      const s = player.soldier;
      if (!s) continue;
      const dx = s.x - origin[0], dy = (s.y + 1.0) - origin[1], dz = s.z - origin[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > range + 0.5 || d >= bestD) continue;
      const cos = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / Math.max(d, 1e-3);
      if (cos < Math.cos(20 * Math.PI / 180)) continue;
      best = id; bestD = d;
    }
    return best;
  };

  referee.applyHeal = (playerId, amount) => {
    const armor = world()?.armorOf(playerId);
    if (!armor) return;
    const before = armor.hitPoints;
    const healed = armor.heal(amount);
    if (env.debug && healed > 0 && Math.floor(armor.hitPoints / 5) !== Math.floor(before / 5)) {
      console.log(`[bots] ${playerId} healed to ${armor.hitPoints.toFixed(1)}/${armor.maxHitPoints}`);
    }
  };

  /**
   * One frame of bot fire. The trigger, its rate and its report; the round's
   * cone and its damage. Runs after the bots' ticks, so `bot.isFiring` is
   * this frame's decision. Dead bots are not skipped: their trigger is up
   * (death clears `isFiring`), but a reload in progress keeps running.
   */
  referee.fireTick = dt => {
    if (!referee.bots.length) return;
    for (const bot of referee.bots) {
      bot._wasFiring = bot.isFiring;
      // A mounted bot's guns are the hull's: the page's world fires them
      // from the bot's input word and each round meets whoever is in its way;
      // the runner fires its stand-in guns here. His hand weapon's magazine
      // is not the seat's: a plane's attack plan reads `magazineEmpty` too.
      if (bot.vehicle) {
        bot.magazineEmpty = false;
        env.mountedFire?.(bot, dt);
        continue;
      }
      // The rate-of-fire timer runs down whether or not the trigger is held
      // and keeps its fraction across a held burst, as the human's gun does
      // (gun-cycle.js `advanceGroups`): an idle gun owes nothing (floored
      // at 0), a held one fires at its own `roundOfFire` whatever the frame
      // rate. Restarted from a full period each round, a 9 rps Mp40 fired
      // 8.57 rounds a second at 60 fps (7 frames a round) and 7.5 at 30.
      // It is the engine's `timeToFireFinished`, and it runs down before the
      // magazine's tick, whose reload waits for it, as `FireArms::
      // handleUpdate` 0x08288890 counts it down before it asks for one.
      bot._fireCooldown = (bot._fireCooldown ?? 0) - dt;
      const mag = referee.magazineTick(bot, dt);
      if (!bot.isFiring || !mag.canFire) bot._fireCooldown = Math.max(0, bot._fireCooldown);
      if (!bot.isFiring || bot._fireCooldown > 0 || !mag.canFire) continue;
      // The bot's own weapon's rate (`fireArms.roundOfFire`), not the human's.
      const stats = referee.weaponDataOf(bot);
      const rof = stats?.roundOfFire > 0 ? stats.roundOfFire : BOT_FALLBACK_ROF;
      bot._fireCooldown = Math.max(-1 / rof, bot._fireCooldown) + 1 / rof;
      referee.magazineShot(bot, mag);
      bot.deviation.onShot();
      bot.onShot(referee.clock);
      // Every round is a sound (`event_soundEmitter`): each bot hears it
      // inside the weapon's AI sound radius, and the shooter goes deaf for 3 s.
      const at = bot.getPosition();
      env.onShot?.(bot, at);
      const radius = bot.weaponAi?.soundSphereRadius ?? null;
      for (const other of referee.bots) other.onShotFired(bot.playerId, bot.team, at, referee.clock, radius);
      // A healing weapon's round (the MedPack): a friend within its reach and
      // in front of the pack is healed instead of anything being shot.
      if (bot.weaponAi?.healing) {
        const friend = referee.resolveHeal(bot);
        if (friend) referee.applyHeal(friend, BOT_HEAL_PER_ROUND);
        continue;
      }
      // A round the caller flies (`env.launchRound`: the page's rocket
      // launchers, `bot-rounds.js`) is resolved where it lands -- the direct
      // hit, the splash, a hull -- and billed from there, not here.
      if (env.launchRound?.(bot, stats)) continue;
      const hit = referee.resolveShot(bot, env.roundDamage(stats), null,
                                      (material, distance) => env.roundDamage(stats, material, distance));
      if (!hit) continue;
      bot.recordHit(hit.targetId);
      env.onHit?.(bot, hit);
      // A round that found a bot damages that bot; the caller bills anyone
      // else (the page's human).
      if (env.damageTarget?.(hit, bot, at)) continue;
      referee.applyDamage(hit.targetId, hit.damage, bot.playerId, at,
                          { weapon: bot.weaponAi?.name ?? null, dist: hit.dist, hit: hit.hit });
    }
  };

  // --- damage ---------------------------------------------------------------

  /**
   * Damage one bot. A seated bot's round lands on his hull (the caller's
   * `damageHull`), except the kill a destroyed hull hands its crew. A killing
   * round parks the bot: `damageLanded` below.
   *
   * `opts`: `via` (the debug log's tag), `weapon`, `shell`, `dist`, and `hit`,
   * the round's meeting with the body (`roundHit`), which becomes his latest
   * collision -- what `soldier-death.js` falls by. A `hit.seated` round met a
   * seated man's drawn body (`bodyAt`), not his hull, so it is his.
   */
  referee.applyDamage = (playerId, damage, attackerId = null, attackerPos = null, opts = {}) => {
    const armor = world()?.armorOf(playerId);
    if (!armor || armor.destroyed) return;
    const bot = botOf(playerId);
    if (opts.hit) armor.lastHit = opts.hit;
    if (bot?.vehicle && !opts.hit?.seated && damage < 1e5
        && env.damageHull?.(bot, damage, { ...opts, attackerId })) return;
    const lost = armor.damage(damage);
    referee.damageLanded(playerId, lost, attackerId, attackerPos, opts);
  };

  /**
   * A bot's Armor has just lost `lost` HP (already applied, by `applyDamage`
   * or by a splash): log it, raise the incoming-fire event and handle a death.
   */
  referee.damageLanded = (playerId, lost, attackerId = null, attackerPos = null, opts = {}) => {
    const armor = world()?.armorOf(playerId);
    if (!armor) return;
    const bot = botOf(playerId);
    if (env.debug) {
      const via = opts.via ?? '';
      console.log(`[bots] ${attackerId} hit ${playerId} for ${Math.round(lost * 10) / 10}: ${Math.round(armor.hitPoints * 10) / 10}/${armor.maxHitPoints}`
                  + (armor.destroyed ? ' (killed)' : '') + (via ? ` [${via}]` : ''));
    }
    if (bot) {
      // `event_projectile`: the hit is incoming fire, x10 for having landed.
      // Not for the world's own damage (`opts.environment`: barbed wire),
      // which no projectile delivered and no shooter stands behind.
      if (!opts.environment) {
        const from = attackerPos ?? env.defaultAttackerPos?.() ?? null;
        bot.onIncomingFire(attackerId, from, referee.clock, true, 1);
      }
      if (!armor.destroyed && lost > 0) env.onHurt?.(bot, lost);
    }
    if (!armor.destroyed || !bot) return;
    // Read before the leave below stands him up beside the hull: a man killed
    // in his seat dies in it (`BFSoldier::handleDamage`'s first branch).
    const seated = !!bot.vehicle;
    if (bot.vehicle) referee.leaveVehicle(bot, { killed: true });
    bot.isFiring = false;
    bot.firingTarget = null;
    bot._respawnIn = BOT_RESPAWN_DELAY;
    referee.strategy?.botDied(playerId);
    env.onDeath?.(bot, attackerId, { ...opts, seated });
  };

  // --- capture ----------------------------------------------------------------

  /**
   * The control points' own law (`controlPointStep`, `ControlPoint::
   * handleFrameUpdate` 0x08283b00) once a frame for every flag the level can
   * lose, over every living player (the human included) whose controlled
   * object is inside its radius. The owner's player on the point keeps it
   * or, with an enemy there too (`loseControlWhenEnemyClose`, set on most
   * vanilla flags), lets it run down to neutral; a neutral point is taken
   * only by one team alone on it. Before, each bot ran its own timer and
   * took the flag from under its defenders: two enemies on one flag traded
   * it every `timeToGetControl` for minutes. `onCapture(bot, flag, prevTeam,
   * takers)` fires for a flag taken (`bot` the taking team's first bot on it,
   * null when only the human was; `takers` every player id of that team
   * inside the radius) and `onNeutralise(bot, flag, prevTeam)` for one
   * lost to neutral. The engine counts only a player with its +0x79 byte set
   * (INFERRED: alive); a dead bot's body no longer counts.
   */
  referee.captureTick = dt => {
    if (!(dt > 0)) return;
    if (env.captureEnabled && !env.captureEnabled()) return;
    const w = world();
    if (!w?.flags?.length) return;
    const botById = new Map(referee.bots.map(b => [b.playerId, b]));
    const players = [];
    for (const [id, p] of w.players ?? []) {
      if (!p?.team || w.armorOf?.(id)?.destroyed) continue;
      const bot = botById.get(id);
      const pos = bot ? bot.getPosition() : playerPosition(p);
      if (pos) players.push({ id, team: p.team, pos, bot });
    }
    for (const flag of w.flags) {
      if (flag.uncapturable || !flag.position) continue;
      const r = captureRadius(flag);
      const inside = players.filter(q => {
        const dy = Number.isFinite(q.pos[1]) ? q.pos[1] - flag.position[1] : 0;
        return Math.hypot(q.pos[0] - flag.position[0], dy, q.pos[2] - flag.position[2]) <= r;
      });
      const prevTeam = flag.team ?? 0;
      const ev = controlPointStep(flag, inside.map(q => q.team), dt);
      if (!ev) continue;
      const team = ev.got ?? ev.by;
      const bot = inside.find(q => q.team === team && q.bot)?.bot ?? null;
      // The takers are everyone of the taking team inside the radius at the
      // moment it turned, which is who the page pays the capture score to
      // (INFERRED: the engine's own recipient set is behind a vtable call).
      const takers = inside.filter(q => q.team === team).map(q => q.id);
      if (ev.got) env.onCapture?.(bot, flag, prevTeam, takers);
      else env.onNeutralise?.(bot, flag, prevTeam);
    }
  };

  // --- the enemy tables and the targets' descriptions ------------------------

  /**
   * `SAI::updateStrengths`' input: every occupied unit -- a seated player's
   * seat with its table and class, a soldier on foot with the soldier's --
   * by player id, for the side's security of it (bot-strength.js).
   */
  referee.occupiedUnits = () => {
    const out = [];
    const w = world();
    if (!w) return out;
    const u = units();
    const cands = u ? u.candidates() : [];
    for (const [id, p] of w.players) {
      if (w.armorOf(id)?.destroyed) continue;
      const side = p.team;
      const seat = u?.seatOf(id) ?? null;
      if (seat) {
        const c = cands.find(x => x.vehicleId === seat.vehicleId && x.seatId === seat.seatId)
          ?? cands.find(x => x.vehicleId === seat.vehicleId && x.isRoot) ?? null;
        out.push({ id, side, table: c?.strengths ?? {}, type: c?.strType ?? seat.strType ?? p.vehicleStrType ?? 'LightArmour',
                   template: c?.template ?? null });
      } else if (p.soldier) {
        out.push({ id, side, table: BOT_SOLDIER_TABLE, type: 'Infantry' });
      }
    }
    return out;
  };

  /** What a target is, for `scoreVehicleTargets`: a seated player's hull with
   *  every seat (the units layer's answer), else a soldier. */
  referee.unitInfo = id => {
    const p = world()?.player(id);
    if (!p) return null;
    const info = units()?.seatOf(id) ? units().unitInfo(id) : null;
    if (info) return info;
    return { type: 'Infantry', air: false, table: BOT_SOLDIER_TABLE, maxSpeed: 5, seats: null, enemyManned: false,
             mobile: true, vehicle: false, extents: [0.6, 1.8, 0.6] };
  };

  /**
   * The unit a bot controls, for `orderNormalBot`: its search type (the
   * `setOrderPosition` key), the test of its own search map (the Mobile
   * plug-in's map: Tank0 for a tank, the water maps for a hull afloat, the
   * infantry map on foot), its bounding radius, and whether it is mounted.
   * A car routes on the Tank map, so it tests that one. An aircraft is
   * ordered by `orderAirBot` (strategic.js `_orderAir`), at the area's
   * position over the higher of the ground and the water.
   */
  referee.strategicUnit = id => {
    const bot = botOf(id);
    const m = bot?.vehicle;
    if (!m) {
      return { type: 'Infantery', isWalkable: referee.navGrid ? (x, z) => isWalkable(referee.navGrid, x, z) : null,
               radius: 1.0, mounted: false };
    }
    // The hull's own search type where the level lists them (bot-units.js
    // `typeNav`: a vanilla jeep is a `Tank` unit), else by drive kind.
    const type = m.searchType ? m.searchType : m.kind === 'tank' ? 'Tank' : m.kind === 'ground' ? 'Car'
      : m.kind === 'ship' ? (m.landingCraft ? 'LandingCraft' : 'Boat')
      : m.kind === 'air' ? 'Plane' : 'Infantery';
    const nav = m.nav ?? (m.kind === 'tank' || m.kind === 'ground' ? units()?.vehicleNav() ?? null : null);
    return { type, isWalkable: nav ? (x, z) => isWalkable(nav, x, z) : null, radius: m.radius ?? 1.0, mounted: true,
             air: m.kind === 'air', root: !!m.isRoot, fixed: m.kind === 'gun', groundAt: (x, z) => bot._groundAt(x, z) };
  };

  // --- seating ------------------------------------------------------------------

  /** Seat a bot in `cand`'s seat. Returns true when it sits. */
  referee.enterVehicle = (bot, cand) => {
    const u = units();
    if (!u) return false;
    const mount = u.enter(bot, cand);
    if (!mount) return false;
    const record = world().player(bot.playerId);
    if (record) record.vehicleStrType = cand.strType;
    // `BotMain::decisionMaking` 0x08520742: a bot whose controlled object
    // changed tells its SAI (`setBotHasChangedEquipment` -> `handleChangingBot`
    // 0x08631450), which drops its assignment and frees it for a fresh order.
    referee.strategy?.botChangedUnit(bot.playerId);
    bot.mount(mount, referee.clock);
    u.invalidate?.();
    env.onMounted?.(bot, cand, mount);
    return true;
  };

  /** Unseat a bot: the seat goes back to its hull, the soldier steps out
   *  beside it, and the controller is told. */
  referee.leaveVehicle = (bot, { killed = false, silent = false } = {}) => {
    const m = bot.vehicle;
    if (!m) return;
    const w = world();
    const p = units()?.leave(bot) ?? { x: bot.position[0], y: bot.position[1], z: bot.position[2] };
    const record = w.player(bot.playerId);
    if (record) { record.vehicleStrType = null; record.position = null; }
    const soldier = record?.soldier;
    // The hull's heading, read while he still holds the seat.
    const f = bot._vehicleForward();
    if (soldier) {
      // Out where the seat says (`setSoldierExitLocation`, `units.leave`), as
      // the human steps out; without one, through the side: re-spawned beside
      // the hull (its position is the body's, `Soldier.spawn` is the
      // placement API). The side step put a soldier leaving Bocage's Allied
      // AA gun inside its sandbag ring, where the route out crossed the bags.
      const x = p.exit ? p.exit.x : p.x + f[1] * BOT_EXIT_OFFSET, z = p.exit ? p.exit.z : p.z - f[0] * BOT_EXIT_OFFSET;
      // At the exit's own height, lifted only onto ground above it; `spawn`'s
      // settle then stands him on whatever is underneath, the hull he left
      // included. Snapping to `groundAt` alone missed that hull: it answers
      // terrain, sea and static decks, so a beached landing craft's
      // passengers, whose exits are on its floor, came out on the sand under
      // the bow, boxed in by the hull and the ramp.
      const exitY = p.exit?.y ?? p.y;
      const y = env.groundAt(x, z, exitY + 3);
      const yy = Number.isFinite(y) ? Math.max(y + 0.05, exitY) : exitY;
      soldier.spawn(x, yy, z, p.exit ? p.exit.yaw : Math.atan2(f[0], f[1]));
      bot.setPosition(soldier.x, soldier.y, soldier.z);
    }
    bot.dismount(referee.clock);
    // Out of a landing craft's hold, over the bow before anything else
    // (doctrine-landing.js `disembarkPath`, bot-route.js `steerToward`).
    const path = soldier && !killed && LANDING_CRAFT_RE.test(m.template ?? '')
      ? disembarkPath(w.collider, soldier.x, soldier.y, soldier.z, p.x, p.z, f[0], f[1])
      : null;
    bot._disembark = path ? { points: path, until: referee.clock + DISEMBARK.timeout, arrive: DISEMBARK.arrive } : null;
    referee.strategy?.botChangedUnit(bot.playerId);
    units()?.invalidate?.();
    env.onDismounted?.(bot, m, { killed, silent });
  };

  /** `BBPChangeTeleport`: the seat-select key moves the bot within the hull.
   *  The hull does not move and nobody steps out; the controller is told it
   *  left one unit and took another, as the engine's controlled object
   *  changes. */
  referee.switchSeat = (bot, cand) => {
    const u = units();
    const mount = u?.switchSeat(bot, cand);
    if (!mount) return false;
    bot.dismount(referee.clock);
    const record = world().player(bot.playerId);
    if (record) record.vehicleStrType = cand.strType;
    referee.strategy?.botChangedUnit(bot.playerId);
    bot.mount(mount, referee.clock);
    u.invalidate?.();
    env.onSeatSwitched?.(bot, cand, mount);
    return true;
  };

  /** Per tick: seat the bots that asked, unseat the ones that asked or whose
   *  hull is gone (the engine kills a destroyed hull's occupants). */
  referee.vehicleTick = () => {
    const u = units();
    if (!u) return;
    u.tick?.();
    const cands = u.candidates();
    for (const bot of referee.bots) {
      bot.vehicleCandidates = cands;
      if (bot.vehicle) {
        const m = bot.vehicle;
        if (u.destroyed(bot)) {
          const attacker = u.attackerOf?.(bot) ?? null;
          referee.leaveVehicle(bot, { killed: true });
          referee.applyDamage(bot.playerId, 1e6, attacker, null, { via: m.template ? `hull ${m.template}` : '' });
          continue;
        }
        if (bot.exitRequest) {
          bot.exitRequest = false;
          referee.leaveVehicle(bot);
        } else if (bot.switchRequest) {
          const req = bot.switchRequest;
          bot.switchRequest = null;
          const cand = cands.find(c => c.vehicleId === req.vehicleId && c.seatId === req.seatId);
          if (cand && !cand.occupiedBy && cand.vehicleId === m.vehicleId && referee.switchSeat(bot, cand)) {
            if (env.debug) console.log(`[bots] ${bot.playerId} switches to seat ${cand.seatId} of the ${cand.template}`);
          }
        }
        continue;
      }
      const req = bot.enterRequest;
      if (!req) continue;
      bot.enterRequest = null;
      const cand = cands.find(c => c.id === req.vehicleId);
      if (cand && !cand.occupiedBy) referee.enterVehicle(bot, cand);
    }
  };

  return referee;
}
