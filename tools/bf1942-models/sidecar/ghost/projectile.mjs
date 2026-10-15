// Decode a ProjectileNetworkable ghost body (grenades, shells, rockets).
//
// ProjectileNetworkable::setNetUpdate (bf1942_lnxed.static 0x08232be0) is the
// reader; getNetUpdate (0x082329f0) is the writer. updateStateMask
// (0x08232630) sets the wire mask bits.
//
//   readBits(8) presence mask, then in this order:
//   0x02  readCompressedVector(0.01)   position      (readCompressedVector(float) 0x083dabe0)
//   0x01  readUnitQuaternion(12)       rotation      (0x083db4f0)
//   0x04  readBool                                     armed/active
//   0x08  readBool                                     detonate
//   0x10  readCompressedVector(0.01)   velocity
//   0x20  readUnsigned(4)              (Projectile +0x3c, a 4-bit field)
//   0x40  readUnsigned(8)              (+0x40)
//   0x80  readUnsigned(2)              (+0x44)
//
// All widths are fixed: readCompressedVector is a 2-bit mode then either a full
// vector (three float32, 96 bits) or three readSigned(COMPRESSION_BITS[mode]),
// and readUnitQuaternion(12) is a sign bit plus three readSignedFloat(12). No
// template knowledge is needed. The 0x20/0x40/0x80 trailing fields are read as
// plain fixed-width unsigned ints (readUnsigned(int) 0x083da010 = readBits(n)).

import { BitReader } from '../bitstream.mjs';

export const MASK = {
  rot: 0x1, pos: 0x2, armed: 0x4, detonate: 0x8,
  vel: 0x10, u4: 0x20, u8: 0x40, u2: 0x80,
};
export const POS_SCALE = 0.01; // 0x3c23d70a
export const QUAT_BITS = 12;

// Decode a projectile body. Returns { mask, pos, rot, armed, detonate, vel,
// u4, u8, u2, consumed }. A compressed vector takes `ref` (default origin); it
// does not affect the bit count. An underflow propagates when opts.strict.
export function decodeProjectileBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 8) return null;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const ref = opts.ref || [0, 0, 0];
  const out = {
    mask: null, pos: null, rot: null, armed: null, detonate: null,
    vel: null, u4: null, u8: null, u2: null, consumed: 0,
  };
  try {
    out.mask = r.readUnsigned(8);
    if (out.mask & MASK.pos) out.pos = r.readCompressedVector(ref, POS_SCALE);
    if (out.mask & MASK.rot) out.rot = r.readUnitQuaternion(QUAT_BITS);
    if (out.mask & MASK.armed) out.armed = r.readBool();
    if (out.mask & MASK.detonate) out.detonate = r.readBool();
    if (out.mask & MASK.vel) out.vel = r.readCompressedVector(ref, POS_SCALE);
    if (out.mask & MASK.u4) out.u4 = r.readUnsigned(4);
    if (out.mask & MASK.u8) out.u8 = r.readUnsigned(8);
    if (out.mask & MASK.u2) out.u2 = r.readUnsigned(2);
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}
