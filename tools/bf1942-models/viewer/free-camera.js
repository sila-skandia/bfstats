/**
 * The free camera: fly and pan navigation, the altitude clamp, the speed and
 * nav-mode toggles, placing and resetting the camera over a level, and the
 * look it steers by. Split out of `page-input.js`, which keeps the devices.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `camera`, `captured`, `car`, `extras`, `FLY_SLOW`,
 * `FLY_SPEED`, `getFloorAltitude`, `groundHeight`, `keys`, `leavePilot`,
 * `optOnFoot`, `optPilot`, `params`, `soldier`, `spawnAtFlag`,
 * `touchFlying`, `updateHud`.
 */
export function createFreeCamera(page) {
  const freeCamera = {};
  // The camera's orientation, which every view but a seat's steers by (the
  // free camera, the soldier's eye, the death cam). Written here and nowhere
  // else: the others aim it (`setLook`) or turn it (`turnLook`).
  const look = { yaw: 0, pitch: -0.15 };
  freeCamera.look = look;
  freeCamera.setLook = (yaw, pitch) => {
    look.yaw = yaw;
    look.pitch = pitch;
  };
  /** A mouse delta at `sens` radians a count, pitch held inside +-1.2. */
  freeCamera.turnLook = (dx, dy, sens) => {
    look.yaw -= dx * sens;
    look.pitch = Math.max(-1.2, Math.min(1.2, look.pitch - dy * sens));
  };

  freeCamera.navMode = 'fly'; // 'fly' or 'pan'

  function clampAltitude() {
    if (page.optPilot.checked && (page.aircraft || page.car)) return;
    const floor = page.getFloorAltitude(page.camera.position.x, page.camera.position.z);
    if (page.camera.position.y < floor) {
      page.camera.position.y = floor;
    }
  }

  function panCamera(dx, dy) {
    // A body owns the camera while it is on foot; pan and dolly would fight it
    // for one frame and then lose to the next tick anyway.
    if (page.optOnFoot.checked) return;
    const gh = page.groundHeight(page.camera.position.x, page.camera.position.z);
    const alt = Number.isFinite(gh) ? Math.max(page.camera.position.y - gh, 15) : Math.max(page.camera.position.y, 15);
    const panSpeed = alt * 0.0018 * (isSlow() ? 0.35 : 1.0);

    const cy = Math.cos(look.yaw), sy = Math.sin(look.yaw);
    const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);

    const rx = -cy, rz = sy;
    const ux = -sy * sp, uy = cp, uz = -cy * sp;

    page.camera.position.x += (-rx * dx - ux * dy) * panSpeed;
    page.camera.position.y += (-uy * dy) * panSpeed;
    page.camera.position.z += (-rz * dx - uz * dy) * panSpeed;

    clampAltitude();
  }

  function dollyCamera(delta) {
    if (page.optOnFoot.checked) return;
    const d = lookVector();
    const gh = page.groundHeight(page.camera.position.x, page.camera.position.z);
    const alt = Number.isFinite(gh) ? Math.max(page.camera.position.y - gh, 15) : Math.max(page.camera.position.y, 15);
    const zoomFactor = alt * 0.003 * (isSlow() ? 0.35 : 1.0);
    const step = delta * zoomFactor;

    page.camera.position.x += d.x * step;
    page.camera.position.y += d.y * step;
    page.camera.position.z += d.z * step;
    clampAltitude();
  }

  freeCamera.initialCameraPose = null;

  function placeCamera() {
    // ?cam=x,y,z,yaw,pitch pins the camera for reproducible screenshots.
    const pinned = (page.params.get('cam') || '').split(',').map(Number);
    if (pinned.length === 5 && pinned.every(Number.isFinite)) {
      page.camera.position.set(pinned[0], pinned[1], pinned[2]);
      freeCamera.setLook(pinned[3], pinned[4]);
      applyLook();
      freeCamera.initialCameraPose = { x: pinned[0], y: pinned[1], z: pinned[2], yaw: pinned[3], pitch: pinned[4] };
      return;
    }
    const cam = page.extras.camera;
    if (cam) {
      page.camera.position.set(cam[0], cam[1] + 55, cam[2]);
    } else {
      page.camera.position.set(0, 80, 0);
    }
    freeCamera.setLook(Math.PI, -0.22);
    applyLook();
    freeCamera.initialCameraPose = { x: page.camera.position.x, y: page.camera.position.y, z: page.camera.position.z, yaw: look.yaw, pitch: look.pitch };
  }

  function resetCamera() {
    page.leavePilot();
    // On foot R respawns rather than resetting the camera — the keydown handler
    // routes it to `spawnAtFlag` before it ever reaches here — but a reset that
    // arrives from the on-screen button must not kick the player out of the mode
    // or move a camera the body owns.
    if (page.optOnFoot.checked && page.soldier) {
      page.spawnAtFlag(true);
      return;
    }
    if (freeCamera.initialCameraPose) {
      page.camera.position.set(freeCamera.initialCameraPose.x, freeCamera.initialCameraPose.y, freeCamera.initialCameraPose.z);
      freeCamera.setLook(freeCamera.initialCameraPose.yaw, freeCamera.initialCameraPose.pitch);
      applyLook();
    } else {
      placeCamera();
    }
  }

  freeCamera.speedMode = 'fast'; // 'fast' or 'slow'

  function isSlow() {
    return page.keys.has('ShiftLeft') || page.keys.has('ShiftRight') || freeCamera.speedMode === 'slow';
  }

  const speedToggleBtn = document.getElementById('speed-toggle-btn');
  function setSpeedMode(mode) {
    freeCamera.speedMode = mode;
    if (speedToggleBtn) {
      speedToggleBtn.dataset.speed = mode;
      const badge = speedToggleBtn.querySelector('.speed-badge');
      const hint = speedToggleBtn.querySelector('.speed-hint');
      if (badge) badge.textContent = mode.toUpperCase();
      if (hint) hint.textContent = mode === 'fast' ? 'Tap for slow' : 'Tap for fast';
    }
  }
  speedToggleBtn?.addEventListener('click', e => {
    e.stopPropagation();
    setSpeedMode(freeCamera.speedMode === 'fast' ? 'slow' : 'fast');
  });

  const modeToggleBtn = document.getElementById('mode-toggle-btn');
  const resetCamBtn = document.getElementById('reset-cam-btn');
  const mapActionsBar = document.getElementById('map-actions');

  function setNavMode(mode) {
    freeCamera.navMode = mode;
    if (modeToggleBtn) {
      modeToggleBtn.dataset.mode = mode;
      const badge = modeToggleBtn.querySelector('.mode-badge') || modeToggleBtn.querySelector('.action-badge');
      const hint = modeToggleBtn.querySelector('.mode-hint') || modeToggleBtn.querySelector('.action-hint');
      if (badge) badge.textContent = mode.toUpperCase();
      if (hint) hint.textContent = mode === 'fly' ? 'Tap for pan' : 'Tap for fly';
    }
    page.updateHud();
  }

  modeToggleBtn?.addEventListener('click', e => {
    e.stopPropagation();
    setNavMode(freeCamera.navMode === 'fly' ? 'pan' : 'fly');
  });

  resetCamBtn?.addEventListener('click', e => {
    e.stopPropagation();
    resetCamera();
  });

  mapActionsBar?.addEventListener('pointerdown', e => {
    e.stopPropagation();
  });


  function flySpeed() {
    return page.FLY_SPEED * (isSlow() ? page.FLY_SLOW : 1);
  }

  function lookVector() {
    const cy = Math.cos(look.yaw), sy = Math.sin(look.yaw);
    const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
    return { x: sy * cp, y: sp, z: cy * cp, cy, sy };
  }

  function applyLook() {
    const d = lookVector();
    page.camera.lookAt(
      page.camera.position.x + d.x,
      page.camera.position.y + d.y,
      page.camera.position.z + d.z,
    );
  }

  function fly(dt) {
    if (!page.captured) return;
    const step = flySpeed() * dt;
    const fwd = (page.keys.has('KeyW') || page.touchFlying ? 1 : 0) - (page.keys.has('KeyS') ? 1 : 0);
    const strafe = (page.keys.has('KeyD') ? 1 : 0) - (page.keys.has('KeyA') ? 1 : 0);
    const vert = (page.keys.has('KeyE') ? 1 : 0) - (page.keys.has('KeyQ') ? 1 : 0);
    const d = lookVector();
    page.camera.position.x += (d.x * fwd - d.cy * strafe) * step;
    page.camera.position.y += (d.y * fwd + vert) * step;
    page.camera.position.z += (d.z * fwd + d.sy * strafe) * step;
    clampAltitude();
  }

  Object.assign(freeCamera, {
    applyLook,
    clampAltitude,
    dollyCamera,
    fly,
    flySpeed,
    isSlow,
    lookVector,
    panCamera,
    placeCamera,
    resetCamera,
    setNavMode,
    setSpeedMode,
  });
  return freeCamera;
}
