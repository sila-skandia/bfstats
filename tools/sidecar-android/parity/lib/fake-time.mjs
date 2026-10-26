// The Node half of core's ManualScheduler (Scheduler.kt): Date.now,
// performance.now, setTimeout and setInterval replaced by one virtual clock,
// so a generator drives the real Node module and the Kotlin test drives the
// port through the same instants. The two must agree exactly:
//   - time stands still until advanceTo(t);
//   - advanceTo runs every timer due by t in order of due time, ties in the
//     order they were armed; an interval re-arms (due += period, armed anew)
//     before it runs; the clock reads each timer's due time while it runs;
//   - Date.now() is WALL0 + the virtual ms, performance.now() the virtual ms.
export const WALL0 = 1.8e12;

export function installFakeTime(start = 0) {
  const real = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    perf: Object.getOwnPropertyDescriptor(performance, 'now') };
  const st = { now: start, seq: 0, timers: [] };
  const arm = (due, period, fn) => {
    const t = { due, period, fn, seq: st.seq++, cancelled: false, unref() { return this; }, ref() { return this; } };
    st.timers.push(t);
    return t;
  };
  const cancel = (t) => { if (t) { t.cancelled = true; st.timers = st.timers.filter((x) => x !== t); } };
  Date.now = () => WALL0 + st.now;
  Object.defineProperty(performance, 'now', { value: () => st.now, configurable: true, writable: true });
  globalThis.setTimeout = (fn, ms = 0) => arm(st.now + Math.max(0, Number(ms) || 0), null, fn);
  globalThis.setInterval = (fn, ms) => arm(st.now + Number(ms), Number(ms), fn);
  globalThis.clearTimeout = cancel;
  globalThis.clearInterval = cancel;
  const api = {
    get now() { return st.now; },
    advanceTo(t) {
      for (;;) {
        let next = null;
        for (const x of st.timers) if (!next || x.due < next.due || (x.due === next.due && x.seq < next.seq)) next = x;
        if (!next || next.due > t) break;
        st.timers = st.timers.filter((x) => x !== next);
        if (next.due > st.now) st.now = next.due;
        if (next.period != null) { next.due += next.period; next.seq = st.seq++; st.timers.push(next); }
        next.fn();
      }
      if (t > st.now) st.now = t;
    },
    get pending() { return st.timers.length; },
    restore() {
      Date.now = real.now;
      globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout;
      globalThis.setInterval = real.setInterval; globalThis.clearInterval = real.clearInterval;
      if (real.perf) Object.defineProperty(performance, 'now', real.perf); else delete performance.now;
    },
  };
  return api;
}

// A seeded generator (the same LCG the repo's harnesses use).
export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

// JSON with Buffers / Uint8Arrays as { $hex }, the form the Kotlin tests write ByteArrays in.
export function plain(v) {
  if (v instanceof Uint8Array) return { $hex: Buffer.from(v).toString('hex') };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = plain(x); return o; }
  return v;
}
