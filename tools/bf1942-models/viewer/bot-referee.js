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

import { buildNavMap, isWalkable, OUTSIDE_MAP_MATERIAL } from './nav-grid.js';
import { spawnBots } from './bot.js';
import { newPathBudget } from './bot-route.js';

/** `?nopathbudget`: every bot searches unbudgeted, the pre-budget behaviour,
 *  for an A/B in the page (features/bot-path-budget). */
const PATH_BUDGET_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nopathbudget');
import { flagSide, spawnOffered } from './spawn-flags.js';
import { spawnReadyAt, waveSecondsLeft } from './spawn-timer.js';
import { wantsSeat, SPAWN_STANDS } from './spawn-seat.js';
import { EnemyStrengthTables } from './bot-strength.js';
import { disembarkPath, DISEMBARK, LANDING_CRAFT_RE } from './doctrine-landing.js';
import { playerPosition } from './bot-sense.js';
import { footingAt } from './bot-pose.js';
import { SAI, StrategicLayer, StrategicAI, StrategicCommand } from './strategic.js';
import { roundHit } from './soldier-death.js';
import { meetSoldier } from './skeleton-hit.js';
import { barrelRays } from './bot-barrels.js';
import { botDeviate, botInputIndex, declaredBarrels, deviationIndex, footInputIndex } from './bot-deviation.js';
import { FireState, reloadAmmo } from './fire-state.js';
import { firePeriod } from './gun-cycle.js';
import { FRIENDLY_FIRE_SHIPPED, friendlyDamage, roundPasses } from './friendly-fire.js';
import { disarmTarget, healingPackKind, medPackHeals, packParams, repairPackTarget, worldHulls } from './healing-packs.js';

// A downed bot waits for the reinforcement wave, as every player does
// (SPAWN-35: `GameServer::killPlayer` 0x0814d920 sets `BFPlayer+0x8c` with no
// AI test at 0x0814dee8..0x0814df13, and `gameStatusPlaying` spawns a dead
// bot once it is spent, 0x08152917..0x08152987). It replaced a flat 8 s of
// our own (`BOT_RESPAWN_DELAY`). The wave clock is the round's
// (`env.roundClock`, `round-state.js` `clock`); `spawn-timer.js` has the law.
/**
 * Rounds/second for a hand weapon whose fire data never arrived. Once the
 * extraction lists every weapon a kit carries (`extract_models.py`
 * `kit_weapon_templates`) the items with no `extras.weapon` are the thrown,
 * placed and swung ones, and the grenades' `roundOfFire` is 1.0 (FH's smoke
 * grenades and Eihandgranate; the bolt rifles 0.77-1.0). The old stand-in,
 * 8 rounds a second and an unlimited magazine, fired a smoke grenade like an
 * SMG (ledger AI-155).
 */
export const BOT_FALLBACK_ROF = 1.0;
/** Seconds a held weapon may have no fire data before it is read as "none":
 *  the glb is fetched once a bot spawns (map.html `loadBotWeapons`), and a bot
 *  that fires meanwhile fires blind. Nothing leaves the weapon in the window. */
export const BOT_WEAPON_DATA_WAIT = 3;
/** A soldier body's stand-in radius and origin height (INVENTION). The height
 *  is physics.js `CHARACTER_HEIGHT`. */
/**
 * The held weapon's `isReadyToUse` on a page bot, from the referee's own
 * timers: `FireArms::isReadyToUse` lnxded 0x0828f510 answers false while the
 * eject-clip (0x0828fc40), reload (0x0828fcb0) or overheat (0x0828fd20) timer
 * is positive, while the fire timer (`timeToFireFinished`, +0x170 via
 * 0x0828fd60) is positive and below the round's own period (+0x234,
 * `1 / roundOfFire`: `fucompp` at 0x0828f629, so the shot's own tick still
 * answers true), while a `fireDelay` round is owed (+0x294 at 0x0828f5b0),
 * and with the loaded magazine empty (`mags()[0] <= 0` and not the endless
 * -1, 0x0828f5ec..0x0828f608). The stance change's torso gate asks it
 * (BODY-2, `SoldierActions.stanceChanged`). A bot the referee has not armed
 * yet answers true, as a soldier with no hand weapon passes the gate.
 */
export function botWeaponReady(bot) {
  if (!bot) return true;
  if (bot._throwRound || bot._altRound) return false;
  const cool = bot._fireCooldown ?? 0;
  if (cool > 0 && !(cool >= (bot._firePeriod ?? 0))) return false;
  const name = bot.weaponAi?.name ?? bot.kitPrimary ?? null;
  if (!name) return true;
  const mag = bot._mags?.get?.(name);
  if (mag) {
    if (mag.reloadLeft > 0 || mag.ejectLeft > 0) return false;
    if (!(mag.rounds > 0)) return false;
  }
  const heat = bot._heat?.get?.(name);
  if (heat && heat.overheatRemaining > 0) return false;
  return true;
}

export const BOT_BODY_RADIUS = 0.6;
export const BOT_BODY_HEIGHT = 1.0;
/** How far from the body centre any capsule of a drawn body can reach, in
 *  any pose (a prone man's boots 1.2 m out, a raised rifle 1 m up) plus the
 *  fattest capsule: the broadphase sphere a round must pass through before
 *  the body's capsules are built for it (`resolveShot`). */
export const BOT_BODY_REACH = 2.5;
/** The material a round is priced against when it meets the stand-in body,
 *  which has no capsules: the torso's (`Bip01_Spine2`, 41), the largest of the
 *  eight and the one most rounds meet (INVENTION: the engine always has the
 *  capsules, ledger DIE-10). Not the soldier object's own material 40, which is
 *  the head capsule's: pricing every stand-in hit as a head shot made a Colt
 *  round 17.5 where the torso's is 10 (DMG-3). */
export const BOT_BODY_MATERIAL = 41;
/** A bot's rounds stop after this far, matching the hand weapon's own range. */
export const BOT_FIRE_RANGE = 600;
/** The soldier's `setBattleStrength` table (`Objects/Soldiers/Common/AI/Objects.con`). */
export const BOT_SOLDIER_TABLE = { Infantry: 4.0, LightArmour: 2.0, HeavyArmour: 1.0, NavalArmour: 0.0, Submarine: 0.0, Air: 1.0 };
/** How far to the side of a hull a bot's body stands up (`botLeaveVehicle`). */
export const BOT_EXIT_OFFSET = 3.5;


// --- the capture law ---------------------------------------------------------

// The law itself lives in control-point-law.js (pure, shared with the
// capture-ring estimate); re-exported here for the referee's callers.
export { CAPTURE_FALLBACK_SECONDS, captureRadius, captureDuration, controlPointSettings,
  controlPointStep, nearestEnemyFlag } from './control-point-law.js';
import { captureRadius, controlPointStep } from './control-point-law.js';
import { createAIRadio } from './bot-radio.js';
import { createPortalPassing } from './bot-portal.js';

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
      e = { id: owner, value, template: values[name] != null ? name : name.replace(/_\d+$/, ''),
            minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
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
      // The template (its mesh's name: `coverPortals` is keyed by it) and
      // the footprint, for the hull's TakeCover (bot-decision.js).
      template: e.template, footprint: [e.minX, e.minZ, e.maxX, e.maxZ],
      // The scene node, for its world matrix (bot-portal.js).
      node: statics.ownerNodes[e.id] ?? null,
    });
  }
  return out;
}

/**
 * Whether the ray from `origin` along the unit `(dx, dy, dz)` passes within
 * `r` of `center` somewhere in `[-r, maxT + r]` along it: a conservative
 * superset of every capsule hit on a body whose capsules lie within `r` of
 * that centre, including a shooter standing inside the sphere.
 */
export function withinReach(origin, dx, dy, dz, maxT, center, r) {
  const cx = center[0] - origin[0], cy = center[1] - origin[1], cz = center[2] - origin[2];
  const t = cx * dx + cy * dy + cz * dz;
  if (t < -r || t > maxT + r) return false;
  return cx * cx + cy * cy + cz * cz - t * t <= r * r;
}

/** Terrain-blocked line of sight (the same stand-in as bot.js `checkLOS`). */
/**
 * How far a round gets along `dir` before the ground stops it, or null while
 * it is clear for the whole `range`.
 *
 * The same march as `lineOfSight`, without its half-metre of slack: that
 * slack is there so a bot may see over a lip, and a round does not. A round
 * is an object that bursts where it meets the world (ledger IMP-2), so its
 * passing crack (`passing-rounds.js`, SND-37) stops at the hill rather than
 * carrying on through it to the end of its life. Damage never needed this —
 * `resolveShot` already refuses a body it has no line to — so this only
 * shortens the sound.
 *
 * Sampled, not solved: 0.8 m steps to a cap of 32, so the answer is coarse to
 * `range / 32` (about 3 m at a bot's longest shot) and a ridge thinner than a
 * step can be missed. That is deliberate. It runs for every round a bot fires
 * and the crack is only audible within about 10 m of the line, so a few
 * metres of overshoot is inaudible where 300 m through a mountain is not
 * (`features/bot-fight-performance`). `lineOfSight` caps at 10 for the same
 * reason.
 */
export function groundReach(collider, origin, dir, range) {
  if (!collider?.surfaceHeight || !(range > 0)) return null;
  const steps = Math.min(32, Math.max(1, Math.ceil(range / 0.8)));
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * range;
    const surface = collider.surfaceHeight(origin[0] + dir[0] * t, origin[2] + dir[2] * t);
    if (!Number.isFinite(surface)) continue;
    if (surface > origin[1] + dir[1] * t) return t;
  }
  return null;
}

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
 *  - `holdFire`: false turns off the bots' hold-fire for a teammate in the
 *    line (INVENTION, bot-plans.js `holdFireFor`); absent, it is on;
 *  - hooks, all optional: `beforeBots()`, `tickBot(bot, dt, now)` (replaces
 *    `bot.tick`), `afterBotTick(bot, dt)`, `onRedeploy(bot, flag)`,
 *    `onRespawned(bot, flag)`, `onShot(bot, at)` (once per round, a flown
 *    one included), `onReload(bot, weapon)` (a magazine change has begun),
 *    `onEject(bot, weapon)` (the clip of an `ejectClipTime` weapon has left it),
 *    `launchRound(bot, stats)` (true: the caller put this
 *    round in flight and bills its landing, so it is not resolved here; the
 *    page's rocket launchers, the runner has none), `onHit(bot, hit)`,
 *    `damageTarget(hit, bot, at)` (true: the caller billed a non-bot target),
 *    `damageHull(bot, damage, opts)` (true: a mounted bot's hull took it),
 *    `defaultAttackerPos()`, `onHurt(bot, lost)`, `onDeath(bot, attackerId,
 *    opts)` (`opts.seated`: he died in his seat), `seatedBodyAt(playerId)`
 *    (a seated player's stand-in body, see `referee.bodyAt`),
 *    `capsulesOf(playerId)` (the drawn body's hit capsules, `rig-capsules.js`,
 *    or null where nobody draws him), `soldierBones(player)` (his skeleton's bones
 *    for the bots' sense rays and aim, `{ count, at(i) }` or a list, in his body
 *    frame; from the same skeleton as `capsulesOf`),
 *    `onHealed(playerId, armor, before)`, `mountedFire(bot, dt)`,
 *    `soldierBody()` and `soldierTemplateOf(team)` (the packs' numbers, `usePack`),
 *    `packHulls()` (the wrench's hulls, `healing-packs.js` shape; absent, the World's),
 *    `packRounds()` and `retireRound(shot)` (the live rounds a crouched wrench may
 *    lift, `gunfire.js` `disarmRounds` / `retireRound`; absent, nothing is lifted),
 *    `captureEnabled()`, `onCapture(bot, flag, prevTeam)`, `onMounted(bot,
 *    cand, mount)`, `onDismounted(bot, mount, opts)`, `onSeatSwitched(bot,
 *    cand)`, `onStrategyChange(side, from, to)`, `onBotCreated(bot)`,
 *    `roundClock()` (the round's clock, which the respawn wave runs on),
 *    `spawnParams()` (the wave law's parameters, `spawn-timer.js`; absent, retail's).
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
    /** The bots' ear (`AIRadio`, bot-radio.js): what the players' radio
     *  messages raise in each bot. `env.mod()` picks the subscriptions. */
    radio: createAIRadio({ mod: env.mod?.() ?? 'bf1942' }),
  };
  const world = () => env.world();
  const units = () => env.units ?? null;
  const botOf = id => referee.bots.find(b => b.playerId === id) ?? null;
  /** The wave clock (SPAWN-35): the round's own (`env.roundClock()`,
   *  `round-state.js` `clock`, 0 at `resetTimers`), else the referee's. */
  const waveClock = () => {
    const c = env.roundClock?.();
    return Number.isFinite(c) ? c : referee.clock;
  };
  /** The wave law's parameters: the host's (`env.spawnParams()`: single
   *  player's flat wait, the owner's choice, `spawn-timer.js`
   *  `singlePlayerSpawnParams`), or retail's defaults where it names none. */
  const waveParams = () => env.spawnParams?.() ?? undefined;

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
    referee.firstLivesPending = false;
    referee.strategy = null;
    referee.covers = [];
    referee.enemyTables = { 1: new EnemyStrengthTables(), 2: new EnemyStrengthTables() };
    referee.tablesAt = -Infinity;
    referee.radio = createAIRadio({ mod: env.mod?.() ?? 'bf1942' });
  };

  /**
   * A player's radio message, as `GameServer::radioMessage` 0x0813a120 hands
   * it to the AI (`AIRadio::sendMessage` 0x08482650 at 0x0813a26a): `id` the
   * message after the sender's remap, `team` his side, `speakerId` his
   * player id, `at` [x, y, z] of what he controls, `broadcast` true for team
   * radio. Every bot of his side that is alive and within 70 m of a shout
   * (any distance for team radio) takes it (bot-radio.js).
   */
  referee.radioMessage = (id, { team, speakerId = null, at = null, broadcast = false }) => {
    const w = world();
    const bots = referee.bots.map(b => ({
      playerId: b.playerId, team: b.team, position: b.getPosition?.() ?? b.position,
      dead: !!w?.armorOf?.(b.playerId)?.destroyed,
    }));
    referee.radio.send(id, { team, speakerId, at, broadcast, bots });
  };

  /**
   * A human's Use or seat key met a seat a bot holds. `toggleEntryPoint`
   * 0x0814ee70 (no free door in reach, `BFfindEntryPoint`'s out pointer
   * holding the nearest held one, 0x0814f1b6..0x0814f21a) and the seat
   * switch in `checkPlayerTriggers` 0x0814fb07..0x0814fb63 (the target seat
   * occupied) both call `IBotManager::playerRequestPlayerControlObject(
   * player, holder)` (vt+0x40, `BotManager` 0x0849c7f0) when the server
   * runs AI, the presser is no bot and the holder is one. The manager wants
   * the two on one side (`+0x7c`) and the holder alive (vt+0xbc); the bot's
   * `BotMain::playerRequestPlayerControlObject` 0x0852ed40 wants the side
   * again and the bot in a vehicle (not its soldier, vt+0x4c(0x16)), and
   * stores its current unit and the time (`+0x1e4` / `+0x1e8`). Nothing
   * moves now: the bot's next Change weighs that seat at `age / 15` of
   * itself for 15 s (bot-vehicle.js `unitUrgency`), so it climbs out or
   * moves seats when that decision wins and its bail is allowed. A second
   * press restarts the clock. Returns true when the request was stored.
   */
  referee.requestSeat = (requesterTeam, holderId) => {
    const bot = botOf(holderId);
    if (!bot || bot.team !== requesterTeam) return false;
    if (world()?.armorOf?.(bot.playerId)?.destroyed) return false;
    const seat = bot.vehicle;
    if (!seat) return false;
    bot.seatRequest = { id: seat.id, at: referee.clock };
    return true;
  };

  /**
   * Spawn bots on both sides, the way the engine's bot manager tops up each
   * team: the navigation map from the level's collider (the engine's own
   * metre bitmap, flood-seeded from every soldier spawn point), `spawnBots`
   * (which owns flag filtering; the world's `spawnPlayer` owns placement),
   * the strategic AI on the level's `AI/*.con` data (without it a bot walks
   * to the nearest enemy flag), the covers, and a body per bot. `nameFor`
   * names each bot as the server does (`bot-names.js`). Returns the nav
   * map's build time in ms.
   */
  referee.spawn = ({ count, botSkill, teams, kitFor, nameFor = null, viewDistance = null }) => {
    const w = world();
    referee.reset();
    const worldSize = w.extras?.worldSize || 2048;
    const seeds = [];
    for (const flag of w.flags ?? []) {
      for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    }
    const navStarted = performance.now();
    // The outside-map material blocked as the engine's painter blocks it
    // (AI-27, `OUTSIDE_MAP_MATERIAL`); a level with a baked map is unchanged.
    referee.navGrid = buildNavMap(w.collider, worldSize, { waterLevel: w.collider?.waterLevel, seeds,
      impassableMaterial: OUTSIDE_MAP_MATERIAL });
    const navMs = performance.now() - navStarted;
    referee.bots = spawnBots({ world: w, count, botSkill, teams, flags: w.flags, kitFor, nameFor, viewDistance });
    // Each bot on foot fires at an input index of its own, one a life
    // (bot-deviation.js, ledger AI-145); `respawn` takes the next.
    for (const bot of referee.bots) {
      bot.lives = 0;
      bot.inputIndex = footInputIndex(bot.playerId, 0);
    }
    // The strategic interface (doctrine.js) is the one order source: it runs
    // the engine's SAI and asks each side's doctrine (`env.doctrine`, default
    // the SAI itself) for the orders.
    referee.strategy = w.extras?.ai?.strategicAreas?.length
      ? new StrategicCommand(new StrategicAI(new StrategicLayer(w.extras.ai, w.flags), {
        isWalkable: (x, z) => isWalkable(referee.navGrid, x, z),
        unitOf: id => referee.strategicUnit(id),
        spottedOf: id => botOf(id)?.senses?.memory?.size ?? 0,
        sampleOf: (id, toSide) => referee.strategicSample(id, toSide),
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
    referee.portals = createPortalPassing();
    referee.portalPlanes = null;
    for (const bot of referee.bots) {
      bot.navGrid = referee.navGrid;
      bot.covers = referee.covers;
      bot.portalPassing = referee.portals;
      bot.coverPortalPlanes = () => units()?.aiCoverPortalPlanes ?? null;
      bot.unitInfoOf = id => referee.unitInfo(id);
      bot.vehicleCandidates = [];
      // The hold-fire for a teammate in the line (INVENTION, bot-plans.js
      // `holdFireFor`): on unless the caller turns it off (`env.holdFire`
      // false: the runner's engine-parity runs, the page's `?holdfire=0`).
      bot.holdFire = env.holdFire !== false;
      referee.strategy?.addBot(bot.playerId, bot.team);
      // The world steps bots, so each needs the Armor the soldier tick and
      // the combat area read (`#soldierTick`, `#combatTick`).
      const flag = w.player(bot.playerId)?.flag ?? null;
      w.setPlayerArmor(bot.playerId, env.armorFor(bot, flag));
      env.onBotCreated?.(bot);
    }
    referee.firstLivesPending = referee.bots.length > 0;
    return navMs;
  };

  /**
   * A bot's first life is a spawn like any other (`GameServer::spawnPlayer`,
   * SPAWN-27): a point that only seats (`setEnterOnSpawn`, fao_landing's
   * eleven British landing boats) is somewhere to spawn while its seat is
   * free, and a bot stood on a seat point is put in that seat. `spawnBots`
   * cannot ask a seat, so it skips such points and seats nobody; the first
   * life is redone here, as `respawnTick` does it, for a side that has a seat
   * point. A side without one keeps its first life exactly as it was. Each
   * seat is taken as it is given, so the next bot on the same point is handed
   * the next free one.
   *
   * The hulls land after the bots do, so this runs on the first tick that has
   * a seat to give (`units.candidates`), for each bot still on his first life
   * and on foot, or gives up after `FIRST_LIFE_WAIT` seconds.
   */
  const FIRST_LIFE_WAIT = 15;
  referee.placeFirstLives = () => firstLives(world());
  function firstLives(w) {
    const u = units();
    const seatPoint = f => (f.spawns ?? []).some(p => wantsSeat(p, true));
    if (!u?.spawnSeat || !w.flags.some(seatPoint) || referee.clock > FIRST_LIFE_WAIT) {
      referee.firstLivesPending = false;
      return;
    }
    if (!u.candidates().length) return;
    referee.firstLivesPending = false;
    const index = { 1: 0, 2: 0 };
    for (const bot of referee.bots) {
      if (bot.vehicle || (bot.lives ?? 0) > 0 || w.armorOf(bot.playerId)?.destroyed) continue;
      const sideFlags = w.flags.filter(f => flagSide(f) === bot.team && !f.captureOnly);
      if (!sideFlags.some(seatPoint)) continue;
      const seatFor = spawn => u.spawnSeat(spawn, bot.team);
      const offered = sideFlags.filter(f => spawnOffered(f, { ai: true, seatFor }));
      if (!offered.length) continue;
      const i = index[bot.team] = (index[bot.team] ?? 0) + 1;
      const flag = offered[(i - 1) % offered.length];
      const spawned = w.spawnPlayer(bot.playerId, { flag, advance: true, group: bot.team, ai: true, seatFor });
      if (!spawned) continue;
      const record = w.player(bot.playerId);
      w.setPlayerArmor(bot.playerId, env.armorFor(bot, record?.flag ?? flag));
      if (record?.soldier) bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
      if (!wantsSeat(spawned.spawn, true)) continue;
      const cand = seatFor(spawned.spawn);
      if (cand && cand !== SPAWN_STANDS) referee.enterVehicle(bot, cand);
    }
  }

  /** Per frame (the page) or per tick (the runner), after the world step. */
  /** Each unit's last passed portal (bot-portal.js, `getLastPassedPortal`),
   *  for the covers whose mesh has portals; built once the tree's planes are
   *  in. One distance test per such cover per unit per tick. */
  function stepPortals(w) {
    const planes = units()?.aiCoverPortalPlanes ?? null;
    if (!planes || !referee.portals) return;
    if (referee.portalPlanes !== planes) {
      referee.portalPlanes = planes;
      referee.portals.setCovers(referee.covers.filter(c => c.node && planes[c.template]?.length).map(c => ({
        id: c.id, planes: planes[c.template], matrix: () => c.node.matrixWorld.elements,
        centre: c.pos, reach: c.width / 2 + 4,
      })));
    }
    for (const [id, p] of w.players ?? []) {
      const s = p?.soldier;
      if (s && !w.armorOf?.(id)?.destroyed) referee.portals.step(id, [s.x, s.y + 1.0, s.z]);   // the body's middle, not its feet
    }
  }

  referee.tick = (dt) => {
    if (!referee.bots.length) return;
    const w = world();
    referee.clock += dt;
    // What the bots hear is the mod's own `Game/AI/radio.con`, which the
    // tree's AI file carries (`vehicle-ai.json` `radio`, bot-units.js
    // `aiRadio`); a tree without it keeps the table `env.mod()` picked.
    const radioRows = units()?.aiRadio ?? null;
    if (radioRows && referee.radio.source !== radioRows) referee.radio.subscribe(radioRows);
    // `AIMain::action` steps the radio every pass (`AIRadio::update`
    // 0x08482330, which acts only once half a second has gone by).
    referee.radio.update(referee.clock);
    stepPortals(w);
    if (referee.firstLivesPending) referee.placeFirstLives();
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
    // The tick's pathfinding slice, shared by every bot's route searches
    // (AI-6; `bot-route.js` `newPathBudget`). `?nopathbudget` is the control.
    if (!PATH_BUDGET_OFF) (referee.pathBudget ??= newPathBudget()).begin();
    for (const bot of referee.bots) {
      if (referee.respawnTick(bot, dt)) continue;   // dead and waiting out its timer
      bot.radio = referee.radio;
      bot.pathBudget = PATH_BUDGET_OFF ? null : referee.pathBudget;
      bot.waypoints = strategy?.waypointsOf(bot.playerId) ?? null;
      // A generated layer's side the SAI could only order to hold (doctrine.js `noLayerOrder`).
      bot.noLayerOrder = !!strategy?.noLayerOrder?.(bot.playerId);
      // The side's standing gun rule (doctrine.js `gunsRuleOf`), for the
      // seconds between a unit change and the next pass.
      bot.gunsRule = strategy?.gunsRuleOf?.(bot.playerId) ?? null;
      // Where a soldier's skeleton is posed, a bot's sense rays and its aim go
      // to his bones (`bot-sense.js` `_rays`, ledger AI-123): the same
      // skeleton `capsulesOf` hangs his capsules on. A respawn makes the
      // bot new senses, so the hook is put back here.
      if (env.soldierBones && bot.senses && bot.senses.soldierBones !== env.soldierBones) {
        bot.senses.soldierBones = env.soldierBones;
      }
      if (env.tickBot) env.tickBot(bot, dt, referee.clock);
      else bot.tick(dt, referee.clock);
      env.afterBotTick?.(bot, dt);
      // The SAI's teleporter list (`BBPChangeTeleport`'s re-deploy plan,
      // bot-mount.js `planChange`).
      if (bot.teleportRequest) {
        bot.teleportRequest = false;
        referee.handleTeleportingBot(bot);
      }
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
   * `SAI::handleTeleportingBot` 0x08631390, the engine's one re-deploy of a
   * living bot: `BBPChangeTeleport::createPlan` 0x08590590 registers the bot
   * (`SAI::registerTeleporter` 0x086369c0) when a human has asked for its
   * seat on a ship and the hull has no better seat for it (AI-173), and
   * `SAI::prepareUpdate` 0x08635210 answers on its next pass: a suitable
   * spawn group of the side (`BotSpawner::findSuitableSpawnGroup`
   * 0x0864b3e0; none, nothing happens), `setIsInTransitionPhase(true)`,
   * `handleDeadBot` (the SAI drops its order), `AIPlayer::setSpawnGroup`,
   * and `BFEnvironment::teleportBot` 0x085e54b0, which is
   * `GameServer::reSpawnPlayer` 0x0814c4b0: the player out of what it
   * controls (0x0814c586), its soldier set on a point of the group
   * (`getSpawnPoint`, `setTransformation` 0x0814c679), a `reSpawnEvent`
   * logged. Nobody dies: no kill, no ticket, the same body with the hit
   * points and kit it had. Here it runs on the tick the plan asks, not the
   * SAI's next pass. The group is one of the side's the bot may spawn on,
   * as a dead bot's is chosen (`respawnTick`). True when the bot was moved.
   */
  referee.handleTeleportingBot = (bot) => {
    const w = world();
    const record = w?.player(bot.playerId);
    if (!record || w.armorOf(bot.playerId)?.destroyed) return false;
    const u = units();
    const seatFor = u?.spawnSeat ? spawn => u.spawnSeat(spawn, bot.team) : null;
    const offered = f => (seatFor ? spawnOffered(f, { ai: true, seatFor }) : !f.inactive && !f.enterOnly);
    const teamFlags = w.flags.filter(f => flagSide(f) === bot.team && !f.captureOnly && offered(f));
    if (!teamFlags.length) return false;
    const flag = teamFlags[Math.floor(Math.random() * teamFlags.length)];
    if (bot.vehicle) referee.leaveVehicle(bot);
    record.spawnIndex = Math.floor(Math.random() * 0x7fffffff);
    const spawned = w.spawnPlayer(bot.playerId, { flag, advance: false, group: bot.team, ai: !!seatFor, seatFor });
    if (!spawned) return false;
    const soldier = w.player(bot.playerId)?.soldier;
    if (soldier) bot.setPosition(soldier.x, soldier.y, soldier.z);
    bot._lastX = null;
    bot._lastZ = null;
    bot.route = null;
    bot.seatRequest = null;
    env.onRedeploy?.(bot, flag);
    // `reSpawnPlayer` presses Use on a seat point as a spawn does
    // (`toggleEntryPoint` at 0x0814c8f6).
    if (seatFor && wantsSeat(spawned.spawn, true)) {
      const cand = seatFor(spawned.spawn);
      if (cand && cand !== SPAWN_STANDS) referee.enterVehicle(bot, cand);
    }
    return true;
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
    // The wave (SPAWN-35): the wait `killPlayer` set at the death, or, for a
    // death no hit path saw (a wreck, the world's own damage), from the
    // first tick that finds the body down. `_respawnForce` is a restart's or
    // a check's "now" (`map.html` `restartRound`, `__botRespawn`).
    if (!bot._respawnForce) {
      const now = waveClock();
      if (!Number.isFinite(bot._respawnAt)) bot._respawnAt = spawnReadyAt(now, waveParams());
      bot._respawnIn = waveSecondsLeft(now, bot._respawnAt, waveParams());
      if (bot._respawnIn > 0) return true;
    }
    // A captured capture-only flag is the side's, and still nowhere to spawn;
    // nor is one whose every carrier is down (Weapon Bunkers' bunkers,
    // SPAWNGRP-10).
    //
    // A point that seats a bot (`setEnterOnSpawn`, `setAIEnterOnSpawn`) is
    // on while a seat he can take has a door within 15 m of it, and a group
    // is his to choose while any of its points is on
    // (`BFEnvironment::isEligibleSpawnpoint` 0x085e51d0: the group's team
    // his, not `OnlyForHuman`, `BFSpawnGroup::getActive(true)`; SPAWN-27).
    // With no vehicles to ask (a page with none, the headless sim) a seat
    // point is nowhere for him, as before.
    const u = units();
    const seatFor = u?.spawnSeat ? spawn => u.spawnSeat(spawn, bot.team) : null;
    const offered = f => (seatFor ? spawnOffered(f, { ai: true, seatFor }) : !f.inactive && !f.enterOnly);
    const teamFlags = w.flags.filter(f => flagSide(f) === bot.team && !f.captureOnly && offered(f));
    const flag = teamFlags.length
      ? teamFlags[Math.floor(Math.random() * teamFlags.length)]
      : (w.player(bot.playerId)?.flag ?? null);
    // Nowhere to stand up: still down, and asking again next tick, as the
    // engine's bot keeps choosing a group `spawnPlayer` refuses.
    // Which of the group's points: `BFSpawnGroup::getSpawnPoint` 0x08166f60
    // gathers the points `getActive` passes and takes `rand() % count`
    // (0x08167033..0x08167049), with no occupancy test. The per-player walk
    // (`advance`) is the human's, which a room pins (`spawnIndex`); for bots
    // it stood every pair whose indices agree modulo the group's size on one
    // point whenever the wave stood them together (SPAWN-35), and two bodies
    // on one spot wedge for the rest of the round. `Math.random` is the
    // runner's seeded generator (`sim/env.mjs` `seedMathRandom`), so a match
    // still replays. `pickSpawn` takes the index modulo the points it keeps.
    const record0 = w.player(bot.playerId);
    if (record0) record0.spawnIndex = Math.floor(Math.random() * 0x7fffffff);
    const spawned = w.spawnPlayer(bot.playerId, { flag, advance: false, group: bot.team, ai: !!seatFor, seatFor });
    if (!spawned) {
      bot._respawnIn = 0;
      return true;
    }
    bot._respawnAt = null;
    bot._respawnForce = false;
    const record = w.player(bot.playerId);
    w.setPlayerArmor(bot.playerId, env.armorFor(bot, record?.flag ?? flag));
    if (record?.soldier) bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
    // A new soldier is a new kit, full (the human's own rule, `kit-ammo.js`):
    // the magazines are made again from the data on the next frame.
    bot._mags?.clear();
    bot._heat?.clear();
    bot._respawnIn = 0;
    bot.onRespawn();
    bot.lives = (bot.lives ?? 0) + 1;
    bot.inputIndex = footInputIndex(bot.playerId, bot.lives);
    env.onRespawned?.(bot, record?.flag ?? flag);
    // `GameServer::spawnPlayer` 0x0814d27c: Use is pressed for him on the
    // point, and the seat is the finder's again from where he stands. One
    // that refuses leaves him there, as the engine's does.
    if (seatFor && wantsSeat(spawned.spawn, true)) {
      const cand = seatFor(spawned.spawn);
      if (cand && cand !== SPAWN_STANDS) referee.enterVehicle(bot, cand);
    }
    return false;
  };

  // --- fire -----------------------------------------------------------------

  /** The fire data of the weapon a bot holds right now, or null while loading. */
  referee.weaponDataOf = bot => {
    const name = bot.weaponAi?.name ?? bot.kitPrimary ?? null;
    return name ? bot.weaponData?.[name] ?? null : null;
  };

  /**
   * The heat of a bot's hand weapon `name`: a `FireState` over its FireArms'
   * heat words (`fireArms.heat`, the page's own law, GUN-14, GUN-15), made
   * from the data as the magazine is, or null for a weapon with none. A
   * thrown weapon's heat is its throw's charge (`velocityDependentOnHeat`,
   * every grenade, GUN-14), not a barrel's: none here. Each item keeps its
   * own heat through a switch, and a new soldier's kit is cold.
   */
  referee.heatOf = (bot, name) => {
    if (!name) return null;
    if (!bot._heat) bot._heat = new Map();
    if (bot._heat.has(name)) return bot._heat.get(name);
    const data = bot.weaponData?.[name];
    if (!data) return null;
    const words = data.heat;
    const state = words && words.heatAddWhenFire != null && !data.throw && !words.velocityDependentOnHeat
      ? new FireState({ ...words, roundOfFire: data.roundOfFire ?? words.roundOfFire }) : null;
    bot._heat.set(name, state);
    return state;
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
          reloadLeft: 0, autoReload: !!m.autoReload,
          // The clip in the gun and the time it takes to leave (FA-7).
          ejectClipTime: m.ejectClipTime > 0 ? m.ejectClipTime : 0, clipIn: true, ejectLeft: 0 }
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
      if (mag.reloadLeft === 0) { mag.rounds = mag.size; mag.spare -= 1; mag.clipIn = true; }
    } else if (mag.ejectLeft > 0) {
      mag.ejectLeft = Math.max(0, mag.ejectLeft - dt);
    } else if (mag.rounds <= 0 && mag.ejectClipTime > 0 && mag.clipIn && !(bot._fireCooldown > 0)) {
      // The clip goes first (`FireArms::handleUpdate` 0x08288890 sends
      // message 8 once the last round's fire cycle is out; `EjectClip`
      // 0x08289d20 sets the eject timer and triggers the script's slot 6),
      // whoever holds the rifle and with or without a spare, and the reload
      // message waits that timer out (ledger FA-7): a Garand's 0.6 s.
      mag.clipIn = false;
      mag.ejectLeft = mag.ejectClipTime;
      env.onEject?.(bot, bot.weaponAi?.name ?? null);
    } else if (mag.rounds <= 0 && mag.spare > 0 && !(bot._fireCooldown > 0)) {
      // Not before the last round's fire cycle has run out: the engine's
      // reload message (`FireArms::handleMessage` 9, 0x082895c0), whoever
      // sends it, starts `Reload` only once `timeToFireFinished` is spent,
      // and `Fire` 0x0828a090 sets that to 1 / roundOfFire (ledger AI-133).
      // A Bazooka's reload starts a second after its round, so it fires one
      // every 6.6 s, and the round's fire clip plays out before the reload's.
      mag.reloadLeft = mag.reloadTime > 0 ? mag.reloadTime : 1e-6;
      // `Reload` triggers the weapon's Reload sound slot as it starts (SND-17).
      env.onReload?.(bot, bot.weaponAi?.name ?? null);
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
   * whatever `env.seatedBodyAt` says -- a seated man is a target exactly where
   * the seat declares a SeatObject, half body or whole (ledger SEAT-37) --
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
   * `reach`, when given, is how far the round flies before its life is out
   * (`bot-barrels.js roundReach`); never past `BOT_FIRE_RANGE`.
   */
  referee.resolveShot = (bot, damage, aimAt = null, damageFor = null, ray = null, seedIndex = null, reach = null) => {
    const range = reach > 0 ? Math.min(reach, BOT_FIRE_RANGE) : BOT_FIRE_RANGE;
    const w = world();
    const { origin, dir } = ray ?? bot.aimRay();
    let d = dir;
    if (aimAt) {
      const dx = aimAt[0] - origin[0], dy = aimAt[1] + BOT_BODY_HEIGHT - origin[1], dz = aimAt[2] - origin[2];
      const h = Math.hypot(dx, dz) || 1;
      const pitch = Math.atan2(dy, h);
      const yaw = Math.atan2(dir[0], dir[2]);
      d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    }
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    // The cone's total in its own unit, hundredths of a radian, and the
    // point of its square the bot's input index and the barrel draw
    // (bot-deviation.js, ledger AI-145); a caller that names none fires a
    // barrel-less gun.
    const k = seedIndex ?? deviationIndex(botInputIndex(bot), 0, 0);
    const [cx, cy, cz] = botDeviate([d[0] / len, d[1] / len, d[2] / len], bot.aimDeviation ?? 0, k);
    // The line this round flew, for the caller that flies its sound
    // (`env.onRound`); `dist` is filled below when it meets a body.
    const round = referee.lastRound;
    round.origin[0] = origin[0]; round.origin[1] = origin[1]; round.origin[2] = origin[2];
    round.dir[0] = cx; round.dir[1] = cy; round.dir[2] = cz;
    round.dist = null;
    const me = w.player(bot.playerId);
    let best = null, bestT = Infinity;
    for (const [id, player] of w.players) {
      if (roundPasses(w, bot.playerId, id)) continue;
      if (w.armorOf(id)?.destroyed) continue;
      const s = referee.bodyAt(id);
      if (!s) continue;
      // The stand-in sphere first, grown to `BOT_BODY_REACH`: only a round that
      // can reach a body pays for its capsules, which read the drawn rig's
      // bones through a full `updateMatrixWorld` (rig-capsules.js). Every
      // round used to build every living body's capsules, most of them for
      // targets it was flying away from (features/bot-fight-performance).
      const center = [s.x, s.y + BOT_BODY_HEIGHT, s.z];
      if (!withinReach(origin, cx, cy, cz, range, center, BOT_BODY_REACH)) continue;
      const met = meetSoldier(origin, [cx, cy, cz], range, {
        capsules: referee.capsulesOf(id),
        center, radius: BOT_BODY_RADIUS,
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
    // A body it met ends the round there; the damage pass has already refused
    // one it has no line to. Otherwise the ground ends it, and only if nothing
    // does is the round left to fly its whole life (`dist` null).
    round.dist = best ? best.dist : groundReach(w?.collider, origin, [cx, cy, cz], range);
    return best;
  };
  /** The last round `resolveShot` flew: its muzzle, its deviated direction
   *  and, when it met a body, how far it went. Overwritten by the next. */
  referee.lastRound = { origin: [0, 0, 0], dir: [0, 0, 1], dist: null };

  referee.lineOfSight = (from, to) => lineOfSight(world()?.collider, from, to);

  /**
   * One round of a bot's pack, by the human's law (`healing-packs.js`): a bot
   * fires its MedPack and RepairPack through the same `BFSoldier::handleMessage`
   * Fire branch a human does (SUP-27), so the medic bag heals every wounded
   * soldier within `healDistance`, friend or enemy, and then the bot itself
   * (`useMedPack` 0x082768d0, `medPackHeals`), and the wrench repairs the
   * closest wounded hull in reach that the other side does not hold, and
   * nothing while the bot crouches (`useRepairPack` 0x08276100,
   * `repairPackTarget`). The numbers are the bot's soldier template's
   * (`env.soldierBody()`, `env.soldierTemplateOf(team)`), vanilla's without.
   * Returns what it healed: `[{ id, amount }]` for the bag, the hull's owner
   * for the wrench, or null.
   */
  referee.usePack = (bot, kind) => {
    const w = world();
    const me = w?.player(bot.playerId);
    if (!w || !me) return null;
    const pack = packParams(kind, env.soldierBody?.() ?? null, env.soldierTemplateOf?.(me.team) ?? null);
    const s = me.soldier;
    const at = s ? [s.x, s.y, s.z] : bot.getPosition();
    if (kind === 'medic') {
      const soldiers = [];
      for (const [id, player] of w.players) {
        const p = player.soldier;
        if (id === bot.playerId || !p) continue;
        soldiers.push({ id, x: p.x, y: p.y, z: p.z, armor: w.armorOf(id) });
      }
      const holder = { id: bot.playerId, x: at[0], y: at[1], z: at[2], armor: w.armorOf(bot.playerId) };
      const heals = medPackHeals(holder, soldiers, pack);
      for (const heal of heals) referee.applyHeal(heal.id, heal.amount);
      return heals.map(h => ({ id: h.id, amount: h.amount }));
    }
    const holder = { x: at[0], y: at[1], z: at[2], team: me.team ?? 0,
                     crouched: (s?.stance ?? bot.stance) === 'crouch' };
    if (holder.crouched) {
      // Crouched, the wrench disarms (SUP-28, `disarmTarget`): the first mine
      // or pack in reach, anyone's, out of the world unexploded, and one
      // round back to the bot's item that fires it (`reloadAmmo(1)`).
      const hit = disarmTarget(holder, env.packRounds?.() ?? [], pack);
      if (!hit) return null;
      env.retireRound?.(hit.round.shot ?? hit.round);
      referee.refundDisarmed(bot, hit.round.template);
      return { disarmed: hit.round.template, item: hit.item };
    }
    const hull = repairPackTarget(holder, env.packHulls?.() ?? worldHulls(w), pack);
    if (!hull) return null;
    hull.armor.heal(pack.repairHeal);
    return hull.owner ?? null;
  };

  /**
   * A lifted round's charge back to the bot (`useRepairPack` `0x082765f6`,
   * `FireArms::reloadAmmo(1)`, SUP-8's fill): the weapon it carries whose
   * projectile is that round's template, the item 4 or 5 retail looks at.
   * True when a round went back.
   */
  referee.refundDisarmed = (bot, template) => {
    const want = String(template ?? '').toLowerCase();
    if (!want) return false;
    for (const w of bot.weapons ?? []) {
      const data = bot.weaponData?.[w?.name];
      const p = typeof data?.projectile === 'string' ? data.projectile : data?.projectile?.template;
      if (String(p ?? '').toLowerCase() !== want) continue;
      const mag = referee.magazineOf(bot, w.name);
      if (!mag || !(mag.size > 0)) return false;
      const counts = { loaded: mag.rounds, spares: mag.spare, pool: mag.pool ?? 0 };
      const before = mag.rounds + mag.spare * mag.size;
      reloadAmmo(counts, mag.size, data.magazine?.magazines ?? 1, 1);
      mag.rounds = counts.loaded;
      mag.spare = counts.spares;
      mag.pool = counts.pool;
      return mag.rounds + mag.spare * mag.size > before;
    }
    return false;
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
      // The rate-of-fire timer is the engine's `timeToFireFinished`: a round
      // sets it to `1 / roundOfFire`, it is not added to, and it runs down a
      // tick at a time, so a gun fires on whole ticks (GUN-13) as the human's
      // does (gun-cycle.js `advanceGroups`): a 9 rps Mp40 fires 7.5 a second
      // and the M249's 13.5 fires 10. Carrying the fraction from round to
      // round fired them at 9 and 13.5. The referee runs on the world's
      // ticks. The timer runs down before the magazine's tick, whose reload
      // waits for it, as `FireArms::handleUpdate` 0x08288890 counts it down
      // before it asks for one; an idle gun owes nothing (floored at 0). A
      // round a `fireDelay` let go was fired after its tick's countdown, so
      // its timer first counts down a tick later (`delayedFireCycle`).
      if (bot._fireCooldownFresh) bot._fireCooldownFresh = false;
      else bot._fireCooldown = Math.max(0, Math.fround((bot._fireCooldown ?? 0) - Math.fround(dt)));
      const mag = referee.magazineTick(bot, dt);
      // The held item's heat runs its own ticks, and a pull at heat 1 or
      // more, or in the lockout, fires nothing (`FireArms::Fire`, GUN-14).
      const heldName = bot.weaponAi?.name ?? bot.kitPrimary ?? null;
      const heat = referee.heatOf(bot, heldName);
      heat?.step(dt);
      const ready = mag.canFire && (!heat || heat.canFire);
      // The bot's own weapon's rate (`fireArms.roundOfFire`), not the human's.
      const stats = referee.weaponDataOf(bot);
      // A weapon with no fire data yet: the window it may still arrive in,
      // counted from the first tick the bot holds it.
      if (!stats && heldName) {
        if (!bot._noData) bot._noData = new Map();
        if (!bot._noData.has(heldName)) bot._noData.set(heldName, referee.clock);
      }
      // The trigger is the AI weapon's own `weaponTemplate.weaponFire`
      // (`BBPFireInfantery::createFirePlan` 0x085ac240 builds both triggers on
      // the template's +0x44): on `PIAltFire` the bot presses the right
      // button, and what goes off is the FireArms the item carries there, a
      // bayonet's stab (XPack1's `No4Bayonet`, whose AI weapon is the stab).
      const alt = altFireOf(bot, stats);
      if (alt) {
        if (stepAltRound(bot, alt, stats, dt)) continue;
        // The stab is held off while the rifle above it reloads or sits out
        // an overheat (ledger FA-11); it takes no round of the rifle's.
        const altReady = !(mag.reloadLeft > 0) && (!heat || heat.canFire);
        if (!bot.isFiring || bot._fireCooldown > 0 || !altReady) continue;
        pressAlt(bot, alt, stats, dt);
        continue;
      }
      // The right button on an item with nothing there fires nothing.
      if (bot.weaponAi?.weaponFire === 'PIAltFire' && stats) continue;
      // A throw under way: its round is owed and no other press is taken.
      if (stepThrow(bot, mag, stats, dt)) continue;
      if (!bot.isFiring || bot._fireCooldown > 0 || !ready) continue;
      if (!stats && heldName
          && referee.clock - bot._noData.get(heldName) < BOT_WEAPON_DATA_WAIT) continue;
      // A `fireDelay` weapon (every hand grenade, the Molotov, a satchel)
      // winds up: the press starts the throw and its round leaves when the
      // delay is out (FA-13), as the human's does (hand-fire.js).
      const windUp = throwDelayOf(stats);
      if (windUp > 0) {
        pressThrow(bot, windUp, mag, stats, dt);
        continue;
      }
      fireRound(bot, mag, heat, stats);
    }
  };

  /** A `fireDelay` weapon's wind-up, in seconds, or 0. The exporter files a
   *  FireArms' `fireDelay` under `throw` (bot-barrels.js `botWeaponData`). */
  function throwDelayOf(stats) {
    const d = stats?.throw?.fireDelay;
    return d > 0 ? d : 0;
  }

  /**
   * The press of a `fireDelay` weapon (FA-13): `Fire` with the delay timer
   * running only flags the shot pending, the torso starts its throw now
   * (`env.onWindUp`, the fire clip that pulls the pin and swings), and the
   * round, its report and the fire timer wait the delay out (`stepThrow`).
   * The two timers are counted as the stab's are (`pressAlt`): the press's
   * own tick takes the first tick off the delay. A weapon whose round never
   * leaves (a swap or a death mid-wind-up) throws nothing and spends nothing.
   */
  function pressThrow(bot, delay, mag, stats, dt) {
    bot._fireCooldown = Math.fround(delay);
    bot._throwRound = { left: Math.fround(delay), weapon: bot.weaponAi?.name ?? null };
    env.onWindUp?.(bot, bot.getPosition());
    stepThrow(bot, mag, stats, dt);
  }

  /** The thrown round, once its delay is out; true while it is still owed. */
  function stepThrow(bot, mag, stats, dt) {
    const owed = bot._throwRound;
    if (!owed) return false;
    if (owed.weapon !== (bot.weaponAi?.name ?? null) || world()?.armorOf(bot.playerId)?.destroyed) {
      bot._throwRound = null;
      return false;
    }
    if (dt > 0) owed.left = Math.fround(owed.left - Math.fround(dt));
    if (owed.left > 0) return true;
    bot._throwRound = null;
    if (!mag.canFire) return false;
    fireRound(bot, mag, null, stats, { thrown: true });
    // `handleUpdate` runs the fire timer before the delay (fire-timer.js
    // `delayedFireCycle`): the next tick does not count this one down yet.
    bot._fireCooldownFresh = true;
    return false;
  }

  /**
   * One round leaves `bot`'s held weapon: the fire timer, the magazine, the
   * heat, the bots' hearing, the page's report, and the round itself -- a
   * heal, a round the page flies (`env.launchRound`) or the referee's rays.
   * `opts.thrown`: the round of a throw whose torso already moved at the
   * press (`pressThrow`).
   */
  function fireRound(bot, mag, heat, stats, opts = null) {
    const rof = stats?.roundOfFire > 0 ? stats.roundOfFire : BOT_FALLBACK_ROF;
    bot._fireCooldown = firePeriod(rof);
    // The round's own period (FireArms +0x234), which `botWeaponReady`
    // compares the timer against.
    bot._firePeriod = bot._fireCooldown;
    referee.magazineShot(bot, mag);
    heat?.registerShot(1);
    const at = bot.getPosition();
    roundLeft(bot, at);
    env.onShot?.(bot, at, opts);
    // The MedPack and the RepairPack fire no round: `handleMessage` runs
    // `useMedPack` / `useRepairPack` on them by NAME (SUP-27, `usePack`). Any
    // other `healing 1` weapon (BF1918's whistles, `BottleHeal`) throws its
    // round, whose depots do the healing, and is never hitscan.
    const pack = healingPackKind(bot.weaponAi?.name);
    if (pack) { referee.usePack(bot, pack); return; }
    if (bot.weaponAi?.healing) { env.launchRound?.(bot, stats); return; }
    // A round the caller flies (`env.launchRound`: the page's rockets and
    // thrown weapons, `bot-rounds.js`) is resolved where it lands -- the
    // direct hit, the splash, a hull -- and billed from there, not here.
    if (env.launchRound?.(bot, stats)) return;
    fireRays(bot, stats, at);
  }

  /**
   * The alternate fire `bot` pulls with the weapon in hand, or null: the
   * item's `c_PIAltFire` FireArms (`bot-barrels.js botWeaponData` `alt`) when
   * its AI weapon fires on `PIAltFire`.
   */
  function altFireOf(bot, stats) {
    return bot.weaponAi?.weaponFire === 'PIAltFire' && stats?.alt ? stats.alt : null;
  }

  /** A round left `bot`'s weapon: the deviation's step, the bot's own shot
   *  clock, and the sound every bot hears inside the weapon's AI radius
   *  (`event_soundEmitter`), which leaves the shooter deaf for 3 s. */
  function roundLeft(bot, at) {
    bot.deviation.onShot();
    bot.onShot(referee.clock);
    const radius = bot.weaponAi?.soundSphereRadius ?? null;
    for (const other of referee.bots) other.onShotFired(bot.playerId, bot.team, at, referee.clock, radius);
  }

  /**
   * The press of the alternate fire: the report and the thrust as it begins
   * (`env.onStab`, the human's `hand-fire.js` `stepAltFire` plays both on the
   * press), and its round `fireDelay` after (a bayonet's 0.12 s; `FireArms::
   * Fire` runs again when the delay is out). The fire timer is the stab's own
   * cycle, `1 / roundOfFire`, counted from the round (hand-alt-fire.js).
   * `dt` is the press's tick, whose own `handleUpdate` takes the first tick
   * off the delay (`fire-timer.js` `delayTicks`, recorded in the lab).
   */
  function pressAlt(bot, alt, stats, dt) {
    const delay = alt.fireDelay > 0 ? Math.fround(alt.fireDelay) : 0;
    env.onStab?.(bot, bot.getPosition(), alt);
    // The delay and the cycle are two timers, each a whole number of ticks
    // (`fire-timer.js`, GUN-13, FA-13): the round's own timer starts when the
    // delay runs out and `Fire` fires it (`stepAltRound`), not at the press,
    // so a 0.12 s delay (4 ticks, the press's own the first) and a
    // `roundOfFire 1.3` cycle hold the next press for 3 + 24 ticks, each timer
    // rounded up to its own whole ticks. No press is taken while the round is
    // owed, and the magazine's reload waits on the delay as before.
    bot._fireCooldown = delay;
    bot._altRound = { left: delay, weapon: bot.weaponAi?.name ?? null };
    stepAltRound(bot, alt, stats, dt);
  }

  /** The stab's round, once its delay is out; true while it is still owed
   *  (no other press is taken then). A swap or a death drops it. */
  function stepAltRound(bot, alt, stats, dt) {
    const owed = bot._altRound;
    if (!owed) return false;
    if (owed.weapon !== (bot.weaponAi?.name ?? null) || world()?.armorOf(bot.playerId)?.destroyed) {
      bot._altRound = null;
      return false;
    }
    // Counted as `handleUpdate` counts the delay: dt off, stored as a float.
    if (dt > 0) owed.left = Math.fround(owed.left - Math.fround(dt));
    if (owed.left > 0) return true;
    bot._altRound = null;
    bot._fireCooldown = firePeriod(alt.roundOfFire > 0 ? alt.roundOfFire : BOT_FALLBACK_ROF);
    bot._firePeriod = bot._fireCooldown;
    // `handleUpdate` runs the fire timer before the delay (fire-timer.js
    // `delayedFireCycle`): the next tick does not count this one down yet.
    bot._fireCooldownFresh = true;
    const at = bot.getPosition();
    roundLeft(bot, at);
    fireRays(bot, { ...stats, round: alt.round, barrels: alt.barrels, reach: alt.reach }, at);
    return false;
  }

  /**
   * One pull's rays. Every barrel fires its own round down its own turn of
   * the eye's frame and draws its own deviation (`fireBarrel` 0x0828aba0,
   * ledger XHIT-12, XHIT-16; bot-barrels.js): a shotgun's eight pellets, each
   * with the round's full damage. A weapon with one plain barrel keeps the
   * one ray down the eye. A round goes no further than it flies in its life
   * (`stats.reach`, velocity x timeToLive): a knife's 3.3 m.
   */
  function fireRays(bot, stats, at) {
    const eye = bot.aimRay();
    const rays = barrelRays(eye.origin, eye.dir, stats?.barrels) ?? [null];
    const barrels = declaredBarrels(stats?.barrels);
    for (const [barrel, ray] of rays.entries()) {
      const hit = referee.resolveShot(bot, env.roundDamage(stats), null,
                                      (material, distance) => env.roundDamage(stats, material, distance), ray,
                                      deviationIndex(botInputIndex(bot), barrels, barrel), stats?.reach ?? null);
      // The round is an object of its own in the game, and its script
      // sounds where it flies (ledger SND-19, SND-37): a passing crack.
      env.onRound?.(bot, stats, referee.lastRound);
      if (!hit) continue;
      bot.recordHit(hit.targetId);
      env.onHit?.(bot, hit);
      // A round that found a bot damages that bot; the caller bills anyone
      // else (the page's human).
      if (env.damageTarget?.(hit, bot, at)) continue;
      referee.applyDamage(hit.targetId, hit.damage, bot.playerId, at,
                          { weapon: bot.weaponAi?.name ?? bot.kitPrimary ?? null, stamped: true, dist: hit.dist, hit: hit.hit });
    }
  }

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
    bot._respawnAt = spawnReadyAt(waveClock(), waveParams());
    bot._respawnIn = waveSecondsLeft(waveClock(), bot._respawnAt, waveParams());
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
      // A spawn-group row or a carried group is no control point; a point
      // that cannot change team still runs the law (FHR-4).
      if ((flag.uncapturable && flag.controlPointName == null) || !flag.position) continue;
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
        const c = (u.seatCandidate?.(seat.vehicleId, seat.seatId)
          ?? cands.find(x => x.vehicleId === seat.vehicleId && x.seatId === seat.seatId))
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
      // `groundAt`: where a soldier stands under a flag's pole, for the
      // capture ring (strategic-ai.js `_captureRing`, INVENTION). The
      // terrain, not the water plane over it (bot-pose.js `footingAt`).
      const collider = world()?.collider ?? null;
      return { type: 'Infantery', isWalkable: referee.navGrid ? (x, z) => isWalkable(referee.navGrid, x, z) : null,
               radius: 1.0, mounted: false, groundAt: bot ? (x, z) => footingAt(collider, x, z) : null };
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

  /**
   * The unit bot `id` occupies as side `toSide` holds it, for the wanted
   * strength of `AIStrategicArea::update` 0x0863d6d0 (strategic-ai.js
   * `wantedStrength`, AI-168): the seat's own `setStrategicStrength` pair
   * (the soldier's 1 / 1 on foot), the unit's health (`IPIUnit+0x10`, which
   * `calculateStrengths` 0x085ec3c0 scales them by), its six battle
   * strengths summed, and the side's security of it. Null when the other
   * side has no information of it (bot-sense.js `SideKnowledge`, AI-75).
   */
  referee.strategicSample = (id, toSide) => {
    const w = world();
    const p = w?.player(id);
    if (!p) return null;
    let security = 1;
    if (p.team !== toSide) {
      security = referee.enemyTables[toSide]?.knowledge?.security(id, referee.clock) ?? null;
      if (security === null) return null;
    }
    const m = botOf(id)?.vehicle ?? null;
    const a = w.armorOf(id);
    let health = a?.maxHitPoints > 0 ? Math.max(0, a.hitPoints / a.maxHitPoints) : 1;
    let strategic = null, table = BOT_SOLDIER_TABLE;
    if (m) {
      const s = m.strategic;
      strategic = [s?.[0] ?? s?.['0'] ?? 0, s?.[1] ?? s?.['1'] ?? 0];
      table = m.strengths ?? {};
      const d = w.vehicleDamage?.get(w.collider?.statics?.ownerOf(m.node) ?? -1) ?? null;
      if (d?.maxHitPoints > 0) health = Math.max(0, d.hitPoints / d.maxHitPoints);
    }
    let strength = 0;
    for (const k in table) strength += table[k] ?? 0;
    return { strategic, health, strength, security };
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
    // A bot climbing out of his own accord is an exit (`destroyOnExit`,
    // ledger SEAT-38); a death in the seat or the round's end is not.
    const p = units()?.leave(bot, { exited: !killed && !silent })
      ?? { x: bot.position[0], y: bot.position[1], z: bot.position[2] };
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
          // A round the bot rode (FA-29): `exitVehicle` gives it back to the
          // launcher it fired it from, alive (`rocket-ride.js` `botRideOut`).
          if (env.rideOut?.(bot)) continue;
          const attacker = u.attackerOf?.(bot) ?? null;
          // The crew's kill is scored on the lethal call, so it carries that
          // call's weapon (and its splash) -- never the attacker's held one.
          // A killer whose weapon nothing named gets the stamp-less line.
          const how = attacker != null ? (u.killedWithOf?.(bot) ?? { weapon: null, splash: false }) : null;
          referee.leaveVehicle(bot, { killed: true });
          referee.applyDamage(bot.playerId, 1e6, attacker, null,
            { via: m.template ? `hull ${m.template}` : '', ...(how ? { weapon: how.weapon, splash: how.splash, stamped: true } : {}) });
          continue;
        }
        if (bot.exitRequest) {
          bot.exitRequest = false;
          // Its own Use: a restricted exit blocked on both sides refuses it,
          // and it stays seated (SEAT-42, `bot-units.js` `mayExit`).
          if (u.mayExit?.(bot) !== false) referee.leaveVehicle(bot);
        } else if (bot.switchRequest) {
          const req = bot.switchRequest;
          bot.switchRequest = null;
          // A door-less seat too (the artillery driver's, bot-units.js
          // `doorless`): the swap is `enterVehicle`, which tests no door.
          const cand = u.seatCandidate?.(req.vehicleId, req.seatId)
            ?? cands.find(c => c.vehicleId === req.vehicleId && c.seatId === req.seatId);
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
