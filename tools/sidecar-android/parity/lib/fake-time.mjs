// The Node half of core's ManualScheduler (Scheduler.kt), the one fake clock
// every generator uses: Date.now, performance.now, setTimeout and setInterval
// replaced by one virtual clock, so a generator drives the real Node module
// and the Kotlin test drives the port through the same instants. The two must
// agree exactly:
//   - time stands still until advanceTo(t);
//   - advanceTo runs every timer due by t in order of due time, ties in the
//     order they were armed; an interval re-arms (due += period, armed anew)
//     before it runs; the clock reads each timer's due time while it runs;
//   - Date.now() is wall0 + the virtual ms (floored with floorWall, as a real
//     Date.now is a whole millisecond), performance.now() the virtual ms.
//
// installFakeTime(0) is ManualScheduler(0.0) (Date.now from WALL0);
// installFakeTime(1_000_000, { wall0: 0, floorWall: true }) is
// ManualScheduler(1e6, 0.0), the wire fixtures' clock.
export const WALL0 = 1.8e12;

export function installFakeTime(start = 0, { wall0 = WALL0, floorWall = false } = {}) {
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
  Date.now = floorWall ? () => Math.floor(wall0 + st.now) : () => wall0 + st.now;
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
    /** ManualScheduler.advance: advanceTo(now + ms). */
    advance(ms) { api.advanceTo(st.now + ms); },
    get pending() { return st.timers.length; },
    /** The earliest due time armed, or null. */
    get nextDue() { let d = null; for (const x of st.timers) if (d === null || x.due < d) d = x.due; return d; },
    /** advanceTo(t) one due instant at a time, letting promises settle after
     *  each (a promise settles after the timers of its instant, as on a real
     *  loop; ManualScheduler's `post` runs there too). */
    async stepTo(t) {
      const settle = () => new Promise((r) => setImmediate(r));
      await settle();
      for (;;) {
        const d = api.nextDue;
        if (d === null || d > t) break;
        api.advanceTo(d);
        await settle();
      }
      api.advanceTo(t);
      await settle();
    },
    restore() {
      Date.now = real.now;
      globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout;
      globalThis.setInterval = real.setInterval; globalThis.clearInterval = real.clearInterval;
      if (real.perf) Object.defineProperty(performance, 'now', real.perf); else delete performance.now;
    },
  };
  return api;
}
