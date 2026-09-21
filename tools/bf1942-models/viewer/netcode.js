// The P2 wire: the engine's own PlayerAction record, the room protocol built
// on it, and the snapshot law -- one shared codec for the browser page and the
// room server (`tools/bf1942-models/server/`), so there is exactly one
// implementation of the quantization and the framing on both sides of the
// socket. See `features/netcode-play-multiplayer/README.md` (P2) and
// `features/bf1942-engine-reference/subsystems/netcode.md` for the evidence
// every number here cites.
//
// THE WIRE INPUT IS THE ENGINE'S 104-BIT PlayerAction RECORD (W-1..W-4):
//
//   six 12-bit channels, bit-packed little-endian from byte 0, in the fixed
//   order  Yaw, Pitch, Roll, Throttle, MouseLookX, MouseLookY  (the channel
//   order `PlayerAction::set` 0x081128a0 packs, and the c_PI* rodata at
//   0x086c86a5 names), then a u32 button mask at bit 72 (byte 9). 104 bits
//   total, byte 13 of the wire record is beyond the engine's (see below).
//
//   Encode and decode are the engine's own, imported from the module that
//   owns them (world.js's composition rule): `mouse-input.js`'s
//   `floatToFixed`/`fixedToFloat` implement `PlayerAction::set` 0x08113480
//   and `PlayerAction::get` 0x0815c5a0 -- `round`/`trunc` over 12 bits in a
//   +-16 range, decode snapped to 0.01 -- and the SAME quantization applies
//   to the page's own local player (GameClient::processLocalPlayersInputs
//   0x00488840 packs before it simulates), so the wire adds no quantization
//   the local path does not already exercise. The axis saturates at +-16,
//   the fact GUN-2b's open calibration question rests on.
//
//   The mask's bits are the engine's c_PI* channel events (W-1):
//     bit 0 = Fire (ch8)      bit 4 = Walk (ch12)   bit 5 = Run (ch13)
//     bit 15 = AltFire (ch23) bit 20 = Lie (ch28)   bit 21 = Crouch (ch29)
//
//   Two bits are a cited departure (the engine's own jump and pad wiring was
//   never re-derived; these are channels the record carries but the engine
//   did not map in the readable table): bit 22 = Jump (ch30), the page's jump
//   key, and bit 23 = Pad (ch31), the page's mobile-pad marker that skips the
//   stick spring exactly as the page's `pad` field does. ch48 (Communication)
//   follows W-4 and stays server-local, never on the wire.
//
//   The byte-13 extension is the second departure: the page's raw key pairs
//   (`forwardKeys`, `rudder`) are the aircraft's throttle latch and rudder --
//   the aircraft path reads the *keys alone*, while the ground path and the
//   body read the pad-fused `forward`/`strafe` axes. The two raw pairs are
//   exactly -1/0/+1 each, so two bits per pair carry them without loss of
//   fidelity. The engine never shipped this (its channels were richer); the
//   record shape stays the engine's, one byte is added.
//
// THE RECEIVE LAW (D-1..D-4) is the server's, in the World already: buffer,
// trim to FOUR dropping the oldest, consume exactly one per tick, zeroed
// input on an empty buffer, seq dedupe on `seq > lastSeen`, backlog > 9
// collapses. This module only frames; `World.setInput(id, input, look, seq)`
// enforces the law.
//
// FRAMING: one type byte + payload per WebSocket binary frame. Input and
// snapshots are binary; control records (join, hello, events, errors) are
// JSON -- control is rare and a JSON row stays debuggable in a proxy log at
// that cadence. The stream is what needs to stay boring.

import { floatToFixed, fixedToFloat } from './mouse-input.js';

// --- protocol constants --------------------------------------------------

export const MAX_PLAYERS = 16;          // the lobby rule, not a scaling limit

// Client -> server
export const MSG_JOIN = 0x01;           // JSON payload: {room, name, team}
export const MSG_INPUT = 0x02;          // binary: u32le seq + 14-byte action
export const MSG_PING = 0x03;           // binary: u32le client time
export const MSG_LEAVE = 0x04;          // empty; the engine's explicit 0xd (J-3)
export const MSG_ACTION = 0x05;         // JSON: the engine's action-message
                                        //   seam -- seat enter/exit/switch and
                                        //   spawn, the things the 104-bit
                                        //   record cannot carry (J-1/J-3 note
                                        //   the engine's control channel)

// Server -> client
export const MSG_HELLO = 0x81;          // JSON: slot, room, level, table...
export const MSG_JOIN_SNAPSHOT = 0x82;  // binary: live state, then the stream
export const MSG_SNAPSHOT = 0x83;       // binary: 20 Hz state (see below)
export const MSG_EVENT = 0x84;          // JSON rows: kill feed, seats, spawns
                                            //   {t, type, slot?, other?, text?}
export const MSG_CLOSED = 0x85;         // JSON: {code}
export const MSG_PONG = 0x86;           // binary: u32le server time

// MSG_ACTION payloads (client -> server), JSON:
//   {type: 'seat', vehicle: <table id>, seat: <index>, action: 'enter'|'exit'|'switch'}
//   {type: 'spawn', flag: <flag index>}     -- the player is re-deploying
// The server mounts/unmounts the player in its own world from these rows,
// exactly as the engine's control channel carried seat changes (J-1).

// MSG_EVENT types (server -> client), JSON rows:
//   {t: <world tick>, type: 'join'|'leave'|'spawn'|'seatEnter'|'seatExit'|'fire'|'closed',
//    slot?: <player slot>, other?: <slot>, text?: <string>}
// P3 adds the kill feed's rows ('killed', 'captured', 'ticket') on the same
// seam; replay.js's SCORE_TEXT already names them.

// The page's raw key pairs (see the header).
const RAWF = 0;                          // the seven reserved low bits
const EXT_FORWARD_UP = 1 << 0;           // forwardKeys > 0
const EXT_FORWARD_DOWN = 1 << 1;         // forwardKeys < 0
const EXT_RUDDER_RIGHT = 1 << 2;         // rudder > 0
const EXT_RUDDER_LEFT = 1 << 3;          // rudder < 0

export const INPUT_BYTES = 14;           // 104 engine bits + the 8-bit extension

// --- the input record ------------------------------------------------------

export const CH_YAW = 0;                 // the strafe/rudder axis the body and
export const CH_PITCH = 1;               // the stick's pitch (pad Y, arrow up)
export const CH_ROLL = 2;                // the stick's roll (pad X, arrow left)
export const CH_THROTTLE = 3;            // the forward axis (W/S, pad Y on foot)
export const CH_LOOK_X = 4;              // c_PIMouseLookX, already per-tick pumped
export const CH_LOOK_Y = 5;              // c_PIMouseLookY

/** The page's input+look word as the 14-byte wire record (see the header). */
export function encodeInput(input, look) {
  const bytes = new Uint8Array(INPUT_BYTES);
  const channels = [
    input?.strafe ?? 0,
    input?.pitch ?? 0,
    input?.roll ?? 0,
    input?.forward ?? 0,
    look?.x ?? 0,
    look?.y ?? 0,
  ];
  // Six 12-bit channels, little-endian bit-packed from bit 0. The engine's
  // own quantization (mouse-input.js), shared with the local player's path.
  for (let ch = 0; ch < 6; ch++) {
    let v = floatToFixed(channels[ch]);
    const bit = ch * 12;
    for (let i = 0; i < 12; i++) {
      if (v & 1) bytes[(bit + i) >> 3] |= 1 << ((bit + i) & 7);
      v >>= 1;
    }
  }
  // The u32 button mask at bit 72.
  let mask = 0;
  if (input?.fire) mask |= 1 << 0;
  if (input?.walk) mask |= 1 << 4;
  if (input?.altFire) mask |= 1 << 15;
  if (input?.prone) mask |= 1 << 20;
  if (input?.crouch) mask |= 1 << 21;
  if (input?.jump) mask |= 1 << 22;       // departure, see the header
  if (input?.pad) mask |= 1 << 23;        // departure, see the header
  for (let i = 0; i < 4; i++) bytes[9 + i] = (mask >> (8 * i)) & 0xff;
  // The extension byte: the aircraft's raw key pairs.
  if (input?.forwardKeys > 0) bytes[13] |= EXT_FORWARD_UP;
  if (input?.forwardKeys < 0) bytes[13] |= EXT_FORWARD_DOWN;
  if (input?.rudder > 0) bytes[13] |= EXT_RUDDER_RIGHT;
  if (input?.rudder < 0) bytes[13] |= EXT_RUDDER_LEFT;
  return bytes;
}

/** The wire record back to the page's input+look word (the server's read). */
export function decodeInput(bytes) {
  const ch = [0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 6; c++) {
    let v = 0;
    const bit = c * 12;
    for (let i = 0; i < 12; i++) {
      if (bytes[(bit + i) >> 3] & (1 << ((bit + i) & 7))) v |= 1 << i;
    }
    ch[c] = fixedToFloat(v);
  }
  let mask = 0;
  for (let i = 0; i < 4; i++) mask |= bytes[9 + i] << (8 * i);
  const ext = bytes[13] ?? 0;
  const key = (up, down) => (up ? 1 : 0) - (down ? 1 : 0);
  return {
    input: {
      strafe: ch[CH_YAW],
      pitch: ch[CH_PITCH],
      roll: ch[CH_ROLL],
      forward: ch[CH_THROTTLE],
      fire: (mask & (1 << 0)) !== 0,
      walk: (mask & (1 << 4)) !== 0,
      altFire: (mask & (1 << 15)) !== 0,
      prone: (mask & (1 << 20)) !== 0,
      crouch: (mask & (1 << 21)) !== 0,
      jump: (mask & (1 << 22)) !== 0,
      pad: (mask & (1 << 23)) !== 0,
      forwardKeys: key(ext & EXT_FORWARD_UP, ext & EXT_FORWARD_DOWN),
      rudder: key(ext & EXT_RUDDER_RIGHT, ext & EXT_RUDDER_LEFT),
    },
    look: { x: ch[CH_LOOK_X], y: ch[CH_LOOK_Y] },
  };
}

/** One tick's wire frame: the seq, then the record (MSG_INPUT payload
 *  body). The seq is the client's per-player tick counter; the World's
 *  `setInput(id, input, look, seq)` dedupes on `seq > lastSeen` (D-4). */
export function encodeInputFrame(seq, input, look) {
  const a = encodeInput(input, look);
  const out = new Uint8Array(4 + a.length);
  out[0] = seq & 0xff; out[1] = (seq >> 8) & 0xff;
  out[2] = (seq >> 16) & 0xff; out[3] = (seq >> 24) & 0xff;
  out.set(a, 4);
  return out;
}

export function decodeInputFrame(payload) {
  const seq = payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
  const fixed = decodeInput(payload.subarray ? payload.subarray(4, 4 + INPUT_BYTES)
    : payload.slice(4, 4 + INPUT_BYTES));
  return { seq, ...fixed };
}

// --- the snapshot record ----------------------------------------------------

// Snapshot cadence is the engine's: the ghost state went out at 0.1 s as a
// single current state with no interpolation buffer (P-2), and the server's
// `Σ(rate x 1044) < cap` choke (R-1) is the capacity law the room server
// honors (20 Hz default, lower on cumulative load). Rendering-side
// smoothness is the client's choice; the record is the law.

// Per-player record, 31 bytes:
//   u8  slot           1..16
//   u8  flags          bit0 alive, bit1 seated, bit2 crouch, bit3 prone,
//                      bit4 inVehicle (position is the hull's)
//   u8  team           1 = Axis, 2 = Allies
//   f32 x, y, z        soldier feet, or the hull's origin when inVehicle
//   f32 yaw, pitch     degrees; NaN when seated (the hull owns the facing)
//   u16 hp             armor hitPoints, 0xffff when the player carries none
//   u8  vehicleId      0 = on foot, else the room's vehicle table id
//   u8  seatIndex      0..15, 0xff when not seated
//   u32 ack            the input seq the authority's last tick CONSUMED for
//                      this player (0 before it has consumed any)
//
// `ack` is a cited departure from the engine's ghost state, and the one the
// engine could not have needed: its client never reconciled, so it never had
// to know which of its own words the authority had already run. A client that
// predicts does -- without an acknowledgement the only comparison available is
// "the authority's position THEN against mine NOW", which reads the whole
// input latency as a prediction error and drags the player backwards by it
// (features/netcode-play-multiplayer/SNAPBACK.md). Four bytes per player-row
// at 20 Hz is 1.3 kB/s at a full 16, inside the R-1 choke's own budget, and
// every row carries it so a remote's input age is observable too.
// Per-vehicle record, 30 bytes:
//   u8  id             the hello vehicle table's id
//   u8  flags          bit0 occupied, bit1 air, bit2 ground
//   f32 x, y, z        the hull origin in world space
//   f32 qx, qy, qz, qw the hull quaternion (viewer frame, already z-negated)
export const SNAPSHOT_PLAYER_BYTES = 31;
export const SNAPSHOT_VEHICLE_BYTES = 30;

export function encodeSnapshot(tick, players, vehicles) {
  const buf = new DataView(new ArrayBuffer(
    4 + 1 + players.length * SNAPSHOT_PLAYER_BYTES
      + 1 + vehicles.length * SNAPSHOT_VEHICLE_BYTES));
  let o = 0;
  buf.setUint32(o, tick, true); o += 4;
  buf.setUint8(o, players.length); o += 1;
  for (const p of players) {
    const flags = (p.alive ? 1 : 0) | (p.seated ? 2 : 0) | (p.crouch ? 4 : 0)
      | (p.prone ? 8 : 0) | (p.inVehicle ? 16 : 0);
    buf.setUint8(o, p.slot); o += 1;
    buf.setUint8(o, flags); o += 1;
    buf.setUint8(o, p.team ?? 0); o += 1;
    buf.setFloat32(o, p.x ?? NaN, true); o += 4;
    buf.setFloat32(o, p.y ?? NaN, true); o += 4;
    buf.setFloat32(o, p.z ?? NaN, true); o += 4;
    buf.setFloat32(o, p.yaw ?? NaN, true); o += 4;
    buf.setFloat32(o, p.pitch ?? NaN, true); o += 4;
    buf.setUint16(o, p.hp === null ? 0xffff : Math.max(0, Math.min(0x7fff, Math.round(p.hp))), true); o += 2;
    buf.setUint8(o, p.vehicleId ?? 0); o += 1;
    buf.setUint8(o, p.seatIndex ?? 0xff); o += 1;
    buf.setUint32(o, Math.max(0, Math.min(0xffffffff, p.ack ?? 0)), true); o += 4;
  }
  buf.setUint8(o, vehicles.length); o += 1;
  for (const v of vehicles) {
    const flags = (v.occupied ? 1 : 0) | (v.air ? 2 : 0) | (v.ground ? 4 : 0);
    buf.setUint8(o, v.id); o += 1;
    buf.setUint8(o, flags); o += 1;
    buf.setFloat32(o, v.x, true); o += 4;
    buf.setFloat32(o, v.y, true); o += 4;
    buf.setFloat32(o, v.z, true); o += 4;
    for (let i = 0; i < 4; i++) { buf.setFloat32(o, v.q[i], true); o += 4; }
  }
  return new Uint8Array(buf.buffer);
}

export function decodeSnapshot(payload) {
  const buf = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let o = 0;
  const tick = buf.getUint32(o, true); o += 4;
  const playerCount = buf.getUint8(o); o += 1;
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const slot = buf.getUint8(o); o += 1;
    const flags = buf.getUint8(o); o += 1;
    const team = buf.getUint8(o); o += 1;
    const x = buf.getFloat32(o, true); o += 4;
    const y = buf.getFloat32(o, true); o += 4;
    const z = buf.getFloat32(o, true); o += 4;
    const yaw = buf.getFloat32(o, true); o += 4;
    const pitch = buf.getFloat32(o, true); o += 4;
    const hp = buf.getUint16(o, true); o += 2;
    const vehicleId = buf.getUint8(o); o += 1;
    const seatIndex = buf.getUint8(o); o += 1;
    const ack = buf.getUint32(o, true); o += 4;
    players.push({
      slot,
      alive: (flags & 1) !== 0,
      seated: (flags & 2) !== 0,
      crouch: (flags & 4) !== 0,
      prone: (flags & 8) !== 0,
      inVehicle: (flags & 16) !== 0,
      team, x, y, z, yaw, pitch,
      hp: hp === 0xffff ? null : hp,
      vehicleId,
      seatIndex: seatIndex === 0xff ? null : seatIndex,
      ack,
    });
  }
  const vehicleCount = buf.getUint8(o); o += 1;
  const vehicles = [];
  for (let i = 0; i < vehicleCount; i++) {
    const id = buf.getUint8(o); o += 1;
    const flags = buf.getUint8(o); o += 1;
    const x = buf.getFloat32(o, true); o += 4;
    const y = buf.getFloat32(o, true); o += 4;
    const z = buf.getFloat32(o, true); o += 4;
    const q = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { q[k] = buf.getFloat32(o, true); o += 4; }
    vehicles.push({
      id,
      occupied: (flags & 1) !== 0,
      air: (flags & 2) !== 0,
      ground: (flags & 4) !== 0,
      x, y, z, q,
    });
  }
  return { tick, players, vehicles };
}