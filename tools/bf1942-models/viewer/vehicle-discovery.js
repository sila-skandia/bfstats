// Finding the drivable vehicles in a loaded map scene. Split out of
// `flight.js`, which still re-exports both helpers. Imports nothing: it only
// walks the scene graph and reads the exporter's `userData` stamps.

// --- discovery -------------------------------------------------------------

/**
 * Vehicles in a loaded map scene that we could plausibly fly or drive.
 *
 * The exporter groups spawned vehicles under a `spawners` node and stamps each
 * with `templateKind: "PlayerControlObject"` and a `control` naming the
 * template, so this needs no per-map table.
 */
export function findVehicles(root) {
  const found = [];
  root.traverse(obj => {
    if (obj.userData?.templateKind !== 'PlayerControlObject') return;
    // Only spawner-placed vehicles; the stationary Defguns and Brownings that
    // share the class are map furniture.
    let parent = obj.parent;
    while (parent && parent.name !== 'spawners') parent = parent.parent;
    if (!parent) return;
    found.push(obj);
  });
  return found;
}

/** The first vehicle whose control name matches, e.g. `Corsair`. */
export function findVehicle(root, name) {
  return findVehicles(root).find(
    obj => (obj.userData?.control || obj.name || '').toLowerCase() === name.toLowerCase(),
  ) || null;
}
