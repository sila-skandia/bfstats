/**
 * The touch controls: the pad, the FIRE, JUMP, ENTER and VIEW buttons and
 * the throttle slider, and what each feeds the input word. Split out of
 * `page-input.js`, which keeps the keyboard and the mouse.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captured`, `car`, `cycleView`, `ensureAudioContext`,
 * `enterVehicle`, `exitSeat`, `footView3p`, `isTouchDevice`, `mannedActive`,
 * `mouseInput`, `nearEntry`, `noteSeatToggle`, `occupancy`, `optOnFoot`,
 * `optPilot`, `releaseButtons`, `seatToggleReady`, `setFly`,
 * `setTouchTriggers`, `soldier`, `soldierDead`, `view`.
 */
export function createTouchControls(page) {
  const touchControls = {};

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
  touchControls.mobilePadPointerId = null;
  touchControls.mobilePadHeld = false;
  touchControls.mobileFireHeld = false;
  touchControls.mobileJumpHeld = false;
  touchControls.mobileThrottle = 0;
  touchControls.mobileThrottleTouched = false;
  touchControls.mobileControlsSignature = '';

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
    if (!touchControls.mobileThrottleTouched || Math.abs(current - touchControls.mobileThrottle) > 0.01) {
      touchControls.mobileThrottle = Math.max(0, Math.min(1, current));
      mobileThrottleInput.value = String(Math.round(touchControls.mobileThrottle * 100));
    }
    mobileThrottleValue.value = String(Math.round(touchControls.mobileThrottle * 100));
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
    const show = page.captured && !deployOpen && (onFoot || seated);
    const padMode = flying ? 'STICK' : driving ? 'DRIVE' : aimable ? 'AIM' : onFoot ? 'MOVE' : 'SEAT';
    const canFire = onFoot || (seated && (driving || flying || aimable)
      && page.occupancy.activeFireArmsNodes().length > 0);
    const signature = [
      show, padMode, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
    ].join('|');
    if (signature === touchControls.mobileControlsSignature) return;
    touchControls.mobileControlsSignature = signature;

    mobileControls.hidden = !show;
    mobilePad.hidden = !(onFoot || driving || flying || aimable);
    mobilePadLabel.textContent = padMode;
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', touchControls.mobileFireHeld && canFire);
    mobileJumpBtn.hidden = !onFoot;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld && onFoot);
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
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileFireBtn.classList.toggle('is-active', on);
    mobilePadPuck.classList.toggle('is-firing', on);
  }

  function setMobileJump(on) {
    touchControls.mobileJumpHeld = on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld);
  }

  function mobileSeatToggle() {
    if (!page.seatToggleReady()) return;
    if (page.optOnFoot.checked && page.soldier && page.nearEntry) {
      page.setFly(true);
      page.enterVehicle(page.nearEntry);
      page.noteSeatToggle();
    } else if (page.optPilot.checked && page.occupancy) {
      page.exitSeat();
      page.noteSeatToggle();
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
    mobilePadAxis,
    mobilePadVector,
    mobileSeatToggle,
    releaseMobileFire,
    releaseMobileJump,
    releaseMobilePad,
    resetMobileControls,
    resetMobilePad,
    setMobileFire,
    setMobileJump,
    syncMobileThrottle,
    updateMobileControls,
    updateMobilePad,
  });
  return touchControls;
}
