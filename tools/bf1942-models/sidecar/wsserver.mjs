// A minimal dependency-free WebSocket server (RFC 6455), enough for the sidecar
// to stream the live record feed to a browser on 127.0.0.1 and to receive the
// occasional command back. No npm install, so the sidecar stays a single
// `node` tool. Text and binary frames, ping/pong, close; server->client frames
// are unmasked, client->server frames are unmasked on read.

import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// The pages allowed to open the sidecar's socket (features/sidecar-desktop-app,
// "Decisions"). The sidecar listens on 127.0.0.1, but any site the user has
// open can still try ws://127.0.0.1:<port>, and a page that could would steer
// the player on the server. The live site, the viewer's host, and a local
// viewer on any port are allowed; anything else is refused at the upgrade.
// A request with no Origin header is allowed: browsers always send one, and
// the node lab probes send none.
export const ALLOWED_ORIGINS = Object.freeze([
  'https://bfstats.io',
  'https://www.bfstats.io',
  'https://mesh.bfstats.io',
]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/** An origin as a browser sends it: scheme://host[:port], lower case, no
 *  trailing slash. Anything that does not parse as one is null. */
export function normaliseOrigin(o) {
  if (typeof o !== 'string') return null;
  const t = o.trim().replace(/\/+$/, '').toLowerCase();
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]+$/.test(t) ? t : null;
}

/** Whether a WebSocket upgrade with this Origin header may connect. `extra`
 *  holds origins the user allowed on the command line (--allow-origin). */
export function originAllowed(origin, extra = []) {
  if (origin === undefined || origin === null || origin === '') return true;
  const o = normaliseOrigin(origin);
  if (!o) return false;
  if (LOCAL_ORIGIN.test(o)) return true;
  if (ALLOWED_ORIGINS.includes(o)) return true;
  return extra.some((e) => normaliseOrigin(e) === o);
}

class Socket extends EventEmitter {
  constructor(raw) { super(); this.raw = raw; this.buf = Buffer.alloc(0); this.open = true; }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const f = decodeFrame(this.buf);
      if (!f) break;
      this.buf = this.buf.subarray(f.total);
      if (f.opcode === 0x8) { this.close(); return; }       // close
      if (f.opcode === 0x9) { this.raw.write(encodeFrame(f.payload, 0xa)); continue; } // ping->pong
      if (f.opcode === 0x1) this.emit('message', f.payload.toString('utf8'), false);
      else if (f.opcode === 0x2) this.emit('message', f.payload, true);
    }
  }

  send(data) {
    if (!this.open) return;
    const isBuf = Buffer.isBuffer(data);
    try { this.raw.write(encodeFrame(isBuf ? data : Buffer.from(String(data), 'utf8'), isBuf ? 0x2 : 0x1)); }
    catch { this.close(); }
  }

  close() { if (!this.open) return; this.open = false; try { this.raw.end(); } catch {} this.emit('close'); }
}

export class WSServer extends EventEmitter {
  constructor({ port, host = '127.0.0.1', allowOrigins = [], staticFile = null } = {}) {
    super();
    this.port = port; this.host = host; this.allowOrigins = [...allowOrigins]; this.staticFile = staticFile;
    this.clients = new Set();
    this.http = http.createServer((req, res) => this._onHttp(req, res));
    this.http.on('upgrade', (req, socket) => this._onUpgrade(req, socket));
  }

  listen() {
    return new Promise((resolve) => this.http.listen(this.port, this.host, () => resolve(this.http.address())));
  }

  _onHttp(req, res) {
    // Serve the live monitor page, so the browser can just open the URL.
    if (this.staticFile && (req.url === '/' || req.url === '/index.html')) {
      try {
        const html = fs.readFileSync(this.staticFile);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      } catch { res.writeHead(404); return res.end('no page'); }
    }
    res.writeHead(404); res.end('not found');
  }

  _onUpgrade(req, socket) {
    // Guard: the allowed origins only (DNS-rebinding / stray-site protection).
    if (!originAllowed(req.headers.origin, this.allowOrigins)) {
      this.emit('refused', req.headers.origin);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const ws = new Socket(socket);
    this.clients.add(ws);
    socket.on('data', (d) => ws._onData(d));
    socket.on('error', () => ws.close());
    socket.on('close', () => { this.clients.delete(ws); ws.emit('close'); });
    ws.on('close', () => this.clients.delete(ws));
    this.emit('connection', ws);
  }

  broadcast(data) { for (const ws of this.clients) ws.send(data); }
  close() { for (const ws of this.clients) ws.close(); this.http.close(); }
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff]); }
  else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2); header.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (masked) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
  return { opcode, payload, total: off + len };
}
