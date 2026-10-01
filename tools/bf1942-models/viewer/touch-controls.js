/**
 * The touch controls: the pad, the FIRE, JUMP, ENTER and VIEW buttons and
 * the throttle slider, and what each feeds the input word. Split out of
 * `page-input.js`, which keeps the keyboard and the mouse.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captured`, `car`, `cycleKitWeapon`, `cycleView`, `ensureAudioContext`,
 * `enterVehicle`, `exitSeat`, `footView3p`, `handWeapon`, `isTouchDevice`,
 * `keys`, `kitOffer`, `mannedActive`, `mouseInput`, `nearEntry`, `noteSeatToggle`,
 * `occupancy`, `optOnFoot`, `optPilot`, `padTriggerDown`, `pickupKit`,
 * `releaseButtons`, `seatToggleReady`, `setFly`, `setTouchAltFire`,
 * `setTouchTriggers`, `soldier`, `soldierDead`, `startReload`, `switchSeat`,
 * `toggleProne`, `view`.
 */
export function createTouchControls(page) {
  const touchControls = {};

  const mobileControls = document.getElementById('mobile-controls');
  const mobilePad = document.getElementById('mobile-pad');
  const mobilePadPuck = document.getElementById('mobile-pad-puck');
  const mobilePadLabel = document.getElementById('mobile-pad-label');
  const mobileFireBtn = document.getElementById('mobile-fire-btn');
  const mobileFire2Btn = document.getElementById('mobile-fire2-btn');
  const mobileAdsBtn = document.getElementById('mobile-ads-btn');
  const mobileReloadBtn = document.getElementById('mobile-reload-btn');
  const mobileSwapBtn = document.getElementById('mobile-swap-btn');
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
  const MOBILE_PAD_RADIUS = 48;
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
    mobileFire2Btn.classList.remove('is-active');
    mobileAdsBtn.classList.remove('is-active');
    mobileCrouchBtn.classList.remove('is-active');
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
    if (!touchControls.mobileThrottleTouched || Math.abs(current - touchControls.mobileThrottle) > 0.01) {
      touchControls.mobileThrottle = Math.max(0, Math.min(1, current));
      mobileThrottleInput.value = String(Math.round(touchControls.mobileThrottle * 100));
    }
    mobileThrottleValue.value = String(Math.round(touchControls.mobileThrottle * 100));
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
    const show = page.captured && !deployOpen && (onFoot || seated);
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
      show, padMode, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
      canFire, canAim, canReload, canPickup, freeSeat,
    ].join('|');
    if (signature === touchControls.mobileControlsSignature) return;
    touchControls.mobileControlsSignature = signature;

    mobileControls.hidden = !show;
    mobilePad.hidden = !(onFoot || driving || flying || aimable);
    mobilePadLabel.textContent = padMode;
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', touchControls.mobileFireHeld && canFire);
    mobileFire2Btn.hidden = !canFire;
    mobileFire2Btn.disabled = !canFire;
    mobileAdsBtn.hidden = !canAim;
    mobileAdsBtn.disabled = !canAim;
    mobileReloadBtn.hidden = !canReload;
    mobileReloadBtn.disabled = !canReload;
    mobileSwapBtn.hidden = !onFoot;
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
    if (touchControls.mobilePadPointerId !== null && event.pointerId !== touchControls.mobilePadPointerId) return;
    try {
      if (mobilePad.hasPointerCapture(event.pointerId)) mobilePad.releasePointerCapture(event.pointerId);
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
    mobileFire2Btn.classList.toggle('is-active', on);
    mobilePadPuck.classList.toggle('is-firing', on);
  }

  /** The ADS button: the touch twin of the right mouse button. On foot it
   *  holds the soldier's aim (zoom); seated it holds the seat's
   *  `c_PIAltFire` (a Sherman's coax, a Corsair's bombs). */
  function setMobileAim(on) {
    page.setTouchAltFire(
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileAdsBtn.classList.toggle('is-active', on);
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

  mobilePad.addEventListener('pointerdown', event => {
    if (touchControls.mobilePadPointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    touchControls.mobilePadPointerId = event.pointerId;
    touchControls.mobilePadHeld = true;
    try { mobilePad.setPointerCapture(event.pointerId); } catch {}
    updateMobilePad(event);
    updateMobileControls();
  });

  mobilePad.addEventListener('pointermove', event => {
    if (!touchControls.mobilePadHeld || event.pointerId !== touchControls.mobilePadPointerId) return;
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

  mobileFire2Btn.addEventListener('pointerdown', event => {
    if (mobileFire2Btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    try { mobileFire2Btn.setPointerCapture(event.pointerId); } catch {}
    setMobileFire(true);
  });
  mobileFire2Btn.addEventListener('pointerup', releaseMobileFire);
  mobileFire2Btn.addEventListener('pointercancel', releaseMobileFire);

  function releaseMobileAim(event) {
    try {
      if (mobileAdsBtn.hasPointerCapture(event.pointerId)) mobileAdsBtn.releasePointerCapture(event.pointerId);
    } catch {}
    setMobileAim(false);
  }

  mobileAdsBtn.addEventListener('pointerdown', event => {
    if (mobileAdsBtn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    try { mobileAdsBtn.setPointerCapture(event.pointerId); } catch {}
    setMobileAim(true);
  });
  mobileAdsBtn.addEventListener('pointerup', releaseMobileAim);
  mobileAdsBtn.addEventListener('pointercancel', releaseMobileAim);

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
    page.cycleKitWeapon?.(1);
  });

  // The map: the M key's own body, dispatched through the same trigger
  // path the keyboard runs (`c_PIMap`: on foot it opens the deploy map,
  // otherwise it toggles the full map).
  mobileMapBtn.addEventListener('pointerdown', event => event.stopPropagation());
  mobileMapBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.padTriggerDown('c_PIMap');
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
    feedMobileTurretAim,
    holdMobileCrouch,
    mobileNextFreeSeat,
    mobilePadAxis,
    mobilePadVector,
    mobileSeatToggle,
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
