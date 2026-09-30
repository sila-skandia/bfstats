// Drives `viewer/pose-bases.js` outside a browser and prints one JSON blob.
// `tests/test_pose_bases.py` copies the module in under its own name.

import { poseBases, poseUrls, rigUrls, weaponUrls, loadFirst, poseSources, forgetPoseIndexes } from './pose-bases.js';
import { byName } from './model-file.js';

const out = {};
out.bases = {
  mod: poseBases('models/mods/xpack1'),
  vanilla: poseBases('models'),
  unset: poseBases(undefined),
};
out.urls = poseUrls('models/mods/xpack2', 'GermanSoldier__K98.pose.glb', '?t=1');

// A split pose is three documents and a mod can supply any one of them, so
// each half is asked for separately (`pose-bases.js`).
out.rigUrls = rigUrls('models/mods/xpack1', 'USSoldier');
out.weaponUrls = weaponUrls('models/mods/xpack1', 'K98');
out.recipeUrls = poseUrls('models/mods/xpack1', 'USSoldier__K98.pose.json');
out.rigUrlsVanilla = rigUrls('models', 'USSoldier');

// A loader that has only what `have` lists, recording what it was asked for.
function fakeLoader(have) {
  const asked = [];
  return {
    asked,
    loadAsync: async url => {
      asked.push(url);
      if (!have.includes(url)) throw new Error(`404 ${url}`);
      return { url };
    },
  };
}
{
  const l = fakeLoader(['models/poses/USSoldier__Thompson.pose.glb']);
  const got = await loadFirst(l, poseUrls('models/mods/xpack1', 'USSoldier__Thompson.pose.glb'));
  out.fallsBack = { got: got.url, asked: l.asked };
}
{
  const l = fakeLoader(['models/mods/xpack1/poses/ItalianSoldier__Breda.pose.glb',
                        'models/poses/ItalianSoldier__Breda.pose.glb']);
  const got = await loadFirst(l, poseUrls('models/mods/xpack1', 'ItalianSoldier__Breda.pose.glb'));
  out.modFirst = { got: got.url, asked: l.asked };
}
{
  const l = fakeLoader([]);
  try {
    await loadFirst(l, poseUrls('models/mods/xpack1', 'Nobody__Nothing.pose.glb'));
    out.none = 'resolved';
  } catch (error) {
    out.none = { rejected: String(error.message), asked: l.asked.length };
  }
}
// A manifest looked up by a template name, whatever its case (ledger LOAD-7).
{
  const grips = { MP40: 'gaits/MP40.gait.glb', Mp40: 'gaits/exact.gait.glb', No2: 'gaits/No2.gait.glb' };
  out.byName = {
    exact: byName(grips, 'Mp40'),
    otherCase: byName(grips, 'mp40'),
    upper: byName(grips, 'NO2'),
    missing: byName(grips, 'Sten') ?? null,
    noTable: byName(null, 'No2') ?? null,
  };
}
// Where a pair is looked for when neither tree publishes an index: each tree's
// recipe then its glb, the mod tree's first, under the asked spelling.
{
  forgetPoseIndexes();
  const asked = [];
  globalThis.fetch = async url => { asked.push(url); return { ok: false, status: 404 }; };
  out.noIndex = {
    sources: await poseSources('models/mods/fhsw', 'GermanSoldier', 'K98'),
    asked,
  };
  // A 404 is remembered: a second pair asks for no index again.
  await poseSources('models/mods/fhsw', 'GermanSoldier', 'Mp40');
  out.noIndex.askedAfterSecond = asked.length;
  // Any other failure is not: the next pair asks again.
  forgetPoseIndexes();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network'); };
  await poseSources('models', 'USSoldier', 'Colt');
  await poseSources('models', 'USSoldier', 'Colt');
  out.noIndex.retriedAfterError = calls;
}
console.log(JSON.stringify(out));
