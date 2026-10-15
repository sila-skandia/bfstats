// Decode a FireArmsNetworkable ghost body (a gun's loaded/ammo state).
//
// FireArmsNetworkable::setNetUpdate (bf1942_lnxed.static 0x08228f70) is the
// reader; getNetUpdate (0x08228e50) is the writer. updateStateMask (0x08228d10)
// raises mask bit 0 when one field changes and bit 1 for the other.
//
//   readBits(2) presence mask, then in this order:
//   0x1  readUnsigned(0, magA + 1)   a magazine/ammo count (value written as n+1)
//   0x2  readUnsigned(0, magB + 1)   the second magazine/ammo count
//
// The two bounds come from the FireArms template: magA is the int at the
// template +0x228 and magB the int at +0x234 (see getNetUpdate, which writes
// value+1 with bound `*(tmpl + 0x228) + 1`). A bound of -1 means the field is
// disabled and never written. So the widths are NOT fixed: they are
// rangedBits(0, mag+1) and need the template's magazine sizes. The body is a
// bare 2-bit mask when nothing changed, which is the common case for a gun
// that is not firing.

import { BitReader, rangedBits } from '../bitstream.mjs';

export const MASK = { magA: 0x1, magB: 0x2 };

// opts: { magA, magB } the template magazine bounds (the values at +0x228 /
// +0x234). A null/negative bound means that field is not present.
export function decodeFireArmsBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 2) return null;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: null, magA: null, magB: null, consumed: 0 };
  try {
    out.mask = r.readUnsigned(2);
    if (out.mask & MASK.magA) {
      const bound = opts.magA ?? 0;
      out.magA = r.readUnsigned(rangedBits(0, bound + 1)) - 1;
    }
    if (out.mask & MASK.magB) {
      const bound = opts.magB ?? 0;
      out.magB = r.readUnsigned(rangedBits(0, bound + 1)) - 1;
    }
  } catch (e) {
    if (opts.strict) throw e;
  }
  out.consumed = r.pos;
  return out;
}
