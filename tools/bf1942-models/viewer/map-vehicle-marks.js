// Which vehicles the map surfaces mark, and how: the retail client's rule,
// read from the vehicle pass of `BfMap::update` (BF1942.exe 0x0046a680, the
// loop at 0x0046b45f..0x0046bc5f over `objectManager->getPcoMap()`, vtable
// +0x8c). Pure: the page hands in each hull's hit points and the teams of the
// men sitting in it, and gets back whether it is drawn and in which colour.
// Ledger MMAP-3.

/**
 * The modulate colour of a vehicle nobody sits in: 0.574219 on each channel
 * (0x3f130004, written to the draw colour at 0x0046b66b..0x0046b6ad before
 * the occupant walk), which is 146 of 255. The icon art is white on black, so
 * an empty hull reads as a mid grey.
 */
export const EMPTY_VEHICLE_TINT = [146, 146, 146];

/**
 * One hull's mark, or null when the local player's map does not show it.
 *
 * - `hitPoints`: the hull's Armor. The pass asks the root object for its
 *   Armor component (`queryComponent(0xc4a4)`, 0x0046b4db) and draws it only
 *   when `getHitPoints() > 0` (the `fcomp 0.0 / test ah,0x41` at 0x0046b4f5).
 *   A wreck is therefore never drawn, and neither is an object with no Armor
 *   at all; the hull comes back on the map when its spawner puts a fresh one
 *   down with full hit points.
 * - `occupantTeams`: the team of every man seated in the hull, in seat order
 *   (the walk over `IPlayerControlObject::getPcos()` at 0x0046b748, each seat's
 *   `getOccupingPlayer`). An occupant on another team than the reader clears
 *   the draw flag, one on his team sets it (0x0046b7b3..0x0046b7bf and
 *   0x0046b88b): the last man walked decides, which in a hull that only ever
 *   carries one side is simply "enemy-crewed hulls are not drawn".
 * - `heldTeam`: the team a `teamOnVehicle` spawner stamped on a fresh hull
 *   while it still holds it (the byte at object +0x11a, written by the client
 *   spawner at 0x0054711c / 0x005476bc and cleared at 0x00547761). A nonzero
 *   held team other than the reader's hides the hull (0x0046b6c5..0x0046b6e2).
 *   The viewer does not model the hold yet; pass 0.
 * - `localTeam`: the reader's team.
 *
 * Returns `'friendly'` for a hull his side is crewing (drawn in his team's
 * colour), `'empty'` for one nobody is in (drawn in `EMPTY_VEHICLE_TINT`), or
 * null. The reader's own hull is not asked here: the client draws it through
 * its own path (0x0046b77a sets the icon kind 0xb) and the viewer marks him
 * with the player ring.
 *
 * Not built: in game modes `BfMenu+0x6DC` 0, 1, 3 and 4 the pass also drops
 * any hull farther from the reader's control object than a float the client
 * reads off the object his player holds at +0x94 (vtable +0x34, 0x0046b476..
 * 0x0046b5cc). What that object is was not identified, so no range is applied.
 */
export function mapVehicleMark({ hitPoints, occupantTeams = [], heldTeam = 0, localTeam }) {
  if (!(hitPoints > 0)) return null;
  if (heldTeam && heldTeam !== localTeam) return null;
  let shown = true;
  let crewed = false;
  for (const team of occupantTeams) {
    crewed = true;
    shown = team === localTeam;
  }
  if (!shown) return null;
  return crewed ? 'friendly' : 'empty';
}
