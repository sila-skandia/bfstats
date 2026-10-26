// The level's tables without a game install: the baked copies on
// mesh.bfstats.io, fetched into the sidecar's cache before they are needed.
//
// What the sidecar reads per level (template-table.mjs: the template ids, their
// classes and the ghost body layouts; game-tables.mjs: the animation states and
// the control point names) is a pure function of the mod, the level and the
// game type. `bake-tables.mjs` computes it from this PC's install for every
// exported level and mode and writes one JSON per level and mode beside the
// level bake:
//
//   viewer/maps/<level>/sidecar/<mode>.json              (bf1942)
//   viewer/maps/mods/<mod>/<level>/sidecar/<mode>.json   (every other mod)
//
// which the mesh publisher sends to the assets volume, so mesh.bfstats.io
// serves it at `<base>maps[/mods/<mod>]/<level>/sidecar/<mode>.json`.
//
// The consumers are synchronous (a SetLevel is handled in the event loop's
// turn that read it), so the download is the async half: `prepareLevel` runs
// before a connect and on a SetLevel, and the session holds the level's load
// until it resolves (session.mjs `levelGate`). The sync lookups then resolve
// in this order (template-table.mjs, game-tables.mjs):
//
//   memo -> local cache (the install's computed tables, or a downloaded bake)
//        -> the install (when one is there) -> [the download, put in the cache
//        by prepareLevel] -> the recorded templates/<level>.json fallback.
//
// A downloaded copy is revalidated at each prepareLevel with a conditional GET
// (its ETag and Last-Modified): 304 keeps it, 200 replaces it, and no answer
// within `revalidateMs` keeps it as it is, so a machine offline still plays.
//
// Every failure is logged once and answered with null; nothing here throws.
//
//   SIDECAR_TABLES_URL   the published base (default https://mesh.bfstats.io/;
//                        "off" never downloads)
//   SIDECAR_CACHE        the cache directory (default ~/.cache/bfstats-sidecar;
//                        %LOCALAPPDATA%\bfstats-sidecar\cache on Windows, paths.mjs)
//   BF1942_DIR           the install (default ~/.wine/drive_c/EA Games/Battlefield 1942,
//                        or the default install folders on Windows, paths.mjs)
//   SIDECAR_PYTHON       the interpreter the install's tables are computed with
//
// The install computes a level's tables only when the Python helpers are
// beside this folder (a repo checkout; the desktop app bundles the sidecar
// alone) and a Python 3 answers (`installCanCompute`). Otherwise an install
// that has the mod still takes the published tables, at once.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir as defaultCacheDir, gameDir as defaultGameDir, pythonAvailable } from './paths.mjs';

export const DEFAULT_TABLES_URL = 'https://mesh.bfstats.io/';
export const FORMAT = 1;

export const cacheDir = () => defaultCacheDir();
export const gameDir = () => defaultGameDir();

// The Python helpers that compute the tables from an install (a repo
// checkout has them one folder up; the desktop app's bundle does not).
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INSTALL_HELPERS = ['sidecar_tid_table.py', 'sidecar_tables.py'].map((f) => path.resolve(HERE, '..', f));

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[level-tables] ${msg}`);
}

/** `bf1942/levels/Market_Garden/`, `market garden` (the live list) -> `market_garden`. */
export function levelKey(level) {
  return String(level || '').trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase().replace(/\s+/g, '_');
}

const MODE_ALIASES = {
  gpm_cq: 'conquest', gpm_coop: 'coop', gpm_ctf: 'ctf', gpm_tdm: 'tdm', gpm_objectivemode: 'objectivemode',
  objective: 'objectivemode', 'co-op': 'coop', teamdeathmatch: 'tdm',
};
/** `CoOp.con`, `coop`, `GPM_COOP` -> `coop`; nothing -> `conquest`. */
export function modeKey(mode) {
  const m = String(mode || 'conquest').trim().toLowerCase().replace(/\.con$/, '');
  return MODE_ALIASES[m] ?? m;
}

/** The server's mod (ServerInfo `mod`, the live list's `mapId`) as a tree key: `XPack1` -> `xpack1`. */
export function modKey(mod) {
  return String(mod || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
}

/** The tree a mod's levels are exported in, relative to the viewer root. */
export function treeFor(mod) {
  const m = modKey(mod);
  return !m || m === 'bf1942' ? 'maps' : `maps/mods/${m}`;
}

/** Where a level's baked tables live under a tree (and on the volume). */
export const bakedRel = ({ mod, level, mode }) => `${treeFor(mod)}/${levelKey(level)}/sidecar/${modeKey(mode)}.json`;

export function tablesBase() {
  const b = process.env.SIDECAR_TABLES_URL ?? DEFAULT_TABLES_URL;
  if (!b || /^(off|none|0)$/i.test(b)) return null;
  return b.endsWith('/') ? b : `${b}/`;
}

/** The published URL of a level's tables, or null when downloads are off. */
export function tablesUrl(args, base = tablesBase()) {
  return base ? `${base.endsWith('/') ? base : `${base}/`}${bakedRel(args)}` : null;
}

/** The downloaded copy's place in the cache, beside the install's computed ones. */
export const bakedCacheFile = ({ mod, level, mode }) =>
  path.join(cacheDir(), modKey(mod) || 'bf1942', `${levelKey(level)}-${modeKey(mode)}.baked.json`);

// Bumped whenever a download lands, so a lookup that found nothing before it
// (and memoised that) looks again.
let generation = 0;
export const bakedGeneration = () => generation;

/** Whether a baked document is one this code reads. */
export function validBaked(j) {
  return !!j && j.format === FORMAT && Array.isArray(j.tids?.names) && j.tids.names.length >= 2
    && Array.isArray(j.tids?.classes) && !!j.tids.specs && !!j.tids.hulls && !!j.tids.soldiers;
}

/** The downloaded tables in the cache, or null. */
export function readBaked(args) {
  const file = bakedCacheFile(args);
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (validBaked(j)) return j;
  warnOnce(`bad:${file}`, `ignoring ${file}: not a format ${FORMAT} table`);
  return null;
}

function writeBaked(args, j) {
  const file = bakedCacheFile(args);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j));
  fs.renameSync(tmp, file);
  generation++;
  return file;
}

// The install is Windows-cased; a mod is there when Mods/<mod> is, any case.
export function installHasMod(mod, dir = gameDir()) {
  try {
    const want = modKey(mod) || 'bf1942';
    return fs.readdirSync(path.join(dir, 'Mods')).some((n) => n.toLowerCase() === want);
  } catch { return false; }
}

/**
 * Whether this process can compute `mod`'s tables from the install: the
 * install has the mod, the helpers are here, and Python 3 runs. A no when
 * the install has the mod is said once, with why, so the published tables
 * stand in without a run of the interpreter per lookup.
 */
export function installCanCompute(mod, { dir = gameDir(), helpers = INSTALL_HELPERS, python = pythonAvailable } = {}) {
  if (!installHasMod(mod, dir)) return false;
  const missing = helpers.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    warnOnce('helpers', `the install at ${dir} has mod=${modKey(mod) || 'bf1942'}, but the Python helpers are not here (${path.basename(missing[0])}): using the published tables`);
    return false;
  }
  const py = python();
  if (!py.ok) {
    warnOnce('python', `the install at ${dir} has mod=${modKey(mod) || 'bf1942'}, but ${py.python} is not a working Python 3 (${py.why}): using the published tables`);
    return false;
  }
  return true;
}


// What prepareLevel last answered per level, and when: a second call within
// `reuseMs` (the pre-join lookup, then the SetLevel a moment later) reuses it
// rather than asking the server again.
const prepared = new Map(); // key -> { p: Promise<result>, at }

async function fetchTables(url, { timeoutMs, fetchImpl, etag = null, lastModified = null }) {
  const headers = {};
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = JSON.parse(await res.text());
  if (!validBaked(j)) throw new Error(`not a format ${FORMAT} table`);
  // Kept with the copy, for the next join's conditional GET. mesh.bfstats.io
  // sends both through Cloudflare (a weak ETag on the gzipped body) and
  // answers either with 304.
  j._http = { url, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  return { status: 200, doc: j };
}

const describe = (j) => `${j.tids.names.length} template ids, ${j.animStates?.length ?? 0} animation states, ${Object.keys(j.cpNames ?? {}).length} control point names`;

/**
 * Make the level's tables available to the sync lookups. Resolves to
 * `{ source, url?, ms, revalidated?, stale? }`, never rejects. `source` is
 *
 *   'cache'     a downloaded copy, revalidated with a conditional GET (304)
 *               or, when that failed or took longer than `revalidateMs`,
 *               used as it is (`stale: true`: offline still plays);
 *   'download'  fetched now: nothing was cached, the server had a newer copy
 *               (200 to the conditional GET), or the cached copy was baked by
 *               other code than this sidecar's (its `tids.v`), for which a
 *               fresh copy is fetched and preferred;
 *   'install'   the install has the mod and built the tables;
 *   'none'      nothing anywhere (the recorded fallback stands in).
 *
 * `timeoutMs` bounds a download nothing cached can stand in for;
 * `revalidateMs` the check of a cached copy. `fetchImpl` and `base` are for
 * tests.
 */
export function prepareLevel({ mod, level, mode } = {}, {
  timeoutMs = 20000, revalidateMs = 3000, reuseMs = 60000,
  fetchImpl = globalThis.fetch, base = tablesBase(), install = true,
} = {}) {
  if (!mod || !levelKey(level)) return Promise.resolve({ source: 'none', why: 'no mod or level' });
  const args = { mod: modKey(mod), level: levelKey(level), mode: modeKey(mode) };
  ({ mod, level, mode } = args);
  const key = `${mod}|${level}|${mode}`;
  const hit = prepared.get(key);
  if (hit && Date.now() - hit.at < reuseMs) return hit.p;
  const p = (async () => {
    const t = Date.now();
    const url = tablesUrl(args, base);
    const canFetch = !!url && typeof fetchImpl === 'function';
    const cached = readBaked(args);
    if (cached) {
      if (!canFetch) return { source: 'cache', ms: Date.now() - t, revalidated: false };
      const { TEMPLATE_TABLE_VERSION } = await import('./template-table.mjs');
      const otherCode = cached.tids.v !== TEMPLATE_TABLE_VERSION;
      if (otherCode) warnOnce(`ver:${key}`, `${key}: the cached table was baked by other code (${cached.tids.v}; this is ${TEMPLATE_TABLE_VERSION}); fetching a fresh copy`);
      try {
        // Other code's copy: no validators, so the server sends its copy whole.
        const r = await fetchTables(url, {
          timeoutMs: otherCode ? timeoutMs : revalidateMs, fetchImpl,
          etag: otherCode ? null : cached._http?.etag, lastModified: otherCode ? null : cached._http?.lastModified,
        });
        if (r.status === 304) return { source: 'cache', url, ms: Date.now() - t, revalidated: true };
        writeBaked(args, r.doc);
        console.log(`[level-tables] ${key}: ${describe(r.doc)}, a newer copy downloaded from ${url} in ${Date.now() - t} ms`);
        return { source: 'download', url, ms: Date.now() - t, replaced: true };
      } catch (e) {
        warnOnce(`reval:${key}`, `could not check the cached tables for ${key} against ${url} (${e.name === 'TimeoutError' ? `no answer in ${otherCode ? timeoutMs : revalidateMs} ms` : e.message}); using the cached copy`);
        return { source: 'cache', url, ms: Date.now() - t, revalidated: false, stale: true };
      }
    }
    if (install && installCanCompute(mod)) {
      // Built (and cached) now rather than at the SetLevel, from the install.
      const { templateTable } = await import('./template-table.mjs');
      const { gameTables } = await import('./game-tables.mjs');
      const tt = templateTable({ mod, level, mode, baked: false });
      const g = gameTables({ mod, level, mode, baked: false });
      if (tt && g.animStates && g.cpNames) return { source: 'install', ms: Date.now() - t };
    }
    if (!url) { warnOnce(`off:${key}`, `no tables for ${key} and downloads are off (SIDECAR_TABLES_URL)`); return { source: 'none', ms: Date.now() - t }; }
    if (!canFetch) { warnOnce('nofetch', 'this Node has no fetch(); cannot download the level tables'); return { source: 'none', url, ms: Date.now() - t }; }
    try {
      const r = await fetchTables(url, { timeoutMs, fetchImpl });
      if (r.status === 304) throw new Error('HTTP 304 to an unconditional GET');
      const file = writeBaked(args, r.doc);
      console.log(`[level-tables] ${key}: ${describe(r.doc)}, downloaded from ${url} in ${Date.now() - t} ms -> ${file}`);
      return { source: 'download', url, ms: Date.now() - t };
    } catch (e) {
      warnOnce(`dl:${key}`, `could not download the tables for ${key} from ${url}: ${e.name === 'TimeoutError' ? `no answer in ${timeoutMs} ms` : e.message}; the recorded fallback stands in`);
      return { source: 'none', url, ms: Date.now() - t, error: e.message };
    }
  })();
  prepared.set(key, { p, at: Date.now() });
  p.then((r) => { if (r.source === 'none') prepared.delete(key); });
  return p;
}

/** Forget what prepareLevel learnt (tests). */
export function resetLevelTables() { prepared.clear(); warned.clear(); }
