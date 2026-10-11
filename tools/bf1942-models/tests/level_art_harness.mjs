// Drives `viewer/level-art.js` and the loading overlay's picture fallback in
// `viewer/progress.js` outside a browser. `test_level_art.py` copies the
// viewer files in under their own names, so what runs is what the page loads.
//
// Two modes:
//   no argument  -> prints a JSON object of pass/fail facts about the chain
//                   and the overlay's error handling;
//   <cases.json> -> `[{mod, level, trees: [{base, rows}]}]`, prints each
//                   case's candidate list, for the test to check on disk.

import { readFileSync } from 'node:fs';
import {
  DEFAULT_ART, artCandidates, firstLoadable, forgetVerdicts, imageLoads, isBlankFrame, joinArt, rowFor,
} from './level-art.js';

if (process.argv[2]) {
  const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const out = cases.map(c => ({
    mod: c.mod, level: c.level, candidates: artCandidates(c.level, c.trees),
  }));
  process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));
  await new Promise(() => {});
}

const results = {};

// -- joinArt ------------------------------------------------------------------
results.joinPlain = joinArt('maps/mods/xpack2', 'raid_on_agheila/load.webp');
results.joinTrailingSlash = joinArt('maps/mods/xpack2/', '/_shared/load/western.webp');
results.joinAbsolute = joinArt('maps', 'https://x.test/a.webp');
results.joinEmpty = joinArt('maps', '');

// -- rowFor -------------------------------------------------------------------
const rows = [{ name: 'Raid_on_Agheila', loading: { background: 'raid_on_agheila/load.webp' } },
  { name: 'Bocage' }];
results.rowCase = rowFor(rows, 'raid_on_agheila')?.name;
results.rowMissing = rowFor(rows, 'nope');
results.rowNullRows = rowFor(null, 'bocage');

// -- artCandidates: own picture, vanilla's, then the defaults ---------------------
const mod = { base: 'maps/mods/xpack2', rows };
const vanilla = { base: 'maps', rows: [{ name: 'Bocage', loading: { background: '_shared/load/western2.webp' } }] };
results.ownFirst = artCandidates('Raid_on_Agheila', [mod, vanilla]);
results.inherited = artCandidates('bocage', [mod, vanilla]);
results.unreadableTree = artCandidates('Bocage', [{ base: 'maps/mods/xpack2', rows: null }, vanilla]);
results.vanillaOnly = artCandidates('Bocage', [vanilla]);
results.unknownLevel = artCandidates('nothing', [mod, vanilla]);
results.defaultArt = DEFAULT_ART;

// -- firstLoadable ---------------------------------------------------------------
const present = new Set(['b', 'c']);
const loads = async url => present.has(url);
results.firstOfTwo = await firstLoadable(['a', 'b', 'c'], loads);
results.firstNone = await firstLoadable(['a', 'z'], loads);
results.firstEmpty = await firstLoadable([], loads);

// -- imageLoads with a stand-in Image ----------------------------------------------
forgetVerdicts();
let made = 0;
class FakeImage {
  constructor() { made += 1; }
  set src(url) {
    this._src = url;
    queueMicrotask(() => (url.includes('missing') ? this.onerror?.() : this.onload?.()));
  }
}
results.imageOk = await imageLoads('maps/ok.webp', FakeImage);
results.imageMissing = await imageLoads('maps/missing.webp', FakeImage);
results.imageSettledOnce = (await imageLoads('maps/ok.webp', FakeImage)) === true && made === 2;
results.imageNoUrl = await imageLoads('', FakeImage);

// -- isBlankFrame: a cover that is only black is not a cover -----------------------
const rgba = (n, px) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? 255 : px));
results.blankBlack = isBlankFrame(rgba(144, 0));
results.blankNearBlack = isBlankFrame(rgba(144, 9));
results.blankDim = isBlankFrame(rgba(144, 40));
const oneLit = rgba(144, 0);
oneLit[4 * 70] = 200;
results.blankOneLitPixel = isBlankFrame(oneLit);
results.blankEmpty = isBlankFrame(new Uint8ClampedArray(0));

// -- the overlay's picture falls through a chain of 404s ------------------------------
function makeEl() {
  const listeners = {};
  return {
    children: {}, dataset: {}, style: { setProperty() {}, left: '', top: '', width: '', height: '' },
    textContent: '', hidden: false, className: '',
    setAttribute() {}, appendChild() {}, after() {},
    removeAttribute(name) { delete this[name]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector(sel) { return this.children[sel] || null; },
    querySelectorAll() { return []; },
  };
}
const roots = [];
globalThis.document = {
  createElement(tag) {
    const el = makeEl();
    if (tag === 'div') {
      let cls = '';
      Object.defineProperty(el, 'className', {
        get: () => cls,
        set(v) {
          cls = v;
          if (v === 'ld-overlay') {
            el.children = {
              '.ld-bg-img': makeEl(), '.ld-stage': makeEl(), '.ld-box .ld-title': makeEl(),
              '.ld-trough': makeEl(), '.ld-fill': makeEl(), '.ld-prompt': makeEl(), '.ld-note': makeEl(),
              '.ld-brief-btn': makeEl(), '.ld-card .ld-title': makeEl(), '.ld-bar': makeEl(),
              '.ld-phase': makeEl(), '.ld-pct': makeEl(), '.ld-sub': makeEl(),
            };
            roots.push(el);
          }
        },
      });
      Object.defineProperty(el, 'innerHTML', { get: () => '', set() {} });
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

const { createLoadOverlay } = await import('./progress.js');
const host = makeEl();
const overlay = createLoadOverlay(host, { placement: 'authentic', audioOptions: null });
const root = roots.at(-1);
const img = root.children['.ld-bg-img'];

overlay.begin('Raid_on_Agheila', {
  assetBase: 'maps/mods/xpack2',
  background: 'raid_on_agheila/load.webp',
  backgroundFallbacks: async () => ['maps/_shared/load/western2.webp', 'maps/mods/xpack2/raid_on_agheila/load.webp'],
});
// The browser fires `error`; the handler may need a turn to look up fallbacks.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const fail = async () => { img.onerror(); await settle(); };
const seen = [img.src];
for (let i = 0; i < 6 && img.src; i += 1) {
  await fail();
  seen.push(img.src ?? null);
}
results.overlayChain = seen;
results.overlayGaveUp = root.dataset.art;

// A picture that loads is left alone; a new load starts a clean chain.
overlay.begin('Wake', { assetBase: 'maps', background: '_shared/load/pacific2.webp' });
results.overlayFresh = img.src;
results.overlayArtCleared = root.dataset.art === undefined;

// A row with no picture asks the page for the inherited one before any default.
overlay.begin('Bocage', { assetBase: 'maps/mods/xpack2',
  backgroundFallbacks: async () => ['maps/_shared/load/western2.webp'] });
await settle();
results.overlayNoRowAsks = img.src;

// A throwing or absent fallback still reaches the theatre defaults.
overlay.begin('X', { assetBase: 'maps/mods/xpack1', background: 'x/load.webp',
  backgroundFallbacks: () => { throw new Error('offline'); } });
await fail();
results.overlayThrowingFallback = img.src;

console.log(JSON.stringify(results));
