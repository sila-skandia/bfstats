package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/rotational-bundle.mjs; keep in step.
//
// Decode a RotationalBundle's ghost body: the yaw/pitch/roll angles of a
// turret or gun part, plus the per-axis servo rates and one aux value.
//
// RotationalBundleNetworkable::getNetUpdate (lnxded 0x082345c0) writes and
// setNetUpdate (0x082347f0) reads; the two share one layout.
//
//   readBits(7) mask, then one field per set mask bit, in mask-bit order:
//   0x01  angleX   readSignedFloat(16) * 180    object+0x104  (deg, wrapped +/-180)
//   0x02  angleY   readSignedFloat(16) * 180    object+0x108
//   0x04  angleZ   readSignedFloat(16) * 180    object+0x10c
//   0x08  rateX    readSignedFloat(16) * Lx     object+0x110  (Lx = |template+0x174| * 16)
//   0x10  rateY    readSignedFloat(16) * Ly     object+0x114  (Ly = |template+0x178| * 16)
//   0x20  rateZ    readSignedFloat(16) * Lz     object+0x118  (Lz = |template+0x17c| * 16)
//   0x40  aux      readSignedFloat(16) * 41.0   object+0x12c
//
// There is no internal try/catch: the BitReader underflow propagates.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.u

object RotationalBundle {
  private const val MASK_BITS = 7
  private const val FIELD_BITS = 16
  private const val ANGLE_LIMIT = 180.0 // 0x43340000
  private const val AUX_LIMIT = 41.0    // 0x42240000

  val MASK = mapOf("angleX" to 0x01, "angleY" to 0x02, "angleZ" to 0x04, "rateX" to 0x08, "rateY" to 0x10, "rateZ" to 0x20, "aux" to 0x40)

  /** Length of a body for a given 7-bit mask. */
  fun rotationalBundleBodyBits(mask: Int): Int {
    var n = 0
    var m = mask and 0x7f
    while (m != 0) { n += m and 1; m = m shr 1 }
    return MASK_BITS + FIELD_BITS * n
  }

  fun decodeRotationalBundleBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || bodyBits == null || bodyBits < MASK_BITS) return null
    val lim = (if (JsOps.truthy(opts.g("rateLimits"))) opts.g("rateLimits").dl() else null) ?: listOf(1.0, 1.0, 1.0)
    val r = hexReader(bodyHex, bodyBits)
    val mask = r.u(MASK_BITS)
    val m = mask.toInt()
    val out = linkedMapOf<String, Any?>(
      "mask" to mask, "angleX" to null, "angleY" to null, "angleZ" to null,
      "rateX" to null, "rateY" to null, "rateZ" to null, "aux" to null, "consumed" to 0.0,
    )
    out["angleX"] = if (m and 0x01 != 0) r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT else null
    out["angleY"] = if (m and 0x02 != 0) r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT else null
    out["angleZ"] = if (m and 0x04 != 0) r.readSignedFloat(FIELD_BITS) * ANGLE_LIMIT else null
    out["rateX"] = if (m and 0x08 != 0) r.readSignedFloat(FIELD_BITS) * lim[0] else null
    out["rateY"] = if (m and 0x10 != 0) r.readSignedFloat(FIELD_BITS) * lim[1] else null
    out["rateZ"] = if (m and 0x20 != 0) r.readSignedFloat(FIELD_BITS) * lim[2] else null
    out["aux"] = if (m and 0x40 != 0) r.readSignedFloat(FIELD_BITS) * AUX_LIMIT else null
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
