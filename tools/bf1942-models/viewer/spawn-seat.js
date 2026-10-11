// The seat a spawn point gives: `setEnterOnSpawn 1` and `setAIEnterOnSpawn 1`
// (`BFSpawnPointTemplate+0x161`, `+0x162`), ledger SPAWN-25..SPAWN-27, SEAT-30.
//
// The engine asks one finder twice. `BFSpawnPoint::getActive(bool ai, int
// team)` 0x08163dd0 switches the point off unless `BFfindEntryPoint` finds a
// door from the point, and `GameServer::spawnPlayer` 0x0814c990 stands the
// soldier on the point and presses Use for him (`toggleEntryPoint(player,
// true)` at 0x0814d27c), which runs the finder again from where he stands.
// Neither names the point's carrier: any door in reach counts, of any hull
// that is nobody's or the group's side's.
//
// Pure: a door is `{ vehicle, seatId, radius }`, and the caller says how far
// one is and whether it is open.

import { pickNearest } from './entry-points.js';

/** `getActive`, a human: `0x40a00000` at 0x08163fd6. */
export const SPAWN_SEAT_REACH = 5.0;
/** `getActive` (0x08163f9d), `getObjectToEnter` and the seating
 *  (0x0814f22e), a bot: `0x41700000`. */
export const SPAWN_SEAT_REACH_AI = 15.0;
/** `toggleEntryPoint`, a human: `0x40400000` at 0x0814f262, and the door's
 *  own `setEntryRadius` (`useTemplateRadius` true). */
export const SPAWN_ENTER_REACH = 3.0;

/**
 * Whether spawning on `spawn` seats this kind of player. A human reads
 * `setEnterOnSpawn` alone; a bot reads either word (`getActive`
 * 0x08163f70..0x08163f8f, `spawnPlayer` 0x0814d1e0..0x0814d204).
 */
export function wantsSeat(spawn, ai = false) {
  return !!(spawn?.enterOnSpawn || (ai && spawn?.aiEnterOnSpawn));
}

/**
 * `BFfindEntryPoint(pos, radius, team, useTemplateRadius, 0, 0)` 0x0831d770:
 * the nearest door of a free seat. `open(door)` is the seat free
 * (`isOccupied`, IPCO vt+0x14), the hull no wreck (`Armor::isDestroyed`,
 * SEAT-28) and its team 0 or the asker's (SEAT-26); `distanceOf(door)` the
 * metres from the point to the door. The engine cuts the distance to whole
 * centimetres (`fistpl` under a truncating control word, 0x0831d93c..
 * 0x0831d967), wants it under the radius, or under the door's own with
 * `useTemplateRadius`, and never over the radius squared. Doors the
 * same distance off keep declaration order (`pickNearest`); the engine
 * breaks that tie on the incumbent's template flag bit 0 in the object
 * manager's order, which is not read.
 */
export function findEntryPoint(doors, radius, { distanceOf, open, useEntryRadius = false }) {
  return pickNearest(doors ?? [], door => {
    if (!open(door)) return Infinity;
    const distance = Math.trunc(distanceOf(door) * 100) / 100;
    const reach = useEntryRadius ? door.radius : radius;
    return distance < reach && distance <= radius * radius ? distance : Infinity;
  });
}

/**
 * A bot's answer for a `setAIEnterOnSpawn` point with no seat it can work:
 * the point stays on and he is stood on it, as he was before the page could
 * seat a bot (`bot-units.js` `spawnSeat` says why this is not the engine's).
 */
export const SPAWN_STANDS = Object.freeze({ stands: true });

/** `setVehicleType` values whose doors hand a human the driver's seat. */
const DRIVER_FIRST = new Set(['vtheavytank', 'vtlighttank', 'vtarmoredcar', 'vttankhunter']);

/**
 * `PlayerControlObject::getPreferredPco()` 0x083193c0, which the human's
 * `toggleEntryPoint` asks of the seat its finder returned (IPCO vt+0x48 at
 * 0x0814f293): a seat whose own template is `VTHeavyTank` (0), `VTLightTank`
 * (1), `VTArmoredCar` (0x11) or `VTTankHunter` (0x12) gives way to the
 * hull's root seat while that is free. A template that never says
 * `setVehicleType` holds 20 (ctor 0x08319720, `+0x1e0`) and keeps its seat.
 * A bot's finder result is taken as it is (SEAT-30).
 */
export function preferredSeat(seatId, { vehicleType, rootId, rootFree }) {
  if (seatId === rootId || !rootFree) return seatId;
  return DRIVER_FIRST.has(String(vehicleType ?? '').toLowerCase()) ? rootId : seatId;
}
