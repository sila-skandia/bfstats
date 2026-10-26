package io.bfstats.sidecar

// Node Buffer helpers the ported modules share.

private val HEX = "0123456789abcdef".toCharArray()

/** buf.toString('hex'). */
fun ByteArray.hex(from: Int = 0, to: Int = size): String {
  val sb = StringBuilder((to - from) * 2)
  for (i in from until to) { val b = this[i].toInt() and 0xff; sb.append(HEX[b shr 4]).append(HEX[b and 15]) }
  return sb.toString()
}

/** Buffer.from(hex, 'hex'): stops at the first pair that is not hex, as Node does. */
fun fromHex(s: String): ByteArray {
  val out = ByteSink(s.length / 2)
  var i = 0
  while (i + 1 < s.length) {
    val h = hexDigit(s[i]); val l = hexDigit(s[i + 1])
    if (h < 0 || l < 0) break
    out.write((h shl 4) or l)
    i += 2
  }
  return out.toByteArray()
}

fun ByteArray.u8(at: Int): Int = this[at].toInt() and 0xff
fun ByteArray.u16le(at: Int): Int = u8(at) or (u8(at + 1) shl 8)
fun ByteArray.u32le(at: Int): Long = (u8(at).toLong() or (u8(at + 1).toLong() shl 8) or
  (u8(at + 2).toLong() shl 16) or (u8(at + 3).toLong() shl 24))
fun ByteArray.i32le(at: Int): Int = u32le(at).toInt()
fun ByteArray.f32le(at: Int): Double = Float.fromBits(i32le(at)).toDouble()
fun ByteArray.putU16le(at: Int, v: Int) { this[at] = v.toByte(); this[at + 1] = (v shr 8).toByte() }
fun ByteArray.putU32le(at: Int, v: Long) { for (i in 0 until 4) this[at + i] = (v shr (8 * i)).toByte() }
fun ByteArray.putF32le(at: Int, v: Double) = putU32le(at, (v.toFloat()).toRawBits().toLong())
