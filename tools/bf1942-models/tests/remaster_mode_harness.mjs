// `viewer/remaster-mode.js` under node: whether a page runs the remaster's
// renderer, and how OPTIONS > VIDEO's REMASTER row is kept (see
// `test_remaster_mode.py`). The module is imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, so the file under test is the file
// the page loads. It also runs `map.html`'s first script and the schools'
// `webgl-fallback.js`, which make the same choice before any module can
// load.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { REMASTER, REMASTER_KEY, chooseRemaster, remasterSupported, storeRemaster, storedRemaster } = await import(pathToFileURL(path.join(viewer, 'remaster-mode.js')).href);

function memoryStorage(initial = null) {
  const map = new Map();
  if (initial !== null) map.set(REMASTER_KEY, initial);
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    raw: () => map.get(REMASTER_KEY) ?? null,
  };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
                  removeItem() { throw new Error('blocked'); } };

const results = { key: REMASTER_KEY, moduleDefault: REMASTER };
results.choose = {
  nothing: chooseRemaster({}),
  storedOn: chooseRemaster({ stored: true }),
  storedOff: chooseRemaster({ stored: false }),
  queryOn: chooseRemaster({ query: '' }),
  queryOne: chooseRemaster({ query: '1' }),
  queryOff: chooseRemaster({ query: '0' }),
  queryOffOverStored: chooseRemaster({ query: '0', stored: true }),
  queryOnOverStored: chooseRemaster({ query: '', stored: false }),
  unsupportedStoredOn: chooseRemaster({ stored: true, supported: false }),
  unsupportedQueryOn: chooseRemaster({ query: '', supported: false }),
  deadWebgl: chooseRemaster({ webglDead: true }),
  deadWebglOverQueryOff: chooseRemaster({ query: '0', stored: false, webglDead: true }),
  deadWebglUnsupported: chooseRemaster({ webglDead: true, supported: false }),
};
results.supported = {
  webgpu: remasterSupported({ gpu: {} }),
  none: remasterSupported({}),
  noNavigator: remasterSupported(null),
};

const kept = memoryStorage();
results.stored = { none: storedRemaster(kept) };
storeRemaster(true, kept);
results.stored.on = { value: storedRemaster(kept), raw: kept.raw() };
storeRemaster(false, kept);
results.stored.off = { value: storedRemaster(kept), raw: kept.raw() };
storeRemaster(null, kept);
results.stored.cleared = { value: storedRemaster(kept), raw: kept.raw() };
results.stored.junk = storedRemaster(memoryStorage('yes'));
storeRemaster(true, blocked);
results.stored.blocked = storedRemaster(blocked);
results.stored.noStorage = storedRemaster(null);

// The pages' inline copies: the first script's body run against a fake page,
// answering whether it inserted the remaster's import map, and whether it
// left `bfWebglDead` set for remaster-mode.js. `webgl` is what a canvas
// hands back: a live context, a lost one, or none.
function inlineOf(file, marker) {
  const html = fs.readFileSync(path.join(viewer, file), 'utf8');
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`${file}: no inline script at ${marker}`);
  return html.slice(at, html.indexOf('</script>', at));
}
const mapInline = inlineOf('map.html', "// The three build is picked here");
const schoolInline = fs.readFileSync(path.join(viewer, 'webgl-fallback.js'), 'utf8');
// The pages without a remaster load it ahead of their import map (copied into the page
// at image build time, `data-inline`).
results.schoolPages = Object.fromEntries(['dogfight.html', 'tanks.html', 'index.html', 'kits.html'].map(file => {
  const html = fs.readFileSync(path.join(viewer, file), 'utf8');
  const tag = html.indexOf('<script src="./webgl-fallback.js" data-inline></script>');
  return [file, tag >= 0 && tag < html.indexOf('<script type="importmap">')];
}));
function inlineChoice(search, stored, webgpu = true, webgl = 'live', inline = mapInline) {
  let inserted = null;
  const context = webgl === 'none' ? null : { isContextLost: () => webgl === 'lost', getExtension: () => ({ loseContext() {} }) };
  const global = {};
  const sandbox = {
    navigator: webgpu ? { gpu: {} } : {},
    location: { search },
    localStorage: stored === 'blocked' ? blocked : memoryStorage(stored),
    globalThis: global,
    document: {
      createElement: tag => (tag === 'canvas' ? { getContext: () => context } : {}),
      currentScript: { after: el => { inserted = JSON.parse(el.textContent).imports.three; } },
    },
  };
  new Function(...Object.keys(sandbox), inline)(...Object.values(sandbox));
  return webgl === 'live' ? inserted : { inserted, flag: global.bfWebglDead ?? null };
}
results.inline = {
  nothing: inlineChoice('', null),
  storedOn: inlineChoice('?map=wake', '1'),
  storedOff: inlineChoice('?map=wake', '0'),
  queryOn: inlineChoice('?map=wake&remaster', null),
  queryOffOverStored: inlineChoice('?remaster=0', '1'),
  blocked: inlineChoice('', 'blocked'),
  blockedQueryOn: inlineChoice('?remaster', 'blocked'),
  noWebgpuStoredOn: inlineChoice('', '1', false),
  noWebgpuQueryOn: inlineChoice('?remaster', null, false),
  lostWebgl: inlineChoice('', null, true, 'lost'),
  noWebgl: inlineChoice('', null, true, 'none'),
  lostWebglOverQueryOff: inlineChoice('?remaster=0', '0', true, 'lost'),
  lostWebglNoWebgpu: inlineChoice('', null, false, 'lost'),
};
results.school = {
  live: inlineChoice('?fight=x', null, true, 'live', schoolInline),
  lost: inlineChoice('?fight=x', null, true, 'lost', schoolInline),
  none: inlineChoice('?fight=x', null, true, 'none', schoolInline),
  lostNoWebgpu: inlineChoice('?fight=x', null, false, 'lost', schoolInline),
};

console.log(JSON.stringify(results));
