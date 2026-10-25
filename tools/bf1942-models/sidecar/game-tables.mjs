// The two tables a retail client builds from its own install, built the same
// way for the sidecar: the engine's animation state table (which sizes and
// names a soldier body's lower/upper state fields, soldier-ghost.mjs) and the
// level's control point names (template -> its setControlPointName word, the
// lexicon key the game prints). The engine side is bf42/game_tables.py; this
// runs its command line (sidecar_tables.py) on the install and caches the
// answer under ~/.cache/bfstats-sidecar/<mod>/<level>-<mode>.json, checked
// against the archives it read (their sizes and times), so a second join of
// the same level costs nothing. A first one costs 0.2 s (vanilla) to 4 s
// (FHSWEurope's 58,000 states), once.
//
// Inputs are what any retail client has: the server's mod (the ServerInfo
// event) and the level and game type (SetLevel). Nothing here reads a
// recording. Without an install, a level's tables come from the published
// bake that level-tables.mjs prepareLevel downloaded into the cache (memo ->
// the install's cache -> the download -> a run on the install, which needs
// the install to have the mod). A failure says so loudly and returns null; the callers then fall
// back to the recorded tables in templates/<level>.json, which are otherwise
// only test fixtures.
//
//   BF1942_DIR       the install (default ~/.wine/drive_c/EA Games/Battlefield 1942)
//   SIDECAR_PYTHON   the interpreter (default python3)
//   SIDECAR_CACHE    the cache directory (default ~/.cache/bfstats-sidecar)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBaked, bakedGeneration, installHasMod } from './level-tables.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../sidecar_tables.py');
const cacheDir = () => process.env.SIDECAR_CACHE || path.join(os.homedir(), '.cache', 'bfstats-sidecar');

const memo = new Map();
const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[game-tables] ${msg}`);
}

const levelBase = (level) => String(level || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase();
const modeBase = (mode) => String(mode || 'conquest.con').toLowerCase().replace(/\.con$/, '');
const safe = (s) => String(s).replace(/[^a-z0-9_.-]+/gi, '_');

function fingerprint(inputs) {
  return inputs.map((p) => { const s = fs.statSync(p); return [p, s.size, Math.round(s.mtimeMs)]; });
}

function readCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = fingerprint(j.inputs.map(([p]) => p));
    if (JSON.stringify(now) !== JSON.stringify(j.inputs)) return null;
    return j.value;
  } catch { return null; }
}

function writeCache(file, inputs, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ inputs: fingerprint(inputs), value }));
  } catch (e) { warnOnce(`w:${file}`, `cannot write the cache ${file}: ${e.message}`); }
}

function run(args) {
  const py = process.env.SIDECAR_PYTHON || 'python3';
  const extra = process.env.BF1942_DIR ? ['--game-dir', process.env.BF1942_DIR] : [];
  const out = execFileSync(py, [SCRIPT, ...extra, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

/**
 * The tables for a server's mod on a level under its game type:
 * { animStates: [[index, name, flags], ...] | null, cpNames: { template: word } | null }.
 * The animation table is per level too: Game::load rebuilds the state machine
 * at every level load with the level's own `animations/` mounted (FH, FHSW and
 * FHSWEurope levels ship scripts and clips there). Either half is null when it
 * could not be built (the reason is logged once).
 */
export function gameTables({ mod, level = null, mode = null, baked = true } = {}) {
  if (!mod) {
    warnOnce('nomod', 'no mod known (no ServerInfo seen): the animation and control point tables cannot be built');
    return { animStates: null, cpNames: null };
  }
  const m = String(mod).toLowerCase();
  const lv = level ? levelBase(level) : null;
  const md = modeBase(mode);
  const key = `${m}|${lv ?? ''}|${md}`;
  // A miss looks again only at a download landed since (level-tables.mjs).
  const hit = memo.get(key);
  // A downloaded table is read again when a newer copy has landed since.
  if (hit?.downloaded && hit.gen !== bakedGeneration()) {
    const b = fromBaked(m, lv, md, key);
    if (b) { memo.set(key, b); return b; }
    hit.gen = bakedGeneration();
  }
  if (hit && (hit.animStates || !baked || !lv || hit.gen === bakedGeneration())) return hit;
  if (hit) {
    const b = fromBaked(m, lv, md, key);
    if (b) { memo.set(key, b); return b; }
    hit.gen = bakedGeneration();
    return hit;
  }

  const file = path.join(cacheDir(), safe(m), lv ? `${safe(lv)}-${safe(md)}.json` : 'anim.json');
  // memo -> the install's cache -> a downloaded bake -> the install itself.
  let value = readCache(file);
  if (!value && baked && lv) value = fromBaked(m, lv, md, key);
  if (!value && !installHasMod(m)) {
    warnOnce(`none:${key}`, `no install has mod=${m}${lv && baked ? `, and no downloaded tables for ${lv} ${md} are in the cache (level-tables.mjs prepareLevel)` : ''}`);
    value = { animStates: null, cpNames: null, gen: bakedGeneration() };
  }
  if (!value) {
    value = { animStates: null, cpNames: null };
    try {
      const t = Date.now();
      const j = run(['--mod', m, ...(lv ? ['--level', lv, '--mode', `${md}.con`] : [])]);
      if (Array.isArray(j.animStates) && j.animStates.length) value.animStates = j.animStates;
      if (j.cpNames) value.cpNames = j.cpNames;
      if (value.animStates && (value.cpNames || !lv)) writeCache(file, j.inputs, value);
      console.log(`[game-tables] ${j.mod}${lv ? ` ${lv} ${md}` : ''}: ${value.animStates?.length ?? 0} animation states, ${value.cpNames ? Object.keys(value.cpNames).length : 0} control point names, from the install in ${Date.now() - t} ms`);
    } catch (e) {
      const why = String(e.stderr || e.message || e).trim().split('\n').slice(-1)[0];
      warnOnce(`run:${key}`, `could not build the tables for mod=${m}${lv ? ` level=${lv} mode=${md}` : ''} from the install: ${why}`);
    }
  }
  // Memoised either way, so one bad level does not spawn the interpreter on
  // every lookup.
  if (!value.animStates) value.gen = bakedGeneration();
  memo.set(key, value);
  return value;
}

function fromBaked(m, lv, md, key) {
  const j = readBaked({ mod: m, level: lv, mode: md });
  if (!j?.animStates?.length) return null;
  console.log(`[game-tables] ${m} ${lv} ${md}: ${j.animStates.length} animation states, ${Object.keys(j.cpNames ?? {}).length} control point names, from the downloaded tables`);
  return { animStates: j.animStates, cpNames: j.cpNames ?? null, downloaded: true, gen: bakedGeneration() };
}

/** A control point's name under a template, whatever case the tid table spells it in. */
export function cpNameOf(cpNames, tmpl) {
  if (!tmpl || !cpNames) return undefined;
  if (cpNames[tmpl] != null) return cpNames[tmpl];
  const want = String(tmpl).toLowerCase();
  for (const [k, v] of Object.entries(cpNames)) if (k.toLowerCase() === want) return v;
  return undefined;
}
