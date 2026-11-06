// OPTIONS > CONTROLS's DEFINE KEY flow under node: the real screen
// (`viewer/play/controls-screen.js`) over the extracted retail layout, its
// canvas, pointer, keyboard and gamepad stubbed. The sentence these defend:
//
//     clicking a box and pressing an input binds it the way retail's screen
//     does, and SAVE writes it only when no box conflicts.
//
// Needs `viewer/maps/_shared/hud/menu/controls-layout.json`
// (`extract_controls_menu_layout.py`); the Python side skips without it.

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `controls-preview.js` imports three by its bare name, as the page's import
// map has it: point that at the vendored copy.
const THREE_URL = new URL('../viewer/vendor/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
    return next(specifier, context);
  }`)}`, import.meta.url);

const MENU = new URL('../viewer/maps/_shared/hud/menu/', import.meta.url);

// --- the browser, as far as the screen needs one ------------------------------

const store = new Map();
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k),
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
const frames = [];
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.getComputedStyle = () => ({ zIndex: 'auto' });
// The window's own listeners, kept so a test can release a drag.
const windowHandlers = {};
globalThis.addEventListener = (type, fn) => { (windowHandlers[type] ??= []).push(fn); };
globalThis.location = { search: '' };
let pads = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', getGamepads: () => pads }, configurable: true,
});
globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 1; this.width = 1; this.height = 1; }
  addEventListener() {}
  set src(v) { this._src = v; }
};

const fills = [];
function context2d() {
  const ctx = { fillStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(ctx, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === 'fillRect') return (x, y, w, h) => fills.push({ color: target.fillStyle, rect: [x, y, w, h] });
      return () => {};
    },
    set(target, name, value) { target[name] = value; return true; },
  });
}

function element(tag) {
  const handlers = {};
  return {
    tag, style: {}, hidden: false, title: '', width: 0, height: 0, clientWidth: 800, clientHeight: 600,
    handlers,
    getContext: kind => (kind === '2d' ? context2d() : null),
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    after() {}, focus() {}, click() {},
    setAttribute() {},
  };
}
globalThis.document = { createElement: element };

globalThis.fetch = async href => {
  const path = String(href).replace(/\?.*$/, '');
  try {
    const body = readFileSync(path.startsWith('file:') ? fileURLToPath(path) : path, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  }
};

const { createControls } = await import('../viewer/controls.js');
const { createControlsScreen } = await import('../viewer/play/controls-screen.js');

const canvas = element('canvas');
const controls = createControls({ keys: new Set() });
let changed = 0;
const screen = createControlsScreen({
  canvas,
  controls,
  root: '../',
  params: new URLSearchParams({ pack: MENU.href.replace(/\/$/, '') }),
  pollPad: true,
  onBindingsChanged: () => { changed += 1; },
});
await screen.load();
screen.start();

const layout = JSON.parse(readFileSync(new URL('controls-layout.json', MENU), 'utf8'));
const out = {};

// --- driving it ------------------------------------------------------------------

const fire = (type, init = {}) => {
  const event = { button: 0, clientX: 0, clientY: 0, movementX: 0, movementY: 0, deltaY: 0,
                  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
  for (const fn of canvas.handlers[type] ?? []) fn(event);
  return event;
};
const runFrames = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const batch = frames.splice(0);
    for (const fn of batch) fn(performance.now());
  }
};
const keyEvent = (code, key = code) => ({ code, key, repeat: false, preventDefault() {} });
const press = code => screen.keydown(keyEvent(code));

/** The box of a row, by lexicon key: its centre. */
function boxAt(rowKey, slot = 0) {
  for (const tab of Object.values(layout.tabs)) {
    for (const page of tab.pages) {
      const row = page.rows.find(r => r.key === rowKey);
      if (row) {
        const [x, y, w, h] = slot ? row.alternate : row.primary;
        return [x + w / 2, y + h / 2];
      }
    }
  }
  throw new Error(`no row ${rowKey}`);
}
function clickBox(rowKey, slot = 0) {
  const [clientX, clientY] = boxAt(rowKey, slot);
  fire('pointermove', { clientX, clientY });
  fire('pointerdown', { clientX, clientY });
  fire('click', { clientX, clientY });
}
const tabHead = index => {
  const heads = layout.pages.tabs.elements.filter(el => el.kind === 'hit');
  const [x, y, w, h] = heads[index].rect;
  return [x + w / 2, y + h / 2];
};
const row = text => screen.state.rows.find(r => r.text === text)?.labels;

// --- INFANTRY: a key, Escape, Grave, AltGr, the mouse, the wheel, the stick ----

screen.setTab('infantry');
clickBox('CONTROLS_INFANTRY_FORWARD');
out.waiting = screen.state.defining;
out.escapeClaimedWhileWaiting = null;
press('KeyI');
out.key = { defining: screen.state.defining, forward: row('FORWARD:'), dirty: screen.state.dirty };

clickBox('CONTROLS_INFANTRY_JUMP');
out.escapeClaimedWhileWaiting = press('Escape');
out.unbound = row('JUMP:');
out.escapeWhenIdle = press('Escape');

clickBox('CONTROLS_INFANTRY_RELOAD');
press('Backquote');
out.grave = { message: screen.state.message, defining: screen.state.defining, reload: row('RELOAD:') };

clickBox('CONTROLS_INFANTRY_DROP');
const [rx, ry] = boxAt('CONTROLS_INFANTRY_DROP');
// The back side button (the browser's 3) is MOUSE 4, and never the
// browser's back.
const side = fire('pointerdown', { button: 3, clientX: rx, clientY: ry });
out.mouse = { drop: row('DROP / PICK-UP KIT:'), prevented: side.defaultPrevented,
              back: fire('mouseup', { button: 3, clientX: rx, clientY: ry }).defaultPrevented,
              menu: fire('contextmenu', { clientX: rx, clientY: ry }).defaultPrevented };
// The right button is MOUSE 2: on ALT FIRE's own box it is ALT FIRE again.
clickBox('CONTROLS_INFANTRY_ALT_FIRE');
fire('pointerdown', { button: 2, clientX: rx, clientY: ry });
out.mouse.altFire = row('ZOOM IN / ALTERNATE FIRE:');

clickBox('CONTROLS_INFANTRY_FIRE', 1);
fire('wheel', { deltaY: -100 });
out.wheel = { fire: row('FIRE:'), clash: screen.state.conflicts.sort() };
// Escape on the alternate box unbinds it.
clickBox('CONTROLS_INFANTRY_FIRE', 1);
press('Escape');
out.wheel.unbound = row('FIRE:');

// A tab head while a box waits lets it go.
clickBox('CONTROLS_INFANTRY_ALT_FIRE', 1);
const [tx, ty] = tabHead(0);
fire('pointerdown', { clientX: tx, clientY: ty });
out.tabCancels = { defining: screen.state.defining, tab: screen.state.tab };
screen.setTab('infantry');

// The stick: a button pressed after the click, then an axis on a movement row.
clickBox('CONTROLS_INFANTRY_WALK', 1);
const pad = (buttons, axes) => ({ connected: true, axes,
  buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) });
pads = [pad([], [0, 0, 0, 0])];
runFrames(2);
pads = [pad([5], [0, 0, 0, 0])];
runFrames(2);
out.padButton = row('WALK:');
pads = [pad([], [0.05, 0, 0, -0.61])];
runFrames(1);
clickBox('CONTROLS_INFANTRY_STRAFE_LEFT', 1);
runFrames(1);
pads = [pad([], [-0.7, 0, 0, -0.61])];
runFrames(2);
out.padAxis = { left: row('STRAFE LEFT:'), right: row('STRAFE RIGHT:') };
// An axis on a button row is no answer: it keeps waiting.
clickBox('CONTROLS_INFANTRY_RELOAD', 1);
pads = [pad([], [0.05, 0.9, 0, -0.61])];
runFrames(2);
out.axisOnButtonRow = screen.state.defining;
press('Escape');
pads = [];
runFrames(1);

// --- AltGr ----------------------------------------------------------------------

screen.turnPage(1);
clickBox('CONTROLS_INFANTRY_CROUCH');
press('ControlLeft');
press('AltRight');
out.altGr = row('CROUCH:');
clickBox('CONTROLS_INFANTRY_PRONE');
press('ControlLeft');
await new Promise(resolve => setTimeout(resolve, 80));
out.realCtrl = row('PRONE:');

// --- conflicts and SAVE -------------------------------------------------------------

clickBox('CONTROLS_INFANTRY_WEAPON_1');
press('KeyE');                         // ENTER / EXIT VEHICLE's key on COMMON
out.conflict = { marked: screen.state.conflicts.sort() };
// Hovering the conflicting box draws the red bar.
fills.length = 0;
const [cx, cy] = boxAt('CONTROLS_INFANTRY_WEAPON_1');
fire('pointermove', { clientX: cx + 1, clientY: cy });
screen.paint();
out.conflict.redBar = fills.some(f => f.color === 'rgb(177,73,73)' && f.rect[2] === 300);
const before = controls.files().infantry;
out.conflict.saved = screen.save();
out.conflict.message = screen.state.message;
out.conflict.unwritten = controls.files().infantry === before;

clickBox('CONTROLS_INFANTRY_WEAPON_1');
press('Digit1');
out.saved = { ok: screen.save(), message: screen.state.message, changed,
              lines: controls.files().infantry.split('\n').filter(l => /c_PIThrottle|c_PIAction|c_PICrouch|c_PIDrop/.test(l)),
              dirty: screen.state.dirty };

// --- DEFAULT asks first --------------------------------------------------------------

screen.turnPage(-1);
screen.askDefault();
out.confirm = { up: screen.state.confirming, escape: press('Escape'), after: screen.state.confirming };
screen.askDefault();
fire('pointermove', { clientX: 300, clientY: 297 });
fire('pointerdown', { clientX: 300, clientY: 297 });
fire('click', { clientX: 300, clientY: 297 });
out.confirm.ok = { up: screen.state.confirming, forward: row('FORWARD:'), dirty: screen.state.dirty,
                   unwritten: controls.files().infantry.includes('IDKey_I IDKey_S') };

// --- leaving drops what SAVE did not write ----------------------------------------------

screen.stop();
screen.start();
out.left = { forward: row('FORWARD:'), dirty: screen.state.dirty };

// --- the panel: MOUSE / KEYBOARD SENSITIVITY and INVERT MOUSE ---------------------

const release = () => { for (const fn of windowHandlers.pointerup ?? []) fn({ button: 0 }); };
const plateOf = tab => layout.pages[`plate.${tab}`].elements;
const tracksOf = tab => plateOf(tab).filter(el => el.kind === 'fill' && el.rect[2] === 74 && el.rect[3] === 9)
  .map(el => el.rect);
const tickOf = tab => plateOf(tab).find(el => el.kind === 'hit' && el.calls?.includes('Sound/PlayMenuUnCheck')).rect;
const word = (context, w) => (controls.files()[context].match(new RegExp(`^${w.replace('.', '\\.')} (\\S+)`, 'm')) || [])[1] ?? null;

screen.setTab('infantry');
const [mx, my, mw, mh] = tracksOf('infantry')[0];
// A press on the track's middle puts the knob's centre there: 0.5.
fire('pointermove', { clientX: mx + mw / 2, clientY: my + mh / 2 });
const knobPress = fire('pointerdown', { clientX: mx + mw / 2, clientY: my + mh / 2 });
release();
out.panel = { pressPrevented: knobPress.defaultPrevented, dirty: screen.state.dirty,
              beforeSave: word('infantry', 'game.setInfMouseSensitivity') };
screen.save();
out.panel.half = word('infantry', 'game.setInfMouseSensitivity');
// A drag keeps going past the track's end and off it vertically: clamped at 1.
fire('pointerdown', { clientX: mx + 4, clientY: my + mh / 2 });
fire('pointermove', { clientX: mx + mw + 60, clientY: my + 40 });
release();
// After the release the pointer moving away changes nothing.
fire('pointermove', { clientX: mx, clientY: my + mh / 2 });
screen.save();
out.panel.full = word('infantry', 'game.setInfMouseSensitivity');
out.panel.profile = controls.describe().vars['game.setInfMouseSensitivity'];
// INVERT MOUSE ticks on a click, and back off on the next.
const [ix, iy, iw, ih] = tickOf('infantry');
const tick = () => {
  fire('pointermove', { clientX: ix + iw / 2, clientY: iy + ih / 2 });
  fire('pointerdown', { clientX: ix + iw / 2, clientY: iy + ih / 2 });
  fire('click', { clientX: ix + iw / 2, clientY: iy + ih / 2 });
};
tick();
screen.save();
out.panel.inverted = word('infantry', 'game.setInfMouseInvert');
tick();
screen.save();
out.panel.uninverted = word('infantry', 'game.setInfMouseInvert');
// AIR's second slider is KEYBOARD SENSITIVITY; the left end is 0.
screen.setTab('air');
const [kx, ky, , kh] = tracksOf('air')[1];
fire('pointerdown', { clientX: kx - 2, clientY: ky + kh / 2 });
release();
screen.save();
out.panel.airKeyboard = word('air', 'game.setAirKeyboardSensitivity');
out.panel.airMouse = word('air', 'game.setAirMouseSensitivity');

process.stdout.write(JSON.stringify(out));
process.exit(0);
