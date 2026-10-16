// The level's object template id table, computed from the install the way the
// retail client and server build it, for naming the tid every CreateObject
// carries (wire.md, "Template ids").
//
// A tid is the template's place in the order the level load first created
// each name (ObjectTemplateManager::createTemplate, lnxded 0x081d5a30, client
// 0x0056db00): id 0 is the code-made ObjectManagerCamera, then the level's
// Init.con, the mod chain's objects/ scripts in path order, and the level's
// <mode>.con. Both processes start each level afresh (the server re-execs, a
// client relaunches), so the table is a function of mod, level and game type.
// The engine side is bf42/template_table.py; this runs its command line
// (sidecar_tid_table.py) and caches the answer under
// ~/.cache/bfstats-sidecar/<mod>/<level>-<mode>.tids.json, checked against the
// archives it read (their sizes and times). A first build costs 0.3 s
// (vanilla) to 2 s (FHSWEurope), once.
//
// A failure says so loudly and returns null; names.mjs then falls back to the
// recorded tables in templates/<level>.json, otherwise only test fixtures.
//
//   BF1942_DIR       the install (default ~/.wine/drive_c/EA Games/Battlefield 1942)
//   SIDECAR_PYTHON   the interpreter (default python3)
//   SIDECAR_CACHE    the cache directory (default ~/.cache/bfstats-sidecar)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    fs.writeFileSync(file, JSON.stringify({ inputs: fingerprint(inputs), value }));
  } catch (e) { warnOnce(`w:${file}`, `cannot write the cache ${file}: ${e.message}`); }
}

/**
 * { tidNames: { "<tid>": name }, count, mod, level, mode } for a round of
 * `mode` (SetLevel's modeFile, e.g. "coop.con") on `level` (SetLevel's
 * levelPath) under the server's `mod` (its ServerInfo), or null when it could
 * not be computed (the reason is logged once).
 */
export function templateTable({ mod, level, mode = null } = {}) {
  if (!mod || !level) {
    warnOnce(`args:${mod}|${level}`, `no ${mod ? 'level' : 'mod (no ServerInfo seen)'}: the template ids cannot be computed from the install`);
    return null;
  }
  const m = String(mod).toLowerCase();
  const lv = levelBase(level);
  const md = modeBase(mode);
  const key = `${m}|${lv}|${md}`;
  if (memo.has(key)) return memo.get(key);

  const file = path.join(cacheDir(), safe(m), `${safe(lv)}-${safe(md)}.tids.json`);
  let value = readCache(file);
  if (!value) {
    try {
      const t = Date.now();
      const py = process.env.SIDECAR_PYTHON || 'python3';
      const extra = process.env.BF1942_DIR ? ['--game-dir', process.env.BF1942_DIR] : [];
      const j = JSON.parse(execFileSync(py, [SCRIPT, ...extra, '--mod', m, '--level', lv, '--mode', `${md}.con`],
        { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (!Array.isArray(j.names) || j.names.length < 2) throw new Error('the load created no templates');
      value = { mod: j.mod, level: j.level, mode: j.mode, names: j.names };
      writeCache(file, j.inputs, value);
      console.log(`[template-table] ${j.mod} ${lv} ${md}: ${j.names.length} template ids from the install in ${Date.now() - t} ms`);
    } catch (e) {
      const why = String(e.stderr || e.message || e).trim().split('\n').slice(-1)[0];
      warnOnce(`run:${key}`, `could not compute the template ids for mod=${m} level=${lv} mode=${md} from the install: ${why}`);
      value = null;
    }
  }
  const out = value ? {
    tidNames: Object.fromEntries(value.names.map((n, i) => [String(i), n])),
    count: value.names.length, mod: value.mod, level: value.level, mode: value.mode,
  } : null;
  // Memoised either way, so one bad level does not spawn the interpreter on
  // every lookup.
  memo.set(key, out);
  return out;
}
