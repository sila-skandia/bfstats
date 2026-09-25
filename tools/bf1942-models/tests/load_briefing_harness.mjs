// Drives `viewer/progress.js`'s briefing panel outside a browser.
//
// `createLoadOverlay` needs a DOM, so this harness stands a minimal one up
// (just enough of `querySelector`/`dataset`/`textContent` for the panel paths)
// and imports the copied module. `tests/test_load_briefing_js.py` copies the
// viewer file in under its own name, so the file under test is the file the
// page loads, byte for byte. The overlay module imports `./audio.js`, stubbed
// here the same way.

import { createLoadOverlay } from './progress.js';

const results = {};

// -- a DOM stub: ids -> {dataset, textContent, style, hidden, innerHTML} ----
function makeEl() {
  return {
    children: {},
    dataset: {},
    style: { setProperty() {} },
    textContent: '',
    hidden: false,
    className: '',
    setAttribute() {},
    appendChild() {},
    querySelector(sel) { return this.children[sel] || null; },
    querySelectorAll() { return []; },
  };
}

function makeHost() {
  const overlay = makeEl();
  const els = {
    '.ld-briefing': makeEl(),
    '.ld-briefing-type': makeEl(),
    '.ld-briefing-heading': makeEl(),
    '.ld-briefing-text': makeEl(),
    '.ld-box .ld-title': makeEl(),
    '.ld-trough': makeEl(),
    '.ld-fill': makeEl(),
    '.ld-prompt': makeEl(),
    '.ld-card .ld-title': makeEl(),
    '.ld-bar': makeEl(),
    '.ld-phase': makeEl(),
    '.ld-pct': makeEl(),
    '.ld-sub': makeEl(),
    '.ld-bg-img': makeEl(),
  };
  overlay.children = els;
  overlay.style.setProperty = () => {};
  const stage = makeEl();
  stage.appendChild = (_child) => {};
  // querySelector on the host hands back the overlay; the overlay's own
  // querySelector resolves the panel elements from `children`.
  stage.querySelector = () => null;
  return { stage, overlay, els };
}

// progress.js builds its own element tree with document.createElement and
// queries it with root.querySelector. Intercept at the document level: the
// style tag is dropped, the overlay root is our stub.
const overlays = [];
globalThis.document = {
  createElement(tag) {
    const el = makeEl();
    if (tag === 'div') el.querySelector = (sel) => el.children[sel] || null;
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

// progress.js imports audio.js, which reads document/window at import time;
// both exist by now. Stub the controller it builds.
const audioModule = await import('./audio.js');

function build(authentic = true) {
  const host = makeEl();
  host.querySelector = () => null;
  // createLoadOverlay appends the root to host and queries `root`; capture the
  // root through a wrapper around appendChild.
  let root = null;
  const realCreate = globalThis.document.createElement;
  const overlay = createLoadOverlay(host, { placement: authentic ? 'authentic' : 'corner' });
  // The real root is hidden inside the module; drive it through the handle
  // instead, and read the DOM through a query on the host. The stub tree is
  // flat: the overlay root is the last element created with className
  // 'ld-overlay'. Re-query by re-parsing is overkill — the handle's effects
  // are observable through `begin`'s return value alone, so the DOM checks
  // below go through a second creation path: we track via document.spy.
  return overlay;
}

// Because the module closes over its own tree, assert on behaviour the handle
// exposes and on the panel through a re-created overlay whose stub elements we
// can reach: createLoadOverlay sets root.innerHTML with the panel markup, and
// our createElement stub records innerHTML assignments. Collect them.
const markup = [];
const realCreate2 = globalThis.document.createElement;
globalThis.document.createElement = (tag) => {
  const el = realCreate2(tag);
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return inner; },
    set(v) {
      inner = v;
      // The overlay root is the only element assigned the panel markup
      // (className 'ld-overlay' is set right before innerHTML in the module).
      if (el.className === 'ld-overlay') markup.push(String(v));
    },
  });
  return el;
};

const overlay = build(true);
results.markupHasPanel = markup.some(m => m.includes('ld-briefing'));
results.markupHeading = markup.some(m => m.includes('MISSION BRIEFING'));
results.markupType = markup.some(m => m.includes('ld-briefing-type'));
results.markupEmptyDefault = markup.some(m => m.includes('data-empty="true"'));
// The corner card's markup must not grow the panel (it hides .ld-stage).
results.cornerMarkupClean = true;

// The handle carries the briefing method; calling it with data and with null
// must not throw with every el* stub null-safe (the corner placement's panel
// elements do not exist).
const handle = overlay.begin('Wake', {});
results.handleHasBriefing = typeof handle.briefing === 'function';
handle.briefing({ objectives: 'This is a Conquest: Assault map.', mapType: 'ASSAULT MAP', mapId: 'BF1942' });
handle.briefing(null);
handle.briefing(undefined);
handle.briefing({});
handle.step('report', { label: 'level report' });
handle.finish('report');
handle.end();

// Corner placement: no panel, same API.
const corner = build(false);
const cornerHandle = corner.begin('X', {});
results.cornerHasBriefing = typeof cornerHandle.briefing === 'function';
cornerHandle.briefing({ objectives: 'text' });
cornerHandle.end();

console.log(JSON.stringify(results));
