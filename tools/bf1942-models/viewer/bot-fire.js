// The Fire behaviour: how an infantry bot picks a target and a weapon
// (`BBFire::calculateUrgency` 0x08563570) and what its fire plan does
// (`BBPFireInfantery::createPlan` 0x085a3870 / `createPlanInternal`
// 0x085a74e0 / `createFirePlan` 0x085ac240, `getFiringPose` 0x085a26f0,
// `EntryTrigger::execute` 0x086257d0, `EntryMouseTurretAimAt::execute`
// 0x08619ac0). Read 2026-09-23; features/bf1942-ai-research-2026-09-21/
// bot-behaviours.md §3.
//
// What the engine does:
//
//  * The target is scored over the whole spotted list (seen and lost, the
//    lost ones decaying, and out-of-range ones within a grace of five times
//    the bot's mobile size), not just the nearest: per weapon
//    `strength[targetType] / (1 + (20 * (shots - hits) + 10) / ammo)` picks
//    the weapon, with the shots and hits the memory record tallies for that
//    target and weapon slot; the score multiplies a range term `max(0, 1 -
//    d / (1.5 * maxRange))`, a range factor `(minRange + 0.1 * (maxRange -
//    minRange)) / d`, a sighting-age term `1 / (1 + 0.05 * age)` for a lost
//    target (1.0 when seen), a speed term `1 / (1 +
//    0.5 * |v|)` inside range (0.25 beyond it), a `1.5 .. 1.0` bonus for an
//    attacker of the last 30 s, `0.75` when the bot is outside its ordered
//    area, and the target's own strength against the bot's armour class.
//    UCFire's `x` here is a per-target pseudo-random in [0, 1): a jitter of
//    x1.08 .. x1.30, not a distance. A new target replaces the current one
//    only at `1.2x` its score. A bot wading deeper than `0.75` m does not
//    fire. A target the plan gave up on is vetoed for `20` s unless someone
//    is moving at `2` m/s.
//  * The plan: `getFiringPose` tries prone, crouch, stand — the first pose
//    whose eye still sees the target wins; the weapon is changed to the
//    chosen one; out of `0.9 * maxRange` it walks closer, inside `minRange +
//    1` it backs off to `2 * minRange + 5`; `BAPALookAtObject` turns the
//    view within `5` deg, the aim condition's tolerance is `0.25 * the
//    target's extents` (at least `0.4` m); a single-shot weapon
//    (`burst 0`) fires one one-tick pulse per `BAPATrigger` and the plan
//    loops a shot counter of up to `10`; a burst weapon holds the trigger
//    (`BAPATriggerContinously`) while the aim condition holds. The plan ends
//    on the target's death, an empty magazine, an overheated barrel, or a
//    `3.0` s timer.
//  * `EntryTrigger` hands the weapon `setBotSkill(botSkill, firingTargetTime,
//    extra)` on every pull: `extra` is 0 against infantry, 30 (or 10 for a
//    primary/occupied vehicle) against a vehicle — the deviation model
//    `deviation.js` implements.
//
// The vehicle and aircraft targeting (`scoreVehicleTargets`, read
// 2026-09-23; bot-behaviours.md §12, ledger AI-52..AI-53):
//
//  * `BBFireLargeBore::calculateUrgency` 0x0856b390 (a hull's or seat's
//    guns): the same spotted-list scan and weapon choice as the infantry's,
//    with a weapon whose `minRange` the target is inside scoring 0; the
//    distance term is `1 - clamp(1.5 d / maxRange, 0.1, 1)` (no range
//    factor); an enemy-manned vehicle is scored over every seat as
//    `(seat.table[myType] + security + own.table[seatType]) *
//    armourClassValue[seatType]`, an infantryman as `own.table[type] *
//    security * armourClassValue[type]`, both times the order and area
//    factors; the seats' `table[myType]` sum under `getHarmlessThrsh` cuts
//    the score to 0.33; a fixed weapon needs `validateCameraDirectionYaw`
//    toward the target; `getEnemyObjects` within 850 m adds targets the bot
//    has not spotted at 0.75, weapons scored `strength / (10 / ammo + 1)`.
//  * `BBFire3d::calculateUrgency` 0x085662f0 (an aircraft): the same
//    base, with `min(1, d / (3 maxRange))` for a ground target (a plane
//    lines up on what is far), `max(0, 1 - d / (1.5 maxRange))` for an air
//    target (doubled when the guns are anti-aircraft), a facing term
//    `max(0.5, forward . dir + 1) * 0.5`, and against an air target from a
//    ground unit: non-AA guns score 0 beyond half their range or against
//    more than 15 m/s, AA guns 1 inside 0.9 of it; an escaping target
//    (faster by 5 m/s, beyond range) `0.25 / (0.5 |v| + 2 max(0, dv . dir)
//    + 2 max(0, dv . side) + 1)`; `getEnemyObjects` within 75 m (600 m for
//    an aircraft) adds the unspotted. Both keep the current target unless
//    beaten 1.2x, veto a plan's target for 20 s, and shape the result
//    through `Declein(2 x)` and the radio terms.
//
// The armour-class value vector (`AISettings` +0x98) is read (1, 3, 8, 15,
// 1, 6) and the harmless threshold (`BotMain` +0x2c) is the 0 both
// `BotManager` call sites pass to the `BotMain` constructor (0x08497887,
// 0x08498194). A target's information security: an object's own side holds
// an `InformationReal` (`getSecurity` 0x085e8d10 is `fld1`), the other side
// an `InformationKnown` (`AIObjectReal::createInformation` 0x085d8ca0) whose
// security is 1 - SCurve((t - t0) / decay) (0x085e8670), 1 at a sighting and
// refreshed by `setTime(t, s)` 0x085e8210. The decay (the object's info
// record +0xc) is not traced: INVENTION, labelled, an enemy's stays 1.
//
// The 20 s feedback veto is dead in the retail binary: its only writer,
// `BBPFireInfantery::createPlan` 0x085a6790, is reached only when
// `detectAimingFailure` 0x085a3860 is true, and that is `xor eax,eax; ret`
// (the aircraft's `BBFire3d` feedback is never written either). The read
// below is kept; nothing fills `vetoed`.

const DEG = Math.PI / 180;

import { decleiningSlope } from './bot-behaviours.js';

export const FIRE = {
  waterGate: 0.75,
  feedbackVeto: 20.0,
  movingVetoSpeed: 2.0,
  attackedWindow: 30.0,
  sightAgeDecay: 0.05,
  outsideAreaFactor: 0.75,
  minDistance: 0.5,
  inRangeSpeedFactor: 0.5,
  beyondRangeFactor: 0.25,
  rangeSlack: 1.5,
  rangeFactorMin: 0.1,
  switchHysteresis: 1.2,
  harmlessFactor: 0.33,
  approachRange: 0.9,
  tooClose: 1.0,
  awayRadius: (minRange) => 2 * minRange + 5.0,
  lookTolerance: 5 * DEG,
  aimToleranceFraction: 0.25,
  aimToleranceMin: 0.4,
  planTimeout: 3.0,
  shotsMax: 10,
  vehicleExtra: 30.0,
  vehicleOccupiedExtra: 10.0,
};

/** The mobile object's size term (`IPIMobile` +0x14 -> +8): 5.0 for a
 *  soldier, INFERRED from `updatePotentialObstacles`' `size * 5 + 0.5` being
 *  the 25.5 m obstacle drop distance. */
export const MOBILE_SIZE_INFANTRY = 5.0;

/** The soldier's own `setBattleStrength` table (`Objects/Soldiers/Common/AI/
 *  Objects.con`): how much a soldier is worth as a target per class. */
export const SOLDIER_BATTLE_STRENGTH = {
  Infantry: 4.0, LightArmour: 2.0, HeavyArmour: 1.0, NavalArmour: 0.0, Submarine: 0.0, Air: 1.0,
};

/** The eye heights `getSoldierPoseCameraPosition` reports per pose,
 *  tried in the engine's order: prone, crouch, stand. */
export const FIRING_POSES = [
  { pose: 'prone', eye: 0.4 },
  { pose: 'crouch', eye: 1.1 },
  { pose: 'stand', eye: 1.6 },
];

/** A weapon's AI template with the engine's defaults filled in. */
export function weaponAiOf(entry) {
  return {
    name: entry?.name ?? entry?.aiTemplate ?? 'weapon',
    burst: entry?.burst ?? 0,
    /** `weaponTemplate.indirect`, the template's byte +1 (ConsoleClass620
     *  0x08510db0): `EntryPlaneAimAt` levels an aircraft's aim for it. */
    indirect: entry?.indirect ?? 0,
    deviation: entry?.deviation ?? 5.0,
    deviationCorrectionTime: entry?.deviationCorrectionTime ?? 10.0,
    minRange: entry?.minRange ?? 0.0,
    maxRange: entry?.maxRange ?? 60.0,
    weaponFire: entry?.weaponFire ?? 'PIFire',
    strength: entry?.strength ?? { Infantry: 1.0 },
    soundSphereRadius: entry?.soundSphereRadius ?? null,
    ammo: entry?.ammo ?? -1,
    healing: !!entry?.healing,
    shotsFired: entry?.shotsFired ?? 0,
    hits: entry?.hits ?? 0,
  };
}

/** `DecleiningSlopeCurve::calculate`: the engine's sampled table
 *  (bot-behaviours.js), kept under the name the earlier build exported. */
export function decliningSlope(x) {
  return decleiningSlope(x);
}

/** A small LCG in [0, 1) seeded per target, the engine's jitter source. */
function seededUnit(seed) {
  let s = (seed * 0x5e30 + 0x661f) >>> 0;
  s = (s * 1103515245 + 12345) >>> 0;
  return (s >>> 8) / 16777216;
}

/**
 * Score every spotted enemy for the bot and pick the target and weapon.
 *
 * @param {object} p
 * @param {Array} p.spotted        `BotSenses.spottedEnemies()` entries
 * @param {number[]} p.position    the bot's position
 * @param {Array} p.weapons        AI weapon entries (`weaponAiOf`) the bot carries
 * @param {number} p.now
 * @param {(id) => number} p.attackedBy   `BotSenses.attackedBy`
 * @param {(id) => number[]|null} p.velocityOf  a target's velocity, or null
 * @param {(id) => 'Infantry'|string} p.typeOf  a target's strength class
 * @param {string|null} p.currentTarget
 * @param {number} p.currentScore
 * @param {boolean} p.insideOrderedArea
 * @param {Set<string>} [p.vetoed]  targets given up on, id -> time
 * @param {number} [p.waterDepth]   how deep the bot stands
 * @param {number} [p.mobileSize]   the bot's `IPIMobile` size term (5.0 on foot)
 * @returns {{ targetId, targetPos, score, weaponIndex, urgency }}
 */
export function scoreTargets({
  spotted, position, weapons, now, attackedBy, velocityOf, typeOf,
  currentTarget = null, currentScore = 0, insideOrderedArea = true, insideArea = null,
  vetoed = null, waterDepth = 0, mySpeed = 0, mobileSize = MOBILE_SIZE_INFANTRY,
}) {
  const none = { targetId: null, targetPos: null, score: 0, weaponIndex: -1, urgency: 0 };
  if (waterDepth > FIRE.waterGate) return none;
  if (!spotted.length || !weapons.length) return none;
  const areaFactor = insideOrderedArea ? 1.0 : FIRE.outsideAreaFactor;
  let best = null, bestScore = 0, bestWeapon = -1;
  let current = null;
  for (const m of spotted) {
    const id = m.id;
    // Feedback veto: a target the plan gave up on within 20 s, unless
    // someone is moving.
    const v = velocityOf?.(id) ?? null;
    const tSpeed = v ? Math.hypot(v[0], v[2]) : 0;
    if (vetoed?.has(id) && now - vetoed.get(id) < FIRE.feedbackVeto) {
      if (mySpeed + tSpeed < FIRE.movingVetoSpeed) continue;
    }
    const attackedAt = attackedBy?.(id) ?? -1000;
    const attackedBonus = attackedAt > -1000
      ? 1.5 - 0.5 * Math.min(1, Math.max(0, (now - attackedAt) / FIRE.attackedWindow))
      : 1.0;
    const dx = m.pos[0] - position[0], dz = m.pos[2] - position[2];
    const dist = Math.max(FIRE.minDistance, Math.hypot(dx, m.pos[1] - position[1], dz));
    // The memory record's lost flag (+0x14) and the time it was lost (+0x18):
    // a visible target counts in full, a lost one decays as
    // `1 / (1 + 0.05 * (now - lostAt))`. (The null test beside it in the
    // binary is on the bot's mobile object, which every bot has -- not an
    // infantry test; ledger AI-40.)
    const sightFactor = m.lost ? 1 / (1 + FIRE.sightAgeDecay * Math.max(0, now - (m.lostAt ?? now))) : 1.0;
    const targetType = typeOf?.(id) ?? 'Infantry';
    // Weapon choice.
    let wBest = -1, wVal = 0, maxRange = 0, minRange = Infinity;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const strength = w.healing ? 0 : (w.strength?.[targetType] ?? 0);
      const ammo = w.ammo < 0 ? 0x10000 : w.ammo;
      // Shots and hits are the memory record's tallies for this target and
      // weapon slot, not the weapon's lifetime: a new target starts clean.
      const missed = (m.shots?.[i] ?? 0) - (m.hits?.[i] ?? 0);
      const val = ammo < 1 ? 0
        : Math.round(strength) / (1 + (20 * missed + 10) / ammo);
      if (val > wVal) { wVal = val; wBest = i; }
      maxRange = Math.max(maxRange, w.maxRange);
      minRange = Math.min(minRange, w.minRange);
    }
    if (wBest < 0 || !(maxRange > 0)) continue;
    if (!Number.isFinite(minRange)) minRange = 0;
    // Range terms. `BBFire::calculateUrgency` 0x08563570 carries one factor
    // F (its fStack_1a4): the bot's own area factor (0.75 outside its
    // ordered area, `isInside` called at 0x085639f3) times 0.75 for a target
    // outside that area (the second `isInside`, 0x08564015); in range it is
    // replaced by 0.5, beyond range it stays. F multiplies every strength
    // term and then the score again, so it counts twice.
    let speedFactor;
    let F = areaFactor;
    if (insideArea && !insideArea(m.pos)) F *= FIRE.outsideAreaFactor;
    if (dist <= maxRange) {
      F = 0.5;
      speedFactor = 1 / (1 + FIRE.inRangeSpeedFactor * tSpeed);
    } else {
      // Beyond the weapon's range the target is kept while the overshoot is
      // under five times the bot's mobile size (`IPIMobile` +0x14 -> +8,
      // 5.0 for a soldier: the same term makes the 25.5 m obstacle drop).
      const dy = m.pos[1] - position[1];
      speedFactor = dy > 5.0
        ? FIRE.beyondRangeFactor / (1 + 0.5 * tSpeed + 2)
        : FIRE.beyondRangeFactor;
      if (dist - maxRange > 5 * mobileSize) continue;
    }
    const range = Math.max(0, 1 - dist / (FIRE.rangeSlack * maxRange));
    const rangeFactor = (minRange + FIRE.rangeFactorMin * (maxRange - minRange)) / dist;
    const strengthSum = Math.round(SOLDIER_BATTLE_STRENGTH[targetType] ?? 1) * F;
    const curve = Math.max(0, -0.22 * seededUnit(hashId(id)) + 1.3);   // UCFire jitter
    let score = curve * range * wVal * sightFactor * speedFactor * attackedBonus
      * F * strengthSum * rangeFactor;
    if (strengthSum <= 0) score *= FIRE.harmlessFactor;
    if (id === currentTarget) current = { score, weapon: wBest, m };
    if (score > bestScore) { bestScore = score; best = m; bestWeapon = wBest; }
  }
  if (!best) return none;
  // Hysteresis: the current target keeps its place unless beaten by 1.2x.
  if (current && current.score > 0 && bestScore < FIRE.switchHysteresis * current.score) {
    best = current.m; bestScore = current.score; bestWeapon = current.weapon;
  }
  return {
    targetId: best.id,
    targetPos: [...best.pos],
    score: bestScore,
    weaponIndex: bestWeapon,
    urgency: decliningSlope(2 * bestScore),
    visible: !!best.seen,
  };
}

function hashId(id) {
  let h = 7;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * `getFiringPose`: the first of prone, crouch, stand whose eye still sees
 * the target. `lineClear(from, to)` is the world's ray. Returns the pose
 * name, or null when none sees it (the plan then aims at the last known
 * point from where it stands).
 */
export function firingPose(position, targetPos, lineClear, force = false) {
  if (force) return FIRING_POSES[0].pose;
  for (const { pose, eye } of FIRING_POSES) {
    const from = [position[0], position[1] + eye, position[2]];
    const to = [targetPos[0], targetPos[1] + 1.0, targetPos[2]];
    if (lineClear(from, to)) return pose;
  }
  return null;
}

/**
 * The aim tolerance `createFirePlan` builds for a soldier target:
 * `0.25 * (extents sum)`, at least 0.4 m, as an angle at `dist`.
 */
export function aimToleranceRad(dist, extents = [0.6, 1.8, 0.6]) {
  const tol = Math.max(FIRE.aimToleranceMin, FIRE.aimToleranceFraction * (extents[0] + extents[1] + extents[2]));
  return Math.atan2(tol, Math.max(dist, 0.5));
}

/**
 * The fire plan for a chosen target as the viewer's interpreter runs it:
 * a pose, a move when out of range or too close, an aim and a trigger.
 * `weapon` is the chosen weapon's AI entry.
 */
export function firePlanFor({ position, targetPos, targetId, weapon, pose, now }) {
  const dx = targetPos[0] - position[0], dz = targetPos[2] - position[2];
  const dist = Math.hypot(dx, dz);
  const plan = [];
  if (pose) plan.push({ type: 'SoldierPose', pose });
  if (dist > FIRE.approachRange * weapon.maxRange) {
    // `BAPAMoveToObjectFinding(bot, target, 0.9 * maxRange)`: close in.
    plan.push({ type: 'InfanteryMoveToObject', targetId, targetPos: [...targetPos],
                arrive: FIRE.approachRange * weapon.maxRange });
  } else if (dist < weapon.minRange + FIRE.tooClose) {
    // `calculateAwayPosition(radius = 2 * minRange + 5)`: back off.
    const r = FIRE.awayRadius(weapon.minRange);
    const ux = dist > 1e-3 ? dx / dist : 0, uz = dist > 1e-3 ? dz / dist : 1;
    plan.push({ type: 'InfanteryMoveTo', waypoint: [targetPos[0] - ux * r, position[1], targetPos[2] - uz * r] });
  }
  // A plan is a sequence: the look and the trigger wait for the approach or
  // the back-off to finish (`afterMove`), as the engine's entries run in order.
  plan.push({ type: 'MouseTurretAimAt', targetId, targetPos: [...targetPos], afterMove: true });
  plan.push({
    type: weapon.burst ? 'TriggerContinously' : 'Trigger',
    targetId, targetPos: [...targetPos], afterMove: true,
    tolerance: aimToleranceRad(dist),
    startedAt: now,
    timeout: FIRE.planTimeout,
    shots: weapon.burst ? 0 : Math.min(FIRE.shotsMax, 1 + Math.floor(Math.random() * FIRE.shotsMax)),
  });
  return plan;
}

/**
 * The fire plan's move for a unit that drives and aims on separate controls
 * (every vanilla tank: `driveTurnControl PIYaw`, `aimHorizontalControl
 * PIMouseLookX`), read 2026-09-24 (ledger AI-115). The Tank row of
 * `AIbehaviours.con` runs `BBPFireInfantery`; `createPlan` 0x085a3870 sets
 * the firing state's +0x14 when the bot's information has a Mobile plug-in
 * (+0x2c) and +0x16 when the ControlInfo plug-in's (type 5, `IPIControlInfo::
 * getType` 0x085d4a30) `getDriveControls` 0x085de710 and `getAimControls`
 * 0x085de730 masks do not overlap. A soldier's do (`driveTurnControl` and
 * `aimHorizontalControl` are both `PIMouseLookX`), so the infantry keep
 * `firePlanFor`'s walk. With both set, `createPlanInternal` 0x085a74e0
 * (from 0x085a7c5e) builds, beside the look and the trigger, one statement
 * re-evaluated every tick (`BAPFlowCIf` 0x08556990 / `execute` 0x08556b80,
 * its last argument 1):
 *
 *   If(S, ResetControls,                                          0x085aa14c
 *      If(target within `mid`,                                    0x085aa0dc
 *         If(target within 1.5 minRange + 1 of the firing point,  0x085aa069
 *            End, MoveToFinding(the firing point)),
 *         MoveToObjectFinding(target)))                           0x085a9e6b
 *
 *  - S (`BAPConSharedCondition` of a `BAPConAnd`, 0x085a9bc5..0x085a9ced):
 *    `BAPConObjectDistance(target, minRange, 0.9 maxRange)` (3D, the
 *    target's position estimate: evaluate 0x0854fce0 tests min^2 <= d^2 <=
 *    max^2), `BAPConObjectValidAiming` 0x08552710 (the aim direction inside
 *    the seat's camera window, `AIObjectControlInfo::validateCameraDirection`;
 *    with the Mobile template's +0x30 byte set `BAPConObjectValidPitchAiming`
 *    at 0x085ab443, the pitch alone, the hull turned by `BAPATurnTowardsObject`)
 *    and `BAPConObjectLineOfFire` 0x08551890
 *    (the bot's memory record of the target exists and its +0x14 is clear:
 *    it is seen).
 *  - `mid` = minRange + min(50, 0.5 (maxRange - minRange)) (0x085a77df..
 *    0x085a7817; x87 compare checked by hand: `fucom` then `test $0x45`
 *    jumps to keep the half-span when it is <= 50).
 *  - The firing point is the firing state's +0x18 (copied in whole at the
 *    end of `createPlan`, 14 words from its local): the bot's own position
 *    unless a case of `createPlan`'s state switch replaces it, with
 *    `calculateAwayPosition`'s point (2 minRange + 5 away) when the target
 *    is inside minRange + 1, or with `getPortalLookAtPosition`'s (an attack
 *    portal of the level's cover data, `getAttackPortal`). The portal case
 *    is not ported and which case a tank's firing state is in was not
 *    traced (INVENTION: its own position). Moving to his own position is
 *    standing: inside `mid` without S the tank holds.
 *  - `BAPAMoveToObjectFinding` (ctor 0x08545c10: 0.9 maxRange, maxSpeed,
 *    0.5 maxSpeed arriving, `BAPConFalse`, the drive controls, and
 *    Not(S) with 1.1 minRange): `initObjectFinding` 0x08545df0 paths to the
 *    target's own point when it is valid on the unit's map (else its
 *    `getValidPosition`, else a valid cell toward it) with the goal radius
 *    min(0.9 maxRange, 1.1 x the target's `IPIPhysical::getRadius`)
 *    (0x085460ad); `update` 0x08546df0 re-runs that search when Not(S)
 *    turns true again (its +0xb4 latch) and otherwise follows the path.
 */
export const FIRE_APPROACH = {
  inRangeFraction: 0.9,
  midCap: 50.0,
  midFraction: 0.5,
  nearPointScale: 1.5,
  nearPointPad: 1.0,
  arriveTargetScale: 1.1,
  arriveSpeedFraction: 0.5,
};

/** `mid`: the distance inside which the fire plan stops closing. */
export function approachMid(weapon) {
  const min = weapon?.minRange ?? 0, max = weapon?.maxRange ?? 0;
  return min + Math.min(FIRE_APPROACH.midCap, FIRE_APPROACH.midFraction * (max - min));
}

/**
 * One tick of the statement above. `dist` is the 3D distance to the target,
 * `holds` S, `nearFiringPoint` whether the target is within 1.5 minRange + 1
 * of the firing point, `targetRadius` its physical radius. Returns `{ move }`:
 * `'hold'` (reset the drive, the look and the trigger go on), `'end'` (the
 * plan ends), `'point'` (to the firing point), or `'find'` with `arrive`,
 * the path's goal radius.
 */
export function fireApproachStep({ dist, holds, weapon, nearFiringPoint = false, targetRadius = 1.0 }) {
  if (holds) return { move: 'hold' };
  if (dist <= approachMid(weapon)) return { move: nearFiringPoint ? 'end' : 'point' };
  const arrive = Math.min(FIRE_APPROACH.inRangeFraction * (weapon?.maxRange ?? 0),
    FIRE_APPROACH.arriveTargetScale * targetRadius);
  return { move: 'find', arrive };
}

/** Per-class weighting `AISettings::getArmourClassValues` 0x084849f0
 *  (+0x98): the constructor 0x08482cf0 stores 1, 3, 8, 15, 1, 6 in the
 *  class order of the `CST*` enum (Infantry, LightArmour, HeavyArmour,
 *  NavalArmour, Submarine, Air); no console command writes it. */
export const ARMOUR_CLASS_VALUES = { Infantry: 1, LightArmour: 3, HeavyArmour: 8, NavalArmour: 15, Submarine: 1, Air: 6 };

export const VEHICLE_FIRE = {
  largeBoreRangeFactor: 1.5,
  largeBoreFloor: 0.1,
  airGroundRangeFactor: 3.0,
  airAirRangeFactor: 1.5,
  facingFloor: 0.5,
  facingScale: 0.5,
  aaNonAaRange: 0.5,
  aaNonAaSpeed: 15.0,
  aaRange: 0.9,
  escapeSpeedGap: 5.0,
  losRange: 0.89,
  environmentFactor: 0.75,
  environmentRadius: 850.0,
  environmentRadiusAir: 600.0,
  environmentRadiusGround: 75.0,
};

/**
 * `BBFireLargeBore` / `BBFire3d`: score the spotted enemies for a mounted
 * bot. `mode` is `'largeBore'` (a hull's or seat's guns) or `'air'`.
 * `infoOf(id)` describes a target: `{ type, air, table, maxSpeed, seats:
 * [{ table, type, occupied }] | null, enemyManned, mobile }`; `forward` /
 * `velocity` are the bot's unit's; `myTable` / `myType` the unit's own
 * table and class; `aimable(dir)` the fixed weapon's camera test (null when
 * the unit moves); `environment` the enemy objects around that are not in
 * the spotted list (`getEnemyObjects`), as `{ id, pos }`.
 */
export function scoreVehicleTargets({
  spotted, environment = [], position, forward = [0, 0, -1], velocity = [0, 0, 0], weapons, now,
  attackedBy, velocityOf, infoOf, myType = 'LightArmour', myTable = {}, air = false, maxSpeed = 0,
  isAntiAircraft = false, armourClassValues = ARMOUR_CLASS_VALUES,
  currentTarget = null, currentScore = 0, insideOrderedArea = true, insideArea = null,
  vetoed = null, orderFactor = 1, harmlessThreshold = 0, aimable = null, mode = 'largeBore',
  fixed = false, lineOfFire = null,
}) {
  const none = { targetId: null, targetPos: null, score: 0, weaponIndex: -1, urgency: 0 };
  if (!weapons?.length) return none;
  const areaFactor = insideOrderedArea ? 1.0 : FIRE.outsideAreaFactor;
  const mySpeed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  let best = null, bestScore = 0, bestWeapon = -1, current = null;

  if (mode === 'infantry') {
    return scoreMountedInfantry({
      spotted, position, weapons, now, attackedBy, velocityOf, infoOf, myType, myTable, maxSpeed,
      isAntiAircraft, armourClassValues, currentTarget, insideOrderedArea, insideArea, vetoed,
      orderFactor, harmlessThreshold, aimable, fixed, lineOfFire, airUnit: air,
    });
  }

  const scoreOne = (id, pos, m, environmental) => {
    if (vetoed?.has(id) && now - vetoed.get(id) < FIRE.feedbackVeto) return null;
    const info = infoOf?.(id) ?? { type: 'Infantry', air: false, table: {}, maxSpeed: 5, seats: null, mobile: true };
    const attackedAt = attackedBy?.(id) ?? -1000;
    const attackedBonus = attackedAt > -1000
      ? 1.5 - 0.5 * Math.min(1, Math.max(0, (now - attackedAt) / FIRE.attackedWindow))
      : 1.0;
    const dx = pos[0] - position[0], dy = pos[1] - position[1], dz = pos[2] - position[2];
    const dist = Math.max(FIRE.minDistance, Math.hypot(dx, dy, dz));
    const dir = [dx / dist, dy / dist, dz / dist];
    const targetType = info.type ?? 'Infantry';
    // Weapon choice: the memory tallies for a spotted target, `10 / ammo`
    // alone for one the environment handed over.
    let wBest = -1, wVal = 0, maxRange = 0;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const strength = w.healing ? 0 : (w.strength?.[targetType] ?? 0);
      const ammo = w.ammo < 0 ? 0x10000 : w.ammo;
      let val;
      if (ammo < 1) val = 0;
      else if (environmental) val = Math.round(strength) / (10 / ammo + 1);
      else {
        const missed = (m?.shots?.[i] ?? 0) - (m?.hits?.[i] ?? 0);
        val = Math.round(strength) / (1 + (20 * missed + 10) / ammo);
      }
      if (mode === 'largeBore' && dist < (w.minRange ?? 0)) val = 0;
      if (val > wVal) { wVal = val; wBest = i; }
      maxRange = Math.max(maxRange, w.maxRange ?? 0);
    }
    if (wBest < 0 || !(wVal > 0) || !(maxRange > 0)) return null;
    // A fixed weapon must be able to point at the target.
    if (aimable && !aimable(dir)) return null;
    const lostFactor = (!environmental && m?.lost)
      ? 1 / (1 + FIRE.sightAgeDecay * Math.max(0, now - (m.lostAt ?? now))) : 1.0;
    const v = velocityOf?.(id) ?? null;
    const tSpeed = v ? Math.hypot(v[0], v[1], v[2]) : 0;
    // The movement term.
    let moveFactor = null;
    if (!air && info.air) {
      if (!isAntiAircraft) {
        if (dist > VEHICLE_FIRE.aaNonAaRange * maxRange || tSpeed > VEHICLE_FIRE.aaNonAaSpeed) moveFactor = 0;
      } else if (dist < VEHICLE_FIRE.aaRange * maxRange) moveFactor = 1;
    }
    if (moveFactor === null) {
      if (!info.mobile) moveFactor = 1;
      else if (dist <= maxRange) moveFactor = 1 / (0.5 * tSpeed + 1);
      else if ((info.maxSpeed ?? 0) - maxSpeed > VEHICLE_FIRE.escapeSpeedGap && v) {
        const side = [dir[2], 0, -dir[0]];
        const rel = [v[0] - velocity[0], v[1] - velocity[1], v[2] - velocity[2]];
        const along = Math.max(0, rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2]);
        const across = Math.max(0, rel[0] * side[0] + rel[1] * side[1] + rel[2] * side[2]);
        moveFactor = 0.25 / (0.5 * tSpeed + 2 * along + 2 * across + 1);
      } else moveFactor = FIRE.beyondRangeFactor;
    }
    if (!(moveFactor > 0)) return null;
    let area = areaFactor;
    if (insideArea && info.mobile && !air && !insideArea(pos)) area *= FIRE.outsideAreaFactor;
    if (environmental) area *= VEHICLE_FIRE.environmentFactor;
    // The base: an enemy-manned vehicle over every seat, else the unit.
    let base = 0, threat = 0, harmless = false;
    if (info.seats?.length && info.enemyManned) {
      for (const seat of info.seats) {
        const st = seat.type ?? targetType;
        threat += seat.table?.[myType] ?? 0;
        base += ((seat.table?.[myType] ?? 0) + 1 + (myTable[st] ?? 0)) * (armourClassValues[st] ?? 1) * orderFactor * area;
      }
      harmless = threat <= harmlessThreshold;
    } else {
      base = (myTable[targetType] ?? 0) * 1 * (armourClassValues[targetType] ?? 1) * orderFactor * area;
    }
    let distF, facing = 1;
    if (mode === 'air') {
      if (!info.air) distF = Math.min(1, dist / (VEHICLE_FIRE.airGroundRangeFactor * maxRange));
      else {
        distF = Math.max(0, 1 - dist / (VEHICLE_FIRE.airAirRangeFactor * maxRange));
        if (isAntiAircraft) base *= 2;
      }
      facing = Math.max(VEHICLE_FIRE.facingFloor, forward[0] * dir[0] + forward[1] * dir[1] + forward[2] * dir[2] + 1)
        * VEHICLE_FIRE.facingScale;
    } else {
      distF = 1 - Math.min(1, Math.max(VEHICLE_FIRE.largeBoreFloor, VEHICLE_FIRE.largeBoreRangeFactor * dist / maxRange));
    }
    let score = facing * distF * wVal * lostFactor * moveFactor * attackedBonus * base;
    if (harmless) score *= FIRE.harmlessFactor;
    return { score, weapon: wBest, pos, mySpeed };
  };

  for (const m of spotted ?? []) {
    const r = scoreOne(m.id, m.pos, m, false);
    if (!r) continue;
    if (m.id === currentTarget) current = { score: r.score, weapon: r.weapon, m };
    if (r.score > bestScore) { bestScore = r.score; best = m; bestWeapon = r.weapon; }
  }
  let environmental = false;
  if (!current && environment?.length) {
    let envBest = null, envScore = 0, envWeapon = -1, envCurrent = null;
    for (const e of environment) {
      if (spotted?.some(m => m.id === e.id)) continue;
      const r = scoreOne(e.id, e.pos, null, true);
      if (!r) continue;
      if (e.id === currentTarget) envCurrent = { e, score: r.score, weapon: r.weapon };
      if (r.score > envScore) { envScore = r.score; envBest = e; envWeapon = r.weapon; }
    }
    // The same 1.2x hysteresis over the unspotted list: a target the bot
    // already flies at is not swapped for one a hair better.
    if (envCurrent && envCurrent.score > 0 && envScore < FIRE.switchHysteresis * envCurrent.score) {
      envBest = envCurrent.e; envScore = envCurrent.score; envWeapon = envCurrent.weapon;
    }
    if (bestScore <= 0 && envBest) {
      // `Declein(2 x) * radio * x`: the unspotted target's own score scales it.
      return {
        targetId: envBest.id, targetPos: [...envBest.pos], score: envScore, weaponIndex: envWeapon,
        urgency: decliningSlope(2 * envScore) * envScore, visible: false, environmental: true,
      };
    }
    environmental = false;
  }
  if (!best) return none;
  if (current && current.score > 0 && bestScore < FIRE.switchHysteresis * current.score) {
    best = current.m; bestScore = current.score; bestWeapon = current.weapon;
  }
  return {
    targetId: best.id, targetPos: [...best.pos], score: bestScore, weaponIndex: bestWeapon,
    urgency: decliningSlope(2 * bestScore), visible: !!best.seen, environmental,
  };
}

/**
 * `BBFire::calculateUrgency` 0x08563570 for a mounted unit: the Fire of
 * every `AIbehaviours.con` row that runs `BBFireInfantery` (Tank, Fixed,
 * LandingCraftFixed; `BBFireInfantery`'s vtable 0x0875f808 has no
 * `calculateUrgency` of its own, slot +0x28 is `BBFire`'s). Read 2026-09-24
 * (Brief R item 2, ledger AI-124):
 *
 *  * only the spotted list (`vt+0x88`, the loop at 0x08563a2f..): no
 *    `getEnemyObjects` pass, unlike `BBFireLargeBore` 0x0856b390;
 *  * the weapon value `strength[type] / ((20 (shots - hits) + 10) / ammo + 1)`
 *    with no minRange cut, `maxRange` the largest of the weapons' (+0x1c),
 *    the range factor from the chosen weapon's own min / max
 *    (`((max - min) 0.1 + min) / d`, d at least 0.5);
 *  * a target in view: a unit with no Mobile plug-in (a fixed gun) must
 *    `validateCameraDirectionByPos` it; a lost one: a fixed gun skips it,
 *    anyone else weighs it `1 / (1 + 0.05 (now - lostAt))`;
 *  * F: the bot's area factor (0.75 outside its ordered area), again 0.75
 *    for a target outside it when the unit moves and is not an aircraft;
 *  * an air target: without the Armament's anti-aircraft word, 0 beyond
 *    half the range or above 5 m/s; with it, 1 inside 0.9 of the range;
 *    else a still target 1, in range `1 / (0.5 |v| + 1)` (both with F set
 *    to 0.5), out of range the escape term when the target's top speed
 *    beats the unit's by 5, else 0.25;
 *  * in range, a fixed gun needs a clear line from its camera to the
 *    target's sense point (the `collideLineWithWorld` call after
 *    `getCameraTransformation`, 0x0856511f..); out of range, a fixed gun
 *    skips it and a mobile unit keeps it while the overshoot is under
 *    5 x its own top speed (the Mobile template's +8);
 *  * the base: over a manned vehicle's seats `(round(seat[myType]) +
 *    security + own[seatType]) x classValue[seatType] x order x F`, the
 *    seats' `[myType]` sum under the harmless threshold x 0.33; anything
 *    else `own[type] x security x classValue[type] x order x F`;
 *  * the score `jitter x max(0, 1 - d / 1.5 maxRange) x value x sight x
 *    move x attacked x F x base x rangeFactor`, the current target kept
 *    unless beaten 1.2x, the urgency `Declein(2 best)`.
 *
 * Not ported: the target's security (1, as elsewhere), the order factor
 * (the caller's), the controlled-object table choice (`cVar13`).
 */
export function scoreMountedInfantry({
  spotted, position, weapons, now, attackedBy, velocityOf, infoOf, myType = 'LightArmour', myTable = {},
  maxSpeed = 0, isAntiAircraft = false, armourClassValues = ARMOUR_CLASS_VALUES,
  currentTarget = null, insideOrderedArea = true, insideArea = null, vetoed = null,
  orderFactor = 1, harmlessThreshold = 0, aimable = null, fixed = false, lineOfFire = null, airUnit = false,
}) {
  const none = { targetId: null, targetPos: null, score: 0, weaponIndex: -1, urgency: 0 };
  if (!weapons?.length || !spotted?.length) return none;
  const areaFactor = insideOrderedArea ? 1.0 : FIRE.outsideAreaFactor;
  let best = null, bestScore = 0, bestWeapon = -1, current = null;
  for (const m of spotted) {
    const id = m.id, pos = m.pos;
    if (vetoed?.has(id) && now - vetoed.get(id) < FIRE.feedbackVeto) continue;
    const info = infoOf?.(id) ?? { type: 'Infantry', air: false, table: {}, maxSpeed: 5, seats: null, mobile: true };
    const dx = pos[0] - position[0], dy = pos[1] - position[1], dz = pos[2] - position[2];
    const dist = Math.max(FIRE.minDistance, Math.hypot(dx, dy, dz));
    const dir = [dx / dist, dy / dist, dz / dist];
    let sight = 1;
    if (!m.lost) {
      if (fixed && aimable && !aimable(dir)) continue;
    } else {
      if (fixed) continue;
      sight = 1 / (1 + FIRE.sightAgeDecay * Math.max(0, now - (m.lostAt ?? now)));
    }
    const targetType = info.type ?? 'Infantry';
    let wBest = -1, wVal = 0, maxRange = 0;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const strength = w.healing ? 0 : (w.strength?.[targetType] ?? 0);
      const ammo = w.ammo == null || w.ammo < 0 ? 0x10000 : w.ammo;
      const missed = (m.shots?.[i] ?? 0) - (m.hits?.[i] ?? 0);
      const val = ammo < 1 ? 0 : Math.round(strength) / ((20 * missed + 10) / ammo + 1);
      if (val > wVal) { wVal = val; wBest = i; }
      maxRange = Math.max(maxRange, w.maxRange ?? 0);
    }
    if (wBest < 0 || !(wVal > 0) || !(maxRange > 0)) continue;
    const chosen = weapons[wBest];
    let F = areaFactor;
    if (!fixed && !airUnit && insideArea && !insideArea(pos)) F *= FIRE.outsideAreaFactor;
    const v = velocityOf?.(id) ?? null;
    const tSpeed = v ? Math.hypot(v[0], v[1], v[2]) : 0;
    let move = null;
    if (info.air) {
      if (!isAntiAircraft) {
        if (0.5 * maxRange < dist || tSpeed > 5.0) move = 0;
      } else if (dist < 0.9 * maxRange) move = 1;
    }
    if (move === null) {
      if (!info.mobile) { move = 1; F = 0.5; }
      else if (dist <= maxRange) { move = 1 / (0.5 * tSpeed + 1); F = 0.5; }
      else if ((info.maxSpeed ?? 0) - maxSpeed > VEHICLE_FIRE.escapeSpeedGap && v) {
        const side = [dir[2], 0, -dir[0]];
        const along = Math.max(0, v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]);
        const across = Math.max(0, v[0] * side[0] + v[1] * side[1] + v[2] * side[2]);
        move = 0.25 / (0.5 * tSpeed + 2 * along + 2 * across + 1);
      } else move = FIRE.beyondRangeFactor;
    }
    if (!(move > 0)) continue;
    if (dist <= maxRange) {
      if (fixed && lineOfFire && !lineOfFire(m)) continue;
    } else if (fixed || dist - maxRange > 5 * maxSpeed) continue;
    let base = 0, threat = 0, harmless = false;
    if (info.seats?.length && info.enemyManned) {
      for (const seat of info.seats) {
        const st = seat.type ?? targetType;
        const t = seat.table?.[myType] ?? 0;
        threat += t;
        base += (Math.round(t) + 1 + (myTable[st] ?? 0)) * (armourClassValues[st] ?? 1) * orderFactor * F;
      }
      harmless = threat <= harmlessThreshold;
    } else {
      base = (myTable[targetType] ?? 0) * (armourClassValues[targetType] ?? 1) * orderFactor * F;
    }
    const attackedAt = attackedBy?.(id) ?? -1000;
    const attacked = attackedAt > -1000
      ? 1.5 - 0.5 * Math.min(1, Math.max(0, (now - attackedAt) / FIRE.attackedWindow)) : 1.0;
    const minR = chosen.minRange ?? 0, maxR = chosen.maxRange ?? maxRange;
    const rangeFactor = ((maxR - minR) * FIRE.rangeFactorMin + minR) / dist;
    const range = Math.max(0, 1 - dist / (FIRE.rangeSlack * maxRange));
    const curve = Math.max(0, -0.22 * seededUnit(hashId(id)) + 1.3);
    let score = curve * range * wVal * sight * move * attacked * F * base * rangeFactor;
    if (harmless) score *= FIRE.harmlessFactor;
    if (id === currentTarget) current = { score, weapon: wBest, m };
    if (score > bestScore) { bestScore = score; best = m; bestWeapon = wBest; }
  }
  if (!best) return none;
  if (current && current.score > 0 && bestScore < FIRE.switchHysteresis * current.score) {
    best = current.m; bestScore = current.score; bestWeapon = current.weapon;
  }
  return {
    targetId: best.id, targetPos: [...best.pos], score: bestScore, weaponIndex: bestWeapon,
    urgency: decliningSlope(2 * bestScore), visible: !!best.seen, environmental: false,
  };
}
