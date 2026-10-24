// A turning part's authored rest rotation, kept once per node.
//
// A RotationalBundle's angle is measured from its authored rest pose
// (`RotationalBundle::setState` lnxded 0x081d8110 and `handleUpdate`
// 0x081d78e0 rebuild the bundle's transform from `pivotPosition + angle`
// every update, GUN-3, GUN-20). The page has several writers of a turret
// node's rotation: the seat's own aim rig (`turret-rig.js`), the server's
// joint rows for a hull somebody else is aiming (`netcode-render.js`
// `applyJoints`), the recorded aim of a replay. Each wrote the node's
// `quaternion` and the aim rig read that same field as its rest when it was
// built. A rig built on a node the joint rows had already turned measured
// every angle from the turned pose: on Wake (2026-10-24) the owner climbed
// back into a Defgun the server had left traversed 8.5 degrees and elevated
// to its stop, the page's rig took that pose for zero, the acked-tick
// correction then set the page's angle to the server's, and the barrel was
// drawn the server's angle PLUS the left-over pose: 16 degrees of traverse
// and 11 of elevation ahead of the server's gun for as long as he sat there
// (features/udp-sidecar/wire.md section 41).
//
// So the rest is noted once, the first time anything is about to turn the
// node, and every writer measures from it. A node nobody has turned yet is
// at its authored pose, so the first note is the right one.

const rests = new WeakMap();

/** The node's authored rest rotation, noted now if nothing has turned it yet.
 *  The returned quaternion is the stored one: do not modify it. */
export function restQuaternion(node) {
  let q = rests.get(node);
  if (!q) {
    q = node.quaternion.clone();
    rests.set(node, q);
  }
  return q;
}

/** Note the rest before writing the node's rotation (idempotent). */
export function noteRest(node) {
  if (node && !rests.has(node)) rests.set(node, node.quaternion.clone());
}
