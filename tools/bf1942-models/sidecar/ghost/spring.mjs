// Decode a SpringNetworkable ghost body (vehicle suspension / wheel travel).
//
// The body is what SpringNetworkable::setNetUpdate (bf1942_lnxded.static
// 0x08239270) reads; getNetUpdate (0x08239190) is the writer. Verified by the
// pair: the writer writes the same fields in the same order inside the same
// guards.
//
//   readBits(1) presence mask, then if set:
//     readHighCompressedVector(0.002)   suspension point A
//     readHighCompressedVector(0.002)   suspension point B
//
// The mask is SpringNetworkable::updateStateMask (0x08239030): bit 0 is set
// only when the spring's position/velocity changed, so an idle spring sends a
// bare 1-bit body (mask 0) and a working one 1 + two high-compressed vectors.
//
// readHighCompressedVector (0x083db9e0) is the sibling of readCompressedVector
// with a coarser table: a 2-bit mode; mode 0 is three absolute float32 (96
// bits), mode 1/2/3 are three readSigned deltas of m_highCompressionVectorBitTable
// = [32, 12, 10, 8] (0x08749254), scaled by the constant and added to a
// reference. Every width here is fixed by the mode, so a spring body needs no
// template knowledge to decode.

import { BitReader } from '../bitstream.mjs';

export const MASK = { moved: 0x1 };
export const SPRING_SCALE = 0.002; // 0x3b03126f
export const HIGH_COMPRESSION_BITS = [32, 12, 10, 8]; // m_highCompressionVectorBitTable

// BitStream::readHighCompressedVector (0x083db9e0): 2-bit mode, then either a
// full vector or three readSigned(bits) deltas around `ref`.
export function readHighCompressedVector(r, ref, scale) {
  const mode = r.readUnsigned(2);
  if (mode === 0) return r.readFullVector();
  const bits = HIGH_COMPRESSION_BITS[mode];
  const dx = r.readSigned(bits), dy = r.readSigned(bits), dz = r.readSigned(bits);
  return [ref[0] + scale * dx, ref[1] + scale * dy, ref[2] + scale * dz];
}

// Decode a spring body. opts: { refA, refB } seed the compressed-vector
// references (unknown without a baseline; they do not affect the bit count).
// Returns { mask, moved, posA, posB, consumed }. An underflow propagates when
// opts.strict, so verify.mjs sees it.
export function decodeSpringBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 1) return null;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: null, moved: false, posA: null, posB: null, consumed: 0 };
  try {
    out.mask = r.readUnsigned(1);
    out.moved = out.mask === 1;
    if (out.mask) {
      out.posA = readHighCompressedVector(r, opts.refA || [0, 0, 0], SPRING_SCALE);
      out.posB = readHighCompressedVector(r, opts.refB || [0, 0, 0], SPRING_SCALE);
    }
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}
