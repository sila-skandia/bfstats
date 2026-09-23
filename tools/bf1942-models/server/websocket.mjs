// RFC 6455, as little of it as the room server needs: the upgrade's accept
// key, the frame head, the incremental frame parser and `SocketPeer`, the
// adapter that puts one upgraded socket behind the room core's `{send,
// close}` peer contract. Split out of `server.mjs`, which does the listening.

import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** A frame may not be worth more than a megabyte; the room's payloads are
 *  all under a couple of KB, so this only bounds a runaway client. */
const MAX_FRAME = 1 << 20;

// --- the RFC6455 side --------------------------------------------------------

export function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

export function writeFrameHead(socket, opcode, length) {
  const head = [0x80 | opcode];
  if (length < 126) head.push(length);
  else if (length < 0x10000) head.push(126, (length >> 8) & 0xff, length & 0xff);
  else {
    head.push(127);
    for (let i = 7; i >= 0; i--) head.push((length >> (8 * i)) & 0xff);
  }
  socket.write(Buffer.from(head));
}

/**
 * One upgraded socket, adapted to the room core's `{send, close}` peer
 * contract (`rooms.mjs` README documents the contract; this is its first
 * implementation). Frames parse incrementally off the socket's data
 * stream; handshake and frame masking follow RFC 6455 exactly.
 */
export class SocketPeer {
  constructor(socket, core) {
    this.socket = socket;
    this.core = core;
    this.buf = Buffer.alloc(0);
    this.fragment = null;         // a fragmented message's accumulated bytes
    this.closed = false;
    this.core.attach(this);
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    this.core.detach(this);
  }

  /** Outbound: one unmasked FIN binary frame (the wire's only shape). */
  send(bytes) {
    if (this.closed || !bytes?.length) return;
    writeFrameHead(this.socket, 0x2, bytes.length);
    this.socket.write(Buffer.from(bytes));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const rc = Buffer.alloc(0);
    if (code !== null) {
      const payload = Buffer.alloc(2 + reason.length);
      payload.writeUInt16BE(code, 0);
      Buffer.from(reason, 'utf8').copy(payload, 2);
      writeFrameHead(this.socket, 0x8, payload.length);
      this.socket.write(payload);
    }
    this.closed = true;
    try { this.socket.destroy(); } catch { /* already gone */ }
    this.core.detach(this);
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (!this.closed) {
      const frame = takeFrame(this.buf);
      if (!frame) break;
      this.buf = frame.rest;
      try {
        this.#onFrame(frame);
      } catch (error) {
        // A buggy handler must not kill the listener: every connection's
        // frames ride one process. Log the throw and sever the peer — the
        // client's own load path sees a closed socket, not a dead server.
        console.error(`peer handler crashed: ${error.stack?.slice(0, 400) ?? error.message}`);
        this.close(1002, 'handler error');
        return;
      }
    }
  }

  #onFrame(frame) {
    const opcode = frame.opcode;
    if (opcode === 0x8) {                    // close
      this.close(1000, '');
      return;
    }
    if (opcode === 0x9) {                    // protocol ping -> pong
      writeFrameHead(this.socket, 0xa, frame.payload.length);
      this.socket.write(frame.payload);
      return;
    }
    if (opcode === 0xa) return;              // pong; nothing to answer
    if (opcode !== 0x1 && opcode !== 0x2 && opcode !== 0x0) return;
    if (opcode === 0x0) {                    // continuation
      if (this.fragment === null) return;
      this.fragment = Buffer.concat([this.fragment, frame.payload]);
      if (this.fragment.length > MAX_FRAME) { this.close(1009, 'too big'); return; }
      if (!frame.fin) return;
      this.core.onMessage(this, this.fragment);
      this.fragment = null;
      return;
    }
    if (!frame.fin) {                        // a fragmented start
      this.fragment = Buffer.from(frame.payload);
      return;
    }
    this.core.onMessage(this, Buffer.from(frame.payload));
  }
}

/** The next complete frame's bytes (mask applied) and the unread remainder,
 *  or null while the buffer holds less than one whole frame. */
function takeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let off = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = (buf[2] << 8) | buf[3];
    off = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    length = Number(BigUInt64BE(buf, 2));
    off = 10;
  }
  if (length > MAX_FRAME) return { opcode: 0x8, payload: Buffer.alloc(0), fin, rest: buf };
  const maskOff = masked ? off + 4 : off;
  if (buf.length < maskOff + length) return null;
  let payload = buf.subarray(maskOff, maskOff + length);
  if (masked) {
    const key = [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
    const out = Buffer.alloc(length);
    for (let i = 0; i < length; i++) out[i] = payload[i] ^ key[i & 3];
    payload = out;
  }
  return { opcode, payload, fin, rest: buf.subarray(maskOff + length) };
}

function BigUInt64BE(buf, at) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[at + i]);
  return v;
}
