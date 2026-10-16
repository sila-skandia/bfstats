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
import { fileURLToPath } from 'node:url';

// Also lifted from a recording: the engine's animation state table (the v4
// `anim` record, `[index, name, flags]`), which names the lower/upper state
// indices a soldier's ghost body carries (soldier-ghost.mjs) and sizes their
// field (rangedBits(0, count-1)). It is the engine's, so stable per mod.
export function tidNamesFromRecording(text) {
  const tidNames = {};
  const cpNames = {};
  let level = '', mod = '', animStates = null;
  for (const line of text.trim().split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.e === 'setLevel') { level = r.level || level; }
    if (r.e === 'serverInfo' && r.mod) mod = r.mod;
    if ((r.e === 'createObject' || r.k === 'o') && r.tid != null && r.tmpl) tidNames[r.tid] = r.tmpl;
    if (r.k === 'anim' && Array.isArray(r.states) && !animStates) animStates = r.states;
    // A client names each control point as the game prints it ("Village"
    // for ALLIES_north_village); the wire carries only the template.
    if (r.k === 'cp' && r.tmpl && r.name) cpNames[r.tmpl] = r.name;
  }
  return { level, mod, tidNames, animStates, cpNames };
}

// Load a tid->name source: a .json map or a .ndjson recording.
export function loadTidNames(path) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.slice(0, 200).trimStart();
  if (first.startsWith('{') && first.includes('"tidNames"')) {
    const j = JSON.parse(text);
    return { level: j.level || '', mod: j.mod || '', tidNames: j.tidNames || {}, animStates: j.animStates || null, cpNames: j.cpNames || {} };
  }
  return tidNamesFromRecording(text);
}

// The saved map for a level, by the setLevel name ("bf1942/levels/wake/" ->
// templates/wake.json), merged over the class map's names (classes.json, which
// names every tid whose class is known). A sidecar started without --names, or
// a recording written by one, still names its objects this way; without names
// the replay has no model for any object and draws nothing.
export function namesForLevel(level) {
  const base = String(level || '').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const own = base ? savedMap(base) : null;
  const wake = wakeNames();
  // A tid is the level's own load order, so Wake's names (the class map was
  // read there) hold on another level only when its own known tids agree with
  // Wake's on every one they share: Midway does, 25 of 25, El Alamein does not
  // (a Sherman is 2914 there, 2916 on Wake), and Wake's names on El Alamein
  // named its control points after Wake's (2026-10-16). Such a level borrows
  // Wake's names for the tids its own recording never saw (the grenade and
  // mine pools), the rest keep only their own.
  let borrow = base === 'wake' || !base;
  if (!borrow && own) {
    const shared = Object.keys(own.tidNames).filter((tid) => wake[tid]);
    borrow = shared.length >= 10 && shared.every((tid) => wake[tid] === own.tidNames[tid]);
  }
  const lent = {};
  if (borrow) for (const [tid, name] of Object.entries(wake)) if (base === 'wake' || !base || !WAKE_OWN.has(name)) lent[tid] = name;
  const tidNames = { ...lent, ...(own?.tidNames ?? {}) };
  return { tidNames, animStates: own?.animStates ?? (borrow ? wakeAnim() : null), cpNames: own?.cpNames ?? {} };
}

function savedMap(base) {
  try { return loadTidNames(fileURLToPath(new URL(`./templates/${base}.json`, import.meta.url))); } catch { return null; }
}
let WAKE = null;
let WAKE_OWN = new Set();
const CLASS_BY_TID = () => { try { return JSON.parse(fs.readFileSync(new URL('./classes.json', import.meta.url), 'utf8')).byTid || {}; } catch { return {}; } };
function wakeNames() {
  if (WAKE) return WAKE.names;
  const names = {};
  try {
    const classes = JSON.parse(fs.readFileSync(new URL('./classes.json', import.meta.url), 'utf8'));
    for (const [tid, info] of Object.entries(classes.byTid || {})) if (info?.tmpl) names[tid] = info.tmpl;
  } catch { /* no class map */ }
  const w = savedMap('wake');
  Object.assign(names, w?.tidNames ?? {});
  // A level's own templates (its control points) load after the shared ones
  // and are never another level's: they are not lent.
  WAKE_OWN = new Set(Object.keys(w?.cpNames ?? {}));
  for (const [tid, info] of Object.entries(CLASS_BY_TID())) if (info?.objectClass === 'ControlPoint') WAKE_OWN.add(info.tmpl);
  WAKE = { names, anim: w?.animStates ?? null };
  return names;
}
function wakeAnim() { wakeNames(); return WAKE.anim; }
