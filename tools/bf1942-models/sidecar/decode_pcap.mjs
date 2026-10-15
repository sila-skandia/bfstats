#!/usr/bin/env node
// Decode a tcpdump capture of a BF1942 session through the wire decoders.
//
//   node decode_pcap.mjs capture.pcap [--port 14568] [--events-only] [--json out.ndjson]
//
// Reads a classic libpcap file (what `tcpdump -w` writes), pulls every UDP
// datagram to/from the game port, parses the 7-byte datagram header
// (netconn.mjs / wire.md §1), and for Data datagrams decodes the stream mask
// and the GameEventManager block (events.mjs / wire.md §2-3). The point is to
// read, in order, the events the real client sends after the challenge — the
// open question J-8 / the POC's step 2.
//
// Direction is by UDP port: a datagram whose destination is the game port is
// client->server (C->S), the other way server->client (S->C).

import fs from 'node:fs';
import { BitReader, readEventBlock } from './events.mjs';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('port', 14568));
const eventsOnly = args.includes('--events-only');
const jsonPath = opt('json', null);
if (!path) { console.error('usage: node decode_pcap.mjs capture.pcap [--port N] [--events-only] [--json out]'); process.exit(2); }

const out = jsonPath ? fs.createWriteStream(jsonPath) : null;
function emit(rec) { if (out) out.write(JSON.stringify(rec) + '\n'); }

const PT_NAME = {
  1: 'ConnectRequest', 2: 'ConnectAccept', 3: 'ConnectDenied', 4: 'ConnectAcceptAck',
  5: 'Disconnect', 7: 'PingRequest', 8: 'PingResponse', 9: 'ServerInfoRequest',
  0xa: 'ServerInfo', 0xf: 'Data',
};
const STREAMS = ['input', 'events', 'ghosts', 'download'];

// --- classic pcap reader --------------------------------------------------

function* pcapPackets(buf) {
  if (buf.length < 24) throw new Error('not a pcap file');
  const magic = buf.readUInt32LE(0);
  let le;
  if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) le = true;
  else if (magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1) le = false;
  else if (buf.readUInt32LE(0) === 0x0a0d0d0a) throw new Error('this is a pcapng file; capture with `tcpdump -w ... ` which writes classic pcap, or convert with `editcap -F pcap`');
  else throw new Error(`unknown pcap magic 0x${magic.toString(16)}`);
  const u32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const u16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const linktype = u32(20);
  let off = 24;
  while (off + 16 <= buf.length) {
    const tsSec = u32(off), tsUsec = u32(off + 4), caplen = u32(off + 8);
    off += 16;
    if (off + caplen > buf.length) break;
    yield { ts: tsSec + tsUsec / 1e6, data: buf.subarray(off, off + caplen), linktype };
    off += caplen;
  }
}

// Skip the link-layer header for the link types tcpdump uses on this host.
function l3offset(data, linktype) {
  switch (linktype) {
    case 1: return 14;            // EN10MB (ethernet, and lo on Linux)
    case 0: case 108: return 4;   // NULL / LOOP (4-byte address family)
    case 101: return 0;           // RAW
    case 113: return 16;          // LINUX_SLL
    case 276: return 20;          // LINUX_SLL2
    case 12: case 14: return 0;   // RAW variants
    default: return null;
  }
}

// Find the IPv4 + UDP payload; returns {src, dst, sport, dport, payload} or null.
function udp(data, linktype) {
  let o = l3offset(data, linktype);
  if (o === null) {
    // Unknown link type: scan a few offsets for an IPv4/UDP header.
    for (const cand of [0, 2, 4, 14, 16, 20]) { const r = ip(data, cand); if (r) return r; }
    return null;
  }
  return ip(data, o);
}

function ip(data, o) {
  if (o + 20 > data.length) return null;
  if ((data[o] >> 4) !== 4) return null;          // IPv4 only
  const ihl = (data[o] & 0xf) * 4;
  if (data[o + 9] !== 17) return null;            // UDP
  const src = `${data[o + 12]}.${data[o + 13]}.${data[o + 14]}.${data[o + 15]}`;
  const dst = `${data[o + 16]}.${data[o + 17]}.${data[o + 18]}.${data[o + 19]}`;
  const u = o + ihl;
  if (u + 8 > data.length) return null;
  const sport = data.readUInt16BE(u), dport = data.readUInt16BE(u + 2);
  const ulen = data.readUInt16BE(u + 4);
  const payload = data.subarray(u + 8, Math.min(data.length, u + ulen));
  return { src, dst, sport, dport, payload };
}

// --- datagram + event decode ----------------------------------------------

const MASK_BITS = 6;

function decodeDatagram(payload, dir, ts, seqLog) {
  if (payload.length < 7) return;
  const type = payload[2] >> 4;
  const name = PT_NAME[type] ?? `0x${type.toString(16)}`;
  const seq = payload[1] & 0x3f;
  const ack = ((payload[2] & 0xf) << 2) | (payload[1] >> 6);
  const base = { ts: +ts.toFixed(4), dir, type: name, seq, ack, len: payload.length };

  if (type !== 0xf) {
    if (!eventsOnly) { print(base); emit(base); }
    return;
  }
  // Data: u16 length at byte 7, then the shared BitStream at byte 9.
  const bodyLen = payload.readUInt16LE(7);
  const body = payload.subarray(9, 9 + bodyLen);
  const r = new BitReader(body);
  let mask;
  try {
    mask = r.readUnsigned(MASK_BITS);
  } catch { print({ ...base, note: 'short body' }); return; }
  const present = STREAMS.filter((_, i) => mask & (1 << i));
  const rec = { ...base, mask: present };
  // The streams are concatenated in slot order: input (0), then events (1),
  // then ghosts (2), then download (3). Consume each present stream so the
  // next one lands at the right bit. We decode input and events; once ghosts
  // (per-class bit deltas, not decoded here) or download appear we stop, since
  // we can no longer find the next boundary.
  try {
    if (mask & (1 << 0)) {
      const count = r.readUnsigned(4);
      rec.input = { actions: count };
      if (count) {
        rec.input.firstSerial = r.readSigned(32);
        // each PlayerAction is six 12-bit axes + a 32-bit button mask
        for (let i = 0; i < count; i++) r.skip(6 * 12 + 32);
      }
    }
    if (mask & (1 << 1)) {
      const block = readEventBlock(r);
      rec.block = { index: block.index, resend: block.resend, count: block.count };
      rec.events = block.events.map(summariseEvent);
      rec.rawEvents = block.events;
    }
  } catch (e) {
    rec.decodeError = e.message;
    rec.bodyHex = Buffer.from(body).toString('hex');
  }
  if (!eventsOnly || rec.events || rec.decodeError) { print(rec); emit(rec); }
}

function summariseEvent(ev) {
  const { type, id } = ev;
  const keep = {};
  for (const k of ['team', 'name', 'playerId', 'spawnGroup', 'spawnPoint', 'kit', 'team', 'connType', 'scoreType',
    'netId', 'template', 'mod', 'xpack', 'serverName', 'mapId', 'value', 'type2', 'rate', 'status']) {
    if (k in ev && k !== 'type') keep[k] = ev[k];
  }
  if (ev.challenge) keep.challenge = Buffer.from(ev.challenge).toString('latin1');
  if (ev.keyHash) keep.keyHashLen = ev.keyHash.length;
  return { type, ...keep };
}

function print(rec) {
  if (rec.events) {
    const evs = rec.events.map((e) => e.type + (e.playerId !== undefined ? `#${e.playerId}` : '')).join(', ');
    console.log(`${pad(rec.ts)} ${rec.dir} ${rec.type} seq=${rec.seq} ack=${rec.ack} block=${rec.block.index}${rec.block.resend ? '(resend)' : ''} [${evs}]`);
    for (const e of rec.events) console.log('                       ' + JSON.stringify(e));
    if (rec.decodeError) console.log('   decode error: ' + rec.decodeError + ' hex=' + rec.bodyHex);
  } else if (rec.input) {
    console.log(`${pad(rec.ts)} ${rec.dir} ${rec.type} seq=${rec.seq} input actions=${rec.input.actions}`);
  } else {
    console.log(`${pad(rec.ts)} ${rec.dir} ${rec.type} seq=${rec.seq} ack=${rec.ack} len=${rec.len}${rec.note ? ' ' + rec.note : ''}${rec.mask ? ' mask=[' + rec.mask + ']' : ''}`);
  }
}
const pad = (t) => String(t).padStart(10);

// --- run ------------------------------------------------------------------

const buf = fs.readFileSync(path);
let n = 0, first = null;
for (const pkt of pcapPackets(buf)) {
  const u = udp(pkt.data, pkt.linktype);
  if (!u) continue;
  if (u.sport !== PORT && u.dport !== PORT) continue;
  if (first === null) first = pkt.ts;
  const dir = u.dport === PORT ? 'C->S' : 'S->C';
  n++;
  decodeDatagram(u.payload, dir, pkt.ts - first, null);
}
console.error(`\n${n} datagrams on udp/${PORT}`);
if (out) out.end();
