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
 * `aircraft`, `altFireDemolitions`, `bfmap`, `camera`, `cameraMode`, `activeCodes`,
 * `cancelDeploy`, `car`, `clampAltitude`, `consoleCaptures`, `codeTriggers`,
 * `cycleKitWeapon`, `cycleView`, `deployActive`, `deploySpawn`,
 * `dollyCamera`, `ensureAudioContext`, `enterVehicle`,
 * `escMenuCaptures`, `escMenuKeydown`, `escMenuKeyup`, `exitSeat`, `FLY_KEYS`, `FLY_SLOW`,
 * `hintText`,
 * `fullmapBox`, `gameConsole`, `handWeapon`, `hud`, `isSlow`,
 * `isTouchDevice`, `itemsLocked`, `LOCAL_PLAYER`, `lookDelta`, `navMode`,
 * `nearEntry`, `occupancy`, `openDeploy`, `optOnFoot`, `optPilot`,
 * `panCamera`, `params`, `radioKeydown`, `renderer`, `resetCamera`,
 * `scoreboardOpen`,
 * `scoreFromSpawn`, `selectDeployFlag`, `selectKitWeapon`, `setConsoleOpen`,
 * `setEscMenu`, `setScoreboard`, `soldier`, `spawnAtFlag`, `stage`,
 * `startReload`, `switchSeat`, `toggleFullMap`, `toggleProne`, `uiFocused`,
 * `updateMobileControls`, `world`.
 */
export function createPageInput(page) {
  const pageInput = {};

  const keys = new Set();
  pageInput.captured = false;
  pageInput.lockHeld = false;
  pageInput.dragging = false;
  pageInput.lastPointerX = 0;
  pageInput.lastPointerY = 0;

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
      if (page.escMenuKeydown(e)) e.preventDefault();
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
    // Caps Lock is the spawn screen — the retail game's own arrangement, and
    // the one key the page has for it; the console never takes it (the
    // control map's Capital line is dropped in controls.js).
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
    // The control map speaks first: what this keypress is, in the game's own
    // trigger vocabulary (`c_PIMap`, `c_PIShowScoreBoard`, ...), read from
    // the merged map — game, common and all three contexts, because a key's
    // meaning rarely changes context (Tab is the scoreboard everywhere).
    // Only the `e.code` literals are gone; the engine's own gating stays,
    // branch by branch. features/viewer-profile-controls.
    const triggers = page.codeTriggers(e.code);
    // F1..F8 are the radio (`c_PIRadio1..8`, input 0x22..0x29, handled by
    // the menu's key handler 0x006D42A0): comms.js takes them, and they never
    // reach the browser (F1 help, F5 reload). The numbers come from the
    // control map too — an imported profile may move them.
    if (!page.deployActive() && page.radioKeydown?.(e)) return;
    // `c_PIMap`. On foot the map opens in its deploy state — the game's own
    // map is also its spawn screen — and Escape or the map key again puts it
    // away without moving you.
    if (triggers.includes('c_PIMap') && !e.repeat
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      mapKey();
      return;
    }
    // `c_PIShowScoreBoard`, `c_CMPushAndHold` in every shipped control map:
    // the board is up for as long as the key is down. Not over the spawn
    // screen, whose own SCORE BOARD button is the way in there.
    if (triggers.includes('c_PIShowScoreBoard')
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat && !page.deployActive() && !page.scoreboardOpen()) {
        page.setScoreboard(true, false);
      }
      return;
    }
    // `c_PIZoomMap`: it steps the minimap's three-level zoom counter
    // (bfmap.js). Behind the same gates as the map key — the console, the
    // Escape menu and a focused form control have all returned above.
    if (triggers.includes('c_PIZoomMap') && !e.repeat
        && !e.ctrlKey && !e.metaKey) {
      zoomMapKey();
      return;
    }
    // The menu-select row (`c_PIMenuSelect1..9`): seated, it switches seats
    // (SEAT-23/24, verify-r5.md); on foot it raises kit weapons —
    // `ObjectTemplate.itemIndex` is the inventory slot and the number key
    // that selects it (1 knife .. 3 primary .. 5 special), so a key with no
    // such slot in the spawned kit's inventory does nothing, exactly as in
    // the game. Only the slots the map binds answer: in the shipped maps
    // that is 1-6 and 9 — 7 and 8 are the vote keys (`c_PIVoteYes/No`).
    // Recorded in `keys` as well as acted on, and the reason is slot 9: the
    // engine gives `c_PIMenuSelect9` a second job on a falling soldier (the
    // ripcord, `parachute.js`), and the per-frame input word reads it through
    // `controls.held`, which reads `keys`. This branch used to return before
    // `keys.add` and the ripcord never reached it.
    const menu = triggers.map(t => /^c_PIMenuSelect([1-9])$/.exec(t)).find(Boolean);
    if (menu && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      keys.add(e.code);
      if (page.optPilot.checked && page.occupancy) {
        page.switchSeat(Number(menu[1]) - 1);
        return;
      }
      if (page.optOnFoot.checked && page.soldier) {
        kitDigit(Number(menu[1]));
        return;
      }
    }
    keys.add(e.code);
    if (triggers.includes('c_PIReload') && !e.repeat) reloadKey(e.shiftKey);
    // `c_PIUse` (SEAT-2, verify-r5.md — the report's own correction: there
    // is no distinctly-named "enter/exit" enum value, vehicle use shares the
    // same trigger a real Use-key bind would). In free fly E is already the
    // vertical thrust, so both branches ask for a mode first. The 1.0s
    // per-player cooldown (SEAT-6) below gates the whole branch, same as the
    // real `toggleEntryPoint`.
    if (triggers.includes('c_PIUse') && !e.repeat && !e.ctrlKey && !e.metaKey
        && !e.altKey && pageInput.seatToggleReady()) {
      useKey();
    }
    // `c_PIToggleCameraMode` is input channel 26, bound to IDKey_C in every
    // one of the game's own control maps -- Infantry's included, which is
    // why it reaches a soldier at all. In a seat the seat's own
    // `VehicleCamera` owns the cycle (every seat has one: driver, passenger,
    // gunner, bare gun). On foot `soldier-camera.js` owns it, widened past
    // the engine's set of one by the server's soldier switch
    // (server-settings.js).
    if (triggers.includes('c_PIToggleCameraMode') && !e.repeat
        && !e.ctrlKey && !e.metaKey) page.cycleView();
    // `c_PILie`, a non-repetitive trigger, so it toggles rather than holds.
    if (triggers.includes('c_PILie') && !e.repeat
        && page.optOnFoot.checked && page.soldier) page.toggleProne();
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      for (const t of triggers) if (cameraOrSpawnTrigger(t)) break;
    }
    // Every key any context binds stops being the browser's while the page
    // is captured: the control map's set, not a hand-written list. The free
    // camera's `FLY_KEYS` is the viewer's own and rides along.
    if (pageInput.captured && (page.FLY_KEYS.has(e.code)
        || page.activeCodes().has(e.code))) e.preventDefault();
  });
  addEventListener('keyup', e => {
    // Push-and-hold: the board held up on the scoreboard key goes with the
    // key, whatever else has the keyboard by then. One opened from the spawn
    // screen stays.
    if (page.codeTriggers(e.code).includes('c_PIShowScoreBoard')
        && page.scoreboardOpen() && !page.scoreFromSpawn) page.setScoreboard(false);
    // A key released under an open console must not reach `keys` either: the
    // set is only ever read for movement, and the console has the keyboard.
    // The Escape menu has it on the same terms.
    if (page.escMenuCaptures() && page.escMenuKeyup(e)) e.preventDefault();
    if (page.consoleCaptures() || page.escMenuCaptures()) return;
    keys.delete(e.code);
  });

  // The trigger bodies the keyboard branches and the joystick's dispatched
  // edges share. None of them may name a key: the binding is the control
  // map's, and these are only what the triggers *do*.
  function mapKey() {
    if (page.deployActive()) page.cancelDeploy();
    else if (page.fullmapBox.hidden && page.optOnFoot.checked && page.soldier
             && !page.optPilot.checked) {
      // On foot, but not merely suspended in a seat: a driver's map key is
      // the plain map, because his soldier is still ticked and still alive.
      page.openDeploy();
    } else page.toggleFullMap();
  }
  function zoomMapKey() { page.bfmap.zoomIn(); }
  function kitDigit(slot) { page.selectKitWeapon(slot); }
  function reloadKey(shift) {
    // The seat is checked before the soldier: a driver who walked in on foot
    // still has his rifle slung, and reload must reset the vehicle he is
    // actually holding the wheel of, not work the bolt.
    if (page.optPilot.checked && (page.aircraft || page.car)) {
      (page.aircraft || page.car).reset();
      page.world?.resetStick(page.LOCAL_PLAYER);
    } else if (page.optOnFoot.checked && page.soldier) {
      // Reload once there is a magazine to reload — the game's own binding —
      // and it stays the respawn only for a soldier holding nothing (a
      // weapon glb that failed to load). Shift is the deliberate road back:
      // it reopens the deploy screen rather than guessing a flag.
      if (shift) {
        if (!page.deployActive()) page.openDeploy();
      } else if (page.handWeapon?.data?.magazine) page.startReload();
      else page.spawnAtFlag(true);
    } else if (!page.optPilot.checked) {
      page.resetCamera();
    }
  }
  function useKey() {
    // `exitSeat` picks the exit: the hull's own for a driver or a passenger
    // of a drivetrain, the seat's for a gunner or a seat of a hull with no
    // drive (`mannedActive()` is the check that is right either way).
    if (page.optPilot.checked && page.occupancy) {
      page.exitSeat();
      pageInput.noteSeatToggle();
    } else if (page.optOnFoot.checked && page.soldier && pageInput.captured
               && page.nearEntry) {
      page.enterVehicle(page.nearEntry);
      pageInput.noteSeatToggle();
    }
  }

  /** The joystick's triggers, dispatched by `controls.pollGamepad`'s edge
   *  detection onto the same bodies the keyboard branches run. Only triggers
   *  the control map actually binds arrive (the poller looks each button up
   *  in the active overlay); the F9-F12 direct camera modes
   *  (`c_PICameraMode1..4`) have no viewer implementation yet, so their
   *  buttons do nothing — as those keys do on the keyboard today. */
  /** F9-F12 (`c_PICameraMode1..4`: INSIDE, CHASE REAR, CHASE FRONT, FLY BY)
   *  straight to that view, and SHOW SPAWNINTERFACE (`c_GIInGameMenu`, Enter
   *  in every shipped map) up — the Caps Lock branch's job, from the binding
   *  the profile gives it. Key and pad both come through here. True when the
   *  trigger was one of these. */
  function cameraOrSpawnTrigger(trigger) {
    const camera = /^c_PICameraMode([1-4])$/.exec(trigger);
    if (camera) { page.cameraMode(Number(camera[1])); return true; }
    if (trigger === 'c_GIInGameMenu') {
      if (!page.deployActive() && !page.optPilot.checked) page.openDeploy();
      return true;
    }
    return false;
  }

  pageInput.padTriggerDown = trigger => {
    if (cameraOrSpawnTrigger(trigger)) return;
    if (trigger === 'c_PIMap') mapKey();
    else if (trigger === 'c_PIZoomMap') zoomMapKey();
    else if (trigger === 'c_PIUse' && pageInput.seatToggleReady()) useKey();
    else if (trigger === 'c_PIToggleCameraMode') page.cycleView();
    else if (trigger === 'c_PILie') {
      if (page.optOnFoot.checked && page.soldier) page.toggleProne();
    } else if (trigger === 'c_PIReload') reloadKey(false);
    else if (trigger === 'c_PIShowScoreBoard') {
      if (!page.deployActive() && !page.scoreboardOpen()) page.setScoreboard(true, false);
    } else {
      // The menu row as the keyboard has it: seated it switches seats, on
      // foot it raises a kit slot.
      const menu = /^c_PIMenuSelect([1-9])$/.exec(trigger);
      if (menu && page.optPilot.checked && page.occupancy) page.switchSeat(Number(menu[1]) - 1);
      else if (menu && page.optOnFoot.checked && page.soldier) kitDigit(Number(menu[1]));
    }
  };
  pageInput.padTriggerUp = trigger => {
    // Push-and-hold: the board held up on the pad button goes with it, the
    // way the keyboard's keyup does.
    if (trigger === 'c_PIShowScoreBoard' && page.scoreboardOpen()
        && !page.scoreFromSpawn) page.setScoreboard(false);
  };

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

  // The keys are the profile's (`controls.hintText`); under `?kblock` the
  // Escape hint grows for as long as the fullscreen session lasts.
  const HUD_FOOT_TEMPLATE = '{move} move · {c_PIWalk} walk · {c_PICrouch} crouch · '
    + '{c_PILie} prone · {c_PIAction} jump · {c_PIFire} fire · {c_PIAltFire} aim · '
    + '{c_PIReload} reload · {c_PIToggleCameraMode} view · {c_PIMenuSelect9} chute · '
    + 'CapsLock / {c_PIMap} redeploy · Esc menu';
  Object.defineProperty(pageInput, 'HUD_FOOT', {
    get: () => page.hintText(HUD_FOOT_TEMPLATE, 'infantry')
      + (pageInput.kbSession ? ' · hold Esc exits full screen' : ''),
    enumerable: true,
  });

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
    page.updateMobileControls();
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
  // On-foot play holds Ctrl with -- walking, strafing, a crouched reload
  // (Ctrl+R reloads the page), E, Z, the map keys, jump -- and Escape, so its
  // short press stays the page's. The list is derived from the control map at
  // lock time, not hardcoded: the shipped player bindings carry W A S D R E Z
  // M Space Shift Ctrl, the zoom map's Alt, the chute's 9 and the rest, and
  // an imported profile moves all of them, so the lock has to follow. Keys
  // the game does not bind stay the browser's: a deliberate Ctrl+T still
  // opens a tab.
  const kblockKeys = () => ['Escape', ...page.kblockKeys()];
  pageInput.kbSession = false;        // inside the fullscreen this page asked for
  pageInput.kbLockState = 'idle';     // what lock() last said; the ?shots hook reads it

  function kbLockEnter() {
    if (!KBLOCK || !(page.optOnFoot.checked && page.soldier)) return;
    if (document.fullscreenElement !== page.stage) page.stage.requestFullscreen().catch(() => {});
    // Asked again on every capture: the session's own `fullscreenchange`
    // handler unlocks when the fullscreen ends, however it ends.
    navigator.keyboard.lock(kblockKeys()).then(
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
      const was = pageInput.HUD_FOOT;
      pageInput.kbSession = inside;
      if (!inside) {
        navigator.keyboard.unlock();
        pageInput.kbLockState = 'unlocked';
      }
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
        if (page.navMode === 'fly') {
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
        if (page.navMode === 'fly') {
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

          page.panCamera(dMidX, dMidY);

          const dDist = geom.dist - pageInput.touchPinchDist;
          pageInput.touchPinchDist = geom.dist;
          if (Math.abs(dDist) > 1) {
            page.dollyCamera(dDist * 0.7);
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
        page.panCamera(dx, dy);
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
      page.panCamera(dx, dy);
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
    page.camera.position.y -= e.deltaY * scale * 0.12 * (page.isSlow() ? page.FLY_SLOW : 1);
    page.clampAltitude();
  }, { passive: false });


  Object.assign(pageInput, {
    KBLOCK,
    capture,
    kbLockLeave,
    keys,
    release,
    setFly,
    setSideCollapsed,
  });
  // `KBLOCK_KEYS` keeps its name for the `?kblock` hooks, but it is now the
  // control map's player bindings read live — an import moves it.
  Object.defineProperty(pageInput, 'KBLOCK_KEYS', {
    get: () => kblockKeys(),
    enumerable: true,
  });
  return pageInput;
}
