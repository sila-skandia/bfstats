// The inspectors' camera glide: the orbit camera and its target carried from
// where they are to a new framing, eased, or snapped there at once. The kit
// and grip inspectors each had the same copy of it; lifted out of kits.html
// and poses.html (features/vehicle-instance-refactor, Part 2d).

// The pose settles first, then the camera glides to the re-fitted framing:
// moving both at once reads as the figure jumping.
const CAMERA_MOVE_MS = 650;

/**
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters:
 * `camera`, `controls`, `invalidate`, `startAnimating`.
 */
export function createCameraGlide(page) {
  let cameraMove = null;    // { fromPosition, fromTarget, position, target, start }

  const glide = {
    // Whether a glide is under way, for the frame loop's keep-going test.
    get moving() { return cameraMove !== null; },
  };

  function moveCamera(position, target, animate) {
    if (!animate) {
      cameraMove = null;
      page.camera.position.copy(position);
      page.controls.target.copy(target);
      page.controls.update();
      page.invalidate();
      return;
    }
    cameraMove = {
      fromPosition: page.camera.position.clone(),
      fromTarget: page.controls.target.clone(),
      position,
      target,
      start: performance.now(),
    };
    page.startAnimating();
  }

  function advanceCamera(now) {
    if (!cameraMove) return;
    const t = Math.min((now - cameraMove.start) / CAMERA_MOVE_MS, 1);
    const eased = t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    page.camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.position, eased);
    page.controls.target.lerpVectors(cameraMove.fromTarget, cameraMove.target, eased);
    if (t === 1) cameraMove = null;
  }

  /** Drop a glide in flight: a drag wins over it, and a new figure ends it. */
  function cancel() {
    cameraMove = null;
  }

  Object.assign(glide, {
    advanceCamera,
    cancel,
    moveCamera,
  });
  return glide;
}
