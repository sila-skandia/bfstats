// The engine's own geometry search (COL-14, COL-15), with no three.js in it:
// which node's geometry a vehicle's inertia box and box drag read, and which
// of its body parts is the root part whose mesh `getVertexCollision` finds.
// `ship-spec.js` re-exports all three; `vehicle-bodies.js` takes the root part
// from here, so the body world's module set stays free of `three`.

/** A node's meshes that are part of ITS geometry: its own, plus every untagged
 *  mesh child (the assembler splits one StandardMesh into a sub-mesh per
 *  material). A child with a `templateKind` is an object of its own. */
export function ownGeometryMeshes(node) {
  const isCollision = n => Boolean(n.userData?.collision || n.geometry?.userData?.collision
    || /collision/i.test(n.name || ''));
  const found = [];
  if (node.isMesh && node.geometry && !isCollision(node)) found.push(node);
  for (const child of node.children) {
    if (child.isMesh && child.geometry && !isCollision(child) && !child.userData?.templateKind) {
      found.push(child);
    }
  }
  return found;
}

/**
 * The object whose geometry `PhysicsNode::updateRotationalPhysics`
 * (`0x082539e0`) takes a vehicle's inertia box from, found the way the engine
 * finds it (COL-8, COL-14, COL-15):
 *
 *   1. the root's own `IGeometry` (`queryComponent(0x492fe0fe)` is the
 *      object's `+0x5c`), which no vanilla or DC land root authors;
 *   2. else `findLodGeometry` (`0x0818d860`): if the root's FIRST child is a
 *      `LodObject`, its highest alternative's geometry (`m_forceHighestLod`,
 *      `LodObject::getChild` `0x08216ce0` returns entry 0) — a tank's
 *      `ShermanComplex`;
 *   3. else the first `LodObject` depth first, child before sibling, whose
 *      selector is a `DistCompareLodSelector` (`internalFindChildOfLodSelectorCID`
 *      `0x0818db50`, CID `0x94b1`), and again its highest alternative's — a
 *      car's cockpit LOD, `WillyCockpitExternal`'s `Willy_Hull_M1`. A
 *      `PlayerControlObject` ends the search of its own sibling chain there.
 *
 * A tree the exporter has stamped with each LodObject's `selectorKind` gets
 * step 3 exactly: only a `DistCompareSelector` matches. An older tree does not
 * carry the class, so step 3 takes the first `LodObject` whose kept
 * alternative has geometry of its own. Across the vanilla and DC land
 * vehicles and every fixed-wing aircraft in vanilla, XPack1, XPack2, DC and
 * DC Final that is the cockpit LOD every time: the root's own LOD
 * (`DistCompareSelector2`, CID `0x94b2`) holds a geometry-less `Bundle` and
 * the steering-wheel LODs sit after the cockpit. Not on DC's AH-6 family,
 * whose `H6Common` puts the control stick's `DistanceSelector` LOD first.
 *
 * @returns {THREE.Object3D|null}
 */
export function inertiaGeometryNode(root) {
  const parts = node => node.children.filter(child => child.userData?.templateKind);
  const hasGeometry = node => Boolean(node?.userData?.geometry) && ownGeometryMeshes(node).length > 0;
  if (hasGeometry(root)) return root;
  const first = parts(root)[0];
  if (first?.userData?.templateKind === 'LodObject') {
    const alternative = parts(first)[0];
    if (hasGeometry(alternative)) return alternative;
  }
  const visit = list => {
    for (const node of list) {
      const kind = node.userData?.templateKind;
      if (kind === 'PlayerControlObject') return null;
      const selector = node.userData?.selectorKind;
      if (kind === 'LodObject' && (selector === undefined || String(selector).toLowerCase() === 'distcompareselector')) {
        const alternative = parts(node)[0];
        if (hasGeometry(alternative)) return alternative;
      }
      const found = visit(parts(node));
      if (found) return found;
    }
    return null;
  };
  return visit(parts(root));
}

/**
 * The body world's part (`describeVehicleParts`) that is the engine's ROOT
 * part: the one whose collision mesh `getVertexCollision` finds for the root
 * object, by the search `inertiaGeometryNode` runs (COL-15). The tree walk
 * meets a part's children before the collision node hung last under it, so
 * the first hull part it met was a gun barrel on a placed BMP-2 and a trail
 * leg on FHSW's `45mmATGunmobile`; `describeVehicleParts` marks this one
 * `isRoot`. Null when no part hangs off that node.
 */
export function rootCollisionPart(parts, root) {
  if (!parts?.length || !root) return null;
  const node = inertiaGeometryNode(root);
  return node ? parts.find(part => part.node === node && part.kind !== 'spring') ?? null : null;
}
