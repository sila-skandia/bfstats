// Decode a vehicle's ghost body.
//
// A vehicle's framed ghost record is a whole NetworkableDescriptor, not one
// networkable: the hull's SimpleObjectNetworkable body followed by the bodies
// of every child networkable in the object's template tree, concatenated and
// sharing one bit budget (NetworkManager::setNetUpdate 0x084315f0 loops the
// descriptor's networkable list; NetworkManager::_analyseObject 0x0842d2f0
// fills it depth-first over the object tree, skipping PlayerControlObject
// descendants). See features/udp-sidecar/decodes/player-control-object.md and
// vehicle-children.md.
//
// The class named PlayerControlObjectNetworkable is a decoy on the dedicated
// server: its setNetUpdate (0x08232350) is an empty `ret`, so every vehicle in
// the corpus takes the SimpleObject branch and its hull is read by
// SimpleObjectNetworkable::setNetUpdate 0x08236d00.
//
// THE HULL (SimpleObjectNetworkable, 0x08236d00): 11-bit presence mask, then
// in this order position (0x2, readCompressedVector), rotation (0x1,
// readUnitQuaternion — 16 bits for every vehicle body here), the 0x4/0x20/0x8/
// 0x40/0x100/0x200 controller vectors, the 0x80 flag, hit points (0x10,
// readUnsigned(rangedBits(0, maxHp))) and the 2-bit sub-state (0x400). No
// vehicle record sets the controller-vector bits, so a hull is
// mask + position + rotation (+ hp + subState on the rare mask-0x493 bodies).
//
// THE CHILD TAIL. The sequence of child types is a property of the object
// template, not of the wire, and lives in children.mjs (CHILDREN_BY_TEMPLATE).
// Child readers, from the binary:
//
//   E  EngineNetworkable::setNetUpdate 0x08227da0
//        readUnsigned(10) mask, 0x1/0x2/0x4 bool, 0x8 readUnsigned(0,gears),
//        0x10/0x20/0x40 readSignedFloat(16), 0x80/0x100/0x200 readSignedFloat(12),
//        then readUnsigned(32) UNCONDITIONALLY (a zero-mask engine is 42 bits)
//   S  SpringNetworkable::setNetUpdate 0x08239270
//        readUnsigned(1) mask; if set, two readHighCompressedVector(0.002)
//        (high-compressed table [32,12,10,8], NOT the normal [32,20,16,12])
//   R  RotationalBundleNetworkable::setNetUpdate 0x082347f0
//        readUnsigned(7) mask, then a 16-bit signed float per set bit
//   O  a SimpleObjectNetworkable child (a Bundle/EntryPoint/... whose template
//        carries a networkableInfo): the same body shape as the hull
//   F  FireArmsNetworkable::setNetUpdate 0x08228f70
//        readUnsigned(2) mask; 0x1 readUnsigned(0, tmpl+0x228 + 1) (magazine A,
//        width rangedBits(0, magSize+1)); 0x2 readUnsigned(0, tmpl+0x234 + 1)
//        (magazine B). The widths are template values and are supplied per
//        child through children.mjs.
//
// An underflow propagates (no try/catch around the reads) so verify.mjs sees a
// short or long read rather than a swallowed throw. The one exception is the
// optional auto-detection path below, which is only used when the caller names
// no template and no children; it still performs real decodes and never
// fabricates a consumption.

import { BitReader, rangedBits } from '../bitstream.mjs';
import { TEMPLATE_SPECS, CHILDREN_BY_TEMPLATE, childrenFor, templateNames, DEFAULT_TEMPLATE } from './children.mjs';

// readCompressedVector's table (BitStream::m_compressionVectorBitTable).
const CV = [32, 20, 16, 12];
// readHighCompressedVector's table (BitStream::m_highCompressionVectorBitTable).
const HV = [32, 12, 10, 8];

export const MASK = {
  rot: 0x1, pos: 0x2, vecA: 0x4, vecB: 0x8, hp: 0x10, vecC: 0x20,
  vecD: 0x40, flag: 0x80, vecE: 0x100, vecF: 0x200, subState: 0x400,
};

function readVec(r, table) {
  const mode = r.readUnsigned(2);
  if (mode === 0) return r.readFullVector();
  const bits = table[mode];
  return [r.readSigned(bits), r.readSigned(bits), r.readSigned(bits)];
}

// SimpleObjectNetworkable body: the hull and every 'O' child share this shape.
// Reads into `out` (mask + fields) and returns the mask.
function readSimpleObject(r, out, quatBits, hpWidth) {
  const mask = r.readUnsigned(11);
  if (out) out.mask = mask;
  const put = (k, v) => { if (out) out[k] = v; };
  if (mask & MASK.pos) put('pos', readVec(r, CV));
  if (mask & MASK.rot) {
    // The wire yaw is mirrored relative to the replayer's frame; negate y the
    // way soldier-ghost.mjs does. Checked on a live M3A1: unflipped, the hull
    // faced +81 deg while it drove at -81 deg.
    const q = r.readUnitQuaternion(quatBits);
    q[1] = -q[1];
    put('rot', q);
  }
  if (mask & MASK.vecA) put('vecA', readVec(r, CV));
  if (mask & MASK.vecC) put('vecC', readVec(r, CV));
  if (mask & MASK.vecB) put('vecB', readVec(r, CV));
  if (mask & MASK.vecD) put('vecD', readVec(r, CV));
  if (mask & MASK.vecE) put('vecE', readVec(r, CV));
  if (mask & MASK.vecF) put('vecF', readVec(r, CV));
  if (mask & MASK.flag) put('flag', r.readBool());
  if (mask & MASK.hp) put('hp', r.readUnsigned(hpWidth));
  if (mask & MASK.subState) put('subState', r.readUnsigned(2));
  return mask;
}

function readEngine(r, gearBits) {
  const mask = r.readUnsigned(10);
  if (mask & 0x1) r.readBool();
  if (mask & 0x2) r.readBool();
  if (mask & 0x4) r.readBool();
  if (mask & 0x8) r.readUnsigned(gearBits);
  if (mask & 0x10) r.readSignedFloat(16);
  if (mask & 0x20) r.readSignedFloat(16);
  if (mask & 0x40) r.readSignedFloat(16);
  if (mask & 0x80) r.readSignedFloat(12);
  if (mask & 0x100) r.readSignedFloat(12);
  if (mask & 0x200) r.readSignedFloat(12);
  r.readUnsigned(32); // the trailing counter is unconditional
  return mask;
}

function readSpring(r) {
  const mask = r.readUnsigned(1);
  if (mask) { readVec(r, HV); readVec(r, HV); }
  return mask;
}

function readRotationalBundle(r) {
  const mask = r.readUnsigned(7);
  for (let b = 0; b < 7; b++) if (mask & (1 << b)) r.readSignedFloat(16);
  return mask;
}

function readFireArms(r, wA, wB) {
  const mask = r.readUnsigned(2);
  if (mask & 0x1) r.readUnsigned(wA);
  if (mask & 0x2) r.readUnsigned(wB);
  return mask;
}

// The M3A1's child sequence (the historical default, kept for callers that
// passed opts.children / relied on the default).
export const M3A1_CHILDREN = CHILDREN_BY_TEMPLATE.M3A1;
export { CHILDREN_BY_TEMPLATE };

function specFromOpts(opts) {
  if (Array.isArray(opts.children)) {
    return {
      children: opts.children,
      gearBits: opts.gearBits ?? TEMPLATE_SPECS[DEFAULT_TEMPLATE].gearBits,
      hpBits: opts.hpBits ?? TEMPLATE_SPECS[DEFAULT_TEMPLATE].hpBits,
      mags: opts.mags || [],
    };
  }
  if (opts.template) return childrenFor(opts.template);
  return null; // signal auto-detection
}

function decodeWithSpec(bodyHex, bodyBits, spec, opts, strict) {
  const quatBits = opts.quatBits || 16;
  const hpWidth = opts.hpBits != null ? opts.hpBits
    : (spec.hpBits != null ? spec.hpBits : rangedBits(0, Math.round(opts.maxHp || 100)));
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = {
    mask: 0, pos: null, rot: null, vecA: null, vecB: null, vecC: null, vecD: null,
    vecE: null, vecF: null, flag: null, hp: null, subState: null,
    children: [], consumed: 0,
  };
  try {
    readSimpleObject(r, out, quatBits, hpWidth);
    let fi = 0;
    for (const t of spec.children) {
      let mask;
      if (t === 'E') mask = readEngine(r, spec.gearBits);
      else if (t === 'S') mask = readSpring(r);
      else if (t === 'R') mask = readRotationalBundle(r);
      else if (t === 'O') mask = readSimpleObject(r, null, quatBits, hpWidth);
      else if (t === 'F') { const w = spec.mags[fi++] || [0, 0]; mask = readFireArms(r, w[0], w[1]); }
      else throw new Error(`unknown child type ${t}`);
      out.children.push({ type: t, mask });
    }
  } catch (e) {
    if (strict) throw e; // verify.mjs MUST see the underflow
    out.consumed = r.pos;
    return out;
  }
  out.consumed = r.pos;
  return out;
}

// Decode a vehicle body. opts: { template } to pick a child sequence by name,
// or { children, gearBits, hpBits, mags } to give one explicitly; quatBits /
// maxHp override the hull widths. With neither, each known template's sequence
// is tried (see the note at the top) and the first that lands on exactly the
// last bit is used; if none lands, the default template's decode is re-run and
// its underflow propagates. Returns { mask, pos, rot, hp, flag, subState,
// children, consumed }.
export function decodePcoBody(bodyHex, bodyBits, opts = {}) {
  const strict = opts.strict !== false;
  const spec = specFromOpts(opts);
  if (spec) return decodeWithSpec(bodyHex, bodyBits, spec, opts, strict);

  // Auto-detect: no template named. The default template first, so its
  // existing behaviour (and any underflow it raises) is unchanged.
  const names = [DEFAULT_TEMPLATE, ...templateNames().filter((n) => n !== DEFAULT_TEMPLATE)];
  for (const name of names) {
    let res;
    try {
      res = decodeWithSpec(bodyHex, bodyBits, TEMPLATE_SPECS[name], opts, true);
    } catch { continue; }
    if (res.consumed === bodyBits) { res.template = name; return res; }
  }
  // Nothing lands exactly: re-run the default so the underflow propagates.
  return decodeWithSpec(bodyHex, bodyBits, TEMPLATE_SPECS[DEFAULT_TEMPLATE], opts, strict);
}

export default decodePcoBody;
