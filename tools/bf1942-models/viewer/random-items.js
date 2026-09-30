// A kit's rolled items: which numbered template a spawn actually hands out.
//
// FHSW's kits carry `addTemplate RandomGBTankcommander` with
// `setRandomGeometries 4`. The engine never makes an object of that name:
// `BundleTemplate::addBundleChilds` (lnxded 0x081a8300, ledger KIT-1) bumps one
// process-wide counter for every such child, wraps it to 1 once it passes N,
// and creates `<name><counter>` -- `RandomGBTankcommander1..3` are No2
// revolvers, `RandomGBTankcommander4` a Sten. The variant is a real weapon
// template: its model, sounds, AI entry and animation states (ledger ANIM-15)
// are all its own, so once it is resolved here the rest of the page treats it
// like any other weapon.
//
// The counter (`world::randomCounter`, .data 0x08720754) starts at 1, is never
// reset, and is shared by every rolled child of every bundle -- helmets and hip
// packs bump it as much as weapons do (KIT-2). So a kit's whole `random` list
// (`_shared/loadouts.json`, extract_loadouts.py) is rolled in order on each
// roll, not just the weapon. A roll that lands on a variant the mod never
// declared gives the soldier nothing in that slot (KIT-3). A kit object is
// made on every spawn and every kit change (KIT-4), and each one rolls.

/** The engine's counter, as the page's one process. */
const counter = { value: 1 };

/** Put the counter back where the engine starts it (a test, a fresh sim). */
export function resetRandomCounter(value = 1) {
  counter.value = value;
}

/** The counter's current value, for a test or a debug hook. */
export function randomCounter() {
  return counter.value;
}

/** One roll of an N-way child: `inc`, then 1 once past N (lnxded 0x081a8352). */
export function nextRoll(count, state = counter) {
  state.value += 1;
  if (count < state.value) state.value = 1;
  return state.value;
}

/**
 * Roll every child `row` (a `loadouts.json` kit) rolls, in order, and say what
 * each rolled name became: a Map from the lowercased bundle name to the
 * variant's template, or to null where the roll found no such template.
 * `state` is the counter to bump (the page's own by default).
 */
export function rollKit(row, state = counter) {
  const rolls = new Map();
  for (const entry of row?.random ?? []) {
    const count = Number(entry?.count);
    if (!entry?.template || !(count >= 1)) continue;
    const index = nextRoll(count, state);
    rolls.set(String(entry.template).toLowerCase(), entry.variants?.[index - 1] ?? null);
  }
  return rolls;
}

/** What the next `rollKit(row)` will hand out, without bumping the counter:
 *  for a caller that must name the weapon before the spawn rolls it (the
 *  deploy screen's preview, a test hook). */
export function peekKit(row) {
  return rollKit(row, { value: counter.value });
}

/** The template a kit item is held as under `rolls`: the variant for a rolled
 *  name (null when the roll found none), the name itself otherwise. */
export function heldItem(name, rolls) {
  if (!name) return name ?? null;
  const key = String(name).toLowerCase();
  return rolls?.has(key) ? rolls.get(key) : name;
}

/**
 * A kit row with its rolled items swapped for what `rolls` gave: `primary`,
 * `items` and `weapons` (the slot list) name variants, and an item whose roll
 * found nothing is left out. Everything else on the row is kept.
 */
export function resolveKitRow(row, rolls) {
  if (!row) return row;
  if (!rolls?.size) return row;
  const items = (row.items ?? []).map(name => heldItem(name, rolls)).filter(Boolean);
  const weapons = Array.isArray(row.weapons)
    ? row.weapons.map(entry => ({ ...entry, weapon: heldItem(entry.weapon, rolls) }))
      .filter(entry => entry.weapon)
    : row.weapons;
  return { ...row, primary: heldItem(row.primary, rolls) ?? null, items, weapons };
}
