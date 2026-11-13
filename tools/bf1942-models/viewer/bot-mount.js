// A bot and vehicles: the page's mount and dismount, the Change behaviour
// (`BBChange` / `BBChangeTeleport`) weighing staying against the foot, other
// hulls and the other seats of its own, the fire strengths it scores them
// by, the Change plan and its enter, exit and seat-switch executors. Plain
// functions of the `BotController` (bot.js), which delegates its methods
// here.

import { isWalkable, traceValidPoint } from './nav-grid.js';
import { playerPosition } from './bot-sense.js';
import { weaponAiOf, SOLDIER_BATTLE_STRENGTH } from './bot-fire.js';
import { unitUrgency, inclinationSplit, changeUrgency, teleportChangeUrgency, mannedByEnemy, TANK, CHANGE, TELEPORT } from './bot-vehicle.js';
import { decleiningSlope } from './bot-behaviours.js';
import { fireStrength, unitTable } from './bot-strength.js';
import { wrapAngle } from './bot-aim.js';
import { BEHAVIOUR } from './bot-decision.js';
import { PLAN_ACTION, approachGoal } from './bot-plans.js';
import { candidateRunwayClear } from './bot-pilot.js';
import { craftBailReason, levelZones, LANDING_CRAFT_RE } from './doctrine-landing.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { changeRadioStrength, teleportRadioStrength, radioOf } from './bot-radio.js';

/** How long a human's request for a bot's seat lasts: `calculateVehicleUrgency`
 *  0x08583c61 (`15.0`, 0x86b01b0), past which the bot drops it (vt+0x184). */
export const SEAT_REQUEST_SECONDS = 15.0;

/**
 * The age of a human's standing request for unit `id`, or Infinity
 * (`BotMain+0x1e4` / `+0x1e8`, set by `playerRequestPlayerControlObject`
 * 0x0852ed40). A request 15 s old is dropped, as the bot's vt+0x184 does
 * from `calculateVehicleUrgency` 0x08583d4f.
 */
export function seatRequestAge(bot, id, now) {
  const q = bot.seatRequest;
  if (!q) return Infinity;
  const age = now - q.at;
  if (!(age < SEAT_REQUEST_SECONDS)) { bot.seatRequest = null; return Infinity; }
  return q.id === id ? age : Infinity;
}

/** `getRadioStrength`'s unit class: the soldier, a naval unit, any other. */
function radioKind(kind) {
  return kind === 'ship' ? 'ship' : 'vehicle';
}

/** The Change walk's arrival: `getMaxPathPosRemovalDistance` 0x0852b780,
 *  `0.99 x max(0.5, radius - |sphere offset|)`, a soldier's 1.0 radius. */
const CHANGE_ARRIVE = 0.99;

/** The soldier's collision radius `CHANGE_ARRIVE` is made from. */
const SOLDIER_RADIUS = 1.0;

/**
 * Where the AI measures a bot on foot from: his Information's position,
 * the soldier object's absolute position, which is his origin a metre over
 * his feet (`setCharacterHeight -1.00`, soldier-pose.js `CHARACTER_HEIGHT`;
 * the page's `bot.position` is the feet). `BBChange::calculateUrgency`
 * 0x0855e0c0 (its `pfVar17`, the bot's unit's vt+0x1c), `BBPChange::
 * createPlan`'s 12.5 m and `BAPConObjectDistance::evaluate` 0x0854fce0's
 * 12.375 m (both Informations' vt+0x1c, 3D) all take it. On a ship's deck the
 * metre decides the seat: the Hood's spawn deck stands 11.2 m over the
 * hull's origin, where every seat object sits (AI-161).
 */
export function aiOrigin(bot) {
  const p = bot.position;
  return bot.vehicle ? [p[0], p[1], p[2]] : [p[0], p[1] + CHARACTER_HEIGHT, p[2]];
}

/**
 * The Change walk's arrival: `BAPAMoveToObjectFinding::initObjectFinding`
 * 0x08545df0 hands the bot's `initPathfinding` (BotMain vt+0xec, 0x0852a0d0,
 * which keeps it at the path's +0x5c, 0x0852a6a5) `min(+0x68, 1.1 x the
 * target's radius)`, the +0x68 being `BBPChange`'s 6.25 (0x0858e797); the
 * path is done once the bot's last point lies inside it in x/z
 * (`BotMain::updateLocalPath` 0x08527120: the `fsqrt` of two squares at
 * 0x085275ec against +0x5c at 0x085275f7). The target's radius is the
 * hull's own box from its origin here (the seat object's own sphere is not
 * computed: INVENTION, and the 6.25 caps every hull bigger than a jeep).
 * Measured (AI-161): retail's deck bots stop 6.4 to 10 m off the Hood's
 * origin in x/z and stand there in Change. The viewer walked them to within
 * 0.99 m, on top of the seat objects, and seated them.
 */
export function changeArrive(c) {
  const b = c?.localBox;
  let r = Infinity;
  if (b?.min && b?.max) {
    r = 0;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      r = Math.max(r, Math.hypot(x, y, z));
    }
  }
  return Math.max(CHANGE_ARRIVE, Math.min(CHANGE.approachTo, 1.1 * r));
}

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
  // A helicopter pilot's collective integral (`helicopterControl`) is the
  // hull's, not the bot's: it starts again at a hover's.
  bot._heliState = null;
  bot.enterRequest = null;
  bot._lastChangeAt = now;
  bot._footWeapons = bot.weapons;
  bot.weapons = (m.weapons?.length ? m.weapons : [{ name: m.template ?? 'vehicle', maxRange: 0, strength: {} }]).map(weaponAiOf);
  bot.exitRequest = false;
  bot.weaponIndex = 0;
  bot._execInfantryResetControls();
  bot.currentPlan = []; bot.currentBehaviour = null; bot.planBehaviour = null;
  bot.route = null;
  // A hull's touch and flag re-plans keep the obstruction count (bot-route.js
  // `ensureRoute`): the new body starts it afresh, and nothing a re-plan was
  // asked for on foot carries into the seat.
  bot._stalledTicks = 0; bot._backOut = false; bot._replanKeepsCount = false; bot._hullContactTicks = 0;
  // A seat has no soldier poses; the pose request starts over when he steps
  // out (INFERRED: the `BotMain` ctor's state, bot-pose.js).
  bot.poseRequest?.reset(); bot.stanceInput = 'stand';
}

/**
 * The gun rule the bot follows: its order's (`guns`), or, while it holds
 * none (the seconds between a unit change and the next pass, when the SAI
 * has dropped it), its side's doctrine's standing rule (`bot.gunsRule`,
 * doctrine.js `gunsRuleOf`). The garrison's 'engaged' read off the order
 * alone lapsed for exactly those seconds, so a bot weighed a fixed gun by
 * the garrison's rule on foot and by the engine's once seated.
 */
export function gunsRule(bot) {
  return bot.waypoints ? (bot.waypoints.guns ?? null) : (bot.gunsRule ?? null);
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
  bot.poseRequest?.reset(); bot.stanceInput = 'stand';
}

/**
 * `BBChange::isBailAllowed` 0x0855fd70's map test (AI-46, AI-147): a seated
 * bot may get out where the soldier's map holds the unit's position, and from
 * a `setUseNoPathfindingToGetToObject` unit (its Unit plug-in's +0x15, the
 * fixed guns) wherever it stands: a blocked cell refuses the bail only when
 * that flag is clear (`cmpb $0, 0x15` at 0x0855ff88). Not read into the
 * viewer: the engine's last veto, an object of one type on the bot's
 * spotted list (`+7 & 8`, 0x0855ff38), and an immobile unit's own
 * vt+0x6c answer (0x0855ffaf).
 */
export function bailAllowedAt(nav, pos, unit) {
  return !nav || isWalkable(nav, pos[0], pos[2]) || !!unit?.noPathfinding;
}

/**
 * `BBChange::calculateUrgency` (bot-vehicle.js): on foot, the enterable
 * land vehicles the page lists against staying on foot; mounted, no
 * voluntary bail (INVENTION: `isBailAllowed` is not read; the page
 * unseats a bot whose vehicle is destroyed).
 */
export function urgencyChange(bot, mod, now) {
  // A garrison post (doctrine-garrison.js, INVENTION) does not Change: the
  // post seats him at the flag's gun, or keeps him on foot at the flag.
  if (bot.waypoints?.kind === 'WPPost') {
    bot._changeResult = null;
    bot.changedTarget.Change = false;
    return 0;
  }
  const cands = bot.vehicleCandidates;
  const world = bot.world;
  // The fire / move split from the bot's inclinations (bot-decision.js
  // `stepInclinations`; ledger AI-43 corrected).
  const split = inclinationSplit(bot.inclination?.fire ?? 0, bot.inclination?.move ?? 0);
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
    // The seat he holds, a door-less one too (the artillery driver's).
    const mine = hullCandidates(cands, m.vehicleId).find(c => c.id === m.id) ?? null;
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
                                value: mine?.value ?? 0, orderSplit: split,
                                requestAge: seatRequestAge(bot, m.id, now) });
    let staying = selfU * CHANGE.stayFactor;
    if (mine && mine.upright === false) staying = 0;
    // The radio term of the hull (`getRadioStrength` 0x0855fc10, called on
    // the root at 0x0855e7c9): `(1 + GetIn) x (1 - BailOut)`, AbandonShip
    // on a naval hull. The stay option enters the comparison scaled by it
    // (0x0855e7d9: own urgency x 1.25 x radio is the best to beat), and so
    // does each of the hull's other seats (0x0855f4db). What `x` divides by
    // is the driver's own x 1.25 (0x0855f682 -> -0x20c) but, for a seat
    // under a driver, its own x 1.25 x radio (0x0855f5d5): so a gunner a
    // teammate shouted "Bail out!" at from under 56 m (radio < 0) has a
    // negative `x` and no Change at all (DecleiningSlopeCurve 0x08655560
    // gives 0 at or under 0), while a driver bails. Upside down there is no
    // radio (0x0855f635: 1, the stay 0).
    const s = radioOf(bot);
    const radio = mine && mine.upright === false ? 1 : changeRadioStrength(radioKind(m.kind), s);
    const nav = bot.navGrid;
    // Not from a cell the soldier's map blocks, unless the unit is a fixed
    // gun: a bot in Bocage's base AA guns, which stand on blocked cells,
    // never got out, where the retail ones climb out (bailAllowedAt).
    let bailAllowed = bailAllowedAt(nav, bot.position, mine);
    // Under the garrison (doctrine-garrison.js, INVENTION) a bot not on a post
    // sitting in a fixed gun with no enemy he has spotted in its reach gets
    // out: his own gun counts him as its occupant, so the fixed weapon's test
    // above never applied to it. (A gun on a blocked cell, Bocage's hill
    // bunker MG42, refused the bail before AI-147's exemption; the engine
    // never did.) He steps out at the gun's own `setSoldierExitLocation`
    // (bot-units.js `units.leave`).
    if (gunsRule(bot) === 'engaged' && m.kind === 'gun' && !bot._fixedAimable()) {
      staying = 0;
      bailAllowed = true;
    }
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
    // The bar the alternatives must beat is the stay option itself (`best`
    // starts as the bot's own unit, 0x0855e752 / 0x0855e7e3); it stays the
    // best -> no Change (0x0855ea34).
    const stayBar = staying * radio;
    const stayDiv = m.drives ? staying : stayBar;
    let best = null, bestU = stayBar, bail = false;
    if (bailAllowed && foot > bestU) { best = { id: 'foot', u: foot, dist: 0, cand: null }; bestU = foot; bail = true; }
    // The whole seated evaluation, the other units included, sits under
    // `isBailAllowed` (0x0855e0c0: `if (unit+6 & 0x40 || isBailAllowed)`):
    // a bot that may not get out may not get out for another hull either.
    // (A Spitfire bot left its plane at 66 m for a Wespe passing below.)
    for (const c of bailAllowed ? (cands ?? []) : []) {
      if (c.occupiedBy || c.upright === false || c.id === m.id) continue;
      // `isMannedByEnemy` 0x0855fcb0 (bot-vehicle.js): an enemy crew's hull
      // is no alternative, any of its seats.
      if (mannedByEnemy(c, bot.team)) continue;
      // The hull's root is off its own map (0x0855ee25 -> 0x0855f0f0).
      if (c.onOwnMap === false) continue;
      const d = Math.hypot(c.pos[0] - bot.position[0], c.pos[2] - bot.position[2]);
      if (d > CHANGE.searchRadius) continue;
      if (c.vehicleId === m.vehicleId) continue;          // the same hull is the teleport's business
      // A unit this bot gave up on (INVENTION, `UNIT_VETO`).
      if (unitVetoed(bot, c, now)) continue;
      if (c.kind === 'air' && !candidateRunwayClear(bot, c)) continue;
      // `modifyForDriver` 0x0855f7d0 scales a secondary seat's whole urgency.
      // The unit's own urgency is `calculateVehicleUrgency` 0x08583b10 as
      // on foot, with its x2.5 move factor when a bot already moves it and
      // its 15 s ramps after the bot left it or it spawned: the same unit
      // scored higher from a seat than from the ground, so a bot drove a
      // Pickup, got out for another Pickup's passenger seat (63 from the
      // seat, 44 on foot), and walked to a Shilka instead, over and over.
      const leftAge = bot._leftVehicle?.id === c.vehicleId ? now - bot._leftVehicle.at : Infinity;
      const u = unitUrgency({ health: c.health ?? 1, fire: bot._candidateFire(c),
                              maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split,
                              occupiedByBot: !!c.movedByBot,
                              spawnAge: c.spawnAge ?? Infinity, leftAge,
                              requestAge: seatRequestAge(bot, c.id, now) }) * (c.seatFactor ?? 1);
      const f = Math.min(0.5, (CHANGE.searchRadius ** 2 - d * d) / CHANGE.searchRadius ** 2);
      // The candidate's own radio term (0x0855ee58 -> x -0x218 at 0x0855eeab).
      const v = u * (f + 0.5) * changeRadioStrength(radioKind(c.kind), s);
      if (v > bestU) { best = { id: c.id, u: v, dist: d, cand: c }; bestU = v; bail = false; }
    }
    let r = null;
    if (best) {
      // 0x0855eb22: `x = 0.5 best / stay`, or `0.5 best` when the stay is 0.
      const x = stayDiv !== 0 ? 0.5 * bestU / stayDiv : 0.5 * bestU;
      const urgency = decleiningSlope(x) * mod * CHANGE.urgencyScale * ramp * areaFactor * (bail ? 2 : 1);
      r = { urgency, best, bail, teleport: false };
    }
    // `BBChangeTeleport`: the other seats of this hull.
    const t = bot._urgencyChangeTeleport({ mine, selfU, split, driver, health,
                                           radio: teleportRadioStrength(radioKind(m.kind), s),
                                           requestAge: seatRequestAge(bot, m.id, now) });
    if (t && (!r || t.urgency > r.urgency)) r = t;
    if (!r) { bot._changeResult = null; bot.changedTarget.Change = false; return 0; }
    bot.changedTarget.Change = (r.best?.id ?? null) !== (bot._changeResult?.best?.id ?? null);
    bot._changeResult = r;
    return r.urgency;
  }
  if (!cands?.length) { bot._changeResult = null; return 0; }
  const nav = bot.navGrid;
  const origin = aiOrigin(bot);
  const footRadio = radioOf(bot);
  const list = [];
  // The seats a press of Use can reach: each has a door of its own. The
  // engine also weighs a door-less seat here (AI-139), one its Use never
  // seats him in; the list leaves those out (bot-units.js `doorless`).
  for (const c of cands) {
    if (c.occupiedBy) continue;
    // A unit this bot gave up on, unreachable (INVENTION, `UNIT_VETO`).
    if (unitVetoed(bot, c, now)) continue;
    // `BBChange::isMannedByEnemy` 0x0855fcb0, tested at 0x0855ea07 before
    // anything else is scored: the free seat of a hull the enemy crews is
    // not offered (the gunner's seat of a tank the enemy drives), so the bot
    // never walks to a door the entry rule would refuse it at.
    if (mannedByEnemy(c, bot.team)) continue;
    if (c.upright === false) continue;
    // `BBChange` 0x0855ee25 -> 0x0855f0f0: a mobile root (not an aircraft)
    // is offered, seats and all, only where its own map holds it
    // (bot-units.js `onOwnMap`).
    if (c.onOwnMap === false) continue;
    const d = Math.hypot(c.pos[0] - bot.position[0], c.pos[2] - bot.position[2]);
    if (d > CHANGE.searchRadius) continue;
    // The score's distance and the 12 m reach test are 3D from his origin
    // (0x0855e0c0: the three differences into `fVar3`, then `144.0 < fVar3`
    // and `(R^2 - fVar3) / R^2`); the 50 m cut stays the page's x/z one
    // (`BFEnvironment::getHardware` 0x085e2fa0 asks the grid, not read).
    const d3 = Math.hypot(c.pos[0] - origin[0], c.pos[1] - origin[1], c.pos[2] - origin[2]);
    if (nav && !unitReachable(nav, c, d3)) continue;
    // `BBChange::runwayClear` 0x0855f850 on a plane (bot-pilot.js).
    if (c.kind === 'air' && !candidateRunwayClear(bot, c)) continue;
    const leftAge = bot._leftVehicle?.id === c.vehicleId ? now - bot._leftVehicle.at : Infinity;
    // `modifyForDriver` 0x0855f7d0 scales a secondary seat's whole urgency
    // (0x0855e0c0: `calculateVehicleUrgency(seat) x radio x (f + 0.5) x
    // modifyForDriver(root)`).
    // The radio term (`getRadioStrength` of the unit, 0x0855ee58): a "Get in!"
    // a teammate shouted from his hull raises every unit, a "Bail out!"
    // lowers them all for as long as it lasts in this bot.
    const u = unitUrgency({ health: c.health ?? 1, fire: bot._candidateFire(c),
                            maxSpeed: c.maxSpeed ?? 0, value: c.value ?? 0, orderSplit: split,
                            occupiedByBot: !!c.movedByBot,
                            spawnAge: c.spawnAge ?? Infinity, leftAge,
                            requestAge: seatRequestAge(bot, c.id, now) })
      * (c.seatFactor ?? 1) * changeRadioStrength(radioKind(c.kind), footRadio);
    list.push({ id: c.id, u, dist: d3, cand: c });
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
  let range = 0;
  for (const w of (c ? c.weapons : bot.weapons) ?? []) range = Math.max(range, w.maxRange ?? 0);
  // Under the garrison (doctrine-garrison.js, INVENTION) a bot not on a post
  // gives a gun something only for an enemy he has spotted inside its range
  // and traverse: not for one somewhere in range he has not seen (the
  // engine's `getEnemyObjects` branch below, which on Bocage covered most of
  // the map from the bridges' AA guns), nor for the strategic direction.
  if (gunsRule(bot) === 'engaged') {
    return spotted.some(m => canPoint(dirTo(m.pos)) && Math.hypot(m.pos[0] - from[0], m.pos[2] - from[2]) <= range)
      ? 'enemy' : false;
  }
  if (spotted.length) return spotted.some(m => canPoint(dirTo(m.pos))) ? 'enemy' : false;
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
export function urgencyChangeTeleport(bot, { mine, selfU, split, driver, health, radio = 0, requestAge = Infinity }) {
  const m = bot.vehicle;
  const seats = mine?.seats ?? m.seats ?? [];
  if (!seats.length) return null;
  // `BBChangeTeleport` weighs the hull's root and seats as AI units, door
  // or none: the driver's seat of DC's artillery, whose doors all hang under
  // the gun seat, is reached only this way (AI-139).
  const cands = hullCandidates(bot.vehicleCandidates, m.vehicleId);
  const rootCand = cands.find(c => c.isRoot) ?? null;
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
    if (c.seatId === m.seatId || c.isRoot || c.occupiedBy) continue;
    others.push({ id: c.id, u: uOf(c), cand: c });
  }
  const orderFactor = bot.waypoints ? 1 : bot.botSkill;
  // `radio`: the BailOut (AbandonShip on a ship) strength in its `1 - s`
  // (0x0856145b). It scales the stay and every seat alike, so on its own it
  // moves no one to another seat.
  // `requested`: a human's standing request for this seat (`requestAge`
  // under 15 s; AI-172). `selfU` already carries its `age / 15`, so a free
  // seat with anything to offer wins the ordinary swap; with none, the own
  // seat stays best and the engine's answer is 6.0 and the re-deploy
  // (0x0856192b..0x085619ce; AI-173).
  // Only a seat whose row's Change is `BBChangeTeleport` or
  // `BBChangeLandingCraft` reads the request here (the ship rows, the
  // artillery gunner's): a tank's or a car's crew answers it through
  // `BBChange`, by climbing out (`urgencyChange`). A seat with no row is
  // taken by its hull's kind.
  const landing = LANDING_CRAFT_RE.test(m.template ?? '');
  const change = m.row?.behaviours?.Change ?? (m.kind === 'ship' ? 'ChangeTeleport' : null);
  const requested = requestAge < SEAT_REQUEST_SECONDS && (landing || change === 'ChangeTeleport');
  const r = teleportChangeUrgency({ where, rootU, selfU, seats: others, orderFactor, attackSplit: split[0],
                                    requested, radio,
                                    // `BBChangeLandingCraft` 0x085602b0 for a landing craft's seats.
                                    landing });
  if (!r.best) {
    if (!r.redeploy) return null;
    return { urgency: r.urgency, best: { id: m.id, u: selfU, dist: 0, cand: mine }, bail: false, teleport: true,
             redeploy: true };
  }
  const cand = r.best.id === 'root' ? rootCand : others.find(o => o.id === r.best.id)?.cand;
  if (!cand) return null;
  return { urgency: r.urgency, best: { id: cand.id, u: r.best.u, dist: 0, cand }, bail: false, teleport: true };
}

/** The candidates of one hull: its seats with a door, in the list, and the
 *  seats with none riding on them (`bot-units.js` `doorless`). */
export function hullCandidates(cands, vehicleId) {
  const hull = (cands ?? []).filter(c => c.vehicleId === vehicleId);
  return hull.length ? [...hull, ...(hull[0].doorless ?? [])] : hull;
}

/** Where `BBPChange`'s distances run from: the seat's own object. */
function seatPoint(c) {
  return c.seatPos ?? c.pos;
}

/** `BAPConObjectBehind::evaluate` 0x0854f720: the bot lies behind the unit
 *  when the unit's forward (its matrix row 2, x/z) dotted with the unit-to-
 *  bot direction is at most `cos` (-0.8). The viewer's forward is the
 *  hull's (`hullYaw`, its -z column, as `unitReachable` walks it). */
export function behindUnit(c, from, cos = CHANGE.behindCos) {
  const p = seatPoint(c);
  const dx = from[0] - p[0], dz = from[2] - p[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return false;
  const yaw = c.hullYaw ?? 0;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d <= cos;
}

/**
 * `BBPChange::createPlan` 0x0858b5c0 (AI-44; the foot branch read again
 * 2026-10-06, AI-138). On foot the plan is `IWChange(Parallel{
 * ChangeVehicle(target), Serial{ Parallel{ walk?, Use }, UpdateVehicle }})`:
 *
 *  * the walk only beyond 12.5 m (3D, the two units' positions): a
 *    `BAPAMoveToObjectFinding` with finding radius 6.25 (`approachGoal`,
 *    AI-126), broken when the unit is occupied or enemy-occupied; a
 *    `setUseNoPathfindingToGetToObject` unit at any range is walked to from
 *    behind, the first valid point on the 12 m line behind it
 *    (`traceValidPoint`, vt+0x54). Inside 12.5 m there is no walk;
 *  * in parallel, the Use key while the seat lies within 12.375 m (and,
 *    for the no-pathfinding unit, the bot behind it), until it is taken.
 *    `toggleEntryPoint` 0x0814ee70 seats a bot through `validateBFEntryPoint`
 *    0x0831d590: the seat's own object within 15 m, free, not a wreck, with
 *    a door of its own -- not the door's radius, which only the human's
 *    finder reads.
 *
 * So a bot standing 2 m from a Lada, or 8 m from a sandbagged MG, gets in
 * without walking. The viewer walked every bot to the door and seated it
 * inside the door's radius, which a soldier pressed against the hull or the
 * sandbags never reached: the bots that stood in Change all round on DC
 * Basrah's Edge, vanilla Battleaxe and Kharkov (features/bot-desert-combat).
 * Where the finding has no goal the engine falls back to
 * `getNearStrategicPosition` (vt+0x9c, not ported): the walk goes to the
 * door, or the unit, as before (INVENTION). There is no pose statement: the
 * moves' own poses decide (bot-pose.js `movePose`).
 */
export function planChange(bot, now) {
  const r = bot._changeResult;
  if (bot.vehicle) {
    if (!r?.best) return bot._planIdle();
    if (r.redeploy) {
      // `BBPChangeTeleport::createPlan` 0x08590590 with the flag `init`
      // stored clear (0x08590722 -> 0x08590cb0): `setChangeTarget(own
      // unit)`, then `SAI::registerTeleporter(bot)` on the side's SAI
      // (`IAIMain::getSAI(team)` vt+0x30, SAI vt+0x60 at 0x08590cde), and a
      // plan that only waits: `BAPIWChange(unit, Parallel(BAPICChangeVehicle,
      // BAPFlowCWait(BAPConTime(2.0))))`. The SAI's next pass takes the bot
      // out of the seat and stands it on one of the side's spawn points,
      // alive (bot-referee.js `handleTeleportingBot`). The plan is kept
      // while it waits, so the bot is registered once a plan.
      const cur = bot.currentPlan;
      if (bot.planBehaviour === BEHAVIOUR.Change && cur?.redeploy && cur[0] && !cur[0].done) return cur;
      bot.teleportRequest = true;
      const plan = [{ type: PLAN_ACTION.Wait, until: now + TELEPORT.redeployWait }];
      plan.vehicleId = r.best.id;
      plan.startedAt = now;
      plan.redeploy = true;
      return plan;
    }
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
  const at = seatPoint(best);
  const o = aiOrigin(bot);
  const d2 = (at[0] - o[0]) ** 2 + (at[1] - o[1]) ** 2 + (at[2] - o[2]) ** 2;
  const nav = bot.navGrid ?? null;
  let goal;
  let arrive = CHANGE_ARRIVE;
  if (best.noPathfinding) {
    const yaw = best.hullYaw ?? 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const bx = at[0] - fx * CHANGE.behindDistance, bz = at[2] - fz * CHANGE.behindDistance;
    // INVENTION: the trace starts behind the unit's own body, a soldier's
    // radius past its box (local +z is behind). Where the soldier's map
    // leaves the gun's own spot free (two of vanilla Bocage's seven AA gun
    // spots, the flags'; the level's own baked map blocks the other five)
    // the engine's trace answers that spot too (AI-39), and the engine's
    // soldier stops against the gun's body, behind it only when he came from
    // behind. The viewer's walks through the gun onto its spot, where he is
    // behind nothing, so a bot coming from the front stood there for good.
    // The offset stands in for that collision; on a blocked spot it lands
    // near where the engine's trace does, at the first free cell behind.
    const s0 = Math.min(Math.max(best.localBox?.max?.[2] ?? 0, 0) + SOLDIER_RADIUS, CHANGE.behindDistance);
    const p = nav ? traceValidPoint(nav, at[0] - fx * s0, at[2] - fz * s0, bx, bz) : [bx, bz];
    goal = p ? [p[0], bot.position[1], p[1]] : null;
  } else if (d2 > CHANGE.approachFrom ** 2) {
    goal = approachGoal(nav, at, bot.position, CHANGE.approachTo);
    if (goal) arrive = changeArrive(best);
  }
  if (goal === null) {
    const e = best.entry ?? [best.pos[0], best.pos[2]];
    goal = [e[0], bot.position[1], e[1]];
  }
  const plan = [
    ...(goal ? [{ type: PLAN_ACTION.InfantryMoveTo, waypoint: goal, arrive }] : []),
    { type: PLAN_ACTION.EnterVehicle, vehicleId: best.id, seatId: best.seatId ?? null, seatPos: [...at],
      behind: best.noPathfinding ? CHANGE.behindCos : null },
  ];
  plan.vehicleId = best.id;
  plan.startedAt = now;
  return plan;
}

/**
 * The give-up on a unit the bot cannot get to (INVENTION, 2026-11-11,
 * features/bot-map-generation/hold-fire.md). The engine has none: a failed
 * path ends the move and the Change behaviour builds the same plan again
 * (AI-140), and a walk that ends where the seat is still out of the Use key's
 * 12.375 m (AI-138) presses nothing for ever. On BF1918's Mauerfall a gun
 * 16.5 m up a tower held five bots under it all match, Change taking up to
 * 0.60 of their alive time against 0.03 to 0.13 on DICE's levels; DICE's
 * Berlin has an MG42 11.4 m up that bots do reach, so the test is progress,
 * not height.
 *
 * While its Change plan runs out of Use reach, a bot keeps the nearest it has
 * come to the unit (3D, from its origin, as the Use key measures). When
 * `patience` seconds pass without getting `progress` metres nearer, or its
 * route has failed `failures` times in a row, the unit (its hull: every seat
 * of it) is vetoed for that bot for `seconds`, the plan is dropped and the
 * bot goes back to its order. A gap of more than `gap` seconds in the chase
 * (another behaviour won meanwhile) starts the clock again.
 *  - `patience` 20 s: a soldier runs about 5 m/s, so a walk to anything in
 *    the 50 m search radius gains a metre every second or so; 20 s with no
 *    metre gained is standing, or circling.
 *  - `seconds` 180: long enough that a bot under an unreachable gun spends at
 *    most a ninth of its time on it, short enough that a gun whose way up
 *    opens (a hull moved off a door) is tried again within the round.
 */
export const UNIT_VETO = Object.freeze({ patience: 20.0, progress: 1.0, failures: 3, gap: 5.0, seconds: 180.0 });

/** The key a veto is held under: the hull, so that no seat of it is wanted. */
export function vetoKey(c) {
  return c?.vehicleId ?? c?.id ?? null;
}

/** Whether `c` is vetoed for `bot` at `now`; an expired veto is dropped. */
export function unitVetoed(bot, c, now) {
  const veto = bot._unitVeto;
  if (!veto?.size) return false;
  const key = vetoKey(c);
  const until = veto.get(key);
  if (until === undefined) return false;
  if (now >= until) { veto.delete(key); return false; }
  return true;
}

/** Veto `c` for `bot` from `now` (`UNIT_VETO.seconds`) and drop the chase. */
export function vetoUnit(bot, c, now, why = 'no-progress') {
  (bot._unitVeto ??= new Map()).set(vetoKey(c), now + UNIT_VETO.seconds);
  bot._unitVetoes = (bot._unitVetoes ?? 0) + 1;
  bot._lastUnitVeto = { key: vetoKey(c), at: now, why };
  bot._changeChase = null;
}

/**
 * One tick of a Change walk out of Use reach, `d` the 3D distance to the
 * seat. True when this tick vetoes the unit: the plan is dropped (the next
 * decision pass scores the Change without it) and the walk's route with it.
 */
export function chaseUnit(bot, c, d, now) {
  const key = vetoKey(c);
  let ch = bot._changeChase;
  if (!ch || ch.key !== key || now - ch.last > UNIT_VETO.gap) {
    ch = bot._changeChase = { key, best: d, since: now, last: now };
  }
  ch.last = now;
  if (d < ch.best - UNIT_VETO.progress) { ch.best = d; ch.since = now; }
  const routeFailed = !!bot.route?.failed && (bot._pathFailures ?? 0) >= UNIT_VETO.failures;
  if (now - ch.since < UNIT_VETO.patience && !routeFailed) return false;
  vetoUnit(bot, c, now, routeFailed ? 'route' : 'no-progress');
  bot._changeResult = null;
  if (bot.changedTarget) bot.changedTarget.Change = true;
  bot.currentPlan = [];
  bot.route = null;
  bot.moveForward = 0; bot.moveStrafe = 0;
  return true;
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

/**
 * `EnterVehicle`: the plan's Use key (`BAPATrigger` channel 10, started by
 * `BAPConObjectDistance(target, 12.375)` and stopped by `ObjectOccupied`),
 * pressed while the seat's own object lies within 12.375 m of the bot's
 * origin (3D, `aiOrigin`: a metre over his feet) and, for a no-pathfinding
 * unit, the bot behind it. Each press asks the
 * page for the seat; `validateBFEntryPoint`'s own 15 m reaches farther than
 * the press starts, and the entry rule (`mayEnterHull`) is the page's. The
 * seat's position is the candidate's live one.
 */
export function execEnterVehicle(bot, action) {
  if (bot.vehicle) return true;
  const c = (bot.vehicleCandidates ?? []).find(x => x.id === action.vehicleId) ?? null;
  const at = c ? seatPoint(c) : action.seatPos;
  if (!at) return false;
  const o = aiOrigin(bot);
  const d = Math.hypot(at[0] - o[0], at[1] - o[1], at[2] - o[2]);
  if (d > CHANGE.useWithin) {
    // Out of the Use key's reach: the give-up's clock (INVENTION, `UNIT_VETO`).
    if (chaseUnit(bot, c ?? { id: action.vehicleId }, d, bot._now ?? 0)) return true;
    return false;
  }
  bot._changeChase = null;
  if (action.behind != null && !behindUnit(c ?? { seatPos: at, hullYaw: 0 }, bot.position, action.behind)) return false;
  bot.enterRequest = { vehicleId: action.vehicleId, seatId: action.seatId };
  return false;
}
