// The ScoreManager's ghost body: both sides' scores, tickets among them.
//
// ScoreManager::setNetUpdate (lnxded 0x08162770) reads a 24-bit mask, then for
// each of bits 0..21 a readSigned(18) into the team record's ints (+0x4 ..
// +0x58), and for bits 22 and 23 a readSigned(3) into its two leading bytes.
// The 22 ints are two sides of 11: index 9 is side 1's tickets and index 20
// side 2's (live on the lab, 2026-10-16: side 1 bled 12 -> 0 in 8 s steps
// while side 2 held 48, the round restarted at 47 / 50 and side 1 bled again,
// which is the lab's Axis with no flags).
//
// The ScoreManager has no createObject (it is one of the server's own
// networkables), so nothing names its netId; looksLikeScoreBody() is how the
// body decoder finds it: a whole-record first send (all 24 mask bits) whose
// length is exactly what that mask implies.

import { BitReader } from '../bitstream.mjs';

export const TICKETS = { 1: 9, 2: 20 };
// Each side's rounds won: setNetUpdate stores int 10 at +0xac and int 21 at
// +0xfc, the counters ScoreManager::setWinner (0x08161b80) raises at
// `team * 0x50 + 0x5c`. Mask bits 22 and 23 (the two bytes) are the winner
// (+0x5c) and the victory type (+0x5d). Live on the lab, 2026-10-16: every
// Wake co-op round end sent mask 0xe00200, bytes [2, 3] (an Allied total
// victory), int 9 at 0 and int 21 one higher; the restart sent [0, 0].
export const ROUNDS_WON = { 1: 10, 2: 21 };

function expectedBits(mask) {
  let n = 24;
  for (let i = 0; i < 22; i++) if (mask & (1 << i)) n += 18;
  if (mask & (1 << 22)) n += 3;
  if (mask & (1 << 23)) n += 3;
  return n;
}

export function looksLikeScoreBody(hex, bodyBits) {
  if (!hex || bodyBits < 24) return false;
  const r = new BitReader(Buffer.from(hex, 'hex'), bodyBits);
  const mask = r.readUnsigned(24);
  return mask === 0xffffff && expectedBits(mask) === bodyBits;
}

// Decode one body. Returns { mask, ints: {index: value}, bytes: [a, b] } with
// only the fields present, or null when the length does not match the mask.
export function decodeScoreBody(hex, bodyBits) {
  const r = new BitReader(Buffer.from(hex, 'hex'), bodyBits);
  const mask = r.readUnsigned(24);
  if (expectedBits(mask) !== bodyBits) return null;
  const ints = {};
  for (let i = 0; i < 22; i++) if (mask & (1 << i)) ints[i] = r.readSigned(18);
  const bytes = [null, null];
  if (mask & (1 << 22)) bytes[0] = r.readSigned(3);
  if (mask & (1 << 23)) bytes[1] = r.readSigned(3);
  return { mask, ints, bytes, consumed: r.pos };
}
