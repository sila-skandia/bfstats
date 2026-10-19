// `audit_replay_assets.mjs`'s pure half under node: the path classifier that
// names each 404's owning extractor, and the recording-argument parser. No
// network, no browser: main() is gated on being invoked as a script, so the
// import is side-effect free.
//
// Same pattern as `replay_harness.mjs` -- one node run, one JSON report.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const { classifyAssetPath, parseRecordingArg, routeFinding } =
  await import(pathToFileURL(path.join(here, '..', 'audit_replay_assets.mjs')).href);

const results = {};

// Every shape the viewer tree serves, each to its owning extractor.
results.classified = Object.fromEntries([
  'models/mods/fhsweurope/Tiger.glb',
  'models/mods/fhsweurope/Tiger.cockpit.glb',
  'models/mods/fhsweurope/Tiger.wreck.glb',
  'models/mods/fhsweurope/Tiger.Rush_To_Baghdad.glb',
  'models/mods/fhsweurope/poses/GermanSoldier__MP40.pose.glb',
  'models/mods/fhsweurope/viewmodels/mp40/rig.glb',
  'models/mods/fhsweurope/sounds/tiger-engine.mp3',
  'models/mods/fhsweurope/thumbs/Tiger.webp',
  'models/Sherman.glb',
  'maps/mods/fhsweurope/rush_to_baghdad/scene.glb',
  'maps/mods/fhsweurope/rush_to_baghdad/terrain/0_0.webp',
  'maps/mods/fhsweurope/_shared/effects.glb',
  'maps/mods/fhsweurope/_shared/loadouts.json',
  'maps/mods/fhsweurope/_shared/voices/axis/attack.mp3',
  'maps/mods/fhsweurope/_shared/hud/kits.json',
  'maps/wake/scene.glb',
  'textures/ab/abcdef0123.webp',
  'glbs/ab/abcdef0123.glb',
  'stats/recordings/8uv24yb8hp/views',
  'favicon.ico',
  'replay-hulls.js',
].map(p => [p, classifyAssetPath(p)]));

// The severity routing: live-vs-local split, manifest-aware probes, the
// tree-fallback collapse's evidence, and the API rows.
const manifests = {
  listed: new Set(['tiger', 'flak30']),
  hasWreck: new Set(['tiger']),
  noCockpit: new Set(['flak30.cockpit.glb']),
};
results.routed = {
  gap: routeFinding({ path: 'models/mods/fhsweurope/RemoteStuka.glb', status: 404,
    trees: ['models/mods/fhsweurope/RemoteStuka.glb', 'models/RemoteStuka.glb'],
    present: false, ...manifests }),
  unpublished: routeFinding({ path: 'models/mods/fhsweurope/Tiger.glb', status: 404,
    trees: ['models/mods/fhsweurope/Tiger.glb'], present: true, ...manifests }),
  wreckByDesign: routeFinding({ path: 'models/mods/fhsweurope/Flak30.wreck.glb', status: 404,
    present: false, ...manifests }),
  wreckExported: routeFinding({ path: 'models/mods/fhsweurope/Tiger.wreck.glb', status: 404,
    present: false, ...manifests }),
  wreckOfUnlisted: routeFinding({ path: 'models/mods/fhsweurope/RemoteStuka.wreck.glb', status: 404,
    present: false, ...manifests }),
  cockpitByDesign: routeFinding({ path: 'models/mods/fhsweurope/Flak30.cockpit.glb', status: 404,
    present: false, ...manifests }),
  api: routeFinding({ path: 'stats/recordings/8uv24yb8hp/views', status: 401, ...manifests }),
  page: routeFinding({ path: 'favicon.ico', status: 404, ...manifests }),
};

// The three argument shapes a recording arrives as.
results.parsed = {
  slug: parseRecordingArg('8uv24yb8hp'),
  ndjson: parseRecordingArg('/stats/recordings/8uv24yb8hp.ndjson'),
  pageUrl: parseRecordingArg(
    'https://play.bfstats.io/map.html?mod=fhsweurope&map=rush_to_baghdad&replay=%2Fstats%2Frecordings%2F8uv24yb8hp.ndjson'),
  plainUrl: parseRecordingArg(
    'https://play.bfstats.io/map.html?mod=bf1942&map=berlin&replay=/stats/recordings/4xhtpkm8bv.ndjson'),
  junk: parseRecordingArg('not a recording !'),
};

console.log(JSON.stringify(results));
