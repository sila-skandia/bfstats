// Decode a simple object's ghost body (dice::ref2::world::SimpleObjectNetworkable).
//
// The body is what SimpleObjectNetworkable::setNetUpdate (lnxded 0x08236d00)
// reads; getNetUpdate (0x08236770) writes the same layout and updateStateMask
// (0x08235ee0) sets the mask bits. A SimpleObject is the base transform-only
// networkable: flags, ammo boxes, wrecks, deployables and any object whose only
// replicated state is a transform plus a handful of controller vectors.
//
// Field map (11-bit presence mask first, then the fields in this order):
//
//   readBits(11) mask
//   0x2   position   readCompressedVector(0.001)
//   0x1   rotation   readUnitQuaternion(16 | 32)
//   -- the rest are controller fields, written only when the object's
//      controller reports one (updateStateMask gates them on a virtual call) --
//   0x4   vector     readCompressedVector(nullVec, 0.001)
//   0x20  vector     readCompressedVector(nullVec, 0.0001)
//   0x8   vector     readCompressedVector(nullVec, 0.001)
//   0x40  vector     readCompressedVector(nullVec, 0.0001)
//   0x100 vector     readCompressedVector(nullVec, 0.0001)
//   0x200 vector     readCompressedVector(nullVec, 0.0001)
//   0x80  flag       readBool
//   0x10  hitPoints  readUnsigned(0, round(maxHp))   template Armor hp
//   0x400 subState   readUnsigned(2)                 object +0x102
//
// Order is the decompile's, not the mask bit order: position before rotation,
// then the 0x4/0x20/0x8/0x40/0x100/0x200/0x80 controller block, then hit points
// and the 2-bit sub-state last.
//
// Quaternion width: setNetUpdate passes ((flag) - 1 & ~0xf) + 0x20 to
// readUnitQuaternion, i.e. 32 bits when its last bool argument is set and 16
// otherwise. opts.quatBits selects the width and defaults to 32: the corpus's
// only SimpleObject (netId 544, M3A1) is 108 bits = 11 (mask) + 1 + 3*32, so
// its updates use the high-precision path. The hit-point width depends on the
// template's Armor maximum, {0, round(maxHp)}; opts.maxHp (default 100 -> 7
// bits) sizes it.
//
// An underflow propagates in strict mode; in lenient mode whatever decoded
// before a gap is kept and `consumed` says how far the read got.

import { BitReader, rangedBits } from '../bitstream.mjs';

export const MASK = {
  rot: 0x1, pos: 0x2, vecA: 0x4, vecB: 0x8, hitPoints: 0x10, vecC: 0x20,
  vecD: 0x40, flag: 0x80, vecE: 0x100, vecF: 0x200, subState: 0x400,
};
const S3 = 1e-3; // 0x3a83126f / 0x3a03126f
const S4 = 1e-4; // 0x38d1b717

export function decodeSimpleObjectBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const quatBits = opts.quatBits || (opts.fullQuat === false ? 16 : 32);
  const hpWidth = rangedBits(0, Math.round(opts.maxHp || 100));
  const out = {
    mask: 0, pos: null, rot: null, vecA: null, vecB: null, vecC: null, vecD: null,
    vecE: null, vecF: null, flag: null, hitPoints: null, subState: null, consumed: 0,
  };
  let mask;
  try { mask = r.readUnsigned(11); } catch (e) { if (opts.strict) throw e; return null; }
  out.mask = mask;
  try {
    if (mask & MASK.pos) out.pos = r.readCompressedVector(opts.baselinePos || [0, 0, 0], S3);
    if (mask & MASK.rot) { out.rot = r.readUnitQuaternion(quatBits); out.rot[0] = -out.rot[0]; out.rot[1] = -out.rot[1]; out.rot[2] = -out.rot[2]; } // the conjugate, as pco.mjs
    if (mask & MASK.vecA) out.vecA = r.readCompressedVector([0, 0, 0], S3);
    if (mask & MASK.vecC) out.vecC = r.readCompressedVector([0, 0, 0], S4);
    if (mask & MASK.vecB) out.vecB = r.readCompressedVector([0, 0, 0], S3);
    if (mask & MASK.vecD) out.vecD = r.readCompressedVector([0, 0, 0], S4);
    if (mask & MASK.vecE) out.vecE = r.readCompressedVector([0, 0, 0], S4);
    if (mask & MASK.vecF) out.vecF = r.readCompressedVector([0, 0, 0], S4);
    if (mask & MASK.flag) out.flag = r.readBool();
    if (mask & MASK.hitPoints) out.hitPoints = r.readUnsigned(hpWidth);
    if (mask & MASK.subState) out.subState = r.readUnsigned(2);
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}

export default decodeSimpleObjectBody;
