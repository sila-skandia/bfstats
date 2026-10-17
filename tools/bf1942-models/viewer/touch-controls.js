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
 *   one short row per thumb at the same height, 6 px between neighbours, so a
 *   thumb never travels more than one button width: STANCE (tap crouch,
 *   hold prone) and SIGHTS for the left thumb, JUMP for the right,
 *   FIRE inboard of the bottom-right corner on foot (a round trigger with
 *   glass on every side of it, so the drag off a held FIRE can go right and
 *   down as well as up and left), RELOAD toward the edge beside it, the
 *   weapon pair in the corner itself (taps need no room),
 *   the claw pair along the top edge for the index fingers curled over it:
 *   a second FIRE top-left and the AIM/ALT trigger top-right, mirrors of the
 *   thumb buttons (a trigger with two buttons is down while either is held),
 *   the MORE tab on the bottom centre, opening the sheet that holds pickup,
 *   seats, view, map and throttle,
 *   the ENTER/EXIT pill above the tab, out of both corners, shown the moment
 *   the entry scan offers a door on foot and all the while a seat is held,
 *   the vehicle ring on the right edge, shown seated only: the seated stick
 *   (STEER in a car, STICK in a plane, AIM on a gun), while the left ring
 *   keeps only the throttle's vertical axis in those modes.
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
 * `enterVehicle`, `exitSeat`, `footView3p`, `handSlot`, `handWeapon`, `hudPack`, `isTouchDevice`,
 * `keys`, `kitOffer`, `kitWeaponSlots`, `lookDelta`, `mannedActive`, `prone`,
 * `mouseInput`, `nearEntry`, `nearestEntry`, `noteSeatToggle`, `occupancy`, `requestSeatToggle`,
 * `optOnFoot`, `optPilot`, `padTriggerDown`, `pickupKit`, `releaseButtons`,
 * `seatToggleReady`, `setFly`, `setTouchAltFire`,
 * `setTouchTriggers`, `soldier`, `soldierDead`, `startReload`, `switchSeat`,
 * `toggleProne`, `view`, `weaponBarFire`.
 */
import { kitIconCandidates } from './kit-icon.js';
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
  // One button for the two stances (tap: crouch, hold: prone).
  const mobileStanceBtn = document.getElementById('mobile-stance-btn');
  const mobileMapBtn = document.getElementById('mobile-map-btn');
  const mobilePickupBtn = document.getElementById('mobile-pickup-btn');
  const mobileSeatsBtn = document.getElementById('mobile-seats-btn');
  const mobileThrottleWrap = document.getElementById('mobile-throttle-wrap');
  const mobileThrottleInput = document.getElementById('mobile-throttle');
  const mobileThrottleValue = document.getElementById('mobile-throttle-value');
  // The vehicle ring (the seated stick) and the weapon chip readout.
  const mobilePadRight = document.getElementById('mobile-pad-right');
  const mobilePadRightPuck = document.getElementById('mobile-pad-right-puck');
  const mobilePadRightLabel = document.getElementById('mobile-pad-right-label');
  const mobileWeaponChip = document.getElementById('mobile-weapon-chip');
  const mobileWeaponChipIcon = document.getElementById('mobile-weapon-chip-icon');
  const mobileWeaponChipName = document.getElementById('mobile-weapon-chip-name');
  // The kit bar, the pilot's throttle slider and rudder pair, and the
  // `?touchstats` readout.
  const mobileKitBar = document.getElementById('mobile-kit-bar');
  const mobileThrWrap = document.getElementById('mobile-thr-wrap');
  const mobileThrTrack = document.getElementById('mobile-thr-track');
  const mobileThrFill = document.getElementById('mobile-thr-fill');
  const mobileThrKnob = document.getElementById('mobile-thr-knob');
  const mobileThrValue = document.getElementById('mobile-thr-value');
  const mobileRudLBtn = document.getElementById('mobile-rud-l-btn');
  const mobileRudRBtn = document.getElementById('mobile-rud-r-btn');
  const mobileTouchStats = document.getElementById('mobile-touchstats');
  const TOUCH_STATS = !!(globalThis.location
    && new URLSearchParams(globalThis.location.search).has('touchstats'));
  // The claw pair along the top edge, for the index fingers curled over it:
  // a second FIRE top-left, and top-right the trigger the right thumb's row
  // holds (AIM on foot, ALT seated). Mirrors, not new bindings: either FIRE
  // holds the one trigger, and it stays down until BOTH are up.
  const mobileClawFireBtn = document.getElementById('mobile-claw-fire-btn');
  const mobileClawAltBtn = document.getElementById('mobile-claw-alt-btn');
  // The fire cluster (class only, no id) and the AIM button's home: seated
  // the button moves beside FIRE and reads ALT -- the seat's other trigger,
  // c_PIAltFire, which the AIM label hid whole -- and returns to its row
  // (the zoom) on foot.
  const mobileFireCluster = document.querySelector('.mobile-fire-cluster');
  const aimHome = mobileAimBtn.parentElement;
  const aimHomeNext = mobileAimBtn.nextSibling;
  let mobileAimMode = '';
  // The ENTER/EXIT pill's parts, built once: two glyphs (the viewer's own
  // vector strokes -- the archives carry no enter icon, a keyboard game needs
  // none) and the word, which the visibility pass swaps. The plate behind it
  // is the menu's own beveled button (`knappext_n`/`_mo`, packed from
  // menu.rfa), hydrated from the sprite pack the first update that finds
  // them loaded.
  let useWord = null;
  let useGlyphs = null;
  touchControls.knappPlated = false;
  const USE_ENTER_GLYPH =
    '<svg class="mu-glyph" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M2 8h9M8 4.6 11.4 8 8 11.4M13 3v10" fill="none" stroke="currentColor"' +
    ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const USE_EXIT_GLYPH =
    '<svg class="mu-glyph" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M14 8H5M8 4.6 4.6 8 8 11.4M3 3v10" fill="none" stroke="currentColor"' +
    ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function buildUsePill() {
    mobileUseBtn.innerHTML = `${USE_ENTER_GLYPH}${USE_EXIT_GLYPH}<span class="mobile-use-word">ENTER</span>`;
    useWord = mobileUseBtn.querySelector('.mobile-use-word');
    useGlyphs = mobileUseBtn.querySelectorAll('.mu-glyph');
  }
  buildUsePill();
  // The fixed move ring: 64 px across with a 28 px ball (`map.css`, keep the
  // three together). The ball's whole travel is 18 px and that travel IS the
  // input range, with full deflection where the ball touches the ring, so the
  // stick answers a twitch. The 5 px dead circle at the centre is what lets a
  // resting finger stand still. This is the viewer's own touch choice, stated
  // rather than transcribed (BF1942 has no touch device to read).
  const MOBILE_PAD_TRAVEL = 18;
  const MOBILE_PAD_DEAD = 5;
  // The flight stick's travel (the right ring in the air, `is-stick`: a
  // 104 px ring and a 32 px ball), twice the move ring's. The move ring's
  // 13 usable pixels were about 3 mm of thumb for full aileron and
  // elevator, which is the instability the plane playtest felt; a gamepad
  // stick has about 10 mm. With it a RESPONSE CURVE: the deflection blends
  // toward its cube, so the centre is soft and a tremor is a trim rather
  // than a snap roll, and full stick is still full stick. The viewer's own
  // touch choice, stated rather than transcribed.
  const MOBILE_STICK_TRAVEL = 36;
  const MOBILE_STICK_EXPO = 0.7;
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
    // The same window with a SECOND contact down (a thumb on a ring while the
    // other pans). Phone digitisers sample slower and burst more with two
    // contacts, and the one-finger window let the bursts through as jumps:
    // the owner's "panning is jumpy while I hold the left control". Twice the
    // window costs ~60 ms more lag at the start and end of a two-finger pan.
    const MOBILE_LOOK_TAU_TWO = 0.12;
    const lookTau = () => (heldPointers.size >= 2 ? MOBILE_LOOK_TAU_TWO : MOBILE_LOOK_TAU);
    // The floor on the interval between two touch samples when recovering their
    // speed. Two samples can share a millisecond, and `travel / 0` would be a
    // spike; this also keeps the easing fraction sane at that spacing.
    const MOBILE_LOOK_MIN_STEP = 0.004;
    // Tells `lookDelta` the delta is a finger, not the mouse: a pilot's mouse
    // flies the aircraft with the look key up, and the look zone must not.
    const TOUCH_SOURCE = Object.freeze({ touch: true });
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
  // Which pointers hold FIRE and which hold AIM/ALT, across the thumb button
  // and its claw mirror. A trigger with two buttons is down while EITHER is
  // held, and lifts only when the last finger leaves: a left index that
  // keeps firing through the thumb's release must not drop the trigger.
  const fireHolders = new Set();
  const aimHolders = new Set();
  const jumpHolders = new Set();
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
  // The vehicle ring's own state and geometry: the seated stick (DRIVE /
  // STICK / AIM), the left ring's twin. In those modes the left ring keeps
  // only the throttle's vertical axis and this one carries the stick the
  // right thumb steers and aims with, in the free zone the old open-screen
  // drag owned. Same dead circle and travel as the left ring.
  const mobileRightPadVector = { x: 0, y: 0 };
  touchControls.mobileRightPadPointerId = null;
  touchControls.mobileRightPadHeld = false;
  let rightPadCentreX = 0;
  let rightPadCentreY = 0;
  // The weapon chip's flash timer, cleared and restarted on every cycle press.
  let weaponChipTimer = 0;

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
    release(event);
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

  /** The vehicle ring's axis (the seated stick): STEER in a car (its yaw
   *  axis), STICK in a plane (roll and pitch), AIM on a gun. Zero unless the
   *  ring is held, exactly as the left ring's is. */
  function mobileRightPadAxis(axis) {
    return touchControls.mobileRightPadHeld ? mobileRightPadVector[axis] : 0;
  }

  /**
   * The vehicle ring's contribution to the same input stage the mouse feeds:
   * the seat's aim. The deflected counts land in the mouse stage the seat
   * camera reads, so the ring aims a turret, a free-look camera, whatever
   * the seat owns -- the same words the desktop mouse says seated.
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
   * Aircraft are fed separately: a plane's roll and pitch read the ring's
   * vector straight (`local-player.js` seated branch), so feeding the stage
   * here would drive the same surfaces twice.
   *
   * `-y` because the pad reports up-positive and the mouse (and DirectInput)
   * report down-positive.
   */
  function feedMobileTurretAim(dt) {
    if (!touchControls.mobileRightPadHeld || page.aircraft) return;
    page.mouseInput.accumulateDeflection(
      mobileRightPadVector.x, -mobileRightPadVector.y, dt, MOBILE_AIM_PIXELS_PER_SECOND);
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
    const ease = 1 - Math.exp(-step / lookTau());
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
    if (vel.at && idle >= lookTau() * 0.5) {
      const ease = 1 - Math.exp(-dt / lookTau());
      vel.x -= vel.x * ease;
      vel.y -= vel.y * ease;
    }
    if (!vel.x && !vel.y) return;
    page.lookDelta(vel.x * dt * TOUCH_LOOK_SCALE, vel.y * dt * TOUCH_LOOK_SCALE, TOUCH_SOURCE);
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
    if (TOUCH_STATS) paintTouchStats();
  }

  // `?touchstats`: how many pan samples a second the zone drag is getting,
  // and how many contacts are down, so the smoothing can be tuned against a
  // real phone's numbers rather than guessed at.
  let panSamples = 0;
  let statsAt = 0;
  let statsHz = 0;
  function paintTouchStats() {
    const now = performance.now();
    if (!statsAt) statsAt = now;
    if (now - statsAt >= 500) {
      statsHz = Math.round(panSamples * 1000 / (now - statsAt));
      panSamples = 0;
      statsAt = now;
    }
    mobileTouchStats.hidden = false;
    mobileTouchStats.textContent =
      `pan ${statsHz} Hz  contacts ${heldPointers.size}  tau ${Math.round(lookTau() * 1000)} ms`;
  }

  // The rings are FIXED: a release only centres the ball again, it never hides
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

  function resetMobileRightPad() {
    touchControls.mobileRightPadPointerId = null;
    touchControls.mobileRightPadHeld = false;
    mobileRightPadVector.x = 0;
    mobileRightPadVector.y = 0;
    mobilePadRightPuck.style.transform = 'translate(-50%, -50%)';
    mobilePadRight.classList.remove('is-active');
  }

  /** The weapon chip's flash ends: the icon and name go dark until the next
   *  cycle press. A global reset ends it too (a seat entry, a spawn). */
  function hideWeaponChip() {
    clearTimeout(weaponChipTimer);
    weaponChipTimer = 0;
    mobileWeaponChip.hidden = true;
  }

  /** The kit icon of the weapon the PREV/NEXT pair just raised, one flash per
   *  press. The engine's own word for this is the weapon bar raised on an
   *  item change (`weapon-bar.js` `itemEnabled`, PICK_TIMEOUT); the chip is
   *  the same idea a thumb can read, beside the pair that pressed it. The
   *  icon is the kit slot's packed sprite (`kitWeaponSlots` `icon` ->
   *  `kitIconCandidates` -> `hudPack`'s sprite); without the sprite (a pack
   *  that has not caught up to the mod) the chip still says the weapon's own
   *  name, so a press is never wordless. */
  const WEAPON_CHIP_MS = 1400;
  function flashWeaponChip() {
    const name = page.handWeapon?.name ?? null;
    const entry = (page.kitWeaponSlots ?? []).find(w => w.weapon === name) ?? null;
    let iconShown = false;
    for (const key of kitIconCandidates(entry?.icon)) {
      const sprite = page.hudPack?.sprites?.get?.(key);
      if (sprite) {
        mobileWeaponChipIcon.src = sprite.src;
        mobileWeaponChipIcon.hidden = false;
        iconShown = true;
        break;
      }
    }
    if (!iconShown) mobileWeaponChipIcon.hidden = true;
    mobileWeaponChipName.textContent = entry?.weapon ?? name ?? '';
    mobileWeaponChip.hidden = false;
    clearTimeout(weaponChipTimer);
    weaponChipTimer = setTimeout(hideWeaponChip, WEAPON_CHIP_MS);
  }

  function resetMobileControls() {
    heldPointers.clear();
    resetMobilePad();
    resetMobileRightPad();
    hideWeaponChip();
    setMobileSheet(false);
    fireLookArmed = false;
    // A global reset is a release: neither drag may keep its aim after it, or
    // the next frame's `feedMobileLook` would turn a view nobody is dragging.
    lookVel.x = 0;
    lookVel.y = 0;
    fireLookVel.x = 0;
    fireLookVel.y = 0;
    mobileFireHeldPointerId = null;
    fireHolders.clear();
    aimHolders.clear();
    jumpHolders.clear();
    touchControls.mobileFireHeld = false;
    touchControls.mobileJumpHeld = false;
    touchControls.mobileThrottle = 0;
    touchControls.mobileThrottleTouched = false;
    page.releaseButtons();
    releaseMobileCrouch();
    mobileFireBtn.classList.remove('is-active');
    mobileClawFireBtn.classList.remove('is-active');
    mobileAimBtn.classList.remove('is-active');
    mobileClawAltBtn.classList.remove('is-active');
    mobileJumpBtn.classList.remove('is-active');
    mobileStanceBtn.classList.remove('is-active', 'is-prone');
    mobileThrottleInput.value = '0';
    mobileThrottleValue.value = '0';
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', 0);
    releaseRudder();
    thrPointerId = null;
    paintThrottle();
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
    paintThrottle();
  }

  /** The slider's knob, fill and word follow `mobileThrottle`. */
  function paintThrottle() {
    const pct = Math.round(touchControls.mobileThrottle * 100);
    mobileThrFill.style.height = `${pct}%`;
    mobileThrKnob.style.bottom = `${pct}%`;
    mobileThrValue.textContent = `THR ${pct}`;
  }

  /** A finger on the track sets the throttle to where it is and LEAVES it
   *  there: a latch, not a spring. The sheet's range input shows the same
   *  value. The hull takes it straight (`c_PIThrottle`), as the sheet's
   *  slider always did; a helicopter's keyed collective reads the same. */
  function setThrottleFromPointer(event) {
    const rect = mobileThrTrack.getBoundingClientRect();
    if (!rect.height) return;
    const v = Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height));
    touchControls.mobileThrottle = v;
    touchControls.mobileThrottleTouched = true;
    mobileThrottleInput.value = String(Math.round(v * 100));
    mobileThrottleValue.value = String(Math.round(v * 100));
    if (page.aircraft) page.aircraft.setInput('c_PIThrottle', v);
    paintThrottle();
  }
  let thrPointerId = null;
  mobileThrTrack.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    thrPointerId = event.pointerId;
    try { mobileThrTrack.setPointerCapture(event.pointerId); } catch {}
    trackPointer(event.pointerId, () => { if (thrPointerId === event.pointerId) thrPointerId = null; });
    setThrottleFromPointer(event);
  });
  mobileThrTrack.addEventListener('pointermove', event => {
    if (event.pointerId !== thrPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setThrottleFromPointer(event);
  });

  // The rudder pair: the keyboard's A and D as held buttons, a step each
  // way (`c_PIYaw`, D positive). Two holder sets, so a finger that slides
  // from one to the other reads the last one down.
  const rudLHolders = new Set();
  const rudRHolders = new Set();
  function mobileRudderAxis() {
    return (rudRHolders.size ? 1 : 0) - (rudLHolders.size ? 1 : 0);
  }
  function releaseRudder() {
    rudLHolders.clear();
    rudRHolders.clear();
    mobileRudLBtn.classList.remove('is-active');
    mobileRudRBtn.classList.remove('is-active');
  }
  function bindRudder(button, holders) {
    bindHeldTrigger(button,
      id => { holders.add(id); button.classList.add('is-active'); },
      id => { holders.delete(id); if (!holders.size) button.classList.remove('is-active'); });
  }
  bindRudder(mobileRudLBtn, rudLHolders);
  bindRudder(mobileRudRBtn, rudRHolders);

  /** The weapon pair: one press steps the kit's weapon bar one slot and then
   *  COMMITS it, so the press raises the weapon instead of only moving the
   *  bar's highlight the way the mouse wheel does (the wheel leaves the raise
   *  to Fire; a phone has no wheel to hover over, and the owner wants to
   *  memorise the cycle over time). `cycleKitWeapon` is `c_PINextItem` /
   *  `c_PIPrevItem` (wrapping), `weaponBarFire` is the Fire press that turns
   *  the highlight into the slot's `c_PIMenuSelect`. */
  function mobileCycleWeapon(dir) {
    if (page.occupancy) { mobileCycleSeat(dir); return; }
    if (!page.cycleKitWeapon(dir)) return;
    page.weaponBarFire();
    flashWeaponChip();
  }

  /** Seated, the corner pair steps SEATS: the next free seat in the
   *  vehicle's spawn-declared order from the one held, wrapping, which is
   *  the digit row walked one key at a time. The chip names the seat the
   *  press asked for (the switch itself is the seat's, or the server's). */
  function mobileCycleSeat(dir) {
    const seat = page.occupancy;
    const order = seat?.order ?? [];
    if (order.length < 2) return;
    const from = Math.max(0, order.indexOf(seat.activeSeatId));
    for (let step = 1; step < order.length; step++) {
      const position = (from + dir * step + order.length * step) % order.length;
      const id = order[position];
      if (id === undefined || id === seat.activeSeatId) continue;
      if (seat.instance.holder(id) != null) continue;
      page.switchSeat(position);
      mobileWeaponChipIcon.hidden = true;
      mobileWeaponChipName.textContent = `SEAT ${position + 1}`;
      mobileWeaponChip.hidden = false;
      clearTimeout(weaponChipTimer);
      weaponChipTimer = setTimeout(hideWeaponChip, WEAPON_CHIP_MS);
      return;
    }
  }

  /** The kit bar: one button per kit slot, in slot order, the raised one
   *  lit. Rebuilt only when the kit, the raised slot or the sprite pack
   *  changed (the pass's `kitSig`), so a steady frame touches no DOM. */
  let kitBarSig = '';
  function renderKitBar(show) {
    const slots = show ? [...(page.kitWeaponSlots ?? [])].sort((a, b) => a.slot - b.slot) : [];
    const sig = slots.map(w => `${w.slot}:${w.weapon}`).join(',')
      + `|${page.handSlot}|${page.hudPack?.sprites?.size ?? 0}`;
    if (sig === kitBarSig) return;
    kitBarSig = sig;
    mobileKitBar.replaceChildren();
    mobileKitBar.hidden = slots.length === 0;
    for (const entry of slots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-kit-slot';
      button.setAttribute('aria-label', `Raise ${entry.weapon}`);
      button.classList.toggle('is-current', entry.slot === page.handSlot);
      let drawn = false;
      for (const key of kitIconCandidates(entry.icon)) {
        const sprite = page.hudPack?.sprites?.get?.(key);
        if (!sprite) continue;
        const img = document.createElement('img');
        img.alt = '';
        img.src = sprite.src;
        button.append(img);
        drawn = true;
        break;
      }
      if (!drawn) button.textContent = String(entry.slot);
      edgeButton(button, () => {
        if (page.selectKitWeapon(entry.slot)) flashWeaponChip();
      });
      mobileKitBar.append(button);
    }
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
    // Two sticks now, one per thumb. The LEFT ring is movement on foot and
    // the throttle's vertical axis seated; on a gun no throttle reaches the
    // seat, so it hides there. The RIGHT ring is the seated stick, the left
    // ring's twin: STEER in a car (its yaw axis), STICK in a plane (roll and
    // pitch), AIM on a gun. `padMode` keeps its whole-mode name for
    // `#mobile-controls[data-mode]`, where the seated layout lifts the fire
    // cluster (FIRE and ALT, the AIM button's seated job) above the right
    // ring while the left ring keeps the drive.
    // In the air the left ring gives way to the throttle slider and the
    // rudder pair (`mobileThrWrap`), and the right ring grows into the stick.
    const padUsable = !!(onFoot || driving);
    const rightUsable = !!(driving || flying || aimable);
    // The corner pair: the kit's weapons on foot, the vehicle's seats seated.
    const seatPair = seated && (page.occupancy?.order?.length ?? 0) > 1;
    // The rings' jobs: the LEFT ring drives (throttle + steer, or throttle +
    // rudder in the air), the RIGHT ring aims -- a turret, hull camera or
    // plane stick. The words are the labels the thumbs read.
    const rightMode = flying ? 'STICK' : 'AIM';
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
    // The crouch latch and the weapon's zoom latch are in it for the same
    // reason: the stance word and the SIGHTS light read state that a key, a
    // shot (the sniper's un-zoom between rounds) or a weapon change can move
    // with no touch of its own.
    const crouched = touchControls.mobileCrouchHeld;
    const zoomed = onFoot && !!page.handWeapon?.zoomed;
    // The kit bar reads the kit, the raised slot and the sprite pack.
    renderKitBar(onFoot && show);
    const signature = [
      show, padMode, padUsable, onFoot, seated, manned, driving, flying, aimable,
      page.nearEntry?.control || '', touchControls.mobileThrottleTouched,
      canFire, canAim, canReload, canPickup, freeSeat, sideOpen, sheetOpen, prone,
      crouched, zoomed, seatPair,
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
    if (mobilePadRight.hidden && touchControls.mobileRightPadHeld) resetMobileRightPad();
    if (mobileZoneLook.hidden && panPointerId !== null) panPointerId = null;
    mobileMoreScrim.hidden = !sheetOpen;
    mobileMoreSheet.hidden = !sheetOpen;
    mobilePad.hidden = !(show && padUsable);
    mobilePadLabel.textContent = onFoot ? 'MOVE' : 'DRIVE';
    mobilePadRight.hidden = !(show && rightUsable);
    mobilePadRight.classList.toggle('is-stick', !!flying);
    mobileThrWrap.hidden = !(show && flying);
    if (mobileThrWrap.hidden) releaseRudder();
    mobilePadRightLabel.textContent = rightMode ?? '';
    mobileFireBtn.hidden = !canFire;
    mobileFireBtn.disabled = !canFire;
    mobileFireBtn.classList.toggle('is-active', touchControls.mobileFireHeld && canFire);
    mobileAimBtn.hidden = !canAim;
    mobileAimBtn.disabled = !canAim;
    // The claw pair follows the triggers it mirrors, and steps aside under
    // the sheet, which drops from the same edge. The right pill reads the
    // row button's word: AIM on foot, ALT (the seat's second trigger) seated.
    mobileClawFireBtn.hidden = !canFire || sheetOpen;
    mobileClawFireBtn.disabled = !canFire;
    // The top-right pill is JUMP on foot -- the right index's job in the
    // four-finger grips, a jump that costs neither thumb its stick -- and
    // the seat's ALT seated.
    const topUsable = onFoot || canAim;
    mobileClawAltBtn.hidden = !topUsable || sheetOpen;
    mobileClawAltBtn.disabled = !topUsable;
    mobileClawAltBtn.textContent = onFoot ? 'JUMP' : 'ALT';
    // AIM's second job, made legible: seated it is the seat's OTHER trigger
    // (`c_PIAltFire` -- a Sherman's coax, a Corsair's bombs; even a
    // single-weapon seat carries one, which is what "left and right mouse"
    // is on the desktop). It moves into the fire cluster beside FIRE, reads
    // ALT, and wears the seat's declared secondary ammo icon when the pack
    // has it; on foot it returns to its row as the zoom's AIM.
    const aimMode = !canAim ? 'off' : onFoot ? 'foot' : 'alt';
    if (mobileAimMode !== aimMode) {
      mobileAimMode = aimMode;
      if (aimMode === 'alt') {
        mobileFireCluster.insertBefore(mobileAimBtn, mobileFireBtn);
        const altIcon = page.occupancy?.activeHud?.()?.secondaryAmmoIcon ?? null;
        let iconSrc = '';
        for (const key of kitIconCandidates(altIcon)) {
          const sprite = page.hudPack?.sprites?.get?.(key);
          if (sprite) { iconSrc = sprite.src; break; }
        }
        if (iconSrc) {
          const img = document.createElement('img');
          img.className = 'mobile-btn-icon';
          img.alt = '';
          img.src = iconSrc;
          mobileAimBtn.append(img, 'ALT');
        } else {
          mobileAimBtn.textContent = 'ALT';
        }
      } else if (aimMode === 'foot') {
        aimHome.insertBefore(mobileAimBtn, aimHomeNext);
        mobileAimBtn.textContent = 'SIGHTS';
      }
    }
    mobileReloadBtn.hidden = !canReload;
    mobileReloadBtn.disabled = !canReload;
    mobileWPrevBtn.hidden = !(onFoot || seatPair);
    mobileWNextBtn.hidden = !(onFoot || seatPair);
    mobileWPrevBtn.textContent = seatPair ? 'SEAT -' : 'PREV';
    mobileWNextBtn.textContent = seatPair ? 'SEAT +' : 'NEXT';
    mobilePickupBtn.hidden = !canPickup;
    mobileSeatsBtn.hidden = freeSeat < 0;
    mobileJumpBtn.hidden = !onFoot;
    mobileStanceBtn.hidden = !onFoot;
    mobileJumpBtn.classList.toggle('is-active', touchControls.mobileJumpHeld && onFoot);
    // The stance button reads the stance: CROUCH lit while crouched, PRONE
    // lit in the warn colour while prone, an unlit CROUCH standing, which is
    // what a tap does next.
    mobileStanceBtn.textContent = prone ? 'PRONE' : 'CROUCH';
    mobileStanceBtn.classList.toggle('is-active', onFoot && (prone || crouched));
    mobileStanceBtn.classList.toggle('is-prone', onFoot && prone);
    // SIGHTS lit while the zoom is latched or a held zoom is held.
    if (onFoot) mobileAimBtn.classList.toggle('is-active', zoomed || aimHolders.size > 0);
    // The enter/exit affordance is its own pill now, above the MORE tab:
    // shown the moment a door is in reach on foot (the scan's own offer) and
    // all the while a seat is held (EXIT). Out of reach it hides rather than
    // greys -- an always-there dead pill is one more thing the eye reads past.
    const canUse = seated || !!(onFoot && page.nearEntry);
    mobileUseBtn.hidden = !canUse;
    mobileUseBtn.disabled = !canUse;
    useWord.textContent = seated ? 'EXIT' : 'ENTER';
    useGlyphs[0].hidden = seated;
    useGlyphs[1].hidden = !seated;
    // The menu's own beveled button, packed from menu.rfa, as the pill's
    // plate once its sprites have landed (the whole vanilla set loads
    // eventually; `want` only promotes it). CSS reads the two urls through
    // custom properties and flips to the `_mo` plate on the lit state.
    if (!touchControls.knappPlated) {
      const sprites = page.hudPack?.sprites;
      if (sprites?.has?.('knappext_n') && sprites?.has?.('knappext_mo')) {
        mobileControls.style.setProperty('--knapp-n', `url(${sprites.get('knappext_n').src})`);
        mobileControls.style.setProperty('--knapp-mo', `url(${sprites.get('knappext_mo').src})`);
        touchControls.knappPlated = true;
      } else {
        page.hudPack?.want?.(['knappext_n', 'knappext_mo']);
      }
    }
    mobileViewBtn.hidden = !((seated && page.view) || (onFoot && page.footView3p.modes.length > 1));
    mobileThrottleWrap.hidden = !flying;
    if (flying) syncMobileThrottle();
    mobileControls.dataset.mode = padMode;
  }

  /** A FIXED ring's deflection, either ring. The ball tracks the finger's
   *  offset from the ring's centre and clamps inside it; the input range is
   *  the ball's whole travel, with a dead circle at the centre so a resting
   *  finger stands still. */
  function padDeflection(event, cx, cy, vector, puck,
    travel = MOBILE_PAD_TRAVEL, expo = 0) {
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const inv = dist > 0 ? 1 / dist : 0;
    // Full deflection where the ball touches the ring (`travel`), zero
    // inside the dead circle; `expo` blends the ramp toward its cube (the
    // flight stick's soft centre).
    const linear = Math.max(0, Math.min(1, (dist - MOBILE_PAD_DEAD) / (travel - MOBILE_PAD_DEAD)));
    const deflect = linear * ((1 - expo) + expo * linear * linear);
    vector.x = dx * inv * deflect;
    vector.y = -(dy * inv) * deflect;
    const vis = Math.min(dist, travel);
    puck.style.transform =
      `translate(calc(-50% + ${(dx * inv * vis).toFixed(1)}px), calc(-50% + ${(dy * inv * vis).toFixed(1)}px))`;
  }

  function updateMobilePad(event) {
    padDeflection(event, padCentreX, padCentreY, mobilePadVector, mobilePadPuck);
  }

  function updateMobileRightPad(event) {
    const stick = !!page.aircraft;
    padDeflection(event, rightPadCentreX, rightPadCentreY,
      mobileRightPadVector, mobilePadRightPuck,
      stick ? MOBILE_STICK_TRAVEL : MOBILE_PAD_TRAVEL, stick ? MOBILE_STICK_EXPO : 0);
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

  function releaseMobileRightPad(event) {
    if (touchControls.mobileRightPadPointerId !== null && event.pointerId !== touchControls.mobileRightPadPointerId) return;
    try {
      if (mobilePadRight.hasPointerCapture(event.pointerId)) {
        mobilePadRight.releasePointerCapture(event.pointerId);
      }
    } catch {}
    resetMobileRightPad();
  }

  function setMobileFire(on) {
    touchControls.mobileFireHeld = on;
    page.setTouchTriggers(
      on && page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy,
      on && page.optPilot.checked && !!page.occupancy
        && (page.occupancy.isActiveRoot() || page.mannedActive()));
    mobileFireBtn.classList.toggle('is-active', on);
    mobileClawFireBtn.classList.toggle('is-active', on);
    mobilePadPuck.classList.toggle('is-firing', on);
    mobilePadRightPuck.classList.toggle('is-firing', on);
  }

  /** One finger takes hold of FIRE (the thumb button or its claw mirror):
   *  the trigger goes down on the first holder and stays down for the rest. */
  function holdFire(pointerId) {
    const first = fireHolders.size === 0;
    fireHolders.add(pointerId);
    if (first) setMobileFire(true);
  }

  /** One finger lets go of FIRE: the trigger lifts only with the last. */
  function dropFire(pointerId) {
    if (!fireHolders.delete(pointerId)) return;
    if (fireHolders.size === 0) setMobileFire(false);
  }

  /** The AIM button: the touch twin of the right mouse button. On foot it
   *  holds the soldier's aim (zoom); seated it holds the seat's
   *  `c_PIAltFire` (a Sherman's coax, a Corsair's bombs). */
  function setMobileAim(on) {
    const foot = page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy;
    const seat = page.optPilot.checked && !!page.occupancy
      && (page.occupancy.isActiveRoot() || page.mannedActive());
    // Seated: the seat's second trigger, held. On foot: the right button's
    // own press edge (`footAltPress`). Every vanilla weapon's zoom is a press
    // LATCH (`altFireOnce`), so the held flag this used to set never reached
    // it and the sights never came up on a phone; a knife's stab and the
    // demolition swap ride the same edge, and only a weapon without the
    // latch zooms for as long as the hold.
    page.setTouchAltFire(false, on && seat);
    if (foot) {
      if (on) page.footAltPress();
      else page.footAltRelease();
    }
    mobileAimBtn.classList.toggle('is-active', on || (foot && !!page.handWeapon?.zoomed));
    mobileClawAltBtn.classList.toggle('is-active', on && !foot);
  }

  /** AIM/ALT's holders, the same rule as FIRE's: down on the first finger
   *  (the row button or the claw pill), up with the last. */
  function holdAim(pointerId) {
    const first = aimHolders.size === 0;
    aimHolders.add(pointerId);
    if (first) setMobileAim(true);
  }

  function dropAim(pointerId) {
    if (!aimHolders.delete(pointerId)) return;
    if (aimHolders.size === 0) setMobileAim(false);
  }

  /** The crouch is the same `e.code` the keyboard path records (`c_PICrouch`,
   *  LeftCtrl, `c_CMPushAndHold` in the shipped Infantry.con), so the engine's
   *  per-frame held read sees one key wherever it came from. On the phone the
   *  key stays LATCHED in `page.keys` from one tap of STANCE to the next (a
   *  thumb has no reason to hold a crouch); letting it go stands the soldier
   *  back up, which BODY-1 reads off `Lb_Crouch`'s own `returnToState
   *  Lb_CrouchToStand`. */
  function holdMobileCrouch(on) {
    if (on) {
      page.setFly(true);
      touchControls.mobileCrouchHeld = true;
      page.keys.add(CROUCH_CODE);
      mobileStanceBtn.classList.add('is-active');
    } else {
      touchControls.mobileCrouchHeld = false;
      page.keys.delete(CROUCH_CODE);
      mobileStanceBtn.classList.remove('is-active');
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
    mobileClawAltBtn.classList.toggle('is-active', touchControls.mobileJumpHeld);
  }

  /** JUMP's holders (the row button and the top-right pill on foot), FIRE's
   *  rule: down on the first finger, up with the last. */
  function holdJump(pointerId) {
    const first = jumpHolders.size === 0;
    jumpHolders.add(pointerId);
    if (first) setMobileJump(true);
  }

  function dropJump(pointerId) {
    if (!jumpHolders.delete(pointerId)) return;
    if (jumpHolders.size === 0) setMobileJump(false);
  }

  /** The top-right pill: JUMP on foot, the seat's ALT seated, decided at the
   *  press; the drop tries both sets, and a set it is not in says nothing. */
  function holdTop(pointerId) {
    if (page.optOnFoot.checked && !!page.soldier && !page.soldierDead && !page.occupancy) holdJump(pointerId);
    else holdAim(pointerId);
  }

  function dropTop(pointerId) {
    dropJump(pointerId);
    dropAim(pointerId);
  }

  /** The touch twin of the keyboard's `useKey`: the seat decides, and the
   *  SEAT branch is asked FIRST — standing in a tank whose own door is in
   *  reach, a press must leave, not climb back in. */
  function mobileSeatToggle() {
    if (!page.seatToggleReady()) return;
    // Against a real server: Use on the wire, the server's answer seats him.
    if ((page.occupancy || (page.optOnFoot.checked && page.soldier)) && page.requestSeatToggle?.()) {
      page.noteSeatToggle();
      resetMobileControls();
      return;
    }
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
    panSamples++;
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

  // The vehicle ring is its own touch target, the left ring's twin: the right
  // thumb finds it at its home spot (bottom-right) and the ball tracks the
  // offset from the ring's centre. Last press wins, as on the left ring.
  mobilePadRight.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    touchControls.mobileRightPadPointerId = event.pointerId;
    touchControls.mobileRightPadHeld = true;
    trackPointer(event.pointerId, () => releaseMobileRightPad(event));
    try { mobilePadRight.setPointerCapture(event.pointerId); } catch {}
    const rect = mobilePadRight.getBoundingClientRect();
    rightPadCentreX = rect.left + rect.width / 2;
    rightPadCentreY = rect.top + rect.height / 2;
    mobilePadRight.classList.add('is-active');
    updateMobileRightPad(event);
    updateMobileControls();
  });

  mobilePadRight.addEventListener('pointermove', event => {
    if (!touchControls.mobileRightPadHeld || event.pointerId !== touchControls.mobileRightPadPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateMobileRightPad(event);
  });

  mobilePadRight.addEventListener('pointerup', releaseMobileRightPad);
  mobilePadRight.addEventListener('pointercancel', releaseMobileRightPad);

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
    holdFire(event.pointerId);
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
    const pointerId = mobileFireHeldPointerId;
    mobileFireHeldPointerId = null;
    // The thumb's hold ends; the trigger itself stays down while the claw
    // FIRE still has it.
    if (pointerId !== null) dropFire(pointerId);
    else if (fireHolders.size === 0) setMobileFire(false);
  }

  function releaseMobileFire(event) {
    try {
      if (mobileFireBtn.hasPointerCapture(event.pointerId)) mobileFireBtn.releasePointerCapture(event.pointerId);
    } catch {}
    endMobileFire();
  }

  mobileFireBtn.addEventListener('pointerup', releaseMobileFire);
  mobileFireBtn.addEventListener('pointercancel', releaseMobileFire);

  function releaseMobileJump(event) {
    dropJump(event.pointerId);
  }

  /** A HELD trigger button with a holder set behind it: down on its
   *  pointerdown edge, up when that pointer ends wherever it ends. The row's
   *  AIM and both claw pills are this. No drag look on any of them: with a
   *  claw grip the right thumb is already panning the open screen, and an
   *  index finger drifting on its pill must not steer a second time. */
  function bindHeldTrigger(button, hold, drop) {
    button.addEventListener('pointerdown', event => {
      if (button.disabled || button.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      page.setFly(true);
      page.ensureAudioContext();
      try { button.setPointerCapture(event.pointerId); } catch {}
      trackPointer(event.pointerId, () => drop(event.pointerId));
      hold(event.pointerId);
    });
    const release = event => {
      try {
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      } catch {}
      drop(event.pointerId);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  }

  bindHeldTrigger(mobileAimBtn, holdAim, dropAim);
  bindHeldTrigger(mobileJumpBtn, holdJump, dropJump);
  bindHeldTrigger(mobileClawFireBtn, holdFire, dropFire);
  bindHeldTrigger(mobileClawAltBtn, holdTop, dropTop);

  // The stance button: one button for the two stances, as COD Mobile's
  // crouch/prone control is. A TAP toggles the crouch (prone, a tap stands
  // up); a HOLD of STANCE_HOLD_MS goes prone, and a second hold stands up.
  // Both are toggles on the phone: the crouch key stays latched in
  // `page.keys` until the next tap, and prone is the Z key's own toggle
  // (`c_PILie`, `c_CMNonRepetive`). The press edge itself does nothing --
  // the tap resolves on the release, the hold on its timer -- which is what
  // lets a hold and a toggle share one target (the ninth pass's objection
  // was a crouch that engaged on the press with a prone then put on top of
  // it). Jump is deliberately not the road up from prone: the engine sets
  // the jump bit only when neither the crouch nor the prone flag is set
  // (client `0x00500628`-`0x0050067a`, `BFSoldier_jumpFlagSet`). The
  // visibility pass runs straight after either action, so the lit word
  // never lags a frame behind the stance.
  const STANCE_HOLD_MS = 350;
  let stancePointerId = null;
  let stanceTimer = 0;
  let stanceHeld = false;
  function stanceTap() {
    if (page.prone) page.toggleProne();
    else holdMobileCrouch(!touchControls.mobileCrouchHeld);
    updateMobileControls();
  }
  function stanceHold() {
    stanceHeld = true;
    if (touchControls.mobileCrouchHeld) holdMobileCrouch(false);
    page.toggleProne();
    updateMobileControls();
  }
  /** The press ends, however it ends: a `pointerup` that was not held long
   *  enough is the tap; a cancel or a pointer lost is no tap at all. Reached
   *  through the window's tracked release, which sees every end event. */
  function endStancePress(pointerId, type) {
    if (pointerId !== stancePointerId) return;
    clearTimeout(stanceTimer);
    stanceTimer = 0;
    stancePointerId = null;
    try {
      if (mobileStanceBtn.hasPointerCapture(pointerId)) mobileStanceBtn.releasePointerCapture(pointerId);
    } catch {}
    if (type === 'pointerup' && !stanceHeld) stanceTap();
  }
  mobileStanceBtn.addEventListener('pointerdown', event => {
    if (mobileStanceBtn.disabled || mobileStanceBtn.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    page.setFly(true);
    page.ensureAudioContext();
    try { mobileStanceBtn.setPointerCapture(event.pointerId); } catch {}
    stancePointerId = event.pointerId;
    stanceHeld = false;
    clearTimeout(stanceTimer);
    stanceTimer = setTimeout(stanceHold, STANCE_HOLD_MS);
    trackPointer(event.pointerId, end => endStancePress(event.pointerId, end?.type));
  });

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

  edgeButton(mobileViewBtn, () => page.cycleView({ force: true }),
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
    dropAim,
    dropFire,
    dropJump,
    edgeButton,
    endMobileFire,
    feedMobileFireLook,
    feedMobileLook,
    feedMobileTurretAim,
    flashWeaponChip,
    hideWeaponChip,
    holdAim,
    holdFire,
    holdJump,
    holdMobileCrouch,
    mobileCycleSeat,
    mobileCycleWeapon,
    mobileNextFreeSeat,
    mobilePadAxis,
    mobilePadVector,
    mobileRightPadAxis,
    mobileRightPadVector,
    mobileRudderAxis,
    mobileSeatToggle,
    releaseMobileCrouch,
    releaseMobileFire,
    releaseMobileJump,
    releaseMobilePad,
    releaseMobileRightPad,
    resetMobileControls,
    resetMobilePad,
    resetMobileRightPad,
    setMobileAim,
    setMobileFire,
    setMobileJump,
    setMobileSheet,
    syncMobileThrottle,
    updateMobileControls,
    updateMobilePad,
    updateMobileRightPad,
  });
  return touchControls;
}