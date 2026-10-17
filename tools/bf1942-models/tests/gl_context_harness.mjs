// `viewer/gl-context.js` under node: the map page's lost-context lifecycle
// (see `test_gl_context.py`). A fake canvas, a fake WEBGL_lose_context and a
// hand-stepped clock stand in for the browser; the module is the file the
// page loads.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerDir } from '../sim/env.mjs';

const { createGlContextGuard, GL_RESTORE_RETRY_MS, GL_FALLBACK_MS, GL_WARM_CAP_MS } =
  await import(pathToFileURL(path.join(viewerDir(), 'gl-context.js')).href);

/** A clock whose timers run only when `advance` passes them. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) { pending.set(++id, { fn, at: t + ms }); return id; },
      clearTimeout(handle) { pending.delete(handle); },
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [k, v] of pending) if (v.at <= end && (!next || v.at < next[1].at)) next = [k, v];
        if (!next) break;
        pending.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fakeCanvas() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type) {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of listeners[type] ?? []) fn(event);
      return event;
    },
  };
}

function rig({ rewarm, extension = true } = {}) {
  const clock = fakeClock();
  const canvas = fakeCanvas();
  const calls = { restoreContext: 0, lost: 0, resumed: [], fallback: 0, rewarm: 0 };
  const ext = extension ? { restoreContext() { calls.restoreContext++; } } : null;
  const guard = createGlContextGuard({
    canvas,
    loseExtension: () => ext,
    rewarm: () => { calls.rewarm++; return rewarm ? rewarm() : Promise.resolve(); },
    onLost: () => { calls.lost++; },
    onResumed: info => { calls.resumed.push(info); },
    onFallback: () => { calls.fallback++; },
    timers: clock.timers,
    now: clock.now,
    log: {},
  });
  return { clock, canvas, calls, guard };
}

const out = { constants: { GL_RESTORE_RETRY_MS, GL_FALLBACK_MS, GL_WARM_CAP_MS } };

// A loss and a restore that comes after the page asks for it.
{
  const { clock, canvas, calls, guard } = rig();
  const before = guard.drawing();
  const event = canvas.fire('webglcontextlost');
  const lost = { drawing: guard.drawing(), down: guard.down(), state: guard.state(), prevented: event.defaultPrevented, onLost: calls.lost };
  await clock.advance(GL_RESTORE_RETRY_MS - 1);
  const beforeAsk = calls.restoreContext;
  await clock.advance(1);
  const firstAsk = calls.restoreContext;
  await clock.advance(GL_RESTORE_RETRY_MS * 2);
  const secondAsk = calls.restoreContext;
  canvas.fire('webglcontextrestored');
  const warming = { state: guard.state(), drawing: guard.drawing(), rewarm: calls.rewarm };
  await clock.advance(0);
  out.basic = {
    before, lost, beforeAsk, firstAsk, secondAsk, warming,
    after: { state: guard.state(), drawing: guard.drawing(), resumed: calls.resumed },
    history: guard.history().map(h => h.event),
  };
  // Nothing left scheduled: no fallback card after a resume, no more asks.
  await clock.advance(GL_FALLBACK_MS * 3);
  out.basic.later = { fallback: calls.fallback, restoreContext: calls.restoreContext };
}

// Drawing waits for the warm-up.
{
  let release;
  const { clock, canvas, guard } = rig({ rewarm: () => new Promise(r => { release = r; }) });
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextrestored');
  await clock.advance(5000);
  const held = guard.drawing();
  release();
  await clock.advance(0);
  out.waitsForWarm = { held, released: guard.drawing() };
}

// A warm-up that never settles is capped.
{
  const { clock, canvas, guard } = rig({ rewarm: () => new Promise(() => {}) });
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextrestored');
  await clock.advance(GL_WARM_CAP_MS - 1);
  const atCapMinus = guard.drawing();
  await clock.advance(1);
  out.cap = { atCapMinus, atCap: guard.drawing(), how: guard.history().at(-1).how };
}

// A warm-up that throws, synchronously or not, still resumes.
{
  const a = rig({ rewarm: () => { throw new Error('sync'); } });
  a.canvas.fire('webglcontextlost'); a.canvas.fire('webglcontextrestored');
  await a.clock.advance(0);
  const b = rig({ rewarm: () => Promise.reject(new Error('async')) });
  b.canvas.fire('webglcontextlost'); b.canvas.fire('webglcontextrestored');
  await b.clock.advance(0);
  out.throws = { sync: a.guard.drawing(), async: b.guard.drawing() };
}

// No restore: the card after GL_FALLBACK_MS, once; a late restore still resumes.
{
  const { clock, canvas, calls, guard } = rig();
  canvas.fire('webglcontextlost');
  await clock.advance(GL_FALLBACK_MS - 1);
  const beforeCard = calls.fallback;
  await clock.advance(1);
  const card = calls.fallback;
  await clock.advance(GL_FALLBACK_MS * 2);
  const stillOne = calls.fallback;
  canvas.fire('webglcontextrestored');
  await clock.advance(0);
  out.fallback = { beforeCard, card, stillOne, drawing: guard.drawing(), resumed: calls.resumed };
}

// A second loss while warming: the first warm-up's end does not resume.
{
  const releases = [];
  const { clock, canvas, guard } = rig({ rewarm: () => new Promise(r => releases.push(r)) });
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextrestored');
  canvas.fire('webglcontextlost');
  releases[0]();
  await clock.advance(0);
  const staleResumed = guard.drawing();
  const stateAfterStale = guard.state();
  canvas.fire('webglcontextrestored');
  releases[1]();
  await clock.advance(0);
  out.relost = { staleResumed, stateAfterStale, final: guard.drawing() };
}

// No WEBGL_lose_context: the guard still pauses and resumes.
{
  const { clock, canvas, guard } = rig({ extension: false });
  canvas.fire('webglcontextlost');
  await clock.advance(GL_RESTORE_RETRY_MS * 4);
  canvas.fire('webglcontextrestored');
  await clock.advance(0);
  out.noExtension = { drawing: guard.drawing() };
}

process.stdout.write(JSON.stringify(out));
