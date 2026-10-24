// A drive's past ticks, kept so a correction can start again from one of them
// (the retail client's `readControlObjectState`, ledger TANK-25): each tick's
// inputs and the whole mutable state it ended in, and the copy back.
//
// `TrackedVehicle` keeps its own hand-written snapshot. This is the generic
// form for a drive whose state is spread over many small objects (an
// aircraft's surfaces, engines, legs and servo registers): a deep copy of
// plain data, vectors and quaternions (anything with `toArray`/`fromArray`),
// arrays and Maps, written back into the same live objects. Functions, scene
// nodes and the keys a drive names as fixed data are left alone.
//
// Imports nothing.

/** Ticks a drive keeps: 3 s, past any round trip. */
export const HISTORY_TICKS = 90;

const isNode = (v) => v && (v.isObject3D || v.isMaterial || v.isBufferGeometry);

/** A deep copy of `src`'s mutable data into `out` (reused). */
export function snapshotOf(src, skip, out) {
  if (src === null || typeof src !== 'object') return src;
  if (typeof src.toArray === 'function' && typeof src.fromArray === 'function' && !Array.isArray(src)) {
    return src.toArray(Array.isArray(out) ? out : []);
  }
  if (Array.isArray(src)) {
    const a = Array.isArray(out) ? out : [];
    a.length = src.length;
    for (let i = 0; i < src.length; i++) a[i] = snapshotOf(src[i], skip, a[i]);
    return a;
  }
  if (src instanceof Map) {
    const m = out instanceof Map ? out : new Map();
    m.clear();
    for (const [k, v] of src) m.set(k, snapshotOf(v, skip, undefined));
    return m;
  }
  if (isNode(src)) return undefined;
  const o = out && typeof out === 'object' && !Array.isArray(out) && !(out instanceof Map) ? out : {};
  for (const key of Object.keys(src)) {
    if (skip.has(key)) continue;
    const v = src[key];
    if (typeof v === 'function' || isNode(v)) continue;
    o[key] = snapshotOf(v, skip, o[key]);
  }
  return o;
}

/** Write a `snapshotOf` copy back into the live `dst`; returns the value to
 *  store where `dst` cannot be updated in place (a primitive). */
export function restoreInto(dst, snap, skip) {
  if (snap === null || typeof snap !== 'object') return snap;
  if (dst && typeof dst.fromArray === 'function' && !Array.isArray(dst)) { dst.fromArray(snap); return dst; }
  if (Array.isArray(dst) && Array.isArray(snap)) {
    dst.length = snap.length;
    for (let i = 0; i < snap.length; i++) dst[i] = restoreInto(dst[i], snap[i], skip);
    return dst;
  }
  if (dst instanceof Map && snap instanceof Map) {
    for (const k of [...dst.keys()]) if (!snap.has(k)) dst.delete(k);
    for (const [k, v] of snap) dst.set(k, restoreInto(dst.get(k), v, skip));
    return dst;
  }
  if (snap instanceof Map) return new Map([...snap].map(([k, v]) => [k, restoreInto(undefined, v, skip)]));
  if (Array.isArray(snap)) return snap.map((v) => restoreInto(undefined, v, skip));
  const o = dst && typeof dst === 'object' ? dst : {};
  for (const key of Object.keys(snap)) {
    if (skip.has(key)) continue;
    o[key] = restoreInto(o[key], snap[key], skip);
  }
  return o;
}
