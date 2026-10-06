// A level's `SupplyDepot` instances: ammo boxes, medical lockers, the land,
// airfield and carrier repair pads, the mobile depots a half-track or a Humvee
// carries for the infantry riding it, and the scripted kill depots a mod hides
// in a level (DC Medina Ridge's `fk1`, `-1000` HP a cycle). One engine class
// behind all of them (`subsystems/supply-depots.md`). Engine ids are ledger
// rows unless a comment says otherwise; the older `SUP-n` numbers some of the
// comments below still carry cite `verify-r3.md`'s claim table, a session doc
// the ledger's SUP rows replaced, and they are kept only where nothing newer
// says more.
//
// Framework-free like `physics.js`/`armor.js`: a depot's position is plain
// `{x,y,z}`, so the whole eligibility/leaky-bucket/dispatch model runs and is
// tested under node with no three.js and no DOM (`tests/test_supply.py`,
// `supply_harness.mjs`). `level-load.js` `collectSupplyDepots` is the only
// place that walks the loaded scene graph for `SupplyDepot` nodes and turns
// them into instances (world position resolved through the scene graph, since
// a depot is usually parented under a Bundle and does not carry its own world
// translation); a depot riding a hull is handed a `locate` callback there that
// reads its node again, so this file never sees a node.
//
// How the engine runs one (ledger SUP-4, SUP-18, SUP-19): every depot keeps its
// own clock of world time and, once 0.5 s has passed, runs one cycle. A cycle
// runs the ammo bucket, then works on every soldier in reach
// (`workOnSoldiers`, `setHealth`'s rate) and every root PlayerControlObject
// in reach (`workOnVehicles`, the `addVehicleType` rows). Ammo and heal both
// run in the cycle, neither starving the other. A hull is repaired by its own
// template's row only, at that row's rate per cycle, whether or not anyone
// is aboard, and `setHealth` never reaches a hull. `SupplyField.update` is
// that pass, made once per world tick (`world-fields.js`).

// SUP-4: the engine only re-evaluates a depot every 0.5s of world time — the
// elapsed seconds since its own last evaluation, not the 1/30s sim tick — and
// no shipped template overrides the default.
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
// SUP-19: an `addVehicleType` reserve of exactly -1 is the unlimited one
// (`repairVehicle` compares against the float -1.0 at `0x086b05ec`).
const UNLIMITED = -1;

/** The four `{gaveAmmo, healed}` answers, shared and frozen so the common
 *  "not due yet" / "nobody in range" case allocates nothing on what is
 *  otherwise a 52-depot-per-frame loop (`features/mesh-viewer-performance
 *  /README.md` rule 5). */
const RESULTS = [
  [Object.freeze({ gaveAmmo: false, healed: false }), Object.freeze({ gaveAmmo: false, healed: true })],
  [Object.freeze({ gaveAmmo: true, healed: false }), Object.freeze({ gaveAmmo: true, healed: true })],
];
const NO_EFFECT = RESULTS[0][0];
const result = (gaveAmmo, healed) => RESULTS[gaveAmmo ? 1 : 0][healed ? 1 : 0];

/** `Armor::heal(float)` with the engine's sign (HP-1): the value is added and
 *  clamped at the max, so a negative rate takes hit points, down to the
 *  death `damage` takes them to. `armor.js` splits the two. */
function healSigned(armor, amount) {
  if (amount > 0) armor.heal(amount);
  else if (amount < 0) armor.damage(-amount);
}

export class SupplyDepot {
  /**
   * @param {{x:number,y:number,z:number}} position world position, already
   *   resolved through the scene graph by the caller.
   * @param {object} data the node's `extras.supply` dict, verbatim.
   * @param {string|null} [name] the node's own name, for diagnostics only.
   * @param {{root?: object|null, locate?: (() => {x:number,y:number,z:number}|null)|null}} [where]
   *   `root`: the object the depot rides (its placed root), an opaque token
   *   compared by identity; `locate`: re-reads the depot's world position,
   *   asked once per cycle, for a depot on a hull that moves.
   */
  constructor(position, data = {}, name = null, { root = null, locate = null } = {}) {
    this.name = name;
    this.x = position.x; this.y = position.y; this.z = position.z;
    this.root = root;
    this.locate = locate;
    this.radius = data.radius ?? DEFAULT_RADIUS;
    this.team = data.team ?? DEFAULT_TEAM;
    this.workOnSoldiers = data.workOnSoldiers === undefined
      ? DEFAULT_WORK_ON_SOLDIERS : !!data.workOnSoldiers;
    this.workOnVehicles = data.workOnVehicles === undefined
      ? DEFAULT_WORK_ON_VEHICLES : !!data.workOnVehicles;

    // setHealth(a1,a2,a3) verbatim: a1 = heal budget (int, -1 = unlimited),
    // a2 = rate (its sign selects heal vs. damage, SUP-11), a3 = unused by
    // any traced consumer. Every shipped heal-capable depot is a1=-1; the
    // finite-budget branch is SUP-10's open half and is not modelled. A
    // soldier's rate only: no hull is ever healed by it (SUP-19).
    const health = data.health || [-1, 0, 0];
    this.healBudget = health[0] ?? -1;
    this.healRate = health[1] ?? 0;

    // addAmmoType rows verbatim, (id, amount, rate, extra). `id` is an opaque
    // `FireArmsTemplate+0x238` tag, not the client's HUD ammo style (SUP-2),
    // so the viewer cannot match it to a held weapon and `amount` (every
    // shipped row is -1, unlimited) is not tracked either. Only `rate` --
    // how often this type has a whole unit ready to give -- governs the
    // leaky bucket `step()` reproduces exactly (SUP-7).
    this.ammoTypes = (data.ammoTypes || []).map(row => ({
      id: row[0], rate: row[2], countdown: 0,
    }));

    // addVehicleType rows verbatim, (template, amount, rate, regen) (SUP-1,
    // SUP-19). `amount` seeds the live reserve and is its cap; -1 is
    // unlimited. `rate` is hit points per cycle, not per second. The name is
    // matched against a hull's root template without regard to case, as
    // `getTemplate` resolves it (`calcStringHashValueNoCase` + `strcasecmp`):
    // DC's Medina Ridge `fk1` writes `m1a1` for the `M1A1` it kills.
    this.vehicleTypes = (data.vehicleTypes || []).map(row => ({
      template: String(row[0]),
      key: String(row[0]).toLowerCase(),
      reserve: row[1] ?? UNLIMITED,
      cap: row[1] ?? UNLIMITED,
      rate: row[2] ?? 0,
      regen: row[3] ?? 0,
    }));

    this._elapsed = 0;  // world seconds accumulated since the last cycle (SUP-4)
    this._cycle = { elapsed: 0, ammoFired: false };
  }

  /** `isHealing()`-adjacent (SUP-12): static per-template capability, not
   *  "did it just heal". A negative `healRate` (a kill trap) is still
   *  "heal-enabled" by the engine's own `+0x152` flag (`rate != 0`), so a
   *  cycle still dispatches into it; the sign flips who benefits. */
  get healEnabled() { return this.healRate !== 0; }
  /** Static capability: this depot has at least one ammo type at all. */
  get ammoEnabled() { return this.ammoTypes.length > 0; }
  /** `isRepairing()` (SUP-13): at least one `addVehicleType` row. */
  get repairEnabled() { return this.vehicleTypes.length > 0; }

  /**
   * SUP-5: team match-or-neutral against *this instance's own* cached team
   * (not a template lookup), inclusive 3-D distance <= radius. `target` is
   * `{x,y,z,team}`; a hull's team is its crew's side, 0 when empty
   * (SEAT-27). A soldier's alive/has-a-body gate is the caller's business.
   */
  inRange(target) {
    if (this.team !== 0 && target.team !== this.team) return false;
    const dx = target.x - this.x, dy = target.y - this.y, dz = target.z - this.z;
    return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }

  /** `inRange` plus the `workOnSoldiers` capability gate. This is also the
   *  un-throttled predicate a HUD icon should track continuously --
   *  `showHealIconInMenu`/`showAmmoIconInMenu` share these same gates with
   *  the give/heal actions but are not paced by the depot's own clock. */
  eligibleForSoldier(target) {
    return this.workOnSoldiers && !target.vehicle && this.inRange(target);
  }

  /** `inRange` plus the `workOnVehicles` capability gate -- the hull
   *  counterpart of `eligibleForSoldier`, on the same team/radius rule.
   *  `target.vehicle` keeps the two kinds apart: a soldier standing beside a
   *  vehicle depot is not a vehicle. */
  eligibleForVehicle(target) {
    return this.workOnVehicles && !!target.vehicle && this.inRange(target);
  }

  /**
   * Advance this depot's clock by `dt` world seconds. Returns null until 0.5 s
   * has accumulated (SUP-4); then runs the cycle's own bookkeeping and
   * returns `{elapsed, ammoFired}` (one object per depot, reused), which
   * `serveSoldier`/`serveVehicle` take for every target the cycle reaches.
   *
   * The bookkeeping is `SupplyDepot::update`'s (`0x08324150`) in its order:
   * the per-ammo-type leaky bucket (SUP-7), whose "ammo enabled this cycle"
   * byte `+0x151` is set only if a type's countdown crosses zero, then, for a
   * `workOnVehicles` depot with vehicle rows, each finite reserve regenerates
   * by `elapsed x regen` up to its cap (`+0x1dc`, `+0x1b8`; SUP-19).
   */
  step(dt) {
    this._elapsed += dt;
    if (this._elapsed < UPDATE_INTERVAL) return null;
    const elapsed = this._elapsed;
    this._elapsed = 0;

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
    if (this.workOnVehicles) {
      for (const type of this.vehicleTypes) {
        if (type.reserve === UNLIMITED) continue;
        type.reserve = Math.min(type.reserve + elapsed * type.regen, type.cap);
      }
    }
    if (this.locate) {
      const at = this.locate();
      if (at) { this.x = at.x; this.y = at.y; this.z = at.z; }
    }
    const cycle = this._cycle;
    cycle.elapsed = elapsed;
    cycle.ammoFired = ammoFired;
    return cycle;
  }

  /**
   * One cycle's work on one soldier (`workOnSoldiers` `0x08323dc0`, SUP-18):
   * `target` is `{x,y,z,team,armor,refillAmmo, root?}`. A seated soldier
   * (`root`: the hull he sits in) is served only by a depot riding that same
   * hull -- the half-track's passengers by its own locker -- and an on-foot
   * one by any depot in reach (SUP-20). The ammo and the heal both run: the
   * ammo when a type's bucket fired this cycle, the heal whenever the rate
   * is non-zero, by `rate x elapsed` (the unlimited branch of SUP-10;
   * positive heals, negative damages, SUP-11).
   *
   * The ammo itself is an approximation: `FireArms::reloadAmmo`'s
   * per-magazine fill is SUP-8's open half and the ammo id cannot be matched
   * to a held weapon (SUP-2), so `refillAmmo` tops the held weapon off in
   * full.
   */
  serveSoldier(target, cycle) {
    if (!this.eligibleForSoldier(target)) return NO_EFFECT;
    if (target.root && target.root !== this.root) return NO_EFFECT;
    const gaveAmmo = cycle.ammoFired;
    if (gaveAmmo && typeof target.refillAmmo === 'function') target.refillAmmo();
    let healed = false;
    if (this.healEnabled) {
      // `applyDamage`'s sign is the inverse of the rate's.
      if (target.armor) target.armor.applyDamage(-(this.healRate * cycle.elapsed));
      healed = this.healRate > 0;
    }
    return result(gaveAmmo, healed);
  }

  /**
   * One cycle's work on one hull (`workOnVehicles` `0x08323f10`, SUP-19):
   * `hull` is `{x,y,z,team,template,armor,refillAmmo, vehicle: true}`, a root
   * PlayerControlObject, crewed or not. Its guns are rearmed when an ammo
   * type fired this cycle (the same full-refill approximation as a
   * soldier's), and it is repaired by `repair`. `healed` reports a positive
   * repair row matched, the way a soldier's reports a positive rate.
   */
  serveVehicle(hull, cycle) {
    if (!this.eligibleForVehicle(hull)) return NO_EFFECT;
    const gaveAmmo = cycle.ammoFired;
    if (gaveAmmo && typeof hull.refillAmmo === 'function') hull.refillAmmo();
    const healed = this.repairEnabled && hull.armor ? this.repair(hull) > 0 : false;
    return result(gaveAmmo, healed);
  }

  /**
   * `SupplyDepot::repairVehicle` (`0x08323ba0`, SUP-19): the first
   * `addVehicleType` row naming the hull's root template; none, nothing.
   * Unlimited (reserve -1): `Armor::heal(rate)`, the row's rate as it
   * stands, once per cycle. Finite: the heal is the smaller of the reserve
   * and the rate, and the reserve pays for it, but never more than the hit
   * points the hull was missing. Returns the signed amount handed to the
   * Armor, 0 when no row matched.
   */
  repair(hull) {
    const key = hull.template ? String(hull.template).toLowerCase() : null;
    if (!key) return 0;
    let type = null;
    for (const row of this.vehicleTypes) {
      if (row.key === key) { type = row; break; }
    }
    if (!type) return 0;
    const armor = hull.armor;
    let amount = type.rate;
    if (type.reserve !== UNLIMITED) {
      amount = type.reserve > type.rate ? type.rate : type.reserve;
      const missing = armor.maxHitPoints - armor.hitPoints;
      type.reserve -= amount - missing >= 0 ? missing : amount;
    }
    healSigned(armor, amount);
    return amount;
  }

  /**
   * `step` and one serve, for a caller with one target: `target.vehicle`
   * picks the hull's work over the soldier's. Returns `{gaveAmmo, healed}`;
   * both false on a call that has not crossed 0.5 s, or when the target is
   * out of reach. Two targets ticked through this share one clock between
   * them, which is why the world uses `SupplyField.update` instead.
   */
  tick(dt, target) {
    const cycle = this.step(dt);
    if (!cycle) return NO_EFFECT;
    return target.vehicle ? this.serveVehicle(target, cycle) : this.serveSoldier(target, cycle);
  }
}

/** Fold one serve's answer into a target's running `{gaveAmmo, healed}`. */
function merge(into, r) {
  if (r.gaveAmmo) into.gaveAmmo = true;
  if (r.healed) into.healed = true;
}

/** A level's whole set of depots, ticked and queried together so the world's
 *  per-tick code stays a couple of calls. */
export class SupplyField {
  constructor(depots = []) {
    this.depots = depots;
    // Mutated and returned in place rather than allocated fresh every call
    // (features/mesh-viewer-performance/README.md rule 5): `tick` is a
    // per-tick call for a caller with a single target.
    this._result = { gaveAmmo: false, healed: false };
  }

  /**
   * The world's one depot pass of a tick. Every depot's clock advances by
   * `dt`; each depot whose cycle comes due works on every soldier and every
   * hull it reaches, in the engine's order (soldiers, then hulls).
   *
   * `targets` is `{soldiers(), hulls()}`, each returning an array asked for
   * at most once a pass and only when a cycle came due (a tick nobody's
   * depot fires builds nothing). A target carries `results`: the
   * `{gaveAmmo, healed}` objects to fold its answer into (a hull's are its
   * crew's). `suspended(depot)`, when given, says the depot's own hull is
   * destroyed, which stops it (`update` returns before anything when the
   * nearest Armor above the depot `isDestroyed`, `0x083241c9`).
   */
  update(dt, targets, suspended = null) {
    let soldiers = null, hulls = null;
    for (const depot of this.depots) {
      const cycle = depot.step(dt);
      if (!cycle || suspended?.(depot)) continue;
      if (depot.workOnSoldiers) {
        soldiers ??= targets.soldiers();
        for (const s of soldiers) {
          const r = depot.serveSoldier(s, cycle);
          if (r !== NO_EFFECT) for (const into of s.results) merge(into, r);
        }
      }
      if (depot.workOnVehicles) {
        hulls ??= targets.hulls();
        for (const h of hulls) {
          const r = depot.serveVehicle(h, cycle);
          if (r !== NO_EFFECT) for (const into of h.results) merge(into, r);
        }
      }
    }
  }

  /** `SupplyDepot.tick` against every depot for one target, folded into one
   *  `{gaveAmmo, healed}` -- a caller that keeps a reference across two
   *  calls sees it change, by design; read it before the next `tick()`. */
  tick(dt, target) {
    const out = this._result;
    out.gaveAmmo = false;
    out.healed = false;
    for (const depot of this.depots) merge(out, depot.tick(dt, target));
    return out;
  }

  /** `ShowReloadIcon` (`showAmmoIconInMenu`): is any depot in range, right
   *  now, that could give this target ammo. Un-throttled -- checked every
   *  frame, unlike the give action's own 0.5s pacing. */
  canRearm(target) {
    return this.depots.some(d => d.ammoEnabled
      && (target.vehicle ? d.eligibleForVehicle(target) : d.eligibleForSoldier(target)));
  }

  /** `ShowHealIcon` (`showHealIconInMenu`). Gated on `healRate > 0` (would
   *  actually help, not merely "non-zero") rather than `healEnabled` alone:
   *  whether the real icon also excludes a damage-sign depot is not settled.
   *  A hull asks for a positive row of its own template. */
  canHeal(target) {
    if (target.vehicle) {
      const key = target.template ? String(target.template).toLowerCase() : null;
      return !!key && this.depots.some(d => d.eligibleForVehicle(target)
        && d.vehicleTypes.some(t => t.key === key && t.rate > 0));
    }
    return this.depots.some(d => d.healRate > 0 && d.eligibleForSoldier(target));
  }

  /** The closest depot to `target` and its straight-line distance, or null.
   *  Not read by any game-logic path -- a convenience for tests and the
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
