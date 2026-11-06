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
// (measured live).
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

// --- a whole hull's rest -------------------------------------------------------
//
// A respawn is a fresh object off its ObjectSpawner (ledger SPAWN-28), and a
// fresh aircraft has its gear down (PHY-25). The page reuses the old hull's
// node, so whatever its last life left posed stayed posed: a plane shot down
// gear-up came back with its legs, wheels and control surfaces retracted and
// deflected, and the next drive's `aircraftSpec` read the retracted wheels as
// the undercarriage, standing the plane 1.3 m into the ground (feedback #9,
// features/browser-play-feedback-2026-11-06). So a hull's turning parts have
// their rest noted while it stands as the level placed it, and the respawn
// puts every one of them back.

const restPositions = new WeakMap();

/** A part something poses while the hull lives: a rigged bundle (gear,
 *  control surface, turret, steering), a wheel's spring, a propeller's spun
 *  child, or any node a writer has already noted the rest of. */
function posedPart(node) {
  const data = node.userData;
  if (rests.has(node)) return true;
  if (!data) return false;
  return !!(data.rig || data.spinsWithEngine || data.templateKind === 'Spring'
    || data.templateKind === 'LandingGear');
}

function eachPosedPart(root, fn) {
  if (!root?.traverse) return;
  root.traverse(node => {
    if (node !== root && posedPart(node)) fn(node);
  });
}

/** Note the rest of every part of `root` that a rig, a wheel or a spin can
 *  move, where nothing has noted it yet: run while the hull stands as
 *  placed (its registration at load), so the note is the authored pose. */
export function noteRestPose(root) {
  eachPosedPart(root, node => {
    if (!rests.has(node)) rests.set(node, node.quaternion.clone());
    if (!restPositions.has(node)) restPositions.set(node, node.position.clone());
  });
}

/** Every noted part of `root` back at its rest, the root itself untouched
 *  (its pose is the pad's). Returns how many parts moved. */
export function restorePose(root) {
  let moved = 0;
  eachPosedPart(root, node => {
    const q = rests.get(node);
    const p = restPositions.get(node);
    let changed = false;
    if (q && !node.quaternion.equals(q)) { node.quaternion.copy(q); changed = true; }
    if (p && !node.position.equals(p)) { node.position.copy(p); changed = true; }
    if (changed) { node.updateMatrix(); moved++; }
  });
  return moved;
}

/** `measure()` run with `root`'s posed parts at their rest and every one put
 *  back as it was after: what a survey of the hull's own geometry reads
 *  (`aircraft.js` `aircraftSpec`), whatever the parts are posed at now. */
export function atRestPose(root, measure) {
  noteRestPose(root);
  const saved = [];
  eachPosedPart(root, node => {
    const q = rests.get(node);
    const p = restPositions.get(node);
    if ((!q || node.quaternion.equals(q)) && (!p || node.position.equals(p))) return;
    saved.push([node, node.quaternion.clone(), node.position.clone()]);
    if (q) node.quaternion.copy(q);
    if (p) node.position.copy(p);
    node.updateMatrix();
  });
  if (!saved.length) return measure();
  root.updateWorldMatrix(true, true);
  try {
    return measure();
  } finally {
    for (const [node, q, p] of saved) {
      node.quaternion.copy(q);
      node.position.copy(p);
      node.updateMatrix();
    }
    root.updateWorldMatrix(true, true);
  }
}
