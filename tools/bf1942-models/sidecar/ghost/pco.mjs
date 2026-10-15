// Decode a vehicle's ghost body.
//
// WHAT THIS IS. The class named in the brief, dice::ref2::world::
// PlayerControlObjectNetworkable, is a decoy: on the dedicated server its
// getNetUpdate (0x08232340) is `return 1;` and its setNetUpdate (0x08232350)
// is an empty `ret` — it writes and reads no body bits at all (class-map.md
// section 2; they are the weak stubs nm shows at those addresses). Every
// vehicle and fixed gun in the corpus carries a non-zero body, so none of them
// is a PlayerControlObjectNetworkable.
//
// A PlayerControlObject whose template hook `*(this+0x50)` is 0 takes the
// SimpleObject::initNetworkableComp branch (PlayerControlObject::
// initNetworkableComp, 0x08316ea0) and is read by
// **SimpleObjectNetworkable::setNetUpdate 0x08236d00** (writer 0x08236770).
//
// THE RECORD IS THE WHOLE DESCRIPTOR, NOT ONE NETWORKABLE. GhostManager::readData
// (0x08141ed0) resolves the framed netId to a NetworkableDescriptor and calls
// NetworkManager::setNetUpdateDelta (0x08431a70 → 0x084319b0). That function
// walks a VECTOR of networkables on the descriptor (descriptor+0xc .. +0x10,
// 3 words per element — NetworkManager::getNetUpdate 0x08431400 loops it the
// same way) and calls each one's setNetUpdate in turn. NetworkManager::
// _analyseObject (0x0842d2f0) fills that vector with the object's own
// networkable and then recurses into every non-PCO descendant. So a vehicle's
// framed body is the hull's SimpleObjectNetworkable output followed by the
// bodies of its child networkables (Engine, Spring, RotationalBundle, ...)
// concatenated, each self-describing (its own presence mask comes first).
// That is why a hull-only decoder stops short of the end on every vehicle
// except by coincidence, and why the sibling engine/spring decoders report
// "no records": their bodies only ever appear inside their parent's record.
//
// THE HULL. SimpleObjectNetworkable::setNetUpdate reads an 11-bit presence mask
// then, in this order:
//
//   readUnsigned(11) mask
//   0x2   position   readCompressedVector(0.001)          (mode 0: 3 x float32)
//   0x1   rotation   readUnitQuaternion(bits)             16 in this corpus
//   0x4   vector     readCompressedVector(nullVec, .001)  (controller block)
//   0x20  vector     readCompressedVector(nullVec, 1e-4)
//   0x8   vector     readCompressedVector(nullVec, .001)
//   0x40  vector     readCompressedVector(nullVec, 1e-4)
//   0x100 vector     readCompressedVector(nullVec, 1e-4)
//   0x200 vector     readCompressedVector(nullVec, 1e-4)
//   0x80  flag       readBool
//   0x10  hitPoints  readUnsigned(0, round(maxHp))
//   0x400 subState   readUnsigned(2)
//
// The 0x4..0x200 vectors and the 0x80 flag are written only when the object's
// controller component (`*(*(this+0x3c)+0x60)`, vtable +0xe0) reports one, and
// 0x10 only when the object has an Armor (queryInterface 0xc4a4). No vehicle
// record in this corpus sets those bits, so the hull is mask + position +
// rotation for every vehicle body here.
//
// The rotation is a 16-bit unit quaternion for every vehicle body checked
// (a clean pure-yaw quaternion, |q| = 1, x = z = 0); the 32-bit reading of the
// same bits is not a unit quaternion, so the 16-bit width is the wire's. The
// width is a caller flag in the engine ((flag - 1) & ~0xf) + 0x20, i.e. 32 when
// set, 16 when clear; opts.quatBits overrides it.
//
// THE CHILD TAIL. The child sequence is fixed per template and is NOT on the
// wire, so it cannot be recovered from a body alone — it is passed in through
// opts.children. The default below is the M3A1's, worked out from the corpus:
// one EngineNetworkable then six SpringNetworkable, which consumes 48 bits when
// every child mask is zero. Sub-body layouts (verified against the readers):
//
//   E  EngineNetworkable::setNetUpdate 0x08227da0
//        readUnsigned(10) mask, 0x1/0x2/0x4 bool, 0x8 readUnsigned(0,gears),
//        0x10/0x20/0x40 readSignedFloat(16), 0x80/0x100/0x200 readSignedFloat(12),
//        then readUnsigned(32) UNCONDITIONALLY (so a zero-mask engine is 42 bits)
//   S  SpringNetworkable::setNetUpdate 0x08239270
//        readUnsigned(1) mask; if set, two readHighCompressedVector(0.002);
//        high-compressed table is [32,12,10,8], NOT the compressed [32,20,16,12]
//   R  RotationalBundleNetworkable::setNetUpdate 0x082347f0
//        readUnsigned(7) mask, then a 16-bit signed float per set bit
//
// An underflow propagates (no try/catch around the reads) so verify.mjs sees a
// short or long read rather than a swallowed throw.

import { BitReader, rangedBits } from '../bitstream.mjs';

// readCompressedVector's table (BitStream::m_compressionVectorBitTable).
const CV = [32, 20, 16, 12];
// readHighCompressedVector's table (BitStream::m_highCompressionVectorBitTable).
const HV = [32, 12, 10, 8];

export const MASK = {
  rot: 0x1, pos: 0x2, vecA: 0x4, vecB: 0x8, hp: 0x10, vecC: 0x20,
  vecD: 0x40, flag: 0x80, vecE: 0x100, vecF: 0x200, subState: 0x400,
};

const S3 = 1e-3; // 0x3a83126f (0x3a03126f for the 0.0005 position scale)
const S4 = 1e-4; // 0x38d1b717

function readVec(r, table) {
  const mode = r.readUnsigned(2);
  if (mode === 0) return r.readFullVector();
  const bits = table[mode];
  return [r.readSigned(bits), r.readSigned(bits), r.readSigned(bits)];
}

// SpringNetworkable: 1-bit mask, then two high-compressed points.
function readSpring(r) {
  const mask = r.readUnsigned(1);
  const points = [];
  if (mask) { points.push(readVec(r, HV)); points.push(readVec(r, HV)); }
  return { mask, points };
}

// EngineNetworkable: 10-bit mask, then the masked fields, then a 32-bit counter.
function readEngine(r, gears) {
  const mask = r.readUnsigned(10);
  const o = { mask, gear: null, counter: null };
  if (mask & 0x1) r.readBool();
  if (mask & 0x2) r.readBool();
  if (mask & 0x4) r.readBool();
  if (mask & 0x8) o.gear = r.readUnsigned(rangedBits(0, gears));
  if (mask & 0x10) r.readSignedFloat(16);
  if (mask & 0x20) r.readSignedFloat(16);
  if (mask & 0x40) r.readSignedFloat(16);
  if (mask & 0x80) r.readSignedFloat(12);
  if (mask & 0x100) r.readSignedFloat(12);
  if (mask & 0x200) r.readSignedFloat(12);
  o.counter = r.readUnsigned(32);
  return o;
}

// RotationalBundleNetworkable: 7-bit mask, then a 16-bit signed float per bit.
function readRotationalBundle(r) {
  const mask = r.readUnsigned(7);
  const angles = [];
  for (let b = 0; b < 7; b++) if (mask & (1 << b)) angles.push(r.readSignedFloat(16));
  return { mask, angles };
}

// The M3A1's engine gear count. `EngineTemplate::getNumberOfGears` is a
// template value not on the wire; the only M3A1 record that carries a gear
// (mask 0x3fc) is exact at a 3-bit gear field, i.e. 3..6 gears, 4 chosen.
// A zero-mask engine never reads it, so this only moves records that set 0x8.
export const DEFAULT_GEARS = 4;

// The M3A1 tail: two springs, one engine, four springs — 48 bits when every
// child mask is zero. Worked out from the corpus (21501 of 21502 M3A1 records
// consume exactly); the order matters as soon as a child mask goes non-zero.
export const M3A1_CHILDREN = ['S', 'S', 'E', 'S', 'S', 'S', 'S'];

// Best child sequence found per template, by brute/beam search over
// {S,E,R} with the corpus as the oracle. Only the M3A1's is nailed; the rest
// are the best fit and are NOT trusted (see player-control-object.md).
export const CHILDREN_BY_TEMPLATE = {
  M3A1: ['S', 'S', 'E', 'S', 'S', 'S', 'S'],
  Daihatsu: ['E', 'R', 'R'],
  Sherman: ['E', 'S', 'S', 'S', 'S', 'R', 'R', 'S', 'S', 'S', 'S'],
  Zero: ['E', 'R', 'R', 'R', 'R', 'R', 'R', 'S', 'S', 'S', 'S'],
};

// Decode a vehicle body. opts: { quatBits (default 16), maxHp (default 100),
// children (array of 'E'|'S'|'R', default M3A1_CHILDREN), gears (default 0) }.
// Returns { mask, pos, rot, hp, flag, subState, children, consumed }. `consumed`
// is how far the read got; in strict mode an underflow is rethrown and `pos`
// stops where it stopped, so verify.mjs can see it.
export function decodePcoBody(bodyHex, bodyBits, opts = {}) {
  const quatBits = opts.quatBits || 16;
  const hpWidth = rangedBits(0, Math.round(opts.maxHp || 100));
  const seq = opts.children || M3A1_CHILDREN;
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = {
    mask: 0, pos: null, rot: null, vecA: null, vecB: null, vecC: null, vecD: null,
    vecE: null, vecF: null, flag: null, hp: null, subState: null,
    children: [], consumed: 0,
  };
  out.mask = r.readUnsigned(11);
  const m = out.mask;
  if (m & MASK.pos) out.pos = readVec(r, CV);
  if (m & MASK.rot) out.rot = r.readUnitQuaternion(quatBits);
  if (m & MASK.vecA) out.vecA = readVec(r, CV);
  if (m & MASK.vecC) out.vecC = readVec(r, CV);
  if (m & MASK.vecB) out.vecB = readVec(r, CV);
  if (m & MASK.vecD) out.vecD = readVec(r, CV);
  if (m & MASK.vecE) out.vecE = readVec(r, CV);
  if (m & MASK.vecF) out.vecF = readVec(r, CV);
  if (m & MASK.flag) out.flag = r.readBool();
  if (m & MASK.hp) out.hp = r.readUnsigned(hpWidth);
  if (m & MASK.subState) out.subState = r.readUnsigned(2);
  for (const t of seq) {
    if (t === 'E') out.children.push(readEngine(r, opts.gears || DEFAULT_GEARS));
    else if (t === 'S') out.children.push(readSpring(r));
    else if (t === 'R') out.children.push(readRotationalBundle(r));
    else throw new Error(`unknown child type ${t}`);
  }
  out.consumed = r.pos;
  return out;
}

export default decodePcoBody;
