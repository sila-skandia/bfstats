// Desert Combat's jets for the school's tests: an `Aircraft` built from a
// row of `fixtures/dc-jets.json` (`surveys/airframe_fixture.py`), the
// published airframe's node tree with the header box its drag and inertia
// are taken from. No geometry: nothing here draws.
//
// `jetMaker(THREE, Aircraft, fixture, name)` returns a `makePlane()`; the
// caller hands in its own three.js and `Aircraft`, so a harness that copies
// the viewer's modules into a temp dir and one that loads them in place
// build the same airframe.

/** A fixture row's node tree as Object3D nodes, its root returned. */
export function airframeTree(THREE, row) {
  const build = index => {
    const n = row.nodes[index];
    // A node that draws is a mesh with nothing in it: the law's geometry
    // search asks that it has one, and takes the box from `collisionMeshes`.
    const o = n.mesh ? new THREE.Mesh(new THREE.BufferGeometry()) : new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    o.userData = structuredClone(n.extras ?? {});
    for (const child of n.children ?? []) o.add(build(child));
    return o;
  };
  const tops = row.scene.map(build);
  return tops.find(o => o.userData?.templateKind) ?? tops[0];
}

/** `makePlane()` for one of the fixture's airframes. */
export function jetMaker(THREE, Aircraft, fixture, name) {
  const row = fixture.airframes[name];
  if (!row) throw new Error(`no airframe ${name} in the fixture`);
  return () => new Aircraft(airframeTree(THREE, row), null, { cockpit: false, collisionMeshes: row.collisionMeshes });
}
