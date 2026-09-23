// A bot's decision loop: the behaviours its unit registers, the urgency
// generators, the winner's selection with the engine's hysteresis, and the
// page's goal readout. Plain functions of the `BotController` (bot.js),
// which delegates its methods here.
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

import { traceValidPoint, isWalkable } from './nav-grid.js';
import { playerPosition, SOLDIER_RADIUS } from './bot-sense.js';
import { TAKE_COVER, MEDIC } from './bot-behaviours.js';
import { airAvoid } from './bot-pilot.js';

/**
 * Behaviour names matching AIbehaviours.con §4.1, in registration order.
 * `Change` and `Special` are not registered (header).
 */
export const BEHAVIOUR = {
  Avoid: 'Avoid', MoveTo: 'MoveTo', Idle: 'Idle', Fire: 'Fire',
  Scout: 'Scout', TakeCover: 'TakeCover', Change: 'Change', Special: 'Special',
};
export const REGISTERED = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Special', 'Scout', 'TakeCover', 'Change'];
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
export const ACTIVE_URGENCY_INIT = 1e-5;
/** The engine's own warning: never let Idle's urgency reach 0 — with every
 *  urgency at 0 the merger picks nothing and the server crashes. */
export const IDLE_FLOOR = 1e-3;

/** No strategic data: a bot walks to the nearest enemy flag with this
 *  waypoint radius (INVENTION). */
const FALLBACK_WAYPOINT_RADIUS = 5.0;
/** How long with no *net* progress toward the goal before the page redeploys
 *  the bot to another spawn point (s). INVENTION: the engine has no such
 *  test (ledger AI-101). Its stuck handling is the obstruction counters
 *  (`ObstructionDetection::update` 0x08532b00, AI-32: the path fails at 401
 *  ticks), and its one respawn of a living bot, the SAI's teleporter list
 *  (`registerTeleporter` 0x086369c0 -> `handleTeleportingBot` 0x08631390
 *  from `prepareUpdate` 0x08635210: a suitable spawn group, the bot handled
 *  as dead and teleported there), is fed by nothing that measures progress.
 *  It stays as the viewer's safety net for a body wedged in geometry the map
 *  cannot see, measured per order. */
const NO_PROGRESS_RESPAWN = 12.0;

/** The behaviours the bot's current unit registers (AIbehaviours.con rows). */
export function registered(bot) {
  return bot.vehicle ? REGISTERED_VEHICLE : REGISTERED;
}

/** The page reads `objective`, `objectiveGoal`, `goalReached`. */
export function updateObjectiveReadout(bot, dt) {
  const wp = bot.waypoints;
  if (wp) {
    bot.objective = { name: wp.area?.name ?? 'order' };
    bot.objectiveGoal = [wp.point[0], bot.position[1], wp.point[1]];
    const d = Math.hypot(wp.point[0] - bot.position[0], wp.point[1] - bot.position[2]);
    bot.goalReached = d < wp.radius;
  } else {
    const flag = bot._nearestEnemyFlag();
    bot.objective = flag;
    bot.objectiveGoal = flag ? [flag.position[0], flag.position[1], flag.position[2]] : null;
    bot.goalReached = !!bot.objectiveGoal && bot._distTo(bot.objectiveGoal) < FALLBACK_WAYPOINT_RADIUS;
  }
  // Progress is measured per order: a new order (a new waypoint object, or
  // the nearest enemy flag changing without one) starts the best distance
  // again. Kept across orders, a follower keeping pace behind a moving point
  // never beat the distance it had once reached and was sent back to spawn
  // (54 redeploys a match for the squad play's Allied side).
  const order = wp ?? bot.objective ?? null;
  if (order !== bot._progressOrder) {
    bot._progressOrder = order;
    bot._bestGoalDist = null;
    bot._noProgress = 0;
  }
  if (bot.objectiveGoal && !bot.goalReached && bot.currentBehaviour === BEHAVIOUR.MoveTo) {
    const d = bot._distTo(bot.objectiveGoal);
    if (bot._bestGoalDist === null || d < bot._bestGoalDist - 0.5) {
      bot._bestGoalDist = d;
      bot._noProgress = 0;
    } else {
      bot._noProgress += dt;
      if (bot._noProgress > NO_PROGRESS_RESPAWN) {
        bot._noProgress = 0;
        bot._bestGoalDist = null;
        bot._needsRespawn = true;
      }
    }
  } else {
    bot._bestGoalDist = bot.objectiveGoal ? bot._distTo(bot.objectiveGoal) : null;
    bot._noProgress = 0;
  }
}

// -----------------------------------------------------------------------
// The decision loop (`BotMain::decisionMaking`)
// -----------------------------------------------------------------------

/** `currentMods[i]`: moral x personality x basic (header). */
export function currentMod(bot, name) {
  return 1.0 * (STANDARD_WEIGHTS[name] ?? 1.0) * (UNIT_WEIGHTS[name] ?? 1.0);
}

export function hasPlan(bot) {
  return bot.currentBehaviour !== null && bot.currentPlan.length > 0;
}

export function decisionMaking(bot, now, dt) {
  const hasPlan = bot._hasPlan();
  const active = hasPlan ? bot.currentBehaviour : null;
  const activeFor = active ? now - bot.behaviourChosenAt : 0;
  // Phase 1: every registered behaviour, with its modifier.
  for (const name of bot._registered()) {
    let mod = bot._currentMod(name);
    if (active) {
      const curve = name === active ? (CURVE_OF[active] ?? URGENCY_CURVE.union)(activeFor) : 1.0;
      mod *= curve * ((INHIBITOR[active] ?? UNIT_WEIGHTS)[name] ?? 1.0);
    }
    if (mod > 0) bot.urgency[name] = bot._generate(name, mod, now, dt, true);
    // else: not evaluated, the old urgency stands.
  }
  // The winner.
  let reselect = !hasPlan;
  if (hasPlan) {
    for (const name of bot._registered()) {
      if (bot._quotientChanged(name) || bot.changedTarget[name]) { reselect = true; break; }
    }
  }
  let winner = bot.currentBehaviour;
  if (reselect) {
    let best = 0;
    winner = null;
    for (const name of bot._registered()) {
      const u = bot.urgency[name];
      bot.activeUrgency[name] = u;
      if (u > best) { best = u; winner = name; }
    }
    // The engine's crash guard, made safe: nothing wins -> Idle.
    if (!winner) { winner = BEHAVIOUR.Idle; bot.urgency.Idle = IDLE_FLOOR; }
    if (winner !== bot.currentBehaviour) {
      bot.currentBehaviour = winner;
      bot.behaviourChosenAt = now;
    }
  }
  // The winner's plan is regenerated every tick; the same plan is kept.
  const plan = bot._generatePlan(winner, now);
  if (plan !== bot.currentPlan) {
    if (plan.length) bot._execInfantryResetControls();
    bot.currentPlan = plan;
    bot.planBehaviour = winner;
    bot.planTargetId = bot.firingTarget;
  }
  for (const name of bot._registered()) bot.changedTarget[name] = false;
}

/** `BotBehaviour::quotientChanged(0.87, 1.15)`. */
export function quotientChanged(bot, name) {
  const active = bot.activeUrgency[name];
  const u = bot.urgency[name];
  if (active === 0) return u > 0;
  if (u === 0) return true;
  const q = u / active;
  return !(HYSTERESIS_LOW <= q && q <= HYSTERESIS_HIGH);
}

// -----------------------------------------------------------------------
// Urgency generators
// -----------------------------------------------------------------------

export function generate(bot, name, mod, now, dt, planned) {
  switch (name) {
    case BEHAVIOUR.Idle: return mod;
    case BEHAVIOUR.MoveTo: return bot._urgencyMoveTo(mod);
    case BEHAVIOUR.Fire: return bot._urgencyFire(mod, now);
    case BEHAVIOUR.Scout: return bot._urgencyScout(mod, now, dt);
    case BEHAVIOUR.TakeCover: return bot._urgencyTakeCover(mod, now);
    case BEHAVIOUR.Special: return bot._urgencySpecial(mod, now);
    case BEHAVIOUR.Change: return bot._urgencyChange(mod, now);
    case BEHAVIOUR.Avoid: return bot._urgencyAvoid(mod, now);
    default: return 0;
  }
}

/**
 * `BBMoveTo::calculateUrgency`: the waypoint list's urgency for the bot's
 * position (`WPMoveTo::getUrgency`), times the modifier. No order and no
 * strategic data: the nearest enemy flag stands in (INVENTION).
 */
export function urgencyMoveTo(bot, mod) {
  const wp = bot.waypoints ?? bot._fallbackWaypoint();
  if (!wp) return 0;
  // R' adds the unit's `getMaxPathPosRemovalDistance` (BotMain 0x0852b780:
  // 0.99 x max(0.5, bounding radius - the bounding centre's offset)); the
  // page's vehicle radius stands in for a hull's.
  const u = wp.urgency(bot.position[0], bot.position[2], bot._pathRadius(), bot.position[1]);
  bot.changedTarget.MoveTo = wp !== bot._lastWaypointObject;
  bot._lastWaypointObject = wp;
  // `BBMoveToFixed::calculateUrgency` 0x08575680 (the Fixed rows: a seat
  // that does not drive) publishes the order's urgency to the bot and
  // returns 0: a gunner or a fixed gun never walks.
  bot._orderUrgency = u > 0 ? u * mod : 0;
  if (bot.vehicle && !bot.vehicle.drives) return 0;
  return u > 0 ? u * mod : 0;
}

/** `Bot::getMaxPathPosRemovalDistance` for the unit the bot controls. */
export function pathRadius(bot) {
  return bot.vehicle ? 0.99 * Math.max(0.5, bot.vehicle.radius ?? SOLDIER_RADIUS) : SOLDIER_RADIUS;
}

export function fallbackWaypoint(bot) {
  if (bot.world?.extras?.ai?.strategicAreas?.length) return null;
  const flag = bot._nearestEnemyFlag();
  if (!flag) return null;
  if (bot._fallback?.flag === flag) return bot._fallback;
  const point = [flag.position[0], flag.position[2]];
  const R = FALLBACK_WAYPOINT_RADIUS;
  bot._fallback = {
    kind: 'WPMoveTo', flag, area: null, point, radius: R, arrived: false,
    urgency(x, z, r = SOLDIER_RADIUS) {
      const Rr = R + r;
      const d2 = (x - point[0]) ** 2 + (z - point[1]) ** 2;
      this.arrived = d2 < 2 * Rr * Rr;
      return Math.min(1, Math.max(0.1, d2 / (4 * Rr * Rr))) * 2.0;
    },
  };
  return bot._fallback;
}

/** The nearest flag this bot's team does not hold, or null. */
export function nearestEnemyFlag(bot) {
  const flags = bot.world?.flags;
  if (!flags?.length) return null;
  let best = null, bestDist = Infinity;
  for (const flag of flags) {
    if (!flag.position || flag.uncapturable || flag.team === bot.team) continue;
    const d = Math.hypot(flag.position[0] - bot.position[0], flag.position[2] - bot.position[2]);
    if (d < bestDist) { bestDist = d; best = flag; }
  }
  return best;
}

/** Horizontal distance from the bot to a world point. */
export function distTo(bot, point) {
  return Math.hypot(point[0] - bot.position[0], point[2] - bot.position[2]);
}

/** `BBFire::calculateUrgency`: the scored target, the chosen weapon. */
export function urgencyFire(bot, mod, now) {
  const t = bot._chooseFiringTarget(now);
  const changed = t.targetId !== bot.firingTarget;
  if (t.targetId) {
    if (changed) bot.firingTargetTime = now;
    bot.firingTarget = t.targetId;
    bot.targetPosition = t.targetPos;
    bot.targetVisible = !!t.visible;
    bot.targetScore = t.score;
    bot.weaponIndex = t.weaponIndex >= 0 ? t.weaponIndex : 0;
    bot.timeSinceHeard = Infinity;
  } else {
    bot.firingTarget = null;
    bot.targetPosition = null;
    bot.targetVisible = false;
    bot.targetScore = 0;
  }
  bot.changedTarget.Fire = changed && !!t.targetId;
  return t.urgency * mod;
}

/** `BBScout::calculateUrgency` through `ScoutState`. */
export function urgencyScout(bot, mod, now, dt) {
  const s = bot.senses;
  const attackers = [];
  for (const [id, f] of s.attackers) {
    const p = f.pos ?? playerPosition(bot.world.players.get(id));
    if (p) attackers.push({ id, pos: p, strength: f.strength, time: f.time, rate: f.rate });
  }
  const heard = [...s.heard.values()].map(h => ({ ...h, threat: 4, direct: true }));
  const incoming = s.incoming.filter(f => f.pos);
  const r = bot.scout.evaluate({
    now, dt,
    position: bot.position, yaw: bot.yaw, pitch: bot.pitch,
    quadInertia: bot.quadInertia,
    incoming, heard, spotted: s.spottedEnemies(), attackers,
    isScouting: bot._scoutRan === true,
    coverActive: bot.currentBehaviour === BEHAVIOUR.TakeCover,
  });
  bot._scoutRan = false;
  bot.changedTarget.Scout = !!r.changed;
  bot._scoutDir = r.dir;
  // The urge curve is applied by the decision loop (the active behaviour's
  // seconds), so the generator hands back its own value times the modifier.
  return r.urgency * mod;
}

/** `BBTakeCoverInfantry::calculateUrgency` through `TakeCoverState`. */
export function urgencyTakeCover(bot, mod, now) {
  const s = bot.senses;
  const heard = [...s.heard.values()].map(h => ({ ...h, threat: 4, security: 1 }));
  const spotted = s.spottedEnemies().map(m => ({ ...m, threat: 4 }));
  const nav = bot._nav();
  const r = bot.cover.evaluate({
    now, position: bot.position,
    incoming: s.incoming.filter(f => f.pos), heard, spotted,
    covers: bot._coverCandidates(),
    lineClear: (a, b) => bot._lineClear(a, b),
    traceValidPoint: nav ? (from, to) => {
      const p = traceValidPoint(nav, from[0], from[1], to[0], to[1], bot.obstacles);
      return p && isWalkable(nav, p[0], p[1]) ? p : null;
    } : null,
    mod,
    myWidth: 0.6, myHeight: 1.8,
  });
  bot.changedTarget.TakeCover = !!r.changed;
  bot._coverResult = r;
  return r.urgency ?? 0;
}

/** The cover objects within the soldier's `coverSearchRadius 20`. */
export function coverCandidates(bot) {
  const all = bot.covers;
  if (!all?.length) return [];
  const out = [];
  for (const c of all) {
    const d = Math.hypot(c.pos[0] - bot.position[0], c.pos[2] - bot.position[2]);
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
export function urgencySpecial(bot, mod, now) {
  if (!bot.weapons?.some(w => w.healing)) return 0;
  const world = bot.world;
  const me = bot._player();
  const friends = [];
  for (const [id, p] of world?.players ?? []) {
    if (id === bot.playerId || !p || p.team !== me?.team) continue;
    const armor = world.armorOf?.(id);
    if (!armor || armor.destroyed || !(armor.maxHitPoints > 0)) continue;
    const pos = playerPosition(p);
    if (!pos) continue;
    const d = Math.hypot(pos[0] - bot.position[0], pos[2] - bot.position[2]);
    if (d > MEDIC.searchRadius) continue;
    friends.push({ id, pos, health: armor.hitPoints / armor.maxHitPoints,
                   upright: true, inVehicle: !!p.vehicle, radius: SOLDIER_RADIUS, type: 'Infantry' });
  }
  const collider = world?.collider;
  const water = collider?.waterLevel;
  const waterDepth = Number.isFinite(water) ? Math.max(0, water - bot.position[1]) : 0;
  const nav = bot._nav();
  const wp = bot.waypoints;
  const r = bot.medic.evaluate({
    now, position: bot.position, waterDepth, weapons: bot.weapons, friends,
    isWalkable: nav ? (x, z) => isWalkable(nav, x, z) : null,
    insideMyArea: wp?.area ? (x, z) => wp.inside(x, z) : null,
    mod,
  });
  bot.changedTarget.Special = !!r.changed;
  bot._medicResult = r;
  return r.urgency;
}

/**
 * `BBAvoid::calculateUrgency` for a soldier (zero look-ahead): a moving
 * body already overlapping the bot's own radius. Urgency `|relVel| /
 * |relPos|`; a stationary one is the map's business (`_trackContact`).
 */
export function urgencyAvoid(bot, mod, now) {
  // An aircraft's pilot predicts collisions 5 s ahead against the other
  // own-side and neutral hulls (`BBAvoid::calculateUrgency` 0x0855c650 with
  // the Mobile plug-in's look-ahead; bot-pilot.js `airAvoid`).
  if (bot.vehicle?.kind === 'air' && bot.vehicle.drives) return airAvoid(bot) * mod;
  let best = 0, bestDir = null;
  const me = bot._player();
  for (const [id, p] of bot.world?.players ?? []) {
    if (id === bot.playerId || !p?.soldier) continue;
    const s = p.soldier;
    const dx = s.x - bot.position[0], dz = s.z - bot.position[2];
    const d = Math.hypot(dx, dz);
    if (d > 2 * SOLDIER_RADIUS * 0.6 || d < 1e-3) continue;
    const v = s.speed ?? 0;
    const mv = me?.soldier?.speed ?? 0;
    const rel = Math.hypot(v * Math.sin(s.yaw) - mv * Math.sin(bot.yaw), v * Math.cos(s.yaw) - mv * Math.cos(bot.yaw));
    if (rel < 0.2) continue;
    const u = rel / d;
    if (u > best) { best = u; bestDir = [dx / d, dz / d]; }
  }
  if (best > 0 && bestDir) {
    bot._avoidThreatDir = bestDir;
    bot.changedTarget.Avoid = true;
  }
  return best * mod;
}
