// Decode the free camera's ghost body (dice::ref2::world::FreeCameraNetworkable).
//
// The body is what FreeCameraNetworkable::setNetUpdate (lnxded 0x08229ba0)
// reads; getNetUpdate (0x08229a70) writes the same layout and updateStateMask
// (0x08229800) sets the mask bits. This is the spectator / MultiPlayerFreeCamera
// object: a transform plus a zoom-ish signed value and an on/off flag.
//
// Field map (mask first, then the fields in this order):
//
//   4-bit presence mask (readBits 4)
//   0x2  position   readCompressedVector(0.001)  mode 0 -> three float32
//   0x1  rotation   readUnitQuaternion(32)       sign + 3 x signedFloat32
//   0x4  fov        readSigned(8)                camera field-of-view / zoom
//   0x8  enable     readBool                     FreeCamera::m_enableFreeCamera
//
// Note the order: position (0x2) is read BEFORE rotation (0x1), and the
// quaternion is full 32-bit precision (not the soldier's 16). A body is
// exactly 4 bits plus the present fields.
//
// An underflow propagates in strict mode; in lenient mode whatever decoded
// before a gap is kept and `consumed` says how far the read got.

import { BitReader } from '../bitstream.mjs';

export const MASK = { pos: 0x2, rot: 0x1, fov: 0x4, enable: 0x8 };
const POS_SCALE = 1e-3; // 0x3a03126f
const QUAT_BITS = 32;

export function decodeFreeCameraBody(bodyHex, bodyBits, opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: 0, pos: null, rot: null, fov: null, enable: null, consumed: 0 };
  let mask;
  try { mask = r.readUnsigned(4); } catch (e) { if (opts.strict) throw e; return null; }
  out.mask = mask;
  try {
    if (mask & MASK.pos) out.pos = r.readCompressedVector(opts.baselinePos || [0, 0, 0], POS_SCALE);
    if (mask & MASK.rot) out.rot = r.readUnitQuaternion(QUAT_BITS);
    if (mask & MASK.fov) out.fov = r.readSigned(8);
    if (mask & MASK.enable) out.enable = r.readBool();
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}

export default decodeFreeCameraBody;
