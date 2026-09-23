// The strength tables behind the vehicle scoring: what a unit is worth as a
// fighter, and what the enemy fields. Read from the decompiles on
// 2026-09-23 (features/bf1942-ai-research-2026-09-21/bot-behaviours.md §12,
// ledger AI-50..AI-51):
//
//  * `AISettings::getNBattleStrengths` 0x084843d0 returns 6: the classes
//    are the soldier's `setBattleStrength` names (`Objects/Soldiers/Common/
//    AI/Objects.con`): Infantry, LightArmour, HeavyArmour, NavalArmour,
//    Submarine, Air. `AITemplateUnit::initFromObject` 0x085e1a90 builds a
//    unit's table as the MAX over its `FireArms` (type 0x986f74) of each
//    weapon template's `setStrength` table (+0x3c), and sums their ammo into
//    +4; a soldier's template carries `setBattleStrength` directly.
//  * `SAI::updateStrengths` 0x08636c20: every strategic pass, for every
//    occupied unit the information grid knows, `strengths[i] += security *
//    unit.table[i]` and `types[unit.type] += security` into the side's own
//    (+0x1a4 / +0x1bc) or the enemy (+0x174 / +0x18c) tables, then all four
//    are halved: an exponential average that settles at the per-pass sum.
//    `BFEnvironment::getEnemyStrengths` / `getEnemyTypes` 0x085e4fe0 /
//    0x085e5030 hand a bot its side's enemy tables (`SAI::getEnemyStrengths`
//    0x08631830 ignores its argument).
//  * `calculateFireStrength` 0x08584580 (VehicleUrgencyCalculator): the
//    unit's own table plus a share of every other occupied seat of the same
//    hull (0.4 for a seat or an aircraft, 0.9 for a ground root), then `m =
//    max_i own[i]^2` and `mt` the same max over the classes the enemy fields
//    (`enemyTypes[i] > 0`); the strength is `mt - enemyStrengths[myType]`
//    (the max with the bot's soldier class when the template's +0x16 flag is
//    set) or `0.5 m` when the enemy fields nothing known. A fixed weapon
//    (no `IPIMobile`) with no known enemy it can point at
//    (`AIObjectControlInfo::validateCameraDirection` 0x085d4170) scores 0.
//  * `BFEnvironment::getHardware` 0x085e2fa0: the Change candidates come
//    from a 50 m radius; `getFriendlyUnits` 0x085e2e50 40 m;
//    `getEnemyObjects` 0x085e4eb0 75 m, 600 m for an aircraft.
//  * `engineHeatInfluence` 0x08585830: 1 until the engine heat passes 0.95,
//    then `1 - (heat - 0.95) * 20`.

export const BATTLE_CLASSES = ['Infantry', 'LightArmour', 'HeavyArmour', 'NavalArmour', 'Submarine', 'Air'];

export const STRENGTH = {
  seatShare: 0.4,
  hullShare: 0.9,
  noTypesFactor: 0.5,
  candidateRadius: 50.0,
  friendlyRadius: 40.0,
  enemyRadius: 75.0,
  enemyRadiusAir: 600.0,
  heatKnee: 0.95,
  heatSlope: 20.0,
  /** The exponential average's factor per strategic pass. */
  decay: 0.5,
};

export function zeroTable() {
  const t = {};
  for (const c of BATTLE_CLASSES) t[c] = 0;
  return t;
}

/** `AITemplateUnit::initFromObject`: a unit's table is the max over its
 *  weapons' `setStrength` tables (a healing pack has none). */
export function unitTable(weapons) {
  const t = zeroTable();
  for (const w of weapons ?? []) {
    if (w?.healing) continue;
    for (const c of BATTLE_CLASSES) {
      const v = w?.strength?.[c] ?? 0;
      if (v > t[c]) t[c] = v;
    }
  }
  return t;
}

/** One side's view of what the enemy fields (`SAI` +0x174 / +0x18c). */
export class EnemyStrengthTables {
  constructor() {
    this.strengths = zeroTable();
    this.types = zeroTable();
    this.passes = 0;
  }

  /**
   * One strategic pass over `units`: every occupied enemy unit (each seat
   * counts) as `{ table, type, security }`, security 1 when known.
   */
  update(units) {
    for (const u of units ?? []) {
      const w = u.security ?? 1;
      const table = u.table ?? {};
      for (const c of BATTLE_CLASSES) this.strengths[c] += w * (table[c] ?? 0);
      if (u.type in this.types) this.types[u.type] += w;
    }
    for (const c of BATTLE_CLASSES) {
      this.strengths[c] *= STRENGTH.decay;
      this.types[c] *= STRENGTH.decay;
    }
    this.passes++;
  }
}

/**
 * `calculateFireStrength` for one unit. `table` is the unit's own table,
 * `others` the other seats of the same hull as `{ table, occupied }`,
 * `air` / `isSeat` pick the share (0.4) over a ground root's (0.9),
 * `myType` the unit's armour class, `soldierType` the bot's own class when
 * the unit's template also exposes the soldier, `fixed` a unit without a
 * mobile plug-in and `aimable` whether it can point at a known enemy.
 */
export function fireStrength({ table, others = [], air = false, isSeat = false, myType = 'Infantry',
                               soldierType = null, enemyStrengths = null, enemyTypes = null,
                               fixed = false, aimable = true }) {
  if (fixed && !aimable) return 0;
  const share = (air || isSeat) ? STRENGTH.seatShare : STRENGTH.hullShare;
  const own = zeroTable();
  for (const c of BATTLE_CLASSES) {
    let v = table?.[c] ?? 0;
    for (const o of others) if (o?.occupied) v += share * (o.table?.[c] ?? 0);
    own[c] = v;
  }
  let m = 0, mt = 0;
  for (const c of BATTLE_CLASSES) {
    const sq = own[c] * own[c];
    if (sq > m) m = sq;
    if ((enemyTypes?.[c] ?? 0) > 0 && sq > mt) mt = sq;
  }
  if (mt <= 0) return STRENGTH.noTypesFactor * m;
  let threat = enemyStrengths?.[myType] ?? 0;
  if (soldierType) threat = Math.max(threat, enemyStrengths?.[soldierType] ?? 0);
  return mt - threat;
}

/** `engineHeatInfluence`: the move term's cut for an overheating engine. */
export function engineHeatInfluence(heat = 0) {
  return heat > STRENGTH.heatKnee ? 1 - (heat - STRENGTH.heatKnee) * STRENGTH.heatSlope : 1;
}
