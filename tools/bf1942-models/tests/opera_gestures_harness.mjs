// Drives `viewer/opera-gestures.js` and its wiring in `viewer/page-input.js`
// outside a browser and prints one JSON blob (tests/test_opera_gestures.py):
// the Opera detection, the hint card's gate, dismissal and comeback, the
// defensive preventDefaults that act only while the game has the mouse, and
// the beforeunload guard on foot and seated. The DOM is stubbed; the test
// copies the modules in under their own names, so the files under test are
// the files the page loads.

let winHandlers = {};
let docHandlers = {};

/** A stub element: enough of one for page-input's construction and for the
 *  hint card (`innerHTML`, then `querySelector` by class). */
function element(tagName = 'DIV') {
  const handlers = {};
  const kids = {};
  const el = {
    tagName, hidden: false, textContent: '', id: '', children: [],
    classList: { toggle() {}, contains: () => false },
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {},
    requestPointerLock() { globalThis.document.pointerLockElement = el; return Promise.resolve(); },
    appendChild(child) { el.children.push(child); return child; },
    querySelector(sel) { return (kids[sel] ??= element(sel === '.oh-ok' ? 'BUTTON' : 'DIV')); },
    set innerHTML(v) { el._html = v; },
    get innerHTML() { return el._html ?? ''; },
    blur() { if (globalThis.document.activeElement === el) globalThis.document.activeElement = null; },
    click() {
      const e = { type: 'click', target: el, stopPropagation() {}, preventDefault() {} };
      for (const fn of handlers.click ?? []) fn(e);
    },
  };
  return el;
}

globalThis.addEventListener = (type, fn) => { (winHandlers[type] ??= []).push(fn); };
globalThis.document = {
  getElementById: () => element(),
  createElement: tag => element(tag.toUpperCase()),
  addEventListener: (type, fn) => { (docHandlers[type] ??= []).push(fn); },
  pointerLockElement: null,
  activeElement: null,
  visibilityState: 'visible',
  exitPointerLock() { globalThis.document.pointerLockElement = null; },
};
globalThis.fetch = () => Promise.reject(new Error('no network in the harness'));
console.warn = () => {};

const store = new Map();
let storageThrows = false;
const storage = {
  getItem(k) { if (storageThrows) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { if (storageThrows) throw new Error('SecurityError'); store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { get: () => storage, configurable: true });

const OPERA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/130.0.0.0 Safari/537.36';
function setNavigator(nav) {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
}

const { isOpera, operaHintText, createOperaHint } = await import('./opera-gestures.js');
const { createPageInput } = await import('./page-input.js');

const out = {};

// --- detection -----------------------------------------------------------------

out.detect = {
  operaBrand: isOpera({ userAgentData: { brands: [{ brand: 'Chromium', version: '130' },
    { brand: 'Opera', version: '115' }, { brand: 'Not?A_Brand', version: '99' }] }, userAgent: CHROME_UA }),
  operaGxBrand: isOpera({ userAgentData: { brands: [{ brand: 'Opera GX', version: '115' }] }, userAgent: '' }),
  oprUa: isOpera({ userAgent: OPERA_UA }),
  chrome: isOpera({ userAgentData: { brands: [{ brand: 'Google Chrome', version: '130' },
    { brand: 'Chromium', version: '130' }] }, userAgent: CHROME_UA }),
  firefox: isOpera({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:132.0) Gecko/20100101 Firefox/132.0' }),
  operaInName: isOpera({ userAgent: 'Mozilla/5.0 Operator/1.0' }),
  none: isOpera(null),
};
out.text = { en: operaHintText('en-US'), de: operaHintText('de-DE'), returned: operaHintText('en', true) };

// --- the hint on its own --------------------------------------------------------

{
  const host = element();
  const hint = createOperaHint({ nav: { userAgent: OPERA_UA, language: 'de-DE' }, storage, doc: globalThis.document, host });
  let accepted = 0;
  const r = {};
  r.enabled = hint.enabled;
  r.freeCamGate = hint.gate(false, () => accepted++);
  r.firstGate = hint.gate(true, () => accepted++);
  r.cardBuilt = host.children.length;
  r.visible = hint.visible();
  r.title = host.children[0]?.querySelector('.oh-title').textContent;
  r.steps = host.children[0]?.querySelector('.oh-steps').textContent;
  r.gateWhileUp = hint.gate(true, () => accepted++);
  host.children[0].querySelector('.oh-ok').click();
  r.afterAccept = { accepted, visible: hint.visible(), dismissed: hint.dismissed(), stored: store.get('bfstats.operaGesturesHintDismissed') ?? null };
  r.gateAfterDismiss = hint.gate(true, () => accepted++);
  r.hiddenWithoutRight = hint.noteHidden(true, false);
  r.visibleNoPending = hint.noteVisible(() => accepted++);
  r.hiddenFreeCam = hint.noteHidden(false, true);
  r.hiddenInPlayRight = hint.noteHidden(true, true);
  r.comeback = hint.noteVisible(() => accepted++);
  r.comebackTitle = host.children[0].querySelector('.oh-title').textContent;
  r.cardsAfterComeback = host.children.length;
  host.children[0].querySelector('.oh-ok').click();
  r.afterComeback = { accepted, visible: hint.visible(), pending: hint.pending() };
  out.hint = r;

  // A second page load reads the dismissal back.
  const again = createOperaHint({ nav: { userAgent: OPERA_UA }, storage, doc: globalThis.document, host: element() });
  out.reload = { dismissed: again.dismissed(), gate: again.gate(true, () => {}) };

  // Storage that throws (a private window, blocked site data): the hint still
  // shows and is still dismissed for this page load.
  storageThrows = true;
  const shut = createOperaHint({ nav: { userAgent: OPERA_UA }, storage, doc: globalThis.document, host: element() });
  const shutFirst = shut.gate(true, () => {});
  shut.accept();
  out.storageOff = { first: shutFirst, dismissed: shut.dismissed(), second: shut.gate(true, () => {}) };
  storageThrows = false;

  const chrome = createOperaHint({ nav: { userAgent: CHROME_UA }, storage, doc: globalThis.document, host: element() });
  out.chromeHint = { enabled: chrome.enabled, gate: chrome.gate(true, () => {}), hidden: chrome.noteHidden(true, true),
    visible: chrome.noteVisible(() => {}) };
  const phone = createOperaHint({ nav: { userAgent: OPERA_UA }, storage, doc: globalThis.document, host: element(), touch: true });
  out.phoneHint = { enabled: phone.enabled, gate: phone.gate(true, () => {}) };
}

// --- the page: page-input.js over a stub page ----------------------------------

const record = () => () => false;
function makePage(over = {}) {
  const canvas = element('CANVAS');
  const target = {
    optOnFoot: { checked: true },
    optPilot: { checked: false },
    soldier: {},
    occupancy: null,
    mouseInput: null,
    consoleCaptures: () => false,
    escMenuCaptures: () => false,
    chatCaptures: () => false,
    uiFocused: () => false,
    deployActive: () => false,
    scoreboardOpen: () => false,
    itemsLocked: () => false,
    weaponBarFire: () => false,
    codeTriggers: () => [],
    activeCodes: () => new Set(),
    kblockKeys: () => [],
    params: new URLSearchParams(''),
    renderer: { domElement: canvas },
    stage: element(),
    fullmapBox: { hidden: true },
    FLY_KEYS: new Set(),
    overlay: null,
    isTouchDevice: false,
    handWeapon: null,
    ...over,
  };
  return new Proxy(target, { get(t, name) { return name in t ? t[name] : record(); } });
}
function build(nav, over) {
  winHandlers = {};
  docHandlers = {};
  setNavigator(nav);
  globalThis.document.pointerLockElement = null;
  const page = makePage(over);
  const input = createPageInput(page);
  return { page, input, win: winHandlers, doc: docHandlers, canvas: page.renderer.domElement };
}
function fire(handlers, type, fields = {}) {
  let prevented = false;
  const e = { type, button: 0, buttons: 0, preventDefault() { prevented = true; }, stopPropagation() {},
    ...fields };
  for (const fn of handlers[type] ?? []) fn(e);
  return prevented;
}

// beforeunload: on foot, seated, free camera, and not captured.
{
  const env = build({ userAgent: CHROME_UA });
  const r = {};
  r.uncaptured = fire(env.win, 'beforeunload');
  env.input.capture();
  r.onFoot = fire(env.win, 'beforeunload');
  env.page.optOnFoot.checked = false;
  env.page.optPilot.checked = true;
  env.page.occupancy = { seat: 0 };
  r.seated = fire(env.win, 'beforeunload');
  env.page.optPilot.checked = false;
  env.page.occupancy = null;
  r.freeCam = fire(env.win, 'beforeunload');
  env.input.release();
  env.page.optPilot.checked = true;
  env.page.occupancy = { seat: 0 };
  r.seatedReleased = fire(env.win, 'beforeunload');
  out.unload = r;
}

// The defensive handlers: only while captured, only the game's own presses.
{
  const env = build({ userAgent: CHROME_UA });
  const c = env.canvas;
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'contextmenu'];
  const all = fields => Object.fromEntries(types.map(t => [t, fire(env.doc, t,
    { pointerType: t.startsWith('pointer') ? 'mouse' : undefined, ...fields })]));
  const r = {};
  r.uncaptured = all({ target: c, button: 2, buttons: 2 });
  env.input.capture();
  r.capturedCaptured = env.input.captured;
  r.canvasRight = all({ target: c, button: 2, buttons: 2 });
  r.canvasSide = all({ target: c, button: 3, buttons: 8 });
  const field = element('INPUT');
  globalThis.document.pointerLockElement = null;
  r.unlockedField = all({ target: field, button: 2, buttons: 2 });
  r.unlockedOther = fire(env.doc, 'mousedown', { target: element('DIV'), button: 2, buttons: 2 });
  globalThis.document.pointerLockElement = c;
  r.lockedOther = fire(env.doc, 'mousedown', { target: element('DIV'), button: 2, buttons: 2 });
  r.touch = fire(env.doc, 'pointerdown', { target: c, pointerType: 'touch', button: 0, buttons: 1 });
  r.touchCompat = fire(env.doc, 'mousedown', { target: c, button: 0, buttons: 1,
    sourceCapabilities: { firesTouchEvents: true } });
  // A sidebar field still focused when the press is taken loses the focus,
  // the way the default mousedown would have taken it.
  const select = element('SELECT');
  globalThis.document.activeElement = select;
  fire(env.doc, 'pointerdown', { target: c, pointerType: 'mouse', button: 0, buttons: 1 });
  r.fieldBlurred = globalThis.document.activeElement === null;
  env.input.release();
  r.released = all({ target: c, button: 2, buttons: 2 });
  out.handlers = r;
}

// Opera: the first capture in play shows the card instead; its button captures.
{
  store.clear();
  const env = build({ userAgent: OPERA_UA, language: 'de-DE' });
  const r = {};
  const hint = env.input.operaHint;
  r.enabled = hint.enabled;
  env.input.capture();
  r.firstCapture = { captured: env.input.captured, visible: hint.visible(), cards: env.page.stage.children.length };
  r.secondCaptureWhileUp = (env.input.capture(), env.input.captured);
  env.page.stage.children[0].querySelector('.oh-ok').click();
  r.afterOk = { captured: env.input.captured, visible: hint.visible(), stored: store.get('bfstats.operaGesturesHintDismissed') ?? null };
  env.input.release();
  env.input.capture();
  r.nextCapture = { captured: env.input.captured, visible: hint.visible() };

  // The right button held in play (a chord's mousedown), then the page goes
  // hidden: Opera's new tab. Back on the page the card is up again.
  fire(env.doc, 'mousedown', { target: env.canvas, button: 2, buttons: 2 });
  r.rightDown = env.input.rightDown;
  globalThis.document.visibilityState = 'hidden';
  fire(env.doc, 'visibilitychange');
  r.pendingWhileHidden = hint.pending();
  globalThis.document.visibilityState = 'visible';
  fire(env.doc, 'visibilitychange');
  r.onReturn = { captured: env.input.captured, visible: hint.visible(), rightDown: env.input.rightDown,
    title: env.page.stage.children[0].querySelector('.oh-title').textContent };
  env.page.stage.children[0].querySelector('.oh-ok').click();
  r.afterReturnOk = { captured: env.input.captured, visible: hint.visible() };

  // Hidden without the right button: nothing comes back.
  fire(env.doc, 'mouseup', { target: env.canvas, button: 2, buttons: 0 });
  globalThis.document.visibilityState = 'hidden';
  fire(env.doc, 'visibilitychange');
  globalThis.document.visibilityState = 'visible';
  fire(env.doc, 'visibilitychange');
  r.plainTabSwitch = { captured: env.input.captured, visible: hint.visible() };

  // The free camera is not play: no card, the capture goes straight through.
  store.clear();
  const free = build({ userAgent: OPERA_UA }, { soldier: null, optOnFoot: { checked: false } });
  free.input.capture();
  r.freeCam = { captured: free.input.captured, visible: free.input.operaHint.visible() };
  out.opera = r;
}

// Chrome: the capture is never held back.
{
  store.clear();
  const env = build({ userAgent: CHROME_UA });
  env.input.capture();
  out.chrome = { enabled: env.input.operaHint.enabled, captured: env.input.captured,
    cards: env.page.stage.children.length };
}

console.log(JSON.stringify(out));
process.exit(0);
