// The page's input devices: the keyboard (the game's own bindings for the
// soldier, the seats and the free camera), the mouse and pointer lock, the
// touch pad and buttons on a phone, the full-screen keyboard lock, and the
// free-fly camera they steer when nobody is in the world. What reaches the
// simulation is sampled once a frame in the frame loop and handed to
// `world.setInput`. Lifted out of map.html (features/vehicle-instance-
// refactor Part 2).

import { GameConsole } from './console.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `AIR_KEYS`, `aircraft`, `altFireDemolitions`, `bfmap`, `camera`,
 * `cancelDeploy`, `car`, `consoleCaptures`, `cycleKitWeapon`, `cycleView`,
 * `deployActive`, `deploySpawn`, `ensureAudioContext`, `enterVehicle`,
 * `escMenu`, `escMenuCaptures`, `exitSeat`, `extras`, `FLY_KEYS`,
 * `FLY_SLOW`, `FLY_SPEED`, `FOOT_KEYS`, `footView3p`, `fullmapBox`,
 * `gameConsole`, `getFloorAltitude`, `groundHeight`, `handWeapon`, `hud`,
 * `isTouchDevice`, `itemsLocked`, `leavePilot`, `LOCAL_PLAYER`, `lookDelta`,
 * `mannedActive`, `mouseInput`, `nearEntry`, `occupancy`, `openDeploy`,
 * `optOnFoot`, `optPilot`, `params`, `renderer`, `scoreboardOpen`,
 * `scoreFromSpawn`, `selectDeployFlag`, `selectKitWeapon`, `setConsoleOpen`,
 * `setEscMenu`, `setScoreboard`, `soldier`, `soldierDead`, `spawnAtFlag`,
 * `stage`, `startReload`, `switchSeat`, `toggleFullMap`, `toggleProne`,
 * `uiFocused`, `updateHud`, `view`, `world`.
 */
export function createPageInput(page) {
  const pageInput = {};

  const keys = new Set();
  const look = { yaw: 0, pitch: -0.15 };
  pageInput.captured = false;
  pageInput.lockHeld = false;
  pageInput.dragging = false;
  pageInput.lastPointerX = 0;
  pageInput.lastPointerY = 0;
  pageInput.navMode = 'fly'; // 'fly' or 'pan'

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

  pageInput.initialCameraPose = null;

  function placeCamera() {
    // ?cam=x,y,z,yaw,pitch pins the camera for reproducible screenshots.
    const pinned = (page.params.get('cam') || '').split(',').map(Number);
    if (pinned.length === 5 && pinned.every(Number.isFinite)) {
      page.camera.position.set(pinned[0], pinned[1], pinned[2]);
      look.yaw = pinned[3];
      look.pitch = pinned[4];
      applyLook();
      pageInput.initialCameraPose = { x: pinned[0], y: pinned[1], z: pinned[2], yaw: pinned[3], pitch: pinned[4] };
      return;
    }
    const cam = page.extras.camera;
    if (cam) {
      page.camera.position.set(cam[0], cam[1] + 55, cam[2]);
    } else {
      page.camera.position.set(0, 80, 0);
    }
    look.yaw = Math.PI;
    look.pitch = -0.22;
    applyLook();
    pageInput.initialCameraPose = { x: page.camera.position.x, y: page.camera.position.y, z: page.camera.position.z, yaw: look.yaw, pitch: look.pitch };
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
    if (pageInput.initialCameraPose) {
      page.camera.position.set(pageInput.initialCameraPose.x, pageInput.initialCameraPose.y, pageInput.initialCameraPose.z);
      look.yaw = pageInput.initialCameraPose.yaw;
      look.pitch = pageInput.initialCameraPose.pitch;
      applyLook();
    } else {
      placeCamera();
    }
  }

  pageInput.speedMode = 'fast'; // 'fast' or 'slow'

  function isSlow() {
    return keys.has('ShiftLeft') || keys.has('ShiftRight') || pageInput.speedMode === 'slow';
  }

  const speedToggleBtn = document.getElementById('speed-toggle-btn');
  function setSpeedMode(mode) {
    pageInput.speedMode = mode;
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
    setSpeedMode(pageInput.speedMode === 'fast' ? 'slow' : 'fast');
  });

  const modeToggleBtn = document.getElementById('mode-toggle-btn');
  const resetCamBtn = document.getElementById('reset-cam-btn');
  const mapActionsBar = document.getElementById('map-actions');

  function setNavMode(mode) {
    pageInput.navMode = mode;
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
    setNavMode(pageInput.navMode === 'fly' ? 'pan' : 'fly');
  });

  resetCamBtn?.addEventListener('click', e => {
    e.stopPropagation();
    resetCamera();
  });

  mapActionsBar?.addEventListener('pointerdown', e => {
    e.stopPropagation();
  });

  const mobileControls = document.getElementById('mobile-controls');
  const mobilePad = document.getElementById('mobile-pad');
  const mobilePadPuck = document.getElementById('mobile-pad-puck');
  const mobilePadLabel = document.getElementById('mobile-pad-label');
  const mobileFireBtn = document.getElementById('mobile-fire-btn');
  const mobileUseBtn = document.getElementById('mobile-use-btn');
  const mobileViewBtn = document.getElementById('mobile-view-btn');
  const mobileJumpBtn = document.getElementById('mobile-jump-btn');
  const mobileThrottleWrap = document.getElementById('mobile-throttle-wrap');
  const mobileThrottleInput = document.getElementById('mobile-throttle');
  const mobileThrottleValue = document.getElementById('mobile-throttle-value');
  const MOBILE_PAD_RADIUS = 48;
  const MOBILE_AIM_PIXELS_PER_SECOND = 720;
  const mobilePadVector = { x: 0, y: 0 };
  pageInput.mobilePadPointerId = null;
  pageInput.mobilePadHeld = false;
  pageInput.mobileFireHeld = false;
  pageInput.mobileJumpHeld = false;
  pageInput.mobileThrottle = 0;
  pageInput.mobileThrottleTouched = false;
  pageInput.mobileControlsSignature = '';

  function clampMobileInput(value) {
    return Math.max(-1, Math.min(1, value));
  }

  function mobilePadAxis(axis) {
    return pageInput.mobilePadHeld ? mobilePadVector[axis] : 0;
  }

  /**
   * The touch pad's contribution to the same input stage the mouse feeds.
   *
   * A pad has a deflection, not a count rate, and the engine has no reading to
   * transcribe here: BF1942's own controller support binds a stick through the
   * same `axisToAxis` arm, so a real gamepad arrives already counted. The
   * viewer's own choice, stated rather than transcribed, is that **full
   * deflection is a hand moving `MOBILE_AIM_PIXELS_PER_SECOND` pixels a
   * second** -- which keeps the pad in the same currency as the mouse, so the
   * sensitivity profiles, the +-16 saturation and `countsPerPixel` all reach it
   * unchanged, and one knob moves both.
   *
   * `-y` because the pad reports up-positive and the mouse (and DirectInput)
   * report down-positive.
   */
  function feedMobileTurretAim(dt) {
    if (!pageInput.mobilePadHeld || !page.occupancy?.turret) return;
    page.mouseInput.accumulateDeflection(
      mobilePadVector.x, -mobilePadVector.y, dt, MOBILE_AIM_PIXELS_PER_SECOND);
  }

  function resetMobilePad() {
    pageInput.mobilePadPointerId = null;
    pageInput.mobilePadHeld = false;
    mobilePadVector.x = 0;
    mobilePadVector.y = 0;
    mobilePadPuck.style.transform = 'translate(-50%, -50%)';
    mobilePad.classList.remove('is-active');
  }

  function resetMobileControls() {
    resetMobilePad();
    pageInput.mobileFireHeld = false;
    pageInput.mobileJumpHeld = false;
    pageInput.mobileThrottle = 0;
    pageInput.mobileThrottleTouched = false;
    pageInput.releaseButtons();
    mobileFireBtn.classList.remove('is-active');
    mobileJumpBtn.classList.remove('is-active');
    mobilePadPuck.classList.remove('is-firing');
    mobileThrottleInput.value = '0';
    mobileThrottleValue.value = '0';
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', 0);
    updateMobileControls();
  }

  function syncMobileThrottle() {
    if (!page.aircraft) return;
    const current = page.aircraft.input('c_PIThrottle');
    if (!pageInput.mobileThrottleTouched || Math.abs(current - pageInput.mobileThrottle) > 0.01) {
      pageInput.mobileThrottle = Math.max(0, Math.min(1, current));
      mobileThrottleInput.value = String(Math.round(pageInput.mobileThrottle * 100));
    }
    mobileThrottleValue.value = String(Math.round(pageInput.mobileThrottle * 100));
  }

  function updateMobileControls() {
    if (!page.isTouchDevice) return;
    const deployOpen = document.getElementById('fullmap')?.classList.contains('deploy');
    const onFoot = page.optOnFoot.checked && page.soldier && !page.soldierDead;
    const seated = page.optPilot.checked && page.occupancy;
    const activeSeat = seated && page.occupancy.isActiveRoot();
    const manned = seated && page.mannedActive();
    const aimable = manned && page.occupancy.turret;
    const driving = activeSeat && page.car;
    const flying = activeSeat && page.aircraft;
    const show = pageInput.captured && !deployOpen && (onFoot || seated);
    const padMode = flying ? 'STICK' : driving ? 'DRIVE' : aimable ? 'AIM' : onFoot ? 'MOVE' : 'SEAT';
    const canFire = onFoot || (seated && (driving || flying || aimable)
      && page.occupancy.activeFireArmsNodes().length > 0);
    const signature = [
      show, padMode, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', pageInput.mobileThrottleTouched,
    ].join('|');
    if (signature === pageInput.mobileControlsSignature) return;
    pageInput.mobileControlsSignature = signature;

    mobileControls.hidden = !show;
    mobilePad.hidden = !(onFoot || driving || flying || aimable);
    mobilePadLabel.textContent = padMode;
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', pageInput.mobileFireHeld && canFire);
    mobileJumpBtn.hidden = !onFoot;
    mobileJumpBtn.classList.toggle('is-active', pageInput.mobileJumpHeld && onFoot);
    mobileUseBtn.hidden = !(onFoot || seated);
    mobileUseBtn.disabled = onFoot ? !page.nearEntry : !seated;
    mobileUseBtn.textContent = onFoot ? (page.nearEntry ? `ENTER ${page.nearEntry.control}` : 'ENTER') : 'EXIT';
    mobileViewBtn.hidden = !((seated && page.view) || (onFoot && page.footView3p.modes.length > 1));
    mobileThrottleWrap.hidden = !flying;
    if (flying) syncMobileThrottle();
    mobileControls.dataset.mode = padMode;
  }

  function updateMobilePad(event) {
    const rect = mobilePad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, MOBILE_PAD_RADIUS);
    const angle = Math.atan2(dy, dx);
    const px = Math.cos(angle) * clamped;
    const py = Math.sin(angle) * clamped;
    mobilePadVector.x = clampMobileInput(px / MOBILE_PAD_RADIUS);
    mobilePadVector.y = clampMobileInput(-py / MOBILE_PAD_RADIUS);
    mobilePadPuck.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), calc(-50% + ${py.toFixed(1)}px))`;
    mobilePad.classList.add('is-active');
  }

  function releaseMobilePad(event) {
    if (pageInput.mobilePadPointerId !== null && event.pointerId !== pageInput.mobilePadPointerId) return;
    try {
      if (mobilePad.hasPointerCapture(event.pointerId)) mobilePad.releasePointerCapture(event.pointerId);
    } catch {}
    resetMobilePad();
  }

  function setMobileFire(on) {
    pageInput.mobileFireHeld = on;
    pageInput.setTouchTriggers(
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileFireBtn.classList.toggle('is-active', on);
    mobilePadPuck.classList.toggle('is-firing', on);
  }

  function setMobileJump(on) {
    pageInput.mobileJumpHeld = on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead;
    mobileJumpBtn.classList.toggle('is-active', pageInput.mobileJumpHeld);
  }

  function mobileSeatToggle() {
    if (!pageInput.seatToggleReady()) return;
    if (page.optOnFoot.checked && page.soldier && page.nearEntry) {
      setFly(true);
      page.enterVehicle(page.nearEntry);
      pageInput.noteSeatToggle();
    } else if (page.optPilot.checked && page.occupancy) {
      page.exitSeat();
      pageInput.noteSeatToggle();
    }
    resetMobileControls();
  }

  mobilePad.addEventListener('pointerdown', event => {
    if (pageInput.mobilePadPointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    setFly(true);
    page.ensureAudioContext();
    pageInput.mobilePadPointerId = event.pointerId;
    pageInput.mobilePadHeld = true;
    try { mobilePad.setPointerCapture(event.pointerId); } catch {}
    updateMobilePad(event);
    updateMobileControls();
  });

  mobilePad.addEventListener('pointermove', event => {
    if (!pageInput.mobilePadHeld || event.pointerId !== pageInput.mobilePadPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateMobilePad(event);
  });

  mobilePad.addEventListener('pointerup', releaseMobilePad);
  mobilePad.addEventListener('pointercancel', releaseMobilePad);

  mobileFireBtn.addEventListener('pointerdown', event => {
    if (mobileFireBtn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setFly(true);
    page.ensureAudioContext();
    try { mobileFireBtn.setPointerCapture(event.pointerId); } catch {}
    setMobileFire(true);
  });

  function releaseMobileFire(event) {
    try {
      if (mobileFireBtn.hasPointerCapture(event.pointerId)) mobileFireBtn.releasePointerCapture(event.pointerId);
    } catch {}
    setMobileFire(false);
  }

  mobileFireBtn.addEventListener('pointerup', releaseMobileFire);
  mobileFireBtn.addEventListener('pointercancel', releaseMobileFire);

  mobileJumpBtn.addEventListener('pointerdown', event => {
    if (mobileJumpBtn.disabled || mobileJumpBtn.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setFly(true);
    try { mobileJumpBtn.setPointerCapture(event.pointerId); } catch {}
    setMobileJump(true);
  });

  function releaseMobileJump(event) {
    try {
      if (mobileJumpBtn.hasPointerCapture(event.pointerId)) mobileJumpBtn.releasePointerCapture(event.pointerId);
    } catch {}
    setMobileJump(false);
  }

  mobileJumpBtn.addEventListener('pointerup', releaseMobileJump);
  mobileJumpBtn.addEventListener('pointercancel', releaseMobileJump);

  mobileUseBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileUseBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setFly(true);
    mobileSeatToggle();
  });

  mobileViewBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileViewBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setFly(true);
    page.cycleView();
  });

  mobileThrottleWrap.addEventListener('pointerdown', event => event.stopPropagation());
  mobileThrottleInput.addEventListener('pointerdown', event => event.stopPropagation());
  mobileThrottleInput.addEventListener('input', () => {
    pageInput.mobileThrottle = Math.max(0, Math.min(1, Number(mobileThrottleInput.value) / 100 || 0));
    pageInput.mobileThrottleTouched = true;
    mobileThrottleValue.value = String(Math.round(pageInput.mobileThrottle * 100));
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', pageInput.mobileThrottle);
  });

  window.addEventListener('blur', resetMobileControls);

  function flySpeed() {
    return page.FLY_SPEED * (isSlow() ? page.FLY_SLOW : 1);
  }

  addEventListener('keydown', e => {
    // The console gets first refusal on every key. Tilde toggles it (the
    // game's `c_GIToggleConsole`); while it is up it eats the keyboard, so
    // movement, fire, the deploy screen and the map never see a keystroke —
    // the same gate the engine puts in front of `Setup`'s input dispatch.
    if (GameConsole.isToggleKey(e)) {
      e.preventDefault();
      page.setConsoleOpen(!page.gameConsole.open);
      return;
    }
    if (page.consoleCaptures()) {
      if (e.code === 'Escape') { page.setConsoleOpen(false); return; }
      if (page.gameConsole.keydown(e)) e.preventDefault();
      return;
    }
    // Under the Escape menu the keyboard is the menu's, the way it is the
    // console's above: the list and the arrow keys answer, and nothing behind
    // it moves. Escape is the way back to the game.
    if (page.escMenuCaptures()) {
      if (e.code === 'Escape') { page.setEscMenu(false); return; }
      if (page.escMenu?.keydown(e)) e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      // The map is the topmost thing Escape can dismiss. In its deploy state
      // it is dismissed with intent: a redeploy resumes the life in progress,
      // and a join nobody committed to leaves for the free camera, which is
      // what closing the game's own spawn menu does on a server that allows
      // it. Under `?kblock` Escape is a locked key and reaches the page in
      // fullscreen too; the browser leaves the fullscreen only on a long
      // press, and `kbLockLeave` is the page's own way out of a session the
      // pointer has already left.
      //
      // With all of those away, Escape is the game's own: it brings up the
      // menu, in one press even mid-play, because the browser has already
      // taken the pointer lock off us by the time this runs.
      if (page.scoreboardOpen()) page.setScoreboard(false);
      else if (page.deployActive()) page.cancelDeploy();
      else if (!page.fullmapBox.hidden) page.toggleFullMap(false);
      else if (pageInput.kbSession && !pageInput.captured && !e.repeat) kbLockLeave();
      else if (!e.repeat) page.setEscMenu(true);
      return;
    }
    // Caps Lock toggles the spawn menu even while a sidebar control is focused,
    // matching Escape's privilege over form focus.
    if (e.code === 'CapsLock' && !e.repeat) {
      if (page.deployActive()) page.cancelDeploy();
      else if (!page.optPilot.checked) page.openDeploy();
      return;
    }
    // Deploy owns Enter and 1-9 even when a sidebar INPUT/SELECT is focused:
    // otherwise Enter toggles `#onfoot` or activates RESUME and the commit
    // either never runs or is immediately undone into fly-through. Not while
    // the score board stands in for the screen: the spawn interface is not up
    // to be driven, and DONE or Escape is the way back to it.
    if (page.deployActive() && !page.scoreFromSpawn) {
      if (e.code === 'Enter' && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        page.deploySpawn();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        page.selectDeployFlag(Number(digit[1]) - 1);
        return;
      }
    }
    if (page.uiFocused()) return;
    // Caps Lock is also handled above; M is `c_PIMap` in the game's own maps.
    // On foot the map opens in its deploy state — the game's own map is also
    // its spawn screen — and Escape or M again puts it away without moving you.
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (page.deployActive()) page.cancelDeploy();
      else if (page.fullmapBox.hidden && page.optOnFoot.checked && page.soldier
               && !page.optPilot.checked) {
        // On foot, but not merely suspended in a seat: a driver's M is the
        // plain map, because his soldier is still ticked and still alive.
        page.openDeploy();
      } else page.toggleFullMap();
      return;
    }
    // Tab is `c_PIShowScoreBoard`, `c_CMPushAndHold` in every shipped control
    // map: the board is up for as long as the key is down. Not over the spawn
    // screen, whose own SCORE BOARD button is the way in there.
    if (e.code === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat && !page.deployActive() && !page.scoreboardOpen()) page.setScoreboard(true, false);
      return;
    }
    // N is `c_PIZoomMap`: it steps the minimap's three-level zoom counter
    // (bfmap.js). Behind the same gates as M — the console, the Escape menu and
    // a focused form control have all returned above.
    if (e.code === 'KeyN' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      page.bfmap.zoomIn();
      return;
    }
    // Seated in anything, the same row switches seats instead (SEAT-23/24,
    // verify-r5.md's `c_PIMenuSelect1..9`) — checked after the deploy screen's
    // own use of these keys above, since the two are never active together.
    if (page.optPilot.checked && page.occupancy && !e.repeat
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const seatDigit = /^Digit([1-9])$/.exec(e.code);
      if (seatDigit) {
        page.switchSeat(Number(seatDigit[1]) - 1);
        return;
      }
    }
    // On foot the row raises kit weapons instead: `ObjectTemplate.itemIndex` is
    // the inventory slot and the number key that selects it (1 knife .. 3
    // primary .. 5 special), so a key with no such slot in the spawned kit's
    // inventory does nothing, exactly as in the game.
    if (page.optOnFoot.checked && page.soldier && !e.repeat
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const kitDigit = /^Digit([1-9])$/.exec(e.code);
      if (kitDigit) {
        // Recorded in `keys` as well as acted on, and the reason is slot 9:
        // the engine gives `c_PIMenuSelect9` a second job on a falling soldier
        // (TemplateMessage 18 -> `setIsParachuting(true)`, `parachute.js`), and
        // the per-frame input word reads `keys`. This branch used to return
        // before `keys.add` and the ripcord never reached it.
        keys.add(e.code);
        page.selectKitWeapon(Number(kitDigit[1]));
        return;
      }
    }
    keys.add(e.code);
    if (e.code === 'KeyR') {
      // The seat is checked before the soldier: a driver who walked in on foot
      // still has his rifle slung, and R must reset the vehicle he is actually
      // holding the wheel of, not work the bolt.
      if (page.optPilot.checked && (page.aircraft || page.car)) {
        (page.aircraft || page.car).reset();
        page.world?.resetStick(page.LOCAL_PLAYER);
      } else if (page.optOnFoot.checked && page.soldier) {
        // R is the reload once there is a magazine to reload — the game's own
        // binding — and stays the respawn only for a soldier holding nothing
        // (a weapon glb that failed to load). Shift+R is the deliberate road
        // back: it reopens the deploy screen rather than guessing a flag.
        if (e.shiftKey) {
          if (!page.deployActive()) page.openDeploy();
        } else if (page.handWeapon?.data?.magazine) page.startReload();
        else page.spawnAtFlag(true);
      } else if (!page.optPilot.checked) {
        resetCamera();
      }
    }
    // E is `c_PIUse` (SEAT-2, verify-r5.md — the report's own correction: there
    // is no distinctly-named "enter/exit" enum value, vehicle use shares the
    // same trigger a real Use-key bind would), mapped to the physical E key.
    // In free fly E is already the vertical thrust, so both branches ask for a
    // mode first. The 1.0s per-player cooldown (SEAT-6) below gates the whole
    // branch, same as the real `toggleEntryPoint`.
    if (e.code === 'KeyE' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey
        && pageInput.seatToggleReady()) {
      // `exitSeat` picks the exit: the hull's own for a driver or a passenger
      // of a drivetrain, the seat's for a gunner or a seat of a hull with no
      // drive (`mannedActive()` is the check that is right either way).
      if (page.optPilot.checked && page.occupancy) {
        page.exitSeat();
        pageInput.noteSeatToggle();
      } else if (page.optOnFoot.checked && page.soldier && pageInput.captured && page.nearEntry) {
        page.enterVehicle(page.nearEntry);
        pageInput.noteSeatToggle();
      }
    }
    // C cycles the view, which is `c_PIToggleCameraMode` (input channel 26)
    // bound to IDKey_C in every one of the game's own control maps -- Infantry's
    // included, which is why it reaches a soldier at all. In a seat the seat's
    // own `VehicleCamera` owns the cycle (every seat has one: driver, passenger,
    // gunner, bare gun). On foot `soldier-camera.js` owns it, widened past the
    // engine's set of one by the server's soldier switch (server-settings.js).
    if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey) page.cycleView();
    // Z is `c_PILie`, a non-repetitive trigger, so it toggles rather than holds.
    if (e.code === 'KeyZ' && !e.repeat && page.optOnFoot.checked && page.soldier) page.toggleProne();
    if (pageInput.captured && (page.FLY_KEYS.has(e.code)
        || (page.optOnFoot.checked && page.FOOT_KEYS.has(e.code))
        || (page.optPilot.checked && page.AIR_KEYS.has(e.code)))) e.preventDefault();
  });
  addEventListener('keyup', e => {
    // Push-and-hold: the board held up on Tab goes with the key, whatever else
    // has the keyboard by then. One opened from the spawn screen stays.
    if (e.code === 'Tab' && page.scoreboardOpen() && !page.scoreFromSpawn) page.setScoreboard(false);
    // A key released under an open console must not reach `keys` either: the
    // set is only ever read for movement, and the console has the keyboard.
    // The Escape menu has it on the same terms.
    if (page.consoleCaptures() || page.escMenuCaptures()) return;
    keys.delete(e.code);
  });

  // Crouch is left Ctrl, for game parity with `c_PICrouch` -- but the browser
  // owns Ctrl+W outright by default, so firing while crouching still closes
  // the tab. Chromium's Keyboard Lock API (`navigator.keyboard.lock()`) can
  // reserve it, but only inside a fullscreen session the page has to request
  // first; that is prototyped behind `?kblock`, off by default (`kbLockEnter`,
  // below). Without it -- and in Firefox and Safari, which have no Keyboard
  // Lock -- the only lever a page has is asking before the tab actually goes,
  // the way any unsaved-work page does. Scoped to mid-play (captured, on foot,
  // a live soldier) so it never fires over the spawn screen or a fly-by.
  // Chromium shows the prompt only for a page that has had a real click or key
  // press since it loaded, which mid-play always has.
  addEventListener('beforeunload', e => {
    if (!(pageInput.captured && page.optOnFoot.checked && page.soldier)) return;
    e.preventDefault();
    e.returnValue = '';
  });

  const sideEl = document.getElementById('side');
  const sideCollapseBtn = document.getElementById('side-collapse-btn');
  const mapFabBtn = document.getElementById('map-controls-fab');

  function setSideCollapsed(collapsed) {
    sideEl.classList.toggle('side-collapsed', collapsed);
    if (mapFabBtn) mapFabBtn.hidden = !collapsed;
  }
  sideCollapseBtn?.addEventListener('click', e => {
    e.stopPropagation();
    setSideCollapsed(true);
  });
  mapFabBtn?.addEventListener('click', e => {
    e.stopPropagation();
    setSideCollapsed(false);
  });
  // Debug options start pulled away on every screen size; the fab restores them.
  setSideCollapsed(true);

  /** The seated player's two triggers, straight off the mouse: left is the
   *  vehicle's `c_PIFire`, right its `c_PIAltFire`. Which weapon either one
   *  reaches is the weapon's own business — a Sherman's cannon declares the
   *  first and its coaxial machine gun the second, a Corsair's guns the first
   *  and its bombs the second — so nothing here names a gun. Space still works
   *  and still means `c_PIFire`; it was the only binding there was. */
  pageInput.seatFire = false;
  pageInput.seatAltFire = false;

  // SEAT-6 (verify-r5.md, confirmed both passes): `toggleEntryPoint` opens with
  // a hard-coded 1.0s cooldown per player, refreshed on every actual toggle
  // (both `exitPlayer` and `toggleEntryPoint`'s own success path) — not a
  // per-vehicle or per-entry-point value. One shared timestamp is therefore
  // correct for this page's single soldier.
  const SEAT_TOGGLE_COOLDOWN_MS = 1000;
  pageInput.lastSeatToggle = -Infinity;

  // Rewritten under `?kblock` the Escape hint changes for as long as the
  // fullscreen session lasts (kbLockEnter). Without it this never changes.
  pageInput.HUD_FOOT = 'WASD move · Shift walk · Ctrl crouch · Z prone · Space jump · '
    + 'LMB fire · RMB aim · R reload · C view · 9 chute · CapsLock / M redeploy · Esc menu';
  const HUD_FOOT_PLAIN = pageInput.HUD_FOOT;
  const HUD_FOOT_KBLOCK = `${HUD_FOOT_PLAIN} · hold Esc exits full screen`;

  // The soldier's two buttons, while pointer-locked on foot: the left held,
  // one queued semi-auto shot per press (the hand weapon spends it with
  // `dropClick`), and the right held, which zooms only mod weapons without
  // `altFireOnce`. These five are written here and nowhere else.
  pageInput.triggerHeld = false;
  pageInput.clickQueued = false;
  pageInput.aimHeld = false;

  /** Every button let go: nothing held across a mode change, an Escape, a
   *  console or a seat change may still be pulling a trigger afterwards. */
  pageInput.releaseButtons = () => {
    pageInput.triggerHeld = false;
    pageInput.clickQueued = false;
    pageInput.aimHeld = false;
    pageInput.seatFire = false;
    pageInput.seatAltFire = false;
  };
  /** The left button on foot: held, and a press queues one shot. */
  pageInput.pressTrigger = on => {
    pageInput.triggerHeld = !!on;
    if (on) pageInput.clickQueued = true;
  };
  pageInput.setAim = on => { pageInput.aimHeld = !!on; };
  /** The seat's `c_PIFire` and `c_PIAltFire`. */
  pageInput.setSeatTriggers = (main, alt = false) => {
    pageInput.seatFire = !!main;
    pageInput.seatAltFire = !!alt;
  };
  /** The hand weapon has spent (or refused) the queued shot. */
  pageInput.dropClick = () => { pageInput.clickQueued = false; };
  /** The touch FIRE button: the soldier's trigger (a press queues its shot)
   *  and the seat's `c_PIFire`, whichever the mode lets it reach. */
  pageInput.setTouchTriggers = (foot, seat) => {
    pageInput.triggerHeld = foot;
    pageInput.clickQueued = foot;
    pageInput.seatFire = seat;
  };
  /** SEAT-6's cooldown, shared by the E key and the touch ENTER button. */
  pageInput.seatToggleReady = () => performance.now() - pageInput.lastSeatToggle >= SEAT_TOGGLE_COOLDOWN_MS;
  pageInput.noteSeatToggle = () => { pageInput.lastSeatToggle = performance.now(); };

  function setFly(on) {
    pageInput.captured = on;
    if (on && page.isTouchDevice && !sideEl.classList.contains('side-collapsed')) {
      setSideCollapsed(true);
    }
    if (!on) {
      pageInput.dragging = false;
      pageInput.lockHeld = false;
      // A trigger held across an Escape must not still be firing when the
      // pointer comes back.
      pageInput.releaseButtons();
      if (document.pointerLockElement === page.renderer.domElement) {
        document.exitPointerLock();
      }
    }
    updateMobileControls();
  }
  function capture() {
    setFly(true);
    page.ensureAudioContext();
    // The lock is asked for, not depended on: Chrome refuses one for about a
    // second after the player pressed Escape out of the last one, and it
    // rejects rather than throws. `captured` is already true either way, so
    // dragging still turns the view and the next click takes the lock.
    const lock = page.renderer.domElement.requestPointerLock();
    if (lock && typeof lock.catch === 'function') lock.catch(() => {});
    // After the pointer, never before: fullscreen spends the click's user
    // activation, and Chrome 149 refuses a pointer lock asked for after it.
    kbLockEnter();
  }
  function release() {
    setFly(false);
  }

  // --- Keyboard Lock, prototype (`?kblock`, off by default) ------------------
  //
  // Crouch-walking is Ctrl+W, and Chrome claims Ctrl+W before the page sees it:
  // IDC_CLOSE_TAB is one of the commands `BrowserCommandController::
  // IsReservedCommandOrKey` reserves, so no preventDefault stops the tab
  // closing. `navigator.keyboard.lock()` is the page's one lever. A locked key
  // reaches the page with every modifier -- locking KeyW sends Control+W and
  // Control+Shift+W to the page (WICG Keyboard Lock) -- because Chromium's view
  // marks it `skip_if_unhandled` and the browser never pre-handles it
  // (render_widget_host_view_event_handler.cc). The lock is live only while
  // the tab is in a fullscreen the page itself requested
  // (`KeyboardLockController::LockKeyboard` checks IsFullscreen(); F11 does not
  // count), so on foot, at capture, this asks for both.
  //
  // Measured headless in Chromium 141 and Chrome 149
  // (features/mesh-viewer-performance, Keyboard Lock):
  //  - requestFullscreen() consumes the click's activation; requestPointerLock()
  //    and keyboard.lock() do not.
  //  - keyboard.lock() needs no activation and resolves once the browser has
  //    registered the request, fullscreen or not -- the promise says nothing
  //    about whether the key is reserved.
  //  - requestFullscreen({ keyboardLock }) is not implemented; the option is
  //    never read.
  //  - With Escape locked, a short Escape reaches the page, so it still releases
  //    capture, cancels the deploy screen and closes the map; the browser leaves
  //    fullscreen only after Escape is held. Unlocked, the first Escape leaves
  //    fullscreen and the page never sees it.
  // Chromium drops the lock while the window is unfocused and re-arms it on
  // focus (`RenderWidgetHostImpl::SetPageFocus`). Firefox and Safari have no
  // navigator.keyboard: there, as without `?kblock`, nothing here runs and the
  // beforeunload prompt above is the only guard.
  const KBLOCK = page.params.has('kblock') && typeof navigator.keyboard?.lock === 'function'
    && !page.isTouchDevice;
  // Every key on-foot play holds Ctrl with -- walking, strafing, a crouched
  // reload (Ctrl+R reloads the page), E, Z, M, jump -- and Escape, so its short
  // press stays the page's. Keys the game does not bind stay the browser's: a
  // deliberate Ctrl+T still opens a tab.
  const KBLOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyZ',
                       'KeyM', 'Space', 'Escape'];
  pageInput.kbSession = false;        // inside the fullscreen this page asked for
  pageInput.kbLockState = 'idle';     // what lock() last said; the ?shots hook reads it

  function kbLockEnter() {
    if (!KBLOCK || !(page.optOnFoot.checked && page.soldier)) return;
    if (document.fullscreenElement !== page.stage) page.stage.requestFullscreen().catch(() => {});
    // Asked again on every capture: the session's own `fullscreenchange`
    // handler unlocks when the fullscreen ends, however it ends.
    navigator.keyboard.lock(KBLOCK_KEYS).then(
      () => { pageInput.kbLockState = 'requested'; },
      error => { pageInput.kbLockState = `rejected: ${error.name}`; });
  }

  // Leaving on-foot play ends the session, and so does the Escape that
  // closes the menu with the pointer already free.
  function kbLockLeave() {
    if (!pageInput.kbSession) return;
    navigator.keyboard.unlock();
    pageInput.kbLockState = 'unlocked';
    document.exitFullscreen().catch(() => {});
  }

  if (KBLOCK) {
    document.addEventListener('fullscreenchange', () => {
      const inside = document.fullscreenElement === page.stage;
      if (inside === pageInput.kbSession) return;
      pageInput.kbSession = inside;
      if (!inside) {
        navigator.keyboard.unlock();
        pageInput.kbLockState = 'unlocked';
      }
      const was = pageInput.HUD_FOOT;
      pageInput.HUD_FOOT = inside ? HUD_FOOT_KBLOCK : HUD_FOOT_PLAIN;
      if (page.hud.textContent === was) page.hud.textContent = pageInput.HUD_FOOT;
    });
  }
  pageInput.touchFlying = false;
  const activeTouches = new Map();
  pageInput.touchPinchDist = 0;
  pageInput.touchMidX = 0;
  pageInput.touchMidY = 0;
  pageInput.isPanning = false;

  function getTouchesCenterAndDist() {
    const pts = Array.from(activeTouches.values());
    if (pts.length < 2) return null;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return {
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2,
      dist: Math.hypot(dx, dy)
    };
  }

  // The bit a button sets in `e.buttons`, indexed by its own `e.button` number.
  // The two numberings disagree on middle vs. right: `button` calls middle 1
  // and right 2, `buttons` puts right at bit 2 (0x2) and middle at bit 4 (0x4).
  // Getting this backwards would read a right-click as a middle-click, so it
  // is a lookup table, not an arithmetic guess.
  const BUTTON_BIT = [1, 4, 2, 8, 16];

  // Real pointer lock, or -- under `?shots` -- captured and stood in for it,
  // the same way `canFire` (Infantry advance) already treats `?shots` as a
  // substitute for `captured` itself: headless Chromium never grants pointer
  // lock, so a harness has nothing else to gate on.
  function pointerLocked() {
    return document.pointerLockElement === page.renderer.domElement || page.params.has('shots');
  }

  // Left is `c_PIFire`, right is `c_PIAltFire` (`Infantry.con`) while captured,
  // on foot and pointer-locked -- the same gate `pointerdown` always checked.
  // A second button pressed while the first is already held never reaches
  // `pointerdown`: the browser reports it as a `pointermove` carrying the
  // button that changed (`e.button`) and the new chord (`e.buttons`), plus a
  // `mousedown` this page does not listen for. Releasing one of two held
  // buttons is the same story on `pointerup`'s side. `pointerdown`, `pointerup`
  // and that chorded `pointermove` all funnel through here so a chord is never
  // silently dropped -- confirmed against real Chromium event order with
  // `scratchpad/chord.cjs` (a held left + a right press/release fires
  // `pointermove button=2 buttons=3` then `buttons=1`, no `pointerdown`/`up`
  // at all for the right button).
  //
  // A release is handled before the gate, not after it: death or a redeploy
  // while the trigger is held nulls `soldier` out from under it (see the
  // `soldier = null` sites), and the pointerup that follows must still clear
  // `triggerHeld`/`aimHeld` or the next life starts with the trigger stuck.
  // A fresh press still needs the full gate -- there is no weapon, no rig and
  // no meaning to "zoomed" without one. Zoom is never touched on a release;
  // `altFireOnce` only toggles on a fresh press.
  function buttonChange(e) {
    // Both triggers are dead under an open console, press and release alike.
    if (page.consoleCaptures()) return;
    const pressed = !!(e.buttons & BUTTON_BIT[e.button]);
    if (!pressed) {
      if (e.button === 0) { pageInput.triggerHeld = false; pageInput.seatFire = false; }
      else if (e.button === 2) { pageInput.aimHeld = false; pageInput.seatAltFire = false; }
      return;
    }
    if (!(pageInput.captured && pointerLocked())) return;
    // Seated, the two buttons are the vehicle's own two triggers rather than
    // the soldier's. `Sherman.con` is the case that makes this matter: the
    // cannon declares `c_PIFire` and `Coaxial_browning` declares `c_PIAltFire`,
    // so with only Space wired to `c_PIFire` the coaxial machine gun had no
    // input at all and could never be fired from the driver's seat — the guns
    // were collected, the FireState existed, and nothing ever pulled it.
    if (page.optPilot.checked && page.occupancy) {
      if (e.button === 0) pageInput.seatFire = true;
      else if (e.button === 2) pageInput.seatAltFire = true;
      return;
    }
    if (!(page.optOnFoot.checked && page.soldier)) return;
    // No active item, no mouse. Both buttons are `handleMessage` messages -- Fire
    // is 6 and AltFire is 7 -- and the gate at `0x082772ac` drops the dispatch
    // whole while `c_AsmHideWeapon` is up. `footFire` would refuse the trigger
    // anyway; this is here so a swimmer does not bank a click or toggle a zoom on
    // a weapon he is not holding.
    if (page.itemsLocked()) return;
    if (e.button === 0) {
      pageInput.triggerHeld = true;
      pageInput.clickQueued = true;
    } else if (e.button === 2) {
      const hw = page.handWeapon;
      // The demolitions pair first: AltFire on the pack or the plunger swaps
      // between them and never reaches the zoom latch. Neither weapon declares
      // a `zoomFov`, so nothing is lost by taking the press here.
      if (page.altFireDemolitions()) return;
      if (hw?.data?.zoom?.toggle) {
        // `altFireOnce` masks the *held* alt-fire input on the client
        // (0x00500901, mask 0x800000) so only a fresh press reaches the
        // weapon -- the button that just transitioned to pressed is a fresh
        // press whether it arrived alone or as half of a chord.
        hw.zoomed = !hw.zoomed;
        hw.rezoom = 0;
      } else {
        pageInput.aimHeld = true;
      }
    }
  }

  page.renderer.domElement.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { page.renderer.domElement.setPointerCapture(e.pointerId); } catch {}
      setFly(true);
      page.ensureAudioContext();

      if (activeTouches.size === 1) {
        pageInput.lastPointerX = e.clientX;
        pageInput.lastPointerY = e.clientY;
        pageInput.dragging = true;
        if (pageInput.navMode === 'fly') {
          pageInput.touchFlying = true;
          pageInput.isPanning = false;
        } else {
          pageInput.touchFlying = false;
          pageInput.isPanning = true;
        }
      } else if (activeTouches.size === 2) {
        pageInput.touchFlying = false;
        pageInput.isPanning = true;
        const geom = getTouchesCenterAndDist();
        if (geom) {
          pageInput.touchMidX = geom.midX;
          pageInput.touchMidY = geom.midY;
          pageInput.touchPinchDist = geom.dist;
        }
      }
      return;
    }

    // Desktop mouse. On foot with the pointer already locked, the buttons stop
    // being a drag and become the game's own bindings — `c_PIFire` on the left,
    // `c_PIAltFire` (aim) on the right, `Infantry.con` — so the very first
    // click still captures and only the clicks after it pull the trigger.
    // Seated players get the same gate: the buttons are triggers, not a drag,
    // and must not fall through to the orbit/pan branch below.
    if (pageInput.captured && pointerLocked() && ((page.optPilot.checked && page.occupancy)
        || (page.optOnFoot.checked && page.soldier))) {
      buttonChange(e);
      return;
    }
    if (e.button === 0) {
      pageInput.dragging = true;
      pageInput.isPanning = false;
      pageInput.lastPointerX = e.clientX;
      pageInput.lastPointerY = e.clientY;
      try { page.renderer.domElement.setPointerCapture(e.pointerId); } catch {}
      capture();
    } else if (e.button === 1 || e.button === 2) {
      pageInput.dragging = true;
      pageInput.isPanning = true;
      pageInput.lastPointerX = e.clientX;
      pageInput.lastPointerY = e.clientY;
      try { page.renderer.domElement.setPointerCapture(e.pointerId); } catch {}
      setFly(true);
      page.ensureAudioContext();
    }
  });

  page.renderer.domElement.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') {
      activeTouches.delete(e.pointerId);
      try {
        if (page.renderer.domElement.hasPointerCapture(e.pointerId)) {
          page.renderer.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {}

      if (activeTouches.size === 0) {
        pageInput.touchFlying = false;
        pageInput.dragging = false;
        pageInput.isPanning = false;
      } else if (activeTouches.size === 1) {
        const remaining = activeTouches.values().next().value;
        pageInput.lastPointerX = remaining.x;
        pageInput.lastPointerY = remaining.y;
        if (pageInput.navMode === 'fly') {
          pageInput.touchFlying = true;
          pageInput.isPanning = false;
        } else {
          pageInput.touchFlying = false;
          pageInput.isPanning = true;
        }
      } else {
        const geom = getTouchesCenterAndDist();
        if (geom) {
          pageInput.touchMidX = geom.midX;
          pageInput.touchMidY = geom.midY;
          pageInput.touchPinchDist = geom.dist;
        }
      }
      return;
    }

    pageInput.dragging = false;
    pageInput.isPanning = false;
    // Same gate and the same function as the press: `buttonChange` reads
    // `pressed` off `e.buttons`, which is already false for the button that
    // just came up, so this clears the right one without repeating the check.
    buttonChange(e);
    try {
      if (page.renderer.domElement.hasPointerCapture(e.pointerId)) {
        page.renderer.domElement.releasePointerCapture(e.pointerId);
      }
    } catch {}
  });

  page.renderer.domElement.addEventListener('pointercancel', e => {
    if (e.pointerType === 'touch') {
      activeTouches.delete(e.pointerId);
    }
    if (activeTouches.size === 0) {
      pageInput.touchFlying = false;
      pageInput.dragging = false;
      pageInput.isPanning = false;
    }
  });

  page.renderer.domElement.addEventListener('contextmenu', e => {
    e.preventDefault();
  });
  document.getElementById('side').addEventListener('pointerdown', e => {
    e.stopPropagation();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === page.renderer.domElement) {
      pageInput.lockHeld = true;
      pageInput.dragging = false;
      setFly(true);
      return;
    }
    if (pageInput.lockHeld) {
      pageInput.lockHeld = false;
      setFly(false);
    }
  });
  document.addEventListener('pointermove', e => {
    if (!pageInput.captured) return;
    // Mouse look is off under an open console. The pointer lock is kept — the
    // console is a keyboard surface and closing it should drop you straight
    // back into play — so the deltas are simply dropped.
    if (page.consoleCaptures()) return;
    if (pointerLocked()) {
      // `e.button !== -1` means this move is really a chorded button change
      // (see `buttonChange` above), not the cursor moving: `movementX/Y`
      // on that kind of event can be a large synthetic delta rather than real
      // mouse travel, and feeding it to `lookDelta` is what snapped the view
      // ~90 degrees when a second button joined one already held.
      if (e.button !== -1) {
        buttonChange(e);
        return;
      }
      page.lookDelta(e.movementX, e.movementY);
      return;
    }

    if (e.pointerType === 'touch') {
      if (!activeTouches.has(e.pointerId)) return;
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activeTouches.size >= 2) {
        const geom = getTouchesCenterAndDist();
        if (geom) {
          const dMidX = geom.midX - pageInput.touchMidX;
          const dMidY = geom.midY - pageInput.touchMidY;
          pageInput.touchMidX = geom.midX;
          pageInput.touchMidY = geom.midY;

          panCamera(dMidX, dMidY);

          const dDist = geom.dist - pageInput.touchPinchDist;
          pageInput.touchPinchDist = geom.dist;
          if (Math.abs(dDist) > 1) {
            dollyCamera(dDist * 0.7);
          }
        }
        return;
      }

      if (!pageInput.dragging) return;
      const dx = e.clientX - pageInput.lastPointerX;
      const dy = e.clientY - pageInput.lastPointerY;
      pageInput.lastPointerX = e.clientX;
      pageInput.lastPointerY = e.clientY;

      if (pageInput.isPanning) {
        panCamera(dx, dy);
      } else {
        page.lookDelta(dx, dy);
      }
      return;
    }

    if (!pageInput.dragging) return;
    const dx = e.clientX - pageInput.lastPointerX;
    const dy = e.clientY - pageInput.lastPointerY;
    pageInput.lastPointerX = e.clientX;
    pageInput.lastPointerY = e.clientY;

    if (pageInput.isPanning) {
      panCamera(dx, dy);
    } else {
      page.lookDelta(dx, dy);
    }
  });
  document.addEventListener('wheel', e => {
    if (!pageInput.captured) return;
    e.preventDefault();
    // On foot the wheel walks the kit's inventory (slot order, wrapping) — the
    // game's own mouse-wheel behaviour — instead of dollying. The free-fly
    // dolly does nothing lasting on foot anyway: the soldier's own eye height
    // sets camera.position.y every frame.
    if (page.optOnFoot.checked && page.soldier && page.cycleKitWeapon(e.deltaY > 0 ? 1 : -1)) {
      return;
    }
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 80 : 1;
    page.camera.position.y -= e.deltaY * scale * 0.12 * (isSlow() ? page.FLY_SLOW : 1);
    clampAltitude();
  }, { passive: false });

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
    if (!pageInput.captured) return;
    const step = flySpeed() * dt;
    const fwd = (keys.has('KeyW') || pageInput.touchFlying ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const vert = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    const d = lookVector();
    page.camera.position.x += (d.x * fwd - d.cy * strafe) * step;
    page.camera.position.y += (d.y * fwd + vert) * step;
    page.camera.position.z += (d.z * fwd + d.sy * strafe) * step;
    clampAltitude();
  }

  Object.assign(pageInput, {
    KBLOCK,
    KBLOCK_KEYS,
    applyLook,
    capture,
    clampMobileInput,
    feedMobileTurretAim,
    fly,
    kbLockLeave,
    keys,
    look,
    mobilePadAxis,
    mobilePadVector,
    placeCamera,
    release,
    resetMobileControls,
    setFly,
    setSideCollapsed,
    updateMobileControls,
  });
  return pageInput;
}
