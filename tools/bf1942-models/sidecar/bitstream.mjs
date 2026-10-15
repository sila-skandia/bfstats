// The engine's dice::ref2::io::BitStream, as far as the wire needs it.
//
// Bit order is LSB-first within each byte: bit i of the stream is bit (i & 7)
// of byte (i >> 3), and a multi-bit integer goes in least significant bit
// first (BitStream::readBits 0x083daf50, writeBits 0x083db030 in
// bf1942_lnxded.static). A signed integer is a sign bit then |v| in n-1 bits
// (writeSigned 0x083da150). A float is its four IEEE bytes (writeFullVector
// 0x083dac10). A ranged unsigned (min, max) takes the smallest n with
// (1 << n) - 1 >= max - min + 1 (readUnsigned(uint, uint) 0x083da040); note
// the engine's off-by-one, which is why an event type in 0..0x3f takes 7 bits.

// BitStream::m_compressionVectorBitTable at 0x08749244: mode 0 is the full
// 32-bit vector, modes 1/2/3 are 20/16/12-bit signed per-axis deltas.
export const COMPRESSION_BITS = [32, 20, 16, 12];

export function rangedBits(min, max) {
  let n = 0;
  if (max - min !== -1) {
    do { n++; } while (((1 << n) - 1) >>> 0 < (max - min) + 1);
  }
  return n;
}

export class BitWriter {
  constructor(capacity = 1472) {
    this.buf = new Uint8Array(capacity);
    this.pos = 0; // bits
  }
  get byteLength() { return (this.pos + 7) >> 3; }
  bytes() { return this.buf.subarray(0, this.byteLength); }
  writeBit(b) {
    if (this.pos >= this.buf.length * 8) throw new Error('BitWriter overflow');
    if (b) this.buf[this.pos >> 3] |= 1 << (this.pos & 7);
    else this.buf[this.pos >> 3] &= ~(1 << (this.pos & 7));
    this.pos++;
  }
  writeUnsigned(v, n) {
    v = Number(v) >>> 0;
    for (let i = 0; i < n; i++) this.writeBit((i < 32 ? (v >>> i) & 1 : 0));
  }
  writeSigned(v, n) {
    v = Number(v) | 0;
    if (v < 0) { this.writeBit(1); this.writeUnsigned(-v, n - 1); }
    else { this.writeBit(0); this.writeUnsigned(v, n - 1); }
  }
  writeBool(b) { this.writeBit(b ? 1 : 0); }
  writeRanged(v, min, max) { this.writeUnsigned(v - min, rangedBits(min, max)); }
  writeBytes(bytes, nbits = bytes.length * 8) {
    for (let i = 0; i < nbits; i++) this.writeBit((bytes[i >> 3] >> (i & 7)) & 1);
  }
  writeFloat(f) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, f, true);
    this.writeBytes(b);
  }
  // A fixed-width string field: `size` bytes, NUL padded, as the engine's
  // writeBits(this + off, size * 8) over a char array.
  writeFixedString(s, size) {
    const b = new Uint8Array(size);
    const enc = Buffer.from(s, 'latin1');
    b.set(enc.subarray(0, Math.min(enc.length, size - 1)));
    this.writeBytes(b);
  }
  // Reserve n bits to fill in later (BitStream::skipBits in write mode).
  reserve(n) { const at = this.pos; this.pos += n; return at; }
  // Write an unsigned at a reserved position without moving the cursor.
  patchUnsigned(at, v, n) {
    const save = this.pos; this.pos = at; this.writeUnsigned(v, n); this.pos = save;
  }
}

export class BitReader {
  constructor(bytes, bitLength = bytes.length * 8) {
    this.buf = bytes;
    this.pos = 0;
    this.end = bitLength;
  }
  get remaining() { return this.end - this.pos; }
  readBit() {
    if (this.pos >= this.end) throw new RangeError('BitReader underflow');
    const b = (this.buf[this.pos >> 3] >> (this.pos & 7)) & 1;
    this.pos++;
    return b;
  }
  readUnsigned(n) {
    let v = 0;
    for (let i = 0; i < n; i++) if (this.readBit()) v += 2 ** i;
    return v;
  }
  readSigned(n) {
    const neg = this.readBit();
    const m = this.readUnsigned(n - 1);
    return neg ? -m : m;
  }
  readBool() { return this.readBit() === 1; }
  readRanged(min, max) { return this.readUnsigned(rangedBits(min, max)) + min; }
  readBytes(nbytes) {
    const out = new Uint8Array(nbytes);
    for (let i = 0; i < nbytes * 8; i++) if (this.readBit()) out[i >> 3] |= 1 << (i & 7);
    return out;
  }
  readBits(nbits) {
    const out = new Uint8Array((nbits + 7) >> 3);
    for (let i = 0; i < nbits; i++) if (this.readBit()) out[i >> 3] |= 1 << (i & 7);
    return out;
  }
  readFloat() {
    const b = this.readBytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
  }
  // The engine's quantised readers (BitStream, bf1942_lnxded.static):
  //   readUnsignedFloat(n)  0x083da440 : readUnsigned(n) / ((1<<n)-1)
  //   readSignedFloat(n)    0x083da280 : 2*readUnsignedFloat(n) - 1
  //   readFullVector        0x083dac50 : three 32-bit floats, absolute
  //   readCompressedVector  0x083db760 : 2-bit mode; 0 -> full vector, else
  //       ref + scale * three readSigned(COMPRESSION_BITS[mode])
  //   readUnitQuaternion    0x083db4f0 : sign bit, x/y/z readSignedFloat(bits),
  //       w = sqrt(1 - min(1, x^2+y^2+z^2)), negated if the sign bit was set
  readUnsignedFloat(n) {
    const max = n === 32 ? 0xffffffff : (1 << n) - 1;
    return this.readUnsigned(n) / max;
  }
  readSignedFloat(n) { return 2 * this.readUnsignedFloat(n) - 1; }
  readFullVector() { return [this.readFloat(), this.readFloat(), this.readFloat()]; }
  readCompressedVector(ref, scale) {
    const mode = this.readUnsigned(2);
    if (mode === 0) return this.readFullVector();
    const bits = COMPRESSION_BITS[mode];
    const dx = this.readSigned(bits), dy = this.readSigned(bits), dz = this.readSigned(bits);
    return [ref[0] + scale * dx, ref[1] + scale * dy, ref[2] + scale * dz];
  }
  readUnitQuaternion(bits) {
    const sign = this.readBit();
    const x = this.readSignedFloat(bits), y = this.readSignedFloat(bits), z = this.readSignedFloat(bits);
    let d = x * x + y * y + z * z;
    if (d > 1) d = 1;
    let w = Math.sqrt(1 - d);
    if (sign) w = -w;
    return [x, y, z, w];
  }
  readFixedString(size) { return cstr(this.readBytes(size)); }
  readLenString(lenBits = 8) { return cstr(this.readBytes(this.readUnsigned(lenBits))); }
  skip(n) { this.pos += n; if (this.pos > this.end) throw new RangeError('BitReader underflow'); }
}

export function cstr(bytes) {
  let n = bytes.indexOf(0);
  if (n < 0) n = bytes.length;
  return Buffer.from(bytes.subarray(0, n)).toString('latin1');
}
