// Drives `viewer/glb-store.js` outside a browser and prints one JSON blob.
// `tests/test_glb_store_resolve.py` copies the module in under its own name.

import { parseGlbUrl, resolveGlb, forgetGlbTables } from './glb-store.js';

const out = {};

// --- the manifests a treated and an untreated tree serve --------------------

const docs = {
  'models/mods/fhsw/models.json': [
    { name: 'Tiger', glb: 'Tiger.glb', sha: 'S1',
      cockpit: 'Tiger.cockpit.glb', cockpitSha: 'S2',
      variants: [{ glb: 'Tiger.wreck.glb', sha: 'S3' }] },
    { name: 'Old', glb: 'Old.glb' },
  ],
  'models/mods/fhsw/viewmodels/index.json': {
    format: 'bf1942-rig-index/1', rigs: ['A__Gun'], sha: { 'A__Gun.fp.glb': 'S4' },
  },
  'models/mods/fhsw/poses/index.json': {
    format: 'bf1942-pose-index/1', recipe: [], glb: ['A__Gun'],
    sha: { 'A__Gun.pose.glb': 'S5', 'gaits/Gun.gait.glb': 'S6', 'rigs/ASoldier.rig.glb': 'S7' },
  },
  // Vanilla's rig index is still the bare array the extractor writes.
  'models/viewmodels/index.json': ['A__Gun'],
  '../models/mods/fhsw/models.json': [{ name: 'Tiger', glb: 'Tiger.glb', sha: 'S1' }],
  'http://host/viewer/models/mods/fhsw/models.json': [{ name: 'Tiger', glb: 'Tiger.glb', sha: 'S1' }],
};

const asked = [];
let errOnce = true;
globalThis.fetch = async url => {
  const path = String(url).split('?')[0];
  asked.push(path);
  if (path === 'models/mods/err/models.json' && errOnce) {
    errOnce = false;
    throw new Error('network down');
  }
  if (path in docs || path === 'models/mods/err/models.json') {
    return { ok: true, status: 200, json: async () => docs[path] ?? [] };
  }
  return { ok: false, status: 404, json: async () => null };
};

const countAsked = path => asked.filter(p => p === path).length;

// --- parsing ----------------------------------------------------------------

out.parse = {
  vanilla: parseGlbUrl('models/Tiger.glb?t=1'),
  mod: parseGlbUrl('models/mods/fhsw/poses/gaits/Gun.gait.glb'),
  absolute: parseGlbUrl('http://host/viewer/models/mods/fhsw/Tiger.glb'),
  maps: parseGlbUrl('maps/bocage/scene.glb'),
  manifest: parseGlbUrl('models/mods/fhsw/models.json'),
  bare: parseGlbUrl('glbs/S1.glb'),
};

// --- model names ------------------------------------------------------------

out.model = await resolveGlb('models/mods/fhsw/Tiger.glb?t=1');
out.cockpit = await resolveGlb('models/mods/fhsw/Tiger.cockpit.glb');
out.wreck = await resolveGlb('models/mods/fhsw/Tiger.wreck.glb');
out.noSha = await resolveGlb('models/mods/fhsw/Old.glb');
out.caseMiss = await resolveGlb('models/mods/fhsw/tiger.glb');
out.modelsJsonFetches = countAsked('models/mods/fhsw/models.json');

// An untreated tree: 404 is remembered, the old path serves.
out.untreated = await resolveGlb('models/Tiger.glb');
await resolveGlb('models/Sherman.glb');
out.untreatedFetches = countAsked('models/models.json');

// --- rigs and poses ---------------------------------------------------------

out.rig = await resolveGlb('models/mods/fhsw/viewmodels/A__Gun.fp.glb?v=9');
out.rigOldIndex = await resolveGlb('models/viewmodels/A__Gun.fp.glb');
out.skin = await resolveGlb('models/viewmodels/skins/lvl.skin.glb');
out.pose = await resolveGlb('models/mods/fhsw/poses/A__Gun.pose.glb');
out.gait = await resolveGlb('models/mods/fhsw/poses/gaits/Gun.gait.glb');
out.poseRig = await resolveGlb('models/mods/fhsw/poses/rigs/ASoldier.rig.glb');

// --- URLs the store has no say over ----------------------------------------

const before = asked.length;
out.scene = await resolveGlb('maps/bocage/scene.glb');
out.noFetchForScene = asked.length === before;

// --- prefixes ---------------------------------------------------------------

out.relative = await resolveGlb('../models/mods/fhsw/Tiger.glb');
out.absolute = await resolveGlb('http://host/viewer/models/mods/fhsw/Tiger.glb?v=2');

// --- a failed fetch is retried, a second resolve refetches after forget -----

out.errFirst = await resolveGlb('models/mods/err/Tiger.glb');
out.errSecond = await resolveGlb('models/mods/err/Tiger.glb');
out.errFetches = countAsked('models/mods/err/models.json');

forgetGlbTables();
await resolveGlb('models/mods/fhsw/Tiger.glb');
out.refetchedAfterForget = countAsked('models/mods/fhsw/models.json');

console.log(JSON.stringify(out));
