// Shared by the parity generators (lib/ is not run by regen.sh).
//
// The level tables. The Node sidecar reads them from its cache (an install's
// computed tables, or a downloaded bake); a fixture must not depend on this
// PC's cache, so each generator runs Node against a scratch cache holding
// exactly the baked tables committed under resources/parity/cache, and the
// Kotlin test unpacks the same files into its own scratch cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The parity folder (this file sits in its lib/).
export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SIDECAR = path.resolve(HERE, '../../bf1942-models/sidecar');
export const MODELS = path.resolve(HERE, '../../bf1942-models');
export const RES = path.resolve(HERE, '../core/src/commonTest/resources/parity');
export const CACHE_RES = path.join(RES, 'cache');

export const gz = (text) => zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
export const gunzip = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
export const writeGz = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, gz(text)); };
export const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

// The tables the fixtures use: [mod, level, mode] as the cache keys them.
export const TABLES = [['bf1942', 'wake', 'coop'], ['bf1942', 'el_alamein', 'coop'], ['desertcombat', 'el_alamein', 'conquest']];

// Bake one level's tables the way bake-tables.mjs does, from this PC's
// install or its computed cache, in a child with the default environment.
function bakeFromInstall([mod, level, mode]) {
  const script = `
    const { templateValue } = await import(${JSON.stringify(path.join(SIDECAR, 'template-table.mjs'))});
    const { gameTables } = await import(${JSON.stringify(path.join(SIDECAR, 'game-tables.mjs'))});
    const { FORMAT } = await import(${JSON.stringify(path.join(SIDECAR, 'level-tables.mjs'))});
    const tids = templateValue({ mod: ${JSON.stringify(mod)}, level: ${JSON.stringify(level)}, mode: ${JSON.stringify(mode)}, baked: false });
    const g = gameTables({ mod: ${JSON.stringify(mod)}, level: ${JSON.stringify(level)}, mode: ${JSON.stringify(mode)}, baked: false });
    if (!tids || !g.animStates) process.exit(3);
    process.stdout.write(JSON.stringify({ format: FORMAT, mod: ${JSON.stringify(mod)}, level: ${JSON.stringify(level)}, mode: ${JSON.stringify(mode)}, tids, animStates: g.animStates, cpNames: g.cpNames ?? {} }));
  `;
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

/** The committed baked tables, made from the install the first time (or with
 *  --refresh-tables). Returns the files. */
export function ensureTables() {
  const files = [];
  for (const t of TABLES) {
    const [mod, level, mode] = t;
    const file = path.join(CACHE_RES, mod, `${level}-${mode}.baked.json.gz`);
    if (!fs.existsSync(file) || process.argv.includes('--refresh-tables')) {
      const text = bakeFromInstall(t);
      if (text) writeGz(file, text);
      else if (!fs.existsSync(file)) throw new Error(`no install to bake ${mod} ${level} ${mode} from, and no committed copy`);
    }
    files.push(file);
  }
  return files;
}

/** A scratch cache directory: with the committed tables, or empty. */
export function scratchCache(withTables = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-cache-'));
  if (withTables) {
    for (const [mod, level, mode] of TABLES) {
      const src = path.join(CACHE_RES, mod, `${level}-${mode}.baked.json.gz`);
      fs.mkdirSync(path.join(dir, mod), { recursive: true });
      fs.writeFileSync(path.join(dir, mod, `${level}-${mode}.baked.json`), gunzip(src));
    }
  }
  return dir;
}

/** The environment a parity child runs in: the scratch cache, no install, no downloads. */
export function parityEnv(cache) {
  return { ...process.env, SIDECAR_CACHE: cache, BF1942_DIR: path.join(os.tmpdir(), 'parity-no-install'), SIDECAR_TABLES_URL: 'off' };
}

/** Run a Node script in a child with that environment; its stdout. */
export function runNode(args, cache, opts = {}) {
  return execFileSync(process.execPath, args, { encoding: 'utf8', env: parityEnv(cache), maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
