// `viewer/level-skin.js` under node (see `test_viewmodel_level_skin.py`): the
// level's paint over an arms rig, on scenes built by hand. The module is the
// file the page loads; it needs no three.js, only objects that traverse.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { createLevelSkin, skinTextures, wearSkin } = await import(
  pathToFileURL(path.join(viewer, 'level-skin.js')).href);

const texture = name => ({ name });
const scene = materials => {
  const meshes = materials.map(material => ({ material }));
  return { meshes, traverse: fn => meshes.forEach(fn) };
};
const maps = s => s.meshes.flatMap(m => [m.material].flat().map(x => x.map?.name ?? null));

const row = {
  file: 'skins/battle_of_foy.skin.glb',
  textures: {
    'texture/Ste_hand2.dds': 'texture/ENVIROMENT_WINTER/Ste_hand2.dds',
    'texture/Ame1_sleeve_T.dds': 'texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds',
    'texture/landmine_T.dds': 'texture/ENVIROMENT_WINTER/landmine_T.dds',
  },
};
// The skin glb as GLTFLoader hands it over: textures named for the level's
// files. The landmine's is missing, as when it failed to decode.
const skinScene = () => scene([
  { map: texture('texture/ENVIROMENT_WINTER/Ste_hand2.dds') },
  { map: texture('texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds') },
]);
const rig = () => scene([
  { map: texture('texture/Ame1_sleeve_T.dds') },
  // Both hands share one material list entry each; one mesh has two.
  [{ map: texture('Texture\\STE_HAND2.dds') }, { map: texture('texture/M1Garand.dds') }],
  { map: texture('texture/landmine_T.dds') },
  { map: null },
]);

const results = {};
{
  const skin = skinTextures(row, skinScene());
  const worn = rig();
  results.pure = { keys: [...skin.keys()].sort(), changed: wearSkin(worn, skin), maps: maps(worn) };
  results.pure.again = wearSkin(worn, skin);
  const bare = rig();
  results.noSkin = { changed: wearSkin(bare, new Map()), maps: maps(bare) };
}

// The fetch and the loader, stubbed: one skins.json a tree, one glb a level.
const run = async ({ index, failGlb = false }) => {
  const asked = [];
  globalThis.fetch = async url => {
    asked.push(url);
    return index === undefined ? { ok: false } : { ok: true, json: async () => index };
  };
  const loader = {
    loadAsync: async url => {
      asked.push(url);
      if (failGlb) throw new Error('404');
      return { scene: skinScene() };
    },
  };
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  const skins = createLevelSkin({ loader: () => loader, modelsBase: () => 'models/mods/fhsw', bust: () => '?v=1' });
  const first = rig();
  const second = rig();
  const other = rig();
  const out = {
    first: await skins.wear(first, 'Battle_Of_Foy'),
    second: await skins.wear(second, 'battle_of_foy'),
    other: await skins.wear(other, 'omaha'),
    none: await skins.wear(rig(), ''),
    maps: maps(first),
    asked,
    warned,
  };
  console.warn = warn;
  return out;
};
results.page = await run({ index: { levels: { battle_of_foy: row } } });
results.noIndex = await run({ index: undefined });
results.brokenGlb = await run({ index: { levels: { battle_of_foy: row } }, failGlb: true });

process.stdout.write(JSON.stringify(results));
