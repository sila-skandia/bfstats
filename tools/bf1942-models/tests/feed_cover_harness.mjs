// The REPLAY feed's cover resolver (`createLevelArt` in `viewer/play/
// recordings-feed.js`) against the real trees on disk, with `fetch` and
// `Image` standing in for the page's: a path is "served" when it is a file
// under `viewer/`. Prints JSON facts for `test_level_art.py`.
//
//   node feed_cover_harness.mjs            -> the facts
//
// A level's `arts` is what the card walks (`firstLoadable`): the first that is
// a file must be the level's own declared picture when the tree has it, and
// must still be a picture when it does not.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWER = join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
const ORIGIN = 'http://localhost';
const hidden = new Set();   // paths under viewer/ taken away for a scenario

const served = url => {
  const path = decodeURIComponent(new URL(String(url), ORIGIN).pathname).replace(/^\/+/, '');
  if (hidden.has(path)) return null;
  const file = join(VIEWER, path);
  return existsSync(file) && statSync(file).isFile() ? file : null;
};

globalThis.location = new URL(`${ORIGIN}/play/index.html`);
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, getElementById() { return null; }, head: { append() {} },
  createElement() { return { style: {}, classList: { add() {} }, append() {}, setAttribute() {} }; },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = async url => {
  const file = served(url);
  return file
    ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) }
    : { ok: false, status: 404, json: async () => null };
};
globalThis.Image = class {
  set src(url) {
    queueMicrotask(() => (served(url) ? this.onload?.() : this.onerror?.()));
  }
};

const { createLevelArt } = await import('../viewer/play/recordings-feed.js');
const { firstLoadable, forgetVerdicts } = await import('../viewer/level-art.js');

const mods = JSON.parse(readFileSync(join(VIEWER, 'models/mods.json'), 'utf8'));
const modList = async () => (Array.isArray(mods) ? mods : mods.mods);
const pathOf = url => decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');

const results = { levels: 0, noLoadable: [], notDeclared: [], untitled: [] };

for (const mod of ['bf1942', 'xpack1', 'xpack2']) {
  const tree = mod === 'bf1942' ? 'maps' : `maps/mods/${mod}`;
  const rows = JSON.parse(readFileSync(join(VIEWER, tree, 'maps.json'), 'utf8'));
  const artFor = createLevelArt('../', modList);
  for (const row of rows) {
    results.levels += 1;
    const level = await artFor(mod, row.name);
    const first = await firstLoadable(level.arts);
    if (!first) { results.noLoadable.push(`${mod}/${row.name}`); continue; }
    const declared = `${tree}/${row.loading?.background}`;
    if (pathOf(first) !== declared) results.notDeclared.push(`${mod}/${row.name}: ${pathOf(first)}`);
    if (!level.title) results.untitled.push(`${mod}/${row.name}`);
  }
}

// The reported state: the row names a picture the tree does not hold.
forgetVerdicts();
hidden.add('maps/mods/xpack2/raid_on_agheila/load.webp');
{
  const artFor = createLevelArt('../', modList);
  const level = await artFor('xpack2', 'Raid_on_Agheila');
  results.agheilaMissing = pathOf(await firstLoadable(level.arts));
}
// An inherited level whose own copy is gone shows vanilla's picture.
forgetVerdicts();
hidden.add('maps/mods/xpack1/truk/load.webp');
{
  const artFor = createLevelArt('../', modList);
  const level = await artFor('xpack1', 'Truk');
  results.inheritedMissing = pathOf(await firstLoadable(level.arts));
}
// A mod nobody serves (or a level nobody knows) still gets a picture.
forgetVerdicts();
{
  const artFor = createLevelArt('../', modList);
  const level = await artFor('some_mod_not_extracted', 'Mystery_Level');
  results.unknownMod = pathOf(await firstLoadable(level.arts));
  results.unknownTitle = level.title;
}

console.log(JSON.stringify(results));
