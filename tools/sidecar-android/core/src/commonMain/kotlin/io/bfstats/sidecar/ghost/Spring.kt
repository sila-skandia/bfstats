package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/spring.mjs; keep in step.
//
// Decode a SpringNetworkable ghost body (vehicle suspension / wheel travel).
//
// The body is what SpringNetworkable::setNetUpdate (bf1942_lnxded.static
// 0x08239270) reads; getNetUpdate (0x08239190) is the writer.
//
//   readBits(1) presence mask, then if set:
//     readHighCompressedVector(0.002)   suspension point A
//     readHighCompressedVector(0.002)   suspension point B
//
// readHighCompressedVector (0x083db9e0) is the sibling of readCompressedVector
// with a coarser table, m_highCompressionVectorBitTable = [32, 12, 10, 8]
// (0x08749254).

import io.bfstats.sidecar.BitReader
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.fullVec
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u

object Spring {
  val MASK = mapOf("moved" to 0x1)
  const val SPRING_SCALE = 0.002 // 0x3b03126f
  val HIGH_COMPRESSION_BITS = intArrayOf(32, 12, 10, 8) // m_highCompressionVectorBitTable

  /** BitStream::readHighCompressedVector (0x083db9e0). */
  fun readHighCompressedVector(r: BitReader, ref: List<Double>, scale: Double): MutableList<Any?> {
    val mode = r.u(2).toInt()
    if (mode == 0) return r.fullVec()
    val bits = HIGH_COMPRESSION_BITS[mode]
    val dx = r.sgn(bits); val dy = r.sgn(bits); val dz = r.sgn(bits)
    return mutableListOf(ref[0] + scale * dx, ref[1] + scale * dy, ref[2] + scale * dz)
  }

  /** opts: { refA, refB }. Returns { mask, moved, posA, posB, consumed }. */
  fun decodeSpringBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || (bodyBits != null && bodyBits < 1)) return null
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to null, "moved" to false, "posA" to null, "posB" to null, "consumed" to 0.0)
    try {
      val mask = r.u(1)
      out["mask"] = mask
      out["moved"] = mask == 1.0
      if (mask != 0.0) {
        val ra = (if (JsOps.truthy(opts.g("refA"))) opts.g("refA").dl() else null) ?: listOf(0.0, 0.0, 0.0)
        out["posA"] = readHighCompressedVector(r, ra, SPRING_SCALE)
        val rb = (if (JsOps.truthy(opts.g("refB"))) opts.g("refB").dl() else null) ?: listOf(0.0, 0.0, 0.0)
        out["posB"] = readHighCompressedVector(r, rb, SPRING_SCALE)
      }
    } catch (e: RuntimeException) {
      if (JsOps.truthy(opts.g("strict"))) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
