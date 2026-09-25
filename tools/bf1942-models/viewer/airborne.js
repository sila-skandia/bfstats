// Is a hull in the air?
//
// One question, asked in three places, and it has to be the same answer in all
// of them:
//
//   * `vehicle-wrecks.js` asks it when a destroyed hull's wreck is decided: a
//     plane with air under it keeps integrating and comes down; anything else
//     is a wreck where it stood.
//   * `vehicle-instance.js` asks it when the last occupant leaves a hull: a
//     plane nobody is in any more is still in the air, so its drive stays its
//     own instead of being handed back as a parked hull's.
//   * `hull-bodies.js` asks it when a drive is released: the body of a hull up
//     in the air is the wreck's to fly, not the parked list's to freeze.
//
// The height is read off the drive's own state, not the node's matrix: a drive
// IS the hull's position (`applyTransform` writes the node from it), and a
// released hull's node can be a frame stale.

/** Metres of air under a hull before it counts as flying rather than parked. */
export const AIRBORNE_MARGIN = 1.5;

/**
 * `drive`'s origin height above the ground under it, against the hull's own
 * ride height. A plane still on its wheels sits at exactly
 * `spec.groundClearance` over the strip, so the margin is what separates
 * taxiing from flight; a drive that cannot say where the ground is answers
 * false.
 */
export function airborneDrive(drive) {
  const s = drive?.state;
  const floor = drive?.groundHeight?.(s?.position?.x ?? 0, s?.position?.z ?? 0);
  if (!s?.position || !Number.isFinite(floor)) return false;
  const ride = drive.spec?.groundClearance ?? 1.2;
  return s.position.y - floor > ride + AIRBORNE_MARGIN;
}
