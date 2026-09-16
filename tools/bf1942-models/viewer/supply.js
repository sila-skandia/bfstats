// Wake's `SupplyDepot` instances: ammo boxes, medical lockers, and the mobile
// depot an M3A1 half-track carries for the infantry riding it. Every rule
// below is `verify-r3.md`'s `## Corrected report`; the `SUP-n` ids cite that
// file's claim table, not this round's own guess.
//
// Framework-free like `physics.js`/`armor.js`: a depot's position is plain
// `{x,y,z}`, so the whole eligibility/leaky-bucket/dispatch model runs and is
// tested under node with no three.js and no DOM (`tests/test_supply.py`,
// `supply_harness.mjs`). `map.html` is the only place that walks the loaded
// scene graph for `userData.templateKind === 'SupplyDepot'` nodes and turns
// them into `SupplyDepot` instances (world position resolved through the
// scene graph, since a depot is usually parented under a Bundle and does not
// carry its own world translation) — that glue is a few lines there and
// nowhere in this file.
//
// Scope: `workOnSoldiers` only. Wake ships two depots whose `workOnVehicles`
// is also set (`AmmoboxVehicleSupplyDepot`, `M3A1VehicleSupplyDepot`,
// `ShokakuAirplaneSupplyDepot`, `AlliedAirplaneSupplyDepot`) but vehicle
// repair/rearm is out of scope this round (P2/P4 own vehicle Armor and entry;
// see the feature doc's Open section) — `eligibleForSoldier` and `tick` both
// gate on `workOnSoldiers`, so a vehicle-only depot simply never fires here.

// SUP-11/SUP-12: the engine only re-evaluates a depot every 0.5s of real
// (wall-clock) time — the elapsed seconds since its own last evaluation, not
// the 1/30s sim tick — and no shipped Wake template overrides the default.
export const UPDATE_INTERVAL = 0.5;

// SUP-16: 0 = both teams / neutral (always eligible), 1 = Axis, 2 = Allied.
const DEFAULT_TEAM = 0;
// SUP-1: `SupplyDepotTemplate`'s own ctor defaults for a word a `.con` chain
// never set. The extractor only emits keys a chain actually assigned, so a
// depot missing these three (Wake's `M3A1SupplyDepot` ships no `team` at
// all, and neither M3A1 depot states `workOnSoldiers`/`workOnVehicles`) gets
// them here rather than reading as "false" by JS's own default-undefined.
const DEFAULT_RADIUS = 2.0;
const DEFAULT_WORK_ON_SOLDIERS = true;   // template+0x141 default byte 1
const DEFAULT_WORK_ON_VEHICLES = false;  // template+0x140 default byte 0

/** A `{gaveAmmo, healed}` result that changed nothing — shared and frozen so
 *  the common "not due yet" / "nobody in range" case allocates nothing on
 *  what is otherwise a 52-depot-per-frame loop (`features/mesh-viewer-performance
 *  /README.md` rule 5). */
const NO_EFFECT = Object.freeze({ gaveAmmo: false, healed: false });

export class SupplyDepot {
  /**
   * @param {{x:number,y:number,z:number}} position world position, already
   *   resolved through the scene graph by the caller.
   * @param {object} data the node's `extras.supply` dict, verbatim.
   * @param {string|null} [name] the node's own name, for diagnostics only.
   */
  constructor(position, data = {}, name = null) {
    this.name = name;
    this.x = position.x; this.y = position.y; this.z = position.z;
    this.radius = data.radius ?? DEFAULT_RADIUS;
    this.team = data.team ?? DEFAULT_TEAM;
    this.workOnSoldiers = data.workOnSoldiers === undefined
      ? DEFAULT_WORK_ON_SOLDIERS : !!data.workOnSoldiers;
    this.workOnVehicles = data.workOnVehicles === undefined
      ? DEFAULT_WORK_ON_VEHICLES : !!data.workOnVehicles;

    // setHealth(a1,a2,a3) verbatim (SUP-2): a1 = heal budget (int, -1 =
    // unlimited), a2 = rate (its sign selects heal vs. damage, SUP-26), a3 =
    // unused by any traced consumer. Every Wake heal-capable depot ships
    // a1=-1 (unlimited); the finite-budget branch's exact arithmetic is
    // downgraded/unresolved in verify-r3.md (SUP-10/SUP-25) and unreached
    // here, so it is not modelled — see `tick()`.
    const health = data.health || [-1, 0, 0];
    this.healBudget = health[0] ?? -1;
    this.healRate = health[1] ?? 0;

    // addAmmoType rows verbatim, (id, amount, rate, extra) (SUP-3). `id` is
    // an opaque `FireArmsTemplate+0x238` tag, not the client's ATxxx HUD
    // style (SUP-8) — the viewer has no mapping from it to a held weapon, so
    // `amount` (reserve; every Wake row ships -1, unlimited) is not tracked
    // either. Only `rate` — how often this type has a whole unit ready to
    // give — governs the leaky-bucket pacing `tick()` reproduces exactly
    // (SUP-21); what happens once it fires is this viewer's own
    // approximation (see `tick()`'s comment), per verify-r3.md's own
    // "Viewer recipe" point 3.
    this.ammoTypes = (data.ammoTypes || []).map(row => ({
      id: row[0], rate: row[2], countdown: 0,
    }));

    this._elapsed = 0;  // real seconds accumulated since the last tick fired (SUP-11)
  }

  /** `isHealing()`-adjacent (SUP-19/SUP-27): static per-template capability,
   *  not "did it just heal". A negative `healRate` (an FH-style kill trap;
   *  no Wake depot has one) is still "heal-enabled" by the engine's own
   *  `+0x152` flag (`rate != 0`) — `tick()` still dispatches into it, the
   *  sign just flips who benefits. */
  get healEnabled() { return this.healRate !== 0; }
  /** Static capability: this depot has at least one ammo type at all. */
  get ammoEnabled() { return this.ammoTypes.length > 0; }

  /**
   * SUP-15/SUP-33: team match-or-neutral against *this instance's own*
   * cached team (not a template lookup — SUP-33's correction), inclusive
   * 3-D distance <= radius. `target` is `{x,y,z,team}`; a soldier's
   * alive/has-a-body gate is the caller's business (this file has no concept
   * of a soldier at all, only positions).
   */
  inRange(target) {
    if (this.team !== 0 && target.team !== this.team) return false;
    const dx = target.x - this.x, dy = target.y - this.y, dz = target.z - this.z;
    return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }

  /** `inRange` plus the `workOnSoldiers` capability gate (SUP-18). This is
   *  also the un-throttled predicate a HUD icon should track continuously —
   *  `showHealIconInMenu`/`showAmmoIconInMenu` share these same gates with
   *  the give/heal actions but are not, themselves, paced by the depot's own
   *  0.5s clock (SUP-33/34). */
  eligibleForSoldier(target) {
    return this.workOnSoldiers && this.inRange(target);
  }

  /**
   * Advance this depot's own real-time clock by `dt` seconds and, once 0.5s
   * has accumulated (SUP-11), run one give/heal cycle against `target`
   * (`{x,y,z,team,armor,refillAmmo}` — `armor` an `armor.js` `Armor`
   * instance, `refillAmmo` a zero-arg callback). Returns `{gaveAmmo,
   * healed}`; both false on a cycle that has not crossed 0.5s yet, or when
   * `target` is out of range or the wrong team.
   *
   * SUP-18's dispatch is a priority if/else, not "do both": ammo firing this
   * cycle takes priority over heal. A depot with both capabilities (Wake's
   * `M3A1SupplyDepot`: three ammo types up to 15/s, plus a heal rate) only
   * ever reaches the heal branch on a cycle none of its ammo types fired —
   * at a 15/s pace against a 0.5s check, that is close to never. That
   * starving is the engine's own behaviour (SUP-18/SUP-19), not a bug here.
   */
  tick(dt, target) {
    this._elapsed += dt;
    if (this._elapsed < UPDATE_INTERVAL) return NO_EFFECT;
    const elapsed = this._elapsed;
    this._elapsed = 0;

    // SUP-21: per-ammo-type leaky bucket, instruction-traced in verify-r3.md
    // and reproduced exactly for the pacing half (the reserve/regen-clamp
    // half is moot here — see the constructor comment). `+0x151` ("ammo
    // enabled this cycle") is reset every update and set only if at least
    // one type's countdown crosses zero (SUP-19).
    let ammoFired = false;
    for (const type of this.ammoTypes) {
      type.countdown -= elapsed;
      if (type.countdown < 0) {
        const units = Math.trunc(-type.countdown * type.rate);
        if (units > 0) {
          type.countdown += units / type.rate;
          ammoFired = true;
        }
      }
    }

    if (!this.eligibleForSoldier(target)) return NO_EFFECT;

    if (ammoFired) {
      // SUP-22/23 (downgraded in verify-r3.md): `FireArms::reloadAmmo`'s
      // real per-magazine mechanics are materially more complex than "give
      // one magazine" (magazine 0 excluded, overflow cascades, a confirmed
      // 0-return path) and were not fully re-derived; combined with SUP-8's
      // opaque ammo-type id, the viewer cannot match a depot's ammo type to
      // a specific held weapon. Approximation, exactly verify-r3.md's own
      // "Viewer recipe" point 3: top the held weapon off in full on this one
      // call, rather than modelling per-magazine fill. Open question this
      // stands on: SUP-23.
      if (typeof target.refillAmmo === 'function') target.refillAmmo();
      return { gaveAmmo: true, healed: false };
    }
    if (this.healEnabled) {
      // SUP-25, the unlimited branch (`healBudget === -1`) — the only one
      // any Wake depot's own data reaches: heal/damage by exactly
      // `rate x elapsed`, `applyDamage`'s sign convention being the inverse
      // of `rate`'s own (SUP-26: positive rate heals, negative damages).
      const amount = -(this.healRate * elapsed);
      if (target.armor) target.armor.applyDamage(amount);
      return { gaveAmmo: false, healed: this.healRate > 0 };
    }
    return NO_EFFECT;
  }
}

/** A level's whole set of depots, ticked and queried together so `map.html`'s
 *  per-frame code stays a couple of calls. */
export class SupplyField {
  constructor(depots = []) {
    this.depots = depots;
    // Mutated and returned in place rather than allocated fresh every call
    // (features/mesh-viewer-performance/README.md rule 5) — `onFoot` calls
    // `tick` unconditionally every frame, so a literal here would be exactly
    // the per-frame allocation rule 5 exists to catch, for a summary its one
    // caller does not even read (the HUD icon vars come from `canHeal`/
    // `canRearm` below instead, since those are continuous, not throttled).
    this._result = { gaveAmmo: false, healed: false };
  }

  /** `SupplyDepot.tick` against every depot, folded into one `{gaveAmmo,
   *  healed}` for the frame — a caller that keeps a reference across two
   *  calls sees it change, by design; read it before the next `tick()`. */
  tick(dt, target) {
    const result = this._result;
    result.gaveAmmo = false;
    result.healed = false;
    for (const depot of this.depots) {
      const r = depot.tick(dt, target);
      if (r.gaveAmmo) result.gaveAmmo = true;
      if (r.healed) result.healed = true;
    }
    return result;
  }

  /** `ShowReloadIcon` (SUP-34/showAmmoIconInMenu): is any depot in range,
   *  right now, that could give this target ammo. Un-throttled — checked
   *  every frame, unlike the give action's own 0.5s pacing. */
  canRearm(target) {
    return this.depots.some(d => d.ammoEnabled && d.eligibleForSoldier(target));
  }

  /** `ShowHealIcon` (SUP-33/showHealIconInMenu). Gated on `healRate > 0`
   *  (would actually help, not merely "non-zero") rather than `healEnabled`
   *  alone: whether the real icon also excludes a damage-sign depot is not
   *  settled by verify-r3.md (SUP-34's full body was not traced) — no Wake
   *  depot has a negative rate, so this choice does not change Wake's
   *  behaviour, only a mod's. */
  canHeal(target) {
    return this.depots.some(d => d.healRate > 0 && d.eligibleForSoldier(target));
  }

  /** The closest depot to `target` and its straight-line distance, or null.
   *  Not read by any game-logic path — a convenience for tests and the
   *  `window.__supply()` hook. */
  nearest(target) {
    let best = null, bestDistSq = Infinity;
    for (const d of this.depots) {
      const dx = d.x - target.x, dy = d.y - target.y, dz = d.z - target.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < bestDistSq) { bestDistSq = distSq; best = d; }
    }
    return best ? { depot: best, distance: Math.sqrt(bestDistSq) } : null;
  }
}
