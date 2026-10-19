// End-to-end check of the cola-kit replay 404, without a browser: the REAL
// stashuv_area recording (9m9vhvfggv) through the REAL replay-recording.js,
// and the exact model URLs replay.js would fetch for its hull lives, GET
// against a staged local tree over HTTP (`serve_viewer.py`).
//
//   node tests/cola_fetch_check.mjs <recording.ndjson> <base url> <loadouts.json url>
//
// Reports, as one JSON line: the cola lives' flags before and after
// `markKits` with the loadouts kit table, which cola model URLs the hull
// path would request and each one's status, and the pickup-glb URL the
// kits.json row names with its status. Run twice — against the tree as
// published (old kits/loadouts) and against the scratch overlay — the first
// shows the 404s, the second shows them gone.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const [recPath, base, loadoutsUrl] = process.argv.slice(2);
const viewer = viewerDir();
installModuleHooks(viewer);
const recording = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

const rec = recording.parseRecording(await readFile(recPath, 'utf8'));
const loadouts = await fetch(loadoutsUrl).then(r => (r.ok ? r.json() : null));
const kitNames = new Set(Object.keys(loadouts?.kits ?? {}).map(n => n.toLowerCase()));

const cola = () => rec.lives.filter(l => /^Us_ColaBottleFighter/i.test(l.tmpl ?? ''))
  .map(l => ({ nid: l.nid, tmpl: l.tmpl, kit: !!l.kit }));
const before = cola();

// replay.js load(): the kit table's kits, then the item flags, then the
// hull filter (isHull: not a soldier, kit, flag, camera or round).
const marked = recording.markKits(rec, tmpl => kitNames.has(tmpl.toLowerCase()));
const carried = new Set();
for (const [name, kit] of Object.entries(loadouts?.kits ?? {})) {
  carried.add(name.toLowerCase());
  for (const item of kit.items ?? []) carried.add(String(item).toLowerCase());
}
for (const life of rec.lives) {
  if (life.tmpl && carried.has(life.tmpl.toLowerCase())) life.item = true;
}
const isHull = l => l.tmpl && !l.soldier && !l.kit && !l.controlPoint && !l.camera && !l.projectile;
const hullTemplates = [...new Set(rec.lives.filter(l => isHull(l) && !l.item).map(l => l.tmpl))];
const colaHulls = hullTemplates.filter(t => /cola/i.test(t));

// What the hull path fetches for each cola template (replay-assets.js
// modelUrlList: the mod tree, then vanilla), GET for real.
const status = async url => { try { return (await fetch(url)).status; } catch { return 'unreachable'; } };
const modelFetches = [];
for (const tmpl of colaHulls) {
  for (const rel of [`models/mods/fhsweurope/${tmpl}.glb`, `models/${tmpl}.glb`]) {
    modelFetches.push({ url: rel, status: await status(`${base}/${rel}`) });
  }
}

// What a kit life draws instead: the kits.json row's pickup glb.
const kitsJson = await fetch(`${base}/models/mods/fhsweurope/kits.json`).then(r => r.json());
const pickups = [];
for (const name of ['Us_ColaBottleFighter', 'Us_ColaBottleFighter2', 'Us_ColaBottleFighter3']) {
  const row = kitsJson.kits.find(k => k.template.toLowerCase() === name.toLowerCase());
  const glb = row?.pickup?.glb ?? null;
  pickups.push({
    kit: name,
    row: Boolean(row),
    pickupOnly: row?.pickupOnly ?? false,
    glb,
    status: glb ? await status(`${base}/models/mods/fhsweurope/${glb}`) : null,
  });
}

console.log(JSON.stringify({
  recording: path.basename(recPath),
  loadoutsKnowsCola: kitNames.has('us_colabottlefighter'),
  colaLivesBefore: before,
  markedByKitTable: marked,
  colaLivesAfter: cola(),
  colaHullTemplates: colaHulls,
  modelFetches,
  pickups,
}, null, 1));
