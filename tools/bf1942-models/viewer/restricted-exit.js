/**
 * A restricted exit: the line out of the hull to the door, the other side
 * when that line is blocked, and no exit at all when both are.
 *
 * Retail, read on lnxded (ledger SEAT-5, SEAT-35, SEAT-42):
 *
 * - `GameServer::toggleEntryPoint` 0x0814ee70 asks the player's controlled
 *   object (the seat's own PlayerControlObject) `isAllowedToExit` 0x08317490
 *   before every exit (call at 0x0814eed9); false and the Use press does
 *   nothing (`je 0x814ee9d`). Every player's press, a bot's included, comes in
 *   through `checkPlayerTriggers` 0x0815058a.
 * - `isAllowedToExit` returns 1 when the template's `hasRestrictedExit` byte
 *   (`+0x192`) is clear (0x083174c5).
 * - Otherwise it builds the exit matrix from the template's
 *   `soldierExitLocation` (position `+0x158`, rotation `+0x164`) with its Y
 *   raised by 0.5 (the double at 0x086be450 = 0.5), times the seat PCO's
 *   absolute transformation (vt+0x40), and asks `ObjectManager::intersectLine`
 *   0x0819e840 (objectManager 0x0871dc24, vt+0x48) for an object on the
 *   segment from the seat PCO's absolute position (vt+0x38) to that point.
 * - The predicate is `PCOPredicator` (vtable 0x0873eb88; `predicate`
 *   0x0831ce70): an object whose root is the seat's own root is skipped, so is
 *   a soldier (template class `CID_BFSoldierTemplate`, 0x086c2b88), and the
 *   rest must carry flag 0x200 (`hasCollisionPhysics`, COL-16). intersectLine
 *   walks the object grid only: the terrain and the sea never block an exit.
 * - No hit: allowed, and `exit` places the soldier at the declared point, not
 *   raised (0x08318290).
 * - Hit: X negated (`xor $0x80000000` at 0x08317714), the same raised Y and Z,
 *   cast again. Clear: the mirrored point is stored at `+0x18c` and flag
 *   `+0x198` set (0x0831792c); `exit` 0x08317e1d then places the soldier
 *   there, Y still raised by 0.5. Blocked: 0 (0x08317938).
 *
 * The local vectors here are in three's frame (Refractor's Z already negated
 * by the caller); X is the same axis in both, so negating it is retail's
 * mirror either way.
 */

/** `isAllowedToExit`'s lift of the exit point (lnxded 0x086be450, double 0.5). */
export const EXIT_TEST_LIFT = 0.5;

/**
 * Decide where a soldier leaving a seat goes.
 *
 * - `restricted`: the seat PCO's `hasRestrictedExit`.
 * - `local`: the declared exit, `{x, y, z}` in the seat's frame (three axes).
 * - `toWorld(x, y, z)`: a seat-frame point to world, `{x, y, z}`.
 * - `origin`: the seat PCO's world position, where the test line starts.
 * - `blocked(ox, oy, oz, dx, dy, dz, len)`: true when an object other than the
 *   hull itself lies on the segment (unit `d`, `len` metres).
 *
 * Returns `{ allowed, mirrored, local }`: `local` is the seat-frame point the
 * soldier is placed at (the declared one, or the mirrored and raised one).
 */
export function restrictedExit({ restricted, local, toWorld, origin, blocked }) {
  const declared = { x: local.x, y: local.y, z: local.z };
  if (!restricted || typeof blocked !== 'function') {
    return { allowed: true, mirrored: false, local: declared };
  }
  const lineBlocked = (x, y, z) => {
    const p = toWorld(x, y, z);
    const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
    const len = Math.hypot(dx, dy, dz);
    // intersectLine returns nothing for a zero direction (0x0819e8f7).
    if (!(len > 0)) return false;
    return !!blocked(origin.x, origin.y, origin.z, dx / len, dy / len, dz / len, len);
  };
  const y = local.y + EXIT_TEST_LIFT;
  if (!lineBlocked(local.x, y, local.z)) {
    return { allowed: true, mirrored: false, local: declared };
  }
  const mirrored = { x: -local.x, y, z: local.z };
  if (!lineBlocked(mirrored.x, mirrored.y, mirrored.z)) {
    return { allowed: true, mirrored: true, local: mirrored };
  }
  return { allowed: false, mirrored: false, local: declared };
}

/**
 * `blocked` for `restrictedExit` over a `WorldCollider`: objects only
 * (`castObjects`), the hull's own owner skipped. Null without a collider that
 * can answer, which `restrictedExit` reads as "nothing blocks".
 */
export function objectBlocker(collider, skipOwner = -1) {
  if (typeof collider?.castObjects !== 'function') return null;
  return (ox, oy, oz, dx, dy, dz, len) =>
    collider.castObjects(ox, oy, oz, dx, dy, dz, len, skipOwner) !== null;
}
