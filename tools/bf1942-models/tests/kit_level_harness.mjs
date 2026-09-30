// Drives the level half of the kit data outside a browser and prints one JSON
// blob: `viewer/kit-loadout.js`'s `levelLoadouts` (the file as one level sees
// it), `kitOverridesAirMovement` (the nochute), the page's `loadout.loadouts`
// over a stubbed fetch, and `viewer/kit-panels.js`'s `variantNotes` (the kits
// page's line per level variant). `tests/test_kit_level_js.py` asserts on it.

import { createKitLoadout, kitOverridesAirMovement, levelLoadouts } from './kit-loadout.js';
import { variantNotes } from './kit-panels.js';

const results = {};

// DC Final's shape, cut down: First Light's US_AT3 carries a Landmine, Lost
// Village nopara's Us_Assault a nochute; the mod's own rows have neither.
const file = {
  mod: 'DC_Final',
  kits: {
    US_AT3: { class: 'Anti-tank', items: ['SMAW', 'KnifeAllies'], primary: 'SMAW' },
    Us_Assault: { class: 'Assault', items: ['M16A2'], primary: 'M16A2' },
  },
  levels: {
    dc_first_light: { 2: { soldier: 'USSoldier', slots: { 2: 'US_AT3' } } },
    dc_lostvillage_nopara: { 2: { soldier: 'USSoldier', slots: { 1: 'Us_Assault' } } },
    dc_lostvillage: { 2: { soldier: 'USSoldier', slots: { 1: 'Us_Assault' } } },
  },
  levelKits: {
    dc_first_light: {
      US_AT3: { class: 'Anti-tank', items: ['SMAW', 'KnifeAllies', 'Landmine'], primary: 'SMAW' },
    },
    dc_lostvillage_nopara: {
      Us_Assault: { class: 'Assault', items: ['M16A2'], primary: 'M16A2',
        overrideAirMovementInhibitations: true },
    },
  },
};

const cache = new Map();
const firstLight = levelLoadouts(file, 'dc_first_light', cache);
results.view = {
  firstLightItems: firstLight.kits.US_AT3.items,
  firstLightKeepsOthers: firstLight.kits.Us_Assault.items,
  // The same object for the same level: a reader that memoizes on it holds.
  stable: levelLoadouts(file, 'dc_first_light', cache) === firstLight,
  // A level with no rows of its own, and no level at all, get the file.
  plainIsFile: levelLoadouts(file, 'dc_lostvillage', cache) === file,
  noDirIsFile: levelLoadouts(file, null, cache) === file,
  // A file written before `levelKits` existed is read as it always was.
  oldFile: levelLoadouts({ kits: file.kits }, 'dc_first_light', cache).kits.US_AT3.items,
  nullFile: levelLoadouts(null, 'dc_first_light', cache),
  // The file itself is never written to.
  fileUntouched: file.kits.US_AT3.items.length,
};

results.nochute = {
  nopara: kitOverridesAirMovement(levelLoadouts(file, 'dc_lostvillage_nopara', cache), 'Us_Assault'),
  plain: kitOverridesAirMovement(levelLoadouts(file, 'dc_lostvillage', cache), 'Us_Assault'),
  noKit: kitOverridesAirMovement(file, null),
  noFile: kitOverridesAirMovement(null, 'Us_Assault'),
};

// The page's own path: `loadout.loadouts` follows `currentDir`.
globalThis.fetch = async url => ({
  ok: String(url).includes('loadouts.json'),
  json: async () => file,
});
const page = {
  currentDir: 'dc_first_light',
  deployKit: 'antitank', deployTeamId: 2,
  KITS: ['scout', 'assault', 'antitank', 'medic', 'engineer'],
  MAPS_BASE: 'maps', bust: () => '', params: new URLSearchParams(),
  teamNation: () => 'us', spawnLayout: { data: null },
};
const loadout = createKitLoadout(page);
await loadout.loadoutsLoad;
const onFirstLight = loadout.kitLoadout(2, 'antitank');
const firstLightRow = loadout.loadouts.kits[onFirstLight.kit];
page.currentDir = 'dc_lostvillage_nopara';
page.deployKit = 'assault';
const noparaKit = loadout.currentKit(2);
const noparaNoChute = kitOverridesAirMovement(loadout.loadouts, loadout.kitLoadout(2, 'assault').kit);
page.currentDir = 'dc_lostvillage';
const plainNoChute = kitOverridesAirMovement(loadout.loadouts, loadout.kitLoadout(2, 'assault').kit);
results.page = {
  firstLightKit: onFirstLight.kit,
  firstLightItems: firstLightRow.items,
  noparaKit,
  noparaNoChute,
  plainNoChute,
};

results.notes = {
  firstLight: variantNotes({
    template: 'US_AT3',
    items: [{ template: 'SMAW' }, { template: 'KnifeAllies' }],
    levelVariants: [{ levels: ['DC_First_Light'],
      items: [{ template: 'SMAW' }, { template: 'KnifeAllies' }, { template: 'Landmine' }] }],
  }),
  nopara: variantNotes({
    template: 'US_Sniper',
    items: [{ template: 'M24' }],
    levelVariants: [{ levels: ['DC_LostVillage_nopara'],
      worn: [{ template: 'Us_Helmet' }, { template: 'US_Assault_BackPack' }],
      overrideAirMovementInhibitations: true }],
  }),
  none: variantNotes({ template: 'US_Medic', items: [] }),
};

console.log(JSON.stringify(results));
