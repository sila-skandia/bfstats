// Decode an objective's ghost body.
//
// The body is what dice::ref2::world::ObjectiveNetworkable::setNetUpdate
// (lnxded 0x08231b20) reads and getNetUpdate (0x08231a60) writes; the field map
// is in features/udp-sidecar/decodes/control-point.md.
//
// Layout, in this order (mask is 2 bits, read first):
//   0x1     position  readFullVector()          member: ring entry +8  (3 x float32)
//   0x2     value     readSignedFloat(5, 1.0)   member: ring entry +4  (float, [-1, 1])
//
// The class keeps a 16-entry ring of recent field values (entry stride 0x14 =
// 20 bytes: a float at +0 written by the caller, the value float at +4 and the
// position vector at +8/+0xc/+0x10); the 2-bit mask says which fields changed
// this frame, and each changed field is read in mask-bit order.
//
// NOTE: the corpus (run.review.ndjson) contains no ObjectiveNetworkable
// objects, so this decoder is implemented from the binary only and is NOT
// verified against a capture.

import { BitReader } from '../bitstream.mjs';

export const MASK = { pos: 0x1, value: 0x2 };
export const MASK_BITS = 2;
export const VALUE_BITS = 5; // readSignedFloat(5, 1.0f) -> [-1, 1]

// Decode an objective body. Returns { mask, pos, value, consumed }; a field
// absent from the mask stays null. Underflow propagates (no try/catch).
export function decodeObjectiveBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const mask = r.readUnsigned(MASK_BITS);
  const out = { mask, pos: null, value: null, consumed: 0 };
  if (mask & MASK.pos) out.pos = r.readFullVector();
  if (mask & MASK.value) out.value = r.readSignedFloat(VALUE_BITS);
  out.consumed = r.pos;
  return out;
}
