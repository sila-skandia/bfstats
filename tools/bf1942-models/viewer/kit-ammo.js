// The soldier's ammunition, per kit item, for the life of the soldier.
//
// In the engine every kit item is its own `FireArms` and the counts live on
// it — `magSize` rounds in the loaded magazine, `numOfMag` magazines carried,
// the round count of the one in hand — for as long as the soldier does.
// Raising another item (`selectItem`) changes which `FireArms` is active; it
// does not touch the one put away, so a pouch thrown empty is still empty
// when the "4" key brings it back. Only two things ever put rounds back:
// a spawn (a new soldier is a new kit, full) and a `SupplyDepot`'s
// `reloadAmmo` (`supply.js`). A kit picked up off the ground replaces the
// lot with the counts its last owner left (`adopt`, `kit-drops.js`).
//
// `map.html` used to mint the counts on the viewmodel rig instead — every
// `loadHandWeapon` started a full magazine — so a slot switch away and back
// was a free resupply (three grenades, then three more, then three more).
// The rig is a presentation object and is destroyed on every switch; the
// counts belong here, keyed by item template, owned by the kit.
//
// The item's heat lives here too (`itemHeat`), for the same reason.
//
// No DOM and no three.js: `tests/kit_ammo_harness.mjs` drives this under
// plain node.

import { FireState } from './fire-state.js';

/** Rounds a full magazine holds. A negative `magSize` is the engine's
 *  unlimited ammo (the knife's -1), read as Infinity so a trigger gate and a
 *  reload check can compare it plainly. No magazine at all (a bare weapon
 *  without stats) is unlimited too, which is what the page always did. */
export function magazineSize(magazine) {
  if (!magazine) return Infinity;
  return magazine.size >= 0 ? magazine.size : Infinity;
}

/** Spare magazines carried beside the loaded one. `magazines` (`numOfMag`)
 *  counts the total, the way the HUD's spare box does, so a `numOfMag 1`
 *  grenade pouch has none spare and a `numOfMag 5` Thompson has four. */
export function spareMagazines(magazine) {
  if (!magazine) return 0;
  return Math.max((magazine.magazines ?? 1) - 1, 0);
}

/** One item's counts. `rounds` is the loaded magazine, `mags` the spares;
 *  `size` and `spares` are what a full one holds, kept beside the live
 *  counts so a refill needs no second look at the weapon data. */
export class AmmoEntry {
  constructor(name, magazine) {
    this.name = name;
    this.size = magazineSize(magazine);
    this.spares = spareMagazines(magazine);
    this.rounds = this.size;
    this.mags = this.spares;
    // The item's heat, a `FireState` over its heat words, built the first
    // time the item is raised (`itemHeat`); null for a
    // weapon with none. A depot gives rounds, not a cold barrel, so `refill`
    // leaves it; a new life is a new entry, and so is a kit picked up off the
    // ground (`adopt`), which comes up cold.
    this.heat = null;
  }

  /** Nothing to give: the engine's depot ticks every half second for as
   *  long as the soldier stands on it, and a soldier owed nothing hears no
   *  give sound. */
  get full() {
    return this.rounds >= this.size && this.mags >= this.spares;
  }

  /** Back to a spawn loadout. True if anything changed. */
  refill() {
    if (this.full) return false;
    this.rounds = this.size;
    this.mags = this.spares;
    return true;
  }
}

/**
 * An item's heat (ledger GUN-14, GUN-15): the M249's and the PKM's
 * `heatAddWhenFire`, `coolDownPerSec` and `timeDelayOnOverHeat`, under the law
 * the vehicle guns already run (`fire-state.js` `FireState`, built over the
 * heat words alone, so its magazine half is unlimited and the entry keeps the
 * rounds). Built once per `entry`, so it lasts the life the counts do: the
 * heat is a field of the item's own FireArms, which a holster and a raise
 * leave as they were (`HandFireArms::disable` / `enable`), so a hot gun
 * swapped away comes back hot. `data` is the weapon's block (`hw.data`), whose
 * `heat` carries the words. A weapon with none gets null, and so does a thrown
 * one: `velocityDependentOnHeat` makes the same field the throw's charge,
 * which the pull resets and nothing overheats.
 */
export function itemHeat(entry, data) {
  const words = data?.heat;
  if (!entry || !(words?.heatAddWhenFire > 0) || words.velocityDependentOnHeat) return null;
  entry.heat ??= new FireState({ ...words, roundOfFire: data.roundOfFire });
  return entry.heat;
}

/** The whole kit's ammunition, keyed by item template. Case-insensitive,
 *  because the kit files and the weapons' own `create` lines disagree on
 *  casing and the same item must land on the same entry either way. */
export class KitAmmo {
  #entries = new Map();

  static key(name) {
    return String(name || '').toLowerCase();
  }

  /** A new life: a new kit, nothing carried over. */
  reset() {
    this.#entries.clear();
  }

  /** The counts for `name`, created full from `magazine` the first time the
   *  item is raised — the engine's own inventory is full at spawn, and an
   *  item never raised is one whose counts nobody has read yet. */
  entry(name, magazine) {
    const key = KitAmmo.key(name);
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = new AmmoEntry(name, magazine);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  /** The counts for an item that may never have been raised: null then. */
  peek(name) {
    return this.#entries.get(KitAmmo.key(name)) ?? null;
  }

  /** A kit picked up off the ground: its items come with whatever their last
   *  owner left in them. `BFSoldier::pickupKit` (lnxded 0x08279390) moves the
   *  dropped kit's own `FireArms` onto the soldier and `addItem` (0x08277bd0)
   *  refills nothing (`kit-drops.js`). `rows` are `snapshot()` rows; an item
   *  with no row is one its owner never raised, and comes up full on its first
   *  raise here as it would have there. */
  adopt(rows) {
    this.#entries.clear();
    for (const row of rows ?? []) {
      if (!row?.name) continue;
      const entry = new AmmoEntry(row.name, null);
      entry.size = Number.isFinite(row.size) ? row.size : Infinity;
      entry.spares = Number.isFinite(row.spares) ? row.spares : 0;
      entry.rounds = Number.isFinite(row.rounds) ? row.rounds : entry.size;
      entry.mags = Number.isFinite(row.mags) ? row.mags : entry.spares;
      this.#entries.set(KitAmmo.key(row.name), entry);
    }
  }

  /** A depot's give: every item in the kit back to full. True if any item
   *  was short — the caller's cue to play the give sound. */
  refill() {
    let gave = false;
    for (const entry of this.#entries.values()) {
      if (entry.refill()) gave = true;
    }
    return gave;
  }

  /** Plain rows, for a harness or a debug hook. */
  snapshot() {
    return [...this.#entries.values()].map(e => ({
      name: e.name, rounds: e.rounds, mags: e.mags, size: e.size, spares: e.spares,
    }));
  }
}
