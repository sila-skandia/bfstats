/**
 * The touch controls, split by FINGER rather than by screen half.
 *
 * LEFT thumb: the FIXED move ring at the bottom-left, then the posture pair
 * stacked above it (JUMP, CROUCH) and the MORE tab over those. Those two are
 * here rather than on the right because they are the actions you need WHILE
 * the other thumb is shooting, and one thumb cannot hold FIRE, jump and crouch
 * at once.
 * RIGHT thumb: FIRE at the bottom-right (a deliberate drag off a held FIRE
 * turns the camera), AIM above it, the kit's weapon pair above that, and the
 * look drag over the whole right half. A drag that is not on a button is the
 * camera, as on a console pad.
 * Everything a firefight does not need (reload, pickup, seats, enter, view,
 * map, throttle) is one MORE tap away in the action sheet, so the play screen
 * carries seven controls instead of twelve.
 *
 * Every button acts on its `pointerdown` EDGE, never on a synthesised
 * `click`: while a second finger is down, panning or on the ring, the
 * browser drops the tap and the button is dead, which is exactly the bug the
 * playtest reported for PREV / NEXT. The held buttons (FIRE, AIM, JUMP,
 * CROUCH, the ring, the look drag) track the pointer that drives them and die
 * with it wherever it ends.
 *
 * `TOUCH_LOOK_SCALE` is the look multiplier the look zone and the drag off
 * FIRE apply to the raw finger travel; `?touchlook=<n>` overrides it for
 * on-device tuning.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captured`, `car`, `cycleKitWeapon`, `cycleView`, `ensureAudioContext`,
 * `enterVehicle`, `exitSeat`, `footView3p`, `handWeapon`, `isTouchDevice`,
 * `keys`, `kitOffer`, `lookDelta`, `mannedActive`,
 * `mouseInput`, `nearEntry`, `nearestEntry`, `noteSeatToggle`, `occupancy`,
 * `optOnFoot`, `optPilot`, `padTriggerDown`, `pickupKit`, `releaseButtons`,
 * `seatToggleReady`, `setFly`, `setTouchAltFire`,
 * `setTouchTriggers`, `soldier`, `soldierDead`, `startReload`, `switchSeat`,
 * `toggleProne`, `view`, `weaponBarFire`.
 */
/**
 * The look multiplier for touch drags: raw finger pixels in, engine look
 * counts out. Retail's on-foot law is 0.1215 degrees of yaw per pixel
 * (`mouse-input.js`, GUN-2b), which needs ~1,480 px of travel for a 180,
 * several phone screens' worth. The owner's playtest asked for "way more
 * responsive", so a touch drag gets `TOUCH_LOOK_SCALE` times the mouse's
 * currency: at 8 a 180 is ~185 px of finger travel (about half a phone
 * width). The +-16 axis saturation of the retail pipeline still caps fast
 * flicks at ~1,440 deg/s, which is transcribed behaviour, not a touch
 * choice. `?touchlook=<n>` overrides the default for on-device tuning
 * (the `?turret=` knob on `countsPerPixel` is the same idea).
 */
export const TOUCH_LOOK_SCALE = (() => {
  const raw = globalThis.location
    ? new URLSearchParams(globalThis.location.search).get('touchlook')
    : null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 8;
})();

export function createTouchControls(page) {
  const touchControls = {};

  const mobileControls = document.getElementById('mobile-controls');
  const mobileZoneLook = document.getElementById('mobile-zone-look');
  const mobileMoreScrim = document.getElementById('mobile-more-scrim');
  const mobileMoreSheet = document.getElementById('mobile-more-sheet');
  const mobileMoreBtn = document.getElementById('mobile-more-btn');
  const mobilePad = document.getElementById('mobile-pad');
  const mobilePadPuck = document.getElementById('mobile-pad-puck');
  const mobilePadLabel = document.getElementById('mobile-pad-label');
  const mobileFireBtn = document.getElementById('mobile-fire-btn');
  const mobileAimBtn = document.getElementById('mobile-aim-btn');
  const mobileReloadBtn = document.getElementById('mobile-reload-btn');
  const mobileWPrevBtn = document.getElementById('mobile-wprev-btn');
  const mobileWNextBtn = document.getElementById('mobile-wnext-btn');
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
  // The fixed move ring: 64 px across with a 28 px ball (`map.css`, keep the
  // three together). The ball's whole travel is 18 px and that travel IS the
  // input range, with full deflection where the ball touches the ring, so the
  // stick answers a twitch. The 5 px dead circle at the centre is what lets a
  // resting finger stand still. This is the viewer's own touch choice, stated
  // rather than transcribed (BF1942 has no touch device to read).
  const MOBILE_PAD_TRAVEL = 18;
  const MOBILE_PAD_DEAD = 5;
  // Full pad deflection is a hand moving this many pixels a second (see
  // `feedMobileTurretAim`). Raised from 720 in the playtest rework: at retail
  // scale 720 px/s is only ~87 deg/s of turret yaw, sluggish next to the
  // reworked look drag; 2200 is ~270 deg/s, a rate stick that turns a 180 in
  // under a second at full tilt and still tracks finely at half deflection.
  const MOBILE_AIM_PIXELS_PER_SECOND = 2200;
  // Hold the CROUCH button this long and the soldier goes prone as well,
  // COD Mobile's crouch-over-prone stack: crouch is a hold (`c_PICrouch`),
  // prone is an edge (`c_PILie`), and the button covers both.
  const MOBILE_PRONE_HOLD_MS = 500;
  // How far a held FIRE has to travel before it turns the camera. PUBG Mobile
  // lets a drag off the fire button aim while the trigger stays down, which is
  // the whole reason the right thumb sits on FIRE; the slop keeps a thumb
  // simply RESTING on the button from walking the view, which is the complaint
  // that put the fire side back on its own half in the sixth pass.
  const MOBILE_FIRE_LOOK_DEAD = 14;
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
  touchControls.mobileSheetOpen = false;
  let proneHoldTimer = 0;
  let panPointerId = null;
  let panLastX = 0;
  let panLastY = 0;
  // The held FIRE's own look: armed only once the drag clears the dead circle,
  // and remembering where the last look sample was left so the frame that
  // crosses the threshold does not apply the slop as one jump.
  let mobileFireHeldPointerId = null;
  let fireLookArmed = false;
  let fireLookOriginX = 0;
  let fireLookOriginY = 0;
  let fireLookLastX = 0;
  let fireLookLastY = 0;
  // The fixed ring's centre, read once on the down event.
  let padCentreX = 0;
  let padCentreY = 0;

  // Every held input tracks the pointer that drives it and dies with that
  // pointer wherever it ends: its own element, another element, or a
  // `pointercancel` from the browser's gesture recognizer when a second
  // finger starts one. A missed or mis-targeted release otherwise leaves the
  // input stuck on or the surface dead, which is what the owner's "it only
  // supports one touch at a time" was.
  const heldPointers = new Map();
  function trackPointer(pointerId, release) {
    heldPointers.set(pointerId, release);
  }
  function endPointer(event) {
    const release = heldPointers.get(event.pointerId);
    if (!release) return;
    heldPointers.delete(event.pointerId);
    release();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    window.addEventListener(type, endPointer, true);
  }

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

  // The ring is FIXED: a release only centres the ball again, it never hides
  // the ring (the floating stick's hide-on-release is what made the thumb
  // hunt for it before every move).
  function resetMobilePad() {
    touchControls.mobilePadPointerId = null;
    touchControls.mobilePadHeld = false;
    mobilePadVector.x = 0;
    mobilePadVector.y = 0;
    mobilePadPuck.style.transform = 'translate(-50%, -50%)';
    mobilePad.classList.remove('is-active');
  }

  function resetMobileControls() {
    heldPointers.clear();
    resetMobilePad();
    setMobileSheet(false);
    fireLookArmed = false;
    mobileFireHeldPointerId = null;
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

  /** The action sheet: the controls that are not a firefight's business, one
   *  MORE tap away. The scrim closes it on any tap that is not a button, and
   *  the sheet goes away by itself when the HUD it belongs to does. */
  function setMobileSheet(open) {
    touchControls.mobileSheetOpen = !!open;
    mobileMoreBtn.classList.toggle('is-active', touchControls.mobileSheetOpen);
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

  /** The weapon pair: one press steps the kit's weapon bar one slot and then
   *  COMMITS it, so the press raises the weapon instead of only moving the
   *  bar's highlight the way the mouse wheel does (the wheel leaves the raise
   *  to Fire; a phone has no wheel to hover over, and the owner wants to
   *  memorise the cycle over time). `cycleKitWeapon` is `c_PINextItem` /
   *  `c_PIPrevItem` (wrapping), `weaponBarFire` is the Fire press that turns
   *  the highlight into the slot's `c_PIMenuSelect`. */
  function mobileCycleWeapon(dir) {
    if (!page.cycleKitWeapon(dir)) return;
    page.weaponBarFire();
  }

  function updateMobileControls() {
    if (!page.isTouchDevice) return;
    const deployOpen = document.getElementById('fullmap')?.classList.contains('deploy');
    // The expanded map-controls panel sits UNDER the look zone (z 3 vs 9), and on
    // a phone it is a full-width bottom sheet, so it covers the foot of the
    // look zone as well as FIRE. The zone steps aside while it is open.
    // `setFly` collapses the panel on any control press.
    const sideOpen = !document.getElementById('side')?.classList.contains('side-collapsed');
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
    // A sheet with nothing in it is a dead tap, so it only exists for a state
    // that has something to offer, and it closes itself the moment it does not.
    const sheetOpen = touchControls.mobileSheetOpen && show;
    const signature = [
      show, padMode, padUsable, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
      canFire, canAim, canReload, canPickup, freeSeat, sideOpen, sheetOpen,
    ].join('|');
    // Collapse the open intent BEFORE the compare. A MORE press that lands on a
    // state with no HUD (the deploy screen) would otherwise leave the flag set,
    // the compare would skip the write, and the sheet would pop open by itself
    // the moment the HUD came back.
    touchControls.mobileSheetOpen = sheetOpen;
    mobileMoreBtn.classList.toggle('is-active', sheetOpen);
    if (signature === touchControls.mobileControlsSignature) return;
    touchControls.mobileControlsSignature = signature;

    mobileControls.hidden = !show;
    // The look zone follows the cluster, and steps aside for three things: the
    // expanded map-controls panel (which sits under it), free roam (where the
    // free camera's own canvas drag is the look and the zone would eat it), and
    // the open sheet (where a tap outside is a CLOSE, not a camera move). The
    // FIXED move ring shows wherever a stick has something to do (free-roam
    // has no soldier to move).
    mobileZoneLook.hidden = !show || sideOpen || freeCam || sheetOpen;
    // A hidden surface must stop driving input: the browser may drop its
    // pointer with no end event at all, and the vector would then freeze at
    // its last value ("sticks the movement").
    if (mobilePad.hidden && touchControls.mobilePadHeld) resetMobilePad();
    if (mobileZoneLook.hidden && panPointerId !== null) panPointerId = null;
    mobileMoreScrim.hidden = !sheetOpen;
    mobileMoreSheet.hidden = !sheetOpen;
    mobilePad.hidden = !(show && padUsable);
    mobilePadLabel.textContent = padMode;
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', touchControls.mobileFireHeld && canFire);
    mobileAimBtn.hidden = !canAim;
    mobileAimBtn.disabled = !canAim;
    mobileReloadBtn.hidden = !canReload;
    mobileReloadBtn.disabled = !canReload;
    mobileWPrevBtn.hidden = !onFoot;
    mobileWNextBtn.hidden = !onFoot;
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

  /** The FIXED move ring's deflection. The ball tracks the finger's offset
   *  from the ring's centre and clamps inside it; the input range is the
   *  ball's whole travel, with a dead circle at the centre so a resting
   *  finger stands still. */
  function updateMobilePadVector(event, cx, cy) {
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const inv = dist > 0 ? 1 / dist : 0;
    // Full deflection where the ball touches the ring (MOBILE_PAD_TRAVEL),
    // zero inside the dead circle.
    const deflect = Math.max(0, Math.min(1,
      (dist - MOBILE_PAD_DEAD) / (MOBILE_PAD_TRAVEL - MOBILE_PAD_DEAD)));
    mobilePadVector.x = dx * inv * deflect;
    mobilePadVector.y = -(dy * inv) * deflect;
    const vis = Math.min(dist, MOBILE_PAD_TRAVEL);
    mobilePadPuck.style.transform =
      `translate(calc(-50% + ${(dx * inv * vis).toFixed(1)}px), calc(-50% + ${(dy * inv * vis).toFixed(1)}px))`;
  }

  function updateMobilePad(event) {
    updateMobilePadVector(event, padCentreX, padCentreY);
  }

  function releaseMobilePad(event) {
    if (touchControls.mobilePadPointerId !== null && event.pointerId !== touchControls.mobilePadPointerId) return;
    try {
      if (mobilePad.hasPointerCapture(event.pointerId)) {
        mobilePad.releasePointerCapture(event.pointerId);
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

  // The RIGHT-half zone is the look: a drag that is not on a button pans the
  // camera, exactly like the free-roam canvas drag, held on one pointer. The
  // zone owns the input; the canvas underneath never sees the touches.
  // `TOUCH_LOOK_SCALE` times the raw finger travel: retail's look law needs
  // several phone screens of drag for a 180, which is the sensitivity the
  // owner's playtest rejected.
  mobileZoneLook.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    panPointerId = event.pointerId;
    panLastX = event.clientX;
    panLastY = event.clientY;
    trackPointer(event.pointerId, () => releaseMobileLook(event));
    try { mobileZoneLook.setPointerCapture(event.pointerId); } catch {}
  });

  mobileZoneLook.addEventListener('pointermove', event => {
    if (event.pointerId !== panPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - panLastX) * TOUCH_LOOK_SCALE;
    const dy = (event.clientY - panLastY) * TOUCH_LOOK_SCALE;
    panLastX = event.clientX;
    panLastY = event.clientY;
    page.lookDelta(dx, dy);
  });

  function releaseMobileLook(event) {
    if (event.pointerId !== panPointerId) return;
    try {
      if (mobileZoneLook.hasPointerCapture(event.pointerId)) {
        mobileZoneLook.releasePointerCapture(event.pointerId);
      }
    } catch {}
    panPointerId = null;
  }

  mobileZoneLook.addEventListener('pointerup', releaseMobileLook);
  mobileZoneLook.addEventListener('pointercancel', releaseMobileLook);

  // The MORE tab opens and closes the action sheet. It lives on the LEFT thumb's
  // column so the right thumb never leaves FIRE to reach it.
  mobileMoreBtn.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    setMobileSheet(!touchControls.mobileSheetOpen);
  });
  // The scrim closes the sheet on any tap that is not a button. Without the
  // stopPropagation the tap would also reach the look zone under it, which the
  // zone's own hiding makes moot but the capture order does not.
  mobileMoreScrim.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    setMobileSheet(false);
  });

  // The FIXED move ring is its own touch target: the left thumb finds it at
  // its home spot (bottom-left) and the ball tracks the offset from the
  // ring's centre. Last press wins: a press while a stale pointer is still
  // tracked re-arms the ring instead of dead-ending behind it.
  mobilePad.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    touchControls.mobilePadPointerId = event.pointerId;
    touchControls.mobilePadHeld = true;
    trackPointer(event.pointerId, () => releaseMobilePad(event));
    try { mobilePad.setPointerCapture(event.pointerId); } catch {}
    const rect = mobilePad.getBoundingClientRect();
    padCentreX = rect.left + rect.width / 2;
    padCentreY = rect.top + rect.height / 2;
    mobilePad.classList.add('is-active');
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
    // The tracked release is the same teardown as the pointerup path, so a
    // pointer that ends on another element (or is cancelled) leaves no look
    // state behind for the next press to inherit.
    trackPointer(event.pointerId, () => endMobileFire());
    // Where this press started, for the drag-off look below. Armed from the
    // dead circle, not from the press, so a held thumb cannot drift the view.
    fireLookArmed = false;
    fireLookOriginX = event.clientX;
    fireLookOriginY = event.clientY;
    fireLookLastX = event.clientX;
    fireLookLastY = event.clientY;
    mobileFireHeldPointerId = event.pointerId;
    setMobileFire(true);
  });

  /** A held FIRE that is then DRAGGED turns the camera while the trigger stays
   *  down: PUBG Mobile's fire-and-aim, and the reason the right thumb can live
   *  on FIRE at all. `MOBILE_FIRE_LOOK_DEAD` px of slop first, so a thumb
   *  resting on the button does not walk the view; the frame that crosses the
   *  slop starts from the edge of the dead circle instead of applying it as a
   *  jump. `TOUCH_LOOK_SCALE` is the same multiplier the look zone uses. */
  function feedMobileFireLook(event) {
    const dx0 = event.clientX - fireLookOriginX;
    const dy0 = event.clientY - fireLookOriginY;
    const dist = Math.hypot(dx0, dy0);
    if (!fireLookArmed) {
      if (dist < MOBILE_FIRE_LOOK_DEAD) return;
      fireLookArmed = true;
      const ux = dx0 / dist;
      const uy = dy0 / dist;
      fireLookLastX = fireLookOriginX + ux * MOBILE_FIRE_LOOK_DEAD;
      fireLookLastY = fireLookOriginY + uy * MOBILE_FIRE_LOOK_DEAD;
    }
    const dx = (event.clientX - fireLookLastX) * TOUCH_LOOK_SCALE;
    const dy = (event.clientY - fireLookLastY) * TOUCH_LOOK_SCALE;
    fireLookLastX = event.clientX;
    fireLookLastY = event.clientY;
    page.lookDelta(dx, dy);
  }

  mobileFireBtn.addEventListener('pointermove', event => {
    if (!touchControls.mobileFireHeld || event.pointerId !== mobileFireHeldPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    feedMobileFireLook(event);
  });

  /** Everything a held FIRE has to let go of when its pointer ends: the look
   *  state, the capture, and the trigger. */
  function endMobileFire() {
    fireLookArmed = false;
    mobileFireHeldPointerId = null;
    setMobileFire(false);
  }

  function releaseMobileFire(event) {
    try {
      if (mobileFireBtn.hasPointerCapture(event.pointerId)) mobileFireBtn.releasePointerCapture(event.pointerId);
    } catch {}
    endMobileFire();
  }

  mobileFireBtn.addEventListener('pointerup', releaseMobileFire);
  mobileFireBtn.addEventListener('pointercancel', releaseMobileFire);

  mobileJumpBtn.addEventListener('pointerdown', event => {
    if (mobileJumpBtn.disabled || mobileJumpBtn.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    try { mobileJumpBtn.setPointerCapture(event.pointerId); } catch {}
    trackPointer(event.pointerId, () => setMobileJump(false));
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
    trackPointer(event.pointerId, () => setMobileAim(false));
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
    trackPointer(event.pointerId, releaseMobileCrouch);
    holdMobileCrouch(true);
  });
  mobileCrouchBtn.addEventListener('pointerup', releaseMobileCrouchPointer);
  mobileCrouchBtn.addEventListener('pointercancel', releaseMobileCrouchPointer);

  /** An EDGE button: the action runs on the `pointerdown` edge, never on a
   *  synthesised `click`. A tap the browser has to turn into a `click` is a
   *  tap the browser DROPS whenever a second finger is already down, whether
   *  that is the pan or the move ring. That is exactly why only JUMP and CROUCH
   *  (the two that always ran on their own down edge) worked while the player
   *  was panning or moving. `guard` is that button's own enabled/hidden check. */
  function edgeButton(element, action, guard) {
    element.addEventListener('pointerdown', event => {
      if (guard && !guard()) return;
      event.preventDefault();
      event.stopPropagation();
      page.setFly(true);
      page.ensureAudioContext();
      action();
    });
  }

  edgeButton(mobileReloadBtn, () => {
    // The keyboard's guard: reload once there is a magazine to reload.
    if (page.handWeapon?.data?.magazine) page.startReload?.();
  }, () => !mobileReloadBtn.disabled && !mobileReloadBtn.hidden);

  // The weapon pair, in the right thumb's arc over AIM: one press per step,
  // wrapping, and the step raises the weapon (see `mobileCycleWeapon`).
  edgeButton(mobileWPrevBtn, () => mobileCycleWeapon(-1),
    () => !mobileWPrevBtn.disabled && !mobileWPrevBtn.hidden);
  edgeButton(mobileWNextBtn, () => mobileCycleWeapon(1),
    () => !mobileWNextBtn.disabled && !mobileWNextBtn.hidden);

  // The map: with a live soldier it is the M key's `c_PIMap` (on foot the
  // deploy map IS the spawn screen, seated the plain map); with nobody
  // alive — the free camera a closed spawn screen left — it is the game's
  // "bring the spawn interface back" trigger (`c_GIInGameMenu`, Caps Lock /
  // Enter on the keyboard), the only road back a phone has.
  edgeButton(mobileMapBtn, () => {
    if (page.soldier && !page.soldierDead) page.padTriggerDown('c_PIMap');
    else page.padTriggerDown('c_GIInGameMenu');
  }, () => !mobileMapBtn.disabled && !mobileMapBtn.hidden);

  // Pick up the kit in reach: the G key's body, `c_PIDrop`.
  edgeButton(mobilePickupBtn, () => page.pickupKit?.(),
    () => !mobilePickupBtn.disabled && !mobilePickupBtn.hidden);

  // Switch to the next free seat: the digit row's job, one button.
  edgeButton(mobileSeatsBtn, () => {
    const position = mobileNextFreeSeat();
    if (position >= 0) page.switchSeat(position);
  }, () => !mobileSeatsBtn.disabled && !mobileSeatsBtn.hidden);

  edgeButton(mobileUseBtn, () => mobileSeatToggle(),
    () => !mobileUseBtn.disabled && !mobileUseBtn.hidden);

  edgeButton(mobileViewBtn, () => page.cycleView(),
    () => !mobileViewBtn.disabled && !mobileViewBtn.hidden);

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
    edgeButton,
    endMobileFire,
    feedMobileFireLook,
    feedMobileTurretAim,
    holdMobileCrouch,
    mobileCycleWeapon,
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
    setMobileSheet,
    syncMobileThrottle,
    updateMobileControls,
    updateMobilePad,
  });
  return touchControls;
}