// The kit inspector's framing: the figure's bounds off its posed joints, the
// head point, and the figure/head view buttons that choose between them.
// Lifted out of kits.html (features/vehicle-instance-refactor, Part 2d).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `camera`, `controls`, `current`, `moveCamera`.
 */
export function createKitView(page) {
  const kitView = {};

  let view = 'figure';
  let framing = null;
  let headPoint = null;

  const headView = () => view === 'head' && headPoint;
  const viewTarget = () => (headView() ? headPoint : framing.centre).clone();
  const viewDistance = ({ radius }) => (headView() ? Math.max(radius * .28, .3) : radius * 2.6);

  function applyView(animate = false) {
    if (!framing) return;
    const target = viewTarget();
    const d = viewDistance(framing);
    const position = headView()
      ? new THREE.Vector3(target.x + d * .8, target.y + d * .2, target.z + d)
      : new THREE.Vector3(target.x + d * .62, target.y + framing.radius * .5, target.z + d * .78);
    page.moveCamera(position, target, animate);
  }

  // Frame off the posed joints, not Box3.setFromObject: a skinned mesh node sits
  // at the scene root, so its object-level bounds describe the bind-space figure
  // lying along +Z, nowhere near the posed render. Same trap poses.html documents.
  function refit({ glide = false } = {}) {
    const current = page.current;
    if (!current) return;
    const previous = framing;
    current.updateMatrixWorld(true);
    const box = new THREE.Box3();
    headPoint = null;
    current.traverse(obj => {
      if (obj.isBone || obj.userData?.joint)
        box.expandByPoint(obj.getWorldPosition(new THREE.Vector3()));
      // GLTFLoader sanitizes node names, so "Bip01 Head" arrives underscored.
      if (!headPoint && /^Bip01[_ ]Head$/i.test(obj.name))
        headPoint = obj.getWorldPosition(new THREE.Vector3());
    });
    box.expandByScalar(0.25);
    const size = box.getSize(new THREE.Vector3());
    framing = {
      centre: box.getCenter(new THREE.Vector3()),
      radius: Math.max(size.x, size.y, size.z) / 2 || 1,
    };
    if (!glide || !previous) { applyView(); return; }
    const target = viewTarget();
    const offset = page.camera.position.clone().sub(page.controls.target)
      .multiplyScalar(viewDistance(framing) / viewDistance(previous));
    page.moveCamera(target.clone().add(offset), target, true);
  }

  for (const id of ['figure', 'head']) {
    document.getElementById(`view-${id}`).addEventListener('click', () => {
      view = id;
      for (const other of ['figure', 'head'])
        document.getElementById(`view-${other}`).classList.toggle('active', other === id);
      applyView(true);
    });
  }

  Object.assign(kitView, {
    refit,
  });
  return kitView;
}
