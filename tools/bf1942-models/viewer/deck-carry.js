// What a moving hull's deck does to what stands on it: nothing but the
// friction, which meets the contact's RELATIVE speed.
//
// Retail (lnxded, collision-response.md sections 6.2 and 8):
//
//   * Per object contact `ResponsePhysics::checkObjectVsObject` (0x08259690)
//     takes `vRel = rootA.getTangentSpeed(hit) - rootB.getTangentSpeed(hit)`
//     (`PhysicsNode::getTangentSpeed` 0x08254b90: the root's velocity, vt+0x38,
//     plus its spin, vt+0x3c, crossed with the hit's offset from the root,
//     vt+0x2c), and hands `share * vRel` to `impulseOn` (0x08258900), which
//     keeps the running mean of it in `+0x74` (0x08258b0e..0x08258b3c).
//   * `addFriction` (0x0825b6e0) then works on `V = (+0x74) - (+0x50)`, the
//     mean contact speed less the body's own `setSurfacePositionalSpeed`
//     (0x0825b887..0x0825b8ae: `fsubrs 0x74(%esi)` against `0x50(%esi)`).
//   * A light body on a heavy one is the vertex side with weight 1 and takes
//     share 1 (sections 5.3, 6.1: a soldier always; a plane on a carrier, the
//     root radii more than 4x apart), so its friction pulls it onto the deck's
//     own point speed, spin included, and a soldier's `vCmd` is a speed over
//     the deck. Below `|vRel|^2 = 0.1` the handler does not run, which is also
//     relative.
//   * There is no parenting. `BFSoldier::handleCollision` (0x0827d3b0) stores
//     the object stood on in `+0x558` (0x0827da4c), and its only other reader
//     is `BFSoldierNetworkable::updateStateMask` (0x082228e4), a networked bool.
//
// The page's soldier and the parked bodies stand on a hull through a height
// (`soldier-resolve.js` `groundUnder`, `hull-bodies.js` `shipDeckAt`), so the
// deck's speed is handed to their friction here. For a hull the collider was
// told has moved (`WorldCollider.setMovedOwner`), the point speed is the
// difference of its pose over the consumer's own last tick, the way
// `pushOutOfHulls` measures a hull's move: each consumer remembers the poses
// it last saw, so a hull republished twice in a tick or skipped once still
// answers the speed over that consumer's tick.

/** A deck that jumps further than this in a tick was put there, not moved. */
const DECK_TELEPORT = 10;

/** One consumer's memory of the moved hulls near it. */
export function createDeckTrack() {
  return { prev: new Map(), stamp: 0 };
}

/**
 * The velocity, over the last tick, of the point of moved owner `owner` now
 * at world (x, y, z), into `out` ({x, y, z}). False (and `out` zero) when
 * the owner is not a moved hull or this track has not seen it last tick.
 */
export function deckPointVelocity(track, collider, owner, x, y, z, dt, out) {
  out.x = 0; out.y = 0; out.z = 0;
  if (!(owner >= 0) || !(dt > 0)) return false;
  const m = collider?.moved?.get(owner);
  const f = track?.prev.get(owner);
  if (!m || !f) return false;
  const e = m.inv;
  // Where the point is in the hull's baked frame, and where that point was.
  const bx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const by = e[1] * x + e[5] * y + e[9] * z + e[13];
  const bz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const px = f[0] * bx + f[4] * by + f[8] * bz + f[12];
  const py = f[1] * bx + f[5] * by + f[9] * bz + f[13];
  const pz = f[2] * bx + f[6] * by + f[10] * bz + f[14];
  const dx = x - px, dy = y - py, dz = z - pz;
  if (dx * dx + dy * dy + dz * dz > DECK_TELEPORT * DECK_TELEPORT) return false;
  out.x = dx / dt; out.y = dy / dt; out.z = dz / dt;
  return true;
}

/**
 * Remember the pose of every moved hull whose bounding sphere comes within
 * `reach` of (x, y, z), for the next tick's `deckPointVelocity`; forget the
 * rest. Once per consumer tick, after its contacts.
 */
export function rememberDecks(track, collider, x, y, z, reach) {
  const moved = collider?.moved;
  if (!track) return;
  if (!moved?.size) { if (track.prev.size) track.prev.clear(); return; }
  const stamp = ++track.stamp;
  for (const [key, m] of moved) {
    if (m.sub >= 0) continue;
    const r = m.radius + reach;
    const cx = m.x - x, cy = m.y - y, cz = m.z - z;
    if (cx * cx + cy * cy + cz * cz > r * r) continue;
    let rec = track.prev.get(key);
    if (!rec) { rec = new Float64Array(17); track.prev.set(key, rec); }
    rec.set(m.fwd);
    rec[16] = stamp;
  }
  for (const [key, rec] of track.prev) if (rec[16] !== stamp) track.prev.delete(key);
}
