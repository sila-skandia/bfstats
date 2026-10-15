// Resolve a ghost object's template name from its numeric template id.
//
// The wire carries only `tid` (the server's template load order); the name
// that selects a model is not on the wire — the real client reads it from the
// loaded template table. The sidecar has no game, so it needs the table from
// elsewhere. Two sources, both handled here:
//   - a bf42plus recording (.ndjson): its createObject/`k:"o"` lines carry both
//     tid and the resolved tmpl, so a tid->name map falls straight out;
//   - a saved map (.json): { level, mod, tidNames: { "<tid>": "<name>" } }.
//
// The map is stable per level+mod (the server loads templates deterministically):
// two Wake sessions gave identical tid->name for all 34 shared ids. So a map
// built once from one recording serves later runs of that level — build it with
// `node sidecar/build-names.mjs <recording> sidecar/templates/<level>.json`.

import fs from 'node:fs';

// Also lifted from a recording: the engine's animation state table (the v4
// `anim` record, `[index, name, flags]`), which names the lower/upper state
// indices a soldier's ghost body carries (soldier-ghost.mjs) and sizes their
// field (rangedBits(0, count-1)). It is the engine's, so stable per mod.
export function tidNamesFromRecording(text) {
  const tidNames = {};
  let level = '', mod = '', animStates = null;
  for (const line of text.trim().split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.e === 'setLevel') { level = r.level || level; }
    if (r.e === 'serverInfo' && r.mod) mod = r.mod;
    if ((r.e === 'createObject' || r.k === 'o') && r.tid != null && r.tmpl) tidNames[r.tid] = r.tmpl;
    if (r.k === 'anim' && Array.isArray(r.states) && !animStates) animStates = r.states;
  }
  return { level, mod, tidNames, animStates };
}

// Load a tid->name source: a .json map or a .ndjson recording.
export function loadTidNames(path) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.slice(0, 200).trimStart();
  if (first.startsWith('{') && first.includes('"tidNames"')) {
    const j = JSON.parse(text);
    return { level: j.level || '', mod: j.mod || '', tidNames: j.tidNames || {}, animStates: j.animStates || null };
  }
  return tidNamesFromRecording(text);
}
