// The second checksum (`b`) of a ChallengeResponse: a CRC of the mod's
// objects.rfa, which the retail client computes from its own install
// (features/udp-sidecar/wire.md section 4).
//
// BF1942.exe 0x005c1280 opens the path relative to the game directory, takes
// the file's length and runs a byte-at-a-time CRC over the whole file with a
// table built at 0x005c1220: polynomial 0x04c11db7 MSB-first (not reflected),
// init 0xffffffff, final NOT. That is CRC-32/BZIP2, not zlib's CRC32. The
// builder (0x0049507b) checksums "Mods/BF1942/Archives/objects.rfa" for the
// base response and "Mods/<Challenge mod>/Archives/objects.rfa" (0x004951ac)
// for an expansion's, then XORs the result with the challenge's first u32.
//
// Env:
//   BF1942_DIR       the install (default ~/.wine/drive_c/EA Games/Battlefield 1942)
//
// Without the install, the bundled objects-crc.json (every mod of a retail
// 1.61 install, `node sidecar/objects-checksum.mjs --build`) answers. An
// optional layer: a mod in neither answers null (the caller sends 0) and
// warns once; nothing here throws.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC-32/BZIP2 of a buffer, as BF1942.exe 0x005c1280 computes it. */
export function crc32Bzip2(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c << 8) ^ TABLE[((c >>> 24) ^ buf[i]) & 0xff];
  return ~c >>> 0;
}

export const gameDir = () =>
  process.env.BF1942_DIR || path.join(os.homedir(), '.wine', 'drive_c', 'EA Games', 'Battlefield 1942');

// The install is Windows-cased ("Mods/bf1942/Archives/Objects.rfa"); match
// each component case-insensitively, as the client's filesystem does.
function resolveCi(root, rel) {
  let cur = root;
  for (const part of rel.split('/')) {
    const exact = path.join(cur, part);
    if (fs.existsSync(exact)) { cur = exact; continue; }
    const hit = fs.readdirSync(cur).find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const cache = new Map(); // resolved path -> {size, mtimeMs, crc}
const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

// Every mod's CRC from a retail 1.61 install, for a machine without one:
// `node sidecar/objects-checksum.mjs --build` rewrites it.
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'objects-crc.json');
let bundled = null;
export function bundledChecksums() {
  if (bundled) return bundled;
  try { bundled = JSON.parse(fs.readFileSync(BUNDLED, 'utf8')).mods ?? {}; }
  catch (e) { warnOnce(BUNDLED, `[sidecar] ${BUNDLED} unreadable (${e.message}); objects.rfa CRCs from the install only`); bundled = {}; }
  return bundled;
}

/** The CRC of the install's `Mods/<mod>/Archives/objects.rfa`, or null. Cached per file by size and mtime. */
export function installChecksum(mod = 'BF1942', { dir = gameDir() } = {}) {
  const file = dir ? resolveCi(dir, `Mods/${mod || 'BF1942'}/Archives/objects.rfa`) : null;
  if (!file) return null;
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.crc;
  const crc = crc32Bzip2(fs.readFileSync(file));
  cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, crc });
  return crc;
}

/**
 * The CRC of `Mods/<mod>/Archives/objects.rfa`: the install's when the
 * archive is there, else the bundled table's (objects-crc.json), else null.
 */
export function objectsChecksum(mod = 'BF1942', { dir = gameDir(), bundled: bundledOk = true } = {}) {
  const rel = `Mods/${mod || 'BF1942'}/Archives/objects.rfa`;
  let why = 'not found';
  try {
    const crc = installChecksum(mod, { dir });
    if (crc != null) return crc;
  } catch (e) { why = e.message; }
  const crc = bundledOk ? bundledChecksums()[String(mod || 'BF1942').toLowerCase()] : undefined;
  if (Number.isInteger(crc)) {
    warnOnce(`b:${mod}`, `[sidecar] no ${path.join(dir || '', rel)}; ChallengeResponse b from the bundled objects-crc.json (${mod})`);
    return crc >>> 0;
  }
  warnOnce(path.join(dir || '', rel), `[sidecar] no ${path.join(dir || '', rel)} (${why}) and no bundled CRC for ${mod}; ChallengeResponse b = 0`);
  return null;
}

// Find the case-insensitive `Archives/objects.rfa` of every installed mod.
export function installChecksums({ dir = gameDir() } = {}) {
  const out = {};
  let mods = [];
  try { mods = fs.readdirSync(path.join(dir, 'Mods')).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); } catch { return out; }
  for (const m of mods) {
    try { const crc = installChecksum(m, { dir }); if (crc != null) out[m.toLowerCase()] = crc; } catch { /* not a mod */ }
  }
  return out;
}

// node sidecar/objects-checksum.mjs --build [out.json]: bundle the install's CRCs.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--build') {
  const out = process.argv[3] ?? BUNDLED;
  const mods = installChecksums();
  if (!Object.keys(mods).length) { console.error(`no Mods/*/Archives/objects.rfa under ${gameDir()}`); process.exit(1); }
  fs.writeFileSync(out, `${JSON.stringify({ source: 'CRC-32/BZIP2 of Mods/<mod>/Archives/objects.rfa of a retail 1.61 install, keyed by the mod in lower case', mods }, null, 1)}\n`);
  console.log(`${Object.keys(mods).length} mods -> ${out}`);
}
