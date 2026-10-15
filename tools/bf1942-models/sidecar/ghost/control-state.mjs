// The control-object state: the local player's own object, which the server
// never sends as an ordinary ghost record. A ghost block whose hasControl bit
// is set carries it ahead of the records; without it a client never hears
// where the server has its own soldier or vehicle, so it can neither draw
// itself from the server's state nor correct its prediction.
//
// GhostManager::writeControlObjectState 0x081422b0 (writer) and
// readControlObjectState 0x081428a0 (reader):
//
//   u12   n            bit count of everything below (the writer back-fills it)
//   s32   controlId    GhostManager+0xe0, the server's input serial echo
//   bool  hit          the hit-indicator flag (XHIT-6), cleared once sent
//         resetCompressionVector, then
//   cvec  rootPos      readCompressedVector(scale 1.0): the root parent's
//                      position, whole metres; the stream's compression
//                      reference is SET to it for the body below
//   u16   netId        the control object
//   bool  isDelta
//   u3    baseline     the baseline slot (0..7)
//   body  every networkable of the netId's descriptor, each written with
//         mask 0xffffffff and the 32-bit-quaternion flag
//         (NetworkManager::getNetUpdate 0x08431400 / getNetUpdateDelta
//         0x084317b0 pass `0xffffffff, 3, 1`). A full body (isDelta 0) reads
//         a position relative to the stream reference (rootPos) and stores
//         itself as baseline slot `baseline`; a delta reads each vector
//         relative to that slot's copy (BFSoldierNetworkable::getNetUpdate
//         0x082246e0, the BaseLineData branch).
//
// The writer fills the baseline from the object's exact state before it
// writes the full body, so a client's baseline differs from the server's by
// the full body's quantisation (1 mm at the 0.001 scale), which a delta then
// carries forward. That is the engine's own error, not ours.

import { BitReader } from '../bitstream.mjs';
import { decodeSoldierBody } from '../soldier-ghost.mjs';
import { decodePcoBody } from './pco.mjs';
import { childrenFor } from './children.mjs';
import { decodeFreeCameraBody } from './free-camera.mjs';

export const BASELINE_SLOTS = 8;

// Per-session baseline store: netId -> [slot] -> { pos, vel, vecA, vecB }.
export class ControlBaselines {
  constructor() { this.byNet = new Map(); }
  get(netId, slot) { return this.byNet.get(netId)?.[slot] ?? null; }
  set(netId, slot, b) {
    let a = this.byNet.get(netId);
    if (!a) { a = new Array(BASELINE_SLOTS).fill(null); this.byNet.set(netId, a); }
    a[slot] = b;
  }
  clear() { this.byNet.clear(); }
}

// Decode a control-object state from its n field bits (hex of exactly the
// bits after the 12-bit length). ctx: { classOf(netId), templateOf(netId),
// baselines: ControlBaselines, animStates }. Returns
// { controlId, hit, rootPos, netId, isDelta, slot, cls, body, consumed, ok }.
export function decodeControlState(hex, nBits, ctx = {}) {
  const r = new BitReader(Buffer.from(hex, 'hex'), nBits);
  const out = { controlId: null, hit: null, rootPos: null, netId: null, isDelta: null, slot: null, cls: null, body: null, consumed: 0, ok: false };
  out.controlId = r.readSigned(32);
  out.hit = r.readBool();
  out.rootPos = r.readCompressedVector([0, 0, 0], 1.0);
  out.netId = r.readUnsigned(16);
  out.isDelta = r.readBool();
  out.slot = r.readUnsigned(3);
  const headBits = r.pos;
  const bodyBits = nBits - headBits;
  const bodyHex = bitsToHex(Buffer.from(hex, 'hex'), headBits, bodyBits);
  const cls = ctx.classOf ? ctx.classOf(out.netId) : null;
  out.cls = cls;
  const baselines = ctx.baselines;
  const base = out.isDelta ? baselines?.get(out.netId, out.slot) : null;
  if (out.isDelta && !base) { out.reason = 'no-baseline'; return out; }
  if (cls === 'BFSoldierNetworkable') {
    const b = decodeSoldierBody(bodyHex, bodyBits, {
      strict: true, quatBits: 32, animStates: ctx.animStates,
      ...(out.isDelta ? { baseline: base } : { baselinePos: out.rootPos }),
    });
    out.body = b;
    out.consumed = headBits + (b?.consumed ?? 0);
    out.ok = !!b && b.consumed === bodyBits;
    if (out.ok && !out.isDelta && baselines) {
      baselines.set(out.netId, out.slot, { pos: b.pos, vel: b.vel || [0, 0, 0], vecA: b.vecA || [0, 0, 0], vecB: b.vecB || [0, 0, 0] });
    }
  } else if (cls === 'SimpleObjectNetworkable') {
    // A vehicle driven by this player: the hull and its child networkables,
    // each SimpleObject one against its own baseline entry. Whether a
    // SimpleObject wrote its controller vectors depends on its physics state
    // (pco.mjs readSimpleObject), so each combination is tried, hull moving
    // first, and the one that reads to the last bit is kept.
    const template = ctx.templateOf ? ctx.templateOf(out.netId) : null;
    const nObjects = 1 + (template ? countObjects(template) : 0);
    const bases = out.isDelta ? base.objects : null;
    const tries = [];
    for (let m = 0; m < (1 << Math.min(nObjects, 4)); m++) {
      tries.push(Array.from({ length: nObjects }, (_, i) => (i === 0 ? !(m & 1) : !!(m & (1 << i)))));
    }
    for (const physics of tries) {
      try {
        const b = decodePcoBody(bodyHex, bodyBits, {
          ...(template ? { template } : {}), quatBits: 32, strict: true,
          control: { ref: out.rootPos, bases, physics },
        });
        if (b.consumed !== bodyBits) continue;
        out.body = b;
        out.consumed = headBits + b.consumed;
        out.ok = true;
        out.physics = physics;
        break;
      } catch { /* the next combination */ }
    }
    if (!out.ok) out.reason = 'no exact read';
    else if (!out.isDelta && baselines) {
      baselines.set(out.netId, out.slot, { objects: out.body.objects.map((o) => ({ pos: o.pos, vecA: o.vecA || [0, 0, 0], vecB: o.vecB || [0, 0, 0] })) });
    }
  } else if (cls === 'FreeCameraNetworkable') {
    // The spawn screen's camera: what the player looks at before spawning.
    try {
      const b = decodeFreeCameraBody(bodyHex, bodyBits, { strict: true, baselinePos: base?.pos || out.rootPos });
      out.body = b;
      out.consumed = headBits + b.consumed;
      out.ok = b.consumed === bodyBits;
      if (out.ok && !out.isDelta && baselines && b.pos) baselines.set(out.netId, out.slot, { pos: b.pos });
    } catch (e) { out.reason = e.message; }
  } else {
    out.reason = `no reader for ${cls}`;
  }
  return out;
}

function bitsToHex(buf, start, n) {
  const o = Buffer.alloc(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) {
    const s = start + i;
    if (buf[s >> 3] & (1 << (s & 7))) o[i >> 3] |= 1 << (i & 7);
  }
  return o.toString('hex');
}

// How many 'O' (SimpleObject) children a template's descriptor carries.
function countObjects(template) {
  try { return (childrenFor(template)?.children || []).filter((t) => t === 'O').length; } catch { return 0; }
}
