package io.bfstats.sidecar

// MD5 (RFC 1321: the CD key hash, CdKey.kt) and SHA-1 (FIPS 180-4: the
// WebSocket accept key, WsServer.kt) in plain Kotlin, for every target.
// Checked against java.security.MessageDigest by DigestTest on the JVM and by
// the RFC test vectors on every target.

object Digest {
  private val MD5_S = intArrayOf(
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  )

  /** floor(abs(sin(i + 1)) * 2^32), RFC 1321's table, written out. */
  private val MD5_K = intArrayOf(
    0xd76aa478.toInt(), 0xe8c7b756.toInt(), 0x242070db, 0xc1bdceee.toInt(), 0xf57c0faf.toInt(), 0x4787c62a, 0xa8304613.toInt(), 0xfd469501.toInt(),
    0x698098d8, 0x8b44f7af.toInt(), 0xffff5bb1.toInt(), 0x895cd7be.toInt(), 0x6b901122, 0xfd987193.toInt(), 0xa679438e.toInt(), 0x49b40821,
    0xf61e2562.toInt(), 0xc040b340.toInt(), 0x265e5a51, 0xe9b6c7aa.toInt(), 0xd62f105d.toInt(), 0x02441453, 0xd8a1e681.toInt(), 0xe7d3fbc8.toInt(),
    0x21e1cde6, 0xc33707d6.toInt(), 0xf4d50d87.toInt(), 0x455a14ed, 0xa9e3e905.toInt(), 0xfcefa3f8.toInt(), 0x676f02d9, 0x8d2a4c8a.toInt(),
    0xfffa3942.toInt(), 0x8771f681.toInt(), 0x6d9d6122, 0xfde5380c.toInt(), 0xa4beea44.toInt(), 0x4bdecfa9, 0xf6bb4b60.toInt(), 0xbebfbc70.toInt(),
    0x289b7ec6, 0xeaa127fa.toInt(), 0xd4ef3085.toInt(), 0x04881d05, 0xd9d4d039.toInt(), 0xe6db99e5.toInt(), 0x1fa27cf8, 0xc4ac5665.toInt(),
    0xf4292244.toInt(), 0x432aff97, 0xab9423a7.toInt(), 0xfc93a039.toInt(), 0x655b59c3, 0x8f0ccc92.toInt(), 0xffeff47d.toInt(), 0x85845dd1.toInt(),
    0x6fa87e4f, 0xfe2ce6e0.toInt(), 0xa3014314.toInt(), 0x4e0811a1, 0xf7537e82.toInt(), 0xbd3af235.toInt(), 0x2ad7d2bb, 0xeb86d391.toInt(),
  )

  /** The message padded to whole 64-byte blocks with its bit length, little-
   *  or big-endian. */
  private fun pad(msg: ByteArray, bigEndian: Boolean): ByteArray {
    val n = msg.size
    val total = ((n + 8) / 64 + 1) * 64
    val out = msg.copyOf(total)
    out[n] = 0x80.toByte()
    val bits = n.toLong() * 8
    for (i in 0 until 8) {
      val b = (bits ushr (8 * i)).toByte()
      if (bigEndian) out[total - 1 - i] = b else out[total - 8 + i] = b
    }
    return out
  }

  fun md5(msg: ByteArray): ByteArray {
    var a0 = 0x67452301
    var b0 = 0xefcdab89.toInt()
    var c0 = 0x98badcfe.toInt()
    var d0 = 0x10325476
    val m = pad(msg, bigEndian = false)
    val w = IntArray(16)
    for (blk in 0 until m.size / 64) {
      for (i in 0 until 16) {
        val o = blk * 64 + i * 4
        w[i] = (m[o].toInt() and 0xff) or ((m[o + 1].toInt() and 0xff) shl 8) or ((m[o + 2].toInt() and 0xff) shl 16) or ((m[o + 3].toInt() and 0xff) shl 24)
      }
      var a = a0; var b = b0; var c = c0; var d = d0
      for (i in 0 until 64) {
        val f: Int; val g: Int
        when (i shr 4) {
          0 -> { f = (b and c) or (b.inv() and d); g = i }
          1 -> { f = (d and b) or (d.inv() and c); g = (5 * i + 1) and 15 }
          2 -> { f = b xor c xor d; g = (3 * i + 5) and 15 }
          else -> { f = c xor (b or d.inv()); g = (7 * i) and 15 }
        }
        val t = d
        d = c
        c = b
        b += (a + f + MD5_K[i] + w[g]).rotateLeft(MD5_S[i])
        a = t
      }
      a0 += a; b0 += b; c0 += c; d0 += d
    }
    val out = ByteArray(16)
    for ((j, v) in intArrayOf(a0, b0, c0, d0).withIndex()) for (i in 0 until 4) out[j * 4 + i] = (v ushr (8 * i)).toByte()
    return out
  }

  fun sha1(msg: ByteArray): ByteArray {
    var h0 = 0x67452301
    var h1 = 0xefcdab89.toInt()
    var h2 = 0x98badcfe.toInt()
    var h3 = 0x10325476
    var h4 = 0xc3d2e1f0.toInt()
    val m = pad(msg, bigEndian = true)
    val w = IntArray(80)
    for (blk in 0 until m.size / 64) {
      for (i in 0 until 16) {
        val o = blk * 64 + i * 4
        w[i] = ((m[o].toInt() and 0xff) shl 24) or ((m[o + 1].toInt() and 0xff) shl 16) or ((m[o + 2].toInt() and 0xff) shl 8) or (m[o + 3].toInt() and 0xff)
      }
      for (i in 16 until 80) w[i] = (w[i - 3] xor w[i - 8] xor w[i - 14] xor w[i - 16]).rotateLeft(1)
      var a = h0; var b = h1; var c = h2; var d = h3; var e = h4
      for (i in 0 until 80) {
        val f: Int; val k: Int
        when {
          i < 20 -> { f = (b and c) or (b.inv() and d); k = 0x5a827999 }
          i < 40 -> { f = b xor c xor d; k = 0x6ed9eba1 }
          i < 60 -> { f = (b and c) or (b and d) or (c and d); k = 0x8f1bbcdc.toInt() }
          else -> { f = b xor c xor d; k = 0xca62c1d6.toInt() }
        }
        val t = a.rotateLeft(5) + f + e + k + w[i]
        e = d; d = c; c = b.rotateLeft(30); b = a; a = t
      }
      h0 += a; h1 += b; h2 += c; h3 += d; h4 += e
    }
    val out = ByteArray(20)
    for ((j, v) in intArrayOf(h0, h1, h2, h3, h4).withIndex()) for (i in 0 until 4) out[j * 4 + i] = (v ushr (24 - 8 * i)).toByte()
    return out
  }
}
