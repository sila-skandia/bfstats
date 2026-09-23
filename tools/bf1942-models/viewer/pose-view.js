// The grip inspector's framing: the figure's bounds off its posed joints, the
// right-hand grip point, and the figure/grip view buttons that choose between
// them. Lifted out of poses.html (features/vehicle-instance-refactor, Part 2d).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `camera`, `controls`, `current`, `moveCamera`.
 */
export function createPoseView(page) {
  const poseView = {};

  let framing = null;        // { centre, radius } of the whole figure
  let gripPoint = null;      // world position of Bip01 R Hand
  let viewMode = 'figure';

  const gripView = () => viewMode === 'grip' && gripPoint;
  const viewTarget = () => (gripView() ? gripPoint : framing.centre).clone();
  const viewDistance = ({ radius }) => (gripView() ? Math.max(radius * .45, .35) : radius * 2.6);

  function applyView(animate = false) {
    if (!framing) return;
    const target = viewTarget();
    const d = viewDistance(framing);
    const position = gripView()
      ? new THREE.Vector3(target.x + d * .8, target.y + d * .35, target.z + d)
      : new THREE.Vector3(target.x + d * .62, target.y + framing.radius * .5, target.z + d * .78);
    page.moveCamera(position, target, animate);
  }

  // Frame off the posed joints, not Box3.setFromObject: a skinned mesh node
  // sits at the scene root, so its object-level bounds are the bind-space
  // figure lying along +Z, nowhere near the posed, pitched render. Re-run
  // after a stance blend lands — the joints move, the bounds move. That one
  // glides and keeps the viewer's orbit angle; a fresh load snaps to the preset.
  function refit({ glide = false } = {}) {
    const current = page.current;
    if (!current) return;
    const previous = framing;
    current.updateMatrixWorld(true);
    const box = new THREE.Box3();
    gripPoint = null;
    current.traverse(obj => {
      if (obj.isBone || obj.userData?.joint)
        box.expandByPoint(obj.getWorldPosition(new THREE.Vector3()));
      // GLTFLoader sanitizes node names, so "Bip01 R Hand" arrives with
      // underscores for spaces.
      if (!gripPoint && /^Bip01[_ ]R[_ ]Hand$/.test(obj.name))
        gripPoint = obj.getWorldPosition(new THREE.Vector3());
    });
    box.expandByScalar(0.25);        // joints sit inside the flesh and the kit
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

  /** Wire the figure/grip buttons. The page does this once the pose manifest
   *  has loaded, with the rest of its controls. */
  function installButtons() {
    const figureButton = document.getElementById('view-figure');
    const gripButton = document.getElementById('view-grip');
    figureButton.addEventListener('click', () => {
      viewMode = 'figure';
      figureButton.classList.add('active');
      gripButton.classList.remove('active');
      applyView(true);
    });
    gripButton.addEventListener('click', () => {
      viewMode = 'grip';
      gripButton.classList.add('active');
      figureButton.classList.remove('active');
      applyView(true);
    });
  }

  Object.assign(poseView, {
    installButtons,
    refit,
  });
  return poseView;
}
