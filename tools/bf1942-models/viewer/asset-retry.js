// Downloads that survive a flaky connection (features/asset-batch-downloads,
// "Retries").
//
// A level opens with a few hundred separate downloads: the scene glb, every
// texture it names, the terrain, water and sky images. When one of those fails
// the page does not stop; three hands the material no map and it draws white.
// On a connection that drops out for a few seconds that looks like a broken
// level: white walls, no rivers, flat ground (2026-11-02, Meuse River Line on
// a stalling line, every file on the server intact).
//
// So a failure gets a few more tries before it is reported:
//
// - `createRetryingFetch` wraps `fetch`. A GET that throws (network error) or
//   answers a transient status (5xx, 408, 429, Cloudflare's 52x) is asked for
//   again after a short wait. Anything else, a 404 included, is returned as is:
//   pages that probe for optional files still learn "not there" at once.
// - A download that dies part way through its body is resumed: the file is
//   asked for again and the bytes already handed over are skipped, so the
//   reader (and the progress bar counting its chunks) sees one unbroken
//   stream. Only for a static file, one with an ETag or Last-Modified, and
//   only if the second copy carries the same one. A live stream has neither
//   and is passed through untouched.
// - `patchImageLoader` does the same for three's `<img>` route (loose
//   textures, cube maps, and glb textures on browsers without
//   createImageBitmap). An `<img>` cannot see a status, so after an error it
//   asks the server with a HEAD: a 404/403/410 fails at once, anything else
//   is retried.
//
// An aborted request is never retried. Nothing here imports three, so the
// Node harness drives it with stubs; `asset-retry-install.js` puts it on the
// page.

/** Waits before each retry. Three retries, about six seconds in all: long
 *  enough to ride out a dropped Wi-Fi frame or a mobile hand-over, short
 *  enough that a file which is really gone still fails while the page loads. */
export const RETRY_DELAYS_MS = [500, 1500, 4000];

/** Statuses that say "try again", not "no". */
export const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);

/** Statuses an `<img>` probe treats as a final answer. */
const FINAL_IMAGE_STATUS = new Set([400, 401, 403, 404, 410]);

const defaultWait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(signal.reason); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
});

/** Raised when a resume cannot be trusted (the file changed, or the server
 *  stopped answering 200); it ends the stream instead of being retried. */
class ResumeRefused extends TypeError {}

function requestParts(input, init) {
  const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();
  const signal = init?.signal ?? req?.signal ?? null;
  const headers = init?.headers ?? req?.headers ?? null;
  let hasRange = false;
  if (headers) {
    if (typeof headers.has === 'function') hasRange = headers.has('range');
    else if (Array.isArray(headers)) hasRange = headers.some(([k]) => String(k).toLowerCase() === 'range');
    else hasRange = Object.keys(headers).some(k => k.toLowerCase() === 'range');
  }
  return { method, signal, hasRange };
}

const validatorOf = res => res.headers?.get?.('etag') || res.headers?.get?.('last-modified') || null;

/** A seconds-valued Retry-After, capped so a server cannot park the page. */
function retryAfterMs(res) {
  const s = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 10000) : 0;
}

/**
 * A `fetch` that retries transient failures of GET and HEAD requests and
 * resumes a static file's body that breaks off part way.
 *
 * @param {typeof fetch} nativeFetch
 * @param {{ delays?: number[], wait?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *           makeResponse?: (body: ReadableStream, res: Response) => Response,
 *           onRetry?: (info: { url: string, attempt: number, reason: string }) => void }} [opts]
 */
export function createRetryingFetch(nativeFetch, opts = {}) {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const wait = opts.wait ?? defaultWait;
  const onRetry = opts.onRetry ?? (() => {});
  const makeResponse = opts.makeResponse ?? defaultMakeResponse;

  return async function retryingFetch(input, init) {
    const { method, signal, hasRange } = requestParts(input, init);
    if (method !== 'GET' && method !== 'HEAD') return nativeFetch(input, init);
    const url = String(input?.url ?? input);

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await nativeFetch(input, init);
      } catch (err) {
        if (signal?.aborted || attempt >= delays.length) throw err;
        onRetry({ url, attempt: attempt + 1, reason: String(err?.message ?? err) });
        await wait(delays[attempt], signal);
        continue;
      }
      if (TRANSIENT_STATUS.has(res.status) && attempt < delays.length) {
        try { await res.body?.cancel?.(); } catch { /* already gone */ }
        onRetry({ url, attempt: attempt + 1, reason: `HTTP ${res.status}` });
        await wait(Math.max(delays[attempt], retryAfterMs(res)), signal);
        continue;
      }
      if (method !== 'GET' || hasRange || res.status !== 200 || !res.body?.getReader) return res;
      const validator = validatorOf(res);
      if (!validator) return res;
      if (/event-stream/i.test(res.headers?.get?.('content-type') ?? '')) return res;
      return makeResponse(resumableBody(res, validator, { input, init, signal, url, used: attempt }), res);
    }
  };

  /** The body of `first`, re-requested and fast-forwarded if it breaks. */
  function resumableBody(first, validator, { input, init, signal, url, used }) {
    let reader = first.body.getReader();
    let delivered = 0;
    let retries = used;
    let pending = null;

    async function reopen() {
      const res = await nativeFetch(input, init);
      if (res.status !== 200 || validatorOf(res) !== validator || !res.body?.getReader) {
        try { await res.body?.cancel?.(); } catch { /* ignore */ }
        if (TRANSIENT_STATUS.has(res.status)) throw new TypeError(`HTTP ${res.status} while resuming`);
        throw new ResumeRefused(`${url} changed or went away while resuming`);
      }
      const r = res.body.getReader();
      let skip = delivered;
      while (skip > 0) {
        const { done, value } = await r.read();
        if (done) throw new ResumeRefused(`${url} came back shorter while resuming`);
        if (value.byteLength <= skip) skip -= value.byteLength;
        else { pending = value.subarray(skip); skip = 0; }
      }
      return r;
    }

    return new ReadableStream({
      async pull(controller) {
        for (;;) {
          try {
            if (!reader) reader = await reopen();
            if (pending) {
              const chunk = pending;
              pending = null;
              delivered += chunk.byteLength;
              controller.enqueue(chunk);
              return;
            }
            const { done, value } = await reader.read();
            if (done) { controller.close(); return; }
            delivered += value.byteLength;
            controller.enqueue(value);
            return;
          } catch (err) {
            try { reader?.cancel?.().catch?.(() => {}); } catch { /* ignore */ }
            reader = null;
            pending = null;
            if (err instanceof ResumeRefused || signal?.aborted || retries >= delays.length) throw err;
            onRetry({ url, attempt: retries + 1, reason: `body broke after ${delivered} bytes` });
            await wait(delays[retries++], signal);
          }
        }
      },
      cancel(reason) {
        return reader?.cancel?.(reason);
      },
    });
  }
}

/** A Response over the resumable stream that still answers like the original:
 *  same status and headers (Content-Length and X-File-Size drive progress
 *  bars), same url, type and redirected. */
function defaultMakeResponse(body, res) {
  const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  for (const key of ['url', 'type', 'redirected']) {
    Object.defineProperty(out, key, { value: res[key], enumerable: true });
  }
  return out;
}

/**
 * Replaces `ImageLoaderClass.prototype.load` with three r169's own, plus
 * retries. The loading manager hears one itemStart and one itemEnd per image
 * however many tries it takes, so a progress bar counts files, not attempts.
 *
 * @param {any} ImageLoaderClass three's ImageLoader
 * @param {any} Cache three's Cache
 * @param {{ createImage?: () => HTMLImageElement,
 *           probe?: (url: string) => Promise<number | null>,
 *           delays?: number[], wait?: (ms: number) => Promise<void>,
 *           onRetry?: (info: { url: string, attempt: number, reason: string }) => void }} [opts]
 */
export function patchImageLoader(ImageLoaderClass, Cache, opts = {}) {
  const proto = ImageLoaderClass.prototype;
  if (proto.__assetRetry) return;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const wait = opts.wait ?? (ms => defaultWait(ms));
  const onRetry = opts.onRetry ?? (() => {});
  const createImage = opts.createImage
    ?? (() => document.createElementNS('http://www.w3.org/1999/xhtml', 'img'));
  const probe = opts.probe ?? defaultProbe;

  proto.load = function load(url, onLoad, onProgress, onError) {
    if (this.path !== undefined) url = this.path + url;
    url = this.manager.resolveURL(url);
    const scope = this;

    const cached = Cache.get(url);
    if (cached !== undefined) {
      scope.manager.itemStart(url);
      setTimeout(() => {
        if (onLoad) onLoad(cached);
        scope.manager.itemEnd(url);
      }, 0);
      return cached;
    }

    const local = url.slice(0, 5) === 'data:' || url.slice(0, 5) === 'blob:';
    let attempt = 0;
    let image;

    const tryLoad = () => {
      image = createImage();
      const off = () => {
        image.removeEventListener('load', onImageLoad, false);
        image.removeEventListener('error', onImageError, false);
      };
      function onImageLoad() {
        off();
        Cache.add(url, this);
        if (onLoad) onLoad(this);
        scope.manager.itemEnd(url);
      }
      async function onImageError(event) {
        off();
        if (!local && attempt < delays.length) {
          const status = await probe(url).catch(() => null);
          if (!FINAL_IMAGE_STATUS.has(status)) {
            onRetry({ url, attempt: attempt + 1, reason: status ? `HTTP ${status}` : 'image error' });
            await wait(delays[attempt++]);
            tryLoad();
            return;
          }
        }
        if (onError) onError(event);
        scope.manager.itemError(url);
        scope.manager.itemEnd(url);
      }
      image.addEventListener('load', onImageLoad, false);
      image.addEventListener('error', onImageError, false);
      if (!local && scope.crossOrigin !== undefined) image.crossOrigin = scope.crossOrigin;
      image.src = url;
    };

    scope.manager.itemStart(url);
    tryLoad();
    return image;
  };
  proto.__assetRetry = true;
}

/** The status a HEAD gets for `url`, or null when the network is down. */
async function defaultProbe(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.status;
  } catch {
    return null;
  }
}
