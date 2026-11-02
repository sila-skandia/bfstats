// OPTIONS > CONTROLS under node: the row table (`viewer/controls-rows.js`)
// against the extracted retail pages (`controls-layout.json`), and the
// control-map queries the screen and its preview make (`rowEntries`,
// `probe`, `hintText`, the profile-folder import). The sentence these defend:
//
//     every row the game's CONTROLS screen draws says what the player's
//     profile binds it to, in the game's own words, and lights when that
//     binding is pressed.
// watches: tools/bf1942-models/tests/fixtures/controls-profile-skandia/*
// (the folders it scans; scripts/select_model_tests.py)

import { readFileSync, readdirSync } from 'node:fs';
import { createControls } from '../viewer/controls.js';
import { CONTROL_ROWS, TAB_CONTEXT } from '../viewer/controls-rows.js';
import { MouseInput } from '../viewer/mouse-input.js';
import {
  hasVideoPage, performancePanel, placeVideoRows, sliderKnob, sliderPick, VIDEO_ROWS, videoLines, videoNavButtons,
  videoPanel,
} from '../viewer/video-options.js';
import {
  chooseHardware3d, hardwareRow, hasSoundPage, soundNavButtons, soundPanel,
  storeHardware3d, storedHardware3d,
} from '../viewer/sound-options.js';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const LAYOUT = new URL('../viewer/maps/_shared/hud/menu/controls-layout.json', import.meta.url);
const FIXTURES = new URL('./fixtures/controls-profile-skandia/', import.meta.url);

const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
const out = {};

// --- the table covers the pages, and only the pages -------------------------

const layoutKeys = [];
for (const tab of Object.values(layout.tabs)) {
  for (const page of tab.pages) for (const row of page.rows) layoutKeys.push(row.key);
}
out.rows = layoutKeys.length;
out.unmapped = layoutKeys.filter(k => !CONTROL_ROWS[k]);
out.unused = Object.keys(CONTROL_ROWS).filter(k => !layoutKeys.includes(k));
out.tabs = Object.fromEntries(Object.entries(layout.tabs)
  .map(([name, tab]) => [name, { id: tab.id, pages: tab.pages.length }]));

/** Every page's rows as `TEXT: primary | alternate`. */
function screen(controls) {
  const pages = {};
  for (const [name, tab] of Object.entries(layout.tabs)) {
    tab.pages.forEach((page, i) => {
      pages[`${name}.${i + 1}`] = Object.fromEntries(page.rows.map(row => [
        row.text, controls.rowLabels(CONTROL_ROWS[row.key], TAB_CONTEXT[name]).slice(0, 2),
      ]));
    });
  }
  return pages;
}

function setPad(pad) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => (pad ? [pad] : []) },
    configurable: true,
  });
}

const page = { keys: new Set(), captured: false };
const controls = createControls(page);
out.defaults = screen(controls);
out.defaultHints = {
  foot: controls.hintText('{move} move · {c_PICrouch} crouch · {c_PIMap} map', 'infantry'),
  pilot: controls.hintText('{c_PIPitch-}/{c_PIPitch+} pitch · {c_PIFire} guns · {c_PIReload} reset', 'air'),
  fly: controls.hintText('{c_PIMap} map', null),
};

// --- what is pressed lights --------------------------------------------------

const entry = (key, context, label) => controls.rowEntries(CONTROL_ROWS[key], context)
  .find(e => e.label === label);
out.lit = {
  forwardOnW: entry('CONTROLS_INFANTRY_FORWARD', 'infantry', 'W').active(new Set(['KeyW']), new Set(), 0),
  forwardOnS: entry('CONTROLS_INFANTRY_FORWARD', 'infantry', 'W').active(new Set(['KeyS']), new Set(), 0),
  // DirectInput's IDButton_1 is the right button: the screen maps the
  // browser's button 2 onto it before asking.
  altFireOnRight: entry('CONTROLS_INFANTRY_ALT_FIRE', 'infantry', 'MOUSE 2')
    .active(new Set(), new Set([1]), 0),
  nextOnWheelUp: entry('CONTROLS_INFANTRY_NEXT_WEAPON', 'infantry', 'MOUSE WHEEL UP')
    .active(new Set(), new Set(), 1),
  prevOnWheelUp: entry('CONTROLS_INFANTRY_PREV_WEAPON', 'infantry', 'MOUSE WHEEL DOWN')
    .active(new Set(), new Set(), 1),
};
const probe = controls.probe('air', new Set(['ArrowDown', 'KeyA']), new Set([0]));
out.probe = {
  pitch: probe.axis('c_PIPitch'),
  yaw: probe.axis('c_PIYaw'),
  fire: probe.held('c_PIFire'),
  capturedAxis: controls.axis('c_PIPitch'),   // the in-game query stays off uncaptured
};

// --- the owner's profile folder ---------------------------------------------

const files = readdirSync(FIXTURES).map(name => ({
  name, text: readFileSync(new URL(name, FIXTURES), 'utf8'),
}));
files.push({ name: 'GeneralOptions.con',
             text: 'rem *** Generated ***\ngame.setPlayerName "skandia"\ngame.setToolTip 0\n' });
files.push({ name: 'Video.con', text: 'renderer.setViewDistanceScale 1.0\n' });
out.import = await controls.importFiles(files);
out.profileName = controls.describe().profileName;
out.profile = screen(controls);
out.profileHints = {
  fly: controls.hintText('{c_PIMap} map', null),
  zoom: controls.hintText('{c_PIZoomMap} zoom', null),
};

// A joystick pulled left on the roll axis lights ROLL LEFT's stick box.
setPad({ connected: true, buttons: [{ pressed: true }], axes: [-0.9, 0, 0, 0] });
controls.pollGamepad();
out.stick = {
  rollLeft: entry('CONTROLS_AIR_ROLL_LEFT', 'air', 'JOYSTICK AXIS 1-').active(new Set(), new Set(), 0),
  rollRight: entry('CONTROLS_AIR_ROLL_RIGHT', 'air', 'JOYSTICK AXIS 1+').active(new Set(), new Set(), 0),
  fire: entry('CONTROLS_AIR_FIRE', 'air', 'JOYSTICK 1').active(new Set(), new Set(), 0),
};

// In the game: a soldier who climbed into the pilot's seat keeps his on-foot
// flag, and must still fly on the Air map, stick and joystick fire included.
{
  const seated = { keys: new Set(), captured: true, soldier: {},
                   optOnFoot: { checked: true }, optPilot: { checked: true },
                   occupancy: { rootKind: 'air', isActiveRoot: () => true } };
  const pilot = createControls(seated);
  const gunner = createControls({ ...seated,
    occupancy: { rootKind: 'air', isActiveRoot: () => false } });
  const walker = createControls({ ...seated, optPilot: { checked: false }, occupancy: null });
  await pilot.importFiles(files);
  pilot.pollGamepad();
  out.seated = {
    pilot: pilot.context(), gunner: gunner.context(), walker: walker.context(),
    roll: pilot.axis('c_PIRoll'), fire: pilot.held('c_PIFire'),
  };
}

// The POV hat, which the game numbers as four buttons after the physical
// ones: an Extreme 3D Pro on Linux reports 12 buttons and six axes, the last
// two its hat (-1/0/1, y -1 up); Chrome on Windows reports one stepped axis.
{
  const fired = [];
  const hatPage = { keys: new Set(), captured: true, soldier: {},
                    optOnFoot: { checked: false }, optPilot: { checked: false }, occupancy: null,
                    padTriggerDown: t => fired.push(t), padTriggerUp: () => {} };
  const hat = createControls(hatPage);
  await hat.importFiles(files);
  const stick = (axes, buttons = 12) => ({ connected: true, axes,
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })) });
  const press = (axes, buttons) => {
    fired.length = 0;
    setPad(stick(axes, buttons)); hat.pollGamepad();
    const got = [...fired];
    setPad(stick(axes.map((v, i) => (i >= axes.length - 2 && buttons !== 10 ? 0 : v)), buttons));
    hat.pollGamepad();
    return got;
  };
  // Real axes move first, the way a stick in the hand does.
  setPad(stick([0.03, -0.02, 0.01, -0.61, 0, 0])); hat.pollGamepad();
  out.hat = {
    up: press([0.03, -0.02, 0.01, -0.61, 0, -1]),
    right: press([0.03, -0.02, 0.01, -0.61, 1, 0]),
    down: press([0.03, -0.02, 0.01, -0.61, 0, 1]),
    left: press([0.03, -0.02, 0.01, -0.61, -1, 0]),
    diagonal: press([0.03, -0.02, 0.01, -0.61, 1, -1]),
  };
  // Chrome on Windows: axis 9 at rest reads 1.2857; right is -1 + 2*(2/7).
  const win = createControls({ ...hatPage, padTriggerDown: t => fired.push(t) });
  await win.importFiles(files);
  const axes = v => [0.03, -0.02, 0.01, -0.61, 0, 0, 0, 0, 0, v];
  fired.length = 0;
  setPad(stick(axes(1.2857))); win.pollGamepad();
  setPad(stick(axes(-1 + 2 * (2 / 7)))); win.pollGamepad();
  out.hatWindows = [...fired];
}

controls.resetDefaults();
out.afterReset = { profileName: controls.describe().profileName,
                   map: controls.hintText('{c_PIMap}', null) };

// The INVERT MOUSE box is per profile: `game.setAirMouseInvert 1` turns the
// look axis round in the air only.
const mouse = new MouseInput();
mouse.setInvert('air', 1);
const lookY = profile => { mouse.accumulate(0, 10); return Math.sign(mouse.pump(1 / 30, profile).y); };
out.invert = { air: lookY('air'), infantry: lookY('infantry'), landSea: lookY('landSea') };

// OPTIONS > VIDEO (features/video-options): the pieces `video-options.js`
// takes out of the game's page, and what a pack without that page gives.
{
  const rows = placeVideoRows(layout, VIDEO_ROWS);
  const perf = performancePanel(layout);
  const nav = videoNavButtons(layout);
  const { video: _video, videoNav: _videoNav, ...older } = layout.pages;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const gq = byId.graphicsQuality;
  out.video = {
    has: hasVideoPage(layout),
    panel: videoPanel(layout).map(el => [el.kind, el.texture || el.text]),
    lines: videoLines(layout),
    rows: rows.map(r => ({
      id: r.id, kind: r.kind, label: r.label.text, y: r.label.rect[1], key: r.label.key ?? null,
      frame: r.frame.map(el => el.rect), track: r.track, box: r.box, hit: r.hit,
      mark: r.mark ? [r.mark.rect, r.mark.when ?? null] : null,
      values: Object.fromEntries(Object.entries(r.values).map(([v, el]) => [v, el.text])),
      unit: r.unit?.rect ?? null, edit: r.edit?.rect ?? null,
    })),
    pick: {
      left: sliderPick(gq.track, [1, 2, 3], gq.track[0]),
      middle: sliderPick(gq.track, [1, 2, 3], gq.track[0] + gq.track[2] / 2),
      right: sliderPick(gq.track, [1, 2, 3], gq.track[0] + gq.track[2]),
      past: sliderPick(gq.track, [1, 2, 3], gq.track[0] + 500),
    },
    knob: { low: sliderKnob(gq.track, [1, 2, 3], 1), high: sliderKnob(gq.track, [1, 2, 3], 3) },
    perf: perf && {
      elements: perf.elements.map(el => el.texture || el.text),
      lines: perf.lines.map(l => [l.value, l.text.text, l.hit, l.fill.rect, l.fill.when ?? null]),
    },
    nav: Object.fromEntries(Object.entries(nav).map(([k, el]) => [k, el.rect])),
    olderPack: { has: hasVideoPage({ pages: older }), rows: placeVideoRows({ pages: older }, VIDEO_ROWS).length,
                 perf: performancePanel({ pages: older }), nav: videoNavButtons({ pages: older }) },
  };
}

// OPTIONS > SOUND (features/sound-hardware-path): SoundMenu's plate, built
// from VIDEO's art, its HARDWARE ACCELERATION row, and the stored choice.
{
  const row = hardwareRow(layout);
  const { video: _video, videoNav: _videoNav, ...older } = layout.pages;
  const kept = new Map();
  const storage = { getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v),
                    removeItem: k => kept.delete(k) };
  const stored = [];
  stored.push(storedHardware3d(storage));
  storeHardware3d(true, storage); stored.push(storedHardware3d(storage), kept.get('bf42-sound-hardware'));
  storeHardware3d(false, storage); stored.push(storedHardware3d(storage));
  storeHardware3d(null, storage); stored.push(storedHardware3d(storage));
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  storeHardware3d(true, throwing);
  out.sound = {
    has: hasSoundPage(layout),
    panel: soundPanel(layout).map(el => [el.kind, el.texture || el.text, el.rect[0], el.rect[1], el.key ?? null]),
    row: row && {
      label: [row.elements[0].text, row.elements[0].rect],
      box: row.box,
      mark: row.mark.rect,
      hit: row.hit,
    },
    nav: Object.fromEntries(Object.entries(soundNavButtons(layout)).map(([k, el]) => [k, el.rect])),
    olderPack: hasSoundPage({ pages: older }),
    stored,
    throwing: storedHardware3d(throwing),
    choose: [
      chooseHardware3d(),
      chooseHardware3d({ stored: true }),
      chooseHardware3d({ hw3d: '0', stored: true }),
      chooseHardware3d({ hw3d: '1', stored: false }),
      chooseHardware3d({ hw3d: 'yes', stored: null }),
    ],
  };
}

process.stdout.write(JSON.stringify(out));
