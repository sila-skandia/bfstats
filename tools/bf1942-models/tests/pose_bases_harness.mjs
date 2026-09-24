// Drives `viewer/pose-bases.js` outside a browser and prints one JSON blob.
// `tests/test_pose_bases.py` copies the module in under its own name.

import { poseBases, poseUrls, loadFirst } from './pose-bases.js';

const out = {};
out.bases = {
  mod: poseBases('models/mods/xpack1'),
  vanilla: poseBases('models'),
  unset: poseBases(undefined),
};
out.urls = poseUrls('models/mods/xpack2', 'GermanSoldier__K98.pose.glb', '?t=1');

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
console.log(JSON.stringify(out));
