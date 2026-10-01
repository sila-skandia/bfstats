/**
 * The touch controls: an open screen that steers, with buttons as islands on it.
 *
 * There is no pan half and no pan margin. `mobileZoneLook` is the whole stage
 * UNDER the buttons, so a touch that starts anywhere that is not a button is
 * the camera. A finger can be up and across the screen anywhere and it steers,
 * which is what makes aiming and firing the same moment rather than two: you
 * do not put your thumb somewhere special to look, you look with whatever
 * finger is spare.
 *
 * That is only possible because the buttons are few and small, and placed where
 * thumbs already sit:
 *   the MOVE ring at the bottom-left corner (FIXED, so the thumb finds it
 *   without looking),
 *   one band of six across the middle, 6 px between neighbours, so a thumb
 *   never travels more than one button width: JUMP, CROUCH, PRONE for the left
 *   thumb, AIM and the weapon pair for the right,
 *   RELOAD against FIRE at the bottom-right corner, because reloading is
 *   common and belongs next to the trigger,
 *   the MORE tab on the bottom centre, opening the sheet that holds reload,
 *   pickup, seats, enter, view, map and throttle.
 *
 * Each button is one retail binding and nothing more: JUMP is `c_PIAction`
 * (Space), CROUCH holds `c_PICrouch` (LeftCtrl), PRONE toggles `c_PILie` (Z).
 * A hold and a toggle cannot share one target.
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
 * on-device tuning. Both look drags measure the finger into a smoothed
 * velocity and are fed ONCE A FRAME as `speed x dt` (`feedMobileLook`), not
 * per event: touch samples arrive in bursts, and a per-event feed handed the
 * sim one lump on the frames that received events and zero on the frames that
 * did not, which read as jumpy panning.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captured`, `car`, `cycleKitWeapon`, `cycleView`, `ensureAudioContext`,
 * `enterVehicle`, `exitSeat`, `footView3p`, `handWeapon`, `isTouchDevice`,
 * `keys`, `kitOffer`, `lookDelta`, `mannedActive`, `prone`,
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
  const mobileProneBtn = document.getElementById('mobile-prone-btn');
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
  // How far a finger has to travel on the open screen before it steers. The
  // zone is the WHOLE stage now, so a thumb or index lying on the glass would
  // otherwise walk the view off its own micro drift. Same reason the ring and
  // the drag off FIRE have one.
  const MOBILE_LOOK_DEAD = 8;
  // The time constant of the fed look VELOCITY's smoothing, in seconds.
    //
    // WHY A VELOCITY AND NOT THE RAW PER-EVENT TRAVEL. Touch input is delivered
    // in bursts: the digitiser samples on its own clock, so one animation frame
    // often gets several `pointermove`s and the next gets none. The look stage
    // converts accumulated PIXELS into a per-frame axis (`mouse-input.js`
    // `pump`: `counts / elapsedSeconds`), so forwarding each event's raw travel
    // hands the sim one lump on the frames that received events and zero on the
    // frames that did not — a staircase the player reads as "jumpy panning".
    // Measured on the page (scratchpad/touchpan): during a steady drag 32 of 120
    // frames rotated by exactly 0 deg, each bracketed by a full-rotation frame.
    //
    // So the look is fed the way the move ring is (see `accumulateDeflection`):
    // each event's position delta over its own time delta recovers the finger's
    // true speed regardless of how the OS batched it, that speed is smoothed, and
    // each FRAME then contributes `smoothedSpeed x dt`. Frame-to-frame smoothness
    // depends on the smoothed rate, not on event cadence, so a frame that
    // received no event still turns by the steady rate and the staircase is gone.
    // The rate is in the same pixel currency as the mouse, so the sensitivity
    // profiles, the +-16 saturation and `countsPerPixel` reach it unchanged, and
    // `TOUCH_LOOK_SCALE` keeps its meaning (the same multiple on the same pixel
    // count).
    //
    // The smoothing is a TIME constant, not a per-sample fraction: the samples
    // are unevenly spaced, so a fixed fraction would make the window breathe
    // with the sample rate and the fed rate would still jitter. Each sample eases
    // the rate a fraction `1 - exp(-step / TAU)` of the way to its own
    // measurement, which is the same window whatever the spacing. It has to span
    // several frames (60 ms is ~4) for the fed rate to be steady frame to frame,
    // and it is short enough that a swipe still starts and stops promptly.
    const MOBILE_LOOK_TAU = 0.06;
    // The floor on the interval between two touch samples when recovering their
    // speed. Two samples can share a millisecond, and `travel / 0` would be a
    // spike; this also keeps the easing fraction sane at that spacing.
    const MOBILE_LOOK_MIN_STEP = 0.004;
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
  let panPointerId = null;
  let panLastX = 0;
  let panLastY = 0;
  // The open-screen drag's own rest threshold state.
  let lookArmed = false;
  let lookOriginX = 0;
  let lookOriginY = 0;
  // The smoothed look VELOCITY, in finger pixels per second, and when it was
  // last measured. Fed once a frame as `velocity x dt` (see
  // `feedMobileLook`); measured per event so a burst cannot jolt it. Reset on
  // every arm and every release, so a drag never inherits the last one's speed.
  const lookVel = { x: 0, y: 0, at: 0 };
  // The held FIRE's own look: armed only once the drag clears the dead circle,
  // and remembering where the last look sample was left so the frame that
  // crosses the threshold does not apply the slop as one jump.
  let mobileFireHeldPointerId = null;
  let fireLookArmed = false;
  let fireLookOriginX = 0;
  let fireLookOriginY = 0;
  let fireLookLastX = 0;
  let fireLookLastY = 0;
  // The drag off FIRE's smoothed velocity, same units and same reason as the
  // zone's above: fire-and-aim on a phone is a held thumb drifting, and a
  // thumb's touch samples arrive in bursts exactly as a pan's do.
  const fireLookVel = { x: 0, y: 0, at: 0 };
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

  /** Fold one touch sample's travel into a smoothed finger VELOCITY, in
   *  pixels per second.
   *
   *  `dx, dy` are this event's raw travel from the previous sample and `now`
   *  its timestamp. The interval is floored at `MOBILE_LOOK_MIN_STEP` because
   *  two samples can share a millisecond, and `travel / 0` would be an
   *  infinite speed that the smooth would then have to spend many frames
   *  decaying. The measurement is eased toward, not snapped to, so one bursty
   *  sample nudges the rate instead of replacing it. Returns nothing; the
   *  smoothed pair is the caller's own state. */
  function measureLookVelocity(dx, dy, now, vel) {
    const step = Math.max((now - vel.at) / 1000, MOBILE_LOOK_MIN_STEP);
    const measuredX = dx / step;
    const measuredY = dy / step;
    // Ease a TIME-constant's worth of the way to this measurement, so the
    // window is the same however the OS spaced its samples (see the constant).
    const ease = 1 - Math.exp(-step / MOBILE_LOOK_TAU);
    vel.x += (measuredX - vel.x) * ease;
    vel.y += (measuredY - vel.y) * ease;
    vel.at = now;
  }

  /** This frame's contribution from a held look drag: the smoothed finger
   *  speed turned into the pixel travel this frame represents.
   *
   *  Called ONCE A FRAME (beside `feedMobileTurretAim`) rather than once per
   *  touch event, and that is the whole fix. Feeding `speed x dt` gives the sim
   *  a rate that is steady across frames, so the look no longer depends on how
   *  many `pointermove`s the OS happened to deliver in each one. A frame that
   *  received no event still turns by `speed x dt`; a frame that received five
   *  turns by the same `speed x dt`. The staircase measured before this (frames
   *  at exactly 0 deg between full-rotation frames) is what that removes.
   *
   *  A finger that comes to rest stops sending samples, and nothing would ever
   *  bring the stored speed back to zero, so a held-still drag would turn the
   *  view forever. When the last sample is stale the speed eases to rest over
   *  the same time constant the measurement uses, so the aim coasts to a halt
   *  in a few frames instead of drifting. `vel` is already zero unless a drag
   *  is armed, and the release paths zero it, so a released drag cannot coast
   *  at all. */
  function feedLookVelocity(dt, vel) {
    if (!vel.x && !vel.y) return;
    // Ease the aim to a stop once the SAMPLES go stale. `vel.at` is stamped
    // only by a real pointermove (on `performance.now`, the same clock as
    // here), so a finger that has come to rest — and thus stopped sampling —
    // leaves `vel.at` behind and the aim coasts to a halt over the same time
    // constant the measurement uses. (Staleness cannot be measured against a
    // per-feed clock: consecutive fed frames each see only one frame's gap, so
    // that never crosses the gate and the rate would pin forever.)
    const idle = (performance.now() - vel.at) / 1000;
    if (vel.at && idle >= MOBILE_LOOK_TAU * 0.5) {
      const ease = 1 - Math.exp(-dt / MOBILE_LOOK_TAU);
      vel.x -= vel.x * ease;
      vel.y -= vel.y * ease;
    }
    if (!vel.x && !vel.y) return;
    page.lookDelta(vel.x * dt * TOUCH_LOOK_SCALE, vel.y * dt * TOUCH_LOOK_SCALE);
  }

  /** This frame's look contribution from whichever drag is armed, if any.
   *
   *  The zone drag and the drag off a held FIRE are mutually exclusive (the
   *  fire button is a button, so a finger on it never reaches the zone), so
   *  at most one of the two velocities is non-zero and one call serves both.
   *  Exported for the same per-frame call as `feedMobileTurretAim`. */
  function feedMobileLook(dt) {
    feedLookVelocity(dt, lookVel);
    feedLookVelocity(dt, fireLookVel);
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
    // A global reset is a release: neither drag may keep its aim after it, or
    // the next frame's `feedMobileLook` would turn a view nobody is dragging.
    lookVel.x = 0;
    lookVel.y = 0;
    fireLookVel.x = 0;
    fireLookVel.y = 0;
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
    mobileProneBtn.classList.remove('is-active');
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
    // The prone flag is in the signature because the Z key can flip it with no
    // touch of its own, and PRONE has to read as held either way.
    const prone = !!page.prone;
    const signature = [
      show, padMode, padUsable, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
      canFire, canAim, canReload, canPickup, freeSeat, sideOpen, sheetOpen, prone,
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
    // has no soldier to move). It covers the whole stage otherwise, so the
    // margins and the top steer like the middle does.
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
    mobileProneBtn.hidden = !onFoot;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld && onFoot);
    mobileCrouchBtn.classList.toggle('is-active', touchControls.mobileCrouchHeld && onFoot);
    mobileProneBtn.classList.toggle('is-active', prone && onFoot);
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

  /** Crouch is a hold and only a hold: the same `e.code` the keyboard path
   *  records (`c_PICrouch`, LeftCtrl, `c_CMPushAndHold` in the shipped
   *  Infantry.con), so the engine's per-frame held read sees one key wherever
   *  it came from. Releasing stands the soldier back up, which BODY-1 reads
   *  off `Lb_Crouch`'s own `returnToState Lb_CrouchToStand`.
   *
   *  Prone used to be this button's 500 ms long press, and that was wrong in
   *  two ways at once: a hold and a toggle cannot share one target, and
   *  nothing on the phone could undo the toggle. Prone is its own button now
   *  (`c_PILie`, the Z key, `c_CMNonRepetitive`). */
  function holdMobileCrouch(on) {
    if (on) {
      page.setFly(true);
      touchControls.mobileCrouchHeld = true;
      page.keys.add(CROUCH_CODE);
      mobileCrouchBtn.classList.add('is-active');
    } else {
      touchControls.mobileCrouchHeld = false;
      page.keys.delete(CROUCH_CODE);
      mobileCrouchBtn.classList.remove('is-active');
    }
  }

  function releaseMobileCrouch() {
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

  // The zone is the look, and it is the WHOLE stage under the buttons, so a
  // drag that did not start on a button pans the camera however far across the
  // screen it happens to run. Held on one pointer; the canvas underneath never
  // sees the touches. `MOBILE_LOOK_DEAD` px of rest before it engages, because
  // a finger lying on open glass would otherwise walk the view.
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
    lookArmed = false;
    lookOriginX = event.clientX;
    lookOriginY = event.clientY;
    // The velocity starts at rest, timed now, so the first measured sample is
    // the press point's own interval and a fresh drag never inherits the
    // previous one's speed.
    lookVel.x = 0;
    lookVel.y = 0;
    lookVel.at = performance.now();
    trackPointer(event.pointerId, () => releaseMobileLook(event));
    try { mobileZoneLook.setPointerCapture(event.pointerId); } catch {}
  });

  mobileZoneLook.addEventListener('pointermove', event => {
    if (event.pointerId !== panPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!lookArmed) {
      const dx0 = event.clientX - lookOriginX;
      const dy0 = event.clientY - lookOriginY;
      const dist = Math.hypot(dx0, dy0);
      if (dist < MOBILE_LOOK_DEAD) return;
      lookArmed = true;
      // Resume from the edge of the dead circle, so the frame that crosses it
      // does not apply the slop as one jump. The velocity is timed from here,
      // which is what makes the circle the true origin of the drag.
      panLastX = lookOriginX + (dx0 / dist) * MOBILE_LOOK_DEAD;
      panLastY = lookOriginY + (dy0 / dist) * MOBILE_LOOK_DEAD;
      lookVel.at = performance.now();
    }
    // Measure the travel into the smoothed velocity; `feedMobileLook` turns it
    // into the frame's rotation once a frame.
    measureLookVelocity(event.clientX - panLastX, event.clientY - panLastY,
      performance.now(), lookVel);
    panLastX = event.clientX;
    panLastY = event.clientY;
  });

  function releaseMobileLook(event) {
    if (event.pointerId !== panPointerId) return;
    try {
      if (mobileZoneLook.hasPointerCapture(event.pointerId)) {
        mobileZoneLook.releasePointerCapture(event.pointerId);
      }
    } catch {}
    panPointerId = null;
    lookArmed = false;
    // A released drag is at rest. Zeroing here is what stops a fast pan from
    // coasting on after the finger lifts.
    lookVel.x = 0;
    lookVel.y = 0;
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
    // At rest until the drag clears the dead circle, so a resting thumb never
    // walks the view however long it is held.
    fireLookVel.x = 0;
    fireLookVel.y = 0;
    fireLookVel.at = performance.now();
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
      // Timed from the dead circle's edge, like the zone's drag.
      fireLookVel.at = performance.now();
    }
    // Measured, not forwarded: the thumb's samples burst exactly as a pan's
    // do, and the smoothing is what keeps a held FIRE from stepping the view.
    measureLookVelocity(event.clientX - fireLookLastX, event.clientY - fireLookLastY,
      performance.now(), fireLookVel);
    fireLookLastX = event.clientX;
    fireLookLastY = event.clientY;
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
    // The thumb is off the trigger, so the aim it was carrying stops here.
    fireLookVel.x = 0;
    fireLookVel.y = 0;
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

  // Prone, the Z key's own toggle (`c_PILie`, `c_CMNonRepetive`). Tapping it a
  // second time is the road back up, exactly as on the keyboard, and the
  // soldier rises through `Lb_LieToStand` (BODY-1). Jump is deliberately not
  // that road: the engine sets the jump bit only when neither the crouch nor
  // the prone flag is set (client `0x00500628`-`0x0050067a`, symbols.json
  // `BFSoldier_jumpFlagSet`), so a prone man's Space press does nothing at all.
  //
  // The visibility pass is called straight on rather than left to the next
  // `paintHud`, because this is the one button whose own lit state the press
  // changes, and a frame of latency on "am I prone" is a frame of doubt.
  edgeButton(mobileProneBtn, () => {
    page.toggleProne();
    updateMobileControls();
  }, () => !mobileProneBtn.disabled && !mobileProneBtn.hidden);

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
    feedMobileLook,
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