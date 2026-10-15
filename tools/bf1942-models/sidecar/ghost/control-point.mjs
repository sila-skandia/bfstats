// Decode a control point's ghost body.
//
// The body is what dice::ref2::world::ControlPointNetworkable::setNetUpdate
// (lnxded 0x08226de0) reads and getNetUpdate (0x08226d20) writes; the field
// map is in features/udp-sidecar/decodes/control-point.md.
//
// Layout, in this order (mask is 2 bits, read first):
//   0x1     team   readSigned(4)    member: ring entry +0 (4-byte team)
//   0x2     flag   readBool()       member: ring entry +4 (1-byte bool)
//
// The class keeps a 16-entry ring of recent field values (entry stride 8 bytes:
// int team at +0, bool at +4); the 2-bit mask says which fields changed this
// frame, and each changed field is read in mask-bit order.
//
// A full body (after the class's own mask) is 3 bits minimum (mask only) up to
// 7 bits (mask + team + flag); the corpus records are all 7 bits with mask 3.

import { BitReader } from '../bitstream.mjs';

export const MASK = { team: 0x1, flag: 0x2 };
export const MASK_BITS = 2;
export const TEAM_BITS = 4; // readSigned(4): 1 sign bit + 3 magnitude bits, range [-7, 7]

// Decode a control-point body. Returns { mask, team, flag, consumed }; a field
// absent from the mask stays null. Underflow propagates (verify.mjs relies on
// it): no try/catch wraps the reads.
export function decodeControlPointBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const mask = r.readUnsigned(MASK_BITS);
  const out = { mask, team: null, flag: null, consumed: 0 };
  if (mask & MASK.team) out.team = r.readSigned(TEAM_BITS);
  if (mask & MASK.flag) out.flag = r.readBool();
  out.consumed = r.pos;
  return out;
}

// Back-compat alias: the team only.
export function decodeControlPointTeam(bodyHex, bodyBits, opts = {}) {
  const b = decodeControlPointBody(bodyHex, bodyBits, opts);
  return b ? b.team : null;
}
