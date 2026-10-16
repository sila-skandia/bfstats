// The level's object template table, computed from the install the way the
// retail client and server build it: each template id's name and class, for
// naming and classing the tid every CreateObject carries (wire.md, "Template
// ids", "Template classes"), and what the level's ghost bodies take from its
// templates: every hull's child networkables and widths, its hit points,
// mobility and turning parts, and every soldier's hit points and aim limits
// (wire.md, "Ghost body layouts from the install").
//
// A tid is the template's place in the order the level load first created
// each name (ObjectTemplateManager::createTemplate, lnxded 0x081d5a30, client
// 0x0056db00): id 0 is the code-made ObjectManagerCamera, then the level's
// Init.con, the mod chain's objects/ scripts in path order, and the level's
// <mode>.con. Both processes start each level afresh (the server re-execs, a
// client relaunches), so the table is a function of mod, level and game type.
// The engine side is bf42/template_table.py; this runs its command line
// (sidecar_tid_table.py --graph), derives the layouts from the graph it prints
// (ghost/derive-children.mjs deriveLevel) and caches the answer under
// ~/.cache/bfstats-sidecar/<mod>/<level>-<mode>.tids.json, checked against the
// archives it read (their sizes and times). A first build costs 0.3 s
// (vanilla) to 10 s (FHSWEurope), once.
//
// A failure says so loudly and returns null; names.mjs then falls back to the
// recorded tables in templates/<level>.json and children.mjs to the vanilla
// hulls.json / ghost/derived-specs.json, otherwise only test fixtures.
//
//   BF1942_DIR       the install (default ~/.wine/drive_c/EA Games/Battlefield 1942)
//   SIDECAR_PYTHON   the interpreter (default python3)
//   SIDECAR_CACHE    the cache directory (default ~/.cache/bfstats-sidecar)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deriveLevel } from './ghost/derive-children.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../sidecar_tid_table.py');
const cacheDir = () => process.env.SIDECAR_CACHE || path.join(os.homedir(), '.cache', 'bfstats-sidecar');

const memo = new Map();
const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[template-table] ${msg}`);
}

export const levelBase = (level) => String(level || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase();
export const modeBase = (mode) => String(mode || 'conquest.con').toLowerCase().replace(/\.con$/, '');
const safe = (s) => String(s).replace(/[^a-z0-9_.-]+/gi, '_');

function fingerprint(inputs) {
  return inputs.map((p) => { const s = fs.statSync(p); return [p, s.size, Math.round(s.mtimeMs)]; });
}

function readCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (JSON.stringify(fingerprint(j.inputs.map(([p]) => p))) !== JSON.stringify(j.inputs)) return null;
    return j.value;
  } catch { return null; }
}

function writeCache(file, inputs, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Renamed into place, so a sidecar reading it meanwhile never sees half.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ inputs: fingerprint(inputs), value }));
    fs.renameSync(tmp, file);
  } catch (e) { warnOnce(`w:${file}`, `cannot write the cache ${file}: ${e.message}`); }
}

// The cached value is the code's as much as the archives': a cache written by
// other code (an older table, another derivation) is rebuilt. The version is
// a hash of the files that compute it.
const VERSION = (() => {
  const h = createHash('sha1');
  for (const f of [SCRIPT, path.resolve(HERE, '../bf42/template_table.py'), path.resolve(HERE, 'ghost/derive-children.mjs')]) {
    try { h.update(fs.readFileSync(f)); } catch { h.update(f); }
  }
  return h.digest('hex').slice(0, 12);
})();

function compute(m, lv, md, key) {
  const file = path.join(cacheDir(), safe(m), `${safe(lv)}-${safe(md)}.tids.json`);
  let value = readCache(file);
  if (value && value.v !== VERSION) value = null;
  if (!value) {
    try {
      const t = Date.now();
      const py = process.env.SIDECAR_PYTHON || 'python3';
      const extra = process.env.BF1942_DIR ? ['--game-dir', process.env.BF1942_DIR] : [];
      const j = JSON.parse(execFileSync(py, [SCRIPT, ...extra, '--mod', m, '--level', lv, '--mode', `${md}.con`, '--graph'],
        { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (!Array.isArray(j.names) || j.names.length < 2) throw new Error('the load created no templates');
      const { specs, hulls, soldiers } = deriveLevel(j.graph);
      value = { v: VERSION, mod: j.mod, level: j.level, mode: j.mode, names: j.names, classes: j.classes, specs, hulls, soldiers };
      writeCache(file, j.inputs, value);
      console.log(`[template-table] ${j.mod} ${lv} ${md}: ${j.names.length} template ids, ${Object.keys(specs).length} hull specs, ${Object.keys(soldiers).length} soldiers, from the install in ${Date.now() - t} ms`);
    } catch (e) {
      const why = String(e.stderr || e.message || e).trim().split('\n').slice(-1)[0];
      warnOnce(`run:${key}`, `could not compute the template table for mod=${m} level=${lv} mode=${md} from the install: ${why}`);
      value = null;
    }
  }
  return value;
}

function load({ mod, level, mode }) {
  if (!mod || !level) {
    warnOnce(`args:${mod}|${level}`, `no ${mod ? 'level' : 'mod (no ServerInfo seen)'}: the template table cannot be computed from the install`);
    return null;
  }
  const m = String(mod).toLowerCase();
  const lv = levelBase(level);
  const md = modeBase(mode);
  const key = `${m}|${lv}|${md}`;
  // Memoised either way, so one bad level does not spawn the interpreter on
  // every lookup.
  if (!memo.has(key)) memo.set(key, compute(m, lv, md, key));
  return memo.get(key);
}

/**
 * { tidNames: { "<tid>": name }, tidClasses: { "<tid>": template class },
 * count, mod, level, mode } for a round of `mode` (SetLevel's modeFile, e.g.
 * "coop.con") on `level` (SetLevel's levelPath) under the server's `mod` (its
 * ServerInfo), or null when it could not be computed (the reason is logged
 * once). A class is TEMPLATE_CLASSES' spelling (bf42/template_table.py).
 */
export function templateTable({ mod, level, mode = null } = {}) {
  const value = load({ mod, level, mode });
  if (!value) return null;
  return {
    tidNames: Object.fromEntries(value.names.map((n, i) => [String(i), n])),
    tidClasses: Object.fromEntries(value.classes.map((c, i) => [String(i), c])),
    count: value.names.length, mod: value.mod, level: value.level, mode: value.mode,
  };
}

/**
 * The level's ghost body layouts, { specs, hulls, soldiers } keyed by
 * template name (ghost/derive-children.mjs deriveLevel), or null.
 */
export function levelTemplates({ mod, level, mode = null } = {}) {
  const value = load({ mod, level, mode });
  return value ? { specs: value.specs, hulls: value.hulls, soldiers: value.soldiers, mod: value.mod, level: value.level, mode: value.mode } : null;
}
