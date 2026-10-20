// The level's asset set, requested in one burst instead of discovered one
// glb at a time (features/asset-batch-downloads).
//
// Opening a level pulls a few thousand files: the baked scene's textures, one
// content-addressed glb per model in play, and each model's own textures. The
// page learns each of those URLs only when it parses the glb that names them,
// so the requests arrive in waves — measure it on the live site and a vanilla
// replay's storm runs for twenty seconds while the bytes themselves take nine
// (features/asset-batch-downloads/README.md carries the waterfall). Nothing on
// the server can fix that: the wave is the level's own dependency chain.
//
// So the level ships the list. `<maps>/<level>/assets.json` is written by
// `capture_level_assets.mjs`, which opens the level once headless and records
// every asset the page asked for; this module reads it at the start of a level
// and asks for all of it at once, at low priority so the scene's own glb keeps
// the bandwidth it needs, into the browser's HTTP cache. The page's normal
// per-file loads then find them already there.
//
// The file is a convenience, never a dependency: a level with no `assets.json`
// (one baked before this existed), a manifest that 404s or fails to parse, or
// an entry that errors all fall back to the plain fetch the page would have
// made anyway. Every entry is immutable-addressed (`/textures/`, `/glbs/`), so
// a second visit costs nothing: `cache: 'force-cache'` answers from disk.
//
// No three.js import: this is queue and cache work, and the Node harness runs
// it against a stubbed fetch.

/** How many requests are in flight at once. Enough that a level's whole set is
 *  asked for inside one or two round trips rather than a tenth of it per RTT:
 *  measured at 80 ms latency, ten at a time spreads 892 files over seven
 *  seconds of issuing alone, which is the wave this module exists to remove.
 *  Chrome caps an origin at about a hundred concurrent HTTP/2 streams, so more
 *  than that only queues inside the browser. */
const CONCURRENCY = 64;

/** The manifest a level's assets are listed in, beside its baked scene. */
export const MANIFEST_NAME = 'assets.json';

/** The level directory a `maps.json` row points at: its scene's dirname
 *  (`aberdeen/scene.glb` -> `aberdeen`), or the name lowercased with spaces
 *  as underscores for a row that has no glb. */
export function levelDirOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.glb === 'string' && entry.glb.includes('/')) {
    return entry.glb.slice(0, entry.glb.lastIndexOf('/'));
  }
  if (typeof entry.name === 'string' && entry.name.trim()) {
    return entry.name.trim().toLowerCase().replace(/\s+/g, '_');
  }
  return null;
}

/** The document the page is on, for turning the maps tree's relative base into
 *  an absolute one (`new URL` rejects a relative base). Node has neither, and
 *  the harness only reads the URL it is handed, so a placeholder will do. */
function pageBase() {
  return globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/';
}

/**
 * `page`-free queue over the browser's HTTP cache. `fetcher` is `fetch`, handed
 * in so the harness can watch the calls; `onProgress` hears `{ done, total,
 * bytes }` as requests settle, for a loader that wants to say how much is left.
 */
export function createAssetPrefetch({ fetcher = null, onProgress = null } = {}) {
  const doFetch = fetcher ?? globalThis.fetch?.bind(globalThis);
  // Every URL this page has already asked for, once per page. A level switch
  // repeats most of a mod's set (the shared store and the soldier poses), and
  // asking the cache again costs a round trip for nothing.
  const asked = new Set();
  let queue = [];
  let active = 0;
  let generation = 0;
  let state = { level: null, total: 0, done: 0, bytes: 0, failed: 0, running: false };

  /** Read and drop a response body. The read is what commits the entry to the
   *  HTTP cache; dropping the chunks keeps a 35 MB texture set out of the JS
   *  heap. One chunk at a time, never the whole body. */
  async function drain(response) {
    const reader = response.body?.getReader?.();
    if (!reader) return 0;
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
    }
    return bytes;
  }

  async function one(url) {
    try {
      const response = await doFetch(url, { cache: 'force-cache', priority: 'low' });
      if (response?.ok) state.done += 1;
      else state.failed += 1;
      if (response?.ok) state.bytes += await drain(response);
    } catch {
      state.failed += 1;
    }
    onProgress?.({ done: state.done, total: state.total, bytes: state.bytes });
  }

  /** Start the next queued URL while there is room. The queue is drained by
   *  the settling of its own requests, so there is no timer and no loop that
   *  outlives the work. */
  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const url = queue.shift();
      active += 1;
      one(url).finally(() => {
        active -= 1;
        if (!queue.length && !active) state.running = false;
        else pump();
      });
    }
  }

  /**
   * Read the level's manifest and queue everything it names. `base` is the
   * maps tree the level hangs off (`maps`, `maps/mods/xpack1`); `entry` is its
   * `maps.json` row. Never throws: a level with no manifest is the state this
   * page shipped in for a year.
   */
  async function open(base, entry) {
    const dir = levelDirOf(entry);
    if (!dir || !base) return { queued: 0, reason: 'no-level' };
    const mine = ++generation;
    // A switch abandons the previous level's queue: its bytes are no longer
    // wanted and they would compete with the level being opened.
    queue = [];
    state = { level: dir, total: 0, done: 0, bytes: 0, failed: 0, running: false };
    const levelBase = new URL(`${base}/${dir}/`, pageBase());
    let manifest;
    try {
      const response = await doFetch(`${base}/${dir}/${MANIFEST_NAME}`, { cache: 'no-cache' });
      if (!response?.ok) return { queued: 0, reason: `manifest ${response?.status ?? 'error'}` };
      manifest = await response.json();
    } catch (error) {
      return { queued: 0, reason: `manifest ${error?.message ?? error}` };
    }
    if (mine !== generation) return { queued: 0, reason: 'superseded' };
    const files = Array.isArray(manifest?.files) ? manifest.files : [];
    const urls = [];
    for (const file of files) {
      if (typeof file !== 'string' || !file) continue;
      // Root-absolute (the capture writes them that way) or level-relative.
      const url = new URL(file, levelBase);
      if (asked.has(url.pathname)) continue;
      asked.add(url.pathname);
      urls.push(url.href);
    }
    state.total = urls.length;
    queue = urls;
    state.running = urls.length > 0;
    pump();
    return { queued: state.total, bytes: Number(manifest?.bytes) || 0 };
  }

  /** What the prefetch is doing, for a probe or a loader that wants a number. */
  function status() {
    return { ...state, queued: queue.length, active };
  }

  return { open, status };
}
