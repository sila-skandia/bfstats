// What a shot does to a vehicle: hit points, the tier it smokes or burns at,
// the per-second loss once it is critical, and death.
//
// The engine side is settled in `features/bf1942-engine-reference/` — ledger
// rows HP-1/HP-2/HP-5 and ARM-1/ARM-2, and
// `subsystems/hitpoints-and-damage.md` §8. The two findings that shape this
// file:
//
//   - **A collision never costs hit points** (HP-6). Nothing here is driven by
//     an impact against terrain or a wall; only a projectile damages anything.
//     Do not add a crash-damage path — the engine has none.
//   - **A living object re-evaluates its effect tier every tick** (ARM-1). The
//     `Armor+0x128` byte the engine keeps is a *death* latch, not a first-run
//     latch, so there is no once-per-lifetime behaviour to reproduce: poll, and
//     stop polling when it dies.
//
// Framework-free, like `armor.js`, `physics.js` and `collision.js` — no
// three.js, no DOM — so `tests/vehicle_damage_harness.mjs` runs the real thing
// under plain node. The caller owns every scene concern: where an effect is
// drawn, what a wreck looks like, who is allowed to climb in.

import { Armor, DEATH_EPSILON } from './armor.js';

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
 * OPEN, and worth knowing before trusting this on a mod: the engine reaches the
 * same answer through an `std::map<int,DamageEffects*>` keyed by threshold
 * (ARM-1), and the two agents who read `Armor::getEffect` both described the
 * lookup as "nearest threshold below" — which, taken literally, would make a
 * full-health Sherman smoke, because 50 is the nearest key below 100. That
 * cannot be what the game does, so this implements the rule that matches
 * observed play and the authored data. Whether the engine gets there by
 * `lower_bound` on the live HP or by some other arrangement was never pinned
 * down; if a mod's tiers ever look inverted, this is the assumption to re-read.
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
 * The death tier's effects: `0` normally, `-1` when the vehicle died in water
 * and authored a water tier. Returns null when neither is declared.
 */
export function deathTier(effects, { inWater = false } = {}) {
  if (!effects || !effects.length) return null;
  if (inWater) {
    const names = namesAt(effects, TIER_WATER_DEATH);
    if (names.length) return { threshold: TIER_WATER_DEATH, names };
  }
  const names = namesAt(effects, TIER_DEATH);
  return names.length ? { threshold: TIER_DEATH, names } : null;
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
 * `hpLostWhileCriticalDamage`, `effects`.
 */
export class DamageableVehicle {
  constructor(extras, { name = null, owner = -1 } = {}) {
    const max = Number.isFinite(extras?.maxHitpoints) ? extras.maxHitpoints
      : (Number.isFinite(extras?.hitpoints) ? extras.hitpoints : 0);
    const start = Number.isFinite(extras?.hitpoints) ? extras.hitpoints : max;
    this.armor = new Armor(max, start);
    this.effects = Array.isArray(extras?.effects) ? extras.effects : [];
    this.criticalDamage = Number.isFinite(extras?.criticalDamage)
      ? extras.criticalDamage : null;
    this.hpLostWhileCriticalDamage =
      Number.isFinite(extras?.hpLostWhileCriticalDamage)
        ? extras.hpLostWhileCriticalDamage : null;
    this.name = name;
    this.owner = owner;
    /** The tier the caller has been told to draw, or null. */
    this.shown = null;
    /** Seconds accumulated toward the next critical tick (HP-5's `+0xe8`). */
    this.criticalAccumulator = 0;
    /** Set once the caller has been handed the death tier, so it fires once. */
    this.deathAnnounced = false;
  }

  get hitPoints() { return this.armor.hitPoints; }
  get maxHitPoints() { return this.armor.maxHitPoints; }
  get destroyed() { return this.armor.destroyed; }

  /**
   * Is this vehicle critically damaged — the state the engine broadcasts as
   * message `0x15` and the state its fire tier is authored to coincide with
   * (ARM-2: 10 of 10 sampled vanilla vehicles put the fire tier at exactly
   * `criticalDamage`)?
   */
  get critical() {
    return this.criticalDamage !== null
      && this.armor.hitPoints <= this.criticalDamage;
  }

  /** A round landed. Returns the HP actually lost. */
  damage(amount) {
    return this.armor.damage(amount);
  }

  /** A depot or a repair tool. Returns the HP actually restored. */
  heal(amount) {
    return this.armor.heal(amount);
  }

  /** Pad respawn: full HP, clear death latch, no burn smoke until damaged again. */
  reset() {
    this.armor.reset();
    this.shown = null;
    this.criticalAccumulator = 0;
    this.deathAnnounced = false;
  }

  /**
   * One simulation step. Runs the critical-damage burn — `Armor::update`'s
   * accumulator, which fires a flat `hpLostWhileCriticalDamage` once per whole
   * second and is **not** scaled by `dt` (HP-5) — and reports what the caller
   * should now be drawing.
   *
   * Returns `{ tier, changed, died }`: `tier` is what to draw (the death tier
   * once it is dead), `changed` is true only on the step the answer moved, and
   * `died` is true on the one step the caller is first told about death.
   *
   * `died` deliberately means "newly dead *as far as the caller knows*", not
   * "died inside this call" — a round that kills the vehicle does so through
   * `damage()`, outside any `update`, so a flag scoped to this call would never
   * fire for the one case that matters and the explosion would never play.
   */
  update(dt, { inWater = false } = {}) {
    if (!this.armor.destroyed && this.critical
        && this.hpLostWhileCriticalDamage !== null) {
      this.criticalAccumulator += dt;
      // A long frame does not burn more; it checks in less often. Drain whole
      // seconds so a 2 s hitch costs two ticks rather than one.
      while (this.criticalAccumulator >= 1 && !this.armor.destroyed) {
        this.criticalAccumulator -= 1;
        this.armor.damage(this.hpLostWhileCriticalDamage);
      }
    } else if (!this.critical) {
      // Recovered above the threshold: the next burn starts its second over.
      this.criticalAccumulator = 0;
    }

    const died = this.armor.destroyed && !this.deathAnnounced;
    const tier = this.armor.destroyed
      ? deathTier(this.effects, { inWater })
      : activeTier(this.effects, this.armor.hitPoints);

    // A destroyed vehicle's tier is announced once and then frozen — which is
    // the one thing the engine's `+0x128` latch actually buys, reproduced here
    // by not asking again rather than by keeping a latch.
    if (this.armor.destroyed && this.deathAnnounced) {
      return { tier: this.shown, changed: false, died };
    }

    const changed = tierKey(tier) !== tierKey(this.shown);
    if (changed) this.shown = tier;
    if (this.armor.destroyed) this.deathAnnounced = true;
    return { tier, changed, died };
  }
}

/** Identity for a tier, so "same threshold, same names" is one comparison. */
function tierKey(tier) {
  return tier ? `${tier.threshold}:${tier.names.join(',')}` : '';
}

/**
 * Every damageable thing in the level, keyed by the collision index's owner id
 * — which is what a hit record names, so a round that lands can be turned into
 * the vehicle it landed on with one lookup.
 */
export class VehicleDamageSet {
  constructor() {
    this.byOwner = new Map();
  }

  /**
   * Register a placed object if it is damageable at all. `extras` is its node's
   * `armor` block; anything without hit points is skipped, which is most of a
   * level — a palm and a sandbag have no Armor (ARM-3).
   */
  add(owner, extras, { name = null } = {}) {
    if (!extras) return null;
    const max = Number.isFinite(extras.maxHitpoints) ? extras.maxHitpoints
      : extras.hitpoints;
    if (!Number.isFinite(max) || max <= 0) return null;
    const vehicle = new DamageableVehicle(extras, { name, owner });
    this.byOwner.set(owner, vehicle);
    return vehicle;
  }

  get(owner) { return this.byOwner.get(owner) ?? null; }
  get size() { return this.byOwner.size; }
  values() { return this.byOwner.values(); }
  clear() { this.byOwner.clear(); }

  /**
   * Apply a `gunfire.js` hit record. Returns the vehicle and the HP it lost, or
   * null when the round hit something that cannot be damaged (terrain, a
   * building, a tree).
   */
  applyHit(record) {
    if (!record || !(record.damage > 0)) return null;
    const vehicle = this.get(record.owner);
    if (!vehicle || vehicle.destroyed) return null;
    const lost = vehicle.damage(record.damage);
    return lost > 0 ? { vehicle, lost } : null;
  }

  /** Step every vehicle. Returns only those whose drawing needs to change. */
  update(dt) {
    const changes = [];
    for (const vehicle of this.byOwner.values()) {
      // A destroyed vehicle with nothing left to announce costs one branch.
      if (vehicle.destroyed && vehicle.deathAnnounced) continue;
      const result = vehicle.update(dt);
      if (result.changed || result.died) changes.push({ vehicle, ...result });
    }
    return changes;
  }
}

export { DEATH_EPSILON };
