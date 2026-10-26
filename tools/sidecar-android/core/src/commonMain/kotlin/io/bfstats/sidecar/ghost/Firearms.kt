package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/firearms.mjs; keep in step.
//
// Decode a FireArmsNetworkable ghost body (a gun's loaded/ammo state).
//
// FireArmsNetworkable::setNetUpdate (bf1942_lnxed.static 0x08228f70) is the
// reader; getNetUpdate (0x08228e50) is the writer. updateStateMask (0x08228d10)
// raises mask bit 0 when one field changes and bit 1 for the other.
//
//   readBits(2) presence mask, then in this order:
//   0x1  readUnsigned(0, magA + 1)   a magazine/ammo count (value written as n+1)
//   0x2  readUnsigned(0, magB + 1)   the second magazine/ammo count
//
// The two bounds come from the FireArms template (+0x228 / +0x234). A bound
// of -1 means the field is disabled and never written.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.n
import io.bfstats.sidecar.rangedBits
import io.bfstats.sidecar.u

object Firearms {
  val MASK = mapOf("magA" to 0x1, "magB" to 0x2)

  /** opts: { magA, magB } the template magazine bounds. */
  fun decodeFireArmsBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || (bodyBits != null && bodyBits < 2)) return null
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to null, "magA" to null, "magB" to null, "consumed" to 0.0)
    try {
      val mask = r.u(2)
      out["mask"] = mask
      val m = mask.toInt()
      if (m and 0x1 != 0) {
        val bound = opts.n("magA") ?: 0.0
        out["magA"] = r.u(JsOps.rangedBits(0.0, bound + 1)) - 1
      }
      if (m and 0x2 != 0) {
        val bound = opts.n("magB") ?: 0.0
        out["magB"] = r.u(JsOps.rangedBits(0.0, bound + 1)) - 1
      }
    } catch (e: RuntimeException) {
      if (JsOps.truthy(opts.g("strict"))) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
