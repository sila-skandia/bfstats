#!/usr/bin/env node
// Tests App/Resources/socket-bridge.js, the WebSocket stand-in the iPhone app
// injects into the game page, under Node with a fake WKWebView around it: a
// message handler that records what the page posts, and a native WebSocket
// that opens, throws (WebKit's mixed-content SecurityError) or fails.
//
//   node tools/sidecar-ios/scripts/test-socket-bridge.mjs
//
// CI runs it (sidecar-ios.yml); the simulator smoke test runs the same file
// against the real page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'App', 'Resources', 'socket-bridge.js'), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

class CloseEventShim extends Event {
  constructor(type, init = {}) { super(type); this.code = init.code ?? 0; this.reason = init.reason ?? ''; this.wasClean = !!init.wasClean; }
}

/** A page with the stand-in installed. `native` is how its real WebSocket behaves. */
function page({ mode, native, bridge = true, directWaitMs = 50 }) {
  const posts = [];
  const opened = [];
  class FakeNative {
    constructor(url) {
      if (native === 'throw') throw new DOMException('The operation is insecure.', 'SecurityError');
      this.url = url; this.readyState = 0; this.sent = [];
      opened.push(this);
      if (native === 'open') setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 1);
      if (native === 'fail') setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006, reason: '', wasClean: false }); }, 1);
      // 'hang': never answers
    }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; }
  }
  FakeNative.OPEN = 1;
  const ctx = {
    console, setTimeout, clearTimeout, btoa, EventTarget, Event, MessageEvent, DOMException, ArrayBuffer, Uint8Array, Blob,
    CloseEvent: globalThis.CloseEvent ?? CloseEventShim,
    WebSocket: FakeNative,
    __bfstatsSocketConfig: { mode, directWaitMs },
    webkit: bridge ? { messageHandlers: { bfstatsSocket: { postMessage: m => posts.push(structuredClone(m)) } } } : undefined,
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, posts, opened, FakeNative };
}

const diags = posts => posts.filter(p => p.op === 'diag').map(p => `${p.kind} ${p.detail}`);

async function directOpens() {
  const { ctx, posts, opened } = page({ mode: 'auto', native: 'open' });
  const ws = new ctx.WebSocket('ws://127.0.0.1:17942');
  ws.binaryType = 'arraybuffer';
  const seen = [];
  ws.onopen = () => seen.push('open');
  ws.addEventListener('message', e => seen.push(`msg ${e.data}`));
  await tick(5);
  assert.equal(ws.readyState, 1);
  assert.equal(ws.transport, 'direct');
  assert.equal(opened[0].binaryType, 'arraybuffer');
  opened[0].onmessage({ data: 'row' });
  ws.send(new Uint8Array([2, 1]));
  assert.deepEqual(seen, ['open', 'msg row']);
  assert.deepEqual(Array.from(opened[0].sent[0]), [2, 1]);
  assert.deepEqual(diags(posts), ['installed auto', 'open direct', 'first-message direct']);
  assert.equal(posts.filter(p => p.op === 'open').length, 0, 'nothing bridged');
}

async function refusedFallsBackToBridge() {
  for (const native of ['throw', 'fail', 'hang']) {
    const { ctx, posts } = page({ mode: 'auto', native });
    const ws = new ctx.WebSocket('ws://127.0.0.1:17942');
    const seen = [];
    ws.onopen = () => seen.push('open');
    ws.onmessage = e => seen.push(`msg ${e.data}`);
    ws.onerror = () => seen.push('error');
    await tick(native === 'hang' ? 80 : 10);
    const open = posts.find(p => p.op === 'open');
    assert.ok(open, `${native}: the bridge is asked to open`);
    assert.equal(ws.readyState, 0, `${native}: still connecting until the app answers`);
    assert.throws(() => ws.send('x'), /connecting/);
    ctx.__bfstatsSocket.opened(open.id);
    ctx.__bfstatsSocket.deliver(open.id, ['{"k":"live"}', '{"k":"srv"}']);
    ws.send(new Uint8Array([4]));
    ws.send('{"type":"identity"}');
    assert.deepEqual(seen, ['open', 'msg {"k":"live"}', 'msg {"k":"srv"}'], native);
    assert.equal(ws.transport, 'bridge');
    const out = posts.filter(p => p.op === 'bin' || p.op === 'text');
    assert.deepEqual(out.map(p => p.op), ['bin', 'text']);
    assert.equal(Buffer.from(out[0].data, 'base64')[0], 4);
    assert.equal(out[1].data, '{"type":"identity"}');
    assert.ok(diags(posts).some(d => d.startsWith('direct-')), `${native}: says why direct was left`);
    assert.ok(diags(posts).includes('open bridge'));
  }
}

async function directOnlyReportsTheRefusal() {
  const { ctx, posts } = page({ mode: 'direct', native: 'throw' });
  const ws = new ctx.WebSocket('ws://127.0.0.1:17942');
  const seen = [];
  ws.onerror = () => seen.push('error');
  ws.onclose = e => seen.push(`close ${e.code}`);
  await tick(5);
  assert.deepEqual(seen, ['error', 'close 1006']);
  assert.equal(posts.filter(p => p.op === 'open').length, 0);
  assert.ok(diags(posts)[1].startsWith('direct-refused SecurityError'));
}

async function bridgeModeAndClose() {
  const { ctx, posts, opened } = page({ mode: 'bridge', native: 'open' });
  const ws = new ctx.WebSocket('ws://127.0.0.1:17942/');
  const seen = [];
  ws.onclose = e => seen.push(`close ${e.code}`);
  await tick(2);
  assert.equal(opened.length, 0, 'the real socket is never tried');
  const { id } = posts.find(p => p.op === 'open');
  // Frames before the app's `opened` open the socket first.
  ctx.__bfstatsSocket.deliver(id, ['a']);
  assert.equal(ws.readyState, 1);
  ws.close();
  await tick(2);
  assert.ok(posts.some(p => p.op === 'close' && p.id === id));
  assert.deepEqual(seen, ['close 1000']);
  assert.deepEqual([...ctx.__bfstatsSocket.sockets()], []);

  const ws2 = new ctx.WebSocket('ws://localhost:17942');
  await tick(2);
  const id2 = posts.filter(p => p.op === 'open')[1].id;
  const seen2 = [];
  ws2.onclose = e => seen2.push(`close ${e.code}`);
  ctx.__bfstatsSocket.opened(id2);
  ctx.__bfstatsSocket.closed(id2);
  assert.deepEqual(seen2, ['close 1001']);
}

async function otherUrlsAreUntouched() {
  const { ctx, opened, FakeNative } = page({ mode: 'bridge', native: 'open' });
  const ws = new ctx.WebSocket('wss://play.bfstats.io/netcode');
  assert.ok(ws instanceof FakeNative);
  assert.equal(opened.length, 1);
  assert.equal(ctx.WebSocket.OPEN, 1);
}

async function noBridgeFails() {
  const { ctx } = page({ mode: 'bridge', native: 'open', bridge: false });
  const ws = new ctx.WebSocket('ws://127.0.0.1:1');
  const seen = [];
  ws.onclose = e => seen.push(e.code);
  await tick(2);
  assert.deepEqual(seen, [1006]);
}

for (const t of [directOpens, refusedFallsBackToBridge, directOnlyReportsTheRefusal, bridgeModeAndClose, otherUrlsAreUntouched, noBridgeFails]) {
  await t();
  console.log(`ok ${t.name}`);
}
