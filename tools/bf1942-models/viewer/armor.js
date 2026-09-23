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
 * `setMaxHitPoints(float v)` never raises a max past this (`R4-5`,
 * `0x086c1fe8` = 128.0 exactly). **R4-5 re-verified from the bytes 2026-09-22**,
 * because its sibling R4-13 turned out to be wrong and because SHIPS DO EXCEED
 * IT — a Fletcher authors `maxhitpoints 300`, a Yamato and an Enterprise 600 —
 * so the old note here ("no vanilla soldier or Wake vehicle reaches it") was
 * true only of the cases it had looked at, and reads as if nothing does.
 *
 * `Armor::setMaxHitPoints` lnxded `0x08173680` is eleven instructions and it is
 * a hard clamp:
 *
 *     fld [0x86c1fe8]   ; 128.0            st1
 *     fld [ebp+0xc]     ; v                st0
 *     fucom st(1) / fnstsw ax / test ah,0x45
 *     jne  0x81736a0    ; v <= 128 -> fstp st(1) pops the 128, v survives
 *     fstp st(0)        ; v  >  128 -> pops v, leaving 128.0
 *     fstp [eax+0x3c]   ; store whichever survived
 *
 * `test ah,0x45` reads fucom's C0/C2/C3: zero only when `v > 128`, which is the
 * fall-through that discards `v`. So a Yamato is a 128 HP object in the real
 * engine too, and this ceiling is parity rather than a lost field. **Do not
 * "fix" it by passing the authored value through** — that would make every ship
 * 2.3x to 4.7x tougher than retail. The extractor is emitting 300 and 600
 * correctly; the clamp is supposed to eat them.
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
