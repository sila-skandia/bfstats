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

// readCompressedVector(ref, scale): mode 0 is three floats, any other mode a
// delta from `ref` in units of `scale` (BitStream::readCompressedVector).
function readVecFrom(r, ref, scale) {
  const mode = r.readUnsigned(2);
  if (mode === 0) return r.readFullVector();
  const bits = CV[mode];
  const d = [r.readSigned(bits), r.readSigned(bits), r.readSigned(bits)];
  const o = ref || [0, 0, 0];
  return [o[0] + d[0] * scale, o[1] + d[1] * scale, o[2] + d[2] * scale];
}

// SimpleObjectNetworkable::getNetUpdate 0x08236770's scales: the position at
// 0x3a03126f (0.0005), vecA/vecB at 0.001, the other four at 0.0001.
const POS_SCALE = 0.0005, VEL_SCALE = 0.001, SMALL_SCALE = 0.0001;

// SimpleObjectNetworkable body: the hull and every 'O' child share this shape.
// Reads into `out` (mask + fields) and returns the mask.
//
// `cx` is the control-object state's context (ghost/control-state.mjs), absent
// for an ordinary ghost record: { ref, base, physics }. There the position is
// relative to the block's reference (the root position) or, in a delta, to
// the baseline's copy, and vecA/vecB to the baseline's; and the six
// controller vectors and the flag are written only while the object's
// physics says so (getNetUpdate's vt+0xe0 test), which the mask (all bits, in
// a control state) does not tell, so the caller tries both.
// Outside a control state the vt+0xe0 answer is the template's
// hasMobilePhysics (`mobile`, hulls.json): a fixed gun (Defgun, AA_Allies)
// skips the vectors and the flag even with their mask bits set, and reading
// a flag bit it never sent halved its hit points (50 read as 25).
function readSimpleObject(r, out, quatBits, hpWidth, cx = null, blockRef = null, mobile = true) {
  const mask = r.readUnsigned(11);
  if (out) out.mask = mask;
  const put = (k, v) => { if (out) out[k] = v; };
  const base = cx?.base ?? null;
  // The position is the 2-argument writeCompressedVector: relative to the
  // stream's compression reference, which is zero unless the block opened
  // with a control-object state, whose root position it then is for every
  // record in the block (GhostManager::readControlObjectState sets it and
  // nothing resets it). Read without it, a hull's delta came out as raw
  // counts: a Sherman at 455635, 44895 (live, 2026-10-16).
  if (mask & MASK.pos) put('pos', readVecFrom(r, base?.pos ?? cx?.ref ?? blockRef ?? [0, 0, 0], POS_SCALE));
  if (mask & MASK.rot) {
    // The wire's quaternion is the conjugate of the one the client draws
    // with (the inverse rotation): negate x, y and z. Negating y alone (the
    // first fix, from a live M3A1 that faced +81 deg while it drove at -81)
    // got the yaw right and mirrored every pitch and roll: a climbing Zero
    // flew nose-down in the replay, and its rounds left 24 deg below the
    // client's own (Wake, 2026-10-16: client [-0.033, 0.771, 0.048, 0.634],
    // y-flipped wire [0.033, 0.768, -0.053, 0.637]).
    const q = r.readUnitQuaternion(quatBits);
    q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2];
    put('rot', q);
  }
  if (cx ? cx.physics : mobile) {
    const v = (ref, scale) => (cx ? readVecFrom(r, ref, scale) : readVec(r, CV));
    if (mask & MASK.vecA) put('vecA', v(base?.vecA, VEL_SCALE));
    if (mask & MASK.vecC) put('vecC', v(null, SMALL_SCALE));
    if (mask & MASK.vecB) put('vecB', v(base?.vecB, VEL_SCALE));
    if (mask & MASK.vecD) put('vecD', v(null, SMALL_SCALE));
    if (mask & MASK.vecE) put('vecE', v(null, SMALL_SCALE));
    if (mask & MASK.vecF) put('vecF', v(null, SMALL_SCALE));
    if (mask & MASK.flag) put('flag', r.readBool());
  }
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

// Returns the mask; `into.values` gets the per-bit floats (null when absent).
function readRotationalBundle(r, into) {
  const mask = r.readUnsigned(7);
  const values = [];
  for (let b = 0; b < 7; b++) values.push(mask & (1 << b) ? r.readSignedFloat(16) : null);
  if (into) into.values = values;
  return mask;
}

// Returns the mask; `into.magA` / `into.magB` get the magazine fields. magA is
// a round counter: it steps once per round leaving the gun, so a change is a
// shot (see decodes/vehicle-seats in features/udp-sidecar/wire.md §17).
function readFireArms(r, wA, wB, into) {
  const mask = r.readUnsigned(2);
  if (mask & 0x1) { const v = r.readUnsigned(wA); if (into) into.magA = v; }
  if (mask & 0x2) { const v = r.readUnsigned(wB); if (into) into.magB = v; }
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

// A seat's descriptor: no hull, just its child tail (SEAT_SPECS in
// children.mjs). Returns { children, consumed } like decodePcoBody.
export function decodeSeatBody(bodyHex, bodyBits, spec, opts = {}) {
  return decodeWithSpec(bodyHex, bodyBits, spec, { ...opts, noHull: true }, opts.strict !== false);
}

function decodeWithSpec(bodyHex, bodyBits, spec, opts, strict) {
  const quatBits = opts.quatBits || 16;
  // The hit points are readUnsigned(0, round(armor max)): the template's
  // maxHitPoints (hulls.json) sizes them, so a Hatsuzuki's 300 is 9 bits.
  const hpWidth = opts.hpBits != null ? opts.hpBits
    : opts.maxHp != null ? rangedBits(0, Math.round(opts.maxHp))
    : (spec.hpBits != null ? spec.hpBits : rangedBits(0, 100));
  const mobile = opts.mobile !== false;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = {
    mask: 0, pos: null, rot: null, vecA: null, vecB: null, vecC: null, vecD: null,
    vecE: null, vecF: null, flag: null, hp: null, subState: null,
    children: [], consumed: 0,
  };
  try {
    // In a control-object state every SimpleObject networkable (the hull and
    // each 'O' child) reads against its own baseline entry, in order
    // (getNetUpdate advances BaseLineData+0x400 per networkable).
    const cx = opts.control ?? null;
    let oi = 0;
    const cxFor = () => (cx ? { ref: cx.ref, base: cx.bases?.[oi] ?? null, physics: cx.physics?.[oi++] ?? false } : null);
    out.objects = [];
    if (!opts.noHull) { readSimpleObject(r, out, quatBits, hpWidth, cxFor(), opts.ref ?? null, mobile); out.objects.push({ pos: out.pos, vecA: out.vecA, vecB: out.vecB }); }
    let fi = 0;
    for (const t of spec.children) {
      let mask;
      const child = { type: t, mask: 0 };
      if (t === 'E') mask = readEngine(r, spec.gearBits);
      else if (t === 'S') mask = readSpring(r);
      else if (t === 'R') mask = readRotationalBundle(r, child);
      else if (t === 'O') { const o = {}; mask = readSimpleObject(r, o, quatBits, hpWidth, cxFor(), opts.ref ?? null); out.objects.push({ pos: o.pos ?? null, vecA: o.vecA ?? null, vecB: o.vecB ?? null }); }
      else if (t === 'F') { const w = spec.mags[fi++] || [0, 0]; mask = readFireArms(r, w[0], w[1], child); }
      else throw new Error(`unknown child type ${t}`);
      child.mask = mask;
      out.children.push(child);
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
