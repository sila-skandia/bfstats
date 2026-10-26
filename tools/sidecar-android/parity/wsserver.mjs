// Writes core/src/commonTest/resources/parity/wsserver.json from the Node
// sidecar's wsserver.mjs, the page socket, over real TCP: each case is the
// raw bytes a client sends (an HTTP request, then WebSocket frames), and the
// transcript is what the server does: the status line and body it answers
// (headers such as Date differ by design), every 'connection', 'message'
// (text or binary), 'close' and 'refused' it raises, and the frames it sends
// back. WsServerParityTest.kt sends the same bytes to WsServer.kt.
//   node parity/wsserver.mjs
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { RES, SIDECAR } from './lib/tables.mjs';

const { WSServer, originAllowed, normaliseOrigin } = await import(path.join(SIDECAR, 'wsserver.mjs'));
const PAGE = path.join(SIDECAR, 'page', 'index.html');

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const req = (lines) => Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1');
const up = (extra = [], path = '/') => req([`GET ${path} HTTP/1.1`, 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${KEY}`, 'Sec-WebSocket-Version: 13', ...extra]);
// A client frame, masked.
function frame(opcode, payload, { fin = true, mask = [1, 2, 3, 4] } = {}) {
  const p = Buffer.from(payload);
  const len = p.length;
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len])
    : len < 65536 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, len >> 8, len & 0xff])
      : (() => { const h = Buffer.alloc(10); h[0] = (fin ? 0x80 : 0) | opcode; h[1] = 0x80 | 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); return h; })();
  const m = Buffer.from(mask);
  const body = Buffer.from(p.map((b, i) => b ^ m[i & 3]));
  return Buffer.concat([head, m, body]);
}
const text = (s) => frame(0x1, Buffer.from(s, 'utf8'));
const bin = (b) => frame(0x2, Buffer.from(b));

// Each case: chunks sent in order (a pause between), and whether the client
// ends the TCP connection after them.
const CASES = {
  monitorPage: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1'])] },
  monitorPageIndex: { send: [req(['GET /index.html HTTP/1.1', 'Host: 127.0.0.1'])] },
  otherPath: { send: [req(['GET /x HTTP/1.1', 'Host: 127.0.0.1'])] },
  queryPath: { send: [req(['GET /?a=1 HTTP/1.1', 'Host: 127.0.0.1'])] },
  upgradeNoConnection: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', `Sec-WebSocket-Key: ${KEY}`])] },
  connectionNoUpgrade: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Connection: Upgrade', `Sec-WebSocket-Key: ${KEY}`])] },
  upgradeH2c: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: h2c', 'Connection: Upgrade', `Sec-WebSocket-Key: ${KEY}`])] },
  connectionList: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: keep-alive, Upgrade', `Sec-WebSocket-Key: ${KEY}`])], end: true },
  strayOrigin: { send: [up(['Origin: https://evil.example'])] },
  extraOrigin: { send: [up(['Origin: https://extra.example'])], end: true },
  noKey: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade'])] },
  emptyKey: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key:'])] },
  noHost: { send: [req(['GET / HTTP/1.1'])] },
  hugeHead: { send: [req(['GET / HTTP/1.1', 'Host: 127.0.0.1', `X-Pad: ${'a'.repeat(20000)}`])] },
  frames: {
    send: [up(['Origin: https://play.bfstats.io']), text('hello'), bin([2, 1, 0, 0, 0, 9]), frame(0x9, 'pp'),
      text('x'.repeat(300)), bin(Buffer.alloc(65540, 7)), text('é中'), text('big:200'), text('big:70000'), frame(0x8, Buffer.from([3, 232]))],
  },
  closeByTcp: { send: [up([]), text('bye')], end: true },
  splitFrame: { send: [up([]), text('split').subarray(0, 3), text('split').subarray(3)], end: true },
};

function runCase(port, c, events) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const chunks = [];
    sock.on('data', (d) => chunks.push(d));
    let i = 0;
    const next = () => {
      if (i < c.send.length) { sock.write(c.send[i++]); setTimeout(next, 60); return; }
      if (c.end) sock.end();
      setTimeout(() => { sock.destroy(); setTimeout(() => resolve(Buffer.concat(chunks)), 80); }, 250);
    };
    sock.on('connect', next);
    sock.on('error', () => {});
  });
}

// The server's answer: the status line, the body of a non-101 answer (by
// Content-Length) and the frames after a 101.
function parseAnswer(buf) {
  const s = buf.toString('latin1');
  const end = s.indexOf('\r\n\r\n');
  if (end < 0) return { status: s.split('\r\n')[0] || null };
  const head = s.slice(0, end).split('\r\n');
  const status = head[0];
  const hdr = Object.fromEntries(head.slice(1).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  let rest = buf.subarray(Buffer.byteLength(s.slice(0, end + 4), 'latin1'));
  if (!status.includes(' 101 ')) {
    // The body as sent (Node sends the page chunked; the Kotlin copy with a length).
    let body;
    if (/chunked/i.test(hdr['transfer-encoding'] ?? '')) {
      const parts = [];
      for (let at = 0; ;) {
        const nl = rest.indexOf('\r\n', at);
        const n = parseInt(rest.subarray(at, nl).toString('latin1'), 16);
        if (!(n > 0)) break;
        parts.push(rest.subarray(nl + 2, nl + 2 + n));
        at = nl + 2 + n + 2;
      }
      body = Buffer.concat(parts);
    } else body = rest.subarray(0, hdr['content-length'] != null ? Number(hdr['content-length']) : rest.length);
    return { status, contentType: hdr['content-type'] ?? null, body: body.toString('utf8') };
  }
  const frames = [];
  while (rest.length >= 2) {
    const op = rest[0] & 0x0f; let len = rest[1] & 0x7f; let off = 2;
    if (len === 126) { len = rest.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(rest.readBigUInt64BE(2)); off = 10; }
    if (rest.length < off + len) break;
    const p = rest.subarray(off, off + len);
    // A long payload as its length and SHA-1, not its bytes.
    frames.push([op, p.length > 1000 ? `${p.length}:${crypto.createHash('sha1').update(p).digest('hex')}` : p.toString('hex')]);
    rest = rest.subarray(off + len);
  }
  return { status, accept: hdr['sec-websocket-accept'] ?? null, frames };
}

const out = {};
for (const [name, c] of Object.entries(CASES)) {
  const events = [];
  const server = new WSServer({ port: 0, allowOrigins: ['https://extra.example'], staticFile: PAGE });
  server.on('refused', (o) => events.push(['refused', o ?? null]));
  server.on('connection', (ws) => {
    events.push(['connection', server.clients.size]);
    ws.on('message', (data, isBin) => {
      events.push(isBin ? ['binary', Buffer.from(data).toString('hex')] : ['text', String(data)]);
      // Answer every message, so the frames back are in the transcript too.
      // `big:<n>` asks for an n-byte answer (the 16- and 64-bit length forms).
      const big = !isBin && /^big:(\d+)$/.exec(String(data));
      ws.send(big ? 'z'.repeat(Number(big[1])) : isBin ? Buffer.from(data).subarray(0, 4) : `echo:${String(data).slice(0, 8)}`);
    });
    ws.on('close', () => events.push(['close', server.clients.size]));
  });
  const { port } = await server.listen();
  const answer = parseAnswer(await runCase(port, c, events));
  server.close();
  out[name] = { send: c.send.map((b) => b.toString('hex')), end: !!c.end, answer, events };
  console.log(name, answer.status, events.map((e) => e[0]).join(','));
}
// The origin rules over odd input: JS whitespace, case, slashes, shapes.
const ORIGINS = [null, '', 'https://bfstats.io', ' https://bfstats.io/ ', '\u00a0https://play.bfstats.io\ufeff', 'HTTPS://MESH.BFSTATS.IO//',
  'https://bfstats.io\u2028x', 'https://bfstats.io\u00a0', 'http://localhost:5173', 'http://LOCALHOST', 'http://[::1]:1', 'http://127.0.0.1:99999',
  'https://evil.example', 'null', 'file://', 'https://extra.example', 'https://extra.example/', 'ws://bfstats.io', 'https://bfstats.io:443'];
const origins = ORIGINS.map((o) => [o, normaliseOrigin(o), originAllowed(o ?? undefined), originAllowed(o ?? undefined, ['https://extra.example/', ' HTTPS://Other.example '])]);
fs.writeFileSync(path.join(RES, 'wsserver.json'), JSON.stringify({ page: fs.readFileSync(PAGE, 'utf8'), cases: out, origins }));
process.exit(0);
