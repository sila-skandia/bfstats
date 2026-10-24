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
// An optional layer: a missing archive answers null (the caller sends 0) and
// warns once per path; nothing here throws.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/**
 * The CRC of `Mods/<mod>/Archives/objects.rfa` under the install, or null
 * when it is not there. Cached per file by size and mtime.
 */
export function objectsChecksum(mod = 'BF1942', { dir = gameDir() } = {}) {
  const rel = `Mods/${mod || 'BF1942'}/Archives/objects.rfa`;
  try {
    const file = resolveCi(dir, rel);
    if (!file) throw new Error('not found');
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.crc;
    const crc = crc32Bzip2(fs.readFileSync(file));
    cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, crc });
    return crc;
  } catch (e) {
    const key = path.join(dir, rel);
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[sidecar] no ${key} (${e.message}); ChallengeResponse b = 0`);
    }
    return null;
  }
}
