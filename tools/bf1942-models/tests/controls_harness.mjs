// `viewer/controls.js` under node: the control-map module's parse, query and
// joystick dispatch, against the shipped defaults (the generated
// `controls-defaults.js`) and the owner's real profile (the fixtures the
// Python driver copies in). One sentence these tests defend:
//
//     every `event.code` literal the page used to hardcode is now a binding
//     of the game's own control map, and a joystick's axes and buttons land
//     on the same engine triggers the profile binds them to.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCon, classifyCon, keyIdToCode, describeBinding, createControls,
} from '../viewer/controls.js';
import { GameConsole } from '../viewer/console.js';
import { CONTROLS_DEFAULTS } from '../viewer/controls-defaults.js';

// The page stub: what createControls reads, live.
function makePage(state = {}) {
  return {
    captured: false,
    keys: new Set(),
    optOnFoot: { checked: false },
    optPilot: { checked: false },
    occupancy: null,
    soldier: {},
    padTriggerDown: null,
    padTriggerUp: null,
    ...state,
  };
}

// Node's own `navigator` is getter-only; the stub goes through defineProperty.
function setPad(pad) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => (pad ? [pad] : []) },
    configurable: true,
  });
}

const results = { parse: {}, defaults: {}, profile: {}, gamepad: {}, describe: {} };

// --- parse ------------------------------------------------------------------

results.parse.keyIdToCode = {
  grave: keyIdToCode('IDKey_Grave'),
  capital: keyIdToCode('IDKey_Capital'),
  w: keyIdToCode('IDKey_W'),
  digit9: keyIdToCode('IDKey_9'),
  arrowUp: keyIdToCode('IDKey_ArrowUp'),
  numpad6: keyIdToCode('IDKey_Numpad6'),
  f12: keyIdToCode('IDKey_F12'),
  leftAlt: keyIdToCode('IDKey_LeftAlt'),
  unknown: keyIdToCode('IDKey_Nonsense'),
};

const sample = [
  'rem *** Generated ***',
  'ControlMap.create AirPlayerInputControlMap',
  'ControlMap.addKeysToAxisMapping c_PIThrottle IDFKeyboard IDKey_W IDKey_S',
  'ControlMap.addAxisToAxisMapping c_PIPitch IDFGameController_0 IDAxis_1 1',
  'ControlMap.addAxisToAxisMapping c_PIYaw IDFGameController_0 IDAxis_2 0 1',
  'ControlMap.addButtonToTriggerMapping c_PIFire IDFGameController_0 IDButton_0 c_CMPushAndHold',
  'ControlMap.addKeyToTriggerMapping c_PIMap IDFKeyboard IDKey_F c_CMNonRepetive',
  'ControlMap.addAxisToTriggerMapping c_PINextItem c_PIPrevItem IDFMouse IDAxis_2',
  'game.setAirMouseSensitivity 1.000000',
  'run User.con',
].join('\n');

const parsed = parseCon(sample);
results.parse.sample = {
  bindings: parsed.bindings.length,
  vars: parsed.vars,
  maps: parsed.maps,
  pitchInvert: parsed.bindings.find(b => b.trigger === 'c_PIPitch')?.invert,
  yawInvert: parsed.bindings.find(b => b.trigger === 'c_PIYaw')?.invert,
  mapCode: parsed.bindings.find(b => b.trigger === 'c_PIMap')?.code,
  fireButton: parsed.bindings.find(b => b.trigger === 'c_PIFire')?.button,
};

results.parse.classify = {
  air: classifyCon(sample),
  common: classifyCon('ControlMap.create defaultGameControlMap\nControlMap.addKeyToTriggerMapping c_GIToggleConsole IDFKeyboard IDKey_Grave c_CMNonRepetive'),
  land: classifyCon('ControlMap.create LandSeaPlayerInputControlMap\n'),
  infantry: classifyCon('ControlMap.create defaultPlayerInputControlMap\nControlMap.addKeyToTriggerMapping c_PICrouch IDFKeyboard IDKey_LeftCtrl c_CMPushAndHold'),
};

results.parse.describe = describeBinding(
  { kind: 'trigger', device: 'controller', trigger: 'c_PIUse', button: 11 });
results.parse.describeKeyboard = describeBinding(
  { kind: 'trigger', device: 'keyboard', trigger: 'c_PIZoomMap', code: 'AltLeft' });

// --- defaults (the shipped maps) --------------------------------------------

// A build without an imported profile must answer exactly what the page used
// to hardcode.
{
  const page = makePage({ optOnFoot: { checked: true } });
  const controls = createControls(page);
  const d = results.defaults;
  d.mapKey = controls.codeTriggers('KeyM');
  d.zoomKey = controls.codeTriggers('KeyN');
  d.tab = controls.codeTriggers('Tab');
  d.use = controls.codeTriggers('KeyE');
  d.camera = controls.codeTriggers('KeyC');
  d.lie = controls.codeTriggers('KeyZ');
  d.reload = controls.codeTriggers('KeyR');
  d.slot9 = controls.codeTriggers('Digit9');
  d.vote7 = controls.codeTriggers('Digit7');
  d.radio1 = controls.radioNumberOf('F1');
  d.radio8 = controls.radioNumberOf('F8');
  d.radioM = controls.radioNumberOf('KeyM');
  // Grave opens the console; the shipped maps' Caps Lock line is dropped —
  // Caps Lock is the spawn screen, in the retail game and in the viewer.
  d.consoleToggle = [...(GameConsole.toggleCodes ?? [])];

  // axes on foot, keyboard only
  page.captured = true;
  page.keys.add('KeyW');
  d.throttleW = controls.axis('c_PIThrottle');
  page.keys.add('KeyS');
  d.throttleWS = controls.axis('c_PIThrottle');
  page.keys.delete('KeyW'); page.keys.delete('KeyS');
  page.keys.add('KeyD');
  d.yawD = controls.axis('c_PIYaw');
  page.keys.delete('KeyD');

  // not captured: the device stage owes the world nothing
  page.captured = false;
  page.keys.add('KeyW');
  d.throttleUncaptured = controls.axis('c_PIThrottle');
  page.captured = true;
  page.keys.delete('KeyW');

  // held
  page.keys.add('ShiftLeft');
  d.walk = controls.held('c_PIWalk');
  page.keys.delete('ShiftLeft');
  page.keys.add('Space');
  d.jump = controls.held('c_PIAction');
  page.keys.delete('Space');

  // air context: the arrow pairs ride the aircraft's stick channels
  page.optOnFoot.checked = false;
  page.optPilot.checked = true;
  page.occupancy = { rootKind: 'air' };
  page.keys.add('ArrowUp');
  d.pitchArrow = controls.axis('c_PIPitch');
  page.keys.delete('ArrowUp');
  page.keys.add('ArrowLeft');
  d.rollArrow = controls.axis('c_PIRoll');
  page.keys.delete('ArrowLeft');

  // context selection
  d.contextOnFoot = (() => {
    page.optPilot.checked = false; page.occupancy = null;
    page.optOnFoot.checked = true;
    return controls.context();
  })();
  d.contextAir = (() => {
    page.optOnFoot.checked = false;
    page.optPilot.checked = true; page.occupancy = { rootKind: 'air' };
    return controls.context();
  })();
  d.contextLand = (() => {
    page.occupancy = { rootKind: 'ship' };
    return controls.context();
  })();
  d.contextFree = (() => {
    page.optPilot.checked = false; page.occupancy = null;
    return controls.context();
  })();

  d.kblock = controls.kblockKeys().sort();
  // `Enter` lives only in the game map (`c_GIInGameMenu`, `c_GIEnter`); K
  // is a *player* trigger (`c_PISayAll`), so it belongs in the lock list.
  d.kblockHasNoGameKeys = !controls.kblockKeys().includes('Enter');
  d.activeCodesHasCaps = controls.activeCodes().has('CapsLock');

  // the defaults' own variables
  d.vars = controls.describe().vars;
}

// --- profile import (the owner's own Controls/*.con) -------------------------

{
  const page = makePage();
  const controls = createControls(page);
  const p = results.profile;
  p.import = await controls.importFiles(
    ['Common.con', 'Infantry.con', 'Air.con', 'Land.con'].map(name => ({
      name, text: readFileSync(new URL(`./fixtures/controls-profile-skandia/${name}`, import.meta.url), 'utf8'),
    })));
  p.source = controls.describe().source;

  // the owner's map key is F, zoom is Left Alt — M and N are nothing now
  p.mapKey = controls.codeTriggers('KeyF');
  p.mapKeyM = controls.codeTriggers('KeyM');
  p.zoomKey = controls.codeTriggers('AltLeft');
  p.zoomKeyN = controls.codeTriggers('KeyN');

  // joystick buttons, infantry overlay
  page.optOnFoot.checked = true;
  p.buttonUse = controls.buttonTriggers(11);
  p.buttonMap = controls.buttonTriggers(12);
  p.buttonScoreboard = controls.buttonTriggers(15);
  p.buttonChute = controls.buttonTriggers(10);
  p.buttonUnbound = controls.buttonTriggers(7);

  // joystick buttons, air overlay
  page.optOnFoot.checked = false;
  page.optPilot.checked = true;
  page.occupancy = { rootKind: 'air' };
  p.airButtonFire = controls.buttonTriggers(0);
  p.airButtonAltFire = controls.buttonTriggers(2);

  // joystick axes, air overlay (the profile's Air.con: roll 0, pitch 1
  // inverted, yaw 2, throttle 3)
  page.captured = true;
  setPad({ connected: true, buttons: [], axes: [0.5, -0.8, 0.3, 0.9] });
  controls.pollGamepad();
  p.axisRoll = controls.axis('c_PIRoll');
  p.axisPitch = controls.axis('c_PIPitch');
  p.axisYaw = controls.axis('c_PIYaw');
  p.axisThrottle = controls.axis('c_PIThrottle');

  // a pad button feeds `held` without any DOM event
  setPad({ connected: true, buttons: [{ pressed: true }, { pressed: false },
    { pressed: true }], axes: [0, 0, 0, 0] });
  controls.pollGamepad();
  p.heldFire = controls.held('c_PIFire');
  p.heldAltFire = controls.held('c_PIAltFire');

  // edges dispatch through the page's handlers
  const down = [];
  const up = [];
  page.padTriggerDown = t => down.push(t);
  page.padTriggerUp = t => up.push(t);
  setPad({ connected: true, buttons: [{ pressed: true }, { pressed: false },
    { pressed: true }, { pressed: true }, { pressed: false },
    { pressed: false }, { pressed: false }, { pressed: false },
    { pressed: false }, { pressed: false }, { pressed: true },
    { pressed: true }, { pressed: true }], axes: [0, 0, 0, 0] });
  controls.pollGamepad();     // 3,10,11,12 rise (0 and 2 are still held)
  p.edgesDown = down.sort();
  setPad({ connected: true, buttons: [{ pressed: false }, { pressed: false },
    { pressed: false }, { pressed: true }], axes: [0, 0, 0, 0] });
  controls.pollGamepad();     // 0,2 fall; 3 stays
  p.edgesUp = up.sort();

  // the profile's own sensitivity variables survive the parse
  p.vars = controls.describe().vars;

  // and a reset is a real reset
  controls.resetDefaults();
  p.afterResetMap = controls.codeTriggers('KeyM');
  p.afterResetSource = controls.describe().source;
}

// --- describe, for the sidebar ----------------------------------------------

{
  const controls = createControls(makePage({ optOnFoot: { checked: true } }));
  const d = controls.describe();
  results.describe.rows = d.rows.length;
  results.describe.mapRow = d.rows.find(r => r.trigger === 'c_PIMap');
  results.describe.useRow = d.rows.find(r => r.trigger === 'c_PIUse');
}

console.log(JSON.stringify(results, null, 1));
