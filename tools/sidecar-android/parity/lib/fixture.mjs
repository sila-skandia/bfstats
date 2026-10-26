// Shared by the parity generators (not run by regen.sh, which runs only the
// top-level *.mjs): writing a fixture, the two value encodings both sides
// compare, and the seeded PRNGs. The Kotlin twin of each is in
// core/src/commonTest/kotlin/io/bfstats/sidecar/Fixtures.kt; keep the two in step.
// The fake clock is fake-time.mjs, the level tables tables.mjs.
import fs from 'node:fs';

export const SIDECAR = new URL('../../../bf1942-models/sidecar/', import.meta.url);
export const sidecar = (name) => import(new URL(name, SIDECAR).href);

export function write(name, obj) {
  const url = new URL(`../../core/src/commonTest/resources/parity/${name}.json`, import.meta.url);
  const text = JSON.stringify(obj);
  fs.writeFileSync(url, text);
  console.log(`${name}.json: ${text.length} bytes`);
}

export const hex = (b) => Buffer.from(b).toString('hex');

// A value as the fixture holds it: bytes become "hex:<hex>", the rest is JSON.
// The Kotlin side (Fixtures.enc) encodes its values the same way and compares
// the strings.
export function enc(v) {
  if (v instanceof Uint8Array) return `hex:${hex(v)}`;
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = x === undefined ? undefined : enc(x);
    return o;
  }
  return v;
}
export const encs = (v) => JSON.stringify(enc(v));

// JSON with Buffers / Uint8Arrays as { $hex }, the other form (Fixtures.canon).
export function plain(v) {
  if (v instanceof Uint8Array) return { $hex: Buffer.from(v).toString('hex') };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = plain(x); return o; }
  return v;
}

// xorshift32 in [0, 1), the stream the fixtures record as plain numbers.
export function prng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

// A seeded LCG (the one the repo's harnesses use), for generators whose
// inputs only Node sees.
export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
