// Drives `viewer/mouse-look-key.js` -- the pilot's mouse-look key -- and the
// page's use of it, outside a browser, and prints one JSON blob.
//
// `tests/test_mouse_look_key.py` copies the viewer modules in under their own
// names (and the vendored three.js as a package), so the files under test are
// the files the page loads, byte for byte:
//
//   * the law itself (`recentreFactor`, `recentreLook`, `routeFlightInput`,
//     `seatNeedsMouseLookKey`);
//   * the binding, through the real `controls.js` over the shipped maps and
//     the owner's own profile (the fixtures the driver copies in);
//   * the page path, through the real `createLocalLook` and `VehicleCamera`
//     on a stub page: the gate in `lookDelta`, the recentre in
//     `stepMouseLookKey`, for a pilot, a gunner, a driver, a ship and a
//     touch screen, inside the cockpit and outside it.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MOUSE_LOOK_TRIGGER, MOUSE_LOOK_CHANNEL, HELD_THRESHOLD, RECENTRE_PER_TICK,
  TICK_HZ, LOOK_REST, seatNeedsMouseLookKey, recentreFactor, recentreLook,
  routeFlightInput,
} from './viewer/mouse-look-key.js';
import { createControls } from './viewer/controls.js';
import { createLocalLook } from './viewer/local-look.js';
import { VehicleCamera } from './viewer/vehicle-camera.js';

const results = {};
const round = (n, places = 9) => Math.round(n * 10 ** places) / 10 ** places;

// --- the numbers ------------------------------------------------------------

results.constants = {
  trigger: MOUSE_LOOK_TRIGGER,
  channel: MOUSE_LOOK_CHANNEL,
  heldThreshold: HELD_THRESHOLD,
  perTick: RECENTRE_PER_TICK,
  tickHz: TICK_HZ,
  rest: LOOK_REST,
};

// --- the recentre law ---------------------------------------------------------

{
  const r = {};
  r.oneTick = recentreFactor(1 / 30);
  r.eightTicks = recentreFactor(8 / 30);
  r.sixteenTicks = recentreFactor(16 / 30);
  r.oneSecond = recentreFactor(1);
  r.zero = recentreFactor(0);
  r.negative = recentreFactor(-0.1);
  r.nan = recentreFactor(NaN);
  // Half the angle gone: ln 0.5 / (30 ln 0.75).
  r.halfLife = Math.log(0.5) / (TICK_HZ * Math.log(RECENTRE_PER_TICK));

  // One second of release at several frame rates and through a vile slicing:
  // the angle left must be the engine's 0.75^30 whatever the display did.
  const decayOver = frames => {
    const look = { yaw: 1, pitch: -0.5 };
    for (const dt of frames) recentreLook(look, dt);
    return look;
  };
  const even = (fps, seconds) => Array.from({ length: Math.round(fps * seconds) }, () => 1 / fps);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const vile = [];
  let left = 1;
  while (left > 1e-12) {
    const dt = Math.min(left, 0.001 + rand() * 0.08);
    vile.push(dt);
    left -= dt;
  }
  r.perFps = {};
  for (const fps of [30, 60, 144]) r.perFps[fps] = decayOver(even(fps, 1));
  r.vile = decayOver(vile);
  r.vileFrames = vile.length;
  // At 60 fps every second frame is a tick boundary, and there the drawn
  // angle is exactly the engine's tick value.
  r.tickBoundaries = [];
  const look = { yaw: 1, pitch: 0 };
  for (let frame = 1; frame <= 12; frame += 1) {
    recentreLook(look, 1 / 60);
    if (frame % 2 === 0) r.tickBoundaries.push({ ticks: frame / 2, yaw: look.yaw });
  }
  // Put exactly at rest once below a micro-radian, never overshooting.
  const rest = { yaw: 1.2, pitch: -0.7 };
  let seconds = 0;
  while ((rest.yaw !== 0 || rest.pitch !== 0) && seconds < 10) {
    recentreLook(rest, 1 / 60);
    seconds += 1 / 60;
  }
  r.restAfter = round(seconds, 4);
  r.restLook = rest;
  r.nullLook = recentreLook(null, 1 / 30);
  results.recentre = r;
}

// --- which seats need the key -------------------------------------------------

results.seats = {
  pilot: seatNeedsMouseLookKey({ rootKind: 'air', root: true }),
  gunnerOfAnAircraft: seatNeedsMouseLookKey({ rootKind: 'air', root: false }),
  shipsHelm: seatNeedsMouseLookKey({ rootKind: 'ship', root: true }),
  tankDriver: seatNeedsMouseLookKey({ rootKind: 'tank', root: true }),
  carDriver: seatNeedsMouseLookKey({ rootKind: 'ground', root: true }),
  bareGun: seatNeedsMouseLookKey({ rootKind: 'gun', root: true }),
  rootUnknown: seatNeedsMouseLookKey({ rootKind: 'air' }),
  none: seatNeedsMouseLookKey(null),
};

// --- the router's held branch ---------------------------------------------------

{
  const word = () => ({ forward: 1, forwardKeys: 1, strafe: 0.5, rudder: -1, roll: 0.7,
    pitch: -0.4, fire: true, altFire: true, pad: false });
  results.route = {
    held: routeFlightInput(word(), true),
    released: routeFlightInput(word(), false),
    heldOnThePad: routeFlightInput({ ...word(), pad: true }, true),
    nullWord: routeFlightInput(null, true),
  };
}

// --- the binding, through the real control map --------------------------------

function makeControlsPage(state = {}) {
  return {
    captured: true,
    keys: new Set(),
    optOnFoot: { checked: false },
    optPilot: { checked: true },
    occupancy: { rootKind: 'air', isActiveRoot: () => true },
    soldier: {},
    padTriggerDown: null,
    padTriggerUp: null,
    ...state,
  };
}

function setPad(pad) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => (pad ? [pad] : []) },
    configurable: true,
  });
}

{
  const b = {};
  const shift = new Set(['ShiftLeft']);
  const shipped = createControls(makeControlsPage());
  b.shipped = {
    air: shipped.probe('air', shift).held(MOUSE_LOOK_TRIGGER),
    land: shipped.probe('land', shift).held(MOUSE_LOOK_TRIGGER),
    infantry: shipped.probe('infantry', shift).held(MOUSE_LOOK_TRIGGER),
    // The same key on foot is the walk (Infantry.con:8), on the game map
    // `c_GILeftShift` (Common.con:35); in a plane it is only the look.
    infantryWalk: shipped.probe('infantry', shift).held('c_PIWalk'),
    airWalk: shipped.probe('air', shift).held('c_PIWalk'),
    triggersOnTheKey: shipped.codeTriggers('ShiftLeft').sort(),
    airRightShift: shipped.probe('air', new Set(['ShiftRight'])).held(MOUSE_LOOK_TRIGGER),
    hint: shipped.hintText('{c_PIMouseLook}+mouse look around', 'air'),
  };

  // In game: the context comes off the seat, the keys off the page.
  const page = makeControlsPage({ keys: new Set(['ShiftLeft']) });
  const inGame = createControls(page);
  b.inGame = { pilotHolding: inGame.held(MOUSE_LOOK_TRIGGER), pilotContext: inGame.context() };
  page.keys.clear();
  b.inGame.pilotReleased = inGame.held(MOUSE_LOOK_TRIGGER);
  page.keys.add('ShiftLeft');
  page.occupancy = { rootKind: 'air', isActiveRoot: () => false };
  b.inGame.gunnerContext = inGame.context();
  b.inGame.gunnerHolding = inGame.held(MOUSE_LOOK_TRIGGER);
  page.occupancy = { rootKind: 'air', isActiveRoot: () => true };
  page.captured = false;
  b.inGame.uncaptured = inGame.held(MOUSE_LOOK_TRIGGER);

  // The owner's own profile keeps the shipped line (Air.con:20).
  const owner = createControls(makeControlsPage());
  await owner.importFiles(['Common.con', 'Infantry.con', 'Air.con', 'Land.con'].map(name => ({
    name, text: readFileSync(new URL(`./fixtures/controls-profile-skandia/${name}`, import.meta.url), 'utf8'),
  })));
  b.owner = {
    air: owner.probe('air', shift).held(MOUSE_LOOK_TRIGGER),
    hint: owner.hintText('{c_PIMouseLook}+mouse look around', 'air'),
  };

  // Rebound to a joystick button, it is held from the stick.
  const padPage = makeControlsPage();
  const rebound = createControls(padPage);
  await rebound.importFiles([{
    name: 'Air.con',
    text: 'ControlMap.create AirPlayerInputControlMap\n'
      + 'ControlMap.addButtonToTriggerMapping c_PIMouseLook IDFGameController_0 IDButton_4 c_CMPushAndHold\n',
  }]);
  setPad({ connected: true, buttons: [0, 1, 2, 3, 4].map(i => ({ pressed: i === 4 })), axes: [0, 0, 0, 0] });
  rebound.pollGamepad();
  b.joystick = { button5: rebound.held(MOUSE_LOOK_TRIGGER) };
  padPage.keys.add('ShiftLeft');
  setPad({ connected: true, buttons: [0, 1, 2, 3, 4].map(() => ({ pressed: false })), axes: [0, 0, 0, 0] });
  rebound.pollGamepad();
  b.joystick.shiftAfterRebind = rebound.held(MOUSE_LOOK_TRIGGER);
  setPad(null);
  results.binding = b;
}

// --- the page path: `createLocalLook` + the real `VehicleCamera` ---------------

/** A hull the camera can frame: at the origin, nose down -Z, level. */
function makeSubject() {
  return {
    state: {
      position: new THREE.Vector3(0, 100, 0),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(0, 0, -60),
      throttle: 1,
    },
    firstPerson: true,
    setFirstPerson(on) { this.firstPerson = !!on; return this.firstPerson; },
    cameraPose(out) {
      out.position.set(0, 101.2, 0);
      out.quaternion.identity();
      return out;
    },
  };
}

/**
 * The page as `createLocalLook` reads it. `seat` is what the occupancy says
 * about the seat taken; `held` the control map's answer for the key.
 */
function makeLookPage({ rootKind = 'air', root = true, turret = null, aircraft = true,
  car = false, manned = false, held = false, touch = false } = {}) {
  const view = new VehicleCamera(makeSubject(), { modes: ['cockpit', 'chase', 'front', 'flyby'] });
  const state = { held, touch };
  const page = {
    optPilot: { checked: true },
    optOnFoot: { checked: false },
    occupancy: { rootKind, isActiveRoot: () => root, turret },
    aircraft: aircraft ? {} : null,
    car: car ? {} : null,
    mannedActive: () => manned,
    view,
    held: trigger => trigger === MOUSE_LOOK_TRIGGER && state.held,
    get touchFlying() { return state.touch; },
    soldier: null,
    LOOK_SENS: 0.0022,
    turnLook: () => {},
  };
  return { page, view, state };
}

const deg = r => round(r * 180 / Math.PI, 6);
const lookOf = view => ({ yaw: deg(view.look.yaw), pitch: deg(view.look.pitch) });

/** The angle between the camera's forward and the eye's forward, degrees. */
function offForward(view) {
  const pose = view.update(1 / 60);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
  return deg(fwd.angleTo(new THREE.Vector3(0, 0, -1)));
}

{
  const p = {};

  // The pilot, in the cockpit.
  {
    const { page, view, state } = makeLookPage();
    const look = createLocalLook(page);
    p.pilotGate = { needsKey: look.lookNeedsKey(), held: look.lookKeyHeld() };
    look.lookDelta(300, 0);
    p.pilotKnock = { look: lookOf(view), offForward: offForward(view) };
    state.held = true;
    p.pilotGate.heldWithKey = look.lookKeyHeld();
    look.lookDelta(300, 0);
    p.pilotHolding = { look: lookOf(view), offForward: offForward(view) };
    // Still held: the look stays where the hand put it.
    for (let i = 0; i < 30; i += 1) look.stepMouseLookKey(1 / 60);
    p.pilotHeldHalfSecond = lookOf(view);
    // Released: 0.75 a tick.
    state.held = false;
    const start = view.look.yaw;
    look.stepMouseLookKey(1 / 30);
    p.pilotReleasedOneTick = { ratio: round(view.look.yaw / start), look: lookOf(view) };
    look.stepMouseLookKey(7 / 30);
    p.pilotReleasedEightTicks = { ratio: round(view.look.yaw / start), look: lookOf(view) };
    for (let i = 0; i < 120; i += 1) look.stepMouseLookKey(1 / 60);
    p.pilotReleasedLater = { look: lookOf(view), offForward: offForward(view) };
    // The released key blocks the next knock as well.
    look.lookDelta(-500, 200);
    p.pilotSecondKnock = lookOf(view);
  }

  // The pilot outside: the orbit obeys the same key and swings back behind.
  {
    const { page, view, state } = makeLookPage();
    const look = createLocalLook(page);
    view.setMode('chase');
    look.lookDelta(400, 0);
    p.chaseKnock = lookOf(view);
    state.held = true;
    look.lookDelta(400, 0);
    p.chaseHolding = lookOf(view);
    state.held = false;
    for (let i = 0; i < 60; i += 1) look.stepMouseLookKey(1 / 60);
    p.chaseReleasedOneSecond = lookOf(view);
    p.chaseMode = view.mode;
  }

  // A touch screen: the finger on the view is the key.
  {
    const { page, view, state } = makeLookPage();
    const look = createLocalLook(page);
    state.touch = true;
    look.lookDelta(200, 0);
    for (let i = 0; i < 10; i += 1) look.stepMouseLookKey(1 / 60);
    p.touchDragging = lookOf(view);
    state.touch = false;
    for (let i = 0; i < 2; i += 1) look.stepMouseLookKey(1 / 60);
    p.touchLifted = { ratio: round(view.look.yaw / (-200 * 0.0022)), look: lookOf(view) };
  }

  // A gunner of the same aircraft (the B17's turrets): the mouse aims his gun
  // through the look stage exactly as before, key or no key.
  {
    const aimed = { counts: 0 };
    const { page, view } = makeLookPage({ root: false, turret: { aim() {} }, manned: true });
    const look = createLocalLook(page);
    const before = look.mouseInput.pendingPixels ? { ...look.mouseInput.pendingPixels } : null;
    look.lookDelta(300, -40);
    const after = look.mouseInput.pendingPixels ? { ...look.mouseInput.pendingPixels } : null;
    aimed.counts = after && before ? after.x - before.x : null;
    look.stepMouseLookKey(1);
    p.gunner = {
      needsKey: look.lookNeedsKey(),
      pendingX: after?.x ?? null, pendingY: after?.y ?? null,
      viewLook: lookOf(view),
    };
  }

  // A tank's driver (the Sherman: a seat with a turret) and a jeep's driver
  // (no turret, the view's head/orbit): no key, and no recentre.
  {
    const { page } = makeLookPage({ rootKind: 'tank', turret: { aim() {} }, aircraft: false, car: true });
    const look = createLocalLook(page);
    look.lookDelta(300, 0);
    p.tankDriver = { needsKey: look.lookNeedsKey(), pendingX: look.mouseInput.pendingPixels?.x ?? null };
  }
  {
    const { page, view } = makeLookPage({ rootKind: 'ground', aircraft: false, car: true });
    const look = createLocalLook(page);
    look.lookDelta(300, 0);
    const turned = lookOf(view);
    for (let i = 0; i < 60; i += 1) look.stepMouseLookKey(1 / 60);
    p.jeepDriver = { needsKey: look.lookNeedsKey(), turned, oneSecondLater: lookOf(view) };
  }

  // A ship's helm rides the aircraft's drive class (`page.aircraft`) but is
  // not an aircraft: free to look, as before.
  {
    const { page, view } = makeLookPage({ rootKind: 'ship' });
    const look = createLocalLook(page);
    look.lookDelta(300, 0);
    const turned = lookOf(view);
    for (let i = 0; i < 60; i += 1) look.stepMouseLookKey(1 / 60);
    p.shipHelm = { needsKey: look.lookNeedsKey(), turned, oneSecondLater: lookOf(view) };
  }

  results.page = p;
}

process.stdout.write(JSON.stringify(results));
