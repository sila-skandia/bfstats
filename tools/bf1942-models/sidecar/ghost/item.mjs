// Decode an item's ghost body (dice::ref2::world::ItemNetworkable).
//
// The body is what ItemNetworkable::setNetUpdate (lnxded 0x0822ad90) reads;
// getNetUpdate (0x0822ac30) writes the same layout and updateStateMask
// (0x0822aa30) sets the mask bits. An item is a piece of world state that
// replicates an id and a couple of opaque 32-bit values (an item pick-up /
// deployable / ammo box); the transform is absolute.
//
// Field map (mask first, then the fields in this order):
//
//   5-bit presence mask (readUnsigned 5)
//   0x1  position    readFullVector    three float32 (absolute)
//   0x2  value2      readBits 32       opaque 32-bit field (+0x20)
//   0x4  value4      readBits 32       opaque 32-bit field (+0x24)
//   0x8  active      readBool          flag (+0x28)
//   0x10 value10     readBits 32       opaque 32-bit field (+0x2c)
//
// The mask is read with the engine's readUnsigned(int) = a fixed 5-bit
// integer (not a ranged read). A body is exactly 5 bits plus the present
// fields: mask 0x8 is 6 bits, a single 32-bit value is 5 + 32 = 37, mask 0x1
// is 5 + 96 = 101.
//
// An underflow propagates in strict mode; in lenient mode whatever decoded
// before a gap is kept and `consumed` says how far the read got.

import { BitReader } from '../bitstream.mjs';

export const MASK = { pos: 0x1, value2: 0x2, value4: 0x4, active: 0x8, value10: 0x10 };

export function decodeItemBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: 0, pos: null, value2: null, value4: null, active: null, value10: null, consumed: 0 };
  let mask;
  try { mask = r.readUnsigned(5); } catch (e) { if (opts.strict) throw e; return null; }
  out.mask = mask;
  try {
    if (mask & MASK.pos) out.pos = r.readFullVector();
    if (mask & MASK.value2) out.value2 = r.readUnsigned(32);
    if (mask & MASK.value4) out.value4 = r.readUnsigned(32);
    if (mask & MASK.active) out.active = r.readBool();
    if (mask & MASK.value10) out.value10 = r.readUnsigned(32);
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}

export default decodeItemBody;
