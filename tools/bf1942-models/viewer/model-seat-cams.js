// The model browser's seat cameras: the extractor's `cameraView` nodes, the
// glide that carries the orbit camera to one of them or back to the orbit
// view. The buttons that pick one are the crew console's. Lifted out of
// index.html (features/vehicle-instance-refactor, Part 2c).

import * as THREE from 'three';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `camera`, `controls`, `current`, `framing`, `markActiveView`,
 * `startAnimating`.
 */
export function createSeatCams(page) {
  const seatCams = {};

  // --- seat camera views --------------------------------------------------------
  //
  // Camera templates come out of the extractor as mesh-less nodes tagged
  // `cameraView`, parked exactly where the .con put them — inside the turret or
  // gun bundle they were authored in, so a gunner's view traverses with the rig
  // sliders. Each becomes a button that glides the viewer camera to that seat.

  const seatViews = [];
  seatCams.cameraGlide = null;

  function glideCamera(toPosition, toTarget) {
    seatCams.cameraGlide = {
      fromPosition: page.camera.position.clone(),
      fromTarget: page.controls.target.clone(),
      toPosition, toTarget, t: 0,
    };
    page.startAnimating();
  }

  function advanceGlide(dt) {
    if (!seatCams.cameraGlide) return;
    const glide = seatCams.cameraGlide;
    glide.t = Math.min(1, glide.t + dt / 0.55);
    const eased = glide.t < 0.5
      ? 2 * glide.t * glide.t
      : 1 - ((-2 * glide.t + 2) ** 2) / 2;
    page.camera.position.lerpVectors(glide.fromPosition, glide.toPosition, eased);
    page.controls.target.lerpVectors(glide.fromTarget, glide.toTarget, eased);
    if (glide.t >= 1) seatCams.cameraGlide = null;
  }

  // The user grabbing the controls takes precedence over an in-flight glide.
  page.controls.addEventListener('start', () => { seatCams.cameraGlide = null; });

  function goToView(node) {
    if (!page.current) return;
    page.current.updateMatrixWorld(true);
    const position = node.getWorldPosition(new THREE.Vector3());
    // A camera node's forward is the vehicle's forward: Refractor +Z, which the
    // exporter's handedness mirror turns into glTF -Z.
    const quaternion = node.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const distance = Math.max(page.framing?.radius ?? 5, 2);
    glideCamera(position, position.clone().addScaledVector(forward, distance));
  }

  function orbitView() {
    page.markActiveView(null);
    if (!page.framing) return;
    const angle = -Math.PI * .22;
    const distance = page.framing.radius * 1.85;
    glideCamera(
      new THREE.Vector3(
        page.framing.centre.x + Math.cos(angle) * distance,
        page.framing.centre.y + page.framing.radius * .72,
        page.framing.centre.z + Math.sin(angle) * distance,
      ),
      page.framing.centre.clone(),
    );
  }

  function collectViews(root) {
    seatViews.length = 0;
    root.traverse(obj => {
      if (obj.userData?.cameraView) seatViews.push(obj);
    });
  }

  /** A new model: a glide still in flight was heading into the old one. */
  function cancelGlide() {
    seatCams.cameraGlide = null;
  }

  Object.assign(seatCams, {
    advanceGlide,
    cancelGlide,
    collectViews,
    goToView,
    orbitView,
    seatViews,
  });
  return seatCams;
}
