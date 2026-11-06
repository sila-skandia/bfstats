// Rebinding in OPTIONS > CONTROLS under node: the boxes as retail's DEFINE
// KEY fills them (`viewer/controls-edit.js`), the four `.con` files SAVE
// writes from them, and those files read back by the same parser the game
// page plays on. The sentence these defend:
//
//     a box the player defines is written the way retail writes it, and the
//     page then plays on what was written -- nothing else in the files moves.
// watches: tools/bf1942-models/tests/fixtures/controls-profile-skandia/*
// (the folder it reads; scripts/select_model_tests.py)

import { readFileSync } from 'node:fs';
import { createControls, codeToKeyId, keyIdToCode, parseCon } from '../viewer/controls.js';
import {
  conflictText, createDraft, findConflicts, readBoxes, serializeFiles,
} from '../viewer/controls-edit.js';
import { CONTROLS_DEFAULTS } from '../viewer/controls-defaults.js';

const store = new Map();
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k),
};

const FIXTURES = new URL('./fixtures/controls-profile-skandia/', import.meta.url);
const owner = Object.fromEntries(['common', 'infantry', 'air', 'land'].map(c => [c,
  readFileSync(new URL(`${c[0].toUpperCase()}${c.slice(1)}.con`, FIXTURES), 'utf8')]));
const shipped = CONTROLS_DEFAULTS.files;
const out = {};

const lines = (text, re) => text.split('\n').filter(l => re.test(l));
const boxesOf = files => Object.fromEntries([...readBoxes(files)].map(([k, v]) => [k, v]));
const key = code => ({ type: 'key', code });

// --- nothing edited, nothing moves ------------------------------------------

{
  const fromOwner = serializeFiles(owner, readBoxes(owner));
  const fromShipped = serializeFiles(shipped, readBoxes(shipped));
  out.untouched = {
    // The owner's files were written by retail's own SAVE: rewritten from
    // their boxes they come back byte for byte.
    owner: Object.fromEntries(Object.keys(owner).map(c => [c, fromOwner[c] === owner[c].replace(/\r/g, '')])),
    // The shipped files gain what retail's SAVE adds to them: the map-vote
    // rows in every context file's common block, the screenshot's game-map
    // twin. Their boxes are unchanged.
    shippedBoxes: JSON.stringify(boxesOf(fromShipped)) === JSON.stringify(boxesOf(shipped)),
    shippedAdded: Object.fromEntries(Object.keys(shipped).map(c => {
      const before = new Set(shipped[c].split('\n'));
      return [c, fromShipped[c].split('\n').filter(l => !before.has(l))];
    })),
    shippedRemoved: Object.fromEntries(Object.keys(shipped).map(c => {
      const after = new Set(fromShipped[c].split('\n'));
      return [c, shipped[c].split('\n').filter(l => !after.has(l))];
    })),
    conflicts: { owner: findConflicts(readBoxes(owner)).size, shipped: findConflicts(readBoxes(shipped)).size },
  };
}

// --- a key defined, written, played on ---------------------------------------

{
  const controls = createControls({ keys: new Set() });
  const changes = [];
  controls.onChange(e => changes.push(e.reason));
  const draft = controls.editor();
  draft.set('infantry', 'A:c_PIThrottle:+', 0, key('KeyI'));
  draft.set('infantry', 'T:c_PIReload', 1, { type: 'mouse', button: 2 });
  const files = draft.files();
  controls.commitFiles(files);
  const probe = controls.probe('infantry', new Set(['KeyI']), new Set());
  const probeW = controls.probe('infantry', new Set(['KeyW']), new Set());
  const reload = controls.probe('infantry', new Set(), new Set([2]));
  const saved = JSON.parse(store.get('viewer.controls.profile') || 'null');
  out.capture = {
    throttle: lines(files.infantry, /c_PIThrottle/),
    reload: lines(files.infantry, /c_PIReload/),
    forwardOnI: probe.axis('c_PIThrottle'),
    forwardOnW: probeW.axis('c_PIThrottle'),
    reloadOnMiddle: reload.held('c_PIReload'),
    labels: controls.rowLabels({ axis: 'c_PIThrottle', sign: 1 }, 'infantry'),
    reloadLabels: controls.rowLabels({ trigger: 'c_PIReload' }, 'infantry'),
    changes,
    source: controls.profileOrigin().source,
    stored: saved?.files?.infantry === files.infantry,
    // Untouched lines stay where they were.
    kept: ['rem *** For free camera ***', 'ControlMap.addKeyToTriggerMapping c_PIRun IDFKeyboard IDKey_LeftCtrl c_CMPushAndHold',
      'game.setInfMouseSensitivity 0.250000', 'ControlMap.addAxisToAxisMapping c_PIMouseLookX IDFMouse IDAxis_0 0']
      .every(l => files.infantry.includes(l)),
    otherFiles: ['common', 'air', 'land'].every(c => files[c] === serializeFiles(shipped, readBoxes(shipped))[c]),
  };
}

// --- setKey's rules ----------------------------------------------------------

{
  const d = createDraft(shipped);
  // An alternate defined while the primary is empty lands in the primary.
  d.clear('common', 'T:c_PIZoomMap', 0);
  const landed = d.set('common', 'T:c_PIZoomMap', 1, key('KeyB'));
  // An alternate equal to the primary is cleared.
  d.set('common', 'T:c_PIUse', 1, key('KeyE'));
  const use = d.cells('common', 'T:c_PIUse');
  // A primary set to what the alternate holds clears the alternate.
  d.set('air', 'T:c_PIFire', 0, key('Space'));
  const fire = d.cells('air', 'T:c_PIFire');
  out.rules = {
    landed, zoom: d.cells('common', 'T:c_PIZoomMap'),
    use, fire,
  };
}

// --- Escape unbinds ----------------------------------------------------------

{
  const d = createDraft(shipped);
  d.clear('infantry', 'T:c_PIAction', 0);
  d.clear('infantry', 'A:c_PIYaw:-', 0);
  const files = d.files();
  const back = readBoxes(files);
  const controls = createControls({ keys: new Set() });
  controls.commitFiles(files);
  out.unbind = {
    jumpLines: lines(files.infantry, /c_PIAction/),
    jump: back.get('infantry|T:c_PIAction'),
    // One half of a key pair unbound: the line keeps the other half.
    yawLines: lines(files.infantry, /c_PIYaw/),
    yaw: [back.get('infantry|A:c_PIYaw:+'), back.get('infantry|A:c_PIYaw:-')],
    rightOnD: controls.probe('infantry', new Set(['KeyD'])).axis('c_PIYaw'),
    leftOnA: controls.probe('infantry', new Set(['KeyA'])).axis('c_PIYaw'),
    run: lines(files.infantry, /c_PIRun/),
  };
}

// --- an axis fills both halves ------------------------------------------------

{
  const d = createDraft(shipped);
  // Stick axis 2 pushed back on SPEED UP: speed up is the pull, so the line
  // carries the invert flag; SLOW DOWN reads the push.
  d.set('air', 'A:c_PIThrottle:+', 1, { type: 'padAxis', axis: 1, dir: -1 });
  const filled = [d.cells('air', 'A:c_PIThrottle:+'), d.cells('air', 'A:c_PIThrottle:-')];
  const axisFiles = d.files();
  // A key on one half replaces the axis in both.
  d.set('air', 'A:c_PIThrottle:-', 1, key('KeyX'));
  const replaced = [d.cells('air', 'A:c_PIThrottle:+'), d.cells('air', 'A:c_PIThrottle:-')];
  // Escape on an axis half unbinds the other half too.
  d.set('air', 'A:c_PIRoll:+', 1, { type: 'padAxis', axis: 0, dir: 1 });
  d.clear('air', 'A:c_PIRoll:-', 1);
  const rollCleared = [d.cells('air', 'A:c_PIRoll:+'), d.cells('air', 'A:c_PIRoll:-')];
  // The mouse wheel on a movement row is the wheel axis.
  d.set('land', 'A:c_PIPitch:+', 1, { type: 'mouseAxis', axis: 2, dir: 1 });
  const wheelFiles = d.files();
  out.axes = {
    filled,
    line: lines(axisFiles.air, /c_PIThrottle/),
    replaced,
    replacedLine: lines(d.files().air, /c_PIThrottle/),
    rollCleared,
    wheelLine: lines(wheelFiles.land, /c_PIPitch/),
    wheelBack: readBoxes(wheelFiles).get('land|A:c_PIPitch:+'),
    // An axis in its own pair is one binding; on two channels, a conflict.
    selfConflict: findConflicts(readBoxes(axisFiles)).size,
  };
  const twice = createDraft(shipped);
  twice.set('air', 'A:c_PIPitch:+', 1, { type: 'padAxis', axis: 3, dir: 1 });
  twice.set('air', 'A:c_PIRoll:+', 1, { type: 'padAxis', axis: 3, dir: 1 });
  out.axes.twoChannels = [...twice.conflicts().keys()].sort();
}

// --- the mixed verbs ----------------------------------------------------------

{
  const d = createDraft(shipped);
  d.set('land', 'A:c_PIThrottle:+', 0, { type: 'pad', button: 3 });     // button forward, S back
  d.set('land', 'A:c_PIYaw:-', 0, { type: 'pad', button: 5 });          // D right, button left
  d.set('land', 'A:c_PIPitch:+', 0, { type: 'pad', button: 6 });
  d.set('land', 'A:c_PIPitch:-', 0, { type: 'pad', button: 7 });        // two buttons
  const files = d.files();
  const controls = createControls({ keys: new Set() });
  controls.commitFiles(files);
  const text = [
    'ControlMap.create LandSeaPlayerInputControlMap',
    'ControlMap.addButtonAndKeyToAxisMapping c_PIThrottle IDFGameController_0 IDButton_3 IDFKeyboard IDKey_S',
    'ControlMap.addKeyAndButtonToAxisMapping c_PIYaw IDFKeyboard IDKey_D IDFGameController_0 IDButton_5',
    'ControlMap.addButtonsToAxisMapping c_PIPitch IDFMouse IDButton_3 IDButton_4 1',
  ].join('\n');
  out.mixed = {
    written: [
      ...lines(files.land, /c_PIThrottle/), ...lines(files.land, /c_PIYaw/), ...lines(files.land, /c_PIPitch/),
    ],
    parsed: parseCon(text).bindings.map(b => ({ trigger: b.trigger, device: b.device, parts: b.parts, secondary: b.secondary })),
    labels: {
      speedUp: controls.rowLabels({ axis: 'c_PIThrottle', sign: 1 }, 'land'),
      slowDown: controls.rowLabels({ axis: 'c_PIThrottle', sign: -1 }, 'land'),
      left: controls.rowLabels({ axis: 'c_PIYaw', sign: -1 }, 'land'),
      right: controls.rowLabels({ axis: 'c_PIYaw', sign: 1 }, 'land'),
    },
    // The key half of a mixed pair drives the channel in game.
    backOnS: controls.probe('land', new Set(['KeyS'])).axis('c_PIThrottle'),
    rightOnD: controls.probe('land', new Set(['KeyD'])).axis('c_PIYaw'),
  };
}

// --- conflicts, per map --------------------------------------------------------

{
  const d = createDraft(shipped);
  d.set('infantry', 'T:c_PIReload', 0, key('KeyE'));          // USE is E in Common
  const inInfantry = [...d.conflicts()].map(([k, maps]) => [k, [...maps]]);
  const text = conflictText(d.conflicts().get('common|T:c_PIUse|0'), 'common');
  d.set('air', 'T:c_PIMouseLook', 0, key('KeyE'));
  const both = conflictText(d.conflicts().get('common|T:c_PIUse|0'), 'common');
  const onTab = conflictText(d.conflicts().get('air|T:c_PIMouseLook|0'), 'air');
  const ok = createDraft(shipped);
  // INFANTRY's walk and AIR's mouse look on one key: two maps, no conflict.
  ok.set('infantry', 'T:c_PIWalk', 0, key('KeyQ'));
  ok.set('air', 'T:c_PIMouseLook', 0, key('KeyQ'));
  // W on both halves of FORWARD/BACKWARD is a conflict in its own channel.
  const keys = createDraft(shipped);
  keys.set('infantry', 'A:c_PIThrottle:-', 0, key('KeyW'));
  out.conflicts = {
    inInfantry, text, both, onTab,
    acrossMaps: ok.conflicts().size,
    sameKeyBothHalves: [...keys.conflicts().keys()].sort(),
  };
}

// --- COMMON rows go into every file, and the game map's twins -------------------

{
  const d = createDraft(owner);
  d.set('common', 'T:c_PIMap', 0, key('KeyQ'));
  d.set('common', 'T:c_PIShowScoreBoard', 1, { type: 'pad', button: 9 });
  d.set('common', 'T:c_GIInGameMenu', 0, key('KeyJ'));
  const files = d.files();
  out.common = {
    map: Object.fromEntries(Object.keys(files).map(c => [c, lines(files[c], /c_PIMap\b/)])),
    scoreboard: lines(files.common, /ShowScoreBoard/),
    spawn: Object.fromEntries(Object.keys(files).map(c => [c, lines(files[c], /c_GIInGameMenu/)])),
    contextScoreboard: lines(files.infantry, /ShowScoreBoard/),
  };
}

// --- the wheel pair -------------------------------------------------------------

{
  const d = createDraft(shipped);
  d.set('infantry', 'T:c_PINextItem', 0, { type: 'wheel', dir: -1 });
  d.set('infantry', 'T:c_PIPrevItem', 0, { type: 'wheel', dir: 1 });
  const files = d.files();
  const controls = createControls({ keys: new Set() });
  controls.commitFiles(files);
  out.wheel = {
    line: lines(files.infantry, /AxisToTriggerMapping/),
    up: controls.wheelTriggers(true, 'infantry'),
    labels: [controls.rowLabels({ trigger: 'c_PINextItem' }, 'infantry'),
             controls.rowLabels({ trigger: 'c_PIPrevItem' }, 'infantry')],
  };
  // One direction alone is not written (retail writes the pair or nothing).
  const lone = createDraft(shipped);
  lone.clear('infantry', 'T:c_PIPrevItem', 0);
  out.wheel.lone = lines(lone.files().infantry, /AxisToTriggerMapping/);
}

// --- keyboard layouts ------------------------------------------------------------

{
  const controls = createControls({ keys: new Set() });
  const d = controls.editor();
  d.set('infantry', 'T:c_PILie', 0, key('IntlBackslash'));
  d.set('infantry', 'T:c_PIDrop', 0, key('KeyZ'));
  const files = d.files();
  controls.commitFiles(files);
  const us = [controls.rowLabels({ trigger: 'c_PILie' }, 'infantry'), controls.rowLabels({ trigger: 'c_PIDrop' }, 'infantry')];
  controls.setKeyNames(new Map([['IntlBackslash', '<'], ['KeyZ', 'y'], ['KeyR', 'r']]));
  out.layout = {
    lines: [...lines(files.infantry, /c_PILie/), ...lines(files.infantry, /c_PIDrop/)],
    us,
    german: [controls.rowLabels({ trigger: 'c_PILie' }, 'infantry'), controls.rowLabels({ trigger: 'c_PIDrop' }, 'infantry')],
    oem: [keyIdToCode('IDKey_OEM_102'), codeToKeyId('IntlBackslash')],
    equals: [keyIdToCode('IDKey_Equals'), codeToKeyId('Equal'), keyIdToCode('IDKey_f11'), keyIdToCode('IDKey_Unknown')],
    lessOnIntl: controls.probe('infantry', new Set(['IntlBackslash'])).held('c_PILie'),
  };
}

// --- slots as the engine fills them ---------------------------------------------

{
  // A lone alternate line (no primary yet) is refused (MLK-15); a later
  // primary line replaces the earlier one.
  const text = [
    'ControlMap.create defaultPlayerInputControlMap',
    'ControlMap.addKeyToTriggerMapping c_PIReload IDFKeyboard IDKey_T c_CMNonRepetive 1',
    'ControlMap.addKeyToTriggerMapping c_PIReload IDFKeyboard IDKey_R c_CMNonRepetive',
    'ControlMap.addKeyToTriggerMapping c_PIReload IDFKeyboard IDKey_Y c_CMNonRepetive',
  ].join('\n');
  out.slots = readBoxes({ ...shipped, infantry: text }).get('infantry|T:c_PIReload');
}

// --- DEFAULT -----------------------------------------------------------------------

{
  const d = createDraft(owner);
  d.set('infantry', 'T:c_PIReload', 0, key('KeyQ'));
  d.reset();
  const files = d.files();
  out.reset = {
    dirty: d.dirty,
    boxes: JSON.stringify(boxesOf(files)) === JSON.stringify(boxesOf(shipped)),
    sensitivity: lines(files.common, /setCommonMouseSensitivity/),
    map: lines(files.common, /c_PIMap\b/),
  };
}

process.stdout.write(JSON.stringify(out));
