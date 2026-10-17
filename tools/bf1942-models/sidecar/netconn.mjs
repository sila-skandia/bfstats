// The datagram layer: dice::ref2::io::NetServer / SWConnection, from the
// client's side. Every number here is read from bf1942_lnxded.static; the
// addresses are in features/udp-sidecar/wire.md.
//
// A datagram is a 7-byte header and a payload:
//   [0]    connection id (the one ConnectAccept assigned; anything before)
//   [1]    bits 0-5 sequence, bits 6-7 the two low bits of the ack sequence
//   [2]    bits 0-3 the four high bits of the ack sequence, bits 4-7 the type
//   [3..6] ack mask, little-endian: bit i says whether sequence (ack - i)
//          was received
// Types: 1 ConnectRequest (84 bytes), 2 ConnectAccept (13), 3 ConnectDenied
// (16), 4 ConnectAcceptAck (8), 5 Disconnect (524), 7 PingRequest (13),
// 8 PingResponse (17), 9 ServerInfoRequest, 0xa ServerInfo (136), 0xf Data.

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { buildPlusAcceptAck } from './plus.mjs';

export const PT = {
  ConnectRequest: 1, ConnectAccept: 2, ConnectDenied: 3, ConnectAcceptAck: 4,
  Disconnect: 5, PingRequest: 7, PingResponse: 8, ServerInfoRequest: 9, ServerInfo: 0xa,
  Data: 0xf,
};

export const PRESULT = {
  0: 'PROk', 1: 'PRNewConnection', 2: 'PRServerIsFull', 4: 'PRConnectFailed', 5: 'PRInvalidParam',
  6: 'PRSocketFailed', 7: 'PRAllocFailed', 8: 'PRNoPacket', 9: 'PRFailed', 10: 'PRTimeOut',
  11: 'PRIgnored', 12: 'PRSystem', 13: 'PRDisconnect', 14: 'PRRecvBufferOverflow',
  15: 'PRSendBufferOverflow', 16: 'PRPacketTooBig', 17: 'PRInvalidPassword', 18: 'PRConnecting',
  0x17: 'VersionTooOld', 0x18: 'VersionTooNew', 0x1e: 'PRInvalidReservedPassword',
  // Not PResults but the game's own disconnect and denial reasons, carried in
  // the same field (rejoin.mjs): GameServer::kickPlayers 0x08148b20 closes a
  // kicked player with 0x15 and a banned one with 0x16 (handleConnectRequest
  // 0x08436810 denies a banned address with 0x16 too), and gameStatusEndGame
  // 0x08152ca0 closes every connection with 0x19 before the server restarts
  // itself for the next level.
  0x15: 'Kicked', 0x16: 'Banned', 0x19: 'LevelChange',
};

export const PROTOCOL_MAJOR = 0x1002; // NetServer::checkVersion 0x084367d0
export const PROTOCOL_MINOR = 1610;   // *(0x086b1580), passed to setVersion by GameServer::startServer
export const MAX_DATAGRAM = 0x5c0;     // 1472, the server's receive buffer
export const MAX_PAYLOAD = 0x5c0 - 9;  // addPacketToSendBuffer: payload + 9 < 0x5c1

const SEQ_MASK = 0x3f;
const SEQ_HALF = 0x20;

// ConnectRequestPacket, 84 bytes (handleConnectRequest 0x08436810; the retail
// client's builder is BF1942.exe 0x0060f300): [8] u32 major, [12] u32 minor,
// [16..79] the server password, [80..83] the reconnect password. The client
// fills both with strncpy: the password to 0x20 bytes, the reconnect password
// to 4 (0x0060f332 / 0x0060f34f), so a shorter one is NUL-padded and an empty
// one is four zeros. The reconnect password is the four digits a server's
// GameStatus 5 carried before it restarted for the next level (rejoin.mjs);
// NetServer::checkReconnectPassword 0x08436750 compares exactly four bytes.
export function buildConnectRequest({ password = '', reconnectPassword = '' } = {}) {
  const b = Buffer.alloc(0x54);
  b[2] = PT.ConnectRequest << 4;
  b.writeUInt32LE(PROTOCOL_MAJOR, 8);
  b.writeUInt32LE(PROTOCOL_MINOR, 12);
  b.write(String(password).slice(0, 63), 16, 'latin1');
  b.write(String(reconnectPassword).slice(0, 4), 80, 'latin1');
  return b;
}

// ServerInfoRequestPacket: the retail client's wait-for-server probe
// (BF1942.exe 0x004b7030) sends 8 bytes whose only set field is the type
// nibble 9; the server answers any length with a 136-byte ServerInfo
// (NetServer::_update 0x08433e60 dispatches type 9 before any connection
// lookup -> handleServerInfoRequest 0x08436e60 -> sendServerInfo 0x08436280:
// [0] 1, type 0xa, [8..] the server's name).
export function buildServerInfoRequest() {
  const b = Buffer.alloc(8);
  b[2] = PT.ServerInfoRequest << 4;
  return b;
}

export function parseServerInfo(buf) {
  if (!buf || buf.length < 7 || (buf[2] >> 4) !== PT.ServerInfo) return null;
  return { name: buf.length > 8 ? cstr(buf.subarray(8)) : '' };
}

// Ask a server whether it is up, as the retail client does while it waits for
// a restarting server: one ServerInfoRequest, and the answer or null.
export function probeServerInfo(host, port, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const end = (v) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closed */ }
      resolve(v);
    };
    const timer = setTimeout(() => end(null), timeoutMs);
    sock.on('error', () => end(null));
    sock.on('message', (msg) => { const info = parseServerInfo(msg); if (info) end(info); });
    try { sock.send(buildServerInfoRequest(), port, host, (err) => { if (err) end(null); }); } catch { end(null); }
  });
}

export class NetConnection extends EventEmitter {
  constructor(host, port, opts = {}) {
    super();
    this.host = host;
    this.port = port;
    this.password = opts.password ?? '';
    this.reconnectPassword = opts.reconnectPassword ?? '';
    // Identify as a bf42++ client in the ConnectAcceptAck (plus.mjs), or
    // null to send the retail ack. A server reads only the id and the type
    // of it, so a retail server is indifferent; a bf42++-aware one reads the
    // marker and may then send bf42++'s own events (events.mjs).
    this.plus = opts.plus === undefined ? {} : opts.plus;
    this.log = opts.log ?? (() => {});
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (msg, rinfo) => this._onDatagram(msg, rinfo));
    this.state = 'closed'; // closed | connecting | accepted | connected
    this.id = -1;
    this.t0 = Date.now();
    // SWConnection::reset 0x0843b820
    this.sendSeq = 1;        // +0x5c, next sequence to send
    this.lastRecv = 0;       // +0x60, last sequence received
    this.lastConfirmed = 0;  // +0x64, last sequence the peer acked
    this.recvMask = 0;       // +0xec, received history, bit 0 = lastRecv
    this.lastSentSeq = -1;   // +0x68
    this.sentPackets = new Map(); // seq -> tag, for delivery status
    this.stats = { sent: 0, received: 0, lost: 0, duplicates: 0, rttMs: null };
    this._connectTimer = null;
    this.lastHeardAt = Date.now(); // the last datagram from the server (Session's quiet watchdog)
  }

  now() { return (Date.now() - this.t0) >>> 0; }

  async bind() {
    await new Promise((res, rej) => { this.sock.once('error', rej); this.sock.bind(0, () => res()); });
    return this.sock.address();
  }

  close() {
    clearInterval(this._connectTimer);
    try { this.sock.close(); } catch { /* already closed */ }
    this.state = 'closed';
  }

  // --- the handshake -------------------------------------------------------

  // ConnectRequestPacket, 84 bytes (buildConnectRequest above).
  connect() {
    const b = buildConnectRequest({ password: this.password, reconnectPassword: this.reconnectPassword });
    this.state = 'connecting';
    const send = () => { if (this.state === 'connecting') this._raw(b); };
    send();
    this._connectTimer = setInterval(send, 1000);
  }

  _onConnectAccept(buf) {
    // 13 bytes: [8] the id this connection gets, [9..12] the server's ms clock
    // (sendConnectAccept 0x08436110). The ack is 8 bytes with our id in
    // byte 0 and type 4 (handleConnectAcceptAck 0x08436560).
    if (this.state !== 'connecting' && this.state !== 'accepted') return;
    clearInterval(this._connectTimer);
    this.id = buf[8];
    this.serverTime = buf.readUInt32LE(9);
    this.state = 'accepted';
    let ack;
    if (this.plus) {
      ack = buildPlusAcceptAck(this.id, this.plus.version, this.plus.protocol);
    } else {
      ack = Buffer.alloc(8);
      ack[0] = this.id;
      ack[2] = PT.ConnectAcceptAck << 4;
    }
    this._raw(ack);
    this.state = 'connected';
    this.emit('connected', { id: this.id, serverTime: this.serverTime });
  }

  // DisconnectPacket, 0x20c bytes: [8] u32 reason, [12..] 512-char message
  // (sendDisconnect 0x08436360). The client sends reason 0xd (J-3).
  disconnect(reason = 0xd, message = '') {
    if (this.state !== 'connected') return;
    const b = this._header(PT.Disconnect, 0x20c);
    b.writeUInt32LE(reason, 8);
    b.write(message.slice(0, 511), 12, 'latin1');
    this._raw(b);
    this.state = 'closed';
  }

  // --- data ---------------------------------------------------------------

  // One datagram carrying one payload; the engine's u16 length prefix at
  // byte 7 (addPacketToSendBuffer 0x0843bb80). Returns the sequence used.
  sendData(payload, tag = null) {
    if (this.state !== 'connected') throw new Error('not connected');
    if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} > ${MAX_PAYLOAD}`);
    // SWConnection::send 0x0843be80: no more than 30 sequences ahead of the last ack.
    const seq = this.sendSeq & SEQ_MASK;
    if (((seq - this.lastConfirmed) & SEQ_MASK) > 0x1e) throw new Error('send window full');
    const b = this._header(PT.Data, 9 + payload.length, seq);
    b.writeUInt16LE(payload.length, 7);
    Buffer.from(payload.buffer, payload.byteOffset, payload.length).copy(b, 9);
    this._raw(b);
    this.sendSeq++;
    this.lastSentSeq = seq;
    this.sentPackets.set(seq, tag);
    this.stats.sent++;
    return seq;
  }

  // PingRequestPacket, 13 bytes: [8] u32 our clock, [12] 1 if we ever sent
  // data (sendPingRequest 0x08436040 / SWConnection::sendPingRequest
  // 0x0843bae0). The sequence field repeats our last data sequence.
  pingRequest() {
    if (this.state !== 'connected') return;
    const b = this._header(PT.PingRequest, 13, this.lastSentSeq & SEQ_MASK);
    b.writeUInt32LE(this.now(), 8);
    b[12] = this.lastSentSeq !== -1 ? 1 : 0;
    this._raw(b);
  }

  // PingResponsePacket, 17 bytes: [8] the request's clock, [12] ours,
  // [16] the same flag (sendPingResponse 0x08435f70).
  _pingResponse(echo) {
    const b = this._header(PT.PingResponse, 17, this.lastSentSeq & SEQ_MASK);
    b.writeUInt32LE(echo, 8);
    b.writeUInt32LE(this.now(), 12);
    b[16] = this.lastSentSeq !== -1 ? 1 : 0;
    this._raw(b);
  }

  _header(type, size, seq = 0) {
    const b = Buffer.alloc(size);
    b[0] = this.id & 0xff;
    b[1] = (seq & SEQ_MASK) | ((this.lastRecv & 3) << 6);
    b[2] = (type << 4) | ((this.lastRecv >> 2) & 0xf);
    b.writeUInt32LE(this.recvMask >>> 0, 3);
    return b;
  }

  _raw(b) { this.sock.send(b, this.port, this.host); this.emit('raw-out', b); }

  // --- receive --------------------------------------------------------------

  _onDatagram(buf, rinfo) {
    this.emit('raw-in', buf, rinfo);
    if (buf.length < 7) return;
    this.lastHeardAt = Date.now();
    const type = buf[2] >> 4;
    switch (type) {
      case PT.ConnectAccept: return this._onConnectAccept(buf);
      case PT.ConnectDenied: {
        clearInterval(this._connectTimer);
        const reason = buf.length >= 12 ? buf.readUInt32LE(8) : -1;
        this.state = 'closed';
        return this.emit('denied', { reason, name: PRESULT[reason] ?? `0x${reason.toString(16)}` });
      }
      case PT.Disconnect: {
        const reason = buf.length >= 12 ? buf.readUInt32LE(8) : -1;
        const message = buf.length > 12 ? cstr(buf.subarray(12)) : '';
        this.state = 'closed';
        return this.emit('disconnected', { reason, name: PRESULT[reason] ?? `0x${reason.toString(16)}`, message });
      }
      case PT.PingRequest: {
        if (buf.length !== 13 || this.state !== 'connected') return;
        if (buf[12] === 1) this._accountSeq(buf[1] & SEQ_MASK, false);
        this._confirm(buf);
        return this._pingResponse(buf.readUInt32LE(8));
      }
      case PT.PingResponse: {
        if (buf.length !== 17 || this.state !== 'connected') return;
        if (buf[16] === 1) this._accountSeq(buf[1] & SEQ_MASK, false);
        this._confirm(buf);
        this.stats.rttMs = (this.now() - buf.readUInt32LE(8)) >>> 0;
        return this.emit('pong', this.stats.rttMs);
      }
      case PT.Data: {
        if (this.state !== 'connected') return;
        const seq = buf[1] & SEQ_MASK;
        // handleDataPacket 0x08436f30: a duplicate or an old sequence is dropped.
        const d = (seq - this.lastRecv) & SEQ_MASK;
        if (seq === this.lastRecv || d >= SEQ_HALF) { this.stats.duplicates++; return; }
        this._confirm(buf);
        this._accountSeq(seq, true);
        this.stats.received++;
        const len = buf.readUInt16LE(7);
        const payload = buf.subarray(9, 9 + len);
        return this.emit('data', payload, seq);
      }
      case PT.ServerInfo:
        return this.emit('server-info', parseServerInfo(buf));
      default:
        return this.emit('unknown', type, buf);
    }
  }

  // The receiver's bookkeeping for a sequenced packet (handleDataPacket for
  // data, handlePingRequestPacket 0x08436e70 for a ping that carries one): the
  // history mask shifts by the gap, then records this one as received (data)
  // or as lost (a ping repeating a sequence we never saw).
  _accountSeq(seq, received) {
    const d = (seq - this.lastRecv) & SEQ_MASK;
    if (d === 0 || d >= SEQ_HALF) return;
    if (d > 1) { this.stats.lost += d - 1; this.recvMask = (this.recvMask << (d - 1)) >>> 0; }
    this.lastRecv = seq;
    this.recvMask = ((this.recvMask << 1) | (received ? 1 : 0)) >>> 0;
    if (!received) this.stats.lost++;
  }

  // SWConnection::confirmPacket 0x0843bfb0: walk the sequences between the
  // last confirmed and this ack, oldest first, and report each as delivered
  // or lost from the mask.
  _confirm(buf) {
    const ackSeq = ((buf[2] & 0xf) << 2) | (buf[1] >> 6);
    const mask = buf.readUInt32LE(3);
    const d = (ackSeq - this.lastConfirmed) & SEQ_MASK;
    if (d >= SEQ_HALF || d === 0) return;
    this.lastConfirmed = ackSeq;
    for (let i = d - 1; i >= 0; i--) {
      const seq = (ackSeq - i) & SEQ_MASK;
      const delivered = (mask & (1 << i)) !== 0;
      const tag = this.sentPackets.get(seq);
      this.sentPackets.delete(seq);
      this.emit('status', { seq, delivered, tag });
    }
  }
}

function cstr(b) { const n = b.indexOf(0); return b.subarray(0, n < 0 ? b.length : n).toString('latin1'); }
