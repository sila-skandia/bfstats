// Which kit item the soldier raises by himself, and which he cannot raise:
// the engine's `changeWeaponWhenNoAmmo` and `cantSelectWhenNoAmmo`, from the
// weapon's own words and the kit's own order, never from a weapon's name.
//
// THE KIT'S ORDER. `Kit::Kit` (lnxded `0x08295f60`) fills a list on the kit
// template (`KitTemplate+0x170`, a `vector<int>`) the first time a kit is made
// from it: it walks the kit's children (`getChild`, then each sibling at
// `+0x54`), and for every one that answers `IID_IItemObject` (`0xc49c`) pushes
// its `itemIndex`. `BundleTemplate::addBundleChilds` (`0x081a8300`) adds the
// children in the order the template's `addTemplate` lines name them, and
// `addSibling` (`0x08165ea0`) appends, so the list is the kit's carried items
// in its own declaration order: vanilla's US medic is Thompson (3), Colt (2),
// knife (1), medpack (5), grenade (4). No script word fills it.
//
// THE SWITCH. `BFSoldier::selectBestLoadedWeapon` (`0x08273a80`):
//   * nothing while the item gate is shut (`c_AsmHideWeapon`, `0x08273af4`),
//     the held item is flagged (`+0x4` bit 0), or the soldier has no kit;
//   * the held item is the `ExpPack` (the template `BFSoldierTemplate::init`
//     resolves by name into `+0x2a4`) and has no ammunition: raise item 11,
//     the detonator (`0x08273c45`);
//   * otherwise walk the kit's list for the first index whose slot holds an
//     item (`soldier+0x3ac`) answering non-zero to `getTotalAmmo` (`vt+0xf8`;
//     -1 is unlimited, so a knife always answers), and raise it; when none
//     does, or the one found is index 0 or below, raise the list's first.
// The raise is `enableItem` (`vt+0x100`, `0x08278460`) itself: none of the
// MenuSelect gates (recoil, the fire cycle) stands in front of it.
//
// WHO CALLS IT. `BFSoldier::handlePlayerInput` (`0x08273c70`, the call at
// `0x08275c52`) every tick the held item's `getTotalAmmo` is 0 and its
// template's `changeWeaponWhenNoAmmo` byte (`+0x1ec`) is set; and
// `FireArms::handleUpdate` (`0x08288890`, `0x08289135`) at the end of a
// `fireDelay` weapon's `hideDuringFireTime`, when the throw spent the loaded
// magazine's last round, whatever the word says (ledger FA-14).
//
// THE REFUSAL. `cantSelectWhenNoAmmo` is `HandFireArmsTemplate+0x360`
// (`ConsoleClass254::executeObjectMethod` `0x082c51d0`; the client's
// `+0x55c`, `0x004cedf0`). Its one reader is `HandFireArms::enable`
// (`0x08293bd3`): set, and `getTotalAmmo` 0, and `enable` returns false, so
// `enableItem` returns with the old item still in hand (the test at
// `0x082785c8`).
//
// No DOM and no three.js: `tests/kit_select_harness.mjs` drives it under node.

/**
 * A magazine's total, the way `FireArms::getTotalAmmo` (lnxded `0x0828cb60`)
 * counts it: every magazine summed, or -1 (here Infinity) when the weapon has
 * no magazines to count. `entry` is a `kit-ammo.js` row (`rounds` in the
 * loaded magazine, `mags` spares of `size` each); null is an item never raised
 * this life, which the engine made full.
 */
export function totalAmmo(entry) {
  if (!entry) return Infinity;
  // A negative `magSize` is the engine's unlimited magazine (the knife's -1).
  if (!Number.isFinite(entry.rounds) || !Number.isFinite(entry.size) || entry.size < 0) return Infinity;
  return Math.max(0, entry.rounds) + Math.max(0, entry.mags || 0) * entry.size;
}

/**
 * The kit template's item list (`KitTemplate+0x170`): the item indexes of its
 * carried weapons in the kit's own `addTemplate` order. `row` is the kit's
 * `_shared/loadouts.json` row: `items` is that order (by name, `kit.py`
 * `kit_parts`), `weapons` the slot each weapon sits at. A name with no slot
 * (an ammo bundle, a flag part) is no item. Two items at one index both go in,
 * as `Kit::Kit` pushes them; the soldier holds one of them.
 */
export function kitItemOrder(row) {
  const weapons = Array.isArray(row?.weapons) ? row.weapons : [];
  const slotOf = new Map();
  for (const w of weapons) {
    const key = String(w?.weapon || '').toLowerCase();
    if (key && Number.isInteger(w.slot) && !slotOf.has(key)) slotOf.set(key, w.slot);
  }
  const order = [];
  for (const name of Array.isArray(row?.items) ? row.items : []) {
    const slot = slotOf.get(String(name || '').toLowerCase());
    if (slot !== undefined) order.push(slot);
  }
  // A row with no `items` (an older tree) still has its weapons, in slot order.
  if (!order.length) for (const w of weapons) if (Number.isInteger(w?.slot)) order.push(w.slot);
  return order;
}

/**
 * `selectBestLoadedWeapon`'s answer: the item index to raise, or null for
 * none. `order` is `kitItemOrder`; `filled(slot)` whether the soldier holds an
 * item at the index; `total(slot)` that item's `getTotalAmmo`. `heldIsPack`
 * and `heldTotal` are the explosives-pack case, answered by the caller with
 * the engine's name.
 */
export function bestLoadedSlot(order, { filled, total, heldIsPack = false, heldTotal = 1,
                                        detonatorSlot = 11 } = {}) {
  if (heldIsPack && heldTotal === 0) return detonatorSlot;
  if (!Array.isArray(order) || !order.length) return null;
  let found = -1;
  for (const slot of order) {
    if (!filled(slot)) continue;
    if (total(slot) !== 0) { found = slot; break; }
  }
  return found > 0 ? found : order[0];
}

/** `HandFireArms::enable`'s refusal: `cantSelectWhenNoAmmo` set and nothing
 *  left to fire. */
export function refusesRaise(magazine, total) {
  return !!magazine?.cantSelectWhenNoAmmo && total === 0;
}

/**
 * Whether this tick's held weapon calls for the switch. `hw` is the page's
 * hand weapon (`rounds`, `mags`, `cool`, `hideFire`, `throwWind`, `pulse`),
 * `entry` its kit row. The page takes a round off at the shot; the engine's
 * `fireFinished` (`0x08288470`, which decrements the loaded magazine) runs
 * when the fire timer or `hideDuringFireTime` runs out (`handleUpdate`
 * `0x082893b1`, `0x082890fb`), so the count reaches 0 there, and the switch
 * waits for both.
 */
export function wantsSwitch(hw, entry = hw?.ammo) {
  if (!hw) return false;
  // A rig without a kit row (a harness, a bare weapon) counts its own.
  entry ??= { rounds: hw.rounds, mags: hw.mags, size: hw.data?.magazine?.size };
  if (!hw.data?.magazine?.changeWeaponWhenNoAmmo) return false;
  if (hw.cool > 0 || hw.hideFire > 0 || hw.throwWind > 0 || hw.pulse) return false;
  return totalAmmo(entry) === 0;
}
