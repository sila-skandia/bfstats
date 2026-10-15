// Decode a kit's ghost body (dice::ref2::world::KitNetworkable).
//
// The body is what KitNetworkable::setNetUpdate (lnxded 0x0822ba10) reads;
// getNetUpdate (0x0822b8e0) writes the same layout and updateStateMask
// (0x0822b710) sets the mask bits. A kit is the bag a soldier drops on death
// (it carries the weapons/ammo parts), so it moves only when it is a fresh
// drop: position is a full vector, not a delta.
//
// Field map (mask first, then the fields in this order):
//
//   4-bit presence mask (readBits 4)
//   0x1  position        readFullVector              three float32 (absolute)
//   0x2  partIndex       readUnsigned(0, 0x100) - 1  ranged, 9 bits
//   0x4  active          readBool                    flag
//   0x8  weaponIndex     readUnsigned(0, 8) - 1      ranged, 4 bits
//
// The two ranged fields store `value - 1` after the read (an "unset" sentinel
// is 0 -> -1); the wire value is the read. Nothing beyond the mask gates any
// field, so a body is exactly 4 bits plus the present fields: mask 0x1 is
// 4 + 96 = 100 bits, mask 0xf is the common 4 + 96 + 9 + 1 + 4 = 114.
//
// An underflow propagates in strict mode (no internal try/catch around the
// reads), which is what verify.mjs needs to see. In lenient mode whatever
// decoded before a gap is kept and `consumed` says how far the read got.

import { BitReader } from '../bitstream.mjs';

export const MASK = { pos: 0x1, partIndex: 0x2, active: 0x4, weaponIndex: 0x8 };

export function decodeKitBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: 0, pos: null, partIndex: null, active: null, weaponIndex: null, consumed: 0 };
  let mask;
  try { mask = r.readUnsigned(4); } catch (e) { if (opts.strict) throw e; return null; }
  out.mask = mask;
  try {
    if (mask & MASK.pos) out.pos = r.readFullVector();
    if (mask & MASK.partIndex) out.partIndex = r.readRanged(0, 0x100) - 1;
    if (mask & MASK.active) out.active = r.readBool();
    if (mask & MASK.weaponIndex) out.weaponIndex = r.readRanged(0, 8) - 1;
  } catch (e) {
    // Ran past the body: keep whatever decoded before the gap. Strict mode
    // rethrows so the underflow is visible to the verifier.
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}

export default decodeKitBody;
