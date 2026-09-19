// Drives `viewer/hud-pack.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_hud_pack_js.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing; the only global
// it can reach for is `fetch`, and every case below passes its own `fetcher`
// so nothing here touches the network.

import { hudPaths, loadHudPaths, modHudBase,
         VANILLA_HUD_DIR, VANILLA_CONSOLE_FONT } from './hud-pack.js';

const results = {};

results.constants = { hud: VANILLA_HUD_DIR, console: VANILLA_CONSOLE_FONT };

results.bases = {
  vanilla: modHudBase('bf1942'),
  empty: modHudBase(''),
  missing: modHudBase(undefined),
  eod: modHudBase('eod'),
  eodFromPlay: modHudBase('eod', '../'),
};

// Vanilla: no manifest, no mod directory, every path the one it always was.
const vanilla = hudPaths('bf1942', null);
results.vanilla = {
  mod: vanilla.mod,
  modBase: vanilla.modBase,
  ownCount: vanilla.ownCount,
  hudJson: vanilla.url('hud.json'),
  sprite: vanilla.url('conp_us.png'),
  font: vanilla.url('fonts/trebuchet_ms14.png'),
  menu: vanilla.menuUrl('menu-layout.json'),
  consoleFont: vanilla.consoleFont(),
  owns: vanilla.owns('hud.json'),
};

// Road to Rome: overrides no sprite, adds eight nation files and a manifest.
const xpack1 = hudPaths('xpack1', {
  mod: 'xpack1',
  files: ['hud.json', 'conp_fre.png', 'conp_it.png', 'minimap-icons.json',
          'menu/menu-levels.json', 'menu/textures/background.png'],
});
results.xpack1 = {
  ownCount: xpack1.ownCount,
  // Listed -> the mod's own directory.
  hudJson: xpack1.url('hud.json'),
  ownSprite: xpack1.url('conp_fre.png'),
  ownMenuFile: xpack1.menuUrl('menu-levels.json'),
  ownMenuTexture: xpack1.menuUrl('textures/background.png'),
  // Not listed -> vanilla's, including a layout the mod did not restyle and
  // the fonts beside a manifest it did override.
  inheritedSprite: xpack1.url('conp_us.png'),
  inheritedLayout: xpack1.url('spawn-layout.json'),
  inheritedHudLayout: xpack1.url('hud-layout.json'),
  inheritedFont: xpack1.url('fonts/trebuchet_ms14.png'),
  inheritedMenuLayout: xpack1.menuUrl('menu-layout.json'),
  // No Font.rfa of its own, so no console face in the pack.
  consoleFont: xpack1.consoleFont(),
  ownsOverridden: xpack1.owns('conp_fre.png'),
  ownsInherited: xpack1.owns('conp_us.png'),
};

// A mod that does ship its own console face.
const withConsole = hudPaths('fhsw', {
  files: ['console/bf1942.json', 'console/bf1942.png'],
});
results.withConsole = {
  consoleFont: withConsole.consoleFont(),
  png: withConsole.url('console/bf1942.png'),
};

// Leading `./` and `/` in a manifest entry or a lookup must not change the
// answer: `hud.json`'s own `file` values have no prefix, but a caller
// concatenating paths easily produces one.
const sloppy = hudPaths('eod', { files: ['./conp_us.png', 'fonts/standard6.png'] });
results.sloppy = {
  listedWithDot: sloppy.url('conp_us.png'),
  lookupWithDot: sloppy.url('./conp_us.png'),
  lookupWithSlash: sloppy.url('/conp_us.png'),
  font: sloppy.url('fonts/standard6.png'),
};

// Malformed or missing manifests all mean "nothing of its own".
results.degenerate = {
  nullManifest: hudPaths('eod', null).url('hud.json'),
  noFiles: hudPaths('eod', {}).url('hud.json'),
  filesNotAnArray: hudPaths('eod', { files: 'hud.json' }).url('hud.json'),
  emptyFiles: hudPaths('eod', { files: [] }).ownCount,
};

// A page one directory down.
const fromPlay = hudPaths('eod', { files: ['menu/menu-levels.json'] },
                          { root: '../' });
results.root = {
  own: fromPlay.menuUrl('menu-levels.json'),
  inherited: fromPlay.menuUrl('menu-layout.json'),
  consoleFont: fromPlay.consoleFont(),
};

// --- loadHudPaths ------------------------------------------------------------

const fetched = [];
const fetcher = async (url) => {
  fetched.push(url);
  if (url.startsWith('maps/mods/eod/')) {
    return { ok: true, json: async () => ({ files: ['conp_us.png'] }) };
  }
  if (url.startsWith('maps/mods/gone/')) return { ok: false, status: 404 };
  if (url.startsWith('maps/mods/broken/')) {
    return { ok: true, json: async () => { throw new Error('not json'); } };
  }
  throw new Error(`unexpected fetch ${url}`);
};

const loadedVanilla = await loadHudPaths('bf1942', { fetcher });
const fetchedAfterVanilla = fetched.length;
const loadedEod = await loadHudPaths('eod', { fetcher });
const loaded404 = await loadHudPaths('gone', { fetcher });
const loadedBroken = await loadHudPaths('broken', { fetcher });
const loadedBust = await loadHudPaths('eod', { fetcher, bust: () => '?t=1' });

results.load = {
  // Vanilla must not fetch anything at all.
  vanillaFetches: fetchedAfterVanilla,
  vanillaSprite: loadedVanilla.url('conp_us.png'),
  eodSprite: loadedEod.url('conp_us.png'),
  eodInherited: loadedEod.url('conp_can.png'),
  // A pack that 404s, or is not JSON, resolves everything to vanilla's.
  missingPack: loaded404.url('conp_us.png'),
  brokenPack: loadedBroken.url('conp_us.png'),
  urls: fetched,
  bustedSprite: loadedBust.url('conp_us.png'),
};

console.log(JSON.stringify(results, null, 1));
