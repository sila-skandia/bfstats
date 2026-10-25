// The CD-key half of the ChallengeResponse (wire.md section 4).
//
// The retail client reads its key from the registry (`...\Battlefield
// 1942\ergc`, Setup::getStringFromRegistry 0x00443f10 at 0x00495103; an
// expansion's own key at 0x00459e20) and hands it, with the Challenge's
// string, to GameSpy's `gcd_compute_response` (BF1942.exe 0x0081fa20):
//
//   md5hex(key) . sprintf("%.8x", r) . md5hex(key . sprintf("%d", r % 0xffff) . challenge) . NUL
//
// 32 + 8 + 32 + 1 = the event's 73 bytes, r = rand() << 16 | rand() (srand
// seeded with time ^ 0x33333333). A LAN server accepts anything
// (GameSpyHost::authenticateUser 0x0810b630, "LanGame Accept"); an internet
// server passes the hash and its own challenge to `gcd_authenticate_user`
// (lnxded 0x0810d380), and the master recomputes the second digest.
//
// The challenge string is the Challenge event's 10 bytes read as a C string.
// The server writes ten letters then NULs the tenth
// (ClientConnection::initChallengeString 0x08116280 sets +0x151 = 0 over a
// buffer at +0x148), so it is nine letters, and that NUL travels in the
// event. The client keeps the mod name straight after the 10 bytes (event
// +0xc challenge, +0x16 mod, ChallengeEvent::deSerialize 0x0811f130), so a
// challenge without a NUL would run on into the mod; that is mirrored too.
//
// The key: bf42++ replaces a missing or published key with a generated
// 22-digit one (generic.cpp getStringFromRegistry_hook), and those join
// public servers. The sidecar does the same, one key per product, kept in
// ~/.config/bfstats-sidecar/cdkeys.json (%APPDATA%\bfstats-sidecar on Windows) so a server sees the same player
// across runs. It never borrows this PC's own key: a master that sees one key
// on two connections drops one, and the other would be the owner's game.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { configDir } from './paths.mjs';
import path from 'node:path';

export const KEY_HASH_BYTES = 73;

const md5hex = (buf) => crypto.createHash('md5').update(buf).digest('hex');

/** The C string the client hands gcd_compute_response, as latin1 bytes. */
export function challengeString({ challenge, mod = '' }) {
  const ch = Buffer.from(challenge);
  const nul = ch.indexOf(0);
  if (nul >= 0) return ch.subarray(0, nul);
  const m = Buffer.from(String(mod), 'latin1');
  const mnul = m.indexOf(0);
  return Buffer.concat([ch, mnul >= 0 ? m.subarray(0, mnul) : m]);
}

/** A retail-shaped r: two 15-bit MSVC rand() values, `rand() << 16 | rand()`. */
export const retailRand = () => ((crypto.randomInt(0x8000) << 16) | crypto.randomInt(0x8000)) >>> 0;

/** gcd_compute_response (BF1942.exe 0x0081fa20): the 73-byte key hash. */
export function keyHashResponse(cdkey, challenge, r = retailRand()) {
  const key = Buffer.from(String(cdkey), 'latin1');
  const ch = Buffer.isBuffer(challenge) ? challenge : Buffer.from(String(challenge), 'latin1');
  const out = Buffer.alloc(KEY_HASH_BYTES);
  // The client's own guard (key*2 + challenge + 8 > 0x1ff) writes an error
  // string instead; nothing the sidecar sends comes near it.
  if (key.length * 2 + ch.length + 8 > 0x1ff) throw new Error('CD key or challenge too long');
  r >>>= 0;
  const rand = r.toString(16).padStart(8, '0');
  const raw = Buffer.concat([key, Buffer.from(String(r % 0xffff), 'latin1'), ch]);
  out.write(md5hex(key) + rand + md5hex(raw), 0, 'latin1');
  return out; // byte 72 stays NUL
}

/** A fresh 22-digit key, the shape bf42++ generates. */
export function generateCdKey() {
  let s = '';
  while (s.length < 22) s += crypto.randomInt(10);
  // A leading zero is legal, but keep the first digit non-zero like a printed key.
  return s[0] === '0' ? `1${s.slice(1)}` : s;
}

// %APPDATA%\bfstats-sidecar\cdkeys.json on Windows (paths.mjs).
const keyFile = () => process.env.SIDECAR_CDKEY_FILE || path.join(configDir(), 'cdkeys.json');

/**
 * The sidecar's keys, by the Challenge's xpack (-1 base game, 713 Road to
 * Rome, 783 Secret Weapons). `override` (a --cdkey, or SIDECAR_CDKEY) is the
 * base game's key; an expansion still gets its own. A key file that cannot be
 * read or written leaves the run on in-memory keys with a warning.
 */
export function cdKeyStore({ override = process.env.SIDECAR_CDKEY, file = keyFile(), warn = (m) => console.warn(m) } = {}) {
  let keys = null;
  const load = () => {
    if (keys) return keys;
    try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') warn(`cdkey: ${file} unreadable (${e.message}); using fresh keys`);
      keys = {};
    }
    return keys;
  };
  return (xpack) => {
    const id = String(xpack ?? -1);
    if (id === '-1' && override) return String(override);
    const k = load();
    if (typeof k[id] === 'string' && k[id]) return k[id];
    k[id] = generateCdKey();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(k, null, 2)}\n`, { mode: 0o600 });
    } catch (e) { warn(`cdkey: could not save ${file} (${e.message}); this run's key is not kept`); }
    return k[id];
  };
}
