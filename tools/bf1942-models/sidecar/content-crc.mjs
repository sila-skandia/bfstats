// The content check's answer: the u32 the client puts in the Ack (0x02) it
// sends once its level has loaded (features/udp-sidecar/wire.md section 4).
//
// The retail client computes a CRC while the level loads (BF1942.exe
// 0x00410980): the bytes of every .con the console runs, outside ai/, chained
// with the smallest mip of every DDS texture it uploads (0x00596650 ->
// 0x005c1360), merged into one u32 (0x005c13c0) and sent as
// `challenge[0..3] ^ crc`. The server does not compute it. It reads
// `Mods/<mod>/contentCrc32.con` (Setup::readContentCrc32File), lines of
// `game.addContentCrc32 <mapId> <level> <GPM_mode> <crc>`, and with
// serverContentCheck on, GameServer::handleGameEventManagerEvent case 2
// (lnxded 0x08136308) sets the connection's content flag only when
// `Ack ^ challenge[0..3]` is one of the level's listed values. A connection
// without the flag is closed with reason 0x1b when it acks the database
// (0x08136cc3). The install ships the same file the server reads, so the
// sidecar answers from it. Vanilla Market Garden Conquest lists 2545831109
// (0x97be4cc5), the value a retail client sent TheGreatEscape (2026-10-24).
//
// The sidecar must also run without the game installed, so every row of the
// install's files (bf1942, XPack1, XPack2, GCMOD) is bundled in
// content-crc.json, rebuilt with `node sidecar/content-crc.mjs --build`. An
// install's own file is read first and the bundled table answers the rest.
//
// An optional layer: a level with no row anywhere answers null (the caller
// sends 0, which only a server with the check off accepts) and warns once;
// nothing here throws.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameDir } from './objects-checksum.mjs';

const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'content-crc.json');

// SetLevel's mode file -> the GamePlayMode name the file keys on.
const GPM = { conquest: 'GPM_CQ', coop: 'GPM_COOP', ctf: 'GPM_CTF', tdm: 'GPM_TDM', objectivemode: 'GPM_OBJECTIVEMODE' };

/** `conquest.con` -> `GPM_CQ`; null for a mode the file never names. */
export function gpmFor(modeFile) {
  return GPM[String(modeFile || '').toLowerCase().replace(/\.con$/, '').trim()] ?? null;
}

/** The level's directory name from SetLevel's path (`bf1942/levels/market_garden/`). */
export function levelName(levelPath) {
  const parts = String(levelPath || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Parse a contentCrc32.con: Map `mapid/level/gpm` (lower case) -> [crc, ...]. */
export function parseContentCrc32(text) {
  const rows = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^game\.addContentCrc32\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)/i);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}/${m[3]}`.toLowerCase();
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(Number(m[4]) >>> 0);
  }
  return rows;
}

let bundled = null;
function bundledRows() {
  if (bundled) return bundled;
  try { bundled = new Map(Object.entries(JSON.parse(fs.readFileSync(BUNDLED, 'utf8')).rows ?? {})); }
  catch (e) { console.warn(`[sidecar] ${BUNDLED} unreadable (${e.message}); content CRCs from the install only`); bundled = new Map(); }
  return bundled;
}

/** Every row of every Mods/<mod>/contentCrc32.con under the install. */
export function installRows({ dir = gameDir() } = {}) {
  const all = new Map();
  let mods = [];
  try { mods = fs.readdirSync(path.join(dir, 'Mods')).sort(); } catch { return all; }
  for (const m of mods) {
    for (const [k, v] of rowsFor(path.join(dir, 'Mods', m)) ?? []) {
      all.set(k, [...new Set([...(all.get(k) ?? []), ...v])]);
    }
  }
  return all;
}

const files = new Map(); // mod dir -> {mtimeMs, rows}
const warned = new Set();

function rowsFor(modDir) {
  try {
    const name = fs.readdirSync(modDir).find((n) => n.toLowerCase() === 'contentcrc32.con');
    if (!name) return null;
    const file = path.join(modDir, name);
    const st = fs.statSync(file);
    const hit = files.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.rows;
    const rows = parseContentCrc32(fs.readFileSync(file, 'latin1'));
    files.set(file, { mtimeMs: st.mtimeMs, rows });
    return rows;
  } catch { return null; }
}

/**
 * The content CRC for a level, or null. `mod` is the server's mod (its
 * Mods/ directory, any case), `mapId` ServerInfo's (BF1942, XPack1, ...),
 * `levelPath` and `modeFile` the SetLevel's. The server's mod is looked up
 * first, then every other mod's file, since an expansion server can run a
 * level another pack lists.
 */
export function contentCrc({ mod, mapId, levelPath, modeFile }, { dir = gameDir(), bundled: bundledOk = true } = {}) {
  const gpm = gpmFor(modeFile);
  const level = levelName(levelPath);
  const key = `${mapId || mod || 'BF1942'}/${level}/${gpm}`.toLowerCase();
  if (gpm && level && dir) {
    let mods = [];
    try { mods = fs.readdirSync(path.join(dir, 'Mods')); } catch { /* no install */ }
    const want = String(mod || mapId || 'bf1942').toLowerCase();
    mods.sort((a, b) => (b.toLowerCase() === want) - (a.toLowerCase() === want));
    for (const m of mods) {
      const crc = rowsFor(path.join(dir, 'Mods', m))?.get(key)?.[0];
      if (crc !== undefined) return crc;
    }
  }
  const crc = gpm && level && bundledOk ? bundledRows().get(key)?.[0] : undefined;
  if (crc !== undefined) return crc;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[sidecar] no contentCrc32.con row for ${key}; content Ack = 0 (a server with serverContentCheck on will close us with 0x1b)`);
  }
  return null;
}

// node sidecar/content-crc.mjs --build [out.json]: bundle the install's rows.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--build') {
  const out = process.argv[3] ?? BUNDLED;
  const rows = Object.fromEntries([...installRows()].sort(([a], [b]) => a.localeCompare(b)));
  if (!Object.keys(rows).length) { console.error(`no contentCrc32.con under ${gameDir()}/Mods`); process.exit(1); }
  fs.writeFileSync(out, `${JSON.stringify({ source: 'Mods/*/contentCrc32.con of a retail 1.61 install, keyed mapid/level/gpm', rows }, null, 1)}\n`);
  console.log(`${Object.keys(rows).length} rows -> ${out}`);
}
