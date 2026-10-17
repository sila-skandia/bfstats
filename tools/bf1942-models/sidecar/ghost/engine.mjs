// Decode an EngineNetworkable ghost body (vehicle engine state).
//
// EngineNetworkable::setNetUpdate (bf1942_lnxed.static 0x08227da0) is the
// reader; getNetUpdate (0x082279d0) is the writer. updateStateMask
// (0x08227620) sets the wire mask bits.
//
//   readBits(10) presence mask, then in this order:
//   0x001  readBool                                   (Engine +0x142, RUNNING)
//   0x002  readBool                                   (Engine +0xee -> +0x143, disabled)
//   0x004  readBool                                   (physEngine +0xb4)
//   0x008  readUnsigned(0, numberOfGears)             (physEngine +0xbc, gear)
//   0x010  readSignedFloat(16)                        (Engine +0x10c)
//   0x020  readSignedFloat(16)                        (Engine +0x104)
//   0x040  readSignedFloat(16)                        (Engine +0x118)
//   0x080  readSignedFloat(12)                        (physEngine +0xa0, REVS)
//   0x100  readSignedFloat(12)                        (physEngine +0xb0)
//   0x200  readSignedFloat(12)                        (physEngine +0xa4)
//   ALWAYS readUnsigned(32)                           a per-update counter
//
// The member behind each bit is updateStateMask's own source operand
// (0x08227620, read 2026-10-18), and setNetUpdate writes each one back to the
// same offset. `physEngine` is what the object's vtable +0x28 hands back for
// 0xc422; its +0xa0 is the revs the server recorder reads
// (`target_lnxded.c` `pe_revs_off`), and the tail of
// PhysicsEngine::updatePhysics rolls the Engine's first child LodObject by
// revs*20 degrees a tick from it (PHY-30). So a remote hull's propeller,
// rotor or screw is TOLD to a client, not derived.
//
// Revs arrives at 80% of the server's value and retail keeps it that way: the
// writer is writeSignedFloat(revs, 12, 1.25) (0x083da220), which divides by
// max, while the reader readSignedFloat(int, float) (0x083da200) forwards to
// readSignedFloat(int) (0x083da280) and DROPS max, returning 2u-1 in [-1, 1].
// setNetUpdate stores that figure unscaled. Undoing the 1.25 would make our
// propellers turn faster than the game's.
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
  running: 0x1, disabled: 0x2, flag2: 0x4, gears: 0x8,
  angleA: 0x10, angleB: 0x20, angleC: 0x40,
  revs: 0x80, f12B: 0x100, f12C: 0x200,
};
export const DEFAULT_GEARS = 6;
export const SEQ_BITS = 32;

// Decode an engine body. opts: { numGears } the template's gear count (width of
// the gear field). Returns { mask, running, disabled, flags, gears, angleA,
// angleB, angleC, revs, f12B, f12C, seq, consumed }. An underflow propagates when opts.strict.
export function decodeEngineBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 10) return null;
  const gears = opts.numGears ?? DEFAULT_GEARS;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = {
    mask: null, running: null, disabled: null, flags: [null], gears: null,
    angleA: null, angleB: null, angleC: null, revs: null, f12B: null, f12C: null,
    seq: null, consumed: 0,
  };
  try {
    out.mask = r.readUnsigned(10);
    if (out.mask & MASK.running) out.running = r.readBool();
    if (out.mask & MASK.disabled) out.disabled = r.readBool();
    if (out.mask & MASK.flag2) out.flags[0] = r.readBool();
    if (out.mask & MASK.gears) out.gears = r.readUnsigned(rangedBits(0, gears));
    if (out.mask & MASK.angleA) out.angleA = r.readSignedFloat(16);
    if (out.mask & MASK.angleB) out.angleB = r.readSignedFloat(16);
    if (out.mask & MASK.angleC) out.angleC = r.readSignedFloat(16);
    if (out.mask & MASK.revs) out.revs = r.readSignedFloat(12);
    if (out.mask & MASK.f12B) out.f12B = r.readSignedFloat(12);
    if (out.mask & MASK.f12C) out.f12C = r.readSignedFloat(12);
    out.seq = r.readUnsigned(SEQ_BITS);
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}
