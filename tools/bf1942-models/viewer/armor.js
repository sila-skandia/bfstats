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
// Deliberately NOT modelled, both because this file's only caller this round
// is the on-foot soldier and because the engine itself excludes soldiers from
// them: the per-accumulated-second critical/upside-down/water-damage ticks
// (`R4-13`: "explicitly skips soldiers — no HP loss at all"), and the
// finite-budget heal/repair branch (`R4-10`/`R4-25`: exact arithmetic
// unresolved, and moot — every Wake depot's own budget is the unlimited `-1`
// sentinel; see `supply.js`).

/**
 * `Armor::status(float)`'s death threshold (`R4-2`, `R4-7`): a pending value
 * at or below this counts as dead, snapped to exactly 0 — not "close to
 * zero", the actual stored value. `0x086c0308` (float) and `0x086c0b90`
 * (double) both decode to exactly this.
 */
export const DEATH_EPSILON = 0.001;

/**
 * `setMaxHitPoints(float v)` never raises a max past this (`R4-5`,
 * `0x086c1fe8` = 128.0 exactly). No vanilla soldier (30 HP) or Wake vehicle
 * reaches it; kept here because it is the engine's own rule, not this
 * viewer's, and a mod's Armor should not silently exceed it.
 */
export const MAX_HITPOINTS_CEILING = 128;

export class Armor {
  /**
   * @param {number} maxHitPoints template max, pre-ceiling (`R4-5`)
   * @param {number} [hitPoints] starting HP; defaults to spawning full
   */
  constructor(maxHitPoints, hitPoints = maxHitPoints) {
    this.maxHitPoints = Math.min(maxHitPoints, MAX_HITPOINTS_CEILING);
    // `hitPoints`'s default argument binds to the raw, pre-ceiling
    // `maxHitPoints` (JS evaluates default parameters before the body runs),
    // so an explicit "spawn full" call with an over-ceiling max would
    // otherwise leave `hitPoints > this.maxHitPoints` — clamp here too.
    this.hitPoints = Math.min(hitPoints, this.maxHitPoints);
    this.destroyed = this.hitPoints <= DEATH_EPSILON;
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
}
