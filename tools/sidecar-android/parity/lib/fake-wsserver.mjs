// The page socket sidecar.mjs gets under the parity driver (sidecar-hooks.mjs
// resolves its wsserver.mjs here): the same surface as wsserver.mjs's
// WSServer, with every frame the sidecar sends a page logged to the driver's
// transcript. The Kotlin twin is SidecarTest's FakeHub.
import { EventEmitter } from 'node:events';

const P = globalThis.__sidecarParity;

export class FakePageSocket extends EventEmitter {
  constructor(server, idx) { super(); this.server = server; this.idx = idx; this.open = true; }
  send(data) {
    if (!this.open) return;
    P.line([P.at(), 'page', this.idx, typeof data === 'string' ? data : `hex:${Buffer.from(data).toString('hex')}`]);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.server.clients.delete(this);
    this.emit('close');
  }
}

export class WSServer extends EventEmitter {
  constructor({ port, allowOrigins = [] } = {}) {
    super();
    this.port = Number(port) || 0; this.allowOrigins = allowOrigins;
    this.clients = new Set();
    P.ws = this;
  }
  listen() { return Promise.resolve({ address: '127.0.0.1', family: 'IPv4', port: this.port }); }
  /** The driver's page connects. */
  connectPage(idx) {
    const s = new FakePageSocket(this, idx);
    this.clients.add(s);
    this.emit('connection', s);
    return s;
  }
  broadcast(data) { for (const ws of this.clients) ws.send(data); }
  close() { for (const ws of [...this.clients]) ws.close(); }
}
