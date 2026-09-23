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
//    The grid is the SAI's own side's (`getInformationGrid(side)`, env
//    vt+0xdc), so an enemy unit is in it only once the side has spotted or
//    heard it, and `security` is that side's `InformationKnown::
//    getSecurity()` 0x085e86a0: `1 - SCurve((now - t0) / D)` with t0 the
//    last sighting and D the unit template's `aiTemplate.degeneration`
//    (bot-sense.js `SideKnowledge`, ledger AI-75). A unit last seen D
//    seconds ago adds nothing; one never seen is not summed at all.
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

import { SideKnowledge, INFORMATION } from './bot-sense.js';

export const BATTLE_CLASSES = ['Infantry', 'LightArmour', 'HeavyArmour', 'NavalArmour', 'Submarine', 'Air'];

/**
 * `aiTemplate.degeneration` of each vanilla vehicle's hull template, keyed by
 * the `vehicle-ai.json` name (read from `Objects.rfa`
 * `Objects/Vehicles/<class>/<name>/AI/Objects.con`, 2026-09-24). A seat's
 * own template mostly carries its hull's value; the exceptions are a
 * carrier's or destroyer's AA and MG seats (20 against 180 / 50) and the
 * M3A1's rear passengers (15 against 20), which take the hull's here.
 */
export const VEHICLE_DEGENERATION = {
  aa_allies: 20, aichival: 8, 'aichival-t': 5, b17: 7, bf109: 5, blackmedal: 10, 'chi-ha': 15,
  corsair: 5, daihatsu: 20, defgun: 60, enterprise: 180, flak_38: 20, fletcher: 50, hanomag: 15,
  hatsuzuki: 50, ilyushin: 5, katyusha: 15, kettenkrad: 10, kubelwagen: 10, lcvp: 20, lynx: 10,
  m10: 25, m3a1: 20, mustang: 5, panzeriv: 15, priest: 15, princeow: 90, sbd: 5, 'sbd-t': 5,
  sexton: 25, sherman: 15, shokaku: 180, spitfire: 5, stuka: 5, t34: 25, 't34-85': 15, tiger: 25,
  wespe: 15, willy: 10, yak9: 5, yamato: 90, zero: 5,
};

/** A unit's degeneration: its own `degeneration` when the caller has one,
 *  else its vehicle template's, else the soldier's 15. A vehicle outside
 *  the vanilla table (a mod's) takes the soldier's value: INVENTION. */
export function unitDegeneration(unit) {
  const d = unit?.degeneration;
  if (Number.isFinite(d) && d > 0) return d;
  const t = unit?.template ? VEHICLE_DEGENERATION[String(unit.template).toLowerCase()] : undefined;
  return t ?? INFORMATION.soldierDegeneration;
}

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
  /** A fixed weapon with no known enemy and no enemy object in range that
   *  can face along its strategic area's links scores this flat value
   *  (`calculateFireStrength` 0x08584580, the `return 5.0` after the
   *  `validateCameraDirection` loop over the strategic object's children). */
  fixedStrategic: 5.0,
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
    /** What this side knows of the enemy (the bots' senses write it). */
    this.knowledge = new SideKnowledge();
    /** The last pass's weight per unit id, for the debug hooks. */
    this.lastSecurity = new Map();
  }

  /**
   * One strategic pass over `units`: every occupied enemy unit (each seat
   * counts) as `{ id, table, type, template?, degeneration? }`. With `now`
   * and an `id`, the unit weighs the side's security for it (0 and left
   * out when the side has never spotted or heard it); without them it
   * weighs its own `security` (1 when absent), the old omniscient input.
   * A player no longer among the units (dead) is forgotten.
   */
  update(units, now = null) {
    const k = this.knowledge;
    const known = now !== null && Number.isFinite(now);
    const present = new Set();
    this.lastSecurity.clear();
    for (const u of units ?? []) {
      let w;
      if (known && u.id !== undefined && u.id !== null) {
        present.add(u.id);
        k.degeneration.set(u.id, unitDegeneration(u));
        w = k.security(u.id, now);
        this.lastSecurity.set(u.id, w);
        if (w === null || !(w > 0)) continue;
      } else {
        w = u.security ?? 1;
      }
      const table = u.table ?? {};
      for (const c of BATTLE_CLASSES) this.strengths[c] += w * (table[c] ?? 0);
      if (u.type in this.types) this.types[u.type] += w;
    }
    if (known) for (const id of [...k.t0.keys()]) if (!present.has(id)) k.forget(id);
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
 * mobile plug-in and `aimable` whether it can point at a known enemy
 * (true / 'enemy': the normal score; 'strategic': no enemy known or in
 * range, only the strategic direction, a flat `fixedStrategic`; false: 0).
 *
 * The bot's own seat, when it weighs ANOTHER unit, is left out of that
 * unit's occupied shares (0x08584580: every share tests `unit != param_7 ||
 * !param_6`, `param_7` the bot's current seat and `param_6` "not my own
 * seat"): the seat it would leave is counted empty. The caller passes
 * `others` with that seat already marked unoccupied.
 */
export function fireStrength({ table, others = [], air = false, isSeat = false, myType = 'Infantry',
                               soldierType = null, enemyStrengths = null, enemyTypes = null,
                               fixed = false, aimable = true }) {
  if (fixed && !aimable) return 0;
  if (fixed && aimable === 'strategic') return STRENGTH.fixedStrategic;
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
