// A fake BF1942 server's datagrams, built with the wire's own encoders, for
// the parity generators that script a join (session.mjs, sidecar.mjs). Not
// itself a generator.
import path from 'node:path';
import { SIDECAR } from './tables.mjs';

const { BitWriter, writeEvent, EVENTS, EVENT_TYPE_BITS } = await import(path.join(SIDECAR, 'events.mjs'));
const { PT } = await import(path.join(SIDECAR, 'netconn.mjs'));

export const ID = 3;
export function dg({ type, seq = 0, ack = 0, mask = 0, body = null }) {
  const b = Buffer.alloc(7 + (body ? body.length : 0));
  b[0] = ID;
  b[1] = (seq & 0x3f) | ((ack & 3) << 6);
  b[2] = (type << 4) | ((ack >> 2) & 0xf);
  b.writeUInt32LE(mask >>> 0, 3);
  if (body) Buffer.from(body).copy(b, 7);
  return b.toString('hex');
}
export const accept = (time = 777) => { const b = Buffer.alloc(13); b[0] = 0; b[2] = PT.ConnectAccept << 4; b[8] = ID; b.writeUInt32LE(time, 9); return b.toString('hex'); };
export const data = (seq, ack, mask, payload) => { const body = Buffer.alloc(2 + payload.length); body.writeUInt16LE(payload.length, 0); payload.copy(body, 2); return dg({ type: PT.Data, seq, ack, mask, body }); };
export const disconnect = (reason) => { const b = Buffer.alloc(0x20c); b[0] = ID; b[2] = PT.Disconnect << 4; b.writeUInt32LE(reason, 8); b.write('bye', 12, 'latin1'); return b.toString('hex'); };
export const pingReq = (seq, ack, mask, clock) => { const body = Buffer.alloc(6); body.writeUInt32LE(clock, 1); body[5] = 1; return dg({ type: PT.PingRequest, seq, ack, mask, body }); };

// Events the wire has no writer for, written here as their readers read them.
export function writeCustom(w, ev) {
  if (ev.type === 'Challenge') {
    w.writeUnsigned(EVENTS.Challenge.id, EVENT_TYPE_BITS);
    w.writeBytes(Buffer.from(ev.challenge, 'hex'));
    w.writeSigned(ev.xpack, 32);
    const mod = Buffer.from(ev.mod, 'latin1');
    w.writeUnsigned(mod.length, 8); w.writeBytes(mod); w.writeBytes(Buffer.alloc(8, 7));
    return;
  }
  if (ev.type === 'GameStatus') {
    w.writeUnsigned(EVENTS.GameStatus.id, EVENT_TYPE_BITS);
    w.writeUnsigned(ev.status, 8);
    if (ev.status === 5) { w.writeBytes(Buffer.from(ev.extra, 'latin1')); const t = Buffer.from(ev.text, 'latin1'); w.writeUnsigned(t.length, 8); w.writeBytes(t); }
    return;
  }
  if (ev.type === 'raw') { w.writeUnsigned(ev.id, EVENT_TYPE_BITS); for (const b of ev.bits ?? []) w.writeBool(!!b); return; }
  writeEvent(w, ev.type, ev);
}
// A data payload: the stream mask, then (events) a block, then (ghosts) raw bits.
export function payload({ mask = 2, index = 0, resend = false, events = [], tail = null, count = null }) {
  const w = new BitWriter(1400);
  w.writeUnsigned(mask, 6);
  if (mask & 2) {
    w.writeUnsigned(count ?? events.length, 8); w.writeUnsigned(index, 5); w.writeBool(resend);
    for (const ev of events) writeCustom(w, ev);
  }
  if (tail) for (const b of tail) w.writeBool(!!b);
  return Buffer.from(w.bytes());
}
export const bitsOf = (n, v) => Array.from({ length: n }, (_, i) => (v >>> i) & 1);

// A ConnectDenied with its reason at 8.
export const denied = (reason) => { const b = Buffer.alloc(16); b[2] = PT.ConnectDenied << 4; b.writeUInt32LE(reason, 8); return b.toString('hex'); };
// A ServerInfo answer (netconn.mjs parseServerInfo); bytes from 8 are filler
// (a retail server's are uninitialised stack, never read).
export const serverInfoReply = (name = 'parity lab', len = 0x88) => { const b = Buffer.alloc(len); b[0] = 1; b[2] = PT.ServerInfo << 4; b.write(name, 8, 'latin1'); return b.toString('hex'); };
export const CHALLENGE = '0102030405060708090a';
export const serverInfo = (mod = 'bf1942') => [
  { type: 'ServerInfo', mapId: mod, mod, gameId: 'bf1942' },
  { type: 'ServerInfo2', serverName: 'parity lab' },
];
export const setLevel = (level = 'bf1942/levels/wake/', mode = 'coop.con') => ({ type: 'SetLevel', levelPath: level, modeFile: mode, outsideWorldTime: 10, nameTagNear: 50, nameTagScope: 100, u8d: 0, u16e: 0, u16f: 0, minPlayers: 0 });
export const createPlayer = (playerId, team, isRemote, name, base) => ({ type: 'CreatePlayer', team, spawnGroup: 0, isRemote, playerId, playerNetId: base, vehicleNetId: base + 1, cameraNetId: base + 2, kitNetId: base + 3, name, isAI: isRemote });

// A fake server's join: ConnectAccept, ServerInfo and Challenge, the world
// dump (SetLevel, players, objects), Simulation on; `seq` the first Data
// sequence. Returns { steps, seq } (the next sequence).
export function fakeJoin(t, { mod = 'bf1942', challengeMod = mod, level = 'bf1942/levels/wake/', mode = 'coop.con', me = 'ed', team = 2, extra = [], seq = 1 } = {}) {
  const steps = [
    { t, op: 'in', hex: accept() },
    { t: t + 60, op: 'in', ack: 'auto', hex: data(seq, 0, 0, payload({ index: 0, events: [...serverInfo(mod), { type: 'Challenge', challenge: CHALLENGE, xpack: -1, mod: challengeMod }] })) },
    { t: t + 200, op: 'in', ack: 'auto', hex: data(seq + 1, 0, 0, payload({ index: 1, events: [
      setLevel(level, mode), createPlayer(0, team, false, me, 200), createPlayer(1, 3 - team, true, 'bot', 210),
      { type: 'SetDefaultVehicle', playerId: 0, netId: 202 }, ...extra, { type: 'DataBaseComplete', a: 0, b: 0 },
    ] })) },
    { t: t + 400, op: 'in', ack: 'auto', hex: data(seq + 2, 0, 0, payload({ index: 2, events: [{ type: 'Simulation', running: true, worldTime: 1 }] })) },
  ];
  return { steps, seq: seq + 3 };
}
export const keepalive = (from, to, seq0, every = 300) => { const o = []; for (let t = from, n = seq0; t < to; t += every, n++) o.push({ t, op: 'in', ack: 'auto', hex: pingReq(n, 0, 0, 1000 + n) }); return o; };
