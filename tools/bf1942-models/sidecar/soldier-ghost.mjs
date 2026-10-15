// Decode a soldier's ghost body: transform, aim, animation states and flags.
//
// The body is what BFSoldierNetworkable::setNetUpdate (lnxded 0x08224e40) reads;
// the field map is P-4. Decompiled 2026-10-15 (features/udp-sidecar/wire.md
// §13); position and facing were validated earlier against a bf42plus
// recording of the same round (~1 m, matching quaternion magnitudes), the
// animation states against the engine's state table (every decoded lower
// state is an Lb_*, every upper a Ub_*).
//
//   readBits(14) mask + readBool (a 15th flag bit), then in this order:
//   0x1     position   readCompressedVector(0.001)   mode 0 = three float32
//   0x4     rotation   readUnitQuaternion(16)        sign + 3 x signedFloat16
//   0x2     velocity   readCompressedVector(ref)     (consumed)
//   0x200   vector     readCompressedVector(ref)     (consumed)
//   0x400   vector     readCompressedVector(ref)     (consumed)
//   0x8     aim B      readSignedFloat(16) * limit   (+0x6c, torso twist)
//   0x10    aim A      readSignedFloat(16) * limit   (+0x68, aim pitch)
//   0x20    lower      readUnsigned(0, nStates-1)    animation state index
//   0x40    upper      readUnsigned(0, nStates-1)    animation state index
//   0x1000  bytes      readBits(16)                  soldier+0x58c/+0x58d
//   0x80    hp         readUnsigned(0, round(maxHp)) the Armor's hit points
//   0x100   held       readBits(32)                  held item
//   0x800   stateBits  readUnsigned(15)              getStateBits (0x10 chute, 0x20 zoom)
//   0x2000  kitPart    readBool
//
// Rotation comes BEFORE velocity on the wire; an earlier reading had them the
// other way round, which only held while the two never appeared together.
//
// The animation state width depends on the engine's state table size
// (rangedBits(0, count-1)); vanilla's table has 1395 states, so 11 bits. The
// hp width depends on the template's hit points (100 for a vanilla soldier,
// 7 bits). The aim limits (the soldier template's pitch and twist bounds)
// are not known yet, so aim is returned normalised in [-1, 1].

import { BitReader, rangedBits } from './bitstream.mjs';

const POS_SCALE = 1e-3; // 0x3a83126f; only matters in a delta mode, soldiers send mode 0
const VEL_SCALE = 1e-3; // value unused, read only to advance
const QUAT_BITS = 16;
const AIM_BITS = 16;
export const VANILLA_ANIM_STATES = 1395;
export const VANILLA_SOLDIER_HP = 100;

export const MASK = {
  pos: 0x1, vel: 0x2, rot: 0x4, aimB: 0x8, aimA: 0x10, lower: 0x20, upper: 0x40,
  hp: 0x80, held: 0x100, vecA: 0x200, vecB: 0x400, stateBits: 0x800, bytes: 0x1000, kitPart: 0x2000,
};

// Decode a soldier body. opts: { baselinePos, animStates (count), maxHp }.
// Returns { mask, flag, pos, rot, vel, aimA, aimB, lower, upper, bytes, hp,
// held, stateBits, kitPart, consumed } with null for absent fields; a field
// past a decode gap stays null and `consumed` says how far the read got.
export function decodeSoldierBody(bodyHex, bodyBits, opts = {}) {
  if (!bodyHex || bodyBits < 15) return null;
  const nStates = opts.animStates || VANILLA_ANIM_STATES;
  const stateBitsWidth = rangedBits(0, nStates - 1);
  const hpWidth = rangedBits(0, Math.round(opts.maxHp || VANILLA_SOLDIER_HP));
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  let mask;
  try { mask = r.readUnsigned(14); } catch { return null; }
  const out = {
    mask, flag: null, pos: null, rot: null, vel: null, aimA: null, aimB: null, lower: null, upper: null,
    bytes: null, hp: null, held: null, stateBits: null, kitPart: null, consumed: 0,
  };
  try {
    out.flag = r.readBool();
    if (mask & MASK.pos) out.pos = r.readCompressedVector(opts.baselinePos || [0, 0, 0], POS_SCALE);
    if (mask & MASK.rot) {
      out.rot = r.readUnitQuaternion(QUAT_BITS);
      // The wire yaw is mirrored relative to the replayer's frame (BF1942 vs
      // viewer handedness, the same Z flip the viewer applies elsewhere), so
      // negate the quaternion's y to face the right way. (Soldiers are pure
      // yaw, x=z=0.) If facing is still wrong, the alternative is a 180-degree
      // turn: [x, w, z, -y].
      out.rot[1] = -out.rot[1];
    }
    if (mask & MASK.vel) out.vel = r.readCompressedVector([0, 0, 0], VEL_SCALE);
    if (mask & MASK.vecA) r.readCompressedVector([0, 0, 0], VEL_SCALE);
    if (mask & MASK.vecB) r.readCompressedVector([0, 0, 0], VEL_SCALE);
    if (mask & MASK.aimB) out.aimB = r.readSignedFloat(AIM_BITS);
    if (mask & MASK.aimA) out.aimA = r.readSignedFloat(AIM_BITS);
    if (mask & MASK.lower) out.lower = r.readUnsigned(stateBitsWidth);
    if (mask & MASK.upper) out.upper = r.readUnsigned(stateBitsWidth);
    if (mask & MASK.bytes) out.bytes = r.readUnsigned(16);
    if (mask & MASK.hp) out.hp = r.readUnsigned(hpWidth);
    if (mask & MASK.held) out.held = r.readUnsigned(32);
    if (mask & MASK.stateBits) out.stateBits = r.readUnsigned(15);
    if (mask & MASK.kitPart) out.kitPart = r.readBool();
  } catch { /* ran past the body: keep whatever decoded before the gap */ }
  out.consumed = r.pos;
  if (out.pos && !Number.isFinite(out.pos[0])) out.pos = null;
  return out;
}

// Transform only: { pos, rot, mask }. baselinePos seeds a position delta mode
// (rare for soldiers). rot is a unit quaternion [x,y,z,w] or null.
export function decodeSoldierTransform(bodyHex, bodyBits, baselinePos) {
  const b = decodeSoldierBody(bodyHex, bodyBits, { baselinePos });
  return b ? { mask: b.mask, pos: b.pos, rot: b.rot } : null;
}

// Back-compat: position only.
export function decodeSoldierPosition(bodyHex, bodyBits, baseline) {
  const t = decodeSoldierTransform(bodyHex, bodyBits, baseline);
  return t ? t.pos : null;
}

// The body fields the replayer's `st` record carries, with the last known
// values carried forward per soldier: `[nid, lower, upper, pitch, twist,
// item, bits]` (replay-recording.js, v4 `st`). Returns the row when something
// the replayer reads changed (or on first sight), else null.
export class SoldierStateTracker {
  constructor() { this.last = new Map(); }
  update(netId, b) {
    if (!b) return null;
    const prev = this.last.get(netId) || { lower: null, upper: null, pitch: 0, twist: 0, item: 0, bits: 0 };
    const cur = {
      lower: b.lower ?? prev.lower,
      upper: b.upper ?? prev.upper,
      pitch: b.aimA ?? prev.pitch,
      twist: b.aimB ?? prev.twist,
      item: b.held ?? prev.item,
      bits: b.stateBits ?? prev.bits,
    };
    const first = !this.last.has(netId);
    this.last.set(netId, cur);
    if (cur.lower == null && cur.upper == null) return null;
    const changed = first || cur.lower !== prev.lower || cur.upper !== prev.upper || cur.bits !== prev.bits
      || cur.item !== prev.item || Math.abs(cur.pitch - prev.pitch) > 0.01 || Math.abs(cur.twist - prev.twist) > 0.01;
    if (!changed) return null;
    return [netId, cur.lower ?? 0, cur.upper ?? 0, +cur.pitch.toFixed(3), +cur.twist.toFixed(3), cur.item, cur.bits];
  }
}
