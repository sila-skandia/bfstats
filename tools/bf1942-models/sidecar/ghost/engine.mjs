// Decode an EngineNetworkable ghost body (vehicle engine state).
//
// EngineNetworkable::setNetUpdate (bf1942_lnxed.static 0x08227da0) is the
// reader; getNetUpdate (0x082279d0) is the writer. updateStateMask
// (0x08227620) sets the wire mask bits.
//
//   readBits(10) presence mask, then in this order:
//   0x001  readBool                                   (Engine +0x142)
//   0x002  readBool                                   (Engine +0xee)
//   0x004  readBool                                   (+0xb4)
//   0x008  readUnsigned(0, numberOfGears)             (EngineTemplate +0x360)
//   0x010  readSignedFloat(16)                        (rotation, signedFloat(16))
//   0x020  readSignedFloat(16)
//   0x040  readSignedFloat(16)
//   0x080  readSignedFloat(12)
//   0x100  readSignedFloat(12)
//   0x200  readSignedFloat(12)
//   ALWAYS readUnsigned(32)                           a per-update counter
//
// The readSignedFloat(bits, max) readers ignore their `max` argument in this
// build (readSignedFloat(int,float) 0x083da200 just forwards to
// readSignedFloat(int) 0x083da280 = 2*readUnsignedFloat(bits)-1), so only the
// bit width is meaningful: 16 for the three engine-angle fields, 12 for the
// three 0x3fa00000 (1.25) fields. The trailing 32-bit counter is written
// unconditionally by getNetUpdate (writeUnsigned 0x083d9ff0 -> writeBits) and
// read unconditionally here, so every engine body is at least 10 + 32 = 42
// bits even when the mask is zero.
//
// BitStream::readUnsigned(int) (0x083da010) is readBits(n): the width is
// literal, not ranged. Only bit 0x008 depends on the template (the engine's
// gear count); everything else is fixed.

import { BitReader, rangedBits } from '../bitstream.mjs';

export const MASK = {
  flag0: 0x1, flag1: 0x2, flag2: 0x4, gears: 0x8,
  angleA: 0x10, angleB: 0x20, angleC: 0x40,
  f12A: 0x80, f12B: 0x100, f12C: 0x200,
};
export const DEFAULT_GEARS = 6;
export const SEQ_BITS = 32;

// Decode an engine body. opts: { numGears } the template's gear count (width of
// the gear field). Returns { mask, flags, gears, angleA, angleB, angleC, f12A,
// f12B, f12C, seq, consumed }. An underflow propagates when opts.strict.
export function decodeEngineBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 10) return null;
  const gears = opts.numGears ?? DEFAULT_GEARS;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = {
    mask: null, flags: [null, null, null], gears: null,
    angleA: null, angleB: null, angleC: null, f12A: null, f12B: null, f12C: null,
    seq: null, consumed: 0,
  };
  try {
    out.mask = r.readUnsigned(10);
    if (out.mask & MASK.flag0) out.flags[0] = r.readBool();
    if (out.mask & MASK.flag1) out.flags[1] = r.readBool();
    if (out.mask & MASK.flag2) out.flags[2] = r.readBool();
    if (out.mask & MASK.gears) out.gears = r.readUnsigned(rangedBits(0, gears));
    if (out.mask & MASK.angleA) out.angleA = r.readSignedFloat(16);
    if (out.mask & MASK.angleB) out.angleB = r.readSignedFloat(16);
    if (out.mask & MASK.angleC) out.angleC = r.readSignedFloat(16);
    if (out.mask & MASK.f12A) out.f12A = r.readSignedFloat(12);
    if (out.mask & MASK.f12B) out.f12B = r.readSignedFloat(12);
    if (out.mask & MASK.f12C) out.f12C = r.readSignedFloat(12);
    out.seq = r.readUnsigned(SEQ_BITS);
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}
