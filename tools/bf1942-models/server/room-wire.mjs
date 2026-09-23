// The room server's wire helpers: netcode.js's framing (one type byte +
// payload), the JSON control record, the MSG_EVENT row and the few byte
// codecs the room's handlers share. Split out of `rooms.mjs`, which
// re-exports `frame`, `encodeJsonMsg`, `eventRow` and `parseJson`.

import { MSG_EVENT } from '../viewer/netcode.js';

// --- wire helpers ------------------------------------------------------------

/** One type byte + payload (netcode.js's framing). */
export function frame(type, payload) {
  const out = new Uint8Array(1 + payload.length);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

/** A JSON control record's frame: type byte + UTF-8 JSON (netcode.js:
 *  "control is rare and a JSON row stays debuggable in a proxy log"). */
export function encodeJsonMsg(row, type = MSG_EVENT) {
  return Buffer.from([type, ...Buffer.from(JSON.stringify(row))]);
}

/** MSG_EVENT's row: {t, type, ...extra} — types join/leave/spawn/seatEnter/
 *  seatExit/fire/closed, plus row-specific keys (netcode.js). */
export function eventRow(type, tick, extra = {}) {
  return { t: tick, type, ...extra };
}

export function parseJson(body) {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    return null;
  }
}

export function serverTimeBytes(ms) {
  const n = Math.max(0, Math.round(ms)) & 0xffffffff;
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

export function tail(bytes) {
  return bytes.subarray ? bytes.subarray(1) : bytes.slice(1);
}
