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
// Every failure is logged once and answered with null; nothing here throws.
//
//   SIDECAR_TABLES_URL   the published base (default https://mesh.bfstats.io/;
//                        "off" never downloads)
//   SIDECAR_CACHE        the cache directory (default ~/.cache/bfstats-sidecar)
//   BF1942_DIR           the install (default ~/.wine/drive_c/EA Games/Battlefield 1942)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TABLES_URL = 'https://mesh.bfstats.io/';
export const FORMAT = 1;

export const cacheDir = () => process.env.SIDECAR_CACHE || path.join(os.homedir(), '.cache', 'bfstats-sidecar');
export const gameDir = () =>
  process.env.BF1942_DIR || path.join(os.homedir(), '.wine', 'drive_c', 'EA Games', 'Battlefield 1942');

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
    && Array.isArray(j.tids?.classes) && j.tids.specs && j.tids.hulls && j.tids.soldiers;
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

const prepared = new Map(); // key -> Promise<result> (successes only stay)

/**
 * Make the level's tables available to the sync lookups, downloading them
 * into the cache when neither the cache nor an install has them. Resolves to
 * `{ source: 'cache' | 'install' | 'download' | 'none', url?, ms }`; never
 * rejects. `timeoutMs` bounds the download. `fetchImpl` and `base` are for
 * tests.
 */
export function prepareLevel({ mod, level, mode } = {}, { timeoutMs = 20000, fetchImpl = globalThis.fetch, base = tablesBase(), install = true } = {}) {
  if (!mod || !levelKey(level)) return Promise.resolve({ source: 'none', why: 'no mod or level' });
  const args = { mod: modKey(mod), level: levelKey(level), mode: modeKey(mode) };
  ({ mod, level, mode } = args);
  const key = `${modKey(mod)}|${levelKey(level)}|${modeKey(mode)}`;
  if (prepared.has(key)) return prepared.get(key);
  const p = (async () => {
    const t = Date.now();
    if (readBaked(args)) return { source: 'cache', ms: Date.now() - t };
    if (install && installHasMod(mod)) {
      // Built (and cached) now rather than at the SetLevel, from the install.
      const { templateTable } = await import('./template-table.mjs');
      const { gameTables } = await import('./game-tables.mjs');
      const tt = templateTable({ mod, level, mode, baked: false });
      const g = gameTables({ mod, level, mode, baked: false });
      if (tt && g.animStates && g.cpNames) return { source: 'install', ms: Date.now() - t };
    }
    const url = tablesUrl(args, base);
    if (!url) { warnOnce(`off:${key}`, `no tables for ${key} and downloads are off (SIDECAR_TABLES_URL)`); return { source: 'none', ms: Date.now() - t }; }
    if (typeof fetchImpl !== 'function') { warnOnce('nofetch', 'this Node has no fetch(); cannot download the level tables'); return { source: 'none', url, ms: Date.now() - t }; }
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = JSON.parse(await res.text());
      if (!validBaked(j)) throw new Error(`not a format ${FORMAT} table`);
      const file = writeBaked(args, j);
      console.log(`[level-tables] ${key}: ${j.tids.names.length} template ids, ${j.animStates?.length ?? 0} animation states, ${Object.keys(j.cpNames ?? {}).length} control point names, downloaded from ${url} in ${Date.now() - t} ms -> ${file}`);
      return { source: 'download', url, ms: Date.now() - t };
    } catch (e) {
      warnOnce(`dl:${key}`, `could not download the tables for ${key} from ${url}: ${e.name === 'TimeoutError' ? `no answer in ${timeoutMs} ms` : e.message}; the recorded fallback stands in`);
      return { source: 'none', url, ms: Date.now() - t, error: e.message };
    }
  })();
  prepared.set(key, p);
  p.then((r) => { if (r.source === 'none') prepared.delete(key); });
  return p;
}

/** Forget what prepareLevel learnt (tests). */
export function resetLevelTables() { prepared.clear(); warned.clear(); }
