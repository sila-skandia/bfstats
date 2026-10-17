// The map page's WebGL context, lost and brought back without a reload
// (features/webgl-context-restore).
//
// Under GPU load Chrome drops the page's context (`GL_CONTEXT_LOST_KHR ...
// Internal Vulkan error (-4)`, a device lost). A reload costs the whole level
// load, and on a sidecar session that is the round. Nothing but the drawing
// needs the GPU: the world, the bots, the room and sidecar links and the audio
// keep running through the loss, so only the 3D draw pauses.
//
// The states:
//   live     drawing.
//   lost     the context is gone. `preventDefault()` on the event is what lets
//            the browser restore it: after a GPU process crash or a device
//            lost, Chrome restores a context whose page asked for that once
//            its GPU process is back (unless it has blocked WebGL for the
//            site, which then needs a reload: the fallback card). The page
//            also calls `restoreContext()`, and again, which only ever
//            applies to a loss `loseContext()` made -- the headless check's
//            and the twelve-bot sweep's simulated one; for a real loss it
//            records an INVALID_OPERATION GL error and does nothing.
//   warming  three has rebuilt its GL state (its own `webglcontextrestored`
//            listener, registered in its constructor, runs before this one)
//            and forgotten every program, buffer and texture it had. They
//            would all come back on the first draw, linked inside that frame:
//            the multi-second stall that took the context in the first place
//            (features/mesh-viewer-performance, rule 6). So `rewarm()` links
//            and uploads them first, off the frame, and drawing resumes when
//            it settles (or after `warmCapMs`, whichever comes first).
//
// The card is the fallback only: when no restore arrives within `fallbackMs`,
// `onFallback` puts up the Reload card. A restore after that still resumes.

export const GL_RESTORE_RETRY_MS = 1500;
export const GL_FALLBACK_MS = 10000;
export const GL_WARM_CAP_MS = 20000;

/**
 * `canvas`: the renderer's canvas. `loseExtension()`: the context's
 * `WEBGL_lose_context`, read once while the context is live (a lost context
 * answers `getExtension` with null). `rewarm()`: a promise that links the
 * programs and uploads the textures the page draws with. `onLost`,
 * `onResumed`, `onFallback`: the page's reactions. `timers` and `now` are
 * injectable for the node harness.
 */
export function createGlContextGuard({
  canvas,
  loseExtension = () => null,
  rewarm = () => Promise.resolve(),
  onLost = () => {},
  onResumed = () => {},
  onFallback = () => {},
  retryMs = GL_RESTORE_RETRY_MS,
  fallbackMs = GL_FALLBACK_MS,
  warmCapMs = GL_WARM_CAP_MS,
  timers = globalThis,
  now = () => performance.now(),
  log = console,
}) {
  let state = 'live';
  let extension = null;
  try { extension = loseExtension(); } catch { extension = null; }
  // Every loss starts a new episode; a timer or a warm-up from an older one
  // finds the token moved on and does nothing.
  let episode = 0;
  let retryTimer = null;
  let fallbackTimer = null;
  let fellBack = false;
  let lostAt = 0;
  const history = [];

  function clearTimers() {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    if (fallbackTimer !== null) timers.clearTimeout(fallbackTimer);
    retryTimer = fallbackTimer = null;
  }

  function askRestore(token) {
    retryTimer = null;
    if (token !== episode || state !== 'lost') return;
    // A no-op (an INVALID_OPERATION GL error) unless `loseContext()` made
    // the loss; caught all the same, a nicety that must never throw.
    try { extension?.restoreContext(); } catch { /* nothing to restore */ }
    retryTimer = timers.setTimeout(() => askRestore(token), retryMs * 2);
  }

  function lost(event) {
    event?.preventDefault?.();
    const token = ++episode;
    clearTimers();
    state = 'lost';
    lostAt = now();
    history.push({ event: 'lost', at: lostAt });
    log.warn?.('map: WebGL context lost; drawing paused, the game keeps running');
    onLost();
    retryTimer = timers.setTimeout(() => askRestore(token), retryMs);
    fallbackTimer = timers.setTimeout(() => {
      fallbackTimer = null;
      if (token !== episode || state !== 'lost') return;
      fellBack = true;
      history.push({ event: 'fallback', at: now() });
      onFallback();
    }, fallbackMs);
  }

  function restored() {
    const token = episode;
    clearTimers();
    state = 'warming';
    const restoredAt = now();
    history.push({ event: 'restored', at: restoredAt });
    let settled = false;
    const resume = how => {
      if (settled || token !== episode || state !== 'warming') return;
      settled = true;
      state = 'live';
      const at = now();
      history.push({ event: 'resumed', at, how, lostMs: at - lostAt, warmMs: at - restoredAt });
      log.info?.(`map: WebGL context back after ${Math.round(at - lostAt)} ms (warm-up ${Math.round(at - restoredAt)} ms, ${how})`);
      const hadFallback = fellBack;
      fellBack = false;
      onResumed({ fellBack: hadFallback });
    };
    const cap = timers.setTimeout(() => resume('cap'), warmCapMs);
    let warming;
    try { warming = Promise.resolve(rewarm()); } catch (error) { warming = Promise.reject(error); }
    warming.then(() => resume('warm'), error => {
      log.warn?.('map: warm-up after context restore failed; drawing anyway', error);
      resume('warm-failed');
    }).finally(() => timers.clearTimeout(cap));
  }

  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);

  return {
    /** True while the 3D passes may draw. */
    drawing: () => state === 'live',
    /** True from the loss until drawing resumes. */
    down: () => state !== 'live',
    state: () => state,
    history: () => history.slice(),
  };
}
