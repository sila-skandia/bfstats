// A small seeded generator (mulberry32): 32 bits of state, uniform in [0, 1).
// Enough for a reproducible match; not for anything cryptographic.

export function mulberry32(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
