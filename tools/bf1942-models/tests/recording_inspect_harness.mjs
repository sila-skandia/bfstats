// `viewer/recording-inspect.js` under node: what the REPLAY feed's share
// dialog sends up for a recording (see `test_recording_inspect.py`). The
// modules are imported from the viewer tree in place through `sim/env.mjs`'s
// hooks; `fetch` serves a small mods.json, three maps.json and their
// scene.json files, so the level search reads what a page would.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);

const mod = (id, maps) => ({ id, name: id, paths: { maps }, counts: { maps: 1 } });
const MODS = [mod('bf1942', 'maps'), mod('xpack1', 'maps/mods/xpack1'), mod('xpack2', 'maps/mods/xpack2')];

// Each level's flags as scene.json writes them: BF1942's z negated.
const flag = (name, x, z) => ({ name, position: [x, 60, -z] });
const level = (name, flags) => ({ row: { name, glb: `${name.toLowerCase()}/scene.glb`, worldSize: 1024 }, scene: { controlPoints: flags } });
const TOBRUK = level('Tobruk', [flag('AxisBase', 100, 100), flag('AlliesBase', 900, 900), flag('Town', 500, 500)]);
const HELLENDOORN = level('Hellendoorn', [
  flag('AxisBase', 291.22, 476.72), flag('AlliesBase', 697.53, 771.90), flag('Hellendoorn', 493.35, 651.62),
]);
// The packs carry their own copy of vanilla's levels; Hellendoorn is
// Secret Weapons' alone.
const TREES = {
  maps: [TOBRUK],
  'maps/mods/xpack1': [TOBRUK],
  'maps/mods/xpack2': [TOBRUK, HELLENDOORN],
};

const files = new Map([['models/mods.json', { mods: MODS }]]);
for (const [base, levels] of Object.entries(TREES)) {
  files.set(`${base}/maps.json`, levels.map(l => l.row));
  for (const l of levels) files.set(`${base}/${l.row.glb.replace(/\.glb$/, '.json')}`, l.scene);
}
const root = pathToFileURL(viewer + path.sep).href;
globalThis.fetch = async url => {
  const rel = String(url).replace(root, '').replace(/\?.*$/, '');
  const body = files.get(rel);
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
};

const { describeRecording } = await import(pathToFileURL(path.join(viewer, 'recording-inspect.js')).href);

/** A recording begun with no join events: a header and its flags. */
const recording = flags => [
  '{"k":"h","v":5,"plus":"2.0","start":"2026-11-07T17:21:28","hz":10}',
  ...flags.map(([tmpl, x, z], i) =>
    JSON.stringify({ k: 'cp', t: 0, id: 800 + i, name: tmpl.toUpperCase(), tmpl, pos: [x, 60, z], team: 0 })),
  '{"k":"s","t":1.0,"o":[]}',
].join('\n');

const sent = async text => {
  const { meta } = await describeRecording(text);
  return { level: meta.level, mod: meta.mod };
};

const results = {
  // gb8ft8napv: a Secret Weapons round, no setLevel, no serverInfo.
  packOnly: await sent(recording([['AxisBase', 291.22, 476.72], ['AlliesBase', 697.53, 771.90], ['Hellendoorn', 493.35, 651.62]])),
  // A vanilla level found from vanilla stays vanilla's.
  vanilla: await sent(recording([['AxisBase', 100, 100], ['AlliesBase', 900, 900], ['Town', 500, 500]])),
};

process.stdout.write(JSON.stringify(results));
