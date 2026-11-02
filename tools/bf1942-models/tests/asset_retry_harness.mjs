// Drives `viewer/asset-retry.js` outside a browser and prints one JSON blob.
// Node's own Response and ReadableStream stand in for the browser's; `fetch`
// is a scripted stub and the waits resolve at once (their lengths are logged).
import { createRetryingFetch, patchImageLoader, RETRY_DELAYS_MS } from './asset-retry.mjs';

const out = { delays: RETRY_DELAYS_MS };
const enc = new TextEncoder();
const dec = new TextDecoder();

/** A body that hands out `chunks` and then, if `breakAfter` is set, errors
 *  the way a dropped connection does. */
function body(chunks, breakAfter = null) {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (breakAfter !== null && i === breakAfter) { c.error(new TypeError('network error')); return; }
      if (i >= chunks.length) { c.close(); return; }
      c.enqueue(enc.encode(chunks[i++]));
    },
  });
}

/** A fetch that plays `script` in order, one step per call: 'throw', a status
 *  number, or { status, chunks, breakAfter, etag }. */
function scripted(script) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET' });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'throw') throw new TypeError('Failed to fetch');
    const s = typeof step === 'number' ? { status: step } : step;
    const headers = {};
    if (s.etag) headers.etag = s.etag;
    if (s.contentType) headers['content-type'] = s.contentType;
    return new Response(body(s.chunks ?? ['ok'], s.breakAfter ?? null), { status: s.status ?? 200, headers });
  };
  return { fetch, calls };
}

async function run(script, init, { read = true } = {}) {
  const waits = [];
  const retries = [];
  const s = scripted(script);
  const f = createRetryingFetch(s.fetch, {
    wait: async ms => { waits.push(ms); },
    onRetry: info => retries.push(info.reason),
  });
  const r = { calls: s.calls.length };
  try {
    const res = await f('https://x/a.webp', init);
    r.status = res.status;
    r.url = res.url;
    if (read) r.text = dec.decode(await res.arrayBuffer());
  } catch (err) {
    r.error = String(err?.message ?? err);
  }
  r.calls = s.calls.length;
  r.waits = waits;
  r.retries = retries;
  return r;
}

out.networkThenOk = await run(['throw', 'throw', { status: 200, chunks: ['hello'] }]);
out.transientThenOk = await run([503, 200]);
out.notFound = await run([404]);
out.alwaysDown = await run(['throw']);
out.post = await run(['throw'], { method: 'POST', body: 'x' });
const ac = new AbortController();
ac.abort();
out.aborted = await run(['throw'], { signal: ac.signal });

// A static file whose body breaks after two chunks, then comes back whole.
out.resumed = await run([
  { etag: '"v1"', chunks: ['aa', 'bb', 'cc', 'dd'], breakAfter: 2 },
  { etag: '"v1"', chunks: ['a', 'abbc', 'cdd'] },
]);
// The file changed between the two requests: the read fails, no retry.
out.changed = await run([
  { etag: '"v1"', chunks: ['aa', 'bb', 'cc'], breakAfter: 1 },
  { etag: '"v2"', chunks: ['xx', 'yy', 'zz'] },
]);
// No validator (a live stream): passed through, the break surfaces.
out.noValidator = await run([{ chunks: ['aa', 'bb'], breakAfter: 1 }, { chunks: ['aa', 'bb'] }]);
// An event stream is never resumed even with an ETag.
out.eventStream = await run([
  { etag: '"v1"', contentType: 'text/event-stream', chunks: ['aa', 'bb'], breakAfter: 1 },
  { etag: '"v1"', chunks: ['aa', 'bb'] },
]);
// A break that outlasts every retry fails the read.
out.bodyAlwaysBreaks = await run([{ etag: '"v1"', chunks: ['aa', 'bb'], breakAfter: 1 }]);

// --- the <img> route -------------------------------------------------------

class FakeImage {
  static outcomes = [];
  static made = 0;
  constructor() { this.listeners = {}; FakeImage.made += 1; }
  addEventListener(t, fn) { this.listeners[t] = fn; }
  removeEventListener(t) { delete this.listeners[t]; }
  set src(v) {
    this._src = v;
    const ok = FakeImage.outcomes.shift() ?? true;
    setTimeout(() => (ok ? this.listeners.load?.call(this) : this.listeners.error?.call(this, { type: 'error' })), 0);
  }
  get src() { return this._src; }
}

async function runImage(outcomes, probeStatus, url = 'https://x/t.png') {
  FakeImage.outcomes = [...outcomes];
  FakeImage.made = 0;
  const manager = { started: 0, ended: 0, errors: 0,
    resolveURL: u => u, itemStart() { this.started++; }, itemEnd() { this.ended++; }, itemError() { this.errors++; } };
  class ImageLoader { constructor() { this.manager = manager; this.crossOrigin = 'anonymous'; } }
  const cache = new Map();
  const Cache = { get: k => cache.get(k), add: (k, v) => cache.set(k, v) };
  const probes = [];
  patchImageLoader(ImageLoader, Cache, {
    createImage: () => new FakeImage(),
    probe: async u => { probes.push(u); return probeStatus; },
    wait: async () => {},
  });
  const result = await new Promise(resolve => {
    new ImageLoader().load(url, img => resolve({ loaded: img.src }), undefined, ev => resolve({ error: ev.type }));
  });
  return { ...result, images: FakeImage.made, probes: probes.length,
    started: manager.started, ended: manager.ended, errors: manager.errors };
}

out.imageRetried = await runImage([false, false, true], null);
out.image404 = await runImage([false], 404);
out.image503 = await runImage([false, true], 503);
out.imageAlwaysDown = await runImage([false, false, false, false, false], null);
out.imageData = await runImage([false], null, 'data:image/png;base64,AA==');

console.log(JSON.stringify(out));
