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
//  * The target is scored over the spotted list — for an infantry bot the
//    targets it sees right now and inside its weapons' range (a vehicle keeps
//    lost and out-of-range ones) — not just the nearest: per weapon
//    `strength[targetType] / (1 + (20 * (shots - hits) + 10) / ammo)` picks
//    the weapon, with the shots and hits the memory record tallies for that
//    target and weapon slot; the score multiplies a range term `max(0, 1 -
//    d / (1.5 * maxRange))`, a range factor `(minRange + 0.1 * (maxRange -
//    minRange)) / d`, a sighting-age term `1 / (1 + 0.05 * age)` for a lost
//    target of a vehicle bot (1.0 when seen), a speed term `1 / (1 +
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
// INVENTION, labelled: `DecleiningSlopeCurve` (the final urgency shaping)
// was not in the corpus and is `x / (1 + x)` here; target types are the
// soldier's `setBattleStrength` classes with every soldier `Infantry`; the
// armour-class value vector is 1.

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
    deviation: entry?.deviation ?? 5.0,
    deviationCorrectionTime: entry?.deviationCorrectionTime ?? 10.0,
    minRange: entry?.minRange ?? 0.0,
    maxRange: entry?.maxRange ?? 60.0,
    weaponFire: entry?.weaponFire ?? 'PIFire',
    strength: entry?.strength ?? { Infantry: 1.0 },
    soundSphereRadius: entry?.soundSphereRadius ?? null,
    ammo: entry?.ammo ?? -1,
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
 * @param {boolean} [p.inVehicle]   the bot is in a vehicle (lost and
 *                                  out-of-range targets stay scored)
 * @returns {{ targetId, targetPos, score, weaponIndex, urgency }}
 */
export function scoreTargets({
  spotted, position, weapons, now, attackedBy, velocityOf, typeOf,
  currentTarget = null, currentScore = 0, insideOrderedArea = true,
  vetoed = null, waterDepth = 0, mySpeed = 0, inVehicle = false,
}) {
  const none = { targetId: null, targetPos: null, score: 0, weaponIndex: -1, urgency: 0 };
  if (waterDepth > FIRE.waterGate) return none;
  if (!spotted.length || !weapons.length) return none;
  // The 0.75 outside the ordered area applies to a bot in a vehicle only.
  const areaFactor = (inVehicle && !insideOrderedArea) ? FIRE.outsideAreaFactor : 1.0;
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
    // a visible target counts in full; a lost one is skipped by an infantry
    // bot and decays as `1 / (1 + 0.05 * age)` only for a bot in a vehicle.
    if (m.lost && !inVehicle) continue;
    const sightFactor = m.lost ? 1 / (1 + FIRE.sightAgeDecay * Math.max(0, now - (m.lostAt ?? now))) : 1.0;
    const targetType = typeOf?.(id) ?? 'Infantry';
    // Weapon choice.
    let wBest = -1, wVal = 0, maxRange = 0, minRange = Infinity;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const strength = w.strength?.[targetType] ?? 0;
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
    // Range terms.
    let speedFactor, strengthScale;
    if (dist <= maxRange) {
      strengthScale = 0.5;
      speedFactor = 1 / (1 + FIRE.inRangeSpeedFactor * tSpeed);
    } else {
      // Beyond the weapon's range an infantry bot skips the target; a vehicle
      // keeps it while the overshoot is under five times its own extent.
      if (!inVehicle) continue;
      strengthScale = 0.5;
      const dy = m.pos[1] - position[1];
      speedFactor = dy > 5.0
        ? FIRE.beyondRangeFactor / (1 + 0.5 * tSpeed + 2)
        : FIRE.beyondRangeFactor;
      if (dist - maxRange > 5 * Math.max(0, dy)) continue;
    }
    const range = Math.max(0, 1 - dist / (FIRE.rangeSlack * maxRange));
    const rangeFactor = (minRange + FIRE.rangeFactorMin * (maxRange - minRange)) / dist;
    const strengthSum = Math.round(SOLDIER_BATTLE_STRENGTH[targetType] ?? 1) * areaFactor * strengthScale;
    const curve = Math.max(0, -0.22 * seededUnit(hashId(id)) + 1.3);   // UCFire jitter
    let score = curve * range * wVal * sightFactor * speedFactor * attackedBonus
      * areaFactor * strengthSum * rangeFactor;
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
