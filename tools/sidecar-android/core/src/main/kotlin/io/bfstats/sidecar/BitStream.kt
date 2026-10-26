package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/bitstream.mjs: the engine's
// dice::ref2::io::BitStream, as far as the wire needs it. Keep in step.
//
// Bit order is LSB-first within each byte: bit i of the stream is bit (i & 7)
// of byte (i >> 3), and a multi-bit integer goes in least significant bit
// first (BitStream::readBits 0x083daf50, writeBits 0x083db030 in
// bf1942_lnxded.static). A signed integer is a sign bit then |v| in n-1 bits
// (writeSigned 0x083da150). A float is its four IEEE bytes (writeFullVector
// 0x083dac10). A ranged unsigned (min, max) takes the smallest n with
// (1 << n) - 1 >= max - min + 1 (readUnsigned(uint, uint) 0x083da040); note
// the engine's off-by-one, which is why an event type in 0..0x3f takes 7 bits.
//
// Numbers: the Node copy works in JS doubles. Unsigned reads return Long so a
// 32-bit field never goes negative; floats are widened to Double the way a
// DataView getFloat32 widens them, so derived arithmetic matches bit for bit.

/** BitStream::m_compressionVectorBitTable at 0x08749244: mode 0 is the full
 *  32-bit vector, modes 1/2/3 are 20/16/12-bit signed per-axis deltas. */
val COMPRESSION_BITS = intArrayOf(32, 20, 16, 12)

fun rangedBits(min: Long, max: Long): Int {
  var n = 0
  if (max - min != -1L) {
    // JS: ((1 << n) - 1) >>> 0, with the shift taken mod 32.
    do { n++ } while ((((1 shl (n and 31)) - 1).toLong() and 0xffffffffL) < (max - min) + 1)
  }
  return n
}

class BitWriter(capacity: Int = 1472) {
  val buf = ByteArray(capacity)
  /** In bits. */
  var pos = 0
  val byteLength get() = (pos + 7) shr 3
  fun bytes(): ByteArray = buf.copyOf(byteLength)

  fun writeBit(b: Int) {
    if (pos >= buf.size * 8) throw IllegalStateException("BitWriter overflow")
    val i = pos shr 3
    val m = 1 shl (pos and 7)
    buf[i] = if (b != 0) (buf[i].toInt() or m).toByte() else (buf[i].toInt() and m.inv()).toByte()
    pos++
  }
  fun writeBit(b: Boolean) = writeBit(if (b) 1 else 0)

  /** The low n bits of v (JS `Number(v) >>> 0`: v is taken mod 2^32). */
  fun writeUnsigned(v: Long, n: Int) {
    val u = v and 0xffffffffL
    for (i in 0 until n) writeBit(if (i < 32) ((u ushr i) and 1L).toInt() else 0)
  }
  fun writeUnsigned(v: Int, n: Int) = writeUnsigned(v.toLong(), n)

  fun writeSigned(v: Int, n: Int) {
    if (v < 0) { writeBit(1); writeUnsigned(-v.toLong(), n - 1) }
    else { writeBit(0); writeUnsigned(v.toLong(), n - 1) }
  }
  fun writeBool(b: Boolean) = writeBit(b)
  fun writeRanged(v: Long, min: Long, max: Long) = writeUnsigned(v - min, rangedBits(min, max))
  fun writeBytes(bytes: ByteArray, nbits: Int = bytes.size * 8) {
    for (i in 0 until nbits) writeBit((bytes[i shr 3].toInt() shr (i and 7)) and 1)
  }
  fun writeFloat(f: Double) {
    val bits = java.lang.Float.floatToRawIntBits(f.toFloat())
    writeBytes(byteArrayOf(bits.toByte(), (bits shr 8).toByte(), (bits shr 16).toByte(), (bits shr 24).toByte()))
  }
  /** A fixed-width string field: `size` bytes, NUL padded, as the engine's
   *  writeBits(this + off, size * 8) over a char array. */
  fun writeFixedString(s: String, size: Int) {
    val b = ByteArray(size)
    val enc = latin1(s)
    enc.copyInto(b, 0, 0, minOf(enc.size, size - 1))
    writeBytes(b)
  }
  /** Reserve n bits to fill in later (BitStream::skipBits in write mode). */
  fun reserve(n: Int): Int { val at = pos; pos += n; return at }
  /** Write an unsigned at a reserved position without moving the cursor. */
  fun patchUnsigned(at: Int, v: Long, n: Int) { val save = pos; pos = at; writeUnsigned(v, n); pos = save }
}

class BitReaderUnderflow : RuntimeException("BitReader underflow")

class BitReader(val buf: ByteArray, val end: Int = buf.size * 8) {
  var pos = 0
  val remaining get() = end - pos

  fun readBit(): Int {
    if (pos >= end) throw BitReaderUnderflow()
    val b = (buf[pos shr 3].toInt() shr (pos and 7)) and 1
    pos++
    return b
  }
  /** Up to 53 bits, as the Node copy's `v += 2 ** i` is exact to 2^53. */
  fun readUnsigned(n: Int): Long {
    var v = 0L
    for (i in 0 until n) if (readBit() != 0) v += 1L shl i
    return v
  }
  fun readUnsignedInt(n: Int): Int = readUnsigned(n).toInt()
  fun readSigned(n: Int): Long {
    val neg = readBit()
    val m = readUnsigned(n - 1)
    return if (neg != 0) -m else m
  }
  fun readBool() = readBit() == 1
  fun readRanged(min: Long, max: Long): Long = readUnsigned(rangedBits(min, max)) + min
  fun readBytes(nbytes: Int): ByteArray {
    val out = ByteArray(nbytes)
    for (i in 0 until nbytes * 8) if (readBit() != 0) out[i shr 3] = (out[i shr 3].toInt() or (1 shl (i and 7))).toByte()
    return out
  }
  fun readBits(nbits: Int): ByteArray {
    val out = ByteArray((nbits + 7) shr 3)
    for (i in 0 until nbits) if (readBit() != 0) out[i shr 3] = (out[i shr 3].toInt() or (1 shl (i and 7))).toByte()
    return out
  }
  fun readFloat(): Double {
    val b = readBytes(4)
    val bits = (b[0].toInt() and 0xff) or ((b[1].toInt() and 0xff) shl 8) or
      ((b[2].toInt() and 0xff) shl 16) or ((b[3].toInt() and 0xff) shl 24)
    return java.lang.Float.intBitsToFloat(bits).toDouble()
  }

  // The engine's quantised readers (BitStream, bf1942_lnxded.static):
  //   readUnsignedFloat(n)  0x083da440 : readUnsigned(n) / ((1<<n)-1)
  //   readSignedFloat(n)    0x083da280 : 2*readUnsignedFloat(n) - 1
  //   readFullVector        0x083dac50 : three 32-bit floats, absolute
  //   readCompressedVector  0x083db760 : 2-bit mode; 0 -> full vector, else
  //       ref + scale * three readSigned(COMPRESSION_BITS[mode])
  //   readUnitQuaternion    0x083db4f0 : sign bit, x/y/z readSignedFloat(bits),
  //       w = sqrt(1 - min(1, x^2+y^2+z^2)), negated if the sign bit was set
  fun readUnsignedFloat(n: Int): Double {
    // JS `(1 << n) - 1` in doubles: 1 << 31 is negative there, so n = 31
    // gives -2^31 - 1, as the Node copy does.
    val max: Double = if (n == 32) 4294967295.0 else (1 shl (n and 31)).toDouble() - 1
    return readUnsigned(n).toDouble() / max
  }
  fun readSignedFloat(n: Int): Double = 2 * readUnsignedFloat(n) - 1
  fun readFullVector(): DoubleArray = doubleArrayOf(readFloat(), readFloat(), readFloat())
  fun readCompressedVector(ref: DoubleArray, scale: Double): DoubleArray {
    val mode = readUnsigned(2).toInt()
    if (mode == 0) return readFullVector()
    val bits = COMPRESSION_BITS[mode]
    val dx = readSigned(bits); val dy = readSigned(bits); val dz = readSigned(bits)
    return doubleArrayOf(ref[0] + scale * dx, ref[1] + scale * dy, ref[2] + scale * dz)
  }
  fun readUnitQuaternion(bits: Int): DoubleArray {
    val sign = readBit()
    val x = readSignedFloat(bits); val y = readSignedFloat(bits); val z = readSignedFloat(bits)
    var d = x * x + y * y + z * z
    if (d > 1) d = 1.0
    var w = Math.sqrt(1 - d)
    if (sign != 0) w = -w
    return doubleArrayOf(x, y, z, w)
  }
  fun readFixedString(size: Int): String = cstr(readBytes(size))
  fun readLenString(lenBits: Int = 8): String = cstr(readBytes(readUnsigned(lenBits).toInt()))
  fun skip(n: Int) { pos += n; if (pos > end) throw BitReaderUnderflow() }
}

/** Bytes up to the first NUL, as latin1 (bitstream.mjs cstr). */
fun cstr(bytes: ByteArray): String {
  var n = bytes.indexOf(0)
  if (n < 0) n = bytes.size
  return String(bytes, 0, n, Charsets.ISO_8859_1)
}

/** Node's Buffer.from(s, 'latin1'): each UTF-16 unit's low byte. */
fun latin1(s: String): ByteArray = ByteArray(s.length) { s[it].code.toByte() }
