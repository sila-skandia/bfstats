// What a shot does to a vehicle: hit points, the tier it smokes or burns at,
// the per-second loss once it is critical, and death.
//
// The engine side is settled in `features/bf1942-engine-reference/` — ledger
// rows HP-1/HP-2/HP-5, ARM-1/ARM-2, HP-9/HP-9d and HP-15, and
// `subsystems/hitpoints-and-damage.md` §8. The findings that shape this file:
//
//   - **A collision costs hit points** — HP-6's "a collision never costs hit
//     points" was refuted on 2026-09-18/19. Both collision handlers reach
//     `GameServer::giveDamage` through the GameServer's own vtable slot
//     `+0x15c`; see `subsystems/collision-response.md` §9. The vehicle crash
//     path is **not in this file**: its formulas, material rules and
//     once-a-second limiter (COL-3/COL-4/COL-5) are `crash-damage.js`, and the
//     contacts that feed it come from `body-world.js`. What arrives here is a
//     plain `damage(amount)`, exactly as a round's does, so everything below —
//     tiers, the critical tick, death — follows a crash for free. The soldier
//     half is HP-14, in `map.html`. What this module owns is projectile damage,
//     direct and splash, plus the standing damage clocks below.
//   - **A living object re-evaluates its effect tier every tick** (ARM-1). The
//     `Armor+0x128` byte the engine keeps is a *death* latch, not a first-run
//     latch, so there is no once-per-lifetime behaviour to reproduce: poll, and
//     stop polling when it dies.
//   - **A soldier IS splashed, and through a mechanism of his own** (HP-10).
//     `applySplash` walks registered vehicles, and the man on foot is not one;
//     what reaches him instead is a target carrying its own `Armor` plus an
//     exposure callback, because the engine multiplies his distance falloff by
//     the fraction of line-of-sight samples that got through
//     (`checkForHitOnSoldier`, `viewer/soldier-exposure.js`). Nothing that is
//     not a soldier has any occlusion at all.
//   - **A wreck takes no player input and a critical vehicle traverses at
//     0.2x** (HP-15, superseding the retired ARM-6). That is two persistent
//     bytes on the engine's object, not per-frame flags, and it lasts the whole
//     wrecked lifetime; `inputGate` below is the rule and `map.html`/`seats.js`
//     are where it is spent.
//
// Framework-free, like `armor.js`, `physics.js` and `collision.js` — no
// three.js, no DOM — so `tests/vehicle_damage_harness.mjs` runs the real thing
// under plain node. The caller owns every scene concern: where an effect is
// drawn, what a wreck looks like, who is allowed to climb in.

import {
  Armor, DEATH_EPSILON, HP_LOST_WHILE_CRITICAL_DEFAULT, HP_LOST_WHILE_UPSIDE_DOWN_DEFAULT,
  HP_LOST_WHILE_DAMAGE_FROM_WATER_DEFAULT, WATER_DAMAGE_DELAY_DEFAULT,
  HP_LOST_WHILE_DAMAGE_FROM_DEEP_WATER_DEFAULT, DEEP_WATER_DAMAGE_DELAY_DEFAULT,
  DEEP_WATER_LEVEL_DEFAULT, templateHitPoints,
} from './armor.js';
import { blastDistance, splashDamage as splashHp } from './effects-core.js';

/** `addArmorEffect`'s death tier: the explosion and the scrap. */
export const TIER_DEATH = 0;
/** Its water-death tier, for a vehicle that dies in the sea. */
export const TIER_WATER_DEATH = -1;

/**
 * The tier active at `hitPoints`, as `{ threshold, names }`, or null for a
 * vehicle that is not showing anything.
 *
 * The rule is **the lowest authored threshold that `hitPoints` has fallen to or
 * below**, and every effect declared at that threshold plays (the Spitfire
 * declares two at 65). A Sherman authors 50 and 12: at 100 HP it shows
 * nothing, from 50 it smokes, from 12 it burns, and it keeps burning all the
 * way down.
 *
 * `0` and `-1` are the death tiers and never match a living vehicle; ask for
 * them explicitly with `deathTier`.
 *
 * This is exactly the engine's (ARM-1, settled 2026-11-12 on lnxded):
 * `Armor::playEffect` (`0x08172960`) keys a living object on `ceil(hitPoints)`
 * (`or $0x800; frndint; fistpl`, `0x08172e6d`), and `Armor::getEffect`
 * (`0x08172820`) answers the SMALLEST authored threshold at or above that key,
 * nothing when the key is above every threshold (it walks back from the map's
 * end while the previous key is still `>=` the key). For an integer threshold
 * `ceil(hp) <= k` is `hp <= k`, so comparing the float here is the same rule.
 */
export function activeTier(effects, hitPoints) {
  if (!effects || !effects.length) return null;
  let best = null;
  for (const entry of effects) {
    const threshold = entry.hp;
    if (!(threshold > 0)) continue;             // death tiers are not "active"
    if (hitPoints > threshold) continue;        // not fallen this far yet
    if (best === null || threshold < best) best = threshold;
  }
  if (best === null) return null;
  return { threshold: best, names: namesAt(effects, best) };
}

/**
 * `Armor::playEffect`'s key for a dead object (ARM-11; lnxded `0x0817299f`..
 * `0x081729c4` and `0x08172e55`..`0x08172e68`, client `0x004bc413`): 0 when no
 * hit material was ever recorded (`Armor+0x8 == -1`), -1 when the object is in
 * water (`+0x10`), otherwise minus the last hit material. The material is the
 * other side's of the latest `SimpleObject::handleCollision` (`0x081dae4d`,
 * vtable +0x60 `setLastHitMaterialIndex`), so a hull that last touched the sea
 * (material 1) keys -1 even out of the water.
 */
export function deathKey({ lastHitMaterial = -1, inWater = false } = {}) {
  if (lastHitMaterial == null || lastHitMaterial === -1) return 0;
  return inWater ? TIER_WATER_DEATH : -lastHitMaterial;
}

/**
 * `Armor::getEffect(key)` (lnxded `0x08172820`, client `0x004bc2f0`) over an
 * `armor.effects` list: `{ threshold, effects }` with every entry authored at
 * the answered threshold, in authored order, or null.
 *
 * Below 1 it is the exact key, else key 0 (`find(key)`, then `find(0)`,
 * `0x081728fc`..`0x0817295c`). From 1 up it is the smallest threshold at or
 * above the key, and nothing when the key is above every threshold.
 */
export function tierAt(effects, key) {
  if (!Array.isArray(effects) || !effects.length) return null;
  const at = threshold => effects.filter(entry => entry.hp === threshold);
  if (key < 1) {
    for (const threshold of [key, 0]) {
      const found = at(threshold);
      if (found.length) return { threshold, effects: found };
    }
    return null;
  }
  let best = null;
  for (const entry of effects) {
    if (entry.hp >= key && (best === null || entry.hp < best)) best = entry.hp;
  }
  return best === null ? null : { threshold: best, effects: at(best) };
}

/**
 * The death tier's effects, `{ threshold, names }`, or null when the key and
 * the 0 fallback are both undeclared: `getEffect(deathKey(...))` (ARM-11).
 *
 * `lastHitMaterial` is the Armor's `+0x8`. A caller that does not track it
 * (no caller does yet: the body world does not hand the contact's material to
 * the hull's damage record) leaves it undefined and gets the water rule alone,
 * -1 in the water and 0 out of it, which is the engine's answer for every
 * death but two: a hull in the water that never touched anything (0), and one
 * whose last contact was the sea while it is out of it (-1).
 */
export function deathTier(effects, { inWater = false, lastHitMaterial = undefined } = {}) {
  if (!effects || !effects.length) return null;
  const key = lastHitMaterial === undefined
    ? (inWater ? TIER_WATER_DEATH : TIER_DEATH)
    : deathKey({ lastHitMaterial, inWater });
  const tier = tierAt(effects, key);
  return tier ? { threshold: tier.threshold, names: tier.effects.map(e => e.effect) } : null;
}

/** Every effect name declared at exactly this threshold, in authored order. */
function namesAt(effects, threshold) {
  return effects.filter(e => e.hp === threshold).map(e => e.effect);
}

/**
 * One damageable vehicle: an `Armor`, the tiers it authored, and the bookkeeping
 * to tell a caller when what it should be drawing changes.
 *
 * `extras` is the `armor` block the assembler now ships on a placed vehicle's
 * node — `hitpoints`, `maxHitpoints`, `criticalDamage`,
 * `hpLostWhileCriticalDamage`, `hpLostWhileDamageFromWater`,
 * `hpLostWhileUpSideDown`, `damageFromWater`, `effects`.
 */
export class DamageableVehicle {
  constructor(extras, { name = null, owner = -1, submarineData = null } = {}) {
    // The template's two words as `setArmorComponent` hands them over, a
    // word the `.con` never set being the template's own 10. `Armor` then
    // applies the 128 ceiling to the max and lets the starting value raise it
    // again (HP-17), so an authored 2000/2000 spawns 2000/2000.
    this.armor = new Armor(templateHitPoints(extras?.maxHitpoints),
                           templateHitPoints(extras?.hitpoints));
    this.effects = Array.isArray(extras?.effects) ? extras.effects : [];
    // Whether the template's tiers are known at all. The assembler writes
    // the `armor` block for every template with an Armor (since 2026-09-17)
    // and lists `effects` only where the `.con` authored `addArmorEffect`
    // rows, so a block with none means the template authored none, and its
    // death draws nothing (ARM-1, ARM-11: `Armor::playEffect` plays the
    // authored tier and nothing else). Only a node with no block at all
    // leaves the tiers unknown.
    this.armorKnown = extras !== null && typeof extras === 'object';
    this.criticalDamage = Number.isFinite(extras?.criticalDamage)
      ? extras.criticalDamage : null;
    // A template that never says the word bleeds the constructor's 1.0 a
    // second (HP-22: `SimpleObjectTemplate` +0xf8, lnxded 0x081dbe35).
    this.hpLostWhileCriticalDamage =
      Number.isFinite(extras?.hpLostWhileCriticalDamage)
        ? extras.hpLostWhileCriticalDamage : HP_LOST_WHILE_CRITICAL_DEFAULT;
    // The other two rates default to the same constructor 1.0 (HP-22,
    // `armor.js`): an unwritten word is 1 HP a second, not none.
    this.hpLostWhileDamageFromWater =
      Number.isFinite(extras?.hpLostWhileDamageFromWater)
        ? extras.hpLostWhileDamageFromWater : HP_LOST_WHILE_DAMAGE_FROM_WATER_DEFAULT;
    this.hpLostWhileUpSideDown =
      Number.isFinite(extras?.hpLostWhileUpSideDown)
        ? extras.hpLostWhileUpSideDown : HP_LOST_WHILE_UPSIDE_DOWN_DEFAULT;
    this.damageFromWater = Boolean(extras?.damageFromWater);
    /** `WaterDamageDelay`, the grace before the first water bill (HP-5);
     *  0 where never written. */
    this.waterDamageDelay = Number.isFinite(extras?.waterDamageDelay)
      ? extras.waterDamageDelay : WATER_DAMAGE_DELAY_DEFAULT;
    // The deep-water clock (HP-5's second countdown): off unless authored.
    this.damageFromDeepWater = Boolean(extras?.damageFromDeepWater);
    this.hpLostWhileDamageFromDeepWater =
      Number.isFinite(extras?.hpLostWhileDamageFromDeepWater)
        ? extras.hpLostWhileDamageFromDeepWater : HP_LOST_WHILE_DAMAGE_FROM_DEEP_WATER_DEFAULT;
    this.deepWaterDamageDelay = Number.isFinite(extras?.deepWaterDamageDelay)
      ? extras.deepWaterDamageDelay : DEEP_WATER_DAMAGE_DELAY_DEFAULT;
    /** `deepWaterLevel` (Armor `+0x144`): the origin is deep, and wet, when
     *  the sea at it stands above `y - deepWaterLevel` (`Armor::update`
     *  `0x08172f9d`..`0x08172fcc`). */
    this.deepWaterLevel = Number.isFinite(extras?.deepWaterLevel)
      ? extras.deepWaterLevel : DEEP_WATER_LEVEL_DEFAULT;
    this.splashMaterial = Number.isFinite(extras?.splashMaterial)
      ? extras.splashMaterial : null;
    this.name = name;
    this.owner = owner;
    /** The tier the caller has been told to draw, or null. */
    this.shown = null;
    /** `Armor+0xe8`, the one-second bank the critical bleed and the
     *  upside-down test are both billed from (HP-17, HP-18). It runs from
     *  spawn whatever the hull's state, as a float. */
    this.bank = 0;
    /** `Armor+0xe4`, the water countdown: the delay while dry, then 1.0 s
     *  after each bill (HP-5). */
    this.waterTimer = this.waterDamageDelay;
    /** `Armor+0x13c`, the deep-water countdown, the same law (HP-5). */
    this.deepWaterTimer = this.deepWaterDamageDelay;
    /**
     * The critical byte `Armor::status` moves by message (HP-13, HP-17):
     * set on `0x14` when a safe Armor's new value is at or under
     * `criticalDamage` (alive), cleared on `0x13` when a critical one's rises
     * above it. **Death sends `0x15` alone**: `status()` (`0x081739e0`) takes
     * the death branch at `0x08173a06` straight to `0x08173c70` for any value
     * at or under 0.001, so a hull killed outright from above its threshold
     * never gets `0x14`. What reads it: `RotationalBundle`'s 0.2 input scale
     * (HP-15, `SimpleObject+0xee`) and `FloatingBundle`'s sink rate (only its
     * `0x14` branch arms `+0xb0`, `0x08240557`; `0x15` sets the wreck byte
     * alone, `0x082403fa`). So a ship destroyed in one blow from above its
     * threshold never arms its floats' sink rate.
     */
    this.criticalFlagged = false;
    /**
     * `Armor+0x1c`, the last hit place (`setLastHitPlace` `0x08174120`): the
     * hit point less the root's position, world axes, written by every
     * `GameServer::_giveDamage` before the damage lands (`0x0814b996`..
     * `0x0814b9dd`). Only its x is read anywhere this page models: a Wing
     * going critical mirrors its lift scale on `x < 0` (`Wing::handleMessage`
     * `0x08250e92`, `aircraft.js` `criticalLift`). 0 until a hit names one.
     */
    this.lastHitPlaceX = 0;
    /** `lastHitPlaceX` as the crossing into critical found it, which is when
     *  the Wings read it (message 0x14). */
    this.criticalHitX = 0;
    /**
     * `Armor+0x8`, the last hit material: -1 until a contact records one
     * (Armor ctor `0x081722be`), then the other side's material of each
     * `handleCollision`, which stops recording once the object is destroyed
     * (`0x081dae32` skips past it). The death tier keys on it (ARM-11).
     */
    this.lastHitMaterial = -1;
    /**
     * `PlayerControlObjectTemplate::submarineData`'s seven floats (PHY-3,
     * template `+0x218..+0x230`), or null when the hull authors none or a
     * crush depth (the 6th) of 0, which turns the whole system off
     * (`0x08318da0`). Desert Combat writes it on fourteen land vehicles, every
     * one with a 1st and 3rd that come to no suffocation, so on land it is the
     * crush: an M1A1 deeper than 1.5 m loses 5 HP a second.
     */
    this.submarine = Array.isArray(submarineData) && submarineData.length >= 7
      && submarineData[5] > 0 ? submarineData.slice(0, 7).map(Number) : null;
    /** `PlayerControlObject+0x178`, the crew's oxygen: 1.0 from the
     *  constructor (`0x08316733`), refilled at most to 1.0. */
    this.oxygen = 1;
    /** `PlayerControlObject+0x19c`, the seconds `handleFrameUpdate` banks
     *  before it acts (0.5, `0x086b05e8`). */
    this.submarineAccumulator = 0;
    /** Set once the caller has been handed the death tier, so it fires once. */
    this.deathAnnounced = false;
    /** Who last hit it: `Armor+0x14` (`lastHitPlayer`), which
     *  `GameServer::_giveDamage` (lnxded 0x0814b870) sets through the Armor's
     *  vtable +0x74 (0x0814b947) only when the attacker resolves to a player
     *  (`getBFPlayer`, 0x0814b92c). A player id, or null. */
    this.lastHitPlayer = null;
    /** Who dealt the killing damage, or null when nobody did (a burn-down, a
     *  hit with no player behind it). `_giveDamage` scores the crew's deaths
     *  on the lethal call itself: it walks the hull's seats (`getPcos`,
     *  0x0814baea) and, per living occupant, gives that call's attacker an
     *  ordinary kill (score event 3, then `killPlayer(victim, true)`:
     *  0x0814c122/0x0814c12f and 0x0814c277/0x0814c284), a team kill (6,
     *  0x0814c15b / 0x0814c2d0) for his own side, or, when the call had no
     *  attacker, `killPlayer(victim, false)` (4, `is no more`: 0x0814c224,
     *  0x0814c399). Ledger AI-76. */
    this.killedBy = null;
    /** What the lethal call was dealt with, `{ weapon, splash }` as the
     *  message log's `how` takes it, or null when nothing named a weapon. The
     *  crew's deaths are scored on that call, so its template stamp (the
     *  fourth argument `_giveDamage` hands `handleScore`, 0x0814c12f) is what
     *  each crewman's kill line names: the projectile's own `+0x140`, fixed
     *  when `FireArms::fireBarrel` made it, never what the attacker holds when
     *  the hull finally dies (ledger KILLSTAMP-1). */
    this.killedWith = null;
  }

  get hitPoints() { return this.armor.hitPoints; }
  get maxHitPoints() { return this.armor.maxHitPoints; }
  get destroyed() { return this.armor.destroyed; }

  /**
   * Is this vehicle critically damaged — the state its fire tier is authored
   * to coincide with (ARM-2: 10 of 10 sampled vanilla vehicles put the fire
   * tier at exactly `criticalDamage`)? `hitPoints <= criticalDamage` on the
   * two numbers, inclusive, which is the engine's own bleed test (HP-17).
   * The engine's critical flag moves only when `status()` sees the crossing
   * (message `0x14`; `0x15` is destruction, HP-13), so the two agree for any
   * hull that spawns above its threshold. A scripted burn-down authored at
   * or under it (DC's `flagkill`, EoD's `LtnFX`) bleeds here as it does in
   * the engine, where it is never flagged.
   */
  get critical() {
    return this.criticalDamage !== null
      && this.armor.hitPoints <= this.criticalDamage;
  }

  /** The critical byte's move for one change of hit points (`status()`'s
   *  alive branches, HP-13/HP-17). Death moves nothing. Death is final here
   *  (no `canBeRepairedAndDestroyed`), so only a living Armor reaches this. */
  _status(before) {
    const after = this.armor.hitPoints;
    if (this.armor.destroyed || this.criticalDamage === null) return;
    if (before > this.criticalDamage && after <= this.criticalDamage) {
      this.criticalFlagged = true;
      this.criticalHitX = this.lastHitPlaceX;
    }
    else if (before <= this.criticalDamage && after > this.criticalDamage) this.criticalFlagged = false;
  }

  /** Any damage the hull's own Armor takes: the move of the critical byte
   *  with it. Returns the HP lost. */
  _hurt(amount) {
    const before = this.armor.hitPoints;
    const lost = this.armor.damage(amount);
    this._status(before);
    return lost;
  }

  /** A round landed. `attacker` is the player behind it (an id), if any.
   *  Returns the HP actually lost. */
  damage(amount, attacker = null, how = null) {
    if (this.armor.destroyed) return this.armor.damage(amount);
    if (attacker != null) this.lastHitPlayer = attacker;
    const lost = this._hurt(amount);
    if (this.armor.destroyed) {
      this.killedBy = attacker ?? null;
      this.killedWith = attacker != null && how ? { weapon: how.weapon ?? null, splash: !!how.splash } : null;
    }
    return lost;
  }

  /** Where a hit landed, as its world x less the root's (`lastHitPlaceX`).
   *  Called before the damage it belongs to, as `_giveDamage` orders it. */
  noteHitPlace(dx) {
    if (!this.armor.destroyed && Number.isFinite(dx)) this.lastHitPlaceX = dx;
  }

  /** A contact's other-side material (`setLastHitMaterialIndex`); a dead
   *  object keeps the one it died with. */
  noteHitMaterial(material) {
    if (!this.armor.destroyed && Number.isFinite(material)) this.lastHitMaterial = material;
  }

  /** A depot or a repair tool. Returns the HP actually restored. */
  heal(amount) {
    const before = this.armor.hitPoints;
    const healed = this.armor.heal(amount);
    this._status(before);
    return healed;
  }

  /** Pad respawn: full HP, clear death latch, no burn smoke until damaged again. */
  reset() {
    this.armor.reset();
    this.shown = null;
    this.bank = 0;
    this.waterTimer = this.waterDamageDelay;
    this.deepWaterTimer = this.deepWaterDamageDelay;
    // `setHitPoints(getMaxHitPoints())` from destroyed: `status()` sends
    // `0x13` when the new value is above the threshold and `0x14` when it is
    // at or under it (HP-17), so the byte is the full hull's own answer.
    this.criticalFlagged = this.criticalDamage !== null
      && this.armor.hitPoints <= this.criticalDamage;
    this.lastHitMaterial = -1;
    this.lastHitPlaceX = 0;
    this.criticalHitX = 0;
    this.oxygen = 1;
    this.submarineAccumulator = 0;
    this.deathAnnounced = false;
    this.lastHitPlayer = null;
    this.killedBy = null;
    this.killedWith = null;
  }

  /**
   * `submarineData`'s half of `PlayerControlObject::handleFrameUpdate`
   * (`0x08318d20`, PHY-3), on `depth`, the root node's `getUnderWater`
   * (`[this+0x60]` vtable `+0xc4`, `PhysicsNode::getUnderWater` `0x0824d450`).
   * It banks the frame time and acts once 0.5 s is in the bank, on the whole
   * of it, and every path through the function reaches it (`0x08318d80`,
   * `0x08318d9a`, `0x08319190`): the `+0x17c` test PHY-3 read as its gate
   * only decides whether the abandoned-vehicle block runs first.
   *
   *   deeper than the 6th     the hull takes `elapsed x 7th` (`0x08318e3e`)
   *   no deeper than the 5th  oxygen += `elapsed x 2nd`, capped at 1.0
   *   deeper                  oxygen -= `elapsed x 1st`; spent, it is held at 0
   *                           and every attached soldier takes `elapsed x 3rd`
   *                           (`damageAllAttachedSoldiers` `0x08318c70`)
   *
   * Returns `{ hull, crew }`: what the hull lost and what each of its crew is
   * owed this step (0 and 0 when the clock did not fire).
   */
  stepSubmarine(dt, depth) {
    const out = { hull: 0, crew: 0 };
    const sub = this.submarine;
    if (!sub || this.armor.destroyed) return out;
    // A float, as `+0x19c` is: 15 ticks of 1/30 s reach 0.5 here, 16 in a double.
    this.submarineAccumulator = Math.fround(this.submarineAccumulator + Math.fround(dt));
    if (this.submarineAccumulator < 0.5) return out;
    const elapsed = this.submarineAccumulator;
    this.submarineAccumulator = 0;
    const [drain, refill, suffocation, , breathDepth, crushDepth, crushRate] = sub;
    if (depth > crushDepth) out.hull = this._hurt(elapsed * crushRate);
    if (depth <= breathDepth) {
      this.oxygen = Math.min(1, this.oxygen + refill * elapsed);
    } else {
      this.oxygen -= elapsed * drain;
      if (this.oxygen < 0) {
        this.oxygen = 0;
        out.crew = elapsed * suffocation;
      }
    }
    return out;
  }

  /**
   * One simulation step: `Armor::update`'s server clocks (lnxded
   * `0x08172f40`), in its order, then `submarineData`'s, and what the caller
   * should now be drawing.
   *
   *   bank      `+0xe8 += dt` from spawn, a float. Once it holds a second:
   *             the critical bleed, `bank x hpLostWhileCriticalDamage` when
   *             `hitPoints <= criticalDamage` and the rate is not 0
   *             (`0x081732f2`..`0x08173657`, HP-17); then the upside-down
   *             test, `bank x hpLostWhileUpSideDown` (HP-18, `0x081734a6`);
   *             then the bank is zeroed, no carry (`0x0817336d`).
   *   water     every step: wet and `damageFromWater`, `+0xe4 -= dt`, and
   *             below 0 a flat `hpLostWhileDamageFromWater` and `+0xe4 = 1`
   *             (`0x08173167`..`0x081732b8`); otherwise `+0xe4 =
   *             WaterDamageDelay` (`0x081732c7`). HP-5.
   *   deep      the same law on `+0x13c` with the deep-water words
   *             (`0x0817318d`..`0x08173248`). HP-5.
   *
   * Returns `{ tier, changed, died, tick, crew }`: `tier` is what to draw (the
   * death tier once it is dead), `changed` is true only on the step the answer
   * moved, `died` is true on the one step the caller is first told about
   * death, `tick` the HP the hull's own clocks took and `crew` the HP each of
   * its crew is owed for want of air (`stepSubmarine`). `depth` is the hull's
   * `underWater`, metres; `deepWater` is the origin under the sea plus
   * `deepWaterLevel` (`world-damage.js` `deepWaterOwners`), which is wet too
   * (`0x08172fc8` sets `+0x10` with `+0x130`).
   *
   * `died` deliberately means "newly dead *as far as the caller knows*", not
   * "died inside this call" — a round that kills the vehicle does so through
   * `damage()`, outside any `update`, so a flag scoped to this call would never
   * fire for the one case that matters and the explosion would never play.
   */
  update(dt, { inWater = false, upsideDown = false, depth = 0, deepWater = false } = {}) {
    // Each tick below is its own `giveDamage` in the engine (`Armor::update`
    // hands it the Armor's own object and the world origin for `Pos3`), so
    // each washes the screen of whoever sits in this hull (ledger HFD-11,
    // HFD-13). `tick` is the HP the last of this step's ticks took, 0 when
    // none fired: a second tick in the same step replaces the first's flash.
    let tick = 0;
    const wet = inWater || deepWater;
    if (inWater) this.noteHitMaterial(1);

    // The one-second bank (HP-17, HP-18). The float matters: 30 ticks of
    // 1/30 s fill it, where a double needs 31 and bills 5.17 HP every 1.03 s.
    // Retail bills 5.0 at each whole second (DC lab, an unmanned Humvee_TOW on
    // its roof). A hull that goes critical is billed 0 to 1 s later, on the
    // bank's own phase, never sooner.
    if (!this.armor.destroyed) {
      this.bank = Math.fround(this.bank + Math.fround(dt));
      if (this.bank >= 1) {
        if (this.critical && this.hpLostWhileCriticalDamage !== 0) {
          const amount = this.bank * this.hpLostWhileCriticalDamage;
          this._hurt(amount);
          tick = amount;
        }
        if (!this.armor.destroyed && upsideDown && this.hpLostWhileUpSideDown > 0.01) {
          const amount = this.bank * this.hpLostWhileUpSideDown;
          this._hurt(amount);
          tick = amount;
        }
        this.bank = 0;
      }
    }

    // Water, then deep water: each its own countdown, its first bill after
    // its delay (0 s and 1 s where never written), every one after it 1.0 s
    // on, and the delay given back the moment the hull is dry (HP-5).
    if (!this.armor.destroyed) {
      if (wet && this.damageFromWater) {
        // A float, as `+0xe4` is (`fstps`).
        this.waterTimer = Math.fround(this.waterTimer - Math.fround(dt));
        if (this.waterTimer < 0) {
          this._hurt(this.hpLostWhileDamageFromWater);
          tick = this.hpLostWhileDamageFromWater;
          this.waterTimer = 1;
        }
      } else {
        this.waterTimer = this.waterDamageDelay;
      }
      if (deepWater && this.damageFromDeepWater) {
        this.deepWaterTimer = Math.fround(this.deepWaterTimer - Math.fround(dt));
        if (this.deepWaterTimer < 0) {
          this._hurt(this.hpLostWhileDamageFromDeepWater);
          tick = this.hpLostWhileDamageFromDeepWater;
          this.deepWaterTimer = 1;
        }
      } else {
        this.deepWaterTimer = this.deepWaterDamageDelay;
      }
    }

    // `submarineData`'s crush and the crew's air, on its own 0.5 s bank.
    const submarine = this.stepSubmarine(dt, depth);
    if (submarine.hull > 0) tick = submarine.hull;
    const crew = submarine.crew;

    const died = this.armor.destroyed && !this.deathAnnounced;
    const tier = this.armor.destroyed
      // A hull in the water is touching it: its wet parts send
      // `handleCollision` with material 1 every tick (HP-21), and the wet
      // byte `+0x10` is itself that contact's (`setLastHitMaterialIndex`,
      // `0x081736c7`..`0x0817370a`), so on the frame it dies in the sea its
      // last material is 1 whatever killed it.
      ? deathTier(this.effects, { inWater, lastHitMaterial: inWater ? 1 : this.lastHitMaterial })
      : activeTier(this.effects, this.armor.hitPoints);

    // A destroyed vehicle's tier is announced once and then frozen — which is
    // the one thing the engine's `+0x128` latch actually buys, reproduced here
    // by not asking again rather than by keeping a latch.
    if (this.armor.destroyed && this.deathAnnounced) {
      return { tier: this.shown, changed: false, died, tick, crew };
    }

    const changed = tierKey(tier) !== tierKey(this.shown);
    if (changed) this.shown = tier;
    if (this.armor.destroyed) this.deathAnnounced = true;
    return { tier, changed, died, tick, crew };
  }
}

/** Identity for a tier, so "same threshold, same names" is one comparison. */
function tierKey(tier) {
  return tier ? `${tier.threshold}:${tier.names.join(',')}` : '';
}

/**
 * How much of the player's input a vehicle in this state actually passes on —
 * `{ blocked, rotationalScale }`.
 *
 * **HP-15**, which retires ARM-6's "a critically damaged vehicle drives and
 * traverses exactly as a healthy one". ARM-6's sweep was sound and its
 * conclusion still holds for the question it asked — no drivetrain and no
 * `RotationalBundle` function queries the Armor *component* — but it missed
 * the path, because the Armor's state reaches the input code as two bytes on
 * the object rather than through a component lookup:
 *
 *   `SimpleObject+0xed` (destroyed)
 *     `PlayerControlObject::handlePlayerInput` (0x08318920) returns at its
 *     epilogue (0x08318952) **before forwarding input to any child**. Not a
 *     throttle cut and not a steering lock: a wreck receives nothing at all.
 *
 *   `SimpleObject+0xee` (critically damaged)
 *     `RotationalBundle::handlePlayerInput` (0x081d834f) picks the second of
 *     two near-identical duplicated blocks, which multiplies each of the three
 *     input axes by the double at `ds:0x86c8678` = **0.2** (0x081d83af /
 *     0x081d83b7). So a burning tank still traverses — at one fifth the rate.
 *     (An earlier pass read that block as running *only* when the byte is set,
 *     i.e. as an all-or-nothing gate; it is a scale.) The byte is the
 *     message's, `criticalFlagged`, not the float test the bleed uses: a hull
 *     authored at or under its own threshold (DC's `flagkill`) is never sent
 *     `0x14` and so turns at full rate while it burns down (HP-17).
 *
 * Both are **persistent state for the whole wrecked lifetime**, not per-frame
 * edge flags. They are set by the Armor's own status messages and cleared only
 * when the wreck-respawn timer expires — six conditions inside
 * `SimpleObject::handleUpdate` (0x081db2e0), ending in
 * `setHitPoints(getMaxHitPoints())` and a timer reload. So a caller polls this
 * every frame against the live Armor rather than latching it when a shell
 * lands, which also means a vehicle killed some other way — the combat area's
 * own `giveDamage`, drowning, burning down while empty — is gated identically.
 *
 * `null`/an unregistered vehicle is an undamaged one: full input.
 *
 * `out` is an optional caller-owned result object, filled in place and
 * returned. This function is polled every frame by whoever is driving, and a
 * fresh two-field object sixty times a second is a fresh two-field object
 * sixty times a second; `map.html` keeps one and passes it. Omit it and you
 * get a new object, which is what the tests want.
 */
export function inputGate(vehicle, out = { blocked: false, rotationalScale: 1 }) {
  out.blocked = !!vehicle?.destroyed;
  out.rotationalScale = !vehicle ? 1
    : vehicle.destroyed ? 0
      : (vehicle.criticalFlagged ?? vehicle.critical) ? CRITICAL_INPUT_SCALE
        : 1;
  return out;
}

/**
 * The 0.2 a critically damaged vehicle's rotational bundles scale every input
 * axis by — the double at lnxded `ds:0x86c8678`
 * (`9a9999999999c93f`), read as bytes. HP-15.
 */
export const CRITICAL_INPUT_SCALE = 0.2;

/**
 * Every damageable thing in the level, keyed by the collision index's owner id
 * — which is what a hit record names, so a round that lands can be turned into
 * the vehicle it landed on with one lookup.
 */
/** The template a round's kill names: its barrel's stamp (`round-launch.js`,
 *  ledger KILLSTAMP-1), else the hand weapon its group carries. */
export function roundWeapon(record) {
  return record?.stamp?.weapon ?? record?.firerGroup?.weapon ?? null;
}

/**
 * An Armor's own blast and push words as `SimpleObjectTemplate`'s
 * constructor leaves them (lnxded 0x081dbc70): `explosionRadius` 15.0
 * (0x081dbdf4), `explosionDamage` 10.0 (0x081dbdfe), `explosionMaterial` 204
 * (0x081dbe08), `explosionForce` 150.0 (0x081dbe12), `explosionForceMod` 1.0
 * (0x081dc0ac), `explosionForceMax` 300.0 (0x081dc0b2). `setArmorComponent`
 * hands all six to the Armor (0x081ddcba..0x081ddd14). `extract_map.py`
 * `ARMOR_EXPLOSION_DEFAULTS` holds the same six.
 */
export const ARMOR_EXPLOSION_DEFAULTS = Object.freeze({
  explosionRadius: 15, explosionDamage: 10, explosionMaterial: 204,
  explosionForce: 150, explosionForceMod: 1, explosionForceMax: 300,
});

/** `Armor::status` fires the death blast only above this (`ds:0x86c0308`,
 *  0.001f, the compare at 0x08173d6b..0x08173d83). */
export const DEATH_BLAST_DAMAGE_MIN = 0.001;

/**
 * A template's Armor words out of `damage.json`'s `armors` table
 * (`extract_map.py` `armor_explosions`), the constructor's for every word it
 * does not write. Null when the table is absent (a tree published before it,
 * which leaves the death blast and the hull push off rather than guessing) or
 * the template is not in it (it has no Armor).
 */
export function armorExplosion(tables, template) {
  const table = tables?.armors;
  if (!table || typeof template !== 'string') return null;
  const row = table[template.toLowerCase()];
  if (!row) return null;
  const out = { ...ARMOR_EXPLOSION_DEFAULTS };
  for (const key of Object.keys(out)) if (Number.isFinite(row[key])) out[key] = row[key];
  return out;
}

/**
 * The blast record a destroyed Armor's own explosion is, for `applySplash`:
 * `Armor::status`'s destroyed branch (0x08173d89..0x08173df0) calls
 * `GameServer::handleExplosion` with the owner's `getPos` (vt+0x38), the
 * Armor's `explosionRadius` (+0xf8), `explosionMaterial` (+0xfc),
 * `explosionDamage` (+0x100), its last hitter (+0x14) as the attacker, a null
 * source Armor (so nothing is excluded by it), stat id and team -1 (so
 * `calcDamage` never scales it, HP-9c) and `explosionForce` (+0x104). Null
 * when the damage is not above 0.001 or the spec is missing. `at` is the
 * object's origin `[x, y, z]`.
 */
export function deathBlastRecord(spec, at) {
  if (!spec || !(spec.explosionDamage > DEATH_BLAST_DAMAGE_MIN)) return null;
  if (!Array.isArray(at) || !at.every(Number.isFinite)) return null;
  return {
    deathBlast: true,
    point: at.slice(), splashPoint: at.slice(),
    splashRadius: spec.explosionRadius,
    splashMaterial2: Math.trunc(spec.explosionMaterial),
    splashDamage: spec.explosionDamage,
    splashForce: spec.explosionForce,
    firer: null,
  };
}

export class VehicleDamageSet {
  constructor() {
    this.byOwner = new Map();
  }

  /**
   * Register a placed object if it is damageable at all. `extras` is its node's
   * `armor` block; anything without hit points is skipped, which is most of a
   * level — a palm and a sandbag have no Armor (ARM-3).
   */
  add(owner, extras, { name = null, submarineData = null } = {}) {
    if (!extras) return null;
    const max = Number.isFinite(extras.maxHitpoints) ? extras.maxHitpoints
      : extras.hitpoints;
    if (!Number.isFinite(max) || max <= 0) return null;
    const vehicle = new DamageableVehicle(extras, { name, owner, submarineData });
    this.byOwner.set(owner, vehicle);
    return vehicle;
  }

  get(owner) { return this.byOwner.get(owner) ?? null; }
  get size() { return this.byOwner.size; }
  values() { return this.byOwner.values(); }
  clear() { this.byOwner.clear(); }

  /**
   * Apply a `gunfire.js` hit record. `attacker` is the player who fired it.
   * Returns the vehicle and the HP it lost, or null when the round hit
   * something that cannot be damaged (terrain, a building, a tree).
   *
   * `scale(damage, owner)`, when given, is the server's last word on the
   * amount: `calcDamage`'s friendly-fire scaling (`friendly-fire.js`).
   *
   * `amount` is that priced damage, which can exceed the HP `lost`: it is
   * what `_giveDamage` divides by the max HP for the crew's wash (HFD-2).
   */
  applyHit(record, attacker = null, scale = null) {
    if (!record || !(record.damage > 0)) return null;
    const vehicle = this.get(record.owner);
    if (!vehicle || vehicle.destroyed) return null;
    const amount = scale ? scale(record.damage, record.owner) : record.damage;
    if (!(amount > 0)) return null;
    // `originX` is the world's answer for a hull's present x where a world
    // owns this set (`world.js`); without one the place stays what it was.
    const originX = this.originX?.(record.owner);
    if (Number.isFinite(originX) && Number.isFinite(record.point?.[0])) vehicle.noteHitPlace(record.point[0] - originX);
    const lost = vehicle.damage(amount, attacker, { weapon: roundWeapon(record), splash: false });
    return lost > 0 ? { vehicle, lost, amount } : null;
  }

  /**
   * Apply splash HP to every registered vehicle within `radius` of the blast.
   *
   * `targets` is `{ owner, x, y, z, splashMaterial }[]` — the map page supplies
   * world positions because this module stays free of three.js. The firer is
   * skipped. Returns every vehicle that lost HP.
   *
   * Which blast this is came from `effects-core.js`'s `splashSpec` and rode
   * here on the record (HP-9d): an **impact** blast needs `damageType 1` and
   * `hasCollisionEffect`, an **end-of-life** blast needs `damageType` 1 or 4
   * and tests no flag, and a caller that reaches this function has already
   * decided which. The record carries `splashRadius` at whichever of the two
   * radii applies — the truncated integer for an impact, the untruncated one
   * for end of life (0x0831f73e) — so there is nothing left to re-derive
   * here, and in particular nothing is inferred from `material2`, which
   * carries none of it.
   *
   * `record.splashYMod` scales the **Y** term of the distance and nothing else
   * (HP-9, 0x08156613), so a bomb's 2.0 halves its vertical reach. Absent
   * means the engine's own 1.0.
   *
   * **Soldiers.** A target may carry its own `armor` (an `Armor`, not a
   * `DamageableVehicle`) instead of an owner id the set knows about, which is
   * how the man on foot — who is not a registered vehicle and never will be —
   * gets splashed at all. A target marked `soldier: true` also gets HP-10's
   * exposure: `options.exposure(target, blast)` is called for it and the
   * result multiplies the distance falloff, exactly as the engine's
   * `checkForHitOnSoldier` result multiplies it at `0x081566b4`. An exposure
   * of 0 short-circuits the victim (`0x08156ede`) and is not even asked for a
   * damage mod. Everything that is not a soldier keeps exposure 1: there is no
   * occlusion at all for a non-soldier victim, so a tank behind a wall really
   * does take the full falloff.
   *
   * `options.scale(amount, target)`, when given, is `calcDamage`'s
   * friendly-fire scaling, applied last as the engine applies it before it
   * queues the damage (HP-9, HP-9b; `friendly-fire.js`).
   */
  applySplash(record, targets,
              { materials = null, modifiers = null, exposure = null, attacker = null,
                scale = null, wrecks = false } = {}) {
    const material2 = record?.splashMaterial2;
    const radius = record?.splashRadius;
    if (!(Number.isFinite(material2) && material2 >= 0) || !(radius > 0)) {
      return [];
    }
    // `splashPoint` when the record carries one, `point` otherwise. They
    // differ by design on the impact path: the engine centres that explosion
    // 0.1 m off the struck surface along the collision normal
    // (`hitPos + 0.1 * normal`, lnxded 0x08153f5e-0x08153f8f) while playing
    // the collision effect at the raw hit point (0x08153e5b). The end-of-life
    // explosion has no surface and no offset — it stands on the projectile's
    // own position (0x0831f747) — so `detonate` sets no `splashPoint` and
    // this falls through to `point`, which is right.
    const [bx, by, bz] = record.splashPoint || record.point || [];
    if (![bx, by, bz].every(Number.isFinite)) return [];
    const yMod = record.splashYMod;
    const out = [];
    // What the round struck, whose Armor is the blast's source (below): a
    // soldier (`target`, a player id) or a placed object (`owner`).
    const struckSoldier = record.target ?? null;
    const struckOwner = Number.isFinite(record.owner) ? record.owner : -1;
    for (const target of targets) {
      // A soldier carries his own Armor; a placed object is looked up by the
      // collision index's owner id. `target.armor` wins, so a caller can
      // splash anything with hit points without registering it.
      const victim = target.armor ?? this.get(target.owner);
      if (!victim) continue;
      // A wreck is priced and pushed like anything else
      // (`handleExplosionOnObject` 0x08156500 asks no destroyed flag before
      // the push at 0x08156b92), so a caller that pushes hulls (`wrecks`)
      // hears of it, with nothing lost: its Armor has no hit points left.
      const wreck = victim.destroyed && !target.armor;
      if (victim.destroyed && !(wrecks && wreck)) continue;
      // The source Armor (HP-9g): `handleExplosionOnObject` skips the one
      // victim whose own Armor is the explosion's source (0x08156597), and
      // the impact path's source is the Armor of the object the round
      // STRUCK, not the firer's: `handleCollisionForProjectile` walks up
      // from its second object argument (0x08153d3d..0x08153d71, stored at
      // 0x08154552, pushed at 0x08154009), which `SimpleObject::
      // handleCollision` hands it as the other object (0x081daf23). So the
      // hull or the man a round met takes its direct hit and not its blast
      // as well, and the hull that fired it is hurt by its own shell like
      // anything else in reach (a tank firing into a wall at its tracks).
      // The end-of-life blast and a wreck's own pass no source
      // (0x0831f727), which is how your own grenade hurts you.
      if (struckSoldier != null) {
        if (target.soldier && target.playerId === struckSoldier) continue;
      } else if (struckOwner >= 0 && !target.armor && target.owner === struckOwner) continue;
      // Distance to the victim's transform ORIGIN — not a bounding box, not
      // the nearest surface (HP-9) — with only Y scaled.
      const distance = blastDistance(target.x - bx, target.y - by,
                                     target.z - bz, yMod);
      if (distance >= radius) continue;
      const splashMaterial = Number.isFinite(target.splashMaterial)
        ? target.splashMaterial
        : victim.splashMaterial;
      if (!Number.isFinite(splashMaterial)) continue;
      // HP-10, and soldier-only. `handleExplosionOnObject` seeds `edi` with
      // 1.0f at 0x08156505 and only a soldier victim replaces it
      // (0x08156ece); 0.0 short-circuits at 0x08156ede before any damage mod
      // is looked up, which is why this `continue`s rather than multiplying
      // by zero.
      let seen = 1;
      if (target.soldier && exposure) {
        seen = exposure(target, [bx, by, bz]);
        if (!(seen > 0)) continue;
      }
      const raw = splashHp(material2, splashMaterial, distance, radius,
                           materials, modifiers, seen, record.splashDamage);
      const amount = scale ? scale(raw, target) : raw;
      if (!(amount > 0)) continue;
      if (wreck) {
        out.push({ vehicle: victim, target, lost: 0, amount, raw, distance, exposure: seen, wreck: true });
        continue;
      }
      // A soldier's own Armor takes no attacker; a hull records who hit it.
      if (!target.armor) victim.noteHitPlace?.(bx - target.x);
      const lost = target.armor ? victim.damage(amount)
        : victim.damage(amount, attacker, { weapon: roundWeapon(record), splash: true });
      if (lost > 0) {
        // `raw` is what `calcDamage` was asked; a soldier's push is scaled by
        // its answer over it (`knockback.js`, KNOCK-4).
        out.push({ vehicle: victim, target, lost, amount, raw, distance, exposure: seen });
      }
    }
    return out;
  }

  /** Step every vehicle. Returns only those whose drawing needs to change.
   *  `ticks`, when given, collects `{ vehicle, owner, amount }` for every
   *  vehicle whose own damage clocks took HP this step (`update`'s `tick`);
   *  `crews` collects `{ vehicle, owner, amount }` for a crew owed HP for
   *  want of air. `depthOf(owner)` is a hull's `underWater`, 0 when absent;
   *  `upsideDownOwners` the hulls `Armor::update`'s tilt test passes for. */
  update(dt, {
    inWaterOwners = null, upsideDownOwners = null, ticks = null, depthOf = null, crews = null,
    deepWaterOwners = null,
  } = {}) {
    const changes = [];
    for (const [owner, vehicle] of this.byOwner) {
      // A destroyed vehicle with nothing left to announce costs one branch.
      if (vehicle.destroyed && vehicle.deathAnnounced) continue;
      const inWater = inWaterOwners?.has(owner) ?? false;
      const upsideDown = upsideDownOwners?.has(owner) ?? false;
      const depth = vehicle.submarine && depthOf ? depthOf(owner) : 0;
      const deepWater = deepWaterOwners?.has(owner) ?? false;
      const result = vehicle.update(dt, { inWater, upsideDown, depth, deepWater });
      if (result.changed || result.died) changes.push({ vehicle, ...result });
      if (result.tick > 0) ticks?.push({ vehicle, owner, amount: result.tick });
      if (result.crew > 0) crews?.push({ vehicle, owner, amount: result.crew });
    }
    return changes;
  }
}

export { DEATH_EPSILON };
