// Decode a RotationalBundle's ghost body: the yaw/pitch/roll angles of a
// turret or gun part, plus the per-axis servo rates and one aux value.
//
// The body is what dice::ref2::world::RotationalBundleNetworkable::getNetUpdate
// (lnxded 0x082345c0) writes and setNetUpdate (0x082347f0) reads; the two share
// one layout. Decompiled 2026-10-15 (features/udp-sidecar/decodes/rotational-bundle.md).
//
//   readBits(7) mask, then one field per set mask bit, in mask-bit order:
//   0x01  angleX   readSignedFloat(16) * 180    object+0x104  (deg, wrapped +/-180)
//   0x02  angleY   readSignedFloat(16) * 180    object+0x108
//   0x04  angleZ   readSignedFloat(16) * 180    object+0x10c
//   0x08  rateX    readSignedFloat(16) * Lx     object+0x110  (Lx = |template+0x174| * 16)
//   0x10  rateY    readSignedFloat(16) * Ly     object+0x114  (Ly = |template+0x178| * 16)
//   0x20  rateZ    readSignedFloat(16) * Lz     object+0x118  (Lz = |template+0x17c| * 16)
//   0x40  aux      readSignedFloat(16) * 41.0   object+0x12c
//
// The mask is 7 bits because a RotationalBundle has seven changeable fields
// (updateStateMask 0x082341a0 sets one bit per changed field); the class's
// getMinimumBitSize (0x08235900) is 7, the mask alone. All seven fields are
// readSignedFloat(16) = 16 bits each, so every body is 7 + 16 * popcount(mask)
// bits: 7, 23, 39, 55, 71, 87, 103 or 119.
//
// The three rates are the servo's per-axis angular rates (deg/s); the template
// limit is the axis' max rate and the "* 16" is the writer's own headroom
// (writeSignedFloat(value, 16, limit*16)). The three angles are the bundle's
// current rotation in degrees about each axis, clipped/wrapped to +/-180 by
// RotationalBundle::calculateAndClipAngle (0x081d7490) and applied to the world
// matrix by RotationalBundle::setState (0x081d8110). The aux value (limit 41.0)
// is carried in the body but lives only in the ring buffer slot +0x1c.
//
// NOTE (2026-10-15): no body in the review corpus has this shape, so the layout
// below is read from the binary and is NOT verified against a capture. See the
// findings doc; the decoder lets underflow propagate so verify.mjs reports it
// honestly rather than as a clean read.

import { BitReader } from '../bitstream.mjs';

const MASK_BITS = 7;
const FIELD_BITS = 16;
const ANGLE_LIMIT = 180.0; // 0x43340000
const AUX_LIMIT = 41.0;    // 0x42240000

export const MASK = {
  angleX: 0x01, angleY: 0x02, angleZ: 0x04,
  rateX: 0x08, rateY: 0x10, rateZ: 0x20,
  aux: 0x40,
};

// Length of a body for a given 7-bit mask (bits of mask above 0x7f are ignored).
export function rotationalBundleBodyBits(mask) {
  let n = 0;
  for (let m = mask & 0x7f; m; m >>= 1) n += m & 1;
  return MASK_BITS + FIELD_BITS * n;
}

// Decode a RotationalBundle body. opts: { rateLimits: [Lx, Ly, Lz] } — the
// template's per-axis rate limits times 16 (unknown without the template, so
// the rates come back normalised in [-1, 1] when rateLimits is omitted). The
// angles are degrees.
//
// Returns { mask, angleX, angleY, angleZ, rateX, rateY, rateZ, aux, consumed }
// with null for absent fields. There is no internal try/catch: a mask bit that
// names a field the body does not hold runs off the end and the BitReader
// underflow propagates, which is what verify.mjs needs to see. `consumed` says
// how far the read got.
export function decodeRotationalBundleBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits == null || bodyBits < MASK_BITS) return null;
  const lim = opts.rateLimits || [1, 1, 1];
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const mask = r.readUnsigned(MASK_BITS);
  const out = {
    mask, angleX: null, angleY: null, angleZ: null,
    rateX: null, rateY: null, rateZ: null, aux: null, consumed: 0,
  };
  out.angleX = (mask & MASK.angleX) ? r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT : null;
  out.angleY = (mask & MASK.angleY) ? r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT : null;
  out.angleZ = (mask & MASK.angleZ) ? r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT : null;
  out.rateX = (mask & MASK.rateX) ? r.readSignedFloat(FIELD_BITS) * lim[0] : null;
  out.rateY = (mask & MASK.rateY) ? r.readSignedFloat(FIELD_BITS) * lim[1] : null;
  out.rateZ = (mask & MASK.rateZ) ? r.readSignedFloat(FIELD_BITS) * lim[2] : null;
  out.aux = (mask & MASK.aux) ? r.readSignedFloat(FIELD_BITS) * AUX_LIMIT : null;
  out.consumed = r.pos;
  return out;
}
