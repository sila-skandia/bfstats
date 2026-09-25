// Drives `viewer/progress.js`'s mission-briefing screen outside a browser.
//
// `createLoadOverlay` needs a DOM, so this harness stands a minimal one up
// (just enough of `querySelector`/`dataset`/`textContent`/event listeners for
// the screen's paths) and imports the copied module. `test_load_briefing_js.py`
// copies the viewer files in under their own names, so the file under test is
// the file the page loads, byte for byte. The overlay module imports
// `./audio.js`, stubbed here the same way.
//
// What is pinned here:
//   * the authentic screen's markup carries the briefing dialog (name, flags
//     row, mode, settings, OBJECTIVES/COMMENTS bands) and the READY button,
//     and no longer the old splash-borne MISSION BRIEFING panel;
//   * `load.briefing(...)` fills the dialog and survives data, null,
//     undefined and an object with none of the fields;
//   * `end()` on the authentic placement parks the overlay in the `briefing`
//     state and returns a promise; clicking READY resolves it, fires the
//     `onReady` the page handed `begin`, and fades the music — the corner
//     placement keeps the old done-means-gone behaviour.

import { createLoadOverlay } from './progress.js';

const results = {};

// -- a DOM stub -------------------------------------------------------------
function makeEl(tag = 'div') {
  const listeners = {};
  const el = {
    children: {},
    dataset: {},
    style: { setProperty() {} },
    textContent: '',
    hidden: false,
    className: '',
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { for (const fn of listeners[type] || []) fn({}); },
    querySelector(sel) { return this.children[sel] || null; },
    querySelectorAll(sel) { return this.children[`${sel}[]`] || []; },
  };
  return el;
}

// The module builds its tree as one innerHTML string and then queries it, so
// the stub resolves every selector the module uses to a hand-made element.
// The two flag images are the one querySelectorAll.
function seedOverlay(el) {
  const flagA = makeEl();
  const flagB = makeEl();
  el.children = {
    '.ld-bg-img': makeEl(),
    '.ld-box .ld-title': makeEl(),
    '.ld-trough': makeEl(),
    '.ld-fill': makeEl(),
    '.ld-prompt': makeEl(),
    '.ld-brief': makeEl(),
    '.ld-brief-name': makeEl(),
    '.ld-brief-mode': makeEl(),
    '.ld-brief-settings': makeEl(),
    '.ld-brief-objectives .ld-brief-bandtext': makeEl(),
    '.ld-brief-comments .ld-brief-bandtext': makeEl(),
    '.ld-brief-btn': makeEl('button'),
    '.ld-brief-flag[]': [flagA, flagB],
    '.ld-card .ld-title': makeEl(),
    '.ld-bar': makeEl(),
    '.ld-phase': makeEl(),
    '.ld-pct': makeEl(),
    '.ld-sub': makeEl(),
  };
  return el.children;
}

const overlays = [];
const markup = [];
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
          if (v === 'ld-overlay') { seedOverlay(el); overlays.push(el); }
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

function build(authentic) {
  const host = makeEl();
  host.querySelector = () => null;
  return createLoadOverlay(host, { placement: authentic ? 'authentic' : 'corner' });
}

// -- markup ------------------------------------------------------------------
build(true);
const screen = markup[markup.length - 1] || '';
results.markupHasDialog = screen.includes('ld-brief-name') && screen.includes('ld-brief-mode');
results.markupHasBands = screen.includes('OBJECTIVES') && screen.includes('COMMENTS');
results.markupHasReady = screen.includes('READY') && screen.includes('ld-brief-btn');
results.markupHasFlags = (screen.match(/class="ld-brief-flag"/g) || []).length === 2;
results.markupNoSplashPanel = !screen.includes('ld-briefing');
results.markupNoHeading = !screen.includes('MISSION BRIEFING');

// -- the briefing data fills the dialog --------------------------------------
let readyClicks = 0;
const overlay = build(true);
const root = overlays[overlays.length - 1];
const els = root.children;
const handle = overlay.begin('Wake', { onReady: () => { readyClicks += 1; } });
results.handleHasBriefing = typeof handle.briefing === 'function';

handle.briefing({
  objectives: 'This is a Conquest: Assault map.',
  mapType: 'ASSAULT MAP',
  mapId: 'BF1942',
  displayName: 'WAKE ISLAND',
  gameType: 'Conquest',
  flags: ['maps/_shared/hud/icon_flag_jp.png', null],
});
results.dialogName = els['.ld-brief-name'].textContent;
results.dialogMode = els['.ld-brief-mode'].textContent;
results.dialogObjectives = els['.ld-brief-objectives .ld-brief-bandtext'].textContent;
results.dialogCommentsEmpty = els['.ld-brief-comments .ld-brief-bandtext'].textContent === '';
results.dialogFirstFlagShown = els['.ld-brief-flag[]'][0].src !== undefined
  && els['.ld-brief-flag[]'][0].style.display === '';
results.dialogSecondFlagHidden = els['.ld-brief-flag[]'][1].style.display === 'none';
results.settingsRows = (els['.ld-brief-settings'].innerHTML.match(/ld-brief-row/g) || []).length;

// survives null / undefined / an empty object
handle.briefing(null);
handle.briefing(undefined);
handle.briefing({});
results.dialogCleared = els['.ld-brief-name'].textContent === ''
  && els['.ld-brief-objectives .ld-brief-bandtext'].textContent === '';

// -- end() parks on the briefing screen until READY --------------------------
handle.step('report', { label: 'level report' });
handle.finish('report');
const ended = handle.end();
results.endReturnsPromise = ended instanceof Promise;
results.stateBriefing = root.dataset.state === 'briefing';
els['.ld-brief-btn'].dispatch('click');
results.readyFiresOnReady = readyClicks === 1;
results.readyClearsState = root.dataset.state === 'done';

// -- corner placement: no dialog, done means gone ----------------------------
const corner = build(false);
const cornerRoot = overlays[overlays.length - 1];
const cornerHandle = corner.begin('X', {});
results.cornerHasBriefing = typeof cornerHandle.briefing === 'function';
cornerHandle.briefing({ objectives: 'text' });
cornerHandle.end();
results.cornerEndConceals = cornerRoot.dataset.state === 'done';

console.log(JSON.stringify(results));
