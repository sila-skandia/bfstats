// A bot's perception bookkeeping: the page's sensing hooks (shots heard,
// incoming fire, its own rounds and hits), the per-tick sensing pass and
// quadrant ageing over bot-sense.js, and the Fire behaviour's target choice
// on foot and mounted. Plain functions of the `BotController` (bot.js),
// which delegates its methods here.

import { lineClear, playerPosition, bakedToWorld } from './bot-sense.js';
import { scoreTargets, scoreVehicleTargets, SOLDIER_BATTLE_STRENGTH, VEHICLE_FIRE } from './bot-fire.js';
import { QUADRANTS, quadrantOf } from './bot-behaviours.js';
import { TANK } from './bot-vehicle.js';
import { unitTable } from './bot-strength.js';

/**
 * The world's line-of-sight test between two points, skipping the bot's own
 * unit and the unit its firing target sits in: `collideLineWithWorld`
 * (environment +0x54) ignores both on a sense ray (`BotMain::sense`
 * 0x08521cf0, `lineClear` in bot-sense.js). The trigger's line to a target
 * aims at the target's +1 m, which for a player in a hull is inside that
 * hull's own collision: with only the bot's unit skipped the ray ended on the
 * target's fuselage and an AA gunner never let the trigger down on a plane,
 * whatever its miss (Brief L, 2026-09-24; live on El Alamein, a Spitfire held
 * 180 m out: miss 0.19 m against a precision of 11.3 m, the line blocked by
 * the Spitfire itself).
 */
export function lineClearSkippingSelf(bot, from, to) {
  const skip = [bot._selfOwner()];
  const target = bot.firingTarget != null ? bot.world?.players?.get?.(bot.firingTarget) : null;
  const owner = target ? bot.senses?.unitOwnerOf?.(target) : null;
  if (owner !== null && owner !== undefined && owner !== -1) skip.push(owner);
  return lineClear(bot.world?.collider, from, to, skip);
}

/** The collision owner of the hull the bot sits in, -1 on foot: its own
 *  rays skip it (`collideLineWithWorld` ignores the bot's unit). */
export function selfOwner(bot) {
  const node = bot.vehicle?.node;
  return node ? (bot.world?.collider?.statics?.ownerOf?.(node) ?? -1) : -1;
}

// -----------------------------------------------------------------------
// Sensing hooks the page calls
// -----------------------------------------------------------------------

/**
 * A shot was fired somewhere (the page calls this for the human and for
 * every bot). Hearing per `soundPerceptionCalculation`: enemy shots inside
 * the weapon's sound radius within 3 s of firing, else the 15 m sphere.
 */
export function onShotFired(bot, shooterId, shooterTeam, pos, now, weaponRadius = null) {
  if (shooterId === bot.playerId) { bot.senses.onOwnFire(now); return; }
  const heard = bot.senses.hear(now, shooterId, shooterTeam, pos, bot.position, bot.team,
                                 { weaponRadius, firedAt: now });
  if (heard) {
    bot.lastHeardPosition = [...pos];
    bot.timeSinceHeard = 0;
  }
}

/** A round from `attackerId` at `pos` landed on (or near) this bot. */
export function onIncomingFire(bot, attackerId, pos, now, hit = false, strength = 1) {
  bot.senses.onIncomingFire(now, attackerId, strength, hit, pos);
  bot.isUnderFire = true;
  bot.timeSinceNearbyShot = 0;
}

/** The page's older hook: the human fired near this bot. Counts as a heard
 *  shot and as incoming fire. */
export function recordNearbyShot(bot, shotPos, now, shooterId = 'local', shooterTeam = null) {
  bot.onShotFired(shooterId, shooterTeam, shotPos, now ?? 0);
  const d = Math.hypot(shotPos[0] - bot.position[0], shotPos[2] - bot.position[2]);
  if (d <= 20) bot.onIncomingFire(shooterId, shotPos, now ?? 0, false, 1);
}

/** Older alias. */
export function hearSound(bot, soundPos, now, sourceTeam = null) {
  bot.onShotFired('sound', sourceTeam, soundPos, now);
}

/** The page reports a round this bot fired (for the fire plan's counter). */
export function onShot(bot, now) {
  bot.senses.onOwnFire(now);
  bot._shotsThisPlan = (bot._shotsThisPlan ?? 0) + 1;
  bot._tally('shots', bot.firingTarget);
}

/** The page: one of this bot's rounds landed on `targetId`. */
export function recordHit(bot, targetId) {
  bot._tally('hits', targetId);
}

/** The memory record's per-weapon-slot tally for a target (+0x34 / +0x54). */
export function tally(bot, kind, targetId) {
  const m = targetId ? bot.senses.memory.get(targetId) : null;
  if (!m) return;
  const list = m[kind] ?? (m[kind] = []);
  const i = bot.weaponIndex ?? 0;
  list[i] = (list[i] ?? 0) + 1;
}

/** Compatibility: the current firing target as the old `sense()` gave it. */
export function sense(bot, now) {
  bot._sensePass(now ?? 0, 0);
  const t = bot._chooseFiringTarget(now ?? 0);
  return { targetId: t.targetId, targetPos: t.targetPos };
}

/**
 * Where a bot's sense rays start: its camera (Brief R item 1, ledger
 * AI-123). `BotMain::sense` 0x08521cf0 and `updateMemory` 0x085244e0 take the
 * ray origin from row 3 of `AIPlayer::getCameraTransformation` 0x085dcdb0,
 * which is `BFPlayer::getCamera` 0x08054ce0 (the player's +0x50); `BFPlayer::
 * _setVehicle` 0x080523d0 sets that to the first camera of the
 * PlayerControlObject the player sits in (the seat's `Camera` child), so a
 * mounted bot sees from its seat's camera node, not from a height over the
 * hull origin. A seat whose survey found no camera keeps the old stand-in
 * (`_eye()`, 2 m over the origin: INVENTION).
 */
export function sensingEye(bot) {
  const seat = bot.vehicle?.occupancy;
  const cam = seat?.seatInfo?.(seat.seatId)?.camera ?? null;
  if (cam?.matrixWorld) {
    cam.updateWorldMatrix?.(true, false);
    const e = cam.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }
  return bot._eye();
}

/** One sensing pass plus the memory update. */
export function sensePass(bot, now, dt) {
  const me = bot._player();
  if (!me || !bot.world?.players) return;
  const eye = bot.vehicle ? sensingEye(bot) : bot._eye();
  // A seated bot looks where its gun points (the turret's heading), not
  // where the hull does.
  const lookYaw = bot.vehicle ? (bot._aimReference()?.yaw ?? bot.yaw) : bot.yaw;
  bot.senses.selfOwner = bot._selfOwner();
  // The vehicle frustums (75 / 45 / 15 deg, AI-33) while seated.
  bot.senses.isMobile = !!bot.vehicle;
  if (!bot.senses.unitOwnerOf) {
    bot.senses.unitOwnerOf = (p) => {
      const node = p?.occupancy?.root ?? p?.vehicle?.node ?? null;
      return node ? (bot.world?.collider?.statics?.ownerOf?.(node) ?? -1) : -1;
    };
  }
  const basis = bot._cameraBasis(lookYaw);
  bot.senses.sense(now, bot.world, me, eye, lookYaw, basis);
  bot.senses.updateMemory(now, bot.world, me, eye, lookYaw, basis);
  // `updateSensingQuads`: every quadrant ages; the one the camera looks
  // into is fresh.
  for (let q = 0; q < QUADRANTS; q++) bot.quadInertia[q] += dt;
  const fq = quadrantOf(Math.sin(bot.yaw), Math.sin(bot.pitch), Math.cos(bot.yaw));
  bot.quadInertia[fq] = 0;
}

/** `BBFire::calculateUrgency`'s target scoring, shared by Fire and `sense()`. */
export function chooseFiringTarget(bot, now) {
  const collider = bot.world?.collider;
  const water = collider?.waterLevel;
  const waterDepth = Number.isFinite(water) ? Math.max(0, water - bot.position[1]) : 0;
  const me = bot._player();
  const mySpeed = me?.soldier?.speed ?? 0;
  if (bot.vehicle) return bot._chooseVehicleTarget(now);
  return scoreTargets({
    spotted: bot.senses.spottedEnemies(),
    position: bot.position,
    weapons: bot.weapons,
    now,
    attackedBy: id => bot.senses.attackedBy(id),
    velocityOf: id => {
      const p = bot.world.players.get(id);
      const s = p?.soldier;
      if (!s) return null;
      const v = s.body?.body?.velocity;
      return v ? [v.x, v.y, v.z] : [Math.sin(s.yaw) * (s.speed ?? 0), 0, Math.cos(s.yaw) * (s.speed ?? 0)];
    },
    // The target's own class, a seated man's his hull's (`unitInfo`): the
    // weapon is chosen on each weapon's `strength[type]` (`BBFire::
    // calculateUrgency` 0x08563570 indexes the strength table by the
    // target's type, ledger AI-132). Read as Infantry for every target, a
    // German AT soldier's WalterP38 (3) outscored his Panzershreck (2)
    // against a tank, so he never fired it at one (features/bot-weapons).
    typeOf: id => bot._unitInfo(id)?.type ?? 'Infantry',
    currentTarget: bot.firingTarget,
    currentScore: bot.targetScore,
    insideOrderedArea: bot._insideOrderedArea(),
    insideArea: bot.waypoints?.inside ? (pos) => bot.waypoints.inside(pos[0], pos[2]) : null,
    vetoed: bot.vetoedTargets,
    waterDepth,
    mySpeed,
  });
}

export function insideOrderedArea(bot) {
  const wp = bot.waypoints;
  if (!wp?.inside) return true;
  return wp.inside(bot.position[0], bot.position[2]);
}

/** The class the bot's unit answers to in the enemy's tables. */
export function myType(bot) {
  return bot.vehicle ? (bot.vehicle.strType ?? 'LightArmour') : 'Infantry';
}

/** `BBFireLargeBore` / `BBFire3d`: the mounted bot's target. */
export function chooseVehicleTarget(bot, now) {
  const m = bot.vehicle;
  const air = m.kind === 'air';
  const spotted = bot.senses.spottedEnemies();
  // `getEnemyObjects`: the enemy objects around that are not spotted.
  const radius = air ? VEHICLE_FIRE.environmentRadiusAir
    : (m.kind === 'ship' || m.kind === 'ground' || m.kind === 'tank' || m.kind === 'gun') ? VEHICLE_FIRE.environmentRadius
    : VEHICLE_FIRE.environmentRadiusGround;
  const environment = [];
  for (const [id, p] of bot.world?.players ?? []) {
    if (id === bot.playerId || p.team === bot.team) continue;
    if (bot.world.armorOf?.(id)?.destroyed) continue;
    const pos = playerPosition(p);
    if (!pos) continue;
    const d = Math.hypot(pos[0] - bot.position[0], pos[2] - bot.position[2]);
    if (d <= radius) environment.push({ id, pos });
  }
  const aimable = (!m.drives && m.occupancy?.turret) ? (dir) => bot._turretCanPoint(dir) : null;
  return scoreVehicleTargets({
    spotted, environment, position: bot.position, forward: bot._unitForward3(), velocity: bot._unitVelocity(),
    weapons: bot.weapons, now,
    attackedBy: id => bot.senses.attackedBy(id),
    velocityOf: id => {
      const p = bot.world.players.get(id);
      const v = p?.vehicle?.state?.velocity ?? p?.soldier?.body?.body?.velocity;
      if (v) return [v.x, v.y, v.z];
      const s = p?.soldier;
      return s ? [Math.sin(s.yaw) * (s.speed ?? 0), 0, Math.cos(s.yaw) * (s.speed ?? 0)] : null;
    },
    infoOf: id => bot._unitInfo(id),
    myType: bot._myType(), myTable: unitTable(bot.weapons), air, maxSpeed: m.maxSpeed ?? m.hullMaxSpeed ?? 0,
    // The unit's Armament plug-in (`setIsAntiAircraft`, read back by
    // `IPIArmamentReal::isAntiAircraft` 0x085e9b00), carried on the mount.
    // No AI weapon entry has the word, so reading it off the weapons left
    // every AA gun a non-AA one: blind to an aircraft past 150 m or faster
    // than 15 m/s, which is every aircraft in flight.
    isAntiAircraft: !!m.antiAircraft || bot.weapons.some(w => w.isAntiAircraft),
    currentTarget: bot.firingTarget, currentScore: bot.targetScore,
    insideOrderedArea: bot._insideOrderedArea(),
    insideArea: bot.waypoints?.inside ? (pos) => bot.waypoints.inside(pos[0], pos[2]) : null,
    vetoed: bot.vetoedTargets, aimable, mode: air ? 'air' : fireMode(m),
    fixed: FIXED_EQUIPMENT.has(m.equipmentType) || !m.drives,
    lineOfFire: (rec) => {
      const p = bot.world?.players?.get(rec.id);
      const owner = p ? bot.senses?.unitOwnerOf?.(p) ?? -1 : -1;
      // The memory record's sense point (+4..+0xc, the one that saw it),
      // through the target's live transform; a soldier's as its offset
      // from his feet (the engine keeps a bone index, +0x10).
      const off = rec.offset ?? [0, 1.0, 0];
      const to = rec.local && owner >= 0 ? bakedToWorld(bot.world?.collider, owner, rec.local)
        : [rec.pos[0] + off[0], rec.pos[1] + off[1], rec.pos[2] + off[2]];
      return lineClear(bot.world?.collider, sensingEye(bot), to, [bot._selfOwner(), owner]);
    },
  });
}

/**
 * Which Fire behaviour a mounted unit runs: its `aiTemplatePlugIn.
 * equipmentType` is its row of `AIbehaviours.con`'s `setVehicle` list, and
 * that file gives `BBFireInfantery` (`BBFire::calculateUrgency` 0x08563570)
 * to Tank (0), Fixed (4) and LandingCraftFixed (11), `BBFireLargeBore`
 * (0x0856b390) to Boat (2), BoatFixed (9) and FixedLargeBore (13), and
 * `BBFire3d` to Plane (Brief R item 2, ledger AI-124). The ledger's AI-54
 * had every hull and seat on the large-bore rule. A tree without the field
 * takes a driven tank for a Tank (INFERRED, as `approachesByFinding`) and
 * keeps the large-bore rule for the rest.
 */
const INFANTRY_FIRE_EQUIPMENT = new Set([0, 4, 11]);
const FIXED_EQUIPMENT = new Set([4, 11]);
export function fireMode(m) {
  if (Number.isInteger(m?.equipmentType)) return INFANTRY_FIRE_EQUIPMENT.has(m.equipmentType) ? 'infantry' : 'largeBore';
  return m?.drives && m?.kind === 'tank' ? 'infantry' : 'largeBore';
}

/** What a target is: the page's description, else an infantryman. */
export function unitInfo(bot, id) {
  const info = bot.unitInfoOf?.(id);
  if (info) return info;
  const p = bot.world?.players?.get(id);
  return { type: p?.vehicleStrType ?? 'Infantry', air: p?.kind === 'air', table: SOLDIER_BATTLE_STRENGTH,
           maxSpeed: p?.vehicle ? 20 : TANK.soldierMaxSpeed, seats: null, enemyManned: !!p?.vehicle, mobile: true };
}
