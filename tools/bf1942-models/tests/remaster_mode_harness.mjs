// `viewer/remaster-mode.js` under node: whether a page runs the remaster's
// renderer, and how OPTIONS > VIDEO's REMASTER row is kept (see
// `test_remaster_mode.py`). The module is imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, so the file under test is the file
// the page loads. It also reads `map.html`'s first script, which makes the
// same choice inline before any module can load, and runs it.

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

// map.html's inline copy: the first script's body run against a fake page,
// answering whether it inserted the remaster's import map.
const html = fs.readFileSync(path.join(viewer, 'map.html'), 'utf8');
const at = html.indexOf("// The three build is picked here");
const inline = html.slice(at, html.indexOf('</script>', at));
function inlineChoice(search, stored, webgpu = true) {
  let inserted = null;
  const sandbox = {
    navigator: webgpu ? { gpu: {} } : {},
    location: { search },
    localStorage: stored === 'blocked' ? blocked : memoryStorage(stored),
    document: {
      createElement: () => ({}),
      currentScript: { after: el => { inserted = JSON.parse(el.textContent).imports.three; } },
    },
  };
  new Function(...Object.keys(sandbox), inline)(...Object.values(sandbox));
  return inserted;
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
};

console.log(JSON.stringify(results));
