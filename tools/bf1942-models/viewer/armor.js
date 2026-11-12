// The generic hit-point model every Armor-bearing thing gets: a soldier, a
// vehicle, a stationary gun. One clamp-and-death rule, and one generic
// signed-amount entry point that a fall, a supply depot's heal tick, and the
// `window.__damage(n)` test hook all go through unchanged.
//
// This is `Armor`'s own arithmetic (`verify-r4.md`'s `## Corrected report`,
// ids `R4-n` below), not an invention: every number and every branch here
// cites the claim it came from. Framework-free like `physics.js` and
// `collision.js` — no three.js, no DOM — so `tests/test_armor.py` runs it
// under plain node through `armor_harness.mjs`.
//
// Deliberately NOT modelled here: the per-accumulated-second
// critical/upside-down ticks, and the finite-budget heal/repair branch
// (`R4-10`/`R4-25`: exact arithmetic unresolved, and moot — every Wake depot's
// own budget is the unlimited `-1` sentinel; see `supply.js`).
//
// **`R4-13` is REFUTED, and the water tick does NOT skip soldiers** (HP-16,
// 2026-09-22). The claim ("explicitly skips soldiers — no HP loss at all")
// cited a `verify-r4.md` that is not in the tree, and it is wrong: a soldier
// drowns on `Armor`'s own ordinary water timer (`Armor::update` lnxded
// `0x08172f40`). What arms it is a soldier-specific clause in
// `Armor::setLastHitMaterialIndex` (`0x081736b0`) — material 1 is water, and a
// `CID_BFSoldierTemplate` object gets `armor[0x11] = isSwimming()` where every
// other object gets 1, so it is keyed on the SWIM STATE rather than on contact.
// Vanilla `CommonSoldierData.inc` gives `WaterDamageDelay 90`,
// `hpLostWhileDamageFromWater 1` against 30 HP: 90 s of grace, then 1 HP/s,
// dead at 119 s. The post-hit reset is a literal 1.0 s, and the dry arm
// restores the whole delay, so one dry tick buys the full grace back. The
// timer itself lives in `viewer/swim.js` and is applied from `world.js`
// beside the fall damage; this file's business is the damage it then bills.

/**
 * `Armor::status(float)`'s death threshold (`R4-2`, `R4-7`): a pending value
 * at or below this counts as dead, snapped to exactly 0 — not "close to
 * zero", the actual stored value. `0x086c0308` (float) and `0x086c0b90`
 * (double) both decode to exactly this.
 */
export const DEATH_EPSILON = 0.001;

/**
 * `setMaxHitPoints(float v)` stores `min(v, 128)` (`0x086c1fe8` = 128.0
 * exactly; lnxded `0x08173680`, client `0x004bbd40`). **The ceiling belongs to
 * that one setter, and it does not survive a spawn** (HP-17, 2026-09-30).
 *
 * The 2026-09-22 reading here was right about the setter and wrong about the
 * hull: it said a Yamato is a 128 HP object in retail and warned against
 * passing the authored value through. It read `setMaxHitPoints` alone.
 * `SimpleObjectTemplate::setArmorComponent` (`0x081ddae0`) builds every
 * Armor by calling `setMaxHitPoints(template max)` (vtable `+0x10`,
 * `0x081ddc43`) and **then** `setHitPoints(template hitPoints)` (`+0x18`,
 * `0x081ddc5e`), and `setHitPoints` (`0x081726c0`) stores the value and, when
 * it exceeds the max, stores it as the max too (`fsts [ebx+0x38]`, then
 * `fstps [ebx+0x3c]` on the `v > max` fall-through at `0x0817271a`). Almost
 * every template authors `hitPoints` equal to `maxHitPoints`, so a Yamato
 * spawns 600/600, an Elco80 500/500 and DC's AC-130 2000/2000. The
 * retail client says the same: bf42plus recordings read the live client
 * Armor's `+0x3c` as 500 on Elco80 and Type38, 450 on the B17, 130 on the
 * SBD and Stuka (`features/round-replay-capture` section 11.5).
 *
 * What the ceiling still does: a template whose `hitPoints` is below its
 * over-128 max spawns with a 128 max (an FHSW `BrokenTiger`, 40 of 155,
 * spawns 40/128). No other `setMaxHitPoints` caller was found (HP-17).
 */
export const MAX_HITPOINTS_CEILING = 128;

/**
 * A template's `hitPoints` and `maxHitPoints` before any `.con` sets them:
 * both 10 (`SimpleObjectTemplate` constructors `0x081dbd38`/`0x081dbd42` and
 * `0x081dbfc8`/`0x081dbfd2`). The console words store `ceil(v)` as an
 * unsigned int on the template (`ConsoleClass105`/`106::executeObjectMethod`,
 * `0x081c1820`/`0x081c1c80`: round-up control word, `frndint`, `fistpll`), and
 * `setArmorComponent` converts them back to float.
 */
export const TEMPLATE_HITPOINTS_DEFAULT = 10;

/**
 * `hpLostWhileCriticalDamage` before any `.con` sets it: 1.0 a second
 * (HP-22). The `SimpleObjectTemplate` constructor stores 1.0 at +0xf8
 * (lnxded `0x081dbe35`), the console word writes that field as it is
 * (`ConsoleClass128::executeObjectMethod` `0x081c6c2e`) and
 * `setArmorComponent` hands it to the Armor's `setHpLostWhileCriticalDamage`
 * (`0x081ddd26`, Armor +0x11c, the rate HP-17 bills).
 */
export const HP_LOST_WHILE_CRITICAL_DEFAULT = 1;

/**
 * The two rates beside it, before any `.con` sets them: 1.0 as well. The same
 * constructor stores the same 1.0 (`esi`) to template `+0xfc` and `+0x100`
 * (lnxded `0x081dbe3b`, `0x081dbe41`), and `setArmorComponent` hands `+0xfc`
 * to the Armor's vt+0xd8 `setHpLostWhileUpSideDown` (`0x081ddd38`, Armor
 * `+0x120`, the rate HP-18 bills) and `+0x100` to vt+0xe0
 * `setHpLostWhileDamageFromWater` (`0x081ddd4a`, Armor `+0x124`, HP-5's flat
 * amount). So a hull that never writes either still loses 1 HP a second on its
 * roof, and 1 a second in the water when it has `damageFromWater` (HP-22).
 */
export const HP_LOST_WHILE_UPSIDE_DOWN_DEFAULT = 1;
export const HP_LOST_WHILE_DAMAGE_FROM_WATER_DEFAULT = 1;

/**
 * `WaterDamageDelay` before any `.con` sets it: 0 s, so a `damageFromWater`
 * hull is billed on its first wet frame (template `+0xc0` takes `ecx` = 0 at
 * lnxded `0x081dbdc0`; `setArmorComponent` vt+0x58 `setWaterDamageDelay`
 * `0x08174050` writes it to both the live countdown `+0xe4` and the reload
 * `+0xec`). HP-5.
 */
export const WATER_DAMAGE_DELAY_DEFAULT = 0;

/**
 * The deep-water words before any `.con` sets them (HP-5, ledger edit
 * 2026-11-12): `damageFromDeepWater` off (template `+0x11c` = 0, vt+0x110,
 * Armor `+0x138`), `hpLostWhileDamageFromDeepWater` 1.0 (`+0x118`, vt+0x108,
 * Armor `+0x134`), `deepWaterLevel` 0 (`+0x120`, vt+0x100, Armor `+0x144`) and
 * `deepWaterDamageDelay` 1.0 (`+0x124`, vt+0x118, Armor `+0x13c`/`+0x140`).
 * BF1918 authors `damageFromDeepWater 1` on 137 templates.
 */
export const HP_LOST_WHILE_DAMAGE_FROM_DEEP_WATER_DEFAULT = 1;
export const DEEP_WATER_DAMAGE_DELAY_DEFAULT = 1;
export const DEEP_WATER_LEVEL_DEFAULT = 0;

/** One of a template's two hit-point words as the Armor receives it: the
 *  authored value rounded up, or the template default when it was never
 *  authored. */
export function templateHitPoints(value) {
  return Number.isFinite(value) ? Math.ceil(value) : TEMPLATE_HITPOINTS_DEFAULT;
}

export class Armor {
  /**
   * Spawns the way `setArmorComponent` does: `setMaxHitPoints(maxHitPoints)`
   * first, then `setHitPoints(hitPoints)`, which raises the max to the
   * starting value when that is higher (HP-3, HP-17).
   *
   * @param {number} maxHitPoints the template's max, before the ceiling
   * @param {number} [hitPoints] the template's starting HP; defaults to the
   *   same value, which spawns full
   */
  constructor(maxHitPoints, hitPoints = maxHitPoints) {
    this.destroyed = false;
    this.maxHitPoints = 0;
    this.hitPoints = 0;
    this.setMaxHitPoints(maxHitPoints);
    this.setHitPoints(hitPoints);
    /**
     * The body's latest round, `{ travel, height }` (`soldier-death.js`
     * `roundHit`), or null. The engine keeps it on the soldier's skeleton
     * collision mesh (`SkeletonCollisionMesh::getLatestCollision`, lnxded
     * `0x083aff50`) beside `Armor::setLastHitPlace`; either way it belongs to
     * the one body and a fresh body starts without one. Only the death pose
     * reads it.
     */
    this.lastHit = null;
  }

  /** `Armor::setMaxHitPoints` (`0x08173680`): `min(value, 128)`. It never
   *  touches `hitPoints` (HP-1). */
  setMaxHitPoints(value) {
    this.maxHitPoints = value > MAX_HITPOINTS_CEILING ? MAX_HITPOINTS_CEILING : value;
  }

  /**
   * `Armor::setHitPoints` (`0x081726c0`). A no-op once destroyed (this file
   * never sets `canBeRepairedAndDestroyed`, the `+0x12a` escape). A value at
   * or below the death epsilon is stored as exactly 0 and kills, through
   * `status()`, as `damage` does. A value above the max becomes the max too:
   * no ceiling applies here, which is how a 2000 HP template keeps its 2000.
   */
  setHitPoints(value) {
    if (this.destroyed) return;
    const next = value > DEATH_EPSILON ? value : 0;
    if (next === 0) this.destroyed = true;
    this.hitPoints = next;
    if (next > this.maxHitPoints) this.maxHitPoints = next;
  }

  /**
   * `Armor::damage(float)` (`R4-3`). No-op once destroyed — this file never
   * sets `canBeRepairedAndDestroyed`, so death is final, matching a vanilla
   * soldier's own Armor (the flag defaults off and `CommonSoldierData.inc`
   * never sets it). Returns the HP actually lost (not necessarily `amount`:
   * a killing blow only ever removes down to exactly 0).
   */
  damage(amount) {
    if (this.destroyed || !(amount > 0)) return 0;
    const before = this.hitPoints;
    let next = before - amount;
    if (next <= DEATH_EPSILON) { next = 0; this.destroyed = true; }
    this.hitPoints = next;
    return before - next;
  }

  /**
   * `Armor::heal(float)` (`R4-4`). Clamps at the current max; no-op once
   * destroyed (same reasoning as `damage`). Returns the HP actually
   * restored.
   */
  heal(amount) {
    if (this.destroyed || !(amount > 0)) return 0;
    const before = this.hitPoints;
    this.hitPoints = Math.min(before + amount, this.maxHitPoints);
    return this.hitPoints - before;
  }

  /**
   * `SimpleObject::handleDamage(float amt)` (`R4-19`, corrected this round —
   * the previous reading, "parent gets healed, root gets damaged", was
   * wrong). The sign of the one argument selects damage vs. heal *on this
   * same Armor*, compared against a literal `0.0`: `amt>0` damages,
   * `amt<=0` heals by `-amt`. This is the generic entry point a fall or a
   * scripted event uses — the viewer's fall damage and `window.__damage(n)`
   * both call this rather than `damage`/`heal` directly, for the same reason
   * the engine has one function here and not two.
   */
  applyDamage(amount) {
    if (amount > 0) this.damage(amount);
    else this.heal(-amount);
  }

  /** Restore full HP after a pad respawn. Death is otherwise final. */
  reset() {
    this.hitPoints = this.maxHitPoints;
    this.destroyed = false;
    this.lastHit = null;
  }
}
