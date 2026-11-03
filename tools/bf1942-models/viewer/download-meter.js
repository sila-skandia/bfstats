// What the page is downloading, for the loading screen's download line
// (features/loading-download-progress).
//
// A level, and a replay on top of it, opens with a few hundred downloads from
// many loaders: the scene glb, its textures, the vehicles' models, the
// soldiers' poses, sounds. No one loader knows them all, so the bar can sit
// at one number for seconds while files keep arriving. This counts every one
// of them at the two doors they all go through:
//
// - `meterFetch` wraps `fetch`: a GET is a file from the call until its body
//   has been read to the end. Its size is `X-File-Size` (what nginx sends for
//   a gzipped glb: the size once unzipped) or, for a body that is not
//   encoded, `Content-Length`. The bytes are counted as the reader takes
//   them, unzipped, which is what both headers measure.
// - `meterImageLoader` wraps three's ImageLoader (`<img>` textures): a file
//   from the call to its load or error, its size read off the resource
//   timing entry once it is in.
//
// A body that is never read (a page that only wanted the headers) stops
// counting once it has sat idle for `IDLE_MS` after its answer, so it cannot
// hold the line at "40 of 41" for ever. Nothing here imports three, so the
// Node harness drives it with stubs; `download-meter-install.js` puts it on
// the page.

/** An unfinished file with no bytes for this long is left out of the count. */
export const IDLE_MS = 20000;

/** A Response over `body` that answers like `res`: status, headers, url,
 *  type and redirected (asset-retry.js's own rule, for the same reason). */
function answerLike(body, res) {
  const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  for (const key of ['url', 'type', 'redirected']) {
    Object.defineProperty(out, key, { value: res[key], enumerable: true });
  }
  return out;
}

/** The unzipped size a response declares, or null. */
export function declaredSize(headers) {
  const get = name => headers?.get?.(name) ?? null;
  const fileSize = Number(get('x-file-size'));
  if (Number.isFinite(fileSize) && fileSize > 0) return fileSize;
  const encoded = (get('content-encoding') ?? 'identity').toLowerCase() !== 'identity';
  const length = Number(get('content-length'));
  return !encoded && Number.isFinite(length) && length > 0 ? length : null;
}

const skipUrl = url => /^(?:data|blob):/i.test(url);

/**
 * @param {{ now?: () => number, makeResponse?: (body: ReadableStream, res: Response) => Response,
 *           sizeOf?: (url: string) => number }} [opts]
 */
export function createDownloadMeter(opts = {}) {
  const now = opts.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const makeResponse = opts.makeResponse ?? answerLike;
  const sizeOf = opts.sizeOf ?? (url => {
    const entries = globalThis.performance?.getEntriesByName?.(url) ?? [];
    const last = entries[entries.length - 1];
    return last?.decodedBodySize || last?.encodedBodySize || 0;
  });
  /** The files since the last `reset`, plus any still coming in then. */
  let files = new Set();
  /** Answered, unfinished and idle: a body nobody is reading (a stream
   *  pulls its first chunk whether or not it is read, so bytes alone do not
   *  tell). One still waiting for its answer is queued, not idle. */
  const idle = (f, t) => !f.done && f.answered && t - f.seen >= IDLE_MS;

  function open(url) {
    const file = { url, loaded: 0, total: null, done: false, answered: false, seen: now() };
    files.add(file);
    return file;
  }
  function close(file, size = null) {
    if (file.done) return;
    file.done = true;
    if (Number.isFinite(size) && size > 0) file.loaded = Math.max(file.loaded, size);
    file.total = file.loaded;
  }

  /** `body` counted into `file` as it is read, closed at its end. */
  function counted(body, file) {
    const reader = body.getReader();
    return new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { close(file); controller.close(); return; }
          file.loaded += value.byteLength;
          file.seen = now();
          controller.enqueue(value);
        } catch (err) {
          close(file);
          controller.error(err);
        }
      },
      cancel(reason) {
        close(file);
        return reader.cancel(reason);
      },
    });
  }

  return {
    /** A `fetch` that counts what `inner` downloads. */
    meterFetch(inner) {
      const metered = async function meteredFetch(input, init) {
        const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
        const method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();
        const url = String(req?.url ?? input);
        if (method !== 'GET' || skipUrl(url)) return inner(input, init);
        const file = open(url);
        let res;
        try {
          res = await inner(input, init);
        } catch (err) {
          close(file);
          throw err;
        }
        // A stream that never ends (server-sent events) is no download.
        if (!res.ok || !res.body?.getReader || /event-stream/i.test(res.headers?.get?.('content-type') ?? '')) {
          files.delete(file);
          return res;
        }
        file.total = declaredSize(res.headers);
        file.answered = true;
        file.seen = now();
        return makeResponse(counted(res.body, file), res);
      };
      metered.__downloadMeter = true;
      return metered;
    },

    /** Count three's `<img>` loads (ImageLoader); a cached image is none. */
    meterImageLoader(ImageLoaderClass, Cache) {
      const proto = ImageLoaderClass.prototype;
      if (proto.__downloadMeter) return;
      const load = proto.load;
      proto.load = function meteredLoad(url, onLoad, onProgress, onError) {
        let resolved = this.path !== undefined ? this.path + url : url;
        resolved = this.manager?.resolveURL ? this.manager.resolveURL(resolved) : resolved;
        if (skipUrl(resolved) || Cache?.get?.(resolved) !== undefined) {
          return load.call(this, url, onLoad, onProgress, onError);
        }
        let abs = resolved;
        try { abs = new URL(resolved, globalThis.location?.href).href; } catch { /* keep it */ }
        const file = open(abs);
        return load.call(this, url,
          image => { close(file, sizeOf(abs)); onLoad?.(image); },
          onProgress,
          error => { close(file); onError?.(error); });
      };
      proto.__downloadMeter = true;
    },

    /** A new count: what has finished is dropped, what is still coming in
     *  stays (a level's scene that started before its loading screen). */
    reset() {
      const t = now();
      files = new Set([...files].filter(f => !f.done && !idle(f, t)));
    },

    /** `{ files, done, loaded, total, active }`: files asked for and
     *  finished, bytes in and expected (a file of unknown size counts what
     *  has arrived), and how many are downloading now. */
    snapshot() {
      const t = now();
      let count = 0;
      let done = 0;
      let loaded = 0;
      let total = 0;
      for (const f of files) {
        if (idle(f, t)) continue;
        count += 1;
        if (f.done) done += 1;
        loaded += f.total !== null ? Math.min(f.loaded, f.total) : f.loaded;
        total += f.total !== null ? f.total : f.loaded;
      }
      return { files: count, done, loaded, total, active: count - done };
    },
  };
}
