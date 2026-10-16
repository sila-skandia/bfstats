// Resolve a ghost object's template name from its numeric template id.
//
// The wire carries only `tid` (the server's template load order); the name
// that selects a model is not on the wire — the real client reads it from the
// template table its own level load built. namesForLevel computes that table
// from the install (template-table.mjs). The recorded sources below are the
// fallback and the test fixtures:
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
import { templateTable } from './template-table.mjs';

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

// A level's tid -> template name table, and each tid's template class.
// First choice, computed from the install the way the retail client and
// server build it (template-table.mjs, bf42/template_table.py): every id the
// level load creates, for the server's mod (its ServerInfo) and the round's
// game type (SetLevel's mode), with no recording involved. Only when that
// fails (no install, no mod known, a level the install lacks) does it fall
// back, loudly, to the saved map for the level (templates/<level>.json, by the
// setLevel name "bf1942/levels/wake/"), with no classes (template-class.mjs
// then guesses from names). Those recorded maps are partial (only what a
// recording instantiated) and are otherwise test fixtures. The animation and
// control point tables here are the recorded ones either way; game-tables.mjs
// builds those from the install.
const fellBack = new Set();
export function namesForLevel(level, { mod = null, mode = null } = {}) {
  const base = String(level || '').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const own = base ? savedMap(base) : null;
  const computed = base ? templateTable({ mod, level, mode }) : null;
  if (computed) {
    return { tidNames: computed.tidNames, tidClasses: computed.tidClasses, animStates: own?.animStates ?? null, cpNames: own?.cpNames ?? {}, computed: true };
  }
  if (base && !fellBack.has(`${mod}|${base}|${mode}`)) {
    fellBack.add(`${mod}|${base}|${mode}`);
    console.error(`[names] FALLBACK: the template ids for ${base} (mod=${mod ?? '?'} mode=${mode ?? '?'}) could not be computed from the install; naming objects from the recorded table templates/${base}.json${own ? ` (${Object.keys(own.tidNames).length} ids)` : ' (none: only Wake\'s borrowed names)'}`);
  }
  const wake = wakeNames();
  // A tid is the level's own load order, so Wake's names hold on another
  // level only when its own known tids agree with Wake's on every one they
  // share: Midway does, 25 of 25, El Alamein does not (a Sherman is 2914
  // there, 2916 on Wake), and Wake's names on El Alamein named its control
  // points after Wake's (2026-10-16). Such a level borrows Wake's names for
  // the tids its own recording never saw (the grenade and mine pools), the
  // rest keep only their own.
  let borrow = base === 'wake' || !base;
  if (!borrow && own) {
    const shared = Object.keys(own.tidNames).filter((tid) => wake[tid]);
    borrow = shared.length >= 10 && shared.every((tid) => wake[tid] === own.tidNames[tid]);
  }
  const lent = {};
  if (borrow) for (const [tid, name] of Object.entries(wake)) if (base === 'wake' || !base || !WAKE_OWN.has(name)) lent[tid] = name;
  const tidNames = { ...lent, ...(own?.tidNames ?? {}) };
  return { tidNames, tidClasses: null, animStates: own?.animStates ?? (borrow ? wakeAnim() : null), cpNames: own?.cpNames ?? {}, computed: false };
}

function savedMap(base) {
  try { return loadTidNames(fileURLToPath(new URL(`./templates/${base}.json`, import.meta.url))); } catch { return null; }
}
let WAKE = null;
let WAKE_OWN = new Set();
function wakeNames() {
  if (WAKE) return WAKE.names;
  const w = savedMap('wake');
  const names = { ...(w?.tidNames ?? {}) };
  // A level's own templates (its control points) load after the shared ones
  // and are never another level's: they are not lent.
  WAKE_OWN = new Set(Object.keys(w?.cpNames ?? {}));
  WAKE = { names, anim: w?.animStates ?? null };
  return names;
}
function wakeAnim() { wakeNames(); return WAKE.anim; }
