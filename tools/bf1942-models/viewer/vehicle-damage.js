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

import { Armor, DEATH_EPSILON } from './armor.js';
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
 * `hpLostWhileCriticalDamage`, `hpLostWhileDamageFromWater`,
 * `hpLostWhileUpSideDown`, `damageFromWater`, `effects`.
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
    this.hpLostWhileDamageFromWater =
      Number.isFinite(extras?.hpLostWhileDamageFromWater)
        ? extras.hpLostWhileDamageFromWater : null;
    this.hpLostWhileUpSideDown =
      Number.isFinite(extras?.hpLostWhileUpSideDown)
        ? extras.hpLostWhileUpSideDown : null;
    this.damageFromWater = Boolean(extras?.damageFromWater);
    this.splashMaterial = Number.isFinite(extras?.splashMaterial)
      ? extras.splashMaterial : null;
    this.name = name;
    this.owner = owner;
    /** The tier the caller has been told to draw, or null. */
    this.shown = null;
    /** Seconds accumulated toward the next critical tick (HP-5's `+0xe8`). */
    this.criticalAccumulator = 0;
    /** Seconds accumulated toward the next water-damage tick. */
    this.waterAccumulator = 0;
    /** Seconds accumulated toward the next upside-down tick. */
    this.upsideDownAccumulator = 0;
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

  /** A round landed. `attacker` is the player behind it (an id), if any.
   *  Returns the HP actually lost. */
  damage(amount, attacker = null) {
    if (this.armor.destroyed) return this.armor.damage(amount);
    if (attacker != null) this.lastHitPlayer = attacker;
    const lost = this.armor.damage(amount);
    if (this.armor.destroyed) this.killedBy = attacker ?? null;
    return lost;
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
    this.waterAccumulator = 0;
    this.upsideDownAccumulator = 0;
    this.deathAnnounced = false;
    this.lastHitPlayer = null;
    this.killedBy = null;
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
  update(dt, { inWater = false, upsideDown = false } = {}) {
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

    // Water damage: a flat hpLostWhileDamageFromWater once per whole second,
    // not scaled by dt (HP-5). Only vehicles with `damageFromWater` set take
    // it — boats are excluded (they have a water death tier, not drowning).
    if (!this.armor.destroyed && inWater && this.damageFromWater
        && this.hpLostWhileDamageFromWater !== null) {
      this.waterAccumulator += dt;
      while (this.waterAccumulator >= 1 && !this.armor.destroyed) {
        this.waterAccumulator -= 1;
        this.armor.damage(this.hpLostWhileDamageFromWater);
      }
    } else if (!inWater) {
      this.waterAccumulator = 0;
    }

    // Upside-down damage: same accumulator cadence, independent clock.
    if (!this.armor.destroyed && upsideDown
        && this.hpLostWhileUpSideDown !== null) {
      this.upsideDownAccumulator += dt;
      while (this.upsideDownAccumulator >= 1 && !this.armor.destroyed) {
        this.upsideDownAccumulator -= 1;
        this.armor.damage(this.hpLostWhileUpSideDown);
      }
    } else if (!upsideDown) {
      this.upsideDownAccumulator = 0;
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
 *     i.e. as an all-or-nothing gate; it is a scale.)
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
      : vehicle.critical ? CRITICAL_INPUT_SCALE
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
   * Apply a `gunfire.js` hit record. `attacker` is the player who fired it.
   * Returns the vehicle and the HP it lost, or null when the round hit
   * something that cannot be damaged (terrain, a building, a tree).
   *
   * `scale(damage, owner)`, when given, is the server's last word on the
   * amount: `calcDamage`'s friendly-fire scaling (`friendly-fire.js`).
   */
  applyHit(record, attacker = null, scale = null) {
    if (!record || !(record.damage > 0)) return null;
    const vehicle = this.get(record.owner);
    if (!vehicle || vehicle.destroyed) return null;
    const amount = scale ? scale(record.damage, record.owner) : record.damage;
    if (!(amount > 0)) return null;
    const lost = vehicle.damage(amount, attacker);
    return lost > 0 ? { vehicle, lost } : null;
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
                scale = null } = {}) {
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
    for (const target of targets) {
      // A soldier carries his own Armor; a placed object is looked up by the
      // collision index's owner id. `target.armor` wins, so a caller can
      // splash anything with hit points without registering it.
      const victim = target.armor ?? this.get(target.owner);
      if (!victim || victim.destroyed) continue;
      // The firer is excluded by owner id — but a soldier target has no owner
      // id worth excluding, and the end-of-life blast passes `firer -1`
      // anyway, which is how your own grenade hurts you (`sourceArmor = NULL`
      // at 0x0831f727).
      if (!target.armor && target.owner === record.firer) continue;
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
                           materials, modifiers, seen);
      const amount = scale ? scale(raw, target) : raw;
      if (!(amount > 0)) continue;
      // A soldier's own Armor takes no attacker; a hull records who hit it.
      const lost = target.armor ? victim.damage(amount) : victim.damage(amount, attacker);
      if (lost > 0) {
        out.push({ vehicle: victim, target, lost, distance, exposure: seen });
      }
    }
    return out;
  }

  /** Step every vehicle. Returns only those whose drawing needs to change. */
  update(dt, { inWaterOwners = null } = {}) {
    const changes = [];
    for (const [owner, vehicle] of this.byOwner) {
      // A destroyed vehicle with nothing left to announce costs one branch.
      if (vehicle.destroyed && vehicle.deathAnnounced) continue;
      const inWater = inWaterOwners?.has(owner) ?? false;
      const result = vehicle.update(dt, { inWater });
      if (result.changed || result.died) changes.push({ vehicle, ...result });
    }
    return changes;
  }
}

export { DEATH_EPSILON };
