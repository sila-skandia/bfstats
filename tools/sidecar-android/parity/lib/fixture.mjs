// Shared by the parity generators (not run by regen.sh, which runs only the
// top-level *.mjs): writing a fixture, the value encoding both sides compare,
// a seeded PRNG and the fake clock. The Kotlin twin of each is in
// core/src/test/kotlin/io/bfstats/sidecar/Parity.kt; keep the two in step.
import fs from 'node:fs';

export const SIDECAR = new URL('../../../bf1942-models/sidecar/', import.meta.url);
export const sidecar = (name) => import(new URL(name, SIDECAR).href);

export function write(name, obj) {
  const url = new URL(`../../core/src/test/resources/parity/${name}.json`, import.meta.url);
  const text = JSON.stringify(obj);
  fs.writeFileSync(url, text);
  console.log(`${name}.json: ${text.length} bytes`);
}

export const hex = (b) => Buffer.from(b).toString('hex');

// A value as the fixture holds it: bytes become "hex:<hex>", the rest is JSON.
// The Kotlin side encodes its values the same way and compares the strings.
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

// xorshift32 in [0, 1), the stream the fixtures record as plain numbers.
export function prng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

// A fake clock with setTimeout / setInterval semantics: timers fire in order
// of due time, then of creation; an interval is due again `ms` after it fired.
// install() swaps it in for Date.now and the global timer functions.
export class FakeClock {
  constructor(t = 1_000_000) { this.t = t; this.q = []; this.seq = 0; }
  // Date.now is a whole millisecond even when a jittered timer fires between two.
  now() { return Math.floor(this.t); }
  setTimeout(fn, ms) { const h = { at: this.t + Number(ms), fn, id: this.seq++, every: null }; this.q.push(h); return h; }
  setInterval(fn, ms) { const h = { at: this.t + Number(ms), fn, id: this.seq++, every: Number(ms) }; this.q.push(h); return h; }
  clear(h) { if (h) { h.dead = true; this.q = this.q.filter((x) => x !== h); } }
  advance(ms) {
    const until = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const h = this.q[0];
      if (!h || h.at > until) break;
      this.t = h.at;
      if (h.every != null) { h.at += h.every; h.id = this.seq++; } else this.q.shift();
      h.fn();
    }
    this.t = until;
  }
  install() {
    const saved = { now: Date.now, st: globalThis.setTimeout, si: globalThis.setInterval, ct: globalThis.clearTimeout, ci: globalThis.clearInterval };
    Date.now = () => this.now();
    globalThis.setTimeout = (fn, ms) => this.setTimeout(fn, ms);
    globalThis.setInterval = (fn, ms) => this.setInterval(fn, ms);
    globalThis.clearTimeout = (h) => this.clear(h);
    globalThis.clearInterval = (h) => this.clear(h);
    return () => {
      Date.now = saved.now; globalThis.setTimeout = saved.st; globalThis.setInterval = saved.si;
      globalThis.clearTimeout = saved.ct; globalThis.clearInterval = saved.ci;
    };
  }
}
