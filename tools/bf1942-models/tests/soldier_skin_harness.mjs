// `viewer/soldier-skin.js` under node (see `test_soldier_skin.py`): the
// soldier's paint over a shared weapon rig, on scenes built by hand. The
// module is the file the page loads; it needs no three.js, only objects that
// traverse — and `level-skin.js` beside it, to prove the level's own paint
// still lands on a soldier-painted rig.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { forgetSoldierSkins, paintSoldierRig, soldierSkinTextures } = await import(
  pathToFileURL(path.join(viewer, 'soldier-skin.js')).href);
const { skinTextures, wearSkin } = await import(
  pathToFileURL(path.join(viewer, 'level-skin.js')).href);

const texture = name => ({ name });
const scene = materials => {
  const meshes = materials.map(material => ({ material }));
  return { meshes, traverse: fn => meshes.forEach(fn) };
};
const maps = s => s.meshes.flatMap(m => [m.material].flat().map(x => x.map?.name ?? null));

// The canonical rig: German sleeves, shared hand, the weapon's own texture.
const rig = () => scene([
  { map: texture('texture/Ger1_sleeve_T.dds') },
  [{ map: texture('Texture\\STE_HAND2.dds') }, { map: texture('texture/345RCL.dds') }],
  { map: null },
]);
// The US soldier's skin glb as GLTFLoader hands it over: one material a
// texture, material and texture both named for the file.
const skinScene = () => scene([
  { name: 'texture/Ame1_sleeve_T.dds', map: texture('texture/Ame1_sleeve_T.dds') },
]);
// The index row's entry (`pose-bases.js` rigIndexOf).
const entry = () => ({
  stem: 'GermanSoldier__345RCL', base: 'models/mods/fhsw',
  pair: 'USSoldier__345RCL',
  textures: { 'texture/Ger1_sleeve_T.dds': 'texture/Ame1_sleeve_T.dds' },
  skin: 'soldiers/USSoldier.skin.glb',
});

const fakeLoader = (have, asked) => ({
  loadAsync: async url => {
    asked.push(url);
    if (!have) throw new Error('404');
    return { scene: skinScene() };
  },
});

const results = {};
{
  // soldierSkinTextures keys by the material's name and the texture's.
  const byFile = soldierSkinTextures(skinScene());
  results.keys = [...byFile.keys()].sort();
}
{
  forgetSoldierSkins();
  const asked = [];
  const loader = fakeLoader(true, asked);
  const worn = rig();
  const changed = await paintSoldierRig(worn, entry(), { loader, bust: '?v=1' });
  // The same soldier again: the skin glb is fetched once per tree.
  const again = await paintSoldierRig(rig(), entry(), { loader });
  results.paint = { changed, again, asked, maps: maps(worn) };

  // The level's own paint still lands after the soldier's: its row keys off
  // the SOLDIER's image (the texture keeps its own name), as the engine
  // resolves the texture the shader asked for.
  const levelRow = { textures: {
    'texture/Ame1_sleeve_T.dds': 'texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds',
  } };
  const levelScene = scene([
    { name: 'texture/Ame1_sleeve_T.dds',
      map: texture('texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds') },
  ]);
  const onLevel = wearSkin(worn, skinTextures(levelRow, levelScene));
  const winter = maps(worn);
  // ... and off again: the soldier's texture comes back, not the canonical's.
  const back = wearSkin(worn, new Map());
  results.level = { onLevel, winter, back, maps: maps(worn) };
}
{
  // A row naming a texture the skin lacks warns and keeps the canonical paint.
  forgetSoldierSkins();
  let warned = 0;
  const warn = console.warn;
  console.warn = () => { warned += 1; };
  const missing = { ...entry(), textures: { 'texture/Ger1_sleeve_T.dds': 'texture/NotInSkin.dds' } };
  const worn = rig();
  const changed = await paintSoldierRig(worn, missing, { loader: fakeLoader(true, []) });
  // A skin glb that fails to load warns once and paints nothing.
  forgetSoldierSkins();
  const broken = await paintSoldierRig(rig(), entry(), { loader: fakeLoader(false, []) });
  console.warn = warn;
  results.nicety = { changed, broken, warned, maps: maps(worn) };
}
{
  // No textures, no skin, no scene: a quiet no-op.
  forgetSoldierSkins();
  results.noop = {
    bare: await paintSoldierRig(rig(), { stem: 'A__Gun', base: 'models' },
                                { loader: fakeLoader(true, []) }),
    noScene: await paintSoldierRig(null, entry(), { loader: fakeLoader(true, []) }),
    noLoader: await paintSoldierRig(rig(), entry(), {}),
  };
}
console.log(JSON.stringify(results));
