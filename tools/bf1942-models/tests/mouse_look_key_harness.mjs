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
//     touch screen, inside the cockpit and outside it;
//   * the stick: the same counts, key up, through the look stage's Air
//     profile and the shipped Air map's mouse lines onto `c_PIRoll` /
//     `c_PIPitch`, against the keys by the engine's slot rule, and the owner's
//     joystick profile, which binds no mouse to the stick.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MOUSE_LOOK_TRIGGER, MOUSE_LOOK_CHANNEL, HELD_THRESHOLD, RECENTRE_PER_TICK,
  TICK_HZ, LOOK_REST, seatNeedsMouseLookKey, recentreFactor, recentreLook,
  routeFlightInput, routeLookPair, describeSeat, seatProfile, seatLookPitchSign,
} from './viewer/mouse-look-key.js';
import { surveyVehicle } from './viewer/seat-survey.js';
import { RATE_FACTOR, axisScale, quantiseAxis } from './viewer/mouse-input.js';
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
    lookReleased: routeLookPair({ x: 2.5, y: -1.2 }, false),
    lookHeld: routeLookPair({ x: 2.5, y: -1.2 }, true),
    lookNull: routeLookPair(null, false),
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

// --- the stick: the mouse flies the aircraft while the key is up ---------------
//
// The whole chain the page runs, real modules end to end: `lookDelta` puts the
// counts in the look stage, `pumpLook` converts them on the Air profile once a
// frame, and the Air map's mouse lines carry the pumped pair onto the stick
// (`controls.axis(trigger, mouse)`), the keys folded in by the engine's slot
// rule. One frame owing one tick, so the counts are a rate over 1/30 s.

{
  const s = {};
  const TICK = 1 / 30;
  const keys = new Set();
  const controls = createControls(makeControlsPage({ keys }));
  const { page, view, state } = makeLookPage();
  page.held = trigger => controls.held(trigger);
  const look = createLocalLook(page);
  const mouse = () => ({ x: look.mouseInput.x, y: look.mouseInput.y });
  const frame = (dx, dy) => { look.lookDelta(dx, dy); look.pumpLook(1); return mouse(); };
  // What the engine computes for a hand of `px` counts in one tick at sensitivity `sens`.
  const expected = (px, sens = 0.75) => quantiseAxis(RATE_FACTOR * (px / TICK) * axisScale(sens));
  s.expected = { right30: expected(30), back30: expected(-30), right30quarter: expected(30, 0.25),
                 back30Uninverted: expected(30) };

  // The frame the seat is taken activates the Air map (the stage resets on
  // the profile change, as the engine resets the map it leaves).
  look.pumpLook(1);
  // 30 px right and 30 px toward the player in one tick: 900 counts a second.
  look.lookDelta(30, 30);
  s.knockView = lookOf(view);
  s.knockPending = { ...look.mouseInput.pendingPixels };
  look.pumpLook(1);
  s.profile = look.mouseInput.profile;
  s.scale = look.mouseInput.scaleFor('air');
  const m = mouse();
  s.mouse = m;
  s.roll = controls.axis('c_PIRoll', m);
  s.pitch = controls.axis('c_PIPitch', m);
  s.yaw = controls.axis('c_PIYaw', m);
  s.rollWithoutTheMouse = controls.axis('c_PIRoll');

  // The keys against the mouse on one channel: the larger magnitude, the
  // primary slot (the mouse line) on a tie.
  keys.add('ArrowUp');
  s.slots = {
    keyAlone: controls.axis('c_PIPitch', { x: 0, y: 0 }),
    keyAgainstAFastHand: controls.axis('c_PIPitch', m),
    keyAgainstASlowHand: controls.axis('c_PIPitch', { x: 0, y: -0.3 }),
    keyAgainstAnEqualHand: controls.axis('c_PIPitch', { x: 0, y: -1 }),
  };
  keys.delete('ArrowUp');

  // The same hand with the INVERT MOUSE box off, and at a quarter sensitivity.
  look.mouseInput.setInvert('air', 0);
  s.pitchUninverted = controls.axis('c_PIPitch', frame(0, 30));
  look.mouseInput.setInvert('air', 1);
  look.mouseInput.setSensitivity('air', 0.25);
  s.rollAtAQuarter = controls.axis('c_PIRoll', frame(30, 0));
  look.mouseInput.setSensitivity('air', 0.75);

  // A still mouse is a centred stick on the next pumped frame.
  s.rollStill = controls.axis('c_PIRoll', frame(0, 0));

  // Left Shift held: the counts turn the head (the vertical inverted with the
  // device's Y) and never reach the stage, so the stick is let go.
  keys.add('ShiftLeft');
  s.heldNeedsKey = look.lookKeyHeld();
  look.lookDelta(30, 30);
  s.heldPending = { ...look.mouseInput.pendingPixels };
  s.heldLook = lookOf(view);
  s.heldStick = controls.axis('c_PIRoll', frame(0, 0));
  keys.delete('ShiftLeft');
  for (let i = 0; i < 120; i += 1) look.stepMouseLookKey(1 / 60);
  // The box off: the held look's vertical is the old sense.
  look.mouseInput.setInvert('air', 0);
  keys.add('ShiftLeft');
  const before = view.look.pitch;
  look.lookDelta(0, 30);
  s.heldPitchUninverted = deg(view.look.pitch - before);
  keys.delete('ShiftLeft');
  look.mouseInput.setInvert('air', 1);
  for (let i = 0; i < 120; i += 1) look.stepMouseLookKey(1 / 60);
  // A finger on the view is not the mouse: no invert.
  state.touch = true;
  const touchBefore = view.look.pitch;
  look.lookDelta(0, 30);
  s.touchPitch = deg(view.look.pitch - touchBefore);
  state.touch = false;
  for (let i = 0; i < 120; i += 1) look.stepMouseLookKey(1 / 60);

  // The touch look zone in a pilot's seat: the seat is not touchFlying, the
  // key is up, and `touch-controls.js` hands its drag over as a finger.
  {
    look.pumpLook(1);
    const before = lookOf(view);
    look.lookDelta(30, 30, { touch: true });
    const pending = { ...look.mouseInput.pendingPixels };
    const after = lookOf(view);
    s.touchZone = {
      pending,
      look: { yaw: after.yaw - before.yaw, pitch: after.pitch - before.pitch },
      roll: controls.axis('c_PIRoll', frame(0, 0)),
    };
  }

  // The owner's profile flies on the joystick: its Air map binds no mouse
  // axis to the stick, so the mouse flies nothing.
  const owner = createControls(makeControlsPage({ keys }));
  await owner.importFiles(['Common.con', 'Infantry.con', 'Air.con', 'Land.con'].map(name => ({
    name, text: readFileSync(new URL(`./fixtures/controls-profile-skandia/${name}`, import.meta.url), 'utf8'),
  })));
  s.owner = { roll: owner.axis('c_PIRoll', { x: 3, y: -3 }), pitch: owner.axis('c_PIPitch', { x: 3, y: -3 }) };

  // A gunner's seat is on the LandSea map, which binds the mouse to the look
  // alone: handing it the pair moves no stick channel.
  const gunner = createControls(makeControlsPage({ keys,
    occupancy: { rootKind: 'air', isActiveRoot: () => false } }));
  s.gunner = { context: gunner.context(), roll: gunner.axis('c_PIRoll', { x: 3, y: -3 }),
               pitch: gunner.axis('c_PIPitch', { x: 3, y: -3 }) };
  results.stick = s;
}

// --- the seats that are not the pilot's (ledger MLK-14) ------------------------
//
// The seat trees below are the extracted Desert Combat glbs' own extras, cut to
// the nodes `surveyVehicle` reads (`viewer/models/mods/desertcombat/MH-6.glb`,
// `MH-53.glb`): every seat is its own PCO node with `physics.vehicleCategory`,
// and its Camera carries `cameraView` (and, where the Camera had children of
// its own, a `rig`). `word` adds what a glb baked with `toggleMouseLook` and
// the camera's look rig carries (`cameraView.toggleMouseLook`,
// `cameraView.look`), as the con-reader package exports them.

function node(name, extras = {}, children = []) {
  const n = new THREE.Object3D();
  n.name = name;
  n.userData = extras;
  for (const child of children) n.add(child);
  return n;
}
const pco = (name, category, children) => node(name,
  { templateKind: 'PlayerControlObject', control: name, physics: { vehicleCategory: category } }, children);
const camera = (name, control, view = {}, rig = null) => node(name,
  { templateKind: 'Camera', control, cameraView: { control, ...view }, ...(rig ? { rig } : {}) });
const entry = control => node(`${control}Entry`, { templateKind: 'EntryPoint', control, seat: { control } });
const lookRig = (control, direction) => ({
  axes: {
    yaw: { input: 'c_PIMouseLookX', min: -70, max: 70, free: false, maxSpeed: 90, direction: 1 },
    pitch: { input: 'c_PIMouseLookY', min: -60, max: 45, free: false, maxSpeed: 90, direction },
  },
  automaticReset: false, control,
});

/** DC 0.7's MH-6: pilot, co-pilot (`H6CoPilotCamera`, no word, its own rig)
 *  and a bench passenger (`MH6PassengerCamera`, the word in DC's data). */
function mh6({ word = false } = {}) {
  const passengerView = word
    ? { toggleMouseLook: true, look: lookRig('MH6Passenger_PCO3', -1) } : {};
  const coPilotView = word ? { toggleMouseLook: false, look: lookRig('H6CoPilot', -1) } : {};
  const pilotView = word ? { toggleMouseLook: true, look: lookRig('MH-6', -1) } : {};
  return pco('MH-6', 'VCAir', [
    camera('H6PilotCamera', 'MH-6', pilotView),
    entry('MH-6'),
    pco('H6CoPilot', 'VCAir', [
      entry('H6CoPilot'),
      camera('H6CoPilotCamera', 'H6CoPilot', coPilotView, lookRig('H6CoPilot', -1)),
    ]),
    pco('MH6Passenger_PCO3', 'VCAir', [
      entry('MH6Passenger_PCO3'),
      camera('MH6PassengerCamera', 'MH6Passenger_PCO3', passengerView),
    ]),
  ]);
}

/** DC 0.7's MH-53: the co-pilot sits behind the pilot's own Camera template;
 *  the door gunner is a VCLand PCO with a turret on the mouse. */
function mh53() {
  return pco('MH-53', 'VCAir', [
    camera('MH53PilotCamera', 'MH-53'),
    entry('MH-53'),
    pco('MH53CoPilot', 'VCAir', [entry('MH53CoPilot'), camera('MH53PilotCamera', 'MH53CoPilot')]),
    pco('MH53_50Cal', 'VCLand', [
      entry('MH53_50Cal'),
      node('MH53_50Cal_Base', {
        templateKind: 'RotationalBundle', control: 'MH53_50Cal',
        rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: -60, max: 60, free: false, maxSpeed: 60, direction: 1 } } },
      }, [camera('MH-53_Gunner_Camera', 'MH53_50Cal')]),
    ]),
  ]);
}

/** DC Final's MH-6 bench: no word, and a +100000 pitch acceleration. */
function mh6Final() {
  return pco('MH-6', 'VCAir', [
    camera('H6PilotCamera', 'MH-6', { toggleMouseLook: true, look: lookRig('MH-6', -1) }),
    entry('MH-6'),
    pco('MH6Passenger_PCO3', 'VCAir', [
      entry('MH6Passenger_PCO3'),
      camera('MH6PassengerCamera', 'MH6Passenger_PCO3',
             { toggleMouseLook: false, look: lookRig('MH6Passenger_PCO3', 1) }),
    ]),
  ]);
}

/** What the page's occupancy (`SeatHandle`) answers, over the real survey. */
function seatOf(root, seatId, rootKind = 'air') {
  const survey = surveyVehicle(root);
  return {
    rootKind,
    rootId: survey.rootId,
    activeSeatId: seatId,
    isActiveRoot: () => seatId === survey.rootId,
    seatInfo: id => survey.seats.get(id),
    turret: null,
  };
}

const seatRules = occupancy => {
  const seat = describeSeat(occupancy);
  const profile = seatProfile(seat);
  return { profile, needsKey: seatNeedsMouseLookKey(seat), pitchSign: seatLookPitchSign(seat, profile),
           category: seat.vehicleCategory ?? null };
};

{
  const n = {};
  n.oldTree = {
    pilot: seatRules(seatOf(mh6(), 'MH-6')),
    coPilot: seatRules(seatOf(mh6(), 'H6CoPilot')),
    passenger: seatRules(seatOf(mh6(), 'MH6Passenger_PCO3')),
    mh53CoPilot: seatRules(seatOf(mh53(), 'MH53CoPilot')),
    mh53Gunner: seatRules(seatOf(mh53(), 'MH53_50Cal')),
  };
  n.wordTree = {
    pilot: seatRules(seatOf(mh6({ word: true }), 'MH-6')),
    coPilot: seatRules(seatOf(mh6({ word: true }), 'H6CoPilot')),
    passenger: seatRules(seatOf(mh6({ word: true }), 'MH6Passenger_PCO3')),
    finalPassenger: seatRules(seatOf(mh6Final(), 'MH6Passenger_PCO3')),
  };
  // The same descriptor object for the same seat: the page asks per event.
  const cached = seatOf(mh6(), 'H6CoPilot');
  n.cached = describeSeat(cached) === describeSeat(cached);

  // The control map follows the seat: Left Shift is the look key on the
  // co-pilot's and the passenger's Air map, and nothing on the gunner's.
  const shift = new Set(['ShiftLeft']);
  const contextOf = occupancy => {
    const page = makeControlsPage({ keys: shift, occupancy });
    const controls = createControls(page);
    return { context: controls.context(), shiftIsLook: controls.held(MOUSE_LOOK_TRIGGER) };
  };
  n.maps = {
    coPilot: contextOf(seatOf(mh6(), 'H6CoPilot')),
    passenger: contextOf(seatOf(mh6(), 'MH6Passenger_PCO3')),
    mh53Gunner: contextOf(seatOf(mh53(), 'MH53_50Cal')),
  };

  // The page path: `createLocalLook` over the real survey, the real control
  // map for the key, and the seat's own view (`buildSeatView` gives every
  // seat one, a driverless hull included -- `aircraft` is null here).
  const lookAt = (root, seatId, { word } = {}) => {
    const keys = new Set();
    const occupancy = seatOf(root, seatId);
    const controls = createControls(makeControlsPage({ keys, occupancy }));
    const { page, view } = makeLookPage({ aircraft: false });
    page.occupancy = occupancy;
    page.held = trigger => controls.held(trigger);
    const look = createLocalLook(page);
    look.pumpLook(1);
    const out = { profile: look.lookProfile(), needsKey: look.lookNeedsKey() };
    look.lookDelta(200, 20);
    out.knock = lookOf(view);
    out.knockPending = { ...look.mouseInput.pendingPixels };
    keys.add('ShiftLeft');
    look.lookDelta(200, 20);
    out.held = lookOf(view);
    keys.delete('ShiftLeft');
    look.stepMouseLookKey(1 / 30);
    out.releasedOneTick = lookOf(view);
    look.mouseInput.setInvert('air', 0);
    for (let i = 0; i < 120; i += 1) look.stepMouseLookKey(1 / 60);
    keys.add('ShiftLeft');
    const before = view.look.pitch;
    look.lookDelta(0, 20);
    out.heldPitchBoxOff = deg(view.look.pitch - before);
    return out;
  };
  n.page = {
    passengerWithTheWord: lookAt(mh6({ word: true }), 'MH6Passenger_PCO3'),
    coPilot: lookAt(mh6(), 'H6CoPilot'),
    finalPassenger: lookAt(mh6Final(), 'MH6Passenger_PCO3'),
  };
  results.otherSeats = n;
}

process.stdout.write(JSON.stringify(results));
