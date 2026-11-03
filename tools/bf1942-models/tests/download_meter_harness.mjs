// Drives `viewer/download-meter.js` and progress.js's `downloadLine` outside a
// browser and prints one JSON blob. Node's own Response and ReadableStream
// stand in for the browser's; `fetch` is a stub and the clock is a counter.
import { createDownloadMeter, declaredSize, IDLE_MS } from './download-meter.js';
import { downloadLine } from './progress.js';

const out = { idleMs: IDLE_MS };
const enc = new TextEncoder();

let clock = 0;
const now = () => clock;

/** A body that hands out `chunks` (strings) then closes, or errors after
 *  `breakAfter` chunks the way a dropped connection does. */
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

function stub(routes) {
  return async (input, init = {}) => {
    const r = routes[String(input)];
    if (!r) throw new TypeError('Failed to fetch');
    return new Response(body(r.chunks ?? [], r.breakAfter ?? null), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
}

// Sizes from the headers.
out.sizes = {
  fileSize: declaredSize(new Headers({ 'x-file-size': '2000', 'content-length': '900', 'content-encoding': 'gzip' })),
  plainLength: declaredSize(new Headers({ 'content-length': '900' })),
  gzipNoFileSize: declaredSize(new Headers({ 'content-length': '900', 'content-encoding': 'gzip' })),
  none: declaredSize(new Headers({})),
};

// One file read part way, one read whole, one of unknown size; a 404, a POST.
{
  clock = 0;
  const meter = createDownloadMeter({ now });
  const f = meter.meterFetch(stub({
    'https://x/scene.glb': { chunks: ['aaaa', 'bbbb', 'cc'], headers: { 'x-file-size': '10' } },
    'https://x/report.json': { chunks: ['{"a":1}'], headers: { 'content-length': '7' } },
    'https://x/stream': { chunks: ['xyz'], headers: { 'content-encoding': 'gzip' } },
    'https://x/missing': { status: 404 },
  }));
  const scene = await f('https://x/scene.glb');
  const reader = scene.body.getReader();
  await reader.read();
  out.partway = meter.snapshot();
  out.json = await (await f('https://x/report.json')).json();
  out.afterJson = meter.snapshot();
  await reader.read();
  await reader.read();
  await reader.read();
  out.sceneRead = meter.snapshot();
  await (await f('https://x/stream')).arrayBuffer();
  out.unknownSize = meter.snapshot();
  out.missing = (await f('https://x/missing')).status;
  await f('https://x/report.json', { method: 'POST' }).catch(() => null);
  out.afterMissing = meter.snapshot();
  out.urlKept = scene.url;
  meter.reset();
  out.afterReset = meter.snapshot();
}

// A network error, a body that breaks, a body nobody reads.
{
  clock = 0;
  const meter = createDownloadMeter({ now });
  const f = meter.meterFetch(stub({
    'https://x/broken': { chunks: ['aa', 'bb'], breakAfter: 1 },
    'https://x/unread': { chunks: ['aa', 'bb'], headers: { 'content-length': '4' } },
  }));
  out.netError = await f('https://x/gone').then(() => 'ok', e => e.message);
  out.broken = await f('https://x/broken').then(r => r.arrayBuffer()).then(() => 'ok', e => e.message);
  await f('https://x/unread');
  out.unreadFresh = meter.snapshot();
  clock += IDLE_MS + 1;
  out.unreadIdle = meter.snapshot();
  meter.reset();
  out.unreadAfterReset = meter.snapshot();
}

// A load that started before reset() is kept; the finished ones are not.
{
  clock = 0;
  const meter = createDownloadMeter({ now });
  const f = meter.meterFetch(stub({
    'https://x/a': { chunks: ['aa'], headers: { 'content-length': '2' } },
    'https://x/b': { chunks: ['bb', 'bb'], headers: { 'content-length': '4' } },
  }));
  await (await f('https://x/a')).text();
  const b = (await f('https://x/b')).body.getReader();
  await b.read();
  meter.reset();
  out.carried = meter.snapshot();
}

// Three's <img> route: a file from the call to its load; a cached one is none.
{
  clock = 0;
  const meter = createDownloadMeter({ now, sizeOf: () => 1234 });
  const loads = [];
  class ImageLoader {
    constructor() { this.manager = { resolveURL: u => u }; }
    load(url, onLoad, onProgress, onError) { loads.push({ url, onLoad, onError }); }
  }
  const cache = new Map([['https://x/cached.png', {}]]);
  meter.meterImageLoader(ImageLoader, { get: k => cache.get(k) });
  meter.meterImageLoader(ImageLoader, { get: k => cache.get(k) });
  const loader = new ImageLoader();
  let loaded = 0;
  loader.load('https://x/t.png', () => { loaded += 1; });
  loader.load('https://x/bad.png', null, null, () => {});
  loader.load('https://x/cached.png', () => {});
  out.imagesPending = meter.snapshot();
  loads[0].onLoad({});
  loads[1].onError({});
  out.imagesDone = meter.snapshot();
  out.imageOnLoad = loaded;
}

// The line itself.
out.lines = {
  none: downloadLine({ files: 0, done: 0, loaded: 0, total: 0, active: 0 }, null, 'preparing the level'),
  active: downloadLine({ files: 41, done: 23, loaded: 54.3 * 1048576, total: 78 * 1048576, active: 18 }, 4.2 * 1048576),
  noRate: downloadLine({ files: 2, done: 0, loaded: 0, total: 0, active: 2 }, null),
  allIn: downloadLine({ files: 41, done: 41, loaded: 78 * 1048576, total: 78 * 1048576, active: 0 }, null, 'preparing the level'),
  oneIn: downloadLine({ files: 1, done: 1, loaded: 2048, total: 2048, active: 0 }),
};

console.log(JSON.stringify(out));
