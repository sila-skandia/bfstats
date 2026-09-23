// A bot and vehicles: the page's mount and dismount, the Change behaviour
// (`BBChange` / `BBChangeTeleport`) weighing staying against the foot, other
// hulls and the other seats of its own, the fire strengths it scores them
// by, the Change plan and its enter, exit and seat-switch executors. Plain
// functions of the `BotController` (bot.js), which delegates its methods
// here.

import { isWalkable } from './nav-grid.js';
import { playerPosition } from './bot-sense.js';
import { weaponAiOf, SOLDIER_BATTLE_STRENGTH } from './bot-fire.js';
import { unitUrgency, orderSplit, changeUrgency, teleportChangeUrgency, TANK, CHANGE } from './bot-vehicle.js';
import { decleiningSlope } from './bot-behaviours.js';
import { fireStrength, unitTable } from './bot-strength.js';
import { wrapAngle } from './bot-aim.js';
import { BEHAVIOUR } from './bot-decision.js';
import { PLAN_ACTION } from './bot-plans.js';
import { candidateRunwayClear } from './bot-pilot.js';
import { craftBailReason, levelZones } from './doctrine-landing.js';

/** The landing craft (the Daihatsu and the LCVP, whose seats are the
 *  `LandingCraft` / `LandingCraftPassenger` / `LandingCraftFixed` units:
 *  `equipmentType` 7 / 10 / 11), by AI template name, as bot-units.js
 *  picks their water map. */
const LANDING_CRAFT_RE = /lcvp|daihatsu|landing/i;
/** `BBChangeLandingCraft::calculateUrgency` 0x085608ea: the bail's urgency. */
const LANDING_BAIL_URGENCY = 4.0;

/**
 * The page seats the bot: `m` is `{ id, node, drive, occupancy, kind, nav,
 * radius, maxSpeed, weapons, template }`. The unit's weapons replace the
 * kit's for the Fire behaviour while mounted.
 */
export function mount(bot, m, now = bot._now ?? 0) {
  bot.vehicle = m;
  // `isAirBorn` (+0x1d5) is cleared only when the controlled object
  // changes (`updateBotVehicle` 0x0852c899) or the bot is built (ctor
  // 0x0851d475); `event_airborn` 0x0852eca0 sets it from the flight law.
  // A landed plane keeps it.
  bot._airborne = false;
  bot.enterRequest = null;
  bot._lastChangeAt = now;
  bot._footWeapons = bot.weapons;
  bot.weapons = (m.weapons?.length ? m.weapons : [{ name: m.template ?? 'vehicle', maxRange: 0, strength: {} }]).map(weaponAiOf);
  bot.exitRequest = false;
  bot.weaponIndex = 0;
  bot._execInfantryResetControls();
  bot.currentPlan = []; bot.currentBehaviour = null; bot.planBehaviour = null;
  bot.route = null;
}

/** The page unseats the bot (destroyed, or bailed). */
export function dismount(bot, now = bot._now ?? 0) {
  const left = bot.vehicle;
  bot.vehicle = null;
  bot._airborne = false;
  // Keyed by the hull, as the candidates are (`vehicleId`): the seat's own
  // id (`<uuid>:<seat>`) never matched one, so the 15 s ramp never ran.
  bot._leftVehicle = left ? { id: left.vehicleId ?? left.id, at: now } : null;
  bot._lastChangeAt = now;
  if (bot._footWeapons) bot.weapons = bot._footWeapons;
  bot._footWeapons = null;
  bot.weaponIndex = 0;
  bot._execInfantryResetControls();
  bot.currentPlan = []; bot.currentBehaviour = null; bot.planBehaviour = null;
  bot.route = null;
}

/**
 * `BBChange::calculateUrgency` (bot-vehicle.js): on foot, the enterable
 * land vehicles the page lists against staying on foot; mounted, no
 * voluntary bail (INVENTION: `isBailAllowed` is not read; the page
 * unseats a bot whose vehicle is destroyed).
 */
export function urgencyChange(bot, mod, now) {
  const cands = bot.vehicleCandidates;
  const world = bot.world;
  const split = orderSplit(bot.waypoints?.attack ?? 0, bot.waypoints?.defence ?? 0);
  const me = world?.armorOf?.(bot.playerId);
  const myHealth = me?.maxHitPoints > 0 ? me.hitPoints / me.maxHitPoints : 1;
  // The soldier's own table is `setBattleStrength` (the kit's weapons do
  // not rewrite it: `AITemplateUnit` +0x14 is set by the con).
  const foot = unitUrgency({ health: myHealth, fire: bot._fireStrengthOf({ table: SOLDIER_BATTLE_STRENGTH, myType: 'Infantry' }),
                             maxSpeed: TANK.soldierMaxSpeed, value: 1, orderSplit: split });
  const ramp = Math.min(1, Math.max(0, (now - bot._lastChangeAt) / CHANGE.rampSeconds));
  const areaFactor = bot._insideOrderedArea() ? 1 : CHANGE.outsideAreaFactor;
  if (bot.vehicle) {
    // Seated: `staying` is the seat's own urgency x1.25, 0 when the hull
    // is upside down; the alternatives are the foot (a bail, doubled) and
    // the other free seats around. `isBailAllowed` 0x0855fd70: a soldier
    // must be able to stand where the hull is (the infantry map).
    const m = bot.vehicle;
    const mine = cands?.find(c => c.id === m.id) ?? null;
    const hull = world?.occupiedDamageable?.(bot.playerId);
    const health = hull?.maxHitPoints > 0 ? hull.hitPoints / hull.maxHitPoints : (mine?.health ?? 1);
    // `calculateVehicleMoveUrgency`: a driver moves the hull; a rider moves
    // only while someone drives it (x2.5 of the 4 under a bot driver whose
    // order differs — taken as the same order here).
    const driver = m.drives ? bot.playerId : (m.driverOf?.() ?? null);
    const seatSpeed = m.drives ? (m.maxSpeed ?? 0) : (driver ? (m.hullMaxSpeed ?? 0) : 0);
    // A seat has no mobile plug-in of its own: it is a fixed weapon
    // unless its hull is occupied (`calculateFireStrength` takes the
    // parent's), and a fixed weapon needs a known enemy it can point at.
    const rootOccupied = !!(mine?.seats ?? m.seats ?? []).find(s => s.isRoot)?.occupied;
    const seatFire = bot._fireStrengthOf({
      table: bot._seatStrengths(), others: bot._otherSeats(mine), air: m.kind === 'air', isSeat: !m.drives,
      myType: bot._myType(), fixed: !m.drives && !rootOccupied, aimable: bot._fixedAimable(),
    });
    const selfU = unitUrgency({ health, fire: seatFire,
                                maxSpeed: seatSpeed, occupiedByBot: !m.drives && !!driver,
                                value: mine?.value ?? 0, orderSplit: split });
    let staying = selfU * CHANGE.stayFactor;
    if (mine && mine.upright === false) staying = 0;
    const nav = bot.navGrid;
    let bailAllowed = !nav || isWalkable(nav, bot.position[0], bot.position[2]);
    // A landing craft's crew runs `BBChangeLandingCraft` 0x085602b0, not
    // `BBChange` (`Game/AIbehaviours.con`: the Change row of the
    // `LandingCraft`, `LandingCraftPassenger` and `LandingCraftFixed` units):
    // it weighs only the craft's own seats and gets out only at a beach or
    // when the craft has tipped, which the craft's beach order does
    // (doctrine-landing.js `landingTick`). No voluntary bail, no other hull.
    if (LANDING_CRAFT_RE.test(m.template ?? '')) {
      bailAllowed = false;
      // Its own bail, for every occupant whatever the driver holds (the
      // beach order's executor bails the crew it carries the same way): in
      // a zone, stopped, on the soldier's map, or tipped -> the Use key at
      // urgency 4.0 (0x085608ea).
      const v = m.hullVelocity?.();
      const reason = craftBailReason({
        zones: levelZones(world?.extras?.ai), x: bot.position[0], z: bot.position[2],
        speed: v ? Math.hypot(v.x, v.y, v.z) : 0,
        walkable: !nav || isWalkable(nav, bot.position[0], bot.position[2]),
        touchingLand: mine?.touchingLand ?? undefined, tipped: mine?.tipped ?? undefined, upright: mine?.upright,
      });
      if (reason) {
        // A driver who bails switches the craft's AI physics off
        // (`AIObjectPhysical::disablePhysics` at 0x08560958): its
        // `isTouchingLand` is its own map's test again (bot-units.js).
        if (m.drives && m.drive) m.drive.aiPhysics = false;
        const r = { urgency: LANDING_BAIL_URGENCY * mod, best: { id: 'foot', u: 0, dist: 0, cand: null }, bail: true,
                    teleport: false, landing: reason };
        bot.changedTarget.Change = (bot._changeResult?.best?.id ?? null) !== 'foot';
        bot._changeResult = r;
        return r.urgency;
      }
    }
    if (m.kind === 'air') {
      // In the air the engine's bail is a parachute jump; the viewer's
      // soldier has none, so a flying bot stays aboard until it is low
      // (INVENTION).
      const gy = world?.collider?.surfaceHeight?.(bot.position[0], bot.position[2]);
      bailAllowed = bailAllowed && Number.isFinite(gy) && bot.position[1] - gy < 6;
    }
    let best = null, bestU = 0, bail = false;
    if (bailAllowed && foot > bestU) { best = { id: 'foot', u: foot, dist: 0, cand: null }; bestU = foot; bail = true; }
    // The whole seated evaluation, the other units included, sits under
    // `isBailAllowed` (0x0855e0c0: `if (unit+6 & 0x40 || isBailAllowed)`):
    // a bot that may not get out may not get out for another hull either.
    // (A Spitfire bot left its plane at 66 m for a Wespe passing below.)
    for (const c of bailAllowed ? (cands ?? []) : []) {
      if (c.occupiedBy || c.upright === false || c.id === m.id) continue;
      // The hull's root is off its own map (0x0855ee25 -> 0x0855f0f0).
      if (c.onOwnMap === false) continue;
      const d = Math.hypot(c.pos[0] - bot.position[0], c.pos[2] - bot.position[2]);
      if (d > CHANGE.searchRadius) continue;
      if (c.vehicleId === m.vehicleId) continue;          // the same hull is the teleport's business
      if (c.kind === 'air' && !candidateRunwayClear(bot, c)) continue;
      // `modifyForDriver` 0x0855f7d0 scales a secondary seat's whole urgency.
      const u = unitUrgency({ health: c.health ?? 1, fire: bot._candidateFire(c),
                              maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split }) * (c.seatFactor ?? 1);
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
    const t = bot._urgencyChangeTeleport({ mine, selfU, split, driver, health });
    if (t && (!r || t.urgency > r.urgency)) r = t;
    if (!r) { bot._changeResult = null; bot.changedTarget.Change = false; return 0; }
    bot.changedTarget.Change = (r.best?.id ?? null) !== (bot._changeResult?.best?.id ?? null);
    bot._changeResult = r;
    return r.urgency;
  }
  if (!cands?.length) { bot._changeResult = null; return 0; }
  const nav = bot.navGrid;
  const list = [];
  for (const c of cands) {
    if (c.occupiedBy) continue;
    if (c.upright === false) continue;
    // `BBChange` 0x0855ee25 -> 0x0855f0f0: a mobile root (not an aircraft)
    // is offered, seats and all, only where its own map holds it
    // (bot-units.js `onOwnMap`).
    if (c.onOwnMap === false) continue;
    const d = Math.hypot(c.pos[0] - bot.position[0], c.pos[2] - bot.position[2]);
    if (d > CHANGE.searchRadius) continue;
    if (nav && !unitReachable(nav, c, d)) continue;
    // `BBChange::runwayClear` 0x0855f850 on a plane (bot-pilot.js).
    if (c.kind === 'air' && !candidateRunwayClear(bot, c)) continue;
    const leftAge = bot._leftVehicle?.id === c.vehicleId ? now - bot._leftVehicle.at : Infinity;
    // `modifyForDriver` 0x0855f7d0 scales a secondary seat's whole urgency
    // (0x0855e0c0: `calculateVehicleUrgency(seat) x radio x (f + 0.5) x
    // modifyForDriver(root)`).
    const u = unitUrgency({ health: c.health ?? 1, fire: bot._candidateFire(c),
                            maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split,
                            occupiedByBot: !!c.movedByBot,
                            spawnAge: c.spawnAge ?? Infinity, leftAge }) * (c.seatFactor ?? 1);
    list.push({ id: c.id, u, dist: d, cand: c });
  }
  const r = changeUrgency({ staying: foot, candidates: list, mod, ramp, areaFactor });
  bot.changedTarget.Change = (r.best?.id ?? null) !== (bot._changeResult?.best?.id ?? null);
  bot._changeResult = r;
  return r.urgency;
}

/** Beyond 12 m BBChange tests the unit on the bot's own map. */
const REACH_TEST_BEYOND = 12.0;
/** The line behind a `setUseNoPathfindingToGetToObject` unit, metres. */
const REACH_TRACE_BEHIND = 12.0;

/**
 * `BBChange::calculateUrgency` 0x0855e0c0's reach test for a unit on foot
 * (the branch on the soldier's map, `uStack_224`): a unit whose
 * `AITemplateUnit+0x15` (`setUseNoPathfindingToGetToObject`, ConsoleClass557
 * 0x08506040) is clear passes within 12 m (`144.0 < d^2`) and beyond it
 * when its own position is a valid cell (`AIPathfinding::isValidPosition`
 * 0x0847ccc0, vt+0x78); with the flag set it passes when
 * `traceValidPoint` 0x0847e500 (vt+0x54) finds a valid point on the line
 * from the unit to 12 m behind it (`-forward x 12`). The trace's own walk
 * (vt+0x58) is not read: here the line is sampled every half metre
 * (INVENTION). The engine's baked map holds no vehicles; the viewer's
 * paints a parked hull's footprint, so the unit's "own cell" is the
 * nearest free cell within its door's radius of its position (INVENTION).
 * The door (`c.entry`) was tested before, which a gun's seat inside its own
 * footprint never passed: no bot took a fixed gun.
 */
export function unitReachable(nav, c, d) {
  const [x, , z] = c.pos;
  if (c.noPathfinding) {
    const yaw = c.hullYaw ?? 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let s = 0; s <= REACH_TRACE_BEHIND; s += 0.5) if (isWalkable(nav, x - fx * s, z - fz * s)) return true;
    return false;
  }
  if (d <= REACH_TEST_BEYOND) return true;
  if (isWalkable(nav, x, z)) return true;
  const r = Math.max(c.entryRadius ?? 0, 1.0);
  const step = Math.max(nav.cellSize ?? 1, 0.5);
  for (let rr = step; rr <= r + 1e-6; rr += step) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      if (isWalkable(nav, x + rr * Math.cos(t), z + rr * Math.sin(t))) return true;
    }
  }
  return false;
}

/** The strength table of the seat the bot holds (its guns). */
export function seatStrengths(bot) {
  return unitTable(bot.weapons);
}

/** `calculateFireStrength` against the side's enemy tables. With no
 *  strategic pass yet the enemy is taken to field infantry only. */
export function fireStrengthOf(bot, { table, others = [], air = false, isSeat = false, myType = 'Infantry', fixed = false, aimable = true }) {
  const t = bot.enemyTables;
  const enemyStrengths = t?.strengths ?? {};
  const enemyTypes = t && t.passes > 0 ? t.types : { Infantry: 1 };
  return fireStrength({ table, others, air, isSeat, myType, enemyStrengths, enemyTypes, fixed, aimable });
}

/** A candidate seat's fire strength: its table plus the shares of the
 *  hull's other occupied seats. A fixed gun, or a seat of a hull nobody
 *  drives, is a fixed weapon and needs a known enemy it can point at. */
export function candidateFire(bot, c) {
  // Weighing another seat of the hull it sits in, the bot counts its own
  // seat as empty: it would leave it (0x08584580, `unit != param_7 ||
  // !param_6` on the root's and every seat's share and on the root's
  // mobile test). Without this a driver saw the gunner's seat as a seat
  // under a driver, and the gunner saw the root as a hull with a gunner:
  // each side of the swap beat the other and the bot changed seats every
  // tick.
  const m = bot.vehicle;
  const vacate = m && c.vehicleId === m.vehicleId && c.seatId !== m.seatId ? m.seatId : null;
  const seats = (c.seats ?? []).map(s => (s.seatId === vacate ? { ...s, occupied: false } : s));
  const rootOccupied = !!seats.find(s => s.isRoot)?.occupied;
  const fixed = c.kind === 'gun' || (!c.isRoot && !rootOccupied);
  return bot._fireStrengthOf({
    table: c.strengths ?? {}, others: seats.filter(s => s.seatId !== c.seatId),
    air: c.kind === 'air', isSeat: !c.isRoot, myType: c.strType ?? 'LightArmour',
    fixed, aimable: fixed ? bot._fixedAimable(c) : true,
  });
}

/** The other seats of the hull the bot sits in, for the share. */
export function otherSeats(bot, mine) {
  return (mine?.seats ?? bot.vehicle?.seats ?? []).filter(s => s.seatId !== bot.vehicle?.seatId);
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
export function fixedAimable(bot, c = null) {
  const limits = c ? c.yawLimits : bot.vehicle?.occupancy?.turret?.yawLimitsRadians?.();
  const hullYaw = c ? (c.hullYaw ?? 0) : bot.yaw;
  const canPoint = (dir) => {
    if (!limits) return true;
    const want = wrapAngle(Math.atan2(dir[0], dir[2]) - hullYaw);
    return want >= limits[0] && want <= limits[1];
  };
  const from = c?.pos ?? bot.position;
  const dirTo = (pos) => {
    const dx = pos[0] - from[0], dz = pos[2] - from[2];
    const d = Math.hypot(dx, dz) || 1;
    return [dx / d, 0, dz / d];
  };
  const spotted = bot.senses.spottedEnemies();
  if (spotted.length) return spotted.some(m => canPoint(dirTo(m.pos))) ? 'enemy' : false;
  let range = 0;
  for (const w of (c ? c.weapons : bot.weapons) ?? []) range = Math.max(range, w.maxRange ?? 0);
  for (const [id, p] of bot.world?.players ?? []) {
    if (id === bot.playerId || p.team === bot.team || bot.world.armorOf?.(id)?.destroyed) continue;
    const pos = playerPosition(p);
    if (!pos) continue;
    if (Math.hypot(pos[0] - from[0], pos[2] - from[2]) <= range) return 'enemy';
  }
  const flag = bot._nearestEnemyFlag();
  return flag?.position && canPoint(dirTo(flag.position)) ? 'strategic' : false;
}

/**
 * `BBChangeTeleport::calculateUrgency`: the root's and the other seats'
 * urgencies by where the bot sits, the winner other than its own seat.
 */
export function urgencyChangeTeleport(bot, { mine, selfU, split, driver, health }) {
  const m = bot.vehicle;
  const seats = mine?.seats ?? m.seats ?? [];
  if (!seats.length) return null;
  const cands = bot.vehicleCandidates ?? [];
  const rootCand = cands.find(c => c.vehicleId === m.vehicleId && c.isRoot) ?? null;
  const rootOccupied = !!(rootCand?.occupiedBy) && rootCand.occupiedBy !== bot.playerId;
  let where = 'root';
  if (!m.drives && !mine?.isRoot) {
    where = rootOccupied ? 'seatUnderDriver' : (m.kind === 'air' ? 'seatAir' : m.kind === 'ship' ? 'seatShip' : 'seatLand');
  }
  // The bot weighs each seat as the one it would move to, leaving its own
  // (the vacate rule `candidateFire` follows, 0x08584580 `unit != param_7`):
  // a driver weighing a gunner's seat leaves the hull undriven, so that
  // seat has no move term. Scored with the driver still aboard, a
  // Hanomag's MG seat outbid the wheel it had just been left for, and the
  // bot changed seats every two seconds (El Alamein seed 2, 70 swaps).
  const others_ = driver === bot.playerId ? null : driver;
  const uOf = (c) => unitUrgency({ health, fire: bot._candidateFire(c),
                                   maxSpeed: c.drives ? (c.maxSpeed ?? 0) : (others_ ? (m.hullMaxSpeed ?? 0) : 0),
                                   occupiedByBot: !c.drives && !!others_, value: c.value ?? 0, orderSplit: split });
  const rootU = rootCand && !rootOccupied && where !== 'root' ? uOf(rootCand) : 0;
  const others = [];
  for (const c of cands) {
    if (c.vehicleId !== m.vehicleId || c.seatId === m.seatId || c.isRoot || c.occupiedBy) continue;
    others.push({ id: c.id, u: uOf(c), cand: c });
  }
  const orderFactor = bot.waypoints ? 1 : bot.botSkill;
  const r = teleportChangeUrgency({ where, rootU, selfU, seats: others, orderFactor, attackSplit: split[0],
                                    hasPlan: bot._hasPlan(), pending: !!bot.enterRequest });
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
export function planChange(bot, now) {
  const r = bot._changeResult;
  if (bot.vehicle) {
    if (!r?.best) return bot._planIdle();
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
  if (!best) return bot._planIdle();
  const cur = bot.currentPlan;
  if (bot.planBehaviour === BEHAVIOUR.Change && cur.length && cur.vehicleId === best.id && !best.occupiedBy) return cur;
  const entry = best.entry ?? [best.pos[0], best.pos[2]];
  const radius = Math.max(best.entryRadius ?? 4, 2.0);
  const plan = [
    { type: PLAN_ACTION.SoldierPose, pose: 'stand' },
    { type: PLAN_ACTION.InfantryMoveTo, waypoint: [entry[0], bot.position[1], entry[1]], arrive: radius },
    { type: PLAN_ACTION.EnterVehicle, vehicleId: best.id, seatId: best.seatId ?? null, entry, radius, afterMove: true },
  ];
  plan.vehicleId = best.id;
  plan.startedAt = now;
  return plan;
}

/** `ExitVehicle`: ask the page to unseat the bot (the Use key held). */
export function execExitVehicle(bot) {
  if (!bot.vehicle) return true;
  bot.exitRequest = true;
  return false;
}

/** `SwitchSeat` (`BAPICChangeVehicle` + the select key): the page reseats. */
export function execSwitchSeat(bot, action) {
  if (!bot.vehicle) return true;
  if (bot.vehicle.seatId === action.seatId) return true;
  bot.switchRequest = { vehicleId: action.vehicleId, seatId: action.seatId };
  return false;
}

/** `EnterVehicle`: inside the door's radius, ask the page for the seat. */
export function execEnterVehicle(bot, action) {
  if (bot.vehicle) return true;
  const d = Math.hypot(action.entry[0] - bot.position[0], action.entry[1] - bot.position[2]);
  if (d > action.radius + 0.5) return false;
  bot.enterRequest = { vehicleId: action.vehicleId, seatId: action.seatId };
  return false;
}
