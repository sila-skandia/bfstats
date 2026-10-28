// The game page's socket to the sidecar, inside the iPhone app's WKWebView
// (tools/sidecar-ios, PlayViewController injects this at document start).
//
// map.html?sidecar=127.0.0.1:<port> opens `new WebSocket("ws://127.0.0.1:<port>")`
// from an https page. Whether WebKit lets it is the question this file
// answers either way: a WebSocket to a loopback address is handed a stand-in
// that either opens the real socket (`direct`) or carries the frames through
// the app (`bridge`: window.webkit.messageHandlers.bfstatsSocket in, and
// window.__bfstatsSocket.deliver(...) back), or tries direct first and falls
// back to the bridge when WebKit refuses it (`auto`). The page is none the
// wiser: the stand-in is a WebSocket in every way the page uses one
// (net-sidecar.js: onopen/onmessage/onerror/onclose and addEventListener,
// readyState, binaryType, send, close). Every other URL gets the real
// WebSocket untouched.
//
// window.__bfstatsSocketConfig = { mode: "auto" | "direct" | "bridge" } is
// set by the app before this runs. What happened is posted back as `diag`
// messages (the CI's smoke test reads them).
(function () {
  'use strict';
  if (window.__bfstatsSocket) return;
  const cfg = window.__bfstatsSocketConfig || {};
  const MODE = cfg.mode === 'direct' || cfg.mode === 'bridge' ? cfg.mode : 'auto';
  /** How long `auto` waits for the real socket to open before the bridge. */
  const DIRECT_WAIT_MS = cfg.directWaitMs || 4000;
  const handlers = (window.webkit && window.webkit.messageHandlers) || {};
  const handler = handlers.bfstatsSocket || null;
  const Native = window.WebSocket;
  const LOOPBACK = /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|\?|$)/i;
  const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

  function post(msg) {
    if (!handler) return false;
    try { handler.postMessage(msg); return true; } catch (e) { return false; }
  }
  function diag(kind, detail) { post({ op: 'diag', kind: kind, detail: detail == null ? '' : String(detail) }); }

  function base64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function bytesOf(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  let nextId = 1;
  const bridged = new Map();
  let firstMessage = false;

  class LoopbackSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.readyState = CONNECTING;
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      this._binaryType = 'blob';
      this._native = null;
      this._id = 0;
      this.transport = null;
      if (MODE === 'bridge' || !Native) setTimeout(() => this._bridge('mode ' + MODE), 0);
      else this._direct(MODE === 'auto');
    }

    get binaryType() { return this._binaryType; }
    set binaryType(v) {
      this._binaryType = v === 'arraybuffer' ? 'arraybuffer' : 'blob';
      if (this._native) this._native.binaryType = this._binaryType;
    }

    _emit(type, init) {
      let ev;
      if (type === 'message') ev = new MessageEvent('message', init);
      else if (type === 'close') ev = new CloseEvent('close', init);
      else ev = new Event(type);
      const h = this['on' + type];
      if (typeof h === 'function') {
        try { h.call(this, ev); } catch (e) { setTimeout(() => { throw e; }, 0); }
      }
      this.dispatchEvent(ev);
    }

    _opened(transport) {
      if (this.readyState !== CONNECTING) return;
      this.transport = transport;
      this.readyState = OPEN;
      diag('open', transport);
      this._emit('open');
    }

    _message(data) {
      if (this.readyState !== OPEN) return;
      if (!firstMessage) { firstMessage = true; diag('first-message', this.transport); }
      this._emit('message', { data: data });
    }

    _closed(code, reason, clean) {
      if (this.readyState === CLOSED) return;
      const wasOpen = this.readyState !== CONNECTING;
      this.readyState = CLOSED;
      if (this._id) bridged.delete(this._id);
      diag('close', (this.transport || 'none') + ' ' + code);
      if (!wasOpen || code === 1006) this._emit('error');
      this._emit('close', { code: code, reason: reason || '', wasClean: !!clean });
    }

    _direct(fallback) {
      let ws;
      try {
        ws = new Native(this.url);
      } catch (e) {
        // WebKit's mixed-content block can throw a SecurityError here.
        diag('direct-refused', (e && (e.name + ': ' + e.message)) || e);
        if (fallback) setTimeout(() => this._bridge('direct threw'), 0);
        else setTimeout(() => this._closed(1006, 'refused', false), 0);
        return;
      }
      this._native = ws;
      ws.binaryType = this._binaryType;
      let settled = false;
      const t0 = Date.now();
      const giveUp = why => {
        if (settled) return;
        settled = true;
        diag('direct-failed', why + ' after ' + (Date.now() - t0) + ' ms');
        this._native = null;
        try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (e) { /* already gone */ }
        if (fallback) this._bridge('direct ' + why);
        else this._closed(1006, why, false);
      };
      const timer = fallback ? setTimeout(() => giveUp('timeout'), DIRECT_WAIT_MS) : 0;
      ws.onopen = () => { settled = true; clearTimeout(timer); this._opened('direct'); };
      ws.onmessage = e => this._message(e.data);
      ws.onerror = () => { if (settled) this._emit('error'); else giveUp('error'); };
      ws.onclose = e => {
        clearTimeout(timer);
        if (!settled) giveUp('close ' + e.code);
        else this._closed(e.code, e.reason, e.wasClean);
      };
    }

    _bridge(why) {
      if (this.readyState !== CONNECTING) return;
      this._id = nextId++;
      bridged.set(this._id, this);
      if (!post({ op: 'open', id: this._id, url: this.url, why: why })) {
        diag('bridge-missing', why);
        this._closed(1006, 'no bridge', false);
      }
      // The app answers with __bfstatsSocket.opened(id) or failed(id).
    }

    send(data) {
      if (this.readyState === CONNECTING) throw new DOMException('WebSocket is still connecting', 'InvalidStateError');
      if (this.readyState !== OPEN) return;
      if (this._native) { this._native.send(data); return; }
      if (typeof data === 'string') { post({ op: 'text', id: this._id, data: data }); return; }
      const u8 = bytesOf(data);
      if (u8) { post({ op: 'bin', id: this._id, data: base64(u8) }); return; }
      if (data instanceof Blob) data.arrayBuffer().then(b => this.send(b));
    }

    close(code, reason) {
      if (this.readyState === CLOSING || this.readyState === CLOSED) return;
      if (this._native) { this.readyState = CLOSING; this._native.close(code, reason); return; }
      if (this._id) post({ op: 'close', id: this._id });
      this.readyState = CLOSING;
      setTimeout(() => this._closed(code || 1000, reason || '', true), 0);
    }
  }
  for (const [k, v] of [['CONNECTING', CONNECTING], ['OPEN', OPEN], ['CLOSING', CLOSING], ['CLOSED', CLOSED]]) {
    LoopbackSocket[k] = v;
    LoopbackSocket.prototype[k] = v;
  }

  // What the app calls (evaluateJavaScript).
  window.__bfstatsSocket = {
    mode: MODE,
    opened(id) { const s = bridged.get(id); if (s) s._opened('bridge'); },
    failed(id, why) { const s = bridged.get(id); if (s) s._closed(1006, why || 'refused', false); },
    /** Frames for socket `id`, in order (text, as the sidecar sends them). */
    deliver(id, frames) {
      const s = bridged.get(id);
      if (!s) return;
      if (s.readyState === CONNECTING) s._opened('bridge');
      for (const f of frames) s._message(f);
    },
    closed(id) { const s = bridged.get(id); if (s) s._closed(1001, 'sidecar closed', true); },
    sockets() { return Array.from(bridged.keys()); },
  };

  if (Native) {
    const Wrapped = function WebSocket(url, protocols) {
      if (!new.target) throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator");
      if (LOOPBACK.test(String(url))) return new LoopbackSocket(url);
      return protocols === undefined ? new Native(url) : new Native(url, protocols);
    };
    Wrapped.prototype = Native.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Native[k];
    window.WebSocket = Wrapped;
  } else {
    window.WebSocket = LoopbackSocket;
  }

  // The page's errors reach the app's log (as the Android app's console hook).
  if (handlers.bfstatsConsole) {
    const send = (level, args) => {
      try {
        handlers.bfstatsConsole.postMessage({ level: level, text: Array.from(args).map(a => (a && a.stack) || String(a)).join(' ').slice(0, 2000) });
      } catch (e) { /* the app is gone */ }
    };
    const err = console.error.bind(console);
    console.error = function () { send('error', arguments); err.apply(null, arguments); };
    window.addEventListener('error', e => send('error', [e.message + ' at ' + e.filename + ':' + e.lineno]));
    window.addEventListener('unhandledrejection', e => send('error', ['unhandled rejection: ' + ((e.reason && e.reason.stack) || e.reason)]));
  }
  diag('installed', MODE);
})();
