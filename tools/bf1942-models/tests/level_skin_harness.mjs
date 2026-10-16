// `viewer/level-skin.js` under node (see `test_viewmodel_level_skin.py`): the
// level's paint over an arms rig, on scenes built by hand. The module is the
// file the page loads; it needs no three.js, only objects that traverse.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const {
  createLevelSkin, forgetLevelSkins, repaintPage, sharePagePaint, skinTextures, wearPagePaint,
  wearSkin,
} = await import(
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
  forgetLevelSkins();
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


// One file standing in for several images, as the texture store leaves a
// skin: GLTFLoader hands every material at one address the same texture, named
// for the first image. The material's name says which image each replaces.
{
  let copies = 0;
  const glove = { name: 'texture/ENVIROMENT_WINTER/Hand01_r.dds' };
  glove.clone = () => { copies += 1; return { name: glove.name, copy: copies }; };
  const gloves = {
    file: 'skins/battle_of_foy.skin.glb',
    textures: {
      'texture/Hand01_r.dds': 'texture/ENVIROMENT_WINTER/Hand01_r.dds',
      'texture/Hand03_r.dds': 'texture/ENVIROMENT_WINTER/Hand03_r.dds',
    },
  };
  const skin = skinTextures(gloves, scene([
    { name: 'texture/Hand01_r.dds', map: glove },
    { name: 'texture/Hand03_r.dds', map: glove },
  ]));
  const body = scene([
    { map: texture('texture/Hand01_r.dds') },
    { map: texture('texture/Hand03_r.dds') },
  ]);
  const changed = wearSkin(body, skin);
  // The next level repaints nothing: each hand is handed its own back.
  const back = wearSkin(body, new Map());
  results.sharedFile = { keys: [...skin.keys()].sort(), copies, changed, back, maps: maps(body) };
}

// A model outlives a level. A body composed on Foy is shaded (its materials
// rebuilt around the maps they hold then) and kept for the page; the level
// changes in place and the same materials are painted again.
{
  const foy = skinTextures(row, skinScene());
  const bulge = skinTextures({
    textures: { 'texture/Ame1_sleeve_T.dds': 'texture/Levels/bulge/Ame1_sleeve_T.dds' },
  }, scene([{ name: 'texture/Ame1_sleeve_T.dds', map: texture('texture/Levels/bulge/Ame1_sleeve_T.dds') }]));
  const cached = rig();
  wearSkin(cached, foy);
  // What the shading leaves: new materials holding the same textures.
  const shaded = scene(cached.meshes.flatMap(m => [m.material].flat()).map(m => ({ map: m.map })));
  const onBulge = wearSkin(shaded, bulge);
  const bulgeMaps = maps(shaded);
  const onOmaha = wearSkin(shaded, new Map());
  const omahaMaps = maps(shaded);
  const onFoy = wearSkin(shaded, foy);
  results.relevel = { onBulge, bulgeMaps, onOmaha, omahaMaps, onFoy, foyMaps: maps(shaded) };
}

// The page's paint: nothing shared (a model browser), one shared, one that
// throws.
{
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  sharePagePaint(null);
  const none = await wearPagePaint(rig());
  const skin = skinTextures(row, skinScene());
  const seen = [];
  sharePagePaint(async s => { seen.push(s); return wearSkin(s, skin); });
  const body = rig();
  const shared = await wearPagePaint(body);
  const nothing = await wearPagePaint(null);
  sharePagePaint(() => { throw new Error('no level'); });
  const thrown = await wearPagePaint(rig());
  sharePagePaint(null);
  console.warn = warn;
  results.pagePaint = { none, shared, nothing, thrown, warned, asked: seen.length, maps: maps(body) };
}

// Two askers on one tree (the page's arms and a replay's) share its index and
// its skins.
{
  forgetLevelSkins();
  const asked = [];
  globalThis.fetch = async url => {
    asked.push(url);
    return { ok: true, json: async () => ({ levels: { battle_of_foy: row } }) };
  };
  const loader = { loadAsync: async url => { asked.push(url); return { scene: skinScene() }; } };
  const make = () => createLevelSkin({ loader: () => loader, modelsBase: () => 'models/mods/fhsw', bust: () => '' });
  const one = rig();
  const two = rig();
  await make().wear(one, 'battle_of_foy');
  await make().wear(two, 'battle_of_foy');
  const flat = s => s.meshes.flatMap(m => [m.material].flat());
  results.sharedTree = { asked, sameTexture: flat(one)[0].map === flat(two)[0].map };
}

// A level switch while the old level's skin is still in flight: the scene is
// asked for Foy, then for Omaha (which repaints nothing), and Foy's skin lands
// last. The last request wins.
{
  forgetLevelSkins();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ levels: { battle_of_foy: row } }) });
  const loader = { loadAsync: async () => { await held; return { scene: skinScene() }; } };
  const skins = createLevelSkin({ loader: () => loader, modelsBase: () => 'models/mods/fhsw', bust: () => '' });
  const body = rig();
  const onFoy = skins.wear(body, 'battle_of_foy');
  const onOmaha = await skins.wear(body, 'omaha');
  release();
  results.lastWins = { foy: await onFoy, omaha: onOmaha, maps: maps(body) };
}

// The page changes level in place: what it kept (a body, a canopy, a held
// round) is painted again as the level on screen does.
{
  forgetLevelSkins();
  let skin = skinTextures(row, skinScene());
  sharePagePaint(s => wearSkin(s, skin));
  const kept = [rig(), rig()];
  const before = await repaintPage([...kept, null]);
  skin = new Map();
  const after = await repaintPage(kept);
  sharePagePaint(null);
  results.repaint = { before, after, maps: maps(kept[1]), none: await repaintPage(undefined) };
}

process.stdout.write(JSON.stringify(results));
