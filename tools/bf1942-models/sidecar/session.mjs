// A reusable sidecar session: owns the UDP connection, runs the join the real
// client runs (wire.md §5-6), decodes the server's event stream, frames the
// ghost (object-update) stream into per-object records, and emits all of it.
// join.mjs (the CLI tester) and sidecar.mjs (the browser bridge) are thin
// layers over this.
//
// Events emitted:
//   open {local}                connected {id, serverTime}   joined {playerId, team, players, objects}
//   event <decoded event>       (every known server event, in order; after a
//                               ChatFragment that finishes a line, a synthetic
//                               {type:'Chat', pid, text, team, server})
//   unknown-event {id, seq, block, bitOffset, hex}
//   ghost {seq, tick, count, hasControl, records:[{netId,action,bodyBits,hex}], raw?}
//   unknown-datagram {type, hex}   decode-error {where, seq, message, hex}
//   denied {...}  disconnected {...}  pong rttMs  stats {...}  left
//   level-change {password, mod}   (GameStatus 5: the server will restart for
//                               the next level; rejoin.mjs)
//   plus-settings <settings>    (a welcome line carried bf42++ server settings;
//                               plus.mjs parseServerSettings, wire.md §30)
//   skip-static-objects         (bf42++ SpecialGame 2 before the SetLevel: this
//                               connection's level loads without StaticObjects.con)

import { EventEmitter } from 'node:events';
import { NetConnection } from './netconn.mjs';
import {
  BitReader, BitWriter, readEvent, writeEventBlock, writeActionBlock,
  BLOCK_COUNT_BITS, BLOCK_INDEX_BITS, EVENT_TYPE_BITS, EVENT_BY_ID,
} from './events.mjs';
import { BodyDecoder } from './body-decoder.mjs';
import { recordFor } from './record.mjs';
import { decodeControlState, ControlBaselines } from './ghost/control-state.mjs';
import { ChatAssembler, ChatSender } from './chat.mjs';
import { reconnectFromGameStatus, DISCONNECT } from './rejoin.mjs';
import { defaultServerSettings, parseServerSettings, restartTiming } from './plus.mjs';

const SERVER_EXE_CHECKSUM = 0xa14aac64; // GameServer::calculateServerCheckSums 0x08133220
const STREAM = { INPUT: 1 << 0, EVENTS: 1 << 1, GHOSTS: 1 << 2, DOWNLOAD: 1 << 3 };
const MASK_BITS = 6;

/**
 * The ChallengeResponse events a Challenge is answered with, in order. The
 * retail client (BF1942.exe builds them at 0x0049502b and 0x00495177) always
 * sends one with xpack -1 (0x0049514c, `addEvent` 0x0049515b), and when the
 * Challenge names an expansion (`+0x27` != -1, 0x00495160) a second with
 * that xpack in the same block (0x0049526f, `addEvent` 0x0049527a): the
 * base game's key, then the expansion's. The server needs both on an
 * expansion's level:
 * `GameServer::authentificationOk` (lnxded 0x08139950) counts each
 * authentication on the connection (`+0x16c`) and, while
 * `XpackUtils::checkXpackMapModIdForProdAuth` (0x080d6320, the map id XPack1
 * or XPack2) holds, returns before SetLevel until the second. Answered with
 * only the expansion's, a Secret Weapons server (xpack 783) never sent the
 * level.
 */
export function challengeResponses(challenge) {
  const a = (challenge.challenge.readUInt32LE(0) ^ SERVER_EXE_CHECKSUM) >>> 0;
  const out = [{ a, b: 0, c: 0, xpack: -1, flag: 0 }];
  if (challenge.xpack !== -1) out.push({ a, b: 0, c: 0, xpack: challenge.xpack, flag: 0 });
  return out;
}

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
    // The reconnect password is the four digits the previous level's
    // GameStatus 5 carried (rejoin.mjs); empty on an ordinary join.
    // `plus`: the bf42++ identity the ConnectAcceptAck carries (plus.mjs;
    // undefined = this PC's bf42++ build, null = a retail client).
    this.conn = new NetConnection(host, port, { password: opts.password ?? '', reconnectPassword: opts.reconnectPassword ?? '', plus: opts.plus, log: () => {} });
    // What a bf42++ client keeps for the life of its process (wire.md §30):
    // the server settings from the welcome lines (g_serverSettings), and
    // whether a SpecialGame 2 came before the SetLevel (g_skipLoadingStatic-
    // Objects, setLevelEventReceived). The client restarts its process at a
    // level change, and the sidecar starts a new Session there, so a Session
    // is the unit. `templateExists(name)` answers for a 3DO's template.
    this.plus = { settings: defaultServerSettings(), skipStaticObjects: false, setLevelSeen: false };
    this.templateExists = opts.templateExists ?? null;
    // A server that goes quiet this long while connected has gone (a lost
    // Disconnect datagram, a crash, a restart we were not told of): report it
    // as a PRTimeOut disconnect. A live server sends ghosts at 20 Hz and pings
    // after 3 s of quiet (_updateConnections 0x08433af0), so 20 s is no false alarm.
    this.silenceMs = opts.silenceMs ?? 20000;
    // Set by GameStatus 5: {password, mod}. The next drop is a level change.
    this.levelChange = null;
    this.players = new Map();
    this.objects = new Map();
    this.soldiers = new Set();   // netIds that are a player's on-foot control object
    this.animStates = opts.animStates ?? 0; // engine animation state count (sizes a body's state fields; 0 = the level's, from the install)
    // Picks each ghost body's reader from the events (body-decoder.mjs).
    this.bodies = new BodyDecoder({ animStates: this.animStates });
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
    // chat (chat.mjs): the server's lines put back together, and our own sent
    // a piece at a time
    this.chatIn = new ChatAssembler();
    this.chatOut = new ChatSender(this);
    this._wire();
  }

  // ---- public ----
  async start() {
    const addr = await this.conn.bind();
    this.emit('open', { local: `${addr.address}:${addr.port}` });
    this.conn.connect();
    this._flushTimer = setInterval(() => this._flush(), 33);
    this._pingTimer = setInterval(() => this.conn.pingRequest(), 2000);
    this._quietTimer = setInterval(() => this._checkQuiet(), 1000);
  }

  _checkQuiet() {
    if (this.conn.state !== 'connected') return;
    if (Date.now() - this.conn.lastHeardAt <= this.silenceMs) return;
    this.conn.state = 'closed';
    this.emit('disconnected', { reason: DISCONNECT.TIMEOUT, name: 'PRTimeOut', message: '', local: true });
  }

  leave() {
    clearInterval(this._flushTimer); clearInterval(this._pingTimer); clearInterval(this._quietTimer);
    this.chatOut.stop();
    this.conn.disconnect(0xd, '');
    this.emit('left');
    this.emit('stats', { ...this.conn.stats, players: this.players.size, objects: this.objects.size, joined: this.joined });
    this.conn.close();
  }

  // The server ended the connection: stop this session's timers and socket
  // without the goodbye leave() sends. A replaced session left its flush and
  // ping timers running against a closed socket for the rest of the process.
  close() {
    clearInterval(this._flushTimer); clearInterval(this._pingTimer); clearInterval(this._quietTimer);
    this.chatOut.stop();
    try { this.conn.close(); } catch { /* already closed */ }
  }

  queue(name, body = {}) { this.outbox.push([name, body]); }

  // When to start probing, and how often, after this connection's server
  // restarts for the next level: bf42++'s faster pinger unless the server
  // said UI&nfr, or the retail pinger for a retail identity (plus.mjs).
  restartTiming() { return restartTiming({ plus: !!this.conn.plus, settings: this.plus.settings }); }

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

  // Frame the ghost stream into per-object records (GhostManager
  // processReceivedPacket 0x081435a0 / readData 0x08141ed0): u32 tick, u8
  // count, bool hasControl, the control-object state when the bool is set,
  // then per object a 2-bit action, a 16-bit netId, and for action 1 a 1-bit
  // flag + 11-bit body length + that many body bits (the class's setNetUpdate
  // output). The control-object state is self-describing: it opens with a
  // 12-bit length of the fields that follow it, so 12 + n sizes it whole.
  _readGhosts(r, seq, payload) {
    const start = r.pos;
    let tick, count, hasControl;
    try {
      tick = r.readUnsigned(32);
      count = r.readUnsigned(8);
      hasControl = r.readBool();
    } catch (e) { return this.emit('ghost', { seq, raw: hexFrom(r, start), reason: 'header', message: e.message }); }
    // GhostManager::readControlObjectState 0x081428a0 reads a 12-bit length
    // first; GhostManager::writeControlObjectState 0x081422b0 reserves those
    // 12 bits, writes the state (s32 control id, bool, compressed vector, u16
    // netId, a delta flag and the object's own update body), then stores the
    // bit count of everything after the reserved field. So the state is
    // exactly 12 + n bits and needs no field decode to step over.
    let controlBits = 0;
    let controlRec = null;
    let blockRef = null; // the records' compression reference (pco.mjs readSimpleObject)
    if (hasControl) {
      const at = r.pos;
      try {
        const n = r.readUnsigned(12);
        const fieldsAt = r.pos;
        r.skip(n);
        controlBits = 12 + n;
        // Decode it (ghost/control-state.mjs): this is the only place the
        // server says where it has the local player's own object.
        const controlHex = bitSliceHex(payload, fieldsAt, n);
        try {
          const c = this._decodeControl(controlHex, n, seq, tick);
          blockRef = c.rootPos ?? null;
          controlRec = this._controlRecord(c);
        } catch (e) {
          this.emit('control-state', { seq, tick, ok: false, reason: e.message, hex: controlHex, bits: n });
        }
      } catch (e) {
        return this.emit('ghost', {
          seq, tick, count, hasControl: true, raw: hexFrom(r, at),
          reason: 'control-object-state', message: e.message,
        });
      }
    }
    // The control object rides first, as an ordinary decoded record marked
    // `control`, so every consumer draws the local player like anyone else.
    const records = controlRec ? [controlRec] : [];
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
          if (blockRef) rec.ref = blockRef;
          // Decode the body so the recording can move, face, take a stance and
          // fire. The object's class picks the reader, and the class comes from
          // the template id in its createObject (the level's template table,
          // template-table.mjs): the wire never names it. A vehicle's body is its hull plus its child networkables
          // (ghost/pco.mjs), a player's is its own (ghost/player.mjs), a
          // soldier's is one networkable.
          try { this.bodies.decode(rec); } catch { /* stays raw; the review log keeps it */ }
          records.push(rec);
        } else if (action === 3 || action === 0) {
          records.push({ netId, action, bodyBits: null, hex: null });
        } else {
          // action 2 is the engine's own desync marker; stop and keep the rest raw
          records.push({ netId, action, bodyBits: null, hex: null, note: 'unframed-action' });
          this.emit('ghost', { seq, tick, count, hasControl, controlBits, records, raw: hexFrom(r, r.pos), reason: `action-${action}` });
          return;
        }
      }
    } catch (e) {
      return this.emit('ghost', { seq, tick, count, hasControl, controlBits, records, raw: hexFrom(r, r.pos), reason: 'frame-underflow', message: e.message });
    }
    this.emit('ghost', { seq, tick, count, hasControl, controlBits, records });
  }

  // ---- the control-object state ------------------------------------------
  //
  // The local player's own soldier or vehicle (ghost/control-state.mjs). It is
  // emitted as 'control-state' and also as an ordinary decoded record, so the
  // recording and the page see their own object exactly as they see others.
  _decodeControl(hex, n, seq, tick) {
    if (!this.controlBaselines) this.controlBaselines = new ControlBaselines();
    const c = decodeControlState(hex, n, {
      classOf: (id) => this.bodies.classOf(id),
      templateOf: (id) => this.bodies.info(id)?.tmpl ?? null,
      seatOf: (id) => this.bodies.seatOf(id),
      baselines: this.controlBaselines,
      animStates: this.bodies.animStates, // the count the level's setLevel settled (body-decoder.mjs)
    });
    c.seq = seq; c.tick = tick; c.hex = hex; c.bits = n;
    this.emit('control-state', c);
    return c;
  }

  // A decoded control state as a ghost record (pos/rot/body like
  // BodyDecoder.decode's), or null when it did not decode.
  _controlRecord(c) {
    if (!c?.ok || !c.body) return null;
    const rec = { netId: c.netId, action: 1, bodyBits: null, hex: null, control: true, cls: c.cls, body: c.body };
    if (c.cls === 'FreeCameraNetworkable') return null; // the spawn camera is not drawn
    if (c.body.pos) { rec.pos = c.body.pos; rec.rot = c.body.rot || null; }
    return rec;
  }

  // ---- the client's own input (stream 0) --------------------------------
  //
  // The input path lives in `input.mjs` (InputSender), which owns the 30 Hz
  // schedule, the idle policy and the framing. It is deliberately the only
  // sender: a second implementation of the same block in here would be free to
  // drift from it, and the engine's record has exactly one shape.

  // ---- the join, and world state ----
  _handle(ev, seq) {
    try { this.bodies.note(recordFor(ev)); } catch { /* an odd event never stops the stream */ }
    this.emit('event', ev);
    switch (ev.type) {
      case 'Challenge': {
        this.me.challengeA = (ev.challenge.readUInt32LE(0) ^ SERVER_EXE_CHECKSUM) >>> 0;
        this.me.challengeXpack = ev.xpack;
        this.queue('ConnectionType', { connType: 0 });
        this.queue('CreatePlayer', { team: this.team, name: this.name });
        setTimeout(() => {
          if (this.conn.state === 'connected') {
            for (const body of challengeResponses(ev)) this.queue('ChallengeResponse', body);
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
      case 'SetTeam':
        // Our side as the server now has it, so a rejoin asks for the same one.
        if (ev.playerId === this.me.playerId && (ev.team === 1 || ev.team === 2)) this.me.team = ev.team;
        break;
      case 'GameStatus': {
        // Status 5: the level's last round is over and the server will restart
        // itself for the next level; its tail is the reconnect password and
        // the next mod (rejoin.mjs). Sent twice (gameStatusFirstEndGame, then
        // gameStatusEndGame just before the 0x19 disconnects); the first is
        // the one that reliably arrives.
        const rc = reconnectFromGameStatus(ev);
        if (rc) { this.levelChange = rc; this.emit('level-change', rc); }
        break;
      }
      case 'ChatFragment': {
        // The server sends this connection one line at a time
        // (StringManager::updateSendStream 0x0815d3c0), so one assembler.
        // A piece the engine's receiver would refuse is reported and the line
        // dropped; a first piece then starts afresh rather than be lost too.
        let line = this.chatIn.push(ev);
        if (line?.refused) {
          this.emit('decode-error', { where: 'chat', seq, message: line.refused });
          this.chatIn.reset();
          line = ev.first ? this.chatIn.push(ev) : null;
        }
        if (line && !line.refused) this.emit('event', { type: 'Chat', ...line });
        break;
      }
      case 'WelcomeMsg': {
        // bf42++ parses every welcome line for its settings
        // (gameevent.cpp:153-157 -> settings.cpp:306); a retail client
        // shows the line and nothing more.
        const before = this.plus.settings.seen.length;
        parseServerSettings(ev.message, this.plus.settings, { templateExists: this.templateExists });
        if (this.plus.settings.seen.length > before) this.emit('plus-settings', this.plus.settings);
        break;
      }
      case 'SpecialGame':
        // gameevent.cpp:225-236: action 2 before this connection's SetLevel
        // means "do not run the level's StaticObjects.con". After the
        // SetLevel it is passed on as an ordinary SpecialGame.
        if (ev.kind === 2 && !this.plus.setLevelSeen && !this.plus.skipStaticObjects) {
          this.plus.skipStaticObjects = true;
          this.emit('skip-static-objects');
        }
        break;
      case 'SetLevel': this.plus.setLevelSeen = true; break;
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
