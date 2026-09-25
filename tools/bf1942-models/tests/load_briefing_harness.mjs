// Drives `viewer/progress.js`'s mission-briefing screen outside a browser.
//
// `createLoadOverlay` needs a DOM, so this harness stands a minimal one up
// (just enough of `querySelector`/`dataset`/`textContent`/event listeners for
// the screen's paths) and imports the copied module. `test_load_briefing_js.py`
// copies the viewer files in under their own names, so the file under test is
// the file the page loads, byte for byte. The overlay module imports
// `./audio.js`, stubbed here the same way. The briefing screen's pixels are
// `briefing-screen.js`'s, exercised live in the browser; here the module is a
// stub and only the handshake is under test.
//
// What is pinned here:
//   * the authentic overlay hosts the briefing module's canvas and the READY
//     hit area, and no longer carries a DOM briefing dialog;
//   * `load.briefing(...)` forwards its payload (and `null`) to the module's
//     paint — the module renders, the overlay only stores and forwards;
//   * `end()` on the authentic placement lays the screen out, parks the
//     overlay in the `briefing` state and returns a promise; clicking READY
//     resolves it, fires the `onReady` the page handed `begin` — the corner
//     placement (the models page, no briefing module) keeps the old
//     done-means-gone behaviour.

import { createLoadOverlay } from './progress.js';

const results = {};

// -- a DOM stub -------------------------------------------------------------
function makeEl(tag = 'div') {
  const listeners = {};
  const el = {
    children: {},
    dataset: {},
    style: { setProperty() {}, left: '', top: '', width: '', height: '' },
    textContent: '',
    hidden: false,
    className: '',
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    after() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { for (const fn of listeners[type] || []) fn({}); },
    querySelector(sel) { return this.children[sel] || null; },
    querySelectorAll(sel) { return this.children[`${sel}[]`] || []; },
  };
  return el;
}

// The module builds its tree as one innerHTML string and then queries it, so
// the stub resolves every selector the module uses to a hand-made element.
function seedOverlay(el, buttons) {
  const btn = makeEl('button');
  el.children = {
    '.ld-bg-img': makeEl(),
    '.ld-stage': makeEl(),
    '.ld-box .ld-title': makeEl(),
    '.ld-trough': makeEl(),
    '.ld-fill': makeEl(),
    '.ld-prompt': makeEl(),
    '.ld-brief-btn': btn,
    '.ld-card .ld-title': makeEl(),
    '.ld-bar': makeEl(),
    '.ld-phase': makeEl(),
    '.ld-pct': makeEl(),
    '.ld-sub': makeEl(),
  };
  el.appendChild = child => { el._children = el._children || []; el._children.push(child); };
  btn.addEventListener('click', () => buttons.push(btn));
  return el.children;
}

const overlays = [];
const markup = [];
const buttons = [];
let makeElement = tag => makeEl(tag);
globalThis.document = {
  createElement(tag) {
    const el = makeElement(tag);
    if (tag === 'div') {
      let cls = '';
      Object.defineProperty(el, 'className', {
        get: () => cls,
        set(v) {
          cls = v;
          if (v === 'ld-overlay') { seedOverlay(el, buttons); overlays.push(el); }
        },
      });
      let inner = '';
      Object.defineProperty(el, 'innerHTML', {
        get: () => inner,
        set(v) { inner = v; if (el.className === 'ld-overlay') markup.push(String(v)); },
      });
    }
    return el;
  },
  createElementNS() { return makeEl(); },
  getElementById() { return null; },
  head: { appendChild() {} },
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => 0 };

await import('./audio.js');

// The briefing module as progress.js sees it: paint/layout/hover recorded.
function makeBriefingStub() {
  const calls = { paint: [], layout: [], hover: [] };
  return {
    canvas: makeEl('canvas'),
    calls,
    paint(p) { calls.paint.push(p); },
    layout(...args) { calls.layout.push(args); },
    hover(on) { calls.hover.push(on); },
  };
}

function build(briefing) {
  const host = makeEl();
  host.querySelector = () => null;
  return createLoadOverlay(host, { placement: 'authentic', briefing });
}

// -- markup: the canvas is the screen; the DOM dialog is gone ----------------
build(makeBriefingStub());
const screen = markup[markup.length - 1] || '';
results.markupNoDomDialog = !screen.includes('ld-brief-name') && !screen.includes('ld-brief-settings');
results.markupHasHitButton = screen.includes('ld-brief-btn') && screen.includes('aria-label="Ready"');
results.markupNoSplashPanel = !screen.includes('ld-briefing');
results.markupNoHeading = !screen.includes('MISSION BRIEFING');

// -- the briefing data is forwarded to the module ----------------------------
const briefingStub = makeBriefingStub();
const overlay = build(briefingStub);
const root = overlays[overlays.length - 1];
const els = root.children;
let readyClicks = 0;
const handle = overlay.begin('Wake', { onReady: () => { readyClicks += 1; } });
results.handleHasBriefing = typeof handle.briefing === 'function';

handle.briefing({
  objectives: 'This is a Conquest: Assault map.',
  mapType: 'ASSAULT MAP',
  mapId: 'BF1942',
  displayName: 'WAKE ISLAND',
  gameType: 'Conquest',
  flags: ['maps/_shared/hud/flag_ticket_jp.png', null],
});
const painted = briefingStub.calls.paint.at(-1);
results.paintForwardedName = painted.displayName;
results.paintForwardedFlags = painted.flags && painted.flags[0];

// survives null / undefined / an empty object
handle.briefing(null);
results.paintCleared = briefingStub.calls.paint.at(-1) === null;
handle.briefing(undefined);
handle.briefing({});
const storedGarbage = briefingStub.calls.paint.at(-1);
results.paintSurvivesEmpty = storedGarbage !== undefined
  && Object.keys(storedGarbage).length === 0;

// -- end() parks on the briefing screen until READY --------------------------
handle.step('report', { label: 'level report' });
handle.finish('report');
const ended = handle.end();
results.endReturnsPromise = ended instanceof Promise;
results.stateBriefing = root.dataset.state === 'briefing';
results.layoutRan = briefingStub.calls.layout.length === 1;
results.paintRanOnEnd = typeof briefingStub.calls.paint.at(-1) === 'object';
els['.ld-brief-btn'].dispatch('mouseenter');
els['.ld-brief-btn'].dispatch('click');
results.readyFiresOnReady = readyClicks === 1;
results.readyClearsState = root.dataset.state === 'done';
results.hoverRelayed = briefingStub.calls.hover.includes(true);

// -- corner placement: no briefing module, done means gone --------------------
const corner = build(null);
const cornerRoot = overlays[overlays.length - 1];
const cornerHandle = corner.begin('X', {});
results.cornerHasBriefing = typeof cornerHandle.briefing === 'function';
cornerHandle.briefing({ objectives: 'text' });
await cornerHandle.end();
results.cornerEndConceals = cornerRoot.dataset.state === 'done';

console.log(JSON.stringify(results));