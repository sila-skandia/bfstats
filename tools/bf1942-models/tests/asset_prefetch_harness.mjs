// Drives `viewer/asset-prefetch.js` outside a browser and prints one JSON blob.
// The module imports nothing, so this is the whole harness: `fetch` is stubbed.
import { createAssetPrefetch, levelDirOf, MANIFEST_NAME } from './asset-prefetch.mjs';

const out = {};

// The level directory a maps.json row points at.
out.levelDir = {
  fromGlb: levelDirOf({ name: 'Aberdeen', glb: 'aberdeen/scene.glb' }),
  fromName: levelDirOf({ name: 'Battle of Britain' }),
  nothing: levelDirOf({}),
};

/** A fetch that answers a table of URLs. Every call is recorded, and each
 *  response's body reader hands back one chunk so `drain` has something to
 *  read. A URL in `missing` answers 404, one in `broken` throws. */
function stubFetch({ manifest = null, missing = [], broken = [], bytes = 100 } = {}) {
  const calls = [];
  let inFlightBox = { now: 0, peak: 0 };
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    inFlightBox.now += 1;
    inFlightBox.peak = Math.max(inFlightBox.peak, inFlightBox.now);
    await new Promise(r => setImmediate(r));
    inFlightBox.now -= 1;
    if (broken.includes(String(url))) throw new Error('network down');
    if (missing.includes(String(url))) return { ok: false, status: 404, json: async () => ({}) };
    if (String(url).endsWith(MANIFEST_NAME)) {
      if (!manifest) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => manifest, body: null };
    }
    let sent = false;
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(bytes) },
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true } : (sent = true, { done: false, value: { byteLength: bytes } })),
        }),
      },
    };
  };
  return { fetch, calls, inFlight: inFlightBox };
}

// A whole manifest, asked for at once, at low priority, ten at a time.
{
  const files = Array.from({ length: 35 }, (_, i) => `/textures/${String(i).padStart(2, '0')}/t${i}.webp`);
  const stub = stubFetch({ manifest: { version: 1, files, bytes: 3500 } });
  const progress = [];
  const prefetch = createAssetPrefetch({ fetcher: stub.fetch, onProgress: p => progress.push(p.done) });
  const opened = await prefetch.open('maps', { name: 'Aberdeen', glb: 'aberdeen/scene.glb' });
  const deadline = Date.now() + 5000;
  while (prefetch.status().running && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
  out.full = {
    opened,
    fileCalls: stub.calls.length - 1,
    manifestUrl: stub.calls[0].url,
    firstFile: stub.calls[1].url,
    init: stub.calls[1].init,
    peak: stub.inFlight.peak,
    status: prefetch.status(),
    progressLast: progress.at(-1),
  };
}

// Opening the same level again asks for nothing: the page already has it.
{
  const files = ['/textures/aa/a.webp', '/glbs/b.glb'];
  const stub = stubFetch({ manifest: { files } });
  const prefetch = createAssetPrefetch({ fetcher: stub.fetch });
  await prefetch.open('maps', { glb: 'aberdeen/scene.glb' });
  await new Promise(r => setTimeout(r, 50));
  const before = stub.calls.length;
  const second = await prefetch.open('maps', { glb: 'aberdeen/scene.glb' });
  await new Promise(r => setTimeout(r, 50));
  out.dedupe = { second, extraCalls: stub.calls.length - before, total: before };
}

// No manifest is not an error: the level loads the way it always did.
{
  const stub = stubFetch({ manifest: null });
  const prefetch = createAssetPrefetch({ fetcher: stub.fetch });
  const opened = await prefetch.open('maps', { glb: 'aberdeen/scene.glb' });
  out.noManifest = { opened, calls: stub.calls.length };
}

// A broken entry costs that entry only, and a relative path resolves against
// the level's directory.
{
  const files = ['textures/aa/a.webp', '/glbs/broken.glb'];
  const stub = stubFetch({ manifest: { files }, broken: ['http://localhost/glbs/broken.glb'] });
  const prefetch = createAssetPrefetch({ fetcher: stub.fetch });
  await prefetch.open('maps', { glb: 'aberdeen/scene.glb' });
  for (let i = 0; i < 200 && prefetch.status().running; i += 1) await new Promise(r => setTimeout(r, 5));
  out.partial = {
    urls: stub.calls.slice(1).map(c => c.url),
    status: prefetch.status(),
  };
}

// A level with no directory is a no-op.
{
  const prefetch = createAssetPrefetch({ fetcher: async () => { throw new Error('should not fetch'); } });
  out.noLevel = await prefetch.open('maps', {});
}

console.log(JSON.stringify(out));
