/**
 * The touch controls: two sense zones (top-left pans the camera, top-right
 * moves with a floating stick), the small game buttons and the swap menu, and
 * what each feeds the input word. Split out of `page-input.js`, which keeps
 * the keyboard and the mouse.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captured`, `car`, `cycleKitWeapon`, `cycleView`, `ensureAudioContext`,
 * `enterVehicle`, `exitSeat`, `footView3p`, `handWeapon`, `isTouchDevice`,
 * `keys`, `kitOffer`, `kitWeaponSlots`, `lookDelta`, `mannedActive`,
 * `mouseInput`, `nearEntry`, `noteSeatToggle`, `occupancy`, `optOnFoot`,
 * `optPilot`, `padTriggerDown`, `pickupKit`, `releaseButtons`,
 * `seatToggleReady`, `selectKitWeapon`, `setFly`, `setTouchAltFire`,
 * `setTouchTriggers`, `soldier`, `soldierDead`, `startReload`, `switchSeat`,
 * `toggleProne`, `view`.
 */
export function createTouchControls(page) {
  const touchControls = {};

  const mobileControls = document.getElementById('mobile-controls');
  const mobileZonePan = document.getElementById('mobile-zone-pan');
  const mobileZoneMove = document.getElementById('mobile-zone-move');
  const mobilePad = document.getElementById('mobile-pad');
  const mobilePadPuck = document.getElementById('mobile-pad-puck');
  const mobilePadLabel = document.getElementById('mobile-pad-label');
  const mobileFireBtn = document.getElementById('mobile-fire-btn');
  const mobileAimBtn = document.getElementById('mobile-aim-btn');
  const mobileReloadBtn = document.getElementById('mobile-reload-btn');
  const mobileSwapBtn = document.getElementById('mobile-swap-btn');
  const mobileSwapWrap = document.getElementById('mobile-swap-wrap');
  const mobileSwapMenu = document.getElementById('mobile-swap-menu');
  const mobileUseBtn = document.getElementById('mobile-use-btn');
  const mobileViewBtn = document.getElementById('mobile-view-btn');
  const mobileJumpBtn = document.getElementById('mobile-jump-btn');
  const mobileMapBtn = document.getElementById('mobile-map-btn');
  const mobilePickupBtn = document.getElementById('mobile-pickup-btn');
  const mobileSeatsBtn = document.getElementById('mobile-seats-btn');
  const mobileCrouchBtn = document.getElementById('mobile-crouch-btn');
  const mobileThrottleWrap = document.getElementById('mobile-throttle-wrap');
  const mobileThrottleInput = document.getElementById('mobile-throttle');
  const mobileThrottleValue = document.getElementById('mobile-throttle-value');
  // The floating stick is 96 px wide; its vector clamps to this radius.
  const MOBILE_PAD_RADIUS = 44;
  const MOBILE_AIM_PIXELS_PER_SECOND = 720;
  // Hold the CROUCH button this long and the soldier goes prone as well,
  // COD Mobile's crouch-over-prone stack: crouch is a hold (`c_PICrouch`),
  // prone is an edge (`c_PILie`), and the button covers both.
  const MOBILE_PRONE_HOLD_MS = 500;
  const CROUCH_CODE = 'ControlLeft';
  const mobilePadVector = { x: 0, y: 0 };
  touchControls.mobilePadPointerId = null;
  touchControls.mobilePadHeld = false;
  touchControls.mobileFireHeld = false;
  touchControls.mobileJumpHeld = false;
  touchControls.mobileCrouchHeld = false;
  touchControls.mobileThrottle = 0;
  touchControls.mobileThrottleTouched = false;
  touchControls.mobileControlsSignature = '';
  let proneHoldTimer = 0;
  let panPointerId = null;
  let panLastX = 0;
  let panLastY = 0;

  function clampMobileInput(value) {
    return Math.max(-1, Math.min(1, value));
  }

  function mobilePadAxis(axis) {
    return touchControls.mobilePadHeld ? mobilePadVector[axis] : 0;
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
    if (!touchControls.mobilePadHeld || !page.occupancy?.turret) return;
    page.mouseInput.accumulateDeflection(
      mobilePadVector.x, -mobilePadVector.y, dt, MOBILE_AIM_PIXELS_PER_SECOND);
  }

  function resetMobilePad() {
    touchControls.mobilePadPointerId = null;
    touchControls.mobilePadHeld = false;
    mobilePadVector.x = 0;
    mobilePadVector.y = 0;
    mobilePadPuck.style.transform = 'translate(-50%, -50%)';
    mobilePad.classList.remove('is-active');
    mobilePad.hidden = true;
  }

  function resetMobileControls() {
    resetMobilePad();
    touchControls.mobileFireHeld = false;
    touchControls.mobileJumpHeld = false;
    touchControls.mobileThrottle = 0;
    touchControls.mobileThrottleTouched = false;
    page.releaseButtons();
    releaseMobileCrouch();
    mobileFireBtn.classList.remove('is-active');
    mobileAimBtn.classList.remove('is-active');
    mobileCrouchBtn.classList.remove('is-active');
    mobileJumpBtn.classList.remove('is-active');
    mobileThrottleInput.value = '0';
    mobileThrottleValue.value = '0';
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', 0);
    updateMobileControls();
  }

  function syncMobileThrottle() {
    if (!page.aircraft) return;
    const current = page.aircraft.input('c_PIThrottle');
    if (!touchControls.mobileThrottleTouched || Math.abs(current - touchControls.mobileThrottle) > 0.01) {
      touchControls.mobileThrottle = Math.max(0, Math.min(1, current));
      mobileThrottleInput.value = String(Math.round(touchControls.mobileThrottle * 100));
    }
    mobileThrottleValue.value = String(Math.round(touchControls.mobileThrottle * 100));
  }

  /** The kit's weapon names, one short line each, for the swap menu. The
   *  `weapon` field is a template name ("KnifeAllies", "Colt"); the menu is
   *  tiny, so the nation suffixes come off. */
  function swapOptionLabel(entry) {
    const name = String(entry?.weapon || '');
    return name.replace(/(Allies|Axis)$/i, '') || `slot ${entry?.slot}`;
  }

  /** The SWAP option menu, built fresh each time it opens from the spawned
   *  kit's slots, and anchored to the SWAP button itself: the thumb taps
   *  SWAP and the options appear where the thumb already is. */
  function openSwapMenu() {
    const slots = Array.isArray(page.kitWeaponSlots) ? page.kitWeaponSlots : [];
    if (!slots.length) return;
    mobileSwapMenu.replaceChildren();
    for (const entry of slots) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'mobile-swap-opt';
      opt.dataset.slot = String(entry.slot);
      opt.textContent = swapOptionLabel(entry);
      opt.addEventListener('pointerdown', event => event.stopPropagation());
      opt.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeSwapMenu();
        page.setFly(true);
        if (page.selectKitWeapon) page.selectKitWeapon(entry.slot);
      });
      mobileSwapMenu.append(opt);
    }
    mobileSwapMenu.hidden = false;
  }

  function closeSwapMenu() {
    mobileSwapMenu.hidden = true;
    mobileSwapMenu.replaceChildren();
  }

  function updateMobileControls() {
    if (!page.isTouchDevice) return;
    const deployOpen = document.getElementById('fullmap')?.classList.contains('deploy');
    const onFoot = page.optOnFoot.checked && page.soldier && !page.soldierDead
      && !page.occupancy;
    // The seat, not the box: the page keeps both mode boxes ticked through an
    // entry (the box unticks when the soldier leaves, not when the seat is
    // taken), so the seat itself is the truth the HUD must show.
    const seated = !!page.occupancy;
    const activeSeat = seated && page.occupancy.isActiveRoot();
    const manned = seated && page.mannedActive();
    const aimable = manned && page.occupancy.turret;
    const driving = activeSeat && page.car;
    const flying = activeSeat && page.aircraft;
    const freeCam = !onFoot && !seated;
    const show = page.captured && !deployOpen && (onFoot || seated || freeCam);
    const padUsable = !!(onFoot || driving || flying || aimable);
    const padMode = flying ? 'STICK' : driving ? 'DRIVE' : aimable ? 'AIM' : onFoot ? 'MOVE' : 'SEAT';
    const canFire = onFoot || (seated && (driving || flying || aimable)
      && page.occupancy.activeFireArmsNodes().length > 0);
    const canAim = onFoot || (seated && (driving || flying || aimable)
      && page.occupancy.activeFireArmsNodes().length > 0);
    const canReload = onFoot && !!(page.handWeapon?.data?.magazine);
    // A kit in reach: the same question `c_PIDrop` answers, polled so the
    // button appears the moment the soldier walks up to one.
    const canPickup = !!(onFoot && page.kitOffer?.());
    // Seats besides the driver's root: the digit row's own job seated, one
    // button that walks the vehicle's spawn-declared order to the next free
    // seat. Empty when every other seat is taken, as the keys' misses are.
    const freeSeat = seated && page.occupancy ? mobileNextFreeSeat() : -1;
    const signature = [
      show, padMode, padUsable, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
      canFire, canAim, canReload, canPickup, freeSeat,
    ].join('|');
    if (signature === touchControls.mobileControlsSignature) return;
    touchControls.mobileControlsSignature = signature;

    mobileControls.hidden = !show;
    // The zones follow the cluster: hidden with it, and the move zone only
    // where a stick has something to do (free-roam has no soldier to move).
    mobileZonePan.hidden = !show;
    mobileZoneMove.hidden = !(show && padUsable);
    if (!show && touchControls.mobilePadHeld) resetMobilePad();
    mobilePadLabel.textContent = padMode;
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', touchControls.mobileFireHeld && canFire);
    mobileAimBtn.hidden = !canAim;
    mobileAimBtn.disabled = !canAim;
    mobileReloadBtn.hidden = !canReload;
    mobileReloadBtn.disabled = !canReload;
    mobileSwapBtn.hidden = !onFoot;
    if (!onFoot) closeSwapMenu();
    mobilePickupBtn.hidden = !canPickup;
    mobileSeatsBtn.hidden = freeSeat < 0;
    mobileJumpBtn.hidden = !onFoot;
    mobileCrouchBtn.hidden = !onFoot;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld && onFoot);
    mobileCrouchBtn.classList.toggle('is-active', touchControls.mobileCrouchHeld && onFoot);
    mobileUseBtn.hidden = !(onFoot || seated);
    mobileUseBtn.disabled = onFoot ? !page.nearEntry : !seated;
    mobileUseBtn.textContent = onFoot ? (page.nearEntry ? `ENTER ${page.nearEntry.control}` : 'ENTER') : 'EXIT';
    mobileViewBtn.hidden = !((seated && page.view) || (onFoot && page.footView3p.modes.length > 1));
    mobileThrottleWrap.hidden = !flying;
    if (flying) syncMobileThrottle();
    mobileControls.dataset.mode = padMode;
  }

  /** The floating move stick. The zone places the pad ring under the finger
   *  that touched it, then the usual deflection math runs from that spot. */
  function placeMobilePad(event) {
    mobilePad.style.left = `${event.clientX}px`;
    mobilePad.style.top = `${event.clientY}px`;
    mobilePad.hidden = false;
    mobilePad.classList.add('is-active');
    mobilePadPuck.style.transform = 'translate(-50%, -50%)';
    const rect = mobilePad.getBoundingClientRect();
    updateMobilePadVector(event, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function updateMobilePadVector(event, cx, cy) {
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
  }

  function updateMobilePad(event) {
    const rect = mobilePad.getBoundingClientRect();
    updateMobilePadVector(event, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function releaseMobilePad(event) {
    if (touchControls.mobilePadPointerId !== null && event.pointerId !== touchControls.mobilePadPointerId) return;
    try {
      if (mobileZoneMove.hasPointerCapture(event.pointerId)) {
        mobileZoneMove.releasePointerCapture(event.pointerId);
      }
    } catch {}
    resetMobilePad();
  }

  function setMobileFire(on) {
    touchControls.mobileFireHeld = on;
    page.setTouchTriggers(
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileFireBtn.classList.toggle('is-active', on);
    mobilePadPuck.classList.toggle('is-firing', on);
  }

  /** The AIM button: the touch twin of the right mouse button. On foot it
   *  holds the soldier's aim (zoom); seated it holds the seat's
   *  `c_PIAltFire` (a Sherman's coax, a Corsair's bombs). */
  function setMobileAim(on) {
    page.setTouchAltFire(
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileAimBtn.classList.toggle('is-active', on);
  }

  /** Crouch is a hold, prone its long press. The held key is the same
   *  `e.code` the keyboard path records (`c_PICrouch`, LeftCtrl), so the
   *  engine's per-frame held read sees one key, wherever it came from. */
  function holdMobileCrouch(on) {
    if (on) {
      page.setFly(true);
      touchControls.mobileCrouchHeld = true;
      page.keys.add(CROUCH_CODE);
      mobileCrouchBtn.classList.add('is-active');
      clearTimeout(proneHoldTimer);
      proneHoldTimer = setTimeout(() => {
        if (page.optOnFoot.checked && page.soldier && !page.soldierDead && !page.occupancy) page.toggleProne();
      }, MOBILE_PRONE_HOLD_MS);
    } else {
      touchControls.mobileCrouchHeld = false;
      page.keys.delete(CROUCH_CODE);
      mobileCrouchBtn.classList.remove('is-active');
    }
  }

  function releaseMobileCrouch() {
    clearTimeout(proneHoldTimer);
    if (touchControls.mobileCrouchHeld || page.keys.has(CROUCH_CODE)) holdMobileCrouch(false);
  }

  /** The next free seat after the active one, walked in the vehicle's
   *  spawn-declaration order — the digit row's own job (`c_PIMenuSelectN`
   *  seated, `VehicleOccupancy.seatIdAt`), as one button. Returns the
   *  position to hand `switchSeat`, or -1 when every other seat is taken. */
  function mobileNextFreeSeat() {
    const seat = page.occupancy;
    if (!seat) return -1;
    const order = seat.order ?? [];
    for (let position = 0; position < order.length; position++) {
      const id = order[position];
      if (id === undefined || id === seat.activeSeatId) continue;
      if (seat.instance.holder(id) == null) return position;
    }
    return -1;
  }

  function setMobileJump(on) {
    touchControls.mobileJumpHeld = on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld);
  }

  /** The touch twin of the keyboard's `useKey`: the seat decides, and the
   *  SEAT branch is asked FIRST — standing in a tank whose own door is in
   *  reach, a press must leave, not climb back in. */
  function mobileSeatToggle() {
    if (!page.seatToggleReady()) return;
    if (page.occupancy) {
      page.exitSeat();
      page.noteSeatToggle();
    } else {
      // The same press-time lookup the keyboard's E does (`page-input.js`
      // `useKey`): the engine's `c_PIUse` edge searches for a door where the
      // player stands, rather than using the HUD's cached offer.
      const entry = page.nearestEntry() ?? page.nearEntry;
      if (page.optOnFoot.checked && page.soldier && entry) {
        page.setFly(true);
        page.enterVehicle(entry);
        page.noteSeatToggle();
      }
    }
    resetMobileControls();
  }

  // The top-left zone pans the camera: a drag here is the look, exactly like
  // a drag on the canvas, held on one pointer. The zone owns the input; the
  // canvas underneath never sees the touches.
  mobileZonePan.addEventListener('pointerdown', event => {
    if (panPointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    panPointerId = event.pointerId;
    panLastX = event.clientX;
    panLastY = event.clientY;
    try { mobileZonePan.setPointerCapture(event.pointerId); } catch {}
  });

  mobileZonePan.addEventListener('pointermove', event => {
    if (event.pointerId !== panPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - panLastX;
    const dy = event.clientY - panLastY;
    panLastX = event.clientX;
    panLastY = event.clientY;
    page.lookDelta(dx, dy);
  });

  function releaseMobilePan(event) {
    if (event.pointerId !== panPointerId) return;
    try {
      if (mobileZonePan.hasPointerCapture(event.pointerId)) {
        mobileZonePan.releasePointerCapture(event.pointerId);
      }
    } catch {}
    panPointerId = null;
  }

  mobileZonePan.addEventListener('pointerup', releaseMobilePan);
  mobileZonePan.addEventListener('pointercancel', releaseMobilePan);

  // The top-right zone moves: the stick appears at the touch point and the
  // deflection feeds the same pad the bottom-left ring used to.
  mobileZoneMove.addEventListener('pointerdown', event => {
    if (touchControls.mobilePadPointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    touchControls.mobilePadPointerId = event.pointerId;
    touchControls.mobilePadHeld = true;
    try { mobileZoneMove.setPointerCapture(event.pointerId); } catch {}
    placeMobilePad(event);
    updateMobileControls();
  });

  mobileZoneMove.addEventListener('pointermove', event => {
    if (!touchControls.mobilePadHeld || event.pointerId !== touchControls.mobilePadPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateMobilePad(event);
  });

  mobileZoneMove.addEventListener('pointerup', releaseMobilePad);
  mobileZoneMove.addEventListener('pointercancel', releaseMobilePad);

  mobileFireBtn.addEventListener('pointerdown', event => {
    if (mobileFireBtn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
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
    page.setFly(true);
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

  function releaseMobileAim(event) {
    try {
      if (mobileAimBtn.hasPointerCapture(event.pointerId)) mobileAimBtn.releasePointerCapture(event.pointerId);
    } catch {}
    setMobileAim(false);
  }

  mobileAimBtn.addEventListener('pointerdown', event => {
    if (mobileAimBtn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    try { mobileAimBtn.setPointerCapture(event.pointerId); } catch {}
    setMobileAim(true);
  });
  mobileAimBtn.addEventListener('pointerup', releaseMobileAim);
  mobileAimBtn.addEventListener('pointercancel', releaseMobileAim);

  function releaseMobileCrouchPointer(event) {
    try {
      if (mobileCrouchBtn.hasPointerCapture(event.pointerId)) mobileCrouchBtn.releasePointerCapture(event.pointerId);
    } catch {}
    releaseMobileCrouch();
  }

  mobileCrouchBtn.addEventListener('pointerdown', event => {
    if (mobileCrouchBtn.disabled || mobileCrouchBtn.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    page.ensureAudioContext();
    try { mobileCrouchBtn.setPointerCapture(event.pointerId); } catch {}
    holdMobileCrouch(true);
  });
  mobileCrouchBtn.addEventListener('pointerup', releaseMobileCrouchPointer);
  mobileCrouchBtn.addEventListener('pointercancel', releaseMobileCrouchPointer);

  mobileReloadBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileReloadBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    // The keyboard's guard: reload once there is a magazine to reload.
    if (page.handWeapon?.data?.magazine) page.startReload?.();
  });

  mobileSwapBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileSwapBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    if (mobileSwapMenu.hidden) openSwapMenu();
    else closeSwapMenu();
  });

  // A tap anywhere else closes the swap menu: the thumb that opened it is on
  // the SWAP button, and the options sit right under that thumb.
  document.addEventListener('pointerdown', event => {
    if (mobileSwapMenu.hidden) return;
    if (event.target === mobileSwapBtn || mobileSwapWrap.contains(event.target)) return;
    closeSwapMenu();
  });

  // The map: with a live soldier it is the M key's `c_PIMap` (on foot the
  // deploy map IS the spawn screen, seated the plain map); with nobody
  // alive — the free camera a closed spawn screen left — it is the game's
  // "bring the spawn interface back" trigger (`c_GIInGameMenu`, Caps Lock /
  // Enter on the keyboard), the only road back a phone has.
  mobileMapBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileMapBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    if (page.soldier && !page.soldierDead) page.padTriggerDown('c_PIMap');
    else page.padTriggerDown('c_GIInGameMenu');
  });

  // Pick up the kit in reach: the G key's body, `c_PIDrop`.
  mobilePickupBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobilePickupBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.pickupKit?.();
  });

  // Switch to the next free seat: the digit row's job, one button.
  mobileSeatsBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileSeatsBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    const position = mobileNextFreeSeat();
    if (position >= 0) page.switchSeat(position);
  });

  mobileUseBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileUseBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    mobileSeatToggle();
  });

  mobileViewBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileViewBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.cycleView();
  });

  mobileThrottleWrap.addEventListener('pointerdown', event => event.stopPropagation());
  mobileThrottleInput.addEventListener('pointerdown', event => event.stopPropagation());
  mobileThrottleInput.addEventListener('input', () => {
    touchControls.mobileThrottle = Math.max(0, Math.min(1, Number(mobileThrottleInput.value) / 100 || 0));
    touchControls.mobileThrottleTouched = true;
    mobileThrottleValue.value = String(Math.round(touchControls.mobileThrottle * 100));
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', touchControls.mobileThrottle);
  });

  window.addEventListener('blur', resetMobileControls);

  Object.assign(touchControls, {
    clampMobileInput,
    closeSwapMenu,
    feedMobileTurretAim,
    holdMobileCrouch,
    mobileNextFreeSeat,
    mobilePadAxis,
    mobilePadVector,
    mobileSeatToggle,
    openSwapMenu,
    releaseMobileCrouch,
    releaseMobileFire,
    releaseMobileJump,
    releaseMobilePad,
    resetMobileControls,
    resetMobilePad,
    setMobileAim,
    setMobileFire,
    setMobileJump,
    syncMobileThrottle,
    updateMobileControls,
    updateMobilePad,
  });
  return touchControls;
}