// A reusable sidecar session: owns the UDP connection, runs the join the real
// client runs (wire.md §5-6), decodes the server's event stream, frames the
// ghost (object-update) stream into per-object records, and emits all of it.
// join.mjs (the CLI tester) and sidecar.mjs (the browser bridge) are thin
// layers over this.
//
// Events emitted:
//   open {local}                connected {id, serverTime}   joined {playerId, team, players, objects}
//   event <decoded event>       (every known server event, in order)
//   unknown-event {id, seq, block, bitOffset, hex}
//   ghost {seq, tick, count, hasControl, records:[{netId,action,bodyBits,hex}], raw?}
//   unknown-datagram {type, hex}   decode-error {where, seq, message, hex}
//   denied {...}  disconnected {...}  pong rttMs  stats {...}  left

import { EventEmitter } from 'node:events';
import { NetConnection } from './netconn.mjs';
import {
  BitReader, BitWriter, readEvent, writeEventBlock, writeActionBlock,
  BLOCK_COUNT_BITS, BLOCK_INDEX_BITS, EVENT_TYPE_BITS, EVENT_BY_ID,
} from './events.mjs';
import { decodeSoldierBody } from './soldier-ghost.mjs';

const SERVER_EXE_CHECKSUM = 0xa14aac64; // GameServer::calculateServerCheckSums 0x08133220
const STREAM = { INPUT: 1 << 0, EVENTS: 1 << 1, GHOSTS: 1 << 2, DOWNLOAD: 1 << 3 };
const MASK_BITS = 6;

export class Session extends EventEmitter {
  constructor(host, port, opts = {}) {
    super();
    this.name = opts.name ?? 'sidecar';
    // Team to request in CreatePlayer. 0 lets the server auto-assign (and
    // balance), which usually lands the sidecar opposite a lone human; a human
    // on the other team is relevance-culled from a sidecar parked on the spawn
    // screen (§19/P-5), so set this to the human's team to receive their
    // movement map-wide. A non-zero team is honoured unless the server forces
    // auto-balance (GameServer::createPlayer 0x081310e0 rebalances only when
    // the requested team is 0 or auto-balance is on).
    this.team = opts.team ?? 0;
    this.conn = new NetConnection(host, port, { password: opts.password ?? '', log: () => {} });
    this.players = new Map();
    this.objects = new Map();
    this.soldiers = new Set();   // netIds that are a player's on-foot control object
    this.animStates = opts.animStates ?? 0; // engine animation state count (sizes a body's state fields; 0 = vanilla's 1395)
    this.lastPos = new Map();    // netId -> last decoded position (baseline for deltas)
    this.lastRot = new Map();    // netId -> last decoded facing (carried when an update omits it)
    this.joined = false;
    this.me = { playerId: null, team: null, netIds: null, challengeA: 0, challengeXpack: -1, dbAcked: false };
    // event stream (our side)
    this.outbox = [];
    this.nextSendBlock = 0;
    this.unconfirmed = new Map();
    this.resendQueue = [];
    // event stream (server side), reordered by block index
    this.nextRecvBlock = 0;
    this.pendingBlocks = new Map();
    this._wire();
  }

  // ---- public ----
  async start() {
    const addr = await this.conn.bind();
    this.emit('open', { local: `${addr.address}:${addr.port}` });
    this.conn.connect();
    this._flushTimer = setInterval(() => this._flush(), 33);
    this._pingTimer = setInterval(() => this.conn.pingRequest(), 2000);
  }

  leave() {
    clearInterval(this._flushTimer); clearInterval(this._pingTimer);
    this.conn.disconnect(0xd, '');
    this.emit('left');
    this.emit('stats', { ...this.conn.stats, players: this.players.size, objects: this.objects.size, joined: this.joined });
    this.conn.close();
  }

  queue(name, body = {}) { this.outbox.push([name, body]); }

  // ---- connection wiring ----
  _wire() {
    this.conn.on('connected', (info) => this.emit('connected', info));
    this.conn.on('denied', (info) => this.emit('denied', info));
    this.conn.on('disconnected', (info) => this.emit('disconnected', info));
    this.conn.on('pong', (rtt) => this.emit('pong', rtt));
    this.conn.on('unknown', (type, buf) => this.emit('unknown-datagram', { type, hex: buf.toString('hex') }));
    this.conn.on('status', (s) => this._onStatus(s));
    this.conn.on('data', (payload, seq) => this._onData(payload, seq));
  }

  _flush() {
    if (this.conn.state !== 'connected') return;
    let block = null;
    if (this.resendQueue.length) {
      const r = this.resendQueue.shift();
      block = { index: r.index, resend: true, events: r.events };
    } else if (this.outbox.length) {
      if (this.unconfirmed.size >= 15) return;
      const events = this.outbox.splice(0, 0xfe);
      block = { index: this.nextSendBlock++ & 0x1f, resend: false, events };
      this.unconfirmed.set(block.index, events);
    }
    if (!block) return;
    const w = new BitWriter(1024);
    w.writeUnsigned(STREAM.EVENTS, MASK_BITS);
    writeEventBlock(w, block.index, block.resend, block.events);
    const sseq = this.conn.sendData(w.bytes(), { block: block.index });
    this.emit('sent', { seq: sseq, index: block.index, resend: block.resend, events: block.events });
  }

  _onStatus({ delivered, tag }) {
    if (!tag || tag.block === undefined) return;
    if (delivered) { this.unconfirmed.delete(tag.block); return; }
    const events = this.unconfirmed.get(tag.block);
    if (events) this.resendQueue.push({ index: tag.block, events });
  }

  // ---- receive ----
  _onData(payload, seq) {
    const r = new BitReader(payload);
    let mask;
    try { mask = r.readUnsigned(MASK_BITS); }
    catch (e) { return this.emit('decode-error', { where: 'mask', seq, message: e.message, hex: Buffer.from(payload).toString('hex') }); }

    // streams in slot order: input, events, ghosts, download
    if (mask & STREAM.INPUT) {
      // the server never sends input; if it appears we cannot find the next
      // boundary, so log and stop.
      this.emit('decode-error', { where: 'server-input-stream', seq, message: 'unexpected input stream', hex: Buffer.from(payload).toString('hex') });
      return;
    }
    if (mask & STREAM.EVENTS) {
      if (!this._readEvents(r, seq)) return; // desync: do not trust what follows
    }
    if (mask & STREAM.GHOSTS) this._readGhosts(r, seq, payload);
    if (mask & STREAM.DOWNLOAD) {
      this.emit('decode-error', { where: 'download-stream', seq, message: 'download stream present (not decoded)', hex: Buffer.from(payload).toString('hex') });
    }
  }

  // Tolerant event-block read: keep events that parse, record the first that
  // does not, and stop (the rest of the stream is then untrustworthy).
  _readEvents(r, seq) {
    let count, index, resend;
    try {
      count = r.readUnsigned(BLOCK_COUNT_BITS);
      index = r.readUnsigned(BLOCK_INDEX_BITS);
      resend = r.readBool();
    } catch (e) { this.emit('decode-error', { where: 'event-block-header', seq, message: e.message }); return false; }
    const events = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const bitOffset = r.pos;
      // peek the id so an unknown type can be reported with its bit offset
      let id;
      try { id = r.readUnsigned(EVENT_TYPE_BITS); } catch { ok = false; break; }
      const def = EVENT_BY_ID.get(id);
      if (!def) {
        this.emit('unknown-event', { id, seq, block: index, bitOffset, hex: hexFrom(r, bitOffset) });
        ok = false; break;
      }
      r.pos = bitOffset; // rewind and let readEvent consume type+body
      try { events.push(readEvent(r)); }
      catch (e) {
        this.emit('decode-error', { where: `event#${i}`, seq, message: e.message, hex: hexFrom(r, bitOffset) });
        ok = false; break;
      }
    }
    this._deliver({ index, resend, events }, seq);
    return ok;
  }

  // Deliver a block's events in block-index order, then handle each.
  _deliver(block, seq) {
    if (block.resend && this.pendingBlocks.has(block.index)) return;
    this.pendingBlocks.set(block.index, block.events);
    while (this.pendingBlocks.has(this.nextRecvBlock)) {
      const events = this.pendingBlocks.get(this.nextRecvBlock);
      this.pendingBlocks.delete(this.nextRecvBlock);
      this.nextRecvBlock = (this.nextRecvBlock + 1) & 0x1f;
      for (const ev of events) this._handle(ev, seq);
    }
  }

  // Frame the ghost stream into per-object records (GhostManager 0x081435a0 /
  // readData 0x08141ed0): u32 tick, u8 count, bool hasControl, then per object
  // a 2-bit action, a 16-bit netId, and for action 1 a 1-bit flag + 11-bit body
  // length + that many body bits (the class's setNetUpdate output). We cannot
  // size a control-object state, so a block carrying one is logged raw.
  _readGhosts(r, seq, payload) {
    const start = r.pos;
    let tick, count, hasControl;
    try {
      tick = r.readUnsigned(32);
      count = r.readUnsigned(8);
      hasControl = r.readBool();
    } catch (e) { return this.emit('ghost', { seq, raw: hexFrom(r, start), reason: 'header', message: e.message }); }
    if (hasControl) {
      return this.emit('ghost', { seq, tick, count, hasControl: true, raw: hexFrom(r, start), reason: 'control-object-state' });
    }
    const records = [];
    try {
      for (let i = 0; i < count; i++) {
        const action = r.readUnsigned(2);
        const netId = r.readUnsigned(16);
        if (action === 1) {
          r.readBool();                       // flag
          const bodyBits = r.readUnsigned(11);
          const at = r.pos;
          r.skip(bodyBits);
          const hex = bitSliceHex(payload, at, bodyBits);
          const rec = { netId, action, bodyBits, hex };
          // Decode known soldiers' bodies so the recording can move, face,
          // take a stance and fire (soldier-ghost.mjs).
          if (this.soldiers.has(netId)) {
            const b = decodeSoldierBody(hex, bodyBits, { baselinePos: this.lastPos.get(netId), animStates: this.animStates });
            if (b) {
              rec.body = b;
              if (b.pos) {
                rec.pos = b.pos;
                if (b.rot) this.lastRot.set(netId, b.rot);
                rec.rot = b.rot || this.lastRot.get(netId) || null;
                this.lastPos.set(netId, b.pos);
              }
            }
          }
          records.push(rec);
        } else if (action === 3 || action === 0) {
          records.push({ netId, action, bodyBits: null, hex: null });
        } else {
          // action 2 is the engine's own desync marker; stop and keep the rest raw
          records.push({ netId, action, bodyBits: null, hex: null, note: 'unframed-action' });
          this.emit('ghost', { seq, tick, count, hasControl: false, records, raw: hexFrom(r, r.pos), reason: `action-${action}` });
          return;
        }
      }
    } catch (e) {
      return this.emit('ghost', { seq, tick, count, hasControl: false, records, raw: hexFrom(r, r.pos), reason: 'frame-underflow', message: e.message });
    }
    this.emit('ghost', { seq, tick, count, hasControl: false, records });
  }

  // ---- the join, and world state ----
  _handle(ev, seq) {
    this.emit('event', ev);
    switch (ev.type) {
      case 'Challenge': {
        this.me.challengeA = (ev.challenge.readUInt32LE(0) ^ SERVER_EXE_CHECKSUM) >>> 0;
        this.me.challengeXpack = ev.xpack;
        this.queue('ConnectionType', { connType: 0 });
        this.queue('CreatePlayer', { team: this.team, name: this.name });
        setTimeout(() => {
          if (this.conn.state === 'connected') {
            this.queue('ChallengeResponse', { a: this.me.challengeA, b: 0, c: 0, xpack: this.me.challengeXpack, flag: 0 });
          }
        }, 60);
        break;
      }
      case 'CreatePlayer':
        this.players.set(ev.playerId, ev);
        if (!ev.isRemote && this.me.playerId === null) {
          this.me.playerId = ev.playerId; this.me.team = ev.team;
          this.me.netIds = { player: ev.playerNetId, vehicle: ev.vehicleNetId, camera: ev.cameraNetId, kit: ev.kitNetId };
        }
        break;
      case 'DestroyPlayer': this.players.delete(ev.playerId); break;
      case 'SetDefaultVehicle': if (ev.netId != null) this.soldiers.add(ev.netId); break; // on-foot control object
      case 'CreateObject': this.objects.set(ev.netId, ev); break;
      case 'DestroyObject': this.objects.delete(ev.netId); break;
      case 'DataBaseComplete':
        if (!this.me.dbAcked) {
          this.me.dbAcked = true;
          this.queue('Ack', { value: 0 });
          if (this.me.playerId !== null) this.queue('CreatePlayerAck', { playerId: this.me.playerId });
          this.queue('DatabaseCompleteAck');
          this.queue('ConnectionType', { connType: 5 });
        }
        break;
      case 'Simulation':
        if (!this.joined) {
          this.joined = true;
          this.emit('joined', { playerId: this.me.playerId, team: this.me.team, players: this.players.size, objects: this.objects.size, worldTime: ev.worldTime });
        }
        break;
      default: break;
    }
  }
}

function hexFrom(r, bitOffset) {
  const startByte = bitOffset >> 3;
  return Buffer.from(r.buf.subarray(startByte, Math.min(r.buf.length, startByte + 48))).toString('hex');
}
function bitSliceHex(payload, atBit, nBits) {
  const out = new Uint8Array((nBits + 7) >> 3);
  for (let i = 0; i < nBits; i++) if ((payload[(atBit + i) >> 3] >> ((atBit + i) & 7)) & 1) out[i >> 3] |= 1 << (i & 7);
  return Buffer.from(out).toString('hex');
}

export { STREAM };
